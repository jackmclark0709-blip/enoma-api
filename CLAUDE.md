# Enoma

AI-generated business pages for local service businesses (landscaping, plumbing, HVAC, etc.). Vercel serverless functions (`api/*.js`, ESM) + static HTML in `public/` + Supabase (Postgres + Auth). Stripe for billing, Resend for email, OpenAI for page copy and outreach drafting, GA4 + Search Console for traffic. Full product/business context: `README.md`.

## Hard constraint: 12 serverless functions

**Vercel Hobby plan caps this project at exactly 12 files under `api/*.js`.** Run `ls api/` before adding a new one. If already at 12, extend an existing endpoint (add a new `?action=` branch) or move pure logic into `api/_lib/` (not counted against the cap) instead of adding a 13th file. This is why `ga-metrics.js` has accumulated many unrelated `action=` branches — it's the natural place to add server logic without spending a function slot.

## Commands

- `npm test` — runs all unit test files in `tests/` (pure functions only, no network/DB): `service-utils.test.js`, `lead-scoring.test.js`, `email-crawler.test.js`.

## Architecture

- `api/*.js` — Vercel serverless functions, one per file, ESM (`type: module`).
- `api/_lib/` — pure/shared helpers, excluded from the 12-function cap.
- `public/` — static HTML/JS for the marketing site and `/admin/*` tools.
- `enoma-backend/` — separate Express server (`server.js`), not part of the Vercel function set.

### Admin tools

Gated to `jack@enoma.io` only via Supabase session JWT (see `requireAdmin` in `api/ga-metrics.js`):

- `/admin/admin-list.html` — every business profile
- `/admin/voice.html` — voice-driven assistant for revenue/traffic/CRM questions, plus outreach-email drafting
- `/admin/sales-queue.html` — Sales Queue, scored/prioritized leads (`action=sales_queue`, `action=update_lead_status`)

## Prospect outreach agent (website crawl → contact extraction → drafted email)

Turns an Outscraper-sourced prospect that has a **website but no known email** into a **suppression-checked contact email plus a gap-aware drafted outreach email**, entirely server-side, with a human always approving before send.

**Entry point:** `GET /api/ga-metrics?action=crawl_websites&limit=N` → `handleCrawlWebsites` in `api/ga-metrics.js:318`. Pulls up to `limit` (max 15) prospects where `website IS NOT NULL AND email IS NULL AND email_crawl_status IS NULL`, and for each one, runs the pipeline below. Batched (not all-at-once) because the whole file has a 60s Vercel `maxDuration`.

1. **Fetch + extract contact info** — `findEmailForWebsite()` (`api/ga-metrics.js:247`) fetches the homepage, falls back to a `/contact` page if no email found there, then calls `extractEmails()` (`api/_lib/email-crawler.js:19`) to pull candidate emails from `mailto:` links and bare page text (skipping `<script>`/`<style>` blocks, which otherwise leak unrelated third-party emails like font-license comments). Junk domains/prefixes (`noreply@`, `sentry.io`, `wixpress.com`, etc.) are filtered out. `pickBestEmail()` (`email-crawler.js:49`) prefers an address on the business's own domain over one from a third-party widget.
   - No page fetched at all → `email_crawl_status = "fetch_failed"`.
   - Page fetched but no real email found → `"no_email_found"`.
2. **Suppression check** — before ever saving a discovered email, it's checked against `suppression_list` (permanent do-not-contact). A match sets `email_crawl_status = "suppressed"` and stops there — no draft is generated.
3. **Site-gap assessment** — `assessSiteGaps()` (`api/ga-metrics.js:276`), only run once a usable email exists. Sends the page's stripped text (`htmlToText()`, `email-crawler.js:58`) to OpenAI (`gpt-4o`, JSON mode) asking for genuine, specific gaps grounded in that page's actual text — not a generic small-business-site checklist. Returns `tier: "good_site" | "weak_site"` plus up to 3 short gaps.
   - `good_site` → prospect is marked `status = "reviewed"` (not offered a "you need a website" pitch that would be false) and no draft is written.
4. **Gap-aware draft** — for `weak_site` prospects, `generateDraftCopy()` (`api/ga-metrics.js:504`) writes a short (<120 words) cold outreach email via OpenAI, explicitly pitching *"you have a site but aren't getting found"* rather than *"you don't have a website"* — picks exactly one real gap as supporting evidence, references the real Conway's Landscaping case study, and (if one exists) an unclaimed preview page already built from the business's public listing. Plain text only — markdown link syntax is explicitly forbidden in the prompt. Result is saved as `draft_subject`/`draft_body` with `status = "drafted"`, landing in the Sales Queue for human review. **Nothing is ever auto-sent.**

**Related actions in the same file:**
- `action=draft_all` → `handleDraftAll` (`api/ga-metrics.js:618`) — batch-drafts (or re-drafts with `force=true`) outreach for any prospect that already has an email on file, oldest-`updated_at`-first, skipping `status="reviewed"` (the crawler's `good_site` verdict holds regardless of force).
- `action=list_drafts` — read-only listing of drafted prospects for review.
- Voice-agent tools (`toolDraftOutreachEmail`, `toolGetOutreachDraft`, `toolApproveOutreachEmail`) let `/admin/voice.html` drive the same `generateDraftCopy()` path conversationally, and mark a draft `approved` — sending itself is still manual (Jack sends it).

**Tests:** `tests/email-crawler.test.js` covers `extractEmails`/`pickBestEmail`/`htmlToText` in isolation (no network/Supabase/OpenAI — those live only in `ga-metrics.js` and aren't unit-tested directly).

See `README.md` → "Sales strategy & prospecting status" for why this exists: Outscraper's own enrichment doesn't reliably return emails, so this crawl is the fallback contact-sourcing path for prospects that already cleared the "has a real website" bar.
