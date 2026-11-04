// api/create-checkout.js
// Creates a Stripe Checkout session for the monthly lead-page subscription.
// Prices come from Stripe by lookup key (data/plans.mjs): enoma_page_monthly
// ($19.99), or enoma_page_partner_monthly ($9.99) when the business was
// referred by a partner with partner_pricing on. STRIPE_MONTHLY_PRICE_ID is
// only a fallback if the lookup key isn't found.
// Called from dashboard when user clicks "Subscribe".
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
import { PLANS, LOOKUP_KEYS, pageLookupKeyFor } from '../data/plans.mjs';

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
    .select('status, stripe_subscription_id, stripe_customer_id')
    .eq('business_id', business_id)
    .maybeSingle();

  if (existingSub?.status === 'active') {
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

  // Pick the price: partner or standard, by lookup key.
  const lookupKey = pageLookupKeyFor(await referrerFor(business_id));
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

  // Create Checkout session
  const session = await stripe.checkout.sessions.create({
    customer: stripeCustomerId,
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    subscription_data: {
      metadata: {
        business_id,
        supabase_user_id: user.id,
        lookup_key: lookupKey,
      },
    },
    success_url: `https://enoma.io/dashboard?subscribed=1&business_id=${business_id}`,
    cancel_url: `https://enoma.io/dashboard?business_id=${business_id}`,
    metadata: {
      business_id,
      supabase_user_id: user.id,
    },
  });

  return res.status(200).json({ url: session.url });
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
