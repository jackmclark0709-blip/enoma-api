// One label per signup / visit source, for the morning brief's "traffic by
// source" and signup reports. Input is an attribution object as stored by
// api/_lib/attribution.js (businesses.first_touch, prospects.raw.attribution,
// funnel_events.metadata / metadata.first_touch).
//
// SQL twin: public.attribution_source_label() in
// supabase/migrations/20261113_comment_keyword_sources.sql, used by the
// v_funnel_sources_daily and v_signups_by_source views. Keep the two in step;
// tests/traffic-sources.test.js checks the labels appear in the SQL.

import { COMMENT_SRC } from "./attribution.js";

export const SOURCE_LABELS = {
  comment_fb: "Comment (FB)",
  comment_ig: "Comment (IG)",
  comment: "Comment",
  cold_email: "Cold email",
  google: "Google",
  social: "Facebook / Instagram",
  bing: "Bing",
  direct: "Direct"
};

const host = (url) => {
  const m = typeof url === "string" ? url.match(/^https?:\/\/(?:www\.)?([^/:?#]+)/i) : null;
  return m ? m[1].toLowerCase() : "";
};

/** The source label for one attribution object (never empty). */
export function sourceLabel(t) {
  const a = t && typeof t === "object" ? t : {};
  const str = (k) => (typeof a[k] === "string" ? a[k].trim().toLowerCase() : "");

  if (str("src") === COMMENT_SRC) {
    if (str("ch") === "fb") return SOURCE_LABELS.comment_fb;
    if (str("ch") === "ig") return SOURCE_LABELS.comment_ig;
    return SOURCE_LABELS.comment;
  }

  const utm = str("utm_source");
  if (utm) {
    if (utm === "cold_email") return SOURCE_LABELS.cold_email;
    if (/^(google|adwords|gads)$/.test(utm)) return SOURCE_LABELS.google;
    if (/^(facebook|fb|instagram|ig|meta)$/.test(utm)) return SOURCE_LABELS.social;
    if (utm === "bing") return SOURCE_LABELS.bing;
    return utm;
  }

  const h = host(a.referrer);
  if (!h || h.endsWith("enoma.io") || h.endsWith(".vercel.app") || /^(localhost|127\.0\.0\.1)$/.test(h)) return SOURCE_LABELS.direct;
  if (/(^|\.)google\./.test(h)) return SOURCE_LABELS.google;
  if (/(^|\.)(facebook\.com|fb\.com|instagram\.com)$/.test(h)) return SOURCE_LABELS.social;
  if (/(^|\.)bing\.com$/.test(h)) return SOURCE_LABELS.bing;
  return h;
}

/**
 * The source of a funnel_events row. A comment tag on the event itself
 * (metadata.src, sent by get-your-website.html for this visit) wins over the
 * browser's stored first touch (metadata.first_touch).
 */
export function funnelSourceLabel(row) {
  const meta = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  if (typeof meta.src === "string" && meta.src.trim().toLowerCase() === COMMENT_SRC) return sourceLabel(meta);
  return sourceLabel(meta.first_touch || meta);
}
