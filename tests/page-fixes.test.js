// Run with: node tests/page-fixes.test.js (also wired into `npm test`)
// Page fixes from the example-page audit (Nov 20, 2026):
//   - the hero card's review isn't repeated in the review grid; the grid
//     keeps full rows of three
//   - "Open on Saturdays" comes after review-backed stats and only fills a
//     row that would have fewer than 3
//   - the FAQ section lines up with the rest of the page
//   - a remodeler's bathroom card gets a bathroom photo, not a roof
//   - example pages: readable yellow pills, a one-line banner on phones,
//     6 sample reviews each, no photo shared between two examples

import assert from "node:assert/strict";
import fs from "node:fs";
import { proofItemsV3, factsFor, heroReviewShown } from "../api/_lib/page-v3.js";
import { stockForService, tagForService } from "../api/_lib/stock-library.js";
import { exampleProfiles } from "../scripts/example-businesses.mjs";
import { buildExamplePages } from "../scripts/build-example-pages.mjs";

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { console.error(`  FAIL - ${name}`); console.error(err); process.exitCode = 1; }
}
const read = rel => fs.readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const KEYS = ["landscaping", "plumbing", "electrical", "hvac", "roofing", "painting", "cleaning", "contractor"];
const SAT_HOURS = ["Monday: 7:00 AM – 5:00 PM", "Tuesday: 7:00 AM – 5:00 PM", "Wednesday: 7:00 AM – 5:00 PM", "Thursday: 7:00 AM – 5:00 PM", "Friday: 7:00 AM – 5:00 PM", "Saturday: 8:00 AM – 12:00 PM", "Sunday: Closed"];

await test("stats: Saturdays only fills a short row, and comes last", () => {
  const fsheet = { business: { hours: SAT_HOURS, rating: 4.9, review_count: 41 } };
  const facts = { google: { rating: 4.9, count: 41 }, years_in_business: 14 };
  const ai = [{ value: "On time", evidence: ["r1", "r2"] }];
  const full = proofItemsV3(fsheet, facts, ai).map(x => x.big);
  assert.deepEqual(full, ["4.9 ★", "14 years", "On time"], "3 stronger stats: no Saturdays");
  const short = proofItemsV3(fsheet, facts, []).map(x => x.big);
  assert.deepEqual(short, ["4.9 ★", "14 years", "Saturdays"], "2 stats: Saturdays fills the row, last");
});

await test("examples: every page has 3 stats and none of them is Saturdays", () => {
  for (const key of KEYS) {
    const html = read(`public/examples/${key}.html`);
    const stats = [...html.matchAll(/<span class="v3-proof__big">([^<]+)<\/span>/g)].map(m => m[1]);
    assert.equal(stats.length, 3, `${key}: ${stats.join(", ")}`);
    assert.ok(!stats.includes("Saturdays"), key);
  }
});

await test("reviews: the hero card's review isn't in the grid; the grid is full rows", () => {
  for (const { key, profile } of exampleProfiles()) {
    assert.equal(profile.fact_sheet.reviews.length, 6, `${key}: 6 sample reviews`);
    const html = read(`public/examples/${key}.html`);
    const hero = heroReviewShown(factsFor(profile));
    assert.ok(hero, `${key}: hero shows a review`);
    const grid = html.slice(html.indexOf('<div class="v3-reviews">'));
    assert.ok(!grid.slice(0, grid.indexOf("</section>")).includes(hero.quote.slice(0, 50)), `${key}: hero review repeated`);
    assert.equal((html.match(/<figure class="v3-review">/g) || []).length % 3, 0, `${key}: full rows`);
  }
});

await test("FAQ: heading in a v3-head like other sections; list keeps a readable width", () => {
  const html = read("public/examples/landscaping.html");
  assert.match(html, /<div class="v3-head"><h2 id="faqHeading" class="v3-h2">Common questions<\/h2><\/div>\s*<div class="v3-faqs">/);
  assert.match(read("public/styles/business-base.css"), /\.page-v3 \.v3-faqs \{ max-width: 820px; \}/);
});

await test("photos: a remodeler's bathroom card gets a bathroom photo", () => {
  assert.equal(tagForService("contractor", "Bathrooms and mudrooms"), "plumbing/bathroom");
  assert.equal(stockForService({ persona: "contractor", name: "Bathroom remodels", seed: "x" }).key, "plumbing/bathroom");
  assert.equal(tagForService("cleaning", "Kitchens and bathrooms"), tagForService("cleaning", "Kitchens and bathrooms"), "own tags still win");
  assert.ok(!/plumbing\//.test(tagForService("cleaning", "Bathroom cleaning")), "cleaning keeps its own bathroom photos");
});

await test("examples: no stock photo is shared by two example pages", () => {
  const seen = new Map();
  for (const key of KEYS) {
    const ids = new Set([...read(`public/examples/${key}.html`).matchAll(/\/stock\/([A-Za-z0-9_-]+?)-(?:800|1600)\.webp/g)].map(m => m[1]));
    for (const id of ids) {
      assert.ok(!seen.has(id), `${id} is on both ${seen.get(id)} and ${key}`);
      seen.set(id, key);
    }
  }
});

await test("examples: yellow pills force dark text; the phone banner is one short line", () => {
  const html = read("public/examples/plumbing.html");
  const css = html.match(/\.ex-tag\{[^}]+\}/)[0];
  assert.match(css, /background:#ffe14d!important/);
  assert.match(css, /color:#111827!important/);
  assert.match(html, /@media \(max-width:640px\)\{[^}]*\}\.ex-banner \.ex-long\{display:none\}/);
  assert.match(html, /<span class="ex-short">A made-up business\.<\/span>/);
});

await test("examples: the committed pages match the build script", async () => {
  const built = await buildExamplePages({ write: false });
  assert.equal(built.length, KEYS.length);
  // The rebuild is deterministic: rebuilding must not change the files.
  const before = KEYS.map(k => read(`public/examples/${k}.html`));
  await buildExamplePages({ write: true });
  KEYS.forEach((k, i) => assert.equal(read(`public/examples/${k}.html`), before[i], `${k}.html is stale: run node scripts/build-example-pages.mjs`));
});

console.log(`\n${passed} passed`);
