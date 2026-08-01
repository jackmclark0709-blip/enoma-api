// api/ga-metrics.js
// Reads live traffic data from GA4 via a service account (Data API).
// Protected the same way as the admin path in generate-business.js: requires
// the x-admin-secret header to match ADMIN_SECRET.

import { BetaAnalyticsDataClient } from "@google-analytics/data";
import { createClient } from "@supabase/supabase-js";

const client = new BetaAnalyticsDataClient({
  credentials: {
    client_email: process.env.GA_CLIENT_EMAIL,
    private_key: (process.env.GA_PRIVATE_KEY || "").replace(/\\n/g, "\n")
  }
});

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

  const rows = places.map(p => {
    const phone = normalizePhone(p.phone);
    return {
      source: "outscraper_google_maps",
      trade,
      business_name: p.name || "Unknown",
      phone: p.phone || null,
      address: p.full_address || null,
      city: p.city || null,
      state: p.state || p.us_state || null,
      website: p.site || null,
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
    dedup_matches: rows.filter(r => r.status === "dedup_match").length
  });
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");

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
