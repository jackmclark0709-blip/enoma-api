// api/create-checkout.js
// Creates a Stripe Checkout session for the lead-page subscription.
// POST body: { business_id, interval: "month" | "year" (default "month") }.
// Prices come from Stripe by lookup key (data/plans.mjs): enoma_page_monthly
// ($19.99/month) or enoma_page_annual ($199/year), or
// enoma_page_partner_monthly ($9.99/month, monthly only) when the business was
// referred by a partner with partner_pricing on. STRIPE_MONTHLY_PRICE_ID is
// only a fallback if the monthly lookup key isn't found; a missing yearly
// price returns 503 rather than charging monthly.
//
// The free month: while the owner's free month (subscriptions.is_trial,
// trial_expires_at) has more than 48 hours left, the subscription gets a
// trial_end so the first charge is the day the free month ends
// (api/_lib/billing.js trialEndFor). Otherwise they're charged at checkout.
// Called from the dashboard, /upgrade and /website-live (public/scripts/plan-picker.js).
//
// Service pages: each PUBLISHED service page (service_spotlights) is a
// $9.99/month add-on (lookup key enoma_spotlight_monthly), or the yearly add-on
// (enoma_spotlight_yearly) on a yearly checkout. Checkout adds them
// as a second line item, quantity = published service pages, on the same
// subscription (same trial_end). Comped and internal businesses are never
// billed for them. See api/_lib/spotlight-billing.js.
//
// action: "spotlight_quantity" (body) recomputes the published count from
// service_spotlights and sets the add-on quantity on the owner's Stripe
// subscription (with proration). The publish/unpublish code path calls the
// same function server-side; this action is for re-syncs and, with
// dry_run: true, returns the billing summary the dashboard shows (page plan +
// service pages = monthly total) without changing anything.
//
// action: "portal" (body) opens the Stripe customer portal instead, so an
// owner can update their card, cancel, or download invoices. The portal has
// to be enabled once in Stripe (Settings → Billing → Customer portal).
//
// GET ?action=plans (public, no auth) returns the live amounts for the plans
// on the pricing page, so changing a price in Stripe updates the page.
// It lives here because the Vercel Hobby plan is at its 12-function limit.

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { PLANS, LOOKUP_KEYS } from '../data/plans.mjs';
import { normalizeInterval, checkoutPlanFor, hasLiveStripeSubscription, pageItemOf, spotlightLookupKeyFor } from './_lib/billing.js';
import {
  loadSpotlightBillingState, spotlightBilling, syncSpotlightQuantity, checkoutSubscriptionParams,
  billingSummary, spotlightItemOf,
} from './_lib/spotlight-billing.js';
import { utmMetadata } from './_lib/attribution.js';
import { logFunnelEvent } from './_lib/tracking.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Live prices by lookup key, cached per warm instance for 10 minutes.
let priceCache = { at: 0, byKey: null };
async function pricesByLookupKey() {
  if (priceCache.byKey && Date.now() - priceCache.at < 10 * 60 * 1000) return priceCache.byKey;
  const { data } = await stripe.prices.list({ lookup_keys: LOOKUP_KEYS, active: true, limit: 10 });
  const byKey = {};
  for (const price of data || []) if (price.lookup_key) byKey[price.lookup_key] = price;
  priceCache = { at: Date.now(), byKey };
  return byKey;
}

async function handlePlans(req, res) {
  try {
    const byKey = await pricesByLookupKey();
    const plans = PLANS.filter((p) => p.public).map((p) => {
      const live = byKey[p.lookupKey];
      return {
        id: p.id,
        lookup_key: p.lookupKey,
        amount: live?.unit_amount ?? p.fallbackAmount,
        interval: live?.recurring?.interval || p.interval,
        live: !!live,
      };
    });
    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600');
    return res.status(200).json({ plans });
  } catch (e) {
    console.error('plans lookup failed:', e?.message);
    return res.status(200).json({ plans: [], error: 'unavailable' });
  }
}

// First-touch utm_* values for Stripe metadata (businesses.first_touch,
// filled when the page was claimed). Missing column or row -> {}.
async function firstTouchUtm(business_id) {
  try {
    const { data, error } = await supabase.from('businesses').select('first_touch').eq('id', business_id).maybeSingle();
    if (error) return {};
    return utmMetadata(data?.first_touch);
  } catch {
    return {};
  }
}

// The partner price applies only when the business was referred by an active
// partner with partner_pricing on. Missing column or row -> standard price.
async function referrerFor(business_id) {
  try {
    const { data: biz } = await supabase.from('businesses').select('referred_by').eq('id', business_id).maybeSingle();
    if (!biz?.referred_by) return null;
    const { data: ref, error } = await supabase.from('referrers')
      .select('code, active, partner_pricing').eq('code', biz.referred_by).maybeSingle();
    if (error) return null;
    return ref || null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method === 'GET' && req.query?.action === 'plans') return handlePlans(req, res);
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // Auth — require valid session
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Invalid session' });

  const { business_id, action } = req.body || {};
  if (!business_id) return res.status(400).json({ error: 'business_id required' });

  if (action === 'portal') return openPortal(req, res, user, business_id);
  if (action === 'spotlight_quantity') return spotlightQuantity(req, res, user, business_id);

  const interval = normalizeInterval(req.body?.interval);
  if (!interval) return res.status(400).json({ error: 'interval must be "month" or "year"' });


  // Verify the user owns this business
  const { data: membership } = await supabase
    .from('business_members')
    .select('role')
    .eq('business_id', business_id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!membership) return res.status(403).json({ error: 'Not your business' });

  // Check if already subscribed
  const { data: existingSub } = await supabase
    .from('subscriptions')
    .select('status, stripe_subscription_id, stripe_customer_id, is_trial, trial_expires_at')
    .eq('business_id', business_id)
    .maybeSingle();

  // "trialing" with a Stripe subscription id = already subscribed during the
  // free month (card on file, first charge pending).
  if (hasLiveStripeSubscription(existingSub)) {
    return res.status(400).json({ error: 'Already subscribed' });
  }

  // Get or create Stripe customer
  let stripeCustomerId = existingSub?.stripe_customer_id;

  if (!stripeCustomerId) {
    const { data: profile } = await supabase
      .from('small_business_profiles')
      .select('business_name, email')
      .eq('business_id', business_id)
      .maybeSingle();

    const customer = await stripe.customers.create({
      email: user.email,
      name: profile?.business_name || user.email,
      metadata: {
        supabase_user_id: user.id,
        business_id,
      },
    });
    stripeCustomerId = customer.id;

    // Save customer ID immediately
    await supabase
      .from('subscriptions')
      .upsert({
        business_id,
        stripe_customer_id: stripeCustomerId,
        provider: 'stripe',
        status: existingSub?.status || 'trialing',
        plan_code: 'starter',
        is_trial: existingSub?.is_trial ?? true,
      }, { onConflict: 'business_id' });
  }

  // Pick the price: partner (monthly only) or standard monthly/yearly, by
  // lookup key. Only the monthly price has an env fallback; a missing yearly
  // price must never fall through to charging monthly.
  // trialEnd: first charge when the free month ends, if it has more than 48h left.
  const { lookupKey, interval: billedInterval, trialEnd } =
    checkoutPlanFor({ referrer: await referrerFor(business_id), interval, sub: existingSub });
  let priceId = null;
  try {
    priceId = (await pricesByLookupKey())[lookupKey]?.id || null;
  } catch (e) {
    console.error('price lookup failed:', e?.message);
  }
  if (!priceId && lookupKey === 'enoma_page_monthly') priceId = process.env.STRIPE_MONTHLY_PRICE_ID || null;
  if (!priceId) {
    return res.status(503).json({ error: 'Subscriptions are opening shortly. Email jack@enoma.io and we\'ll keep your page live in the meantime.' });
  }
  const utm = await firstTouchUtm(business_id);
  const metadata = {
    business_id,
    supabase_user_id: user.id,
    lookup_key: lookupKey,
    interval: billedInterval,
    ...utm,
  };

  // Service pages published before subscribing (free month, grandfathered,
  // or never subscribed) become the second line item, on the add-on price
  // for the interval being bought (Stripe needs one interval per
  // subscription). Comped -> none.
  const spotState = await loadSpotlightBillingState(supabase, business_id);
  let spotlightPriceId = null;
  if (spotState.published) {
    try { spotlightPriceId = (await pricesByLookupKey())[spotlightLookupKeyFor(billedInterval)]?.id || null; } catch { /* handled below */ }
  }
  const params = checkoutSubscriptionParams({
    pagePriceId: priceId,
    published: spotState.published,
    billing: spotlightBilling({ sub: spotState.sub, business: spotState.business }),
    spotlightPriceId,
    trialEnd,
    metadata,
  });
  if (params.error) {
    return res.status(503).json({ error: 'Subscriptions are opening shortly. Email jack@enoma.io and we\'ll keep your page live in the meantime.' });
  }

  let pageAmountCents = null;
  try { pageAmountCents = (await pricesByLookupKey())[lookupKey]?.unit_amount ?? null; } catch { /* only used for GA */ }
  // ?session_id/plan/value let the dashboard send GA4's purchase event once.
  const successParams = new URLSearchParams({ subscribed: '1', business_id, plan: billedInterval });
  if (pageAmountCents !== null) successParams.set('value', (pageAmountCents / 100).toFixed(2));

  // Create Checkout session
  const session = await stripe.checkout.sessions.create({
    customer: stripeCustomerId,
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: params.line_items,
    subscription_data: params.subscription_data,
    // {CHECKOUT_SESSION_ID} is filled in by Stripe (left unencoded on purpose).
    success_url: `https://enoma.io/dashboard?${successParams.toString()}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `https://enoma.io/dashboard?business_id=${business_id}`,
    metadata,
  });

  await logFunnelEvent(supabase, req, {
    event: 'checkout_started', businessId: business_id, anonId: req.body?.anon_id,
    metadata: { interval: billedInterval, lookup_key: lookupKey, ...utm }
  });

  return res.status(200).json({ url: session.url });
}

// Service-page add-on: recompute the published count and set the Stripe
// quantity (or, with dry_run, just report it). Members of the business only.
async function spotlightQuantity(req, res, user, business_id) {
  const { data: membership } = await supabase
    .from('business_members').select('role')
    .eq('business_id', business_id).eq('user_id', user.id).maybeSingle();
  if (!membership) return res.status(403).json({ error: 'Not your business' });

  const dryRun = req.body?.dry_run === true;
  try {
    const state = await loadSpotlightBillingState(supabase, business_id);
    const billing = spotlightBilling({ sub: state.sub, business: state.business });
    const sync = dryRun ? null : await syncSpotlightQuantity({ stripe, supabase, businessId: business_id, state });

    const byKey = await pricesByLookupKey().catch(() => ({}));
    let pageAmount = null, pageInterval = billing.interval || 'month', billedQuantity = 0, spotlightAmount = null;
    if (billing.billing === 'never') {
      pageAmount = 0;
    } else if (billing.billing === 'subscription') {
      const stripeSub = sync?.stripeSub || await stripe.subscriptions.retrieve(state.sub.stripe_subscription_id);
      const pageItem = pageItemOf(stripeSub);
      pageAmount = pageItem?.price?.unit_amount ?? null;
      pageInterval = pageItem?.price?.recurring?.interval || pageInterval;
      const spotItem = spotlightItemOf(stripeSub);
      billedQuantity = sync ? sync.quantity : (spotItem?.quantity || 0);
      // The amount the owner will actually pay: the item already on the
      // subscription if it matches the plan's interval, else the live price.
      const key = spotlightLookupKeyFor(pageInterval);
      spotlightAmount = spotItem?.price?.lookup_key === key && spotItem.price.unit_amount != null
        ? spotItem.price.unit_amount
        : byKey[key]?.unit_amount ?? null;
    } else {
      // Not subscribed yet: what the monthly checkout would charge.
      const { lookupKey } = checkoutPlanFor({ referrer: await referrerFor(business_id), interval: 'month' });
      pageAmount = byKey[lookupKey]?.unit_amount ?? null;
      spotlightAmount = byKey[spotlightLookupKeyFor('month')]?.unit_amount ?? null;
    }
    return res.status(200).json(billingSummary({
      published: state.published, billing, sub: state.sub, pageAmount, pageInterval, spotlightAmount, billedQuantity,
    }));
  } catch (e) {
    console.error('[spotlight-billing] spotlight_quantity failed:', business_id, e?.message);
    return res.status(502).json({ error: "We couldn't check your service page billing just now. Email jack@enoma.io." });
  }
}

// Stripe customer portal: update card, cancel, invoices. Members of the
// business only; the customer id comes from our database, never the browser.
async function openPortal(req, res, user, business_id) {
  const { data: membership } = await supabase
    .from('business_members').select('role')
    .eq('business_id', business_id).eq('user_id', user.id).maybeSingle();
  if (!membership) return res.status(403).json({ error: 'Not your business' });

  const { data: sub } = await supabase
    .from('subscriptions').select('stripe_customer_id')
    .eq('business_id', business_id).maybeSingle();
  if (!sub?.stripe_customer_id) {
    return res.status(404).json({ error: "There's no billing account yet. Subscribe first, or email jack@enoma.io." });
  }
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: `https://enoma.io/dashboard?business_id=${encodeURIComponent(business_id)}`,
    });
    return res.status(200).json({ url: session.url });
  } catch (e) {
    console.error('billing portal failed:', e?.message);
    return res.status(502).json({ error: "We couldn't open billing just now. Email jack@enoma.io and we'll sort it out." });
  }
}
