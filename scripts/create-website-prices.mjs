// scripts/create-website-prices.mjs
// Creates the Nov 18, 2026 website prices in Stripe TEST mode, by lookup key
// (data/plans.mjs): website_monthly_39, website_yearly_390, website_founding_29.
//
//   STRIPE_TEST_SECRET_KEY=sk_test_... node scripts/create-website-prices.mjs
//
// Refuses anything but an sk_test_/rk_test_ key: live prices are created by
// Jack in the Stripe dashboard (list in the PR). Idempotent: a lookup key
// that already exists is left alone.

import Stripe from "stripe";
import { planByLookupKey } from "../data/plans.mjs";

export const NEW_KEYS = ["website_monthly_39", "website_yearly_390", "website_founding_29"];
export const isTestKey = k => /^(sk|rk)_test_/.test(String(k || ""));

async function main() {
  const key = process.env.STRIPE_TEST_SECRET_KEY;
  if (!isTestKey(key)) {
    console.error("Refusing: set STRIPE_TEST_SECRET_KEY to a test-mode key (sk_test_…). This script never touches live Stripe.");
    process.exit(2);
  }
  const stripe = new Stripe(key);
  const { data: existing } = await stripe.prices.list({ lookup_keys: NEW_KEYS, limit: 10 });
  const have = new Set(existing.map(p => p.lookup_key));
  // Same product as the current page plan, when it exists in test mode.
  const { data: cur } = await stripe.prices.list({ lookup_keys: ["enoma_page_monthly"], limit: 1, expand: ["data.product"] });
  let product = cur[0]?.product?.id;
  if (!product) product = (await stripe.products.create({ name: "Your website" })).id;
  for (const k of NEW_KEYS) {
    if (have.has(k)) { console.log(`${k}: already exists`); continue; }
    const plan = planByLookupKey(k);
    const price = await stripe.prices.create({
      product, currency: "usd", unit_amount: plan.fallbackAmount, lookup_key: k, nickname: plan.name,
      recurring: { interval: plan.interval },
      metadata: { decided: "2026-11-18", ...(plan.founding ? { founding: "1" } : {}) },
    });
    console.log(`${k}: created ${price.id} (${plan.fallbackAmount / 100} USD / ${plan.interval})`);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  main().catch(e => { console.error(e?.message || e); process.exit(1); });
}
