// The personal note from Jack after a prospect really opens their preview.
//
// Flow (api/ga-metrics.js): the first real (non-scanner) visit from a cold
// email creates one visit_followups row per prospect, ever. Jack's instant
// alert carries a signed "Approve and send" link. Approving schedules the
// email with Resend for 10-20 minutes after the visit (or a minute from now
// if that has passed), so it never lands while they're still on the page.
// Nothing goes out without Jack's tap.

import crypto from "node:crypto";
import { cleanBusinessName } from "./outreach-email.js";

export const FOLLOWUP_MIN_DELAY_MS = 10 * 60 * 1000;
export const FOLLOWUP_MAX_DELAY_MS = 20 * 60 * 1000;
// "Saw you had a look" only reads right for a few days.
export const FOLLOWUP_EXPIRES_MS = 3 * 864e5;
// Resend rejects a schedule time that is already past or a few seconds out.
const MIN_SCHEDULE_LEAD_MS = 60 * 1000;

export const FOLLOWUP_MARKS = ["approve", "skip"];

function secret() {
  const s = process.env.UNSUBSCRIBE_SECRET;
  if (!s) throw new Error("UNSUBSCRIBE_SECRET is not set");
  return s;
}

export function buildFollowupToken(followupId, mark) {
  return crypto.createHmac("sha256", secret()).update(`visit_followup:${followupId}:${mark}`).digest("hex");
}

export function verifyFollowupToken(followupId, mark, token) {
  if (!followupId || !FOLLOWUP_MARKS.includes(mark) || !token || !process.env.UNSUBSCRIBE_SECRET) return false;
  const a = Buffer.from(buildFollowupToken(followupId, mark));
  const b = Buffer.from(String(token));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function followupActionUrl(followupId, mark) {
  return `https://enoma.io/api/ga-metrics?action=visit_followup&id=${followupId}&mark=${mark}&token=${buildFollowupToken(followupId, mark)}`;
}

// Why no note should go to this prospect, or null if one may. Checked when the
// visit is logged and again when Jack approves, since things change between.
export function followupBlockReason({ prospect, isInternal, suppressed, pageClaimed, responseStatus } = {}) {
  if (!prospect?.id) return "no_prospect";
  if (isInternal) return "internal_business";
  if (!prospect.email) return "no_email";
  if (suppressed) return "suppressed";
  if (["opted_out", "invalid_email", "skipped", "claimed"].includes(prospect.status)) return `prospect_${prospect.status}`;
  if (pageClaimed) return "page_claimed";
  if (responseStatus) return `already_${responseStatus}`;
  return null;
}

// A stable 10-20 minute delay per follow-up (from its id), so a retried
// approval lands on the same time instead of re-rolling.
export function followupSendAt({ visitedAt, followupId, now = Date.now() }) {
  const visit = new Date(visitedAt).getTime();
  const span = FOLLOWUP_MAX_DELAY_MS - FOLLOWUP_MIN_DELAY_MS;
  const seed = parseInt(crypto.createHash("sha256").update(String(followupId)).digest("hex").slice(0, 8), 16);
  const target = visit + FOLLOWUP_MIN_DELAY_MS + (seed % (span + 1));
  const earliest = now + MIN_SCHEDULE_LEAD_MS;
  return new Date(Math.max(target, earliest));
}

export function followupExpired({ visitedAt, now = Date.now() }) {
  return now - new Date(visitedAt).getTime() > FOLLOWUP_EXPIRES_MS;
}

// Short, from Jack, no pitch and no links: they just saw the page, and a
// link here would only invite mail scanners to click it.
export function buildVisitFollowupEmail({ businessName, originalSubject, unsubscribeUrl, mailingAddress }) {
  const name = cleanBusinessName(businessName) || "your business";
  const base = String(originalSubject || `I built ${name} a new page`).replace(/^\s*re:\s*/i, "");
  const subject = `Re: ${base}`;
  const p1 = `Saw you had a look at the page I made for ${name}.`;
  const p2 = "Want me to change anything on it, or set it up with you? It takes about ten minutes, and I'm happy to do it over the phone.";
  const p3 = "Just reply here.";
  const text = ["Hi there,", p1, p2, p3, "Jack", `---\n${mailingAddress}\nDon't want these emails? ${unsubscribeUrl}`].join("\n\n");
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const html = `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#ffffff;">
<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#222222;max-width:560px;margin:0 auto;padding:24px 16px;">
<p style="margin:0 0 16px;">Hi there,</p>
<p style="margin:0 0 16px;">${esc(p1)}</p>
<p style="margin:0 0 16px;">${esc(p2)}</p>
<p style="margin:0 0 16px;">${esc(p3)}</p>
<p style="margin:0 0 24px;">Jack</p>
<p style="margin:0;font-size:12px;color:#888888;border-top:1px solid #eeeeee;padding-top:12px;">${esc(mailingAddress)}<br><a href="${esc(unsubscribeUrl)}" style="color:#888888;">Unsubscribe</a></p>
</div>
</body>
</html>`;
  return { subject, text, html };
}

// The block appended to Jack's instant visit alert: what would be sent and
// the two signed buttons, or why nothing will be.
export function buildAlertFollowupSection({ followupId, blockReason, email }) {
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  if (blockReason || !followupId || !email) {
    const why = blockReason || "not_created";
    return {
      text: `\nNo follow-up email will go out (${why}).`,
      html: `<p style="color:#666;">No follow-up email will go out (${esc(why)}).</p>`
    };
  }
  const approve = followupActionUrl(followupId, "approve");
  const skip = followupActionUrl(followupId, "skip");
  const text = [
    "",
    "Follow-up email, ready to send 10-20 min after their visit:",
    `Subject: ${email.subject}`,
    email.text.split("\n---")[0],
    "",
    `Approve and send: ${approve}`,
    `Skip it: ${skip}`
  ].join("\n");
  const html = `<hr style="border:none;border-top:1px solid #ddd;margin:16px 0;">
<p><strong>Follow-up email</strong>, ready to send 10-20 min after their visit:</p>
<blockquote style="margin:0 0 12px;padding:8px 12px;border-left:3px solid #ccc;color:#333;">
<p style="margin:0 0 8px;"><em>Subject: ${esc(email.subject)}</em></p>
${email.text.split("\n---")[0].split("\n\n").map(p => `<p style="margin:0 0 8px;">${esc(p)}</p>`).join("\n")}
</blockquote>
<p><a href="${approve}" style="display:inline-block;background:#1a73e8;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:bold;">Approve and send</a>
&nbsp; <a href="${skip}" style="color:#666;">Skip</a></p>`;
  return { text, html };
}
