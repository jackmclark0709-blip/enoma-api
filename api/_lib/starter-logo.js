// api/_lib/starter-logo.js
// "Starter logos": three simple, deterministic wordmarks for a business that
// has no logo yet (small_business_profiles.logo_url empty). Each one is the
// business name set in type, an optional small trade icon, and the page's
// brand identity color (page-style.js brandTokens). Not an image generator: no
// network, no paid APIs, no pictures. Pure functions, unit-tested in
// tests/starter-logo.test.js.
//
// Fonts: the name is set in Archivo, the customer-page font (already loaded
// on every business page from Google Fonts), with a system sans fallback, so
// an SVG used outside the page (or inside an <img>, which can't load web
// fonts) still looks deliberate.
// The trade icons are original line drawings made for Enoma (24x24 grid).

import { personaFor, brandTokens, splitWordmark } from "./page-style.js";

export const STARTER_LOGO_IDS = ["badge", "stacked", "wordmark"];
export const DEFAULT_STARTER_LOGO_ID = "badge";

const SANS = "Archivo, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";
const DISPLAY = SANS;

// ── Trade icons: stroke-only paths on a 24x24 grid, drawn with
// stroke-width 2, round caps and joins. Keep them simple enough to read at 20px.
export const TRADE_ICONS = {
  // Water drop with a highlight.
  plumbing: [
    "M12 2.5c-3 4.2-6.2 7.6-6.2 11.3a6.2 6.2 0 0 0 12.4 0c0-3.7-3.2-7.1-6.2-11.3z",
    "M9 14.3a3 3 0 0 0 3 3",
  ],
  // Fan: hub, three blades, housing ring.
  hvac: [
    "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z",
    "M12 10.5c-.4-2.6.4-4.6 2.6-5.2c1.6 2.4.6 4.6-2.6 5.2z",
    "M13.3 12.8c2.4 1 3.6 2.8 3 5c-2.9.2-4.3-1.7-3-5z",
    "M10.7 12.8c-2.1 1.6-4.2 1.8-5.8.2c1.2-2.6 3.6-2.9 5.8-.2z",
    "M12 11a1 1 0 1 0 0 2a1 1 0 1 0 0-2z",
  ],
  // Lightning bolt.
  electrical: [
    "M13.5 2.5 5 13.5h6.2L10.5 21.5 19 10.5h-6.2z",
  ],
  // Leaf with a center vein.
  landscaping: [
    "M5 19c-.6-8.4 4.8-14 15-14.2c.2 10.2-5.6 15.6-14 15.2",
    "M4 20c3.2-4.4 6.4-7.6 10-10",
  ],
  // Six-armed snowflake.
  snow: [
    "M12 2.5v19", "M3.8 7.2l16.4 9.6", "M3.8 16.8l16.4-9.6",
    "M9.6 4.2 12 6.2l2.4-2", "M9.6 19.8 12 17.8l2.4 2",
    "M3.6 10.6l3.1-.4L5.8 7.3", "M20.4 13.4l-3.1.4.9 2.9",
    "M3.6 13.4l3.1.4-.9 2.9", "M20.4 10.6l-3.1-.4.9-2.9",
  ],
  // Sparkle: one large four-point star and a small one.
  cleaning: [
    "M10 3.5l1.7 5 5 1.7-5 1.7-1.7 5-1.7-5-5-1.7 5-1.7z",
    "M18 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z",
  ],
  // Roofline: pitched roof, a second shingle course and a chimney.
  roofing: [
    "M2.5 14 12 5.5l9.5 8.5",
    "M6 18.5 12 13.2l6 5.3",
    "M16 9.1V4.5h2.6v6.9",
  ],
  // Paint brush: handle, ferrule, bristles.
  painting: [
    "M19.5 3.5 12 11",
    "M10.2 10.2l3.6 3.6",
    "M11 11.6c-2.6-.4-4.6 1-5 3.4-.3 1.9-1.2 3.4-2.8 4.2c3.8 1.4 7.6.4 8.8-2.4.6-1.4.4-3.4-1-5.2z",
  ],
  // Open-ended wrench.
  handyman: [
    "M14.6 6.2a4.4 4.4 0 0 1 5.6-2.6l-2.9 2.9.3 2.1 2.1.3 2.9-2.9a4.4 4.4 0 0 1-5.8 5.4l-8.3 8.3a2 2 0 0 1-2.8-2.8l8.3-8.3a4.4 4.4 0 0 1 .6-2.4z",
  ],
  // House.
  default: [
    "M3 11 12 3.8 21 11",
    "M5.5 9.2V20h13V9.2",
    "M10 20v-5.5h4V20",
  ],
};

// Which icon a business gets. personaFor() collapses categories to a handful
// of page looks; a few trades inside those looks get a more specific icon.
export function tradeIconFor(category) {
  const c = String(category || "").toLowerCase();
  if (/snow/.test(c)) return "snow";
  if (/roof/.test(c)) return "roofing";
  if (/handyman|general contractor/.test(c)) return "handyman";
  const persona = personaFor(category);
  if (persona === "contractor") return "handyman";
  return TRADE_ICONS[persona] ? persona : "default";
}

export function escapeXml(s) {
  return String(s ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[ch]));
}

// ── Name handling ──
// Drop legal suffixes (LLC, Inc, …) from the logo; keep "& Sons", "Co." etc.
const LEGAL = /[,\s]+(l\.?l\.?c\.?|p\.?l\.?l\.?c\.?|l\.?l\.?p\.?|inc\.?|incorporated|corp\.?|corporation|ltd\.?)$/i;
export function logoName(businessName) {
  let name = String(businessName || "").replace(/\s+/g, " ").trim();
  let prev;
  do { prev = name; name = name.replace(LEGAL, "").replace(/[,\s]+$/, "").trim(); } while (name !== prev);
  return name || String(businessName || "").trim() || "Your Business";
}

const CONNECTOR = /^(&|and|of|the|for|\+|-|–|—)$/i;
const MAX_LINE = 18;     // characters per line of the name, roughly
const MAX_DESC = 30;

function trimConnectors(words) {
  const w = [...words];
  while (w.length > 1 && CONNECTOR.test(w[w.length - 1])) w.pop();
  return w;
}

// First three words, but never stopping on a dangling "&"/"and"
// ("Bob Smith & Sons Plumbing" -> "Bob Smith & Sons").
function firstWords(words, n = 3) {
  let out = words.slice(0, n);
  if (CONNECTOR.test(out[out.length - 1]) && words[n]) out = words.slice(0, n + 1);
  return trimConnectors(out);
}

// Best two-line break: the most even split that doesn't leave "&"/"and"
// at the end of line one (so "& Sons" stays together).
function twoLines(words) {
  let best = null;
  for (let i = 1; i < words.length; i++) {
    if (CONNECTOR.test(words[i - 1])) continue;
    const a = words.slice(0, i).join(" "), b = words.slice(i).join(" ");
    const score = Math.max(a.length, b.length);
    if (!best || score < best.score) best = { lines: [a, b], score };
  }
  return best;
}

// Lines for the main name: one line if short, two if that fits, else the
// first three words (wrapped if they still don't fit on one line).
export function nameLines(main) {
  const text = String(main || "").trim();
  if (text.length <= MAX_LINE) return [text];
  const words = text.split(" ");
  const split = twoLines(words);
  if (split && split.score <= MAX_LINE + 4 && words.length <= 6) return split.lines;
  const short = firstWords(words, 3);
  const joined = short.join(" ");
  if (joined.length <= MAX_LINE + 2 || short.length < 2) return [joined];
  return twoLines(short)?.lines || [joined];
}

function shortDescriptor(desc) {
  const d = String(desc || "").trim();
  if (d.length <= MAX_DESC) return d;
  const words = d.split(" ");
  let out = [];
  for (const w of words) {
    if ([...out, w].join(" ").length > MAX_DESC) break;
    out.push(w);
  }
  return trimConnectors(out).join(" ");
}

// Main name + small descriptor line, e.g. "Foley & Sons" / "Landscaping".
export function logoText(businessName) {
  const name = logoName(businessName);
  const { main, descriptor } = splitWordmark(name);
  return { name, lines: nameLines(main || name), descriptor: shortDescriptor(descriptor) };
}

// ── Rough text metrics (no font files on the server). Deliberately a touch
// generous so text never overflows the viewBox in the fallback fonts.
function charWidth(ch) {
  if (ch === " ") return 0.26;
  if (/[iljI.,'’:;!|]/.test(ch)) return 0.32;
  if (/[frt()\-]/.test(ch)) return 0.42;
  if (/[mwMW]/.test(ch)) return 0.92;
  if (ch === "&") return 0.78;
  if (/[A-Z]/.test(ch)) return 0.72;
  if (/[0-9]/.test(ch)) return 0.6;
  return 0.57;
}
export function textWidth(text, size) {
  let w = 0;
  for (const ch of String(text)) w += charWidth(ch);
  return w * size;
}
function capsWidth(text, size, tracking) {
  const t = String(text).toUpperCase();
  return t.length ? textWidth(t, size) * 0.92 + tracking * (t.length - 1) : 0;
}

const r1 = n => Math.round(n * 10) / 10;

// Fit the name: shrink the font until the widest line fits maxWidth.
function fitSize(lines, start, min, maxWidth) {
  let size = start;
  while (size > min && Math.max(...lines.map(l => textWidth(l, size))) > maxWidth) size -= 1;
  return size;
}

function colorsFor(palette, tone) {
  return tone === "dark"
    ? { ink: "#ffffff", accent: palette.light, chip: palette.primary, chipIcon: "#ffffff", soft: palette.light }
    : { ink: palette.bg, accent: palette.primary, chip: palette.primary, chipIcon: "#ffffff", soft: palette.primary };
}

function iconGroup(key, { x, y, size, color, width = 2 }) {
  const paths = TRADE_ICONS[key] || TRADE_ICONS.default;
  const s = size / 24;
  return `<g transform="translate(${r1(x)} ${r1(y)}) scale(${r1(s * 100) / 100})" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${paths.map(d => `<path d="${d}"/>`).join("")}</g>`;
}

function nameTspans(lines, { x, y0, lineHeight }) {
  return lines.map((l, i) => `<tspan x="${r1(x)}" y="${r1(y0 + i * lineHeight)}">${escapeXml(l)}</tspan>`).join("");
}

function svgWrap(w, h, title, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.ceil(w)} ${Math.ceil(h)}" width="${Math.ceil(w)}" height="${Math.ceil(h)}" role="img" aria-label="${escapeXml(title)}"><title>${escapeXml(title)}</title>${body}</svg>`;
}

// (a) badge: icon in a rounded square, name to the right.
function badgeSvg(t, icon, c) {
  const chip = 64, gap = 16, x0 = chip + gap;
  const two = t.lines.length > 1;
  const size = fitSize(t.lines, two ? 26 : 32, 18, 300);
  const lh = size * 1.06;
  const descSize = 10.5, tracking = 2.2;
  const nameH = size * 0.74 + (t.lines.length - 1) * lh;
  const blockH = nameH + (t.descriptor ? 10 + descSize * 0.74 : 0);
  const h = Math.max(chip, blockH) + 4;
  const top = (h - blockH) / 2;
  const y0 = top + size * 0.74;
  const descY = top + nameH + 10 + descSize * 0.74;
  const w = x0 + Math.max(...t.lines.map(l => textWidth(l, size)), capsWidth(t.descriptor, descSize, tracking)) + 4;
  const chipY = (h - chip) / 2;
  const body =
    `<rect x="0" y="${r1(chipY)}" width="${chip}" height="${chip}" rx="15" fill="${c.chip}"/>` +
    iconGroup(icon, { x: 16, y: chipY + 16, size: 32, color: c.chipIcon, width: 2 }) +
    `<text font-family="${DISPLAY}" font-weight="800" font-size="${size}" letter-spacing="-0.4" fill="${c.ink}">${nameTspans(t.lines, { x: x0, y0, lineHeight: lh })}</text>` +
    (t.descriptor ? `<text x="${x0}" y="${r1(descY)}" font-family="${SANS}" font-weight="700" font-size="${descSize}" letter-spacing="${tracking}" fill="${c.accent}">${escapeXml(t.descriptor.toUpperCase())}</text>` : "");
  return { w, h, body };
}

// (b) stacked: icon above the name, centered.
function stackedSvg(t, icon, c) {
  const iconSize = 40;
  const size = fitSize(t.lines, t.lines.length > 1 ? 26 : 30, 18, 280);
  const lh = size * 1.06;
  const descSize = 10.5, tracking = 2.4;
  const textW = Math.max(...t.lines.map(l => textWidth(l, size)), capsWidth(t.descriptor, descSize, tracking));
  const w = Math.max(textW, iconSize + 40) + 8;
  const cx = w / 2;
  const y0 = iconSize + 16 + size * 0.74;
  const lastY = y0 + (t.lines.length - 1) * lh;
  const descY = lastY + 12 + descSize * 0.74 + 4;
  const h = (t.descriptor ? descY : lastY) + 6;
  const body =
    iconGroup(icon, { x: cx - iconSize / 2, y: 2, size: iconSize, color: c.soft, width: 1.8 }) +
    `<text text-anchor="middle" font-family="${DISPLAY}" font-weight="800" font-size="${size}" letter-spacing="-0.4" fill="${c.ink}">${nameTspans(t.lines, { x: cx, y0, lineHeight: lh })}</text>` +
    (t.descriptor
      ? `<rect x="${r1(cx - 14)}" y="${r1(lastY + 9)}" width="28" height="1.5" fill="${c.accent}" opacity=".7"/>` +
        `<text x="${r1(cx)}" y="${r1(descY + 4)}" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="${descSize}" letter-spacing="${tracking}" fill="${c.accent}">${escapeXml(t.descriptor.toUpperCase())}</text>`
      : "");
  return { w, h: h + (t.descriptor ? 4 : 0), body };
}

// (c) wordmark: name only, with a short accent bar.
function wordmarkSvg(t, c) {
  const size = fitSize(t.lines, t.lines.length > 1 ? 30 : 36, 20, 320);
  const lh = size * 1.04;
  const descSize = 10.5, tracking = 2.4;
  const barH = 5, y0 = barH + 12 + size * 0.74;
  const lastY = y0 + (t.lines.length - 1) * lh;
  const descY = lastY + 10 + descSize * 0.74 + 4;
  const w = Math.max(...t.lines.map(l => textWidth(l, size)), capsWidth(t.descriptor, descSize, tracking), 40) + 4;
  const h = (t.descriptor ? descY : lastY) + 8;
  const body =
    `<rect x="1" y="0" width="34" height="${barH}" rx="2.5" fill="${c.accent}"/>` +
    `<text font-family="${DISPLAY}" font-weight="800" font-size="${size}" letter-spacing="-0.6" fill="${c.ink}">${nameTspans(t.lines, { x: 0, y0, lineHeight: lh })}</text>` +
    (t.descriptor ? `<text x="1" y="${r1(descY)}" font-family="${SANS}" font-weight="700" font-size="${descSize}" letter-spacing="${tracking}" fill="${c.accent}">${escapeXml(t.descriptor.toUpperCase())}</text>` : "");
  return { w, h, body };
}

// One option. tone "light" = dark ink for light backgrounds (the default,
// a normal logo); "dark" = white ink for the page's dark hero.
export function starterLogoSvg(profile, id = DEFAULT_STARTER_LOGO_ID, { tone = "light" } = {}) {
  const p = profile || {};
  // The page's identity color: the palette primary, or brand_color when set.
  const palette = brandTokens(p);
  const c = colorsFor(palette, tone);
  const t = logoText(p.business_name);
  const icon = tradeIconFor(p.primary_category);
  const kind = STARTER_LOGO_IDS.includes(id) ? id : DEFAULT_STARTER_LOGO_ID;
  const { w, h, body } = kind === "stacked" ? stackedSvg(t, icon, c) : kind === "wordmark" ? wordmarkSvg(t, c) : badgeSvg(t, icon, c);
  return svgWrap(w, h, `${t.name} logo`, body);
}

// Exactly three options, same order every time.
export function starterLogoOptions(profile, opts = {}) {
  return STARTER_LOGO_IDS.map(id => ({ id, svg: starterLogoSvg(profile, id, opts) }));
}

// The option a page should show: the owner's pick if valid, else the badge.
export function chosenStarterLogoId(profile) {
  const id = String(profile?.starter_logo_id || "");
  return STARTER_LOGO_IDS.includes(id) ? id : DEFAULT_STARTER_LOGO_ID;
}

export function isStarterLogoId(id) {
  return STARTER_LOGO_IDS.includes(String(id || ""));
}
