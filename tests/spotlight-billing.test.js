// Run with: node tests/spotlight-billing.test.js (also wired into `npm test`)
// Service pages are a $9.99/month add-on per PUBLISHED page, or the yearly
// add-on price on a yearly plan (api/_lib/spotlight-billing.js): the quantity
// counts published pages only,
// comped businesses are never billed, checkout adds the second line item with
// the right quantity, and publish/unpublish change the Stripe quantity with
// proration — with publishing undone if Stripe refuses.
import assert from "node:assert/strict";
import {
  publishedCount, spotlightBilling, quantityChange, checkoutSpotlightLine, checkoutSubscriptionParams,
  chargeStartsOn, billingSummary, syncSpotlightQuantity, SPOTLIGHT_LOOKUP_KEY, SPOTLIGHT_YEARLY_LOOKUP_KEY, PRORATION,
} from "../api/_lib/spotlight-billing.js";
import { subscriptionFieldsFromStripe, intervalOfStripeSubscription, pageItemOf } from "../api/_lib/billing.js";
import { handleSpotlight } from "../api/_lib/spotlight.js";

let passed = 0;
const tests = [];
function test(name, fn) { tests.push([name, fn]); }

const DAY = 24 * 3600 * 1000;
const NOW = Date.parse("2026-11-09T15:00:00Z");
const ENV = { PRICING_TRIAL_STARTS_AT: "2026-10-14T04:00:00Z" };
const BIZ = "biz-1";
const NEW_BIZ = { is_internal: false, created_at: "2026-11-01T00:00:00Z" }; // after the trial pricing
const OLD_BIZ = { is_internal: false, created_at: "2026-09-01T00:00:00Z" }; // grandfathered

const spot = (slug, status) => ({ id: `id-${slug}`, business_id: BIZ, service_slug: slug, status, content: { hero: {} } });
const pageItem = (interval = "month", amount = 1999) => ({ id: "si_page", quantity: 1, price: { id: "price_page", lookup_key: interval === "year" ? "enoma_page_annual" : "enoma_page_monthly", unit_amount: amount, recurring: { interval } } });
const SPOT_PRICES = {
  [SPOTLIGHT_LOOKUP_KEY]: { id: "price_spot", lookup_key: SPOTLIGHT_LOOKUP_KEY, unit_amount: 999, recurring: { interval: "month" } },
  [SPOTLIGHT_YEARLY_LOOKUP_KEY]: { id: "price_spot_year", lookup_key: SPOTLIGHT_YEARLY_LOOKUP_KEY, unit_amount: 9900, recurring: { interval: "year" } },
};
const spotItem = (quantity, interval = "month") => ({
  id: interval === "year" ? "si_spot_year" : "si_spot", quantity,
  price: SPOT_PRICES[interval === "year" ? SPOTLIGHT_YEARLY_LOOKUP_KEY : SPOTLIGHT_LOOKUP_KEY],
});
const stripeSubWith = (...items) => ({ id: "sub_1", status: "active", items: { data: items } });
const activeRow = (extra = {}) => ({ business_id: BIZ, provider: "stripe", status: "active", stripe_subscription_id: "sub_1", billing_interval: "month", ...extra });

// ── Fakes ──
// A tiny in-memory stand-in for the supabase-js query builder.
function fakeSupabase(tables, user = { id: "owner-1" }) {
  class Q {
    constructor(name) { this.name = name; this.filters = []; this.op = "select"; }
    select() { return this; }
    order() { return this; }
    eq(k, v) { this.filters.push((r) => r[k] === v); return this; }
    neq(k, v) { this.filters.push((r) => r[k] !== v); return this; }
    in(k, vs) { this.filters.push((r) => vs.includes(r[k])); return this; }
    update(patch) { this.op = "update"; this.patch = patch; return this; }
    rows() { return (tables[this.name] || []).filter((r) => this.filters.every((f) => f(r))); }
    maybeSingle() { const r = this.rows()[0]; return Promise.resolve({ data: r ? structuredClone(r) : null, error: null }); }
    single() { return this.maybeSingle(); }
    then(ok, fail) {
      if (this.op === "update") { for (const r of this.rows()) Object.assign(r, this.patch); return Promise.resolve({ data: null, error: null }).then(ok, fail); }
      return Promise.resolve({ data: this.rows().map((r) => structuredClone(r)), error: null }).then(ok, fail);
    }
  }
  return { auth: { getUser: async () => ({ data: { user }, error: null }) }, from: (name) => new Q(name) };
}

// `prices`: the add-on prices that exist in Stripe (default: both).
function fakeStripe(sub, { failWrites = false, prices = SPOT_PRICES } = {}) {
  const calls = [];
  const items = () => sub.items.data;
  return {
    calls,
    subscriptions: { retrieve: async (id) => { calls.push(["retrieve", id]); return sub; } },
    prices: { list: async ({ lookup_keys = [] } = {}) => ({ data: lookup_keys.map((k) => prices[k]).filter(Boolean) }) },
    subscriptionItems: {
      create: async (p) => {
        calls.push(["create", p]); if (failWrites) throw new Error("card_declined");
        const price = Object.values(SPOT_PRICES).find((x) => x.id === p.price);
        items().push({ id: `si_new_${price.recurring.interval}`, quantity: p.quantity, price });
      },
      update: async (id, p) => { calls.push(["update", id, p]); if (failWrites) throw new Error("stripe down"); items().find((i) => i.id === id).quantity = p.quantity; },
      del: async (id, p) => { calls.push(["del", id, p]); if (failWrites) throw new Error("stripe down"); sub.items.data = items().filter((i) => i.id !== id); },
    },
  };
}

function fakeRes() {
  return { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
}
const req = (action, body) => ({ query: { kind: "spotlight", action }, headers: { authorization: "Bearer t" }, body: { business_id: BIZ, ...body } });

function tablesFor({ spotlights, sub = activeRow(), business = NEW_BIZ }) {
  return {
    service_spotlights: spotlights,
    subscriptions: sub ? [sub] : [],
    businesses: [{ id: BIZ, ...business }],
    business_members: [{ user_id: "owner-1", business_id: BIZ, role: "owner" }],
    small_business_profiles: [{ business_id: BIZ, username: "acme", business_name: "Acme" }],
  };
}

// ── Quantity: published pages only ──
test("quantity counts published service pages only (drafts and archived are free)", () => {
  assert.equal(publishedCount([]), 0);
  assert.equal(publishedCount(null), 0);
  assert.equal(publishedCount([spot("a", "draft"), spot("b", "archived")]), 0);
  assert.equal(publishedCount([spot("a", "published"), spot("b", "draft"), spot("c", "published"), spot("d", "archived")]), 2);
});

test("quantity change: create, update, delete at zero, nothing when equal", () => {
  assert.deepEqual(quantityChange(stripeSubWith(pageItem()), 0), { op: "none", quantity: 0, current: 0, itemId: null });
  assert.deepEqual(quantityChange(stripeSubWith(pageItem()), 2), { op: "create", quantity: 2, current: 0, itemId: null });
  assert.deepEqual(quantityChange(stripeSubWith(pageItem(), spotItem(2)), 3), { op: "update", quantity: 3, current: 2, itemId: "si_spot" });
  assert.deepEqual(quantityChange(stripeSubWith(pageItem(), spotItem(2)), 1), { op: "update", quantity: 1, current: 2, itemId: "si_spot" });
  assert.deepEqual(quantityChange(stripeSubWith(pageItem(), spotItem(2)), 0), { op: "delete", quantity: 0, current: 2, itemId: "si_spot" });
  assert.equal(quantityChange(stripeSubWith(pageItem(), spotItem(2)), 2).op, "none");
});

test("quantity change: an add-on on the other interval's price is replaced (or just removed at zero)", () => {
  const monthlyOnYearly = stripeSubWith(pageItem("year", 19900), spotItem(2));
  assert.deepEqual(quantityChange(monthlyOnYearly, 2, SPOTLIGHT_YEARLY_LOOKUP_KEY), { op: "replace", quantity: 2, current: 2, itemId: "si_spot" });
  assert.equal(quantityChange(monthlyOnYearly, 0, SPOTLIGHT_YEARLY_LOOKUP_KEY).op, "delete");
  assert.equal(quantityChange(stripeSubWith(pageItem("year", 19900), spotItem(2, "year")), 2, SPOTLIGHT_YEARLY_LOOKUP_KEY).op, "none");
});

// ── Who pays ──
test("comped and internal businesses are never billed", () => {
  assert.deepEqual(spotlightBilling({ sub: { provider: "comped", status: "active" }, business: NEW_BIZ, now: NOW, env: ENV }), { billing: "never", reason: "comped" });
  // Even if a comped row still carries an old Stripe subscription id.
  assert.equal(spotlightBilling({ sub: activeRow({ provider: "comped" }), business: NEW_BIZ, now: NOW, env: ENV }).billing, "never");
  assert.equal(spotlightBilling({ sub: activeRow(), business: { ...NEW_BIZ, is_internal: true }, now: NOW, env: ENV }).billing, "never");
});

test("a Stripe subscription (active, subscribed in the free month, past due) is billed now", () => {
  assert.deepEqual(spotlightBilling({ sub: activeRow(), business: NEW_BIZ, now: NOW, env: ENV }), { billing: "subscription", reason: "subscribed", interval: "month" });
  assert.deepEqual(spotlightBilling({ sub: activeRow({ status: "trialing" }), business: NEW_BIZ, now: NOW, env: ENV }), { billing: "subscription", reason: "subscribed_in_free_month", interval: "month" });
  assert.equal(spotlightBilling({ sub: activeRow({ status: "past_due" }), business: NEW_BIZ, now: NOW, env: ENV }).billing, "subscription");
});

test("free month, grandfathered and never-subscribed pages publish now and are billed at checkout", () => {
  const freeMonth = { provider: "stripe", status: "trialing", is_trial: true, trial_expires_at: new Date(NOW + 10 * DAY).toISOString() };
  assert.deepEqual(spotlightBilling({ sub: freeMonth, business: NEW_BIZ, now: NOW, env: ENV }), { billing: "at_checkout", reason: "free_month" });
  assert.deepEqual(spotlightBilling({ sub: null, business: OLD_BIZ, now: NOW, env: ENV }), { billing: "at_checkout", reason: "grandfathered" });
  assert.deepEqual(spotlightBilling({ sub: null, business: NEW_BIZ, now: NOW, env: ENV }), { billing: "at_checkout", reason: "not_subscribed" });
  // A canceled subscription is not billed now either.
  assert.equal(spotlightBilling({ sub: activeRow({ status: "canceled" }), business: NEW_BIZ, now: NOW, env: ENV }).billing, "at_checkout");
});

test("a yearly Stripe plan is billed now, on the yearly add-on", () => {
  assert.deepEqual(spotlightBilling({ sub: activeRow({ billing_interval: "year" }), business: NEW_BIZ, now: NOW, env: ENV }), { billing: "subscription", reason: "subscribed", interval: "year" });
});

// ── Checkout ──
test("checkout adds the service pages as a second line item, quantity = published", () => {
  const p = checkoutSubscriptionParams({
    pagePriceId: "price_page", published: 3, billing: { billing: "at_checkout" },
    spotlightPriceId: "price_spot", trialEnd: 1765000000, metadata: { business_id: BIZ },
  });
  assert.deepEqual(p.line_items, [{ price: "price_page", quantity: 1 }, { price: "price_spot", quantity: 3 }]);
  // One subscription, so the free month's trial_end covers both line items.
  assert.equal(p.subscription_data.trial_end, 1765000000);
  assert.equal(p.subscription_data.metadata.spotlight_quantity, "3");
  assert.equal(p.subscription_data.metadata.business_id, BIZ);
  assert.equal(p.spotlightQuantity, 3);
});

test("checkout: no second line item with no published pages, or for comped businesses", () => {
  const none = checkoutSubscriptionParams({ pagePriceId: "price_page", published: 0, billing: { billing: "at_checkout" }, spotlightPriceId: "price_spot" });
  assert.deepEqual(none.line_items, [{ price: "price_page", quantity: 1 }]);
  assert.equal(none.subscription_data.trial_end, undefined);
  const comped = checkoutSubscriptionParams({ pagePriceId: "price_page", published: 4, billing: { billing: "never" }, spotlightPriceId: "price_spot" });
  assert.deepEqual(comped.line_items, [{ price: "price_page", quantity: 1 }]);
  assert.equal(comped.subscription_data.metadata.spotlight_quantity, "0");
});

test("yearly checkout: the second line item is the yearly add-on, same trial_end", () => {
  const p = checkoutSubscriptionParams({
    pagePriceId: "price_page_annual", published: 2, billing: { billing: "at_checkout" },
    spotlightPriceId: "price_spot_year", trialEnd: 1765000000,
  });
  assert.deepEqual(p.line_items, [{ price: "price_page_annual", quantity: 1 }, { price: "price_spot_year", quantity: 2 }]);
  assert.equal(p.subscription_data.trial_end, 1765000000);
});

test("checkout refuses rather than dropping published pages when the add-on price is missing", () => {
  assert.equal(checkoutSpotlightLine({ published: 2, billing: { billing: "at_checkout" }, spotlightPriceId: null }).error, "price_missing");
  // Nothing published: no add-on price needed.
  assert.deepEqual(checkoutSpotlightLine({ published: 0, billing: { billing: "at_checkout" }, spotlightPriceId: null }), { line: null });
});

// ── The page plan is never confused with the add-on item ──
test("subscription fields come from the page item even when the add-on is listed first", () => {
  const sub = { id: "sub_1", status: "active", items: { data: [
    { ...spotItem(2), current_period_start: 1, current_period_end: 2 },
    { ...pageItem("year", 19900), current_period_start: 1762700000, current_period_end: 1794236000 },
  ] } };
  assert.equal(pageItemOf(sub).id, "si_page");
  assert.equal(intervalOfStripeSubscription(sub), "year");
  const f = subscriptionFieldsFromStripe(sub);
  assert.equal(f.billing_interval, "year");
  assert.equal(f.current_period_end, new Date(1794236000 * 1000).toISOString());
});

// ── Dashboard numbers ──
test("monthly total = page plan + published service pages; comped pays nothing for them", () => {
  const s = billingSummary({ published: 2, billing: { billing: "subscription", reason: "subscribed" }, pageAmount: 1999, pageInterval: "month", spotlightAmount: 999, billedQuantity: 2, now: NOW });
  assert.equal(s.spotlight_total, 1998);
  assert.equal(s.monthly_total, 3997);
  assert.equal(s.total, 3997);
  assert.equal(s.total_interval, "month");
  assert.equal(s.starts_on, new Date(NOW).toISOString());
  const c = billingSummary({ published: 2, billing: { billing: "never", reason: "comped" }, pageAmount: 0, spotlightAmount: 999, now: NOW });
  assert.equal(c.spotlight_total, 0);
  assert.equal(c.monthly_total, 0);
  assert.equal(c.starts_on, null);
});

test("yearly total = $199 page plan + published service pages at the yearly add-on price", () => {
  const y = billingSummary({ published: 2, billing: { billing: "subscription", reason: "subscribed", interval: "year" }, pageAmount: 19900, pageInterval: "year", spotlightAmount: 9900, now: NOW });
  assert.equal(y.spotlight_interval, "year");
  assert.equal(y.spotlight_total, 19800);
  assert.equal(y.total, 39700);
  assert.equal(y.total_interval, "year");
  assert.equal(y.monthly_total, null);
  // No live amount: the display falls back to the yearly placeholder, never $9.99.
  const f = billingSummary({ published: 1, billing: { billing: "subscription", reason: "subscribed", interval: "year" }, pageAmount: 19900, pageInterval: "year", now: NOW });
  assert.equal(f.spotlight_amount, 9900);
});

test("charge start date: today, the first charge, the end of the free month, or 'when you subscribe'", () => {
  assert.equal(chargeStartsOn({ billing: { billing: "subscription", reason: "subscribed" }, now: NOW }), new Date(NOW).toISOString());
  assert.equal(chargeStartsOn({ billing: { billing: "subscription", reason: "subscribed_in_free_month" }, sub: { current_period_end: "2026-12-01T00:00:00.000Z" }, now: NOW }), "2026-12-01T00:00:00.000Z");
  assert.equal(chargeStartsOn({ billing: { billing: "at_checkout", reason: "free_month" }, sub: { trial_expires_at: "2026-11-20T00:00:00.000Z" }, now: NOW }), "2026-11-20T00:00:00.000Z");
  assert.equal(chargeStartsOn({ billing: { billing: "at_checkout", reason: "grandfathered" }, now: NOW }), null);
});

// ── Sync against Stripe (fakes) ──
test("sync: published pages become the add-on quantity, with proration", async () => {
  const sb = fakeSupabase(tablesFor({ spotlights: [spot("a", "published"), spot("b", "draft"), spot("c", "published")] }));
  const sub = stripeSubWith(pageItem());
  const stripe = fakeStripe(sub);
  const r = await syncSpotlightQuantity({ stripe, supabase: sb, businessId: BIZ, now: NOW, env: ENV });
  assert.equal(r.op, "create");
  assert.equal(r.quantity, 2);
  const create = stripe.calls.find((c) => c[0] === "create")[1];
  assert.deepEqual(create, { subscription: "sub_1", price: "price_spot", quantity: 2, ...PRORATION });
  assert.equal(create.proration_behavior, "create_prorations");
});

test("sync: unpublishing lowers the quantity, and the last one removes the item", async () => {
  const tables = tablesFor({ spotlights: [spot("a", "published"), spot("b", "draft")] });
  const sub = stripeSubWith(pageItem(), spotItem(2));
  const stripe = fakeStripe(sub);
  let r = await syncSpotlightQuantity({ stripe, supabase: fakeSupabase(tables), businessId: BIZ, now: NOW, env: ENV });
  assert.equal(r.op, "update");
  assert.deepEqual(stripe.calls.find((c) => c[0] === "update"), ["update", "si_spot", { quantity: 1, ...PRORATION }]);
  tables.service_spotlights[0].status = "draft";
  r = await syncSpotlightQuantity({ stripe, supabase: fakeSupabase(tables), businessId: BIZ, now: NOW, env: ENV });
  assert.equal(r.op, "delete");
  assert.deepEqual(stripe.calls.find((c) => c[0] === "del"), ["del", "si_spot", PRORATION]);
  assert.equal(sub.items.data.length, 1);
});

test("sync: comped, free-month and grandfathered businesses make no Stripe calls", async () => {
  const published = [spot("a", "published"), spot("b", "published")];
  for (const t of [
    tablesFor({ spotlights: published, sub: { business_id: BIZ, provider: "comped", status: "active" } }),
    tablesFor({ spotlights: published, sub: { business_id: BIZ, provider: "stripe", status: "trialing", is_trial: true, trial_expires_at: new Date(NOW + 5 * DAY).toISOString() } }),
    tablesFor({ spotlights: published, sub: null, business: OLD_BIZ }),
  ]) {
    const stripe = fakeStripe(stripeSubWith(pageItem()));
    const r = await syncSpotlightQuantity({ stripe, supabase: fakeSupabase(t), businessId: BIZ, now: NOW, env: ENV });
    assert.equal(r.op, "none");
    assert.equal(r.quantity, 0);
    assert.equal(stripe.calls.length, 0, JSON.stringify(stripe.calls));
  }
});

test("sync: a yearly plan gets the yearly add-on price, with proration", async () => {
  const yearlyRow = activeRow({ billing_interval: "year" });
  const stripe = fakeStripe(stripeSubWith(pageItem("year", 19900)));
  const r = await syncSpotlightQuantity({ stripe, supabase: fakeSupabase(tablesFor({ spotlights: [spot("a", "published"), spot("b", "published")], sub: yearlyRow })), businessId: BIZ, now: NOW, env: ENV });
  assert.equal(r.op, "create");
  assert.equal(r.interval, "year");
  assert.deepEqual(stripe.calls.find((c) => c[0] === "create")[1], { subscription: "sub_1", price: "price_spot_year", quantity: 2, ...PRORATION });
});

test("sync: the Stripe subscription's interval wins over a stale row", async () => {
  // Row still says monthly, but the owner is on the yearly price in Stripe.
  const stripe = fakeStripe(stripeSubWith(pageItem("year", 19900)));
  await syncSpotlightQuantity({ stripe, supabase: fakeSupabase(tablesFor({ spotlights: [spot("a", "published")], sub: activeRow() })), businessId: BIZ, now: NOW, env: ENV });
  assert.equal(stripe.calls.find((c) => c[0] === "create")[1].price, "price_spot_year");
});

test("sync: after switching to yearly, a monthly add-on item is swapped for the yearly one", async () => {
  const sub = stripeSubWith(pageItem("year", 19900), spotItem(1));
  const stripe = fakeStripe(sub);
  const r = await syncSpotlightQuantity({ stripe, supabase: fakeSupabase(tablesFor({ spotlights: [spot("a", "published")], sub: activeRow({ billing_interval: "year" }) })), businessId: BIZ, now: NOW, env: ENV });
  assert.equal(r.op, "replace");
  assert.deepEqual(stripe.calls.filter((c) => c[0] !== "retrieve").map((c) => c[0]), ["del", "create"]);
  assert.deepEqual(sub.items.data.map((i) => i.price.lookup_key), ["enoma_page_annual", SPOTLIGHT_YEARLY_LOOKUP_KEY]);
});

test("sync: a missing yearly add-on price refuses (never bills monthly on a yearly plan)", async () => {
  const stripe = fakeStripe(stripeSubWith(pageItem("year", 19900)), { prices: { [SPOTLIGHT_LOOKUP_KEY]: SPOT_PRICES[SPOTLIGHT_LOOKUP_KEY] } });
  await assert.rejects(
    syncSpotlightQuantity({ stripe, supabase: fakeSupabase(tablesFor({ spotlights: [spot("a", "published")], sub: activeRow({ billing_interval: "year" }) })), businessId: BIZ, now: NOW, env: ENV }),
    (e) => e.code === "price_missing",
  );
  assert.equal(stripe.calls.filter((c) => c[0] === "create").length, 0);
});

// ── The real publish / unpublish handler ──
test("publish: the page goes live and the quantity is computed server-side (browser can't send one)", async () => {
  const tables = tablesFor({ spotlights: [spot("a", "published"), spot("b", "draft")] });
  const sub = stripeSubWith(pageItem(), spotItem(1));
  const stripe = fakeStripe(sub);
  const res = fakeRes();
  await handleSpotlight(req("publish", { service_slug: "b", quantity: 50 }), res, { supabaseAdmin: fakeSupabase(tables), stripe });
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.equal(tables.service_spotlights[1].status, "published");
  assert.equal(res.body.billing.quantity, 2);
  assert.deepEqual(stripe.calls.find((c) => c[0] === "update"), ["update", "si_spot", { quantity: 2, ...PRORATION }]);
});

test("publish: if Stripe refuses, the page goes back to draft and is not billed", async () => {
  const tables = tablesFor({ spotlights: [spot("b", "draft")] });
  const stripe = fakeStripe(stripeSubWith(pageItem()), { failWrites: true });
  const res = fakeRes();
  await handleSpotlight(req("publish", { service_slug: "b" }), res, { supabaseAdmin: fakeSupabase(tables), stripe });
  assert.equal(res.code, 502);
  assert.equal(tables.service_spotlights[0].status, "draft");
  assert.equal(tables.service_spotlights[0].published_at, null);
});

test("publish on a yearly plan: live, billed on the yearly add-on", async () => {
  const tables = tablesFor({ spotlights: [spot("b", "draft")], sub: activeRow({ billing_interval: "year" }) });
  const stripe = fakeStripe(stripeSubWith(pageItem("year", 19900)));
  const res = fakeRes();
  await handleSpotlight(req("publish", { service_slug: "b" }), res, { supabaseAdmin: fakeSupabase(tables), stripe });
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.equal(tables.service_spotlights[0].status, "published");
  assert.equal(stripe.calls.find((c) => c[0] === "create")[1].price, "price_spot_year");
});

test("publish on a yearly plan with no yearly add-on price in Stripe: back to draft", async () => {
  const tables = tablesFor({ spotlights: [spot("b", "draft")], sub: activeRow({ billing_interval: "year" }) });
  const stripe = fakeStripe(stripeSubWith(pageItem("year", 19900)), { prices: {} });
  const res = fakeRes();
  await handleSpotlight(req("publish", { service_slug: "b" }), res, { supabaseAdmin: fakeSupabase(tables), stripe });
  assert.equal(res.code, 502);
  assert.equal(res.body.code, "price_missing");
  assert.equal(tables.service_spotlights[0].status, "draft");
});

test("publish for a comped business: live, no Stripe calls", async () => {
  const tables = tablesFor({ spotlights: [spot("b", "draft")], sub: { business_id: BIZ, provider: "comped", status: "active" } });
  const stripe = fakeStripe(stripeSubWith(pageItem()));
  const res = fakeRes();
  await handleSpotlight(req("publish", { service_slug: "b" }), res, { supabaseAdmin: fakeSupabase(tables), stripe });
  assert.equal(res.code, 200);
  assert.equal(tables.service_spotlights[0].status, "published");
  assert.equal(res.body.billing.billing, "never");
  assert.equal(stripe.calls.length, 0);
});

test("publish in the free month (no Stripe subscription yet): live now, billed at checkout", async () => {
  const tables = tablesFor({ spotlights: [spot("b", "draft")], sub: { business_id: BIZ, provider: "stripe", status: "trialing", is_trial: true, trial_expires_at: new Date(Date.now() + 10 * DAY).toISOString() } });
  const res = fakeRes();
  await handleSpotlight(req("publish", { service_slug: "b" }), res, { supabaseAdmin: fakeSupabase(tables), stripe: null });
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.equal(tables.service_spotlights[0].status, "published");
  assert.equal(res.body.billing.billing, "at_checkout");
});

test("unpublish: always succeeds and lowers the quantity; a Stripe failure doesn't republish", async () => {
  const tables = tablesFor({ spotlights: [spot("a", "published"), spot("b", "published")] });
  const sub = stripeSubWith(pageItem(), spotItem(2));
  const stripe = fakeStripe(sub);
  let res = fakeRes();
  await handleSpotlight(req("unpublish", { service_slug: "a" }), res, { supabaseAdmin: fakeSupabase(tables), stripe });
  assert.equal(res.code, 200);
  assert.equal(tables.service_spotlights[0].status, "draft");
  assert.equal(sub.items.data.find((i) => i.id === "si_spot").quantity, 1);

  const failing = fakeStripe(sub, { failWrites: true });
  const origError = console.error; console.error = () => {};
  res = fakeRes();
  try {
    await handleSpotlight(req("unpublish", { service_slug: "b" }), res, { supabaseAdmin: fakeSupabase(tables), stripe: failing });
  } finally { console.error = origError; }
  assert.equal(res.code, 200);
  assert.equal(tables.service_spotlights[1].status, "draft");
  assert.deepEqual(res.body.billing, { pending: true });
});

for (const [name, fn] of tests) {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { console.error(`FAIL: ${name}`); throw err; }
}
console.log(`spotlight-billing: ${passed} passed`);
