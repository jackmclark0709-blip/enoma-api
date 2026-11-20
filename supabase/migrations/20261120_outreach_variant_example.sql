-- Example outreach arm (PR #134, api/_lib/example-outreach.js). Apply before
-- setting OUTREACH_EXAMPLE_SHARE above 0.
--
-- 1. First emails in that arm are stored with variant 'example', so
--    v_outreach_variant_stats compares a, b and example side by side.
alter table public.outreach_messages drop constraint if exists outreach_messages_variant_check;
alter table public.outreach_messages add constraint outreach_messages_variant_check
  check (variant in ('a', 'b', 'example'));

-- 2. The arm a prospect was drafted in ('example' or 'personal'), stamped by
--    prepare_outreach, so send_outreach sends an example email only to
--    prospects drafted for one (not, say, a hand-made draft with no page).
alter table public.prospects add column if not exists outreach_arm text
  check (outreach_arm in ('example', 'personal'));
