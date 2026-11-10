// Alerts to Jack about the outreach pipeline itself (not about prospects).
// Each kind goes out at most once per UTC day; the last day sent is kept in
// the system_alerts table (supabase/migrations/20261110_outreach_followup2_and_alerts.sql)
// so a run every couple of hours can't fill his inbox.

export const ALERT_TO = "jack@enoma.io";
export const ALERT_FROM = "Enoma <noreply@enoma.io>";

export const ALERT_KEYS = {
  zerobounceServiceError: "zerobounce_service_error",
  verifyRetrySpike: "verify_retry_spike",
};

// More than this many prospects parked at verify_retry in 24 h means
// ZeroBounce is failing on us even without a clear account error.
export const VERIFY_RETRY_ALERT_THRESHOLD = 10;

export function utcDay(date = new Date()) {
  return new Date(date).toISOString().slice(0, 10);
}

// lastSentOn is a "YYYY-MM-DD" (or null). True when nothing has gone out yet
// today (UTC).
export function alertDueToday(lastSentOn, now = new Date()) {
  if (!lastSentOn) return true;
  return String(lastSentOn).slice(0, 10) < utcDay(now);
}

export function shouldAlertVerifyRetrySpike(count, threshold = VERIFY_RETRY_ALERT_THRESHOLD) {
  return Number(count) > threshold;
}

export function buildZeroBounceAlert(reason) {
  const why = String(reason || "unknown error").trim();
  const text = `ZeroBounce isn't verifying addresses (${why}). No new cold emails will go out until it's fixed. Check credits at zerobounce.net.`;
  return { subject: "ZeroBounce isn't verifying addresses", text };
}

export function buildVerifyRetrySpikeAlert(count) {
  return buildZeroBounceAlert(`${count} prospects moved to verify_retry in the last 24 hours`);
}
