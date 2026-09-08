// Run with: node tests/prospect-rotation.test.js (also wired into `npm test`)

import assert from "node:assert/strict";
import { townForDate, TOWNS } from "../api/_lib/prospect-rotation.js";

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

console.log("townForDate");

test("Jan 1 picks the first town", () => {
  assert.equal(townForDate(new Date("2026-01-01T12:00:00Z")), TOWNS[0]);
});

test("advances one town per day", () => {
  assert.equal(townForDate(new Date("2026-01-02T12:00:00Z")), TOWNS[1]);
  assert.equal(townForDate(new Date("2026-01-03T12:00:00Z")), TOWNS[2]);
});

test("wraps around after the full list", () => {
  const wrapped = new Date(Date.UTC(2026, 0, 1 + TOWNS.length));
  assert.equal(townForDate(wrapped), TOWNS[0]);
});

test("time of day doesn't change the pick, only the calendar date", () => {
  assert.equal(
    townForDate(new Date("2026-03-05T00:00:01Z")),
    townForDate(new Date("2026-03-05T23:59:59Z"))
  );
});

test("custom town list is respected", () => {
  const custom = ["A", "B", "C"];
  assert.equal(townForDate(new Date("2026-01-01T00:00:00Z"), custom), "A");
  assert.equal(townForDate(new Date("2026-01-04T00:00:00Z"), custom), "A");
});

console.log(`\n${passed} passed`);
