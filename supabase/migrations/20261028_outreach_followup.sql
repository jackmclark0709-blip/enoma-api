-- One automatic follow-up per cold email, 3-4 days later (api/ga-metrics.js
-- sendFollowUpsOnce). Stored on the original message row: the follow-up uses
-- the same message id in its links and tags, so its opens/clicks/replies land
-- on the same row as the first email.
alter table outreach_messages add column if not exists followup_sent_at timestamptz;
alter table outreach_messages add column if not exists followup_resend_email_id text;

create index if not exists outreach_messages_followup_due_idx
  on outreach_messages (sent_at)
  where channel = 'email' and status = 'sent' and followup_sent_at is null and response_status is null;
