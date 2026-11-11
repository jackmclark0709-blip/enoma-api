// Run with: node tests/traffic-classifier.test.js (also wired into `npm test`)
import assert from "node:assert/strict";
import {
  classifyTraffic, ipInCidr, ipv4ToInt, isInternalIp, internalIpsFromEnv, hasInternalCookie,
  requestTrafficInput, isHumanOpenLikely, normalizeIp
} from "../api/_lib/traffic-classifier.js";

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (err) { console.error(`FAIL: ${name}`); throw err; }
}
const cls = input => classifyTraffic(input).trafficClass;

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1";
const WIN_CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const ANDROID = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Mobile Safari/537.36";

console.log("CIDR helper");
test("matches inside and outside a range", () => {
  assert.equal(ipInCidr("72.153.231.4", "72.152.0.0/14"), true);
  assert.equal(ipInCidr("72.156.0.1", "72.152.0.0/14"), false);
  assert.equal(ipInCidr("66.249.95.255", "66.249.64.0/19"), true);
  assert.equal(ipInCidr("66.249.96.0", "66.249.64.0/19"), false);
  assert.equal(ipInCidr("135.239.255.255", "135.224.0.0/12"), true);
  assert.equal(ipInCidr("135.240.0.0", "135.224.0.0/12"), false);
  assert.equal(ipInCidr("1.2.3.4", "0.0.0.0/0"), true);
});
test("is not a string-prefix match", () => {
  // "72.15" would prefix-match 72.150.x, which is outside 72.152.0.0/14
  assert.equal(ipInCidr("72.150.1.1", "72.152.0.0/14"), false);
  assert.equal(ipInCidr("173.48.250.2", "173.48.250.211/32"), false);
});
test("rejects junk and handles IPv6-mapped IPv4", () => {
  assert.equal(ipv4ToInt("256.1.1.1"), null);
  assert.equal(ipv4ToInt("2601:19b::1"), null);
  assert.equal(ipInCidr("not-an-ip", "10.0.0.0/8"), false);
  assert.equal(normalizeIp("::ffff:173.48.250.211"), "173.48.250.211");
  assert.equal(normalizeIp("173.48.250.211, 10.0.0.1"), "173.48.250.211");
});

console.log("internal");
test("Jack's home IP", () => {
  assert.equal(cls({ ip: "173.48.250.211", userAgent: IPHONE, event: "page_view" }), "internal");
  // even when the same request also looks like a scanner (internal wins)
  assert.equal(cls({ ip: "173.48.250.211", userAgent: "curl/8", event: "outreach_page_click" }), "internal");
});
test("INTERNAL_IPS env replaces the default list, CIDR entries allowed", () => {
  const list = internalIpsFromEnv({ INTERNAL_IPS: "10.1.2.3, 192.168.0.0/16" });
  assert.deepEqual(list, ["10.1.2.3", "192.168.0.0/16"]);
  assert.equal(isInternalIp("192.168.4.4", list), true);
  assert.equal(isInternalIp("173.48.250.211", list), false);
  assert.ok(internalIpsFromEnv({}).includes("173.48.250.211"));
});
test("enoma_internal cookie", () => {
  assert.equal(hasInternalCookie("a=1; enoma_internal=1; b=2"), true);
  assert.equal(hasInternalCookie("enoma_internal=10"), false);
  assert.equal(hasInternalCookie("xenoma_internal=1"), false);
  assert.equal(cls({ ip: "70.255.1.1", userAgent: IPHONE, cookieHeader: "enoma_internal=1", event: "page_view" }), "internal");
});
test("device ?internal=1 flag", () => {
  assert.equal(cls({ ip: "70.255.1.1", userAgent: IPHONE, internalFlag: true }), "internal");
});

console.log("crawler");
test("Googlebot user agent", () => {
  const gb = "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.122 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
  assert.deepEqual(classifyTraffic({ ip: "66.249.66.1", userAgent: gb, event: "page_view" }), { trafficClass: "crawler", reason: "user_agent" });
  // Googlebot's UA from anywhere is still a crawler
  assert.equal(cls({ ip: "8.8.8.8", userAgent: gb }), "crawler");
});
test("Googlebot IP range with a non-bot UA (GoogleOther / rendering)", () => {
  assert.deepEqual(classifyTraffic({ ip: "66.249.70.12", userAgent: IPHONE, event: "page_view" }), { trafficClass: "crawler", reason: "googlebot_ip" });
});
test("other bots and tools", () => {
  for (const ua of ["YelpBot (https://www.yelp.com/)", "Mozilla/5.0 (compatible; bingbot/2.0)", "Stripe/1.0 (+https://stripe.com/docs/webhooks)",
    "facebookexternalhit/1.1", "meta-externalagent/1.1", "python-requests/2.31", "curl/8.4.0", "Go-http-client/2.0",
    "axios/1.7.2", "node-fetch/1.0", "Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/156.0", "Lightpanda/1.0", "Chrome-Lighthouse"]) {
    assert.equal(cls({ ip: "70.255.1.1", userAgent: ua }), "crawler", ua);
  }
  assert.equal(cls({ ip: "70.255.1.1", userAgent: "" }), "crawler");
});
test("datacenter page views", () => {
  assert.equal(cls({ ip: "54.201.1.1", userAgent: WIN_CHROME, event: "page_view" }), "crawler");
  assert.equal(cls({ ip: "43.153.2.2", userAgent: WIN_CHROME, event: "page_view" }), "crawler");
});

console.log("social_preview");
test("Meta IP burst", () => {
  const base = Date.parse("2026-11-03T15:00:00Z");
  const ips = ["31.13.115.1", "173.252.107.4", "66.220.149.20", "69.171.230.2", "69.63.189.1", "157.240.19.6", "129.134.27.1"];
  for (let i = 0; i < 10; i++) {
    assert.equal(cls({ ip: ips[i % ips.length], userAgent: IPHONE, event: "page_view", at: base + i * 80 }), "social_preview");
  }
});
test("facebookexternalhit from Meta is a crawler (UA wins)", () => {
  assert.equal(cls({ ip: "31.13.115.1", userAgent: "facebookexternalhit/1.1" }), "crawler");
});

console.log("link_scanner");
const delivered = Date.parse("2026-11-05T11:12:43Z");
const outreach = { sentAt: "2026-11-05T11:12:41.767Z", deliveredAt: "2026-11-05T11:12:43.628Z" };
test("Azure IP outreach click 30 s after delivery", () => {
  assert.equal(cls({ ip: "72.153.231.40", userAgent: WIN_CHROME, event: "outreach_page_click", at: delivered + 30_000, outreach }), "link_scanner");
});
test("any IP, outreach click 30 s after delivery", () => {
  assert.deepEqual(
    classifyTraffic({ ip: "209.222.82.126", userAgent: WIN_CHROME, event: "outreach_page_click", at: delivered + 30_000, outreach }),
    { trafficClass: "link_scanner", reason: "soon_after_send" }
  );
});
test("follow-up sends restart the clock", () => {
  const o = { ...outreach, followupSentAt: "2026-11-09T11:12:31Z" };
  assert.equal(cls({ ip: "68.104.221.174", userAgent: WIN_CHROME, event: "outreach_page_click", at: Date.parse("2026-11-09T11:13:01Z"), outreach: o }), "link_scanner");
  assert.equal(cls({ ip: "68.104.221.174", userAgent: WIN_CHROME, event: "outreach_page_click", at: Date.parse("2026-11-09T11:20:00Z"), outreach: o }), "human");
});
test("page + claim expanded in the same second", () => {
  const at = Date.parse("2026-11-07T15:00:00.700Z");
  const prior = [{ at: "2026-11-07T15:00:00.200Z", event: "outreach_page_click", ip: "209.6.1.1", trafficClass: "human" }];
  assert.equal(cls({ ip: "209.6.1.2", userAgent: WIN_CHROME, event: "outreach_claim_click", at, outreach, priorForMessage: prior }), "link_scanner");
});
test("a person's click then landing view a second later is not a burst", () => {
  const at = Date.parse("2026-11-07T15:00:01.000Z");
  const prior = [{ at: "2026-11-07T15:00:00.200Z", event: "outreach_page_click", ip: "209.6.1.1", trafficClass: "human" }];
  assert.equal(cls({ ip: "209.6.1.1", userAgent: IPHONE, event: "landing_view", at, outreach, priorForMessage: prior }), "human");
});
test("the page a scanner was redirected to is the scanner too", () => {
  const at = Date.parse("2026-11-07T15:00:09Z");
  const prior = [{ at: "2026-11-07T15:00:00Z", event: "outreach_page_click", ip: "209.222.82.72", trafficClass: "link_scanner" }];
  assert.equal(cls({ ip: "209.222.82.72", userAgent: WIN_CHROME, event: "landing_view", at, outreach, priorForMessage: prior }), "link_scanner");
});
test("AWS / GCP on an outreach event", () => {
  assert.equal(cls({ ip: "34.224.213.75", userAgent: WIN_CHROME, event: "outreach_page_click", at: delivered + 3 * 3600e3, outreach }), "link_scanner");
  assert.equal(cls({ ip: "54.89.25.36", userAgent: WIN_CHROME, event: "outreach_page_click" }), "link_scanner");
});

console.log("human");
test("Comcast/Verizon residential and mobile visits", () => {
  assert.equal(cls({ ip: "73.143.20.5", userAgent: WIN_CHROME, event: "page_view" }), "human");        // Comcast
  assert.equal(cls({ ip: "174.224.179.161", userAgent: ANDROID, event: "contact_click" }), "human");   // Verizon Wireless
  assert.equal(cls({ ip: "75.67.181.245", userAgent: IPHONE, event: "contact_click" }), "human");      // Comcast
});
test("a prospect clicking hours after the email", () => {
  assert.deepEqual(
    classifyTraffic({ ip: "68.104.221.174", userAgent: IPHONE, event: "outreach_page_click", at: Date.parse("2026-11-05T14:12:11Z"), outreach }),
    { trafficClass: "human", reason: "default" }
  );
});

console.log("request + opens");
test("requestTrafficInput reads the first forwarded IP and the cookie", () => {
  const r = requestTrafficInput({ headers: { "x-forwarded-for": "173.48.250.211, 76.76.21.21", "user-agent": IPHONE, cookie: "enoma_internal=1" } });
  assert.deepEqual(r, { ip: "173.48.250.211", userAgent: IPHONE, cookieHeader: "enoma_internal=1" });
});
test("Apple MPP and scanner opens aren't human", () => {
  assert.equal(isHumanOpenLikely({}), null);
  assert.equal(isHumanOpenLikely({ ip: "17.58.1.1", userAgent: "Mozilla/5.0" }), false);
  assert.equal(isHumanOpenLikely({ ip: "104.28.1.1", userAgent: "Mozilla/5.0" }), false);
  assert.equal(isHumanOpenLikely({ ip: "52.1.1.1", userAgent: WIN_CHROME }), false);
  assert.equal(isHumanOpenLikely({ ip: "73.1.1.1", userAgent: WIN_CHROME, at: delivered + 10_000, outreach }), false);
  assert.equal(isHumanOpenLikely({ ip: "73.1.1.1", userAgent: WIN_CHROME, at: delivered + 3600e3, outreach }), true);
});

console.log(`traffic-classifier: ${passed} passed`);
