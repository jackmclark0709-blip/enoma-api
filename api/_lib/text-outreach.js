// api/_lib/text-outreach.js
// Hand-sent text outreach: every morning Jack gets an email with a short batch
// of ready-to-send texts, one per prospect, each with a tap-to-text link that
// opens his phone's Messages app with the text already filled in. Nothing is
// ever sent automatically — Jack sends each one himself, from his own phone.
//
// The rule that matters most: a prospect only makes the batch if their page is
// one we'd be proud to send. assessPageQuality() is that gate, and it is
// deliberately strict — a thin page burns the prospect for good.
//
// Pure functions here; network/DB lives in ga-metrics.js (text_* actions).
import crypto from "node:crypto";

export const TEXT_DAILY_CAP = 10;
// Unmarked texts come back in the batch after this long, once.
export const TEXT_REMIND_AFTER_DAYS = 2;

// Prospect statuses that must never be texted.
export const NEVER_TEXT_STATUSES = new Set([
  "excluded_existing_customer", "excluded_wrong_category", "excluded_no_contact",
  "dedup_match", "skipped", "opted_out", "claimed", "customer",
]);

const GENERIC_SERVICE = /^(general|various|all|full[- ]service)\b.*\bservices?\b/i;
const TEST_NAME = /\b(test|qc|demo|sample)\b/i;

/** "+1 508-761-7399" / "(508) 761-7399" -> "+15087617399"; null if not a US 10-digit number. */
export function normalizeUsPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length !== 10 || /^[01]/.test(ten) || /^\d{3}555/.test(ten)) return null;
  return `+1${ten}`;
}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

/**
 * Is this page good enough to text? Checks only what's in the stored profile;
 * the live render check (page actually loads) is done by the caller.
 * Returns { ok, reasons[] } — reasons name every failed check, so a rejected
 * page says exactly what to fix.
 */
export function assessPageQuality(profile) {
  const reasons = [];
  if (!profile) return { ok: false, reasons: ["no_page"] };
  const p = profile;

  if (!p.is_public) reasons.push("page_not_public");
  if (p.is_claimed) reasons.push("already_claimed");
  if (TEST_NAME.test(p.business_name || "")) reasons.push("test_page");

  const rating = Number(p.average_rating), reviews = Number(p.review_count);
  if (!(rating >= 4.5 && reviews >= 10)) reasons.push("rating_below_4.5_or_under_10_reviews");

  const services = asArray(p.services).filter(s => s && String(s.service_name || "").trim());
  const solid = services.filter(s => {
    const d = String(s.service_description || "").trim();
    return d.length >= 30 && !GENERIC_SERVICE.test(d);
  });
  if (services.length < 3) reasons.push("fewer_than_3_services");
  else if (solid.length < services.length) reasons.push("service_missing_or_generic_description");

  if (String(p.about || "").trim().length < 200) reasons.push("about_too_short");
  if (String(p.hero_tagline || "").trim().length < 25) reasons.push("tagline_too_short");
  if (asArray(p.faqs).length < 2) reasons.push("fewer_than_2_faqs");
  if (!normalizeUsPhone(p.phone)) reasons.push("no_valid_phone_on_page");

  return { ok: reasons.length === 0, reasons };
}

/** Does the live page look right? (status 200, shows the business name, not an inactive/404 page.) */
export function assessRenderedPage({ status, html, businessName }) {
  const reasons = [];
  const body = String(html || "");
  if (status !== 200) reasons.push(`page_status_${status}`);
  if (/currently inactive|free trial has ended/i.test(body)) reasons.push("page_shows_inactive");
  const raw = shortName(businessName).slice(0, 20);
  const escaped = raw.replace(/&/g, "&amp;").replace(/'/g, "&#39;");
  if (raw && !body.includes(raw) && !body.includes(escaped)) reasons.push("page_missing_business_name");
  return { ok: reasons.length === 0, reasons };
}

// Strips ", Inc." / " LLC" so the text reads like a person wrote it.
export function shortName(name) {
  return String(name || "").replace(/[,.]?\s+(inc|llc|l\.l\.c|co|corp|ltd)\.?$/i, "").trim();
}

function variantFor(id, n) {
  const h = crypto.createHash("sha256").update(String(id || "")).digest();
  return h[0] % n;
}

/**
 * The text itself. Short, first person, names Jack and Enoma, carries the page
 * link, and gives a plain way to opt out. Deliberately says nothing about
 * price, so it stays true whatever the pricing page says.
 */
export function buildTextMessage({ id, businessName, previewUrl, rating, reviewCount }) {
  const name = shortName(businessName);
  const reviews = Number(reviewCount) >= 10 ? " and reviews" : "";
  const variants = [
    `Hi, this is Jack Clark with Enoma in Attleboro, MA. I built a website for ${name} from your Google listing${reviews}: ${previewUrl}\n\nIf you want it, just reply and I'll set it up for you. Not interested? Reply STOP and I won't text again.`,
    `Hi, Jack Clark here from Enoma (Attleboro, MA). I put together a page for ${name} using your Google listing${reviews}. Take a look: ${previewUrl}\n\nWant to keep it? Reply and I'll get it set up. If not, reply STOP and I won't reach out again.`,
    `Hi, it's Jack Clark with Enoma, a small web company in Attleboro, MA. I made ${name} a website from your Google listing${reviews}: ${previewUrl}\n\nHappy to set it up for you if you like it. Reply STOP if you'd rather I didn't text.`,
  ];
  return variants[variantFor(id, variants.length)];
}

/** Tap-to-text link that opens Messages with the number and body filled in (iPhone and Android). */
export function smsLink(phoneE164, body) {
  return `sms:${phoneE164}?&body=${encodeURIComponent(body)}`;
}

// ── Signed links for Jack's "Sent / Skip / Opted out" buttons ──
function secret() {
  const s = process.env.UNSUBSCRIBE_SECRET;
  if (!s) throw new Error("UNSUBSCRIBE_SECRET is not set");
  return s;
}

export const TEXT_MARKS = ["sent", "skip", "opted_out"];

export function buildTextMarkToken(prospectId, mark) {
  return crypto.createHmac("sha256", secret()).update(`text:${prospectId}:${mark}`).digest("hex");
}

export function verifyTextMarkToken(prospectId, mark, token) {
  if (!prospectId || !TEXT_MARKS.includes(mark) || !token) return false;
  const a = Buffer.from(buildTextMarkToken(prospectId, mark));
  const b = Buffer.from(String(token));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function textMarkUrl(prospectId, mark) {
  return `https://enoma.io/api/ga-metrics?action=text_mark&id=${encodeURIComponent(prospectId)}&mark=${mark}&token=${buildTextMarkToken(prospectId, mark)}`;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/**
 * The morning email to Jack. items: [{ id, businessName, trade, city, phone, previewUrl, rating, reviewCount, body, reminder }]
 */
export function buildTextBatchEmail(items, { dateLabel } = {}) {
  const count = items.length;
  const subject = count
    ? `${count} text${count === 1 ? "" : "s"} ready to send${dateLabel ? ` · ${dateLabel}` : ""}`
    : `No texts today${dateLabel ? ` · ${dateLabel}` : ""}`;

  const cards = items.map((it, i) => {
    const btn = (href, label, bg, fg) =>
      `<a href="${esc(href)}" style="display:inline-block;padding:10px 16px;margin:0 6px 6px 0;border-radius:999px;background:${bg};color:${fg};font-weight:700;font-size:14px;text-decoration:none;">${label}</a>`;
    return `
<div style="border:1px solid #d4e2f4;border-radius:12px;padding:16px;margin:0 0 16px;background:#ffffff;">
  <div style="font-size:12px;color:#5a7a9a;margin:0 0 4px;">${i + 1} of ${count}${it.reminder ? " · <strong>not marked yet</strong>" : ""}</div>
  <div style="font-size:17px;font-weight:700;color:#0a1628;">${esc(it.businessName)}</div>
  <div style="font-size:13px;color:#2a4060;margin:2px 0 10px;">${esc([it.trade, it.city].filter(Boolean).join(" · "))} · ${esc(it.phone)}${it.rating ? ` · ${esc(it.rating)}★ (${esc(it.reviewCount)})` : ""}</div>
  <div style="font-size:14px;color:#0a1628;background:#f0f6ff;border-radius:8px;padding:12px;white-space:pre-line;margin:0 0 12px;">${esc(it.body)}</div>
  ${btn(it.previewUrl, "Check the page", "#e6f1fb", "#0c447c")}
  ${btn(smsLink(it.phoneE164, it.body), "Tap to text", "#3882dc", "#ffffff")}
  <div style="margin-top:6px;">
    ${btn(textMarkUrl(it.id, "sent"), "I sent it", "#d1f0e4", "#065f46")}
    ${btn(textMarkUrl(it.id, "skip"), "Skip", "#f7faff", "#5a7a9a")}
    ${btn(textMarkUrl(it.id, "opted_out"), "They said stop", "#fde8e8", "#a33030")}
  </div>
</div>`;
  }).join("");

  const intro = count
    ? `Every page below passed the quality check. Open each page before you send it. Tap "Tap to text" on your phone to open Messages with the text filled in, then tap "I sent it" so it doesn't come back.`
    : `No pages passed the quality check today, so there's nothing to send. That's on purpose: only pages we're confident in go out.`;

  const html = `<div style="font-family:Inter,Arial,sans-serif;background:#f0f6ff;padding:20px;">
<div style="max-width:560px;margin:0 auto;">
  <div style="font-size:20px;font-weight:800;color:#0a1628;margin:0 0 6px;">Today's texts</div>
  <p style="font-size:14px;color:#2a4060;line-height:1.5;margin:0 0 16px;">${intro}</p>
  ${cards}
  <p style="font-size:12px;color:#5a7a9a;line-height:1.5;">Send these by hand, one at a time, from your own phone. If anyone replies STOP, tap "They said stop" and they won't be texted again.</p>
</div></div>`;

  const text = [subject, "", ...items.map((it, i) =>
    `${i + 1}. ${it.businessName} (${it.phone})\n${it.body}\nSent: ${textMarkUrl(it.id, "sent")}\nSkip: ${textMarkUrl(it.id, "skip")}\n`)].join("\n");

  return { subject, html, text };
}
