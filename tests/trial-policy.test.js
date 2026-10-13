// Run with: node tests/trial-policy.test.js (also wired into `npm test`)
import assert from "node:assert/strict";
import { trialStartsAt, isGrandfathered } from "../api/_lib/trial-policy.js";

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (err) { console.error(`FAIL: ${name}`); throw err; }
}

const env = { PRICING_TRIAL_STARTS_AT: "2026-10-14T04:00:00Z" };

test("with no start date set, every page is grandfathered (nothing turns off)", () => {
  assert.equal(trialStartsAt({}), null);
  assert.equal(isGrandfathered("2027-01-01T00:00:00Z", {}), true);
});

test("a bad start date is treated as unset", () => {
  assert.equal(isGrandfathered("2027-01-01T00:00:00Z", { PRICING_TRIAL_STARTS_AT: "soon" }), true);
});

test("pages created before the start keep free-for-good", () => {
  assert.equal(isGrandfathered("2026-10-11T12:28:26Z", env), true);
  assert.equal(isGrandfathered("2025-12-17T19:51:05Z", env), true);
});

test("pages created at or after the start are on the trial clock", () => {
  assert.equal(isGrandfathered("2026-10-14T04:00:00Z", env), false);
  assert.equal(isGrandfathered("2026-11-01T00:00:00Z", env), false);
});

test("a page with no created date is never turned off", () => {
  assert.equal(isGrandfathered(null, env), true);
});

console.log(`trial-policy: ${passed} tests passed`);
