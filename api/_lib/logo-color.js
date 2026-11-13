// api/_lib/logo-color.js
// Read an uploaded logo's dominant color on the server (sharp), so the
// customer page is rendered in the logo's color from the first paint instead
// of loading in the palette color and shifting once the browser reads the
// logo. The color rules themselves are pure and live in page-style.js
// (dominantColorFromPixels: same 64x64 bucketing the browser used, then
// ensureUsableBrandColor's darkening rule).
//
// sharp is loaded lazily: if it's missing or the image can't be read, this
// returns null and logs; the page falls back to its palette.

import { dominantColorFromPixels } from "./page-style.js";

let sharpLoader = null;
async function loadSharp() {
  if (!sharpLoader) sharpLoader = import("sharp").then(m => m.default || m).catch(e => { sharpLoader = null; throw e; });
  return sharpLoader;
}

/**
 * Store a logo's color (or clear it: null) on the profile. Best effort and
 * separate from the logo write itself, so a missing brand_color column
 * (migration 20261114_brand_color not applied yet) or any other failure only
 * logs: the logo is still saved and the page uses its palette.
 */
export async function saveBrandColor(supabaseAdmin, businessId, color, { log = console } = {}) {
  try {
    const { error } = await supabaseAdmin.from("small_business_profiles")
      .update({ brand_color: color || null }).eq("business_id", businessId);
    if (error) { log.warn?.("logo brand color: not saved:", error.message || error); return false; }
    return true;
  } catch (e) {
    log.warn?.("logo brand color: not saved:", e?.message || e);
    return false;
  }
}

/**
 * Dominant brand color of an image buffer, as "#rrggbb", or null.
 * opts.sharp lets tests pass a stand-in.
 */
export async function logoBrandColor(buffer, { sharp: sharpImpl, log = console } = {}) {
  if (!buffer || !buffer.length) return null;
  try {
    const sharp = sharpImpl || await loadSharp();
    const { data } = await sharp(buffer)
      .resize(64, 64, { fit: "fill" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return dominantColorFromPixels(data);
  } catch (e) {
    log.warn?.("logo brand color: couldn't read logo:", e?.message || e);
    return null;
  }
}
