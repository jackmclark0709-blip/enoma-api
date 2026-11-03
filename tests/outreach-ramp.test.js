// Run with: node tests/outreach-ramp.test.js (also wired into `npm test`)

import assert from "node:assert/strict";
import { rampCapForDate } from "../api/_lib/outreach-ramp.js";

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

console.log("rampCapForDate");

const start = new Date("2026-09-01T00:00:00Z");
const daysAfter = n => new Date(start.getTime() + n * 24 * 60 * 60 * 1000);

test("day 0 (launch) caps at 5", () => {
  assert.equal(rampCapForDate(daysAfter(0), start), 5);
  assert.equal(rampCapForDate(daysAfter(2.9), start), 5);
});

test("day 3 steps up to 10", () => {
  assert.equal(rampCapForDate(daysAfter(3), start), 10);
  assert.equal(rampCapForDate(daysAfter(6.9), start), 10);
});

test("day 7 steps up to 15", () => {
  assert.equal(rampCapForDate(daysAfter(7), start), 15);
  assert.equal(rampCapForDate(daysAfter(13.9), start), 15);
});

test("day 14 steps up to 20", () => {
  assert.equal(rampCapForDate(daysAfter(14), start), 20);
  assert.equal(rampCapForDate(daysAfter(62.9), start), 20);
});

test("day 63 (Nov 3 2026) reaches the steady-state 30", () => {
  assert.equal(rampCapForDate(daysAfter(63), start), 30);
  assert.equal(rampCapForDate(daysAfter(200), start), 30);
});

test("before the start date, still capped at the lowest step (never negative/unbounded)", () => {
  assert.equal(rampCapForDate(daysAfter(-5), start), 5);
});

console.log(`\n${passed} passed`);

import { capWithBounceBrake } from "../api/_lib/outreach-ramp.js";
{
  const assert2 = (await import("node:assert/strict")).default;
  assert2.equal(capWithBounceBrake(20, { sends7d: 100, bounces7d: 2 }), 20);
  assert2.equal(capWithBounceBrake(20, { sends7d: 100, bounces7d: 4 }), 10);
  assert2.equal(capWithBounceBrake(20, { sends7d: 10, bounces7d: 5 }), 20, "too few sends to judge");
  console.log("bounce brake: ok");
}

import { followUpAllowance } from "../api/_lib/outreach-ramp.js";
{
  const assert3 = (await import("node:assert/strict")).default;
  assert3.equal(followUpAllowance({ dailyCap: 30 }), 10, "follow-ups capped at 10 even with 30 free");
  assert3.equal(followUpAllowance({ dailyCap: 30, followupsToday: 7 }), 3, "only the rest of today's 10");
  assert3.equal(followUpAllowance({ dailyCap: 30, sentToday: 25 }), 5, "never past the overall cap");
  assert3.equal(followUpAllowance({ dailyCap: 10, sentToday: 4, followupsToday: 6 }), 0, "brake cap used up");
  assert3.equal(followUpAllowance({ dailyCap: 30, followupsToday: 12 }), 0, "never negative");
  console.log("follow-up allowance: ok");
}
