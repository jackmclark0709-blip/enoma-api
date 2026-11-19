-- Website v3 PR C: the one service page that comes with the website
-- (api/_lib/service-page-v3.js). Additive; existing rows become 'manual'.
--   source       'manual' = the owner's intake form (13-question gap check)
--                'auto'   = drafted from page_copy_v3.service_page (no gap check)
--   approved_at  the owner approved the auto page in the owner bar; it is
--                published when the business goes live (Stripe webhook).
alter table public.service_spotlights
  add column if not exists source text not null default 'manual',
  add column if not exists approved_at timestamptz;

do $$ begin
  alter table public.service_spotlights
    add constraint service_spotlights_source_check check (source in ('manual', 'auto'));
exception when duplicate_object then null; end $$;

-- At most one auto service page per business.
create unique index if not exists service_spotlights_one_auto_per_business
  on public.service_spotlights (business_id) where source = 'auto';
