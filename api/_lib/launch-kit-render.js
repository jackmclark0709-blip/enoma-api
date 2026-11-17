// api/_lib/launch-kit-render.js
// Makes and stores a business's launch kit (api/_lib/launch-kit.js): renders
// each piece with @vercel/og (same fonts and pipeline as the share card in
// og-card.js), writes one gpt-4o call for the three captions, and uploads:
//
//   business-images (public)  launch-kit/<business_id>/<fingerprint>/<id>-preview.jpg
//                             watermarked previews ("Preview" ribbon), safe to show anyone
//   launch-kits (private)     <business_id>/<fingerprint>/<id>.png|pdf
//                             the clean files; only reachable through a short
//                             signed URL handed out after the $1 claim
//
// The result is stored on brand_kit.launch_kit. Runs after preview generation
// (waitUntil, no cron) and on demand when the owner opens /<slug>/kit and the
// stored kit is missing or stale. Never throws.
//
// No vision calls here: the logo was already read once (and cached) when the
// brand kit was built. The only model call is the captions, cached on the
// launch kit by a fingerprint of the facts it was given.

import crypto from "node:crypto";
import {
  LAUNCH_KIT_VERSION, CARD, ITEM_LABELS, itemIds, piecesFor, launchKitFingerprint, launchKitFresh,
  captionPrompt, captionRequestBody, finalizeCaptions, fallbackCaptions, contactLines, captionFlags,
} from "./launch-kit.js";
import { treeFor, sizeFor, hasWatermark, watermarkLayer } from "./launch-kit-art.js";
import { kitFonts, shareHeroImage } from "./og-card.js";
import { googlePhotoUri } from "./brand-kit.js";
import { lintCaption, fixInstructions } from "./copy-lint.js";

export const PREVIEW_BUCKET = "business-images";
export const FILE_BUCKET = "launch-kits";
export const SIGNED_URL_SECONDS = 600;
// A build marked "building" longer ago than this is treated as dead.
export const BUILD_STALE_MS = 3 * 60 * 1000;
// One kit takes ~5s of CPU. The daily pipeline makes up to 25 previews in one
// 60-second function, so only this many are made at creation per invocation;
// the rest are made the first time the owner opens their owner link or kit.
export const CREATION_BUILDS_PER_RUN = 3;
let creationBuilds = 0;
/** May this invocation make one more launch kit at page creation? (counts it) */
export function takeCreationBuild() {
  if (creationBuilds >= CREATION_BUILDS_PER_RUN) return false;
  creationBuilds++;
  return true;
}

const FILE_NAMES = {
  cover: "facebook-cover", post_online: "post-were-online", post_specialty: "post-our-specialty",
  post_seasonal: "post-this-season", qr_card: "qr-card-4x6", badge: "profile-picture",
};

/** "let-it-roll-painting-facebook-cover.png". */
export function downloadName(slug, id, format) {
  return `${String(slug || "enoma").slice(0, 60)}-${FILE_NAMES[id] || id}.${format}`;
}

// ── PDF (pure) ────────────────────────────────────────────────────────────

/**
 * A one-page PDF holding one JPEG, page size in points (4x6 in = 288x432).
 * Hand-written so no PDF library ships with the function.
 */
export function jpegToPdf(jpeg, { pxW, pxH, ptW = CARD.pt.w, ptH = CARD.pt.h, title = "" } = {}) {
  const parts = [];
  const offsets = [];
  let length = 0;
  const push = chunk => { const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "latin1"); parts.push(b); length += b.length; };
  const obj = (n, body) => { offsets[n] = length; push(`${n} 0 obj\n`); for (const b of [].concat(body)) push(b); push("\nendobj\n"); };
  const content = `q ${ptW} 0 0 ${ptH} 0 0 cm /Im0 Do Q`;
  const safeTitle = String(title).replace(/[^\x20-\x7e]/g, "").replace(/[()\\]/g, "");
  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ptW} ${ptH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  obj(4, [`<< /Type /XObject /Subtype /Image /Width ${pxW} /Height ${pxH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, jpeg, "\nendstream"]);
  obj(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  obj(6, `<< /Title (${safeTitle}) /Producer (Enoma) >>`);
  const xref = length;
  push(`xref\n0 7\n0000000000 65535 f \n${[1, 2, 3, 4, 5, 6].map(n => `${String(offsets[n]).padStart(10, "0")} 00000 n \n`).join("")}`);
  push(`trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(parts);
}

// ── Rendering ─────────────────────────────────────────────────────────────

let sharpLoader = null;
async function loadSharp() {
  if (!sharpLoader) sharpLoader = import("sharp").then(m => m.default || m).catch(e => { sharpLoader = null; throw e; });
  return sharpLoader;
}

async function renderPng(tree, { w, h }, fonts) {
  const { ImageResponse } = await import("@vercel/og");
  const res = new ImageResponse(tree, { width: w, height: h, ...(fonts.length ? { fonts } : {}) });
  return Buffer.from(await res.arrayBuffer());
}

/** The logo as an absolute URL satori can fetch (Google logos via a fresh Places URL). */
async function logoImageUrl(kit, { fetchImpl } = {}) {
  const url = kit.logo?.url;
  if (!url || kit.logo?.quality !== "usable") return null;
  if (/^https:\/\//i.test(url)) return url;
  const n = String(url).match(/^google:(places\/.+)$/);
  return n ? await googlePhotoUri(n[1], { maxWidthPx: 800, ...(fetchImpl ? { fetchImpl } : {}) }).catch(() => null) : null;
}

/**
 * Fetch an image and hand it to satori as a JPEG/PNG data URL (satori can't
 * read WebP, and a dead link shouldn't fail the whole kit). Null on failure.
 */
export async function inlineImage(url, { fetchImpl = globalThis.fetch, sharp, max = 1400, png = false } = {}) {
  if (!url) return null;
  try {
    const r = await fetchImpl(url, { headers: { "User-Agent": "EnomaLaunchKit/1.0" }, signal: AbortSignal.timeout(15000), redirect: "follow" });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > 8 * 1024 * 1024) return null;
    const s = sharp || await loadSharp();
    const img = s(buf).rotate().resize(max, max, { fit: "inside", withoutEnlargement: true });
    const out = png ? await img.png().toBuffer() : await img.flatten({ background: "#ffffff" }).jpeg({ quality: 86 }).toBuffer();
    return `data:image/${png ? "png" : "jpeg"};base64,${out.toString("base64")}`;
  } catch { return null; }
}

// Previews are for looking at on a phone: never wider than this.
const PREVIEW_MAX_W = 1080;

/**
 * Stamp the "Preview" ribbon on a rendered piece and shrink it for the page.
 * The ribbon is rendered at the piece's own size, then both are scaled
 * together, so it sits in the same corner at the same proportion.
 */
export async function watermarkPng(clean, { w, h }, ribbonPng, layer, { sharp, maxW = PREVIEW_MAX_W } = {}) {
  const s = sharp || await loadSharp();
  const stamped = await s(clean).composite([{ input: ribbonPng, left: layer.left, top: layer.top }]).png().toBuffer();
  const width = Math.min(maxW, w);
  const img = width < w ? s(stamped).resize(width, Math.round((h * width) / w)) : s(stamped);
  // JPEG: a photo preview as PNG is ~1.4 MB; this is ~150 KB.
  return img.flatten({ background: "#ffffff" }).jpeg({ quality: 82 }).toBuffer();
}

/**
 * Render every piece once: the clean file, and a watermarked preview made
 * from it (the "Preview" ribbon stamped on). Returns
 * [{ id, w, h, format, clean, preview, thumb? }] (Buffers).
 */
export async function renderLaunchKitImages(p, kit, pieces, { fetchImpl = globalThis.fetch, sharp, fonts } = {}) {
  const f = fonts || await kitFonts(fetchImpl);
  const s = sharp || await loadSharp();
  const [heroUrl, logoUrl] = await Promise.all([shareHeroImage(kit, { fetchImpl, maxWidthPx: 1200 }), logoImageUrl(kit, { fetchImpl })]);
  const [heroImage, logo] = await Promise.all([
    inlineImage(heroUrl, { fetchImpl, sharp: s, max: 1400 }),
    inlineImage(logoUrl, { fetchImpl, sharp: s, max: 600, png: true }),
  ]);
  const out = [];
  for (const id of itemIds(kit)) {
    const size = sizeFor(id);
    const opts = { heroImage, logo };
    let clean;
    try { clean = await renderPng(treeFor(id, p, kit, pieces, opts), size, f); }
    catch (e) { if (!opts.heroImage && !opts.logo) throw e; clean = await renderPng(treeFor(id, p, kit, pieces, { heroImage: null, logo: null }), size, f); } // a photo satori can't draw: use the scene
    const layer = watermarkLayer(size.w, size.h);
    if (!hasWatermark(layer.tree)) throw new Error("preview without watermark");
    const ribbon = await renderPng(layer.tree, { w: layer.w, h: layer.h }, f);
    const preview = await watermarkPng(clean, size, ribbon, layer, { sharp: s, maxW: id === "qr_card" ? 600 : PREVIEW_MAX_W });
    // The owner bar's little picture (44px tall on a phone; 240px wide covers 2x screens).
    const mini = await s(preview).resize({ height: 120, width: 240, fit: "inside" }).jpeg({ quality: 78 }).toBuffer();
    if (id === "qr_card") {
      const jpeg = await s(clean).flatten({ background: "#ffffff" }).jpeg({ quality: 92 }).toBuffer();
      // What the kit page shows after the claim (a 4x6 card doesn't need 1200x1800 on screen).
      const thumb = await s(clean).resize(600, 900).png().toBuffer();
      clean = jpegToPdf(jpeg, { pxW: size.w, pxH: size.h, title: `${p.business_name || ""} QR card` });
      out.push({ id, ...size, format: "pdf", clean, preview, mini, thumb });
    } else {
      out.push({ id, ...size, format: "png", clean, preview, mini });
    }
  }
  return out;
}

// ── Captions ──────────────────────────────────────────────────────────────

/** Fingerprint of the caption prompt: the same facts never call the model twice. */
export function captionKey(prompt) {
  return crypto.createHash("sha256").update(prompt).digest("hex").slice(0, 16);
}

async function callCaptionModel(prompt, { fetchImpl, apiKey }) {
  const r = await fetchImpl("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(captionRequestBody(prompt)),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`captions ${r.status}`);
  const content = (await r.json())?.choices?.[0]?.message?.content;
  return content ? JSON.parse(content) : null;
}

/**
 * The three captions: cached ones when the facts haven't changed, else one
 * gpt-4o call (plus one retry if the lint finds problems), and the
 * deterministic captions for anything that still fails.
 */
export async function captionsFor(p, kit, pieces, { fetchImpl = globalThis.fetch, apiKey = process.env.OPENAI_KEY, cached = null, log = console } = {}) {
  const prompt = captionPrompt(p, kit, pieces);
  const key = captionKey(prompt);
  if (cached?.key === key && cached.captions) return { ...cached, reused: true };
  if (!apiKey) return { key, source: "fallback", captions: finalizeCaptions(fallbackCaptions(p, kit, pieces), p, kit, pieces).captions };
  try {
    let raw = await callCaptionModel(prompt, { fetchImpl, apiKey });
    const flags = captionFlags(p, kit);
    const problems = ["post_online", "post_specialty", "post_seasonal"].flatMap(id =>
      lintCaption(raw?.[id], flags).map(i => ({ message: `${id} ${i.message}` })));
    if (problems.length) raw = await callCaptionModel(prompt + fixInstructions(problems), { fetchImpl, apiKey }).catch(() => raw);
    const { captions, issues } = finalizeCaptions(raw, p, kit, pieces);
    return { key, source: issues.length ? "gpt-4o+fallback" : "gpt-4o", captions, issues: issues.map(i => `${i.id}: ${i.message}`) };
  } catch (e) {
    log.warn?.("launch kit: captions fell back:", e?.message || e);
    return { key, source: "fallback", captions: finalizeCaptions(fallbackCaptions(p, kit, pieces), p, kit, pieces).captions };
  }
}

// ── Storage + saving ──────────────────────────────────────────────────────

async function upload(supabase, bucket, path, buf, contentType) {
  const { error } = await supabase.storage.from(bucket).upload(path, buf, { contentType, upsert: true, cacheControl: "31536000" });
  if (error) throw new Error(`${bucket} upload: ${error.message || error}`);
}

/**
 * Merge launch_kit into the *current* brand_kit (never overwrite fields
 * changed meanwhile). baseKit: what to store with it when no kit is stored yet.
 */
export async function saveLaunchKit(supabase, businessId, launchKit, { log = console, baseKit = null } = {}) {
  try {
    const { data } = await supabase.from("small_business_profiles").select("brand_kit").eq("business_id", businessId).maybeSingle();
    const current = data?.brand_kit && typeof data.brand_kit === "object" && data.brand_kit.colors ? data.brand_kit : (baseKit || {});
    const { error } = await supabase.from("small_business_profiles").update({ brand_kit: { ...current, launch_kit: launchKit } }).eq("business_id", businessId);
    if (error) { log.warn?.("launch kit: not saved:", error.message || error); return false; }
    return true;
  } catch (e) { log.warn?.("launch kit: not saved:", e?.message || e); return false; }
}

/** Is a build already running (started recently)? */
export function buildInFlight(launchKit, now = Date.now()) {
  return launchKit?.status === "building" && now - Date.parse(launchKit.started_at || 0) < BUILD_STALE_MS;
}

/**
 * Make, upload and save the launch kit for one profile (its stored brand
 * kit). deps: { supabase, fetchImpl, sharp, openaiKey, now, log, force }.
 * Returns the saved launch_kit (status "ready" or "failed").
 */
export async function generateLaunchKit(profile, deps = {}) {
  const { supabase, fetchImpl = globalThis.fetch, sharp, openaiKey = process.env.OPENAI_KEY, log = console, now = Date.now(), force = false } = deps;
  const kit = profile?.brand_kit;
  if (!supabase || !profile?.business_id || !kit?.colors?.identity) return null;
  const month = new Date(now).getMonth();
  const fingerprint = launchKitFingerprint(profile, kit, { month });
  const prev = kit.launch_kit || null;
  if (!force && launchKitFresh(prev, fingerprint)) return prev;
  if (!force && buildInFlight(prev, now)) return prev;

  const started = new Date(now).toISOString();
  const { launch_kit: _lk, ...baseKit } = kit;
  const save = (lk) => saveLaunchKit(supabase, profile.business_id, lk, { log, baseKit });
  await save({ ...(prev || {}), version: LAUNCH_KIT_VERSION, status: "building", started_at: started, building_fingerprint: fingerprint });
  try {
    const pieces = piecesFor(profile, kit, { month });
    const [captions, images] = await Promise.all([
      captionsFor(profile, kit, pieces, { fetchImpl, apiKey: openaiKey, cached: prev?.captions, log }),
      renderLaunchKitImages(profile, kit, pieces, { fetchImpl, sharp }),
    ]);
    const base = `${profile.business_id}/${fingerprint}`;
    const items = [];
    for (const img of images) {
      const previewPath = `launch-kit/${base}/${img.id}-preview.jpg`;
      const filePath = `${base}/${img.id}.${img.format}`;
      await upload(supabase, PREVIEW_BUCKET, previewPath, img.preview, "image/jpeg");
      const miniPath = `launch-kit/${base}/${img.id}-mini.jpg`;
      await upload(supabase, PREVIEW_BUCKET, miniPath, img.mini, "image/jpeg");
      await upload(supabase, FILE_BUCKET, filePath, img.clean, img.format === "pdf" ? "application/pdf" : "image/png");
      // What the kit page shows after the claim (the file itself, or a PNG of the PDF).
      let thumbPath = filePath;
      if (img.thumb) { thumbPath = `${base}/${img.id}-thumb.png`; await upload(supabase, FILE_BUCKET, thumbPath, img.thumb, "image/png"); }
      const preview_url = supabase.storage.from(PREVIEW_BUCKET).getPublicUrl(previewPath).data?.publicUrl || null;
      items.push({
        id: img.id, label: ITEM_LABELS[img.id], w: img.w, h: img.h, format: img.format,
        preview_url, mini_url: supabase.storage.from(PREVIEW_BUCKET).getPublicUrl(miniPath).data?.publicUrl || null, file_path: filePath, thumb_path: thumbPath, caption: captions.captions[img.id] || null,
      });
    }
    const done = {
      version: LAUNCH_KIT_VERSION, status: "ready", built_at: new Date().toISOString(), fingerprint,
      contact: contactLines(profile, pieces), items,
      captions: { key: captions.key, source: captions.source, captions: captions.captions },
    };
    await save(done);
    return done;
  } catch (e) {
    log.warn?.("launch kit: build failed:", e?.message || e);
    const failed = { ...(prev?.status === "ready" ? prev : {}), version: LAUNCH_KIT_VERSION, status: prev?.status === "ready" ? "ready" : "failed", error: String(e?.message || e).slice(0, 200), failed_at: new Date().toISOString() };
    await save(failed);
    return failed;
  }
}

/** Only this business's own folder is ever signed (owners can edit their own row). */
export function ownPath(businessId, path) {
  const p = String(path || "");
  return !!businessId && p.startsWith(`${businessId}/`) && !p.includes("..");
}

/** Signed URLs for the clean pictures shown on the kit page after the claim: { [id]: url }. */
export async function signedThumbs(supabase, businessId, items = []) {
  const want = items.filter(i => ownPath(businessId, i.thumb_path || i.file_path));
  if (!want.length) return {};
  const { data, error } = await supabase.storage.from(FILE_BUCKET).createSignedUrls(want.map(i => i.thumb_path || i.file_path), 3600);
  if (error || !Array.isArray(data)) return {};
  return Object.fromEntries(want.map((it, k) => [it.id, data[k]?.signedUrl || null]).filter(([, u]) => u));
}

/** A short-lived download link for one clean file (after the claim). */
export async function signedDownloadUrl(supabase, slug, item, businessId) {
  if (!item?.file_path || !ownPath(businessId, item.file_path)) return null;
  const { data, error } = await supabase.storage.from(FILE_BUCKET)
    .createSignedUrl(item.file_path, SIGNED_URL_SECONDS, { download: downloadName(slug, item.id, item.format || "png") });
  return error ? null : data?.signedUrl || null;
}
