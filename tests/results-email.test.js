// Run with: node tests/results-email.test.js (also wired into `npm test`)

import assert from "node:assert/strict";
import { previousMonth, tallyClicks, buildResultsEmail } from "../api/_lib/results-email.js";

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { console.error(`  FAIL - ${name}`); console.error(err); process.exitCode = 1; }
}

console.log("results-email");
test("previous month window, including January rollover", () => {
  const m = previousMonth(new Date("2026-10-01T10:00:00Z"));
  assert.equal(m.start.toISOString(), "2026-09-01T00:00:00.000Z");
  assert.equal(m.end.toISOString(), "2026-10-01T00:00:00.000Z");
  assert.equal(m.label, "September 2026");
  assert.equal(previousMonth(new Date("2027-01-01T00:00:00Z")).label, "December 2026");
});
test("click tally separates calls, ignores form clicks", () => {
  const t = tallyClicks([{ metadata: { type: "call" } }, { metadata: { type: "mobile_bar_call" } }, { metadata: { type: "contact_form" } }, { metadata: { type: "email" } }, {}]);
  assert.deepEqual(t, { calls: 2, other: 2 });
});
test("email with activity", () => {
  const e = buildResultsEmail({ businessName: "Conway's Landscaping", ownerName: "Jack", monthLabel: "September 2026", views: 120, calls: 4, otherClicks: 1, quoteRequests: 2, pageUrl: "https://enoma.io/conways-landscaping" });
  assert.equal(e.subject, "Conway's Landscaping: 7 customers reached out through your page in September 2026");
  assert.ok(e.text.includes("- 4 taps to call you") && e.text.includes("- 2 quote requests"));
});
test("singulars and quiet months", () => {
  const e = buildResultsEmail({ businessName: "X", monthLabel: "May 2026", views: 1, calls: 0, otherClicks: 0, quoteRequests: 0, pageUrl: "u" });
  assert.equal(e.subject, "X: Your page had 1 visit in May 2026");
  assert.ok(e.text.includes("No one reached out"));
});
test("nothing to report -> null", () => {
  assert.equal(buildResultsEmail({ businessName: "X", monthLabel: "May", views: 0, calls: 0, otherClicks: 0, quoteRequests: 0, pageUrl: "u" }), null);
});

console.log(`${passed} passed`);
