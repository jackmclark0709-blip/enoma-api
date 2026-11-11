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

import { selfServeFirstTouch } from "../api/_lib/attribution.js";
assert.deepEqual(selfServeFirstTouch(null, "instant_preview"), { created_via: "instant_preview" });
assert.deepEqual(
  selfServeFirstTouch({ landing: "/for/website-for-hvac-business", utm_source: "google", utm_medium: "cpc", utm_campaign: "hvac", junk: 1 }, "create", "https://www.google.com/"),
  { landing: "/for/website-for-hvac-business", utm_source: "google", utm_medium: "cpc", utm_campaign: "hvac", referrer: "https://www.google.com/", created_via: "create" }
);
assert.equal(selfServeFirstTouch({ referrer: "https://facebook.com/" }, "create", "https://x.test/").referrer, "https://facebook.com/");
console.log("selfServeFirstTouch: ok");
