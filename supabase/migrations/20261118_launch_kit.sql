-- Launch kit (page v2, PR 3): marketing pieces made for each business
-- (api/_lib/launch-kit.js, launch-kit-render.js).
--
-- Stored on small_business_profiles.brand_kit.launch_kit (the existing jsonb
-- column, no schema change). Files:
--   * business-images (public, existing): launch-kit/<business_id>/<fp>/<id>-preview.jpg
--     watermarked previews ("Preview" ribbon), fine for anyone to see.
--   * launch-kits (private, new here): <business_id>/<fp>/<id>.png|pdf
--     the clean files. No storage.objects policies: only the service role
--     reads them, and owners get a 10-minute signed URL after the $1 claim.
--
-- Additive and idempotent: creating a bucket changes no existing row.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('launch-kits', 'launch-kits', false, 10485760, array['image/png', 'application/pdf'])
on conflict (id) do nothing;
