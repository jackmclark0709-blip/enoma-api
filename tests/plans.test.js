// Run with: node tests/plans.test.js (also wired into `npm test`)
// Keeps public/pricing/index.html in step with data/plans.mjs, and checks
// which lead-page price a business gets.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PLANS, planById, pageLookupKeyFor, formatAmount } from "../data/plans.mjs";

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (err) { console.error(`FAIL: ${name}`); throw err; }
}

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const page = fs.readFileSync(path.join(root, "public/pricing/index.html"), "utf8");

test("lookup keys are unique", () => {
  const keys = PLANS.map((p) => p.lookupKey);
  assert.equal(new Set(keys).size, keys.length);
});

test("every price on the pricing page is a public plan with the matching fallback amount", () => {
  const tags = [...page.matchAll(/data-price-key="([^"]+)">([^<]*)</g)];
  assert.ok(tags.length > 0, "pricing page has tagged prices");
  for (const [, key, text] of tags) {
    const plan = PLANS.find((p) => p.lookupKey === key);
    assert.ok(plan, `unknown lookup key on pricing page: ${key}`);
    assert.equal(plan.public, true, `${key} is not a public plan`);
    assert.equal(text, formatAmount(plan.fallbackAmount), `${key} fallback text`);
  }
});

test("every public plan appears on the pricing page", () => {
  for (const p of PLANS.filter((x) => x.public)) {
    assert.ok(page.includes(`data-price-key="${p.lookupKey}"`), `${p.lookupKey} missing from pricing page`);
  }
});

test("the partner price never appears on the public pricing page", () => {
  assert.ok(!page.includes("enoma_page_partner_monthly"));
});

test("partner price only for an active partner with partner_pricing on", () => {
  assert.equal(pageLookupKeyFor(null), "enoma_page_monthly");
  assert.equal(pageLookupKeyFor({ active: true }), "enoma_page_monthly");
  assert.equal(pageLookupKeyFor({ active: false, partner_pricing: true }), "enoma_page_monthly");
  assert.equal(pageLookupKeyFor({ active: true, partner_pricing: "true" }), "enoma_page_monthly");
  assert.equal(pageLookupKeyFor({ active: true, partner_pricing: true }), "enoma_page_partner_monthly");
});

test("current amounts match Stripe as set up on 2026-11-03", () => {
  assert.equal(planById("page").fallbackAmount, 1999);
  assert.equal(planById("page_partner").fallbackAmount, 999);
  assert.equal(planById("spotlight").fallbackAmount, 999);
});

test("formatAmount", () => {
  assert.equal(formatAmount(1999), "$19.99");
  assert.equal(formatAmount(999), "$9.99");
  assert.equal(formatAmount(-1), null);
  assert.equal(formatAmount(9.5), null);
});

console.log(`plans: ${passed} passed`);
