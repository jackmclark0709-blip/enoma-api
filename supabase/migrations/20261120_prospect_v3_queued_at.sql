-- v3 pipeline (PR #131): when a prospect entered the v3 build path. The daily
-- cap (PAGE_V3_DAILY_MAX) counts these, so upgrades of existing previews and
-- new builds share one budget across the day's prepare_outreach runs.
alter table public.prospects add column if not exists v3_queued_at timestamptz;
create index if not exists prospects_v3_queued_at_idx on public.prospects (v3_queued_at) where v3_queued_at is not null;
