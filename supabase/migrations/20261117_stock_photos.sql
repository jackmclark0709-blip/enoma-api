-- Curated stock photo library (Unsplash). Built offline by
-- scripts/build-stock-library.mjs, approved by hand with
-- scripts/approve-stock.mjs, picked per business by api/_lib/stock-photos.js.
--
-- Unsplash rules we follow (help.unsplash.com, "API Guidelines"):
--   * Hotlink: we store urls.raw (keeps its ixid) and add Imgix params at
--     render time. No file is ever copied to our storage.
--   * Attribution: every page that shows one renders "Photo by <name> on
--     Unsplash" with utm_source=enoma&utm_medium=referral links.
--   * Download trigger: download_location is called once, when a photo is
--     first assigned to a business (stock_photo_assignments), never on views.
--
-- Only approved = true rows are ever shown on a page.

create table if not exists public.stock_photos (
  id bigint generated always as identity primary key,
  unsplash_id text not null unique,
  persona text not null,
  service_tag text not null,
  raw_url text not null,
  width integer not null,
  height integer not null,
  color text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  blur_hash text,
  alt text,
  photographer_name text not null,
  photographer_username text not null,
  photographer_url text not null,
  photo_page_url text not null,
  download_location text not null,
  approved boolean not null default false,
  vision_verdict jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists stock_photos_approved_persona_idx
  on public.stock_photos (persona, service_tag) where approved;

-- One row per (business, photo) the first time that photo is assigned to that
-- business. stock_assigned_at marks the single Unsplash download trigger; the
-- primary key makes a repeat impossible.
create table if not exists public.stock_photo_assignments (
  business_id uuid not null,
  unsplash_id text not null references public.stock_photos (unsplash_id) on delete cascade,
  slot text not null default 'hero',
  stock_assigned_at timestamptz not null default now(),
  download_triggered boolean not null default false,
  primary key (business_id, unsplash_id)
);

-- Server-only tables: RLS on, no policies (service role bypasses RLS).
alter table public.stock_photos enable row level security;
alter table public.stock_photo_assignments enable row level security;
