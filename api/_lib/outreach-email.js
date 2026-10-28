// Builds the automated cold-outreach email around a prospect's preview page.
//
// The model only writes the short personal intro (see generateDraftCopy's
// preview brief). Everything that has to be exact — the page card, the
// "Keep my page live" button, the reply line, the sign-off and the CAN-SPAM
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
    // The page itself, with its claim box open: the owner enters an email and
    // claims by sign-in link (no password), and m= carries through to /claim.
    claimDest: `${BASE}/${slug}?claim=1&m=${encodeURIComponent(messageId)}`
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

// "Maynard Roofing /40 yrs Family Business" -> "Maynard Roofing";
// "Comfort Aire Heating & Cooling Inc." -> "Comfort Aire Heating & Cooling".
// Listing names often carry taglines and legal suffixes nobody says out loud.
export function cleanBusinessName(name) {
  let n = String(name || "").trim();
  n = n.split(/\s+[\/|]\s*/)[0];
  // A dash only starts a tagline when what follows reads like one
  // ("Ace Plumbing - Serving Taunton Since 1990"), not a name ("Smith - Jones").
  const dash = n.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (dash && /\b(serving|since|family|owned|licensed|insured|best|yrs|years|24\/7|#1|llc|inc|services in|repair in)\b/i.test(dash[2])) n = dash[1];
  n = n.replace(/[,\s]+(llc|l\.l\.c\.|inc\.?|incorporated|co\.|corp\.?|corporation|ltd\.?)\s*$/i, "");
  n = n.replace(/[,\s]+(llc|inc\.?)\s*$/i, "").trim();
  return n || String(name || "").trim();
}

// The single reason to look, one per verified site problem (site-checks.js
// pitch text), most persuasive first. Each is something the owner can check
// on their own phone in ten seconds; none claims anything we can't see.
const REASONS = [
  { match: /tap-to-call/i, line: (site) => `When someone finds ${site} on their phone, there's no button to tap and call you.` },
  { match: /resize for phones/i, line: (site) => `${site} doesn't fit a phone screen, and that's where most people look up a local contractor.` },
  { match: /quote or contact form/i, line: (site) => `There's no way to ask for a quote on ${site}'s homepage, so anyone who finds you after hours has to remember to call back.` },
  { match: /not secure/i, line: (site) => `Most browsers show a "Not secure" warning on ${site}, which is often enough to make someone hit back.` },
  { match: /copyright year/i, line: (site) => `The footer on ${site} shows a copyright year from a few years back, which can make it look like you're not in business anymore.` },
  { match: /very little text/i, line: (site) => `${site} has very little text on it, so Google has almost nothing to show when someone searches for what you do.` },
];

/**
 * The cold email body, built around one reason and one link (the link and
 * the reply line are added by buildOutreachEmail). Deterministic: no model,
 * so every claim traces to a verified site check or the Google listing.
 * @returns {{ subject: string, body: string, reason: string }}
 */
export function buildOutreachIntro({ business_name, website, site_gaps, raw }) {
  const name = cleanBusinessName(business_name);
  const site = website ? String(website).replace(/%3F.*$/i, "").replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/.*$/, "") : "";
  const gaps = Array.isArray(site_gaps) ? site_gaps : [];
  let reason = null, line = null;
  if (site) {
    for (const r of REASONS) {
      if (gaps.some(g => r.match.test(String(g)))) { reason = String(r.match); line = r.line(site); break; }
    }
  } else {
    reason = "no_website";
    line = `Your Google listing doesn't link to a website, so people who find you there have nowhere to check you out before they call.`;
  }
  const rating = Number(raw?.rating), reviews = Number(raw?.reviews);
  if (!line && rating >= 4.5 && reviews >= 10) {
    reason = "rating";
    line = `You have a ${rating % 1 ? rating.toFixed(1) : rating}-star rating from ${reviews} Google reviews.`;
    return { subject: `I built ${name} a new page`, body: `Hi there,\n\n${line}\n\nI used your Google listing to build ${name} a page that puts that rating front and center, right next to a button that calls you.`, reason };
  }
  if (!line) {
    reason = "generic";
    line = `I put together a simple page for ${name} built to turn a Google search into a phone call.`;
    return { subject: `I built ${name} a new page`, body: `Hi there,\n\n${line}`, reason };
  }
  return { subject: `I built ${name} a new page`, body: `Hi there,\n\n${line}\n\nSo I used your Google listing to build ${name} a page that fixes it.`, reason };
}

// One link (the page), one ask (reply). Fewer links and no images also read
// less like a marketing blast to spam filters and link scanners.
export function buildOutreachEmail({ intro, businessName, messageId, slug, unsubscribeUrl, mailingAddress }) {
  const links = trackedLinks(messageId, slug);
  const ask = `If you want to keep it, just reply "yes". The first month is free, then it's $19.99/month, no contract. If it's not for you, reply "no" and I'll take it down.`;
  const signoff = "Jack Clark\nEnoma · jack@enoma.io";

  const text = [
    String(intro || "").trim(),
    `Here it is: ${links.page}`,
    ask,
    signoff,
    `---\n${mailingAddress}\nDon't want these emails? ${unsubscribeUrl}`
  ].join("\n\n");

  const html = `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#ffffff;">
<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#222222;max-width:560px;margin:0 auto;padding:24px 16px;">
${plainTextToHtml(String(intro || "").trim())}
<p style="margin:0 0 16px;">Here it is: <a href="${links.page}" style="color:#1a73e8;">${escapeHtml(cleanBusinessName(businessName) || "your page")} on Enoma</a></p>
<p style="margin:0 0 16px;">${escapeHtml(ask).replace(/&quot;yes&quot;/, "<strong>yes</strong>").replace(/&quot;no&quot;/, "<strong>no</strong>")}</p>
<p style="margin:0 0 24px;">Jack Clark<br>Enoma &middot; jack@enoma.io</p>
<p style="margin:0;font-size:12px;color:#888888;border-top:1px solid #eeeeee;padding-top:12px;">${escapeHtml(mailingAddress)}<br><a href="${unsubscribeUrl}" style="color:#888888;">Unsubscribe</a></p>
</div>
</body>
</html>`;

  return { text, html, links };
}

// Follow-up window: one follow-up, 3 days after the first email (the daily
// send runs at 7am ET, so it lands on day 3 or 4), and never for emails
// older than 10 days, where a "following up" would read as random.
export const FOLLOW_UP_AFTER_DAYS = 3;
export const FOLLOW_UP_MAX_AGE_DAYS = 10;

export function isFollowUpDue({ sentAt, followupSentAt, responseStatus, now = Date.now() }) {
  if (!sentAt || followupSentAt || responseStatus) return false;
  const age = now - new Date(sentAt).getTime();
  return age >= FOLLOW_UP_AFTER_DAYS * 864e5 && age <= FOLLOW_UP_MAX_AGE_DAYS * 864e5;
}

// The second (and last) email: a short reply in the same thread, the same
// tracked page link, and one new reason to say yes (help getting the page onto
// their Google listing).
export function buildFollowUpEmail({ businessName, originalSubject, messageId, slug, unsubscribeUrl, mailingAddress }) {
  const links = trackedLinks(messageId, slug);
  const name = cleanBusinessName(businessName) || "your business";
  const base = String(originalSubject || `I built ${name} a new page`).replace(/^\s*re:\s*/i, "");
  const subject = `Re: ${base}`;
  const p1 = `Following up on the page I built for ${name}. It's still up:`;
  const p2 = `If you keep it, I'll help you add it to your Google listing, so people who find you there can see what you do and call you in one tap. Reply "yes" and I'll set it up, or "no" and I'll take it down.`;
  const text = [
    "Hi there,", `${p1} ${links.page}`, p2, "Jack",
    `---\n${mailingAddress}\nDon't want these emails? ${unsubscribeUrl}`
  ].join("\n\n");
  const html = `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#ffffff;">
<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#222222;max-width:560px;margin:0 auto;padding:24px 16px;">
<p style="margin:0 0 16px;">Hi there,</p>
<p style="margin:0 0 16px;">${escapeHtml(p1)} <a href="${links.page}" style="color:#1a73e8;">${escapeHtml(name)} on Enoma</a></p>
<p style="margin:0 0 16px;">${escapeHtml(p2).replace(/&quot;yes&quot;/, "<strong>yes</strong>").replace(/&quot;no&quot;/, "<strong>no</strong>")}</p>
<p style="margin:0 0 24px;">Jack</p>
<p style="margin:0;font-size:12px;color:#888888;border-top:1px solid #eeeeee;padding-top:12px;">${escapeHtml(mailingAddress)}<br><a href="${unsubscribeUrl}" style="color:#888888;">Unsubscribe</a></p>
</div>
</body>
</html>`;
  return { subject, text, html, links };
}

// A click within two minutes of sending is a mail filter checking the link,
// not a person (people open the email later; scanners hit it on arrival).
export const SCANNER_WINDOW_MS = 2 * 60 * 1000;
export function isLikelyLinkScanner({ sentAt, now = Date.now(), userAgent } = {}) {
  if (/bot|crawler|spider|preview|scanner|python|curl|wget|headless/i.test(String(userAgent || ""))) return true;
  const sent = sentAt ? new Date(sentAt).getTime() : NaN;
  return Number.isFinite(sent) && now - sent >= 0 && now - sent < SCANNER_WINDOW_MS;
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
