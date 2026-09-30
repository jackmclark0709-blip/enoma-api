// api/_lib/page-style.js
// Pure helpers for how a business page *looks* when we have little to go on —
// no logo, no photos, thin Google data. Used by api/p.js (server render) and
// unit-tested in tests/page-style.test.js. No network, no DB.

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

// ── Palettes: several hand-picked, dark-hero palettes per persona, so two
// landscapers in the same town don't get identical pages. Each has:
//   bg      hero base (dark)        bg2   hero gradient end
//   primary buttons / accents       light accent on dark
//   rgb     primary as "r,g,b"      name  for debugging
const PALETTES = {
  landscaping: [
    { name: "forest",  bg: "#0f1f14", bg2: "#1b3322", primary: "#2f6b3a", light: "#8cc79a", rgb: "47,107,58" },
    { name: "moss",    bg: "#171c10", bg2: "#2a3319", primary: "#5a6e2a", light: "#c3d38a", rgb: "90,110,42" },
    { name: "pine",    bg: "#0c1a1a", bg2: "#15302c", primary: "#1f5e55", light: "#86cbbf", rgb: "31,94,85" },
  ],
  plumbing: [
    { name: "navy",    bg: "#0b1526", bg2: "#14264a", primary: "#1f4f8f", light: "#8fb6ea", rgb: "31,79,143" },
    { name: "copper",  bg: "#141820", bg2: "#232a38", primary: "#b0643a", light: "#e7a67f", rgb: "176,100,58" },
    { name: "harbor",  bg: "#0a1a22", bg2: "#123140", primary: "#1c6a86", light: "#86c6dc", rgb: "28,106,134" },
  ],
  hvac: [
    { name: "frost",   bg: "#0b1822", bg2: "#132c3c", primary: "#1f7196", light: "#8fd0ea", rgb: "31,113,150" },
    { name: "ember",   bg: "#1a1210", bg2: "#2e1d18", primary: "#b4502e", light: "#f0a07e", rgb: "180,80,46" },
    { name: "slate",   bg: "#12161c", bg2: "#222a34", primary: "#3d5a80", light: "#a3b8d6", rgb: "61,90,128" },
  ],
  electrical: [
    { name: "volt",    bg: "#14130c", bg2: "#28251a", primary: "#b8860b", light: "#f2cf5b", rgb: "184,134,11" },
    { name: "graphite",bg: "#111317", bg2: "#20242c", primary: "#d08a1a", light: "#f4c26b", rgb: "208,138,26" },
    { name: "indigo",  bg: "#10122a", bg2: "#1d2150", primary: "#3b44a8", light: "#a8aef0", rgb: "59,68,168" },
  ],
  cleaning: [
    { name: "mint",    bg: "#0c1c1a", bg2: "#14332e", primary: "#1f8a72", light: "#8fe0cb", rgb: "31,138,114" },
    { name: "sky",     bg: "#0d1a26", bg2: "#173048", primary: "#2a7fc0", light: "#9ccaf0", rgb: "42,127,192" },
    { name: "lilac",   bg: "#16132a", bg2: "#282348", primary: "#6a55b8", light: "#c4b8f2", rgb: "106,85,184" },
  ],
  painting: [
    { name: "terracotta", bg: "#1c1310", bg2: "#33221b", primary: "#b0543a", light: "#efa58c", rgb: "176,84,58" },
    { name: "teal",    bg: "#0c1a1c", bg2: "#153236", primary: "#1f7a80", light: "#8fd3d8", rgb: "31,122,128" },
    { name: "plum",    bg: "#1a1020", bg2: "#2f1d3a", primary: "#7a3f8f", light: "#d3a6e3", rgb: "122,63,143" },
  ],
  contractor: [
    { name: "timber",  bg: "#1a140e", bg2: "#2f2418", primary: "#8a5a24", light: "#e0b27a", rgb: "138,90,36" },
    { name: "steel",   bg: "#121519", bg2: "#232830", primary: "#4a5a6e", light: "#b3c0d0", rgb: "74,90,110" },
    { name: "brick",   bg: "#1c110f", bg2: "#331e1a", primary: "#9a3f2c", light: "#e8a08e", rgb: "154,63,44" },
  ],
  default: [
    { name: "ink",     bg: "#0b1422", bg2: "#162640", primary: "#2f6fbf", light: "#9cc3f0", rgb: "47,111,191" },
    { name: "charcoal",bg: "#131417", bg2: "#24262c", primary: "#4f5d73", light: "#b8c2d3", rgb: "79,93,115" },
    { name: "evergreen", bg: "#0f1c16", bg2: "#1a3328", primary: "#2c6b4f", light: "#93cfb3", rgb: "44,107,79" },
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
    electrical: "Electrical work", cleaning: "Cleaning", painting: "Painting", contractor: "Quality work",
  }[personaFor(out.primary_category)] || "Local, reliable service";
  const where = out.city ? ` in ${out.city}${out.state ? ", " + String(out.state).replace(/^Massachusetts$/i, "MA").replace(/^Rhode Island$/i, "RI").replace(/^Connecticut$/i, "CT") : ""}` : "";

  if (ratingClaimIsWeak(out.hero_tagline)) {
    out.hero_tagline = `${tradeWord}${where} — call for a free, no-obligation quote.`;
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
