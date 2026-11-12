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
import { lintCopy, scrubCopy, fixInstructions } from "./copy-lint.js";

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
    const c = String(t || "").replace(PUFFERY, "").replace(/\s{2,}/g, " ").replace(/\s+([,.])/g, "$1").trim();
    return c.charAt(0).toUpperCase() + c.slice(1);
  };
  const unsupportedNumber = t => numbersIn(t).some(n => n.length >= 2 && !srcNums.has(n));
  const unsupportedClaim = t => CLAIMS.some(([claim, need]) => claim.test(t) && !need.test(srcLc));
  const keep = t => !!t && !RATING.test(t) && !unsupportedNumber(t) && !unsupportedClaim(t);
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
