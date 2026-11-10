-- Outreach throughput + second follow-up (api/ga-metrics.js prepareOutreachOnce,
-- sendSecondFollowUpsOnce).

-- Second and last follow-up, stored on the original message row like the
-- first one (same message id in links and tags).
alter table outreach_messages add column if not exists followup2_sent_at timestamptz;
alter table outreach_messages add column if not exists followup2_message_id text;

create index if not exists outreach_messages_followup2_due_idx
  on outreach_messages (sent_at)
  where channel = 'email' and status = 'sent' and followup_sent_at is not null
    and followup2_sent_at is null and response_status is null;

-- ZeroBounce verdict saved on the prospect, so one verified in a prepare run
-- that runs out of time is built next run without paying for a second check.
alter table prospects add column if not exists mailbox_status text;
alter table prospects add column if not exists mailbox_verified_at timestamptz;

-- Pipeline alerts to Jack, at most one per key per UTC day.
create table if not exists system_alerts (
  key text primary key,
  last_sent_on date,
  last_reason text,
  updated_at timestamptz not null default now()
);
-- Service role only, like the other outreach tables.
alter table system_alerts enable row level security;
