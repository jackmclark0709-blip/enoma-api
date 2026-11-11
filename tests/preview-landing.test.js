// Run with: node tests/preview-landing.test.js (also wired into `npm test`)

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { detectCallouts, workingPoints, validateContactRequest, buildContactAlert, renderLanding, MAX_CALLOUTS, instantPreviewPath, landingSource } from "../api/_lib/preview-landing.js";
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
await test("the logo note offers the three starter logos", () => {
  const c = detectCallouts({ ...full, logo_url: null }, { spotlightCount: 2 }).find(x => x.key === "logo");
  assert.equal(c.body, "You don't have a logo yet, so I made you a simple starter one. Pick from three, or send me yours (a photo of your truck works too).");
  assert.ok(!/\$\d/.test(c.body), "no price");
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

await test("no copy says the page was built from the Google listing", () => {
  assert.doesNotMatch(html, /Google listing/);
  assert.doesNotMatch(html, /I built this/);
  for (const c of detectCallouts(thin)) assert.doesNotMatch(c.body, /Google listing/, c.key);
  for (const w of workingPoints({ ...thin, website: "https://x" })) assert.doesNotMatch(w, /Google listing/);
});

console.log("renderLanding src=instant");
const instant = renderLanding(thin, { slug: "robbins-plumbing", src: "instant", callouts: detectCallouts(thin), working: workingPoints(thin) });
const visible = h => h.replace(/<style>[\s\S]*?<\/style>|<script>[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ");
await test("headline is in the visitor's voice, not Jack's greeting", () => {
  assert.match(instant, /<h1>Here's your page, Robbins Plumbing<\/h1>/);
  assert.match(instant, /live as a preview/);
  assert.doesNotMatch(visible(instant), /Hi, it&#039;s Jack|Hi, it's Jack|I built/);
});
await test("never mentions the Google listing", () => {
  assert.doesNotMatch(instant, /Google listing/);
});
await test("price sits with every 'free' (lede and the catch)", () => {
  assert.match(instant, /Keep it free for a month, then \$19\.99\/month or \$199\/year/);
  assert.match(instant, /\$19\.99<\/b><span>a month after the free month, or \$199\/year/);
});
await test("keeps the callouts, the catch and all three contact buttons", () => {
  assert.match(instant, /class="note"/);
  assert.match(instant, /What's the catch\?/);
  for (const b of ["Email me", "Text me", "Book 10 minutes"]) assert.ok(instant.includes(b), b);
});
await test("Keep this page claims without m; contact taps carry src=instant", () => {
  assert.match(instant, /href="\/robbins-plumbing\?claim=1"/);
  assert.match(instant, /var ctx = \{"slug":"robbins-plumbing","m":null,"src":"instant"\}/);
});
await test("a cold-email visit with m stays a cold-email visit", () => {
  const cold = renderLanding(thin, { slug: "robbins-plumbing", m: M, src: "instant", callouts: [], working: [] });
  assert.match(cold, /Here's a preview of your page/);
  assert.match(cold, /"src":null/);
});
await test("instant copy follows the house copy rules", () => {
  assert.deepEqual(bannedWordsIn(visible(instant)), []);
});

console.log("landingSource / instantPreviewPath");
await test("only 'instant' without a valid m counts", () => {
  assert.equal(landingSource({ src: "instant" }), "instant");
  assert.equal(landingSource({ src: "instant", m: M }), null);
  assert.equal(landingSource({ src: "instant", m: "junk" }), "instant");
  assert.equal(landingSource({ src: "<script>" }), null);
  assert.equal(landingSource({}), null);
});
await test("redirect target is the preview landing with src=instant", () => {
  assert.equal(instantPreviewPath("robbins-plumbing"), "/robbins-plumbing/preview?src=instant");
});
await test("contact requests keep src=instant only without m, and the alert says so", () => {
  const r = validateContactRequest({ kind: "email", slug: "robbins-plumbing", src: "instant" });
  assert.equal(r.ok, true);
  assert.equal(r.m, null);
  assert.equal(r.src, "instant");
  assert.equal(validateContactRequest({ kind: "email", slug: "a", m: M, src: "instant" }).src, null);
  const a = buildContactAlert({ ...r, businessName: "Robbins Plumbing" });
  assert.match(a.text, /src=instant/);
  assert.doesNotMatch(buildContactAlert({ kind: "email", slug: "r" }).text, /src=instant/);
});

console.log("/get-your-website copy");
const gyw = readFileSync(new URL("../public/get-your-website.html", import.meta.url), "utf8");
await test("sends a built instant preview to the landing, using the same path", () => {
  assert.ok(gyw.includes("'/' + encodeURIComponent(data.slug) + '/preview?src=instant'"));
  assert.ok(!gyw.includes("'?new=1'"));
  assert.equal(instantPreviewPath("x"), "/" + "x" + "/preview?src=instant");
});
await test("names no customer and has no example iframe", () => {
  assert.doesNotMatch(gyw, /conway/i);
  assert.doesNotMatch(gyw, /browser-mini/);
});
await test("no 'from your listing' copy, one speed claim", () => {
  assert.doesNotMatch(gyw, /from your (Google )?listing/i);
  assert.doesNotMatch(gyw, /under 5 minutes|20 seconds/);
  assert.match(gyw, /Type in your business name and see your page in about 30 seconds/);
  assert.match(gyw, /Not on Google yet, or your info is out of date\? I'll build it with you\./);
});
await test("price shows next to the free month in the form header", () => {
  assert.match(gyw, /Free for a month — no credit card · \$19\.99\/month after the free month/);
});
await test("logs place_search_used once per page", () => {
  assert.equal((gyw.match(/enomaTrack\('place_search_used'/g) || []).length, 1);
  assert.match(gyw, /if \(!searchLogged\) \{ searchLogged = true;/);
});

console.log(`\n${passed} passed`);
