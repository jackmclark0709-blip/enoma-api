-- Comment-keyword entry (/page → /get-your-website?src=comment&ch=fb|ig&kw=…)
-- and one source label per visit / signup for the morning brief.
--
-- src/ch/kw ride along in the existing attribution JSON (no new columns):
--   funnel_events.metadata (the visit's own tags) and metadata.first_touch,
--   prospects.raw.attribution, businesses.first_touch (the claimed page's
--   signup source) and the Stripe metadata. See api/_lib/attribution.js.
--
-- public.attribution_source_label() is the SQL twin of sourceLabel() in
-- api/_lib/traffic-sources.js; tests/traffic-sources.test.js keeps them in step.
-- Needs funnel_events.traffic_class (20261112_traffic_class.sql) first.

create or replace function public.attribution_source_label(t jsonb)
returns text
language sql
immutable
as $$
  select case
    when lower(coalesce(t->>'src', '')) = 'comment' then
      case lower(coalesce(t->>'ch', ''))
        when 'fb' then 'Comment (FB)'
        when 'ig' then 'Comment (IG)'
        else 'Comment'
      end
    when coalesce(t->>'utm_source', '') <> '' then
      case
        when lower(t->>'utm_source') = 'cold_email' then 'Cold email'
        when lower(t->>'utm_source') in ('google', 'adwords', 'gads') then 'Google'
        when lower(t->>'utm_source') in ('facebook', 'fb', 'instagram', 'ig', 'meta') then 'Facebook / Instagram'
        when lower(t->>'utm_source') = 'bing' then 'Bing'
        else lower(trim(t->>'utm_source'))
      end
    when coalesce(lower(substring(t->>'referrer' from '^https?://(?:www\.)?([^/:?#]+)')), '') = '' then 'Direct'
    when lower(substring(t->>'referrer' from '^https?://(?:www\.)?([^/:?#]+)')) like '%enoma.io'
      or lower(substring(t->>'referrer' from '^https?://(?:www\.)?([^/:?#]+)')) like '%.vercel.app'
      or (t->>'referrer') ~* '^https?://(localhost|127\.0\.0\.1)' then 'Direct'
    when (t->>'referrer') ~* '^https?://([^/]+\.)?google\.' then 'Google'
    when (t->>'referrer') ~* '^https?://([^/]+\.)?(facebook\.com|fb\.com|instagram\.com)([/:?#]|$)' then 'Facebook / Instagram'
    when (t->>'referrer') ~* '^https?://([^/]+\.)?bing\.com([/:?#]|$)' then 'Bing'
    else lower(substring(t->>'referrer' from '^https?://(?:www\.)?([^/:?#]+)'))
  end
$$;

-- The source of one funnel_events row: the visit's own comment tag wins over
-- the browser's stored first touch (funnelSourceLabel in traffic-sources.js).
create or replace function public.funnel_source_label(meta jsonb)
returns text
language sql
immutable
as $$
  select case
    when lower(coalesce(meta->>'src', '')) = 'comment' then public.attribution_source_label(meta)
    else public.attribution_source_label(coalesce(meta->'first_touch', meta))
  end
$$;

-- ── Traffic by source (human visitors only) ────────────────────────────────
-- One row per Eastern day and source: people who opened /get-your-website,
-- started an instant preview, and claimed a page. Internal devices
-- (?internal=1 / /internal-optout), crawlers and scanners are excluded by
-- traffic_class.
create or replace view public.v_funnel_sources_daily as
select (e.created_at at time zone 'America/New_York')::date as day,
       public.funnel_source_label(e.metadata) as source,
       count(distinct e.anon_id) filter (where e.event = 'gyw_viewed') as visitors,
       count(*) filter (where e.event = 'instant_preview_started') as previews_started,
       count(*) filter (where e.event = 'business_claimed') as claims
from funnel_events e
where e.traffic_class = 'human'
group by 1, 2
order by 1 desc, 3 desc;

-- ── Signups by source ──────────────────────────────────────────────────────
-- Every claimed page with its signup source (businesses.first_touch), and
-- whether it has a Stripe subscription (website_is_active's paying rules). Internal businesses are left out.
create or replace view public.v_signups_by_source as
select b.id as business_id,
       b.slug,
       b.name,
       (b.created_at at time zone 'America/New_York')::date as created_day,
       public.attribution_source_label(b.first_touch) as source,
       b.first_touch->>'kw' as keyword,
       exists (
         select 1 from subscriptions s
         where s.business_id = b.id
           and (s.status = 'active' or (s.status = 'trialing' and s.stripe_subscription_id is not null))
       ) as paying
from businesses b
join small_business_profiles p on p.business_id = b.id and p.is_claimed
where coalesce(b.is_internal, false) = false;

revoke all on public.v_funnel_sources_daily from anon, authenticated;
revoke all on public.v_signups_by_source from anon, authenticated;
