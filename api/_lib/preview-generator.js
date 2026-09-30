// api/_lib/preview-generator.js
// Facts-only preview pages for outbound prospects.
//
// The rule: every claim on a preview page must be traceable to the business's
// own website or Google Business Profile. Nothing invented — no "since 1985"
// unless their site says so, no "free estimates" unless their site says so.
// The LLM only rewrites and organizes facts; validateGenerated() then strips
// anything that slipped through (numbers not in the source, banned puffery,
// rating claims — the page shows the real rating itself).
//
// Pure functions here; network/DB lives in ga-metrics.js (generatePreviewForProspect).

import { isStrongRating, pickReviewQuotes, personaFor } from "./page-style.js";

export const PREVIEW_TRIAL_DAYS = 90;

const STATE_ABBR = { massachusetts: "MA", "rhode island": "RI", connecticut: "CT", "new hampshire": "NH", vermont: "VT", maine: "ME", "new york": "NY" };
export const stateAbbr = s => STATE_ABBR[String(s || "").toLowerCase().trim()] || String(s || "").trim();

export function slugify(text) {
  return String(text || "").toLowerCase()
    .replace(/[,.]?\s+(inc|llc|l\.l\.c|co|corp|corporation|company|ltd)\.?$/i, "")
    .replace(/&/g, " and ").replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60);
}

/**
 * Who gets a preview page. Strong Google reputation is required — a page
 * that has to hide a 3.8★ rating or an empty review section isn't a pitch.
 * For prospects with a website, the site must objectively fail 2+ checks.
 */
export function qualifiesForPreview({ rating, reviewCount, hasWebsite, siteCheckScore, phone }) {
  if (!phone) return { ok: false, reason: "no_phone" };
  if (!isStrongRating(rating, reviewCount)) return { ok: false, reason: "weak_or_thin_rating" };
  if (hasWebsite && !(siteCheckScore >= 2)) return { ok: false, reason: "site_not_weak_enough" };
  return { ok: true };
}

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

Return ONLY JSON:
{
  "hero_headline": "6-9 words: what they do + where. No business name.",
  "hero_tagline": "one sentence from SOURCE facts",
  "about": "1-2 short paragraphs separated by \\n\\n, only SOURCE facts",
  "services_intro": "one sentence",
  "services": [{"service_name": "", "service_description": ""}],   // 3-6, grouped from services SOURCE lists; if none listed, one entry for the trade itself
  "service_area": ["Town"],                                        // only towns SOURCE lists; else just the business's town
  "why_choose_us": ["short concrete fact from SOURCE"],             // 0-5
  "trust_badges": ["2-4 word fact from SOURCE"],                    // 0-4
  "faqs": [{"q": "", "a": ""}]                                      // 2-4, answers only from SOURCE (area served, how to get a quote, services)
}`;
}

const BANNED = /\b(trusted|reliable|professional|quality|dedicated|passionate|excellence|premier|top-notch|best|#1|leading)\b/gi;
const RATING = /(\d(\.\d)?\s*★|\bstars?\b|\breviews?\b|\brated\b)/i;

// Numbers in generated copy must appear in the source (phone digits, years,
// license #s). Anything else is a hallucinated fact — drop that sentence/item.
function numbersIn(s) { return (String(s).match(/\d[\d,]*/g) || []).map(n => n.replace(/,/g, "")); }
function unsupportedNumber(text, sourceNumbers) {
  return numbersIn(text).some(n => n.length >= 2 && !sourceNumbers.has(n));
}
function cleanSentence(s) {
  const t = String(s || "").replace(BANNED, "").replace(/\s{2,}/g, " ").replace(/\s+([,.])/g, "$1").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}
// Short claims (badges, why-us bullets) must share a distinctive word with the
// source text — catches invented-but-numberless claims like "Free estimates"
// on a site that never offers them.
const STOP = new Set("about after also always and any are best call can come customers every from have home homes into just local more most need needs only other our over same service services that their them they this through throughout time today very what when where which will with work your".split(" "));
function grounded(text, siteLc) {
  if (!siteLc) return false;
  const words = String(text).toLowerCase().match(/[a-z]{5,}/g) || [];
  return words.some(w => !STOP.has(w) && siteLc.includes(w.slice(0, Math.max(5, w.length - 2))));
}
function keep(text, srcNums) { return text && !RATING.test(text) && !unsupportedNumber(text, srcNums); }
function filterSentences(text, srcNums) {
  return String(text || "").split(/\n\n+/).map(par =>
    par.split(/(?<=[.!?])\s+/).map(cleanSentence).filter(s => keep(s, srcNums)).join(" ")
  ).filter(Boolean).join("\n\n");
}

/**
 * @param {object} gen    parsed LLM JSON
 * @param {object} source { siteText, phone, address, city, trade }
 */
export function validateGenerated(gen, source) {
  const srcNums = new Set(numbersIn(`${source.siteText || ""} ${source.phone || ""} ${source.address || ""} ${(source.hours || []).join(" ")}`));
  const arr = v => (Array.isArray(v) ? v : []);
  const str = v => (typeof v === "string" ? v : "");

  const services = arr(gen.services)
    .map(s => ({ service_name: cleanSentence(s?.service_name), service_description: filterSentences(s?.service_description, srcNums) }))
    .filter(s => s.service_name && keep(s.service_name, srcNums))
    .slice(0, 6);
  if (!services.length) {
    const trade = String(source.trade || "Local service").replace(/\b\w/g, m => m.toUpperCase());
    services.push({ service_name: trade, service_description: "" });
  }

  const towns = arr(gen.service_area).map(t => String(t).replace(/,\s*[A-Z]{2}$/, "").trim()).filter(Boolean);
  const siteLc = String(source.siteText || "").toLowerCase();
  // Towns must literally appear in the source text (or be the home town).
  const service_area = [...new Set([source.city, ...towns.filter(t => siteLc.includes(t.toLowerCase()))].filter(Boolean))].slice(0, 20);

  const faqs = arr(gen.faqs)
    .map(f => ({ q: cleanSentence(f?.q), a: filterSentences(f?.a, srcNums) }))
    .filter(f => f.q && f.a && !RATING.test(f.q))
    .slice(0, 4);

  const headline = cleanSentence(str(gen.hero_headline));
  return {
    hero_headline: keep(headline, srcNums) ? headline : "",
    hero_tagline: filterSentences(gen.hero_tagline, srcNums),
    about: filterSentences(gen.about, srcNums),
    services_intro: filterSentences(gen.services_intro, srcNums),
    services,
    service_area,
    why_choose_us: arr(gen.why_choose_us).map(cleanSentence).filter(w => keep(w, srcNums) && grounded(w, siteLc)).slice(0, 5),
    trust_badges: arr(gen.trust_badges).map(cleanSentence).filter(b => b && b.length <= 32 && keep(b, srcNums) && grounded(b, siteLc)).slice(0, 4),
    faqs,
  };
}

/** Assemble the small_business_profiles row (minus business_id). */
export function assembleProfile({ slug, name, trade, city, state, phone, address, placeId, rating, reviewCount, googleReviews, copy }) {
  const st = stateAbbr(state);
  const place = [city, st].filter(Boolean).join(", ");
  const personaTrade = { landscaping: "Landscaping", plumbing: "Plumbing", hvac: "Heating & cooling", electrical: "Electrical", cleaning: "Cleaning", painting: "Painting", contractor: "Contracting" }[personaFor(trade)] || String(trade || "Local service");
  const headline = copy.hero_headline || `${personaTrade} in ${city || "your area"}`;
  return {
    username: slug,
    business_name: name,
    seo_business_name: String(name).replace(/[,.]?\s+(inc|llc|co|corp)\.?$/i, "").trim(),
    is_public: true,
    is_claimed: false,
    primary_category: String(trade || "").toLowerCase(),
    phone, city, state: st, address: address || null,
    hero_headline: headline,
    hero_tagline: copy.hero_tagline || `${personaTrade} in ${place} — call ${phone} for a quote.`,
    about: copy.about || "",
    services_intro: copy.services_intro || "",
    services: copy.services,
    service_area: copy.service_area.length ? copy.service_area : [city].filter(Boolean),
    why_choose_us: copy.why_choose_us,
    trust_badges: copy.trust_badges,
    faqs: copy.faqs,
    testimonials: pickReviewQuotes(googleReviews || [], 3),
    google_place_id: placeId || null,
    average_rating: rating ?? null,
    review_count: reviewCount ?? null,
    accepting_clients: true,
    offers_emergency: false,
    is_open_now: false,
    primary_cta_type: "call",
    primary_cta_label: `Call ${phone}`,
    primary_cta_value: phone,
    seo_title: `${name.replace(/[,.]?\s+(inc|llc)\.?$/i, "")} — ${personaTrade} in ${place}`,
    seo_description: `${name} — ${personaTrade.toLowerCase()} in ${place}. Call ${phone}.`,
    attachments: [],
    before_after_images: [],
  };
}
