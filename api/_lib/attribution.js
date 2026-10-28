// Signup attribution sent by get-your-website.html (guide slug, CTA position,
// first-touch landing page and utm_* params). Client-supplied, so keep only
// known keys as short plain strings.
const ATTRIBUTION_KEYS = ["from", "cta", "landing", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
export function cleanAttribution(input) {
  if (!input || typeof input !== "object") return null;
  const out = {};
  for (const k of ATTRIBUTION_KEYS) {
    const v = input[k];
    if (typeof v === "string" && v.trim()) out[k] = v.trim().slice(0, 100);
  }
  return Object.keys(out).length ? out : null;
}
