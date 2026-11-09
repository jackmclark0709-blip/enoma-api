-- Free-month reminder emails (api/_lib/trial-reminders.js, sent by
-- api/ga-metrics.js?action=trial_reminders). One row per reminder actually
-- attempted; the cron inserts the row before sending, so the unique
-- (business_id, kind) means a business never gets the same reminder twice.
--   7d     6–7 days before the free month ends
--   1d     under 36 hours before it ends
--   ended  first run after it ends (only pages that turn off)
create table if not exists trial_reminders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  kind text not null check (kind in ('7d', '1d', 'ended')),
  sent_at timestamptz default now(),
  resend_id text,
  unique (business_id, kind)
);

-- Service role only, like prospects, outreach_messages and visit_followups.
alter table trial_reminders enable row level security;
