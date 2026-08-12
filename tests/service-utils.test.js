// Lightweight, dependency-free test for the two P0 bug fixes:
//   1. service prices silently dropped during AI generation
//   2. state abbreviations ("MA") becoming fake service-area towns
// Run with: node tests/service-utils.test.js  (also wired into `npm test`)

import assert from "node:assert/strict";
import {
  mergeUserServicePrices,
  normalizeServiceAreas
} from "../api/_lib/service-utils.js";

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

console.log("mergeUserServicePrices");

test("backfills a price onto an AI-generated service with the same name", () => {
  const aiServices = [{ service_name: "Weekly Mowing", service_description: "Regular lawn cuts." }];
  const rawUser = JSON.stringify([{ service_name: "Weekly Mowing", service_description: "", price: "$50" }]);
  const result = mergeUserServicePrices(aiServices, rawUser);
  assert.equal(result[0].price, "$50");
  assert.equal(result[0].service_description, "Regular lawn cuts.");
});

test("falls back to position when the AI reworded the service name", () => {
  const aiServices = [{ service_name: "Lawn Mowing & Edging", service_description: "..." }];
  const rawUser = JSON.stringify([{ service_name: "Mowing", service_description: "", price: "From $50" }]);
  const result = mergeUserServicePrices(aiServices, rawUser);
  assert.equal(result[0].price, "From $50");
});

test("never overwrites a price that's already present (manual/no-regenerate path)", () => {
  const manualServices = [{ service_name: "Mowing", service_description: "", price: "$60" }];
  const rawUser = JSON.stringify([{ service_name: "Mowing", service_description: "", price: "$999 (should not win)" }]);
  const result = mergeUserServicePrices(manualServices, rawUser);
  assert.equal(result[0].price, "$60");
});

test("leaves price empty when the user never entered one (does not fabricate)", () => {
  const aiServices = [{ service_name: "Snow Plowing", service_description: "..." }];
  const rawUser = JSON.stringify([{ service_name: "Snow Plowing", service_description: "", price: "" }]);
  const result = mergeUserServicePrices(aiServices, rawUser);
  assert.equal(result[0].price, "");
});

test("is a no-op when there is no raw user service data at all", () => {
  const aiServices = [{ service_name: "Mowing", service_description: "..." }];
  const result = mergeUserServicePrices(aiServices, "");
  assert.equal(result, aiServices);
});

test("handles multiple services, matching each independently", () => {
  const aiServices = [
    { service_name: "Mowing", service_description: "a" },
    { service_name: "Leaf Removal", service_description: "b" }
  ];
  const rawUser = JSON.stringify([
    { service_name: "Mowing", service_description: "", price: "$50" },
    { service_name: "Leaf Removal", service_description: "", price: "$80" }
  ]);
  const result = mergeUserServicePrices(aiServices, rawUser);
  assert.equal(result[0].price, "$50");
  assert.equal(result[1].price, "$80");
});

console.log("normalizeServiceAreas");

test("drops a bare state abbreviation split out by the comma parser (the reported bug)", () => {
  assert.deepEqual(normalizeServiceAreas("Agawam, MA"), ["Agawam"]);
});

test("strips a trailing state abbreviation with no comma at all", () => {
  assert.deepEqual(normalizeServiceAreas("Agawam MA"), ["Agawam"]);
});

test("drops a full state name, not just abbreviations", () => {
  assert.deepEqual(normalizeServiceAreas("Boston, Massachusetts"), ["Boston"]);
});

test("works for states other than Massachusetts (robust, not a one-off patch)", () => {
  assert.deepEqual(normalizeServiceAreas("Austin, TX"), ["Austin"]);
  assert.deepEqual(normalizeServiceAreas("Tampa, Florida"), ["Tampa"]);
});

test("preserves a genuine multi-town service area untouched", () => {
  assert.deepEqual(
    normalizeServiceAreas("Springfield, Agawam, West Springfield"),
    ["Springfield", "Agawam", "West Springfield"]
  );
});

test("dedupes case-insensitively", () => {
  assert.deepEqual(normalizeServiceAreas("Agawam, agawam, AGAWAM"), ["Agawam"]);
});

test("returns an empty array for empty input", () => {
  assert.deepEqual(normalizeServiceAreas(""), []);
  assert.deepEqual(normalizeServiceAreas(undefined), []);
});

test("does not mistake a two-word town containing 'new' for New York/New Jersey etc.", () => {
  assert.deepEqual(normalizeServiceAreas("New Bedford, MA"), ["New Bedford"]);
});

console.log(`\n${passed} passed`);
if (process.exitCode) {
  console.error("SOME TESTS FAILED");
} else {
  console.log("ALL TESTS PASSED");
}
