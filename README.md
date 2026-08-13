# Enoma

AI-generated business pages for local service businesses (landscaping, plumbing, HVAC, etc.) — one page built to be found by Google and AI assistants, not a generic ten-page site. Free 30-day trial, then $19.99/mo.

Production: [enoma.io](https://enoma.io). Vercel serverless functions (`api/*.js`, ESM) + static HTML in `public/` + Supabase (Postgres + Auth). Stripe for billing, Resend for email, OpenAI for page copy and outreach drafting, GA4 + Search Console for traffic.

**Vercel Hobby plan caps this project at exactly 12 serverless functions per deployment.** Before adding a new `api/*.js` file, check `ls api/` — if already at 12, extend an existing endpoint or move pure logic into `api/_lib/` (excluded from the cap) instead of adding a 13th file.

## Admin tools

All gated to `jack@enoma.io` only, via Supabase session:

- `/admin/admin-list.html` — every business profile
- `/admin/voice.html` — voice-driven assistant for revenue/traffic/CRM questions, plus outreach-email drafting
- `/admin/sales-queue.html` — **Sales Queue**, see below

## Sales Queue

`/admin/sales-queue.html`, backed by `api/ga-metrics.js?action=sales_queue` and `?action=update_lead_status`.

Answers one question: **who should I talk to today?** It merges the two lead populations that actually carry contact info into a single scored, prioritized list:

1. **Raw Enoma leads** — `contact_submissions` rows where `business_id IS NULL`: people who filled the "get your website" form or asked for the concierge build. First-party interest in Enoma itself.
2. **Outbound prospects** — the Outscraper pipeline (`prospects` + `outreach_messages`): local businesses found via Google Maps search filtered to `only_without_website`, worked through draft → approve → send → reply/claim.

### Scoring model (`api/_lib/lead-scoring.js`)

Every lead gets a 0–100 score and a tier (hot ≥70, warm ≥40, cold below), from real signals only:

- **Raw leads**: base score by source (a concierge request scores higher than a bare form start), +10 for a phone number on file, +10 if unread, −25 once replied to.
- **Prospects**: base score by pipeline stage (new → reviewed → drafted → approved → sent), overridden hard by real response signals — a reply scores 90, a claim scores 100. Skipped prospects and bounced/opted-out outreach are excluded from the queue entirely, not just down-ranked.
- **Both**: a recency multiplier decays the score over ~30 days but never to zero — an old hot lead still surfaces, just not first.

Unit tests: `tests/lead-scoring.test.js` (pure functions, no network/DB — run via `npm test`).

### What's deliberately not in the queue

Self-serve wizard drop-off (`funnel_events`) is not turned into individual leads. Those rows carry only an anonymous `anon_id` — no name, email, or phone — until *after* a business page is already generated (see `public/scripts/funnel-track.js`), so there's no honest way to attribute early drop-off to a real, contactable person. It's shown instead as an aggregate "last 30 days" funnel-health panel on the same page (step counts only, not leads).

### Actions

Both are JWT-gated (Supabase session bearer token, `jack@enoma.io` only) and were added to the existing `api/ga-metrics.js` rather than a new file, to stay within the 12-function cap:

- `action=sales_queue` (GET) — returns the scored queue, summary tiles, and funnel-health counts.
- `action=update_lead_status` (POST) — mark a raw lead replied/read, or advance a prospect's status (reviewed → drafted → approved, or skipped).

## Security note (2026-08-12)

`outreach_messages` and `suppression_list` (the permanent do-not-contact list) had Row Level Security disabled — publicly readable *and writable* via the anon key already embedded in the admin pages' page source. Fixed by enabling RLS with no public policies added, matching the existing `prospects`/`funnel_events` pattern (service-role-only access — nothing legitimate touches these tables from a browser). Run Supabase's `get_advisors(type: "security")` after any new table or migration to catch this class of issue early.
