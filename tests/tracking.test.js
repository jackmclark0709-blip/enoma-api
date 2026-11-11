// Run with: node tests/tracking.test.js (also wired into `npm test`)
// Server-side funnel logging (api/_lib/tracking.js) and the dashboard's GA4
// purchase snippet.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { funnelRow, burstPartnerIds, logFunnelEvent, FUNNEL_EVENTS } from "../api/_lib/tracking.js";

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok - ${name}`); } catch (err) { console.error(`  FAIL - ${name}`); throw err; }
}

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";
const BIZ = "32d0946d-0a0e-4309-a42d-1ac12e16ac1c";

function fakeSupabase() {
  const inserted = [];
  return {
    inserted,
    from(table) {
      return {
        insert: async row => { inserted.push({ table, row }); return { error: null }; },
        select() { return this; }, eq() { return this; }, gte() { return this; }, order() { return this; }, limit() { return this; },
        maybeSingle: async () => ({ data: null })
      };
    }
  };
}
const req = (ip, ua = IPHONE, extra = {}) => ({ headers: { "x-forwarded-for": ip, "user-agent": ua, referer: "https://enoma.io/get-your-website", ...extra } });

await test("every self-serve step is allowlisted for /api/track", () => {
  for (const e of ["gyw_viewed", "gyw_step_completed", "gyw_submitted", "preview_shown", "signup_viewed", "signup_submitted", "account_created"]) {
    assert.ok(FUNNEL_EVENTS.has(e), e);
  }
  // server-only steps can't be forged from the browser
  for (const e of ["generation_succeeded", "checkout_started", "subscription_activated", "business_claimed"]) assert.equal(FUNNEL_EVENTS.has(e), false, e);
});

await test("funnelRow keeps known first-touch keys, clips, validates business_id", () => {
  const row = funnelRow({
    event: "gyw_submitted", trafficClass: "human", ip: "73.1.1.1", userAgent: IPHONE, anonId: "a".repeat(100),
    businessId: "not-a-uuid", referrer: "https://www.google.com/", metadata: { path: "instant" },
    attribution: { landing: "/for/x", utm_source: "google", utm_campaign: "hvac", evil: "<script>" }
  });
  assert.equal(row.anon_id.length, 64);
  assert.equal(row.business_id, null);
  assert.equal(row.traffic_class, "human");
  assert.deepEqual(row.metadata, { path: "instant", first_touch: { landing: "/for/x", utm_source: "google", utm_campaign: "hvac" } });
});

await test("checkout_started from a person's browser is human, with IP and UA", async () => {
  const sb = fakeSupabase();
  await logFunnelEvent(sb, req("174.224.179.161"), { event: "checkout_started", businessId: BIZ, anonId: "anon-1", metadata: { interval: "year" } });
  const { table, row } = sb.inserted[0];
  assert.equal(table, "funnel_events");
  assert.equal(row.event, "checkout_started");
  assert.equal(row.traffic_class, "human");
  assert.equal(row.business_id, BIZ);
  assert.equal(row.ip, "174.224.179.161");
});

await test("Jack's checkout is internal", async () => {
  const sb = fakeSupabase();
  await logFunnelEvent(sb, req("173.48.250.211"), { event: "checkout_started", businessId: BIZ });
  assert.equal(sb.inserted[0].row.traffic_class, "internal");
});

await test("subscription_activated from the Stripe webhook takes the class it's given, not Stripe's", async () => {
  const sb = fakeSupabase();
  await logFunnelEvent(sb, req("54.187.174.169", "Stripe/1.0 (+https://stripe.com/docs/webhooks)"), {
    event: "subscription_activated", businessId: BIZ, trafficClass: "human", referrer: null
  });
  const row = sb.inserted[0].row;
  assert.equal(row.traffic_class, "human");
  assert.equal(row.ip, null);
  assert.equal(row.user_agent, null);
  assert.equal(row.referrer, null);
});

await test("logging never throws", async () => {
  const broken = { from() { return { insert: async () => { throw new Error("db down"); } }; } };
  assert.equal(await logFunnelEvent(broken, req("73.1.1.1"), { event: "checkout_started" }), null);
});

await test("burst partners: only earlier human rows within 2 s, same email", () => {
  const at = Date.parse("2026-11-07T15:00:01.000Z");
  const prior = [
    { id: "1", at: "2026-11-07T15:00:00.500Z", event: "outreach_page_click", trafficClass: "human" },
    { id: "2", at: "2026-11-07T14:59:50.000Z", event: "outreach_page_click", trafficClass: "human" },
    { id: "3", at: "2026-11-07T15:00:00.800Z", event: "landing_view", trafficClass: "human" },
    { id: "4", at: "2026-11-07T15:00:00.900Z", event: "outreach_page_click", trafficClass: "link_scanner" }
  ];
  assert.deepEqual(burstPartnerIds({ event: "outreach_claim_click", at, priorForMessage: prior }), ["1"]);
});

// ── Dashboard GA4 purchase snippet ──
const dash = fs.readFileSync(new URL("../public/dashboard/index.html", import.meta.url), "utf8");
const snippet = dash.match(/<script>\s*\/\/ GA4 key event "purchase"[\s\S]*?<\/script>/)[0].replace(/<\/?script>/g, "");
function runPurchase(search, store = new Map()) {
  const events = [];
  const gtag = (...a) => events.push(a);
  vm.runInNewContext(snippet, {
    location: { search }, URLSearchParams, Number,
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
    gtag, window: { gtag }
  });
  return { events, store };
}
await test("purchase fires once per Checkout session with value and plan", () => {
  const store = new Map();
  const q = "?subscribed=1&business_id=x&plan=year&value=199.00&session_id=cs_test_a1B2c3";
  const first = runPurchase(q, store);
  assert.equal(first.events.length, 1);
  const [kind, name, params] = first.events[0];
  assert.equal(kind, "event"); assert.equal(name, "purchase");
  assert.equal(params.transaction_id, "cs_test_a1B2c3");
  assert.equal(params.value, 199); assert.equal(params.currency, "USD");
  assert.equal(params.items[0].item_id, "enoma_page_year");
  assert.equal(runPurchase(q, store).events.length, 0, "reload doesn't double count");
});
await test("no purchase without a real session id", () => {
  assert.equal(runPurchase("?subscribed=1&business_id=x").events.length, 0);
  assert.equal(runPurchase("?subscribed=1&session_id={CHECKOUT_SESSION_ID}").events.length, 0);
});

console.log(`tracking: ${passed} passed`);
