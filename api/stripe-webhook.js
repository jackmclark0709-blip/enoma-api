// api/stripe-webhook.js
// Handles Stripe webhook events to keep subscriptions in sync
// Events handled:
//   checkout.session.completed  → subscription created
//   customer.subscription.updated → status changes (active, past_due, etc.)
//   customer.subscription.deleted → canceled
//   invoice.payment_failed      → mark past_due
//
// Monthly and yearly subscriptions are stored the same way; billing_interval
// records which. A subscription started during the free month has a
// trial_end, so Stripe reports it as "trialing" until the first charge. We
// store that status as-is (with is_trial false: our own free month is
// superseded) and website_is_active treats "trialing" + a Stripe
// subscription id as live (supabase/migrations/20261110_billing_interval.sql).
//
// Service pages: the subscription can carry a second item, the $9.99/month
// add-on (enoma_spotlight_monthly, or enoma_spotlight_yearly on a yearly
// plan), quantity = published service pages. Our
// database is the source of truth: after checkout, and whenever Stripe
// reports the subscription changed (someone edited the quantity in the Stripe
// dashboard, or a page was published while the checkout was open), the
// quantity is set back to the published count (api/_lib/spotlight-billing.js).
// Comped businesses are never billed for them.

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { subscriptionFieldsFromStripe } from './_lib/billing.js';
import { syncSpotlightQuantity, spotlightItemOf } from './_lib/spotlight-billing.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Writes a subscriptions row. If the billing_interval column isn't there yet
// (migration not applied), retry without it rather than lose the event.
async function writeSubscription(fields, write) {
  let { error } = await write(fields);
  if (error && /billing_interval/.test(error.message || '')) {
    console.warn('subscriptions.billing_interval missing; apply 20261110_billing_interval.sql');
    const { billing_interval, ...rest } = fields;
    ({ error } = await write(rest));
  }
  if (error) throw error;
}

export const config = { api: { bodyParser: false } };

// Puts the service-page quantity back in line with service_spotlights. Never
// fails the webhook: a mismatch is logged and fixed on the next sync.
async function keepSpotlightQuantityInSync(business_id, stripeSub, why) {
  if (!['active', 'trialing', 'past_due'].includes(stripeSub?.status)) return;
  try {
    const r = await syncSpotlightQuantity({ stripe, supabase, businessId: business_id });
    if (r.stripeSub && r.stripeSub.id !== stripeSub.id) {
      console.warn(`[spotlight-billing] ${why}: business ${business_id} has another subscription on file (${r.stripeSub.id}); synced that one`);
    }
    if (r.op !== 'none') {
      const had = spotlightItemOf(stripeSub)?.quantity || 0;
      console.log(`[spotlight-billing] ${why}: business ${business_id} service pages ${had} -> ${r.quantity} (published: ${r.published})`);
    }
  } catch (e) {
    console.error(`[spotlight-billing] ${why}: quantity sync failed for business ${business_id}:`, e?.message || e);
  }
}

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

        // Guard: session may not have a subscription (e.g. free trial, one-time payment)
        if (!session.subscription) {
          console.log(`checkout.session.completed has no subscription for business ${business_id} — skipping subscription upsert`);
          // Still publish the page if business_id is set
          await supabase.from('businesses').update({ is_published: true }).eq('id', business_id);
          break;
        }

        const subscription = await stripe.subscriptions.retrieve(session.subscription);
        const fields = subscriptionFieldsFromStripe(subscription);

        await writeSubscription({
          business_id,
          provider: 'stripe',
          stripe_customer_id: session.customer,
          plan_code: 'starter',
          ...fields,
          // "active", or "trialing" when the first charge waits for the end
          // of the free month. Either keeps the page live.
          status: fields.status === 'trialing' ? 'trialing' : 'active',
          is_trial: false,
          updated_at: new Date().toISOString(),
        }, (row) => supabase.from('subscriptions').upsert(row, { onConflict: 'business_id' }));

        // Make business page public
        await supabase
          .from('businesses')
          .update({ is_published: true })
          .eq('id', business_id);

        await keepSpotlightQuantityInSync(business_id, subscription, 'checkout.session.completed');

        console.log(`✓ Subscription activated for business ${business_id}`);
        break;
      }

      // ── Subscription updated (renewal, plan change, cancel scheduled) ──
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const business_id = sub.metadata?.business_id;
        if (!business_id) break;

        // Stripe's status is stored as-is (active, trialing, past_due,
        // unpaid, canceled, incomplete), with the interval and period dates.
        await writeSubscription({
          ...subscriptionFieldsFromStripe(sub),
          is_trial: false,
          updated_at: new Date().toISOString(),
        }, (row) => supabase.from('subscriptions').update(row).eq('business_id', business_id));

        // If canceled or unpaid, unpublish the page
        if (['canceled', 'unpaid'].includes(sub.status)) {
          await supabase
            .from('businesses')
            .update({ is_published: false })
            .eq('id', business_id);
        }

        await keepSpotlightQuantityInSync(business_id, sub, 'customer.subscription.updated');

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
        if (!invoice.subscription) {
          console.log('invoice.payment_failed has no subscription id — skipping');
          break;
        }
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
