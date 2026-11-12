// api/_lib/generator-prompt.js
// The AI copy prompts for api/generate-business.js, and what happens to the
// AI's JSON afterwards. Two entry points write pages: the admin JSON path
// (Jack's bulk previews) and the self-serve form. Both now share:
//   - the same honesty rules: no "several years" when years aren't given, no
//     hard-coded state, no "free estimate" unless the business offers one
//     (offersFreeEstimates in page-claims.js, false until there's a field)
//   - the same JSON schema: faqs as {q, a}, why_choose_us as one string with
//     a line per reason (what page-ssr.js splitWhy and profile.js read)
//   - the same copy check: lintCopy, one AI retry with the problems listed
//     (kept only if it's better), then scrubCopy (finishGenerated below).
// Pure functions apart from the retry callback the caller passes in.

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
  "primary_cta": { "label": "", "type": "call|email|form|link", "value": "" }
}`;

/** The admin JSON path (bulk previews): businessName, ownerFirstName, trade, phone, town, state, areasServed, yearsInBusiness, services. */
export function buildAdminPrompt(input = {}) {
  const years = yearsInBusinessFrom(input.yearsInBusiness);
  const free = offersFreeEstimates(input);
  const services = (Array.isArray(input.services) ? input.services : []).map(given).filter(Boolean);
  const areas = (Array.isArray(input.areasServed) ? input.areasServed : []).map(given).filter(Boolean);
  const town = given(input.town), state = given(input.state), phone = given(input.phone);
  return `You are a copywriter for local businesses. Write copy that sounds like it was written by someone who actually knows this business — not a generic template.
Return ONLY valid JSON (no markdown, no commentary).

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
Return ONLY valid JSON (no markdown, no commentary).

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
    primary_cta: g.primary_cta && typeof g.primary_cta === "object" ? { ...g.primary_cta } : {},
  };
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
 * Normalize → lint → one retry if there are problems (kept only if it parses
 * and has fewer) → scrub → honest CTA label. Same steps for both paths.
 * `retry(extraPrompt)` returns the AI's parsed JSON or null; it may throw.
 * Returns { generated, issues } (issues = what's left after the scrub).
 */
export async function finishGenerated(raw, { flags = {}, profile = {}, retry = null, log = () => {} } = {}) {
  let generated = normalizeGenerated(raw);
  const firstIssues = lintCopy(generated, flags);
  if (firstIssues.length && retry) {
    try {
      const again = await retry(fixInstructions(firstIssues));
      if (again && typeof again === "object" && Array.isArray(again.services)) {
        const retried = normalizeGenerated(again);
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
