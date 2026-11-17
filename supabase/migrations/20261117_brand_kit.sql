-- Page v2: per-business brand kit, page version flag, owner link token.
-- (api/_lib/brand-kit.js, api/_lib/page-v2.js, api/_lib/owner-link.js)
--
-- Additive only. Every existing row keeps page_version = 1 and renders
-- exactly as before; new unclaimed previews are switched to 2 by the preview
-- generator after the profile row is written (best effort, so the generator
-- still works if this migration hasn't been applied yet).

alter table public.small_business_profiles
  add column if not exists brand_kit jsonb,
  add column if not exists page_version smallint not null default 1,
  -- Unguessable token for the owner's link (/<slug>?o=<token>). Generated in
  -- code the first time an owner link is built for a v2 page.
  add column if not exists owner_token text,
  -- Logo source 5: an image URL Jack (or the daily run) pastes for leads whose
  -- logo only lives on Facebook/Messenger. Never scraped automatically.
  add column if not exists admin_logo_url text;

alter table public.small_business_profiles
  drop constraint if exists small_business_profiles_page_version_check;
alter table public.small_business_profiles
  add constraint small_business_profiles_page_version_check check (page_version in (1, 2));

create unique index if not exists small_business_profiles_owner_token_key
  on public.small_business_profiles (owner_token) where owner_token is not null;
