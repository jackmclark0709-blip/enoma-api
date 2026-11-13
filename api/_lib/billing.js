// api/_lib/billing.js
// Pure billing rules shared by api/create-checkout.js and
// api/stripe-webhook.js (and tested in tests/billing.test.js). No Stripe or
// Supabase calls here.
//
// The free month lives in our database (subscriptions.is_trial,
// trial_expires_at), not in Stripe. When an owner subscribes during their free
// month we pass Stripe a trial_end so the first charge lands the day the free
// month ends. Stripe then reports the subscription as "trialing" until that
// day; a "trialing" subscription that has a Stripe subscription id was set up
// through Checkout with a card, so it keeps the page live like "active".

import { pageLookupKeyFor, planByLookupKey } from "../../data/plans.mjs";

export const INTERVALS = ["month", "year"];

// Stripe rejects a trial_end in the past and warns near "now"; we only pass
// one when the free month has more than 48 hours left.
export const MIN_TRIAL_END_LEAD_MS = 48 * 60 * 60 * 1000;

/** "month" | "year" from the request body; missing -> "month"; anything else -> null (reject). */
export function normalizeInterval(value) {
  if (value === undefined || value === null || value === "") return "month";
  return INTERVALS.includes(value) ? value : null;
}

/**
 * Unix seconds for subscription_data.trial_end, or null for "charge at
 * checkout". Only while our own free month is running (is_trial true) and it
 * ends more than 48 hours from `now`. Pages whose free month already ended
 * (even if their row still says status "trialing") get null.
 */
export function trialEndFor(sub, now = Date.now()) {
  if (!sub || sub.is_trial !== true || !sub.trial_expires_at) return null;
  const ends = new Date(sub.trial_expires_at).getTime();
  if (!Number.isFinite(ends)) return null;
  if (ends - now <= MIN_TRIAL_END_LEAD_MS) return null;
  return Math.floor(ends / 1000);
}

// The $1 first month (pricing v2) ends at 23:59 Eastern on the 30th calendar
// day after checkout. "now + 30 days" to the second made Stripe Checkout say
// "29 days free" (it rounds down); ending the day instead gives "30 days
// free", and every place that shows the date (plan picker, checkout text,
// reminder emails via current_period_end) shows the same day. The plan
// picker (public/scripts/plan-picker.js) mirrors this; tests check they agree.
export const FIRST_MONTH_DAYS = 30;
export const BILLING_TZ = "America/New_York";

// Minutes that `tz` is ahead of UTC at instant `ms` (negative for the US).
function tzOffsetMinutes(ms, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
  }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

/** Unix seconds of 23:59:00 Eastern, `days` calendar days after today (Eastern). */
export function endOfDayUnix(now = Date.now(), days = FIRST_MONTH_DAYS, tz = BILLING_TZ) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "numeric", day: "numeric" })
    .formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  const wall = Date.UTC(+p.year, +p.month - 1, +p.day + days, 23, 59, 0);
  // Wall-clock 23:59 in tz -> UTC; a second pass settles a DST change between today and then.
  let ms = wall - tzOffsetMinutes(wall, tz) * 60000;
  ms = wall - tzOffsetMinutes(ms, tz) * 60000;
  return Math.floor(ms / 1000);
}

/** trial_end for a v2 first-month checkout started at `now`. */
export function firstMonthTrialEndUnix(now = Date.now()) {
  return endOfDayUnix(now, FIRST_MONTH_DAYS);
}

/**
 * What create-checkout charges: the lookup key, the interval actually billed
 * (the partner price is monthly-only, whatever was picked) and the trial_end
 * (null = charge at checkout).
 */
export function checkoutPlanFor({ referrer = null, interval = "month", sub = null, now = Date.now() } = {}) {
  const lookupKey = pageLookupKeyFor(referrer, interval);
  const billedInterval = planByLookupKey(lookupKey)?.interval || interval;
  // Pricing v2 ($1 first month, api/_lib/pricing.js): a one-time $1 item
  // today and the plan on a 30-day trial, whatever is left of the preview.
  // Inlined here (not imported) because pricing.js imports this file.
  if (sub?.pricing_version === "v2_1dollar" && !sub.stripe_subscription_id && sub.provider !== "comped") {
    return {
      lookupKey,
      interval: billedInterval,
      trialEnd: firstMonthTrialEndUnix(now),
      firstMonthFee: true,
      pricingVersion: "v2_1dollar",
    };
  }
  return {
    lookupKey,
    interval: billedInterval,
    trialEnd: trialEndFor(sub, now),
    firstMonthFee: false,
    pricingVersion: sub?.pricing_version || null,
  };
}

/**
 * True when the business already has a Stripe subscription that keeps the
 * page live: "active", or "trialing" in Stripe (subscribed during the free
 * month, card on file, first charge pending). A row that only says
 * "trialing" because of our own free month has no stripe_subscription_id.
 */
export function hasLiveStripeSubscription(sub) {
  if (!sub) return false;
  if (sub.status === "active") return true;
  return sub.status === "trialing" && !!sub.stripe_subscription_id;
}

function isoFromUnix(sec) {
  return Number.isFinite(sec) && sec > 0 ? new Date(sec * 1000).toISOString() : null;
}

// Service pages (Service Spotlights) ride the page subscription as a second
// line item (api/_lib/spotlight-billing.js). Everything that describes "the
// plan" (interval, period dates) must read the page item, never that one.
// Stripe requires every item on a subscription to share one interval, so a
// yearly page plan gets the yearly add-on price.
export const SPOTLIGHT_LOOKUP_KEY = "enoma_spotlight_monthly";
export const SPOTLIGHT_YEARLY_LOOKUP_KEY = "enoma_spotlight_yearly";
export const SPOTLIGHT_LOOKUP_KEYS = [SPOTLIGHT_LOOKUP_KEY, SPOTLIGHT_YEARLY_LOOKUP_KEY];

/** The add-on lookup key for a page-plan interval ("year" -> yearly, else monthly). */
export function spotlightLookupKeyFor(interval) {
  return interval === "year" ? SPOTLIGHT_YEARLY_LOOKUP_KEY : SPOTLIGHT_LOOKUP_KEY;
}

export function isSpotlightItem(item) {
  return SPOTLIGHT_LOOKUP_KEYS.includes(item?.price?.lookup_key);
}

/** The page-plan item of a Stripe subscription: the first item that isn't the service-page add-on. */
export function pageItemOf(sub) {
  const items = sub?.items?.data || [];
  return items.find((i) => !isSpotlightItem(i)) || items[0] || null;
}

/** The billing interval of a Stripe subscription ("month" | "year" | null). */
export function intervalOfStripeSubscription(sub) {
  const fromPrice = pageItemOf(sub)?.price?.recurring?.interval;
  if (INTERVALS.includes(fromPrice)) return fromPrice;
  const fromMeta = sub?.metadata?.interval;
  return INTERVALS.includes(fromMeta) ? fromMeta : null;
}

/**
 * The subscriptions-row fields a Stripe subscription maps to. Period dates
 * are on the subscription in older Stripe API versions and on the item in
 * newer ones, so read either. For a "trialing" subscription the period end is
 * the trial end, i.e. the first charge date.
 */
export function subscriptionFieldsFromStripe(sub) {
  const item = pageItemOf(sub) || {};
  return {
    stripe_subscription_id: sub?.id || null,
    status: sub?.status || null,
    billing_interval: intervalOfStripeSubscription(sub),
    current_period_start: isoFromUnix(sub?.current_period_start ?? item.current_period_start),
    current_period_end: isoFromUnix(sub?.current_period_end ?? item.current_period_end),
    cancel_at_period_end: !!sub?.cancel_at_period_end,
  };
}
