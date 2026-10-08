// Run with: node tests/outreach-email.test.js (also wired into `npm test`)

import assert from "node:assert/strict";
import { buildOutreachEmail, trackedLinks, slugFromPreviewUrl, replyToFor, messageIdFromReplyAddress, classifyReplyIntent, isUuid } from "../api/_lib/outreach-email.js";
import { decisionForStatus, verifyMailbox } from "../api/_lib/mailbox-verify.js";

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

console.log("slugFromPreviewUrl");
await test("reads the slug from our own preview URL", () => {
  assert.equal(slugFromPreviewUrl("https://enoma.io/arno-plumbing-and-heating"), "arno-plumbing-and-heating");
  assert.equal(slugFromPreviewUrl("https://enoma.io/tavares-landscaping/"), "tavares-landscaping");
});
await test("rejects any other host, so redirects can't leave enoma.io", () => {
  assert.equal(slugFromPreviewUrl("https://evil.com/x"), null);
  assert.equal(slugFromPreviewUrl("https://enoma.io.evil.com/x"), null);
  assert.equal(slugFromPreviewUrl(null), null);
});

console.log("trackedLinks");
await test("links go through the go redirect with the message id", () => {
  const l = trackedLinks(ID, "cb-landscaping");
  assert.equal(l.page, `https://enoma.io/api/ga-metrics?action=go&m=${ID}&to=page`);
  assert.equal(l.claim, `https://enoma.io/api/ga-metrics?action=go&m=${ID}&to=claim`);
  assert.equal(l.claimDest, `https://enoma.io/claim?business=cb-landscaping&m=${ID}`);
  assert.equal(l.pageDest, `https://enoma.io/cb-landscaping?m=${ID}`);
});

console.log("buildOutreachEmail");
const email = buildOutreachEmail({
  intro: "Hi there,\n\nI'm Jack. I built Bob's <Plumbing> a new page.",
  businessName: "Bob's <Plumbing>",
  messageId: ID,
  slug: "bobs-plumbing",
  unsubscribeUrl: "https://enoma.io/api/ga-metrics?action=unsubscribe&email=a%40b.com&token=t",
  mailingAddress: "Enoma, 183 Fairway Dr, Attleboro, MA 02703"
});
await test("HTML has the page card, the Claim my free page button and the reply line", () => {
  assert.match(email.html, /Claim my free page/);
  assert.match(email.html, /reply <strong>yes<\/strong>/);
  assert.ok(email.html.includes(`action=go&m=${ID}&to=claim`));
  assert.ok(email.html.includes(`action=go&m=${ID}&to=page`));
  assert.ok(email.html.includes("/api/p?og=1&slug=bobs-plumbing"));
});
await test("HTML keeps the CAN-SPAM address and unsubscribe link", () => {
  assert.match(email.html, /183 Fairway Dr/);
  assert.match(email.html, /action=unsubscribe/);
});
await test("business name and intro are escaped", () => {
  assert.ok(!email.html.includes("<Plumbing>"));
  assert.ok(email.html.includes("Bob&#039;s &lt;Plumbing&gt;"));
});
await test("plain-text version carries both tracked links and the footer", () => {
  assert.ok(email.text.includes(`to=page`));
  assert.ok(email.text.includes(`to=claim`));
  assert.match(email.text, /Don't want these emails\?/);
});

console.log("reply routing");
await test("Reply-To stays jack@enoma.io until capture is switched on", () => {
  assert.equal(replyToFor(ID, {}), "jack@enoma.io");
  assert.equal(replyToFor(ID, { captureReplies: true }), `reply+${ID}@mail.enoma.io`);
});
await test("message id is recovered from the reply address", () => {
  assert.equal(messageIdFromReplyAddress([`Jack <reply+${ID}@mail.enoma.io>`]), ID);
  assert.equal(messageIdFromReplyAddress(["jack@enoma.io"]), null);
  assert.ok(isUuid(ID));
});

console.log("classifyReplyIntent");
await test("yes / interested replies are positive", () => {
  assert.equal(classifyReplyIntent({ text: "Yes please\n\nOn Mon, Jack wrote:\n> reply no" }), "positive");
  assert.equal(classifyReplyIntent({ text: "Sure, how do I get started?" }), "positive");
});
await test("opt-outs win, even when the quoted email says yes", () => {
  assert.equal(classifyReplyIntent({ text: "no thanks" }), "opt_out");
  assert.equal(classifyReplyIntent({ text: "Please remove me from your list" }), "opt_out");
});
await test("out-of-office replies are auto_reply", () => {
  assert.equal(classifyReplyIntent({ subject: "Out of Office", text: "I'm away" }), "auto_reply");
  assert.equal(classifyReplyIntent({ text: "hi", headers: { "auto-submitted": "auto-replied" } }), "auto_reply");
});

console.log("mailbox verification");
await test("ZeroBounce statuses map to send / drop / retry", () => {
  assert.equal(decisionForStatus("valid"), "send");
  assert.equal(decisionForStatus("catch-all"), "send_catch_all");
  for (const s of ["invalid", "spamtrap", "abuse", "do_not_mail"]) assert.equal(decisionForStatus(s), "drop");
  assert.equal(decisionForStatus("unknown"), "retry");
});
await test("no API key means unverified, never a silent pass", async () => {
  assert.equal((await verifyMailbox("a@b.com", { apiKey: "" })).decision, "unverified");
});
await test("API errors and timeouts become retry", async () => {
  const bad = async () => ({ ok: true, json: async () => ({ error: "Invalid API key" }) });
  assert.equal((await verifyMailbox("a@b.com", { apiKey: "k", fetchImpl: bad })).decision, "retry");
  const boom = async () => { throw Object.assign(new Error("t"), { name: "TimeoutError" }); };
  assert.equal((await verifyMailbox("a@b.com", { apiKey: "k", fetchImpl: boom })).sub_status, "timeout");
});
await test("a valid response passes through", async () => {
  const ok = async () => ({ ok: true, json: async () => ({ status: "valid", sub_status: "" }) });
  assert.equal((await verifyMailbox("a@b.com", { apiKey: "k", fetchImpl: ok })).decision, "send");
});

console.log(`\n${passed} passed`);
