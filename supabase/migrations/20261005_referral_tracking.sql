-- Referral tracking.
--
-- A referrer (a happy customer like Conway's, or a partner like a supply yard
-- or insurance agent) gets a link such as https://enoma.io/?ref=conways.
-- public/scripts/ref-capture.js stores the code in a first-party cookie for
-- 90 days (first touch wins); api/_lib/referral.js reads it when a business
-- is created or a preview page is claimed and stamps businesses.referred_by.
-- Payouts stay manual: referral_signups shows each referred business and its
-- subscription state, referral_summary rolls that up per referrer.

create table if not exists public.referrers (
  code          text primary key check (code ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  name          text not null,
  kind          text not null check (kind in ('customer', 'partner')),
  contact_email text,
  reward_note   text,          -- e.g. 'free month each side' or '20% for 12 months'
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- Service role only: no policies means anon/authenticated get nothing.
alter table public.referrers enable row level security;
revoke all on public.referrers from anon, authenticated;

alter table public.businesses
  add column if not exists referred_by text references public.referrers(code),
  add column if not exists referred_at timestamptz;

create index if not exists businesses_referred_by_idx
  on public.businesses (referred_by) where referred_by is not null;

create or replace view public.referral_signups
with (security_invoker = true) as
select
  r.code                 as referrer_code,
  r.name                 as referrer_name,
  r.kind                 as referrer_kind,
  b.id                   as business_id,
  b.name                 as business_name,
  b.slug,
  b.referred_at,
  s.status               as subscription_status,
  coalesce(s.is_trial, true) as is_trial,
  s.current_period_start,
  s.current_period_end,
  (s.status = 'active' and not coalesce(s.is_trial, true)) as is_paying
from public.businesses b
join public.referrers r on r.code = b.referred_by
left join public.subscriptions s on s.business_id = b.id;

create or replace view public.referral_summary
with (security_invoker = true) as
select
  r.code, r.name, r.kind, r.reward_note, r.active,
  count(rs.business_id)                          as signups,
  count(rs.business_id) filter (where rs.is_paying) as paying
from public.referrers r
left join public.referral_signups rs on rs.referrer_code = r.code
group by r.code, r.name, r.kind, r.reward_note, r.active;

revoke all on public.referral_signups, public.referral_summary from anon, authenticated;

insert into public.referrers (code, name, kind, reward_note)
values ('conways', 'Conway''s Landscaping', 'customer', 'Free month for both sides per paying referral')
on conflict (code) do nothing;
