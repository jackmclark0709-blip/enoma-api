-- Example outreach arm (PR #134, api/_lib/example-outreach.js): first emails
-- in that arm are stored with variant 'example', so v_outreach_variant_stats
-- compares a, b and example side by side. Apply before setting
-- OUTREACH_EXAMPLE_SHARE above 0 (until then no 'example' rows are written).
alter table public.outreach_messages drop constraint if exists outreach_messages_variant_check;
alter table public.outreach_messages add constraint outreach_messages_variant_check
  check (variant in ('a', 'b', 'example'));
