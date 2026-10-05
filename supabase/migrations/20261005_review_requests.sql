-- Review requests: a business owner asks a past customer for a Google review.
-- One row per request. The row id doubles as the tracking token in the
-- email link (enoma.io/r/<id>), so clicks can be counted before we
-- forward the customer to Google's "write a review" screen.

create table if not exists public.review_requests (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references public.businesses(id) on delete cascade,
  customer_name    text,
  customer_email   text,
  customer_phone   text,
  channel          text not null default 'email' check (channel in ('email', 'sms')),
  status           text not null default 'queued'
                   check (status in ('queued', 'sent', 'clicked', 'failed')),
  error            text,
  sent_at          timestamptz,
  clicked_at       timestamptz,
  reminder_sent_at timestamptz,
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint review_requests_has_contact
    check (customer_email is not null or customer_phone is not null)
);

-- Dashboard list + daily cap lookups.
create index if not exists review_requests_business_created_idx
  on public.review_requests (business_id, created_at desc);

-- "Don't ask the same customer twice in 30 days" lookup (emails are stored lowercased).
create index if not exists review_requests_business_email_idx
  on public.review_requests (business_id, customer_email)
  where customer_email is not null;

-- The daily reminder cron only scans requests that are still waiting.
create index if not exists review_requests_reminder_due_idx
  on public.review_requests (sent_at)
  where status = 'sent' and reminder_sent_at is null;

-- Writes only happen server-side (service role bypasses RLS), so they go
-- through the API's rate limits. Owners may read their own rows directly.
alter table public.review_requests enable row level security;

drop policy if exists "members read own review requests" on public.review_requests;
create policy "members read own review requests"
  on public.review_requests for select
  to authenticated
  using (
    exists (
      select 1 from public.business_members bm
      where bm.business_id = review_requests.business_id
        and bm.user_id = auth.uid()
    )
  );
