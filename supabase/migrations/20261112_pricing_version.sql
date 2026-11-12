-- $1 first month (pricing v2). New signups get pricing_version 'v2_1dollar'
-- on their subscriptions row (api/_lib/pricing.js). Existing rows stay NULL
-- and keep their current terms: the no-card free month, or whatever they
-- already pay. Nothing here changes an existing row.
--
-- v2 rules (api/_lib/pricing.js):
--   - The preview (search, generated page, editing, claiming) is free, no card.
--   - Going live (shown to Google, listed in the sitemap, kept up after the
--     preview window) needs Stripe Checkout: $1 today, then $19.99/month or
--     $199/year starting 30 days later.
alter table public.subscriptions
  add column if not exists pricing_version text
    check (pricing_version is null or pricing_version in ('v2_1dollar'));

-- Two more emails ride the existing reminder table and cron
-- (api/ga-metrics.js?action=trial_reminders), once per business each:
--   charge_3d   3 days before the first full charge of a v2 subscription
--   first_paid  confirmation after the $1 charge (sent by the Stripe webhook)
alter table public.trial_reminders drop constraint if exists trial_reminders_kind_check;
alter table public.trial_reminders
  add constraint trial_reminders_kind_check
    check (kind in ('7d', '1d', 'ended', 'charge_3d', 'first_paid'));
