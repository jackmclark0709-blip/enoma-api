// Outreach filters applied before any paid step (ZeroBounce, Places, OpenAI)
// and again at send time, so a draft made before a filter existed is held too.
//
// - Franchise dealers: the owner can't buy their own site (the brand runs it),
//   and the "website" we flag is usually the brand's dealer page.
// - OUTREACH_STATES: optional allowlist of states ("MA,RI,CT"). Unset or
//   empty means every state, which is how outreach has always run.
import { US_STATE_NAMES, US_STATE_ABBR } from "./service-utils.js";

// National franchise brands common among trades prospects. Matched on the
// business name as whole words, case-insensitive.
export const FRANCHISE_BRANDS = [
  "roof maxx", "mr\\.? rooter", "mr\\.? electric", "mr\\.? handyman", "mr\\.? appliance",
  "mister sparky", "one hour (?:heating|air)", "benjamin franklin plumbing", "aire serv",
  "roto-?rooter", "rooter-?man", "ars rescue rooter", "rescue rooter", "1-800-plumber",
  "molly maid", "merry maids", "the maids", "maid pro", "maidpro", "two maids",
  "certapro", "five star painting", "fresh coat painters", "fresh coat painting",
  "lawn doctor", "trugreen", "weed man", "mosquito joe", "mosquito squad", "the grounds guys",
  "window world", "bath fitter", "re-?bath", "kitchen tune-?up", "budget blinds",
  "dryer vent wizard", "glass doctor", "chem-?dry", "zerorez", "servicemaster", "servpro",
  "paul davis", "puroclean", "rainbow restoration", "restoration 1", "precision garage door",
  "ace handyman", "handyman connection", "sears home services", "four seasons sunrooms",
  "leaffilter", "leaf filter", "power home remodeling", "renewal by andersen", "bath planet",
];
const BRAND_RE = new RegExp(`(?:^|[^a-z0-9])(?:${FRANCHISE_BRANDS.join("|")})(?:$|[^a-z0-9])`, "i");

// A website that is a page on a brand's dealer locator, not the owner's site.
// "/locations/" is left out on purpose: plenty of local businesses with
// their own site have a locations page.
const DEALER_PATH_RE = /\/(?:find-a-dealer|dealer-locator|dealers?|franchisees?)\//i;

export function isFranchiseDealer(prospect = {}) {
  const name = String(prospect.business_name || "");
  if (BRAND_RE.test(name)) return true;
  const site = String(prospect.website || "");
  try {
    const u = new URL(site);
    if (DEALER_PATH_RE.test(u.pathname + "/")) return true;
  } catch { /* no or bad website: name check only */ }
  return false;
}

const CODE_BY_NAME = Object.fromEntries(US_STATE_NAMES.map((n, i) => [n, US_STATE_ABBR[i].toUpperCase()]));
const NAME_BY_CODE = Object.fromEntries(US_STATE_ABBR.map((c, i) => [c.toUpperCase(), US_STATE_NAMES[i]]));
const titleCase = s => s.replace(/\b[a-z]/g, c => c.toUpperCase());

export function stateCodeOf(value) {
  const v = String(value || "").trim();
  if (/^[A-Za-z]{2}$/.test(v)) return NAME_BY_CODE[v.toUpperCase()] ? v.toUpperCase() : "";
  return CODE_BY_NAME[v.toLowerCase()] || "";
}

// "MA, ri,Connecticut" -> Set {"MA","RI","CT"}; unset/empty -> null (no filter).
// Unknown entries are ignored; a list with no valid entries is also null, so
// a typo can't silently stop all outreach.
export function parseStateAllowlist(value) {
  const codes = String(value || "").split(",").map(stateCodeOf).filter(Boolean);
  return codes.length ? new Set(codes) : null;
}

export function stateAllowed(prospect, allow) {
  if (!allow) return true;
  return allow.has(stateCodeOf(prospect?.state));
}

// Values for a `.in("state", ...)` filter: the codes and the names as stored
// ("Massachusetts", "MA").
export function stateQueryValues(allow) {
  if (!allow) return null;
  const out = [];
  for (const code of allow) out.push(code, titleCase(NAME_BY_CODE[code]));
  return out;
}

// What, if anything, keeps a prospect out of outreach right now.
// Returns null, "franchise_dealer" or "out_of_area".
export function outreachExclusion(prospect, env = process.env) {
  if (isFranchiseDealer(prospect)) return "franchise_dealer";
  if (!stateAllowed(prospect, parseStateAllowlist(env.OUTREACH_STATES))) return "out_of_area";
  return null;
}
