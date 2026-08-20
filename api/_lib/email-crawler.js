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
  // Bare-text email matching must skip <script>/<style> content — font
  // license comments (@font-face attributions), JSON-LD, and analytics
  // snippets routinely contain unrelated third-party emails that have
  // nothing to do with the business (e.g. a font designer's email baked
  // into a copyright comment). mailto: links above are unaffected since
  // they live in href attributes, not inside those blocks.
  const visibleHtml = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  (visibleHtml.match(EMAIL_REGEX) || []).forEach(e => found.add(e.toLowerCase()));

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

// Blocks the crawler from being pointed at internal infrastructure via a
// prospect's `website` field (semi-trusted — sourced from Google Maps
// listings, not fully attacker-controlled, but not something we validate
// either). Covers loopback, RFC1918 private ranges, link-local (which
// includes the 169.254.169.254 cloud-metadata address on AWS/GCP-style
// platforms), CGNAT, and IPv6 loopback/link-local/unique-local equivalents.
const IPV4_BLOCKED = [
  /^0\./,
  /^10\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.0\.0\./,
  /^192\.168\./,
  /^198\.(1[89])\./,
  /^22[4-9]\./,
  /^23\d\./,
  /^24\d\./,
  /^25[0-5]\./
];

export function isPrivateOrReservedIp(ip) {
  if (!ip) return true;
  if (ip.includes(":")) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd")) return true;
    if (lower.startsWith("::ffff:")) return isPrivateOrReservedIp(lower.slice(7));
    return false;
  }
  return IPV4_BLOCKED.some(re => re.test(ip));
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
