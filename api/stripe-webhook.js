// api/stripe-webhook.js
// Handles Stripe webhook events to keep subscriptions in sync
// Events handled:
//   checkout.session.completed  → subscription created
//   customer.subscription.updated → status changes (active, past_due, etc.)
//   customer.subscription.deleted → canceled
//   invoice.payment_failed      → mark past_due

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const sig = req.headers['stripe-signature'];
  const rawBody = await getRawBody(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  try {
    switch (event.type) {

      // ── Checkout completed → subscription is live ──
      case 'checkout.session.completed': {
        const session = event.data.object;
        const business_id = session.metadata?.business_id;
        if (!business_id) break;

        const subscription = await stripe.subscriptions.retrieve(
          session.subscription
        );

        await supabase
          .from('subscriptions')
          .upsert({
            business_id,
            provider: 'stripe',
            stripe_customer_id: session.customer,
            stripe_subscription_id: subscription.id,
            plan_code: 'starter',
            status: 'active',
            is_trial: false,
            current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
            current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
            cancel_at_period_end: subscription.cancel_at_period_end,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'business_id' });

        // Make business page public
        await supabase
          .from('businesses')
          .update({ is_published: true })
          .eq('id', business_id);

        console.log(`✓ Subscription activated for business ${business_id}`);
        break;
      }

      // ── Subscription updated (renewal, plan change, cancel scheduled) ──
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const business_id = sub.metadata?.business_id;
        if (!business_id) break;

        const statusMap = {
          active: 'active',
          past_due: 'past_due',
          unpaid: 'unpaid',
          canceled: 'canceled',
          incomplete: 'incomplete',
          trialing: 'trialing',
        };

        await supabase
          .from('subscriptions')
          .update({
            status: statusMap[sub.status] || sub.status,
            stripe_subscription_id: sub.id,
            current_period_start: new Date(sub.current_period_start * 1000).toISOString(),
            current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
            cancel_at_period_end: sub.cancel_at_period_end,
            is_trial: false,
            updated_at: new Date().toISOString(),
          })
          .eq('business_id', business_id);

        // If canceled or unpaid, unpublish the page
        if (['canceled', 'unpaid'].includes(sub.status)) {
          await supabase
            .from('businesses')
            .update({ is_published: false })
            .eq('id', business_id);
        }

        console.log(`✓ Subscription updated for business ${business_id}: ${sub.status}`);
        break;
      }

      // ── Subscription canceled ──
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const business_id = sub.metadata?.business_id;
        if (!business_id) break;

        await supabase
          .from('subscriptions')
          .update({
            status: 'canceled',
            updated_at: new Date().toISOString(),
          })
          .eq('business_id', business_id);

        await supabase
          .from('businesses')
          .update({ is_published: false })
          .eq('id', business_id);

        console.log(`✓ Subscription canceled for business ${business_id}`);
        break;
      }

      // ── Payment failed ──
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const sub = await stripe.subscriptions.retrieve(invoice.subscription);
        const business_id = sub.metadata?.business_id;
        if (!business_id) break;

        await supabase
          .from('subscriptions')
          .update({
            status: 'past_due',
            updated_at: new Date().toISOString(),
          })
          .eq('business_id', business_id);

        console.log(`⚠ Payment failed for business ${business_id}`);
        break;
      }

      default:
        // Ignore unhandled event types
        break;
    }
  } catch (err) {
    console.error('Webhook handler error:', err);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }

  return res.status(200).json({ received: true });
}
