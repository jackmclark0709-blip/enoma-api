// Run with: node tests/text-outreach.test.js (also wired into `npm test`)

process.env.UNSUBSCRIBE_SECRET = "test-secret-do-not-use-in-prod";

import assert from "node:assert/strict";
import {
  normalizeUsPhone, assessPageQuality, assessRenderedPage, buildTextMessage, smsLink, shortName,
  buildTextMarkToken, verifyTextMarkToken, buildTextBatchEmail,
} from "../api/_lib/text-outreach.js";

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (err) { console.error(`FAIL: ${name}`); throw err; }
}

const goodPage = {
  business_name: "Grillo Plumbing, Inc.", is_public: true, is_claimed: false,
  average_rating: 5, review_count: 106, phone: "+1 508-298-5042",
  hero_tagline: "Up-front pricing and certified technicians for MetroWest homes.",
  about: "x".repeat(250),
  faqs: [{ q: "a" }, { q: "b" }, { q: "c" }],
  services: [
    { service_name: "Toilet, Faucet & Shower Repair", service_description: "Repairs and replacements for toilets, faucets, tub and shower trim." },
    { service_name: "Water Heaters", service_description: "Gas and electric water heater installs, same week in most cases." },
    { service_name: "Drain Cleaning", service_description: "Clogged kitchen, bath and main lines cleared and camera-inspected." },
  ],
};

test("normalizes US phones and rejects junk", () => {
  assert.equal(normalizeUsPhone("+1 508-761-7399"), "+15087617399");
  assert.equal(normalizeUsPhone("(508) 761-7399"), "+15087617399");
  assert.equal(normalizeUsPhone("761-7399"), null);
  assert.equal(normalizeUsPhone("(508) 555-1234"), null);
  assert.equal(normalizeUsPhone(null), null);
});

test("a strong page passes the quality gate", () => {
  const q = assessPageQuality(goodPage);
  assert.deepEqual(q, { ok: true, reasons: [] });
});

test("the thin one-service landscaping pages fail", () => {
  const thin = {
    ...goodPage, average_rating: null, review_count: null, about: "x".repeat(126), hero_tagline: "Attleboro Landscaping",
    faqs: [{ q: "a" }],
    services: [{ service_name: "Landscaping & Lawn Care", service_description: "General landscaping and property maintenance services." }],
  };
  const q = assessPageQuality(thin);
  assert.equal(q.ok, false);
  for (const r of ["rating_below_4.5_or_under_10_reviews", "fewer_than_3_services", "about_too_short", "tagline_too_short", "fewer_than_2_faqs"]) {
    assert.ok(q.reasons.includes(r), r);
  }
});

test("an empty or generic service description fails", () => {
  const q1 = assessPageQuality({ ...goodPage, services: [...goodPage.services, { service_name: "Electrical", service_description: "" }] });
  assert.ok(q1.reasons.includes("service_missing_or_generic_description"));
  const q2 = assessPageQuality({ ...goodPage, services: [...goodPage.services, { service_name: "Misc", service_description: "General electrical services for residential and commercial." }] });
  assert.ok(q2.reasons.includes("service_missing_or_generic_description"));
});

test("test pages, claimed pages and thin ratings never pass", () => {
  assert.ok(assessPageQuality({ ...goodPage, business_name: "ENOMA QC TEST — safe to delete" }).reasons.includes("test_page"));
  assert.ok(assessPageQuality({ ...goodPage, is_claimed: true }).reasons.includes("already_claimed"));
  assert.ok(assessPageQuality({ ...goodPage, review_count: 6 }).reasons.includes("rating_below_4.5_or_under_10_reviews"));
  assert.deepEqual(assessPageQuality(null), { ok: false, reasons: ["no_page"] });
});

test("rendered-page check catches inactive pages, errors and wrong pages", () => {
  assert.ok(assessRenderedPage({ status: 200, html: "<h1>Grillo Plumbing</h1>", businessName: "Grillo Plumbing, Inc." }).ok);
  assert.ok(assessRenderedPage({ status: 200, html: "<h1>K&amp;T Landscaping</h1>", businessName: "K&T Landscaping" }).ok);
  assert.ok(assessRenderedPage({ status: 200, html: "This website is currently inactive Grillo Plumbing", businessName: "Grillo Plumbing" }).reasons.includes("page_shows_inactive"));
  assert.ok(assessRenderedPage({ status: 404, html: "Not found", businessName: "Grillo Plumbing" }).reasons.includes("page_status_404"));
  assert.ok(assessRenderedPage({ status: 200, html: "<h1>Someone Else</h1>", businessName: "Grillo Plumbing" }).reasons.includes("page_missing_business_name"));
});

test("text names Jack and Enoma, carries the link, offers STOP, never quotes a price", () => {
  for (const id of ["a", "b", "c", "d", "e", "f"]) {
    const t = buildTextMessage({ id, businessName: "Grillo Plumbing, Inc.", previewUrl: "https://enoma.io/grillo-plumbing", rating: 5, reviewCount: 106 });
    assert.match(t, /Jack Clark/);
    assert.match(t, /Enoma/);
    assert.ok(t.includes("https://enoma.io/grillo-plumbing"));
    assert.match(t, /STOP/);
    assert.doesNotMatch(t, /\$\d/);
    assert.doesNotMatch(t, /Inc\./);
    assert.ok(t.length < 320, `too long: ${t.length}`);
  }
});

test("same prospect always gets the same wording", () => {
  const a = buildTextMessage({ id: "x1", businessName: "A", previewUrl: "u", reviewCount: 20 });
  assert.equal(a, buildTextMessage({ id: "x1", businessName: "A", previewUrl: "u", reviewCount: 20 }));
});

test("shortName drops company suffixes", () => {
  assert.equal(shortName("Grillo Plumbing, Inc."), "Grillo Plumbing");
  assert.equal(shortName("Landry Landscaping LLC"), "Landry Landscaping");
});

test("sms link carries number and encoded body", () => {
  const l = smsLink("+15087617399", "Hi & bye\nnow");
  assert.equal(l, "sms:+15087617399?&body=Hi%20%26%20bye%0Anow");
});

test("mark tokens verify only for the same prospect and mark", () => {
  const t = buildTextMarkToken("p1", "sent");
  assert.ok(verifyTextMarkToken("p1", "sent", t));
  assert.ok(!verifyTextMarkToken("p2", "sent", t));
  assert.ok(!verifyTextMarkToken("p1", "skip", t));
  assert.ok(!verifyTextMarkToken("p1", "delete", t));
  assert.ok(!verifyTextMarkToken("p1", "sent", "nope"));
});

test("batch email lists each text with its buttons, and escapes names", () => {
  const items = [{
    id: "p1", businessName: "K&T <Landscaping>", trade: "landscaping", city: "Norton", phone: "+1 774-265-2527",
    phoneE164: "+17742652527", previewUrl: "https://enoma.io/kt", rating: 4.9, reviewCount: 40, body: "Hi there", reminder: true,
  }];
  const e = buildTextBatchEmail(items, { dateLabel: "Tue Oct 13" });
  assert.equal(e.subject, "1 text ready to send · Tue Oct 13");
  assert.ok(e.html.includes("K&amp;T &lt;Landscaping&gt;"));
  assert.ok(e.html.includes("sms:+17742652527"));
  assert.ok(e.html.includes("mark=sent"));
  assert.ok(e.html.includes("mark=opted_out"));
  assert.ok(e.html.includes("not marked yet"));
  assert.equal(buildTextBatchEmail([], {}).subject, "No texts today");
});

console.log(`text-outreach: ${passed} tests passed`);
