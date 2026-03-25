// api/create-checkout.js
// Creates a Stripe Checkout session for $19.99/mo subscription
// Called from dashboard when user clicks "Subscribe"

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

  const { business_id } = req.body;
  if (!business_id) return res.status(400).json({ error: 'business_id required' });

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
    .select('status, stripe_subscription_id')
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
        price: process.env.STRIPE_PRICE_ID,
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
