// Per-guide performance: Search Console impressions/clicks/queries joined with
// on-site CTA clicks and signups (funnel_events with metadata.from = guide slug).
// Pure functions; the network calls live in ga-metrics.js (content_performance).

// A query earns a "paid test" flag when people clearly search it (enough
// impressions) but the guide isn't on page one yet (position > 10). Those are
// the cheapest keywords to test with a small Google Ads budget while SEO catches up.
export const PAID_TEST_MIN_IMPRESSIONS = 20;
export const PAID_TEST_MIN_POSITION = 10;

export function slugFromPageUrl(url) {
  const m = String(url || "").match(/\/for\/([a-z0-9-]+?)(?:\.html)?\/?(?:[?#].*)?$/i);
  return m ? m[1].toLowerCase() : null;
}

const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

/**
 * @param {Array<{keys:[string], clicks, impressions, ctr, position}>} pageRows   Search Console rows, dimension [page]
 * @param {Array<{keys:[string,string], clicks, impressions, ctr, position}>} pageQueryRows  dimensions [page, query]
 * @param {Array<{event:string, metadata:object}>} events  funnel_events rows
 */
export function summarizeContent(pageRows = [], pageQueryRows = [], events = []) {
  const bySlug = new Map();
  const get = slug => {
    if (!bySlug.has(slug)) bySlug.set(slug, { slug, clicks: 0, impressions: 0, ctr: 0, avg_position: null, cta_clicks: 0, previews_started: 0, top_queries: [], paid_test_queries: [] });
    return bySlug.get(slug);
  };

  for (const r of pageRows) {
    const slug = slugFromPageUrl(r.keys?.[0]);
    if (!slug) continue;
    const p = get(slug);
    // A slug can appear twice (/for/x and /for/x.html); merge, weighting position by impressions.
    const prevImpr = p.impressions;
    p.clicks += r.clicks || 0;
    p.impressions += r.impressions || 0;
    if (r.position != null) {
      p.avg_position = p.avg_position == null ? r.position
        : (p.avg_position * prevImpr + r.position * (r.impressions || 0)) / Math.max(p.impressions, 1);
    }
  }

  const queriesBySlug = new Map();
  for (const r of pageQueryRows) {
    const slug = slugFromPageUrl(r.keys?.[0]);
    const query = r.keys?.[1];
    if (!slug || !query) continue;
    if (!queriesBySlug.has(slug)) queriesBySlug.set(slug, []);
    queriesBySlug.get(slug).push({ query, clicks: r.clicks || 0, impressions: r.impressions || 0, avg_position: r.position != null ? round(r.position) : null });
  }

  for (const e of events) {
    const slug = e?.metadata?.from;
    if (!slug || typeof slug !== "string") continue;
    const p = get(slug.toLowerCase());
    if (e.event === "cta_clicked") p.cta_clicks++;
    if (e.event === "instant_preview_started") p.previews_started++;
  }

  for (const [slug, qs] of queriesBySlug) {
    const p = get(slug);
    qs.sort((a, b) => b.impressions - a.impressions);
    p.top_queries = qs.slice(0, 5);
    p.paid_test_queries = qs
      .filter(q => q.impressions >= PAID_TEST_MIN_IMPRESSIONS && q.avg_position != null && q.avg_position > PAID_TEST_MIN_POSITION)
      .slice(0, 5);
  }

  const pages = [...bySlug.values()].map(p => ({
    ...p,
    ctr: p.impressions ? round(p.clicks / p.impressions, 3) : 0,
    avg_position: p.avg_position == null ? null : round(p.avg_position),
  }));
  pages.sort((a, b) => b.impressions - a.impressions || b.previews_started - a.previews_started);

  return {
    totals: pages.reduce((t, p) => ({
      impressions: t.impressions + p.impressions,
      clicks: t.clicks + p.clicks,
      cta_clicks: t.cta_clicks + p.cta_clicks,
      previews_started: t.previews_started + p.previews_started,
    }), { impressions: 0, clicks: 0, cta_clicks: 0, previews_started: 0 }),
    pages,
  };
}
