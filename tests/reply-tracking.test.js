// Run with: node tests/reply-tracking.test.js (also wired into `npm test`)

import assert from "node:assert/strict";
import {
  buildReplyAddress, parseReplyAddress, extractAddress, stripQuoted,
  classifyReply, engagementKind, tagPreviewLinks, looksLikeBot
} from "../api/_lib/reply-tracking.js";

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

const ID = "3f2b8c1e-5d4a-4b7e-9c2f-1a2b3c4d5e6f";

console.log("reply addresses");

test("round-trips a message id", () => {
  const addr = buildReplyAddress(ID);
  assert.equal(addr, `reply+${ID}@mail.enoma.io`);
  assert.equal(parseReplyAddress([addr]), ID);
});

test("parses display-name form and ignores other addresses", () => {
  assert.equal(parseReplyAddress(["jack@enoma.io", `"Jack at Enoma" <reply+${ID.toUpperCase()}@mail.enoma.io>`]), ID);
});

test("rejects wrong domain or non-uuid tag", () => {
  assert.equal(parseReplyAddress([`reply+${ID}@evil.com`]), null);
  assert.equal(parseReplyAddress(["reply+abc@mail.enoma.io"]), null);
  assert.equal(parseReplyAddress(undefined), null);
});

test("extractAddress handles names and junk", () => {
  assert.equal(extractAddress("Bob Smith <Bob@Smith.com>"), "bob@smith.com");
  assert.equal(extractAddress("bob@smith.com"), "bob@smith.com");
  assert.equal(extractAddress("not an email"), null);
});

console.log("reply classification");

const quoted = "\n\nOn Tue, Sep 29, 2026 at 7:40 AM Jack at Enoma <reply@mail.enoma.io> wrote:\n> Hi there\n> Don't want these emails? https://enoma.io/api/ga-metrics?action=unsubscribe";

test("stripQuoted drops the quoted original", () => {
  assert.equal(stripQuoted("Sounds good, call me." + quoted), "Sounds good, call me.");
});

test("footer text in the quoted original doesn't trigger opt-out", () => {
  assert.deepEqual(classifyReply("What does it cost after the trial?" + quoted), { status: "replied", intent: "other" });
});

test("positive replies", () => {
  assert.equal(classifyReply("Yes" + quoted).intent, "positive");
  assert.equal(classifyReply("yeah, interested. what do you need from me?").intent, "positive");
});

test("opt-outs", () => {
  assert.deepEqual(classifyReply("Please remove me from your list"), { status: "opted_out", intent: "opt_out" });
  assert.equal(classifyReply("Not interested.").status, "opted_out");
  assert.equal(classifyReply("STOP").status, "opted_out");
  assert.equal(classifyReply("unsubscribe" + quoted).status, "opted_out");
});

test("auto-replies are not counted as replies", () => {
  assert.deepEqual(classifyReply("I am out of the office until Monday.", "Automatic reply: quick question"), { status: null, intent: "auto_reply" });
});

console.log("engagement + preview links");

test("engagementKind maps Resend events", () => {
  assert.equal(engagementKind("email.opened"), "opened");
  assert.equal(engagementKind("email.clicked"), "clicked");
  assert.equal(engagementKind("email.delivered"), "delivered");
  assert.equal(engagementKind("email.bounced"), null);
});

test("tagPreviewLinks tags only the preview URL", () => {
  const body = "See https://enoma.io/north-country-landscaping — or https://enoma.io/signup?utm_source=cold_email to start.";
  const out = tagPreviewLinks(body, "https://enoma.io/north-country-landscaping", ID);
  assert.ok(out.includes(`https://enoma.io/north-country-landscaping?m=${ID}`));
  assert.ok(out.includes("https://enoma.io/signup?utm_source=cold_email to start."));
});

test("tagPreviewLinks doesn't match a longer slug and appends to an existing query", () => {
  const body = "https://enoma.io/cb-landscaping-two and https://enoma.io/cb-landscaping?x=1.";
  const out = tagPreviewLinks(body, "https://enoma.io/cb-landscaping", ID);
  assert.ok(out.startsWith("https://enoma.io/cb-landscaping-two and"));
  assert.ok(out.includes(`https://enoma.io/cb-landscaping?x=1&m=${ID}`));
});

test("looksLikeBot", () => {
  assert.equal(looksLikeBot("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148"), false);
  assert.equal(looksLikeBot("Mozilla/5.0 (compatible; Googlebot/2.1)"), true);
  assert.equal(looksLikeBot(""), true);
});

console.log(`\n${passed} passed`);
