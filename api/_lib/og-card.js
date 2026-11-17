// api/_lib/og-card.js
// The per-business share image for page v2: GET /og/<slug>.png (vercel.json
// rewrites it to /api/p?og=2), 1200x630, rendered with @vercel/og and cached
// at the edge. Left: the wordmark, the H1 and "Town, ST · N years · phone".
// Right: a tilted phone showing a simplified hero (scene or photo, H1, call
// button). So a link to the page arrives looking like the page.
//
// cardTree() is pure (an element tree satori renders) and tested;
// renderOgPng() does the fonts and the rendering.

import { headlineFor } from "./page-v2.js";
import { stateCode, ownerCallLabel } from "./brand-kit.js";
import { sceneDataUrl } from "./trade-scenes.js";
import { tradeIconSvg } from "./starter-logo.js";
import { hexToRgb, rgbToHex } from "./page-style.js";
import { googlePhotoUri } from "./brand-kit.js";
import { ogSafeImageUrl } from "./stock-photos.js";

const W = 1200, H = 630;
const h = (type, style = {}, children = [], extra = {}) => ({ type, props: { style: { display: "flex", ...style }, children, ...extra } });
const deep = hex => { const rgb = hexToRgb(hex); return rgb ? rgbToHex(rgb.map(v => v * 0.72)) : hex; };
const svgUrl = svg => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
const cleanTown = t => String(t || "").replace(/,\s*[A-Za-z .]+$/, "").trim();

/** "Ewing, NJ · 20+ years · (732) 948-4046". */
export function factsLine(p, kit) {
  const where = [cleanTown(p.city), stateCode(p.state)].filter(Boolean).join(", ");
  return [where, kit.years ? `${kit.years} years` : "", p.phone || ""].filter(Boolean).join(" · ");
}

/**
 * The card as a satori element tree. heroImage: an https URL of a work
 * photo, or null to draw the trade scene.
 */
export function cardTree(p, kit, { heroImage = null } = {}) {
  const c = kit.colors;
  const d = deep(c.identity);
  const h1 = headlineFor(p, kit);
  // The wordmark as real text (SVG <text> has no fonts in the renderer).
  const icon = size => svgUrl(tradeIconSvg(kit.wordmark?.icon, { size, width: 2.2 }).replace(/currentColor/g, c.ctaText).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '));
  const mark = (scale, ink, sub) => h("div", { alignItems: "center" }, [
    h("div", { width: 66 * scale, height: 66 * scale, borderRadius: 999, background: c.cta, alignItems: "center", justifyContent: "center", flexShrink: 0 }, [
      h("img", {}, [], { src: icon(36 * scale), width: 36 * scale, height: 36 * scale }),
    ]),
    h("div", { flexDirection: "column", marginLeft: 16 * scale }, [
      h("div", { color: ink, fontFamily: "Archivo", fontWeight: 900, fontSize: 40 * scale, lineHeight: 1 }, [kit.wordmark?.line1 || p.business_name || ""]),
      ...(kit.wordmark?.line2 ? [h("div", { color: sub, fontSize: 15 * scale, fontWeight: 600, letterSpacing: 2 * scale, marginTop: 6 * scale }, [kit.wordmark.line2])] : []),
    ]),
  ]);
  const scene = heroImage || sceneDataUrl(kit.hero?.kind === "scene" && kit.hero.ref ? kit.hero.ref : "contractor", { identity: c.identity, accent: c.accent, cta: c.cta, deep: d });
  const h1Size = h1.length > 48 ? 54 : h1.length > 32 ? 62 : 72;

  const phone = h("div", {
    position: "absolute", right: 70, top: 46, width: 330, height: 640, borderRadius: 48, background: "#0f1115",
    padding: 12, transform: "rotate(6deg)", boxShadow: "0 30px 80px rgba(0,0,0,.45)",
  }, [
    h("div", { flexDirection: "column", width: "100%", height: "100%", borderRadius: 38, overflow: "hidden", background: "#ffffff" }, [
      h("div", { height: 58, alignItems: "center", padding: "0 16px", background: "#ffffff", borderBottom: `4px solid ${c.accent}` }, [
        mark(0.5, "#1a1714", "#4a4540"),
      ]),
      h("div", { flexDirection: "column", background: c.identity, flexGrow: 1 }, [
        h("img", { width: 306, height: 220, objectFit: "cover" }, [], { src: scene, width: 306, height: 220 }),
        h("div", { flexDirection: "column", padding: "16px 18px" }, [
          h("div", { color: "#ffffff", fontFamily: "Archivo", fontSize: 30, lineHeight: 1.04, fontWeight: 900 }, [h1]),
          h("div", { marginTop: 16, height: 56, borderRadius: 14, background: c.cta, color: c.ctaText, alignItems: "center", justifyContent: "center", fontFamily: "Archivo", fontWeight: 900, fontSize: 22 }, [ownerCallLabel(kit.owner_names)]),
        ]),
      ]),
    ]),
  ]);

  return h("div", { width: W, height: H, position: "relative", background: c.identity, fontFamily: "Inter", overflow: "hidden" }, [
    h("div", { position: "absolute", left: 0, top: 0, width: W, height: 10, background: c.accent }, []),
    h("div", { flexDirection: "column", justifyContent: "center", width: 720, height: H, padding: "0 0 0 64px" }, [
      mark(1, "#ffffff", "rgba(255,255,255,.85)"),
      h("div", { marginTop: 34, color: "#ffffff", fontFamily: "Archivo", fontWeight: 900, fontSize: h1Size, lineHeight: 1.0, letterSpacing: -1 }, [h1]),
      h("div", { marginTop: 28, color: "#ffffff", fontSize: 28, fontWeight: 600, opacity: 0.92 }, [factsLine(p, kit)]),
    ]),
    phone,
  ]);
}

// ── Rendering ─────────────────────────────────────────────────────────────

const fontCache = new Map();
/** A static TTF from Google Fonts (satori can't use woff2 or variable fonts). */
export async function googleFont(family, axes, fetchImpl = globalThis.fetch) {
  const key = `${family}:${axes}`;
  if (fontCache.has(key)) return fontCache.get(key);
  const css = await (await fetchImpl(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:${axes}`, { signal: AbortSignal.timeout(6000) })).text();
  const url = (css.match(/src:\s*url\(([^)]+)\)\s*format\('(?:truetype|opentype)'\)/) || [])[1];
  if (!url) throw new Error(`no ttf for ${family}`);
  const data = await (await fetchImpl(url, { signal: AbortSignal.timeout(6000) })).arrayBuffer();
  fontCache.set(key, data);
  return data;
}

/** PNG bytes for a profile + kit. */
export async function renderOgPng(p, kit, { heroImage = null, fetchImpl } = {}) {
  const { ImageResponse } = await import("@vercel/og");
  const fonts = [];
  try { fonts.push({ name: "Archivo", data: await googleFont("Archivo", "wdth,wght@85,900", fetchImpl), weight: 900, style: "normal" }); } catch { /* default font */ }
  try { fonts.push({ name: "Inter", data: await googleFont("Inter", "wght@600", fetchImpl), weight: 600, style: "normal" }); } catch { /* default font */ }
  const res = new ImageResponse(cardTree(p, kit, { heroImage }), { width: W, height: H, ...(fonts.length ? { fonts } : {}) });
  return Buffer.from(await res.arrayBuffer());
}

/** The default fonts for kit images (Archivo 900, Inter 600); missing ones fall back. */
export async function kitFonts(fetchImpl) {
  const fonts = [];
  try { fonts.push({ name: "Archivo", data: await googleFont("Archivo", "wdth,wght@85,900", fetchImpl), weight: 900, style: "normal" }); } catch { /* default font */ }
  try { fonts.push({ name: "Inter", data: await googleFont("Inter", "wght@600", fetchImpl), weight: 600, style: "normal" }); } catch { /* default font */ }
  return fonts;
}

// A kit's hero as an absolute image URL for rendered images (null = draw the scene).
export async function shareHeroImage(kit, { fetchImpl, maxWidthPx = 800 } = {}) {
  const hero = kit?.hero || {};
  if (hero.kind !== "work_photo" && hero.kind !== "stock") return null;
  const ref = typeof hero.ref === "string" ? hero.ref : String(hero.ref?.url || "");
  // Stock heroes are WebP hotlinks; satori needs JPEG/PNG.
  if (/^https:\/\//i.test(ref)) return hero.kind === "stock" ? ogSafeImageUrl(ref) : ref;
  const m = ref.match(/^google:(\d+)$/);
  const g = m ? (kit.google_photos || [])[Number(m[1])] : null;
  return g?.name ? await googlePhotoUri(g.name, { maxWidthPx, ...(fetchImpl ? { fetchImpl } : {}) }).catch(() => null) : null;
}
