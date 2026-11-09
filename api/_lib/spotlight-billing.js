// api/_lib/spotlight-billing.js
// Service pages (Service Spotlights, table service_spotlights) are an add-on:
// $9.99/month per PUBLISHED page (Stripe lookup key enoma_spotlight_monthly),
// not part of the base plan (decision of Nov 9, 2026).
//
// The rule:
//   - Writing and previewing a service page is free. Only "published" pages
//     are ever billed; drafts and archived pages never are.
//   - Owner with a Stripe subscription: the add-on is a second line item on
//     that subscription, quantity = published service pages, changed with
//     proration (proration_behavior "create_prorations").
//   - No Stripe subscription yet (free month, grandfathered free-for-good
//     page, or never subscribed): publishing is allowed, and the pages are
//     added as a second line item when they subscribe (api/create-checkout.js).
//   - Comped businesses (subscriptions.provider = "comped") and internal Enoma
//     pages are never billed.
//   - Yearly plan: Stripe can't put a monthly price on a yearly subscription,
//     so publishing is refused with a "contact us" message until Jack decides
//     how yearly owners pay for service pages.
//
// The quantity is always recomputed from service_spotlights on the server
// (syncSpotlightQuantity) — never taken from the browser.
//
// Pure rules first (tested in tests/spotlight-billing.test.js), then the one
// function that talks to Stripe and Supabase (clients are passed in).

import { SPOTLIGHT_LOOKUP_KEY, isSpotlightItem, intervalOfStripeSubscription } from "./billing.js";
import { isGrandfathered } from "./trial-policy.js";
import { planByLookupKey } from "../../data/plans.mjs";

export { SPOTLIGHT_LOOKUP_KEY };
export const PRORATION = { proration_behavior: "create_prorations" };
export const SPOTLIGHT_FALLBACK_AMOUNT = planByLookupKey(SPOTLIGHT_LOOKUP_KEY)?.fallbackAmount ?? 999;

// Statuses where a Stripe subscription exists and can take a quantity change.
const STRIPE_LIVE_STATUSES = ["active", "trialing", "past_due"];

export class SpotlightBillingError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export const YEARLY_MESSAGE =
  "Service pages are billed monthly, and your plan is yearly. Email jack@enoma.io and we'll add it for you.";

/** How many service pages are billed: only status "published". */
export function publishedCount(rows) {
  return (Array.isArray(rows) ? rows : []).filter((r) => r?.status === "published").length;
}

function inFreeMonth(sub, now) {
  if (!sub?.is_trial || !sub.trial_expires_at) return false;
  const ends = Date.parse(sub.trial_expires_at);
  return Number.isFinite(ends) && ends > now;
}

/**
 * How this business pays for service pages.
 *   billing "never"        — comped or internal: publish free, never billed
 *   billing "subscription" — has a Stripe subscription: change its quantity now
 *   billing "at_checkout"  — no Stripe subscription yet: publish now, billed when they subscribe
 *   billing "yearly"       — yearly Stripe plan: can't add a monthly item (see top of file)
 */
export function spotlightBilling({ sub = null, business = null, now = Date.now(), env = process.env } = {}) {
  if (business?.is_internal) return { billing: "never", reason: "internal" };
  if (sub?.provider === "comped") return { billing: "never", reason: "comped" };
  if (sub?.stripe_subscription_id && STRIPE_LIVE_STATUSES.includes(sub.status)) {
    if (sub.billing_interval === "year") return { billing: "yearly", reason: "yearly_plan" };
    return { billing: "subscription", reason: sub.status === "trialing" ? "subscribed_in_free_month" : "subscribed" };
  }
  if (inFreeMonth(sub, now)) return { billing: "at_checkout", reason: "free_month" };
  if (business && isGrandfathered(business.created_at, env)) return { billing: "at_checkout", reason: "grandfathered" };
  return { billing: "at_checkout", reason: "not_subscribed" };
}

/** The add-on item on a Stripe subscription, if any. */
export function spotlightItemOf(stripeSub) {
  return (stripeSub?.items?.data || []).find(isSpotlightItem) || null;
}

/** What to do to the Stripe subscription so the add-on quantity equals `published`. */
export function quantityChange(stripeSub, published) {
  const item = spotlightItemOf(stripeSub);
  const current = item?.quantity || 0;
  if (current === published) return { op: "none", quantity: published, current, itemId: item?.id || null };
  if (!item) return { op: "create", quantity: published, current, itemId: null };
  if (published === 0) return { op: "delete", quantity: 0, current, itemId: item.id };
  return { op: "update", quantity: published, current, itemId: item.id };
}

/**
 * The second Checkout line item: the published service pages, same
 * subscription (so same trial_end as the page plan). null line = none needed.
 * Never for comped/internal businesses; never on a yearly checkout.
 */
export function checkoutSpotlightLine({ published = 0, billing = { billing: "at_checkout" }, interval = "month", spotlightPriceId = null } = {}) {
  if (!published || billing.billing === "never") return { line: null };
  if (interval !== "month") return { line: null, error: "yearly" };
  if (!spotlightPriceId) return { line: null, error: "price_missing" };
  return { line: { price: spotlightPriceId, quantity: published } };
}

/**
 * line_items + subscription_data for create-checkout. Both line items live on
 * one subscription, so the page plan's trial_end (end of the free month)
 * applies to the service pages too. { error } instead when the service pages
 * can't be added (yearly checkout, or the add-on price is missing).
 */
export function checkoutSubscriptionParams({ pagePriceId, published = 0, billing, interval = "month", spotlightPriceId = null, trialEnd = null, metadata = {} }) {
  const spot = checkoutSpotlightLine({ published, billing, interval, spotlightPriceId });
  if (spot.error) return { error: spot.error };
  const spotlightQuantity = spot.line ? spot.line.quantity : 0;
  return {
    line_items: [{ price: pagePriceId, quantity: 1 }, ...(spot.line ? [spot.line] : [])],
    subscription_data: {
      metadata: { ...metadata, spotlight_quantity: String(spotlightQuantity) },
      ...(trialEnd ? { trial_end: trialEnd } : {}),
    },
    spotlightQuantity,
  };
}

/** ISO date the add-on charge starts, or null for "when you subscribe" / never. */
export function chargeStartsOn({ billing, sub = null, now = Date.now() }) {
  if (billing.billing === "subscription") {
    // Subscribed in the free month: Stripe's first charge is the trial end.
    if (billing.reason === "subscribed_in_free_month" && sub?.current_period_end) return sub.current_period_end;
    return new Date(now).toISOString(); // prorated from today
  }
  if (billing.billing === "at_checkout" && billing.reason === "free_month") return sub?.trial_expires_at || null;
  return null;
}

/**
 * What the dashboard shows: the page plan, the service pages and the monthly
 * total (cents). monthly_total is null on a yearly plan.
 */
export function billingSummary({ published = 0, billing, sub = null, pageAmount = null, pageInterval = "month", spotlightAmount = SPOTLIGHT_FALLBACK_AMOUNT, billedQuantity = 0, now = Date.now() }) {
  const billable = billing.billing === "never" ? 0 : published;
  const spotlightMonthly = billable * spotlightAmount;
  return {
    published,
    billing: billing.billing,
    reason: billing.reason,
    billed_quantity: billedQuantity,
    spotlight_amount: spotlightAmount,
    spotlight_monthly: spotlightMonthly,
    page_amount: pageAmount,
    page_interval: pageInterval,
    monthly_total: pageInterval === "month" && Number.isInteger(pageAmount) ? pageAmount + spotlightMonthly : null,
    starts_on: chargeStartsOn({ billing, sub, now }),
  };
}

// ── I/O ──

let priceCache = { at: 0, price: null };
/** The live enoma_spotlight_monthly price (cached 10 minutes per instance), or null. */
export async function lookupSpotlightPrice(stripe) {
  if (priceCache.price && Date.now() - priceCache.at < 10 * 60 * 1000) return priceCache.price;
  const { data } = await stripe.prices.list({ lookup_keys: [SPOTLIGHT_LOOKUP_KEY], active: true, limit: 1 });
  const price = data?.[0] || null;
  if (price) priceCache = { at: Date.now(), price };
  return price;
}

/** Published count, subscriptions row and businesses row for one business. */
export async function loadSpotlightBillingState(supabase, businessId) {
  const [spots, subRes, bizRes] = await Promise.all([
    supabase.from("service_spotlights").select("status").eq("business_id", businessId),
    supabase.from("subscriptions").select("*").eq("business_id", businessId).maybeSingle(),
    supabase.from("businesses").select("is_internal, created_at").eq("id", businessId).maybeSingle(),
  ]);
  if (spots.error) throw spots.error;
  return { published: publishedCount(spots.data), sub: subRes.data || null, business: bizRes.data || null };
}

/**
 * Recomputes the published count from service_spotlights and sets the
 * add-on quantity on the owner's Stripe subscription to match (with
 * proration). No Stripe subscription, comped or internal -> nothing to change.
 * Throws SpotlightBillingError("yearly") when it would have to add to a yearly
 * plan, and lets Stripe errors through; callers decide what to undo.
 */
export async function syncSpotlightQuantity({ stripe, supabase, businessId, now = Date.now(), env = process.env, state = null }) {
  const s = state || (await loadSpotlightBillingState(supabase, businessId));
  const billing = spotlightBilling({ sub: s.sub, business: s.business, now, env });
  const result = { business_id: businessId, published: s.published, billing: billing.billing, reason: billing.reason, quantity: 0, op: "none", stripeSub: null };
  if (billing.billing !== "subscription" && billing.billing !== "yearly") return result;
  if (!stripe) throw new SpotlightBillingError("stripe_missing", "Billing isn't set up on this server.");

  const stripeSub = await stripe.subscriptions.retrieve(s.sub.stripe_subscription_id);
  const change = quantityChange(stripeSub, s.published);
  const out = { ...result, quantity: change.quantity, op: change.op, stripeSub };
  if (change.op === "none") return out;
  // Lowering the quantity is always allowed (never bill an unpublished page).
  if (change.op === "delete") {
    await stripe.subscriptionItems.del(change.itemId, PRORATION);
    return out;
  }
  const raising = change.quantity > change.current;
  if (raising && (intervalOfStripeSubscription(stripeSub) === "year" || billing.billing === "yearly")) {
    throw new SpotlightBillingError("yearly", YEARLY_MESSAGE);
  }
  if (change.op === "update") {
    await stripe.subscriptionItems.update(change.itemId, { quantity: change.quantity, ...PRORATION });
    return out;
  }
  const price = await lookupSpotlightPrice(stripe);
  if (!price?.id) throw new SpotlightBillingError("price_missing", "The service page price isn't set up yet. Email jack@enoma.io.");
  await stripe.subscriptionItems.create({ subscription: stripeSub.id, price: price.id, quantity: change.quantity, ...PRORATION });
  return out;
}
