// api/_lib/launch-kit-art.js
// The launch kit's pictures as satori element trees (rendered by @vercel/og
// in launch-kit-render.js, the same pipeline as the share card in og-card.js).
// Colors, wordmark, scene and photo all come from the brand kit; the words
// come from piecesFor() in launch-kit.js. Pure: tested in tests/launch-kit.test.js.
//
// Every tree takes { watermark }: before the owner's $1 claim the previews
// carry a small diagonal "Preview" ribbon in the top-right corner.

import QRCode from "qrcode";
import { COVER, POST, CARD, BADGE } from "./launch-kit.js";
import { sceneDataUrl } from "./trade-scenes.js";
import { tradeIconSvg } from "./starter-logo.js";
import { hexToRgb, rgbToHex } from "./page-style.js";
import { sceneKeyFor } from "./brand-kit.js";

const h = (type, style = {}, children = [], extra = {}) => ({ type, props: { style: { display: "flex", ...style }, children, ...extra } });
const deep = hex => { const rgb = hexToRgb(hex); return rgb ? rgbToHex(rgb.map(v => v * 0.72)) : hex; };
const svgUrl = svg => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
const INK = "#1a1714";

export const WATERMARK_TEXT = "PREVIEW";

/** The diagonal "Preview" ribbon across the top-right corner. */
export function watermarkRibbon(W, H) {
  const S = Math.max(Math.min(W, H), W * 0.5);
  const L = Math.round(S * 0.46), T = Math.round(S * 0.075);
  const cx = W - S * 0.13, cy = S * 0.13;
  return h("div", {
    position: "absolute", left: Math.round(cx - L / 2), top: Math.round(cy - T / 2), width: L, height: T,
    transform: "rotate(45deg)", background: "rgba(17,17,17,0.82)", alignItems: "center", justifyContent: "center",
    color: "#ffffff", fontFamily: "Inter", fontWeight: 600, fontSize: Math.round(T * 0.46), letterSpacing: Math.round(T * 0.12),
  }, [WATERMARK_TEXT], { "data-watermark": "preview" });
}

/**
 * Just the ribbon, as a small transparent square for the top-right corner of
 * a W x H picture: { tree, w, h, left, top }. The renderer draws each piece
 * once and stamps this on for the preview (half the rendering work).
 */
export function watermarkLayer(W, H) {
  const S = Math.max(Math.min(W, H), W * 0.5);
  const C = Math.ceil(S * 0.36);
  const ribbon = watermarkRibbon(W, H);
  const st = ribbon.props.style;
  const shifted = { ...ribbon, props: { ...ribbon.props, style: { ...st, left: st.left - (W - C) } } };
  return { tree: h("div", { width: C, height: C, position: "relative", overflow: "hidden", background: "transparent" }, [shifted]), w: C, h: C, left: W - C, top: 0 };
}

/** Does this tree carry the watermark? (tests + a guard before upload) */
export function hasWatermark(node) {
  if (!node || typeof node !== "object") return false;
  if (node.props?.["data-watermark"] === "preview") return true;
  const kids = node.props?.children;
  return Array.isArray(kids) ? kids.some(hasWatermark) : hasWatermark(kids);
}

function frame(W, H, bg, children, { watermark = false } = {}) {
  return h("div", { width: W, height: H, position: "relative", background: bg, fontFamily: "Inter", overflow: "hidden" },
    [...children, ...(watermark ? [watermarkRibbon(W, H)] : [])]);
}

/** The hero picture: the business's photo, else its trade scene in its colors. */
export function heroSrc(kit, p, heroImage) {
  if (heroImage) return heroImage;
  const c = kit.colors;
  const key = kit.hero?.kind === "scene" && kit.hero.ref ? kit.hero.ref : sceneKeyFor(p.primary_category);
  return sceneDataUrl(key, { identity: c.identity, accent: c.accent, cta: c.cta, deep: deep(c.identity) });
}

function iconUrl(kit, size, color) {
  return svgUrl(tradeIconSvg(kit.wordmark?.icon, { size, width: 2.2 }).replace(/currentColor/g, color).replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" '));
}

/**
 * The wordmark: their logo on a white card when it's usable, else the
 * trade icon + name in their colors (same mark as the share card).
 */
function mark(p, kit, { scale = 1, ink = "#ffffff", sub = "rgba(255,255,255,.85)", logo = null } = {}) {
  const c = kit.colors;
  if (logo && kit.logo?.quality === "usable") {
    return h("div", { background: "#ffffff", borderRadius: 18 * scale, padding: `${12 * scale}px ${18 * scale}px`, alignItems: "center" }, [
      h("img", { height: 86 * scale, objectFit: "contain" }, [], { src: logo, height: 86 * scale, width: 260 * scale }),
    ]);
  }
  const l1 = kit.wordmark?.line1 || String(p.business_name || "").toUpperCase();
  const size = (l1.length > 22 ? 34 : l1.length > 16 ? 40 : 46) * scale;
  return h("div", { alignItems: "center" }, [
    h("div", { width: 76 * scale, height: 76 * scale, borderRadius: 999, background: c.cta, alignItems: "center", justifyContent: "center", flexShrink: 0 }, [
      h("img", {}, [], { src: iconUrl(kit, 42 * scale, c.ctaText), width: 42 * scale, height: 42 * scale }),
    ]),
    h("div", { flexDirection: "column", marginLeft: 18 * scale }, [
      h("div", { color: ink, fontFamily: "Archivo", fontWeight: 900, fontSize: size, lineHeight: 1 }, [l1]),
      ...(kit.wordmark?.line2 ? [h("div", { color: sub, fontSize: 17 * scale, fontWeight: 600, letterSpacing: 2.2 * scale, marginTop: 8 * scale }, [kit.wordmark.line2])] : []),
    ]),
  ]);
}

function pill(text, c, { size = 40, pad = "16px 30px" } = {}) {
  return h("div", { background: c.cta, color: c.ctaText, borderRadius: 999, padding: pad, fontFamily: "Archivo", fontWeight: 900, fontSize: size, alignItems: "center" }, [text]);
}

// ── Facebook cover (1702x630) ─────────────────────────────────────────────

export function coverTree(p, kit, pieces, { heroImage = null, logo = null, watermark = false } = {}) {
  const c = kit.colors, { w: W, h: H, safe } = COVER;
  const imgX = 1000;
  return frame(W, H, c.identity, [
    h("img", { position: "absolute", left: imgX, top: 0, width: W - imgX, height: H, objectFit: "cover" }, [], { src: heroSrc(kit, p, heroImage), width: W - imgX, height: H }),
    h("div", { position: "absolute", left: imgX, top: 0, width: 260, height: H, backgroundImage: `linear-gradient(90deg, ${c.identity}, ${c.identity}00)` }, []),
    h("div", { position: "absolute", left: 0, top: 0, width: W, height: 12, background: c.accent }, []),
    h("div", {
      position: "absolute", left: safe.x0, top: safe.y0, width: safe.x1 - safe.x0, height: safe.y1 - safe.y0,
      flexDirection: "column", justifyContent: "center",
    }, [
      mark(p, kit, { scale: 1.1, logo }),
      h("div", { marginTop: 26, color: "#ffffff", fontSize: 34, fontWeight: 600, opacity: 0.95 }, [pieces.cover.line]),
      ...(pieces.phone ? [h("div", { marginTop: 30 }, [pill(pieces.phone, c, { size: 44, pad: "14px 34px" })])] : []),
      h("div", { marginTop: 18, color: "#ffffff", fontSize: 28, fontWeight: 600, opacity: 0.9, whiteSpace: "nowrap" }, [pieces.display]),
    ]),
  ], { watermark });
}

// ── Posts (1080x1080) ─────────────────────────────────────────────────────

function kicker(text, c, color = c.accent) {
  return h("div", { color, fontSize: 30, fontWeight: 600, letterSpacing: 3, textTransform: "uppercase" }, [text]);
}

function headlineSize(t, big = 84) {
  const n = String(t || "").length;
  return n > 60 ? Math.round(big * 0.66) : n > 44 ? Math.round(big * 0.78) : n > 30 ? Math.round(big * 0.9) : big;
}

function footer(p, kit, pieces, { logo, bg }) {
  const c = kit.colors;
  return h("div", { position: "absolute", left: 0, bottom: 0, width: POST.w, height: 150, background: bg, alignItems: "center", justifyContent: "space-between", padding: "0 56px" }, [
    mark(p, kit, { scale: 0.72, logo }),
    h("div", { flexDirection: "column", alignItems: "flex-end" }, [
      ...(pieces.phone ? [h("div", { color: "#ffffff", fontFamily: "Archivo", fontWeight: 900, fontSize: 38 }, [pieces.phone])] : []),
      h("div", { color: "rgba(255,255,255,.85)", fontSize: 22, fontWeight: 600, marginTop: 4 }, [pieces.display]),
    ]),
  ]);
}

export function postTree(id, p, kit, pieces, { heroImage = null, logo = null, watermark = false } = {}) {
  const c = kit.colors, W = POST.w, H = POST.h, d = deep(c.identity);
  const src = heroSrc(kit, p, heroImage);
  if (id === "post_online") {
    const x = pieces.post_online;
    return frame(W, H, c.identity, [
      h("img", { position: "absolute", left: 0, top: 0, width: W, height: 470, objectFit: "cover" }, [], { src, width: W, height: 470 }),
      h("div", { position: "absolute", left: 0, top: 470, width: W, height: 10, background: c.accent }, []),
      h("div", { position: "absolute", left: 56, top: 520, width: W - 112, flexDirection: "column" }, [
        kicker(x.kicker, c),
        h("div", { marginTop: 14, color: "#ffffff", fontFamily: "Archivo", fontWeight: 900, fontSize: headlineSize(x.headline, 70), lineHeight: 1.02 }, [x.headline]),
        h("div", { marginTop: 20, color: "#ffffff", fontSize: 32, fontWeight: 600, opacity: 0.95 }, [x.what]),
        ...(x.towns ? [h("div", { marginTop: 10, color: "#ffffff", fontSize: 28, fontWeight: 600, opacity: 0.85 }, [x.towns])] : []),
      ]),
      footer(p, kit, pieces, { logo, bg: d }),
    ], { watermark });
  }
  if (id === "post_specialty") {
    const x = pieces.post_specialty;
    return frame(W, H, c.identity, [
      h("img", { position: "absolute", left: 0, top: 450, width: W, height: H - 450 - 150, objectFit: "cover" }, [], { src, width: W, height: H - 600 }),
      h("div", { position: "absolute", left: 0, top: 440, width: W, height: 10, background: c.accent }, []),
      h("div", { position: "absolute", left: 56, top: 70, width: W - 112, flexDirection: "column" }, [
        h("div", { alignSelf: "flex-start", background: c.accent, color: INK, borderRadius: 999, padding: "8px 22px", fontSize: 26, fontWeight: 600, letterSpacing: 2, textTransform: "uppercase" }, [x.kicker]),
        h("div", { marginTop: 26, color: "#ffffff", fontFamily: "Archivo", fontWeight: 900, fontSize: headlineSize(x.headline, 92), lineHeight: 1.0 }, [x.headline]),
        h("div", { marginTop: 24 }, [pill(x.sub, c, { size: 32, pad: "12px 26px" })]),
      ]),
      footer(p, kit, pieces, { logo, bg: d }),
    ], { watermark });
  }
  // post_seasonal
  const x = pieces.post_seasonal;
  return frame(W, H, "#ffffff", [
    h("div", { position: "absolute", left: 0, top: 0, width: W, height: 380, background: c.accent }, []),
    h("img", { position: "absolute", left: 470, top: 70, width: 550, height: 550, borderRadius: 32, objectFit: "cover", boxShadow: "0 20px 50px rgba(0,0,0,.25)" }, [], { src, width: 550, height: 550 }),
    h("div", { position: "absolute", left: 56, top: 90, width: 400, flexDirection: "column" }, [
      h("div", { color: INK, fontFamily: "Archivo", fontWeight: 900, fontSize: 120, lineHeight: 0.9 }, [x.kicker]),
    ]),
    h("div", { position: "absolute", left: 56, top: 670, width: W - 112, flexDirection: "column" }, [
      h("div", { color: c.identity, fontFamily: "Archivo", fontWeight: 900, fontSize: headlineSize(x.headline, 78), lineHeight: 1.02 }, [x.headline]),
      h("div", { marginTop: 22 }, [pill(x.sub, c, { size: 32, pad: "12px 26px" })]),
    ]),
    footer(p, kit, pieces, { logo, bg: c.identity }),
  ], { watermark });
}

// ── QR card (4x6 in, 1200x1800 at 300 dpi) ────────────────────────────────

/** The QR code as an SVG (black modules, white quiet zone). */
export function qrSvg(text, { margin = 4 } = {}) {
  const qr = QRCode.create(String(text), { errorCorrectionLevel: "M" });
  const n = qr.modules.size, size = n + margin * 2;
  let d = "";
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!qr.modules.get(r, c)) { c++; continue; }
      let run = 1;
      while (c + run < n && qr.modules.get(r, c + run)) run++;
      d += `M${c + margin} ${r + margin}h${run}v1h-${run}z`;
      c += run;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#ffffff"/><path d="${d}" fill="#000000"/></svg>`;
}

export function qrCardTree(p, kit, pieces, { logo = null, watermark = false } = {}) {
  const c = kit.colors, W = CARD.w, H = CARD.h;
  const q = pieces.qr_card;
  return frame(W, H, "#ffffff", [
    h("div", { position: "absolute", left: 0, top: 0, width: W, height: 470, background: c.identity, flexDirection: "column", justifyContent: "center", padding: "0 80px" }, [
      mark(p, kit, { scale: 1.35, logo }),
      h("div", { marginTop: 30, color: "#ffffff", fontSize: 40, fontWeight: 600, opacity: 0.95 }, [q.line]),
    ]),
    h("div", { position: "absolute", left: 0, top: 470, width: W, height: 16, background: c.accent }, []),
    h("div", { position: "absolute", left: 0, top: 540, width: W, flexDirection: "column", alignItems: "center" }, [
      h("div", { color: INK, fontFamily: "Archivo", fontWeight: 900, fontSize: 84, lineHeight: 1 }, [q.scan]),
      h("div", { marginTop: 40, padding: 18, borderRadius: 28, border: `6px solid ${c.identity}`, background: "#ffffff" }, [
        h("img", {}, [], { src: svgUrl(qrSvg(q.target)), width: 600, height: 600 }),
      ]),
      h("div", { marginTop: 24, color: "#4a4540", fontSize: 34, fontWeight: 600 }, [pieces.display]),
    ]),
    ...(pieces.phone ? [h("div", { position: "absolute", left: 0, bottom: 70, width: W, flexDirection: "column", alignItems: "center" }, [
      h("div", { color: "#4a4540", fontSize: 34, fontWeight: 600 }, ["Call or text"]),
      h("div", { marginTop: 6, color: c.identity, fontFamily: "Archivo", fontWeight: 900, fontSize: 104 }, [pieces.phone]),
    ])] : []),
    h("div", { position: "absolute", left: 0, bottom: 0, width: W, height: 26, background: c.identity }, []),
  ], { watermark });
}

// ── Round profile badge (640x640, Facebook crops it to a circle) ──────────

export function badgeTree(p, kit, pieces, { watermark = false } = {}) {
  const c = kit.colors, W = BADGE.w, H = BADGE.h;
  const l1 = kit.wordmark?.line1 || String(p.business_name || "").toUpperCase();
  const size = l1.length > 18 ? 52 : l1.length > 12 ? 62 : 74;
  const trade = String(kit.wordmark?.line2 || "").split("·")[0].trim();
  return frame(W, H, c.identity, [
    h("div", { position: "absolute", left: 22, top: 22, width: W - 44, height: H - 44, borderRadius: 999, border: `10px solid ${c.accent}` }, []),
    h("div", { position: "absolute", left: 0, top: 0, width: W, height: H, flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 110px" }, [
      h("div", { width: 112, height: 112, borderRadius: 999, background: c.cta, alignItems: "center", justifyContent: "center" }, [
        h("img", {}, [], { src: iconUrl(kit, 62, c.ctaText), width: 62, height: 62 }),
      ]),
      h("div", { marginTop: 24, color: "#ffffff", fontFamily: "Archivo", fontWeight: 900, fontSize: size, lineHeight: 0.98, textAlign: "center", justifyContent: "center" }, [l1]),
      ...(trade ? [h("div", { marginTop: 14, color: "rgba(255,255,255,.88)", fontSize: 26, fontWeight: 600, letterSpacing: 3, textAlign: "center" }, [trade])] : []),
    ]),
  ], { watermark });
}

/** The tree for one item id. */
export function treeFor(id, p, kit, pieces, opts = {}) {
  if (id === "cover") return coverTree(p, kit, pieces, opts);
  if (id === "qr_card") return qrCardTree(p, kit, pieces, opts);
  if (id === "badge") return badgeTree(p, kit, pieces, opts);
  return postTree(id, p, kit, pieces, opts);
}

/** Pixel size for one item id. */
export function sizeFor(id) {
  if (id === "cover") return { w: COVER.w, h: COVER.h };
  if (id === "qr_card") return { w: CARD.w, h: CARD.h };
  if (id === "badge") return { w: BADGE.w, h: BADGE.h };
  return { w: POST.w, h: POST.h };
}
