// api/_lib/stock-photos.js
// Curated Unsplash stock photos for pages that have no photos of their own.
//
// The library is built offline (scripts/build-stock-library.mjs), every photo
// is approved by hand (scripts/approve-stock.mjs), and page loads never call
// the Unsplash API: they read approved rows from stock_photos and hotlink
// images.unsplash.com (image requests don't count against the rate limit).
//
// Rules (Unsplash API Guidelines):
//   * Hotlink urls.raw. Sized URLs keep its ixid and add Imgix params.
//   * Attribute wherever a stock photo shows: creditHtml().
//   * Trigger download_location once per business, when a photo is first
//     assigned to it: trackStockAssignment(). Never on page views.
//
// Where stock may appear: the hero or service cards only. Never in Recent
// work and never captioned as the business's own work (STOCK_SLOTS).

import { personaFor, brandTokens, hashString, hexToRgb } from "./page-style.js";

export const UTM = "utm_source=enoma&utm_medium=referral";
export const STOCK_SLOTS = Object.freeze(["hero", "service"]);
export const MIN_WIDTH = 2400;
export const SIZES = Object.freeze([2400, 1200, 600]);

// ── Search queries per persona x service. `tag` is stored as service_tag;
// `match` decides which of a business's services/category point at it. The
// first entry of each persona is its general fallback.
export const STOCK_QUERIES = Object.freeze({
  painting: [
    { tag: "interior", query: "freshly painted living room", match: /interior|room|wall|ceiling|cabinet|drywall/ },
    { tag: "vaulted-ceiling", query: "vaulted ceiling interior", match: /ceiling|vault/ },
    { tag: "roller", query: "paint roller wall", match: /paint|roller|interior/ },
    { tag: "exterior", query: "freshly painted house exterior", match: /exterior|house|siding|trim/ },
    { tag: "cabinets", query: "painted kitchen cabinets", match: /cabinet|kitchen/ },
    { tag: "trim", query: "white painted window trim", match: /trim|window|door/ },
    { tag: "deck-stain", query: "stained wood deck", match: /deck|stain|fence/ },
    { tag: "commercial", query: "painted office interior", match: /commercial|office/ },
  ],
  landscaping: [
    { tag: "lawn", query: "freshly mowed lawn backyard", match: /lawn|mow|grass|turf|landscap/ },
    { tag: "garden-beds", query: "mulched garden beds", match: /mulch|bed|garden|plant/ },
    { tag: "hardscape", query: "stone patio backyard", match: /hardscap|patio|paver|wall|stone/ },
    { tag: "hedges", query: "trimmed hedges garden", match: /hedge|shrub|trim|prun/ },
    { tag: "cleanup", query: "autumn leaves yard", match: /clean ?up|leaf|leaves|fall|spring/ },
    { tag: "trees", query: "tree lined backyard", match: /tree/ },
    { tag: "irrigation", query: "lawn sprinkler", match: /irrigat|sprinkler/ },
    { tag: "design", query: "landscaped front yard", match: /design|install|front yard/ },
  ],
  snow: [
    { tag: "driveway", query: "snow cleared driveway", match: /snow|plow|driveway/ },
    { tag: "plow", query: "snow plow truck", match: /plow/ },
    { tag: "shovel", query: "shoveled sidewalk snow", match: /shovel|sidewalk|walk/ },
    { tag: "salt", query: "salted winter road", match: /salt|sand|ice/ },
    { tag: "parking-lot", query: "plowed parking lot snow", match: /lot|commercial/ },
    { tag: "winter-house", query: "house in snow winter", match: /snow|winter|residential/ },
  ],
  plumbing: [
    { tag: "fixtures", query: "modern bathroom faucet", match: /fixture|faucet|plumb/ },
    { tag: "kitchen-sink", query: "kitchen sink faucet", match: /sink|kitchen|disposal/ },
    { tag: "bathroom", query: "renovated bathroom shower", match: /bath|shower|tub|toilet|remodel/ },
    { tag: "pipes", query: "copper pipes plumbing", match: /pipe|repipe|leak|repair|plumb/ },
    { tag: "water-heater", query: "water heater tank", match: /water heater|tankless|heater/ },
    { tag: "drain", query: "drain pipe", match: /drain|clog|sewer|septic/ },
    { tag: "boiler", query: "boiler heating pipes", match: /boiler|heating|radiator/ },
    { tag: "tools", query: "plumbing wrench tools", match: /emergency|service|plumb/ },
  ],
  hvac: [
    { tag: "outdoor-unit", query: "air conditioner outdoor unit house", match: /air condition|\bac\b|a\/c|cool|hvac|condenser/ },
    { tag: "furnace", query: "furnace basement", match: /furnace|heat|boiler/ },
    { tag: "heat-pump", query: "heat pump outdoor", match: /heat pump|mini ?split/ },
    { tag: "mini-split", query: "ductless mini split wall unit", match: /mini ?split|ductless/ },
    { tag: "thermostat", query: "wall thermostat", match: /thermostat|smart/ },
    { tag: "ductwork", query: "air duct vent", match: /duct|vent|air quality/ },
    { tag: "cozy-home", query: "cozy living room winter", match: /heat|comfort|hvac/ },
    { tag: "rooftop", query: "rooftop hvac units", match: /commercial|rooftop/ },
  ],
  electrical: [
    { tag: "panel", query: "electrical panel breaker", match: /panel|breaker|electric|upgrade/ },
    { tag: "lighting", query: "pendant lights kitchen", match: /light|fixture|pendant|recessed/ },
    { tag: "outlets", query: "wall outlet switch", match: /outlet|switch|wiring|receptacle/ },
    { tag: "ev-charger", query: "electric car charger garage", match: /\bev\b|charger|electric car/ },
    { tag: "generator", query: "home standby generator", match: /generator|backup/ },
    { tag: "exterior-lighting", query: "house exterior lights night", match: /exterior|landscape light|outdoor/ },
    { tag: "wiring", query: "electrical wiring", match: /wir|rewire|electric/ },
    { tag: "ceiling-fan", query: "ceiling fan living room", match: /fan/ },
  ],
  cleaning: [
    { tag: "living-room", query: "clean bright living room", match: /clean|house|home|residential|maid/ },
    { tag: "kitchen", query: "clean modern kitchen", match: /kitchen|deep/ },
    { tag: "bathroom", query: "clean white bathroom", match: /bath|deep/ },
    { tag: "supplies", query: "cleaning supplies", match: /clean|supplies/ },
    { tag: "windows", query: "clean windows sunlight", match: /window/ },
    { tag: "office", query: "clean empty office", match: /office|commercial|janitor/ },
    { tag: "pressure-wash", query: "pressure washing driveway", match: /pressure|power wash/ },
    { tag: "move-out", query: "empty clean apartment", match: /move|turnover|apartment/ },
  ],
  contractor: [
    { tag: "framing", query: "house framing construction", match: /contract|construct|build|framing|addition/ },
    { tag: "kitchen-remodel", query: "kitchen remodel", match: /kitchen|remodel|renovat/ },
    { tag: "roof", query: "new roof shingles", match: /roof|shingle/ },
    { tag: "siding", query: "house siding exterior", match: /siding|exterior/ },
    { tag: "deck", query: "new wood deck", match: /deck|porch|carpent/ },
    { tag: "masonry", query: "brick masonry wall", match: /mason|brick|stone|concrete|chimney/ },
    { tag: "paving", query: "new asphalt driveway", match: /pav|asphalt|driveway|sealcoat/ },
    { tag: "tools", query: "carpentry tools workbench", match: /handyman|repair|carpent/ },
  ],
});

export const STOCK_PERSONAS = Object.freeze(Object.keys(STOCK_QUERIES));

// ── URLs and credit ──────────────────────────────────────────────────────

/** Sized hotlink URLs from urls.raw. Keeps every raw param (ixid included). */
export function sizedUrls(rawUrl) {
  const raw = String(rawUrl || "");
  if (!/^https:\/\/images\.unsplash\.com\//.test(raw)) return null;
  const sep = raw.includes("?") ? "&" : "?";
  const at = w => `${raw}${sep}w=${w}&q=75&fm=webp&fit=crop`;
  const urls = { w2400: at(2400), w1200: at(1200), w600: at(600) };
  urls.srcset = `${urls.w600} 600w, ${urls.w1200} 1200w, ${urls.w2400} 2400w`;
  return urls;
}

/**
 * The same Unsplash hotlink as a JPEG, for the share card: @vercel/og
 * (satori) reads PNG/JPEG/GIF only and throws on WebP. Other URLs pass
 * through unchanged.
 */
export function ogSafeImageUrl(url) {
  const u = String(url || "");
  if (!/^https:\/\/images\.unsplash\.com\//.test(u)) return u;
  return /[?&]fm=/.test(u) ? u.replace(/([?&])fm=[a-z]+/, "$1fm=jpg") : `${u}${u.includes("?") ? "&" : "?"}fm=jpg`;
}

const withUtm = url => {
  const u = String(url || "").replace(/[?&]utm_[a-z]+=[^&]*/g, "");
  return `${u}${u.includes("?") ? "&" : "?"}${UTM}`;
};
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** The credit object a page needs, from a stock_photos row. */
export function creditFor(row) {
  return {
    name: row.photographer_name,
    profileUrl: withUtm(row.photographer_url || `https://unsplash.com/@${row.photographer_username}`),
    photoUrl: withUtm(row.photo_page_url),
  };
}

/**
 * "Photo by <name> on Unsplash". Both links carry the UTM params. Placement
 * (hero bottom corner, under the hero on phones) is the page's job: see
 * STOCK_CREDIT_CSS.
 */
export function creditHtml(credit, { className = "stock-credit" } = {}) {
  if (!credit || !credit.name) return "";
  const a = (href, text) => `<a href="${esc(href)}" target="_blank" rel="noopener nofollow">${esc(text)}</a>`;
  return `<p class="${esc(className)}">Photo by ${a(withUtm(credit.profileUrl), credit.name)} on ${a(`https://unsplash.com/?${UTM}`, "Unsplash")}</p>`;
}

/** Suggested CSS for the hero credit (wired in with page v2). */
export const STOCK_CREDIT_CSS = `.stock-credit{font-size:11px;line-height:1.3;opacity:.75;margin:0}
.stock-credit a{color:inherit;text-decoration:underline}
.hero .stock-credit{position:absolute;right:12px;bottom:8px;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.6)}
@media (max-width:640px){.hero .stock-credit{position:static;color:var(--ink-faint);text-shadow:none;padding:6px 16px 0;text-align:right}}`;

// ── Picking ──────────────────────────────────────────────────────────────

/** Library groups to draw from, best first. Snow businesses get snow photos. */
export function stockPersonasFor(profile = {}) {
  const text = businessText(profile);
  const base = personaFor(profile.primary_category);
  if (/snow|plow/.test(text)) return base === "landscaping" || base === "default" ? ["snow", "landscaping"] : ["snow", base];
  return base === "default" ? [] : [base];
}

function businessText(profile) {
  const services = (Array.isArray(profile.services) ? profile.services : [])
    .map(s => (typeof s === "string" ? s : `${s?.service_name || s?.name || ""}`));
  return [profile.primary_category, ...services].join(" ").toLowerCase();
}

/** service_tags the business's services point at, for one persona. */
export function serviceTagsFor(profile, persona) {
  const text = businessText(profile);
  return (STOCK_QUERIES[persona] || []).filter(q => q.match.test(text)).map(q => q.tag);
}

/** The identity color to match: brand kit, then logo color, then palette. */
export function identityColorFor(profile = {}, kit = null) {
  const hex6 = v => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null);
  return hex6(kit?.identity) || hex6(kit?.identityColor) || hex6(kit?.colors?.identity)
    || hex6(kit?.primary) || hex6(profile.brand_color) || brandTokens(profile).primary;
}

// CIE Lab distance with lightness down-weighted: Unsplash's `color` is a
// photo's average, so it is darker and duller than a brand color; hue and
// chroma matter more than lightness for "feels like the same colors".
function toLab(hex) {
  const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const [r, g, b] = hexToRgb(hex).map(lin);
  const f = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047);
  const y = f(r * 0.2126 + g * 0.7152 + b * 0.0722);
  const z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
export function colorDistance(a, b) {
  if (!/^#[0-9a-f]{6}$/i.test(a || "") || !/^#[0-9a-f]{6}$/i.test(b || "")) return Infinity;
  const [l1, a1, b1] = toLab(a), [l2, a2, b2] = toLab(b);
  return Math.sqrt((0.5 * (l1 - l2)) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2);
}

// Photos within this distance of the best match count as a tie; the
// business_id hash picks among them so neighbors don't share one photo.
export const TIE_BAND = 8;

/**
 * Pure: choose a photo from library rows. Approved rows only; filtered by
 * persona and the business's services (falling back to the whole persona);
 * nearest color to the identity color; ties broken by a hash of business_id.
 * Returns { urls, credit, unsplash_id, row } or null.
 */
export function chooseStockPhoto(rows, profile = {}, kit = null) {
  const approved = (Array.isArray(rows) ? rows : []).filter(r => r && r.approved === true && sizedUrls(r.raw_url));
  let pool = [];
  for (const persona of stockPersonasFor(profile)) {
    const inPersona = approved.filter(r => r.persona === persona);
    if (!inPersona.length) continue;
    const tags = new Set(serviceTagsFor(profile, persona));
    const tagged = inPersona.filter(r => tags.has(r.service_tag));
    pool = tagged.length ? tagged : inPersona;
    break;
  }
  if (!pool.length) return null;

  const target = identityColorFor(profile, kit);
  const scored = pool.map(r => ({ r, d: colorDistance(target, r.color) }));
  const best = Math.min(...scored.map(s => s.d));
  const ties = scored
    .filter(s => (best === Infinity ? true : s.d <= best + TIE_BAND))
    .map(s => s.r)
    .sort((x, y) => (x.unsplash_id < y.unsplash_id ? -1 : x.unsplash_id > y.unsplash_id ? 1 : 0));
  const row = ties[hashString(`${profile.business_id || profile.business_name || ""}:stock`) % ties.length];
  return { urls: sizedUrls(row.raw_url), credit: creditFor(row), unsplash_id: row.unsplash_id, row };
}

const ROW_COLS = "unsplash_id, persona, service_tag, raw_url, width, height, color, blur_hash, alt, photographer_name, photographer_username, photographer_url, photo_page_url, download_location, approved";

/** Thin DB read: approved rows for the business's persona groups. */
export async function loadStockLibrary(supabase, personas) {
  if (!supabase || !personas?.length) return [];
  const { data, error } = await supabase.from("stock_photos").select(ROW_COLS)
    .eq("approved", true).in("persona", personas);
  if (error) throw new Error(`stock_photos: ${error.message}`);
  return data || [];
}

/**
 * pickStockPhoto(profile, kit, { supabase } | { photos }): the photo for this
 * business, or null. Never calls Unsplash. Any DB error → null (the page
 * falls back to its pattern hero).
 */
export async function pickStockPhoto(profile, kit = null, { supabase, photos, log = console } = {}) {
  try {
    const rows = photos || await loadStockLibrary(supabase, stockPersonasFor(profile));
    const pick = chooseStockPhoto(rows, profile, kit);
    if (!pick) return null;
    const { row, ...out } = pick;
    out.photo = { unsplash_id: row.unsplash_id, download_location: row.download_location };
    out.alt = row.alt || "";
    return out;
  } catch (e) {
    log.warn?.("stock photo: none picked:", e?.message || e);
    return null;
  }
}

/**
 * The Unsplash download trigger, once per (business, photo). Call it when a
 * photo is assigned to a business (page generated / first published), not on
 * views. The assignment row's primary key makes a repeat impossible; only the
 * call that inserted it pings download_location.
 * Returns { triggered: boolean, reason }.
 */
export async function trackStockAssignment(photo, businessId, {
  supabase, fetchImpl = globalThis.fetch, accessKey = process.env.UNSPLASH_ACCESS_KEY, slot = "hero", log = console,
} = {}) {
  const id = photo?.unsplash_id;
  const loc = photo?.download_location || photo?.photo?.download_location;
  if (!id || !loc || !businessId || !supabase) return { triggered: false, reason: "missing_input" };
  if (!STOCK_SLOTS.includes(slot)) return { triggered: false, reason: "slot_not_allowed" };
  try {
    const { data, error } = await supabase.from("stock_photo_assignments")
      .upsert({ business_id: businessId, unsplash_id: id, slot, stock_assigned_at: new Date().toISOString() },
        { onConflict: "business_id,unsplash_id", ignoreDuplicates: true })
      .select("business_id");
    if (error) return { triggered: false, reason: `db: ${error.message}` };
    if (!data || !data.length) return { triggered: false, reason: "already_assigned" };
    // From here this call owns the assignment. If the ping can't be made,
    // release the row so the next assignment tries again.
    const release = () => supabase.from("stock_photo_assignments").delete()
      .eq("business_id", businessId).eq("unsplash_id", id).then(() => {}, () => {});
    if (!accessKey) { await release(); return { triggered: false, reason: "no_access_key" }; }
    let r;
    try {
      r = await fetchImpl(loc, { headers: { Authorization: `Client-ID ${accessKey}`, "Accept-Version": "v1" } });
    } catch (e) {
      await release();
      log.warn?.("stock photo: download trigger failed:", e?.message || e);
      return { triggered: false, reason: "error" };
    }
    if (!r.ok) { await release(); log.warn?.(`stock photo: download trigger HTTP ${r.status}`); return { triggered: false, reason: `http_${r.status}` }; }
    await supabase.from("stock_photo_assignments").update({ download_triggered: true })
      .eq("business_id", businessId).eq("unsplash_id", id);
    return { triggered: true, reason: "assigned" };
  } catch (e) {
    log.warn?.("stock photo: assignment failed:", e?.message || e);
    return { triggered: false, reason: "error" };
  }
}
