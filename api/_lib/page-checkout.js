// api/_lib/page-checkout.js
// Creates the Stripe Checkout session for a page subscription. Shared by
// api/create-checkout.js (the owner, signed in) and
// api/ga-metrics.js?action=checkout_link (Jack sending a link for a claimed
// page after a setup call), so both end at the same checkout.
//
// Pricing v2 (api/_lib/pricing.js): a v2 account that has never subscribed
// gets a one-time $1 line item today and the plan on a trial that ends at
// 23:59 Eastern 30 days out (Checkout shows "30 days free"), with a line
// above the pay button saying what the $1 covers and when the plan starts.
// Partner sign-ups get the same: $1 today, then $9.99/month.
// Everyone else keeps the old rules (api/_lib/billing.js checkoutPlanFor).

import { LOOKUP_KEYS } from "../../data/plans.mjs";
import { checkoutPlanFor, hasLiveStripeSubscription, spotlightLookupKeyFor } from "./billing.js";
import { loadSpotlightBillingState, spotlightBilling, checkoutSubscriptionParams } from "./spotlight-billing.js";
import { utmMetadata } from "./attribution.js";
import { firstMonthLineItem, FIRST_MONTH_CENTS, FIRST_MONTH_LOOKUP_KEY, checkoutSubmitMessage } from "./pricing.js";

const OPENING_SHORTLY = "Subscriptions are opening shortly. Email jack@enoma.io and we'll keep your page live in the meantime.";

// Live prices by lookup key, cached per warm instance for 10 minutes.
let priceCache = { at: 0, byKey: null };
export async function pricesByLookupKey(stripe) {
  if (priceCache.byKey && Date.now() - priceCache.at < 10 * 60 * 1000) return priceCache.byKey;
  const { data } = await stripe.prices.list({ lookup_keys: LOOKUP_KEYS, active: true, limit: 10 });
  const byKey = {};
  for (const price of data || []) if (price.lookup_key) byKey[price.lookup_key] = price;
  priceCache = { at: Date.now(), byKey };
  return byKey;
}
export function _resetPriceCache() { priceCache = { at: 0, byKey: null }; }

// First-touch utm_* values for Stripe metadata. Missing column or row -> {}.
async function firstTouchUtm(supabase, businessId) {
  try {
    const { data, error } = await supabase.from("businesses").select("first_touch").eq("id", businessId).maybeSingle();
    if (error) return {};
    return utmMetadata(data?.first_touch);
  } catch {
    return {};
  }
}

// The partner price applies only when the business was referred by an active
// partner with partner_pricing on. Missing column or row -> standard price.
export async function referrerFor(supabase, businessId) {
  try {
    const { data: biz } = await supabase.from("businesses").select("referred_by").eq("id", businessId).maybeSingle();
    if (!biz?.referred_by) return null;
    const { data: ref, error } = await supabase.from("referrers")
      .select("code, active, partner_pricing").eq("code", biz.referred_by).maybeSingle();
    if (error) return null;
    return ref || null;
  } catch {
    return null;
  }
}

/**
 * Returns { status: 200, url, session, plan } or { status, error }.
 * customer: { email, userId } for the Stripe customer (the owner).
 * source: "dashboard" | "admin_link", recorded in metadata.
 */
export async function createPageCheckoutSession({
  stripe, supabase, businessId, interval, customer = {}, source = "dashboard", now = Date.now(), env = process.env,
}) {
  const { data: existingSub } = await supabase
    .from("subscriptions")
    .select("status, provider, stripe_subscription_id, stripe_customer_id, is_trial, trial_expires_at, pricing_version")
    .eq("business_id", businessId)
    .maybeSingle();

  // "trialing" with a Stripe subscription id = already subscribed (card on
  // file, first charge pending).
  if (hasLiveStripeSubscription(existingSub)) return { status: 400, error: "Already subscribed" };

  let stripeCustomerId = existingSub?.stripe_customer_id;
  if (!stripeCustomerId) {
    const { data: profile } = await supabase
      .from("small_business_profiles").select("business_name").eq("business_id", businessId).maybeSingle();
    const created = await stripe.customers.create({
      email: customer.email || undefined,
      name: profile?.business_name || customer.email || undefined,
      metadata: { ...(customer.userId ? { supabase_user_id: customer.userId } : {}), business_id: businessId },
    });
    stripeCustomerId = created.id;
    await supabase.from("subscriptions").upsert({
      business_id: businessId,
      stripe_customer_id: stripeCustomerId,
      provider: "stripe",
      status: existingSub?.status || "trialing",
      plan_code: "starter",
      is_trial: existingSub?.is_trial ?? true,
    }, { onConflict: "business_id" });
  }

  const plan = checkoutPlanFor({ referrer: await referrerFor(supabase, businessId), interval, sub: existingSub, now });
  let byKey = {};
  try { byKey = await pricesByLookupKey(stripe); } catch (e) { console.error("price lookup failed:", e?.message); }
  let priceId = byKey[plan.lookupKey]?.id || null;
  if (!priceId && plan.lookupKey === "enoma_page_monthly") priceId = env.STRIPE_MONTHLY_PRICE_ID || null;
  if (!priceId) return { status: 503, error: OPENING_SHORTLY };

  const utm = await firstTouchUtm(supabase, businessId);
  const metadata = {
    business_id: businessId,
    ...(customer.userId ? { supabase_user_id: customer.userId } : {}),
    lookup_key: plan.lookupKey,
    interval: plan.interval,
    pricing_version: plan.pricingVersion || "v1",
    first_month_fee: plan.firstMonthFee ? "1" : "0",
    checkout_source: source,
    ...utm,
  };

  // v2: the one-time $1 price, by lookup key. Missing -> same answer as a
  // missing plan price, rather than charging the full price today.
  const firstMonthLine = plan.firstMonthFee ? firstMonthLineItem(byKey) : null;
  if (plan.firstMonthFee && !firstMonthLine) {
    console.error(`checkout: Stripe price ${FIRST_MONTH_LOOKUP_KEY} not found`);
    return { status: 503, error: OPENING_SHORTLY };
  }

  const spotState = await loadSpotlightBillingState(supabase, businessId);
  const spotlightPriceId = spotState.published ? byKey[spotlightLookupKeyFor(plan.interval)]?.id || null : null;
  const params = checkoutSubscriptionParams({
    pagePriceId: priceId,
    published: spotState.published,
    billing: spotlightBilling({ sub: spotState.sub, business: spotState.business }),
    spotlightPriceId,
    trialEnd: plan.trialEnd,
    metadata,
    firstMonthLine,
  });
  if (params.error) return { status: 503, error: OPENING_SHORTLY };

  // ?plan/value let the dashboard send GA4's purchase event once. On v2 the
  // amount paid today is the $1.
  const pageAmountCents = byKey[plan.lookupKey]?.unit_amount ?? null;
  const successParams = new URLSearchParams({ subscribed: "1", business_id: businessId, plan: plan.interval });
  const valueCents = plan.firstMonthFee ? FIRST_MONTH_CENTS : pageAmountCents;
  if (valueCents !== null) successParams.set("value", (valueCents / 100).toFixed(2));

  const session = await stripe.checkout.sessions.create({
    customer: stripeCustomerId,
    mode: "subscription",
    payment_method_types: ["card"],
    line_items: params.line_items,
    subscription_data: params.subscription_data,
    // {CHECKOUT_SESSION_ID} is filled in by Stripe (left unencoded on purpose).
    success_url: `https://enoma.io/dashboard?${successParams.toString()}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `https://enoma.io/dashboard?business_id=${businessId}`,
    metadata,
    // v2: say what today's $1 is and when the plan starts, above the pay
    // button. The date is trial_end (23:59 Eastern, 30 days out).
    ...(plan.firstMonthFee ? {
      custom_text: { submit: { message: checkoutSubmitMessage({
        interval: plan.interval,
        partner: plan.lookupKey === "enoma_page_partner_monthly",
        chargeDate: plan.trialEnd,
        amountCents: pageAmountCents,
      }) } },
    } : {}),
  });

  return { status: 200, url: session.url, session, plan, utm };
}
