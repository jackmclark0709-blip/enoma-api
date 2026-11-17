# Stock photo library: build and first use

## The build (overnight, Nov 16–17, 2026)

`scripts/build-stock-library.mjs` filled `stock_photos` from Unsplash:

| Step | Count |
| --- | --- |
| Photos found (Unsplash search, 8 personas) | 1,601 |
| Passed the vision check | 1,098 |
| Approved by hand (`scripts/approve-stock.mjs`) | 200 |

The 200 approved photos are 25 per persona: cleaning, contractor, electrical, hvac, landscaping, painting, plumbing and snow. Checked against production on Nov 17: 1,601 rows, 200 approved, 25 in each persona. Only approved photos are ever used on pages. Don't re-run the build and don't change approvals without a reason.

`PAGE_STOCK_HERO=on` is set for Vercel Production, and production was redeployed with it (`dpl_GDiXBoTTkMMPSAxp2ntKLjzn11Sm`, commit `88923e0`, READY). It isn't set for Preview.

## How a page gets a stock photo

The stock pick only happens when a brand kit is built (`buildBrandKit` → `pickStock`), and only when the hero would otherwise be the drawn trade scene. An owner photo or a Google work photo always wins. When a business is first assigned a photo, `trackStockAssignment` writes a `stock_photo_assignments` row and sends Unsplash's `download_location` ping, once per business and photo. A failed ping deletes its row, so the next kit build tries again. Images are hotlinked from `images.unsplash.com` and never re-hosted. The credit reads "Photo by <name> on Unsplash", both linked with `utm_source=enoma&utm_medium=referral`.

## Let It Roll Painting rebuild (Nov 17): not done yet

The first business to get a stock photo was meant to be Let It Roll Painting (`let-it-roll-painting`, page v2, persona painting, hero currently the drawn scene). It's blocked:

- `POST https://enoma.io/api/ga-metrics?action=rebuild_brand_kit` with `{"slug":"let-it-roll-painting"}` returned **401**. The `ADMIN_SECRET` in the local `.env` doesn't match production's.
- Running the same `buildBrandKit` locally against production was not permitted in that session.

Nothing on his page changed. A backup of his kit from before any attempt is at `reports/let-it-roll-brand-kit-before-20261117.json` (local only, not committed). The kit's logo colors (identity `#1830f0`, accent `#d81818`, CTA `#F2A93B`), specialty ("Cathedral & high ceilings"), owner names (Patrick, Rick) and the v2 captions should come through the rebuild unchanged. Only the hero should change.

To finish: run the rebuild with the right admin secret, then check:
1. `brand_kit.hero.kind = "stock"` with a painting photo, and a `stock_photo_assignments` row with `download_triggered = true`. If the row is missing, the production `UNSPLASH_ACCESS_KEY` isn't set.
2. Load the page at 390 px and 1440 px wide: painting photo, the "Photo by … on Unsplash" credit, and images served from `images.unsplash.com`. Save screenshots to `reports/let-it-roll-stock-390.png` and `-1440.png`. These are for Unsplash's "Apply for production" form.
3. `/og/let-it-roll-painting.png?v=<kit build time>` shows the new hero.
4. Open his `/kit` with the owner link so the launch kit is remade with the photo, and read `brand_kit.launch_kit.captions`.

## Unsplash rate limit

The key is still the **demo key: 50 requests per hour**. Each new business assigned a stock photo uses one request (the download ping). The page v2 rollout (`scripts/rollout-page-v2.mjs`) throttles pings to 45 per rolling hour until production access is approved.
