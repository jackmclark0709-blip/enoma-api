// Helpers for tracking what happens after an outreach email is sent:
// per-message reply addresses (so an inbound reply maps back to the exact
// outreach_messages row), reply classification (opt-out vs. real reply),
// Resend webhook event mapping, and per-message tagging of preview-page
// links (so a preview visit can be tied to the email that drove it).
// Pure functions only — no Supabase/Resend calls — so they're unit-testable.

export const REPLY_DOMAIN = "mail.enoma.io";

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// reply+<outreach_message_id>@mail.enoma.io — Resend Inbound accepts mail
// for any address at a receiving-enabled domain, so every sent message gets
// its own reply address and no header parsing/guessing is needed to match.
export function buildReplyAddress(messageId, domain = REPLY_DOMAIN) {
  return `reply+${messageId}@${domain}`;
}

// Accepts the `to`/`received_for` arrays from an email.received webhook and
// returns the outreach message id encoded in the first reply+ address found.
export function parseReplyAddress(addresses, domain = REPLY_DOMAIN) {
  for (const raw of [].concat(addresses || [])) {
    const addr = extractAddress(raw);
    if (!addr) continue;
    const [local, host] = addr.split("@");
    if (host !== domain.toLowerCase()) continue;
    const m = local.match(/^reply\+(.+)$/);
    if (m && UUID_RE.test(m[1])) return m[1].match(UUID_RE)[0].toLowerCase();
  }
  return null;
}

// "Jane Doe <jane@x.com>" -> "jane@x.com"; bare addresses pass through.
export function extractAddress(raw) {
  if (!raw || typeof raw !== "string") return null;
  const angle = raw.match(/<([^>]+)>/);
  const addr = (angle ? angle[1] : raw).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr) ? addr : null;
}

// Drops the quoted original ("On Tue, ... wrote:", "> ..." lines, Outlook's
// "From: ... Sent: ..." block) so classification only reads what the
// prospect actually typed — the original email contains the word
// "emails"/"unsubscribe" in its footer and would otherwise false-positive.
export function stripQuoted(text) {
  if (!text) return "";
  const lines = String(text).replace(/\r\n/g, "\n").split("\n");
  const out = [];
  for (const line of lines) {
    const t = line.trim();
    if (/^On .+wrote:?$/i.test(t)) break;
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(t)) break;
    if (/^From:\s.+/i.test(t) && out.length) break;
    if (/^_{5,}$/.test(t)) break;
    if (t.startsWith(">")) continue;
    out.push(line);
  }
  return out.join("\n").trim();
}

const OPT_OUT_RE = /\b(unsubscribe|remove me|take me off|stop emailing|stop sending|do not (contact|email)|don'?t (contact|email) me|not interested|no thanks|no thank you|opt[\s-]?out)\b|^\s*(stop|remove|no)\s*[.!]?\s*$/i;
const POSITIVE_RE = /^\s*(yes|yeah|yep|sure|ok(ay)?|interested|sounds good|let'?s do it|i'?m in)\b/i;
const AUTO_REPLY_RE = /\b(out of (the )?office|auto(matic)?[- ]?reply|away from (the )?office|on vacation|currently unavailable|will respond .* return)\b/i;

// Returns { status, intent }:
//   status  -> outreach_messages.response_status value ('replied' | 'opted_out')
//   intent  -> 'positive' | 'opt_out' | 'auto_reply' | 'other' (for the alert)
// An auto-reply is recorded as a reply only in outreach_replies, not as the
// message's response_status, so it doesn't inflate the reply rate.
export function classifyReply(text, subject = "") {
  const body = stripQuoted(text);
  if (AUTO_REPLY_RE.test(subject) || AUTO_REPLY_RE.test(body.slice(0, 400))) {
    return { status: null, intent: "auto_reply" };
  }
  if (OPT_OUT_RE.test(body)) return { status: "opted_out", intent: "opt_out" };
  if (POSITIVE_RE.test(body)) return { status: "replied", intent: "positive" };
  return { status: "replied", intent: "other" };
}

// Resend event type -> which engagement fields to bump on outreach_messages.
// Consumed by the record_outreach_event() SQL function.
export function engagementKind(type) {
  switch (type) {
    case "email.delivered": return "delivered";
    case "email.opened": return "opened";
    case "email.clicked": return "clicked";
    default: return null;
  }
}

// Appends ?m=<messageId> to every occurrence of the prospect's preview URL
// in the body, so the preview page's own page_view event records which
// email drove the visit. Leaves other links (signup, case study) alone.
export function tagPreviewLinks(body, previewUrl, messageId) {
  if (!body || !previewUrl || !messageId) return body;
  const base = previewUrl.replace(/\/+$/, "");
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escaped}(?![\\w/-])(\\?[^\\s)]*[^\\s).,!?;:'"])?`, "g");
  return body.replace(re, (_m, query) => {
    const q = query ? `${query}&m=${messageId}` : `?m=${messageId}`;
    return `${base}${q}`;
  });
}

// Link scanners/prefetchers (corporate mail security, Gmail image proxy)
// hit links without a human. page_view is fired from client-side JS so most
// never register, but filter the obvious ones before alerting anyway.
export function looksLikeBot(userAgent) {
  if (!userAgent) return true;
  return /bot|crawl|spider|preview|scan|headless|slurp|fetch|python|curl|wget|facebookexternalhit|google-?inspectiontool/i.test(userAgent);
}
