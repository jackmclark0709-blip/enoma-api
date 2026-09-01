// Pure(ish) pre-send email sanity check for automated outreach — deliberately
// NOT a live SMTP mailbox probe. Probing RCPT TO from a serverless IP gets
// flagged by receiving mail servers fast and would burn the sending domain's
// reputation before it's even warmed up. An MX-record lookup is a much
// cheaper, safer first filter: catches typo'd/dead domains (no mail server at
// all) without ever touching the target mailbox. Real mailbox-level bounces
// are handled separately, after the fact, via the Resend bounce webhook
// feeding suppression_list (see outreach-footer.js / ga-metrics.js).
import dns from "node:dns/promises";

export async function hasValidMx(email) {
  const domain = (email || "").split("@")[1];
  if (!domain) return false;
  try {
    const records = await dns.resolveMx(domain);
    return Array.isArray(records) && records.length > 0;
  } catch {
    return false;
  }
}
