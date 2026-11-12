// api/_lib/pricing.js
// Pricing v2: "$1 first month". Pure rules shared by checkout, the Stripe
// webhook, page serving, the sitemap and the reminder cron. No Stripe or
// Supabase calls here (tests/pricing.test.js).
//
// Who is on v2: subscriptions.pricing_version = 'v2_1dollar', stamped when
// the subscriptions row is created (new page from /create, admin build,
// instant or outreach preview). Rows from before this change are NULL and
// keep their terms (the no-card free month, or what they already pay).
// Setting PRICING_VERSION_NEW_SIGNUPS=v1 in Vercel stops stamping new rows,
// so new signups get the old free month again; existing v2 rows are untouched.
//
// What v2 changes:
//   - The preview stays free with no card: search, generated page, editing,
//     claiming and the dashboard all work as before, for the same preview
//     window as before (trial_expires_at).
//   - Going live needs Stripe Checkout. Live = shown to Google
//     (index,follow), listed in the sitemap, and kept up after the preview
//     window. Until then a v2 page is a noindex preview.
//   - Checkout: a one-time $1 line item (Stripe lookup key
//     enoma_page_first_month) charged today, and the plan ($19.99/month,
//     $199/year, or the $9.99/month partner price) on a 30-day trial, so the
//     first full charge is 30 days after checkout.

import { hasLiveStripeSubscription } from "./billing.js";

export const PRICING_V2 = "v2_1dollar";
export const FIRST_MONTH_CENTS = 100;
export const FIRST_MONTH_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

// The standing price line (Operating Doc): wherever a price or "$1" appears,
// this full line is in the same view.
export const PRICE_LINE = "$1 for your first month, then $19.99/month or $199/year. Cancel anytime.";

/** pricing_version for a subscriptions row created now (null = legacy terms). */
export function pricingVersionForNewSignup(env = process.env) {
  return String(env.PRICING_VERSION_NEW_SIGNUPS || "").trim().toLowerCase() === "v1" ? null : PRICING_V2;
}

/**
 * Writes a new subscriptions row with pricing_version stamped. If the column
 * isn't there yet (migration 20261112_pricing_version.sql not applied), it
 * retries without it rather than break signup; that row is then legacy.
 * write(row) must return a Supabase-style { error } (insert or upsert).
 */
export async function writeNewSubscription(write, row, env = process.env) {
  const version = pricingVersionForNewSignup(env);
  if (!version) return write(row);
  const first = await write({ ...row, pricing_version: version });
  if (first?.error && /pricing_version/.test(first.error.message || "")) {
    console.warn("subscriptions.pricing_version missing; apply 20261112_pricing_version.sql");
    return write(row);
  }
  return first;
}

export function isV2(sub) {
  return sub?.pricing_version === PRICING_V2;
}

/**
 * A Stripe subscription that keeps the page live: active, trialing with a
 * card on file, past_due while Stripe retries, or canceled but paid through
 * (the same cases as website_is_active).
 */
function hasStripeSub(sub, now = Date.now()) {
  if (!sub) return false;
  if (hasLiveStripeSubscription(sub)) return true;
  if (sub.status === "past_due" && sub.stripe_subscription_id) return true;
  if (sub.status === "canceled" && sub.current_period_end) return new Date(sub.current_period_end).getTime() > now;
  return false;
}

/**
 * True when checkout should charge $1 today and start the plan 30 days
 * later: a v2 account that has never had a Stripe subscription. Someone who
 * subscribed before and canceled pays full price at checkout.
 */
export function firstMonthOfferApplies(sub) {
  return isV2(sub) && !sub.stripe_subscription_id && sub.provider !== "comped";
}

// The one-time $1 price, resolved by lookup key like every other price
// (data/plans.mjs). No env var, no hard-coded price id.
export const FIRST_MONTH_LOOKUP_KEY = "enoma_page_first_month";

/** The Checkout line item for the $1 first month, or null if the price is missing in Stripe. */
export function firstMonthLineItem(pricesByKey) {
  const price = pricesByKey?.[FIRST_MONTH_LOOKUP_KEY];
  return price?.id ? { price: price.id, quantity: 1 } : null;
}

/** The standing price line, with the partner monthly price when it applies. */
export function priceLineFor({ partner = false } = {}) {
  return partner ? "$1 for your first month, then $9.99/month. Cancel anytime." : PRICE_LINE;
}

/** Unix seconds of the first full charge for a checkout started at `now`. */
export function firstFullChargeUnix(now = Date.now()) {
  return Math.floor((now + FIRST_MONTH_DAYS * DAY_MS) / 1000);
}

/** "December 12, 2026" in Eastern time. */
export function formatChargeDate(date) {
  const d = date instanceof Date ? date : new Date(typeof date === "number" && date < 1e12 ? date * 1000 : date);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" }).format(d);
}

/**
 * The plain-text terms shown right next to the payment button, and in the
 * confirmation and reminder emails.
 *   month: "$1 today. Then $19.99/month starting December 12, 2026. Cancel anytime from your dashboard."
 *   year:  "$1 today. Then $199/year starting December 12, 2026. Cancel anytime from your dashboard."
 */
export function checkoutTermsLine({ interval = "month", chargeDate, monthlyPrice = "$19.99", yearlyPrice = "$199" } = {}) {
  const when = formatChargeDate(chargeDate);
  const then = interval === "year" ? `${yearlyPrice}/year` : `${monthlyPrice}/month`;
  return `$1 today. Then ${then} starting ${when}. Cancel anytime from your dashboard.`;
}

/**
 * True when a v2 page still needs checkout to go live: no Stripe
 * subscription keeping it up, not comped. Legacy (NULL) rows never do.
 */
export function needsCheckoutToGoLive(sub, now = Date.now()) {
  if (!isV2(sub)) return false;
  if (sub.provider === "comped") return false;
  return !hasStripeSub(sub, now);
}

/**
 * May search engines index this business page? Legacy rule (public and
 * claimed) plus, for v2, a Stripe subscription. Internal pages follow the
 * legacy rule.
 */
export function pageIndexable({ profile, sub, isInternal = false } = {}) {
  if (!profile?.is_public || profile.is_claimed === false) return false;
  if (isInternal) return true;
  return !needsCheckoutToGoLive(sub);
}
