// Run with: node tests/founding.test.js (also wired into `npm test`)
// New prices (decided Nov 18, 2026): $39/month or $390/year, founding
// $29/month for the first 25 paying customers (api/_lib/founding.js), $1
// first month. Checks: founding price below 25 paid, standard at 25, the
// yearly plan, comped/internal/placeholder rows don't count, checkout picks
// the right price, and no old price string is left in public/, data/, api/.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FOUNDING_LIMIT, foundingSpotsLeft, foundingOpen, countPaid, foundingState } from "../api/_lib/founding.js";
import { checkoutPlanFor } from "../api/_lib/billing.js";
import { createPageCheckoutSession, _resetPriceCache } from "../api/_lib/page-checkout.js";
import { PRICE_LINE } from "../api/_lib/pricing.js";

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { console.error(`  FAIL - ${name}`); console.error(err); process.exitCode = 1; }
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NOW = Date.parse("2026-11-18T15:00:00Z");

const paidRows = n => Array.from({ length: n }, (_, i) => ({ business_id: `b${i}`, provider: "stripe", stripe_subscription_id: `sub_${i}` }));

await test("founding price below 25 paying customers, standard price at 25", () => {
  assert.equal(FOUNDING_LIMIT, 25);
  assert.equal(foundingOpen(0), true);
  assert.equal(foundingOpen(24), true);
  assert.equal(foundingOpen(25), false);
  assert.equal(foundingOpen(40), false);
  assert.equal(foundingSpotsLeft(1), 24);
  assert.equal(foundingSpotsLeft(25), 0);
  assert.equal(foundingSpotsLeft(30), 0);
  assert.equal(checkoutPlanFor({ interval: "month", founding: foundingOpen(24), now: NOW }).lookupKey, "website_founding_29");
  assert.equal(checkoutPlanFor({ interval: "month", founding: foundingOpen(25), now: NOW }).lookupKey, "website_monthly_39");
});

await test("the yearly plan is $390/year whether or not founding spots are left", () => {
  assert.equal(checkoutPlanFor({ interval: "year", founding: true, now: NOW }).lookupKey, "website_yearly_390");
  assert.equal(checkoutPlanFor({ interval: "year", founding: false, now: NOW }).lookupKey, "website_yearly_390");
});

await test("only non-internal businesses that have had a paid Stripe subscription count", () => {
  const rows = [
    ...paidRows(3),
    { business_id: "b0", provider: "stripe", stripe_subscription_id: "sub_again" }, // same business twice
    { business_id: "comp", provider: "comped", stripe_subscription_id: null },
    { business_id: "placeholder", provider: "stripe", stripe_subscription_id: null }, // preview-trial row
    { business_id: "jack", provider: "stripe", stripe_subscription_id: "sub_j" },
  ];
  assert.equal(countPaid(rows, new Set(["jack"])), 3);
});

function fakeSupabase(tables) {
  class Q {
    constructor(n) { this.n = n; this.f = []; this.op = "select"; }
    select() { return this; }
    eq(k, v) { this.f.push(r => r[k] === v); return this; }
    in(k, vs) { this.f.push(r => vs.includes(r[k])); return this; }
    not(k, op, v) { this.f.push(r => !(op === "is" && v === null ? r[k] == null : r[k] === v)); return this; }
    upsert(row) { this.op = "upsert"; this.row = row; return this; }
    rows() { return (tables[this.n] || []).filter(r => this.f.every(f => f(r))); }
    maybeSingle() { const r = this.rows()[0]; return Promise.resolve({ data: r ? { ...r } : null, error: null }); }
    then(ok, fail) { return Promise.resolve({ data: this.op === "select" ? this.rows() : null, error: null }).then(ok, fail); }
  }
  return { from: n => new Q(n) };
}

await test("foundingState reads the live count (24 paid → 1 left; 25 → closed)", async () => {
  const s24 = await foundingState(fakeSupabase({ subscriptions: paidRows(24), businesses: [] }));
  assert.deepEqual(s24, { limit: 25, paid: 24, left: 1, open: true });
  const s25 = await foundingState(fakeSupabase({ subscriptions: paidRows(25), businesses: [] }));
  assert.equal(s25.open, false);
  assert.equal(s25.left, 0);
});

function fakeStripe() {
  const sessions = [];
  const prices = ["website_monthly_39", "website_yearly_390", "website_founding_29", "enoma_page_first_month"]
    .map(k => ({ id: `price_${k}`, lookup_key: k, unit_amount: { website_monthly_39: 3900, website_yearly_390: 39000, website_founding_29: 2900, enoma_page_first_month: 100 }[k], recurring: k.includes("first") ? null : { interval: k.includes("yearly") ? "year" : "month" } }));
  return {
    sessions,
    customers: { create: async () => ({ id: "cus_1" }) },
    prices: { list: async ({ lookup_keys }) => ({ data: prices.filter(p => lookup_keys.includes(p.lookup_key)) }) },
    checkout: { sessions: { create: async s => { sessions.push(s); return { id: "cs_1", url: "https://checkout" }; } } },
  };
}
const checkoutTables = paid => ({
  subscriptions: [...paidRows(paid), { business_id: "new", provider: "stripe", status: "trialing", is_trial: true, pricing_version: "v2_1dollar", stripe_customer_id: "cus_1" }],
  businesses: [{ id: "new", is_internal: false }],
  service_spotlights: [],
  small_business_profiles: [{ business_id: "new", business_name: "New Co" }],
});

await test("checkout: founding price for the 25th paying customer, standard for the 26th; $1 first month stays", async () => {
  for (const [paid, key] of [[24, "website_founding_29"], [25, "website_monthly_39"]]) {
    _resetPriceCache();
    const stripe = fakeStripe();
    const r = await createPageCheckoutSession({ stripe, supabase: fakeSupabase(checkoutTables(paid)), businessId: "new", interval: "month", now: NOW });
    assert.equal(r.status, 200, r.error);
    const items = stripe.sessions[0].line_items;
    assert.equal(items[0].price, `price_${key}`, `${paid} paid → ${key}`);
    assert.ok(items.some(i => i.price === "price_enoma_page_first_month"), "$1 first month line");
    assert.equal(stripe.sessions[0].metadata.founding, key === "website_founding_29" ? "1" : "0");
  }
  _resetPriceCache();
  const stripe = fakeStripe();
  await createPageCheckoutSession({ stripe, supabase: fakeSupabase(checkoutTables(3)), businessId: "new", interval: "year", now: NOW });
  assert.equal(stripe.sessions[0].line_items[0].price, "price_website_yearly_390");
});

await test("the standard price line", () => {
  assert.equal(PRICE_LINE, "$1 for your first month, then $39/month or $390/year. Cancel anytime.");
});

await test("no old price string left in public/, data/ or api/", () => {
  const OLD = /\$19\.99|\$199\b|\$19\b|\$190\b/;
  const hits = [];
  const walk = dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== "node_modules") walk(p); continue; }
      if (!/\.(html|js|mjs|json|txt|xml|css)$/.test(e.name)) continue;
      fs.readFileSync(p, "utf8").split("\n").forEach((line, i) => { if (OLD.test(line)) hits.push(`${path.relative(root, p)}:${i + 1}: ${line.trim().slice(0, 100)}`); });
    }
  };
  for (const d of ["public", "data", "api"]) walk(path.join(root, d));
  assert.deepEqual(hits, []);
});

console.log(`\n${passed} passed`);
