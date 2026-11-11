-- One-off backfill for supabase/migrations/20261112_traffic_class.sql.
-- Run once, after that migration, in the Supabase SQL editor. Safe to re-run
-- (it recomputes from raw events). Deletes nothing from page_events or
-- funnel_events; the outreach counters it rewrites are backed up first.
--
-- Same rules as api/_lib/traffic-classifier.js: IP + user agent via
-- public.traffic_class_for(), plus the outreach timing rules (event < 120 s
-- after the email/follow-up was sent or delivered; two events for the same
-- email within 2 s; a view from the same IP within 10 min of a scanner's
-- click). Unlike the live path, a 2 s burst marks both events, since the
-- backfill can see the later one.

begin;

-- 0. Before
select 'before' as phase, case when is_internal then 'internal' when metadata->>'likely_scanner' = 'true' then 'likely_scanner' else 'unflagged' end as class, count(*)
from page_events where created_at > now() - interval '30 days' group by 1, 2 order by 3 desc;

-- 1. page_events
with pe as (
  select e.id, e.ip, e.user_agent, e.event, e.created_at, coalesce(e.is_internal, false) as is_internal,
         case when e.metadata->>'m' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (e.metadata->>'m')::uuid end as m
  from page_events e
),
timed as (
  select pe.*,
    om.id is not null as has_message,
    pe.created_at - (
      select max(t) from unnest(array[om.sent_at, om.delivered_at, om.followup_sent_at, om.followup2_sent_at]) t where t <= pe.created_at
    ) as since_send,
    exists (
      select 1 from pe o
      where pe.m is not null and o.m = pe.m and o.id <> pe.id
        and abs(extract(epoch from o.created_at - pe.created_at)) < 2
        and (o.event = pe.event or (o.event in ('outreach_page_click', 'outreach_claim_click') and pe.event in ('outreach_page_click', 'outreach_claim_click')))
    ) as burst
  from pe left join outreach_messages om on om.id = pe.m
),
base as (
  select t.*, public.traffic_class_for(t.ip, t.user_agent, t.event, t.has_message, t.since_send, t.burst, t.is_internal) as cls
  from timed t
),
final as (
  select b.id,
    case when b.cls = 'human' and b.has_message and exists (
      select 1 from base p
      where p.m = b.m and p.ip = b.ip and p.cls = 'link_scanner'
        and p.created_at < b.created_at and b.created_at - p.created_at < interval '10 minutes'
    ) then 'link_scanner' else b.cls end as cls
  from base b
)
update page_events e
set traffic_class = f.cls,
    is_internal = (f.cls = 'internal') or coalesce(e.is_internal, false)
from final f
where f.id = e.id and e.traffic_class is distinct from f.cls;

-- 2. funnel_events (no IP stored before this change: user agent + internal only)
update funnel_events
set traffic_class = public.traffic_class_for(ip, user_agent, event, false, null, false, coalesce(metadata->>'internal', '') = 'true')
where traffic_class is null;

-- 3. outreach_messages counters, rebuilt from the tracked /go clicks.
--    The originals are kept in outreach_click_backup_20261112.
create table if not exists outreach_click_backup_20261112 as
select id, first_clicked_at, click_count, preview_visited_at, now() as backed_up_at
from outreach_messages where click_count > 0 or preview_visited_at is not null or first_clicked_at is not null;

with c as (
  select (metadata->>'m')::uuid as id,
    count(*) filter (where traffic_class = 'human') as human_clicks,
    count(*) filter (where traffic_class in ('link_scanner', 'crawler', 'social_preview')) as scanner_clicks,
    min(created_at) filter (where traffic_class = 'human') as first_human_click
  from page_events
  where event in ('outreach_page_click', 'outreach_claim_click')
    and metadata->>'m' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  group by 1
)
update outreach_messages om
set click_count = c.human_clicks,
    scanner_click_count = c.scanner_clicks,
    first_clicked_at = c.first_human_click,
    preview_visited_at = c.first_human_click,
    updated_at = now()
from c
where c.id = om.id;

-- Clicks Resend recorded for emails with no tracked /go click at all are
-- left as they were (nothing to classify them with).

-- 4. After
select 'after' as phase, traffic_class as class, count(*)
from page_events where created_at > now() - interval '30 days' group by 1, 2 order by 3 desc;

select count(*) filter (where click_count > 0) as emails_with_human_clicks,
       count(*) filter (where scanner_click_count > 0) as emails_with_scanner_clicks
from outreach_messages where sent_at > now() - interval '30 days';

commit;
