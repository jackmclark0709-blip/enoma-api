// CAN-SPAM compliance footer for automated cold outreach. Manual, one-off
// sends (a human hitting send in an email client) don't legally need this on
// every message the same way, but once sending is automated/programmatic at
// volume it does: a valid physical postal address and a working opt-out
// mechanism are both required on every commercial email. Appended at send
// time rather than baked into draft_body so the review copy shown in the
// sales-queue UI stays exactly what the model wrote.
import crypto from "node:crypto";

const MAILING_ADDRESS = "Enoma, 183 Fairway Dr, Attleboro, MA 02703";
const UNSUBSCRIBE_BASE_URL = "https://enoma.io/api/ga-metrics";

function secret() {
  const s = process.env.UNSUBSCRIBE_SECRET;
  if (!s) throw new Error("UNSUBSCRIBE_SECRET is not set");
  return s;
}

export function buildUnsubscribeToken(email) {
  return crypto.createHmac("sha256", secret()).update(email.toLowerCase()).digest("hex");
}

export function verifyUnsubscribeToken(email, token) {
  if (!email || !token) return false;
  const expected = buildUnsubscribeToken(email);
  const a = Buffer.from(expected);
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function appendComplianceFooter(body, email) {
  const token = buildUnsubscribeToken(email);
  const unsubscribeUrl = `${UNSUBSCRIBE_BASE_URL}?action=unsubscribe&email=${encodeURIComponent(email)}&token=${token}`;
  // No "Unsubscribe:" label before the URL — the automated HTML send
  // substitutes "Unsubscribe" as the link's own visible text (see
  // LINK_LABEL_RULES in email-html.js), so a label here would read as a
  // redundant "Unsubscribe: Unsubscribe". The plain-text fallback still
  // reads fine as "Don't want these emails? <bare url>".
  return `${body}\n\n---\n${MAILING_ADDRESS}\nDon't want these emails? ${unsubscribeUrl}`;
}
