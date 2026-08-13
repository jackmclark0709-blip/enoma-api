// Pure lead-scoring helpers for the internal sales queue (api/ga-metrics.js,
// action=sales_queue). Kept dependency-free/framework-free so they can be
// unit tested directly (see tests/lead-scoring.test.js), same pattern as
// service-utils.js. Lives under api/_lib — excluded from the 12-function cap.
//
// Three distinct lead populations exist in this app and must never be mixed
// (see project notes on contact_submissions): raw Enoma-side leads
// (contact_submissions where business_id IS NULL), and outbound prospects
// (prospects + outreach_messages, the Outscraper pipeline). A third
// population — people who start the self-serve create.html wizard but never
// finish — is deliberately NOT scored into individually-actionable leads
// here: funnel_events only carries an anon_id (no name/email/phone) until
// AFTER generation succeeds, at which point a page already exists. There is
// no honest way to turn those anonymous rows into "call this person" leads,
// so they're surfaced only as an aggregate funnel-health panel instead.

const DAY_MS = 24 * 60 * 60 * 1000;

export const daysSince = (iso, now = Date.now()) =>
  iso ? (now - new Date(iso).getTime()) / DAY_MS : null;

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// Full weight for the first 3 days, decays to a floor by day 30. Never hits
// zero — an old hot lead is still worth surfacing, just not at the top.
export function recencyFactor(days) {
  if (days === null) return 0.6;
  if (days <= 3) return 1;
  if (days >= 30) return 0.35;
  return 1 - ((days - 3) / 27) * 0.65;
}

export function tierFor(score) {
  if (score >= 70) return "hot";
  if (score >= 40) return "warm";
  return "cold";
}

function finalize(base, activityIso, now) {
  const days = daysSince(activityIso, now);
  const score = clamp(Math.round(base * recencyFactor(days)), 0, 100);
  return { score, tier: tierFor(score), days_since_activity: days === null ? null : Math.round(days) };
}

// row: { source, phone, is_read, replied_at, created_at }
export function scoreRawLead(row, now = Date.now()) {
  let base = 55;
  if (row.source === "choose_path_concierge") base += 20;
  else if (row.source === "started_form") base += 10;
  if (row.phone) base += 10;

  if (row.replied_at) base -= 25;
  else if (row.is_read === false) base += 10;

  return finalize(base, row.created_at, now);
}

const PROSPECT_STATUS_WEIGHT = {
  new: 10,
  dedup_match: 5,
  reviewed: 20,
  drafted: 35,
  approved: 45,
  sent: 55,
};

// args: { prospectStatus, outreachStatus, responseStatus, lastActivityAt }
// Returns null for suppressed/dead prospects (skipped by Jack, bounced, or
// opted out) so they drop out of the active queue entirely.
export function scoreProspect(args, now = Date.now()) {
  const { prospectStatus, outreachStatus, responseStatus, lastActivityAt } = args;
  if (prospectStatus === "skipped") return null;
  if (responseStatus === "opted_out" || responseStatus === "bounced") return null;

  let base = PROSPECT_STATUS_WEIGHT[prospectStatus] ?? 10;
  if (outreachStatus === "sent") base = Math.max(base, 55);
  if (responseStatus === "replied") base = 90;
  if (responseStatus === "claimed") base = 100;

  return finalize(base, lastActivityAt, now);
}
