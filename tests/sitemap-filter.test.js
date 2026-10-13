// Run with: node tests/sitemap-filter.test.js (also wired into `npm test`)
import assert from "node:assert/strict";
import { isSitemapListable } from "../api/_lib/sitemap-filter.js";

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (err) { console.error(`FAIL: ${name}`); throw err; }
}

test("test, QA and junk pages are left out", () => {
  for (const p of [
    { username: "test", business_name: "test" },
    { username: "test-1", business_name: "test" },
    { username: "qc-test-plumbing", business_name: "QC Test Plumbing" },
    { username: "cars", business_name: "cars" },
  ]) assert.equal(isSitemapListable(p), false, p.username);
});

test("Enoma's internal pages are left out", () => {
  assert.equal(isSitemapListable({ username: "enoma-io", business_name: "enoma", businesses: { is_internal: true } }), false);
  assert.equal(isSitemapListable({ username: "assayquant-technologies-inc", business_name: "AssayQuant Technologies, Inc.", businesses: { is_internal: true } }), false);
});

test("real customer pages stay, including names that merely contain test-like letters", () => {
  for (const p of [
    { username: "conways-landscaping", business_name: "Conway's Landscaping", businesses: { is_internal: false } },
    { username: "the-blooming-daisy-co", business_name: "The Blooming Daisy Co.", businesses: null },
    { username: "contest-roofing", business_name: "Contest Roofing" },
    { username: "attestation-electric", business_name: "Attestation Electric" },
  ]) assert.equal(isSitemapListable(p), true, p.username);
});

console.log(`sitemap-filter: ${passed} tests passed`);
