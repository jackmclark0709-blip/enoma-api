// api/_lib/trial-reminders.js
// Emails to an owner whose free month is ending (subscriptions.is_trial,
// trial_expires_at). Pure: no Supabase, Stripe or Resend calls here. The cron
// that uses these lives in api/ga-metrics.js (action=trial_reminders).
//
// Three reminders, each sent at most once per business (trial_reminders has
// a unique (business_id, kind)):
//   "7d"     6–7 days before the free month ends
//   "1d"     under 36 hours before it ends
//   "ended"  the first run after it ends (within 3 days), only for pages that
//            actually turn off. Grandfathered pages (api/_lib/trial-policy.js)
//            never turn off, so they never get "ended" and the wording never
//            says the page turns off.
//
// Paying customers are Stripe's job (renewal reminders, failed payments,
// expiring cards are Stripe's own emails), so anyone with a live Stripe
// subscription is skipped.

import { escapeHtml, wrapEmailHtml, emailButtonHtml } from "./email-html.js";
import { hasLiveStripeSubscription } from "./billing.js";
import { isGrandfathered } from "./trial-policy.js";
import { PRICE_LINE, PRICING_V2, formatChargeDate, priceLineFor, checkoutTermsLine } from "./pricing.js";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const REMINDER_KINDS = ["7d", "1d", "ended"];
export const MAX_SENDS_PER_RUN = 30;
// How far back/forward the cron looks for free months to remind about.
export const LOOKBACK_MS = 3 * DAY;
export const LOOKAHEAD_MS = 7 * DAY;

// Jack's own Enoma user (same id as ADMIN_USER_ID in api/generate-business.js).
// Pages Jack generated under his admin account (e.g. the 18 landscaping pages
// from Aug 3, 2026) list this user as owner until a real owner claims them.
export const JACK_USER_ID = "b2f87fe4-4d1e-4038-8754-5ab64969e975";

// Enoma's own and test pages. Never remind these.
export const INTERNAL_SLUGS = new Set(["enoma-io", "assayquant-technologies-inc", "qc-test-plumbing", "cars"]);
const INTERNAL_EMAILS = new Set(["jack@enoma.io", "jclark22@une.edu"]);

export function isInternalEmail(email) {
  if (!email) return false;
  const e = String(email).trim().toLowerCase();
  return INTERNAL_EMAILS.has(e) || e.includes("enoma.test");
}

/**
 * Which reminder is due now, or null. `sent` is the kinds already sent for
 * this business.
 */
export function reminderDue({ trialExpiresAt, now = Date.now(), sent = [] } = {}) {
  const ends = new Date(trialExpiresAt).getTime();
  const at = now instanceof Date ? now.getTime() : now;
  if (!Number.isFinite(ends) || !Number.isFinite(at)) return null;
  const done = new Set(sent || []);
  const left = ends - at;

  if (left <= 0) {
    return -left <= LOOKBACK_MS && !done.has("ended") ? "ended" : null;
  }
  if (left < 36 * HOUR) return done.has("1d") ? null : "1d";
  if (left >= 6 * DAY && left <= 7 * DAY) return done.has("7d") ? null : "7d";
  return null;
}

/** "Nov 16" in Eastern time (Enoma's customers are in New England). */
export function formatEndsOn(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" }).format(d);
}

/** Dashboard subscribe box for this business, with the reminder's UTM tags. */
export function buildSubscribeUrl(businessId, kind) {
  const params = new URLSearchParams({
    business_id: businessId,
    utm_source: "enoma",
    utm_medium: "email",
    utm_campaign: "trial_reminder",
    utm_content: kind,
  });
  return `https://enoma.io/dashboard?${params.toString()}#upgrade-banner`;
}

function priceSentence(monthlyPrice, yearlyPrice) {
  const tail = "with me as your account manager — text or email me any change and it's on your page within two business days.";
  return yearlyPrice
    ? `It's ${monthlyPrice}/month, or ${yearlyPrice}/year ${tail}`
    : `It's ${monthlyPrice}/month ${tail}`;
}

function buttonHtml(label, url) {
  return `<p style="margin:8px 0 24px;">${emailButtonHtml(label, url)}</p>`;
}

function paragraphHtml(text) {
  return `<p style="margin:0 0 16px;">${escapeHtml(text).replace(/\n/g, "<br>")}</p>`;
}

/**
 * { subject, text, html } for one reminder, or null when nothing should be
 * sent ("ended" for a grandfathered page, or an unknown kind).
 */
export function buildTrialReminderEmail({
  kind, businessName, ownerFirstName, pageUrl, endsOn, turnsOff,
  monthlyPrice, yearlyPrice, subscribeUrl, unsubscribeUrl, pricingVersion = null,
} = {}) {
  if (!REMINDER_KINDS.includes(kind)) return null;
  if (pricingVersion === PRICING_V2) {
    return buildPreviewEndingEmail({ kind, businessName, ownerFirstName, pageUrl, endsOn, subscribeUrl, unsubscribeUrl });
  }
  if (kind === "ended" && !turnsOff) return null;

  const name = businessName || "your business";
  const greeting = ownerFirstName ? `Hi ${ownerFirstName},` : "Hi,";
  // A grandfathered page stays live either way, so its button doesn't say
  // "keep my page live".
  const button = kind === "ended" ? "Turn my page back on" : turnsOff ? "Keep my page live" : "Subscribe";

  let subject;
  let before; // paragraphs above the button
  let after = []; // paragraphs below the button
  if (kind === "7d") {
    subject = `Your free month on Enoma ends ${endsOn}`;
    before = [
      greeting,
      `Your free month for ${name} on Enoma ends ${endsOn}.`,
      `You get your page, live at ${pageUrl}, with a call button and a quote form so customers can reach you.`,
      priceSentence(monthlyPrice, yearlyPrice),
      turnsOff
        ? `If you don't subscribe by ${endsOn}, your page turns off.`
        : "Subscribe to keep getting updates and support from me.",
    ];
    after = ["Questions? Just reply."];
  } else if (kind === "1d") {
    subject = turnsOff ? "Your page turns off tomorrow" : "Your free month ends tomorrow";
    before = [
      greeting,
      turnsOff
        ? `Your free month for ${name} ends tomorrow, and your page turns off unless you subscribe.`
        : `Your free month for ${name} ends tomorrow. Subscribe to keep getting updates and support from me.`,
    ];
  } else {
    subject = "Your page is paused";
    before = [greeting, "Your page is paused. Subscribe and it's back on right away."];
  }
  const signoff = "Jack\nEnoma";
  const footer = unsubscribeUrl ? `Don't want these reminders? Unsubscribe: ${unsubscribeUrl}` : null;

  const text = [
    ...before,
    `${button}: ${subscribeUrl}`,
    ...after,
    signoff,
    ...(footer ? [`—\n${footer}`] : []),
  ].join("\n\n");

  const html = wrapEmailHtml([
    ...before.map(paragraphHtml),
    buttonHtml(button, subscribeUrl),
    ...after.map(paragraphHtml),
    paragraphHtml(signoff),
    ...(unsubscribeUrl
      ? [`<p style="margin:24px 0 0;font-size:12px;color:#777777;">Don't want these reminders? <a href="${escapeHtml(unsubscribeUrl)}" style="color:#777777;">Unsubscribe</a></p>`]
      : []),
  ].join("\n"), { logo: true });

  return { subject, text, html };
}

/**
 * Why this business gets no reminder, or null if it may get one.
 * candidate: { slug, isInternal, isClaimed, ownerUserIds, ownerEmail,
 *              profileEmail, sub, suppressed }
 */
export function reminderSkipReason(c) {
  if (!c) return "missing";
  if (c.isInternal === true || INTERNAL_SLUGS.has(c.slug) || isInternalEmail(c.ownerEmail) || isInternalEmail(c.profileEmail)) {
    return "internal";
  }
  if (c.isClaimed !== true) return "unclaimed";
  const owners = c.ownerUserIds || [];
  if (!owners.length) return "no_owner";
  if (owners.every((id) => id === JACK_USER_ID)) return "jack_owned";
  if (!c.ownerEmail) return "no_owner_email";
  const sub = c.sub || {};
  if (sub.is_trial !== true) return "not_on_free_month";
  if (hasLiveStripeSubscription(sub)) return "already_paying";
  if (sub.provider === "comped") return "comped";
  if (c.suppressed) return "suppressed";
  return null;
}

/**
 * Splits candidates into what to send now and what to skip (with a reason).
 * Each due item gets `kind` and `turnsOff`. At most `cap` are due; the rest
 * are skipped as "cap" and picked up on the next run.
 */
export function planTrialReminders(candidates, { now = Date.now(), env = process.env, cap = MAX_SENDS_PER_RUN } = {}) {
  const due = [];
  const skipped = [];
  for (const c of candidates || []) {
    const reason = reminderSkipReason(c);
    if (reason) { skipped.push({ slug: c?.slug, reason }); continue; }
    const kind = reminderDue({ trialExpiresAt: c.sub.trial_expires_at, now, sent: c.sent });
    if (!kind) { skipped.push({ slug: c.slug, reason: "nothing_due" }); continue; }
    const turnsOff = !isGrandfathered(c.createdAt, env);
    if (kind === "ended" && !turnsOff) { skipped.push({ slug: c.slug, reason: "grandfathered_no_ended" }); continue; }
    if (due.length >= cap) { skipped.push({ slug: c.slug, reason: "cap" }); continue; }
    due.push({ ...c, kind, turnsOff });
  }
  return { due, skipped };
}

/** The one-line note to Jack, or null when nothing went out. */
export function buildJackSummary(sent) {
  if (!sent || !sent.length) return null;
  const line = `Trial reminders sent: ${sent.map((s) => `${s.businessName} (${s.kind})`).join(", ")}`;
  return { subject: `Trial reminders sent (${sent.length})`, text: line };
}

// ── Pricing v2 ($1 first month, api/_lib/pricing.js) ─────────────────────
// A v2 page is a free preview until the owner goes live through checkout, so
// its reminders talk about the preview, not a free month. Every email that
// shows a price carries the full PRICE_LINE.

function renderEmail({ before, button, buttonUrl, after = [], unsubscribeUrl = null }) {
  const signoff = "Jack\nEnoma";
  const footer = unsubscribeUrl ? `Don't want these reminders? Unsubscribe: ${unsubscribeUrl}` : null;
  const text = [
    ...before,
    ...(button ? [`${button}: ${buttonUrl}`] : []),
    ...after,
    signoff,
    ...(footer ? [`—\n${footer}`] : []),
  ].join("\n\n");
  const html = wrapEmailHtml([
    ...before.map(paragraphHtml),
    ...(button ? [buttonHtml(button, buttonUrl)] : []),
    ...after.map(paragraphHtml),
    paragraphHtml(signoff),
    ...(unsubscribeUrl
      ? [`<p style="margin:24px 0 0;font-size:12px;color:#777777;">Don't want these reminders? <a href="${escapeHtml(unsubscribeUrl)}" style="color:#777777;">Unsubscribe</a></p>`]
      : []),
  ].join("\n"), { logo: true });
  return { text, html };
}

/** Preview-window reminders for a v2 page that hasn't gone live yet. */
export function buildPreviewEndingEmail({ kind, businessName, ownerFirstName, pageUrl, endsOn, subscribeUrl, unsubscribeUrl } = {}) {
  if (!REMINDER_KINDS.includes(kind)) return null;
  const name = businessName || "your business";
  const greeting = ownerFirstName ? `Hi ${ownerFirstName},` : "Hi,";
  let subject;
  let before;
  if (kind === "7d") {
    subject = `Your Enoma preview ends ${endsOn}`;
    before = [
      greeting,
      `Your preview page for ${name} is at ${pageUrl}, and it stays up until ${endsOn}.`,
      "When you're happy with it, go live: your page is shown to Google and stays up, with a call button and a quote form that send customers straight to you.",
      PRICE_LINE,
    ];
  } else if (kind === "1d") {
    subject = "Your Enoma preview ends tomorrow";
    before = [greeting, `Your preview page for ${name} comes down tomorrow unless you go live.`, PRICE_LINE];
  } else {
    subject = "Your Enoma preview has ended";
    before = [greeting, `Your preview for ${name} has ended. Go live and it's back up right away.`, PRICE_LINE];
  }
  const { text, html } = renderEmail({
    before, button: "Go live for $1", buttonUrl: subscribeUrl, after: ["Questions? Just reply."], unsubscribeUrl,
  });
  return { subject, text, html };
}

/** Dashboard link that opens Stripe's billing portal (change plan, card, cancel) once signed in. */
export function buildManageBillingUrl(businessId) {
  const params = new URLSearchParams({ business_id: businessId, billing: "1" });
  return `https://enoma.io/dashboard?${params.toString()}`;
}

export const CHARGE_REMINDER_KIND = "charge_3d";
export const FIRST_PAID_KIND = "first_paid";
// The cron runs once a day, so "3 days before" is the first run with
// 3.5 days or less to go.
export const CHARGE_REMINDER_WINDOW_MS = 3.5 * DAY;

/** "charge_3d" when the first full charge is 3 days out and not yet reminded, else null. */
export function chargeReminderDue({ chargeAt, now = Date.now(), sent = [] } = {}) {
  const t = new Date(chargeAt).getTime();
  const at = now instanceof Date ? now.getTime() : now;
  if (!Number.isFinite(t) || !Number.isFinite(at)) return null;
  const left = t - at;
  if (left <= 0 || left > CHARGE_REMINDER_WINDOW_MS) return null;
  return (sent || []).includes(CHARGE_REMINDER_KIND) ? null : CHARGE_REMINDER_KIND;
}

/** Why a v2 subscription gets no charge reminder, or null. */
export function chargeReminderSkipReason(c) {
  if (!c) return "missing";
  if (c.isInternal === true || INTERNAL_SLUGS.has(c.slug) || isInternalEmail(c.ownerEmail)) return "internal";
  if (!c.ownerEmail) return "no_owner_email";
  const sub = c.sub || {};
  if (sub.pricing_version !== PRICING_V2) return "not_v2";
  if (sub.status !== "trialing" || !sub.stripe_subscription_id) return "not_in_first_month";
  if (sub.cancel_at_period_end) return "canceling";
  return null;
}

/** One line on the page's activity, or null when there's nothing to report. */
export function activityLine(activity) {
  if (!activity) return null;
  const views = Number(activity.views) || 0;
  const clicks = Number(activity.contactClicks) || 0;
  if (!views && !clicks) return null;
  const v = `${views} page view${views === 1 ? "" : "s"}`;
  const c = `${clicks} contact click${clicks === 1 ? "" : "s"} (calls, emails and quote requests)`;
  return `Since you went live: ${v} and ${c}.`;
}

/**
 * Sent 3 days before the first full charge of a v2 subscription: the amount,
 * the date, a line of activity if there is any, and a one-click link to
 * manage or cancel.
 */
export function buildChargeReminderEmail({ businessName, ownerFirstName, amount, interval = "month", chargeDate, activity = null, manageUrl, partner = false } = {}) {
  if (!amount || !chargeDate || !manageUrl) return null;
  const name = businessName || "your page";
  const date = formatChargeDate(chargeDate);
  const per = interval === "year" ? "year" : "month";
  const before = [
    ownerFirstName ? `Hi ${ownerFirstName},` : "Hi,",
    `A heads-up: your first full charge for ${name} is ${amount} on ${date}, then ${amount} every ${per} after that.`,
    ...(activityLine(activity) ? [activityLine(activity)] : []),
    "Nothing to do if you're staying. To change your plan or cancel, it's one click:",
  ];
  const { text, html } = renderEmail({
    before, button: "Manage or cancel", buttonUrl: manageUrl,
    after: [`Your plan: ${priceLineFor({ partner })}`, "Questions? Just reply."],
  });
  return { subject: `Your first Enoma charge: ${amount} on ${date}`, text, html };
}

/** Confirmation after the $1 first-month charge, with the renewal terms. */
export function buildFirstMonthConfirmationEmail({ businessName, ownerFirstName, amount, interval = "month", chargeDate, pageUrl, manageUrl, partner = false } = {}) {
  if (!amount || !chargeDate || !manageUrl) return null;
  const name = businessName || "your business";
  const date = formatChargeDate(chargeDate);
  const per = interval === "year" ? "year" : "month";
  const before = [
    ownerFirstName ? `Hi ${ownerFirstName},` : "Hi,",
    `Thanks. Your $1 first month for ${name} is paid${pageUrl ? ` and your page is live at ${pageUrl}` : ""}.`,
    `Next: ${amount}/${per} starting ${date}. I'll email you 3 days before that charge. Cancel anytime from your dashboard.`,
    `Your plan: ${priceLineFor({ partner })}`,
  ];
  const { text, html } = renderEmail({ before, button: "Manage billing", buttonUrl: manageUrl, after: ["Questions or changes to your page? Just reply."] });
  return { subject: "You're live on Enoma", text, html };
}

/**
 * Jack's "send checkout link" after a setup call (api/ga-metrics.js
 * action=checkout_link). firstMonth: the $1 offer applies (v2, never
 * subscribed). Stripe Checkout links expire after 24 hours.
 */
export function buildCheckoutLinkEmail({ businessName, ownerFirstName, url, interval = "month", chargeDate, firstMonth = true, partner = false } = {}) {
  if (!url) return null;
  const name = businessName || "your page";
  const monthlyPrice = partner ? "$9.99" : "$19.99";
  const before = [
    ownerFirstName ? `Hi ${ownerFirstName},` : "Hi,",
    `Thanks for the call. Here's the link to put ${name} live. It works for 24 hours; if it runs out, just reply and I'll send another.`,
    firstMonth
      ? checkoutTermsLine({ interval, chargeDate, monthlyPrice })
      : `${interval === "year" ? "$199/year" : `${monthlyPrice}/month`}. Cancel anytime from your dashboard.`,
    ...(firstMonth ? [`Your plan: ${priceLineFor({ partner })}`] : []),
  ];
  const { text, html } = renderEmail({ before, button: firstMonth ? "Go live for $1" : "Go live", buttonUrl: url, after: ["Questions? Just reply."] });
  return { subject: `Your Enoma page: ready to go live`, text, html };
}
