// Lightweight, dependency-free tests for the sales-queue lead-scoring model.
// Run with: node tests/lead-scoring.test.js (also wired into `npm test`)

import assert from "node:assert/strict";
import { recencyFactor, tierFor, scoreRawLead, scoreProspect } from "../api/_lib/lead-scoring.js";

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (err) {
    console.error(`  FAIL - ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

const NOW = new Date("2026-08-12T12:00:00Z").getTime();
const daysAgo = n => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();

console.log("recencyFactor / tierFor");

test("fresh activity gets full weight", () => {
  assert.equal(recencyFactor(0), 1);
  assert.equal(recencyFactor(3), 1);
});

test("old activity decays toward the floor but never hits zero", () => {
  assert.equal(recencyFactor(30), 0.35);
  assert.equal(recencyFactor(365), 0.35);
});

test("tier thresholds", () => {
  assert.equal(tierFor(70), "hot");
  assert.equal(tierFor(69), "warm");
  assert.equal(tierFor(40), "warm");
  assert.equal(tierFor(39), "cold");
});

console.log("scoreRawLead");

test("concierge request with a phone number, unread, fresh — scores hot", () => {
  const { score, tier } = scoreRawLead({
    source: "choose_path_concierge", phone: "555-1212", is_read: false,
    replied_at: null, created_at: daysAgo(0)
  }, NOW);
  assert.ok(score >= 70, `expected hot score, got ${score}`);
  assert.equal(tier, "hot");
});

test("already-replied lead scores lower than an unread twin", () => {
  const base = { source: "started_form", phone: null, created_at: daysAgo(0) };
  const unread = scoreRawLead({ ...base, is_read: false, replied_at: null }, NOW);
  const replied = scoreRawLead({ ...base, is_read: true, replied_at: daysAgo(0) }, NOW);
  assert.ok(replied.score < unread.score);
});

test("a 45-day-old lead decays but is still a lead, not zero", () => {
  const { score } = scoreRawLead({
    source: "started_form", phone: null, is_read: true, replied_at: null, created_at: daysAgo(45)
  }, NOW);
  assert.ok(score > 0 && score < 40);
});

console.log("scoreProspect");

test("skipped prospects are suppressed entirely", () => {
  assert.equal(scoreProspect({ prospectStatus: "skipped", lastActivityAt: daysAgo(0) }, NOW), null);
});

test("bounced/opted-out outreach is suppressed regardless of prospect status", () => {
  assert.equal(scoreProspect({ prospectStatus: "sent", responseStatus: "bounced", lastActivityAt: daysAgo(0) }, NOW), null);
  assert.equal(scoreProspect({ prospectStatus: "sent", responseStatus: "opted_out", lastActivityAt: daysAgo(0) }, NOW), null);
});

test("a reply is the single strongest signal in the whole queue", () => {
  const { score, tier } = scoreProspect({
    prospectStatus: "sent", outreachStatus: "sent", responseStatus: "replied", lastActivityAt: daysAgo(1)
  }, NOW);
  assert.equal(score, 90);
  assert.equal(tier, "hot");
});

test("claiming outranks a bare reply", () => {
  const replied = scoreProspect({ prospectStatus: "sent", responseStatus: "replied", lastActivityAt: daysAgo(0) }, NOW);
  const claimed = scoreProspect({ prospectStatus: "sent", responseStatus: "claimed", lastActivityAt: daysAgo(0) }, NOW);
  assert.ok(claimed.score > replied.score);
});

test("a fresh unreviewed prospect scores cold, not hot", () => {
  const { tier } = scoreProspect({ prospectStatus: "new", lastActivityAt: daysAgo(0) }, NOW);
  assert.equal(tier, "cold");
});

console.log(`\n${passed} passed`);
