-- Security hardening for Supabase security-advisor findings (2026-11-17 run).
--
-- 1. ERROR  rls_disabled_in_public               outreach_click_backup_20261112
-- 2. WARN   anon/authenticated_security_definer  8 SECURITY DEFINER functions callable via /rest/v1/rpc
-- 3. WARN   function_search_path_mutable          13 functions
--
-- Left alone on purpose: rls_enabled_no_policy (INFO) — those are server-only
-- tables accessed with the service role key.
--
-- Background on why grants matter here: Postgres grants EXECUTE on new functions
-- to PUBLIC by default, so revoking from anon/authenticated alone is not enough;
-- PUBLIC must be revoked too. Trigger functions are only privilege-checked when
-- the trigger is created, never when it fires, so revoking EXECUTE does not stop
-- any trigger from running. The service role keeps an explicit grant.

-- ── 1. Stale one-off backup table ────────────────────────────────────────────
-- Snapshot of outreach_messages click columns (13 rows, all taken
-- 2026-11-12 15:46 UTC, minutes before 20261112_traffic_class reclassified
-- link-scanner clicks). Not created by any migration and not referenced in code.
-- Lock it down now; dropping it is Jack's call (see PR) — uncomment to drop.
alter table public.outreach_click_backup_20261112 enable row level security;
revoke all on table public.outreach_click_backup_20261112 from anon, authenticated;
-- drop table if exists public.outreach_click_backup_20261112;

-- ── 2. SECURITY DEFINER functions exposed over RPC ───────────────────────────
-- Trigger-only functions.
revoke execute on function public.auto_add_enoma_admin()    from public, anon, authenticated; -- trigger on business_members
revoke execute on function public.notify_admin_on_signup()  from public, anon, authenticated; -- trigger on auth.users
revoke execute on function public.notify_admin_on_contact() from public, anon, authenticated; -- trigger on contact_submissions
revoke execute on function public.handle_new_user()         from public, anon, authenticated; -- no trigger attached; no-op body

-- Server-only functions (pg_cron as postgres / service-role client in api/*.js).
revoke execute on function public.rollup_daily_metrics(date)      from public, anon, authenticated; -- pg_cron 'rollup-daily-metrics'
revoke execute on function public.website_is_active(uuid)         from public, anon, authenticated; -- api/p.js, api/ga-metrics.js (service role)
revoke execute on function public.user_can_create_website(uuid)   from public, anon, authenticated; -- no callers found

grant execute on function
  public.auto_add_enoma_admin(),
  public.notify_admin_on_signup(),
  public.notify_admin_on_contact(),
  public.handle_new_user(),
  public.rollup_daily_metrics(date),
  public.website_is_active(uuid),
  public.user_can_create_website(uuid)
to service_role;

-- is_enoma_admin() is used by the RLS policy "Admin can read all profiles" on
-- small_business_profiles (roles: public), so anon and authenticated must keep
-- EXECUTE or every select on that table would fail with "permission denied for
-- function". It only reads auth.email() from the caller's own JWT, so it never
-- needed SECURITY DEFINER: switch it to SECURITY INVOKER instead of revoking.
alter function public.is_enoma_admin() security invoker;

-- ── 3. Pin search_path ───────────────────────────────────────────────────────
alter function public.is_enoma_admin()                set search_path = public;
alter function public.is_business_member(uuid)        set search_path = public;
alter function public.is_business_admin(uuid)         set search_path = public;
alter function public.user_can_create_website(uuid)   set search_path = public;
alter function public.website_is_active(uuid)         set search_path = public;
alter function public.auto_add_enoma_admin()          set search_path = public;
alter function public.handle_new_user()               set search_path = public;
alter function public.set_updated_at()                set search_path = public;
alter function public.generate_unique_slug(text)      set search_path = public;
alter function public.attribution_source_label(jsonb) set search_path = public;
alter function public.funnel_source_label(jsonb)      set search_path = public;
alter function public.traffic_class_for(text, text, text, boolean, interval, boolean, boolean, text[])
                                                      set search_path = public;
-- Same setting as notify_admin_on_signup (fixed 2026-07-31): net.http_post must
-- resolve no matter which role fires the trigger.
alter function public.notify_admin_on_contact()       set search_path = net, public, extensions;
