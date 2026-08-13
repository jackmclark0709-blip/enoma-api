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

## Sales strategy & prospecting status (2026-08-13)

**Target segments**: **plumbing** is the primary scale bet, **landscaping** stays as a warm/proof lane, **junk removal** was evaluated and ruled out.

Real data behind the call — web-presence rate by trade (unfiltered Outscraper pulls, Attleboro MA, ~35–50 businesses sampled per trade — one town, directionally useful, not a large-scale study):

| Trade | No website | Real website |
|---|---|---|
| Landscaping | 24% | 72% |
| Junk removal | 11% | 86% |
| Plumbing | 12% | 88% |
| HVAC | 16% | 84% |
| Electrical | 24% | 76% |

- **Landscaping** has the widest "no website" pool of anything tested and is the only vertical with a real paying customer/case study (Conway's Landscaping) — left running exactly as-is (phone-based outreach, existing Outscraper pipeline, no new tooling needed).
- **Plumbing** was picked as the new scale bet despite a *lower* "no website" rate than landscaping, because it's a state-licensed trade — meaning contact sourcing is structurally solvable via public licensing registries, which landscaping and junk removal have no equivalent of. Also: national search volume for plumbing sits in the hundreds of thousands/month (third-party published estimates, not independently verified against a paid keyword tool), demand is comparatively steady year-round (unlike HVAC's extreme seasonality), and a $19.99/mo ask is trivial against typical job value. `p.js`'s schema.org mapping (`Plumber`) and the AI copy-generation prompt (trust badges, `offers_emergency`) already support this trade correctly — zero engineering cost to add.
- **Junk removal** was ruled out: same structural sourcing gap as landscaping (no licensing-registry equivalent), but a *more* saturated, already web-savvy market (86% real websites, many with hundreds of Google reviews) — a harder "you're invisible online" pitch than any other trade tested.

**Known gap, not yet fixed**: Outscraper's `leads_n_contacts`/`company_websites_finder` enrichment does not appear to actually return email data — confirmed empirically across 250+ real raw listings spanning 5 trades (including businesses with real websites, where an email should almost always be findable), zero email-shaped fields returned anywhere. Every prospect in the pipeline today is phone-only as a result. Don't trust `firstEmail()`'s guessed field names in `handleProspectPull` (`api/ga-metrics.js`) as working until this is separately investigated — likely needs `async=true` + polling rather than the current synchronous call, but that's unconfirmed.

**MA plumbing license bulk data — investigated, not viable today**: Massachusetts's plumbing/gas-fitting license system (`licensing.reg.state.ma.us` / ePlace Portal) is a one-license-at-a-time verification lookup, not a browsable or bulk-downloadable registry. A "Professional Licensing API" exists but requires vendor/municipality-level API access, not self-serve signup. This is a real potential lever (worth a formal public-records request someday), just not something to re-attempt the same way expecting a different result.

**Fixed this session**: `handleProspectPull` was reading `p.site` for a business's website, but Outscraper's actual field is `p.website` — confirmed against a real raw API pull. `prospects.website`/`found_website` had been `NULL` for every prospect ever pulled until this was fixed; invisible under the default `only_without_website` filter since Outscraper does that filtering server-side.

## Open items / backlog (2026-08-13)

Not yet started, none of this exists in the codebase — confirmed via a repo-wide grep for UTM/attribution fields before writing this.

**Visitor attribution tracking** — the underlying question was "can we know who's visiting via organic search vs. direct vs. an AI assistant, and follow up on their interest." Current state: `page_events`/`funnel_events` capture the referring domain, but only per-request, not persisted — so if someone lands via Google then clicks around for five minutes, every later event's "referrer" is just enoma.io itself, not Google. No UTM params, no landing page, no first-touch source captured anywhere.

Real distinction worth keeping straight: an *anonymous* visitor can't be identified before they submit a form — that's not a tooling gap, it's how privacy-respecting tracking works. (B2B "visitor deanonymization" tools like Clearbit Reveal / RB2B exist and do reverse-IP-lookup tricks, but they're built for corporate-network traffic and would perform poorly against Enoma's actual visitors — small-business owners on home wifi/mobile.) The real, buildable value is at the moment someone *does* submit a form — that's when attribution can actually attach to a real lead:

1. Client-side: capture `document.referrer` + parsed UTM params + landing page once per `anon_id`, persist alongside it in `localStorage` (extends `public/scripts/funnel-track.js`).
2. Server-side: attach that first-touch bundle to the `contact_submissions` row when a real lead-capture happens (`send-contact.js`) — needs new columns (`first_touch_source`, `utm_campaign`, `landing_page`).
3. Surface it in the Sales Queue — a natural column/filter addition to the existing raw-lead rows, not a new page.

**AI-referral traffic specifically**: referrer behavior varies by AI product — some pass `chatgpt.com`/`perplexity.ai`/`claude.ai` cleanly, others strip it. GA4 (already connected) has started bucketing some of this natively — check what's actually showing up there before building custom detection. If needed, a cheap addition is matching the referrer against a known-AI-domain list rather than relying on GA4's generic "referral" bucket.

**Conversion chatbot** — raised again 2026-08-13. Explicitly out of scope for the sales-queue work this session — see the "Sales strategy" section above; the original scoping decision was distribution tooling only, no new product surface (chat widget, SEO pages, referral loops all deliberately skipped). Not decided whether to revisit; flagged, not started.

**"Claude Dispatch"** — mentioned 2026-08-13, unclear what specific feature/product this refers to. Needs clarification before any work starts — don't guess and build the wrong thing.

## Security note (2026-08-12)

`outreach_messages` and `suppression_list` (the permanent do-not-contact list) had Row Level Security disabled — publicly readable *and writable* via the anon key already embedded in the admin pages' page source. Fixed by enabling RLS with no public policies added, matching the existing `prospects`/`funnel_events` pattern (service-role-only access — nothing legitimate touches these tables from a browser). Run Supabase's `get_advisors(type: "security")` after any new table or migration to catch this class of issue early.
