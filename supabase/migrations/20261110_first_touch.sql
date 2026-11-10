-- First-touch attribution, kept through to payment. Filled once when a page
-- is claimed (api/claim-business.js) and never overwritten:
--   1. the claiming browser's stored first touch (localStorage
--      enoma_first_touch, set by public/scripts/ref-capture.js) if it has utm_*;
--   2. else the prospect's raw.attribution (instant previews);
--   3. else {"utm_source": "cold_email"} for outreach prospects;
--   4. else the browser's landing page / referrer without utm_*.
-- api/create-checkout.js copies its utm_* keys into the Stripe Checkout
-- session and subscription metadata.
alter table public.businesses
  add column if not exists first_touch jsonb;
