// Run with: node tests/reviews.test.js (also wired into `npm test`)

import assert from "node:assert/strict";
import { cleanReview, addTestimonial, googleReviewUrl } from "../api/_lib/reviews.js";
import { gapCheck, expandQuickIntake, slugifyService } from "../api/_lib/spotlight.js";

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { console.error(`  FAIL - ${name}`); console.error(err); process.exitCode = 1; }
}

console.log("reviews");
test("valid review is cleaned and trimmed", () => {
  assert.deepEqual(cleanReview({ name: " Sarah ", quote: " Great leaf cleanup ", rating: "5" }),
    { ok: true, value: { name: "Sarah", quote: "Great leaf cleanup", rating: 5 } });
});
test("missing name, bad rating or empty quote are rejected", () => {
  assert.equal(cleanReview({ quote: "Great job", rating: 5 }).ok, false);
  assert.equal(cleanReview({ name: "A", quote: "Great job", rating: 9 }).ok, false);
  assert.equal(cleanReview({ name: "A", quote: "ok", rating: 5 }).ok, false);
});
test("approved review goes first and duplicates are skipped", () => {
  const existing = [{ quote: "Old", author: "Shana" }];
  const out = addTestimonial(existing, { name: "Sarah", quote: "New one", rating: 5 });
  assert.deepEqual(out[0], { quote: "New one", author: "Sarah", rating: 5, source: "enoma" });
  assert.equal(addTestimonial(out, { name: "Sarah", quote: "New one", rating: 5 }).length, 2);
});
test("Google review link only with a place id", () => {
  assert.equal(googleReviewUrl(null), null);
  assert.match(googleReviewUrl("ChIJabc"), /writereview\?placeid=ChIJabc$/);
});

console.log("quick spotlight survey");
const quick = { mode: "quick", service_name: "Snow Removal", one_liner: "Driveway and walkway plowing in Agawam.", deliverables: "Driveway plowed\nWalkway shoveled", turnaround: "Agawam and West Springfield, after each storm", pricing_mode: "request a quote", cta_type: "request a quote" };
test("five answers are enough in quick mode", () => {
  assert.equal(gapCheck(quick).ready, true);
  assert.equal(gapCheck({ ...quick, mode: "detailed" }).ready, false);
});
test("quick intake gets neutral steps and the one-liner as outcome", () => {
  const x = expandQuickIntake(quick);
  assert.equal(x.outcome, quick.one_liner);
  assert.equal(x.steps.split("\n").length, 3);
  assert.equal(expandQuickIntake({ ...quick, steps: "A\nB" }).steps, "A\nB");
});
test("'review' is reserved for the review page", () => {
  assert.equal(slugifyService("Review"), "review-service");
  assert.equal(slugifyService("Snow Removal"), "snow-removal");
});

console.log(`\n${passed} passed`);
