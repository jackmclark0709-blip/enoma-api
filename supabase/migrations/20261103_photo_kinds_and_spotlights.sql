-- Photo tags: { "<url>": "work" | "flyer" | "logo" | "other" }.
-- Only "work" (and older untagged uploads) appear in the hero and gallery.
alter table public.small_business_profiles
  add column if not exists attachment_kinds jsonb not null default '{}'::jsonb;

-- Service Spotlight pages: one page per service, at enoma.io/<business>/<service>.
-- Drafts are viewable by link (noindex) until the owner approves them.
create table if not exists public.service_spotlights (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  service_slug text not null,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  intake jsonb not null default '{}'::jsonb,      -- the owner's survey answers
  brief jsonb not null default '{}'::jsonb,       -- positioning brief (step 2)
  content jsonb not null default '{}'::jsonb,     -- rendered blocks (steps 3-6)
  removed_claims jsonb not null default '[]'::jsonb, -- what the fact check took out
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  unique (business_id, service_slug)
);

create index if not exists service_spotlights_business_idx on public.service_spotlights (business_id, status);

-- Server-only table: the API uses the service role; nothing is exposed to anon.
alter table public.service_spotlights enable row level security;
