-- Cold-email A/B test (api/_lib/outreach-variant-b.js).
-- Apply BEFORE deploying the code: send_outreach writes this column and the
-- follow-up runs select it.

-- 'a' = the existing copy, 'b' = the differentiated copy (50/50 by prospect
-- id). Null = sent before the test, or a hand-edited draft sent as written;
-- both stay out of the comparison. Follow-ups use the first email's variant.
alter table outreach_messages add column if not exists variant text
  check (variant in ('a', 'b'));

create index if not exists outreach_messages_variant_idx
  on outreach_messages (variant, sent_at) where variant is not null;

-- A vs B, one row per variant, cold emails sent since the test began.
-- Real outside people only, same rules as v_outreach_funnel_daily:
--   human_opens        an open that looked like a person (human_open_likely)
--   human_clicks       emails with a human click on the tracked link
--                      (first_clicked_at counts human clicks only)
--   preview_visits     emails whose preview landing a person opened
--   replies            a reply that isn't an auto-reply (inbound capture, or
--                      response_status 'replied'); opt-out replies included
--   positive_replies   replies classified "positive" (inbound capture only)
-- Each count is per email (a row counts once however many times it happens),
-- and covers the first email and its follow-ups together, since they share
-- one message id.
create or replace view public.v_outreach_variant_stats
with (security_invoker = true) as
with m as (
  select om.*,
         exists (select 1 from outreach_replies r where r.outreach_message_id = om.id and r.intent is distinct from 'auto_reply') as has_reply_row,
         exists (select 1 from outreach_replies r where r.outreach_message_id = om.id and r.intent = 'positive') as has_positive_reply
  from outreach_messages om
  where om.channel = 'email' and om.status = 'sent' and om.variant is not null
)
select variant,
       count(*) as sent,
       count(*) filter (where delivered_at is not null) as delivered,
       count(*) filter (where followup_sent_at is not null) as followup1_sent,
       count(*) filter (where followup2_sent_at is not null) as followup2_sent,
       count(*) filter (where human_open_likely is true) as human_opens,
       count(*) filter (where first_clicked_at is not null) as human_clicks,
       count(*) filter (where preview_visited_at is not null) as preview_visits,
       count(*) filter (where response_status = 'replied' or has_reply_row) as replies,
       count(*) filter (where has_positive_reply) as positive_replies,
       count(*) filter (where response_status = 'claimed') as claims,
       count(*) filter (where response_status = 'opted_out') as opt_outs,
       count(*) filter (where response_status = 'bounced') as bounces,
       round(100.0 * count(*) filter (where human_open_likely is true) / nullif(count(*), 0), 1) as human_open_pct,
       round(100.0 * count(*) filter (where first_clicked_at is not null) / nullif(count(*), 0), 1) as human_click_pct,
       round(100.0 * count(*) filter (where response_status = 'replied' or has_reply_row) / nullif(count(*), 0), 1) as reply_pct,
       round(100.0 * count(*) filter (where response_status = 'claimed') / nullif(count(*), 0), 1) as claim_pct,
       min(sent_at) as first_sent_at,
       max(sent_at) as last_sent_at
from m
group by variant
order by variant;

-- Service role only (reports, the morning brief), like the other outreach views.
revoke all on public.v_outreach_variant_stats from anon, authenticated;
