// Per-trade example pages (public/examples/<key>.html, built by
// scripts/build-example-pages.mjs from the made-up businesses in
// scripts/example-businesses.mjs). The "example" outreach arm shows one of
// these in the cold email and builds the prospect's own page only when they
// click (api/ga-metrics.js action=build_page).
//
// Every example is a made-up business, labeled as one on the page. Nothing
// here may claim real results.

const BASE = "https://enoma.io";

export const EXAMPLE_PAGES = Object.freeze({
  landscaping: { key: "landscaping", business: "Birchline Landscaping", noun: "landscaping company" },
  plumbing: { key: "plumbing", business: "Copperfield Plumbing & Heating", noun: "plumbing company" },
  electrical: { key: "electrical", business: "Brightwire Electric", noun: "electrician" },
  hvac: { key: "hvac", business: "Hearthside Heating & Air", noun: "heating and cooling company" },
  roofing: { key: "roofing", business: "Ridgecap Roofing", noun: "roofing company" },
  painting: { key: "painting", business: "Trueline Painting", noun: "painting company" },
  cleaning: { key: "cleaning", business: "Sparrow Lane Home Cleaning", noun: "cleaning company" },
  contractor: { key: "contractor", business: "Oakbeam Builders", noun: "contractor" },
});

// Order matters: the specific trades before the catch-all "contractor".
const TRADE_RULES = [
  [/roof/i, "roofing"],
  [/hvac|heating|cooling|air condition|furnace|boiler/i, "hvac"],
  [/plumb|drain|rooter/i, "plumbing"],
  [/electric/i, "electrical"],
  [/paint/i, "painting"],
  [/clean|maid|janitor/i, "cleaning"],
  [/landscap|lawn|tree|garden|snow|yard/i, "landscaping"],
  [/contractor|construction|remodel|builder|carpent|handyman|renovat/i, "contractor"],
];

/** The example page for a prospect's trade, or null when none fits. */
export function exampleForTrade(trade) {
  const t = String(trade || "");
  for (const [re, key] of TRADE_RULES) if (re.test(t)) return EXAMPLE_PAGES[key];
  return null;
}

export function examplePath(entry) {
  return entry ? `/examples/${entry.key}.html` : null;
}

export function exampleUrl(entry) {
  return entry ? `${BASE}${examplePath(entry)}` : null;
}

/**
 * Which outreach arm a prospect is in: "example" (example page in the email,
 * their own page built on click) or "personal" (their page built up front).
 * Deterministic per prospect id, so a prospect never switches arms between
 * runs. share: OUTREACH_EXAMPLE_SHARE, 0-100 (percent in the example arm).
 */
export function outreachArmFor(prospectId, share) {
  const pct = Math.max(0, Math.min(100, Number.parseInt(share, 10) || 0));
  if (pct <= 0) return "personal";
  if (pct >= 100) return "example";
  let h = 2166136261;
  for (const ch of String(prospectId || "")) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return (h % 100) < pct ? "example" : "personal";
}

/**
 * Whether a prospect can go in the example arm: an example page exists for
 * their trade and their page isn't built yet. (The listing checks, phone and
 * rating, already ran in prepare_outreach's free checks.)
 */
export function exampleArmEligible(prospect) {
  return !prospect?.preview_url && !!exampleForTrade(prospect?.trade || prospect?.raw?.type);
}
