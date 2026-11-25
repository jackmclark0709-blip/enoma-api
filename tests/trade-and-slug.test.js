// Run with: node tests/trade-and-slug.test.js (also wired into `npm test`)
// Fixes from the first builds under the new pipeline (Nov 24-25, 2026):
//   - builds failed on "businesses_slug_key": uniqueSlug only checked pages,
//     not the businesses half-finished builds had left behind
//   - HVAC and landscaping pages said "General contractor in ..." and used
//     contractor FAQs, because Enoma's broad category won over Google's type
//   - a home inspector found by a house-cleaning search was drafted

import assert from "node:assert/strict";
import fs from "node:fs";
import { specificTrade, buildFactSheet } from "../api/_lib/fact-sheet.js";
import { buildEyebrow, tradeNoun } from "../api/_lib/page-copy.js";
import { personaForProfile, copyFor, factsFor } from "../api/_lib/page-v3.js";
import { isUnsupportedCategory } from "../api/_lib/prospect-filters.js";

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { console.error(`  FAIL - ${name}`); console.error(err); process.exitCode = 1; }
}
const src = fs.readFileSync(new URL("../api/ga-metrics.js", import.meta.url), "utf8");
const slice = (from, len = 2000) => { const i = src.indexOf(from); assert.ok(i >= 0, `missing: ${from}`); return src.slice(i, i + len); };

await test("trade: Google's specific type beats a broad bucket; real contractors stay contractors", () => {
  assert.equal(specificTrade({ trade: "general contractor", primary_type: "HVAC contractor" }), "HVAC contractor");
  assert.equal(specificTrade({ trade: "general contractor", primary_type: "Landscaper" }), "Landscaper");
  assert.equal(specificTrade({ trade: "services", primary_type: "Home inspector" }), "Home inspector");
  assert.equal(specificTrade({ trade: "general contractor", primary_type: "General contractor" }), "general contractor");
  assert.equal(specificTrade({ trade: "plumber", primary_type: "Drainage service" }), "plumber", "a specific trade is kept");
  assert.equal(specificTrade({ trade: "", primary_type: "Electrician" }), "Electrician");
});

await test("eyebrow and persona: Dalton's HVAC page reads HVAC, not General contractor", () => {
  const fsheet = { business: { trade: "general contractor", primary_type: "HVAC contractor", town: "Lafayette", state: "LA" } };
  assert.equal(buildEyebrow(fsheet), "HVAC contractor in Lafayette, LA");
  assert.equal(tradeNoun(fsheet), "HVAC contractor");
  assert.equal(personaForProfile({ fact_sheet: fsheet }), "hvac");
  const land = { business: { trade: "general contractor", primary_type: "Landscaper", town: "Santa Rosa", state: "CA" } };
  assert.equal(personaForProfile({ fact_sheet: land }), "landscaping", "landscaper FAQs, not masonry");
});

await test("eyebrow is rebuilt at render time, so pages saved with the old eyebrow are fixed", () => {
  const profile = {
    business_name: "Dalton's HVAC & Refrigeration",
    fact_sheet: { business: { name: "Dalton's HVAC & Refrigeration", trade: "general contractor", primary_type: "HVAC contractor", town: "Lafayette", state: "LA" }, reviews: [] },
    page_copy_v3: { eyebrow: "General contractor in Lafayette, LA", hero_headline: "HVAC Repairs in Lafayette" },
  };
  assert.equal(copyFor(profile, factsFor(profile)).hero.eyebrow, "HVAC contractor in Lafayette, LA");
  assert.equal(copyFor({ page_copy_v3: { eyebrow: "Plumber in Attleboro, MA" } }).hero.eyebrow, "Plumber in Attleboro, MA", "no fact sheet: stored eyebrow");
});

await test("fact sheet: new builds store the specific trade", () => {
  const fsheet = buildFactSheet({ profile: { business_name: "Dalton's", primary_category: "general contractor" }, raw: { type: "HVAC contractor" } });
  assert.equal(fsheet.business.trade, "HVAC contractor");
});

await test("fact sheet source: trade is passed through specificTrade", () => {
  const fsrc = fs.readFileSync(new URL("../api/_lib/fact-sheet.js", import.meta.url), "utf8");
  assert.match(fsrc, /business\.trade = specificTrade\(business\) \|\| business\.trade;/);
});

await test("category: listings with no supported trade type are excluded; trades and missing types aren't", () => {
  assert.equal(isUnsupportedCategory({ raw: { type: "Home inspector", subtypes: "Home inspector, Pest control service" } }), true);
  assert.equal(isUnsupportedCategory({ raw: { type: "Landscaper", subtypes: "Landscaper, Landscape designer" } }), false);
  assert.equal(isUnsupportedCategory({ raw: { type: "House cleaning service", subtypes: "House cleaning service, Janitorial service" } }), false);
  assert.equal(isUnsupportedCategory({ raw: { type: "Air conditioning contractor" } }), false);
  assert.equal(isUnsupportedCategory({ raw: {} }), false);
  assert.equal(isUnsupportedCategory({}), false);
});

await test("wiring: category check runs in prepare (before paid checks) and at send", () => {
  const free = slice("// 1. Free checks.", 2600);
  const c = free.indexOf("isUnsupportedCategory(prospect)");
  assert.ok(c > 0 && c < free.indexOf("classifyEmail("), "before the email and site checks");
  assert.match(free, /fail\(prospect, "excluded_wrong_category", "category_not_supported"\)/);
  const send = slice("// Drafted before the franchise and category filters existed", 900);
  assert.match(send, /status: "excluded_wrong_category"/);
});

await test("slug: a slug is free only when no page and no business uses it", () => {
  const f = slice("async function uniqueSlug(base)", 900);
  assert.match(f, /from\("small_business_profiles"\)\.select\("id"\)\.eq\("username", slug\)/);
  assert.match(f, /from\("businesses"\)\.select\("id"\)\.eq\("slug", slug\)/);
  assert.match(f, /if \(!page\?\.length && !biz\?\.length\) return slug;/);
  assert.match(f, /if \(pageErr \|\| bizErr\) throw pageErr \|\| bizErr;/);
});

console.log(`\n${passed} passed`);
