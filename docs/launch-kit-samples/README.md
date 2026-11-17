# Launch kit samples (PR 3 of page v2)

Rendered locally with the real pipeline (`api/_lib/launch-kit-render.js`) from
each page's real profile (read-only copy, 2026-11-16), month = November.
Brand kits were built the way production builds them, with no model keys, so:

- **Captions** here are the deterministic fallback (`fallbackCaptions`). In
  production one gpt-4o call writes them; anything that fails `lintCaption`
  is retried once, then falls back to these.
- **Conway's Landscaping** is page v1 and claimed in production; it's here
  only as the landscaper sample (page_version = 2 assumed). Nothing about its
  live page changes. Its logo reads as `badge_only` without the vision call,
  so the wordmark is drawn and a round badge is included.
- `*-preview.jpg` is what the owner sees before the $1 claim (the "Preview"
  ribbon). The rest are the clean files that unlock after it.
- `*-qr_card.pdf` is the printable 4x6 card; `*-qr_card.jpg` is the same
  card as an image. Both QR codes were decoded and point at the page.

Files: JPEG copies at q84 to keep the repo small; the real downloads are PNG.
