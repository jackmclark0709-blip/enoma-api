// Run with: node tests/outreach-throughput.test.js (also wired into `npm test`)
// ZeroBounce account errors, the free-checks-first gate, alert rules, and the
// second follow-up.

import assert from "node:assert/strict";
import { verifyMailbox, checkZeroBounceAccount, accountErrorReason, mapWithConcurrency } from "../api/_lib/mailbox-verify.js";
import { cheapPreviewGate, isWeakEnoughSite, qualifiesForPreview, SITE_WEAK_MIN_SCORE } from "../api/_lib/preview-generator.js";
import { alertDueToday, shouldAlertVerifyRetrySpike, buildZeroBounceAlert, buildVerifyRetrySpikeAlert, utcDay, VERIFY_RETRY_ALERT_THRESHOLD } from "../api/_lib/system-alerts.js";
import { isSecondFollowUpDue, buildSecondFollowUpEmail, buildFollowUpEmail, isLikelyLinkScanner, withUtm } from "../api/_lib/outreach-email.js";
import { followUpAllowance, secondFollowUpAllowance, FOLLOWUP_DAILY_CAP } from "../api/_lib/outreach-ramp.js";

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (err) {
    console.error(`  FAIL - ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

const respond = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });

console.log("ZeroBounce account errors");
await test("out of credits / bad key in the error field is a service_error, not retry", async () => {
  for (const error of ["Invalid API Key or your account ran out of credits", "Invalid API key", "Your account is suspended"]) {
    const v = await verifyMailbox("a@b.com", { apiKey: "k", fetchImpl: respond(200, { error }) });
    assert.equal(v.decision, "service_error", error);
    assert.match(v.reason, /credit|key|account/i);
  }
});
await test("HTTP 401 and 403 are service_errors whatever the body", async () => {
  assert.equal((await verifyMailbox("a@b.com", { apiKey: "k", fetchImpl: respond(401, {}) })).decision, "service_error");
  assert.equal((await verifyMailbox("a@b.com", { apiKey: "k", fetchImpl: respond(403, null) })).decision, "service_error");
});
await test("per-address trouble is still retry", async () => {
  assert.equal((await verifyMailbox("a@b.com", { apiKey: "k", fetchImpl: respond(500, { error: "Internal error" }) })).decision, "retry");
  assert.equal((await verifyMailbox("a@b.com", { apiKey: "k", fetchImpl: respond(200, { status: "unknown", sub_status: "greylisted" }) })).decision, "retry");
  const boom = async () => { throw Object.assign(new Error("t"), { name: "TimeoutError" }); };
  assert.equal((await verifyMailbox("a@b.com", { apiKey: "k", fetchImpl: boom })).decision, "retry");
});
await test("accountErrorReason ignores unrelated errors", () => {
  assert.equal(accountErrorReason({ httpStatus: 200, error: "Email address is required" }), null);
  assert.equal(accountErrorReason({ httpStatus: 500 }), null);
  assert.ok(accountErrorReason({ httpStatus: 401 }));
});
await test("getcredits: 0 or -1 stops the run, positive is fine", async () => {
  const zero = await checkZeroBounceAccount({ apiKey: "k", fetchImpl: respond(200, { Credits: "0" }) });
  assert.equal(zero.ok, false); assert.equal(zero.decision, "service_error"); assert.match(zero.reason, /credits/);
  const neg = await checkZeroBounceAccount({ apiKey: "k", fetchImpl: respond(200, { Credits: "-1" }) });
  assert.equal(neg.ok, false); assert.match(neg.reason, /key/i);
  const ok = await checkZeroBounceAccount({ apiKey: "k", fetchImpl: respond(200, { Credits: "812" }) });
  assert.deepEqual([ok.ok, ok.credits], [true, 812]);
});
await test("getcredits failing on its own doesn't stop the run", async () => {
  const boom = async () => { throw new Error("network"); };
  assert.equal((await checkZeroBounceAccount({ apiKey: "k", fetchImpl: boom })).ok, true);
  assert.equal((await checkZeroBounceAccount({ apiKey: "", fetchImpl: boom })).ok, true);
});

console.log("mapWithConcurrency");
await test("never more than N in flight, results in order", async () => {
  let inFlight = 0, peak = 0;
  const out = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 4, async (n) => {
    inFlight++; peak = Math.max(peak, inFlight);
    await new Promise(r => setTimeout(r, 5));
    inFlight--;
    return n * 2;
  });
  assert.deepEqual(out, [2, 4, 6, 8, 10, 12, 14]);
  assert.equal(peak, 4);
});
await test("stops starting new items once shouldStart is false", async () => {
  let stop = false;
  const out = await mapWithConcurrency([1, 2, 3, 4, 5], 1, async (n) => { if (n === 2) stop = true; return n; }, { shouldStart: () => !stop });
  assert.deepEqual(out, [1, 2, undefined, undefined, undefined]);
});

console.log("cheapPreviewGate (free checks before ZeroBounce)");
await test("passes on a strong Outscraper rating with a phone, no Places call needed", () => {
  assert.deepEqual(cheapPreviewGate({ prospectPhone: "508-555-0100", raw: { rating: 4.8, reviews: 40 } }), { ok: true });
});
await test("raw missing or weak asks for Places before deciding", () => {
  assert.equal(cheapPreviewGate({ prospectPhone: "x", raw: null }).needsPlaces, true);
  assert.equal(cheapPreviewGate({ prospectPhone: "x", raw: { rating: 4.2, reviews: 3 } }).needsPlaces, true);
});
await test("Places details decide when given (fresher than raw)", () => {
  assert.equal(cheapPreviewGate({ prospectPhone: "x", raw: { rating: 4.2, reviews: 3 }, place: { rating: 4.7, userRatingCount: 12 } }).ok, true);
  assert.equal(cheapPreviewGate({ prospectPhone: "x", raw: { rating: 5, reviews: 2 }, place: { rating: 4.0, userRatingCount: 80 } }).reason, "weak_or_thin_rating");
});
await test("no phone anywhere fails as no_phone; place = {} falls back to raw", () => {
  assert.equal(cheapPreviewGate({ raw: { rating: 5, reviews: 50 }, place: {} }).reason, "no_phone");
  assert.equal(cheapPreviewGate({ raw: { rating: 5, reviews: 50, phone: "x" }, place: {} }).ok, true);
  assert.equal(cheapPreviewGate({ raw: { rating: 5, reviews: 50 }, place: { nationalPhoneNumber: "(508) 555-0100" } }).ok, true);
});

await test("site check: the free pre-ZeroBounce rule is the same one the build uses", () => {
  assert.equal(SITE_WEAK_MIN_SCORE, 2);
  for (const score of [0, 1, 2, 3, undefined]) {
    const build = qualifiesForPreview({ rating: 5, reviewCount: 50, hasWebsite: true, siteCheckScore: score, phone: "x" });
    assert.equal(isWeakEnoughSite(score), build.ok, `score ${score}`);
  }
});

console.log("system alerts");
await test("at most one alert per UTC day", () => {
  const now = new Date("2026-11-10T15:00:00Z");
  assert.equal(alertDueToday(null, now), true);
  assert.equal(alertDueToday("2026-11-09", now), true);
  assert.equal(alertDueToday("2026-11-10", now), false);
  assert.equal(utcDay(new Date("2026-11-10T23:59:59Z")), "2026-11-10");
});
await test("verify_retry spike alerts above 10 in 24h", () => {
  assert.equal(VERIFY_RETRY_ALERT_THRESHOLD, 10);
  assert.equal(shouldAlertVerifyRetrySpike(10), false);
  assert.equal(shouldAlertVerifyRetrySpike(11), true);
});
await test("alert text says what's wrong and what to do", () => {
  const a = buildZeroBounceAlert("out of credits (0 left)");
  assert.equal(a.text, "ZeroBounce isn't verifying addresses (out of credits (0 left)). No new cold emails will go out until it's fixed. Check credits at zerobounce.net.");
  assert.match(buildVerifyRetrySpikeAlert(28).text, /28 prospects moved to verify_retry/);
});

console.log("isSecondFollowUpDue");
const sentAt = "2026-11-01T11:00:00Z";
const day = (n) => Date.parse(sentAt) + n * 864e5;
const fu1 = new Date(day(3)).toISOString();
const base = { sentAt, followupSentAt: fu1 };
await test("due once the first follow-up is 7 days old and the email 10-21 days old", () => {
  assert.equal(isSecondFollowUpDue({ ...base, now: day(10) }), true);
  assert.equal(isSecondFollowUpDue({ ...base, now: day(21) }), true);
});
await test("not before 7 days after the first follow-up", () => {
  assert.equal(isSecondFollowUpDue({ ...base, now: day(9.9) }), false);
  // First follow-up went late (day 8): email is 10 days old but follow-up only 2.
  assert.equal(isSecondFollowUpDue({ sentAt, followupSentAt: new Date(day(8)).toISOString(), now: day(10) }), false);
  assert.equal(isSecondFollowUpDue({ sentAt, followupSentAt: new Date(day(8)).toISOString(), now: day(15) }), true);
});
await test("not once the first email is older than 21 days", () => {
  assert.equal(isSecondFollowUpDue({ ...base, now: day(21.01) }), false);
});
await test("never without a first follow-up, or twice", () => {
  assert.equal(isSecondFollowUpDue({ sentAt, now: day(12) }), false);
  assert.equal(isSecondFollowUpDue({ ...base, followup2SentAt: new Date(day(11)).toISOString(), now: day(12) }), false);
});
await test("never after any response: reply, bounce, unsubscribe, complaint", () => {
  for (const r of ["replied", "bounced", "opted_out", "complained", "claimed"]) {
    assert.equal(isSecondFollowUpDue({ ...base, responseStatus: r, now: day(12) }), false, r);
  }
});
await test("never to someone who already opened their page", () => {
  assert.equal(isSecondFollowUpDue({ ...base, previewVisited: true, now: day(12) }), false);
});

console.log("buildSecondFollowUpEmail");
const ID = "3f2b8c1e-9d4a-4b6e-8f1a-2c3d4e5f6a7b";
const args = {
  businessName: "Arno Plumbing & Heating LLC", originalSubject: "I built Arno Plumbing & Heating a new page",
  messageId: ID, slug: "arno-plumbing", unsubscribeUrl: "https://enoma.io/api/ga-metrics?action=unsubscribe&email=a%40b.com&token=t",
  mailingAddress: "183 Fairway Dr, Attleboro, MA 02703"
};
const e2 = buildSecondFollowUpEmail(args);
await test("threads on the original subject, like the first follow-up", () => {
  assert.equal(e2.subject, "Re: I built Arno Plumbing & Heating a new page");
  assert.equal(e2.subject, buildFollowUpEmail(args).subject);
  assert.equal(buildSecondFollowUpEmail({ ...args, originalSubject: "Re: Re: x" }).subject, "Re: Re: x".replace(/^re:\s*/i, "Re: "));
});
await test("short last note with the price and a promise not to email again", () => {
  assert.match(e2.text, /^Hi there,\n\nLast note from me about Arno Plumbing & Heating's page: https:\/\/enoma\.io\/api\/ga-metrics\?action=go/);
  assert.match(e2.text, /first month free, then \$19\.99\/month or \$199\/year/);
  assert.match(e2.text, /I won't email again/);
  assert.notEqual(e2.text, buildFollowUpEmail(args).text);
  assert.ok(e2.text.split(/\s+/).length < 90, "short");
});
await test("every link carries the cold_followup2 UTM tags", () => {
  for (const url of [e2.links.page, e2.links.claim, e2.links.unsubscribe]) {
    const u = new URL(url);
    assert.equal(u.searchParams.get("utm_source"), "enoma");
    assert.equal(u.searchParams.get("utm_medium"), "email");
    assert.equal(u.searchParams.get("utm_campaign"), "cold_followup2");
  }
  const hrefs = [...e2.html.matchAll(/href="([^"]+)"/g)].map(m => m[1].replace(/&amp;/g, "&"));
  assert.equal(hrefs.length, 2);
  for (const h of hrefs) assert.match(h, /utm_campaign=cold_followup2/);
  assert.match(new URL(e2.links.page).searchParams.get("m"), /^3f2b8c1e/);
});
await test("keeps the unsubscribe footer and mailing address", () => {
  assert.match(e2.text, /---\n183 Fairway Dr, Attleboro, MA 02703\nDon't want these emails\? https:\/\/enoma\.io\/api\/ga-metrics\?action=unsubscribe/);
  assert.match(e2.html, /183 Fairway Dr, Attleboro, MA 02703/);
  assert.match(e2.html, />Unsubscribe</);
  assert.equal(new URL(e2.links.unsubscribe).searchParams.get("token"), "t", "unsubscribe token untouched");
});
await test("withUtm keeps existing params", () => {
  const u = new URL(withUtm("https://enoma.io/x?a=1"));
  assert.equal(u.searchParams.get("a"), "1");
  assert.equal(u.searchParams.get("utm_campaign"), "cold_followup2");
});

console.log("scanner window after the second follow-up");
await test("a click within 5 minutes of followup2_sent_at is a scanner", () => {
  const f2 = "2026-11-12T11:00:00Z";
  assert.equal(isLikelyLinkScanner({ sentAt, followupSentAt: fu1, followup2SentAt: f2, now: Date.parse("2026-11-12T11:00:40Z") }), true);
  assert.equal(isLikelyLinkScanner({ sentAt, followupSentAt: fu1, followup2SentAt: f2, now: Date.parse("2026-11-12T11:06:00Z") }), false);
  assert.equal(isLikelyLinkScanner({ sentAt, followupSentAt: fu1, now: Date.parse("2026-11-12T11:00:40Z") }), false);
});

console.log("follow-up cap ordering");
await test("first follow-ups take the allowance first; second ones get the rest", () => {
  const allowance = followUpAllowance({ dailyCap: 30 });
  assert.equal(allowance, FOLLOWUP_DAILY_CAP);
  assert.equal(secondFollowUpAllowance({ allowance, firstFollowUpsSent: 7 }), 3);
  assert.equal(secondFollowUpAllowance({ allowance, firstFollowUpsSent: 10 }), 0);
  assert.equal(secondFollowUpAllowance({ allowance, firstFollowUpsSent: 0 }), 10);
});
await test("second follow-ups sent earlier today use up the shared allowance and the overall cap", () => {
  // 4 first + 5 second follow-ups already out today: 1 follow-up slot left.
  const allowance = followUpAllowance({ dailyCap: 30, sentToday: 10, followupsToday: 9 });
  assert.equal(allowance, 1);
  assert.equal(secondFollowUpAllowance({ allowance, firstFollowUpsSent: 1 }), 0);
  // Overall cap nearly used: follow-ups can't push past 30.
  assert.equal(followUpAllowance({ dailyCap: 30, sentToday: 28, followupsToday: 0 }), 2);
});
await test("never negative", () => {
  assert.equal(secondFollowUpAllowance({ allowance: 0, firstFollowUpsSent: 3 }), 0);
});

console.log(`\n${passed} passed`);
