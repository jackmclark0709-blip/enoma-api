-- Customer page upgrade (pages/customer-page-upgrade).
-- New optional facts an owner can give about their business. All nullable,
-- no defaults, no changes to existing columns: a row without them renders
-- exactly as before apart from layout, and every block that reads them
-- disappears when they're empty.
--
-- Per-service "price_from" and "turnaround" live inside the existing
-- services jsonb items ({ service_name, service_description, price_from,
-- turnaround }), so they need no column.

alter table public.small_business_profiles
  add column if not exists years_in_business int,
  add column if not exists license_number text,
  add column if not exists is_insured boolean,
  add column if not exists offers_free_estimates boolean,
  add column if not exists response_time text,   -- e.g. "within 2 hours"
  add column if not exists owner_photo_url text,
  add column if not exists owner_blurb text,
  add column if not exists how_it_works jsonb;    -- [{ "title": "", "text": "" }] x3

-- Keep obviously wrong values out (the page prints these as facts).
alter table public.small_business_profiles
  drop constraint if exists small_business_profiles_years_in_business_check;
alter table public.small_business_profiles
  add constraint small_business_profiles_years_in_business_check
  check (years_in_business is null or (years_in_business >= 0 and years_in_business <= 150));

alter table public.small_business_profiles
  drop constraint if exists small_business_profiles_how_it_works_check;
alter table public.small_business_profiles
  add constraint small_business_profiles_how_it_works_check
  check (how_it_works is null or jsonb_typeof(how_it_works) = 'array');
