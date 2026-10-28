// Run with: node tests/outreach-email.test.js (also wired into `npm test`)

import assert from "node:assert/strict";
import { buildOutreachEmail, buildOutreachIntro, buildFollowUpEmail, isFollowUpDue, cleanBusinessName, isLikelyLinkScanner, trackedLinks, slugFromPreviewUrl, replyToFor, messageIdFromReplyAddress, classifyReplyIntent, isUuid } from "../api/_lib/outreach-email.js";
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
  assert.equal(l.claimDest, `https://enoma.io/cb-landscaping?claim=1&m=${ID}`);
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
await test("one link only: the tracked page link (plus unsubscribe)", () => {
  const links = [...email.html.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(links, [`https://enoma.io/api/ga-metrics?action=go&m=${ID}&to=page`, "https://enoma.io/api/ga-metrics?action=unsubscribe&email=a%40b.com&token=t"]);
  assert.ok(!/<img/i.test(email.html), "no images");
  assert.ok(!/to=claim|feedback\?m=/.test(email.html + email.text), "no claim or vote links");
});
await test("HTML has the reply ask with price and the CAN-SPAM footer", () => {
  assert.match(email.html, /reply <strong>yes<\/strong>/);
  assert.match(email.html, /\$19\.99\/month, no contract/);
  assert.match(email.html, /183 Fairway Dr/);
  assert.match(email.html, /action=unsubscribe/);
});
await test("business name and intro are escaped", () => {
  assert.ok(!email.html.includes("<Plumbing>"));
  assert.ok(email.html.includes("Bob&#039;s &lt;Plumbing&gt;"));
});
await test("plain-text version carries the page link and the footer", () => {
  assert.ok(email.text.includes(`to=page`));
  assert.ok(!email.text.includes(`to=claim`));
  assert.match(email.text, /Don't want these emails\?/);
});

console.log("buildOutreachIntro");
await test("leads with the single strongest verified site problem", () => {
  const i = buildOutreachIntro({ business_name: "DePaolo's Painting Inc", website: "http://www.depaolospainting.com/home", site_gaps: ["Not secure (no HTTPS) — browsers warn visitors away", "No tap-to-call phone link, so mobile visitors can't call in one tap"], raw: { rating: 5, reviews: 40 } });
  assert.equal(i.subject, "I built DePaolo's Painting a new page");
  assert.match(i.body, /depaolospainting\.com on their phone, there's no button to tap and call you/);
  assert.ok(!/Not secure/.test(i.body), "only one reason");
  assert.ok(!/https?:\/\//.test(i.body), "no link in the intro");
});
await test("no website: says so", () => {
  assert.match(buildOutreachIntro({ business_name: "Bob's Plumbing", website: null, site_gaps: [] }).body, /doesn't link to a website/);
});
await test("no verified gap: falls back to a strong Google rating, then a plain line", () => {
  assert.match(buildOutreachIntro({ business_name: "A", website: "a.com", site_gaps: [], raw: { rating: 4.8, reviews: 112 } }).body, /4\.8-star rating from 112 Google reviews/);
  const plain = buildOutreachIntro({ business_name: "A", website: "a.com", site_gaps: [], raw: { rating: 4.8, reviews: 3 } });
  assert.equal(plain.reason, "generic");
});
await test("cleanBusinessName drops taglines and legal suffixes", () => {
  assert.equal(cleanBusinessName("Maynard Roofing /40 yrs Family Business"), "Maynard Roofing");
  assert.equal(cleanBusinessName("Comfort Aire Heating & Cooling Inc."), "Comfort Aire Heating & Cooling");
  assert.equal(cleanBusinessName("Alex & Son Construction llc"), "Alex & Son Construction");
  assert.equal(cleanBusinessName("Smith - Jones Electric"), "Smith - Jones Electric");
  assert.equal(cleanBusinessName("Ace Plumbing - Serving Taunton Since 1990"), "Ace Plumbing");
});

console.log("follow-up");
await test("due 3 to 10 days after sending, once, and only with no response", () => {
  const sentAt = "2026-10-20T11:00:00Z";
  const at = (d) => Date.parse(sentAt) + d * 864e5;
  assert.equal(isFollowUpDue({ sentAt, now: at(2.9) }), false);
  assert.equal(isFollowUpDue({ sentAt, now: at(3.1) }), true);
  assert.equal(isFollowUpDue({ sentAt, now: at(11) }), false);
  assert.equal(isFollowUpDue({ sentAt, now: at(4), followupSentAt: "2026-10-24T11:00:00Z" }), false);
  for (const r of ["replied", "bounced", "opted_out", "claimed"]) assert.equal(isFollowUpDue({ sentAt, now: at(4), responseStatus: r }), false);
});
await test("follow-up replies in the thread with the same tracked page link", () => {
  const f = buildFollowUpEmail({ businessName: "DePaolo's Painting Inc", originalSubject: "I built DePaolo's Painting a new page", messageId: ID, slug: "depaolos-painting", unsubscribeUrl: "https://enoma.io/u", mailingAddress: "Enoma, 183 Fairway Dr, Attleboro, MA 02703" });
  assert.equal(f.subject, "Re: I built DePaolo's Painting a new page");
  assert.ok(f.text.includes(`action=go&m=${ID}&to=page`));
  assert.match(f.text, /Google listing/);
  assert.match(f.html, /reply|Reply/);
  assert.match(f.html, /183 Fairway Dr/);
  assert.equal(buildFollowUpEmail({ businessName: "A", originalSubject: "Re: x", messageId: ID, slug: "a", unsubscribeUrl: "u", mailingAddress: "m" }).subject, "Re: x");
});

console.log("isLikelyLinkScanner");
await test("a click within two minutes of sending is a scanner, later is a person", () => {
  const sent = "2026-10-26T11:42:14Z";
  assert.equal(isLikelyLinkScanner({ sentAt: sent, now: Date.parse("2026-10-26T11:43:08Z") }), true);
  assert.equal(isLikelyLinkScanner({ sentAt: sent, now: Date.parse("2026-10-26T14:10:00Z") }), false);
  assert.equal(isLikelyLinkScanner({ sentAt: sent, now: Date.parse("2026-10-26T14:10:00Z"), userAgent: "Mozilla/5.0 HeadlessChrome/141" }), true);
  assert.equal(isLikelyLinkScanner({ sentAt: null, now: Date.now() }), false);
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
