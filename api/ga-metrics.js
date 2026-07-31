// api/ga-metrics.js
// Reads live traffic data from GA4 via a service account (Data API).
// Protected the same way as the admin path in generate-business.js: requires
// the x-admin-secret header to match ADMIN_SECRET.

import { BetaAnalyticsDataClient } from "@google-analytics/data";

const client = new BetaAnalyticsDataClient({
  credentials: {
    client_email: process.env.GA_CLIENT_EMAIL,
    private_key: (process.env.GA_PRIVATE_KEY || "").replace(/\\n/g, "\n")
  }
});

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");

  const secret = req.headers["x-admin-secret"];
  if (secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const [response] = await client.runReport({
      property: `properties/${process.env.GA_PROPERTY_ID}`,
      dateRanges: [{ startDate: "7daysAgo", endDate: "today" }],
      metrics: [
        { name: "activeUsers" },
        { name: "screenPageViews" },
        { name: "sessions" }
      ],
      dimensions: [{ name: "date" }],
      orderBys: [{ dimension: { dimensionName: "date" } }]
    });

    res.json({
      success: true,
      rowCount: response.rowCount,
      rows: (response.rows || []).map(r => ({
        date: r.dimensionValues[0].value,
        activeUsers: r.metricValues[0].value,
        pageViews: r.metricValues[1].value,
        sessions: r.metricValues[2].value
      }))
    });
  } catch (err) {
    console.error("GA metrics fetch failed:", err);
    res.status(500).json({ success: false, error: err.message });
  }
}
