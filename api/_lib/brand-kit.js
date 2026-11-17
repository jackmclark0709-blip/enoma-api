// api/_lib/brand-kit.js
// The brand kit: everything page v2 needs to look like it was made for one
// business. Stored as small_business_profiles.brand_kit (jsonb), rebuilt when
// a preview is generated and whenever a logo or photo is added.
//
//   { version, built_at,
//     logo: { url, source, quality: "usable" | "badge_only" | "none", reason, width, height, analysis },
//     colors: { identity, accent, cta, ctaText, source: "logo" | "persona" },
//     wordmark: { line1, line2, icon },
//     badges: [ "american_owned" | "veteran_owned" | "family_owned" | "woman_owned" | "since_<year>" ],
//     owner_names: [ "Rick", "Patrick" ],
//     specialty: "Cathedral & high ceilings" | null,
//     license: { number, state, verify_url } | null,
//     towns: { confirmed: [...], suggested: [...] },
//     hero: { kind: "work_photo" | "stock" | "scene", ref },
//     years: "20+" | "12" | null, insured: bool, google_photos: [...] }
//
// The top half of this file is pure (no network, no DB) and unit-tested in
// tests/brand-kit.test.js. The bottom half is a thin I/O layer (fetch the
// logo candidates, sharp for size + colors, one cached gpt-4o vision call per
// image, Places photos) with every dependency injectable.
//
// The rule for every field: it comes from something the business itself
// shows (its logo, its listing, its own page facts) or it is empty. A badge,
// a name, a license, a specialty is never invented to fill a slot.

import {
  personaFor, pickPalette, hexToRgb, rgbToHex, rgbToHsl, contrastRatio, relativeLuminance,
  ctaFor, splitWordmark,
} from "./page-style.js";
import { tradeIconFor, logoName } from "./starter-logo.js";
import { heroPhoto as ownerHeroPhoto, isImageUrl } from "./photo-kinds.js";
import { US_STATE_NAMES, US_STATE_ABBR } from "./service-utils.js";

export const KIT_VERSION = 1;
export const CHARCOAL = "#17181c";
export const INK = "#1a1714";
export const WHITE = "#ffffff";
export const MIN_TEXT_CONTRAST = 4.5;
export const BADGE_IDS = ["american_owned", "veteran_owned", "family_owned", "woman_owned"];
export const SUGGEST_RADIUS_MILES = 12;
export const MAX_SUGGESTED_TOWNS = 6;
export const MIN_USABLE_LOGO_PX = 300;

const STATE_CODES = Object.fromEntries(US_STATE_NAMES.map((n, i) => [n, US_STATE_ABBR[i].toUpperCase()]));
export function stateCode(s) {
  const v = String(s || "").trim();
  if (/^[A-Za-z]{2}$/.test(v)) return v.toUpperCase();
  return STATE_CODES[v.toLowerCase()] || "";
}
const list = v => {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") { try { const j = JSON.parse(v); return Array.isArray(j) ? j : []; } catch { return []; } }
  return [];
};
const uniq = arr => [...new Set(arr)];

// ── Colors ────────────────────────────────────────────────────────────────

/**
 * The 3–4 dominant colors of a logo from raw RGBA pixels (sharp, 64x64):
 * transparent, near-white, near-black and grey pixels skipped, the rest
 * bucketed, similar buckets merged. darkShare = share of opaque pixels that
 * are near-black (a black/gold logo is black, even though black is skipped).
 */
export function paletteFromPixels(data, { max = 4 } = {}) {
  const counts = new Map();
  let opaque = 0, dark = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    if (a < 200) continue;
    opaque++;
    const hi = Math.max(r, g, b), lo = Math.min(r, g, b);
    if (hi < 45) { dark++; continue; }                         // near-black
    if (lo > 225) continue;                                     // near-white
    const { s, l } = rgbToHsl([r, g, b]);
    if (s < 0.22 || hi - lo < 32 || l > 0.92) continue;         // grey / washed out
    const key = [r, g, b].map(v => Math.min(255, Math.round(v / 24) * 24)).join(",");
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const buckets = [...counts].map(([k, n]) => ({ rgb: k.split(",").map(Number), n })).sort((a, b) => b.n - a.n);
  const merged = [];
  for (const b of buckets) {
    const near = merged.find(m => Math.hypot(m.rgb[0] - b.rgb[0], m.rgb[1] - b.rgb[1], m.rgb[2] - b.rgb[2]) < 70);
    if (near) near.n += b.n; else merged.push({ ...b });
  }
  merged.sort((a, b) => b.n - a.n);
  const colors = merged
    .filter(m => opaque && m.n / opaque >= 0.01)
    .slice(0, max)
    .map(m => ({ hex: rgbToHex(m.rgb), share: Math.round((m.n / opaque) * 1000) / 1000 }));
  return { colors, darkShare: opaque ? Math.round((dark / opaque) * 1000) / 1000 : 0, opaque };
}

/** Darken until white text on it reads at `min`:1 (the hero background). */
export function darkenForWhite(hex, min = MIN_TEXT_CONTRAST) {
  let rgb = hexToRgb(hex);
  if (!rgb) return null;
  for (let i = 0; i < 60 && contrastRatio(rgbToHex(rgb), WHITE) < min; i++) rgb = rgb.map(v => v * 0.92);
  return rgbToHex(rgb);
}

/** Mix toward white by `f` (0..1). */
export function tint(hex, f = 0.5) {
  const rgb = hexToRgb(hex);
  return rgb ? rgbToHex(rgb.map(v => v + (255 - v) * f)) : hex;
}

/** White or ink, whichever reads better on `hex`. */
export function textOn(hex) {
  return contrastRatio(hex, WHITE) >= contrastRatio(hex, INK) ? WHITE : INK;
}

function hueDistance(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Can a logo color be the call-to-action color against this identity?
 * The existing CTA rules: text on it reads at 4.5:1, it differs clearly from
 * the identity in lightness (and isn't the identity's own hue), and the
 * button stands out on the identity-colored hero (3:1, non-text contrast).
 */
export function ctaCandidateOk(hex, identity) {
  const rgb = hexToRgb(hex), id = hexToRgb(identity);
  if (!rgb || !id) return false;
  const text = textOn(hex);
  if (contrastRatio(hex, text) < MIN_TEXT_CONTRAST) return false;
  const a = rgbToHsl(rgb), b = rgbToHsl(id);
  if (Math.abs(a.l - b.l) < 0.25) return false;
  if (b.s > 0.15 && hueDistance(a.h, b.h) < 30) return false;
  return contrastRatio(hex, identity) >= 3;
}

/**
 * The kit's colors from a logo palette (paletteFromPixels) or, with no
 * usable logo colors, today's persona palette.
 *   identity  hero background (white text on it at 4.5:1+)
 *   accent    small accents (rules, icons, chips)
 *   cta/ctaText  filled call buttons only
 */
export function kitColors(logoPalette, profile = {}) {
  const pal = pickPalette(profile.primary_category, profile.business_name);
  const colors = (logoPalette?.colors || []).filter(c => hexToRgb(c.hex));
  if (!colors.length) {
    const identity = darkenForWhite(pal.primary);
    return { identity, accent: pal.light, cta: pal.cta, ctaText: pal.ctaText, source: "persona" };
  }
  const top = colors[0].hex;
  // A light brand color on lots of black (black & gold) reads as black.
  const blackBrand = (logoPalette.darkShare || 0) >= 0.2 && relativeLuminance(hexToRgb(top)) > 0.3;
  const identity = blackBrand ? CHARCOAL : darkenForWhite(top);
  const idHsl = rgbToHsl(hexToRgb(identity));
  const others = blackBrand ? colors : colors.slice(1);
  const accentSrc = others.find(c => hueDistance(rgbToHsl(hexToRgb(c.hex)).h, idHsl.h) >= 30);
  // One-color logo: a light tint of the identity, so accents still show.
  const accent = accentSrc ? accentSrc.hex : tint(identity, 0.55);
  const logoCta = (blackBrand ? colors : colors.slice(1)).map(c => c.hex).find(h => ctaCandidateOk(h, identity));
  if (logoCta) return { identity, accent, cta: logoCta, ctaText: textOn(logoCta), source: "logo" };
  const fallback = ctaFor(identity);
  return { identity, accent, cta: fallback.cta, ctaText: fallback.ctaText, source: "logo" };
}

// ── Logo quality ──────────────────────────────────────────────────────────

/**
 * usable: may render large. badge_only: a cartoon character or mascot, under
 * 300px, or busy/low-res; only ever a small round badge. none: no logo.
 */
export function logoQuality({ url, width, height, analysis } = {}) {
  if (!url) return { quality: "none", reason: "no_logo" };
  const reasons = [];
  if (analysis?.has_character_or_mascot) reasons.push("mascot");
  if (Number.isFinite(width) && Number.isFinite(height) && Math.min(width, height) < MIN_USABLE_LOGO_PX) reasons.push("under_300px");
  if (analysis?.is_busy_or_low_res) reasons.push("busy_or_low_res");
  return reasons.length ? { quality: "badge_only", reason: reasons.join(",") } : { quality: "usable", reason: "ok" };
}

// ── Facts from text ───────────────────────────────────────────────────────

/** Everything the page already says about the business, as one string. */
export function factText(p = {}) {
  const parts = [p.hero_tagline, p.hero_headline, p.about, p.services_intro, p.owner_blurb];
  parts.push(...list(p.trust_badges));
  const why = p.why_choose_us;
  if (Array.isArray(why)) parts.push(...why.map(w => (typeof w === "string" ? w : [w?.title, w?.description].join(" "))));
  else if (typeof why === "string") parts.push(why);
  for (const f of list(p.faqs)) parts.push(f?.q || f?.question, f?.a || f?.answer);
  for (const s of list(p.services)) parts.push(s?.service_name || s?.name, s?.service_description || s?.description);
  return parts.filter(v => typeof v === "string" && v.trim()).join("\n");
}

const BADGE_RULES = [
  ["american_owned", /\bamerican[\s-]+owned\b/i],
  ["veteran_owned", /\bveteran[\s-]+owned\b|\bowned (and|&) operated by (a )?veterans?\b/i],
  ["family_owned", /\bfamily[\s-]+owned\b|\bfamily[\s-]+run\b/i],
  ["woman_owned", /\bwom[ae]n[\s-]+owned\b|\bfemale[\s-]+owned\b/i],
];

/**
 * Whitelisted badges only, and only when the text actually says them
 * (logo text lines, then the business's own badges and copy). Never inferred.
 */
export function badgesFrom(texts = []) {
  const t = texts.filter(Boolean).join("\n");
  const out = BADGE_RULES.filter(([, re]) => re.test(t)).map(([id]) => id);
  const since = t.match(/\b(?:since|est\.?|established)\s*(?:in\s*)?((?:19|20)\d\d)\b/i);
  const year = since ? Number(since[1]) : 0;
  if (year >= 1900 && year <= new Date().getFullYear()) out.push(`since_${year}`);
  return out;
}

export function isValidBadge(id) {
  return BADGE_IDS.includes(id) || /^since_(19|20)\d\d$/.test(String(id || ""));
}

export function badgeLabel(id) {
  if (id === "american_owned") return "American Owned & Operated";
  if (id === "veteran_owned") return "Veteran Owned";
  if (id === "family_owned") return "Family Owned";
  if (id === "woman_owned") return "Woman Owned";
  const m = String(id || "").match(/^since_(\d{4})$/);
  return m ? `Since ${m[1]}` : "";
}

const NOT_NAMES = new Set(("us me you today now our your we the a an for free call text email ask talk get " +
  "monday tuesday wednesday thursday friday saturday sunday january february march april may june july august " +
  "september october november december google facebook yes no estimate estimates quote quotes jack enoma " +
  "inc llc company team crew owner owners").split(" "));

/** First names of the people a customer talks to, at most two, never invented. */
export function ownerNamesFrom(p = {}, analysis = null) {
  const banned = new Set([
    ...String(p.business_name || "").toLowerCase().split(/\W+/),
    ...String(p.city || "").toLowerCase().split(/\W+/),
  ]);
  const ok = n => n && /^[A-Z][a-z]{1,14}$/.test(n) && !NOT_NAMES.has(n.toLowerCase()) && !banned.has(n.toLowerCase());
  const found = [];
  for (const n of list(analysis?.owner_names)) {
    const first = String(n || "").trim().split(/\s+/)[0];
    const name = first ? first[0].toUpperCase() + first.slice(1).toLowerCase() : "";
    if (ok(name)) found.push(name);
  }
  const ownerFirst = String(p.owner_name || "").trim().split(/\s+/)[0];
  if (ok(ownerFirst)) found.push(ownerFirst);
  const text = factText(p);
  const pats = [
    /\b(?:[Cc]all|[Aa]sk for|[Tt]alk to|[Tt]ext)\s+([A-Z][a-z]{1,14})(?:\s+(?:or|and|&)\s+([A-Z][a-z]{1,14}))?\b/g,
    /\b([A-Z][a-z]{1,14})\s+(?:and|&)\s+([A-Z][a-z]{1,14})\s+(?:bring|have|has|run|own|started|founded|are|do|will)\b/g,
  ];
  for (const re of pats) for (const m of text.matchAll(re)) for (const n of [m[1], m[2]]) if (ok(n)) found.push(n);
  return uniq(found).slice(0, 2);
}

/** "Call Rick or Patrick" / "Call Rick" / "Call us". */
export function ownerCallLabel(names = []) {
  const n = names.filter(Boolean).slice(0, 2);
  if (n.length === 2) return `Call ${n[0]} or ${n[1]}`;
  if (n.length === 1) return `Call ${n[0]}`;
  return "Call us";
}

const TIDY_SPECIALTY = s => {
  let t = String(s || "").replace(/\s+/g, " ").replace(/\s+and\s+/gi, " & ").replace(/[.;:,!]+$/, "").trim();
  t = t.replace(/^(the|our|all)\s+/i, "");
  if (!t || t.length > 40 || t.split(" ").length > 6) return null;
  return t[0].toUpperCase() + t.slice(1).toLowerCase().replace(/\b(nj|ny|pa|ma|ct|ri|nh|me|vt|hvac)\b/g, m => m.toUpperCase());
};

/**
 * The one thing this business is known for: logo text first ("Cathedral
 * ceiling specialists"), then the business's own words ("specialists in X",
 * "X is our specialty"). Null when nothing clearly stands out.
 */
// A "specialty" that's only the trade or words from the business name
// ("Pressure washing" for Blue Lightning Pressure Washing) isn't one.
const GENERIC_WORDS = new Set("services service company co inc llc and the of pro pros professional professionals quality local".split(" "));
function isGenericSpecialty(t, p) {
  const own = new Set(`${p.business_name || ""} ${p.primary_category || ""} ${tradeLabel(p)}`.toLowerCase().split(/[^a-z]+/).filter(Boolean)
    .flatMap(w => [w, w.replace(/s$/, ""), w.replace(/ing$/, ""), w.replace(/er$/, "")]));
  const words = t.toLowerCase().split(/[^a-z]+/).filter(w => w && !GENERIC_WORDS.has(w));
  return !words.length || words.every(w => own.has(w) || own.has(w.replace(/s$/, "")) || own.has(w.replace(/ing$/, "")));
}

export function specialtyFrom(p = {}, analysis = null) {
  for (const s of list(analysis?.specialty_phrases)) {
    const t = TIDY_SPECIALTY(String(s).replace(/\bspecialists?\b|\bspecializ\w*\b|\bspecialty\b/gi, ""));
    if (t && !isGenericSpecialty(t, p)) return t;
  }
  const text = factText(p);
  const pats = [
    /\bspeciali[sz](?:ts?|e|es|ing)\s+in\s+([^.\n;:()]{4,60})/i,
    /\bspecialty\s+(?:is|:)\s+([^.\n;:()]{4,60})/i,
    /\b([A-Za-z][^.\n;:()]{3,50}?)\s+(?:is|are)\s+(?:our|a)\s+specialty\b/i,
  ];
  for (const re of pats) {
    const m = text.match(re);
    const t = m && TIDY_SPECIALTY(m[1].replace(/\b(rooms?|work|jobs?|projects?)$/i, "").trim());
    if (t && !isGenericSpecialty(t, p)) return t;
  }
  return null;
}

// ── License ───────────────────────────────────────────────────────────────

// Where a homeowner can check a contractor's license or registration. A
// state not listed shows the number without a link.
export const LICENSE_VERIFY_URLS = {
  NJ: "https://newjersey.mylicense.com/verification/",
  NY: "https://appext20.dos.ny.gov/nydos/selSearchType.do",
  PA: "https://hicsearch.attorneygeneral.gov/",
  MA: "https://www.mass.gov/how-to/check-a-license-or-registration-for-a-home-improvement-contractor",
  CT: "https://www.elicense.ct.gov/Lookup/LicenseLookup.aspx",
  RI: "https://crb.ri.gov/consumer/search-registrantlicensee",
  NH: "https://forms.nh.gov/licenseverification/",
  ME: "https://www.pfr.maine.gov/ALMSOnline/ALMSQuery/SearchIndividual.aspx",
  VT: "https://sos.vermont.gov/opr/find-a-professional/",
};

/** "NJ HIC #13VH08800400" → { number, state, verify_url }; null when there's none. */
export function licenseFrom(p = {}) {
  const own = String(p.license_number || "").trim().replace(/^#/, "");
  const st = stateCode(p.state);
  let number = own, state = st, kind = "License";
  if (!number) {
    const m = factText(p).match(/\b(?:([A-Z]{2})\s+)?(?:HIC|license|lic\.|licence|reg(?:istration)?\.?)\s*(?:#|no\.?|number)\s*:?\s*([A-Z0-9][A-Z0-9-]{4,19})\b/i);
    if (!m || !/\d/.test(m[2])) return null;
    number = m[2].toUpperCase();
    if (m[1] && STATE_CODES_SET.has(m[1].toUpperCase())) state = m[1].toUpperCase();
    if (/\bHIC\b/i.test(m[0])) kind = "HIC";
  }
  if (!number) return null;
  return { number, state: state || null, kind, verify_url: LICENSE_VERIFY_URLS[state] || null };
}
const STATE_CODES_SET = new Set(US_STATE_ABBR.map(s => s.toUpperCase()));

/** "20+" from "20+ years", "12" from years_in_business 12; null otherwise. */
export function yearsFrom(p = {}) {
  const y = Number(p.years_in_business);
  if (Number.isInteger(y) && y > 0 && y < 150) return String(y);
  const t = factText(p);
  // "20+ years" and "more than 20 years" both mean 20+; checked before a plain "20 years".
  const plus = t.match(/\b(\d{1,2})\+\s*(?:years|yrs)\b/i) || t.match(/\b(?:more than|over)\s+(\d{1,2})\s+(?:years|yrs)\b/i);
  const plain = t.match(/\b(\d{1,2})\s*(?:years|yrs)\b(?:\s+of)?\s+(?:experience|in business)/i);
  const m = plus || plain;
  if (!m) return null;
  const n = Number(m[1]);
  if (!(n > 0 && n < 100)) return null;
  return plus ? `${n}+` : String(n);
}

/** Insured: the owner's own answer, or the business saying so in its own copy. */
export function insuredFrom(p = {}) {
  if (p.is_insured === true) return true;
  if (p.is_insured === false) return false;
  return /\b(licensed\s*(and|&)\s*)?(fully\s+)?insured\b/i.test(list(p.trust_badges).join(" ") + "\n" +
    (Array.isArray(p.why_choose_us) ? p.why_choose_us.join("\n") : String(p.why_choose_us || "")));
}

/** "No job too big or too small" only when the business uses the phrase. */
export function usesNoJobTooSmall(p = {}) {
  return /\bno job (is )?too (big|large|small)\b/i.test(factText(p));
}

// ── Towns ─────────────────────────────────────────────────────────────────

const cleanTown = t => String(t || "").replace(/,\s*[A-Za-z]{2}\.?$/, "").replace(/,\s*[A-Za-z ]+$/, "").trim();

function milesBetween(a, b) {
  const R = 3958.8, rad = d => (d * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]), dLng = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * confirmed: the towns the business already lists (and its own town).
 * suggested: up to 6 towns within ~12 miles from the bundled dataset
 * (data/town-coords.json), never already confirmed. Suggested towns are only
 * ever shown to the owner as "Tap to confirm"; nothing public reads them.
 */
export function townsFor(p = {}, coords = []) {
  const st = stateCode(p.state);
  const confirmed = uniq([cleanTown(p.city), ...list(p.service_area).map(cleanTown)]
    .filter(t => t && !/county|nationwide|statewide|area$/i.test(t)));
  const lower = new Set(confirmed.map(t => t.toLowerCase()));
  const home = coords.find(([c, s]) => s === st && c.toLowerCase() === cleanTown(p.city).toLowerCase());
  if (!home) return { confirmed, suggested: [] };
  const suggested = coords
    .filter(([c]) => !lower.has(c.toLowerCase()))
    .map(([c, s, lat, lng]) => ({ name: c, state: s, miles: milesBetween([home[2], home[3]], [lat, lng]) }))
    .filter(t => t.miles <= SUGGEST_RADIUS_MILES)
    .sort((a, b) => a.miles - b.miles)
    .slice(0, MAX_SUGGESTED_TOWNS)
    .map(t => t.name);
  return { confirmed, suggested };
}

// ── Wordmark ──────────────────────────────────────────────────────────────

const TRADE_LABEL = {
  landscaping: "Landscaping", plumbing: "Plumbing", hvac: "Heating & Cooling", electrical: "Electrical",
  cleaning: "Cleaning", painting: "Painting", contractor: "Contracting", default: "",
};

/** The persona, with snow split out (it has its own icon and scene). */
export function sceneKeyFor(category) {
  const c = String(category || "").toLowerCase();
  if (/snow/.test(c)) return "snow";
  const persona = personaFor(category);
  return persona === "default" ? "contractor" : persona;
}

/** Trade word for headlines and the share card: "Painting", "Pressure washing". */
export function tradeLabel(p = {}) {
  const cat = String(p.primary_category || "").trim();
  if (/pressure|power wash/i.test(cat)) return "Pressure washing";
  if (/snow/i.test(cat)) return "Snow removal";
  return TRADE_LABEL[personaFor(cat)] || (cat ? cat[0].toUpperCase() + cat.slice(1).toLowerCase() : "Local service");
}

/** { line1: "LET IT ROLL", line2: "PAINTING · EWING NJ", icon: "painting" }. */
export function wordmarkFor(p = {}) {
  let { main, descriptor } = splitWordmark(logoName(p.business_name));
  // Trades page-style.js's TRADE_WORDS doesn't know (kept out of v1 on purpose).
  const extra = String(main).match(/^(.+?)\s+((?:pressure|power|soft)\s+wash\w*.*|wash\w*.*|roofing.*|gutters?.*|handyman.*|windows?.*)$/i);
  if (extra && !descriptor) { main = extra[1]; descriptor = extra[2]; }
  const line1 = String(main || p.business_name || "").toUpperCase();
  const trade = (descriptor || tradeLabel(p)).replace(/\b(services?|solutions|company|co\.?)\b/gi, "").trim();
  const where = [cleanTown(p.city), stateCode(p.state)].filter(Boolean).join(" ");
  const line2 = [trade, where].filter(Boolean).join(" · ").toUpperCase();
  return { line1, line2, icon: tradeIconFor(p.primary_category) };
}

// ── Hero image (1d) ───────────────────────────────────────────────────────

/**
 * First match: owner work photo, Google work photo, approved stock photo
 * (PAGE_STOCK_HERO=on and PR 2's pickStockPhoto), else a drawn trade scene.
 */
export function heroFor(p = {}, { googlePhotos = [], stock = null } = {}) {
  const own = ownerHeroPhoto(p);
  if (own) return { kind: "work_photo", ref: own };
  const gi = googlePhotos.findIndex(g => g?.kind === "work");
  if (gi >= 0) return { kind: "work_photo", ref: `google:${gi}` };
  if (stock) return { kind: "stock", ref: stock };
  return { kind: "scene", ref: sceneKeyFor(p.primary_category) };
}

// ── The whole kit (pure) ──────────────────────────────────────────────────

/**
 * inputs: { logo: {url, source, width, height} | null, analysis, palette
 * (paletteFromPixels), googlePhotos, townCoords, stock, now }
 */
export function deriveKit(p = {}, inputs = {}) {
  const { logo = null, analysis = null, palette = null, googlePhotos = [], townCoords = [], stock = null, now = Date.now() } = inputs;
  const q = logoQuality({ ...(logo || {}), analysis });
  const colors = kitColors(q.quality === "none" ? null : palette, p);
  const badges = uniq(badgesFrom([...(analysis?.text_lines || []), ...(analysis?.identity_phrases || []), factText(p)]))
    .filter(isValidBadge);
  return {
    version: KIT_VERSION,
    built_at: new Date(now).toISOString(),
    logo: logo?.url
      ? { url: logo.url, source: logo.source, quality: q.quality, reason: q.reason, width: logo.width ?? null, height: logo.height ?? null, analysis: analysis || null }
      : { url: null, source: null, quality: "none", reason: q.reason },
    colors,
    wordmark: wordmarkFor(p),
    badges,
    owner_names: ownerNamesFrom(p, analysis),
    specialty: specialtyFrom(p, analysis),
    license: licenseFrom(p),
    years: yearsFrom(p),
    insured: insuredFrom(p),
    towns: townsFor(p, townCoords),
    google_photos: googlePhotos,
    hero: heroFor(p, { googlePhotos, stock }),
  };
}

/** A kit to render with when none is stored yet (or it's from an older version). */
export function kitFor(p = {}, { townCoords = [] } = {}) {
  const k = p.brand_kit;
  if (k && typeof k === "object" && k.version === KIT_VERSION && k.colors?.identity) {
    // Photos added after the kit was built still win the hero.
    const own = ownerHeroPhoto(p);
    return own && k.hero?.ref !== own ? { ...k, hero: { kind: "work_photo", ref: own } } : k;
  }
  return deriveKit(p, { townCoords });
}

// ── I/O layer ─────────────────────────────────────────────────────────────
// Everything below touches the network or the DB. Every dependency comes in
// through `deps` so tests can stand them in.

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

let sharpLoader = null;
async function loadSharp() {
  if (!sharpLoader) sharpLoader = import("sharp").then(m => m.default || m).catch(e => { sharpLoader = null; throw e; });
  return sharpLoader;
}

let townCoordsCache = null;
export async function loadTownCoords() {
  if (townCoordsCache) return townCoordsCache;
  try {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const raw = fs.readFileSync(path.join(process.cwd(), "data", "town-coords.json"), "utf8");
    townCoordsCache = JSON.parse(raw).towns || [];
  } catch { townCoordsCache = []; }
  return townCoordsCache;
}

const absUrl = (u, base) => { try { return new URL(String(u).trim(), base).toString(); } catch { return null; } };
const attr = (tag, name) => (tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i")) || [])[1] || "";

/**
 * Logo candidates from a business website's HTML: og:image, a 192px+ icon,
 * and <img> tags whose src/alt/class say "logo". Pure (exported for tests).
 */
export function websiteLogoCandidates(html, baseUrl) {
  const out = [];
  const h = String(html || "");
  for (const tag of h.match(/<img\b[^>]*>/gi) || []) {
    const hay = `${attr(tag, "src")} ${attr(tag, "alt")} ${attr(tag, "class")} ${attr(tag, "id")}`;
    if (/logo/i.test(hay)) { const u = absUrl(attr(tag, "src") || attr(tag, "data-src"), baseUrl); if (u) out.push(u); }
  }
  for (const tag of h.match(/<link\b[^>]*>/gi) || []) {
    if (!/rel=["'][^"']*icon/i.test(tag)) continue;
    const size = Math.max(0, ...String(attr(tag, "sizes")).split(/\s+/).map(s => Number(s.split("x")[0]) || 0));
    if (size >= 192) { const u = absUrl(attr(tag, "href"), baseUrl); if (u) out.push(u); }
  }
  for (const tag of h.match(/<meta\b[^>]*>/gi) || []) {
    if (/property=["']og:image["']/i.test(tag)) { const u = absUrl(attr(tag, "content"), baseUrl); if (u) out.push(u); }
  }
  return uniq(out).filter(u => /^https:\/\//i.test(u) && !/\.(ico|svg)(\?|$)/i.test(u));
}

/**
 * Ordered logo candidates. Jack's admin paste (admin_logo_url) sits right
 * after an owner upload: it's a person's explicit choice, so it beats every
 * automatic guess. Facebook is never scraped.
 */
export function logoCandidates({ profile = {}, prospect = null, websiteHtml = null, googleLogoUrl = null } = {}) {
  const out = [];
  const add = (url, source) => { if (url && /^https:\/\//i.test(url) && !/facebook\.com|fbcdn\.net/i.test(url)) out.push({ url, source }); };
  add(profile.logo_url, profile.is_claimed === false ? "profile" : "owner");
  add(profile.admin_logo_url, "admin");
  add(googleLogoUrl, "google");
  if (websiteHtml) for (const u of websiteLogoCandidates(websiteHtml, profile.website)) add(u, "website");
  // Outscraper's logo is the Google profile avatar at 44px ("/s44-p-k-no…");
  // the same URL serves larger sizes.
  add(String(prospect?.raw?.logo || "").replace(/\/s44-p-k-no/, "/s400-p-k-no") || null, "outscraper");
  const seen = new Set();
  return out.filter(c => (seen.has(c.url) ? false : seen.add(c.url)));
}

async function fetchImage(url, { fetchImpl }) {
  const r = await fetchImpl(url, { headers: { "User-Agent": "EnomaBrandKit/1.0" }, signal: AbortSignal.timeout(8000), redirect: "follow" });
  if (!r.ok) throw new Error(`image ${r.status}`);
  const len = Number(r.headers.get("content-length") || 0);
  if (len > MAX_IMAGE_BYTES) throw new Error("image too large");
  const buf = Buffer.from(await r.arrayBuffer());
  if (!buf.length || buf.length > MAX_IMAGE_BYTES) throw new Error("image empty or too large");
  return buf;
}

/** Size + dominant colors + a small PNG for the vision call. */
export async function readImage(buffer, { sharp } = {}) {
  const s = sharp || await loadSharp();
  const meta = await s(buffer).metadata();
  const { data } = await s(buffer).resize(64, 64, { fit: "fill" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const small = await s(buffer).resize(512, 512, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
  return { width: meta.width || null, height: meta.height || null, palette: paletteFromPixels(data), png: small };
}

export const LOGO_ANALYSIS_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["is_logo", "text_lines", "owner_names", "identity_phrases", "specialty_phrases", "has_character_or_mascot", "is_busy_or_low_res"],
  properties: {
    is_logo: { type: "boolean" },
    text_lines: { type: "array", items: { type: "string" } },
    owner_names: { type: "array", items: { type: "string" } },
    identity_phrases: { type: "array", items: { type: "string" } },
    specialty_phrases: { type: "array", items: { type: "string" } },
    has_character_or_mascot: { type: "boolean" },
    is_busy_or_low_res: { type: "boolean" },
  },
};

const LOGO_PROMPT = `This image is a candidate logo for a small local service business. Read it exactly; never guess.
Return JSON:
- is_logo: true if this is a business logo or wordmark (not a photo of a job, a person, a storefront or a flyer).
- text_lines: every line of text in the image, exactly as written, top to bottom.
- owner_names: people's first names written in the image (e.g. "Rick & Patrick"), else [].
- identity_phrases: phrases about who runs it, exactly as written (e.g. "American Owned & Operated", "Veteran Owned", "Family Owned", "Since 1998"), else [].
- specialty_phrases: phrases naming what they specialize in, exactly as written (e.g. "Cathedral Ceiling Specialists"), else [].
- has_character_or_mascot: true if it contains a cartoon character, mascot, animal or person drawing.
- is_busy_or_low_res: true if it is cluttered (many elements, photo backgrounds, tiny text) or visibly blurry/pixelated.`;

/** One gpt-4o vision call for one image (JSON schema). Returns the analysis or null. */
export async function analyzeLogo(png, { fetchImpl = globalThis.fetch, apiKey = process.env.OPENAI_KEY, log = console } = {}) {
  if (!apiKey || !png) return null;
  try {
    const r = await fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o", temperature: 0,
        response_format: { type: "json_schema", json_schema: { name: "logo_analysis", strict: true, schema: LOGO_ANALYSIS_SCHEMA } },
        messages: [{ role: "user", content: [
          { type: "text", text: LOGO_PROMPT },
          { type: "image_url", image_url: { url: `data:image/png;base64,${png.toString("base64")}`, detail: "low" } },
        ] }],
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) { log.warn?.("brand kit: vision call failed", r.status); return null; }
    const content = (await r.json())?.choices?.[0]?.message?.content;
    return content ? JSON.parse(content) : null;
  } catch (e) {
    log.warn?.("brand kit: vision call failed", e?.message || e);
    return null;
  }
}

export const PHOTO_KINDS_SCHEMA = {
  type: "object", additionalProperties: false, required: ["photos"],
  properties: { photos: { type: "array", items: {
    type: "object", additionalProperties: false, required: ["index", "kind"],
    properties: { index: { type: "integer" }, kind: { type: "string", enum: ["work", "logo", "storefront", "people", "vehicle", "other"] } },
  } } },
};

/**
 * Google listing photos: which are photos of the business's work, and is one
 * of them the logo? One vision call for up to 4 photos, cached on the kit by
 * photo name. Google's author attributions are kept with each photo.
 */
export async function classifyGooglePhotos(photos, { fetchImpl, apiKey, placesKey, sharp, log = console, cached = [] } = {}) {
  const byName = new Map(cached.filter(c => c?.name && c.kind).map(c => [c.name, c]));
  const out = photos.slice(0, 4).map(ph => ({
    name: ph.name, width: ph.widthPx || null, height: ph.heightPx || null,
    attributions: (ph.authorAttributions || []).map(a => ({ displayName: a.displayName || "", uri: a.uri || "" })),
    kind: byName.get(ph.name)?.kind || null,
  }));
  const todo = out.filter(o => !o.kind);
  if (!todo.length || !apiKey || !placesKey) return out;
  try {
    const imgs = [];
    for (const o of todo) {
      const uri = await googlePhotoUri(o.name, { fetchImpl, placesKey, maxWidthPx: 512 });
      const buf = uri ? await fetchImage(uri, { fetchImpl }) : null;
      const s = sharp || await loadSharp();
      imgs.push(buf ? await s(buf).resize(384, 384, { fit: "inside" }).jpeg({ quality: 70 }).toBuffer() : null);
    }
    const content = [{ type: "text", text: "These are photos from a local service business's Google listing, numbered from 0. For each, say what it shows: work (a finished or in-progress job by the business), logo (the business's logo or sign graphic), storefront, people, vehicle, or other. JSON." }];
    imgs.forEach((b, i) => { if (b) content.push({ type: "text", text: `Photo ${i}:` }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${b.toString("base64")}`, detail: "low" } }); });
    const r = await fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o", temperature: 0, messages: [{ role: "user", content }],
        response_format: { type: "json_schema", json_schema: { name: "photo_kinds", strict: true, schema: PHOTO_KINDS_SCHEMA } } }),
      signal: AbortSignal.timeout(30000),
    });
    if (r.ok) {
      const parsed = JSON.parse((await r.json())?.choices?.[0]?.message?.content || "{}");
      for (const { index, kind } of parsed.photos || []) if (todo[index]) todo[index].kind = kind;
    }
  } catch (e) { log.warn?.("brand kit: google photo check failed", e?.message || e); }
  for (const o of out) if (!o.kind) o.kind = "other";
  return out;
}

/** A short-lived image URL for a Places photo (the API key stays on the server). */
export async function googlePhotoUri(name, { fetchImpl = globalThis.fetch, placesKey = process.env.GOOGLE_SERVER_PLACES_KEY, maxWidthPx = 1200 } = {}) {
  if (!name || !placesKey || !/^places\/[^/]+\/photos\/[^/]+$/.test(name)) return null;
  const r = await fetchImpl(`https://places.googleapis.com/v1/${name}/media?maxWidthPx=${maxWidthPx}&skipHttpRedirect=true`, {
    headers: { "X-Goog-Api-Key": placesKey }, signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) return null;
  return (await r.json())?.photoUri || null;
}

/** Places photos (names + attributions). Field mask: photos. */
export async function fetchPlacePhotos(placeId, { fetchImpl = globalThis.fetch, placesKey = process.env.GOOGLE_SERVER_PLACES_KEY } = {}) {
  if (!placeId || !placesKey) return [];
  try {
    const r = await fetchImpl(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
      headers: { "X-Goog-Api-Key": placesKey, "X-Goog-FieldMask": "photos" }, signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return [];
    return (await r.json())?.photos || [];
  } catch { return []; }
}

/** Stock hero (PR 2). Null unless PAGE_STOCK_HERO=on and an approved photo fits. */
// api/_lib/stock-photos.js pickStockPhoto(profile, kit, { supabase }) →
// { urls: { w2400, w1200, w600, srcset }, credit: { name, profileUrl, photoUrl },
//   unsplash_id, alt, photo: { unsplash_id, download_location } } | null.
async function pickStock(profile, kit, { env, supabase, log, fetchImpl }) {
  if (env.PAGE_STOCK_HERO !== "on" || !supabase) return null;
  try {
    const m = await import("./stock-photos.js");
    const pick = await m.pickStockPhoto?.(profile, kit, { supabase, log });
    if (!pick?.urls?.w1200) return null;
    // Unsplash's download ping, once per business + photo (stock_photo_assignments
    // dedupes it). Awaited: a ping cut off when the function freezes would leave
    // the photo assigned with no download recorded. It never throws, and after
    // the first build it's one DB read (already_assigned).
    if (profile.business_id && m.trackStockAssignment) {
      await m.trackStockAssignment(pick.photo, profile.business_id, { supabase, log, fetchImpl, accessKey: env.UNSPLASH_ACCESS_KEY });
    }
    return {
      url: pick.urls.w1200, srcset: pick.urls.srcset || null, alt: pick.alt || "", unsplash_id: pick.unsplash_id || null,
      credit: pick.credit?.name ? { name: pick.credit.name, profileUrl: pick.credit.profileUrl || null } : null,
    };
  } catch { return null; }
}

/**
 * Build the kit for one profile: logo candidates in order, the first one
 * that loads, its colors, one cached vision call, Google photos, towns.
 * deps: { fetchImpl, sharp, openaiKey, placesKey, prospect, websiteHtml, env, log, now }
 * Never throws: on any failure the kit falls back to the persona look.
 */
export async function buildBrandKit(profile, deps = {}) {
  const {
    fetchImpl = globalThis.fetch, sharp, openaiKey = process.env.OPENAI_KEY,
    placesKey = process.env.GOOGLE_SERVER_PLACES_KEY, prospect = null, env = process.env, log = console, now = Date.now(),
  } = deps;
  const prev = profile.brand_kit && typeof profile.brand_kit === "object" ? profile.brand_kit : {};
  const townCoords = deps.townCoords || await loadTownCoords();

  // Google listing photos (cached kinds reused; one vision call for new ones).
  let googlePhotos = [];
  if (profile.google_place_id && placesKey) {
    const raw = await fetchPlacePhotos(profile.google_place_id, { fetchImpl, placesKey });
    googlePhotos = await classifyGooglePhotos(raw, { fetchImpl, apiKey: openaiKey, placesKey, sharp, log, cached: prev.google_photos || [] });
  }
  const googleLogo = googlePhotos.find(g => g.kind === "logo");
  const googleLogoUrl = googleLogo ? await googlePhotoUri(googleLogo.name, { fetchImpl, placesKey, maxWidthPx: 800 }).catch(() => null) : null;

  let websiteHtml = deps.websiteHtml || null;
  if (!websiteHtml && /^https?:\/\//i.test(String(profile.website || "")) && !/facebook\.com|instagram\.com/i.test(profile.website)) {
    try {
      const r = await fetchImpl(profile.website, { headers: { "User-Agent": "EnomaBrandKit/1.0" }, signal: AbortSignal.timeout(8000) });
      if (r.ok) websiteHtml = (await r.text()).slice(0, 400000);
    } catch { /* no website logo */ }
  }

  let logo = null, palette = null, analysis = null;
  for (const c of logoCandidates({ profile, prospect, websiteHtml, googleLogoUrl })) {
    try {
      const buf = await fetchImage(c.url, { fetchImpl });
      const img = await readImage(buf, { sharp });
      if (!img.width || Math.min(img.width, img.height) < 48) continue;
      const cachedAnalysis = prev.logo?.url === c.url && prev.logo?.analysis ? prev.logo.analysis : null;
      const a = cachedAnalysis || await analyzeLogo(img.png, { fetchImpl, apiKey: openaiKey, log });
      // An automatic guess the model says isn't a logo is skipped; an owner's
      // or Jack's own pick is always used.
      if (a && a.is_logo === false && !["owner", "admin", "profile"].includes(c.source)) continue;
      logo = { url: c.source === "google" ? `google:${googleLogo.name}` : c.url, source: c.source, width: img.width, height: img.height };
      palette = img.palette; analysis = a;
      break;
    } catch (e) {
      log.warn?.(`brand kit: logo candidate skipped (${c.source})`, e?.message || e);
    }
  }

  const draft = deriveKit(profile, { logo, analysis, palette, googlePhotos, townCoords, now });
  const stock = draft.hero.kind === "scene" ? await pickStock(profile, draft, { env, supabase: deps.supabase, log, fetchImpl }) : null;
  return stock ? { ...draft, hero: { kind: "stock", ref: stock } } : draft;
}

/** Store the kit (best effort: logs and returns false on failure). */
export async function saveBrandKit(supabaseAdmin, businessId, kit, { log = console } = {}) {
  try {
    const { error } = await supabaseAdmin.from("small_business_profiles").update({ brand_kit: kit }).eq("business_id", businessId);
    if (error) { log.warn?.("brand kit: not saved:", error.message || error); return false; }
    return true;
  } catch (e) { log.warn?.("brand kit: not saved:", e?.message || e); return false; }
}

/** Rebuild + save for a v2 page. Used after preview generation and logo/photo changes. */
export async function rebuildBrandKit(supabaseAdmin, businessId, deps = {}) {
  const { data: profile } = await supabaseAdmin.from("small_business_profiles").select("*").eq("business_id", businessId).maybeSingle();
  if (!profile || Number(profile.page_version) !== 2) return null;
  const kit = await buildBrandKit(profile, { supabase: supabaseAdmin, ...deps });
  await saveBrandKit(supabaseAdmin, businessId, kit, deps);
  return kit;
}

export { isImageUrl };
