// api/create-checkout.js
// Creates a Stripe Checkout session for the monthly subscription ($19.99/mo:
// keeps the page live after the free month, with personalized support).
// The amount lives on the Stripe Price referenced by STRIPE_MONTHLY_PRICE_ID.
// Until that env var is set, checkout is refused so nobody is charged an old
// price (STRIPE_PRICE_ID was the $49 price).
// Called from dashboard when user clicks "Subscribe".
//
// action: "portal" (body) opens the Stripe customer portal instead, so an
// owner can update their card, cancel, or download invoices. The portal has
// to be enabled once in Stripe (Settings → Billing → Customer portal).

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
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

  if (!process.env.STRIPE_MONTHLY_PRICE_ID) {
    return res.status(503).json({ error: 'Subscriptions are opening shortly. Email jack@enoma.io and we\'ll keep your page live in the meantime.' });
  }

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

  // Create Checkout session
  const session = await stripe.checkout.sessions.create({
    customer: stripeCustomerId,
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [
      {
        price: process.env.STRIPE_MONTHLY_PRICE_ID,
        quantity: 1,
      },
    ],
    subscription_data: {
      metadata: {
        business_id,
        supabase_user_id: user.id,
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
