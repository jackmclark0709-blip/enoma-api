// Run with: node tests/review-requests.test.js (also wired into `npm test`)

import assert from "node:assert/strict";
import {
  googleReviewUrl, trackedReviewLink, isRequestId, normalizePhone,
  normalizeRequestInput, buildReviewRequestEmail, pickRemindersDue, startOfEasternDay,
} from "../api/_lib/review-requests.js";

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { console.error(`  FAIL - ${name}`); console.error(err); process.exitCode = 1; }
}

console.log("review-requests");

test("google review url from place id", () => {
  assert.equal(googleReviewUrl("ChIJ123abc"), "https://search.google.com/local/writereview?placeid=ChIJ123abc");
  assert.equal(googleReviewUrl("  "), null);
  assert.equal(googleReviewUrl(null), null);
});

test("tracked link and id check", () => {
  const id = "3f2b9c1e-8a4d-4f6b-9c2e-1a2b3c4d5e6f";
  assert.equal(trackedReviewLink(id), `https://enoma.io/r/${id}`);
  assert.ok(isRequestId(id));
  assert.ok(!isRequestId("not-an-id"));
  assert.ok(!isRequestId("3f2b9c1e-8a4d-4f6b-9c2e-1a2b3c4d5e6f' or 1=1"));
});

test("phone normalization", () => {
  assert.equal(normalizePhone("(508) 555-1234"), "+15085551234");
  assert.equal(normalizePhone("1-508-555-1234"), "+15085551234");
  assert.equal(normalizePhone("555-1234"), null);
});

test("input validation", () => {
  assert.deepEqual(
    normalizeRequestInput({ name: "  Maria   Lopez ", email: " Maria@Example.COM ", phone: "508 555 1234" }),
    { ok: true, value: { customer_name: "Maria Lopez", customer_email: "maria@example.com", customer_phone: "+15085551234", channel: "email" } }
  );
  assert.equal(normalizeRequestInput({ name: "Maria" }).ok, false);
  assert.equal(normalizeRequestInput({ email: "maria@" }).ok, false);
  assert.equal(normalizeRequestInput({ email: "maria@example.com" }).value.customer_name, null);
});

test("first email reads like the owner, links to Google, no gating question", () => {
  const e = buildReviewRequestEmail({ businessName: "Conway's Landscaping", ownerName: "Mike Conway", customerName: "Maria Lopez", link: "https://enoma.io/r/abc" });
  assert.equal(e.subject, "Thanks for choosing Conway's Landscaping");
  assert.ok(e.text.startsWith("Hi Maria,"));
  assert.ok(e.text.includes("https://enoma.io/r/abc"));
  assert.ok(e.text.includes("Mike\nConway's Landscaping"));
  assert.ok(!/happy|satisf|5[- ]star/i.test(e.text), "must not ask happy customers only");
  assert.ok(e.html.includes('href="https://enoma.io/r/abc"'));
  assert.ok(e.html.includes("Conway&#039;s"));
});

test("reminder email and fallbacks", () => {
  const e = buildReviewRequestEmail({ businessName: "Acme Plumbing", link: "L", isReminder: true });
  assert.equal(e.subject, "Quick reminder from Acme Plumbing");
  assert.ok(e.text.startsWith("Hi there,"));
  assert.ok(e.text.includes("\nAcme Plumbing\n"));
});

test("html escapes customer-entered names", () => {
  const e = buildReviewRequestEmail({ businessName: "Acme", customerName: "<script>x</script>", link: "L" });
  assert.ok(!e.html.includes("<script>"));
});

test("reminders: only unclicked, 3-14 days old, once", () => {
  const now = new Date("2026-10-10T15:00:00Z");
  const daysAgo = d => new Date(now.getTime() - d * 86400000).toISOString();
  const base = { status: "sent", customer_email: "a@b.co", reminder_sent_at: null, clicked_at: null };
  const rows = [
    { id: "due", ...base, sent_at: daysAgo(4) },
    { id: "too-new", ...base, sent_at: daysAgo(1) },
    { id: "too-old", ...base, sent_at: daysAgo(20) },
    { id: "clicked", ...base, status: "clicked", clicked_at: daysAgo(2), sent_at: daysAgo(5) },
    { id: "reminded", ...base, reminder_sent_at: daysAgo(1), sent_at: daysAgo(5) },
  ];
  assert.deepEqual(pickRemindersDue(rows, now).map(r => r.id), ["due"]);
});

test("daily cap counts from midnight Eastern", () => {
  // 2026-10-05 01:30 UTC is 21:30 EDT on Oct 4 → day started 04:00 UTC Oct 4.
  assert.equal(startOfEasternDay(new Date("2026-10-05T01:30:00Z")), "2026-10-04T04:00:00.000Z");
  // Winter (EST): 2026-12-15 12:00 UTC → 05:00 UTC same day.
  assert.equal(startOfEasternDay(new Date("2026-12-15T12:00:00Z")), "2026-12-15T05:00:00.000Z");
});

console.log(`${passed} passed`);
