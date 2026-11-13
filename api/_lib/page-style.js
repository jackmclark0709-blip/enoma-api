// api/_lib/page-style.js
// Pure helpers for how a business page *looks* when we have little to go on —
// no logo, no photos, thin Google data. Used by api/p.js (server render) and
// unit-tested in tests/page-style.test.js. No network, no DB.

import { US_STATE_NAMES, US_STATE_ABBR } from "./service-utils.js";

// Full state name → postal code for any US state; anything else passes through.
const STATE_CODES = Object.fromEntries(US_STATE_NAMES.map((n, i) => [n, US_STATE_ABBR[i].toUpperCase()]));
function stateCode(s) { const v = String(s || "").trim(); return STATE_CODES[v.toLowerCase()] || v; }

// ── Persona: collapse free-text categories ("hvac contractor", "Plumber",
// "house cleaning service") into the handful of looks we design for.
const PERSONA_RULES = [
  [/landscap|lawn|garden|tree|snow|yard|hardscap|mulch/, "landscaping"],
  [/plumb|heating|drain|septic|water heater/, "plumbing"],
  [/hvac|air condition|furnace|heat pump|cooling/, "hvac"],
  [/electric/, "electrical"],
  [/clean|maid|janitor|pressure wash|power wash/, "cleaning"],
  [/paint/, "painting"],
  [/roof|contractor|construct|remodel|carpent|handyman|paving|asphalt|mason|concrete|builder|siding/, "contractor"],
];

export function personaFor(category) {
  const c = String(category || "").toLowerCase();
  for (const [re, persona] of PERSONA_RULES) if (re.test(c)) return persona;
  return "default";
}

// ── Call-to-action colors. A bright, light action color that differs clearly
// from the identity color in lightness (and usually hue). Amber by default;
// bright teal when the identity color is itself gold/amber, so the two never
// look alike. ctaText on cta: 8.9:1 (amber), 6.9:1 (teal).
export const AMBER = Object.freeze({ cta: "#F2A93B", ctaText: "#1a1714" });
export const TEAL = Object.freeze({ cta: "#2BB3A3", ctaText: "#1a1714" });

// Neutral page tokens (text, lines, chips). Same values as the defaults in
// public/styles/business-base.css :root.
export const NEUTRALS = Object.freeze({
  ink: "#1a1714", inkMuted: "#4a4540", inkFaint: "#6b655d",
  line: "#e6e1d9", lineStrong: "#cfc7bb", chipBg: "#ebe5dc",
});

// ── Palettes: several hand-picked, dark-hero palettes per persona, so two
// landscapers in the same town don't get identical pages. Each has:
//   bg      hero base (dark)        bg2   hero gradient end
//   primary buttons / accents       light accent on dark
//   rgb     primary as "r,g,b"      name  for debugging
const PALETTES = {
  landscaping: [
    { name: "forest",  bg: "#0f1f14", bg2: "#1b3322", primary: "#2f6b3a", light: "#8cc79a", rgb: "47,107,58", ...AMBER },
    { name: "moss",    bg: "#171c10", bg2: "#2a3319", primary: "#5a6e2a", light: "#c3d38a", rgb: "90,110,42", ...AMBER },
    { name: "pine",    bg: "#0c1a1a", bg2: "#15302c", primary: "#1f5e55", light: "#86cbbf", rgb: "31,94,85", ...AMBER },
  ],
  plumbing: [
    { name: "navy",    bg: "#0b1526", bg2: "#14264a", primary: "#1f4f8f", light: "#8fb6ea", rgb: "31,79,143", ...AMBER },
    { name: "copper",  bg: "#141820", bg2: "#232a38", primary: "#b0643a", light: "#e7a67f", rgb: "176,100,58", ...AMBER },
    { name: "harbor",  bg: "#0a1a22", bg2: "#123140", primary: "#1c6a86", light: "#86c6dc", rgb: "28,106,134", ...AMBER },
  ],
  hvac: [
    { name: "frost",   bg: "#0b1822", bg2: "#132c3c", primary: "#1f7196", light: "#8fd0ea", rgb: "31,113,150", ...AMBER },
    { name: "ember",   bg: "#1a1210", bg2: "#2e1d18", primary: "#b4502e", light: "#f0a07e", rgb: "180,80,46", ...AMBER },
    { name: "slate",   bg: "#12161c", bg2: "#222a34", primary: "#3d5a80", light: "#a3b8d6", rgb: "61,90,128", ...AMBER },
  ],
  electrical: [
    { name: "volt",    bg: "#14130c", bg2: "#28251a", primary: "#b8860b", light: "#f2cf5b", rgb: "184,134,11", ...TEAL },
    { name: "graphite",bg: "#111317", bg2: "#20242c", primary: "#d08a1a", light: "#f4c26b", rgb: "208,138,26", ...TEAL },
    { name: "indigo",  bg: "#10122a", bg2: "#1d2150", primary: "#3b44a8", light: "#a8aef0", rgb: "59,68,168", ...AMBER },
  ],
  cleaning: [
    { name: "mint",    bg: "#0c1c1a", bg2: "#14332e", primary: "#1f8a72", light: "#8fe0cb", rgb: "31,138,114", ...AMBER },
    { name: "sky",     bg: "#0d1a26", bg2: "#173048", primary: "#2a7fc0", light: "#9ccaf0", rgb: "42,127,192", ...AMBER },
    { name: "lilac",   bg: "#16132a", bg2: "#282348", primary: "#6a55b8", light: "#c4b8f2", rgb: "106,85,184", ...AMBER },
  ],
  painting: [
    { name: "terracotta", bg: "#1c1310", bg2: "#33221b", primary: "#b0543a", light: "#efa58c", rgb: "176,84,58", ...AMBER },
    { name: "teal",    bg: "#0c1a1c", bg2: "#153236", primary: "#1f7a80", light: "#8fd3d8", rgb: "31,122,128", ...AMBER },
    { name: "plum",    bg: "#1a1020", bg2: "#2f1d3a", primary: "#7a3f8f", light: "#d3a6e3", rgb: "122,63,143", ...AMBER },
  ],
  contractor: [
    { name: "timber",  bg: "#1a140e", bg2: "#2f2418", primary: "#8a5a24", light: "#e0b27a", rgb: "138,90,36", ...AMBER },
    { name: "steel",   bg: "#121519", bg2: "#232830", primary: "#4a5a6e", light: "#b3c0d0", rgb: "74,90,110", ...AMBER },
    { name: "brick",   bg: "#1c110f", bg2: "#331e1a", primary: "#9a3f2c", light: "#e8a08e", rgb: "154,63,44", ...AMBER },
  ],
  default: [
    { name: "ink",     bg: "#0b1422", bg2: "#162640", primary: "#2f6fbf", light: "#9cc3f0", rgb: "47,111,191", ...AMBER },
    { name: "charcoal",bg: "#131417", bg2: "#24262c", primary: "#4f5d73", light: "#b8c2d3", rgb: "79,93,115", ...AMBER },
    { name: "evergreen", bg: "#0f1c16", bg2: "#1a3328", primary: "#2c6b4f", light: "#93cfb3", rgb: "44,107,79", ...AMBER },
  ],
};

// Small stable string hash (FNV-1a) — same business always gets the same palette.
export function hashString(s) {
  let h = 0x811c9dc5;
  for (const ch of String(s || "")) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function pickPalette(category, businessName) {
  const list = PALETTES[personaFor(category)] || PALETTES.default;
  return list[hashString(businessName) % list.length];
}

/** Every palette, flattened (tests and tooling). */
export function allPalettes() {
  return Object.entries(PALETTES).flatMap(([persona, list]) => list.map(p => ({ persona, ...p })));
}

// ── Color math (hex in, hex out). Shared with the browser copy in
// public/scripts/brand-color.js; tests/brand-color.test.js runs both
// against one fixture so they can't drift.
export function hexToRgb(hex) {
  const m = String(hex || "").trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgbToHex([r, g, b]) {
  return "#" + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}
export function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60; if (h < 0) h += 360;
  return { h, s, l };
}
export function relativeLuminance([r, g, b]) {
  const a = [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}
export function contrastRatio(hexA, hexB) {
  const la = relativeLuminance(hexToRgb(hexA)), lb = relativeLuminance(hexToRgb(hexB));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The CTA color for a logo-derived identity color. TEAL when the identity is
 * itself amber/gold/yellow-orange (hue 24°–60°, saturated, not dark), so the
 * button never looks like the brand; AMBER otherwise. Brown (low saturation),
 * terracotta and copper (hue under 24°) keep amber: they differ from it in
 * hue and lightness. Agrees with the hand-set palettes: ctaFor(primary) is
 * each palette's own cta.
 */
export function ctaFor(identityHex) {
  const rgb = hexToRgb(identityHex);
  if (!rgb) return AMBER;
  const { h, s, l } = rgbToHsl(rgb);
  return h >= 24 && h <= 60 && s >= 0.6 && l >= 0.35 ? TEAL : AMBER;
}

/** The CTA mixed 10% toward black (hover). CSS uses color-mix for the same. */
export function ctaHover(cta) {
  const rgb = hexToRgb(cta);
  return rgb ? rgbToHex(rgb.map(v => v * 0.9)) : cta;
}

/**
 * A logo color usable as the page's identity color: darken until it's dark
 * enough to read as an accent on white (same rule profile.js has always used).
 */
export function ensureUsableBrandColor([r, g, b]) {
  let lum = relativeLuminance([r, g, b]);
  while (lum > 0.55) { r *= 0.88; g *= 0.88; b *= 0.88; lum = relativeLuminance([r, g, b]); }
  return rgbToHex([r, g, b]);
}

/**
 * The dominant color of a logo from raw RGBA pixels (64x64 is plenty):
 * transparent, near-white and near-black pixels skipped, the rest bucketed
 * to steps of 16, the biggest bucket wins. Returns a usable hex or null.
 */
export function dominantColorFromPixels(data) {
  const counts = new Map();
  for (let i = 0; i + 3 < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    if (a < 200 || (r > 235 && g > 235 && b > 235) || (r < 30 && g < 30 && b < 30)) continue;
    const key = `${Math.round(r / 16) * 16},${Math.round(g / 16) * 16},${Math.round(b / 16) * 16}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let best = null, bestN = 0;
  for (const [k, n] of counts) if (n > bestN) { best = k; bestN = n; }
  if (!best) return null;
  return ensureUsableBrandColor(best.split(",").map(v => Math.min(255, Number(v))));
}

const isHex6 = v => /^#[0-9a-fA-F]{6}$/.test(String(v || ""));

/**
 * Every color a customer page uses, from its palette and (when the owner
 * uploaded a logo and we read its color) brand_color. The identity color
 * (primary) is for small accents; cta is for filled buttons only.
 */
export function brandTokens(profile = {}) {
  const pal = pickPalette(profile.primary_category, profile.business_name);
  if (!isHex6(profile.brand_color)) return { ...pal, fromLogo: false };
  const primary = profile.brand_color.toLowerCase();
  return { ...pal, primary, rgb: hexToRgb(primary).join(","), ...ctaFor(primary), fromLogo: true };
}

/**
 * The <style> block of CSS variables for a customer page (company page,
 * Service Spotlight, review page, and the page inside /<slug>/preview).
 */
export function brandColorStyle(profile = {}, heroPhoto = null) {
  const persona = personaFor(profile.primary_category);
  const c = brandTokens(profile);
  const pattern = heroPatternSvg(persona, c, (profile.business_name || "").length * 7919);
  // CSS url() inside a custom property: quote it and escape any quotes.
  const cssUrl = u => `url("${String(u).replace(/"/g, '%22')}")`;
  const n = NEUTRALS;
  return `<style id="server-brand-colors">
  :root {
    --brand-primary: ${c.primary};
    --brand-light: ${c.light};
    --brand-primary-10: color-mix(in srgb, ${c.primary} 10%, white);
    --brand-primary-30: color-mix(in srgb, ${c.primary} 28%, white);
    --brand-rgb: ${c.rgb};
    --brand-cta: ${c.cta};
    --brand-cta-text: ${c.ctaText};
    --brand-cta-hover: color-mix(in srgb, ${c.cta}, black 10%);
    --ink: ${n.ink}; --ink-muted: ${n.inkMuted}; --ink-faint: ${n.inkFaint}; --line: ${n.line}; --line-strong: ${n.lineStrong}; --chip-bg: ${n.chipBg};
    --biz-heading-stretch: ${headingStretchFor(persona)};
    --hero-bg: ${c.bg};
    --hero-bg2: ${c.bg2};
    --hero-pattern: ${cssUrl(pattern)};
    ${heroPhoto ? `--hero-photo: ${cssUrl(heroPhoto)};` : ""}
  }
</style>`;
}

// Heading width per trade (same Archivo file, its wdth axis): narrower and
// tougher for building trades, a little wider for the softer ones.
const NARROW_PERSONAS = new Set(["contractor", "electrical", "hvac", "plumbing"]);
export function headingStretchFor(persona) {
  return NARROW_PERSONAS.has(persona) ? "85%" : "92%";
}

// ── Wordmark: turn "A&D Landscaping Services Inc" into a designed two-line
// mark — main: "A&D", descriptor: "Landscaping Services". Reads as an
// intentional logotype instead of a placeholder monogram circle.
const LEGAL_SUFFIX = /[,\s]+(inc\.?|llc\.?|l\.l\.c\.?|co\.?|corp\.?|corporation|company|ltd\.?)$/i;
const TRADE_WORDS = /\b(landscaping|landscape|lawn|lawncare|gardening|tree|snow|property|maintenance|plumbing|plumber|heating|cooling|hvac|air|mechanical|electric|electrical|electrician|cleaning|painting|painters?|roofing|construction|contracting|contractors?|remodeling|builders?|paving|asphalt|masonry|services?|solutions|care|pros?)\b/i;

export function splitWordmark(businessName) {
  let name = String(businessName || "").trim();
  while (LEGAL_SUFFIX.test(name)) name = name.replace(LEGAL_SUFFIX, "").trim();
  if (!name) return { main: String(businessName || "").trim(), descriptor: "" };
  const words = name.split(/\s+/);
  const idx = words.findIndex((w, i) => i > 0 && TRADE_WORDS.test(w.replace(/[^a-z&]/gi, "")));
  if (idx > 0) {
    const main = words.slice(0, idx).join(" ").replace(/\b(and|&)$/i, "").trim();
    // "Foley and Son Landscaping" -> main "Foley and Son", descriptor "Landscaping"
    return { main: main || words[0], descriptor: words.slice(idx).join(" ") };
  }
  return { main: name, descriptor: "" };
}

// ── Hero texture: a subtle, persona-specific line pattern (topographic
// contours for outdoor trades, a blueprint grid for building trades, soft
// rings for cleaning). Deterministic per business so it's stable across loads.
export function heroPatternSvg(persona, palette, seed = 0) {
  const stroke = palette.light;
  const w = 1200, h = 600;
  let body = "";
  if (persona === "landscaping" || persona === "default") {
    // Topographic contour lines: stacked wavy paths
    const rnd = mulberry32(seed || 1);
    for (let i = 0; i < 14; i++) {
      const y0 = 30 + i * 44;
      const amp = 10 + rnd() * 26;
      const ph = rnd() * Math.PI * 2;
      const freq = 1.2 + rnd() * 1.4;
      let d = "";
      for (let x = 0; x <= w; x += 40) {
        const y = y0 + Math.sin((x / w) * Math.PI * 2 * freq + ph) * amp;
        d += (x === 0 ? "M" : "L") + x + " " + y.toFixed(1) + " ";
      }
      body += `<path d="${d.trim()}" fill="none" stroke="${stroke}" stroke-opacity="${(0.05 + (i % 3) * 0.02).toFixed(2)}" stroke-width="1.2"/>`;
    }
  } else if (persona === "cleaning") {
    for (let i = 1; i <= 9; i++) {
      body += `<circle cx="${w * 0.82}" cy="${h * 0.3}" r="${i * 60}" fill="none" stroke="${stroke}" stroke-opacity="${(0.1 - i * 0.008).toFixed(3)}" stroke-width="1"/>`;
    }
  } else {
    // Blueprint grid with a few heavier guide lines
    for (let x = 0; x <= w; x += 40) {
      body += `<line x1="${x}" y1="0" x2="${x}" y2="${h}" stroke="${stroke}" stroke-opacity="${x % 200 === 0 ? 0.09 : 0.04}" stroke-width="1"/>`;
    }
    for (let y = 0; y <= h; y += 40) {
      body += `<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="${stroke}" stroke-opacity="${y % 200 === 0 ? 0.09 : 0.04}" stroke-width="1"/>`;
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice">${body}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Social proof gating: "4★ from 1 Google review" reads worse than saying
// nothing. Only show a rating that actually helps.
export function isStrongRating(rating, count) {
  const r = Number(rating), n = Number(count);
  return Number.isFinite(r) && Number.isFinite(n) && r >= 4.5 && n >= 5;
}

// ── Review quotes: pick the best few real Google reviews to show as
// testimonials — 4–5 stars, substantive but not a wall of text.
export function pickReviewQuotes(reviews, max = 3) {
  if (!Array.isArray(reviews)) return [];
  return reviews
    .map(r => ({
      quote: String(r?.text?.text ?? r?.text ?? "").trim(),
      author: r?.authorAttribution?.displayName || r?.author || "Google reviewer",
      rating: Number(r?.rating) || 0,
      source: "google",
    }))
    .filter(r => r.rating >= 4 && r.quote.length >= 40)
    .sort((a, b) => b.rating - a.rating || Math.abs(a.quote.length - 220) - Math.abs(b.quote.length - 220))
    .slice(0, max)
    .map(r => ({ ...r, quote: r.quote.length > 360 ? r.quote.slice(0, 357).replace(/\s+\S*$/, "") + "…" : r.quote }));
}

// ── Weak rating claims baked into generated copy. Auto-built preview pages
// write things like "Rated 4★ on Google in Mansfield, MA." or "4★ from 1
// Google review" straight into the tagline, trust badges and why-choose-us.
// When the rating isn't strong (isStrongRating), drop those lines and give the
// tagline a neutral replacement instead of advertising a thin rating.
const RATING_CLAIM = /(\d(?:\.\d)?)\s*★(?:[^.\n]*?from\s+(\d+)\s+google\s+reviews?)?/i;

function ratingClaimIsWeak(text) {
  const m = String(text || "").match(RATING_CLAIM);
  if (!m) return false;
  const rating = Number(m[1]);
  const count = m[2] ? Number(m[2]) : 0; // "Rated 4★ on Google" with no count = unknown, treat as weak
  return !isStrongRating(rating, count);
}

export function stripWeakRatingClaims(profile) {
  if (!profile) return profile;
  const out = { ...profile };
  const tradeWord = {
    landscaping: "Landscaping and lawn care", plumbing: "Plumbing and heating", hvac: "Heating and cooling",
    electrical: "Electrical work", cleaning: "Cleaning", painting: "Painting", contractor: "Building and repair work",
  }[personaFor(out.primary_category)] || "Local service";
  const where = out.city ? ` in ${out.city}${out.state ? ", " + stateCode(out.state) : ""}` : "";

  if (ratingClaimIsWeak(out.hero_tagline)) {
    // No "free": that's only for a business that offers free estimates.
    out.hero_tagline = `${tradeWord}${where} — call for a quote.`;
  }
  if (Array.isArray(out.trust_badges)) {
    out.trust_badges = out.trust_badges.filter(b => !ratingClaimIsWeak(b));
  }
  if (Array.isArray(out.why_choose_us)) {
    out.why_choose_us = out.why_choose_us.filter(w => !ratingClaimIsWeak(typeof w === "string" ? w : (w?.title || "")));
  } else if (typeof out.why_choose_us === "string") {
    out.why_choose_us = out.why_choose_us.split("\n").filter(l => !ratingClaimIsWeak(l)).join("\n");
  }
  return out;
}

// ── Generated headlines often read "Attleboro Paving — C Ryan Asphalt Paving".
// With the wordmark already showing the name, drop the repeated name.
export function tidyHeadline(headline, businessName) {
  const h = String(headline || "").trim();
  const name = String(businessName || "").trim();
  if (!h || !name) return h;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const stripped = h.replace(new RegExp(`\\s*[—–|-]\\s*${esc}\\s*$`, "i"), "").trim();
  return stripped.length >= 6 ? stripped : h;
}
