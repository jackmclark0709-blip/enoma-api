// api/ga-metrics.js
// Reads live traffic data from GA4 via a service account (Data API).
// Protected the same way as the admin path in generate-business.js: requires
// the x-admin-secret header to match ADMIN_SECRET.

import { BetaAnalyticsDataClient } from "@google-analytics/data";
import { JWT } from "google-auth-library";
import { createClient } from "@supabase/supabase-js";
import { scoreRawLead, scoreProspect } from "./_lib/lead-scoring.js";
import dns from "node:dns/promises";
import crypto from "node:crypto";
import { extractEmails, pickBestEmail, htmlToText, isPrivateOrReservedIp } from "./_lib/email-crawler.js";
import { hasValidMx } from "./_lib/email-verify.js";
import { siteChecks, decideSiteTier } from "./_lib/site-checks.js";
import { previousMonth, tallyClicks, buildResultsEmail } from "./_lib/results-email.js";
import { qualifiesForPreview, buildFactsPrompt, validateGenerated, assembleProfile, slugify, stateAbbr, PREVIEW_TRIAL_DAYS } from "./_lib/preview-generator.js";
import { verifyUnsubscribeToken, appendComplianceFooter, buildUnsubscribeUrl, MAILING_ADDRESS } from "./_lib/outreach-footer.js";
import { buildOutreachEmail, trackedLinks, replyToFor, slugFromPreviewUrl, messageIdFromReplyAddress, classifyReplyIntent, isUuid } from "./_lib/outreach-email.js";
import { verifyMailbox } from "./_lib/mailbox-verify.js";
import { plainTextToHtml, wrapEmailHtml } from "./_lib/email-html.js";
import { rampCapForDate } from "./_lib/outreach-ramp.js";
import { townForDate, tradeForDate } from "./_lib/prospect-rotation.js";
import { Resend } from "resend";

// Resend's constructor throws synchronously if the key is missing, which
// would crash this whole module (prospecting, crawling, drafting, sending,
// the webhook, and the sales-queue dashboard all live here) at import time.
// Guarded the same way as api/send-contact.js.
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const client = new BetaAnalyticsDataClient({
  credentials: {
    client_email: process.env.GA_CLIENT_EMAIL,
    private_key: (process.env.GA_PRIVATE_KEY || "").replace(/\\n/g, "\n")
  }
});

// Search Console reuses the same service account as GA4 — it just needs to be
// added as a user on the property in Search Console's own UI (done 2026-08-01).
const searchConsoleAuth = new JWT({
  email: process.env.GA_CLIENT_EMAIL,
  key: (process.env.GA_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  scopes: ["https://www.googleapis.com/auth/webmasters.readonly"]
});

let cachedSiteUrl = null;
async function getSearchConsoleSiteUrl(token) {
  if (cachedSiteUrl) return cachedSiteUrl;
  const res = await fetch("https://searchconsole.googleapis.com/webmasters/v3/sites", {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || "Search Console sites.list failed");
  const site = (data.siteEntry || []).find(s => s.siteUrl.includes("enoma.io")) || (data.siteEntry || [])[0];
  if (!site) throw new Error("No Search Console property found for this service account");
  cachedSiteUrl = site.siteUrl;
  return cachedSiteUrl;
}

async function fetchSearchConsoleData() {
  const { token } = await searchConsoleAuth.getAccessToken();
  const siteUrl = await getSearchConsoleSiteUrl(token);

  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 28);
  const fmt = d => d.toISOString().slice(0, 10);

  async function query(body) {
    const res = await fetch(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ startDate: fmt(start), endDate: fmt(end), ...body })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || "Search Console query failed");
    return data.rows || [];
  }

  const [totals] = await query({});
  const topQueries = await query({ dimensions: ["query"], rowLimit: 10 });

  return {
    last_28_days: totals
      ? { clicks: totals.clicks, impressions: totals.impressions, ctr: totals.ctr, avg_position: totals.position }
      : { clicks: 0, impressions: 0, ctr: 0, avg_position: null },
    top_queries: topQueries.map(r => ({
      query: r.keys[0],
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: r.ctr,
      avg_position: r.position
    }))
  };
}

// bodyParser is disabled so handleResendWebhook can verify Resend's signature
// against the exact raw bytes it was computed over — re-serializing a parsed
// body (JSON.stringify(JSON.parse(x))) isn't guaranteed byte-identical to the
// original. req.body is still populated manually below, from the raw bytes,
// so every existing POST action (voice-query, update_lead_status) keeps
// working exactly as before.
export const config = { api: { bodyParser: false }, maxDuration: 60 };

async function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function logNotificationFailure(source, recipient, error, context) {
  console.error(`🚨 Notification email failed [${source}]:`, error?.message || error);
  try {
    await supabase.from("notification_failures").insert({
      source,
      recipient,
      error: error?.message || String(error),
      context
    });
  } catch (e) {
    console.error("🚨 Also failed to record notification_failures row:", e?.message);
  }
}

const normalizePhone = (p) => (p || "").replace(/\D/g, "").slice(-10);

// Pulls a batch of local businesses from Outscraper's Google Maps scraper,
// dedupes against existing contact_submissions/businesses by phone, and
// stores new ones in `prospects` for the Marketing agent to draft outreach to.
// Filtered to only_without_website — Enoma's actual ICP is businesses that
// don't have a site yet, not just any business in the trade.
//
// Email used to be requested via enrichment (company_websites_finder /
// leads_n_contacts) on the theory that it'd discover a site or email Google's
// own listing doesn't show. Checked against the actual data 2026-09-17: of
// every prospect that has ever had an email on file, 100% got it from this
// file's own crawlWebsitesOnce visiting `website` — zero ever came from
// Outscraper's enrichment. Defaulted off below; still overridable via the
// `enrichment` param if worth re-testing later. `email` stays a nice-to-have
// channel signal, not a pull filter — most correctly-targeted no-website
// prospects genuinely have no scrapable email anywhere, and dropping them
// would gut this vertical's list.
// Core pull logic, split out from handleProspectPull so the daily cron
// pipeline (handleDailyPipeline, below) can call it directly without going
// through a req/res cycle.
async function pullProspects({ trade = "landscaping", location = "Attleboro, MA", limit = 250, filters, enrichment } = {}) {
  const cappedLimit = Math.min(limit || 250, 500);

  const params = new URLSearchParams({
    query: `${trade} near ${location}`,
    limit: String(cappedLimit),
    async: "false",
    region: "US",
    language: "en"
  });
  const filtersParam = filters !== undefined ? filters : "only_without_website";
  if (filtersParam && filtersParam !== "none") {
    filtersParam.split(",").forEach(f => params.append("filters", f));
  }
  const enrichmentParam = enrichment !== undefined ? enrichment : "none";
  // Confirmed empirically: unlike `filters`, Outscraper's `enrichment` must be
  // sent as ONE comma-separated value — appending it as repeated params (like
  // filters does) silently returns zero results.
  if (enrichmentParam && enrichmentParam !== "none") {
    params.append("enrichment", enrichmentParam);
  }

  const outscraperRes = await fetch(
    `https://api.outscraper.cloud/google-maps-search?${params.toString()}`,
    { headers: { "X-API-KEY": process.env.OUTSCRAPER_API_KEY || "" } }
  );
  const payload = await outscraperRes.json();
  if (!outscraperRes.ok) {
    const err = new Error("Outscraper request failed");
    err.status = outscraperRes.status;
    err.payload = payload;
    throw err;
  }

  const places = (payload.data || []).flat().filter(Boolean);

  const [{ data: existingContacts }, { data: existingBusinesses }] = await Promise.all([
    supabase.from("contact_submissions").select("phone"),
    supabase.from("businesses").select("phone")
  ]);
  const existingPhones = new Set(
    [...(existingContacts || []), ...(existingBusinesses || [])]
      .map(r => normalizePhone(r.phone))
      .filter(Boolean)
  );

  // Confirmed against a real raw pull (2026-08-13): Outscraper's Google Maps
  // field is `website`, not `site` — the previous `p.site` reads always
  // returned undefined, so `prospects.website`/`found_website` were NULL for
  // every prospect ever pulled. Invisible under only_without_website (Outscraper
  // filters server-side, so an empty website looked like the expected result)
  // — only surfaced by pulling unfiltered results and inspecting the raw shape.
  // The enrichment (leads_n_contacts/company_websites_finder) response shape
  // is still unconfirmed — that same raw pull returned no email-shaped field
  // at all across 50 real listings including businesses with real websites,
  // suggesting the enrichment isn't actually running synchronously. Don't
  // assume firstEmail()'s field-name guesses are correct until that's
  // separately investigated.
  const firstEmail = p => {
    if (p.email_1) return p.email_1;
    if (Array.isArray(p.emails) && p.emails.length) return p.emails[0];
    if (typeof p.email === "string" && p.email) return p.email;
    if (p.contacts?.emails?.length) return p.contacts.emails[0];
    return null;
  };
  const foundWebsite = p => {
    // `website` is the business's own listed site; company_websites_finder
    // may add a distinct discovered-site field when Maps shows none.
    if (!p.website && p.found_website) return p.found_website;
    if (!p.website && p.company_website) return p.company_website;
    return null;
  };

  const rows = places.map(p => {
    const phone = normalizePhone(p.phone);
    return {
      source: "outscraper_google_maps",
      trade,
      business_name: p.name || "Unknown",
      phone: p.phone || null,
      address: p.address || p.full_address || null,
      city: p.city || null,
      state: p.state || p.us_state || null,
      website: p.website || null,
      email: firstEmail(p),
      found_website: foundWebsite(p),
      google_place_id: p.place_id || null,
      status: phone && existingPhones.has(phone) ? "dedup_match" : "new",
      raw: p
    };
  });

  if (rows.length) {
    const { error: insertError } = await supabase
      .from("prospects")
      .upsert(rows, { onConflict: "source,google_place_id", ignoreDuplicates: true });
    if (insertError) throw insertError;
  }

  return {
    pulled: places.length,
    new: rows.filter(r => r.status === "new").length,
    dedup_matches: rows.filter(r => r.status === "dedup_match").length,
    with_email: rows.filter(r => r.email).length
  };
}

async function handleProspectPull(req, res) {
  const trade = (req.query.trade || "landscaping").toString();
  const location = (req.query.location || "Attleboro, MA").toString();
  const limit = parseInt(req.query.limit, 10) || 250;
  const filters = req.query.filters !== undefined ? req.query.filters.toString() : undefined;
  const enrichment = req.query.enrichment !== undefined ? req.query.enrichment.toString() : undefined;

  try {
    const result = await pullProspects({ trade, location, limit, filters, enrichment });
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, error: err.payload });
    throw err;
  }
}

// ==================== Website email crawler ====================
// Fills in the other half of prospecting: the ~50 prospects that DO have a
// website on file (found via handleProspectPull without the
// only_without_website filter, or discovered via company_websites_finder)
// never had that site actually visited. This crawls each one's homepage
// (falling back to /contact) looking for a real contact email, and — only
// when an email is actually found — has OpenAI read the same page text to
// flag specific, honest gaps to personalize outreach around. Deliberately
// conservative on timeouts/paths/limit so a single request stays well under
// this file's 60s maxDuration; call it repeatedly with a small `limit` to
// work through the backlog rather than raising limit to cover it in one go.

// Tried in order after the homepage, stopping as soon as one turns up an
// email. Widened 2026-09-17 from a single "/contact" guess after checking
// the actual data: of prospects with a website, the homepage+/contact combo
// only ever found an email on 39% of them — worth the extra ~5s/prospect
// worst case to try one more common path before giving up.
const CONTACT_FALLBACK_PATHS = ["/contact", "/contact-us"];
const CRAWL_FETCH_HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; EnomaBot/1.0; +https://enoma.io)" };

const MAX_CRAWL_REDIRECTS = 3;

// `website` comes from Outscraper/Google Maps listings — not something we
// control, so it could point at an internal address (RFC1918, loopback, the
// cloud-metadata link-local IP) either directly or via a redirect chain.
// Resolves the hostname and rejects anything that lands on a private/reserved
// IP before letting fetchPageText touch it.
async function assertPublicHost(url) {
  const { hostname, protocol } = new URL(url);
  if (protocol !== "http:" && protocol !== "https:") {
    throw new Error(`Blocked non-http(s) protocol: ${protocol}`);
  }
  const addresses = await dns.lookup(hostname, { all: true });
  if (!addresses.length || addresses.some(a => isPrivateOrReservedIp(a.address))) {
    throw new Error(`Blocked private/unresolvable host: ${hostname}`);
  }
}

// `ok: false` means the page was never actually read (blocked, timed out,
// errored, or resolved to a disallowed host) — distinct from `ok: true,
// html: "..."` where we genuinely read the page and it just has no email.
// Conflating these previously mislabeled bot-blocked sites (e.g. a 403) as
// "no_email_found", which reads as "we checked, there's nothing" when we
// never actually saw the content. Follows redirects manually (rather than
// fetch's default auto-follow) so every hop gets the same host validation as
// the initial URL — an internal-safe start could still redirect internal.
async function fetchPageText(url, timeoutMs) {
  let currentUrl = url;
  for (let hop = 0; hop <= MAX_CRAWL_REDIRECTS; hop++) {
    try {
      await assertPublicHost(currentUrl);
    } catch {
      return { ok: false, html: null };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(currentUrl, { signal: controller.signal, headers: CRAWL_FETCH_HEADERS, redirect: "manual" });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        currentUrl = new URL(res.headers.get("location"), currentUrl).toString();
        continue;
      }
      if (!res.ok) return { ok: false, html: null };
      return { ok: true, html: await res.text() };
    } catch {
      return { ok: false, html: null };
    } finally {
      clearTimeout(timeout);
    }
  }
  return { ok: false, html: null };
}

// Tries the homepage first, then one contact-page fallback if the homepage
// has no extractable email. Returns the HTML actually used for gap
// assessment even when no email was found, so a real "has a site but no
// findable email" prospect can still get a site-quality read. `fetched`
// tells the caller whether any page was actually read successfully, so it
// can tell a genuine "no email on this site" apart from "site blocked us."
async function findEmailForWebsite(website) {
  let base;
  try {
    base = new URL(website.match(/^https?:\/\//) ? website : `https://${website}`);
  } catch {
    return { emails: [], html: null, homeHtml: null, homeUrl: null, domain: null, fetched: false };
  }
  const domain = base.hostname.replace(/^www\./, "");

  const homepage = await fetchPageText(base.toString(), 6000);
  let emails = extractEmails(homepage.html);
  let html = homepage.html;
  let fetched = homepage.ok;

  for (const path of CONTACT_FALLBACK_PATHS) {
    if (emails.length) break;
    const contact = await fetchPageText(`${base.origin}${path}`, 5000);
    fetched = fetched || contact.ok;
    const contactEmails = extractEmails(contact.html);
    if (contactEmails.length) {
      emails = contactEmails;
      html = contact.html;
    }
  }

  // homeHtml/homeUrl: the homepage specifically, for objective site checks
  // (siteChecks) — `html` may be a contact page if that's where the email was.
  return { emails, html, homeHtml: homepage.html, homeUrl: base.toString(), domain, fetched };
}

// Only called once a real email has been found — no point spending an OpenAI
// call assessing a site whose owner we still can't reach.
async function assessSiteGaps(prospect, pageText) {
  const prompt = `Read this local ${prospect.trade || "service"} business's actual website text below and find genuine gaps — things a real customer would notice missing when reading THIS text, not a generic checklist of things small-business sites often lack.

Business: ${prospect.business_name}
Website text (truncated, HTML stripped):
"""
${pageText || "(page could not be fetched)"}
"""

Rules:
- Every gap must be something you can point to as specifically absent from the text above — not a default assumption. If the text is too short/generic to judge something confidently, leave it out rather than guessing.
- Do not reuse the same handful of generic complaints (booking forms, reviews, calls-to-action) unless the text you read genuinely lacks them — treat those as neither more nor less likely than any other real gap you notice.
- If two gaps you're about to list would apply to almost any small business site regardless of what this one actually says, drop the weaker one.

Return ONLY valid JSON: {"tier": "weak_site" | "good_site", "gaps": ["short specific gap", ...]}. Use "good_site" only if the site already covers the basics well and there's genuinely nothing substantive to pitch — in that case gaps must be an empty array. Otherwise use "weak_site" with 1-3 gaps, each under 15 words.`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o",
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You are a JSON API. You ONLY return valid JSON." },
        { role: "user", content: prompt }
      ]
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || "OpenAI gap-assessment request failed");
  const parsed = JSON.parse(data.choices[0].message.content);
  const tier = parsed.tier === "good_site" ? "good_site" : "weak_site";
  return { tier, gaps: tier === "weak_site" && Array.isArray(parsed.gaps) ? parsed.gaps.slice(0, 3) : [] };
}

// Crawls prospects that have a website but haven't been email-crawled yet.
// For each: find an email (checking suppression_list before ever saving one),
// then — only if an email was found and not suppressed — assess the site for
// gaps and draft a gap-aware outreach email via generateDraftCopy. A
// good_site match still gets marked reviewed so it's not offered a
// "replace your website" pitch that doesn't apply.
// Core crawl logic for a single batch, split out from handleCrawlWebsites so
// the daily cron pipeline (handleDailyPipeline, below) can call it directly
// without going through a req/res cycle.
// A fetch_failed prospect (site blocked us / timed out / errored) never got
// its content read at all, unlike no_email_found — so it's worth one retry
// after this cooldown rather than abandoning it forever. no_email_found is
// NOT retried: that page was actually read and genuinely had nothing.
const FETCH_FAILED_RETRY_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

async function crawlWebsitesOnce({ limit = 6, deadline } = {}) {
  const cappedLimit = Math.min(limit || 6, 15);

  const { data: prospects, error } = await supabase
    .from("prospects")
    .select("id, business_name, trade, city, state, phone, address, website, preview_url, google_place_id, raw")
    .not("website", "is", null)
    .is("email", null)
    .or(`email_crawl_status.is.null,and(email_crawl_status.eq.fetch_failed,updated_at.lt.${new Date(Date.now() - FETCH_FAILED_RETRY_AFTER_MS).toISOString()})`)
    .limit(cappedLimit);
  if (error) throw error;

  const results = [];
  for (const prospect of prospects || []) {
    // Each prospect can cost up to ~16s worst-case (homepage + 2 contact-path
    // fetch timeouts) plus OpenAI latency, so `limit` alone doesn't bound
    // wall-clock time — a
    // caller chaining this with other steps (handleDailyPipeline) passes a
    // shared deadline so this stops early rather than risk the platform
    // hard-killing the whole request mid-batch with no response at all.
    // Prospects not yet reached are simply untouched, same as any other
    // batch boundary — picked up on the next run.
    if (deadline && Date.now() > deadline) break;
    try {
      const { emails, html, homeHtml, homeUrl, domain, fetched } = await findEmailForWebsite(prospect.website);
      const email = pickBestEmail(emails, domain);

      if (!email) {
        // Only report "no_email_found" if we actually read a page — a
        // blocked/errored fetch means we never really checked.
        const status = fetched ? "no_email_found" : "fetch_failed";
        await supabase.from("prospects")
          .update({ email_crawl_status: status, updated_at: new Date().toISOString() })
          .eq("id", prospect.id);
        results.push({ business_name: prospect.business_name, website: prospect.website, email_crawl_status: status });
        continue;
      }

      const { data: suppressed } = await supabase
        .from("suppression_list").select("id").eq("email", email).maybeSingle();
      if (suppressed) {
        await supabase.from("prospects")
          .update({ email_crawl_status: "suppressed", updated_at: new Date().toISOString() })
          .eq("id", prospect.id);
        results.push({ business_name: prospect.business_name, website: prospect.website, email_crawl_status: "suppressed" });
        continue;
      }

      const llm = await assessSiteGaps(prospect, htmlToText(html));
      // Objective checks decide the tier (the LLM alone called ~98% of sites
      // weak); concrete, verifiable problems lead the pitch, LLM gaps fill in.
      const checks = siteChecks(homeHtml || html, homeUrl || prospect.website);
      const tier = decideSiteTier(checks, llm.tier);
      const gaps = tier === "weak_site"
        ? [...checks.pitches, ...llm.gaps].slice(0, 3)
        : [];

      if (tier === "good_site") {
        await supabase.from("prospects")
          .update({ email, email_crawl_status: "found", site_tier: tier, site_gaps: gaps, status: "reviewed", updated_at: new Date().toISOString() })
          .eq("id", prospect.id);
        results.push({ business_name: prospect.business_name, email, site_tier: tier, drafted: false });
        continue;
      }

      // Every outreach email now carries the prospect's own preview page, so
      // nothing is drafted here. Weak-site prospects with an email queue as
      // needs_preview; prepareOutreachOnce (below) verifies the mailbox,
      // builds the page, then drafts. Keeps this crawl step fast.
      // Only the objectively verified problems go in the email itself.
      const emailGaps = checks.pitches.length ? checks.pitches : gaps;
      await supabase.from("prospects")
        .update({
          email, email_crawl_status: "found", site_tier: tier, site_gaps: emailGaps,
          status: "needs_preview",
          updated_at: new Date().toISOString()
        })
        .eq("id", prospect.id);
      results.push({ business_name: prospect.business_name, email, site_tier: tier, gaps: emailGaps, queued_for_preview: true });
    } catch (err) {
      // Every branch above writes its terminal status and `continue`s
      // immediately, so anything reaching here failed *after* a successful
      // fetch — suppression lookup, OpenAI gap assessment, draft generation,
      // or a Supabase write — never a fetch problem. The row is untouched
      // (email/email_crawl_status still null), so deliberately don't write a
      // terminal status here: it naturally gets retried on the next crawl
      // batch instead of being permanently mislabeled fetch_failed and
      // silently dropped from the pipeline over a transient OpenAI/DB error.
      results.push({ business_name: prospect.business_name, website: prospect.website, email_crawl_status: "error_will_retry", error: err.message });
    }
  }

  return {
    // results.length (not (prospects || []).length) so an early deadline
    // exit correctly reports only what was actually processed.
    attempted: results.length,
    emails_found: results.filter(r => r.email).length,
    queued_for_preview: results.filter(r => r.queued_for_preview).length,
    results
  };
}

async function handleCrawlWebsites(req, res) {
  const limit = parseInt(req.query.limit, 10) || 6;
  const result = await crawlWebsitesOnce({ limit });
  return res.status(200).json({ success: true, ...result });
}


// ── Automatic preview pages ────────────────────────────────────────────────
// Builds an unclaimed enoma.io/<slug> page for a prospect from ONLY their own
// website text + Google Business Profile (see _lib/preview-generator.js for
// the facts-only rules). Used by the crawl step (weak-site prospects get a
// page before their outreach is drafted, so the email can show it) and by
// action=generate_preview for one-offs (e.g. phone/text outreach).

async function fetchPlaceDetails(placeId) {
  if (!placeId || !process.env.GOOGLE_SERVER_PLACES_KEY) return null;
  const fields = "displayName,formattedAddress,nationalPhoneNumber,rating,userRatingCount,reviews,regularOpeningHours.weekdayDescriptions,types,primaryTypeDisplayName,websiteUri";
  const r = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    headers: { "X-Goog-Api-Key": process.env.GOOGLE_SERVER_PLACES_KEY, "X-Goog-FieldMask": fields }
  });
  if (!r.ok) return null;
  return r.json();
}

// Homepage + up to two same-site pages that look like services / service
// area / about, so the generator sees what they actually offer and where.
async function gatherSiteText(website, homeHtmlHint) {
  let base;
  // Some Google listings store "site.com/%3Futm_source%3D..." — drop that.
  const cleaned = String(website).replace(/%3F.*$/i, "");
  try { base = new URL(cleaned.match(/^https?:\/\//) ? cleaned : `https://${cleaned}`); } catch { return { text: "", homeHtml: null, homeUrl: null }; }
  base.search = ""; // strip GBP utm params baked into some listings
  const home = homeHtmlHint ? { ok: true, html: homeHtmlHint } : await fetchPageText(base.toString(), 6000);
  if (!home.ok || !home.html) return { text: "", homeHtml: null, homeUrl: base.toString() };
  const links = [...home.html.matchAll(/href=["']([^"'#]+)["']/gi)].map(m => m[1])
    .map(h => { try { return new URL(h, base); } catch { return null; } })
    .filter(u => u && u.hostname === base.hostname && /(service|area|about|what-we-do)/i.test(u.pathname))
    .map(u => u.origin + u.pathname);
  const extra = [];
  for (const u of [...new Set(links)].slice(0, 2)) {
    const pg = await fetchPageText(u, 5000);
    if (pg.ok && pg.html) extra.push(htmlToText(pg.html));
  }
  return { text: [htmlToText(home.html), ...extra].join("\n\n").slice(0, 12000), homeHtml: home.html, homeUrl: base.toString() };
}

async function uniqueSlug(base) {
  let slug = base || "business";
  for (let i = 1; i < 50; i++) {
    const { data } = await supabase.from("small_business_profiles").select("id").eq("username", slug).maybeSingle();
    if (!data) return slug;
    slug = `${base}-${i + 1}`;
  }
  throw new Error("Could not find a free slug");
}

async function generatePreviewForProspect(prospect, { homeHtml, force = false } = {}) {
  if (prospect.preview_url && !force) return { skipped: "already_has_preview", preview_url: prospect.preview_url };

  const raw = prospect.raw || {};
  const place = await fetchPlaceDetails(prospect.google_place_id);
  const rating = Number(place?.rating ?? raw.rating) || null;
  const reviewCount = Number(place?.userRatingCount ?? raw.reviews) || 0;
  const phone = place?.nationalPhoneNumber || prospect.phone || raw.phone || null;

  const site = prospect.website ? await gatherSiteText(prospect.website, homeHtml) : { text: "", homeHtml: null, homeUrl: null };
  const checks = site.homeHtml ? siteChecks(site.homeHtml, site.homeUrl) : { score: 0 };
  const gate = qualifiesForPreview({ rating, reviewCount, hasWebsite: !!prospect.website, siteCheckScore: checks.score, phone });
  if (!gate.ok && !force) return { skipped: gate.reason };

  const trade = place?.primaryTypeDisplayName?.text || prospect.trade || raw.type || "local service";
  const hours = place?.regularOpeningHours?.weekdayDescriptions || [];
  const address = place?.formattedAddress || prospect.address || null;
  const prompt = buildFactsPrompt({
    name: prospect.business_name, trade, city: prospect.city, state: stateAbbr(prospect.state), phone, address,
    siteText: site.text, googleTypes: (place?.types || []).slice(0, 5), hours,
  });
  const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o", temperature: 0, response_format: { type: "json_object" },
      messages: [{ role: "system", content: "You are a JSON API. You ONLY return valid JSON." }, { role: "user", content: prompt }]
    })
  });
  const ai = await aiRes.json();
  if (!aiRes.ok) throw new Error(ai?.error?.message || "OpenAI preview generation failed");
  const copy = validateGenerated(JSON.parse(ai.choices[0].message.content), { siteText: site.text, phone, address, hours, city: prospect.city, trade });

  const slug = await uniqueSlug(slugify(prospect.business_name));
  const profile = assembleProfile({
    slug, name: prospect.business_name, trade, city: prospect.city, state: prospect.state, phone, address,
    placeId: prospect.google_place_id, rating, reviewCount, googleReviews: place?.reviews || [], copy,
  });

  const { data: biz, error: bizErr } = await supabase.from("businesses").insert({
    name: prospect.business_name, slug, phone, city: prospect.city, state: profile.state, region: prospect.state, country: "US",
    industry: trade, primary_category: profile.primary_category, is_internal: false, is_published: false,
    google_maps_url: prospect.google_place_id ? `https://www.google.com/maps/search/?api=1&query_place_id=${prospect.google_place_id}` : null,
    ai_generated_at: new Date().toISOString(),
  }).select("id").single();
  if (bizErr) throw bizErr;

  // Unclaimed previews stay visitable for PREVIEW_TRIAL_DAYS (website_is_active
  // reads this row), then show the inactive page unless claimed.
  const { error: subErr } = await supabase.from("subscriptions").insert({
    business_id: biz.id, provider: "stripe", plan_code: "starter", status: "trialing", is_trial: true,
    trial_starts_at: new Date().toISOString(),
    trial_expires_at: new Date(Date.now() + PREVIEW_TRIAL_DAYS * 86400000).toISOString(),
  });
  if (subErr) throw subErr;

  const { error: profErr } = await supabase.from("small_business_profiles").insert({ ...profile, business_id: biz.id });
  if (profErr) throw profErr;

  const preview_url = `https://enoma.io/${slug}`;
  await supabase.from("prospects").update({ preview_url, preview_business_id: biz.id, updated_at: new Date().toISOString() }).eq("id", prospect.id);
  return { preview_url, slug, site_checks: checks.signals || [], rating, reviewCount };
}


// ── Monthly results email ─────────────────────────────────────────────────
// On the 1st (vercel.json cron), every claimed, active customer gets last
// month's numbers: visits, taps to call, quote requests. ?dry_run=1 returns
// the emails without sending; ?test_to=addr sends every email to that address
// instead of the customer (use this to proofread). Idempotent per month via
// small_business_profiles.results_email_last_sent_at.
async function handleResultsEmail(req, res) {
  const dryRun = req.query.dry_run === "1";
  const testTo = req.query.test_to ? String(req.query.test_to) : null;
  const { start, end, label } = previousMonth(new Date());

  const { data: profiles, error } = await supabase
    .from("small_business_profiles")
    .select("business_id, username, business_name, owner_name, email, custom_domain, results_email_opt_out, results_email_last_sent_at, is_claimed")
    .eq("is_claimed", true)
    .not("email", "is", null);
  if (error) throw error;

  const results = [];
  for (const p of profiles || []) {
    const skip = reason => results.push({ business: p.business_name, skipped: reason });
    if (p.results_email_opt_out) { skip("opted_out"); continue; }
    if (!p.email || /@enoma\.io$/i.test(p.email)) { skip("no_customer_email"); continue; }
    if (!testTo && p.results_email_last_sent_at && new Date(p.results_email_last_sent_at) >= end) { skip("already_sent"); continue; }
    const { data: active } = await supabase.rpc("website_is_active", { p_business_id: p.business_id });
    if (active === false) { skip("inactive"); continue; }

    const [{ count: views }, { data: clicks }, { count: quotes }] = await Promise.all([
      supabase.from("page_events").select("id", { count: "exact", head: true })
        .eq("slug", p.username).eq("event", "page_view").not("is_internal", "is", true)
        .gte("created_at", start.toISOString()).lt("created_at", end.toISOString()),
      supabase.from("page_events").select("metadata")
        .eq("slug", p.username).eq("event", "contact_click").not("is_internal", "is", true)
        .gte("created_at", start.toISOString()).lt("created_at", end.toISOString()),
      supabase.from("contact_submissions").select("id", { count: "exact", head: true })
        .eq("business_id", p.business_id)
        .gte("created_at", start.toISOString()).lt("created_at", end.toISOString()),
    ]);
    const { calls, other } = tallyClicks(clicks);
    const pageUrl = p.custom_domain ? `https://${p.custom_domain}/` : `https://enoma.io/${p.username}`;
    const email = buildResultsEmail({
      businessName: p.business_name, ownerName: (p.owner_name || "").split(" ")[0] || null, monthLabel: label,
      views: views || 0, calls, otherClicks: other, quoteRequests: quotes || 0, pageUrl,
    });
    if (!email) { skip("no_visits_this_month"); continue; }

    const to = testTo || p.email;
    if (dryRun) { results.push({ business: p.business_name, to, ...email }); continue; }
    if (!resend) throw new Error("RESEND_API_KEY not configured");
    const text = `${email.text}\n\n—\nDon't want these monthly summaries? Reply "stop" and I'll turn them off.`;
    const { error: sendErr } = await resend.emails.send({
      from: "Jack at Enoma <jack@enoma.io>", to, replyTo: "jack@enoma.io",
      subject: email.subject, text, html: wrapEmailHtml(plainTextToHtml(text)),
    });
    if (sendErr) { results.push({ business: p.business_name, error: sendErr.message }); continue; }
    if (!testTo) {
      await supabase.from("small_business_profiles").update({ results_email_last_sent_at: new Date().toISOString() }).eq("business_id", p.business_id);
    }
    results.push({ business: p.business_name, to, sent: true, subject: email.subject });
  }
  return res.status(200).json({ success: true, month: label, dry_run: dryRun, test_to: testTo, results });
}

async function handleGeneratePreview(req, res) {
  const id = (req.query.prospect_id || req.body?.prospect_id || "").toString();
  if (!id) return res.status(400).json({ error: "prospect_id required" });
  const { data: prospect, error } = await supabase.from("prospects").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!prospect) return res.status(404).json({ error: "Prospect not found" });
  const result = await generatePreviewForProspect(prospect, { force: req.query.force === "1" });
  return res.status(200).json({ success: true, business_name: prospect.business_name, ...result });
}

const ENOMA_ADMIN_EMAIL = "jack@enoma.io";

// Shared by every browser-facing (JWT bearer) admin action — voice-query,
// sales_queue, update_lead_status. Distinct from the x-admin-secret gate
// further below, which is for server-to-server/cron-style calls that never
// run in a browser (the secret can't safely be embedded client-side).
async function requireAdmin(req) {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  if (!token) return null;
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user || user.email !== ENOMA_ADMIN_EMAIL) return null;
  return user;
}

// ==================== Voice agent tools ====================
// Each tool is a real Supabase/GA query — the model never invents numbers,
// it calls one of these and we hand back real data.

async function toolGetRevenueStatus() {
  const { data: subs, error } = await supabase
    .from("subscriptions")
    .select("provider, status, is_trial, trial_expires_at, plan_code, businesses(name, is_internal)");
  if (error) throw error;

  const rows = (subs || []).filter(s => !s.businesses?.is_internal);
  const now = new Date();
  const paying = rows.filter(s => s.provider === "stripe" && s.status === "active");
  const comped = rows.filter(s => s.provider === "comped");
  const activeTrials = rows.filter(s => s.is_trial && s.trial_expires_at && new Date(s.trial_expires_at) > now);
  const stalledTrials = rows.filter(s =>
    s.is_trial && s.trial_expires_at && new Date(s.trial_expires_at) <= now && s.status !== "active"
  );
  // Legacy plan price. Existing subscribers are still billed on the original
  // $19.99 Stripe price, so MRR stays computed at that rate until they migrate.
  // New signups are quoted $49/mo (starter) — update when the old price is retired.
  const PRICE = 19.99;

  return {
    mrr: Math.round(paying.length * PRICE * 100) / 100,
    paying_count: paying.length,
    paying_businesses: paying.map(s => s.businesses?.name),
    comped_count: comped.length,
    comped_businesses: comped.map(s => s.businesses?.name),
    active_trial_count: activeTrials.length,
    stalled_trial_count: stalledTrials.length,
    stalled_trial_businesses: stalledTrials.map(s => s.businesses?.name),
    potential_mrr_if_stalled_convert: Math.round(stalledTrials.length * PRICE * 100) / 100
  };
}

async function toolGetMarketingTraffic() {
  const property = `properties/${process.env.GA_PROPERTY_ID}`;
  const [daily] = await client.runReport({
    property,
    dateRanges: [{ startDate: "7daysAgo", endDate: "today" }],
    metrics: [{ name: "activeUsers" }, { name: "screenPageViews" }, { name: "sessions" }],
    dimensions: [{ name: "date" }],
    orderBys: [{ dimension: { dimensionName: "date" } }]
  });
  const [channels] = await client.runReport({
    property,
    dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
    metrics: [{ name: "sessions" }, { name: "activeUsers" }],
    dimensions: [{ name: "sessionDefaultChannelGroup" }],
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }]
  });
  let searchConsole;
  try {
    searchConsole = await fetchSearchConsoleData();
  } catch (err) {
    searchConsole = { error: `Search Console unavailable: ${err.message}` };
  }

  return {
    last_7_days: (daily.rows || []).map(r => ({
      date: r.dimensionValues[0].value,
      activeUsers: r.metricValues[0].value,
      pageViews: r.metricValues[1].value,
      sessions: r.metricValues[2].value
    })),
    channels_last_30_days: (channels.rows || []).map(r => ({
      channel: r.dimensionValues[0].value,
      sessions: r.metricValues[0].value,
      activeUsers: r.metricValues[1].value
    })),
    search_console: searchConsole
  };
}

async function toolGetCrmProspects(args) {
  let q = supabase.from("prospects").select("business_name, trade, city, state, phone, email, status, draft_subject, created_at");
  if (args?.status) q = q.eq("status", args.status);
  if (args?.trade) q = q.eq("trade", args.trade);
  const { data, error } = await q.order("created_at", { ascending: false });
  if (error) throw error;
  return {
    count: data.length,
    prospects: data.map(p => ({ ...p, has_draft: !!p.draft_subject, draft_subject: undefined }))
  };
}

async function findProspect(businessName) {
  const { data, error } = await supabase
    .from("prospects")
    .select("id, business_name, trade, city, state, phone, email, website, site_gaps, preview_url, status, draft_subject, draft_body")
    .ilike("business_name", `%${businessName}%`)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Drafting is a separate, non-tool-calling OpenAI completion — same raw-fetch
// pattern already used for page copy in generate-business.js.
async function generateDraftCopy(prospect, instructions) {
  // Rules learned the hard way (Sept 2026 review of 128 sends, 0 replies):
  // the old prompt told the model the business "isn't showing up in local
  // search" (unverified — often false for a 100-review business) and let it
  // describe Conway's results as "significant improvement in call volume"
  // (not something we can show). Only verifiable statements now.
  const campaignSlug = (prospect.trade || "general").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "general";
  const SIGNUP_URL = `https://enoma.io/signup?utm_source=cold_email&utm_medium=email&utm_campaign=outreach_${campaignSlug}`;
  const gaps = Array.isArray(prospect.site_gaps) ? prospect.site_gaps.filter(Boolean).slice(0, 3) : [];
  const siteHost = prospect.website ? String(prospect.website).replace(/%3F.*$/i, "").replace(/^https?:\/\//, "").replace(/\/.*$/, "") : "";

  let brief;
  if (prospect.preview_url) {
    // The strongest honest hook: a real page, already built from their own info.
    // The model writes ONLY the intro. buildOutreachEmail (outreach-email.js)
    // appends the page preview card, the "Keep my page live" button, the
    // reply-yes line and the sign-off, with tracked links.
    brief = `STRUCTURE (follow it; this is only the opening of the email — the page link, button, reply line and sign-off are added after it automatically):
1. One line: I'm Jack; I build websites for trades businesses in ${prospect.state || "New England"}.
2. I put together a new page for ${prospect.business_name} using what's already on their ${prospect.website ? "website and " : ""}Google profile — it's below. Do NOT include any URL.${gaps.length && siteHost ? `\n3. A short list comparing it with ${siteHost}, one line per item, using ONLY these verified problems with their current site (rephrase each as what the new page does instead): ${gaps.join("; ")}` : ""}
${gaps.length && siteHost ? "4" : "3"}. Pricing, exactly: "The first month is free. After that it's $49/month, or $99/month if you want me to handle all the updates. No contract."
Do NOT add a closing line, a call to action, or a sign-off.`;
  } else {
    brief = `STRUCTURE:
1. One line: I'm Jack; I build websites for trades businesses in ${prospect.state || "New England"}.
2. ${gaps.length && siteHost ? `Name ONE of these verified problems with ${siteHost} and why it costs them calls: ${gaps[0]}` : `They don't have a website, so homeowners who search for a ${prospect.trade || "local service"} business can't find a page for them.`}
3. Enoma builds a one-page site made to turn a local search into a call. First month free, then $49/month; no contract.
4. Close, exactly: "Want me to build yours? Reply \"yes\" and I'll set it up — or ${SIGNUP_URL} to start it yourself."`;
  }

  const prompt = `Write a short, plain cold email from Jack at Enoma to ${prospect.business_name} (${prospect.trade || "local service business"}, ${[prospect.city, prospect.state].filter(Boolean).join(", ") || "location unknown"}).

${brief}
${prospect.draft_body ? `\nExisting draft to revise:\nSubject: ${prospect.draft_subject}\n${prospect.draft_body}\n\nRevision instructions: ${instructions || "improve it generally"}` : ""}
${!prospect.draft_body && instructions ? `\nSpecific instructions: ${instructions}` : ""}

RULES: Only state facts given above. Never claim they are invisible on Google, losing customers, or ranking poorly. Never cite results or numbers for other customers. No compliments about their current site, no false urgency, no markdown (bare URLs only). Open with "Hi there,". Subject line: specific to ${prospect.business_name}${prospect.preview_url ? ` and the new page (e.g. "I built ${prospect.business_name} a new page")` : ""}.${prospect.preview_url ? " No sign-off." : ' Sign off "Jack Clark\nEnoma · jack@enoma.io".'} Under ${prospect.preview_url ? 90 : 140} words. Return ONLY valid JSON: {"subject": "...", "body": "..."}`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o",
      temperature: 0.6,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You are a JSON API. You ONLY return valid JSON." },
        { role: "user", content: prompt }
      ]
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || "OpenAI draft request failed");
  return JSON.parse(data.choices[0].message.content);
}

async function toolDraftOutreachEmail(args) {
  const prospect = await findProspect(args.business_name);
  if (!prospect) return { error: `No prospect found matching "${args.business_name}"` };

  const draft = await generateDraftCopy(prospect, args.instructions);

  const { error } = await supabase
    .from("prospects")
    .update({ draft_subject: draft.subject, draft_body: draft.body, status: "drafted", updated_at: new Date().toISOString() })
    .eq("id", prospect.id);
  if (error) throw error;

  return { business_name: prospect.business_name, subject: draft.subject, body: draft.body, status: "drafted" };
}

async function toolGetOutreachDraft(args) {
  const prospect = await findProspect(args.business_name);
  if (!prospect) return { error: `No prospect found matching "${args.business_name}"` };
  if (!prospect.draft_body) return { business_name: prospect.business_name, has_draft: false };
  return {
    business_name: prospect.business_name,
    subject: prospect.draft_subject,
    body: prospect.draft_body,
    status: prospect.status
  };
}

async function toolApproveOutreachEmail(args) {
  const prospect = await findProspect(args.business_name);
  if (!prospect) return { error: `No prospect found matching "${args.business_name}"` };
  if (!prospect.draft_body) return { error: `${prospect.business_name} has no draft yet — draft one first.` };

  const { error } = await supabase
    .from("prospects")
    .update({ status: "approved", updated_at: new Date().toISOString() })
    .eq("id", prospect.id);
  if (error) throw error;

  return {
    business_name: prospect.business_name,
    status: "approved",
    note: "Marked 'approved' — this takes it OUT of the automated pipeline. The daily send_outreach cron only sends prospects still at status='drafted', so this one won't be auto-sent; send it yourself, or leave it at 'drafted' if you want the cron to send it for you."
  };
}

// Batch-drafts outreach emails for every prospect that actually has an email
// on file. Most prospects won't (see handleProspectPull) — this only ever
// touches the subset where email is not null, and never re-drafts a prospect
// that's already drafted/approved unless force=true. Capped and ordered by
// oldest-updated-first so repeated calls make forward progress rather than
// re-processing the same subset every time (each regeneration bumps
// updated_at, which naturally rotates it to the back of the queue) — same
// reason handleCrawlWebsites is batched, this file has a 60s maxDuration and
// force=true with no limit at all previously blew straight through it.
// Core batch-draft logic, split out from handleDraftAll so the daily cron
// pipeline (handleDailyPipeline, below) can call it directly without going
// through a req/res cycle.
async function draftAllOnce({ limit = 8, force = false, deadline } = {}) {
  const cappedLimit = Math.min(limit || 8, 15);
  let q = supabase
    .from("prospects")
    .select("id, business_name, trade, city, state, phone, email, website, site_gaps, preview_url, status, draft_subject, draft_body")
    .not("email", "is", null)
    // Every outreach email carries the prospect's preview page — no page,
    // no draft. Prospects without one go through prepareOutreachOnce.
    .not("preview_url", "is", null)
    // reviewed means the crawler already decided this one is a good_site
    // with nothing honest to pitch — that verdict holds regardless of
    // force, it isn't a "haven't gotten to it yet" state like the others.
    .neq("status", "reviewed");
  if (!force) q = q.not("status", "in", "(drafted,sending,approved,sent,invalid_email,claimed,needs_preview,verify_retry,no_preview)");
  q = q.order("updated_at", { ascending: true }).limit(cappedLimit);

  const { data: prospects, error } = await q;
  if (error) throw error;

  const results = [];
  for (const prospect of prospects || []) {
    // Same shared-deadline reasoning as crawlWebsitesOnce — a caller
    // chaining multiple steps (handleDailyPipeline) needs this to stop
    // early rather than risk the whole request timing out with no response.
    if (deadline && Date.now() > deadline) break;
    try {
      const draft = await generateDraftCopy(prospect, null);
      const { error: updateErr } = await supabase
        .from("prospects")
        .update({ draft_subject: draft.subject, draft_body: draft.body, status: "drafted", updated_at: new Date().toISOString() })
        .eq("id", prospect.id);
      if (updateErr) throw updateErr;
      results.push({ business_name: prospect.business_name, email: prospect.email, subject: draft.subject, drafted: true });
    } catch (err) {
      results.push({ business_name: prospect.business_name, email: prospect.email, drafted: false, error: err.message });
    }
  }

  return {
    // results.length so an early deadline exit reports only what actually ran.
    attempted: results.length,
    drafted: results.filter(r => r.drafted).length,
    failed: results.filter(r => !r.drafted).length,
    results
  };
}

// ── Outreach prep: verify mailbox → build preview page → draft ─────────────
// Takes prospects the crawler queued as needs_preview (weak site + found
// email) and gets each one fully ready to send, cheapest check first:
//   1. Mailbox check — ZeroBounce if ZEROBOUNCE_API_KEY is set (invalid/
//      spamtrap/etc. dropped, temporary failures retried after 3 days),
//      otherwise just an MX lookup on the domain.
//   2. Preview page (generatePreviewForProspect). Prospects that don't pass
//      the page-quality gate (no phone, thin rating) are set aside as
//      no_preview: every email has to show a real page.
//   3. Draft the intro copy around that page.
// Each prospect costs ~15-25s (two OpenAI calls + site/Places fetches), so
// this runs on its own crons several times a day under the shared deadline.
const VERIFY_RETRY_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

async function prepareOutreachOnce({ limit = 4, deadline } = {}) {
  const retryBefore = new Date(Date.now() - VERIFY_RETRY_AFTER_MS).toISOString();
  const { data: prospects, error } = await supabase
    .from("prospects")
    .select("id, business_name, trade, city, state, phone, address, email, website, site_gaps, preview_url, google_place_id, raw, status, draft_subject, draft_body")
    .not("email", "is", null)
    .or(`status.eq.needs_preview,and(status.eq.verify_retry,updated_at.lt.${retryBefore})`)
    .order("updated_at", { ascending: true })
    .limit(Math.min(limit || 4, 10));
  if (error) throw error;

  const results = [];
  for (const prospect of prospects || []) {
    if (deadline && Date.now() > deadline - 20000) break;
    const now = () => new Date().toISOString();
    try {
      const { data: suppressed } = await supabase
        .from("suppression_list").select("id").eq("email", prospect.email).maybeSingle();
      if (suppressed) {
        await supabase.from("prospects").update({ status: "invalid_email", updated_at: now() }).eq("id", prospect.id);
        results.push({ business_name: prospect.business_name, ready: false, reason: "suppressed" });
        continue;
      }

      // ZeroBounce when ZEROBOUNCE_API_KEY is set; otherwise only the free
      // MX check (domain accepts mail), with real bounces caught afterwards
      // by the Resend webhook -> suppression_list.
      let v = await verifyMailbox(prospect.email);
      if (v.decision === "unverified") {
        v = (await hasValidMx(prospect.email))
          ? { decision: "send", status: "mx_only", sub_status: null }
          : { decision: "drop", status: "no_mx", sub_status: null };
      }
      if (v.decision === "drop") {
        await supabase.from("prospects").update({ status: "invalid_email", updated_at: now() }).eq("id", prospect.id);
        results.push({ business_name: prospect.business_name, email: prospect.email, ready: false, reason: `mailbox_${v.status}` });
        continue;
      }
      if (v.decision !== "send" && v.decision !== "send_catch_all") {
        await supabase.from("prospects").update({ status: "verify_retry", updated_at: now() }).eq("id", prospect.id);
        results.push({ business_name: prospect.business_name, email: prospect.email, ready: false, reason: `verify_${v.sub_status || v.decision}` });
        continue;
      }

      let preview_url = prospect.preview_url;
      if (!preview_url) {
        const gen = await generatePreviewForProspect(prospect);
        preview_url = gen.preview_url || null;
        if (!preview_url) {
          await supabase.from("prospects").update({ status: "no_preview", updated_at: now() }).eq("id", prospect.id);
          results.push({ business_name: prospect.business_name, ready: false, reason: `no_preview_${gen.skipped || "failed"}` });
          continue;
        }
      }

      const draft = await generateDraftCopy({ ...prospect, preview_url, draft_body: null, draft_subject: null }, null);
      await supabase.from("prospects")
        .update({ draft_subject: draft.subject, draft_body: draft.body, status: "drafted", updated_at: now() })
        .eq("id", prospect.id);
      results.push({ business_name: prospect.business_name, email: prospect.email, mailbox: v.status, preview_url, subject: draft.subject, ready: true });
    } catch (err) {
      // Left at its current status so the next run retries it.
      await supabase.from("prospects").update({ updated_at: now() }).eq("id", prospect.id);
      results.push({ business_name: prospect.business_name, ready: false, error: err.message });
    }
  }

  return { attempted: results.length, ready: results.filter(r => r.ready).length, results };
}

async function handlePrepareOutreach(req, res) {
  const limit = parseInt(req.query.limit, 10) || 4;
  const result = await prepareOutreachOnce({ limit, deadline: Date.now() + DAILY_PIPELINE_BUDGET_MS });
  return res.status(200).json({ success: true, ...result });
}

async function handleDraftAll(req, res) {
  const force = req.query.force === "true";
  const limit = parseInt(req.query.limit, 10) || 8;
  const result = await draftAllOnce({ limit, force });
  return res.status(200).json({ success: true, ...result });
}

// Single entry point for the scheduled 6am ET Vercel Cron run: pulls fresh
// prospects (filters=none, since the crawler needs businesses that DO have a
// website — the opposite of handleProspectPull's own default), crawls one
// batch of newly-eligible websites for a contact email, then drafts outreach
// for anything left with an email but no draft. One action rather than
// separate chained crons, since Vercel Cron can't guarantee ordering between
// entries. Deliberately one batch per step (not looped to exhaustion) to
// stay well under this file's 60s maxDuration — same reasoning as
// crawlWebsitesOnce's own conservative per-call limit. Any backlog beyond
// one batch simply rolls into tomorrow's run, since crawlWebsitesOnce's
// query isn't date-scoped — it always picks up whatever's still uncrawled.
// Chaining three steps in one request means their limits (15/15, each sized
// to fit standalone under this file's own maxDuration) can add up well past
// it — confirmed in production as a guaranteed 504 (Vercel Runtime Timeout
// Error, no response returned at all). A single wall-clock deadline shared
// across crawl+draft fixes this: each step's loop bails as soon as the
// deadline passes (see crawlWebsitesOnce/draftAllOnce), so this always
// returns a clean response describing exactly what got done, instead of the
// platform silently killing the request mid-batch. 45s leaves real margin
// under the 60s maxDuration set for this file specifically (vercel.json) —
// pull() itself isn't deadline-guarded (one fast Outscraper call, not a
// per-item loop) so the full budget is available for crawl+draft. (Note:
// Vercel's `functions` config in vercel.json rejects a literal-path pattern
// overlapping a wildcard pattern that already matches the same file — the
// 60s maxDuration here applies to all of api/*.js, not just this file.)
const DAILY_PIPELINE_BUDGET_MS = 45000;

async function handleDailyPipeline(req, res) {
  // Landscaping/plumber were the only two trades ever pulled here, even
  // though the site's own concierge form (choose-path.html) lists 8
  // categories. Rotates through all of them by day of year (see
  // prospect-rotation.js) at the same Outscraper cost per pull — an explicit
  // ?trade= still wins for a manual one-off pull. ?tradeOffset lets the two
  // same-day cron entries (vercel.json) each land on a different trade
  // instead of both picking the day's same rotation value.
  const trade = req.query.trade
    ? req.query.trade.toString()
    : tradeForDate(new Date(), parseInt(req.query.tradeOffset, 10) || 0);
  // Attleboro alone saturates fast (repeat pulls return zero new listings
  // once the local market's been scanned) -- rotate through nearby towns by
  // day of year so the raw "new" pool keeps refilling. An explicit
  // ?location= still wins, for a manual one-off pull of a specific town.
  const location = req.query.location ? req.query.location.toString() : townForDate(new Date());
  const pullLimit = parseInt(req.query.limit, 10) || 25;
  const deadline = Date.now() + DAILY_PIPELINE_BUDGET_MS;

  const pull = await pullProspects({ trade, location, limit: pullLimit, filters: "none" });

  const crawl = Date.now() < deadline
    ? await crawlWebsitesOnce({ limit: 15, deadline })
    : { attempted: 0, emails_found: 0, drafted: 0, results: [], skipped_reason: "out of time after pull" };

  // Drafting moved to prepare_outreach (own crons): every email now needs a
  // verified mailbox and a built preview page first, which doesn't fit in
  // the time left after pull + crawl.
  return res.status(200).json({ success: true, trade, pull, crawl });
}

// Sends everything currently sitting at status='drafted' — the actual
// outbound step, triggered by its own daily cron (vercel.json) after both
// daily_pipeline runs finish. Deliberately only ever touches 'drafted', never
// 'approved': historically Jack used 'approved' to mean "I already sent this
// myself" (marked *after* copy/pasting into his own email client), not
// "reviewed and ready" — treating it as a send queue would re-send prospects
// who already got a real email. Capped per run (`limit`, default 20) to keep
// a fresh sending subdomain's volume ramping slowly rather than spiking.
// Every send goes through hasValidMx first — not a live mailbox probe (that
// gets a serverless IP flagged fast), just a cheap check that the domain has
// a mail server at all, catching typo'd/dead domains before they ever cost a
// send attempt. Real mailbox-level bounces are handled after the fact by the
// Resend webhook (handleResendWebhook, below) feeding suppression_list.
const SEND_OUTREACH_FROM = "Jack at Enoma <outreach@mail.enoma.io>";
// Hard ceiling on cold emails per day, whatever the cron or a caller asks for.
const OUTREACH_DAILY_CAP = 10;

async function handleSendOutreach(req, res) {
  const rampCap = rampCapForDate(new Date());
  // Count today's sends too, so a manual re-run can't push past the cap.
  const startOfDay = new Date(); startOfDay.setUTCHours(0, 0, 0, 0);
  const { count: sentToday } = await supabase.from("outreach_messages")
    .select("id", { count: "exact", head: true })
    .eq("channel", "email").eq("status", "sent").gte("sent_at", startOfDay.toISOString());
  const remaining = Math.max(0, Math.min(OUTREACH_DAILY_CAP, rampCap) - (sentToday || 0));
  const limit = Math.min(parseInt(req.query.limit, 10) || OUTREACH_DAILY_CAP, remaining);
  const captureReplies = process.env.OUTREACH_REPLY_CAPTURE === "1";

  const { data: prospects, error } = limit > 0
    ? await supabase
      .from("prospects")
      .select("id, business_name, email, draft_subject, draft_body, preview_url")
      .eq("status", "drafted")
      .not("email", "is", null)
      // No page, no email: every send shows the prospect their own page.
      .not("preview_url", "is", null)
      .order("updated_at", { ascending: true })
      .limit(limit)
    : { data: [], error: null };
  if (error) throw error;

  // ?dry_run=1 renders the next queued email as HTML (sample message id,
  // nothing written or sent) so the template can be checked in a browser.
  if (req.query.dry_run === "1") {
    const p = (prospects || [])[0];
    if (!p) return res.status(200).json({ success: true, dry_run: true, note: "No drafted prospect with a preview page is queued" });
    const sample = buildOutreachEmail({
      intro: p.draft_body, businessName: p.business_name, messageId: "00000000-0000-4000-8000-000000000000",
      slug: slugFromPreviewUrl(p.preview_url), unsubscribeUrl: buildUnsubscribeUrl(p.email), mailingAddress: MAILING_ADDRESS
    });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(`<!-- To: ${p.email} | Subject: ${p.draft_subject} -->\n${sample.html}`);
  }

  // Counts sends already made today plus sends in flight (message row
  // created, not yet marked sent), so overlapping runs share one cap.
  const usedToday = async () => {
    const { count } = await supabase.from("outreach_messages")
      .select("id", { count: "exact", head: true })
      .eq("channel", "email").in("status", ["sent", "drafted"]).gte("created_at", startOfDay.toISOString());
    return count || 0;
  };

  const results = [];
  for (const prospect of prospects || []) {
    if ((await usedToday()) >= Math.min(OUTREACH_DAILY_CAP, rampCap)) break;
    // Reserve this prospect: only one run can move it out of 'drafted', so
    // a cron retry or a manual run at the same time can't email it twice.
    const { data: reserved } = await supabase.from("prospects")
      .update({ status: "sending", updated_at: new Date().toISOString() })
      .eq("id", prospect.id).eq("status", "drafted").select("id");
    if (!reserved?.length) continue;

    const slug = slugFromPreviewUrl(prospect.preview_url);
    if (!slug) {
      await supabase.from("prospects").update({ status: "no_preview", updated_at: new Date().toISOString() }).eq("id", prospect.id);
      results.push({ business_name: prospect.business_name, sent: false, reason: "bad_preview_url" });
      continue;
    }
    const { data: suppressed } = await supabase
      .from("suppression_list").select("id").eq("email", prospect.email).maybeSingle();
    if (suppressed) {
      await supabase.from("prospects").update({ status: "invalid_email", updated_at: new Date().toISOString() }).eq("id", prospect.id);
      results.push({ business_name: prospect.business_name, email: prospect.email, sent: false, reason: "suppressed" });
      continue;
    }
    if (!(await hasValidMx(prospect.email))) {
      await supabase.from("prospects").update({ status: "invalid_email", updated_at: new Date().toISOString() }).eq("id", prospect.id);
      results.push({ business_name: prospect.business_name, email: prospect.email, sent: false, reason: "no_mx_record" });
      continue;
    }

    // The message row is created first so its id can go into every link,
    // the Reply-To address and the Resend tags of this exact email.
    let messageId = null;
    let sendAccepted = false;
    try {
      if (!resend) throw new Error("RESEND_API_KEY not configured");
      const { data: msg, error: msgErr } = await supabase.from("outreach_messages")
        .insert({ prospect_id: prospect.id, channel: "email", status: "drafted", draft_subject: prospect.draft_subject, draft_body: prospect.draft_body })
        .select("id").single();
      if (msgErr) throw msgErr;
      messageId = msg.id;

      const email = buildOutreachEmail({
        intro: prospect.draft_body,
        businessName: prospect.business_name,
        messageId,
        slug,
        unsubscribeUrl: buildUnsubscribeUrl(prospect.email),
        mailingAddress: MAILING_ADDRESS
      });
      const { data: sendData, error: sendErr } = await resend.emails.send({
        from: SEND_OUTREACH_FROM,
        to: prospect.email,
        replyTo: replyToFor(messageId, { captureReplies }),
        subject: prospect.draft_subject,
        text: email.text,
        html: email.html,
        headers: { "List-Unsubscribe": `<${buildUnsubscribeUrl(prospect.email)}>` },
        tags: [{ name: "outreach_message_id", value: messageId }, { name: "kind", value: "cold_outreach" }]
      });
      if (sendErr) throw new Error(sendErr.message || "Resend send failed");
      sendAccepted = true;

      const sentAt = new Date().toISOString();
      await supabase.from("outreach_messages")
        .update({ status: "sent", sent_at: sentAt, resend_email_id: sendData?.id || null, updated_at: sentAt })
        .eq("id", messageId);
      await supabase.from("prospects").update({ status: "sent", updated_at: sentAt }).eq("id", prospect.id);
      results.push({ business_name: prospect.business_name, email: prospect.email, sent: true, message_id: messageId, preview_url: prospect.preview_url });
    } catch (err) {
      if (sendAccepted) {
        // Resend accepted it; only our bookkeeping failed. Never re-send.
        await supabase.from("prospects").update({ status: "sent", updated_at: new Date().toISOString() }).eq("id", prospect.id);
      } else {
        if (messageId) await supabase.from("outreach_messages").delete().eq("id", messageId);
        // Released for the next run.
        await supabase.from("prospects").update({ status: "drafted", updated_at: new Date().toISOString() }).eq("id", prospect.id);
      }
      await logNotificationFailure("send-outreach", prospect.email, err, { prospect_id: prospect.id, business_name: prospect.business_name });
      results.push({ business_name: prospect.business_name, email: prospect.email, sent: false, reason: err.message });
    }
  }

  return res.status(200).json({
    success: true,
    daily_cap: Math.min(OUTREACH_DAILY_CAP, rampCap),
    sent_earlier_today: sentToday || 0,
    attempted: results.length,
    sent: results.filter(r => r.sent).length,
    skipped: results.filter(r => !r.sent).length,
    results
  });
}

// Public — the links inside outreach emails. Records the click against the
// exact email (outreach_messages id), then redirects to the prospect's page
// or the claim flow. Destinations are built from our own database row, never
// from the query string, so this can't be used as an open redirect.
async function handleOutreachRedirect(req, res) {
  const m = String(req.query.m || "");
  const to = req.query.to === "claim" ? "claim" : "page";
  if (!isUuid(m)) return res.redirect(302, "https://enoma.io/");

  const { data: msg } = await supabase.from("outreach_messages")
    .select("id, preview_visited_at, prospects(preview_url)")
    .eq("id", m).maybeSingle();
  const slug = slugFromPreviewUrl(msg?.prospects?.preview_url);
  if (!msg || !slug) return res.redirect(302, "https://enoma.io/");

  const links = trackedLinks(msg.id, slug);
  const at = new Date().toISOString();
  try {
    if (!msg.preview_visited_at) {
      await supabase.from("outreach_messages").update({ preview_visited_at: at, updated_at: at }).eq("id", msg.id);
    }
    await supabase.from("page_events").insert({
      slug,
      event: to === "claim" ? "outreach_claim_click" : "outreach_page_click",
      metadata: { m: msg.id },
      referrer: req.headers.referer || null,
      user_agent: req.headers["user-agent"] || null,
      ip: (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || null,
      is_internal: false
    });
  } catch (e) {
    console.error("Outreach click logging failed:", e);
  }
  return res.redirect(302, to === "claim" ? links.claimDest : links.pageDest);
}

// Public — Resend's servers call this, they can't send ADMIN_SECRET/
// CRON_SECRET. Verifies the standard Svix-style signature Resend signs
// webhook payloads with (id.timestamp.body, HMAC-SHA256, base64) so this
// doesn't need the svix package as a dependency. On a hard bounce or spam
// complaint, adds the address to suppression_list so send_outreach (above)
// never retries it — this is the real "is this a working mailbox" signal,
// deliberately deferred until after the fact rather than probed live.
function verifyResendWebhookSignature(req) {
  const secretEnv = process.env.RESEND_WEBHOOK_SECRET;
  if (!secretEnv) return false;
  const id = req.headers["svix-id"];
  const timestamp = req.headers["svix-timestamp"];
  const signatureHeader = req.headers["svix-signature"];
  if (!id || !timestamp || !signatureHeader) return false;

  const secretBytes = Buffer.from(secretEnv.split("_").pop(), "base64");
  const signedContent = `${id}.${timestamp}.${req.rawBody}`;
  const expected = crypto.createHmac("sha256", secretBytes).update(signedContent).digest("base64");

  return signatureHeader.split(" ").some(sig => {
    const [, value] = sig.split(",");
    if (!value) return false;
    try {
      const a = Buffer.from(value);
      const b = Buffer.from(expected);
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  });
}

// Finds the outreach_messages row an event is about: our own tag first
// (set on every send since the tracking rebuild), then Resend's email id.
async function findOutreachMessage(data) {
  const tags = data?.tags || {};
  const tagged = Array.isArray(tags) ? tags.find(t => t?.name === "outreach_message_id")?.value : tags.outreach_message_id;
  const cols = "id, prospect_id, delivered_at, first_opened_at, open_count, first_clicked_at, click_count";
  if (isUuid(tagged)) {
    const { data: row } = await supabase.from("outreach_messages").select(cols).eq("id", tagged).maybeSingle();
    if (row) return row;
  }
  if (data?.email_id) {
    const { data: row } = await supabase.from("outreach_messages").select(cols).eq("resend_email_id", data.email_id).maybeSingle();
    if (row) return row;
  }
  return null;
}

async function handleResendWebhook(req, res) {
  if (!verifyResendWebhookSignature(req)) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  const event = req.body;
  const type = event?.type;
  const data = event?.data || {};
  const at = data.created_at || event?.created_at || new Date().toISOString();

  if (type === "email.received") {
    await handleInboundReply(data);
    return res.status(200).json({ success: true });
  }

  const email = data?.to?.[0];
  if (email && (type === "email.bounced" || type === "email.complained" || type === "email.suppressed")) {
    // suppression_list.reason and outreach_messages.response_status both have
    // CHECK constraints limited to specific values — map Resend's raw event
    // type strings onto them rather than storing verbatim. Note this is
    // response_status, not status: outreach_messages.status tracks the
    // drafted/approved/rejected/sent lifecycle of the message itself (its own
    // CHECK constraint doesn't even allow "bounced"/"opted_out") — a bounce
    // or complaint is what happened *after* it was sent, same field
    // bestOutreachSignal (above) already reads for replies/claims.
    const reason = type === "email.complained" ? "opted_out" : "bounced";
    await supabase.from("suppression_list").upsert({ email, reason }, { onConflict: "email" });
    const { data: matches } = await supabase.from("prospects").select("id").eq("email", email);
    const prospectIds = (matches || []).map(p => p.id);
    if (prospectIds.length) {
      await supabase.from("outreach_messages")
        .update({ response_status: reason, response_at: at, updated_at: new Date().toISOString() })
        .eq("channel", "email")
        .in("prospect_id", prospectIds);
    }
    return res.status(200).json({ success: true });
  }

  const msg = await findOutreachMessage(data);
  if (!msg) return res.status(200).json({ success: true, matched: false });

  const patch = { updated_at: new Date().toISOString() };
  if (type === "email.delivered" && !msg.delivered_at) patch.delivered_at = at;
  if (type === "email.opened") {
    patch.open_count = (msg.open_count || 0) + 1;
    patch.last_opened_at = at;
    if (!msg.first_opened_at) patch.first_opened_at = at;
  }
  if (type === "email.clicked") {
    patch.click_count = (msg.click_count || 0) + 1;
    patch.last_clicked_url = data?.click?.link || null;
    if (!msg.first_clicked_at) patch.first_clicked_at = at;
  }
  if (type === "email.delivery_delayed" || type === "email.failed") {
    patch.notes = `${type} at ${at}${data?.failed?.reason ? `: ${data.failed.reason}` : ""}`;
  }
  if (Object.keys(patch).length > 1) {
    await supabase.from("outreach_messages").update(patch).eq("id", msg.id);
  }
  return res.status(200).json({ success: true, matched: true });
}

// Replies to cold outreach arrive at reply+<outreach_message_id>@mail.enoma.io
// (Resend Inbound, only when OUTREACH_REPLY_CAPTURE=1). The webhook carries
// metadata only, so the body is fetched from Resend, logged in
// outreach_replies against the original email, and forwarded to Jack with
// Reply-To set to the sender so he can answer straight from his inbox.
async function handleInboundReply(data) {
  const messageId = messageIdFromReplyAddress([...(data.to || []), ...(data.received_for || [])]);
  if (!data.email_id) throw new Error("Inbound event without email_id");

  // Resend retries a webhook delivery that doesn't get a 2xx, so a retry
  // of a reply we already stored is acknowledged without a second copy.
  const { data: existing } = await supabase.from("outreach_replies")
    .select("id").eq("resend_inbound_id", data.email_id).maybeSingle();
  if (existing) return;

  // The webhook has metadata only. If the body can't be fetched, throw so
  // the webhook answers 500 and Resend retries, rather than storing an
  // empty reply and losing an opt-out.
  const r = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(data.email_id)}`, {
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` }
  });
  if (!r.ok) throw new Error(`Fetching inbound email ${data.email_id} failed: HTTP ${r.status}`);
  const full = await r.json();

  const text = full.text || "";
  const subject = full.subject || data.subject || "";
  const from = full.from || data.from || "";
  const fromEmail = (String(from).match(/<([^>]+)>/)?.[1] || String(from)).trim().toLowerCase();
  const intent = classifyReplyIntent({ subject, text, headers: full.headers });

  let prospectId = null;
  if (messageId) {
    const { data: msg } = await supabase.from("outreach_messages").select("id, prospect_id").eq("id", messageId).maybeSingle();
    prospectId = msg?.prospect_id || null;
  }

  const { data: reply } = await supabase.from("outreach_replies").insert({
    resend_inbound_id: data.email_id || null,
    outreach_message_id: prospectId ? messageId : null,
    prospect_id: prospectId,
    from_email: fromEmail || null,
    subject,
    body_text: text.slice(0, 20000),
    intent
  }).select("id").single();

  if (prospectId && intent !== "auto_reply") {
    await supabase.from("outreach_messages")
      .update({ response_status: intent === "opt_out" ? "opted_out" : "replied", response_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", messageId);
  }
  if (intent === "opt_out" && fromEmail) {
    await supabase.from("suppression_list").upsert({ email: fromEmail, reason: "opted_out" }, { onConflict: "email" });
  }

  if (resend) {
    try {
      const label = { positive: "INTERESTED", opt_out: "opt-out", auto_reply: "auto-reply", other: "reply" }[intent];
      await resend.emails.send({
        from: "Enoma Replies <replies@mail.enoma.io>",
        to: "jack@enoma.io",
        replyTo: fromEmail || undefined,
        subject: `[${label}] ${subject}`,
        text: `From: ${from}\n\n${text}`,
        ...(full.html ? { html: `<p style="font-family:Arial,sans-serif;font-size:13px;color:#666;">From: ${escapeForForward(from)} &middot; ${label}</p>${full.html}` } : {})
      });
      if (reply?.id) await supabase.from("outreach_replies").update({ forwarded_at: new Date().toISOString() }).eq("id", reply.id);
    } catch (e) {
      await logNotificationFailure("inbound-forward", "jack@enoma.io", e, { email_id: data.email_id });
    }
  }
}

function escapeForForward(s) {
  return String(s || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// Public, no login — a one-click unsubscribe link is a CAN-SPAM requirement,
// not optional. Token is verified via outreach-footer.js's HMAC check so an
// arbitrary email can't be unsubscribed by guessing a URL.
async function handleUnsubscribe(req, res) {
  const email = (req.query.email || "").toString();
  const token = (req.query.token || "").toString();

  if (!verifyUnsubscribeToken(email, token)) {
    return res.status(400).send("Invalid or expired unsubscribe link.");
  }

  await supabase.from("suppression_list").upsert({ email, reason: "requested_removal" }, { onConflict: "email" });

  res.setHeader("Content-Type", "text/html");
  return res.status(200).send(`<!doctype html><html><body style="font-family:sans-serif;max-width:480px;margin:60px auto;text-align:center;"><h2>You're unsubscribed</h2><p>${email} won't receive any more emails from Enoma.</p></body></html>`);
}

// Read-only review surface: every prospect with a draft, for a human to read
// before approving. Sending is never triggered from here.
async function handleListDrafts(req, res) {
  const statusFilter = req.query.status ? req.query.status.toString().split(",") : ["drafted", "approved"];
  const { data, error } = await supabase
    .from("prospects")
    .select("id, business_name, phone, email, preview_url, status, draft_subject, draft_body, updated_at")
    .in("status", statusFilter)
    .order("updated_at", { ascending: false });
  if (error) throw error;

  return res.status(200).json({ success: true, count: (data || []).length, drafts: data || [] });
}

async function toolGetBusinessPagesStatus() {
  const { data, error } = await supabase
    .from("small_business_profiles")
    .select("business_name, username, is_public, businesses(is_published, is_internal, subscriptions(status, provider, is_trial, trial_expires_at))");
  if (error) throw error;
  return {
    pages: (data || [])
      .filter(p => !p.businesses?.is_internal)
      .map(p => ({
        business_name: p.business_name,
        url: p.username ? `enoma.io/${p.username}` : null,
        is_public: p.is_public,
        is_published: p.businesses?.is_published,
        subscription_status: p.businesses?.subscriptions?.status,
        provider: p.businesses?.subscriptions?.provider
      }))
  };
}

async function toolUpdateProspectStatus(args) {
  const { error } = await supabase
    .from("prospects")
    .update({ status: args.status, updated_at: new Date().toISOString() })
    .ilike("business_name", args.business_name);
  if (error) throw error;
  return { success: true, business_name: args.business_name, new_status: args.status };
}

const VOICE_TOOLS = [
  { type: "function", function: { name: "get_revenue_status", description: "Real MRR, paying vs. comped accounts, active and stalled trials.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "get_marketing_traffic", description: "Website traffic: GA4 sessions/users/pageviews for the last 7 days, acquisition channels for the last 30 days, plus Search Console clicks/impressions/CTR/position and top search queries for the last 28 days.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "get_crm_prospects", description: "Prospecting/CRM data pulled via Outscraper. Each result includes has_draft so you know which prospects already have outreach copy.", parameters: { type: "object", properties: {
    status: { type: "string", enum: ["new", "dedup_match", "reviewed", "skipped", "drafted", "approved"], description: "Filter by status" },
    trade: { type: "string", description: "Filter by trade, e.g. landscaping" }
  } } } },
  { type: "function", function: { name: "get_business_pages_status", description: "All live Enoma business pages and their publish/subscription status.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "update_prospect_status", description: "Mark a CRM prospect as reviewed or skipped.", parameters: { type: "object", properties: {
    business_name: { type: "string", description: "Exact or partial business name to match" },
    status: { type: "string", enum: ["reviewed", "skipped", "new"] }
  }, required: ["business_name", "status"] } } },
  { type: "function", function: { name: "draft_outreach_email", description: "Generate (or revise, if one already exists) a cold outreach email draft for a specific prospect. Always returns the actual subject/body so it can be read aloud.", parameters: { type: "object", properties: {
    business_name: { type: "string", description: "Exact or partial business name to match" },
    instructions: { type: "string", description: "Optional feedback for revising an existing draft, e.g. 'make it shorter' or 'mention their reviews'" }
  }, required: ["business_name"] } } },
  { type: "function", function: { name: "get_outreach_draft", description: "Read back the current draft subject/body for a prospect without regenerating it.", parameters: { type: "object", properties: {
    business_name: { type: "string" }
  }, required: ["business_name"] } } },
  { type: "function", function: { name: "approve_outreach_email", description: "Mark a prospect's draft as 'approved', meaning Jack will send it himself outside the automated pipeline. The daily send_outreach cron only auto-sends prospects still at status='drafted', so approving one takes it OUT of automatic sending rather than into it.", parameters: { type: "object", properties: {
    business_name: { type: "string" }
  }, required: ["business_name"] } } }
];

const TOOL_IMPL = {
  get_revenue_status: toolGetRevenueStatus,
  get_marketing_traffic: toolGetMarketingTraffic,
  get_crm_prospects: toolGetCrmProspects,
  get_business_pages_status: toolGetBusinessPagesStatus,
  update_prospect_status: toolUpdateProspectStatus,
  draft_outreach_email: toolDraftOutreachEmail,
  get_outreach_draft: toolGetOutreachDraft,
  approve_outreach_email: toolApproveOutreachEmail
};

const SYSTEM_PROMPT = `You are Enoma's internal voice assistant, speaking directly to Jack, the founder. Enoma builds AI-generated business websites for local service businesses (landscaping, plumbing, HVAC, etc.) — free 30-day trial, then $49/mo. Its ideal customer is a business that doesn't have a website yet.

You have tools for revenue, marketing traffic, CRM/prospecting data, business page status, and outreach drafting — always call a tool rather than guessing at any number or inventing message copy. You can also discuss outbound/inbound marketing strategy and the BD pipeline by reasoning over what the tools return.

Outreach workflow: draft_outreach_email generates or revises a draft and returns the real subject/body — read it back to Jack conversationally (don't just say "I drafted it", actually speak the content). He can ask for changes, which you make by calling draft_outreach_email again with instructions describing the change. Sending itself IS automated: a daily cron sends every prospect still sitting at status='drafted', with no separate approval step. If he says something like "approve it," call approve_outreach_email — but tell him clearly that this takes it OUT of the automated send instead of into it, so he'll need to send that one himself. If he just wants a draft to go out normally, tell him it's already on track to send automatically and no action is needed.

More generally: if a question asks about a capability or data with no matching tool result, say it doesn't exist or isn't built yet — never fabricate an answer that sounds plausible.

This response will be read aloud via text-to-speech, so answer conversationally in 2-4 sentences — no markdown, no bullet lists, no headers. Round numbers naturally when speaking them.`;

async function callOpenAI(messages) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o", temperature: 0.4, messages, tools: VOICE_TOOLS })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || "OpenAI request failed");
  return data.choices[0].message;
}

async function handleVoiceQuery(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const user = await requireAdmin(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const question = (req.body?.question || "").toString().trim();
  if (!question) return res.status(400).json({ error: "question required" });

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: question }
  ];

  let finalMessage;
  for (let i = 0; i < 5; i++) {
    finalMessage = await callOpenAI(messages);
    if (!finalMessage.tool_calls || finalMessage.tool_calls.length === 0) break;

    messages.push(finalMessage);
    for (const call of finalMessage.tool_calls) {
      const impl = TOOL_IMPL[call.function.name];
      let result;
      try {
        const args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        result = impl ? await impl(args) : { error: "Unknown tool" };
      } catch (err) {
        result = { error: err.message };
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }

  const answer = finalMessage.content || "I wasn't able to put that together — try asking again.";
  return res.status(200).json({ success: true, answer });
}

// ==================== Sales queue ====================
// Merges the two lead populations that actually carry contact info (raw
// Enoma-side leads and outbound prospects) into one scored, prioritized list
// for the internal admin dashboard. Deliberately does NOT try to turn
// anonymous pre-signup funnel_events into individual "leads" — those rows
// carry no name/email/phone until after generation succeeds (see
// public/scripts/funnel-track.js), so there's no honest way to attribute
// them to a contactable person. They're surfaced instead as an aggregate
// funnel-health panel below.

const FUNNEL_STEP_ORDER = [
  "get_your_website_submitted",
  "choose_path_viewed",
  "choose_path_selected",
  "create_page_viewed",
  "create_step_viewed",
  "create_form_submitted",
  "create_generation_succeeded",
  "create_generation_failed"
];

// A prospect can have multiple outreach_messages (one per channel). Picks
// the single strongest response signal across all of them and the most
// recent activity timestamp, so a reply on any channel surfaces the prospect.
function bestOutreachSignal(messages) {
  const RESPONSE_RANK = { claimed: 4, replied: 3, no_response: 1, bounced: 0, opted_out: 0 };
  let best = null;
  let lastActivityAt = null;
  let anySent = false;
  for (const m of messages || []) {
    const ts = m.response_at || m.sent_at || m.updated_at;
    if (ts && (!lastActivityAt || new Date(ts) > new Date(lastActivityAt))) lastActivityAt = ts;
    if (m.status === "sent") anySent = true;
    const rank = RESPONSE_RANK[m.response_status] ?? -1;
    if (!best || rank > (RESPONSE_RANK[best.response_status] ?? -1)) best = m;
  }
  return {
    outreachStatus: anySent ? "sent" : (best?.status || null),
    responseStatus: best?.response_status || null,
    lastActivityAt
  };
}

async function handleSalesQueue(req, res) {
  const user = await requireAdmin(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const [{ data: rawLeads, error: leadsErr }, { data: prospects, error: prospectsErr }, { data: funnelRows, error: funnelErr }] =
    await Promise.all([
      supabase
        .from("contact_submissions")
        .select("id, name, email, phone, subject, message, source, is_read, replied_at, created_at")
        .is("business_id", null)
        .order("created_at", { ascending: false }),
      supabase
        .from("prospects")
        .select("id, business_name, trade, city, state, phone, email, status, preview_url, draft_subject, draft_body, updated_at, created_at, outreach_messages(channel, status, response_status, sent_at, response_at, updated_at)")
        .order("updated_at", { ascending: false }),
      supabase
        .from("funnel_events")
        .select("event, created_at")
        .gte("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
    ]);
  if (leadsErr) throw leadsErr;
  if (prospectsErr) throw prospectsErr;
  if (funnelErr) throw funnelErr;

  const leadRows = (rawLeads || []).map(l => {
    const scored = scoreRawLead(l);
    return {
      lead_type: "raw_lead",
      id: l.id,
      name: l.name,
      business_name: null,
      email: l.email,
      phone: l.phone,
      source: l.source,
      status: l.replied_at ? "replied" : (l.is_read ? "read" : "new"),
      score: scored.score,
      tier: scored.tier,
      days_since_activity: scored.days_since_activity,
      last_activity_at: l.created_at,
      detail: l.subject || (l.message || "").slice(0, 140) || null,
      preview_url: null,
      suggested_action: l.replied_at ? "Follow up if no response yet" : "Reply to this lead"
    };
  });

  const prospectRows = (prospects || []).flatMap(p => {
    const sig = bestOutreachSignal(p.outreach_messages);
    const lastActivityAt = sig.lastActivityAt || p.updated_at || p.created_at;
    const scored = scoreProspect({
      prospectStatus: p.status,
      outreachStatus: sig.outreachStatus,
      responseStatus: sig.responseStatus,
      lastActivityAt
    });
    if (!scored) return [];
    const suggested_action =
      sig.responseStatus === "claimed" ? "Claimed! Check they're set up" :
      sig.responseStatus === "replied" ? "They replied — respond now" :
      p.status === "approved" ? "Ready to send" :
      p.status === "drafted" ? "Review draft" :
      p.status === "reviewed" ? "Draft outreach" :
      "Review this prospect";
    return [{
      lead_type: "prospect",
      id: p.id,
      name: null,
      business_name: p.business_name,
      email: p.email,
      phone: p.phone,
      source: `outscraper${p.trade ? `:${p.trade}` : ""}`,
      status: sig.responseStatus || p.status,
      score: scored.score,
      tier: scored.tier,
      days_since_activity: scored.days_since_activity,
      last_activity_at: lastActivityAt,
      detail: [p.city, p.state].filter(Boolean).join(", ") || null,
      preview_url: p.preview_url || null,
      draft_subject: p.draft_subject || null,
      draft_body: p.draft_body || null,
      suggested_action
    }];
  });

  const queue = [...leadRows, ...prospectRows].sort((a, b) =>
    b.score - a.score || new Date(b.last_activity_at) - new Date(a.last_activity_at)
  );

  const stepCounts = Object.fromEntries(FUNNEL_STEP_ORDER.map(e => [e, 0]));
  (funnelRows || []).forEach(r => { if (stepCounts[r.event] !== undefined) stepCounts[r.event]++; });
  const funnel_health = FUNNEL_STEP_ORDER.map(event => ({ event, count_last_30_days: stepCounts[event] }));

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const summary = {
    total_active: queue.length,
    hot: queue.filter(q => q.tier === "hot").length,
    warm: queue.filter(q => q.tier === "warm").length,
    new_today: queue.filter(q => new Date(q.last_activity_at) >= todayStart).length,
    new_this_week: queue.filter(q => new Date(q.last_activity_at) >= weekStart).length,
    raw_leads_uncontacted: leadRows.filter(l => l.status === "new").length,
    prospects_ready_to_send: prospectRows.filter(p => p.status === "approved").length,
    prospects_awaiting_reply: prospectRows.filter(p => p.status === "sent").length
  };

  return res.status(200).json({
    success: true,
    generated_at: new Date().toISOString(),
    summary,
    queue,
    funnel_health
  });
}

// Thin HTTP wrappers around the existing voice-tool functions above, for the
// command center dashboard — same JWT admin gate as sales_queue, but callable
// directly on page load instead of only through the OpenAI tool-calling loop
// in handleVoiceQuery (which would add needless latency/cost for a dashboard
// that just wants the raw numbers).
async function handleRevenueStatus(req, res) {
  const user = await requireAdmin(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  const data = await toolGetRevenueStatus();
  return res.status(200).json({ success: true, generated_at: new Date().toISOString(), ...data });
}

async function handleMarketingTraffic(req, res) {
  const user = await requireAdmin(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  const data = await toolGetMarketingTraffic();
  return res.status(200).json({ success: true, generated_at: new Date().toISOString(), ...data });
}

async function handleBusinessPagesStatus(req, res) {
  const user = await requireAdmin(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  const data = await toolGetBusinessPagesStatus();
  return res.status(200).json({ success: true, generated_at: new Date().toISOString(), ...data });
}

// Lightweight write path so the dashboard can mark things done without
// switching to the voice agent. Same JWT admin gate as sales_queue.
async function handleUpdateLeadStatus(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const user = await requireAdmin(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const { lead_type, id, action: statusAction } = req.body || {};
  if (!lead_type || !id || !statusAction) {
    return res.status(400).json({ error: "lead_type, id, and action are required" });
  }

  if (lead_type === "raw_lead") {
    const patch =
      statusAction === "mark_replied" ? { replied_at: new Date().toISOString(), is_read: true } :
      statusAction === "mark_read" ? { is_read: true } :
      statusAction === "mark_unread" ? { is_read: false, replied_at: null } :
      null;
    if (!patch) return res.status(400).json({ error: `Unknown action for raw_lead: ${statusAction}` });
    const { error } = await supabase.from("contact_submissions").update(patch).eq("id", id);
    if (error) throw error;
    return res.status(200).json({ success: true });
  }

  if (lead_type === "prospect") {
    const allowed = ["new", "reviewed", "skipped", "drafted", "approved"];
    if (!allowed.includes(statusAction)) {
      return res.status(400).json({ error: `Unknown status for prospect: ${statusAction}` });
    }
    const { error } = await supabase.from("prospects")
      .update({ status: statusAction, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
    return res.status(200).json({ success: true });
  }

  return res.status(400).json({ error: `Unknown lead_type: ${lead_type}` });
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");

  const rawBodyBuf = await readRawBody(req);
  req.rawBody = rawBodyBuf.toString("utf8");
  if (req.rawBody) {
    try { req.body = JSON.parse(req.rawBody); } catch { req.body = {}; }
  } else {
    req.body = {};
  }

  if (req.query.action === "resend_webhook") {
    try {
      return await handleResendWebhook(req, res);
    } catch (err) {
      console.error("Resend webhook failed:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  if (req.query.action === "unsubscribe") {
    try {
      return await handleUnsubscribe(req, res);
    } catch (err) {
      console.error("Unsubscribe failed:", err);
      return res.status(500).send("Something went wrong processing your request.");
    }
  }

  // Public: the tracked links inside outreach emails.
  if (req.query.action === "go") {
    try {
      return await handleOutreachRedirect(req, res);
    } catch (err) {
      console.error("Outreach redirect failed:", err);
      return res.redirect(302, "https://enoma.io/");
    }
  }

  if (req.query.action === "voice-query") {
    try {
      return await handleVoiceQuery(req, res);
    } catch (err) {
      console.error("Voice query failed:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  if (req.query.action === "sales_queue") {
    try {
      return await handleSalesQueue(req, res);
    } catch (err) {
      console.error("Sales queue failed:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  if (req.query.action === "update_lead_status") {
    try {
      return await handleUpdateLeadStatus(req, res);
    } catch (err) {
      console.error("Update lead status failed:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  if (req.query.action === "revenue_status") {
    try {
      return await handleRevenueStatus(req, res);
    } catch (err) {
      console.error("Revenue status failed:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  if (req.query.action === "marketing_traffic") {
    try {
      return await handleMarketingTraffic(req, res);
    } catch (err) {
      console.error("Marketing traffic failed:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  if (req.query.action === "business_pages_status") {
    try {
      return await handleBusinessPagesStatus(req, res);
    } catch (err) {
      console.error("Business pages status failed:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // Vercel Cron authenticates by sending Authorization: Bearer $CRON_SECRET
  // automatically once CRON_SECRET is set as a project env var — it can't
  // send arbitrary headers like x-admin-secret, so this is accepted as an
  // alternative to it rather than a replacement.
  const secret = req.headers["x-admin-secret"];
  const cronAuth = req.headers["authorization"];
  const isValidCron = !!process.env.CRON_SECRET && cronAuth === `Bearer ${process.env.CRON_SECRET}`;
  if (secret !== process.env.ADMIN_SECRET && !isValidCron) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (req.query.action === "prospect") {
    try {
      return await handleProspectPull(req, res);
    } catch (err) {
      console.error("Prospect pull failed:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  if (req.query.action === "draft_all") {
    try {
      return await handleDraftAll(req, res);
    } catch (err) {
      console.error("Batch draft failed:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  if (req.query.action === "list_drafts") {
    try {
      return await handleListDrafts(req, res);
    } catch (err) {
      console.error("List drafts failed:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  if (req.query.action === "crawl_websites") {
    try {
      return await handleCrawlWebsites(req, res);
    } catch (err) {
      console.error("Website crawl failed:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  if (req.query.action === "results_email") {
    try {
      return await handleResultsEmail(req, res);
    } catch (err) {
      console.error("Results email failed:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  if (req.query.action === "generate_preview") {
    try {
      return await handleGeneratePreview(req, res);
    } catch (err) {
      console.error("Preview generation failed:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  if (req.query.action === "prepare_outreach") {
    try {
      return await handlePrepareOutreach(req, res);
    } catch (err) {
      console.error("Prepare outreach failed:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  if (req.query.action === "daily_pipeline") {
    try {
      return await handleDailyPipeline(req, res);
    } catch (err) {
      console.error("Daily pipeline failed:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  if (req.query.action === "send_outreach") {
    try {
      return await handleSendOutreach(req, res);
    } catch (err) {
      console.error("Send outreach failed:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  try {
    const property = `properties/${process.env.GA_PROPERTY_ID}`;

    const [daily] = await client.runReport({
      property,
      dateRanges: [{ startDate: "7daysAgo", endDate: "today" }],
      metrics: [
        { name: "activeUsers" },
        { name: "screenPageViews" },
        { name: "sessions" }
      ],
      dimensions: [{ name: "date" }],
      orderBys: [{ dimension: { dimensionName: "date" } }]
    });

    const [channels] = await client.runReport({
      property,
      dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
      metrics: [{ name: "sessions" }, { name: "activeUsers" }],
      dimensions: [{ name: "sessionDefaultChannelGroup" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }]
    });

    res.json({
      success: true,
      rowCount: daily.rowCount,
      rows: (daily.rows || []).map(r => ({
        date: r.dimensionValues[0].value,
        activeUsers: r.metricValues[0].value,
        pageViews: r.metricValues[1].value,
        sessions: r.metricValues[2].value
      })),
      channels: (channels.rows || []).map(r => ({
        channel: r.dimensionValues[0].value,
        sessions: r.metricValues[0].value,
        activeUsers: r.metricValues[1].value
      }))
    });
  } catch (err) {
    console.error("GA metrics fetch failed:", err);
    res.status(500).json({ success: false, error: err.message });
  }
}
