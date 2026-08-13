// Pure helpers shared by api/generate-business.js. Kept dependency-free and
// framework-free so they can be unit tested directly (see tests/service-utils.test.js).
// NOTE: this file lives under api/_lib — Vercel's convention excludes any
// underscore-prefixed file or folder under api/ from becoming its own
// serverless function, so this does NOT count against the 12-function cap.

export const first = v => (Array.isArray(v) ? v[0] : v || "");

export const safeJSON = (v, fallback = []) => {
  try { return v ? JSON.parse(v) : fallback; } catch { return fallback; }
};

export const normalizeServiceKey = name =>
  String(name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// The AI's service JSON schema deliberately has no `price` field — pricing is
// business-sensitive and the model shouldn't be inventing it. This backfills
// whatever price the owner actually typed onto the AI-written services (by
// name, falling back to position), and never touches a service that already
// carries a price (the manual/no-regenerate path already has the real value).
export const mergeUserServicePrices = (finalServices, rawUserServicesJSON) => {
  const rawUserServices = safeJSON(rawUserServicesJSON, []);
  if (!Array.isArray(finalServices)) return [];
  if (!Array.isArray(rawUserServices) || !rawUserServices.length) return finalServices;

  const priceByName = new Map();
  rawUserServices.forEach(s => {
    const key = normalizeServiceKey(s?.service_name);
    if (key && s?.price) priceByName.set(key, String(s.price).trim());
  });

  return finalServices.map((s, i) => {
    if (s.price) return s;
    const byName = priceByName.get(normalizeServiceKey(s.service_name));
    const byPosition = rawUserServices[i]?.price ? String(rawUserServices[i].price).trim() : "";
    return { ...s, price: byName || byPosition || "" };
  });
};

// Marketing/landing-page prefills invite "City, ST" as a single value (e.g. the
// get-your-website.html city field placeholder is literally "Boston, MA"), which
// naive comma-splitting turns into a fake extra service-area town ("MA"). This
// strips a trailing state name/abbreviation from each comma-split chunk and
// drops any chunk that IS just a bare state, for all 50 states + DC — not only
// Massachusetts — while leaving genuine multi-town lists ("Boston, Cambridge,
// Somerville") untouched, and dedupes case-insensitively.
export const US_STATE_ABBR = ["al", "ak", "az", "ar", "ca", "co", "ct", "de", "fl", "ga", "hi", "id", "il", "in", "ia", "ks", "ky", "la", "me", "md", "ma", "mi", "mn", "ms", "mo", "mt", "ne", "nv", "nh", "nj", "nm", "ny", "nc", "nd", "oh", "ok", "or", "pa", "ri", "sc", "sd", "tn", "tx", "ut", "vt", "va", "wa", "wv", "wi", "wy", "dc"];
export const US_STATE_NAMES = ["alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut", "delaware", "florida", "georgia", "hawaii", "idaho", "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana", "maine", "maryland", "massachusetts", "michigan", "minnesota", "mississippi", "missouri", "montana", "nebraska", "nevada", "new hampshire", "new jersey", "new mexico", "new york", "north carolina", "north dakota", "ohio", "oklahoma", "oregon", "pennsylvania", "rhode island", "south carolina", "south dakota", "tennessee", "texas", "utah", "vermont", "virginia", "washington", "west virginia", "wisconsin", "wyoming", "district of columbia"];
const US_STATE_TOKENS = new Set([...US_STATE_ABBR, ...US_STATE_NAMES]);
const US_STATE_SUFFIX_RE = new RegExp(
  `[,\\s]+(${[...US_STATE_NAMES, ...US_STATE_ABBR].sort((a, b) => b.length - a.length).join("|")})\\.?$`,
  "i"
);

export const normalizeServiceAreas = v => {
  const raw = first(v);
  if (!raw) return [];
  const towns = [];
  const seen = new Set();
  for (let part of String(raw).split(",").map(s => s.trim()).filter(Boolean)) {
    part = part.replace(US_STATE_SUFFIX_RE, "").trim();
    if (!part) continue;
    const key = part.toLowerCase().replace(/\.+$/, "");
    if (US_STATE_TOKENS.has(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    towns.push(part);
  }
  return towns;
};
