// api/_lib/results-email.js
// The monthly "here's what your page brought in" email to customers.
// Renewals ride on owners *seeing* the calls; this makes it land in their inbox
// on the 1st instead of hoping they log into the dashboard. Pure helpers.

/** Previous calendar month in UTC: { start, end, label } where end is exclusive. */
export function previousMonth(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const label = start.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  return { start, end, label };
}

/** Split contact_click events into phone taps vs other taps (email, map, CTA). */
export function tallyClicks(events) {
  let calls = 0, other = 0;
  for (const e of events || []) {
    const type = String(e?.metadata?.type || "").toLowerCase();
    if (type === "contact_form") continue; // counted via real submissions instead
    if (type.includes("call") || type === "phone") calls++; else other++;
  }
  return { calls, other };
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * @returns {{ subject: string, text: string } | null} null when there's
 *          nothing worth reporting (no views at all) — Jack gets a list of those.
 */
export function buildResultsEmail({ businessName, ownerName, monthLabel, views, calls, otherClicks, quoteRequests, pageUrl, dashboardUrl = "https://enoma.io/dashboard" }) {
  if (!views) return null;
  const actions = calls + otherClicks + quoteRequests;
  const headline = actions
    ? `${plural(actions, "customer reached out", "customers reached out")} through your page in ${monthLabel}`
    : `Your page had ${plural(views, "visit", "visits")} in ${monthLabel}`;

  const lines = [
    `Hi ${ownerName || "there"},`,
    "",
    `Here's what your Enoma page did for ${businessName} in ${monthLabel}:`,
    "",
    `- ${plural(views, "visit", "visits")} to your page`,
    `- ${plural(calls, "tap", "taps")} to call you`,
    `- ${plural(quoteRequests, "quote request", "quote requests")} sent to your inbox`,
    ...(otherClicks ? [`- ${plural(otherClicks, "other tap", "other taps")} to email you or get directions`] : []),
    "",
    actions
      ? "Every one of those is someone who found you and reached out directly — no shared leads, no directory fees."
      : "No one reached out through the page this month. Reply to this email and I'll look at what we can change — new photos and a couple of Google reviews on the page usually help most.",
    "",
    `Your page: ${pageUrl}`,
    `Your dashboard: ${dashboardUrl}`,
    "",
    "Questions or changes? Just reply — this comes straight to me.",
    "",
    "Jack Clark",
    "Enoma",
  ];
  return { subject: `${businessName}: ${headline}`, text: lines.join("\n") };
}
