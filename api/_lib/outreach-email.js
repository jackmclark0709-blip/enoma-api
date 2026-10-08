// Builds the automated cold-outreach email around a prospect's preview page.
//
// The model only writes the short personal intro (see generateDraftCopy's
// preview brief). Everything that has to be exact — the page card, the
// "Claim my free page" button, the reply line, the sign-off and the CAN-SPAM
// footer — is assembled here, deterministically, so every send carries the
// same tracked links and a model can never drop or mangle them.
//
// Links point at our own redirect endpoint (action=go) carrying the
// outreach_messages id, so a click is recorded against that exact email even
// if Resend's own click tracking is off, then lands on the real page.
import { escapeHtml, plainTextToHtml } from "./email-html.js";

const BASE = "https://enoma.io";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value) {
  return UUID_RE.test(String(value || ""));
}

// "https://enoma.io/arno-plumbing" -> "arno-plumbing". Only accepts our own
// host, so a stray preview_url can never turn into an off-site redirect.
export function slugFromPreviewUrl(previewUrl) {
  const m = String(previewUrl || "").match(/^https:\/\/(?:www\.)?enoma\.io\/([a-z0-9][a-z0-9-]*)\/?(?:[?#].*)?$/i);
  return m ? m[1].toLowerCase() : null;
}

export function trackedLinks(messageId, slug) {
  const go = (to) => `${BASE}/api/ga-metrics?action=go&m=${encodeURIComponent(messageId)}&to=${to}`;
  return {
    page: go("page"),
    claim: go("claim"),
    image: `${BASE}/api/p?og=1&slug=${encodeURIComponent(slug)}`,
    // Where action=go finally sends people (kept here so the redirect
    // handler and the email agree on the destinations).
    pageDest: `${BASE}/${slug}?m=${encodeURIComponent(messageId)}`,
    claimDest: `${BASE}/claim?business=${encodeURIComponent(slug)}&m=${encodeURIComponent(messageId)}`
  };
}

// Reply-To for a given message. With inbound capture on, replies route
// through reply+<id>@mail.enoma.io so they're logged and matched to the
// email, then forwarded on. Off by default: until the MX record for inbound
// is live, that address would bounce a real reply.
export function replyToFor(messageId, { captureReplies } = {}) {
  return captureReplies && isUuid(messageId) ? `reply+${messageId}@mail.enoma.io` : "jack@enoma.io";
}

export function messageIdFromReplyAddress(addresses) {
  for (const a of [].concat(addresses || [])) {
    const m = String(a).match(/reply\+([0-9a-f-]{36})@mail\.enoma\.io/i);
    if (m && isUuid(m[1])) return m[1].toLowerCase();
  }
  return null;
}

export function buildOutreachEmail({ intro, businessName, messageId, slug, unsubscribeUrl, mailingAddress }) {
  const links = trackedLinks(messageId, slug);
  const name = businessName || "your business";
  const signoff = "Jack Clark\nEnoma · jack@enoma.io";

  const text = [
    String(intro || "").trim(),
    `See the page: ${links.page}`,
    `It's free to keep — claim it and make it yours: ${links.claim}`,
    `Or just reply "yes" and I'll set it up for you. If it's not for you, reply "no" and I'll take it down.`,
    signoff,
    `---\n${mailingAddress}\nDon't want these emails? ${unsubscribeUrl}`
  ].join("\n\n");

  const html = `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#ffffff;">
<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#222222;max-width:560px;margin:0 auto;padding:24px 16px;">
${plainTextToHtml(String(intro || "").trim())}
<a href="${links.page}" style="display:block;text-decoration:none;color:#222222;border:1px solid #e3e6ea;border-radius:10px;overflow:hidden;margin:4px 0 20px;">
  <img src="${links.image}" alt="Preview of the new page for ${escapeHtml(name)}" width="528" style="display:block;width:100%;max-width:528px;height:auto;border:0;">
  <span style="display:block;padding:12px 14px;font-size:14px;color:#1a73e8;">View the page built for ${escapeHtml(name)} &rarr;</span>
</a>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;">
  <tr><td style="border-radius:8px;background:#1a5c3a;">
    <a href="${links.claim}" style="display:inline-block;padding:13px 22px;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:8px;">Claim my free page</a>
  </td></tr>
</table>
<p style="margin:0 0 16px;">Or just reply <strong>yes</strong> and I'll set it up for you. If it's not for you, reply <strong>no</strong> and I'll take it down.</p>
<p style="margin:0 0 24px;">Jack Clark<br>Enoma &middot; jack@enoma.io</p>
<p style="margin:0;font-size:12px;color:#888888;border-top:1px solid #eeeeee;padding-top:12px;">${escapeHtml(mailingAddress)}<br><a href="${unsubscribeUrl}" style="color:#888888;">Unsubscribe</a></p>
</div>
</body>
</html>`;

  return { text, html, links };
}

// Rough intent of an inbound reply, for sorting only — Jack still sees every
// reply in full. Order matters: an opt-out wins over a stray "yes".
export function classifyReplyIntent({ subject, text, headers } = {}) {
  const h = headers || {};
  const autoHeader = String(h["auto-submitted"] || h["Auto-Submitted"] || "").toLowerCase();
  const body = String(text || "").split(/\n\s*(?:On .+wrote:|-----Original Message-----|From: )/)[0].toLowerCase();
  const subj = String(subject || "").toLowerCase();
  if ((autoHeader && autoHeader !== "no") || /out of (the )?office|auto(matic)?[- ]?reply|away from (my|the) (desk|office)/.test(subj + " " + body)) return "auto_reply";
  if (/\b(unsubscribe|remove me|take (me|it|us) off|stop (emailing|contacting)|not interested|no thanks|no thank you|don't contact|do not contact|take it down)\b/.test(body) || /^\s*no\b/.test(body)) return "opt_out";
  if (/^\s*(yes|yeah|yep|sure|ok|okay|interested|sounds good|let'?s do it)\b/.test(body) || /\b(i'?m interested|keep it|i want it|set it up|how do i)\b/.test(body)) return "positive";
  return "other";
}
