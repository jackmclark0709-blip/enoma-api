// Run with: node tests/content-performance.test.js (also wired into `npm test`)
import assert from "node:assert/strict";
import { slugFromPageUrl, summarizeContent } from "../api/_lib/content-performance.js";

assert.equal(slugFromPageUrl("https://enoma.io/for/angi-alternatives-for-contractors"), "angi-alternatives-for-contractors");
assert.equal(slugFromPageUrl("https://enoma.io/for/angi-alternatives-for-contractors.html"), "angi-alternatives-for-contractors");
assert.equal(slugFromPageUrl("https://enoma.io/for/x-y?from=a"), "x-y");
assert.equal(slugFromPageUrl("https://enoma.io/conways-landscaping"), null);

const out = summarizeContent(
  [
    { keys: ["https://enoma.io/for/angi-alternatives-for-contractors"], clicks: 3, impressions: 100, position: 14 },
    { keys: ["https://enoma.io/for/angi-alternatives-for-contractors.html"], clicks: 1, impressions: 100, position: 20 },
    { keys: ["https://enoma.io/"], clicks: 9, impressions: 900, position: 3 },
  ],
  [
    { keys: ["https://enoma.io/for/angi-alternatives-for-contractors", "angi alternatives"], clicks: 2, impressions: 60, position: 12.34 },
    { keys: ["https://enoma.io/for/angi-alternatives-for-contractors", "sites like angi"], clicks: 1, impressions: 15, position: 30 },
    { keys: ["https://enoma.io/for/angi-alternatives-for-contractors", "is angi worth it"], clicks: 0, impressions: 40, position: 6 },
  ],
  [
    { event: "cta_clicked", metadata: { from: "angi-alternatives-for-contractors", cta: "hero" } },
    { event: "instant_preview_started", metadata: { from: "angi-alternatives-for-contractors" } },
    { event: "instant_preview_started", metadata: { from: "how-to-get-more-hvac-customers" } },
    { event: "instant_preview_started", metadata: {} },
  ]
);

const angi = out.pages.find(p => p.slug === "angi-alternatives-for-contractors");
assert.equal(angi.impressions, 200);
assert.equal(angi.clicks, 4);
assert.equal(angi.avg_position, 17);
assert.equal(angi.ctr, 0.02);
assert.equal(angi.cta_clicks, 1);
assert.equal(angi.previews_started, 1);
assert.equal(angi.top_queries[0].query, "angi alternatives");
// Only "angi alternatives" is both searched enough and off page one.
assert.deepEqual(angi.paid_test_queries.map(q => q.query), ["angi alternatives"]);
// Non-guide pages are ignored; signups from guides with no impressions still count.
assert.ok(!out.pages.find(p => p.slug === null));
assert.equal(out.pages.find(p => p.slug === "how-to-get-more-hvac-customers").previews_started, 1);
assert.equal(out.totals.previews_started, 2);
console.log("content-performance: ok");
