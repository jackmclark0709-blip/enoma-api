-- One personal follow-up per prospect, ever, after a real preview visit
-- (api/_lib/visit-followup.js, api/ga-metrics.js). Every first real visit from
-- a cold email gets a row, including the ones the guardrails block, so the
-- morning brief can count triggers, approvals and sends.
--   pending  → waiting on Jack's one-tap approval
--   sent     → scheduled with Resend (scheduled_for) and accepted
--   skipped  → Jack tapped Skip
--   blocked  → a guardrail stopped it (block_reason)
--   expired  → approval came more than 3 days after the visit
create table if not exists visit_followups (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null unique references prospects(id) on delete cascade,
  outreach_message_id uuid references outreach_messages(id) on delete set null,
  visited_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'skipped', 'blocked', 'expired')),
  block_reason text,
  decided_at timestamptz,
  scheduled_for timestamptz,
  resend_email_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists visit_followups_created_idx on visit_followups (created_at);

-- Service role only, like prospects and outreach_messages.
alter table visit_followups enable row level security;
