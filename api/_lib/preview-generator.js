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
import { US_STATE_NAMES, US_STATE_ABBR } from "./service-utils.js";
import { buildFactsPrompt, applyFactRules, factChecker, normalizeSteps } from "./page-copy.js";
import { scrubCopy } from "./copy-lint.js";

export const PREVIEW_TRIAL_DAYS = 90;

// Full state name → postal code, for all 50 states + DC (prospecting is national).
const STATE_ABBR = Object.fromEntries(US_STATE_NAMES.map((n, i) => [n, US_STATE_ABBR[i].toUpperCase()]));
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
// A prospect with a website only gets a page when the site has at least this
// many verified problems (site-checks.js score): otherwise there's nothing
// honest to pitch.
export const SITE_WEAK_MIN_SCORE = 2;
// One proven problem is enough when it's one of these: each is a clear,
// checkable pitch on its own ("you have no quote form" / "browsers mark your
// site not secure"). Jack, Nov 11 2026: ~130 strong-rated prospects were
// failing the 2-problem bar on exactly one of these.
export const SITE_STANDALONE_SIGNALS = ["no_contact_form", "not_https"];
// Accepts a site-checks result ({ score, signals }) or, for older callers,
// a bare score.
export function isWeakEnoughSite(checks) {
  const score = typeof checks === "object" && checks !== null ? checks.score : checks;
  const signals = typeof checks === "object" && checks !== null ? (checks.signals || []) : [];
  if (Number(score) >= SITE_WEAK_MIN_SCORE) return true;
  return signals.some(s => SITE_STANDALONE_SIGNALS.includes(s));
}

export function qualifiesForPreview({ rating, reviewCount, hasWebsite, siteCheckScore, siteSignals, phone }) {
  if (!phone) return { ok: false, reason: "no_phone" };
  if (!isStrongRating(rating, reviewCount)) return { ok: false, reason: "weak_or_thin_rating" };
  if (hasWebsite && !isWeakEnoughSite({ score: siteCheckScore, signals: siteSignals })) return { ok: false, reason: "site_not_weak_enough" };
  return { ok: true };
}

// The free part of the quality gate (phone + strong rating), run before any
// paid check (ZeroBounce) so prospects that can't get a page don't cost a
// credit. Judges on the Outscraper listing (raw) first; when raw is missing
// or fails, the caller fetches Places details once and asks again with
// `place` (Places is fresher: in Nov 2026, 31 of 247 sent prospects had a raw
// rating that fails but a Places rating that passed). Pass place = {} when
// Places isn't available, to get a final verdict on raw alone.
export function cheapPreviewGate({ prospectPhone, raw, place } = {}) {
  const r = raw || {};
  const rating = place ? (place.rating ?? r.rating) : r.rating;
  const reviews = place ? (place.userRatingCount ?? r.reviews) : r.reviews;
  const phone = place?.nationalPhoneNumber || prospectPhone || r.phone || null;
  if (phone && isStrongRating(rating, reviews)) return { ok: true };
  if (!place) return { ok: false, needsPlaces: true };
  if (!phone) return { ok: false, reason: "no_phone" };
  return { ok: false, reason: "weak_or_thin_rating" };
}

// The prompt, the output schema and the facts-only rules are shared with
// every other page-copy path: api/_lib/page-copy.js.
export { buildFactsPrompt };

/**
 * Facts-only check for preview copy: the shared rules (applyFactRules), the
 * banned-word scrub (copy-lint.js), then the preview's own limits.
 * @param {object} gen    parsed LLM JSON
 * @param {object} source { siteText, phone, address, hours, city, trade }
 */
export function validateGenerated(gen, source) {
  const arr = v => (Array.isArray(v) ? v : []);
  const raw = gen && typeof gen === "object" ? gen : {};
  const sourceText = [source.siteText || "", source.phone || "", source.address || "", (source.hours || []).join(" ")].join("\n");
  const why = Array.isArray(raw.why_choose_us) ? raw.why_choose_us : String(raw.why_choose_us || "").split("\n").filter(Boolean);
  const checked = scrubCopy(applyFactRules({ ...raw, why_choose_us: why }, sourceText), { offers_free_estimates: false, years_in_business: null });

  const services = arr(checked.services).map(s => ({ service_name: s.service_name, service_description: s.service_description })).slice(0, 6);
  if (!services.length) {
    const trade = String(source.trade || "Local service").replace(/\b\w/g, m => m.toUpperCase());
    services.push({ service_name: trade, service_description: "" });
  }
  const towns = arr(raw.service_area).map(t => String(t).replace(/,\s*[A-Z]{2}$/, "").trim()).filter(Boolean);
  const siteLc = String(source.siteText || "").toLowerCase();
  // Towns must literally appear in the source text (or be the home town).
  const service_area = [...new Set([source.city, ...towns.filter(t => siteLc.includes(t.toLowerCase()))].filter(Boolean))].slice(0, 20);

  return {
    hero_headline: checked.hero_headline,
    hero_tagline: checked.hero_tagline,
    about: checked.about,
    services_intro: checked.services_intro,
    services,
    service_area,
    why_choose_us: arr(checked.why_choose_us).filter(w => factChecker(source.siteText).grounded(w)).slice(0, 5),
    trust_badges: arr(checked.trust_badges).filter(b => factChecker(source.siteText).grounded(b)).slice(0, 4),
    faqs: arr(checked.faqs).slice(0, 4),
    how_it_works: normalizeSteps(checked.how_it_works),
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
    ...(copy.how_it_works?.length ? { how_it_works: copy.how_it_works } : {}),
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

// ── Instant previews from the website ("find your business") ──────────────
// A visitor picks their Google listing and gets a page in ~20s. Unlike
// outbound previews there's no quality gate (they asked for it) except a
// phone number, which every page's call button needs. Unclaimed instant
// previews stay live for a week; claiming starts the normal free month.

export const INBOUND_PREVIEW_DAYS = 7;
export const INBOUND_LIMITS = { perIpPerDay: 3, globalPerDay: 60 };
export const INBOUND_SOURCE = "inbound_lookup";

// Google place ids are URL-safe base64-ish strings; reject anything else
// before it goes into a Places URL or a query.
export function isValidPlaceId(id) {
  return typeof id === "string" && /^[A-Za-z0-9_-]{10,300}$/.test(id);
}

/** Which limit (if any) a new instant preview would exceed. */
export function inboundLimitReason({ perIp, global }, limits = INBOUND_LIMITS) {
  if (global >= limits.globalPerDay) return "busy";
  if (perIp >= limits.perIpPerDay) return "too_many";
  return null;
}

/**
 * Map a Places API (v1) place-details response to the prospect fields the
 * preview generator reads. City/state come from addressComponents.
 */
export function placeToProspect(place, placeId) {
  const comps = place?.addressComponents || [];
  const find = type => comps.find(c => (c.types || []).includes(type));
  const city = (find("locality") || find("postal_town") || find("sublocality") || find("administrative_area_level_3"))?.longText || null;
  const state = find("administrative_area_level_1")?.shortText || null;
  return {
    business_name: place?.displayName?.text || null,
    phone: place?.nationalPhoneNumber || null,
    address: place?.formattedAddress || null,
    city, state,
    website: place?.websiteUri || null,
    google_place_id: placeId,
    trade: place?.primaryTypeDisplayName?.text || null,
  };
}

// Session tokens are client-generated UUIDs (Google accepts any URL-safe
// base64 string up to 36 chars).
export function isValidSessionToken(t) {
  return typeof t === "string" && /^[A-Za-z0-9_-]{8,36}$/.test(t);
}

/** Places API (New) autocomplete response → [{ placeId, name, detail }]. */
export function placeSuggestions(data, max = 5) {
  return (data?.suggestions || [])
    .map(s => s.placePrediction)
    .filter(p => p && isValidPlaceId(p.placeId))
    .slice(0, max)
    .map(p => ({
      placeId: p.placeId,
      name: p.structuredFormat?.mainText?.text || p.text?.text || "",
      detail: p.structuredFormat?.secondaryText?.text || "",
    }))
    .filter(s => s.name);
}
