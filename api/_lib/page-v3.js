// api/_lib/page-v3.js
// Page v3 (small_business_profiles.page_version = 3): the research-based
// company page (the Arno v3 boards). Reads three things:
//   fact_sheet    facts we can check (docs/website-v3-contract.md, written by PR A)
//   page_copy_v3  the words on the page
//   brand_kit     colors, wordmark, logo, Google photo refs (api/_lib/brand-kit.js)
// and fills the same public/profile.html template as v1 and v2. Styles are
// business-base.css section 17, scoped to body.page-v3, colors only from the
// kit's CSS variables (page-v2.js kitStyle). No per-page CSS.
//
// Top to bottom: top bar · header + menu · hero · proof strip · services ·
// meet the owner · recent work · reviews · where we work (map) · FAQ ·
// closing ask + quote form · footer · phone bottom bar.
//
// The rule for every section: it renders from real content or it isn't in
// the HTML at all. The one exception is photos: until the owner adds their
// own, the hero and service cards show placeholders from Enoma's self-hosted
// stock library (stock-library.js), labeled "Sample photo" on unclaimed
// previews and never captioned as the business's work. No drawn scenes, no
// "How it works" or boilerplate About. The area map is Google's free embed;
// common questions come from faq-bank.js (facts + trade questions).
//
// Pure: everything it needs (stock rows, town coordinates, spotlights) comes
// in through ctx, so each section's show/hide rule is testable
// (tests/page-v3.test.js).

import { telHref, smsHref, googleMapsUrl, schemaTypeFor, sameAsLinks, MAX_REVIEWS } from "./company-page.js";
import { normalizeProfile, normalizeFaqs } from "./page-ssr.js";
import { personaFor, hashString, isStrongRating } from "./page-style.js";
import { workPhotos } from "./photo-kinds.js";
import { stateCode, kitFor, wordmarkFor } from "./brand-kit.js";
import { linkServicesToSpotlights } from "./spotlight-render.js";
import { renderQuoteForm } from "./quote-form.js";
import { sizedUrls, creditFor, STOCK_QUERIES } from "./stock-photos.js";
import { stockForService, stockForHero, tagForService } from "./stock-library.js";
import { cleanBusinessName } from "./business-name.js";
import { peopleInReviews, leadPerson, personLine } from "./review-people.js";
import { buildFaqs } from "./faq-bank.js";
import { specificTrade } from "./fact-sheet.js";
import { buildEyebrow } from "./page-copy.js";
import {
  kitStyle, brandMark, mobileBar, ownerBar, googlePhotoSrc, attributionHtml, stockCredit,
} from "./page-v2.js";

const esc = s => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const list = v => {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") { try { const j = JSON.parse(v); return Array.isArray(j) ? j : []; } catch { return []; } }
  return [];
};
const obj = v => {
  if (v && typeof v === "object" && !Array.isArray(v)) return v;
  if (typeof v === "string") { try { const j = JSON.parse(v); return j && typeof j === "object" && !Array.isArray(j) ? j : null; } catch { return null; } }
  return null;
};
const str = v => (v == null ? "" : String(v).trim());
const httpUrl = u => (/^https:\/\//i.test(str(u)) ? str(u) : null);
const slugify = t => str(t).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const cleanTown = t => str(t).replace(/,\s*[A-Za-z .]+$/, "").trim();
const sameTown = (a, b) => cleanTown(a).toLowerCase() === cleanTown(b).toLowerCase();

export const MAX_PROOF = 4;
export const STOCK_MAX_BUSINESSES = 3;

// ── When v3 renders ───────────────────────────────────────────────────────

/** page_version 3 with written copy (a v3 row without copy renders as v2). */
export function isPageV3(profile) {
  return Number(profile?.page_version) === 3 && !!str(obj(profile?.page_copy_v3)?.hero_headline);
}

// ── Contract (docs/website-v3-contract.md, PR A) → one normalized shape ──
// fact_sheet: { business, reviews[], owner, towns, photos }
// page_copy_v3: { eyebrow, hero_headline, hero_sub, proof[], services[],
//                 owner_section, faqs[], closing, service_page }
// Copy items carry evidence ids; one with none isn't shown.

const hasEvidence = x => Array.isArray(x?.evidence) && x.evidence.some(e => str(e));

const DAYS_GOOGLE = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SCHEMA_DAY = [1, 2, 3, 4, 5, 6, 0]; // Google's Monday-first order → 0 = Sunday

function to24(t, mer) {
  const m = str(t).match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (/p/i.test(mer)) h += 12;
  return `${String(h).padStart(2, "0")}:${m[2] || "00"}`;
}
const short = hhmm => { const [h, m] = hhmm.split(":").map(Number); const h12 = h % 12 || 12; return `${h12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`; };

/**
 * Google's weekday lines ("Monday: 8:00 AM – 4:00 PM", "Sunday: Closed",
 * "Open 24 hours") → { text: "Open every day, 8am–4pm" | "Mon–Fri 8am–5pm ·
 * Sat 9am–1pm", spec: [{ days: [0..6], opens, closes }] }, or null. A day
 * with split hours keeps its own text and stays out of the schema.
 */
export function summarizeHours(lines) {
  const rows = list(lines).map(l => String(l).replace(/[   ]/g, " ").trim()).filter(Boolean);
  if (!rows.length) return null;
  const byDay = new Array(7).fill(null);
  for (const row of rows) {
    const m = row.match(/^([A-Za-z]+):\s*(.+)$/);
    if (!m) continue;
    const d = DAYS_GOOGLE.indexOf(m[1].toLowerCase());
    if (d < 0) continue;
    const v = m[2].trim();
    if (/^closed$/i.test(v)) { byDay[d] = { closed: true, key: "closed" }; continue; }
    if (/open 24 hours/i.test(v)) { byDay[d] = { key: "24h", opens: "00:00", closes: "23:59", label: "open 24 hours" }; continue; }
    const r = v.match(/^(\d{1,2}(?::\d{2})?)\s*([AP]M)?\s*[–-]\s*(\d{1,2}(?::\d{2})?)\s*([AP]M)$/i);
    if (r) {
      const opens = to24(r[1], r[2] || r[4]), closes = to24(r[3], r[4]);
      if (opens && closes) { byDay[d] = { key: `${opens}-${closes}`, opens, closes, label: `${short(opens)}–${short(closes)}` }; continue; }
    }
    byDay[d] = { key: `raw:${v}`, label: v };
  }
  if (!byDay.some(Boolean)) return null;
  const spec = [];
  const groups = [];
  for (let d = 0; d < 7; d++) {
    const x = byDay[d];
    if (!x || x.closed) continue;
    const g = groups[groups.length - 1];
    if (g && g.key === x.key && g.end === d - 1) g.end = d; else groups.push({ key: x.key, start: d, end: d, x });
  }
  for (const g of groups) if (g.x.opens) {
    const days = [];
    for (let d = g.start; d <= g.end; d++) days.push(SCHEMA_DAY[d]);
    const same = spec.find(s => s.opens === g.x.opens && s.closes === g.x.closes);
    if (same) same.days.push(...days); else spec.push({ days, opens: g.x.opens, closes: g.x.closes });
  }
  let text;
  if (groups.length === 1 && groups[0].start === 0 && groups[0].end === 6) {
    text = groups[0].key === "24h" ? "Open 24 hours, every day" : `Open every day, ${groups[0].x.label}`;
  } else {
    text = groups.map(g => `${g.start === g.end ? DAY_SHORT[g.start] : `${DAY_SHORT[g.start]}–${DAY_SHORT[g.end]}`} ${g.x.label}`).join(" · ");
  }
  return text ? { text, spec } : null;
}

// What a review sentence says that helps a caller decide.
const CONCRETE = /same day|next (day|morning)|first thing|first call|answered|called back|came (out|over|the)|showed up|on time|fixed|repaired|replaced|free|fair|honest|explained|cleaned up|weekend|emergency|apprentice/gi;
const sentences = t => str(t).replace(/\s+/g, " ").match(/[^.!?…]+[.!?…]+["”']?|[^.!?…]+$/g) || [];

/**
 * A review's quotable part: the most concrete sentence or two (same day,
 * next morning, answered, fixed…), up to max characters, never cut
 * mid-word without an ellipsis. Returns { text, score }.
 */
export function reviewExcerpt(text, max = 200) {
  const all = sentences(text).map(s => s.trim()).filter(s => s.length > 12);
  if (!all.length) return { text: "", score: 0 };
  const scoreOf = s => (s.match(CONCRETE) || []).length * 2 + (s.length >= 40 && s.length <= 170 ? 1 : 0);
  const full = all.join(" ");
  if (full.length <= max) return { text: full, score: all.reduce((n, s) => n + scoreOf(s), 0) };
  let best = 0;
  all.forEach((s, i) => { if (scoreOf(s) > scoreOf(all[best])) best = i; });
  let out = all[best];
  if (all[best + 1] && out.length + 1 + all[best + 1].length <= max && scoreOf(all[best + 1]) > 0) out += ` ${all[best + 1]}`;
  if (out.length > max) out = `${out.slice(0, max).replace(/\s+\S*$/, "")}…`;
  return { text: out, score: scoreOf(out) };
}

/**
 * stock_subject is a photo brief ("copper pipe repair close-up"); the stock
 * library is tagged per persona (stock-photos.js STOCK_QUERIES). The brief
 * and the service name pick the tag with the library's own match rules,
 * specific tags before the persona's general first entry. "" when none fits.
 */
export function stockTagFor(brief, name, persona) {
  const qs = STOCK_QUERIES[persona] || [];
  const text = `${str(brief)} ${str(name)}`.toLowerCase();
  if (!qs.length || !text.trim()) return "";
  const hit = qs.slice(1).find(q => q.match.test(text)) || (qs[0].match.test(text) ? qs[0] : null);
  return hit ? `${persona}/${hit.tag}` : "";
}

/**
 * The look/persona for a v3 business. Google's trade is often a vague
 * "services", so the listing's primary type, its other types, the profile
 * category and finally the service names are tried in turn.
 */
export function personaForProfile(rawProfile = {}) {
  const fs = obj(rawProfile?.fact_sheet) || {};
  const b = obj(fs.business) || {};
  const c = obj(rawProfile?.page_copy_v3) || {};
  // specificTrade: Google's "HVAC contractor" beats our broad "general
  // contractor" bucket, so pages built before that fix render right too.
  const tries = [specificTrade(b), b.trade, b.primary_type, ...list(b.google_types), rawProfile?.primary_category,
    list(c.services).map(s => str(s?.name)).join(" ")];
  for (const t of tries) {
    const pz = personaFor(str(t).replace(/_/g, " "));
    if (pz !== "default") return pz;
  }
  return "default";
}

const SERVICES_HEADING = { plumbing: "What we fix", hvac: "What we fix", electrical: "What we fix", painting: "What we paint", cleaning: "What we clean" };

/**
 * Everything the page shows, from fact_sheet + page_copy_v3 + brand kit,
 * with gaps filled from the profile row. Missing facts stay empty: nothing
 * is invented here.
 */
/** A card's one line when the copy left it empty: the service page's first sentence or first "what we do" line. */
export function serviceLineFallback(name, sp) {
  if (!sp || !str(name)) return "";
  const same = slugify(sp.service_name || sp.slug) === slugify(name);
  if (!same) return "";
  const intro = str(sp.intro).match(/^[^.!?]+[.!?]/);
  if (intro && !WEAK_SUB.test(intro[0])) return intro[0].trim();
  const w = list(sp.what_we_do).map(str).find(Boolean);
  return w ? w.replace(/([^.!?])$/, "$1.") : "";
}

export function factsFor(rawProfile = {}, kit = null) {
  const p = normalizeProfile(rawProfile || {});
  const fs = obj(rawProfile?.fact_sheet) || {};
  const b = obj(fs.business) || {};
  const o = obj(fs.owner) || {};
  const c = obj(rawProfile?.page_copy_v3) || {};
  const k = kit || kitFor(p);
  const persona = personaForProfile(rawProfile);

  const phone = str(b.phone || p.phone);
  const address = str(b.address || p.address);
  const first = address.split(",")[0].trim();
  // Google sometimes repeats the unit ("Bldg A Unit 3 Unit 3").
  const street = /^\d/.test(first) ? first.replace(/\b((?:\S+\s+)?\S+)(?:\s+\1\b)+/g, "$1") : "";
  const zip = (address.match(/\b(\d{5})(?:-\d{4})?\b/) || [])[1] || "";
  const town = cleanTown(b.town || p.city);
  const state = stateCode(b.state || p.state) || "";
  const rating = Number(b.rating ?? p.average_rating);
  const count = Number(b.review_count ?? p.review_count);

  const reviewsIn = Array.isArray(fs.reviews) ? fs.reviews
    : list(p.testimonials).filter(t => t?.source === "google").map(t => ({ author: t.author, rating: t.rating, text: t.quote || t.text }));
  const reviews = reviewsIn.filter(r => r && (Number(r.rating) || 5) >= 4).map((r, i) => {
    const ex = reviewExcerpt(r.text);
    return { id: str(r.id) || `r${i + 1}`, quote: ex.text, author: str(r.author) || "Customer", rating: Number(r.rating) || null, context: "", strength: ex.score + (Number(r.rating) || 0) };
  }).filter(r => r.quote).slice(0, MAX_REVIEWS);


  const towns = obj(fs.towns) || {};
  const confirmed = (Array.isArray(towns.confirmed) ? towns.confirmed : list(k?.towns?.confirmed)).map(cleanTown).filter(Boolean);
  const home = cleanTown(towns.home) || town || confirmed[0] || "";
  const nearby = (Array.isArray(towns.suggested) ? towns.suggested : list(k?.towns?.suggested)).map(cleanTown)
    .filter(t => t && !sameTown(t, home) && !confirmed.some(x => sameTown(x, t)));

  const photos = obj(fs.photos) || {};
  const ownerPhoto = list(photos.owner).map(httpUrl).find(Boolean) || httpUrl(p.owner_photo_url);
  const own = (Array.isArray(photos.work) ? photos.work : workPhotos(p)).map(u => (typeof u === "string" ? { url: u } : u))
    .map(w => ({ url: httpUrl(w?.url), job: str(w?.job), town: cleanTown(w?.town) })).filter(w => w.url);
  // Google work photos stay refs on the kit; the page decides if they may show.
  const google = list(k?.google_photos).map((g, i) => ({ g, i })).filter(x => x.g?.kind === "work").map(x => ({ url: `google:${x.i}`, job: "", town: "" }));

  // A card shows the owner's own photo when the copy points it at one of
  // their work photos (never a URL from anywhere else).
  const sp = obj(c.service_page);
  const services = list(c.services).filter(s => str(s?.name) && hasEvidence(s)).map(s => {
    const name = str(s.name);
    const mine = own.find(w => w.url === httpUrl(s.work_photo));
    return { name, slug: slugify(name), stock_subject: stockTagFor(s.stock_subject, name, persona), brief: str(s.stock_subject), work_photo: mine ? mine.url : null, photo: null, cta: "estimate", line: str(s.description) || serviceLineFallback(name, sp) };
  });

  const nm = cleanBusinessName(str(b.raw_name) || str(b.name) || str(p.business_name));
  const nameClaims = Array.isArray(b.name_claims) ? b.name_claims : nm.claims;
  const ownerNames = (() => { const n = list(o.names).map(str).filter(Boolean); return n.length ? n : list(k?.owner_names); })();
  // People reviews name (review-people.js): only when the owner hasn't told us names.
  // The business name's own words never count as a person ("Maynard always
  // answers" is the brand), even when the name is a person's (John Patrie Electric).
  const people = peopleInReviews(list(fs.reviews), { skip: [town, ...confirmed, ...nearby, nm.name, nm.raw] });
  const lead = ownerNames.length ? null : leadPerson(people);

  const lic = (str(o.license_number) || str(p.license_number)).replace(/^#/, "");
  const kitLic = k?.license && str(k.license.number) === lic ? k.license : null;

  return {
    name: nm.name || str(b.name) || str(p.business_name),
    name_claims: nameClaims,
    years_in_business: Number(o.years_in_business) > 0 ? Number(o.years_in_business) : null,
    person: lead,
    primary_type: str(b.primary_type) || str(p.primary_category),
    trade: persona,
    phone,
    texts_ok: !!phone,
    address: { street, town, state, zip },
    hours: summarizeHours(b.hours) || (str(p.hero_availability) ? { text: str(p.hero_availability).replace(/\.+$/, ""), spec: [] } : null),
    offers_free_estimates: (o.offers_free_estimates ?? p.offers_free_estimates) === true,
    offers_emergency: (o.offers_emergency ?? p.offers_emergency) === true,
    is_insured: (o.is_insured ?? p.is_insured) === true,
    license: lic ? (kitLic || { state, kind: "License", number: lic, verify_url: null }) : null,
    google: {
      place_id: str(b.place_id || p.google_place_id) || null,
      rating: Number.isFinite(rating) && rating > 0 ? rating : null,
      count: Number.isInteger(count) && count > 0 ? count : null,
    },
    reviews,
    services,
    services_heading: SERVICES_HEADING[persona] || "What we do",
    towns: { home, confirmed, nearby },
    owner: { names: ownerNames, photo_url: ownerPhoto || null },
    work_photos: [...own, ...google],
  };
}

const BROAD_EYEBROW = /^(general contractors?|contractors?|services?|local service|home services?)\b/i;

/** The words on the page, from page_copy_v3 (items without evidence dropped). */
export function copyFor(rawProfile = {}, facts = null) {
  const c = obj(rawProfile?.page_copy_v3) || {};
  const owner = obj(c.owner_section);
  const closing = obj(c.closing) || {};
  const ownerBody = owner && hasEvidence(owner) ? str(owner.body).split(/\n\s*\n/).map(str).filter(Boolean) : [];
  return {
    hero: {
      // A page saved with a broad trade ("General contractor in ...") gets
      // its eyebrow rebuilt from the fact sheet; any other eyebrow is kept.
      eyebrow: BROAD_EYEBROW.test(str(c.eyebrow)) && obj(rawProfile?.fact_sheet)?.business ? buildEyebrow(rawProfile.fact_sheet) : str(c.eyebrow), h1: str(c.hero_headline),
      sub: facts && weakSub(c.hero_sub, c.hero_headline, facts.name) ? (factSub(facts) || str(c.hero_sub)) : str(c.hero_sub),
      person: facts ? personLine(facts.person) : "",
    },
    proof: proofItemsV3(obj(rawProfile?.fact_sheet) || {}, facts, list(c.proof)),
    services: { heading: facts?.services_heading || "What we do", sub: "", lines: {} },
    owner_section: owner && str(owner.heading) && ownerBody.length ? { heading: str(owner.heading), body: ownerBody } : null,
    reviews_heading: "What neighbors say",
    faqs: facts ? buildFaqs({
      persona: facts.trade,
      serviceText: [...facts.services.map(s => s.name), facts.trade].join(" | "),
      facts,
      aiFaqs: normalizeFaqs(list(c.faqs).filter(hasEvidence)),
    }) : normalizeFaqs(list(c.faqs).filter(hasEvidence)),
    // Generic AI closings ("Ready to Paint?", "Need plumbing help?") read as a
    // template; those fall back to a line built in code.
    closing: closingCopyV3(facts, closing),
  };
}

// ── Proof strip: facts only ───────────────────────────────────────────────
// Code builds every item it can check (rating, years, family/veteran owned,
// license, insured, hours). Review themes stay only when they're a time or a
// number said by 2+ reviews ("Same day · in 2 reviews"); free-text labels
// like "how fast they showed up" read as machine-made and are dropped.

export const PROOF_TIME_RE = /^(same[- ]day|next[- ](?:day|morning)|within (?:an?|one|\d+) (?:hour|day|minute)s?|\d+\+?\s*(?:years?|yrs?|hours?|days?|minutes?|mins?)|24\/7|on[- ]time)$/i;
export const PROOF_IDENTITY_RE = /^(family[- ]owned|veteran[- ]owned|locally[- ]owned|woman[- ]owned|family business)$/i;

export function proofItemsV3(fs = {}, facts = null, aiProof = []) {
  const b = fs.business || {};
  const out = [];
  const rating = Number(facts?.google?.rating ?? b.rating);
  const count = Number(facts?.google?.count ?? b.review_count);
  if (isStrongRating(rating, count)) out.push({ big: `${rating.toFixed(1)} ★`, small: `${count} Google reviews` });
  const claims = list(facts?.name_claims);
  const years = Number(facts?.years_in_business) || Number(claims.find(x => x?.kind === "years")?.value) || 0;
  const family = claims.some(x => x?.kind === "family");
  const veteran = claims.some(x => x?.kind === "veteran");
  if (years > 0) out.push({ big: `${years} years`, small: family ? "Family business" : veteran ? "Veteran owned" : "In business" });
  else if (family) out.push({ big: "Family", small: "owned and run" });
  if (veteran && !(years > 0 && !family)) out.push({ big: "Veteran", small: "owned" });
  if (facts?.license?.number) out.push({ big: facts.is_insured ? "Licensed & insured" : "Licensed", small: [facts.license.state, `#${str(facts.license.number).replace(/^#/, "")}`].filter(Boolean).join(" ") });
  else if (facts?.is_insured) out.push({ big: "Insured", small: "Fully insured" });
  const hours = list(b.hours).map(String);
  // "Open on Saturdays" is the weakest stat (and showed on every example
  // page): it goes after the review-backed ones, and only fills a row that
  // would otherwise have fewer than 3.
  let saturdays = null;
  if (hours.length === 7) {
    const open = hours.filter(h => !/closed/i.test(h));
    if (hours.every(h => /open 24 hours/i.test(h))) out.push({ big: "24/7", small: "Open around the clock" });
    else if (open.length === 7) out.push({ big: "7 days", small: "Open every day" });
    else if (open.some(h => /^saturday/i.test(h))) saturdays = { big: "Saturdays", small: "Open on Saturdays" };
  }
  for (const x of list(aiProof)) {
    const ev = list(x?.evidence).map(str);
    const reviews = new Set(ev.filter(e => /^r\d+$/.test(e)));
    const value = str(x?.value);
    if (!value || reviews.size < 2 || !hasEvidence(x)) continue;
    if (PROOF_IDENTITY_RE.test(value)) {
      if (/family/i.test(value) && (family || out.some(o => /family/i.test(`${o.big} ${o.small}`)))) continue;
      out.push({ big: value.replace(/^(\w)/, c => c.toUpperCase()), small: `in ${reviews.size} reviews` });
    } else if (PROOF_TIME_RE.test(value)) {
      out.push({ big: value.replace(/^(\w)/, c => c.toUpperCase()), small: `in ${reviews.size} reviews` });
    }
  }
  if (saturdays && out.length < 3) out.push(saturdays);
  return out.slice(0, MAX_PROOF);
}

export const GENERIC_CLOSING = /^(?:need|ready|looking|want|time)\b[^?.!]{0,32}[?.!]?$/i;

export function closingCopyV3(facts, ai = {}) {
  const heading = str(ai?.heading);
  const line = str(ai?.line);
  const codeLine = facts?.phone ? `Call ${facts.phone}, or send a few details and we'll get back to you.` : "Send a few details and we'll get back to you.";
  if (heading && !GENERIC_CLOSING.test(heading)) return { heading, line: line && !/^call us today\b/i.test(line) ? line : codeLine };
  return { heading: "Let's get you on the schedule.", line: codeLine };
}

// ── Hero sub-line check ───────────────────────────────────────────────────
// A sub that restates the H1, pads with adjectives or says "Providing …
// services" reads as a template; the page builds a plain one from facts.

export const WEAK_SUB = /^(providing|offering|serving)\b|\bspeciali[sz]/i;
const PADDING = /\b(?:with|offering)\s+(?:quick|fast|great|detailed|attentive|meticulous|honest|timely|thorough|friendly|reliable)\b/i;
const STOP_WORDS = new Set("a an the and or in of for to with on at by your you our we is are from".split(" "));
const contentWords = t => str(t).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(w => w && !STOP_WORDS.has(w));

export function weakSub(sub, h1, businessName = "") {
  const t = str(sub);
  if (!t) return true;
  if (WEAK_SUB.test(t) || PADDING.test(t)) return true;
  const first = str(businessName).split(/\s+/)[0];
  if (first && first.length > 2 && new RegExp(`\\b${first.replace(/[^A-Za-z0-9]/g, "")}\\b`, "i").test(t)) return true;
  const hw = new Set(contentWords(h1));
  const sw = contentWords(t);
  if (sw.length && hw.size) {
    const overlap = sw.filter(w => hw.has(w)).length / Math.min(sw.length, hw.size);
    if (overlap > 0.6) return true;
  }
  return false;
}

/** "Help with hot water tank failures, drain clogs and pipe leaks in North Attleborough." */
export function factSub(facts) {
  let names = facts.services.map(x => x.name).slice(0, 3);
  if (!names.length) return "";
  if (names.join(", ").length > 70) names = names.slice(0, 2);
  // Lower case inside a sentence, but acronyms (HVAC, EV) stay.
  const lower = names.map(n => n.split(/\s+/).map(w => (/^[A-Z][a-z]/.test(w) ? w.toLowerCase() : w)).join(" "));
  const joined = lower.length > 1 ? `${lower.slice(0, -1).join(", ")} and ${lower[lower.length - 1]}` : lower[0];
  const town = facts.towns.home || facts.address.town;
  return `Help with ${joined}${town ? ` in ${town}` : ""}.${facts.offers_free_estimates ? " Free estimates." : ""}`;
}

/** The one estimate label used everywhere on the page. */
export function estimateLabelV3(facts) {
  return facts.offers_free_estimates ? "Get a free estimate" : "Get an estimate";
}

// ── Seasonal top-bar line ─────────────────────────────────────────────────

// Months are 1–12. Each needs a matching service (or trade) so we never
// advertise work the business doesn't list.
export const SEASONAL_LINES = Object.freeze([
  { key: "snow", months: [11, 12, 1, 2], trades: ["landscaping", "snow"], service: /snow|plow/i, line: "Snow plowing this winter? Call or text us." },
  { key: "heating", months: [10, 11, 12, 1, 2], trades: ["hvac", "plumbing"], service: /heat|boiler|furnace/i, line: "No heat? Call us." },
  { key: "ac", months: [5, 6, 7, 8], trades: ["hvac"], service: /\bac\b|a\/c|air condition|cool|mini ?split|heat pump/i, line: "AC not cooling? Call us." },
  { key: "exteriors", months: [3, 4, 5, 6], trades: ["painting"], service: /exterior|outside|siding|house paint/i, line: "Planning exterior painting this spring? Call us." },
]);

/** The seasonal line for this business this month, or "". */
export function seasonalLine(facts, now = new Date()) {
  const month = now.getMonth() + 1;
  const names = facts.services.map(s => s.name).join(" | ");
  const snowTrade = facts.trade === "snow" || /snow|plow/i.test(names);
  for (const s of SEASONAL_LINES) {
    if (!s.months.includes(month)) continue;
    const tradeOk = s.trades.includes(facts.trade) || (s.key === "snow" && snowTrade);
    if (tradeOk && s.service.test(names)) return s.line;
  }
  return "";
}

// ── Photos ────────────────────────────────────────────────────────────────

/** Google listing photos only on claimed pages and the owner's own view (cost guardrails). */
export function googlePhotosAllowed(rawProfile, ctx = {}) {
  return !!ctx.owner || rawProfile?.is_claimed === true;
}

function googleRef(ref, kit) {
  const m = str(ref).match(/^google:(\d+)$/);
  if (!m) return null;
  const i = Number(m[1]);
  const g = list(kit?.google_photos)[i];
  return g ? { i, g } : null;
}

/** A work photo reference → { src, credit } or null (not allowed / not usable). */
function workPhotoSrc(ref, kit, ctx) {
  const gr = googleRef(ref, kit);
  if (gr) return ctx.googleOk ? { src: googlePhotoSrc(ctx.slug, gr.i), credit: attributionHtml(gr.g).replace(/v2-credit/g, "v3-credit") } : null;
  const url = httpUrl(ref);
  return url ? { src: url, credit: "" } : null;
}

/**
 * Stock for one service by its stock_subject ("plumbing/pipes" or "pipes"):
 * approved rows with that tag, minus photos already on STOCK_MAX_BUSINESSES
 * other businesses and photos already used on this page. Ties broken by a
 * hash of the business and subject, so neighbors differ. null when none.
 * usage: { [unsplash_id]: [business_id, ...] } from stock_photo_assignments.
 */
export function pickServiceStock(rows, subject, { businessId = "", usage = {}, taken = new Set() } = {}) {
  const [a, b] = str(subject).toLowerCase().split("/");
  const persona = b ? a : null, tag = b || a;
  if (!tag) return null;
  const others = id => (usage[id] || []).filter(x => x && x !== businessId).length;
  const pool = (Array.isArray(rows) ? rows : [])
    .filter(r => r && r.approved === true && r.service_tag === tag && (!persona || r.persona === persona) && sizedUrls(r.raw_url))
    .filter(r => !taken.has(r.unsplash_id) && others(r.unsplash_id) < STOCK_MAX_BUSINESSES)
    .sort((x, y) => (x.unsplash_id < y.unsplash_id ? -1 : 1));
  if (!pool.length) return null;
  const row = pool[hashString(`${businessId}:${subject}`) % pool.length];
  const urls = sizedUrls(row.raw_url);
  return { unsplash_id: row.unsplash_id, url: urls.w1200, srcset: urls.srcset, alt: row.alt || "", credit: creditFor(row) };
}

/**
 * The stock rows and usage pickServiceStock needs, for the services that
 * need stock (no work photo, no photo chosen at build time). One read of
 * stock_photos and one of stock_photo_assignments; never Unsplash. Any
 * error → none (cards render without a photo).
 */
export async function loadServiceStock(supabase, rawProfile, { log = console } = {}) {
  const none = { stockRows: [], stockUsage: {} };
  try {
    const subjects = factsFor(rawProfile).services.map(s => s.stock_subject).filter(Boolean);
    if (!supabase || !subjects.length) return none;
    const personas = [...new Set(subjects.map(x => (x.includes("/") ? x.split("/")[0] : personaFor(rawProfile.primary_category))))];
    const tags = [...new Set(subjects.map(x => x.split("/").pop()))];
    const { data: rows, error } = await supabase.from("stock_photos")
      .select("unsplash_id, persona, service_tag, raw_url, alt, photographer_name, photographer_username, photographer_url, photo_page_url, approved")
      .eq("approved", true).in("persona", personas).in("service_tag", tags);
    if (error) throw new Error(error.message);
    const ids = (rows || []).map(r => r.unsplash_id);
    if (!ids.length) return none;
    const { data: used } = await supabase.from("stock_photo_assignments").select("unsplash_id, business_id").in("unsplash_id", ids);
    const stockUsage = {};
    for (const u of used || []) (stockUsage[u.unsplash_id] ||= []).push(u.business_id);
    return { stockRows: rows || [], stockUsage };
  } catch (e) {
    log.warn?.("page v3 stock: none loaded:", e?.message || e);
    return none;
  }
}

/**
 * The photo for a service card: the owner's work photo for it, else a
 * placeholder from Enoma's own stock library (stock-library.js: self-hosted,
 * no credit line). null for an unknown trade.
 */
export function servicePhoto(service, kit, ctx, taken) {
  if (service.work_photo) {
    const w = workPhotoSrc(service.work_photo, kit, ctx);
    if (w) return { kind: "work", src: w.src, srcset: "", alt: `${service.name} by ${ctx.name}`, credit: w.credit };
  }
  const persona = ctx.persona;
  if (!persona || persona === "default") return null;
  const name = service.name || service.service_name;
  const s = stockForService({ persona, name, brief: service.brief, seed: ctx.businessId || ctx.slug || "", taken: taken || new Set() });
  if (!s) return null;
  // Describe the picture only when it is a picture of this service; a
  // fallback photo from another tag gets the service's name, never a wrong subject.
  const own = tagForService(persona, name);
  return { kind: "stock", src: s.src, srcset: s.srcset, alt: own && own === s.key ? s.alt : str(name), credit: "" };
}

/**
 * The hero's photo, behind the headline: a Google listing work photo where
 * allowed (claimed pages), else a placeholder from the stock library.
 * Owner photos use the owner layout instead. { src, srcset, alt, credit, placeholder } or null.
 */
export function heroPhoto(facts, kit, ctx) {
  if (ctx.googleOk) {
    const g = facts.work_photos.find(w => /^google:/.test(w.url));
    const w = g ? workPhotoSrc(g.url, kit, ctx) : null;
    if (w) return { src: w.src, srcset: "", alt: `Work by ${facts.name}`, credit: w.credit, placeholder: false };
    const own = facts.work_photos.find(x => !/^google:/.test(x.url));
    if (own) return { src: own.url, srcset: "", alt: `Work by ${facts.name}`, credit: "", placeholder: false };
  } else {
    const own = facts.work_photos.find(x => !/^google:/.test(x.url));
    if (own) return { src: own.url, srcset: "", alt: `Work by ${facts.name}`, credit: "", placeholder: false };
  }
  if (!facts.trade || facts.trade === "default") return null;
  const s = stockForHero({ persona: facts.trade, mainService: facts.services[0]?.name || "", seed: ctx.businessId || ctx.slug || "", taken: ctx.taken || new Set() });
  return s ? { src: s.src1600, srcset: s.srcset, alt: "", credit: "", placeholder: ctx.claimed !== true } : null;
}

/** Recent work: real photos only (owner uploads; Google only where allowed), captioned job · town. */
export function recentWork(facts, kit, ctx) {
  return facts.work_photos.map(w => {
    const s = workPhotoSrc(w.url, kit, ctx);
    if (!s) return null;
    return { src: s.src, credit: s.credit, job: w.job, town: w.town || facts.towns.home, alt: [w.job || "Recent job", w.town].filter(Boolean).join(", ") };
  }).filter(Boolean).slice(0, 6);
}

// ── Icons ─────────────────────────────────────────────────────────────────

const I = (d, cls = "v3-i") => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${d}</svg>`;
export const ICON_CALL = I('<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.08 4.18 2 2 0 0 1 4.06 2h3a2 2 0 0 1 2 1.72c.12.86.31 1.7.57 2.5a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.58-1.09a2 2 0 0 1 2.11-.45c.8.26 1.64.45 2.5.57A2 2 0 0 1 22 16.92z"/>');
const STARS = n => `<span class="v3-stars" role="img" aria-label="${n} out of 5 stars">${"★".repeat(n)}${"☆".repeat(5 - n)}</span>`;

// Images: on error, try the next src in data-fallback, then drop the figure.
// One capture listener in the top bar, before any image loads.
const IMG_FALLBACK_SCRIPT = `<script>document.addEventListener("error",function(e){var t=e.target;if(!t||t.tagName!=="IMG"||!t.hasAttribute("data-v3-img"))return;var f=(t.getAttribute("data-fallback")||"").split(" ").filter(Boolean);if(f.length){t.removeAttribute("srcset");t.setAttribute("data-fallback",f.slice(1).join(" "));t.src=f[0];return}var box=t.closest("[data-v3-media]");if(box){var host=box.parentNode;box.remove();if(host&&host.classList)host.classList.add("is-noimg")}},true);</script>`;

export function img({ src, srcset = "", alt = "", sizes = "", eager = false, fallback = [] }) {
  return `<img data-v3-img src="${esc(src)}"${srcset ? ` srcset="${esc(srcset)}" sizes="${esc(sizes || "(min-width: 900px) 380px, 100vw")}"` : ""} alt="${esc(alt)}"${fallback.length ? ` data-fallback="${esc(fallback.join(" "))}"` : ""} ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" />`;
}

// ── Sections ──────────────────────────────────────────────────────────────

export function topBar(facts, ctx) {
  const seasonal = seasonalLine(facts, ctx.now || new Date());
  const town = [facts.towns.home || facts.address.town, facts.address.state].filter(Boolean).join(", ");
  const hours = str(facts.hours?.text);
  const left = [hours, town].filter(Boolean).join(" · ");
  if (!left && !seasonal && !facts.phone) return IMG_FALLBACK_SCRIPT;
  return `${IMG_FALLBACK_SCRIPT}<div class="v3-top${seasonal ? " has-season" : ""}">
  <div class="v3-wrap v3-top__in">
    ${left ? `<p class="v3-top__hours">${esc(left)}</p>` : ""}
    ${seasonal ? `<p class="v3-top__season">${esc(seasonal)}</p>` : ""}
    ${facts.phone ? `<a class="v3-top__phone" href="${esc(telHref(facts.phone))}" data-contact="call">${esc(facts.phone)}</a>` : ""}
  </div>
</div>`;
}

/**
 * The header + menu. base: "" on the home page; "/<slug>" on a service page,
 * so the menu's section links go back to the home page's sections.
 */
export function headerBlock(rawProfile, facts, kit, ctx, nav, base = "") {
  const p = { business_name: facts.name };
  // The stored wordmark was built from the raw Google name; when the name was
  // cleaned ("/40 yrs Family Business" off), rebuild it from the clean one.
  const raw = str(obj(rawProfile?.fact_sheet)?.business?.raw_name) || str(rawProfile?.business_name);
  if (kit?.wordmark && raw && raw !== facts.name) {
    kit = { ...kit, wordmark: { ...wordmarkFor({ ...(rawProfile || {}), business_name: facts.name }), icon: kit.wordmark.icon } };
  }
  const at = hash => (base ? `${base}${hash}` : hash);
  const services = nav.services && nav.services.startsWith("#") ? at(nav.services) : nav.services;
  const pages = list(nav.servicePages);
  const links = [
    services && pages.length ? servicesDropdown(services, pages, nav.current) : services ? `<a href="${esc(services)}">Services</a>` : "",
    nav.work ? `<a href="${esc(at("#work"))}">Our work</a>` : "",
    nav.reviews ? `<a href="${esc(at("#reviews"))}">Reviews</a>` : "",
    nav.area ? `<a href="${esc(at("#area"))}">Area</a>` : "",
    `<a href="#contact">Contact</a>`,
  ].filter(Boolean).join("");
  return `<header class="v3-header" id="contactStrip">
  <div class="v3-wrap v3-header__in">
    <a class="v3-brand" href="${esc(base || "#top")}">${brandMark(p, kit, ctx.slug)}</a>
    <nav class="v3-nav" aria-label="Main">${links}</nav>
    <a class="v3-btn v3-btn--cta v3-header__cta" href="#contact" data-contact="quote">${esc(estimateLabelV3(facts))}</a>
  </div>
</header>${services && pages.length ? NAV_DROP_SCRIPT : ""}`;
}

/** The business's service pages, in card order: [{ name, slug, url }]. */
export function servicePagesFor(facts, ctx = {}) {
  if (!facts.services.length || !list(ctx.spotlights).length) return [];
  const { services } = linkServicesToSpotlights(facts.services.map(s => ({ ...s, service_name: s.name })), list(ctx.spotlights), ctx.slug);
  return services.filter(s => s.spotlight_url).map(s => ({ name: s.name, slug: s.slug, url: s.spotlight_url }));
}

/**
 * "Services" stays a link to the section. Beside it, a button opens the list
 * of service pages: on hover or keyboard focus with a mouse, on tap on a
 * phone (NAV_DROP_SCRIPT). The page being viewed is marked.
 */
function servicesDropdown(href, pages, current) {
  const items = pages.map(pg => {
    const here = current && pg.slug === current;
    return `<li><a href="${esc(pg.url)}" data-spotlight-link="${esc(pg.slug)}" data-spotlight-from="nav"${here ? ' aria-current="page"' : ""}>${esc(pg.name)}</a></li>`;
  }).join("");
  return `<div class="v3-navdrop" data-navdrop>
      <a href="${esc(href)}">Services</a>
      <button type="button" class="v3-navdrop__btn" aria-expanded="false" aria-controls="v3NavDrop" aria-label="Service pages"><svg viewBox="0 0 12 8" width="12" height="8" aria-hidden="true"><path d="M1 1.5l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <ul class="v3-navdrop__menu" id="v3NavDrop"><li><a href="${esc(href)}">All services</a></li>${items}</ul>
    </div>`;
}

// Tap/keyboard toggle for the Services dropdown (hover is CSS). Closes on
// Esc, on a click outside, and after choosing a link.
const NAV_DROP_SCRIPT = `<script>(function(){var d=document.querySelector("[data-navdrop]");if(!d)return;var b=d.querySelector(".v3-navdrop__btn");function set(o){d.classList.toggle("is-open",o);if(o)d.classList.remove("is-dismissed");b.setAttribute("aria-expanded",o?"true":"false")}b.addEventListener("click",function(e){e.preventDefault();set(!d.classList.contains("is-open"))});document.addEventListener("click",function(e){if(!d.contains(e.target))set(false)});d.addEventListener("keydown",function(e){if(e.key==="Escape"){set(false);d.classList.add("is-dismissed");b.focus()}});d.addEventListener("focusout",function(e){if(!d.contains(e.relatedTarget))d.classList.remove("is-dismissed")});d.addEventListener("mouseleave",function(){d.classList.remove("is-dismissed")});d.querySelectorAll(".v3-navdrop__menu a").forEach(function(a){a.addEventListener("click",function(){set(false)})})})();</script>`;

/** The review the hero card uses: one marked hero, else the strongest short one. */
export function heroReview(reviews) {
  if (!reviews.length) return null;
  // Never the same review as the pull quote further down.
  const pull = pullQuote(reviews);
  const pool = reviews.filter(r => r !== pull);
  return [...(pool.length ? pool : reviews)].sort((a, b) => (b.strength - a.strength) || (a.quote.length - b.quote.length))[0];
}

/** The review the hero actually shows: none when the hero holds the form. */
export function heroReviewShown(facts) {
  return heroMode(facts) === "form" ? null : heroReview(facts.reviews);
}

/** "Russ B., Google review" / "Julie S." */
function reviewWho(r, facts) {
  return `${r.author}${facts.google.place_id || facts.google.count ? ", Google review" : ""}`;
}

export function reviewCard(r, facts, cls) {
  const n = r.rating ? Math.min(5, Math.max(1, Math.round(r.rating))) : 0;
  return `<figure class="${cls}">
    ${n ? STARS(n) : ""}
    <blockquote><p>“${esc(r.quote.replace(/^["“]|["”]$/g, ""))}”</p></blockquote>
    <figcaption>${esc(reviewWho(r, facts))}</figcaption>
  </figure>`;
}

/** Which hero layout: "owner" (photo + card), "review" (card alone), "form" (no reviews). */
export function heroMode(facts) {
  if (facts.owner.photo_url && facts.reviews.length) return "owner";
  if (facts.reviews.length) return "review";
  if (facts.owner.photo_url) return "owner";
  return "form";
}

function heroBlock(facts, copy, ctx, kit = null) {
  const mode = heroMode(facts);
  const bg = mode === "owner" ? null : heroPhoto(facts, kit, ctx);
  const call = facts.phone
    ? `<a class="v3-btn v3-btn--cta v3-btn--lg" href="${esc(telHref(facts.phone))}" data-contact="call">${ICON_CALL}Call ${esc(facts.phone)}</a>`
    : "";
  const estimate = `<a class="v3-btn v3-btn--ghost v3-btn--lg" href="#contact" data-contact="quote">${esc(estimateLabelV3(facts))}</a>`;
  const review = heroReview(facts.reviews);
  let side = "";
  if (mode === "owner") {
    side = `<div class="v3-hero__side v3-hero__side--owner">
      <figure class="v3-hero__photo" data-v3-media>${img({ src: facts.owner.photo_url, alt: facts.owner.names.length ? `${facts.owner.names.join(" and ")} of ${facts.name}` : `The owner of ${facts.name}`, eager: true })}</figure>
      ${review ? reviewCard(review, facts, "v3-review v3-review--hero") : ""}
    </div>`;
  } else if (mode === "review") {
    side = `<div class="v3-hero__side">${reviewCard(review, facts, "v3-review v3-review--hero v3-review--big")}</div>`;
  } else {
    side = `<div class="v3-hero__side v3-hero__side--form" id="contact"><span id="quote"></span>
      <div class="v3-formcard"><h2 class="v3-formcard__h">${esc(estimateLabelV3(facts))}</h2>{{QUOTE_FORM}}</div>
    </div>`;
  }
  const bgHtml = bg
    ? `<div class="v3-hero__bg" data-v3-media aria-hidden="${bg.alt ? "false" : "true"}">${img({ src: bg.src, srcset: bg.srcset, sizes: "100vw", alt: bg.alt, eager: true })}${bg.credit}${bg.placeholder ? `<span class="v3-hero__ph">Sample photo</span>` : ""}</div>`
    : "";
  return `<section class="v3-hero${bg ? " has-photo" : ""}" aria-labelledby="heroHeadline">
  ${bgHtml}
  <div class="v3-wrap v3-hero__in v3-hero--${mode}">
    <div class="v3-hero__copy">
      ${copy.hero.eyebrow ? `<p class="v3-eyebrow">${esc(copy.hero.eyebrow)}</p>` : ""}
      <h1 id="heroHeadline" class="v3-h1">${esc(copy.hero.h1)}</h1>
      ${copy.hero.sub ? `<p class="v3-sub">${esc(copy.hero.sub)}</p>` : ""}
      ${copy.hero.person ? `<p class="v3-person">${esc(copy.hero.person)}</p>` : ""}
      <div class="v3-actions" id="primaryAction">${call}${mode === "form" ? "" : estimate}</div>
    </div>
    ${side}
  </div>
</section>`;
}

export function proofBlock(copy) {
  const items = copy.proof.slice(0, MAX_PROOF);
  if (items.length < 2) return "";
  return `<section class="v3-proof" aria-label="At a glance">
  <ul class="v3-wrap v3-proof__list v3-proof__list--n${items.length}">${items.map(x => `<li><span class="v3-proof__big">${esc(x.big)}</span><span class="v3-proof__small">${esc(x.small)}</span></li>`).join("")}</ul>
</section>`;
}

function servicesBlock(facts, copy, kit, ctx) {
  if (!facts.services.length) return "";
  const { services } = linkServicesToSpotlights(facts.services.map(s => ({ ...s, service_name: s.name })), list(ctx.spotlights), ctx.slug);
  const taken = ctx.taken || new Set();
  const label = estimateLabelV3(facts);
  // Photos on every card or on none: a grid where some cards have a photo
  // and some don't looks unfinished.
  let photos = services.map(s => servicePhoto(s, kit, ctx, taken));
  if (photos.some(ph => !ph)) photos = photos.map(() => null);
  const cards = services.map((s, i) => {
    const photo = photos[i];
    const line = str(copy.services.lines[s.slug]) || s.line;
    // A service with its own page: outlined in the page's accent, labeled,
    // and the whole card opens the page.
    const link = s.spotlight_url
      ? `<a class="v3-card__go v3-card__go--page" href="${esc(s.spotlight_url)}" data-spotlight-link="${esc(s.slug)}" data-spotlight-from="card" aria-label="Learn more about ${esc(s.name.toLowerCase())}">Learn more <span aria-hidden="true">→</span></a>`
      : s.cta === "call" && facts.phone
        ? `<a class="v3-card__go" href="${esc(telHref(facts.phone))}" data-contact="call">Call about ${esc(s.name.toLowerCase())} <span aria-hidden="true">→</span></a>`
        : `<a class="v3-card__go" href="#quote?service=${esc(s.slug)}" data-service-quote="${esc(s.slug)}">${esc(label)} <span aria-hidden="true">→</span></a>`;
    const page = !!s.spotlight_url;
    return `<li class="v3-card${photo ? "" : " is-noimg"}${page ? " is-page" : ""}">
      ${photo ? `<figure class="v3-card__media" data-v3-media>${img({ src: photo.src, srcset: photo.srcset, alt: photo.alt })}${photo.credit}</figure>` : ""}
      ${page ? `<span class="v3-card__tag">Full details</span>` : ""}
      <div class="v3-card__body">
        <h3 class="v3-card__h">${esc(s.name)}</h3>
        ${line ? `<p class="v3-card__p">${esc(line)}</p>` : ""}
        ${link}
      </div>
    </li>`;
  }).join("");
  return `<section class="v3-band v3-band--tint" id="services" aria-labelledby="servicesHeading">
  <div class="v3-wrap">
    <div class="v3-head"><h2 id="servicesHeading" class="v3-h2">${esc(copy.services.heading)}</h2>${copy.services.sub ? `<p class="v3-lede">${esc(copy.services.sub)}</p>` : ""}</div>
    <ul class="v3-cards v3-cards--n${Math.min(services.length, 6)}">${cards}</ul>
  </div>
</section>`;
}

function ownerBlock(facts, copy) {
  const o = copy.owner_section;
  if (!o) return "";
  const photo = facts.owner.photo_url;
  return `<section class="v3-band" id="owner" aria-labelledby="ownerHeading">
  <div class="v3-wrap v3-owner${photo ? " has-photo" : ""}">
    ${photo ? `<figure class="v3-owner__photo" data-v3-media>${img({ src: photo, alt: facts.owner.names.length ? facts.owner.names.join(" and ") : `The owner of ${facts.name}` })}</figure>` : ""}
    <div class="v3-owner__text">
      <h2 id="ownerHeading" class="v3-h2">${esc(o.heading)}</h2>
      ${o.body.map(b => `<p>${esc(b)}</p>`).join("")}
    </div>
  </div>
</section>`;
}

function workBlock(photos) {
  if (!photos.length) return "";
  return `<section class="v3-band v3-band--tint" id="work" aria-labelledby="workHeading">
  <div class="v3-wrap">
    <h2 id="workHeading" class="v3-h2">Recent work</h2>
    <ul class="v3-work">${photos.map(ph => `<li><figure data-v3-media>${img({ src: ph.src, alt: ph.alt })}<figcaption>${ph.job ? `<strong>${esc(ph.job)}</strong>` : ""}${ph.job && ph.town ? " · " : ""}${esc(ph.town)}</figcaption>${ph.credit}</figure></li>`).join("")}</ul>
  </div>
</section>`;
}

/** The pull quote: the strongest review, when there are 3 or more. */
export function pullQuote(reviews) {
  if (reviews.length < 3) return null;
  return [...reviews].sort((a, b) => (b.strength - a.strength) || (b.quote.length - a.quote.length))[0];
}

function reviewsBlock(facts, copy) {
  const g = facts.google;
  const showRating = g.rating && g.count;
  if (!facts.reviews.length && !showRating) return "";
  const maps = googleMapsUrl({ business_name: facts.name, google_place_id: g.place_id });
  const pull = pullQuote(facts.reviews);
  // The hero card's review isn't repeated in the grid below it.
  const hero = heroReviewShown(facts);
  const others = facts.reviews.filter(r => r !== pull && r !== hero);
  // Full rows of three on desktop: 4 cards left one alone on a second row.
  const rest = others.length > 3 ? others.slice(0, others.length - (others.length % 3)) : others;
  const n = showRating ? Math.round(g.rating) : 0;
  return `<section class="v3-band" id="reviews" aria-labelledby="reviewsHeading">
  <div class="v3-wrap">
    <div class="v3-head v3-head--split">
      <div>
        <h2 id="reviewsHeading" class="v3-h2">${esc(copy.reviews_heading)}</h2>
        ${showRating ? `<p class="v3-lede">${STARS(Math.min(5, Math.max(1, n)))} ${esc(g.rating.toFixed(1))} out of 5 from ${g.count} review${g.count === 1 ? "" : "s"} on Google</p>` : ""}
      </div>
      ${maps && showRating ? `<a class="v3-more" href="${esc(maps)}" target="_blank" rel="noopener">Read all ${g.count} on Google <span aria-hidden="true">→</span></a>` : ""}
    </div>
    ${pull ? reviewCard(pull, facts, "v3-review v3-review--pull") : ""}
    ${rest.length ? `<div class="v3-reviews">${rest.map(r => `<figure class="v3-review">
      ${r.rating ? STARS(Math.min(5, Math.max(1, Math.round(r.rating)))) : ""}
      <blockquote><p>“${esc(r.quote.replace(/^["“]|["”]$/g, ""))}”</p></blockquote>
      <figcaption>${esc(r.author)}${r.context ? ` · ${esc(r.context)}` : ""}</figcaption>
    </figure>`).join("")}</div>` : ""}
  </div>
</section>`;
}

// ── Map ──────────────────────────────────────────────────────────────────
// areaMapSvg (drawn from data/towns/<ST>.json) is kept for tests and the
// share image; the page itself shows the embedded Google map (mapEmbed).

/** [name, st, lat, lon] rows → the row for a town (same state first). */
export function findTown(coords, name, state) {
  const n = cleanTown(name).toLowerCase();
  if (!n) return null;
  const rows = (Array.isArray(coords) ? coords : []).filter(r => Array.isArray(r) && String(r[0]).toLowerCase() === n);
  return rows.find(r => r[1] === state) || rows[0] || null;
}

const MAP_W = 440, MAP_H = 280, PAD = 40;
const labelW = (t, size) => t.length * size * 0.56;

/**
 * The service-area map: home town marked, confirmed towns as labeled dots,
 * nearby towns faint ("for location only"). Returns "" without coordinates
 * for the home town.
 */
export function areaMapSvg(facts, coords, { name = "" } = {}) {
  const st = facts.address.state;
  const home = findTown(coords, facts.towns.home, st);
  if (!home) return "";
  const confirmed = facts.towns.confirmed.filter(t => !sameTown(t, facts.towns.home)).map(t => ({ t, r: findTown(coords, t, st) })).filter(x => x.r);
  const nearby = facts.towns.nearby.map(t => ({ t, r: findTown(coords, t, st) })).filter(x => x.r).slice(0, 8);
  const all = [home, ...confirmed.map(x => x.r), ...nearby.map(x => x.r)];
  const cos = Math.cos(home[2] * Math.PI / 180);
  const xs = all.map(r => r[3] * cos), ys = all.map(r => r[2]);
  let minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  // A lone town (or a tight cluster) still gets a ~10 mile frame.
  const minSpan = 0.15;
  if (maxX - minX < minSpan) { const c = (minX + maxX) / 2; minX = c - minSpan / 2; maxX = c + minSpan / 2; }
  if (maxY - minY < minSpan) { const c = (minY + maxY) / 2; minY = c - minSpan / 2; maxY = c + minSpan / 2; }
  const scale = Math.min((MAP_W - 2 * PAD - 80) / (maxX - minX), (MAP_H - 2 * PAD) / (maxY - minY));
  const ox = (MAP_W - (maxX - minX) * scale) / 2, oy = (MAP_H - (maxY - minY) * scale) / 2;
  const pt = r => [Math.round(ox + (r[3] * cos - minX) * scale), Math.round(oy + (maxY - r[2]) * scale)];

  const placed = [];
  const fits = box => box.x >= 2 && box.x + box.w <= MAP_W - 2 && box.y >= 2 && box.y + box.h <= MAP_H - 2
    && !placed.some(b => box.x < b.x + b.w && box.x + box.w > b.x && box.y < b.y + b.h && box.y + box.h > b.y);
  const label = (text, [x, y], size, cls, r) => {
    const w = labelW(text, size), h = size + 2;
    const tries = [[x + r + 4, y + size / 2 - 1, "start"], [x - r - 4 - w, y + size / 2 - 1, "end"], [x - w / 2, y - r - 4, "middle"], [x - w / 2, y + r + size + 2, "middle"]];
    for (const [tx, ty, anchor] of tries) {
      const bx = anchor === "start" ? tx : anchor === "end" ? tx : tx;
      const box = { x: bx, y: ty - size, w, h };
      if (!fits(box)) continue;
      placed.push(box);
      const ax = anchor === "start" ? tx : anchor === "end" ? tx + w : tx + w / 2;
      return `<text class="${cls}" x="${Math.round(ax)}" y="${Math.round(ty)}" text-anchor="${anchor}">${esc(text)}</text>`;
    }
    return "";
  };

  const hp = pt(home);
  placed.push({ x: hp[0] - 11, y: hp[1] - 11, w: 22, h: 22 });
  const homeLabel = label(cleanTown(facts.towns.home), hp, 17, "v3-map__home-label", 11);
  const conf = confirmed.map(x => { const p = pt(x.r); placed.push({ x: p[0] - 6, y: p[1] - 6, w: 12, h: 12 }); return { x, p }; })
    .map(({ x, p }) => `<circle class="v3-map__dot" cx="${p[0]}" cy="${p[1]}" r="6"></circle>${label(x.t, p, 15, "v3-map__label", 6)}`).join("");
  const near = nearby.map(x => { const p = pt(x.r); return `<circle class="v3-map__faint" cx="${p[0]}" cy="${p[1]}" r="3.5"></circle>${label(x.t, p, 14, "v3-map__faint-label", 4)}`; }).join("");
  const title = `Map of ${cleanTown(facts.towns.home)}${confirmed.length ? ` and the towns ${name || "we"} serve` : ""}`;
  return `<svg class="v3-map" viewBox="0 0 ${MAP_W} ${MAP_H}" width="100%" role="img" aria-label="${esc(title)}">
    <rect class="v3-map__bg" x="0" y="0" width="${MAP_W}" height="${MAP_H}" rx="10"></rect>
    ${near}${conf}
    <circle class="v3-map__home" cx="${hp[0]}" cy="${hp[1]}" r="10"></circle>${homeLabel}
  </svg>`;
}

// Google Maps Embed API: free, no usage limits (developers.google.com/maps/
// documentation/embed/usage-and-billing). Same browser key as the v1 page
// (public/scripts/profile.js); GOOGLE_MAPS_EMBED_KEY overrides it.
export const MAPS_EMBED_KEY = process.env.GOOGLE_MAPS_EMBED_KEY || "AIzaSyD2DZjVEIuq6luIvl-lVeOaxqd3BG2V7IA";

/** The embedded Google map for the area section: the listing pin when we have a place id, else the town. "" with neither. */
export function mapEmbed(facts) {
  const pid = facts.google.place_id;
  const town = [facts.towns.home || facts.address.town, facts.address.state].filter(Boolean).join(", ");
  const addr = [facts.address.street, town].filter(Boolean).join(", ");
  const q = pid ? `place_id:${pid}` : (addr || town);
  if (!q) return "";
  const zoom = pid ? "" : `&zoom=${facts.towns.confirmed.length > 3 ? 10 : 11}`;
  const src = `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(MAPS_EMBED_KEY)}&q=${encodeURIComponent(q)}${zoom}`;
  return `<iframe class="v3-gmap" src="${esc(src)}" title="Map of ${esc(facts.name || town)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe>`;
}

function areaBlock(facts, ctx) {
  const chips = facts.towns.confirmed.length ? facts.towns.confirmed : facts.towns.home ? [facts.towns.home] : [];
  if (!chips.length) return "";
  const map = mapEmbed(facts);
  const hasNearby = false;
  const base = [facts.address.street, facts.towns.home || facts.address.town].filter(Boolean).join(" in ");
  const text = facts.texts_ok
    ? ` Live in a nearby town? <a href="${esc(smsHref(facts.phone))}" data-contact="sms">Text us your town</a> and we'll tell you if we can get there.`
    : facts.phone ? ` Live in a nearby town? <a href="${esc(telHref(facts.phone))}" data-contact="call">Call us</a> and we'll tell you if we can get there.` : "";
  return `<section class="v3-band v3-band--tint" id="area" aria-labelledby="areaHeading">
  <div class="v3-wrap v3-area${map ? " has-map" : ""}">
    <div class="v3-area__text">
      <h2 id="areaHeading" class="v3-h2">Where we work</h2>
      <p>${base ? `Based ${facts.address.street ? "on" : "in"} ${esc(base)}.` : ""}${text}</p>
      <ul class="v3-chips">${chips.map(t => `<li>${esc(t)}</li>`).join("")}</ul>
    </div>
    ${map ? `<figure class="v3-area__map v3-area__map--g">${map}${hasNearby ? `<figcaption>Gray towns are shown for location only.</figcaption>` : ""}</figure>` : ""}
  </div>
</section>`;
}

function faqBlock(copy) {
  if (!copy.faqs.length) return "";
  return `<section class="v3-band" id="faqs" aria-labelledby="faqHeading">
  <div class="v3-wrap">
    <div class="v3-head"><h2 id="faqHeading" class="v3-h2">Common questions</h2></div>
    <div class="v3-faqs">${copy.faqs.map((f, i) => `<details class="v3-faq"${i === 0 ? " open" : ""}><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join("")}</div>
  </div>
</section>`;
}

export function closingBlock(facts, copy, formInHero) {
  const call = facts.phone
    ? `<a class="v3-btn v3-btn--cta v3-btn--lg" href="${esc(telHref(facts.phone))}" data-contact="call">${ICON_CALL}Call ${esc(facts.phone)}</a>`
    : "";
  const form = formInHero
    ? ""
    : `<div class="v3-formcard" id="contact"><span id="quote"></span><h3 class="v3-formcard__h" id="quoteHeading">${esc(estimateLabelV3(facts))}</h3>{{QUOTE_FORM}}</div>`;
  return `<section class="v3-closing" id="${formInHero ? "closing" : "closingAsk"}" aria-labelledby="closingHeading">
  <div class="v3-wrap v3-closing__in${formInHero ? " is-noform" : ""}">
    <div class="v3-closing__text">
      <h2 id="closingHeading" class="v3-h2 v3-h2--light">${esc(copy.closing.heading)}</h2>
      ${copy.closing.line ? `<p>${esc(copy.closing.line)}</p>` : ""}
      ${formInHero ? `<div class="v3-actions">${call}<a class="v3-btn v3-btn--ghost v3-btn--lg" href="#contact" data-contact="quote">${esc(estimateLabelV3(facts))}</a></div>` : ""}
    </div>
    ${form}
  </div>
</section>`;
}

function licenseText(lic) {
  if (!lic?.number) return "";
  return `${[lic.state, lic.kind || "License"].filter(Boolean).join(" ")} #${str(lic.number).replace(/^#/, "")}`;
}

export function footerBlock(facts, ctx) {
  const addr = [facts.address.street, [facts.address.town, [facts.address.state, facts.address.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")].filter(Boolean).join(", ");
  const lic = licenseText(facts.license);
  const { services } = linkServicesToSpotlights(facts.services.map(s => ({ ...s, service_name: s.name })), list(ctx.spotlights), ctx.slug);
  const towns = facts.towns.confirmed.length ? facts.towns.confirmed : facts.towns.home ? [facts.towns.home] : [];
  return `<footer class="v3-footer" id="siteFooter">
  <div class="v3-wrap v3-footer__in">
    <div class="v3-footer__col">
      <p class="v3-footer__h">${esc(facts.name)}</p>
      ${addr ? `<p>${esc(addr)}</p>` : ""}
      ${facts.phone ? `<p><a class="v3-footer__phone" href="${esc(telHref(facts.phone))}" data-contact="call">${esc(facts.phone)}</a></p>` : ""}
      ${lic ? `<p>${esc(lic)}${facts.license.verify_url ? ` · <a href="${esc(facts.license.verify_url)}" target="_blank" rel="noopener">Verify</a>` : ""}</p>` : ""}
    </div>
    ${str(facts.hours?.text) ? `<div class="v3-footer__col"><p class="v3-footer__h">Hours</p><p>${esc(facts.hours.text)}</p></div>` : ""}
    ${services.length ? `<div class="v3-footer__col"><p class="v3-footer__h">Services</p><ul>${services.map(s => `<li><a href="${esc(s.spotlight_url || `${ctx.base || ""}#services`)}">${esc(s.name)}</a></li>`).join("")}</ul></div>` : ""}
    ${towns.length ? `<div class="v3-footer__col"><p class="v3-footer__h">Area</p><ul>${towns.map(t => `<li>${esc(t)}${facts.address.state ? `, ${esc(facts.address.state)}` : ""}</li>`).join("")}</ul></div>` : ""}
  </div>
  <div class="v3-wrap"><p class="v3-footer__by"><a href="https://enoma.io" target="_blank" rel="noopener">Website by Enoma</a></p></div>
</footer>`;
}

// ── Schema ────────────────────────────────────────────────────────────────

const DAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * LocalBusiness JSON-LD for v3: name, address, phone, hours, areaServed
 * (confirmed towns only). No aggregateRating (Google ratings are another
 * site's reviews; see the note in the object).
 */
export function localBusinessSchemaV3(facts, { canonical, image, rawProfile = {} } = {}) {
  const spec = list(facts.hours?.spec).filter(x => x.days?.length && /^\d\d:\d\d$/.test(str(x.opens)) && /^\d\d:\d\d$/.test(str(x.closes)));
  const hoursSpec = spec.length
    ? spec.map(x => ({ "@type": "OpeningHoursSpecification", dayOfWeek: x.days.filter(d => d >= 0 && d <= 6).map(d => `https://schema.org/${DAY[d]}`), opens: x.opens, closes: x.closes }))
    : undefined;
  const a = facts.address;
  const schema = {
    "@context": "https://schema.org",
    "@type": schemaTypeFor(rawProfile.primary_category),
    "@id": canonical,
    name: facts.name || undefined,
    url: canonical,
    telephone: facts.phone || undefined,
    image: image || undefined,
    address: (a.street || a.town || a.state) ? {
      "@type": "PostalAddress",
      ...(a.street ? { streetAddress: a.street } : {}),
      ...(a.town ? { addressLocality: a.town } : {}),
      ...(a.state ? { addressRegion: a.state } : {}),
      ...(a.zip ? { postalCode: a.zip } : {}),
      addressCountry: "US",
    } : undefined,
    openingHoursSpecification: hoursSpec,
    areaServed: facts.towns.confirmed.length ? facts.towns.confirmed.map(name => ({ "@type": "City", name: a.state ? `${name}, ${a.state}` : name })) : undefined,
    // No aggregateRating: Google's review-snippet rules say not to aggregate
    // ratings from other sites, and LocalBusiness pages can't earn stars anyway.
    sameAs: sameAsLinks({ ...rawProfile, google_place_id: facts.google.place_id, business_name: facts.name }),
  };
  if (!schema.sameAs.length) delete schema.sameAs;
  return JSON.parse(JSON.stringify(schema));
}

// ── Assembly ──────────────────────────────────────────────────────────────

/**
 * Which sections render (exported for tests and the menu).
 * Returns the facts/copy too so callers don't normalize twice.
 */
export function v3Plan(rawProfile, kit, ctx = {}) {
  const facts = factsFor(rawProfile, kit);
  const copy = copyFor(rawProfile, facts);
  const c = { ...ctx, name: facts.name, businessId: rawProfile?.business_id || "", googleOk: googlePhotosAllowed(rawProfile, ctx),
    persona: facts.trade, claimed: rawProfile?.is_claimed === true, taken: new Set() };
  const work = recentWork(facts, kit, c);
  return {
    facts, copy, ctx: c, work,
    nav: {
      // Services always scrolls to the section; service pages, when a
      // business has them, open from a dropdown beside it (servicePagesFor).
      services: facts.services.length ? "#services" : null,
      servicePages: servicePagesFor(facts, ctx),
      work: work.length > 0,
      reviews: facts.reviews.length > 0 || !!(facts.google.rating && facts.google.count),
      area: facts.towns.confirmed.length > 0 || !!facts.towns.home,
    },
    heroMode: heroMode(facts),
  };
}

/**
 * All template replacements for a v3 page.
 * ctx: { slug, spotlights, quoteStatus, owner, token, m, utm, jackPhone,
 *        launchKit, townCoords, stockRows, stockUsage, now }
 */
export function renderBlocksV3(rawProfile, kit, ctx = {}) {
  const slug = ctx.slug || rawProfile?.username || "";
  const plan = v3Plan(rawProfile, kit, { ...ctx, slug });
  const { facts, copy, nav } = plan;
  const c = plan.ctx;
  const formInHero = plan.heroMode === "form";
  const p = { ...normalizeProfile(rawProfile || {}), business_name: facts.name };
  const bar = ctx.owner && ctx.token ? ownerBar(p, kit, { ...c, hasPhotos: plan.work.length > 0 }) : "";
  const quoteProfile = {
    ...rawProfile, business_name: facts.name, phone: facts.phone,
    services: facts.services.map(s => ({ service_name: s.name })),
    service_area: facts.towns.confirmed.length ? facts.towns.confirmed : rawProfile?.service_area,
  };
  return {
    "{{BLOCK_TOPBAR}}": bar + topBar(facts, c),
    "{{BLOCK_HEADER}}": headerBlock(rawProfile, facts, kit, c, nav),
    "{{BLOCK_HERO}}": heroBlock(facts, copy, c, kit),
    "{{BLOCK_PROOF}}": proofBlock(copy),
    "{{BLOCK_TRUST}}": "",
    "{{BLOCK_SERVICES}}": servicesBlock(facts, copy, kit, c),
    "{{BLOCK_HOW}}": "",
    "{{BLOCK_WORK}}": workBlock(plan.work),
    "{{BLOCK_REVIEWS}}": reviewsBlock(facts, copy),
    "{{BLOCK_OWNER}}": ownerBlock(facts, copy),
    "{{BLOCK_ABOUT}}": "",
    "{{BLOCK_AREAS}}": areaBlock(facts, c),
    "{{BLOCK_FAQ}}": faqBlock(copy),
    "{{BLOCK_RESOURCES}}": "",
    "{{BLOCK_CLOSING}}": closingBlock(facts, copy, formInHero),
    "{{SSR_QUOTE_HEADING}}": "",
    "{{BLOCK_FOOTER}}": footerBlock(facts, c),
    "{{BLOCK_MOBILE_BAR}}": mobileBar({ phone: facts.phone }),
    // Last: business text above is never re-read as a placeholder after it.
    "{{QUOTE_FORM}}": renderQuoteForm(quoteProfile, { returnPath: `/${slug}`, status: ctx.quoteStatus || "", trackContactClick: true, submitLabel: estimateLabelV3(facts) }),
  };
}

/** Extra <head> lines for v3: Archivo 800/900, Inter up to 700, share image size, scheme color. */
export function v3Head(kit) {
  return `  <link href="https://fonts.googleapis.com/css2?family=Archivo:wght@700;800;900&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="theme-color" content="${esc(kit.colors.identity)}" />`;
}

/** Everything renderCompanyPage needs for a v3 page besides <head> text. */
export function v3PageParts(rawProfile, kit, ctx = {}) {
  const facts = factsFor(rawProfile, kit);
  const copy = copyFor(rawProfile, facts);
  return {
    seo: v3Seo(facts, copy),
    blocks: renderBlocksV3(rawProfile, kit, ctx),
    schema: localBusinessSchemaV3(facts, { canonical: ctx.canonical, image: ctx.image, rawProfile }),
    faqs: copy.faqs,
    style: kitStyle(kit),
    head: v3Head(kit),
  };
}

// ── Title and description ─────────────────────────────────────────────────

// Google's type → the trade word for titles. The persona's own word
// ("Contracting") only when Google's type is generic.
const TYPE_WORD = [
  [/roof/i, "Roofing"], [/paving|asphalt|sealcoat/i, "Paving"], [/plumb/i, "Plumbing"], [/electric/i, "Electrical"],
  [/hvac|heating|air condition/i, "Heating & cooling"], [/paint/i, "Painting"], [/lawn/i, "Lawn care"],
  [/landscap/i, "Landscaping"], [/pressure wash|power wash/i, "Pressure washing"], [/house clean|maid/i, "House cleaning"],
  [/clean/i, "Cleaning"], [/snow/i, "Snow removal"], [/tree/i, "Tree service"], [/fenc/i, "Fencing"],
  [/masonry|mason|concrete/i, "Masonry"], [/handyman/i, "Handyman"], [/general contractor/i, "General contracting"],
];
const PERSONA_WORD = { landscaping: "Landscaping", plumbing: "Plumbing", hvac: "Heating & cooling", electrical: "Electrical", cleaning: "Cleaning", painting: "Painting", snow: "Snow removal", contractor: "Contracting" };

export function tradeWordFor(primaryType, persona) {
  const t = str(primaryType);
  const hit = t && !/^(services?|contractors?|establishment|point of interest|business)$/i.test(t) ? TYPE_WORD.find(([re]) => re.test(t)) : null;
  return hit ? hit[1] : (PERSONA_WORD[persona] || "Local service");
}

/** { title, description } for a v3 home page, built from facts (not the old generator's seo_title). */
export function v3Seo(facts, copy) {
  const word = tradeWordFor(facts.primary_type, facts.trade);
  const town = facts.towns.home || facts.address.town;
  const place = [town, facts.address.state].filter(Boolean).join(", ");
  const title = `${facts.name}${place ? ` — ${word} in ${place}` : ` — ${word}`}`.slice(0, 70);
  const h1 = str(copy?.hero?.h1).replace(/[.!?]+$/, "");
  const parts = [
    h1 ? `${h1}.` : "",
    place ? `${word} in ${place}.` : "",
    facts.google.rating && facts.google.count ? `${facts.google.rating.toFixed(1)}★ from ${facts.google.count} Google reviews.` : "",
    facts.phone ? `Call ${facts.phone}.` : "",
  ].filter(Boolean);
  let description = parts.join(" ");
  while (description.length > 155 && parts.length > 1) { parts.splice(parts.length > 2 ? 2 : 1, 1); description = parts.join(" "); }
  return { title, description: description.slice(0, 155) };
}

// ── Outreach readiness ────────────────────────────────────────────────────
// A cold email shows a business its own page, so the page has to be good
// enough to sell. A page below this floor still exists (and can be improved
// by the owner), but no outreach goes out with it. Pure; reads stored rows.

export const READY_MIN_REVIEWS = 3;   // Google review count behind the page
export const READY_MIN_SERVICES = 2;  // evidence-backed services

/** { ok, reasons: [] } for a page about to be emailed. */
export function outreachReadiness(rawProfile, kit = null) {
  const reasons = [];
  if (Number(rawProfile?.page_version) !== 3) reasons.push("not_v3");
  const c = obj(rawProfile?.page_copy_v3);
  if (!c || !str(c.hero_headline)) { reasons.push("no_v3_copy"); return { ok: false, reasons }; }
  if (rawProfile?.is_public === false) reasons.push("not_public");
  const facts = factsFor(rawProfile, kit);
  const copy = copyFor(rawProfile, facts);
  if (!facts.phone) reasons.push("no_phone");
  if (!(facts.google.count >= READY_MIN_REVIEWS)) reasons.push("few_reviews");
  if (facts.reviews.length < 2) reasons.push("few_review_quotes");
  if (facts.services.length < READY_MIN_SERVICES) reasons.push("few_services");
  if (facts.services.some(s => !str(s.line))) reasons.push("empty_service_card");
  if (copy.proof.length < 2) reasons.push("thin_proof");
  if (!str(copy.hero.sub)) reasons.push("no_hero_sub");
  return { ok: reasons.length === 0, reasons };
}

// PAGE_V3_DAILY_MAX: new v3 builds a day. Unset/invalid -> 15; 0 pauses builds.
export function dailyV3Max(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : 15;
}
