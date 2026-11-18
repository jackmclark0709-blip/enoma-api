-- Website v3, PR A: the fact sheet and the v3 page copy
-- (docs/website-v3-contract.md, api/_lib/fact-sheet.js, api/_lib/page-copy.js).
--
-- Additive only. Both columns are null on every existing row; nothing reads
-- them until the v3 template (PR B) ships.
--
--   fact_sheet    everything we know about the business that copy may cite:
--                 Google listing, up to 5 reviews (4★+, full text), site text,
--                 the owner's answers, towns, owner-uploaded photo URLs.
--                 Google photo URLs/bytes are never stored here (Places terms).
--   page_copy_v3  the copy written from the fact sheet by one gpt-4o call,
--                 every claim carrying evidence ids, plus what the evidence
--                 check removed (removed[]) for review.

alter table public.small_business_profiles
  add column if not exists fact_sheet jsonb,
  add column if not exists page_copy_v3 jsonb;

comment on column public.small_business_profiles.fact_sheet is
  'Website v3 fact sheet (docs/website-v3-contract.md). Built by api/_lib/fact-sheet.js.';
comment on column public.small_business_profiles.page_copy_v3 is
  'Website v3 page copy with evidence ids (docs/website-v3-contract.md). Written by api/_lib/page-copy.js.';
