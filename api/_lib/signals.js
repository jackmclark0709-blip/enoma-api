// Pure helpers for the signal ledger (supabase/migrations/20261116_signals.sql):
// who counts as internal, dedupe keys, the send window in the prospect's own
// time zone, the canSend() guardrails, the follow-up email templates, and
// Jack's HOT alert. Database and Resend work lives in api/_lib/signal-store.js.

import { GUARDRAILS, ruleFor } from "./followup-rules.js";
import { INTERNAL_SLUGS, isInternalEmail } from "./trial-reminders.js";
import { bannedWordsIn } from "./copy-lint.js";
import { cleanBusinessName } from "./outreach-email.js";
import { PRICE_LINE } from "./outreach-variant-b.js";
import { escapeHtml } from "./email-html.js";

export { PRICE_LINE };

// ── Kill switch ─────────────────────────────────────────────────────────────
// off      record signals only: nothing scheduled, no alerts
// dry_run  (default) schedule followup_sends rows and render them, send none;
//          HOT alerts to Jack still go out
// live     send
export const FOLLOWUP_MODES = ["off", "dry_run", "live"];
export function followupsMode(env = process.env) {
  const m = String(env.FOLLOWUPS_MODE || "").trim().toLowerCase();
  return FOLLOWUP_MODES.includes(m) ? m : "dry_run";
}

// ── Internal / test ─────────────────────────────────────────────────────────
// Same rules as the daily run: businesses.is_internal, the internal slugs,
// enoma.test addresses and Jack's own addresses. More of Jack's addresses can
// be added without a deploy via SIGNAL_INTERNAL_EMAILS (comma separated).
export function isInternalPerson({ isInternal, slug, email, trafficClass } = {}, env = process.env) {
  if (isInternal === true) return true;
  if (trafficClass === "internal") return true;
  if (slug && INTERNAL_SLUGS.has(String(slug).toLowerCase())) return true;
  if (isInternalEmail(email)) return true;
  const extra = String(env.SIGNAL_INTERNAL_EMAILS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  if (email && extra.includes(String(email).trim().toLowerCase())) return true;
  return false;
}

// Only a real outside person creates a signal.
export function isHumanSignal({ trafficClass, ...person } = {}) {
  if (trafficClass && trafficClass !== "human") return false;
  return !isInternalPerson(person);
}

// A Resend click this soon after the email was delivered (or sent, if no
// delivery event yet) is a mail scanner checking the link on arrival.
export function isScannerClick({ clickedAt, deliveredAt, sentAt, windowMs = GUARDRAILS.scannerClickWindowMs }) {
  const click = new Date(clickedAt).getTime();
  const base = new Date(deliveredAt || sentAt || NaN).getTime();
  if (!Number.isFinite(click) || !Number.isFinite(base)) return false;
  return click - base >= 0 && click - base < windowMs;
}

export function normEmail(email) {
  const e = String(email || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

export function utcDay(at = Date.now()) {
  return new Date(at).toISOString().slice(0, 10);
}

// One row per real-world event. Retried webhooks and re-scans land on the
// same key, so the insert is a no-op the second time.
export function dedupeKey(type, parts = {}) {
  const p = parts;
  switch (type) {
    case "email_click": return `email_click:${p.messageId || p.prospectId}`;
    case "preview_visit": return `preview_visit:${p.prospectId || p.slug}`;
    case "repeat_visit": return `repeat_visit:${p.prospectId || p.slug}:${utcDay(p.at)}`;
    case "preview_started_no_email": return `preview_started_no_email:${p.anonId || p.eventId}`;
    case "preview_no_claim": return `preview_no_claim:${p.businessId}`;
    case "claim_no_checkout": return `claim_no_checkout:${p.businessId}`;
    // Stripe expiry and the funnel scan can both see one abandonment: same key per business per day.
    case "checkout_abandoned": return `checkout_abandoned:${p.businessId ? `${p.businessId}:${utcDay(p.at)}` : p.sessionId}`;
    case "email_reply": return `email_reply:${p.inboundId}`;
    case "unsubscribe": case "bounce": case "complaint": return `${type}:${normEmail(p.email) || p.email}`;
    case "fb_message": case "fb_comment": return `${type}:${p.externalId || `${p.subscriberId}:${p.at}`}`;
    case "payment_failed": return `payment_failed:${p.invoiceId}`;
    case "subscription_canceled": return `subscription_canceled:${p.subscriptionId}`;
    default: throw new Error(`Unknown signal type: ${type}`);
  }
}

// ── Prospect-local send window ──────────────────────────────────────────────
const STATE_TZ = {
  AL: "America/Chicago", AK: "America/Anchorage", AZ: "America/Phoenix", AR: "America/Chicago",
  CA: "America/Los_Angeles", CO: "America/Denver", CT: "America/New_York", DE: "America/New_York",
  DC: "America/New_York", FL: "America/New_York", GA: "America/New_York", HI: "Pacific/Honolulu",
  ID: "America/Boise", IL: "America/Chicago", IN: "America/Indiana/Indianapolis", IA: "America/Chicago",
  KS: "America/Chicago", KY: "America/New_York", LA: "America/Chicago", ME: "America/New_York",
  MD: "America/New_York", MA: "America/New_York", MI: "America/Detroit", MN: "America/Chicago",
  MS: "America/Chicago", MO: "America/Chicago", MT: "America/Denver", NE: "America/Chicago",
  NV: "America/Los_Angeles", NH: "America/New_York", NJ: "America/New_York", NM: "America/Denver",
  NY: "America/New_York", NC: "America/New_York", ND: "America/Chicago", OH: "America/New_York",
  OK: "America/Chicago", OR: "America/Los_Angeles", PA: "America/New_York", RI: "America/New_York",
  SC: "America/New_York", SD: "America/Chicago", TN: "America/Chicago", TX: "America/Chicago",
  UT: "America/Denver", VT: "America/New_York", VA: "America/New_York", WA: "America/Los_Angeles",
  WV: "America/New_York", WI: "America/Chicago", WY: "America/Denver"
};
const STATE_NAMES = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO",
  connecticut: "CT", delaware: "DE", "district of columbia": "DC", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY",
  louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH",
  "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND",
  ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY"
};

export function timeZoneForState(state) {
  const s = String(state || "").trim();
  const abbr = s.length === 2 ? s.toUpperCase() : STATE_NAMES[s.toLowerCase()];
  return STATE_TZ[abbr] || GUARDRAILS.defaultTimeZone;
}

function zonedParts(at, timeZone) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit"
  });
  const o = {};
  for (const p of f.formatToParts(new Date(at))) o[p.type] = p.value;
  return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour, mi: +o.minute, s: +o.second };
}

// The UTC instant for a wall-clock time in a zone (DST-safe for whole hours).
function zonedToUtc({ y, mo, d, h, mi }, timeZone) {
  let guess = Date.UTC(y, mo - 1, d, h, mi);
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(guess, timeZone);
    const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
    const want = Date.UTC(y, mo - 1, d, h, mi);
    guess += want - asUtc;
  }
  return guess;
}

export function localHour(at, timeZone) {
  return zonedParts(at, timeZone).h;
}

export function inSendWindow(at, timeZone, g = GUARDRAILS) {
  const h = localHour(at, timeZone);
  return h >= g.sendWindowStartHour && h < g.sendWindowEndHour;
}

// `at` if it's inside 8am-7pm local; otherwise the next 8:15am local.
export function nextSendTime(at, timeZone, g = GUARDRAILS) {
  const t = new Date(at).getTime();
  if (inSendWindow(t, timeZone, g)) return new Date(t);
  const p = zonedParts(t, timeZone);
  let day = { y: p.y, mo: p.mo, d: p.d };
  if (p.h >= g.sendWindowEndHour) {
    const next = new Date(Date.UTC(p.y, p.mo - 1, p.d + 1));
    day = { y: next.getUTCFullYear(), mo: next.getUTCMonth() + 1, d: next.getUTCDate() };
  }
  return new Date(zonedToUtc({ ...day, h: g.nextMorning.hour, mi: g.nextMorning.minute }, timeZone));
}

// ── The one gate every automated email goes through ─────────────────────────
// ctx: what's true about the recipient right now (read fresh at send time).
// Returns { ok: true } or { ok: false, reason, retryAt?, status }:
//   status "suppressed"  the address must never get mail (unsub/bounce/complaint)
//   status "cancelled"   this send is moot (replied, claimed, paid, cap...)
//   retryAt              not now, but later (quiet hours, 24 h spacing)
export function canSend(ctx = {}, g = GUARDRAILS) {
  const now = ctx.now ?? Date.now();
  const rule = ruleFor(ctx.signalType);
  const stopIf = rule?.stopIf || [];
  if (!normEmail(ctx.recipient)) return { ok: false, status: "cancelled", reason: "no_email" };
  if (ctx.isInternal) return { ok: false, status: "cancelled", reason: "internal" };
  if (ctx.suppressed) return { ok: false, status: "suppressed", reason: "suppressed" };
  if (ctx.unsubscribed) return { ok: false, status: "suppressed", reason: "unsubscribed" };
  if (ctx.bounced) return { ok: false, status: "suppressed", reason: "bounced" };
  if (ctx.complained) return { ok: false, status: "suppressed", reason: "complained" };
  if (ctx.replied) return { ok: false, status: "cancelled", reason: "replied" };
  if (ctx.isCustomer || ctx.checkoutCompleted) return { ok: false, status: "cancelled", reason: "customer" };
  if (stopIf.includes("claimed") && ctx.claimed) return { ok: false, status: "cancelled", reason: "claimed" };
  if (rule?.oncePer === "visit_followup" && ctx.visitFollowupSent) return { ok: false, status: "cancelled", reason: "visit_followup_already_sent" };
  if ((ctx.automatedSentEver || 0) >= g.maxAutomatedPerPersonEver) return { ok: false, status: "cancelled", reason: "lifetime_cap" };
  const last = ctx.lastAutomatedAt ? new Date(ctx.lastAutomatedAt).getTime() : null;
  if (last && now - last < g.minGapMs) {
    const tz = ctx.timeZone || g.defaultTimeZone;
    return { ok: false, reason: "gap_24h", retryAt: nextSendTime(last + g.minGapMs, tz, g).toISOString() };
  }
  const tz = ctx.timeZone || g.defaultTimeZone;
  if (!inSendWindow(now, tz, g)) return { ok: false, reason: "quiet_hours", retryAt: nextSendTime(now, tz, g).toISOString() };
  return { ok: true };
}

// ── Email copy rules ────────────────────────────────────────────────────────
// copy-lint's banned words, plus the outreach rules: no "free" (only the
// preview may be called that, and these emails don't need to), no ranking
// promises, never name Conway's Landscaping.
const RANKING_RE = /\b(rank(?:ing|ed|s)?|first page|page one|top of google|#1|number one|seo guarantee)\b/i;
export function emailCopyIssues(text) {
  const t = String(text || "");
  const body = t.split("\n---\n")[0];
  const issues = [];
  for (const w of bannedWordsIn(body)) issues.push(`banned word: ${w}`);
  if (/\bfree\b/i.test(body) && !/\bfree preview\b/i.test(body)) issues.push("says free");
  if (RANKING_RE.test(body)) issues.push("ranking promise");
  if (/conway/i.test(t)) issues.push("names Conway's");
  return issues;
}

export const FOLLOWUP_UTM = { utm_source: "followup", utm_medium: "email", utm_campaign: "visit_followup" };

export function withFollowupUtm(url, campaign = FOLLOWUP_UTM.utm_campaign) {
  if (!url) return null;
  const u = new URL(url);
  u.searchParams.set("utm_source", FOLLOWUP_UTM.utm_source);
  u.searchParams.set("utm_medium", FOLLOWUP_UTM.utm_medium);
  u.searchParams.set("utm_campaign", campaign);
  return u.toString();
}

// ── Follow-up templates ─────────────────────────────────────────────────────
// Short, plain text, from Jack. vars: businessName, pageUrl, dashboardUrl,
// checkoutUrl, originalSubject. The compliance footer is appended by
// renderFollowup, so every one carries the unsubscribe link and address.
export const FOLLOWUP_TEMPLATES = {
  visit_followup: (v) => ({
    subject: v.originalSubject ? `Re: ${String(v.originalSubject).replace(/^\s*re:\s*/i, "")}` : `The page I made for ${v.name}`,
    body: [
      "Hi there,",
      `Saw you had a look at the page I made for ${v.name}. Want me to change anything before it goes live?`,
      withFollowupUtm(v.pageUrl, "visit_followup"),
      PRICE_LINE,
      "Just reply here.",
      "Jack"
    ]
  }),
  preview_no_claim_1: (v) => ({
    subject: `Your page for ${v.name}`,
    body: [
      "Hi there,",
      `Your page for ${v.name} is ready: ${withFollowupUtm(v.pageUrl, "preview_no_claim")}`,
      "Want me to change anything before it goes live? Reply and tell me what, and I'll do it.",
      PRICE_LINE,
      "Jack"
    ]
  }),
  preview_no_claim_2: (v) => ({
    subject: `Re: Your page for ${v.name}`,
    body: [
      "Hi there,",
      `Checking in on the page for ${v.name}: ${withFollowupUtm(v.pageUrl, "preview_no_claim")}`,
      "Happy to make changes or set it up with you over the phone. It takes about ten minutes.",
      PRICE_LINE,
      "Jack"
    ]
  }),
  claim_no_checkout_1: (v) => ({
    subject: `${v.name} is almost live`,
    body: [
      "Hi there,",
      `You claimed the page for ${v.name}. One step left to put it live: ${withFollowupUtm(v.dashboardUrl, "claim_no_checkout")}`,
      PRICE_LINE,
      "If something's off on the page or you have a question, just reply.",
      "Jack"
    ]
  }),
  claim_no_checkout_2: (v) => ({
    subject: `Re: ${v.name} is almost live`,
    body: [
      "Hi there,",
      `Anything I can change on the ${v.name} page before it goes live? ${withFollowupUtm(v.dashboardUrl, "claim_no_checkout")}`,
      PRICE_LINE,
      "Just reply, I read every one.",
      "Jack"
    ]
  }),
  checkout_abandoned: (v) => ({
    subject: `Checkout for ${v.name}`,
    body: [
      "Hi there,",
      `Looks like checkout for ${v.name} didn't finish. If something went wrong or you had a question, just reply.`,
      `Here's a link to pick up where you left off: ${v.checkoutUrl ? v.checkoutUrl : withFollowupUtm(v.dashboardUrl, "checkout_abandoned")}`,
      PRICE_LINE,
      "Jack"
    ]
  })
};

// Rendered email, compliance footer included.
export function renderFollowup(template, vars = {}, { unsubscribeUrl, mailingAddress } = {}) {
  const t = FOLLOWUP_TEMPLATES[template];
  if (!t) throw new Error(`Unknown follow-up template: ${template}`);
  const name = cleanBusinessName(vars.businessName) || "your business";
  const { subject, body } = t({ ...vars, name });
  const main = body.filter(Boolean).join("\n\n");
  const text = `${main}\n\n---\n${mailingAddress}\nDon't want these emails? ${unsubscribeUrl}`;
  const linkify = (s) => escapeHtml(s).replace(/https:\/\/[^\s<]+/g, (u) => `<a href="${u}" style="color:#1a73e8;">${u}</a>`);
  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#ffffff;">
<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#222222;max-width:560px;margin:0 auto;padding:24px 16px;">
${body.filter(Boolean).map(p => `<p style="margin:0 0 16px;">${linkify(p)}</p>`).join("\n")}
<p style="margin:8px 0 0;font-size:12px;color:#888888;border-top:1px solid #eeeeee;padding-top:12px;">${escapeHtml(mailingAddress)}<br><a href="${escapeHtml(unsubscribeUrl)}" style="color:#888888;">Unsubscribe</a></p>
</div></body></html>`;
  return { subject, text, html, issues: emailCopyIssues(text) };
}

// ── HOT alert for Jack ──────────────────────────────────────────────────────
const WHAT = {
  email_click: "clicked your email",
  repeat_visit: "came back to their page",
  email_reply: "replied",
  fb_message: "messaged on Facebook",
  checkout_abandoned: "started checkout and didn't finish",
  payment_failed: "payment failed"
};

export function shouldAlert(type) {
  return ruleFor(type)?.alert === true;
}

// One alert per prospect (or business/email) per signal type per day.
export function alertKey({ type, prospectId, businessId, email, at = Date.now() }) {
  const who = prospectId || businessId || normEmail(email) || "unknown";
  return `${type}:${who}:${utcDay(at)}`;
}

export function buildHotAlert({ type, businessName, city, state, trade, at, previewUrl, email, phone, replyText, detail } = {}) {
  const name = String(businessName || email || "Someone").trim();
  const what = WHAT[type] || type.replace(/_/g, " ");
  const when = new Date(at || Date.now()).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" });
  const where = [city, state].filter(Boolean).join(", ");
  const subject = `HOT: ${name} — ${what}`;
  const tel = phone ? String(phone).replace(/[^\d+]/g, "") : null;
  const mailto = email ? `mailto:${email}?subject=${encodeURIComponent(`Re: your page for ${name}`)}` : null;
  const lines = [
    `${name}${where || trade ? ` (${[trade, where].filter(Boolean).join(", ")})` : ""} ${what}, ${when} ET.`,
    detail ? String(detail) : null,
    `Page: ${previewUrl || "none"}`,
    `Email: ${email || "unknown"}`,
    `Phone: ${phone || "not on file"}`,
    replyText ? `\nWhat they wrote:\n${String(replyText).slice(0, 1500)}` : null
  ].filter(v => v !== null);
  const text = lines.join("\n");
  const html = `<p><strong>${escapeHtml(name)}</strong>${where || trade ? ` (${escapeHtml([trade, where].filter(Boolean).join(", "))})` : ""} ${escapeHtml(what)}, ${escapeHtml(when)} ET.</p>
${detail ? `<p>${escapeHtml(detail)}</p>` : ""}
<p>Page: ${previewUrl ? `<a href="${escapeHtml(previewUrl)}">${escapeHtml(previewUrl)}</a>` : "none"}<br>
Email: ${email ? escapeHtml(email) : "unknown"}<br>
Phone: ${phone ? escapeHtml(phone) : "not on file"}</p>
${replyText ? `<blockquote style="margin:0 0 12px;padding:8px 12px;border-left:3px solid #ccc;color:#333;white-space:pre-wrap;">${escapeHtml(String(replyText).slice(0, 1500))}</blockquote>` : ""}
<p>${mailto ? `<a href="${escapeHtml(mailto)}" style="display:inline-block;background:#1a73e8;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:bold;">Reply by email</a>` : ""}
${tel ? ` &nbsp; <a href="tel:${escapeHtml(tel)}" style="display:inline-block;background:#188038;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:bold;">Call ${escapeHtml(phone)}</a>` : ""}</p>`;
  return { subject, text, html, oneLiner: `${subject}${phone ? ` · ${phone}` : ""}` };
}

// ── Closing the loop ────────────────────────────────────────────────────────
// What the daily sweep does with an open signal (pure).
//   { close: "no_response" } after 14 days with no response since the last
//   automated touch (or since the signal, if it never sent anything and has
//   nothing scheduled). Queued-for-Jack signals are left for Jack.
export function sweepDecision({ state, createdAt, lastTouchAt, hasScheduled, now = Date.now() }, g = GUARDRAILS) {
  if (["handled", "closed", "queued_for_jack"].includes(state)) return null;
  if (hasScheduled) return null;
  const since = new Date(lastTouchAt || createdAt).getTime();
  if (now - since >= g.noResponseCloseMs) return { close: "no_response" };
  return null;
}
