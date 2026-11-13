// api/_lib/logo-settings.js
// Owner dashboard: logo settings. Routed from /api/generate-business?kind=logo
// with the same auth as the other dashboard writes (Supabase session +
// business_members row; the Enoma admin account may act on any business).
//
//   action=options  -> the three starter logos, the current pick and logo_url
//   action=choose   -> save starter_logo_id (and, when the owner picks a
//                      starter logo over an uploaded one, clear logo_url)
//   action=upload   -> store an uploaded PNG/JPEG in the business-images
//                      bucket, set logo_url, clear starter_logo_id, and
//                      save the logo's color as brand_color (logo-color.js)
//
// Starter logos are part of the page: there is no price and nothing to buy.

import { starterLogoOptions, chosenStarterLogoId, isStarterLogoId } from "./starter-logo.js";
import { pickPalette } from "./page-style.js";
import { logoBrandColor, saveBrandColor } from "./logo-color.js";

export const ADMIN_ID = "b2f87fe4-4d1e-4038-8754-5ab64969e975";
export const BUCKET = "business-images";
export const MAX_LOGO_BYTES = 3 * 1024 * 1024;
const MAX_BODY_BYTES = 4.5 * 1024 * 1024;

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("too_large"), { code: "too_large" });
    chunks.push(c);
  }
  const t = Buffer.concat(chunks).toString("utf8");
  return t ? JSON.parse(t) : {};
}

// Decode a data: URL (or bare base64) and sniff the real type from the bytes;
// the browser's claimed type is ignored. Only PNG and JPEG, like /create.
export function decodeLogoUpload(data) {
  const s = String(data || "");
  const m = s.match(/^data:([a-z/+.-]+);base64,(.*)$/is);
  const b64 = (m ? m[2] : s).replace(/\s+/g, "");
  if (!b64 || !/^[A-Za-z0-9+/]+=*$/.test(b64)) return { ok: false, error: "That file didn't come through. Try again." };
  const buf = Buffer.from(b64, "base64");
  if (!buf.length) return { ok: false, error: "That file looks empty." };
  if (buf.length > MAX_LOGO_BYTES) return { ok: false, error: "That file is over 3 MB. Try a smaller picture." };
  const png = buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const jpg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (!png && !jpg) return { ok: false, error: "Please upload a PNG or JPG picture." };
  return { ok: true, buffer: buf, ext: png ? "png" : "jpg", contentType: png ? "image/png" : "image/jpeg" };
}

export async function handleLogo(req, res, { supabaseAdmin, now = () => Date.now(), readLogoColor = logoBrandColor }) {
  const token = String(req.headers?.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Please log in." });
  const { data: { user } = {} } = await supabaseAdmin.auth.getUser(token);
  if (!user) return res.status(401).json({ error: "Your session expired. Please log in again." });

  let body;
  try { body = await readJson(req); }
  catch (e) {
    return res.status(e?.code === "too_large" ? 413 : 400).json({ error: e?.code === "too_large" ? "That file is over 3 MB. Try a smaller picture." : "Invalid JSON" });
  }
  const businessId = String(body.business_id || "");
  if (!businessId) return res.status(400).json({ error: "business_id required" });
  if (user.id !== ADMIN_ID) {
    const { data: m } = await supabaseAdmin.from("business_members").select("role")
      .eq("user_id", user.id).eq("business_id", businessId).maybeSingle();
    if (!m) return res.status(403).json({ error: "Not authorized for this business" });
  }

  const { data: profile } = await supabaseAdmin.from("small_business_profiles")
    .select("business_id,business_name,primary_category,logo_url,starter_logo_id")
    .eq("business_id", businessId).maybeSingle();
  if (!profile) return res.status(404).json({ error: "We couldn't find that page." });

  const action = String(req.query?.action || "options");

  if (action === "options") {
    // Shown the way the page shows them: white ink on the page's hero color.
    const palette = pickPalette(profile.primary_category, profile.business_name);
    return res.status(200).json({
      options: starterLogoOptions(profile, { tone: "dark" }),
      background: palette.bg2 || palette.bg,
      chosen: chosenStarterLogoId(profile),
      logo_url: profile.logo_url || null,
    });
  }

  if (action === "choose") {
    const id = String(body.starter_logo_id || "");
    if (!isStarterLogoId(id)) return res.status(400).json({ error: "Pick one of the three starter logos." });
    // Picking a starter logo while an uploaded one is showing means "use this
    // instead": the uploaded file stays in storage, the page stops using it.
    const update = { starter_logo_id: id, updated_at: new Date(now()).toISOString() };
    if (profile.logo_url) update.logo_url = null;
    const { error } = await supabaseAdmin.from("small_business_profiles").update(update).eq("business_id", businessId);
    if (error) return res.status(500).json({ error: "Couldn't save your logo choice. Try again." });
    // The page no longer shows the uploaded logo, so its color goes too.
    if (profile.logo_url) await saveBrandColor(supabaseAdmin, businessId, null);
    return res.status(200).json({ ok: true, chosen: id, logo_url: null });
  }

  if (action === "upload") {
    const file = decodeLogoUpload(body.file);
    if (!file.ok) return res.status(400).json({ error: file.error });
    const storagePath = `${businessId}/logo-${now()}.${file.ext}`;
    const { error: upErr } = await supabaseAdmin.storage.from(BUCKET)
      .upload(storagePath, file.buffer, { contentType: file.contentType, upsert: true });
    if (upErr) return res.status(500).json({ error: "Couldn't upload your logo. Try again." });
    const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(storagePath);
    const logoUrl = pub?.publicUrl;
    if (!logoUrl) return res.status(500).json({ error: "Couldn't upload your logo. Try again." });
    const { error } = await supabaseAdmin.from("small_business_profiles")
      .update({ logo_url: logoUrl, starter_logo_id: null, updated_at: new Date(now()).toISOString() })
      .eq("business_id", businessId);
    if (error) return res.status(500).json({ error: "Couldn't save your logo. Try again." });
    // The page's identity color from the logo (null if it can't be read, so
    // an older logo's color never sticks around).
    const brandColor = await readLogoColor(file.buffer);
    await saveBrandColor(supabaseAdmin, businessId, brandColor);
    return res.status(200).json({ ok: true, logo_url: logoUrl, chosen: null, brand_color: brandColor });
  }

  return res.status(400).json({ error: `Unknown action ${action}` });
}
