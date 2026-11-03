// api/_lib/photo-kinds.js
// Owners tag each uploaded image: a job photo, a flyer or ad, a logo, or
// other. Only job photos (and older untagged uploads) appear in the hero and
// the "Recent Work" gallery, so a promo flyer can't become the hero again.
// Tags live in small_business_profiles.attachment_kinds as { url: kind }.

export const PHOTO_KINDS = {
  work: "Job photo",
  flyer: "Flyer or ad",
  logo: "Logo",
  other: "Other (hide)",
};
const SHOWN = new Set(["work"]);

const urlOf = a => (typeof a === "string" ? a : a && typeof a === "object" ? a.url : "") || "";
export const isImageUrl = u => /\.(png|jpe?g|webp|gif)(\?.*)?$/i.test(String(u || ""));

export function kindOf(kinds, url) {
  const k = kinds && typeof kinds === "object" ? kinds[url] : null;
  return PHOTO_KINDS[k] ? k : null; // null = untagged (older uploads)
}

// Image URLs a visitor should see as the business's work, in upload order.
export function workPhotos(profile) {
  const kinds = profile?.attachment_kinds;
  return (Array.isArray(profile?.attachments) ? profile.attachments : [])
    .map(urlOf)
    .filter(u => isImageUrl(u))
    .filter(u => { const k = kindOf(kinds, u); return k === null || SHOWN.has(k); });
}

// Hero background: first photo tagged as a job photo, else first untagged one.
export function heroPhoto(profile) {
  const kinds = profile?.attachment_kinds;
  const photos = workPhotos(profile);
  return photos.find(u => kindOf(kinds, u) === "work") || photos[0] || null;
}

// Attachments to hand the page: shown photos plus non-image files (Resources).
export function visibleAttachments(profile) {
  const shown = new Set(workPhotos(profile));
  return (Array.isArray(profile?.attachments) ? profile.attachments : [])
    .filter(a => { const u = urlOf(a); return u && (!isImageUrl(u) || shown.has(u)); });
}

// Merge tags on save: keep tags for surviving URLs, apply incoming tags,
// default new uploads to "work" (the upload field asks for work photos).
export function mergeKinds(existing, incoming, finalUrls, newUrls = []) {
  const out = {};
  const prev = existing && typeof existing === "object" ? existing : {};
  const inc = incoming && typeof incoming === "object" ? incoming : {};
  for (const u of finalUrls) {
    const k = PHOTO_KINDS[inc[u]] ? inc[u] : PHOTO_KINDS[prev[u]] ? prev[u] : newUrls.includes(u) ? "work" : null;
    if (k) out[u] = k;
  }
  return out;
}
