-- Multi-step quote form (api/_lib/quote-form.js): the visitor's tap-to-choose
-- answers, stored next to the lead. Nullable; older leads and other sources
-- (global_cta, started_form, concierge) leave it empty. Existing columns are
-- unchanged.
--   { "services": ["Spring cleanup", "Mulching"], "timing": "this_week",
--     "location": "Agawam", "preference": "text" }
alter table contact_submissions add column if not exists answers jsonb;
