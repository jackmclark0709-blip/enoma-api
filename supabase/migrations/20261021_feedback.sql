-- Feedback from preview-page polls and the 👍/👎 links in outreach emails.
-- Written only by the service role (api/track.js); RLS on with no policies.
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  source text not null check (source in ('preview_poll', 'email_vote')),
  answer text not null,
  comment text,
  slug text,
  outreach_message_id uuid references public.outreach_messages(id) on delete set null,
  anon_id text,
  referrer text,
  user_agent text
);
create index if not exists feedback_created_at_idx on public.feedback (created_at desc);
create index if not exists feedback_outreach_message_idx on public.feedback (outreach_message_id);
alter table public.feedback enable row level security;
comment on table public.feedback is
  'Owner feedback: preview_poll (yes/maybe/no on unclaimed preview pages) and email_vote (up/down from outreach emails). Optional free-text comment. Service role writes only.';
