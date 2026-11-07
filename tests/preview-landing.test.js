// Run with: node tests/preview-landing.test.js (also wired into `npm test`)

import assert from "node:assert/strict";
import { detectCallouts, workingPoints, validateContactRequest, buildContactAlert, renderLanding, MAX_CALLOUTS } from "../api/_lib/preview-landing.js";
import { bannedWordsIn } from "../api/_lib/copy-lint.js";

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

// Shaped like the real unclaimed previews (Nov 2026): no photos, no logo,
// one town, 3 Google reviews shown out of many.
const thin = {
  business_name: "Robbins Plumbing", phone: "(555) 010-0002", city: "Gilbert", state: "AZ",
  services: [{ service_name: "Drain cleaning" }, { service_name: "Water heaters" }],
  service_area: ["Gilbert"], testimonials: [{}, {}, {}], average_rating: 5, review_count: 110,
  why_choose_us: ["Licensed and Insured", "Free estimates"], attachments: [], logo_url: null
};
const full = {
  ...thin, logo_url: "https://x/logo.png",
  attachments: ["https://x/job1.jpg", "https://x/job2.jpg"], attachment_kinds: {},
  services: [{ service_name: "A" }, { service_name: "B" }, { service_name: "C" }],
  service_area: ["Gilbert", "Mesa", "Chandler"], testimonials: [{}, {}, {}, {}, {}], review_count: 5,
  why_choose_us: ["17 years of plumbing experience"], hero_response_time: "Same day"
};
const keys = cs => cs.map(c => c.key);

console.log("detectCallouts");
await test("a thin preview gets notes for what's actually missing, photos first", () => {
  const k = keys(detectCallouts(thin));
  assert.equal(k[0], "photos");
  for (const want of ["reviews", "services", "service_pages", "towns", "numbers"]) assert.ok(k.includes(want), want);
  assert.ok(k.length <= MAX_CALLOUTS);
});
await test("says how many reviews are shown out of how many", () => {
  const r = detectCallouts(thin).find(c => c.key === "reviews");
  assert.match(r.title, /110 Google reviews/);
  assert.match(r.body, /shows 3/);
});
await test("a fuller page gets fewer notes, none for what it already has", () => {
  const k = keys(detectCallouts(full, { spotlightCount: 2 }));
  for (const gone of ["photos", "reviews", "towns", "numbers", "logo", "service_pages", "response_time"]) assert.ok(!k.includes(gone), gone);
  assert.deepEqual(k, ["services"]);
});
await test("years in the copy count as numbers; then it asks for response time", () => {
  const k = keys(detectCallouts({ ...thin, why_choose_us: ["Over 20 years experience"] }));
  assert.ok(!k.includes("numbers"));
  assert.ok(k.includes("response_time") || k.length === MAX_CALLOUTS);
});
await test("fewer than 3 services asks for the rest", () => {
  const s = detectCallouts({ ...thin, services: [{ service_name: "One" }] }).find(c => c.key === "services");
  assert.match(s.title, /rest of your services/);
  assert.match(s.body, /one service/);
});
await test("no phone is called out", () => {
  assert.ok(keys(detectCallouts({ ...full, phone: null }, { spotlightCount: 1 })).includes("phone"));
});
await test("notes follow the house copy rules", () => {
  for (const c of detectCallouts(thin)) assert.deepEqual(bannedWordsIn(`${c.title} ${c.body}`), [], c.key);
});

console.log("workingPoints");
await test("leads with what works, and only claims a strong rating", () => {
  const w = workingPoints(thin);
  assert.match(w[0], /tap-to-call/);
  assert.ok(w.some(x => /5★ rating from 110/.test(x)));
  assert.ok(!workingPoints({ ...thin, average_rating: 4.1 }).some(x => /★/.test(x)));
});

console.log("validateContactRequest");
const M = "3f2b8c1e-9d4a-4b6e-8f1a-2c3d4e5f6a7b";
await test("email needs only a kind and slug", () => {
  const r = validateContactRequest({ kind: "email", slug: "robbins-plumbing", m: M });
  assert.equal(r.ok, true);
  assert.equal(r.m, M);
});
await test("text and book need a real 10-digit phone, normalized", () => {
  assert.equal(validateContactRequest({ kind: "text", slug: "a", phone: "555-1234" }).error, "bad_phone");
  assert.equal(validateContactRequest({ kind: "text", slug: "a", phone: "+1 (555) 010-0002" }).phone, "(555) 010-0002");
});
await test("book needs an allowed day and window", () => {
  assert.equal(validateContactRequest({ kind: "book", slug: "a", phone: "5550100002", day: "someday", window: "morning" }).error, "bad_day");
  const ok = validateContactRequest({ kind: "book", slug: "a", phone: "5550100002", day: "tomorrow", window: "evening" });
  assert.equal(ok.ok, true);
});
await test("rejects bad kinds, odd slugs, junk m, and trims notes", () => {
  assert.equal(validateContactRequest({ kind: "call", slug: "a" }).error, "bad_kind");
  assert.equal(validateContactRequest({ kind: "email", slug: "../etc" }).error, "bad_slug");
  assert.equal(validateContactRequest({ kind: "email", slug: "a", m: "x" }).m, null);
  assert.equal(validateContactRequest({ kind: "email", slug: "a", note: "x".repeat(500) }).note.length, 300);
});

console.log("buildContactAlert");
await test("book alert says when and where to call", () => {
  const a = buildContactAlert({ kind: "book", businessName: "Robbins Plumbing", city: "Gilbert", state: "AZ", phone: "(555) 010-0002", day: "tomorrow", window: "evening", slug: "robbins-plumbing" });
  assert.equal(a.subject, "Robbins Plumbing booked 10 minutes: Tomorrow, evening, at (555) 010-0002");
  assert.match(a.text, /Call them in that window/);
});
await test("text alert notes it's opt-in; notes are escaped in HTML", () => {
  const a = buildContactAlert({ kind: "text", businessName: "R", phone: "(555) 010-0002", note: "<b>hi</b>", slug: "r" });
  assert.match(a.text, /asked for it/);
  assert.doesNotMatch(a.html, /<b>hi/);
});

console.log("renderLanding");
const html = renderLanding({ ...thin, business_name: "Robbins <Plumbing>" }, { slug: "robbins-plumbing", m: M, callouts: detectCallouts(thin), working: workingPoints(thin) });
await test("has every section in order", () => {
  const order = ["Here's a preview of your page", "Built to be found", "What I'd add with you", "What's the catch?", "Talk to Jack"].map(s => html.indexOf(s.replace("'", "&#039;")) >= 0 ? html.indexOf(s.replace("'", "&#039;")) : html.indexOf(s));
  order.forEach((i, n) => assert.ok(i > 0, `section ${n} missing`));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});
await test("shows the price and the three contact buttons", () => {
  assert.match(html, /\$19\.99/);
  assert.match(html, /first month is free/);
  assert.match(html, /Email me/);
  assert.match(html, /Text me/);
  assert.match(html, /Book 10 minutes/);
});
await test("embeds the page without logging a page view, and keeps m on claim", () => {
  assert.match(html, /src="\/robbins-plumbing\?embed=1"/);
  assert.match(html, new RegExp(`robbins-plumbing\\?claim=1&amp;m=${M}`));
});
await test("escapes the business name and stays out of search", () => {
  assert.doesNotMatch(html, /Robbins <Plumbing>/);
  assert.match(html, /noindex/);
});
await test("page copy follows the house copy rules", () => {
  const text = html.replace(/<style>[\s\S]*?<\/style>|<script>[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ");
  assert.deepEqual(bannedWordsIn(text), []);
});

console.log(`\n${passed} passed`);
