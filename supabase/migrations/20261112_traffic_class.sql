-- Traffic hygiene: every tracked event gets a traffic_class so engagement
-- numbers count real outside people only. See api/_lib/traffic-classifier.js
-- (the rules) and api/_lib/traffic-ranges.js (the IP ranges).
--   internal | crawler | link_scanner | social_preview | human
-- Raw events are never deleted; reports read the views below.
-- Run scripts/backfill-traffic-class.sql once after this migration.

-- ── Columns ────────────────────────────────────────────────────────────────
alter table page_events add column if not exists traffic_class text
  check (traffic_class in ('internal', 'crawler', 'link_scanner', 'social_preview', 'human'));
alter table funnel_events add column if not exists traffic_class text
  check (traffic_class in ('internal', 'crawler', 'link_scanner', 'social_preview', 'human'));
-- funnel_events had no IP, so old rows can only be classified by user agent.
alter table funnel_events add column if not exists ip text;

create index if not exists page_events_traffic_class_idx on page_events (traffic_class, created_at);
create index if not exists funnel_events_traffic_class_idx on funnel_events (traffic_class, created_at);
create index if not exists page_events_message_idx on page_events ((metadata->>'m')) where metadata ? 'm';

-- Outreach counters: first_clicked_at, click_count and preview_visited_at now
-- count human clicks only; scanners are counted here instead.
alter table outreach_messages add column if not exists scanner_click_count integer not null default 0;
-- Opens are a weak signal (Apple Mail Privacy Protection preloads every
-- image; scanners fetch the pixel on arrival). true once an open looked like
-- a person, false while every open so far came from a proxy or scanner,
-- null when Resend's open event carried no IP/user agent to judge.
alter table outreach_messages add column if not exists human_open_likely boolean;

-- ── Classifier (SQL twin of classifyTraffic, used by the backfill) ─────────
-- Keep in step with api/_lib/traffic-classifier.js + traffic-ranges.js;
-- tests/traffic-sql-sync.test.js checks every range and the UA regex match.
create or replace function public.traffic_class_for(
  p_ip text,
  p_user_agent text,
  p_event text,
  p_has_message boolean default false,
  p_since_send interval default null,
  p_burst boolean default false,
  p_internal boolean default false,
  p_internal_ips text[] default array['173.48.250.211', '71.248.173.98', '75.69.76.70']
) returns text
language plpgsql immutable
as $$
declare
  ip text := btrim(split_part(coalesce(p_ip, ''), ',', 1));
  ua text := coalesce(p_user_agent, '');
  addr inet;
begin
  if ip ilike '::ffff:%.%' then ip := substr(ip, 8); end if;
  if ip ~ '^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$' then
    begin addr := ip::inet; exception when others then addr := null; end;
  end if;

  if p_internal then return 'internal'; end if;
  if ip <> '' and exists (
    select 1 from unnest(p_internal_ips) e
    where e = ip or (addr is not null and position('/' in e) > 0 and addr <<= e::inet)
  ) then return 'internal'; end if;

  if btrim(ua) = '' then return 'crawler'; end if;
  if ua ~* 'bot|crawl|spider|slurp|headless|lighthouse|python|curl|wget|go-http|axios|node-fetch|stripe|facebookexternalhit|meta-externalagent|googlebot|google-inspectiontool|googleother|bingbot|yelpbot|lightpanda' then
    return 'crawler';
  end if;
  -- Googlebot
  if addr <<= any (array['66.249.64.0/19']::inet[]) then return 'crawler'; end if;
  -- Meta link previews
  if addr <<= any (array['31.13.0.0/16', '66.220.0.0/16', '69.63.0.0/16', '69.171.0.0/16', '129.134.0.0/16', '157.240.0.0/16', '173.252.0.0/16']::inet[]) then
    return 'social_preview';
  end if;
  -- Microsoft / Azure (Safe Links, Defender)
  if addr <<= any (array['72.152.0.0/14', '74.176.0.0/14', '135.224.0.0/12', '4.0.0.0/8', '13.0.0.0/8', '20.0.0.0/8', '40.0.0.0/8', '52.0.0.0/8']::inet[]) then
    return 'link_scanner';
  end if;
  if p_has_message or p_event in ('outreach_page_click', 'outreach_claim_click') then
    -- AWS / GCP
    if addr <<= any (array['3.0.0.0/8', '18.0.0.0/8', '44.192.0.0/10', '54.0.0.0/8', '34.0.0.0/8', '35.0.0.0/8']::inet[]) then
      return 'link_scanner';
    end if;
    if p_since_send is not null and p_since_send >= interval '0' and p_since_send < interval '120 seconds' then
      return 'link_scanner';
    end if;
    if p_burst then return 'link_scanner'; end if;
  end if;
  -- AWS / GCP / Tencent / mainland China on ordinary page views
  if addr <<= any (array['3.0.0.0/8', '18.0.0.0/8', '44.192.0.0/10', '54.0.0.0/8', '34.0.0.0/8', '35.0.0.0/8', '43.128.0.0/10', '150.109.0.0/16', '183.0.0.0/8']::inet[]) then
    return 'crawler';
  end if;
  return 'human';
end;
$$;

-- ── Reporting views ────────────────────────────────────────────────────────
-- Real outside people only. Read this, not page_events, for engagement.
create or replace view public.v_human_page_events
with (security_invoker = true) as
select *
from page_events
where traffic_class = 'human' and coalesce(is_internal, false) = false;

-- Cold-email funnel by day (America/New_York). sent/delivered are first
-- emails by send day; followups_sent counts both follow-ups. Clicks and
-- visits come from the tracked /go links (page_events), split into human and
-- scanner; human_preview_visits = distinct emails with a human visit.
create or replace view public.v_outreach_funnel_daily
with (security_invoker = true) as
with days as (
  select generate_series(
    (select min((sent_at at time zone 'America/New_York')::date) from outreach_messages where sent_at is not null),
    (now() at time zone 'America/New_York')::date,
    interval '1 day'
  )::date as day
),
sent as (
  select (sent_at at time zone 'America/New_York')::date as day,
         count(*) as sent,
         count(*) filter (where delivered_at is not null) as delivered
  from outreach_messages where channel = 'email' and sent_at is not null group by 1
),
followups as (
  select (t at time zone 'America/New_York')::date as day, count(*) as followups_sent
  from outreach_messages, unnest(array[followup_sent_at, followup2_sent_at]) t
  where channel = 'email' and t is not null group by 1
),
clicks as (
  select (created_at at time zone 'America/New_York')::date as day,
         count(*) filter (where traffic_class = 'human' and not coalesce(is_internal, false)) as human_clicks,
         count(*) filter (where traffic_class in ('link_scanner', 'crawler', 'social_preview')) as scanner_clicks
  from page_events where event in ('outreach_page_click', 'outreach_claim_click') group by 1
),
visits as (
  select (created_at at time zone 'America/New_York')::date as day,
         count(distinct metadata->>'m') as human_preview_visits
  from page_events
  where metadata ? 'm' and traffic_class = 'human' and not coalesce(is_internal, false)
    and event in ('outreach_page_click', 'landing_view', 'page_view')
  group by 1
),
claims as (
  select (response_at at time zone 'America/New_York')::date as day, count(*) as claims
  from outreach_messages where response_status = 'claimed' group by 1
),
replies as (
  select (received_at at time zone 'America/New_York')::date as day, count(*) as replies
  from outreach_replies where outreach_message_id is not null group by 1
),
bounces as (
  select (response_at at time zone 'America/New_York')::date as day, count(*) as bounces
  from outreach_messages where response_status = 'bounced' group by 1
)
select d.day,
       coalesce(s.sent, 0) as sent,
       coalesce(s.delivered, 0) as delivered,
       coalesce(f.followups_sent, 0) as followups_sent,
       coalesce(c.human_clicks, 0) as human_clicks,
       coalesce(c.scanner_clicks, 0) as scanner_clicks,
       coalesce(v.human_preview_visits, 0) as human_preview_visits,
       coalesce(cl.claims, 0) as claims,
       coalesce(r.replies, 0) as replies,
       coalesce(b.bounces, 0) as bounces
from days d
left join sent s using (day)
left join followups f using (day)
left join clicks c using (day)
left join visits v using (day)
left join claims cl using (day)
left join replies r using (day)
left join bounces b using (day)
order by d.day desc;

-- Both views are for the service role (reports, the brief); owners keep
-- reading their own numbers through daily_metrics / page_events RLS.
revoke all on public.v_human_page_events from anon, authenticated;
revoke all on public.v_outreach_funnel_daily from anon, authenticated;

-- ── daily_metrics / top_sources_daily ──────────────────────────────────────
-- The nightly rollup-daily-metrics cron has failed every night: it called
-- rollup_daily_metrics(CURRENT_DATE - INTERVAL '1 day') (a timestamp, the
-- function takes a date) and the function read the old `events` table. Both
-- now come from human page views only, so the owner dashboard shows people.
create or replace function public.rollup_daily_metrics(p_day date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into daily_metrics (business_id, day, page_views, contact_clicks, phone_clicks, email_clicks, website_clicks, directions_clicks)
  select b.id, p_day,
    count(*) filter (where e.event = 'page_view'),
    count(*) filter (where e.event = 'contact_click' or e.event like 'cta_click%'),
    count(*) filter (where e.event = 'cta_click_phone' or (e.event = 'contact_click' and e.metadata->>'type' in ('call', 'phone', 'mobile_bar_call'))),
    count(*) filter (where e.event = 'cta_click_email' or (e.event = 'contact_click' and e.metadata->>'type' = 'email')),
    count(*) filter (where e.event = 'cta_click_website' or (e.event = 'contact_click' and e.metadata->>'type' = 'website')),
    count(*) filter (where e.event = 'cta_click_directions' or (e.event = 'contact_click' and e.metadata->>'type' = 'directions'))
  from v_human_page_events e
  join businesses b on b.slug = e.slug
  where (e.created_at at time zone 'America/New_York')::date = p_day
  group by b.id
  on conflict (business_id, day) do update set
    page_views = excluded.page_views,
    contact_clicks = excluded.contact_clicks,
    phone_clicks = excluded.phone_clicks,
    email_clicks = excluded.email_clicks,
    website_clicks = excluded.website_clicks,
    directions_clicks = excluded.directions_clicks,
    updated_at = now();

  delete from top_sources_daily where day = p_day;
  insert into top_sources_daily (business_id, day, source, visits)
  select b.id, p_day, src, count(*)
  from (
    select e.slug,
      case
        when e.metadata ? 'm' then 'Enoma email'
        when coalesce(e.referrer, '') = '' then 'Direct'
        -- our own pages and preview deployments aren't a source
        when lower(substring(e.referrer from '^https?://(?:www\.)?([^/:?#]+)')) like '%enoma.io'
          or lower(substring(e.referrer from '^https?://(?:www\.)?([^/:?#]+)')) like '%.vercel.app'
          or e.referrer ~* '^https?://(localhost|127\.0\.0\.1)' then 'Direct'
        when e.referrer ~* '^https?://([^/]+\.)?google\.' then 'Google'
        when e.referrer ~* '^https?://([^/]+\.)?(facebook\.com|fb\.com|m\.facebook\.com|l\.facebook\.com|instagram\.com)' then 'Facebook / Instagram'
        when e.referrer ~* '^https?://([^/]+\.)?bing\.com' then 'Bing'
        else lower(substring(e.referrer from '^https?://(?:www\.)?([^/:?#]+)'))
      end as src
    from v_human_page_events e
    where e.event = 'page_view' and (e.created_at at time zone 'America/New_York')::date = p_day
  ) s
  join businesses b on b.slug = s.slug
  group by b.id, src;
end;
$$;

-- Re-schedule with a date argument, an hour after midnight Eastern.
select cron.unschedule('rollup-daily-metrics') where exists (select 1 from cron.job where jobname = 'rollup-daily-metrics');
select cron.schedule('rollup-daily-metrics', '15 6 * * *',
  $$select public.rollup_daily_metrics(((now() at time zone 'America/New_York')::date - 1))$$);
