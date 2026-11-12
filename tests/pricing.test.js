// Run with: node tests/pricing.test.js (also wired into `npm test`)
// Pricing v2, "$1 first month" (api/_lib/pricing.js): who is on it, what
// checkout sends Stripe (mocked), what owners see next to the button, the
// reminder 3 days before the first full charge, the confirmation email, and
// that legacy accounts are untouched. Also: the Stripe webhook answers 200
// to event types it doesn't handle.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import {
  PRICING_V2, PRICE_LINE, FIRST_MONTH_LOOKUP_KEY, pricingVersionForNewSignup, writeNewSubscription,
  firstMonthOfferApplies, needsCheckoutToGoLive, pageIndexable, checkoutTermsLine, firstMonthLineItem,
  firstFullChargeUnix, priceLineFor,
} from "../api/_lib/pricing.js";
import { checkoutPlanFor } from "../api/_lib/billing.js";
import { createPageCheckoutSession, _resetPriceCache } from "../api/_lib/page-checkout.js";
import {
  chargeReminderDue, chargeReminderSkipReason, buildChargeReminderEmail, buildFirstMonthConfirmationEmail,
  buildManageBillingUrl, buildTrialReminderEmail, buildCheckoutLinkEmail, activityLine, CHARGE_REMINDER_KIND,
} from "../api/_lib/trial-reminders.js";
import { PLANS, LOOKUP_KEYS } from "../data/plans.mjs";

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { console.error(`  FAIL - ${name}`); console.error(err); process.exitCode = 1; }
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-11-12T15:00:00Z");
const v2Preview = { pricing_version: PRICING_V2, provider: "stripe", status: "trialing", is_trial: true, trial_expires_at: new Date(NOW + 20 * DAY).toISOString(), stripe_subscription_id: null };
const legacyFreeMonth = { ...v2Preview, pricing_version: null };

// ── Who is on v2 ──
await test("new signups are stamped v2 unless PRICING_VERSION_NEW_SIGNUPS=v1", () => {
  assert.equal(pricingVersionForNewSignup({}), PRICING_V2);
  assert.equal(pricingVersionForNewSignup({ PRICING_VERSION_NEW_SIGNUPS: "v1" }), null);
  assert.equal(pricingVersionForNewSignup({ PRICING_VERSION_NEW_SIGNUPS: " V1 " }), null);
});

await test("writeNewSubscription stamps pricing_version, and falls back if the column is missing", async () => {
  const rows = [];
  await writeNewSubscription(async (row) => { rows.push(row); return { error: null }; }, { business_id: "b" }, {});
  assert.equal(rows[0].pricing_version, PRICING_V2);

  const tries = [];
  const r = await writeNewSubscription(async (row) => {
    tries.push(row);
    return "pricing_version" in row ? { error: { message: 'column "pricing_version" does not exist' } } : { error: null };
  }, { business_id: "b" }, {});
  assert.equal(tries.length, 2);
  assert.ok(!("pricing_version" in tries[1]));
  assert.equal(r.error, null);

  const legacy = [];
  await writeNewSubscription(async (row) => { legacy.push(row); return { error: null }; }, { business_id: "b" }, { PRICING_VERSION_NEW_SIGNUPS: "v1" });
  assert.ok(!("pricing_version" in legacy[0]));
});

await test("signup paths stamp pricing_version: /create, admin build and previews", () => {
  const gen = fs.readFileSync("api/generate-business.js", "utf8");
  assert.equal((gen.match(/writeNewSubscription\(/g) || []).length, 2);
  const ga = fs.readFileSync("api/ga-metrics.js", "utf8");
  assert.match(ga, /writeNewSubscription\(\(row\) => supabase\.from\("subscriptions"\)\.insert\(row\)/);
});

// ── Preview and claim stay free; go-live needs checkout on v2 only ──
await test("preview and claim need no card: the claim endpoint never touches Stripe", () => {
  const claim = fs.readFileSync("api/claim-business.js", "utf8");
  assert.doesNotMatch(claim, /from ["']stripe["']|page-checkout|create-checkout|new Stripe/);
  // A v2 preview inside its window is live (visitable) through website_is_active's trial rule.
  const sql = fs.readFileSync("supabase/migrations/20261110_billing_interval.sql", "utf8");
  assert.match(sql, /s\.is_trial = true AND s\.trial_expires_at IS NOT NULL AND s\.trial_expires_at > now\(\)/);
});

await test("v2 needs checkout to go live; legacy, comped and subscribed accounts don't", () => {
  assert.equal(needsCheckoutToGoLive(v2Preview, NOW), true);
  assert.equal(needsCheckoutToGoLive(legacyFreeMonth, NOW), false);
  assert.equal(needsCheckoutToGoLive(null, NOW), false);
  assert.equal(needsCheckoutToGoLive({ ...v2Preview, provider: "comped" }, NOW), false);
  assert.equal(needsCheckoutToGoLive({ ...v2Preview, stripe_subscription_id: "sub_1" }, NOW), false);
  assert.equal(needsCheckoutToGoLive({ ...v2Preview, status: "active", stripe_subscription_id: "sub_1" }, NOW), false);
  assert.equal(needsCheckoutToGoLive({ ...v2Preview, status: "past_due", stripe_subscription_id: "sub_1" }, NOW), false);
  assert.equal(needsCheckoutToGoLive({ ...v2Preview, status: "canceled", stripe_subscription_id: "sub_1", current_period_end: new Date(NOW + DAY).toISOString() }, NOW), false);
  assert.equal(needsCheckoutToGoLive({ ...v2Preview, status: "canceled", stripe_subscription_id: "sub_1", current_period_end: new Date(NOW - DAY).toISOString() }, NOW), true);
});

await test("search engines: v2 previews are noindex until checkout; legacy claimed pages unchanged", () => {
  const claimed = { is_public: true, is_claimed: true };
  assert.equal(pageIndexable({ profile: claimed, sub: v2Preview }), false);
  assert.equal(pageIndexable({ profile: claimed, sub: { ...v2Preview, stripe_subscription_id: "sub_1" } }), true);
  assert.equal(pageIndexable({ profile: claimed, sub: legacyFreeMonth }), true);
  assert.equal(pageIndexable({ profile: claimed, sub: null }), true);
  assert.equal(pageIndexable({ profile: { is_public: true, is_claimed: false }, sub: legacyFreeMonth }), false);
  assert.equal(pageIndexable({ profile: claimed, sub: v2Preview, isInternal: true }), true);
  assert.match(fs.readFileSync("api/p.js", "utf8"), /pageIndexable\(\{ profile, \.\.\.billingState \}\)/);
  assert.match(fs.readFileSync("api/sitemap.js", "utf8"), /\.filter\(\(p\) => pageIndexable\(/);
});

// ── Checkout plan ──
await test("checkoutPlanFor: v2 gets the $1 item and a 30-day trial; re-subscribers and legacy don't", () => {
  const m = checkoutPlanFor({ interval: "month", sub: v2Preview, now: NOW });
  assert.deepEqual(m, { lookupKey: "enoma_page_monthly", interval: "month", trialEnd: firstFullChargeUnix(NOW), firstMonthFee: true, pricingVersion: PRICING_V2 });
  assert.equal(m.trialEnd, Math.floor((NOW + 30 * DAY) / 1000));
  const y = checkoutPlanFor({ interval: "year", sub: v2Preview, now: NOW });
  assert.equal(y.lookupKey, "enoma_page_annual");
  assert.equal(y.firstMonthFee, true);
  // Partner sign-ups: $1 today, then $9.99/month.
  const p = checkoutPlanFor({ referrer: { active: true, partner_pricing: true }, interval: "year", sub: v2Preview, now: NOW });
  assert.equal(p.lookupKey, "enoma_page_partner_monthly");
  assert.equal(p.firstMonthFee, true);
  // Subscribed before and canceled: full price, no trial.
  const again = checkoutPlanFor({ interval: "month", sub: { ...v2Preview, status: "canceled", is_trial: false, stripe_subscription_id: "sub_old" }, now: NOW });
  assert.equal(again.firstMonthFee, false);
  assert.equal(again.trialEnd, null);
  // Legacy free month: unchanged (first charge when the free month ends).
  const legacy = checkoutPlanFor({ interval: "month", sub: legacyFreeMonth, now: NOW });
  assert.equal(legacy.firstMonthFee, false);
  assert.equal(legacy.trialEnd, Math.floor(Date.parse(legacyFreeMonth.trial_expires_at) / 1000));
});

await test("the $1 price is a one-time price resolved by lookup key, not an env var or a price id", () => {
  const plan = PLANS.find((p) => p.lookupKey === FIRST_MONTH_LOOKUP_KEY);
  assert.equal(FIRST_MONTH_LOOKUP_KEY, "enoma_page_first_month");
  assert.ok(plan && plan.oneTime === true && plan.public === false && plan.fallbackAmount === 100);
  assert.ok(LOOKUP_KEYS.includes(FIRST_MONTH_LOOKUP_KEY));
  assert.ok(LOOKUP_KEYS.length <= 10, "prices.list is called with limit 10");
  assert.deepEqual(firstMonthLineItem({ enoma_page_first_month: { id: "price_1x" } }), { price: "price_1x", quantity: 1 });
  assert.equal(firstMonthLineItem({}), null);
  const src = fs.readFileSync("api/_lib/page-checkout.js", "utf8") + fs.readFileSync("api/_lib/pricing.js", "utf8");
  assert.doesNotMatch(src, /STRIPE_PRICE_FIRST_MONTH|price_[A-Za-z0-9]{8,}/);
});

// ── Checkout session with a mocked Stripe and Supabase ──
function mockSupabase(tables) {
  const upserts = [];
  const from = (table) => {
    const q = { table, filters: {} };
    const rows = () => (tables[table] || []).filter((r) => Object.entries(q.filters).every(([k, v]) => r[k] === v));
    const chain = {
      select() { return chain; },
      eq(k, v) { q.filters[k] = v; return chain; },
      in() { return chain; },
      maybeSingle: async () => ({ data: rows()[0] || null, error: null }),
      upsert: async (row) => { upserts.push({ table, row }); return { error: null }; },
      then(resolve) { resolve({ data: rows(), error: null }); },
    };
    return chain;
  };
  return { from, upserts };
}
function mockStripe({ withFirstMonth = true } = {}) {
  const created = [];
  const prices = [
    { id: "price_monthly", lookup_key: "enoma_page_monthly", unit_amount: 1999, recurring: { interval: "month" } },
    { id: "price_annual", lookup_key: "enoma_page_annual", unit_amount: 19900, recurring: { interval: "year" } },
    { id: "price_partner", lookup_key: "enoma_page_partner_monthly", unit_amount: 999, recurring: { interval: "month" } },
    ...(withFirstMonth ? [{ id: "price_first", lookup_key: "enoma_page_first_month", unit_amount: 100, recurring: null }] : []),
  ];
  return {
    created,
    prices: { list: async ({ lookup_keys }) => ({ data: prices.filter((p) => lookup_keys.includes(p.lookup_key)) }) },
    customers: { create: async () => ({ id: "cus_new" }) },
    checkout: { sessions: { create: async (params) => { created.push(params); return { id: "cs_test_1", url: "https://checkout.stripe.test/cs_test_1" }; } } },
  };
}
const BIZ = "11111111-1111-4111-8111-111111111111";
function tablesFor(sub, { referredBy = null } = {}) {
  return {
    subscriptions: [{ business_id: BIZ, stripe_customer_id: "cus_1", ...sub }],
    businesses: [{ id: BIZ, is_internal: false, created_at: "2026-11-12T00:00:00Z", first_touch: null, referred_by: referredBy }],
    small_business_profiles: [{ business_id: BIZ, business_name: "Smith Landscaping" }],
    service_spotlights: [],
    referrers: referredBy ? [{ code: referredBy, active: true, partner_pricing: true }] : [],
  };
}

for (const interval of ["month", "year"]) {
  await test(`v2 checkout (${interval}): the plan on a 30-day trial plus the one-time $1 line`, async () => {
    _resetPriceCache();
    const stripe = mockStripe();
    const r = await createPageCheckoutSession({
      stripe, supabase: mockSupabase(tablesFor(v2Preview)), businessId: BIZ, interval,
      customer: { email: "owner@example.com", userId: "u1" }, now: NOW,
    });
    assert.equal(r.status, 200);
    const s = stripe.created[0];
    assert.equal(s.mode, "subscription");
    assert.deepEqual(s.line_items, [
      { price: interval === "year" ? "price_annual" : "price_monthly", quantity: 1 },
      { price: "price_first", quantity: 1 },
    ]);
    assert.equal(s.subscription_data.trial_end, Math.floor((NOW + 30 * DAY) / 1000));
    assert.equal(s.metadata.pricing_version, PRICING_V2);
    assert.equal(s.metadata.first_month_fee, "1");
    assert.equal(s.metadata.interval, interval);
    assert.match(s.success_url, /value=1\.00/);
  });
}

await test("v2 partner checkout: $1 today, then the $9.99/month partner price", async () => {
  _resetPriceCache();
  const stripe = mockStripe();
  const r = await createPageCheckoutSession({ stripe, supabase: mockSupabase(tablesFor(v2Preview, { referredBy: "partner-co" })), businessId: BIZ, interval: "month", now: NOW });
  assert.equal(r.status, 200);
  assert.deepEqual(stripe.created[0].line_items, [{ price: "price_partner", quantity: 1 }, { price: "price_first", quantity: 1 }]);
  assert.ok(stripe.created[0].subscription_data.trial_end);
});

await test("v2 checkout refuses (503) rather than charge full price if the $1 price is missing", async () => {
  _resetPriceCache();
  const stripe = mockStripe({ withFirstMonth: false });
  const r = await createPageCheckoutSession({ stripe, supabase: mockSupabase(tablesFor(v2Preview)), businessId: BIZ, interval: "month", now: NOW });
  assert.equal(r.status, 503);
  assert.equal(stripe.created.length, 0);
});

await test("legacy checkout is unaffected: no $1 line, trial_end = end of the free month", async () => {
  _resetPriceCache();
  const stripe = mockStripe();
  const r = await createPageCheckoutSession({ stripe, supabase: mockSupabase(tablesFor(legacyFreeMonth)), businessId: BIZ, interval: "month", now: NOW });
  assert.equal(r.status, 200);
  assert.deepEqual(stripe.created[0].line_items, [{ price: "price_monthly", quantity: 1 }]);
  assert.equal(stripe.created[0].subscription_data.trial_end, Math.floor(Date.parse(legacyFreeMonth.trial_expires_at) / 1000));
  assert.equal(stripe.created[0].metadata.pricing_version, "v1");
  assert.equal(stripe.created[0].metadata.first_month_fee, "0");
});

await test("already subscribed (v2 in its $1 month) can't check out twice", async () => {
  _resetPriceCache();
  const stripe = mockStripe();
  const r = await createPageCheckoutSession({ stripe, supabase: mockSupabase(tablesFor({ ...v2Preview, stripe_subscription_id: "sub_1" })), businessId: BIZ, interval: "month", now: NOW });
  assert.equal(r.status, 400);
  assert.equal(stripe.created.length, 0);
});

// ── What the owner sees next to the button ──
await test("terms next to the button: computed date, monthly and annual wording", () => {
  const at = Math.floor(Date.parse("2026-12-12T15:00:00Z") / 1000);
  assert.equal(checkoutTermsLine({ interval: "month", chargeDate: at }), "$1 today. Then $19.99/month starting December 12, 2026. Cancel anytime from your dashboard.");
  assert.equal(checkoutTermsLine({ interval: "year", chargeDate: at }), "$1 today. Then $199/year starting December 12, 2026. Cancel anytime from your dashboard.");
  assert.equal(PRICE_LINE, "$1 for your first month, then $19.99/month or $199/year. Cancel anytime.");
  assert.equal(priceLineFor({ partner: true }), "$1 for your first month, then $9.99/month. Cancel anytime.");
});

await test("plan picker (browser) shows the same terms, with the date computed from today", () => {
  const src = fs.readFileSync("public/scripts/plan-picker.js", "utf8");
  const ctx = { window: {} };
  vm.runInNewContext(src, ctx);
  const p = ctx.window.EnomaPlanPicker;
  assert.equal(p.firstMonthOffer(v2Preview), true);
  assert.equal(p.firstMonthOffer(legacyFreeMonth), false);
  assert.equal(p.firstMonthOffer({ ...v2Preview, stripe_subscription_id: "sub_1" }), false);
  assert.equal(p.firstMonthOffer({ ...v2Preview, provider: "comped" }), false);
  assert.match(p.termsLine("month", NOW), /^\$1 today\. Then \$19\.99\/month starting December 12, 2026\. Cancel anytime from your dashboard\.$/);
  assert.match(p.termsLine("year", NOW), /^\$1 today\. Then \$199\/year starting December 12, 2026\. Cancel anytime from your dashboard\.$/);
  assert.equal(p.PRICE_LINE, PRICE_LINE);
  assert.doesNotMatch(src, /starting (January|February|March|April|May|June|July|August|September|October|November|December) \d/, "no hard-coded date");
});

// ── Reminder 3 days before the first full charge ──
const chargeAt = new Date(NOW + 3 * DAY).toISOString();
await test("charge reminder is due 3 days before the first full charge, once", () => {
  assert.equal(chargeReminderDue({ chargeAt, now: NOW }), CHARGE_REMINDER_KIND);
  assert.equal(chargeReminderDue({ chargeAt: new Date(NOW + 3.4 * DAY).toISOString(), now: NOW }), CHARGE_REMINDER_KIND);
  assert.equal(chargeReminderDue({ chargeAt: new Date(NOW + 4 * DAY).toISOString(), now: NOW }), null, "too early");
  assert.equal(chargeReminderDue({ chargeAt: new Date(NOW - 1000).toISOString(), now: NOW }), null, "already charged");
  assert.equal(chargeReminderDue({ chargeAt, now: NOW, sent: [CHARGE_REMINDER_KIND] }), null, "sent once");
});

await test("charge reminder goes to v2 owners in their $1 month only", () => {
  const sub = { pricing_version: PRICING_V2, status: "trialing", stripe_subscription_id: "sub_1", current_period_end: chargeAt };
  const c = { slug: "smith-landscaping", ownerEmail: "owner@example.com", sub };
  assert.equal(chargeReminderSkipReason(c), null);
  assert.equal(chargeReminderSkipReason({ ...c, sub: { ...sub, pricing_version: null } }), "not_v2");
  assert.equal(chargeReminderSkipReason({ ...c, sub: { ...sub, status: "active" } }), "not_in_first_month");
  assert.equal(chargeReminderSkipReason({ ...c, sub: { ...sub, cancel_at_period_end: true } }), "canceling");
  assert.equal(chargeReminderSkipReason({ ...c, ownerEmail: null }), "no_owner_email");
  assert.equal(chargeReminderSkipReason({ ...c, isInternal: true }), "internal");
});

await test("charge reminder email: amount, date, activity and a one-click manage/cancel link", () => {
  const e = buildChargeReminderEmail({
    businessName: "Smith Landscaping", ownerFirstName: "Dana", amount: "$19.99", interval: "month",
    chargeDate: chargeAt, activity: { views: 42, contactClicks: 5 }, manageUrl: buildManageBillingUrl(BIZ),
  });
  assert.equal(e.subject, "Your first Enoma charge: $19.99 on November 15, 2026");
  assert.match(e.text, /your first full charge for Smith Landscaping is \$19\.99 on November 15, 2026/);
  assert.match(e.text, /Since you went live: 42 page views and 5 contact clicks/);
  assert.match(e.text, new RegExp(`Manage or cancel: https://enoma\\.io/dashboard\\?business_id=${BIZ}&billing=1`));
  assert.ok(e.text.includes(PRICE_LINE), "full price line in the same email");
  assert.ok(e.html.includes("billing=1"));
  const quiet = buildChargeReminderEmail({ amount: "$199", interval: "year", chargeDate: chargeAt, activity: { views: 0, contactClicks: 0 }, manageUrl: "https://x" });
  assert.doesNotMatch(quiet.text, /Since you went live/);
  assert.match(quiet.text, /\$199 every year/);
  assert.equal(activityLine(null), null);
});

await test("the dashboard opens Stripe's portal from the ?billing=1 link", () => {
  const dash = fs.readFileSync("public/dashboard/index.html", "utf8");
  assert.match(dash, /get\('billing'\) === '1'\) openBillingPortal\(\)/);
});

await test("charge reminders ride the existing trial_reminders cron (no new function)", () => {
  const ga = fs.readFileSync("api/ga-metrics.js", "utf8");
  assert.match(ga, /const charge = await runChargeReminders\(\{ now, dryRun \}\);/);
  assert.equal(fs.readdirSync("api").filter((f) => f.endsWith(".js")).length, 12, "Vercel Hobby: 12 functions");
  const mig = fs.readFileSync("supabase/migrations/20261112_pricing_version.sql", "utf8");
  assert.match(mig, /'charge_3d', 'first_paid'/);
  assert.match(mig, /add column if not exists pricing_version text/);
});

await test("confirmation after the $1 charge has the renewal terms", () => {
  const e = buildFirstMonthConfirmationEmail({
    businessName: "Smith Landscaping", amount: "$199", interval: "year", chargeDate: Date.parse("2026-12-12T15:00:00Z"),
    pageUrl: "https://enoma.io/smith-landscaping", manageUrl: buildManageBillingUrl(BIZ),
  });
  assert.match(e.text, /Your \$1 first month for Smith Landscaping is paid and your page is live at https:\/\/enoma\.io\/smith-landscaping/);
  assert.match(e.text, /Next: \$199\/year starting December 12, 2026\. I'll email you 3 days before that charge\./);
  assert.ok(e.text.includes(PRICE_LINE));
  const partner = buildFirstMonthConfirmationEmail({ amount: "$9.99", chargeDate: Date.now(), manageUrl: "https://x", partner: true });
  assert.ok(partner.text.includes("$1 for your first month, then $9.99/month. Cancel anytime."));
});

await test("v2 previews get preview wording, not 'free month'; legacy keeps its emails", () => {
  const v2 = buildTrialReminderEmail({ kind: "7d", businessName: "Smith Landscaping", pageUrl: "https://enoma.io/s", endsOn: "Nov 30", subscribeUrl: "https://x", pricingVersion: PRICING_V2 });
  assert.equal(v2.subject, "Your Enoma preview ends Nov 30");
  assert.doesNotMatch(v2.text, /free month/i);
  assert.ok(v2.text.includes(PRICE_LINE));
  const legacy = buildTrialReminderEmail({ kind: "7d", businessName: "Smith Landscaping", pageUrl: "https://enoma.io/s", endsOn: "Nov 30", turnsOff: true, monthlyPrice: "$19.99", yearlyPrice: "$199", subscribeUrl: "https://x" });
  assert.equal(legacy.subject, "Your free month on Enoma ends Nov 30");
});

await test("Jack's checkout-link email carries the same terms and expiry", () => {
  const e = buildCheckoutLinkEmail({ businessName: "Smith Landscaping", url: "https://checkout.stripe.test/x", interval: "month", chargeDate: Date.parse("2026-12-12T15:00:00Z") });
  assert.match(e.text, /\$1 today\. Then \$19\.99\/month starting December 12, 2026\./);
  assert.match(e.text, /works for 24 hours/);
  assert.ok(e.text.includes(PRICE_LINE));
  const ga = fs.readFileSync("api/ga-metrics.js", "utf8");
  assert.match(ga, /req\.query\.action === "checkout_link"/);
  assert.match(ga, /source: "admin_link"/);
});

// ── Funnel events carry pricing_version ──
await test("claim, checkout and payment events record pricing_version", () => {
  assert.match(fs.readFileSync("api/claim-business.js", "utf8"), /pricing_version: pricingVersion/);
  assert.match(fs.readFileSync("api/create-checkout.js", "utf8"), /pricing_version: result\.plan\.pricingVersion/);
  const hook = fs.readFileSync("api/stripe-webhook.js", "utf8");
  assert.match(hook, /\['subscription_activated', 'checkout_completed'\]/);
  assert.match(hook, /pricing_version: pricingVersion/);
});

// ── Stripe webhook: unknown event types get 200 ──
await test("the webhook returns 200 for event types it doesn't handle", async () => {
  process.env.STRIPE_SECRET_KEY ||= "sk_test_dummy";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_dummy";
  process.env.SUPABASE_URL ||= "http://127.0.0.1:9";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "service-role-dummy";
  const { default: handler } = await import("../api/stripe-webhook.js");
  for (const type of ["customer.subscription.trial_will_end", "invoice.paid", "some.future.event"]) {
    const payload = JSON.stringify({ id: "evt_test", object: "event", type, data: { object: {} } });
    const t = Math.floor(Date.now() / 1000);
    const sig = crypto.createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET).update(`${t}.${payload}`).digest("hex");
    const req = Readable.from([Buffer.from(payload)]);
    req.method = "POST";
    req.headers = { "stripe-signature": `t=${t},v1=${sig}` };
    const res = { code: null, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await handler(req, res);
    assert.equal(res.code, 200, type);
    assert.deepEqual(res.body, { received: true });
  }
});

console.log(`pricing: ${passed} passed`);
