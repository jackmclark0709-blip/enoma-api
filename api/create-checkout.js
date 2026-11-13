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
//
// Pricing v2 ($1 first month, api/_lib/pricing.js): accounts with
// subscriptions.pricing_version = 'v2_1dollar' that have never subscribed get
// a one-time $1 line item today and the plan on a trial ending 23:59 Eastern
// on the 30th calendar day (Checkout shows "30 days free"). The session
// itself is built in api/_lib/page-checkout.js (shared with Jack's
// "send checkout link" in api/ga-metrics.js).
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
import { PLANS } from '../data/plans.mjs';
import { normalizeInterval, checkoutPlanFor, pageItemOf, spotlightLookupKeyFor } from './_lib/billing.js';
import {
  loadSpotlightBillingState, spotlightBilling, syncSpotlightQuantity,
  billingSummary, spotlightItemOf,
} from './_lib/spotlight-billing.js';
import { logFunnelEvent } from './_lib/tracking.js';
import { createPageCheckoutSession, pricesByLookupKey as livePrices, referrerFor as referrerOf } from './_lib/page-checkout.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const pricesByLookupKey = () => livePrices(stripe);
const referrerFor = (business_id) => referrerOf(supabase, business_id);

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

  const result = await createPageCheckoutSession({
    stripe, supabase, businessId: business_id, interval,
    customer: { email: user.email, userId: user.id }, source: 'dashboard',
  });
  if (result.status !== 200) return res.status(result.status).json({ error: result.error });

  await logFunnelEvent(supabase, req, {
    event: 'checkout_started', businessId: business_id, anonId: req.body?.anon_id,
    metadata: {
      interval: result.plan.interval, lookup_key: result.plan.lookupKey,
      pricing_version: result.plan.pricingVersion || 'v1', first_month_fee: !!result.plan.firstMonthFee,
      source: 'dashboard', ...result.utm,
    }
  });

  return res.status(200).json({ url: result.url });
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
