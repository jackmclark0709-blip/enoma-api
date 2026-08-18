// Pure helpers for extracting/filtering candidate emails from raw HTML and
// turning HTML into plain text for the AI gap-assessment prompt. Kept free of
// fetch/Supabase/OpenAI calls so they're unit-testable in isolation, same
// pattern as lead-scoring.js/service-utils.js. The actual crawl (fetch +
// OpenAI gap assessment + Supabase writes) lives in ga-metrics.js.

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// Domains/prefixes that show up constantly in scraped HTML but are never a
// real contact address for the business itself (platform infrastructure,
// placeholder/example addresses baked into templates).
const JUNK_EMAIL_DOMAINS = [
  "example.com", "sentry.io", "wixpress.com", "godaddy.com", "yourdomain.com",
  "domain.com", "email.com", "yoursite.com", "schema.org", "w3.org",
  "gstatic.com", "googleapis.com"
];
const JUNK_EMAIL_PREFIXES = ["noreply", "no-reply", "donotreply", "postmaster"];

export function extractEmails(html) {
  if (!html) return [];
  const found = new Set();
  for (const m of html.matchAll(/mailto:([^"'?\s>]+)/gi)) {
    try { found.add(decodeURIComponent(m[1]).toLowerCase()); }
    catch { found.add(m[1].toLowerCase()); }
  }
  (html.match(EMAIL_REGEX) || []).forEach(e => found.add(e.toLowerCase()));

  return [...found].filter(e => {
    const domain = (e.split("@")[1] || "").toLowerCase();
    if (!domain) return false;
    if (JUNK_EMAIL_DOMAINS.some(j => domain === j || domain.endsWith(`.${j}`))) return false;
    if (JUNK_EMAIL_PREFIXES.some(p => e.startsWith(p))) return false;
    if (/\.(png|jpe?g|gif|svg|webp|css|js)$/i.test(e)) return false;
    return true;
  });
}

// Prefers an email on the business's own domain (most reliable signal it's
// really theirs) over one picked up from a third-party embed/widget.
export function pickBestEmail(emails, websiteDomain) {
  if (!emails.length) return null;
  if (websiteDomain) {
    const onDomain = emails.find(e => e.endsWith(`@${websiteDomain}`));
    if (onDomain) return onDomain;
  }
  return emails[0];
}

export function htmlToText(html, maxLen = 6000) {
  if (!html) return "";
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}
