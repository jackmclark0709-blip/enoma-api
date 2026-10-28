// Run with: node tests/attribution.test.js (also wired into `npm test`)
import assert from "node:assert/strict";
import { cleanAttribution } from "../api/_lib/attribution.js";

assert.equal(cleanAttribution(null), null);
assert.equal(cleanAttribution("x"), null);
assert.equal(cleanAttribution({}), null);
assert.deepEqual(
  cleanAttribution({ from: "angi-alternatives-for-contractors", cta: "hero", utm_source: "facebook", evil: "<script>", landing: 5 }),
  { from: "angi-alternatives-for-contractors", cta: "hero", utm_source: "facebook" }
);
assert.equal(cleanAttribution({ from: "a".repeat(500) }).from.length, 100);
console.log("attribution: ok");
