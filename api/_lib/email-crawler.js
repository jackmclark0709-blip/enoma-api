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

// Decodes numeric and the few named HTML entities that show up in email
// obfuscation. WordPress's antispambot() (used by most contractor themes)
// writes "info@x.com" as "&#105;&#110;&#102;&#111;&#64;..." and even
// "mailto:" as entities, so the raw-HTML regex never matched them.
export function decodeEntities(html) {
  if (!html) return "";
  return html
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&commat;/gi, "@")
    .replace(/&period;/gi, ".")
    .replace(/&amp;/gi, "&");
}
function safeChar(code) {
  return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
}

// Cloudflare "Email Address Obfuscation" (on by default for sites behind
// Cloudflare) replaces every address with data-cfemail="<hex>" or a
// /cdn-cgi/l/email-protection#<hex> link. First byte is the XOR key.
export function decodeCfEmail(hex) {
  if (!hex || !/^[0-9a-f]+$/i.test(hex) || hex.length < 4 || hex.length % 2) return null;
  const key = parseInt(hex.slice(0, 2), 16);
  let out = "";
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(out) ? out : null;
}

function cloudflareEmails(html) {
  const out = [];
  for (const m of html.matchAll(/data-cfemail=["']([0-9a-f]+)["']/gi)) out.push(decodeCfEmail(m[1]));
  for (const m of html.matchAll(/email-protection#([0-9a-f]+)/gi)) out.push(decodeCfEmail(m[1]));
  return out.filter(Boolean);
}

// schema.org JSON-LD (LocalBusiness / Organization) often carries the
// business email even when the page text doesn't. These blocks were thrown
// away with every other <script>, so read them on purpose.
function jsonLdEmails(html) {
  const out = [];
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    for (const e of m[1].matchAll(/"email"\s*:\s*"(?:mailto:)?([^"\s]+@[^"\s]+)"/gi)) out.push(e[1]);
  }
  return out;
}

// "info [at] site [dot] com" / "info(at)site.com" — hand-written dodges.
function spelledOutEmails(text) {
  const out = [];
  const re = /([a-z0-9._%+-]+)\s*[\[(]\s*at\s*[\])]\s*([a-z0-9-]+(?:\s*(?:[\[(]\s*dot\s*[\])]|\.)\s*[a-z0-9-]+)+)/gi;
  for (const m of text.matchAll(re)) {
    out.push(`${m[1]}@${m[2].replace(/\s*[\[(]\s*dot\s*[\])]\s*|\s*\.\s*/gi, ".")}`);
  }
  return out;
}

export function extractEmails(rawHtml) {
  if (!rawHtml) return [];
  const found = new Set();
  const html = decodeEntities(rawHtml);
  for (const e of [...cloudflareEmails(rawHtml), ...jsonLdEmails(html)]) found.add(e.toLowerCase());
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
  spelledOutEmails(visibleHtml.replace(/<[^>]+>/g, " ")).forEach(e => found.add(e.toLowerCase()));

  return [...new Set([...found].map(e => e.replace(/[.,;:]+$/, "")))].filter(e => {
    const domain = (e.split("@")[1] || "").toLowerCase();
    if (!domain) return false;
    if (JUNK_EMAIL_DOMAINS.some(j => domain === j || domain.endsWith(`.${j}`))) return false;
    if (JUNK_EMAIL_PREFIXES.some(p => e.startsWith(p))) return false;
    if (/\.(png|jpe?g|gif|svg|webp|css|js)$/i.test(e)) return false;
    return true;
  });
}

// Same-site links from the homepage that are likely to carry contact info,
// best first. Replaces guessing only /contact and /contact-us: real sites use
// /contact.html, /contact-us/, /get-a-quote, /free-estimate, /about-us...
const CONTACT_LINK_RE = /contact|quote|estimate|about|reach|get-in-touch|request/i;
export function contactLinks(html, baseUrl, max = 3) {
  if (!html || !baseUrl) return [];
  let base;
  try { base = new URL(baseUrl); } catch { return []; }
  const host = base.hostname.replace(/^www\./, "");
  const scored = new Map();
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1].trim();
    const label = m[2].replace(/<[^>]+>/g, " ");
    if (/^(mailto|tel|javascript):/i.test(href)) continue;
    if (!CONTACT_LINK_RE.test(href) && !CONTACT_LINK_RE.test(label)) continue;
    let url;
    try { url = new URL(href, base); } catch { continue; }
    if (url.hostname.replace(/^www\./, "") !== host) continue;
    if (/\.(pdf|jpe?g|png|gif|zip|docx?)$/i.test(url.pathname)) continue;
    url.hash = "";
    const key = url.toString();
    if (key === base.toString() || url.pathname === "/" ) continue;
    const score = /contact/i.test(href + label) ? 3 : /quote|estimate/i.test(href + label) ? 2 : 1;
    scored.set(key, Math.max(scored.get(key) || 0, score));
  }
  return [...scored.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([u]) => u);
}

// Listing URLs often say http:// for a site that only answers on https://
// (or the reverse, or only on www.). When the listed URL can't be reached at
// all, these are the other spellings worth one try each.
export function alternateOrigins(url) {
  let u;
  try { u = new URL(url); } catch { return []; }
  const out = [];
  const flipScheme = u.protocol === "http:" ? "https:" : "http:";
  const bare = u.hostname.replace(/^www\./, "");
  const flipWww = u.hostname.startsWith("www.") ? bare : `www.${bare}`;
  for (const [proto, host] of [[flipScheme, u.hostname], ["https:", flipWww]]) {
    const s = `${proto}//${host}/`;
    if (s !== `${u.protocol}//${u.hostname}/` && !out.includes(s)) out.push(s);
  }
  return out;
}

// Only addresses we can stand behind get emailed. Mis-parsed, off-site and
// role addresses were behind most bounces (Aug-Oct 2026 review of 203 sends):
// "office@www.richardbros.com", "mailtocontact@glowcleaningcompany.com",
// "slhr@ruc.edu.cn" scraped off a contractor's site, "webmaster@...".
// Rather than repair or guess (strip "www.", drop "mailto"), those are skipped.
export const FREE_MAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "hotmail.com", "outlook.com", "live.com", "msn.com",
  "aol.com", "icloud.com", "me.com", "mac.com", "comcast.net", "verizon.net", "att.net", "sbcglobal.net",
  "cox.net", "charter.net", "optonline.net", "protonmail.com", "proton.me", "bellsouth.net", "earthlink.net"
]);
const ROLE_PREFIXES = ["webmaster", "hostmaster", "admin", "administrator", "abuse", "privacy", "legal", "dmca", "careers", "jobs", "hr", "billing", "accounting", "press", "media", "marketing", "seo", "wordpress", "user", "test", "email", "name", "your", "you"];

const bareHost = (h) => String(h || "").toLowerCase().replace(/^www\./, "");

/**
 * Why (or whether) a crawled address is safe to send cold outreach to.
 * @returns {{ ok: boolean, reason: string }}
 */
// A business's email domain often isn't its website domain
// (papashvac.com vs papasplumbinghvac.com). Counted as related only when the
// email domain contains a distinctive word from the business name or the
// website's own name, so a stray address on someone else's domain never is.
// Trade and filler words are excluded: "plumbing" in someone else's domain
// says nothing about whether it's this business's address.
const STOP_WORDS = new Set([
  "the", "and", "llc", "inc", "co", "company", "services", "service", "group", "home", "pros", "pro", "local", "best",
  "plumbing", "plumber", "heating", "cooling", "air", "conditioning", "hvac", "electric", "electrical", "electrician",
  "roofing", "painting", "painters", "construction", "contracting", "contractors", "contractor", "landscaping", "lawn",
  "care", "cleaning", "repair", "remodeling", "builders", "solutions", "systems", "general", "family",
]);
function relatedDomain(emailDomain, site, businessName) {
  const label = emailDomain.split(".").slice(0, -1).join("");
  const words = [
    ...String(businessName || "").toLowerCase().replace(/['’]/g, "").split(/[^a-z0-9]+/),
    ...(site ? [site.split(".")[0]] : []),
  ].filter(w => w.length >= 4 && !STOP_WORDS.has(w));
  return words.some(w => label.includes(w));
}

export function classifyEmail(email, websiteDomain, businessName) {
  const e = String(email || "").trim().toLowerCase();
  const m = e.match(/^([a-z0-9._%+-]+)@([a-z0-9-]+(?:\.[a-z0-9-]+)+)$/);
  if (!m) return { ok: false, reason: "malformed" };
  const [, local, domain] = m;
  if (domain.startsWith("www.")) return { ok: false, reason: "malformed" };
  if (local.startsWith("mailto")) return { ok: false, reason: "malformed" };
  if (/^\d+$/.test(local) || local.length < 2) return { ok: false, reason: "malformed" };
  if (ROLE_PREFIXES.includes(local.split(/[+._-]/)[0])) return { ok: false, reason: "role_address" };
  const site = bareHost(websiteDomain);
  if (site && (domain === site || domain.endsWith(`.${site}`))) return { ok: true, reason: "on_domain" };
  if (FREE_MAIL_DOMAINS.has(domain)) return { ok: true, reason: "free_mail" };
  // Related but different domain: allowed only once ZeroBounce confirms the
  // mailbox (prepareOutreachOnce), never on a domain-name match alone.
  if (relatedDomain(domain, site, businessName)) return { ok: true, reason: "related_domain", needsVerification: true };
  return { ok: false, reason: "off_domain" };
}

// Best address found on the business's own pages: one on their own domain
// first, then a personal mailbox (gmail etc., common for one-truck
// businesses). Anything else is skipped rather than risked.
export function pickBestEmail(emails, websiteDomain, businessName) {
  const ranked = (emails || [])
    .map(e => ({ e, c: classifyEmail(e, websiteDomain, businessName) }))
    .filter(x => x.c.ok);
  const order = ["on_domain", "free_mail", "related_domain"];
  ranked.sort((a, b) => order.indexOf(a.c.reason) - order.indexOf(b.c.reason));
  return ranked[0]?.e || null;
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

// Google Business Profile links often carry UTM params, and some listings
// store them with the "?" percent-encoded ("site.com/%3Futm_source%3D..."),
// which turns the query into a path that 404s. Returns the URLs worth trying
// as a site's homepage, best first: the cleaned listing URL (query, hash and
// any encoded query dropped), then the bare origin when the listing pointed
// at a deep page (e.g. "/service-area/sarasota/"). Empty array if unparseable.
export function websiteCandidates(website) {
  if (!website) return [];
  const raw = String(website).trim().replace(/%3F.*$/i, "");
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) && !/^https?:\/\//i.test(raw)) return [];
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return [];
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return [];
  url.search = "";
  url.hash = "";
  const out = [url.toString()];
  const origin = `${url.origin}/`;
  if (!out.includes(origin)) out.push(origin);
  return out;
}
