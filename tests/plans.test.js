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

test("the chosen interval picks monthly or yearly", () => {
  assert.equal(pageLookupKeyFor(null, "month"), "enoma_page_monthly");
  assert.equal(pageLookupKeyFor(null, "year"), "enoma_page_annual");
  assert.equal(pageLookupKeyFor({ active: true }, "year"), "enoma_page_annual");
  assert.equal(pageLookupKeyFor({ active: false, partner_pricing: true }, "year"), "enoma_page_annual");
  // Anything that isn't "year" is monthly.
  assert.equal(pageLookupKeyFor(null), "enoma_page_monthly");
  assert.equal(pageLookupKeyFor(null, "YEAR"), "enoma_page_monthly");
  assert.equal(pageLookupKeyFor(null, undefined), "enoma_page_monthly");
});

test("partner pricing stays monthly-only, even when yearly is picked", () => {
  assert.equal(pageLookupKeyFor({ active: true, partner_pricing: true }, "year"), "enoma_page_partner_monthly");
  assert.equal(pageLookupKeyFor({ active: true, partner_pricing: true }, "month"), "enoma_page_partner_monthly");
});

test("the yearly plan is public, yearly, and on the pricing page", () => {
  const annual = planById("page_annual");
  assert.equal(annual.lookupKey, "enoma_page_annual");
  assert.equal(annual.interval, "year");
  assert.equal(annual.public, true);
  assert.ok(page.includes('data-price-key="enoma_page_annual">$199</span>/year'));
  assert.ok(page.includes("A real person as your account manager: text or email Jack any change and it's on your page within two business days."));
  assert.ok(page.includes("Is there a yearly plan?"));
});

test("yearly saves $40.88 against 12 months, about $16.58 a month", () => {
  const monthly = planById("page").fallbackAmount, yearly = planById("page_annual").fallbackAmount;
  assert.equal(monthly * 12 - yearly, 4088);
  assert.equal((yearly / 12 / 100).toFixed(2), "16.58");
});

test("the pricing page says service pages are an add-on, not included", () => {
  assert.match(page, /Service pages are not included in either plan/);
  assert.match(page, /Add-on · not included/);
});

test("current amounts match Stripe (monthly and spotlight 2026-11-03, yearly 2026-11-09)", () => {
  assert.equal(planById("page").fallbackAmount, 1999);
  assert.equal(planById("page_annual").fallbackAmount, 19900);
  assert.equal(planById("page_partner").fallbackAmount, 999);
  assert.equal(planById("spotlight").fallbackAmount, 999);
});

test("the yearly service-page add-on is $99/year and on the pricing page (Jack, 2026-11-11)", () => {
  const p = planById("spotlight_annual");
  assert.equal(p.lookupKey, "enoma_spotlight_yearly");
  assert.equal(p.fallbackAmount, 9900);
  assert.equal(p.interval, "year");
  assert.equal(p.public, true);
  assert.ok(page.includes('data-price-key="enoma_spotlight_yearly">$99<'));
});

test("formatAmount", () => {
  assert.equal(formatAmount(1999), "$19.99");
  assert.equal(formatAmount(999), "$9.99");
  assert.equal(formatAmount(19900), "$199");
  assert.equal(formatAmount(-1), null);
  assert.equal(formatAmount(9.5), null);
});

console.log(`plans: ${passed} passed`);
