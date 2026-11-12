// Run with: node tests/billing.test.js (also wired into `npm test`)
// The checkout rules (api/_lib/billing.js): which price, the interval billed,
// when the first charge happens (trial_end), what counts as subscribed, and
// how Stripe subscriptions map onto our rows. Also first-touch attribution
// (api/_lib/attribution.js) and the plan picker's copy of the trial_end rule.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {
  normalizeInterval, trialEndFor, checkoutPlanFor, hasLiveStripeSubscription,
  subscriptionFieldsFromStripe, intervalOfStripeSubscription, MIN_TRIAL_END_LEAD_MS,
} from "../api/_lib/billing.js";
import { chooseFirstTouch, firstTouchToWrite, utmMetadata } from "../api/_lib/attribution.js";

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (err) { console.error(`FAIL: ${name}`); throw err; }
}

const HOUR = 3600 * 1000, DAY = 24 * HOUR;
const NOW = Date.parse("2026-11-09T15:00:00Z");
const freeMonth = (msFromNow) => ({ status: "trialing", is_trial: true, trial_expires_at: new Date(NOW + msFromNow).toISOString() });

// ── interval ──
test("interval: month/year accepted, missing means month, anything else rejected", () => {
  assert.equal(normalizeInterval("month"), "month");
  assert.equal(normalizeInterval("year"), "year");
  assert.equal(normalizeInterval(undefined), "month");
  assert.equal(normalizeInterval(null), "month");
  assert.equal(normalizeInterval(""), "month");
  for (const bad of ["annual", "yearly", "Year", "week", 12, {}, ["year"]]) assert.equal(normalizeInterval(bad), null, String(bad));
});

// ── trial_end ──
test("trial_end is the end of the free month when it's more than 48h out", () => {
  const sub = freeMonth(20 * DAY);
  assert.equal(trialEndFor(sub, NOW), Math.floor((NOW + 20 * DAY) / 1000));
  assert.ok(Number.isInteger(trialEndFor(sub, NOW)));
});

test("trial_end is floored to whole seconds", () => {
  const sub = { is_trial: true, trial_expires_at: "2026-12-01T10:00:00.999Z" };
  assert.equal(trialEndFor(sub, NOW), Math.floor(Date.parse("2026-12-01T10:00:00.999Z") / 1000));
});

test("no trial_end at or under 48 hours (Stripe rejects it)", () => {
  assert.equal(trialEndFor(freeMonth(MIN_TRIAL_END_LEAD_MS), NOW), null);
  assert.equal(trialEndFor(freeMonth(47 * HOUR), NOW), null);
  assert.equal(trialEndFor(freeMonth(1000), NOW), null);
  assert.notEqual(trialEndFor(freeMonth(MIN_TRIAL_END_LEAD_MS + 1000), NOW), null);
});

test("no trial_end in the past", () => {
  assert.equal(trialEndFor(freeMonth(-1000), NOW), null);
  assert.equal(trialEndFor(freeMonth(-30 * DAY), NOW), null);
});

test("pages whose free month already ended are charged at checkout (the Jul 10 and Aug 15 pages)", () => {
  // Two real pages as of 2026-11-09: free month ended Jul 10 and Aug 15, both
  // rows still say status "trialing" because expiry isn't enforced.
  const endedJul10 = { status: "trialing", is_trial: true, trial_expires_at: "2026-07-10T00:00:00Z" };
  const endedAug15 = { status: "trialing", is_trial: true, trial_expires_at: "2026-08-15T00:00:00Z" };
  assert.equal(trialEndFor(endedJul10, NOW), null);
  assert.equal(trialEndFor(endedAug15, NOW), null);
  assert.equal(checkoutPlanFor({ interval: "year", sub: endedJul10, now: NOW }).trialEnd, null);
  assert.equal(checkoutPlanFor({ interval: "month", sub: endedAug15, now: NOW }).trialEnd, null);
});

test("no trial_end when the row isn't in our free month", () => {
  assert.equal(trialEndFor(null, NOW), null);
  assert.equal(trialEndFor({}, NOW), null);
  assert.equal(trialEndFor({ ...freeMonth(20 * DAY), is_trial: false }, NOW), null);
  assert.equal(trialEndFor({ ...freeMonth(20 * DAY), is_trial: "true" }, NOW), null);
  assert.equal(trialEndFor({ is_trial: true, trial_expires_at: null }, NOW), null);
  assert.equal(trialEndFor({ is_trial: true, trial_expires_at: "not a date" }, NOW), null);
});

// ── what create-checkout charges ──
test("checkout: monthly and yearly pick their lookup keys, both respecting the free month", () => {
  const sub = freeMonth(10 * DAY);
  const m = checkoutPlanFor({ interval: "month", sub, now: NOW });
  const y = checkoutPlanFor({ interval: "year", sub, now: NOW });
  assert.deepEqual(m, { lookupKey: "enoma_page_monthly", interval: "month", trialEnd: Math.floor((NOW + 10 * DAY) / 1000), firstMonthFee: false, pricingVersion: null });
  assert.deepEqual(y, { lookupKey: "enoma_page_annual", interval: "year", trialEnd: Math.floor((NOW + 10 * DAY) / 1000), firstMonthFee: false, pricingVersion: null });
});

test("checkout: no subscription row -> charged now, default monthly", () => {
  assert.deepEqual(checkoutPlanFor({ now: NOW }), { lookupKey: "enoma_page_monthly", interval: "month", trialEnd: null, firstMonthFee: false, pricingVersion: null });
});

test("checkout: partner price is monthly even when yearly is picked", () => {
  const partner = { active: true, partner_pricing: true };
  assert.deepEqual(checkoutPlanFor({ referrer: partner, interval: "year", now: NOW }),
    { lookupKey: "enoma_page_partner_monthly", interval: "month", trialEnd: null, firstMonthFee: false, pricingVersion: null });
});

// ── subscribed / page live ──
test("a Stripe-trialing subscription with a subscription id counts as subscribed", () => {
  assert.equal(hasLiveStripeSubscription({ status: "active" }), true);
  assert.equal(hasLiveStripeSubscription({ status: "trialing", stripe_subscription_id: "sub_123" }), true);
  // Our own free month (no Stripe subscription) is not a subscription.
  assert.equal(hasLiveStripeSubscription({ status: "trialing", is_trial: true }), false);
  assert.equal(hasLiveStripeSubscription({ status: "trialing", stripe_subscription_id: null }), false);
  assert.equal(hasLiveStripeSubscription({ status: "canceled", stripe_subscription_id: "sub_123" }), false);
  assert.equal(hasLiveStripeSubscription(null), false);
});

test("website_is_active migration keeps Stripe-trialing subscriptions live", () => {
  const sql = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "../supabase/migrations/20261110_billing_interval.sql"), "utf8");
  assert.match(sql, /s\.status = 'trialing' AND s\.stripe_subscription_id IS NOT NULL/);
  assert.match(sql, /add column if not exists billing_interval text/);
  assert.match(sql, /billing_interval in \('month', 'year'\)/);
  // The existing rules are all still there.
  for (const rule of ["s.status = 'active'", "s.status = 'past_due'", "s.status = 'canceled' AND s.current_period_end", "s.is_trial = true AND s.trial_expires_at"]) {
    assert.ok(sql.includes(rule), rule);
  }
});

// ── Stripe -> subscriptions row ──
const yearlyTrialing = {
  id: "sub_y", status: "trialing", cancel_at_period_end: false,
  current_period_start: 1762700000, current_period_end: 1764600000,
  items: { data: [{ price: { recurring: { interval: "year" } } }] },
  metadata: { interval: "year" },
};

test("webhook fields for a yearly subscription in its Stripe trial", () => {
  assert.deepEqual(subscriptionFieldsFromStripe(yearlyTrialing), {
    stripe_subscription_id: "sub_y",
    status: "trialing",
    billing_interval: "year",
    current_period_start: new Date(1762700000 * 1000).toISOString(),
    current_period_end: new Date(1764600000 * 1000).toISOString(),
    cancel_at_period_end: false,
  });
});

test("webhook fields read period dates from the item on newer Stripe API versions", () => {
  const sub = { id: "sub_m", status: "active", items: { data: [{ current_period_start: 1762700000, current_period_end: 1765300000, price: { recurring: { interval: "month" } } }] } };
  const f = subscriptionFieldsFromStripe(sub);
  assert.equal(f.billing_interval, "month");
  assert.equal(f.current_period_end, new Date(1765300000 * 1000).toISOString());
  assert.equal(f.cancel_at_period_end, false);
});

test("interval falls back to metadata, and is null when unknown", () => {
  assert.equal(intervalOfStripeSubscription({ metadata: { interval: "year" } }), "year");
  assert.equal(intervalOfStripeSubscription({ items: { data: [{ price: { recurring: { interval: "week" } } }] } }), null);
  assert.equal(intervalOfStripeSubscription(null), null);
});

// ── the plan picker uses the same trial_end rule ──
test("public/scripts/plan-picker.js shows a first-charge date exactly when checkout sets trial_end", () => {
  const src = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "../public/scripts/plan-picker.js"), "utf8");
  const ctx = { window: {} };
  vm.runInNewContext(src, ctx);
  const picker = ctx.window.EnomaPlanPicker;
  assert.equal(picker.MIN_TRIAL_END_LEAD_MS, MIN_TRIAL_END_LEAD_MS);
  const cases = [
    null, {}, freeMonth(20 * DAY), freeMonth(48 * HOUR), freeMonth(48 * HOUR + 1000), freeMonth(-DAY),
    { ...freeMonth(20 * DAY), is_trial: false },
    { status: "trialing", is_trial: true, trial_expires_at: "2026-07-10T00:00:00Z" },
  ];
  for (const sub of cases) {
    const server = trialEndFor(sub, NOW);
    const client = picker.firstChargeDate(sub, NOW);
    assert.equal(client ? client.getTime() / 1000 : null, server, JSON.stringify(sub));
  }
});

test("plan picker: yearly is the default and the copy matches the decisions", () => {
  const src = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "../public/scripts/plan-picker.js"), "utf8");
  assert.match(src, /value="year" checked/);
  assert.ok(src.includes("$199/year — about $16.58 a month, saves $40.88"));
  assert.ok(src.includes('"$19.99/month"'));
  assert.ok(src.includes("A real person as your account manager: text or email Jack any change and it’s on your page within two business days."));
  assert.ok(src.includes('"Your first charge is on "'));
  assert.match(src, /interval: chosen\(\)/);
});

// ── first-touch attribution ──
test("first touch: never overwrite an existing value", () => {
  const existing = { utm_source: "facebook", utm_campaign: "fall" };
  assert.equal(firstTouchToWrite(existing, { utm_source: "google" }), null);
  assert.equal(firstTouchToWrite(existing, null), null);
  assert.deepEqual(firstTouchToWrite(null, { utm_source: "google" }), { utm_source: "google" });
  assert.deepEqual(firstTouchToWrite({}, { utm_source: "google" }), { utm_source: "google" });
  assert.equal(firstTouchToWrite(null, null), null);
  assert.equal(firstTouchToWrite(null, {}), null);
});

test("first touch: the browser's utm values win", () => {
  const browser = { t: 1, landing: "/for/website-for-electrician", referrer: "https://google.com", utm_source: "google", utm_campaign: "electricians" };
  const prospect = { source: "inbound_lookup", raw: { attribution: { utm_source: "newsletter" } } };
  // referrer is kept too (businesses.first_touch: utm_*, referrer, landing page)
  assert.deepEqual(chooseFirstTouch({ browser, prospect }), { landing: "/for/website-for-electrician", referrer: "https://google.com", utm_source: "google", utm_campaign: "electricians" });
});

test("first touch: else the prospect's raw.attribution", () => {
  const prospect = { source: "inbound_lookup", raw: { attribution: { from: "guide-x", utm_source: "newsletter", junk: "x" } } };
  assert.deepEqual(chooseFirstTouch({ browser: null, prospect }), { from: "guide-x", utm_source: "newsletter" });
  // A browser touch without utm doesn't hide the prospect's.
  assert.deepEqual(chooseFirstTouch({ browser: { landing: "/robbins-plumbing" }, prospect }), { from: "guide-x", utm_source: "newsletter" });
});

test("first touch: else cold_email for outreach prospects", () => {
  const outreach = { source: "outscraper_google_maps", raw: {} };
  assert.deepEqual(chooseFirstTouch({ prospect: outreach }), { utm_source: "cold_email" });
  assert.deepEqual(chooseFirstTouch({ browser: { landing: "/sample-landscaping" }, prospect: outreach }), { utm_source: "cold_email", landing: "/sample-landscaping" });
  // An inbound preview without attribution isn't cold email.
  assert.equal(chooseFirstTouch({ prospect: { source: "inbound_lookup", raw: {} } }), null);
});

test("first touch: nothing known -> landing only, or null", () => {
  assert.deepEqual(chooseFirstTouch({ browser: { landing: "/pricing" } }), { landing: "/pricing" });
  assert.equal(chooseFirstTouch({}), null);
  assert.equal(chooseFirstTouch(), null);
});

test("utm_* keys only, for Stripe metadata", () => {
  assert.deepEqual(utmMetadata({ landing: "/x", from: "g", utm_source: " google ", utm_medium: "cpc", utm_term: "" }), { utm_source: "google", utm_medium: "cpc" });
  assert.deepEqual(utmMetadata(null), {});
  assert.deepEqual(utmMetadata({ utm_source: "cold_email" }), { utm_source: "cold_email" });
});

console.log(`billing: ${passed} passed`);
