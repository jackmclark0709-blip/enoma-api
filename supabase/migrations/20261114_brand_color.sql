-- Logo color, read on the server when an owner uploads a logo
-- (api/_lib/logo-color.js, from api/_lib/logo-settings.js and
-- api/generate-business.js). When set, api/p.js uses it as the page's
-- identity color (--brand-primary) and picks the CTA color from it
-- (page-style.js ctaFor), so the page renders in the logo's color from the
-- first paint. Null means "use the palette". Existing logos are filled in by
-- scripts/backfill-brand-color.mjs.
alter table public.small_business_profiles
  add column if not exists brand_color text
    constraint small_business_profiles_brand_color_hex
    check (brand_color ~ '^#[0-9a-fA-F]{6}$');
