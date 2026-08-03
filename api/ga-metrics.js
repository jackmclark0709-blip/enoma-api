// api/ga-metrics.js
// Reads live traffic data from GA4 via a service account (Data API).
// Protected the same way as the admin path in generate-business.js: requires
// the x-admin-secret header to match ADMIN_SECRET.

import { BetaAnalyticsDataClient } from "@google-analytics/data";
import { JWT } from "google-auth-library";
import { createClient } from "@supabase/supabase-js";

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

export const config = { maxDuration: 60 };

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const normalizePhone = (p) => (p || "").replace(/\D/g, "").slice(-10);

// Pulls a batch of local businesses from Outscraper's Google Maps scraper,
// dedupes against existing contact_submissions/businesses by phone, and
// stores new ones in `prospects` for the Marketing agent to draft outreach to.
// Filtered to only_without_website — Enoma's actual ICP is businesses that
// don't have a site yet, not just any business in the trade.
//
// Email is requested via enrichment (company_websites_finder discovers a site
// Google's own listing doesn't show, leads_n_contacts then scrapes an email
// from it) but is NOT required — most correctly-targeted no-website prospects
// genuinely have no scrapable email anywhere, and dropping them would gut this
// vertical's list. Treat `email` as a nice-to-have channel signal, not a filter.
async function handleProspectPull(req, res) {
  const trade = (req.query.trade || "landscaping").toString();
  const location = (req.query.location || "Attleboro, MA").toString();
  const limit = Math.min(parseInt(req.query.limit, 10) || 250, 500);

  const params = new URLSearchParams({
    query: `${trade} near ${location}`,
    limit: String(limit),
    async: "false",
    region: "US",
    language: "en"
  });
  const filtersParam = req.query.filters !== undefined ? req.query.filters.toString() : "only_without_website";
  if (filtersParam && filtersParam !== "none") {
    filtersParam.split(",").forEach(f => params.append("filters", f));
  }
  const enrichmentParam = req.query.enrichment !== undefined
    ? req.query.enrichment.toString()
    : "company_websites_finder,leads_n_contacts";
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
    return res.status(outscraperRes.status).json({ success: false, error: payload });
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

  // Outscraper's docs don't publish an exact response shape for the
  // leads_n_contacts/company_websites_finder enrichments, so this checks the
  // plausible field-name variants rather than asserting one. Confirm against
  // `raw` on the first real enriched pull and simplify once the real shape
  // is known.
  const firstEmail = p => {
    if (p.email_1) return p.email_1;
    if (Array.isArray(p.emails) && p.emails.length) return p.emails[0];
    if (typeof p.email === "string" && p.email) return p.email;
    if (p.contacts?.emails?.length) return p.contacts.emails[0];
    return null;
  };
  const foundWebsite = p => {
    // `site` is the business's own listed website; company_websites_finder
    // may add a distinct discovered-site field when Maps shows none.
    if (!p.site && p.found_website) return p.found_website;
    if (!p.site && p.company_website) return p.company_website;
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
      website: p.site || null,
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

  return res.status(200).json({
    success: true,
    pulled: places.length,
    new: rows.filter(r => r.status === "new").length,
    dedup_matches: rows.filter(r => r.status === "dedup_match").length,
    with_email: rows.filter(r => r.email).length
  });
}

const ENOMA_ADMIN_EMAIL = "jack@enoma.io";

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
    .select("id, business_name, trade, city, state, phone, email, preview_url, status, draft_subject, draft_body")
    .ilike("business_name", `%${businessName}%`)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Drafting is a separate, non-tool-calling OpenAI completion — same raw-fetch
// pattern already used for page copy in generate-business.js.
async function generateDraftCopy(prospect, instructions) {
  // When a preview page already exists (small_business_profiles.is_claimed=false,
  // linked via prospects.preview_url), that's the strongest honest hook we have —
  // a real, working thing built from their own public info, not a generic pitch.
  const previewLine = prospect.preview_url
    ? `\nA real, unclaimed preview page already exists for this business at ${prospect.preview_url} — built from their public Google Business listing (name, location, and real rating/reviews where available; nothing invented). Reference it directly and invite them to look, keep it, or ask for changes. This is true and verifiable — lean on it instead of generic claims.`
    : "";

  const prompt = `Write a short, professional cold outreach email from Enoma (AI-generated business websites for local service businesses, $19.99/mo after a free 30-day trial) to a local business owner who doesn't have a website yet.

Business: ${prospect.business_name}
Trade: ${prospect.trade || "local service business"}
Location: ${[prospect.city, prospect.state].filter(Boolean).join(", ") || "unknown"}${previewLine}
${prospect.draft_body ? `\nExisting draft to revise:\nSubject: ${prospect.draft_subject}\n${prospect.draft_body}\n\nRevision instructions: ${instructions || "improve it generally"}` : ""}
${!prospect.draft_body && instructions ? `\nSpecific instructions: ${instructions}` : ""}

Keep it short (under 120 words), warm but not pushy, no false urgency, no fake personalization details you don't actually have. Sign off as "Jack, Enoma". Return ONLY valid JSON: {"subject": "...", "body": "..."}`;

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
    note: "Marked ready to send. Actual sending isn't automated yet — Jack sends it himself for now."
  };
}

// Batch-drafts outreach emails for every prospect that actually has an email
// on file. Most prospects won't (see handleProspectPull) — this only ever
// touches the subset where email is not null, and never re-drafts a prospect
// that's already drafted/approved unless force=true.
async function handleDraftAll(req, res) {
  const force = req.query.force === "true";
  let q = supabase
    .from("prospects")
    .select("id, business_name, trade, city, state, phone, email, preview_url, status, draft_subject, draft_body")
    .not("email", "is", null);
  if (!force) q = q.not("status", "in", "(drafted,approved,sent)");

  const { data: prospects, error } = await q;
  if (error) throw error;

  const results = [];
  for (const prospect of prospects || []) {
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

  return res.status(200).json({
    success: true,
    eligible: (prospects || []).length,
    drafted: results.filter(r => r.drafted).length,
    failed: results.filter(r => !r.drafted).length,
    results
  });
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
  { type: "function", function: { name: "approve_outreach_email", description: "Mark a prospect's draft as approved/ready to send. Does NOT actually send anything — sending is not automated yet.", parameters: { type: "object", properties: {
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

const SYSTEM_PROMPT = `You are Enoma's internal voice assistant, speaking directly to Jack, the founder. Enoma builds AI-generated business websites for local service businesses (landscaping, plumbing, HVAC, etc.) — free 30-day trial, then $19.99/mo. Its ideal customer is a business that doesn't have a website yet.

You have tools for revenue, marketing traffic, CRM/prospecting data, business page status, and outreach drafting — always call a tool rather than guessing at any number or inventing message copy. You can also discuss outbound/inbound marketing strategy and the BD pipeline by reasoning over what the tools return.

Outreach workflow: draft_outreach_email generates or revises a draft and returns the real subject/body — read it back to Jack conversationally (don't just say "I drafted it", actually speak the content). He can ask for changes, which you make by calling draft_outreach_email again with instructions describing the change. When he says something like "approve it" or "send it", call approve_outreach_email — but tell him clearly that this only marks it ready; actually sending emails is not automated yet, so he still has to send it himself.

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

  const token = (req.headers.authorization || "").replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user || user.email !== ENOMA_ADMIN_EMAIL) {
    return res.status(401).json({ error: "Unauthorized" });
  }

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

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");

  if (req.query.action === "voice-query") {
    try {
      return await handleVoiceQuery(req, res);
    } catch (err) {
      console.error("Voice query failed:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  const secret = req.headers["x-admin-secret"];
  if (secret !== process.env.ADMIN_SECRET) {
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
