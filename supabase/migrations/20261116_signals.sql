-- One ledger for every buying signal from a real person, and the automated
-- follow-ups it schedules (api/_lib/signals.js, api/_lib/followup-rules.js,
-- api/_lib/signal-store.js). Every signal is recorded once (dedupe_key) and
-- ends up followed up automatically, queued for Jack, or closed with a reason.
--
-- signals.state:
--   new                       recorded, nothing decided yet (or record-only)
--   auto_followup_scheduled   followup_sends rows are waiting in the queue
--   auto_followup_sent        at least one automated follow-up went out
--   queued_for_jack           needs a human (Jack got a HOT alert)
--   handled                   a reply, claim or checkout followed, or Jack marked it
--   closed                    unsubscribe/bounce/complaint, or 14 days of silence
--                             after the last automated touch (closed_reason)

create table if not exists signals (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  type text not null check (type in (
    'email_click', 'preview_visit', 'repeat_visit', 'preview_started_no_email',
    'preview_no_claim', 'claim_no_checkout', 'checkout_abandoned', 'email_reply',
    'unsubscribe', 'bounce', 'complaint', 'fb_message', 'fb_comment',
    'payment_failed', 'subscription_canceled'
  )),
  prospect_id uuid references prospects(id) on delete set null,
  business_id uuid references businesses(id) on delete set null,
  outreach_message_id uuid references outreach_messages(id) on delete set null,
  email text,
  source text not null check (source in ('resend', 'track', 'stripe', 'manychat', 'meta', 'manual')),
  traffic_class text,
  payload jsonb not null default '{}'::jsonb,
  state text not null default 'new' check (state in (
    'new', 'auto_followup_scheduled', 'auto_followup_sent', 'queued_for_jack', 'handled', 'closed'
  )),
  closed_reason text,
  handled_at timestamptz,
  updated_at timestamptz not null default now(),
  dedupe_key text not null unique
);

create index if not exists signals_open_idx on signals (created_at) where state not in ('handled', 'closed');
create index if not exists signals_email_idx on signals (lower(email));
create index if not exists signals_prospect_idx on signals (prospect_id);
create index if not exists signals_business_idx on signals (business_id);

create table if not exists followup_sends (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  signal_id uuid not null references signals(id) on delete cascade,
  recipient text not null,
  template text not null,
  step int not null default 1,
  scheduled_for timestamptz not null,
  sent_at timestamptz,
  resend_id text,
  status text not null default 'scheduled' check (status in ('scheduled', 'sending', 'sent', 'cancelled', 'suppressed')),
  cancel_reason text,
  -- dry_run: what would have gone out, so Jack can read it before going live.
  rendered_subject text,
  rendered_text text,
  dry_run boolean not null default false,
  -- dry_run rows are judged once when due: would_send or would_cancel:<reason>.
  decision text,
  decided_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (signal_id, step)
);

create index if not exists followup_sends_due_idx on followup_sends (scheduled_for) where status = 'scheduled';
create index if not exists followup_sends_recipient_idx on followup_sends (lower(recipient));

-- HOT alert rate limit: one per prospect (or email/business) per type per day.
create table if not exists signal_alerts (
  alert_key text primary key,
  signal_id uuid references signals(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Service role only, like prospects and outreach_messages.
alter table signals enable row level security;
alter table followup_sends enable row level security;
alter table signal_alerts enable row level security;

-- Open signals, oldest first, with the business name when there is one.
create or replace view v_open_signals with (security_invoker = true) as
select
  s.id, s.created_at, s.type, s.state, s.source, s.email,
  coalesce(sbp.business_name, b.name, p.business_name, s.payload->>'business_name') as business_name,
  s.prospect_id, s.business_id, s.outreach_message_id, s.payload,
  now() - s.created_at as age
from signals s
left join prospects p on p.id = s.prospect_id
left join businesses b on b.id = coalesce(s.business_id, p.preview_business_id)
left join small_business_profiles sbp on sbp.business_id = coalesce(s.business_id, p.preview_business_id)
where s.state not in ('handled', 'closed')
order by s.created_at asc;
