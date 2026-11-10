-- Yearly plan ($199/year, Stripe lookup key enoma_page_annual) alongside
-- monthly ($19.99/month). api/stripe-webhook.js stores which one a
-- subscription bills on, and the period end (for "trialing" that's the first
-- charge date).
alter table public.subscriptions
  add column if not exists billing_interval text
    check (billing_interval is null or billing_interval in ('month', 'year'));

-- Already present in production (checked 2026-11-09); kept idempotent for
-- fresh databases.
alter table public.subscriptions
  add column if not exists current_period_end timestamptz;

-- An owner who subscribes during their free month gets a Stripe trial_end
-- (first charge when the free month ends), so Stripe reports the
-- subscription as "trialing" and the webhook sets is_trial = false. Before
-- this change that row matched none of the rules below and the page went
-- offline. New rule: "trialing" with a Stripe subscription id (set up
-- through Checkout, card on file) keeps the page live. Rows that say
-- "trialing" only because of our own free month have no
-- stripe_subscription_id and still follow the trial_expires_at rule.
create or replace function public.website_is_active(p_business_id uuid)
 returns boolean
 language sql
 stable security definer
as $function$
  SELECT
    -- Rule: Jack's own internal/demo pages are always active
    COALESCE(
      (SELECT b.is_internal FROM public.businesses b WHERE b.id = p_business_id),
      false
    )
    OR EXISTS (
      SELECT 1
      FROM public.subscriptions s
      WHERE s.business_id = p_business_id
        AND (
          -- Rule: paying subscriber
          s.status = 'active'
          -- Rule: subscribed in Stripe during the free month; card on file, first charge at trial_end
          OR (s.status = 'trialing' AND s.stripe_subscription_id IS NOT NULL)
          -- Rule: payment failed but Stripe is still retrying (dunning grace period)
          OR s.status = 'past_due'
          -- Rule: canceled, but still within the period they already paid for
          OR (s.status = 'canceled' AND s.current_period_end IS NOT NULL AND s.current_period_end > now())
          -- Rule: still inside the 30-day trial window (checked by actual date, not just status label)
          OR (s.is_trial = true AND s.trial_expires_at IS NOT NULL AND s.trial_expires_at > now())
        )
    );
$function$;
