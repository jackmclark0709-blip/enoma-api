// api/_lib/fact-sheet.js
// The fact sheet: everything we actually know about a business, in one
// place, so the page-copy prompt (buildPagePrompt in page-copy.js) can cite
// it and the evidence check can hold every claim to it. Contract:
// docs/website-v3-contract.md. Stored as small_business_profiles.fact_sheet.
//
//   { version: 1, built_at,
//     business: { name, trade, primary_type, google_types[], phone, address, town, state, hours[], rating, review_count, place_id },
//     reviews: [ { id: "r1".."r5", author: "Russ B.", rating, text, relative_time } ],
//     site_text: "",
//     owner: { names[], years_in_business, license_number, is_insured, offers_free_estimates, offers_emergency, blurb, service_for_page,
//              services[], notes },   // services/notes: additive, the self-serve form's own answers
//     towns: { home, confirmed[], suggested[] },
//     photos: { owner[], work[], google_work_count } }
//
// Built only from data each path already has: no new Places calls. Google
// photo URLs and bytes are never stored (Places terms), only how many there
// are. Owner photos are the owner's own uploads: the "Meet the owner" photo
// and attachments tagged as job photos (photo-kinds.js).
//
// The top half is pure and unit-tested (tests/fact-sheet.test.js). The
// bottom half (rebuildFactSheet) reads and writes one row.

import { cleanBusinessName } from "./business-name.js";
import { workPhotos, kindOf } from "./photo-kinds.js";
import { stateCode, ownerNamesFrom, townsFor } from "./brand-kit.js";

export const FACT_SHEET_VERSION = 1;
export const MAX_REVIEWS = 5;
export const MIN_REVIEW_RATING = 4;
export const MAX_SITE_TEXT = 7000;

const s = v => {
  const t = String(v ?? "").trim();
  return t && !/^(undefined|null)$/i.test(t) ? t : "";
};
const list = v => {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") { try { const j = JSON.parse(v); return Array.isArray(j) ? j : []; } catch { return []; } }
  return [];
};
const uniq = arr => [...new Set(arr)];
const num = v => (v === null || v === undefined || v === "" ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const bool = v => (v === true ? true : v === false ? false : null);
const GENERIC_TYPE = /^(services?|general contractors?|contractors?|establishment|point of interest|business)$/i;

// Enoma's own category buckets are broad: HVAC companies and landscapers were
// filed as "general contractor", so pages said "General contractor in
// Lafayette, LA" above an HVAC headline and borrowed contractor FAQs (Nov 24).
// When the trade is one of these and Google's primary type is specific, the
// Google type is the trade.
export const BROAD_TRADE = /^(services?|general contractors?|contractors?|local service|home services?|business|company|other)$/i;
export function specificTrade(b = {}) {
  const trade = String(b.trade || "").trim();
  const primary = String(b.primary_type || "").trim();
  if (primary && !GENERIC_TYPE.test(primary) && !BROAD_TRADE.test(primary) && (!trade || BROAD_TRADE.test(trade))) return primary;
  return trade || primary;
}

/** "Russell Brown" → "Russell B."; "Russ" → "Russ"; "" → "Google reviewer". */
export function reviewAuthor(name) {
  const parts = s(name).replace(/[^\p{L}\p{M}' .-]/gu, " ").split(/\s+/).filter(Boolean);
  if (!parts.length) return "Google reviewer";
  const cap = w => w.charAt(0).toUpperCase() + w.slice(1);
  const firstName = cap(parts[0]);
  const last = parts.length > 1 ? parts[parts.length - 1].replace(/[^\p{L}]/gu, "") : "";
  return last ? `${firstName} ${last.charAt(0).toUpperCase()}.` : firstName;
}

/**
 * Up to 5 reviews rated 4★ or higher, full text, in the order given (Places
 * returns them most relevant first), with ids r1..r5. Accepts Places (New)
 * review objects ({ rating, text: { text }, originalText, authorAttribution,
 * relativePublishTimeDescription }) or stored testimonials ({ quote, author,
 * rating, source: "google" }).
 */
export function reviewsFrom(raw, max = MAX_REVIEWS) {
  return list(raw)
    .map(r => ({
      author: reviewAuthor(r?.authorAttribution?.displayName ?? r?.author_name ?? r?.author),
      rating: num(r?.rating),
      text: s(r?.text?.text ?? r?.originalText?.text ?? (typeof r?.text === "string" ? r.text : "") ?? "") || s(r?.quote),
      relative_time: s(r?.relativePublishTimeDescription ?? r?.relative_time) || null,
    }))
    .filter(r => r.text && r.rating !== null && r.rating >= MIN_REVIEW_RATING)
    .slice(0, max)
    .map((r, i) => ({ id: `r${i + 1}`, ...r }));
}

/** Only stored testimonials that came from Google (owner-typed quotes aren't reviews). */
export function googleTestimonials(testimonials) {
  return list(testimonials).filter(t => t && t.source === "google");
}

/** The towns block: the brand kit's towns when there is one, else the profile's own. */
export function townsBlock(profile = {}, kit = null) {
  const home = s(profile.city) || null;
  const kt = kit?.towns;
  if (kt && (Array.isArray(kt.confirmed) || Array.isArray(kt.suggested))) {
    return {
      home,
      confirmed: uniq(list(kt.confirmed).map(s).filter(Boolean)),
      suggested: uniq(list(kt.suggested).map(s).filter(Boolean)),
    };
  }
  const t = townsFor(profile, []);
  return { home, confirmed: t.confirmed, suggested: [] };
}

/** Owner uploads only. Google photos are counted, never stored. */
export function photosBlock(profile = {}, kit = null) {
  const kinds = profile.attachment_kinds;
  const work = workPhotos(profile).filter(u => kindOf(kinds, u) === "work");
  const owner = [s(profile.owner_photo_url)].filter(u => /^https:\/\//i.test(u));
  return { owner, work, google_work_count: list(kit?.google_photos).length };
}

/** Owner-entered services, by name (self-serve form / dashboard). */
export function ownerServices(profile = {}) {
  return uniq(list(profile.services)
    .map(x => s(typeof x === "string" ? x : x?.service_name || x?.name))
    .filter(Boolean));
}

/**
 * The fact sheet. Every input is optional:
 *   profile       small_business_profiles row (or the self-serve form's values in the same column names)
 *   place         Places (New) details already fetched by the caller
 *   raw           the prospect's stored Outscraper listing (prospects.raw), when there's no place
 *   reviews       Places reviews or stored google testimonials (see reviewsFrom)
 *   siteText      their own website's text
 *   kit           the stored brand kit (owner names, towns, google photo count)
 *   owner         owner answers that aren't profile columns: { service_for_page, notes, names, services }
 *                 (services: what the owner typed; never the AI-written services column)
 *   previous      the stored fact sheet; anything not given again is kept from it
 *                 (reviews, site text, listing facts, service_for_page)
 */
export function buildFactSheet({ profile = {}, place = null, raw = null, reviews, siteText, kit = null, owner = {}, previous = null, now = Date.now() } = {}) {
  const p = profile || {};
  const prev = previous && typeof previous === "object" ? previous : {};
  const pb = prev.business || {};
  const r = raw || {};
  const k = kit || p.brand_kit || null;

  const googleTypes = list(place?.types).length ? list(place.types)
    : list(r.subtypes ? String(r.subtypes).split(/,\s*/) : []).length ? String(r.subtypes).split(/,\s*/)
      : list(pb.google_types);
  const hours = list(place?.regularOpeningHours?.weekdayDescriptions).length ? place.regularOpeningHours.weekdayDescriptions
    : list(pb.hours);

  const rawName = s(p.business_name) || s(place?.displayName?.text) || s(r.name) || s(pb.raw_name) || s(pb.name);
  const cleaned = cleanBusinessName(rawName, { now: new Date(now) });
  const business = {
    // The clean name shows on the page; the raw Google name (with any
    // "/40 yrs Family Business" tail) stays here as listing evidence (g).
    name: cleaned.name || rawName,
    raw_name: rawName || null,
    name_claims: cleaned.claims,
    trade: s(p.primary_category) || s(place?.primaryTypeDisplayName?.text) || s(r.type || r.category) || s(pb.trade),
    // Google's own primary type is sometimes just "Services"; the stored
    // listing's type ("Lawn care service") is better then.
    primary_type: [place?.primaryTypeDisplayName?.text, r.type, r.category, pb.primary_type].map(s).find(t => t && !GENERIC_TYPE.test(t))
      || s(place?.primaryTypeDisplayName?.text) || s(r.type || r.category) || s(pb.primary_type) || null,
    google_types: uniq(googleTypes.map(s).filter(Boolean)).slice(0, 8),
    phone: s(p.phone) || s(place?.nationalPhoneNumber) || s(r.phone) || s(pb.phone) || null,
    address: s(p.address) || s(place?.formattedAddress) || s(r.address) || s(pb.address) || null,
    town: s(p.city) || s(r.city) || s(pb.town) || null,
    state: stateCode(p.state || r.state_code || r.state) || s(pb.state) || null,
    hours: hours.map(s).filter(Boolean),
    rating: num(place?.rating ?? p.average_rating ?? r.rating ?? pb.rating),
    review_count: num(place?.userRatingCount ?? p.review_count ?? r.reviews ?? pb.review_count),
    place_id: s(p.google_place_id) || s(place?.id) || s(r.place_id) || s(pb.place_id) || null,
  };
  business.trade = specificTrade(business) || business.trade;

  const theReviews = reviews === undefined ? list(prev.reviews) : reviewsFrom(reviews);
  const site = siteText === undefined ? s(prev.site_text) : s(siteText);

  // Names: the owner's own (form/admin), the kit's (logo + listing), the
  // owner_name column. Never read out of AI-written copy.
  const kitNames = list(k?.owner_names).map(s).filter(Boolean);
  const ownFirst = ownerNamesFrom({ owner_name: p.owner_name, business_name: p.business_name, city: p.city });
  const prevOwner = prev.owner || {};
  const names = uniq([...list(owner.names).map(s), ...kitNames, ...ownFirst, ...list(prevOwner.names)].filter(Boolean)).slice(0, 2);
  const serviceForPage = owner.service_for_page !== undefined ? (s(owner.service_for_page) || null) : (prevOwner.service_for_page ?? null);

  return {
    version: FACT_SHEET_VERSION,
    built_at: new Date(now).toISOString(),
    business,
    reviews: theReviews,
    site_text: site.slice(0, MAX_SITE_TEXT),
    owner: {
      names,
      years_in_business: num(p.years_in_business) && num(p.years_in_business) > 0 ? num(p.years_in_business) : null,
      license_number: s(p.license_number) || null,
      is_insured: bool(p.is_insured),
      offers_free_estimates: bool(p.offers_free_estimates),
      // previews store false by default, which isn't the owner saying no:
      // only a true is used as a fact (page-copy.js).
      offers_emergency: bool(p.offers_emergency),
      blurb: s(p.owner_blurb) || null,
      service_for_page: serviceForPage,
      // Only services the owner (or Jack's admin input) typed. A preview's
      // services column is AI-written copy, not an owner answer.
      services: owner.services !== undefined ? ownerServices({ services: owner.services }) : list(prevOwner.services),
      notes: owner.notes !== undefined ? (s(owner.notes) || null) : (prevOwner.notes ?? null),
    },
    towns: townsBlock(p, k),
    photos: photosBlock(p, k),
  };
}

// ── Evidence ──────────────────────────────────────────────────────────────
// Ids a claim can cite: r1..r5 (reviews), g (the Google listing), s (site
// text), o.<field> (owner answers). Each maps to the text the claim must be
// supported by.

const OWNER_FIELDS = ["names", "years_in_business", "license_number", "is_insured", "offers_free_estimates", "offers_emergency", "blurb", "service_for_page", "services", "notes"];

function ownerText(field, v) {
  if (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length)) return null;
  switch (field) {
    case "names": return `Owner: ${v.join(" and ")}`;
    case "years_in_business": return `${v} years in business`;
    case "license_number": return `Licensed. License number ${v}`;
    case "is_insured": return v ? "Insured" : null;
    case "offers_free_estimates": return v ? "Free estimates" : null;
    case "offers_emergency": return v ? "Emergency service, after-hours calls" : null;
    case "services": return `Services: ${v.join(", ")}`;
    default: return String(v);
  }
}

/** Listing text: what Google shows about the business. */
export function listingText(b = {}) {
  return [
    b.raw_name || b.name, b.trade, b.primary_type, list(b.google_types).join(", "),
    b.phone, b.address, [b.town, b.state].filter(Boolean).join(", "),
    list(b.hours).join("; "),
    b.rating ? `${b.rating} stars` : "", b.review_count ? `${b.review_count} Google reviews` : "",
  ].filter(Boolean).join("\n");
}

/** { id: text } for every id this fact sheet can back. */
export function evidenceMap(fs = {}) {
  const out = {};
  for (const r of list(fs.reviews)) if (r?.id && r.text) out[r.id] = r.text;
  out.g = listingText(fs.business || {});
  if (s(fs.site_text)) out.s = fs.site_text;
  const o = fs.owner || {};
  for (const f of OWNER_FIELDS) {
    const t = ownerText(f, o[f]);
    if (t) out[`o.${f}`] = t;
  }
  const towns = uniq([fs.towns?.home, ...list(fs.towns?.confirmed)].filter(Boolean));
  if (towns.length) out["o.towns"] = `Serves ${towns.join(", ")}`;
  const work = list(fs.photos?.work).length;
  if (work) out["o.photos"] = `The owner uploaded ${work} job photo(s)`;
  return out;
}

// ── I/O ───────────────────────────────────────────────────────────────────

/**
 * Store a fact sheet. With PAGE_COPY_V3=on (off by default until the v3
 * template ships) it also writes page_copy_v3: one gpt-4o call plus one
 * gpt-4o-mini call (page-copy.js generatePageCopyV3). Best effort: before
 * migration 20261118_fact_sheet_v3 is applied the columns don't exist, so
 * this logs and returns null instead of throwing.
 */
// onCopy(copy): called after page_copy_v3 is saved (the pipeline uses it to
// move a new preview to page v3).
export async function saveFactSheet(supabaseAdmin, businessId, fs, { env = process.env, fetchImpl = globalThis.fetch, onCopy = null } = {}) {
  const { error } = await supabaseAdmin.from("small_business_profiles").update({ fact_sheet: fs }).eq("business_id", businessId);
  if (error) { console.warn("fact sheet not saved:", error.message); return null; }
  if (env.PAGE_COPY_V3 === "on") {
    try {
      const { generatePageCopyV3 } = await import("./page-copy.js");
      const { copy, cost_usd } = await generatePageCopyV3(fs, { fetchImpl });
      const { error: cErr } = await supabaseAdmin.from("small_business_profiles").update({ page_copy_v3: copy }).eq("business_id", businessId);
      if (cErr) console.warn("page_copy_v3 not saved:", cErr.message);
      else {
        console.log(`page_copy_v3 [${businessId}] $${cost_usd}`);
        if (onCopy) { try { await onCopy(copy); } catch (e) { console.warn("onCopy failed:", e?.message || e); } }
        // Website v3 PR C: the copy's service_page becomes the one auto
        // service page (a draft until the owner approves it).
        const { syncAutoServicePage } = await import("./service-page-v3.js");
        await syncAutoServicePage(supabaseAdmin, businessId, copy, fs, { onUnbill: () => syncQuantityQuietly(supabaseAdmin, businessId) });
      }
    } catch (e) {
      console.warn("page_copy_v3 failed:", e?.message || e);
    }
  }
  return fs;
}

// A replaced auto service page that was live: put the add-on quantity back in line.
async function syncQuantityQuietly(supabaseAdmin, businessId) {
  try {
    const [{ syncSpotlightQuantity }, { default: Stripe }] = await Promise.all([import("./spotlight-billing.js"), import("stripe")]);
    const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
    await syncSpotlightQuantity({ stripe, supabase: supabaseAdmin, businessId });
  } catch (e) {
    console.warn(`[spotlight-billing] sync after auto page change failed for ${businessId}:`, e?.message || e);
  }
}

/**
 * Rebuild one row's fact sheet from what's stored. Called when owner
 * answers, confirmed towns or photos change (owner-actions.js,
 * logo-settings.js, the self-serve edit path). Keeps the stored sheet's
 * reviews, site text and listing facts; makes no Places calls.
 */
export async function rebuildFactSheet(supabaseAdmin, businessId, { owner = {}, reviews, now = Date.now(), env, fetchImpl } = {}) {
  const { data: profile, error } = await supabaseAdmin.from("small_business_profiles").select("*").eq("business_id", businessId).maybeSingle();
  if (error || !profile) return null;
  const previous = profile.fact_sheet || null;
  // A first build for an older row: its stored Google testimonials are the reviews we have.
  const rv = reviews !== undefined ? reviews : (previous ? undefined : googleTestimonials(profile.testimonials));
  const fs = buildFactSheet({ profile, reviews: rv, previous, owner, now });
  return saveFactSheet(supabaseAdmin, businessId, fs, { env, fetchImpl });
}
