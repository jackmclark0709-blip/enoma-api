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

test("day 14 reaches the steady-state 20", () => {
  assert.equal(rampCapForDate(daysAfter(14), start), 20);
  assert.equal(rampCapForDate(daysAfter(100), start), 20);
});

test("before the start date, still capped at the lowest step (never negative/unbounded)", () => {
  assert.equal(rampCapForDate(daysAfter(-5), start), 5);
});

console.log(`\n${passed} passed`);
