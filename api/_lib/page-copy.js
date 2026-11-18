// api/_lib/page-copy.js
// The one page-copy generator. Every path that writes a business page with
// the AI goes through here:
//   - api/generate-business.js admin JSON path (Jack's bulk pages): buildAdminPrompt
//   - api/generate-business.js self-serve create/edit form: buildSelfServePrompt
//   - outbound and instant previews (ga-metrics.js generatePreviewForProspect,
//     via preview-generator.js): buildFactsPrompt
// and all of them share:
//   - one output schema, sent as OpenAI structured output (response_format
//     json_schema, strict) by requestCopy(), so the reply is always parseable
//     JSON in one shape: faqs as {q, a}, why_choose_us as one string with a
//     line per reason, how_it_works as 3 {title, text} steps
//   - the honesty rules: no "several years" when years aren't given, no
//     hard-coded state, no "free estimate" unless the owner said so
//     (offersFreeEstimates), no license / insurance claims unless given
//   - the facts-only check (applyFactRules, first written for previews as
//     validateGenerated): numbers that aren't in the input, rating claims, and
//     license / insurance / guarantee / award claims the input doesn't support
//     are dropped, sentence by sentence
//   - the copy check: lintCopy (banned words), one AI retry with the problems
//     listed (kept only if it's better), then scrubCopy (finishGenerated).
// Pure functions apart from requestCopy and the retry callback.

import { callCtaLabel, offersFreeEstimates } from "./page-claims.js";
import { lintCopy, scrubCopy, fixInstructions, BANNED_WORDS } from "./copy-lint.js";
import { evidenceMap } from "./fact-sheet.js";
import { isStrongRating } from "./page-style.js";

const NOT_PROVIDED = "not provided";
const given = v => {
  const s = String(v ?? "").trim();
  return s && s.toLowerCase() !== "undefined" && s.toLowerCase() !== "null" ? s : "";
};

/**
 * Years in business from a number, or from the owner's own words
 * ("we've been mowing for 12 years", "since 2004"). null when not stated.
 */
export function yearsInBusinessFrom(value, text = "", now = new Date()) {
  const n = Number(value);
  if (Number.isFinite(n) && n > 0 && n < 200) return Math.round(n);
  const t = String(text || "");
  const m = t.match(/\b(\d{1,3})\+?\s*(?:years?|yrs?)\b/i);
  if (m && Number(m[1]) > 0 && Number(m[1]) < 200) return Number(m[1]);
  const since = t.match(/\bsince\s+((?:19|20)\d\d)\b/i);
  if (since) {
    const y = now.getFullYear() - Number(since[1]);
    if (y > 0 && y < 200) return y;
  }
  return null;
}

/** The seo_title instruction: the business's own state, or no state at all. */
export function seoTitleFormat(state) {
  const st = given(state);
  return st
    ? `"[Business Name] — [Trade] in [City], ${st} | [Short differentiator]"`
    : `"[Business Name] — [Trade] in [City] | [Short differentiator]" (no state was given, so don't add one)`;
}

const HONESTY_RULE = `HONESTY RULE (applies to every field below): only state facts that were actually
given in BUSINESS INPUT above — years in business, specific towns, certifications,
licensing, staff size, founding story, free estimates, etc. If a detail says
"${NOT_PROVIDED}" or wasn't given, do not invent it or a stand-in for it ("several
years", "decades of experience", "licensed & insured"). Write shorter and more
general instead. Under-claiming is fine; fabricating a fact a real customer or
competitor could catch as false is not.`;

function yearsRule(years) {
  return years
    ? `Years in business is ${years}. You may mention it once or twice; don't round it up.`
    : `Years in business: ${NOT_PROVIDED}. Do not mention years, "since <year>", decades, or how long the business has been around in ANY field.`;
}

function freeRule(free) {
  return free
    ? `The business offers free estimates; you may say so.`
    : `Free estimates: ${NOT_PROVIDED}. Never say estimates, quotes or consultations are free, in any field (FAQ answers included). Say "call for a quote" instead.`;
}

const JSON_SCHEMA = `JSON SCHEMA:
{
  "seo_title": "",
  "seo_description": "",
  "hero_headline": "",
  "hero_tagline": "",
  "about": "",
  "why_choose_us": "",
  "services_intro": "",
  "trust_badges": [],
  "faqs": [{ "q": "", "a": "" }],
  "services": [{ "service_name": "", "service_description": "" }],
  "how_it_works": [{ "title": "", "text": "" }],
  "service_area": [],
  "primary_cta": { "label": "", "type": "call|email|form|link", "value": "" }
}`;

// Facts the owner can give in the create form / dashboard (migration
// 20261114_profile_upgrade). Snake_case keys on the input object.
function ownerFactLines(input = {}) {
  const lic = given(input.license_number);
  const st = given(input.state);
  const insured = input.is_insured === true ? "yes" : input.is_insured === false ? "no" : NOT_PROVIDED;
  const reply = given(input.response_time);
  return [
    `License number: ${lic ? `${lic}${st ? ` (${st})` : ""}` : NOT_PROVIDED}`,
    `Insured: ${insured}`,
    `Usually replies: ${reply || NOT_PROVIDED}`,
  ].join("\n");
}

// Rules every prompt shares for the newer outputs.
const SHARED_RULES = `services: keep the services given (same names, same order; add none). Each service_description is 1-2 sentences about that service using only details from BUSINESS INPUT (what's included, how often, which season, where). If nothing specific was given about a service, keep it short and plain rather than invent details.
how_it_works: exactly 3 short steps for how a customer hires this business, as {"title","text"} (title 2-5 words, text one short sentence). Describe the process only (get in touch, get a quote, the work gets done). No facts about the business that aren't in BUSINESS INPUT: no times, prices, guarantees, years or team details unless given.
service_area: the towns or areas from BUSINESS INPUT only; an empty list if none were given.
licensing and insurance: say "licensed" only if a license number is given above, and "insured" only if Insured is "yes".
Return empty strings or empty lists for anything you can't fill from BUSINESS INPUT.`;

/** The admin JSON path (bulk previews): businessName, ownerFirstName, trade, phone, town, state, areasServed, yearsInBusiness, services. */
export function buildAdminPrompt(input = {}) {
  const years = yearsInBusinessFrom(input.yearsInBusiness ?? input.years_in_business);
  const free = offersFreeEstimates(input);
  const services = (Array.isArray(input.services) ? input.services : []).map(given).filter(Boolean);
  const areas = (Array.isArray(input.areasServed) ? input.areasServed : []).map(given).filter(Boolean);
  const town = given(input.town), state = given(input.state), phone = given(input.phone);
  return `You are a copywriter for local businesses. Write copy that sounds like it was written by someone who actually knows this business — not a generic template.
Return ONLY JSON in the schema below (no markdown, no commentary).

${JSON_SCHEMA}

BUSINESS INPUT:
Name: ${given(input.businessName)}
Owner first name: ${given(input.ownerFirstName) || NOT_PROVIDED}
Trade: ${given(input.trade) || NOT_PROVIDED}
Phone: ${phone || NOT_PROVIDED}
Town: ${[town, state].filter(Boolean).join(", ") || NOT_PROVIDED}
Service areas: ${areas.join(", ") || town || NOT_PROVIDED}
Years in business: ${years ? `${years} years` : NOT_PROVIDED}
Free estimates: ${free ? "yes" : NOT_PROVIDED}
${ownerFactLines(input)}
Services: ${services.join(", ") || NOT_PROVIDED}

${HONESTY_RULE}

COPY RULES:
hero_headline: Include the town and trade if given. Be direct and specific. AVOID: trusted, reliable, professional, quality, dedicated.
hero_tagline: One sentence. Mention the owner's name if given and the towns served. Be factual.
about: 2 paragraphs separated by \\n\\n. Who they are and who they serve, from the facts above only. Use the owner's name if given. BANNED: trusted, reliable, professional, quality, dedicated, passionate, commitment, excellence, proud, strive, ensure, seamless.
why_choose_us: ONE string, 3-5 lines separated by \\n, no bullet characters. Each line = a specific fact from BUSINESS INPUT, not a vague claim. Fewer lines is fine.
services_intro: One specific sentence about what they do and where.
faqs: 5 questions real customers ask before hiring, as {"q","a"}. Include pricing, service area, scheduling. Answers must not state facts that aren't in BUSINESS INPUT.
trust_badges: up to 5 short phrases, each a fact from BUSINESS INPUT. Return fewer (or none) rather than invent one.
years: ${yearsRule(years)}
free estimates: ${freeRule(free)}
seo_title: ${seoTitleFormat(state)}
seo_description: 1-2 sentences with business name, city, trade${phone ? ", phone" : ""}.
${SHARED_RULES}
primary_cta: type="call", value="${phone}", label="${callCtaLabel(input)}"`;
}

/**
 * The self-serve form. `f` is the parsed form with single values:
 * business_name, primary_category, tone, notes, services_json, address, phone,
 * website, city, state, service_area, owner_name, trust_badges, testimonials,
 * accepting_clients, offers_emergency.
 */
export function buildSelfServePrompt(f = {}) {
  const notes = given(f.notes);
  const years = yearsInBusinessFrom(f.years_in_business, notes);
  const free = offersFreeEstimates(f);
  const cat = given(f.primary_category);
  const owner = given(f.owner_name);
  const city = given(f.city);
  return `
You are a copywriter who specializes in local businesses. Your job is to write copy that sounds like it was written by someone who actually knows this specific business — not a generic template.
Return ONLY JSON in the schema below (no markdown, no commentary).

${JSON_SCHEMA}

BUSINESS INPUT:
Business name: ${given(f.business_name)}
Trade/category: ${!cat || cat === "other" ? "general local service business (no specific trade given)" : cat}
Tone preference: ${given(f.tone) || NOT_PROVIDED}
Owner notes: ${notes || NOT_PROVIDED}
Services (JSON): ${given(f.services_json) || "[]"}
Address: ${given(f.address) || NOT_PROVIDED}
Phone: ${given(f.phone) || NOT_PROVIDED}
Website: ${given(f.website) || NOT_PROVIDED}
City: ${city || NOT_PROVIDED}
State: ${given(f.state) || NOT_PROVIDED}
Service areas: ${given(f.service_area) || NOT_PROVIDED}
Owner name: ${owner || NOT_PROVIDED}
Years in business: ${years ? `${years} years` : NOT_PROVIDED}
Free estimates: ${free ? "yes" : NOT_PROVIDED}
${ownerFactLines(f)}
Existing trust badges: ${given(f.trust_badges) || "none"}
Existing testimonials: ${given(f.testimonials) || "none"}
Operational flags:
- Accepting clients: ${!!f.accepting_clients}
- Emergency services: ${!!f.offers_emergency}

${HONESTY_RULE}

COPY INSTRUCTIONS:

hero_headline:
- Include the city/town name and trade category for local SEO, but ONLY if a
  city/town was actually provided in BUSINESS INPUT — if none was given, build
  the headline from the business name and trade instead of inventing a location
- Be direct and specific — what makes this business worth calling?
- AVOID: "trusted," "reliable," "professional," "your go-to," "quality service"

hero_tagline:
- One sentence. Include owner name if provided and towns served if provided.
- AVOID vague promises. Be factual.

about:
- 2 paragraphs separated by \\n\\n
- Paragraph 1: what makes this business different, from the owner notes. Use owner name if provided.
- Paragraph 2: who they serve today. Specific towns and types of customers only if given.
- BANNED WORDS: trusted, reliable, professional, quality, dedicated, passionate, commitment, excellence, proud, strive, ensure, seamless
- Write like a person, not a press release. Short sentences are fine.

why_choose_us:
- ONE string: 3-5 lines separated by \\n, NO bullet characters or dashes
- Each line should be a specific, concrete reason from BUSINESS INPUT — not a vague claim. Fewer lines is fine.
- Lead each line with the specific fact, THEN the brief explanation
- GOOD: "Owner on every job — ${owner || "the owner"} is hands-on, not managing from an office" (only if the notes say so)
- BAD: "Experienced team", "Quality workmanship", "Customer satisfaction guaranteed"

services_intro:
- One sentence. Specific to this trade and location. Not "we offer a wide range of services."

faqs:
- 5 questions a real customer would actually type into Google before hiring this type of business, as {"q","a"}
- Include at least one about pricing/estimates, one about service area, one about scheduling/availability
- Answers should be specific to this business where possible, and never state a fact that isn't in BUSINESS INPUT
- Emergency/after-hours: follow the "Emergency services" flag above exactly. If it is
  false, never say or imply they offer emergency or after-hours work. If it is true,
  never say they don't. If you write an FAQ about it, the answer must match the flag.
- Customer type: only say "commercial" or "residential" if BUSINESS INPUT says so, and
  never both "residential only" in one place and "commercial" in another.

trust_badges:
- Up to 5 short phrases, each a fact from BUSINESS INPUT (licensing, years, rating) only if given. Return fewer, or none, rather than invent one.
- BAD: "Trusted Professionals", "Quality Work", "Customer First"

Years in business: ${yearsRule(years)}
Free estimates: ${freeRule(free)}

seo_title: ${seoTitleFormat(f.state)}
seo_description: 1-2 sentences. Include business name, city, trade, phone if provided. Should read like a real search result snippet, not marketing copy.

${SHARED_RULES}

primary_cta: If phone is provided, set type to "call", value to the phone number and label to "${callCtaLabel(f)}". Otherwise an action-oriented label for the email or link, never promising anything free.
`.trim();
}

/** why_choose_us as one string, a line per reason, from a string or an array of strings / {title, description}. */
export function whyToString(why) {
  if (Array.isArray(why)) {
    return why.map(w => {
      if (typeof w === "string") return w.trim();
      if (w && typeof w === "object") {
        const title = String(w.title || w.name || "").trim();
        const desc = String(w.description || w.text || "").trim();
        return desc ? (title ? `${title} — ${desc}` : desc) : title;
      }
      return "";
    }).filter(Boolean).join("\n");
  }
  return typeof why === "string" ? why.trim() : "";
}

/** The AI's JSON in the one shape the page renders. */
export function normalizeGenerated(raw) {
  const g = raw && typeof raw === "object" ? raw : {};
  const str = v => (typeof v === "string" ? v.trim() : "");
  return {
    ...g,
    seo_title: str(g.seo_title),
    seo_description: str(g.seo_description),
    hero_headline: str(g.hero_headline),
    hero_tagline: str(g.hero_tagline),
    about: str(g.about),
    services_intro: str(g.services_intro),
    why_choose_us: whyToString(g.why_choose_us),
    trust_badges: (Array.isArray(g.trust_badges) ? g.trust_badges : []).map(b => String(b || "").trim()).filter(Boolean),
    services: (Array.isArray(g.services) ? g.services : [])
      .filter(s => s && (s.service_name || s.name))
      .map(s => ({ service_name: String(s.service_name || s.name || "").trim(), service_description: String(s.service_description || s.description || "").trim() }))
      .filter(s => s.service_name),
    faqs: (Array.isArray(g.faqs) ? g.faqs : [])
      .map(f => ({ q: String(f?.q || f?.question || "").trim(), a: String(f?.a || f?.answer || "").trim() }))
      .filter(f => f.q && f.a),
    how_it_works: normalizeSteps(g.how_it_works),
    service_area: (Array.isArray(g.service_area) ? g.service_area : []).map(t => String(t || "").trim()).filter(Boolean),
    primary_cta: g.primary_cta && typeof g.primary_cta === "object" ? { ...g.primary_cta } : {},
  };
}

/** how_it_works as exactly 3 {title, text} steps, or [] (never a partial list). */
export function normalizeSteps(v) {
  let list = v;
  if (typeof list === "string") { try { list = JSON.parse(list); } catch { list = []; } }
  const steps = (Array.isArray(list) ? list : [])
    .map(st => ({ title: String(st?.title || "").trim().slice(0, 60), text: String(st?.text || st?.description || "").trim().slice(0, 200) }))
    .filter(st => st.title);
  return steps.length >= 3 ? steps.slice(0, 3) : [];
}

/** The CTA label we store: never "free" unless the business offers free estimates. */
export function honestCtaLabel(cta = {}, profile = {}) {
  const type = String(cta.type || "").toLowerCase();
  if (!type || type === "call" || type === "phone") return callCtaLabel(profile);
  const label = String(cta.label || "").trim();
  if (offersFreeEstimates(profile)) return label;
  return label.replace(/\bfree,?\s+(no[- ]obligation\s+)?/i, "").replace(/^\w/, c => c.toUpperCase()).trim();
}

/** lintCopy flags for a page: what we know (and don't) about the business. */
export function lintFlagsFor({ offersEmergency = false, yearsInBusiness = null, profile = {} } = {}) {
  return {
    offers_emergency: !!offersEmergency,
    offers_free_estimates: offersFreeEstimates(profile),
    years_in_business: yearsInBusiness || null,
  };
}

/**
 * Normalize → facts-only rules (when a source is given) → lint → one retry if there are problems (kept only if it parses
 * and has fewer) → scrub → honest CTA label. Same steps for both paths.
 * `retry(extraPrompt)` returns the AI's parsed JSON or null; it may throw.
 * Returns { generated, issues } (issues = what's left after the scrub).
 */
export async function finishGenerated(raw, { flags = {}, profile = {}, source = null, retry = null, log = () => {} } = {}) {
  // source: the facts we were given (factSourceText). When present, the
  // facts-only rules run first, on the first draft and on any retry.
  const facts = g => (source == null ? g : applyFactRules(g, source));
  let generated = normalizeGenerated(facts(normalizeGenerated(raw)));
  const firstIssues = lintCopy(generated, flags);
  if (firstIssues.length && retry) {
    try {
      const again = await retry(fixInstructions(firstIssues));
      if (again && typeof again === "object" && Array.isArray(again.services)) {
        const retried = normalizeGenerated(facts(normalizeGenerated(again)));
        if (!retried.primary_cta || !Object.keys(retried.primary_cta).length) retried.primary_cta = generated.primary_cta;
        if (lintCopy(retried, flags).length < firstIssues.length) generated = retried;
      }
    } catch (e) {
      log(`copy-lint retry failed: ${e?.message || e}`);
    }
  }
  generated = scrubCopy(generated, flags);
  generated.primary_cta = { ...generated.primary_cta, label: honestCtaLabel(generated.primary_cta, profile) };
  return { generated, issues: lintCopy(generated, flags) };
}

// ── Structured output ────────────────────────────────────────────────────
// One schema for every path, sent as response_format json_schema (strict),
// so the model can't return malformed or differently shaped JSON. Strict
// mode needs every key listed as required: "not given" is "" or [].

const str = { type: "string" };
const strList = { type: "array", items: str };
const obj = (properties) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });

export const COPY_SCHEMA = obj({
  seo_title: str,
  seo_description: str,
  hero_headline: str,
  hero_tagline: str,
  about: str,
  why_choose_us: str,
  services_intro: str,
  trust_badges: strList,
  faqs: { type: "array", items: obj({ q: str, a: str }) },
  services: { type: "array", items: obj({ service_name: str, service_description: str }) },
  how_it_works: { type: "array", items: obj({ title: str, text: str }) },
  service_area: strList,
  primary_cta: obj({ label: str, type: { type: "string", enum: ["call", "email", "form", "link"] }, value: str }),
});

export const COPY_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: { name: "page_copy", strict: true, schema: COPY_SCHEMA },
};

/** The chat/completions request body for a prompt (exported for tests). */
export function copyRequestBody(prompt, { model = "gpt-4o", temperature = 0.2 } = {}) {
  return {
    model, temperature,
    response_format: COPY_RESPONSE_FORMAT,
    messages: [
      { role: "system", content: "You write website copy for small local businesses as JSON in the given schema. Use only facts you are given." },
      { role: "user", content: prompt },
    ],
  };
}

/**
 * Ask the model for page copy. Returns the parsed object. Throws an Error
 * whose .code is "ai_request_failed", "ai_refused" or "ai_empty_response".
 */
export async function requestCopy(prompt, { fetchImpl = globalThis.fetch, apiKey = process.env.OPENAI_KEY, model, temperature } = {}) {
  const fail = (code, message) => Object.assign(new Error(message || code), { code });
  const r = await fetchImpl("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(copyRequestBody(prompt, { model, temperature })),
  });
  if (!r.ok) throw fail("ai_request_failed", `OpenAI error: ${await r.text().catch(() => r.status)}`);
  const msg = (await r.json())?.choices?.[0]?.message;
  if (msg?.refusal) throw fail("ai_refused", String(msg.refusal).slice(0, 300));
  if (!msg?.content) throw fail("ai_empty_response");
  return JSON.parse(msg.content); // strict json_schema: always valid JSON in COPY_SCHEMA
}

// ── Preview prompt (outbound + instant previews) ─────────────────────────
// SOURCE is the business's own website text and Google listing; nobody has
// told us anything else, so the rules are the strictest.

export function buildFactsPrompt({ name, trade, city, state, phone, address, siteText, googleTypes, hours }) {
  return `You are writing a one-page website for a real local business. Use ONLY the facts in SOURCE below.

HARD RULES
- Never invent facts: no years in business, license numbers, guarantees, certifications, pricing, awards, owner names, team size, or services that SOURCE does not state.
- If SOURCE does not support a field, return an empty string or empty array for it. Empty is better than invented.
- No puffery words: trusted, reliable, professional, quality, dedicated, passionate, excellence, premier, top-notch, best, #1, leading.
- Do not mention ratings, stars or review counts (the page shows the real rating separately).
- Plain, specific, homeowner-facing language. Short sentences.

SOURCE
Business name: ${name}
Trade (from Google): ${trade}${googleTypes?.length ? ` (${googleTypes.join(", ")})` : ""}
Location: ${[city, state].filter(Boolean).join(", ")}${address ? ` — ${address}` : ""}
Phone: ${phone}
${hours?.length ? `Hours: ${hours.join("; ")}\n` : ""}Website text (may be empty):
"""
${String(siteText || "").slice(0, 7000)}
"""

FIELDS
hero_headline: 6-9 words: what they do + where. No business name.
hero_tagline: one sentence from SOURCE facts.
about: 1-2 short paragraphs separated by \\n\\n, only SOURCE facts.
services_intro: one sentence.
services: 3-6, grouped from services SOURCE lists; if none are listed, one entry for the trade itself. Descriptions only from SOURCE.
service_area: only towns SOURCE lists; else just the business's town.
why_choose_us: 0-5 short concrete facts from SOURCE, one per line (\\n), as one string.
trust_badges: 0-4 facts from SOURCE, 2-4 words each.
faqs: 2-4 {q, a}; answers only from SOURCE (area served, how to get a quote, services).
how_it_works: exactly 3 short steps for how a customer hires them (get in touch, get a quote, the work gets done), {title, text}. No times, prices or promises SOURCE doesn't state.
seo_title, seo_description: "" (the page builds these).
primary_cta: type "call", value the phone, label "".`;
}

// ── Facts-only rules (all paths) ─────────────────────────────────────────
// Every claim must trace back to what we were given: the business's website
// and Google listing for previews, the owner's own answers for the form.
// Numbers that aren't in the source are dropped with their sentence; so are
// rating claims (the page shows the real rating itself) and claims about
// licensing, insurance, guarantees, awards and the like that the source
// doesn't make. Short claims (badges, why-us lines) must also share a
// distinctive word with the source.

export const PUFFERY = /\b(trusted|reliable|professional|quality|dedicated|passionate|excellence|premier|top-notch|best|#1|leading)\b/gi;
// Non-global twin for .test() (a /g regex keeps lastIndex between calls).
const PUFFERY_ONE = new RegExp(PUFFERY.source, "i");
const RATING = /(\d(\.\d)?\s*★|\bstars?\b|\breviews?\b|\brated\b)/i;
// [claim in the copy, what the source must contain to back it]
const CLAIMS = [
  [/\blicen[cs](ed|e)\b/i, /licen[cs]|\bmaster (plumber|electrician|gasfitter)|\bjourneyman\b|\blic\.?\s*#/],
  [/\binsured\b|\binsurance\b/i, /insur/],
  [/\bbonded\b/i, /bonded/],
  [/\bcertifi(ed|cation|cations)\b/i, /certifi/],
  [/\bguarantee(d|s)?\b/i, /guarant/],
  [/\bwarrant(y|ies|ied)\b/i, /warrant/],
  [/\baward/i, /award/],
  [/\bfamily[- ](owned|run|operated|business)\b/i, /family/],
  [/\bveteran/i, /veteran/],
  [/\bdecades?\b|\byears of (experience|service)\b|\bexperienced\b/i, /decade|\byears?\b|since (19|20)\d\d|experience/],
  [/\bfree[\s,-]+(no[\s-]obligation\s+)?(estimates?|quotes?|consultations?|inspections?)\b|\b(estimates?|quotes?) (are|is) (always )?free\b/i, /free (estimate|quote|consult|inspection)|(estimates?|quotes?) (are|is) free/],
  [/\b24\/7\b|\bemergency\b|\bafter[- ]hours\b/i, /24\/7|emergency|after[- ]hours|24 hours/],
  [/\bsame[- ]day\b/i, /same[- ]day/],
];

function numbersIn(s) { return (String(s).match(/\d[\d,]*/g) || []).map(n => n.replace(/,/g, "")); }
const STOP = new Set("about after also always and any are best call can come customers every from have home homes into just local more most need needs only other our over same service services that their them they this through throughout time today very what when where which will with work your".split(" "));

/** The rules, bound to one source. */
export function factChecker(sourceText) {
  const src = String(sourceText || "");
  const srcLc = src.toLowerCase();
  const srcNums = new Set(numbersIn(src));
  const clean = t => {
    // Whitespace only. Puffery is never cut out of a sentence (that turned
    // "ensuring quality and integrity" into "ensuring and integrity"): a
    // sentence with a puffery word is dropped whole by keep() below.
    const c = String(t || "").replace(/\s{2,}/g, " ").replace(/\s+([,.])/g, "$1").trim();
    return c.charAt(0).toUpperCase() + c.slice(1);
  };
  const unsupportedNumber = t => numbersIn(t).some(n => n.length >= 2 && !srcNums.has(n));
  const unsupportedClaim = t => CLAIMS.some(([claim, need]) => claim.test(t) && !need.test(srcLc));
  const keep = t => !!t && !RATING.test(t) && !PUFFERY_ONE.test(t) && !unsupportedNumber(t) && !unsupportedClaim(t);
  const grounded = t => {
    if (!srcLc) return false;
    const words = String(t).toLowerCase().match(/[a-z]{5,}/g) || [];
    return words.some(w => !STOP.has(w) && srcLc.includes(w.slice(0, Math.max(5, w.length - 2))));
  };
  const sentences = text => String(text || "").split(/\n\n+/).map(par =>
    par.split(/(?<=[.!?])\s+/).map(clean).filter(keep).join(" ")
  ).filter(Boolean).join("\n\n");
  return { clean, keep, grounded, sentences, unsupportedNumber, unsupportedClaim };
}

/**
 * The text a page's claims are checked against, built from the facts we
 * were actually given (never from the prompt, which says "Free estimates:
 * not provided" and would otherwise back the claim it forbids).
 */
export function factSourceText(input = {}) {
  const parts = [];
  const add = v => { const s = Array.isArray(v) ? v.map(x => (typeof x === "object" ? JSON.stringify(x) : x)).join(", ") : given(typeof v === "object" && v ? JSON.stringify(v) : v); if (s) parts.push(s); };
  for (const k of ["business_name", "businessName", "primary_category", "trade", "notes", "about", "services_json", "services",
    "address", "phone", "website", "city", "town", "state", "service_area", "areasServed", "owner_name", "ownerFirstName",
    "trust_badges", "testimonials", "siteText", "hours"]) add(input[k]);
  const years = yearsInBusinessFrom(input.years_in_business ?? input.yearsInBusiness, given(input.notes));
  if (years) parts.push(`${years} years in business`);
  if (given(input.license_number)) parts.push(`licensed, license number ${given(input.license_number)}`);
  if (input.is_insured === true) parts.push("insured");
  if (offersFreeEstimates(input)) parts.push("free estimates");
  if (given(input.response_time)) parts.push(`replies ${given(input.response_time)}`);
  if (input.offers_emergency === true) parts.push("emergency service");
  return parts.join("\n");
}

/**
 * Apply the facts-only rules to generated copy (raw or normalized shape).
 * Keeps the input's shapes (why_choose_us string or array). Pure.
 */
export function applyFactRules(gen, sourceText) {
  const g = gen && typeof gen === "object" ? gen : {};
  const { clean, keep, grounded, sentences } = factChecker(sourceText);
  const s = v => (typeof v === "string" ? v : "");
  const arr = v => (Array.isArray(v) ? v : []);
  const line = t => { const c = clean(t); return keep(c) && grounded(c) ? c : ""; };
  const whyLines = Array.isArray(g.why_choose_us)
    ? g.why_choose_us.map(w => (typeof w === "string" ? w : [w?.title, w?.description].filter(Boolean).join(" — ")))
    : s(g.why_choose_us).split("\n");
  const why = whyLines.map(line).filter(Boolean);
  const headline = clean(s(g.hero_headline));
  const seoTitle = s(g.seo_title).trim();
  const steps = arr(g.how_it_works).map(st => ({ title: clean(st?.title), text: clean(st?.text || st?.description) }));
  const out = {
    ...g,
    hero_headline: keep(headline) ? headline : "",
    hero_tagline: sentences(g.hero_tagline),
    about: sentences(g.about),
    services_intro: sentences(g.services_intro),
    seo_title: seoTitle && keep(seoTitle) ? seoTitle : "",
    seo_description: sentences(g.seo_description),
    why_choose_us: Array.isArray(g.why_choose_us) ? why : why.join("\n"),
    trust_badges: arr(g.trust_badges).map(clean).filter(b => b && b.length <= 32 && keep(b) && grounded(b)),
    services: arr(g.services)
      .map(sv => ({ ...sv, service_name: clean(sv?.service_name || sv?.name), service_description: sentences(sv?.service_description || sv?.description) }))
      .filter(sv => sv.service_name && keep(sv.service_name)),
    faqs: arr(g.faqs)
      .map(f => ({ q: clean(f?.q || f?.question), a: sentences(f?.a || f?.answer) }))
      .filter(f => f.q && f.a && !RATING.test(f.q) && keep(f.q)),
    // All three steps survive or none do (the page then uses its defaults).
    how_it_works: steps.length >= 3 && steps.slice(0, 3).every(st => st.title && keep(st.title) && (!st.text || keep(st.text)))
      ? steps.slice(0, 3) : [],
  };
  if (g.primary_cta && typeof g.primary_cta === "object") {
    const label = clean(g.primary_cta.label);
    out.primary_cta = { ...g.primary_cta, label: label && keep(label) ? label : "" };
  }
  return out;
}

// ══ Website v3: one prompt from the fact sheet ═══════════════════════════
// docs/website-v3-contract.md. buildPagePrompt(factSheet) replaces the three
// builders above (buildAdminPrompt, buildSelfServePrompt, buildFactsPrompt).
// Those stay, unchanged, until PR C moves every path onto this one: they
// write the old page shape, which the live pages still render.
//
// One gpt-4o call per page (temperature 0.2, strict JSON schema) writes the
// page and its service page; every claim cites evidence ids from the fact
// sheet. Then checkPageCopyV3:
//   1. an item citing an id the fact sheet doesn't have, or citing nothing,
//      is dropped; so is any sentence with a number, year, license, price,
//      guarantee (the CLAIMS above) its own cited evidence doesn't contain;
//   2. one gpt-4o-mini pass over the surviving sentences returns each one
//      kept, or rewritten without the puffery / banned word. Words are never
//      deleted in place. A rewrite that adds a fact, or still has the word,
//      loses to dropping the sentence;
//   3. everything removed goes to page_copy_v3.removed for Jack's review.
// The eyebrow and the rating / hours proof items are built here, in code.

export const V3_MODEL = "gpt-4o";
export const V3_CHECK_MODEL = "gpt-4o-mini";
export const V3_TEMPERATURE = 0.2;
// USD per 1M tokens (OpenAI list prices).
export const MODEL_PRICES = { "gpt-4o": { input: 2.5, output: 10 }, "gpt-4o-mini": { input: 0.15, output: 0.6 } };

const PUFFERY_WORDS = ["trusted", "reliable", "professional", "quality", "dedicated", "passionate", "excellence", "premier", "top-notch", "best", "#1", "leading"];
const V3_BANNED = [...new Set([...PUFFERY_WORDS, ...BANNED_WORDS])];
// Word forms count too: "ensuring", "dedication", "professionals".
const STEM = { ensure: "ensur(?:e|es|ed|ing)", dedicated: "dedicat(?:ed|ion)", professional: "professional(?:s|ly|ism)?", reliable: "reliab(?:le|ly|ility)", trusted: "trust(?:ed|worthy)", passionate: "passion(?:ate|ately)?", commitment: "commit(?:ment|ted)" };
const V3_BANNED_RE = new RegExp(`(^|[^a-z0-9#])(${V3_BANNED.map(w => STEM[w] || w.replace(/[-\s]/g, "[-\\s]")).join("|")})(?![a-z0-9])`, "i");
export const hasBannedWord = t => V3_BANNED_RE.test(String(t || ""));
// Star ratings belong to the code-built proof item, not the prose.
const RATING_V3 = /\d(?:\.\d)?\s*(?:★|stars?\b)|\brated\b|\bfive[- ]star\b/i;

const ev = { type: "array", items: { type: "string" } };
const arrOf = items => ({ type: "array", items });
const nullable = schema => ({ anyOf: [schema, { type: "null" }] });
const faqItem = obj({ q: str, a: str, evidence: ev });

/** What the model returns. Stored as page_copy_v3 after the check (see contract). */
export const PAGE_V3_SCHEMA = obj({
  hero_headline: str,
  hero_headline_evidence: ev,
  hero_sub: str,
  hero_sub_evidence: ev,
  proof: arrOf(obj({ value: str, label: str, evidence: ev })),
  services: arrOf(obj({ name: str, description: str, evidence: ev, stock_subject: str })),
  owner_section: nullable(obj({ heading: str, body: str, evidence: ev })),
  faqs: arrOf(faqItem),
  closing: obj({ heading: str, line: str }),
  service_page: nullable(obj({
    service_name: str, headline: str, intro: str,
    signs: strList, what_we_do: strList, review_ids: strList,
    faqs: arrOf(faqItem), evidence: ev,
  })),
});

const tc = t => { const x = String(t || "").trim(); return x ? x.charAt(0).toUpperCase() + x.slice(1) : ""; };
const GENERIC_TRADE = /^(services?|contractors?|local service|business|company|other)$/i;
const v3slug = t => String(t || "").toLowerCase().replace(/&/g, " and ").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60);

/** "Plumber" from the fact sheet: the trade, or Google's primary type when the trade is generic. */
export function tradeNoun(fs = {}) {
  const b = fs.business || {};
  const trade = String(b.trade || "").trim();
  const primary = String(b.primary_type || "").trim();
  return tc(!trade || GENERIC_TRADE.test(trade) ? (primary || trade || "Local service") : trade);
}

/** "Plumber in North Attleborough, MA". Built in code, never by the AI. */
export function buildEyebrow(fs = {}) {
  const b = fs.business || {};
  const place = [b.town, b.state].filter(Boolean).join(", ");
  return place ? `${tradeNoun(fs)} in ${place}` : tradeNoun(fs);
}

/** The proof items code builds: the Google rating (when strong) and hours. */
export function buildCodeProof(fs = {}) {
  const b = fs.business || {};
  const out = [];
  if (isStrongRating(b.rating, b.review_count)) {
    out.push({ value: `${Number(b.rating).toFixed(1)} ★`, label: `${b.review_count} Google reviews`, evidence: ["g"] });
  }
  const hours = Array.isArray(b.hours) ? b.hours.map(String) : [];
  if (hours.length === 7) {
    const open = hours.filter(h => !/closed/i.test(h));
    if (hours.every(h => /open 24 hours/i.test(h))) out.push({ value: "24/7", label: "Open around the clock", evidence: ["g"] });
    else if (open.length === 7) out.push({ value: "7 days", label: "Open every day", evidence: ["g"] });
    else if (open.some(h => /^saturday/i.test(h))) out.push({ value: "Saturdays", label: "Open on Saturdays", evidence: ["g"] });
  }
  return out;
}

function factsBlock(fs = {}) {
  const b = fs.business || {};
  const o = fs.owner || {};
  const lines = [];
  lines.push(`[g] GOOGLE LISTING
Name: ${b.name || NOT_PROVIDED}
Trade: ${b.trade || NOT_PROVIDED}${b.primary_type && b.primary_type !== b.trade ? ` (Google: ${b.primary_type})` : ""}
Google categories: ${(b.google_types || []).join(", ") || NOT_PROVIDED}
Town: ${[b.town, b.state].filter(Boolean).join(", ") || NOT_PROVIDED}
Hours: ${(b.hours || []).join("; ") || NOT_PROVIDED}`);
  if (fs.site_text) lines.push(`[s] THEIR OWN WEBSITE TEXT
"""
${String(fs.site_text).slice(0, 7000)}
"""`);
  const own = [];
  if (o.names?.length) own.push(`[o.names] Owner / who answers the phone: ${o.names.join(" and ")}`);
  if (o.years_in_business) own.push(`[o.years_in_business] Years in business: ${o.years_in_business}`);
  if (o.license_number) own.push(`[o.license_number] License number: ${o.license_number}${b.state ? ` (${b.state})` : ""}`);
  if (o.is_insured === true) own.push(`[o.is_insured] Insured: yes`);
  if (o.offers_free_estimates === true) own.push(`[o.offers_free_estimates] Free estimates: yes`);
  if (o.offers_emergency === true) own.push(`[o.offers_emergency] Emergency / after-hours calls: yes`);
  if (o.services?.length) own.push(`[o.services] Services the owner listed: ${o.services.join(", ")}`);
  if (o.notes) own.push(`[o.notes] The owner's notes: "${o.notes}"`);
  if (o.blurb) own.push(`[o.blurb] The owner, in their own words: "${o.blurb}"`);
  if (o.service_for_page) own.push(`[o.service_for_page] Service the owner wants its own page: ${o.service_for_page}`);
  const towns = [...new Set([fs.towns?.home, ...(fs.towns?.confirmed || [])].filter(Boolean))];
  if (towns.length) own.push(`[o.towns] Towns they serve: ${towns.join(", ")}`);
  if (fs.photos?.work?.length) own.push(`[o.photos] The owner uploaded ${fs.photos.work.length} job photo(s)`);
  lines.push(own.length ? `OWNER ANSWERS\n${own.join("\n")}` : `OWNER ANSWERS\nnone`);
  const reviews = (fs.reviews || []).map(r => `${r.id}: "${String(r.text).replace(/\s+/g, " ").trim()}" (${r.rating}★, ${r.author}${r.relative_time ? `, ${r.relative_time}` : ""})`);
  lines.push(reviews.length ? `GOOGLE REVIEWS\n${reviews.join("\n")}` : `GOOGLE REVIEWS\nnone`);
  return lines.join("\n\n");
}

/** The one page-copy prompt. Pure. */
export function buildPagePrompt(fs = {}) {
  const ids = Object.keys(evidenceMap(fs));
  const thin = !(fs.reviews || []).length && !fs.site_text && !(fs.owner?.services || []).length;
  const ownerFor = fs.owner?.service_for_page;
  return `You are writing the website for one real local business, from the FACTS below and nothing else.
Every item you write lists the evidence ids it relies on. The ids you may cite: ${ids.join(", ")}.
An item you can't back with at least one of those ids: leave it out. Shorter and true beats longer and invented.

FACTS
${factsBlock(fs)}

RULES
- Never invent: years, "since <year>", licenses, insurance, certifications, prices, guarantees, warranties, awards, team size, owner names, or towns. Only state one of these when the item cites the id that says it.
- Do not mention star ratings or review counts; the page shows the real rating itself.
- Use the reviewers' own wording for specifics ("came the next morning", "found the leak behind the wall"). Don't quote a whole review and don't name the reviewer.
- Write for a homeowner: plain words, short sentences, no ad language. Never use these words: ${V3_BANNED.join(", ")}.
- Name people only from [o.names].

FIELDS
hero_headline: at most 10 words, no business name. Name the problems people hire them for, or their specialty, as the reviews and owner answers describe them.${thin ? ` The facts are thin here, so use the trade and the town: "${tradeNoun(fs)} in ${fs.business?.town || "their town"}" (cite g).` : ` If the evidence is thin, fall back to the trade and the town (cite g).`}
hero_sub: one sentence on what they do and where, with one specific detail from the evidence.
proof: 0-2 short items, each said by at least 2 different reviews (cite them all). value: 1-3 words, the thing itself. label: a few words saying what the value is about, never repeating the value's words. e.g. {"value":"Next morning","label":"how fast they showed up"}. No ratings, no counts of stars.
services: 3-6. Name each by the homeowner's problem as reviews or the owner describe it ("Backed-up drains and sewer lines", not "Drain Services"). description: 1-2 sentences of specifics from the cited evidence. stock_subject: what a stock photo for it should show, 3-6 words, a close-up of the work or the problem (e.g. "copper pipe repair close-up"), no people's faces, no logos. If the facts only name the trade, write one service for the trade itself.
owner_section: ${(fs.owner?.names?.length || fs.owner?.blurb) ? `heading + 2-3 sentence body about the owner from [o.names] / [o.blurb] and what reviews say about working with them.` : `null (no owner answers).`}
faqs: 3-5 questions a homeowner asks before calling. Answer only from the cited evidence; skip a question you can't answer that way.
closing: a heading and one line asking them to call. No new facts, no promises.
service_page: ${ownerFor ? `the owner picked "${ownerFor}" (cite o.service_for_page); use that service name exactly.` : `the service with the most review evidence.`} null if no service has at least one review or owner answer behind it. headline (no business name), intro (2-3 sentences), signs (2-5 short signs a homeowner needs this, from the evidence), what_we_do (2-5 short lines on how they handle it, from the evidence), review_ids (the reviews about this service), faqs (2-4), evidence.`;
}

/** The chat/completions body for the v3 page call (exported for tests). */
export function pageRequestBody(fs, { model = V3_MODEL, temperature = V3_TEMPERATURE } = {}) {
  return {
    model, temperature,
    response_format: { type: "json_schema", json_schema: { name: "page_copy_v3", strict: true, schema: PAGE_V3_SCHEMA } },
    messages: [
      { role: "system", content: "You write website copy for small local businesses as JSON in the given schema. Every claim cites evidence ids from the facts you are given." },
      { role: "user", content: buildPagePrompt(fs) },
    ],
  };
}

/** One structured-output call. Returns { data, usage }. Throws like requestCopy. */
export async function requestJson(body, { fetchImpl = globalThis.fetch, apiKey = process.env.OPENAI_KEY } = {}) {
  const fail = (code, message) => Object.assign(new Error(message || code), { code });
  const r = await fetchImpl("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw fail("ai_request_failed", `OpenAI error: ${await r.text().catch(() => r.status)}`);
  const json = await r.json();
  const msg = json?.choices?.[0]?.message;
  if (msg?.refusal) throw fail("ai_refused", String(msg.refusal).slice(0, 300));
  if (!msg?.content) throw fail("ai_empty_response");
  return { data: JSON.parse(msg.content), usage: { model: body.model, input: json?.usage?.prompt_tokens || 0, output: json?.usage?.completion_tokens || 0 } };
}

export function costOf(usage = []) {
  return usage.reduce((sum, u) => {
    const p = MODEL_PRICES[u.model] || MODEL_PRICES[String(u.model).replace(/-\d{4}-\d\d-\d\d$/, "")];
    return p ? sum + (u.input * p.input + u.output * p.output) / 1e6 : sum;
  }, 0);
}

// ── The evidence check ───────────────────────────────────────────────────

const sentencesOf = t => String(t || "").split(/(?<=[.!?])\s+/).map(x => x.trim()).filter(Boolean);
const list3 = v => (Array.isArray(v) ? v : []);

/**
 * Walk every text in a v3 draft. fn(field, text, ids) returns the new text
 * ("" removes it). Items whose required text ends up empty are dropped.
 * ids is null for stock_subject (a photo brief, not a claim).
 */
function walkV3(c, fn, allIds) {
  const t = (field, text, ids) => fn(field, String(text || ""), ids);
  const out = { ...c };
  out.hero_headline = t("hero_headline", c.hero_headline, c.hero_headline_evidence);
  out.hero_sub = t("hero_sub", c.hero_sub, c.hero_sub_evidence);
  out.proof = list3(c.proof).map((p, i) => ({ ...p, value: t(`proof[${i}].value`, p.value, p.evidence), label: t(`proof[${i}].label`, p.label, p.evidence) }))
    .filter(p => p.value && p.label);
  out.services = list3(c.services).map((sv, i) => ({
    ...sv,
    name: t(`services[${i}].name`, sv.name, sv.evidence),
    description: t(`services[${i}].description`, sv.description, sv.evidence),
    stock_subject: t(`services[${i}].stock_subject`, sv.stock_subject, null),
  })).filter(sv => sv.name);
  out.owner_section = c.owner_section ? (() => {
    const o = { ...c.owner_section, heading: t("owner_section.heading", c.owner_section.heading, c.owner_section.evidence), body: t("owner_section.body", c.owner_section.body, c.owner_section.evidence) };
    return o.body ? o : null;
  })() : null;
  const faqs = (arr, prefix) => list3(arr).map((f, i) => ({ ...f, q: t(`${prefix}[${i}].q`, f.q, f.evidence), a: t(`${prefix}[${i}].a`, f.a, f.evidence) })).filter(f => f.q && f.a);
  out.faqs = faqs(c.faqs, "faqs");
  out.closing = c.closing ? { heading: t("closing.heading", c.closing.heading, allIds), line: t("closing.line", c.closing.line, allIds) } : c.closing;
  if (c.service_page) {
    const sp = c.service_page;
    const e = sp.evidence;
    const lines = (arr, f) => list3(arr).map((x, i) => t(`service_page.${f}[${i}]`, x, e)).filter(Boolean);
    out.service_page = {
      ...sp,
      headline: t("service_page.headline", sp.headline, e),
      intro: t("service_page.intro", sp.intro, e),
      signs: lines(sp.signs, "signs"),
      what_we_do: lines(sp.what_we_do, "what_we_do"),
      faqs: faqs(sp.faqs, "service_page.faqs"),
    };
  }
  return out;
}

/**
 * Step 1, pure: evidence ids, then numbers / claims / ratings / unconfirmed
 * towns against each item's own cited evidence. Returns { copy, removed }.
 */
export function filterByEvidence(draft, fs = {}) {
  const emap = evidenceMap(fs);
  const allIds = Object.keys(emap);
  const removed = [];
  const log = (field, text, reason) => { if (String(text || "").trim()) removed.push({ field, text: String(text).trim(), reason }); };
  const esc = x => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const unconfirmed = (fs.towns?.suggested || []).filter(Boolean).map(x => new RegExp(`\\b${esc(x)}\\b`, "i"));
  const c = draft && typeof draft === "object" ? { ...draft } : {};

  // Items citing ids we don't have, or nothing: dropped whole.
  const idsOk = ids => Array.isArray(ids) && ids.length > 0 && ids.every(id => id in emap);
  const why = ids => (!Array.isArray(ids) || !ids.length ? "no_evidence" : "unknown_evidence");
  if (!idsOk(c.hero_headline_evidence)) { log("hero_headline", c.hero_headline, why(c.hero_headline_evidence)); c.hero_headline = ""; }
  if (!idsOk(c.hero_sub_evidence)) { log("hero_sub", c.hero_sub, why(c.hero_sub_evidence)); c.hero_sub = ""; }
  const keepItems = (arr, field, text) => list3(arr).filter((it, i) => idsOk(it?.evidence) || (log(`${field}[${i}]`, text(it), why(it?.evidence)), false));
  c.proof = keepItems(c.proof, "proof", p => `${p?.value} ${p?.label}`);
  c.services = keepItems(c.services, "services", sv => `${sv?.name}: ${sv?.description}`);
  c.faqs = keepItems(c.faqs, "faqs", f => `${f?.q} ${f?.a}`);
  if (c.owner_section && !idsOk(c.owner_section.evidence)) { log("owner_section", c.owner_section.body, why(c.owner_section.evidence)); c.owner_section = null; }
  if (c.service_page) {
    const sp = c.service_page;
    if (!idsOk(sp.evidence)) { log("service_page", sp.service_name, why(sp.evidence)); c.service_page = null; }
    else c.service_page = { ...sp, faqs: keepItems(sp.faqs, "service_page.faqs", f => `${f?.q} ${f?.a}`), review_ids: list3(sp.review_ids).filter(id => /^r\d$/.test(id) && id in emap) };
  }

  // Sentence by sentence, against the item's own evidence.
  const checked = walkV3(c, (field, text, ids) => {
    if (!ids) return text;
    const source = list3(ids).map(id => emap[id] || "").join("\n");
    const { unsupportedNumber, unsupportedClaim } = factChecker(source);
    return sentencesOf(text).filter(sn => {
      const reason = unsupportedNumber(sn) ? "unsupported_number"
        : unsupportedClaim(sn) ? "unsupported_claim"
          : !field.startsWith("proof") && RATING_V3.test(sn) ? "rating_in_copy"
            : unconfirmed.some(re => re.test(sn)) ? "unconfirmed_town" : null;
      if (reason) log(field, sn, reason);
      return !reason;
    }).join(" ");
  }, allIds);
  return { copy: checked, removed };
}

/** The gpt-4o-mini request for step 2 (exported for tests). */
export function puffRequestBody(items, { model = V3_CHECK_MODEL } = {}) {
  return {
    model, temperature: 0,
    response_format: { type: "json_schema", json_schema: { name: "sentence_check", strict: true, schema: obj({ sentences: arrOf(obj({ id: str, keep: { type: "boolean" }, text: str })) }) } },
    messages: [
      { role: "system", content: "You edit website sentences for a small local business. You never add facts." },
      { role: "user", content: `For each sentence below: if it uses none of these words and reads like a person talking, return keep=true and the text unchanged.
Otherwise return keep=false and the sentence rewritten without the word: same facts, same meaning, plain words. Never just delete the word and leave a broken sentence; rewrite it so it reads naturally. Never add a number, place, name, price, guarantee or claim that isn't already in the sentence.
Words: ${V3_BANNED.join(", ")}

SENTENCES (JSON):
${JSON.stringify(items.map(it => ({ id: it.id, text: it.text })))}` },
    ],
  };
}

/**
 * Step 2: the mini pass, then the final word check. `rewrite(items)` returns
 * [{ id, keep, text }] (the gpt-4o-mini call; injectable for tests). A
 * rewrite is used only when it keeps to its evidence and loses the word;
 * otherwise a sentence that still has a banned word is dropped whole.
 */
export async function rewritePuffery(copy, fs = {}, { rewrite, removed = [] } = {}) {
  const emap = evidenceMap(fs);
  const allIds = Object.keys(emap);
  const items = [];
  walkV3(copy, (field, text, ids) => {
    sentencesOf(text).forEach((sn, j) => items.push({ id: `${items.length}`, field, j, text: sn, ids }));
    return text;
  }, allIds);
  let answers = [];
  if (rewrite && items.length) {
    try { answers = (await rewrite(items)) || []; } catch (e) { removed.push({ field: "_check", text: String(e?.message || e).slice(0, 200), reason: "rewrite_pass_failed" }); }
  }
  const byId = new Map(answers.map(a => [String(a?.id), a]));
  const decided = new Map(); // `${field}#${j}` → text ("" = drop)
  for (const it of items) {
    const a = byId.get(it.id);
    let text = it.text;
    // Only a sentence with a banned word is rewritten; the rest stay as written.
    if (a && a.keep === false && hasBannedWord(it.text) && String(a.text || "").trim() && a.text.trim() !== it.text) {
      const next = a.text.trim();
      const fc = it.ids ? factChecker(list3(it.ids).map(id => emap[id] || "").join("\n")) : null;
      const addsFact = fc && (fc.unsupportedNumber(next) || fc.unsupportedClaim(next));
      if (!addsFact && !hasBannedWord(next)) {
        removed.push({ field: it.field, text: it.text, reason: "puffery_rewritten", replacement: next });
        text = next;
      }
    }
    if (hasBannedWord(text)) { removed.push({ field: it.field, text: it.text, reason: "banned_word" }); text = ""; }
    decided.set(`${it.field}#${it.j}`, text);
  }
  const out = walkV3(copy, (field, text) => sentencesOf(text)
    .map((sn, j) => (decided.has(`${field}#${j}`) ? decided.get(`${field}#${j}`) : sn)).filter(Boolean).join(" "), allIds);
  return { copy: out, removed };
}

/** The gpt-4o-mini rewrite, bound to a fetch. Returns [{ id, keep, text }]. */
export function miniRewriter({ fetchImpl, apiKey, usage = [] } = {}) {
  return async items => {
    const { data, usage: u } = await requestJson(puffRequestBody(items), { fetchImpl, apiKey });
    usage.push(u);
    return data?.sentences || [];
  };
}

/**
 * Steps 1-3 plus the code-built parts: the stored page_copy_v3.
 * `draft` is the gpt-4o reply. Pure apart from `rewrite`.
 */
export async function checkPageCopyV3(draft, fs = {}, { rewrite = null, now = Date.now() } = {}) {
  const first = filterByEvidence(draft, fs);
  const { copy: c, removed } = await rewritePuffery(first.copy, fs, { rewrite, removed: first.removed });
  const b = fs.business || {};
  const town = b.town || "";
  const noun = tradeNoun(fs);

  let headline = c.hero_headline, headlineEv = c.hero_headline_evidence;
  if (!headline) { headline = town ? `${noun} in ${town}` : noun; headlineEv = ["g"]; }

  // Code builds rating/hours; the AI may add ones at least 2 reviews back,
  // whose label doesn't just repeat the value. 4 at most.
  const words = t => String(t).toLowerCase().match(/[a-z]{3,}/g) || [];
  const aiProof = list3(c.proof).filter(p => {
    const reviews = new Set(list3(p.evidence).filter(id => /^r\d$/.test(id)));
    const repeats = words(p.label).some(w => words(p.value).includes(w));
    if (reviews.size < 2 || repeats) removed.push({ field: "proof", text: `${p.value} | ${p.label}`, reason: reviews.size < 2 ? "fewer_than_2_reviews" : "label_repeats_value" });
    return reviews.size >= 2 && !repeats;
  });
  const proof = [...buildCodeProof(fs), ...aiProof].slice(0, 4);

  const hasOwner = (fs.owner?.names || []).length > 0 || !!fs.owner?.blurb;
  if (!hasOwner && c.owner_section) removed.push({ field: "owner_section", text: c.owner_section.body, reason: "no_owner_answers" });
  const owner_section = hasOwner && c.owner_section ? { heading: c.owner_section.heading, body: c.owner_section.body, evidence: c.owner_section.evidence } : null;

  // The service page needs a review, owner answer or owner photo behind it.
  let service_page = c.service_page || null;
  if (service_page) {
    const backed = list3(service_page.evidence).some(id => /^r\d$/.test(id) || id.startsWith("o."));
    const filled = service_page.headline && service_page.intro;
    if (!backed || !filled) {
      removed.push({ field: "service_page", text: service_page.service_name, reason: !backed ? "no_review_or_owner_evidence" : "empty_after_check" });
      service_page = null;
    } else {
      const name = fs.owner?.service_for_page || service_page.service_name;
      service_page = {
        service_name: name, slug: v3slug(name),
        headline: service_page.headline, intro: service_page.intro,
        signs: service_page.signs, what_we_do: service_page.what_we_do,
        review_ids: service_page.review_ids, faqs: service_page.faqs.map(f => ({ q: f.q, a: f.a, evidence: f.evidence })), evidence: service_page.evidence,
      };
    }
  }

  const closing = c.closing?.heading && c.closing?.line ? { heading: c.closing.heading, line: c.closing.line }
    : { heading: `Need ${/^[aeiou]/i.test(noun) ? "an" : "a"} ${noun.toLowerCase()}${town ? ` in ${town}` : ""}?`, line: b.phone ? `Call ${b.phone}.` : "Get in touch." };

  return {
    eyebrow: buildEyebrow(fs),
    hero_headline: headline, hero_headline_evidence: headlineEv,
    hero_sub: c.hero_sub || "", hero_sub_evidence: c.hero_sub ? c.hero_sub_evidence : [],
    proof,
    services: list3(c.services).map(sv => ({ name: sv.name, description: sv.description, evidence: sv.evidence, stock_subject: sv.stock_subject })),
    owner_section,
    faqs: list3(c.faqs).map(f => ({ q: f.q, a: f.a, evidence: f.evidence })),
    closing,
    service_page,
    removed,
    built_at: new Date(now).toISOString(),
    fact_sheet_built_at: fs.built_at || null,
  };
}

/**
 * The whole v3 generator: one gpt-4o call, then the check (one gpt-4o-mini
 * call). Returns { copy, usage, cost_usd }.
 */
export async function generatePageCopyV3(fs, { fetchImpl = globalThis.fetch, apiKey = process.env.OPENAI_KEY } = {}) {
  const usage = [];
  const { data, usage: u } = await requestJson(pageRequestBody(fs), { fetchImpl, apiKey });
  usage.push(u);
  const copy = await checkPageCopyV3(data, fs, { rewrite: miniRewriter({ fetchImpl, apiKey, usage }) });
  return { copy, usage, cost_usd: Number(costOf(usage).toFixed(5)) };
}
