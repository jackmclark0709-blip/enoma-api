// Signup attribution sent by get-your-website.html (guide slug, CTA position,
// first-touch landing page, external referrer and utm_* params). Client-supplied, so keep only
// known keys as short plain strings.
const ATTRIBUTION_KEYS = ["from", "cta", "landing", "referrer", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
export function cleanAttribution(input) {
  if (!input || typeof input !== "object") return null;
  const out = {};
  for (const k of ATTRIBUTION_KEYS) {
    const v = input[k];
    if (typeof v === "string" && v.trim()) out[k] = v.trim().slice(0, 100);
  }
  return Object.keys(out).length ? out : null;
}

// ── First touch, kept through to payment ──
// businesses.first_touch is filled once, when a page is claimed
// (api/claim-business.js), and never overwritten. Its utm_* keys are copied
// into the Stripe Checkout session and subscription metadata so a paying
// customer can be traced to a campaign.

export const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];

const hasUtm = (o) => !!o && UTM_KEYS.some((k) => typeof o[k] === "string" && o[k]);

/**
 * The first touch to store for a newly claimed page, in priority order:
 * 1. the claiming browser's stored first touch (localStorage enoma_first_touch)
 *    when it carries utm_* values;
 * 2. the prospect's raw.attribution (instant previews);
 * 3. { utm_source: "cold_email" } for an outreach prospect (any prospect that
 *    isn't an inbound instant preview);
 * 4. the browser's first touch without utm_* (landing page / referrer only).
 * A browser touch without utm_* ranks below the prospect because an owner who
 * clicks Jack's email lands on their own page with no utm_* params, and that
 * landing would otherwise hide the real channel. Returns null when nothing is known.
 */
export function chooseFirstTouch({ browser, prospect } = {}) {
  const fromBrowser = cleanAttribution(browser);
  if (hasUtm(fromBrowser)) return fromBrowser;
  const fromProspect = cleanAttribution(prospect?.raw?.attribution);
  if (fromProspect) return fromProspect;
  if (prospect && prospect.source !== "inbound_lookup") {
    return { utm_source: "cold_email", ...(fromBrowser?.landing ? { landing: fromBrowser.landing } : {}) };
  }
  return fromBrowser;
}

/**
 * Never overwrite: the value to write to businesses.first_touch, or null when
 * the business already has one (or there's nothing to write).
 */
export function firstTouchToWrite(existing, candidate) {
  if (existing && typeof existing === "object" && Object.keys(existing).length) return null;
  return candidate && typeof candidate === "object" && Object.keys(candidate).length ? candidate : null;
}

/** Just the utm_* keys, as Stripe metadata (string values, max 500 chars). */
export function utmMetadata(firstTouch) {
  const out = {};
  if (!firstTouch || typeof firstTouch !== "object") return out;
  for (const k of UTM_KEYS) {
    const v = firstTouch[k];
    if (typeof v === "string" && v.trim()) out[k] = v.trim().slice(0, 500);
  }
  return out;
}

/**
 * businesses.first_touch for a page created self-serve (instant preview on
 * /get-your-website, or /create). Never null, so every self-serve business
 * records how it was made even when the browser had no utm_* or referrer.
 * @param {object} attribution  the browser's first touch / enomaAttribution()
 * @param {string} createdVia   "instant_preview" | "create"
 * @param {string} [referrer]   document.referrer, used when attribution has none
 */
export function selfServeFirstTouch(attribution, createdVia, referrer) {
  const clean = cleanAttribution(attribution) || {};
  if (!clean.referrer && typeof referrer === "string" && referrer.trim()) clean.referrer = referrer.trim().slice(0, 100);
  return { ...clean, created_via: createdVia };
}
