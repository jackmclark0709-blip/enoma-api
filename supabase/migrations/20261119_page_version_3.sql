-- Page v3 (api/_lib/page-v3.js, PR #120): allow page_version 3.
-- 20261117_brand_kit limited it to (1, 2). Applied to prod 2026-11-19
-- before flipping arno-plumbing-and-heating-2, the first v3 page.

alter table public.small_business_profiles
  drop constraint if exists small_business_profiles_page_version_check;
alter table public.small_business_profiles
  add constraint small_business_profiles_page_version_check check (page_version in (1, 2, 3));
