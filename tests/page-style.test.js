// Run with: node tests/page-style.test.js (also wired into `npm test`)

import assert from "node:assert/strict";
import {
  personaFor, pickPalette, splitWordmark, heroPatternSvg, isStrongRating, pickReviewQuotes, stripWeakRatingClaims, tidyHeadline,
} from "../api/_lib/page-style.js";

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (err) {
    console.error(`  FAIL - ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

console.log("personaFor");
test("maps free-text categories", () => {
  assert.equal(personaFor("Landscaping"), "landscaping");
  assert.equal(personaFor("hvac contractor"), "hvac");
  assert.equal(personaFor("house cleaning service"), "cleaning");
  assert.equal(personaFor("plumber"), "plumbing");
  assert.equal(personaFor("painting contractor"), "painting");
  assert.equal(personaFor("roofing contractor"), "contractor");
  assert.equal(personaFor("Contractor"), "contractor");
  assert.equal(personaFor(""), "default");
  assert.equal(personaFor(null), "default");
});

console.log("pickPalette");
test("is stable for the same business", () => {
  assert.deepEqual(pickPalette("Landscaping", "Stanos Landscaping"), pickPalette("Landscaping", "Stanos Landscaping"));
});
test("varies across businesses in the same trade", () => {
  const names = ["Stanos Landscaping", "CB Landscaping Inc", "ProLand Landscaping", "Tavares Landscaping", "JN Landscaping LLC", "Holdens Landscaping"];
  const distinct = new Set(names.map(n => pickPalette("Landscaping", n).name));
  assert.ok(distinct.size >= 2, `expected variety, got ${[...distinct]}`);
});

console.log("splitWordmark");
test("splits name from trade descriptor", () => {
  assert.deepEqual(splitWordmark("Stanos Landscaping"), { main: "Stanos", descriptor: "Landscaping" });
  assert.deepEqual(splitWordmark("A&D Landscaping Services Inc"), { main: "A&D", descriptor: "Landscaping Services" });
  assert.deepEqual(splitWordmark("Foley and Son Landscaping"), { main: "Foley and Son", descriptor: "Landscaping" });
  assert.deepEqual(splitWordmark("C Ryan Asphalt Paving"), { main: "C Ryan", descriptor: "Asphalt Paving" });
});
test("strips legal suffixes and keeps names with no trade word whole", () => {
  assert.deepEqual(splitWordmark("Champagne Landscaping LLC"), { main: "Champagne", descriptor: "Landscaping" });
  assert.deepEqual(splitWordmark("Acme Corp."), { main: "Acme", descriptor: "" });
  assert.deepEqual(splitWordmark("Anchor"), { main: "Anchor", descriptor: "" });
});

console.log("heroPatternSvg");
test("returns an svg data uri for every persona", () => {
  for (const p of ["landscaping", "plumbing", "cleaning", "contractor", "default"]) {
    const uri = heroPatternSvg(p, pickPalette(p, "X"), 42);
    assert.ok(uri.startsWith("data:image/svg+xml"), p);
  }
});

console.log("isStrongRating");
test("hides weak or thin ratings", () => {
  assert.equal(isStrongRating(4, 1), false);
  assert.equal(isStrongRating(5, 2), false);
  assert.equal(isStrongRating(4.4, 50), false);
  assert.equal(isStrongRating(4.8, 12), true);
  assert.equal(isStrongRating(undefined, undefined), false);
});

console.log("pickReviewQuotes");
test("keeps substantive 4-5 star reviews, drops short and low ones", () => {
  const long = "They showed up on time, cleaned up everything after, and the lawn has never looked better. Highly recommend.";
  const quotes = pickReviewQuotes([
    { rating: 5, text: { text: long }, authorAttribution: { displayName: "Pat" } },
    { rating: 5, text: { text: "Great!" } },
    { rating: 2, text: { text: long } },
    { rating: 4, text: { text: long + " A bit pricey." }, authorAttribution: { displayName: "Sam" } },
  ]);
  assert.equal(quotes.length, 2);
  assert.equal(quotes[0].author, "Pat");
  assert.equal(quotes[0].source, "google");
});
test("truncates very long reviews on a word boundary", () => {
  const q = pickReviewQuotes([{ rating: 5, text: { text: "word ".repeat(200) } }]);
  assert.ok(q[0].quote.length <= 361 && q[0].quote.endsWith("…"));
});
test("handles missing input", () => {
  assert.deepEqual(pickReviewQuotes(undefined), []);
});

console.log("stripWeakRatingClaims");
test("removes thin rating claims from generated preview copy", () => {
  const out = stripWeakRatingClaims({
    primary_category: "Landscaping", city: "Mansfield", state: "Massachusetts",
    hero_tagline: "Rated 4★ on Google in Mansfield, MA.",
    trust_badges: ["Mansfield, MA", "4★ from 1 Google review"],
    why_choose_us: ["Based in Mansfield, MA", "4★ rating from 1 Google review"],
  });
  assert.equal(out.hero_tagline, "Landscaping and lawn care in Mansfield, MA — call for a free, no-obligation quote.");
  assert.deepEqual(out.trust_badges, ["Mansfield, MA"]);
  assert.deepEqual(out.why_choose_us, ["Based in Mansfield, MA"]);
});
test("keeps strong rating claims and unrelated copy", () => {
  const p = { hero_tagline: "Family-owned since 1985.", trust_badges: ["4.9★ from 87 Google reviews", "Licensed & Insured"], why_choose_us: "Owner on every job.\nFree estimates." };
  const out = stripWeakRatingClaims(p);
  assert.equal(out.hero_tagline, p.hero_tagline);
  assert.deepEqual(out.trust_badges, p.trust_badges);
  assert.equal(out.why_choose_us, p.why_choose_us);
});

console.log("tidyHeadline");
test("drops a trailing repeat of the business name", () => {
  assert.equal(tidyHeadline("Attleboro Paving — C Ryan Asphalt Paving", "C Ryan Asphalt Paving"), "Attleboro Paving");
  assert.equal(tidyHeadline("Reliable Lawn Care in Agawam", "Conway's Landscaping"), "Reliable Lawn Care in Agawam");
  assert.equal(tidyHeadline("", "X"), "");
});

console.log(`${passed} passed`);
