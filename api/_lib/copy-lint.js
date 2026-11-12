// api/_lib/copy-lint.js
// Checks AI-written page copy before it ships. The generation prompts already
// ban filler words and ask for honesty, but nothing enforced it: Conway's
// page went live with "Reliable Lawn Care", "Reliable Scheduling", generic
// service lines and an emergency badge its own FAQ denied. lintCopy() finds
// those problems; scrubCopy() removes what can be fixed without the AI.

import { faqDeniesEmergency } from "./page-claims.js";

export const BANNED_WORDS = [
  "trusted", "reliable", "professional", "quality", "dedicated", "passionate",
  "commitment", "excellence", "proud", "strive", "ensure", "seamless",
  "world-class", "top-notch", "best-in-class", "second to none", "your go-to",
];
const BANNED_RE = new RegExp(`\\b(${BANNED_WORDS.map(w => w.replace(/[-\s]/g, "[-\\s]")).join("|")})\\b`, "gi");

// Service lines that say nothing a competitor couldn't say.
const FILLER_RE = /\b(our [a-z\s]+ services (ensure|keep|provide|will)|we have you covered|perfectly (shaped|done|finished)|stay safe|peace of mind|look(ing)? (its|their|your) best|take care of all your)\b/i;
// Signals a concrete detail: a number, a frequency, a season, a material or scope word.
const SPECIFIC_RE = /\d|weekly|bi-?weekly|monthly|seasonal|spring|fall|autumn|winter|summer|same[- ]day|per |hour|day|inch|foot|feet|yard|driveway|walkway|sidewalk|bed|beds|edging|blow|haul|bark|stone|leaf|leaves|debris|plow|salt|sand|shovel|install|repair|replace|clean ?out|includes?|including/i;

export function bannedWordsIn(text) {
  const hits = String(text || "").match(BANNED_RE) || [];
  return [...new Set(hits.map(h => h.toLowerCase()))];
}

function serviceList(g) {
  return (Array.isArray(g?.services) ? g.services : []).map(s => ({
    name: String(s?.service_name || s?.name || ""),
    desc: String(s?.service_description || s?.description || ""),
  }));
}

// Claims the AI tends to invent. Only checked when the caller says the fact
// is unknown or false (flags.offers_free_estimates === false, or
// flags.years_in_business given as null/0), so other callers are unaffected.
const FREE_ESTIMATE_RE = /\bfree[\s,-]+(?:no[\s-]obligation\s+|in[\s-]home\s+|on[\s-]site\s+)?(estimates?|quotes?|consultations?|assessments?|inspections?)\b|\b(estimates?|quotes?) (are|is) (always )?free\b|\bno[- ]cost (estimates?|quotes?)\b/i;
const YEARS_RE = /\b\d+\+?\s*(?:years?|yrs?)\b|\bsince (?:19|20)\d\d\b|\b(?:several|many|over|decades?|a decade)\s+(?:of\s+)?(?:years?|experience)\b|\bdecades?\b|\byears of (?:experience|service)\b/i;

function unsupportedIn(text, flags) {
  const t = String(text || "");
  const out = [];
  if (flags.offers_free_estimates === false && FREE_ESTIMATE_RE.test(t)) out.push("free estimates");
  if ("years_in_business" in flags && !flags.years_in_business && YEARS_RE.test(t)) out.push("years in business");
  return out;
}

// Every generated text field, as [field, text] pairs.
function allFields(g) {
  const out = [];
  for (const f of ["hero_headline", "hero_tagline", "about", "why_choose_us", "services_intro", "seo_title", "seo_description"]) {
    if (g?.[f]) out.push([f, String(g[f])]);
  }
  (Array.isArray(g?.trust_badges) ? g.trust_badges : []).forEach((b, i) => out.push([`trust_badges[${i}]`, String(b || "")]));
  serviceList(g).forEach((s, i) => out.push([`services[${i}]`, `${s.name} ${s.desc}`]));
  faqsOf(g).forEach((f, i) => out.push([`faqs[${i}]`, `${f.q} ${f.a}`]));
  if (g?.primary_cta?.label) out.push(["primary_cta", String(g.primary_cta.label)]);
  return out;
}

function faqsOf(g) {
  return (Array.isArray(g?.faqs) ? g.faqs : []).map(f => ({ q: f?.q || f?.question || "", a: f?.a || f?.answer || "" }));
}

// Returns [{ field, kind, message }]. kind: banned_word | contradiction | vague_service | unsupported_claim.
// flags: offers_emergency, offers_free_estimates, years_in_business (see unsupportedIn).
export function lintCopy(g, flags = {}) {
  const issues = [];
  const textFields = ["hero_headline", "hero_tagline", "about", "why_choose_us", "services_intro", "seo_title", "seo_description"];
  for (const f of textFields) {
    const hits = bannedWordsIn(g?.[f]);
    if (hits.length) issues.push({ field: f, kind: "banned_word", message: `${f} uses banned word(s): ${hits.join(", ")}` });
  }
  (Array.isArray(g?.trust_badges) ? g.trust_badges : []).forEach((b, i) => {
    const hits = bannedWordsIn(b);
    if (hits.length) issues.push({ field: `trust_badges[${i}]`, kind: "banned_word", message: `badge "${b}" uses: ${hits.join(", ")}` });
  });

  serviceList(g).forEach((s, i) => {
    const words = s.desc.split(/\s+/).filter(Boolean).length;
    const hits = bannedWordsIn(s.desc);
    if (hits.length) issues.push({ field: `services[${i}]`, kind: "banned_word", message: `service "${s.name}" uses: ${hits.join(", ")}` });
    if (!s.desc || words < 6 || FILLER_RE.test(s.desc) || !SPECIFIC_RE.test(s.desc)) {
      issues.push({ field: `services[${i}]`, kind: "vague_service", message: `service "${s.name}" needs one concrete detail (frequency, season, what's included, or area)` });
    }
  });

  const faqs = faqsOf(g);
  faqs.forEach((f, i) => {
    const hits = bannedWordsIn(`${f.q} ${f.a}`);
    if (hits.length) issues.push({ field: `faqs[${i}]`, kind: "banned_word", message: `FAQ "${f.q}" uses: ${hits.join(", ")}` });
  });
  for (const [field, text] of allFields(g)) {
    for (const what of unsupportedIn(text, flags)) {
      issues.push({ field, kind: "unsupported_claim", message: `${field} mentions ${what}, which the business didn't give us; remove it` });
    }
  }
  if (flags.offers_emergency === true && faqDeniesEmergency(faqs)) {
    issues.push({ field: "faqs", kind: "contradiction", message: "FAQ denies emergency service but the business offers it" });
  }
  if (flags.offers_emergency === false && faqs.some(f => /\b(24\/7|emergency service|after-hours service) (is )?available\b|\bwe offer (24\/7|emergency)/i.test(`${f.q} ${f.a}`))) {
    issues.push({ field: "faqs", kind: "contradiction", message: "FAQ offers emergency service but the business doesn't" });
  }
  const all = [g?.about, g?.why_choose_us, g?.services_intro, ...(g?.trust_badges || []), ...faqs.map(f => f.a)].join(" ").toLowerCase();
  if (/residential (specialist|only)|residential homes only|only residential/.test(all) && /\bcommercial (properties|customers|clients|accounts|work)\b/.test(all) && !/\bno commercial\b|\bnot commercial\b/.test(all)) {
    issues.push({ field: "about", kind: "contradiction", message: "copy says residential-only in one place and commercial work in another" });
  }
  return issues;
}

function stripBanned(text) {
  return String(text || "")
    .replace(BANNED_RE, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/^\s*[,–—-]\s*/, "")
    .trim()
    .replace(/^([a-z])/, c => c.toUpperCase());
}

// Deterministic last pass: drop badges with filler words and strip them from
// short display fields. Longer prose is left to the AI retry.
// Unsupported claims (see unsupportedIn) are removed sentence by sentence
// everywhere, since a made-up fact is worse than a shorter page.
export function scrubCopy(g, flags = {}) {
  if (!g || typeof g !== "object") return g;
  const out = { ...g };
  const bad = t => unsupportedIn(t, flags).length > 0;
  const dropSentences = text => String(text || "").split(/\n/).map(line =>
    line.split(/(?<=[.!?])\s+/).filter(sn => !bad(sn)).join(" ")
  ).filter((line, i, arr) => line.trim() || (i > 0 && arr[i - 1].trim())).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (Array.isArray(out.trust_badges)) out.trust_badges = out.trust_badges.filter(b => !bannedWordsIn(b).length && !bad(b));
  for (const f of ["hero_headline", "hero_tagline", "about", "why_choose_us", "services_intro", "seo_title", "seo_description"]) {
    if (typeof out[f] === "string" && bad(out[f])) out[f] = dropSentences(out[f]);
  }
  if (Array.isArray(out.services)) {
    out.services = out.services.map(sv => (bad(sv?.service_description) ? { ...sv, service_description: dropSentences(sv.service_description) } : sv));
  }
  if (Array.isArray(out.faqs)) {
    out.faqs = out.faqs.map(f => {
      const q = f?.q ?? f?.question ?? "", a = f?.a ?? f?.answer ?? "";
      if (bad(q)) return null;
      return bad(a) ? { ...f, ...("a" in (f || {}) ? { a: dropSentences(a) } : { answer: dropSentences(a) }) } : f;
    }).filter(f => f && String(f.a ?? f.answer ?? "").trim());
  }
  for (const f of ["hero_headline", "seo_title"]) {
    if (bannedWordsIn(out[f]).length) out[f] = stripBanned(out[f]);
  }
  return out;
}

// Short instruction block appended to a retry prompt.
export function fixInstructions(issues) {
  if (!issues.length) return "";
  return `\n\nYOUR PREVIOUS DRAFT HAD THESE PROBLEMS. Return the full JSON again with them fixed and everything else unchanged:\n${issues.map(i => `- ${i.message}`).join("\n")}`;
}
