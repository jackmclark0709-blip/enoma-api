-- Hand-sent text outreach (api/_lib/text-outreach.js).
-- text_status: null (not looked at) | ready | queued (in a batch email) |
--   reminded (in a second batch) | sent | skipped | opted_out | low_quality | no_page
alter table prospects add column if not exists text_status text;
alter table prospects add column if not exists text_quality jsonb;
alter table prospects add column if not exists text_body text;
alter table prospects add column if not exists text_queued_at timestamptz;
alter table prospects add column if not exists texted_at timestamptz;

create index if not exists prospects_text_status_idx on prospects (text_status) where texted_at is null;
