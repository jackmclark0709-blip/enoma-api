// One answer to "was this a real outside person?" for every tracked event.
// page_events, funnel_events and the outreach_messages counters all go
// through classifyTraffic(), and scripts/backfill-traffic-class.mjs replays
// the same function over old rows, so reports and the backfill agree.
//
// Classes, checked in this order (first match wins):
//   internal        Jack: INTERNAL_IPS, the enoma_internal=1 cookie
//                   (set by /internal-optout) or the device's ?internal=1 flag
//   crawler         bot user agents, Googlebot's IP range, an empty user
//                   agent, and datacenter IPs on ordinary page views
//   social_preview  Meta's link-preview fetchers (Facebook/Instagram/WhatsApp)
//   link_scanner    mail-security scanners: Microsoft/Azure IPs, AWS/GCP IPs
//                   on outreach events, and outreach events that land within
//                   120 s of the email or in a 2 s burst for the same email
//   human           everything else
//
// IP ranges live in api/_lib/traffic-ranges.js.

import {
  DEFAULT_INTERNAL_IPS, GOOGLEBOT_RANGES, META_RANGES, MICROSOFT_RANGES, CLOUD_RANGES, ASIA_CLOUD_RANGES
} from "./traffic-ranges.js";

export const TRAFFIC_CLASSES = ["internal", "crawler", "link_scanner", "social_preview", "human"];

export const CRAWLER_UA = /bot|crawl|spider|slurp|headless|lighthouse|python|curl|wget|go-http|axios|node-fetch|stripe|facebookexternalhit|meta-externalagent|googlebot|google-inspectiontool|googleother|bingbot|yelpbot|lightpanda/i;

// An outreach event this soon after the email (or a follow-up) was sent or
// delivered is a mail filter checking the link on arrival.
export const SCANNER_AFTER_SEND_MS = 120 * 1000;
// Two events for the same email this close together is a scanner expanding
// every link (Oct 26: page + claim 0.5 s apart).
export const SCANNER_BURST_MS = 2 * 1000;
// A page/landing view that follows a scanner's click from the same IP is the
// scanner rendering the page it was redirected to.
export const SCANNER_FOLLOW_MS = 10 * 60 * 1000;

export const OUTREACH_CLICK_EVENTS = new Set(["outreach_page_click", "outreach_claim_click"]);

export const INTERNAL_COOKIE = "enoma_internal";

// ── CIDR matching (IPv4) ─────────────────────────────────────────────────
export function normalizeIp(ip) {
  let s = String(ip || "").trim();
  if (!s) return null;
  if (s.includes(",")) s = s.split(",")[0].trim();
  if (s.toLowerCase().startsWith("::ffff:") && s.includes(".")) s = s.slice(7);
  return s || null;
}

export function ipv4ToInt(ip) {
  const parts = String(ip).split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

const cidrCache = new Map();
export function parseCidr(cidr) {
  if (cidrCache.has(cidr)) return cidrCache.get(cidr);
  const [addr, bitsRaw] = String(cidr).split("/");
  const base = ipv4ToInt(addr);
  const bits = bitsRaw === undefined ? 32 : Number(bitsRaw);
  const parsed = base === null || !Number.isInteger(bits) || bits < 0 || bits > 32
    ? null
    : { base: bits === 0 ? 0 : base - (base % 2 ** (32 - bits)), size: 2 ** (32 - bits) };
  cidrCache.set(cidr, parsed);
  return parsed;
}

export function ipInCidr(ip, cidr) {
  const n = ipv4ToInt(ip);
  const c = parseCidr(cidr);
  if (n === null || !c) return false;
  return n >= c.base && n < c.base + c.size;
}

export function ipInRanges(ip, ranges) {
  const n = normalizeIp(ip);
  if (!n) return false;
  return ranges.some(r => ipInCidr(n, r));
}

// ── Internal ─────────────────────────────────────────────────────────────
export function internalIpsFromEnv(env = process.env) {
  const raw = String(env.INTERNAL_IPS || "").trim();
  if (!raw) return DEFAULT_INTERNAL_IPS;
  return raw.split(",").map(s => s.trim()).filter(Boolean);
}

export function isInternalIp(ip, list = internalIpsFromEnv()) {
  const n = normalizeIp(ip);
  if (!n) return false;
  // Local development is always internal.
  if (n === "::1" || ipInCidr(n, "127.0.0.0/8")) return true;
  return list.some(entry => entry === n || (entry.includes("/") && ipInCidr(n, entry)));
}

export function hasInternalCookie(cookieHeader) {
  return /(?:^|;\s*)enoma_internal=1(?:;|$)/.test(String(cookieHeader || ""));
}

// ── Outreach timing ──────────────────────────────────────────────────────
const ms = t => {
  if (t === null || t === undefined || t === "") return NaN;
  return typeof t === "number" ? t : new Date(t).getTime();
};

/** Most recent send/delivery of this email (or its follow-ups) at or before `at`. */
export function lastSendBefore(outreach, at) {
  if (!outreach) return NaN;
  const times = [outreach.sentAt, outreach.deliveredAt, outreach.followupSentAt, outreach.followup2SentAt]
    .map(ms).filter(t => Number.isFinite(t) && t <= at);
  return times.length ? Math.max(...times) : NaN;
}

/**
 * @param {object} input
 * @param {string} [input.ip]
 * @param {string} [input.userAgent]
 * @param {string} [input.cookieHeader]   raw Cookie header
 * @param {boolean} [input.internalFlag]  the device's ?internal=1 localStorage flag
 * @param {string[]} [input.internalIps]  defaults to INTERNAL_IPS / DEFAULT_INTERNAL_IPS
 * @param {string} [input.event]
 * @param {number|string} [input.at]     event time (default now)
 * @param {object} [input.outreach]       { sentAt, deliveredAt, followupSentAt, followup2SentAt }
 *                                        when the event belongs to an outreach email
 * @param {Array<{at, event, ip, trafficClass}>} [input.priorForMessage]
 *                                        earlier events for the same email
 * @returns {{ trafficClass: string, reason: string }}
 */
export function classifyTraffic({
  ip, userAgent, cookieHeader, internalFlag, internalIps, event, at, outreach, priorForMessage
} = {}) {
  const when = Number.isFinite(ms(at)) ? ms(at) : Date.now();
  const ua = String(userAgent || "");
  const addr = normalizeIp(ip);
  const result = (trafficClass, reason) => ({ trafficClass, reason });

  if (internalFlag === true) return result("internal", "device_flag");
  if (hasInternalCookie(cookieHeader)) return result("internal", "cookie");
  if (addr && isInternalIp(addr, internalIps || internalIpsFromEnv())) return result("internal", "ip");

  if (!ua.trim()) return result("crawler", "no_user_agent");
  if (CRAWLER_UA.test(ua)) return result("crawler", "user_agent");
  if (ipInRanges(addr, GOOGLEBOT_RANGES)) return result("crawler", "googlebot_ip");

  if (ipInRanges(addr, META_RANGES)) return result("social_preview", "meta_ip");

  if (ipInRanges(addr, MICROSOFT_RANGES)) return result("link_scanner", "microsoft_ip");

  const isOutreach = !!outreach || OUTREACH_CLICK_EVENTS.has(event);
  if (isOutreach) {
    if (ipInRanges(addr, CLOUD_RANGES)) return result("link_scanner", "cloud_ip");
    const sent = lastSendBefore(outreach, when);
    if (Number.isFinite(sent) && when - sent < SCANNER_AFTER_SEND_MS) return result("link_scanner", "soon_after_send");
    for (const p of priorForMessage || []) {
      const pt = ms(p.at);
      if (!Number.isFinite(pt) || pt > when) continue;
      const gap = when - pt;
      const bothClicks = OUTREACH_CLICK_EVENTS.has(event) && OUTREACH_CLICK_EVENTS.has(p.event);
      if (gap < SCANNER_BURST_MS && (bothClicks || p.event === event)) return result("link_scanner", "burst");
      if (gap < SCANNER_FOLLOW_MS && p.trafficClass === "link_scanner" && p.ip && normalizeIp(p.ip) === addr) {
        return result("link_scanner", "follows_scanner");
      }
    }
  }

  if (ipInRanges(addr, CLOUD_RANGES) || ipInRanges(addr, ASIA_CLOUD_RANGES)) return result("crawler", "datacenter_ip");

  return result("human", "default");
}

/** Shorthand for an incoming request (Vercel/Node req). */
export function requestTrafficInput(req) {
  const h = req?.headers || {};
  return {
    ip: normalizeIp(h["x-forwarded-for"]) || normalizeIp(h["x-real-ip"]) || normalizeIp(req?.socket?.remoteAddress),
    userAgent: h["user-agent"] || "",
    cookieHeader: h.cookie || ""
  };
}

// ── Email opens ──────────────────────────────────────────────────────────
// Opens are a weak signal: Apple Mail Privacy Protection preloads every
// image through Apple's proxy (17.0.0.0/8, generic "Mozilla/5.0" UA) whether
// or not anyone reads the email, and mail scanners fetch the pixel on
// arrival. Returns true/false when the open event carries an IP or user
// agent, null when it doesn't (then nothing can be said either way).
export const APPLE_MPP_RANGES = ["17.0.0.0/8"];
export function isHumanOpenLikely({ ip, userAgent, at, outreach } = {}) {
  const addr = normalizeIp(ip);
  const ua = String(userAgent || "").trim();
  if (!addr && !ua) return null;
  if (ipInRanges(addr, APPLE_MPP_RANGES)) return false;
  if (ua === "Mozilla/5.0") return false;
  const c = classifyTraffic({ ip: addr, userAgent: ua || "Mozilla/5.0 (unknown)", at, outreach, event: "email_open" });
  return c.trafficClass === "human";
}
