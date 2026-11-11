-- Starter logos (api/_lib/starter-logo.js): a business with no logo_url gets
-- a simple wordmark on its page. The owner can pick one of three styles in
-- the dashboard; null means the default ("badge"). Cleared when the owner
-- uploads a real logo (api/_lib/logo-settings.js, api/generate-business.js).
alter table public.small_business_profiles
  add column if not exists starter_logo_id text
    check (starter_logo_id is null or starter_logo_id in ('badge', 'stacked', 'wordmark'));
