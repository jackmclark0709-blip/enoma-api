-- Partner price ($9.99/month, Stripe lookup key enoma_page_partner_monthly)
-- for businesses referred by an organization Enoma partners with (SBDC,
-- SCORE, voc-tech schools, trade associations). Turn it on per referrer:
--   update public.referrers set partner_pricing = true where code = '<code>';
-- api/create-checkout.js reads it; without this column everyone gets the
-- standard price.
alter table public.referrers
  add column if not exists partner_pricing boolean not null default false;
