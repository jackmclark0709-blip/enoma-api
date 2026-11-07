// Run with: node tests/visit-followup.test.js (also wired into `npm test`)

import assert from "node:assert/strict";

process.env.UNSUBSCRIBE_SECRET = process.env.UNSUBSCRIBE_SECRET || "test-secret";
const {
  followupBlockReason, followupSendAt, followupExpired, buildVisitFollowupEmail, buildAlertFollowupSection,
  buildFollowupToken, verifyFollowupToken, followupActionUrl, FOLLOWUP_MIN_DELAY_MS, FOLLOWUP_MAX_DELAY_MS
} = await import("../api/_lib/visit-followup.js");

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

const ID = "3f2b8c1e-9d4a-4b6e-8f1a-2c3d4e5f6a7b";
const OTHER = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const prospect = { id: OTHER, email: "owner@acme-plumbing.com", status: "sent" };

console.log("followupBlockReason");
await test("a normal prospect may get a note", () => {
  assert.equal(followupBlockReason({ prospect }), null);
});
await test("internal or test businesses never do", () => {
  assert.equal(followupBlockReason({ prospect, isInternal: true }), "internal_business");
});
await test("suppressed, opted out, claimed or already-replied prospects never do", () => {
  assert.equal(followupBlockReason({ prospect, suppressed: true }), "suppressed");
  assert.equal(followupBlockReason({ prospect: { ...prospect, status: "opted_out" } }), "prospect_opted_out");
  assert.equal(followupBlockReason({ prospect, pageClaimed: true }), "page_claimed");
  assert.equal(followupBlockReason({ prospect, responseStatus: "replied" }), "already_replied");
});
await test("no email or no prospect blocks it", () => {
  assert.equal(followupBlockReason({ prospect: { ...prospect, email: null } }), "no_email");
  assert.equal(followupBlockReason({}), "no_prospect");
});

console.log("followupSendAt");
const visit = Date.parse("2026-11-07T15:00:00Z");
await test("lands 10-20 minutes after the visit when approved right away", () => {
  const at = followupSendAt({ visitedAt: new Date(visit).toISOString(), followupId: ID, now: visit + 60e3 }).getTime();
  assert.ok(at >= visit + FOLLOWUP_MIN_DELAY_MS && at <= visit + FOLLOWUP_MAX_DELAY_MS, new Date(at).toISOString());
});
await test("the same follow-up always gets the same time", () => {
  const a = followupSendAt({ visitedAt: new Date(visit).toISOString(), followupId: ID, now: visit });
  const b = followupSendAt({ visitedAt: new Date(visit).toISOString(), followupId: ID, now: visit + 30e3 });
  assert.equal(a.getTime(), b.getTime());
});
await test("goes a minute out when the window has passed", () => {
  const now = visit + 2 * 3600e3;
  const at = followupSendAt({ visitedAt: new Date(visit).toISOString(), followupId: ID, now }).getTime();
  assert.equal(at, now + 60e3);
});
await test("expires after 3 days", () => {
  assert.equal(followupExpired({ visitedAt: new Date(visit).toISOString(), now: visit + 2 * 864e5 }), false);
  assert.equal(followupExpired({ visitedAt: new Date(visit).toISOString(), now: visit + 3.1 * 864e5 }), true);
});

console.log("tokens");
await test("a token only works for its own id and mark", () => {
  const t = buildFollowupToken(ID, "approve");
  assert.equal(verifyFollowupToken(ID, "approve", t), true);
  assert.equal(verifyFollowupToken(ID, "skip", t), false);
  assert.equal(verifyFollowupToken(OTHER, "approve", t), false);
  assert.equal(verifyFollowupToken(ID, "delete", buildFollowupToken(ID, "approve")), false);
  assert.equal(verifyFollowupToken(ID, "approve", ""), false);
});
await test("action URLs carry a valid token", () => {
  const u = new URL(followupActionUrl(ID, "approve"));
  assert.equal(u.searchParams.get("action"), "visit_followup");
  assert.equal(verifyFollowupToken(u.searchParams.get("id"), u.searchParams.get("mark"), u.searchParams.get("token")), true);
});

console.log("buildVisitFollowupEmail");
const email = buildVisitFollowupEmail({ businessName: "Acme Plumbing LLC", originalSubject: "I built Acme Plumbing a new page", unsubscribeUrl: "https://enoma.io/u?x=1", mailingAddress: "1 Main St, Boston, MA" });
await test("threads as a reply to the original email", () => {
  assert.equal(email.subject, "Re: I built Acme Plumbing a new page");
  assert.equal(buildVisitFollowupEmail({ businessName: "X", originalSubject: "Re: Hi", unsubscribeUrl: "u", mailingAddress: "a" }).subject, "Re: Hi");
});
await test("is short, personal and carries the legal footer", () => {
  assert.match(email.text, /Saw you had a look at the page I made for Acme Plumbing/);
  assert.match(email.text, /Want me to change anything/);
  assert.match(email.text, /1 Main St, Boston, MA/);
  assert.match(email.html, /Unsubscribe/);
  assert.doesNotMatch(email.text, /\$|per month|free/i);
});
await test("has no tracked links for scanners to click", () => {
  assert.doesNotMatch(email.text, /action=go/);
  assert.equal((email.html.match(/href=/g) || []).length, 1);
});

console.log("buildAlertFollowupSection");
await test("shows the draft and both buttons", () => {
  const s = buildAlertFollowupSection({ followupId: ID, email });
  assert.match(s.html, /Approve and send/);
  assert.match(s.html, /mark=skip/);
  assert.match(s.text, /Saw you had a look/);
  assert.doesNotMatch(s.text, /Unsubscribe|Don't want these/);
});
await test("says why when blocked, with no buttons", () => {
  const s = buildAlertFollowupSection({ followupId: ID, blockReason: "internal_business" });
  assert.match(s.text, /internal_business/);
  assert.doesNotMatch(s.html, /Approve/);
});

console.log(`\n${passed} passed`);
