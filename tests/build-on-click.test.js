// Example arm: per-trade example pages in the email, the prospect's own page
// built only when they click (api/_lib/example-pages.js, example-outreach.js,
// api/ga-metrics.js build_page/build_start/build_status).
import assert from "node:assert/strict";
import fs from "node:fs";
import { EXAMPLE_PAGES, exampleForTrade, exampleUrl, outreachArmFor, exampleArmEligible } from "../api/_lib/example-pages.js";
import { buildExampleIntro, buildExampleEmail, buildExampleFollowUpEmail, buildExampleSecondFollowUpEmail, exampleLinks, buildPageHtml, EXAMPLE_VARIANT } from "../api/_lib/example-outreach.js";
import { OUTREACH_CLICK_EVENTS } from "../api/_lib/traffic-classifier.js";

let passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log(`  ok - ${name}`); } catch (e) { console.log(`  FAIL - ${name}`); console.error(e); process.exitCode = 1; } }
const read = rel => fs.readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const src = read("api/ga-metrics.js");
const MID = "11111111-2222-4333-8444-555555555555";

await test("trades: every prospect trade we pull maps to an example", () => {
  const trades = ["landscaping", "plumber", "general contractor", "electrician", "house cleaning service", "painting contractor", "painter", "roofing contractor", "hvac contractor"];
  const keys = trades.map(t => exampleForTrade(t)?.key);
  assert.deepEqual(keys, ["landscaping", "plumbing", "contractor", "electrical", "cleaning", "painting", "painting", "roofing", "hvac"]);
  assert.equal(exampleForTrade("Biotechnology research services"), null);
  assert.equal(exampleUrl(EXAMPLE_PAGES.roofing), "https://enoma.io/examples/roofing.html");
});

await test("arm split: deterministic, 0 = all personal, 100 = all example, 50 about half", () => {
  const ids = Array.from({ length: 2000 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
  assert.ok(ids.every(id => outreachArmFor(id, undefined) === "personal"));
  assert.ok(ids.every(id => outreachArmFor(id, "100") === "example"));
  const half = ids.filter(id => outreachArmFor(id, "50") === "example").length;
  assert.ok(half > 850 && half < 1150, `got ${half}`);
  assert.equal(outreachArmFor(ids[7], "50"), outreachArmFor(ids[7], "50"));
  assert.equal(exampleArmEligible({ trade: "plumber" }), true);
  assert.equal(exampleArmEligible({ trade: "plumber", preview_url: "https://enoma.io/x" }), false);
  assert.equal(exampleArmEligible({ trade: "Services" }), false);
});

await test("email: example + build links through action=go, honest about the sample, no up-front page claim", () => {
  const intro = buildExampleIntro({ business_name: "Acme Roofing LLC", trade: "roofing contractor", website: null });
  assert.match(intro.subject, /^What a website for Acme Roofing could look like$/);
  assert.match(intro.body, /no website|doesn't link to a website/);
  assert.match(intro.body, /it's a sample business/);
  const e = buildExampleEmail({ intro: intro.body, businessName: "Acme Roofing LLC", trade: "roofing contractor", messageId: MID, unsubscribeUrl: "https://enoma.io/u", mailingAddress: "PO Box 1" });
  const L = exampleLinks(MID);
  assert.ok(e.html.includes(L.example) && e.html.includes(L.build));
  assert.ok(e.text.includes(`action=go&m=${MID}&to=build`));
  assert.match(e.html, /Build Acme Roofing&#0?39;s page/);
  assert.doesNotMatch(e.text, /I built|already generating|is generating leads/i);
  assert.match(e.text, /Unsubscribe|Don't want these emails/);
  const f1 = buildExampleFollowUpEmail({ businessName: "Acme Roofing", trade: "roofing contractor", originalSubject: intro.subject, messageId: MID, unsubscribeUrl: "u", mailingAddress: "a" });
  assert.match(f1.subject, /^Re: What a website/);
  assert.ok(f1.text.includes(L.build));
  const f2 = buildExampleSecondFollowUpEmail({ businessName: "Acme Roofing", originalSubject: intro.subject, messageId: MID, unsubscribeUrl: "u", mailingAddress: "a" });
  assert.ok(f2.text.includes(L.build) && /won't email again/.test(f2.text));
});

await test("build page: auto-starts only for people, otherwise a button; polls build_status", () => {
  const human = buildPageHtml({ messageId: MID, businessName: "Acme <b>", autoStart: true });
  const bot = buildPageHtml({ messageId: MID, businessName: "Acme", autoStart: false });
  assert.match(human, /\nstart\(\);\n/);
  assert.doesNotMatch(bot, /\nstart\(\);\n/);
  assert.match(bot, /Build my page/);
  assert.match(human, /action=build_start&m=/);
  assert.match(human, /action=build_status&m=/);
  assert.doesNotMatch(human, /Acme <b>/);
  assert.match(human, /noindex/);
});

await test("prepare: example arm drafts without building, before the v3 cap", () => {
  const build = src.slice(src.indexOf("const built = await mapWithConcurrency(toBuild"));
  const arm = build.indexOf('outreachArmFor(prospect.id, process.env.OUTREACH_EXAMPLE_SHARE) === "example" && exampleArmEligible(prospect)');
  assert.ok(arm > 0 && arm < build.indexOf("v3Left <= 0"));
  assert.ok(arm < build.indexOf("generatePreviewForProspect("));
});

await test("send: example arm goes out without a page and skips the page check; variant recorded", () => {
  const send = src.slice(src.indexOf("async function handleSendOutreach"), src.indexOf("async function handleSendOutreach") + 14000);
  assert.doesNotMatch(send, /\.not\("preview_url", "is", null\)/);
  assert.match(send, /const exampleArm = !slug && exampleArmEligible\(prospect\);/);
  assert.match(send, /if \(v3PipelineOn\(\) && !exampleArm\)/);
  assert.match(send, /variant: EXAMPLE_VARIANT, email/);
  assert.equal(EXAMPLE_VARIANT, "example");
});

await test("follow-ups: example arm without a page re-offers the build", () => {
  assert.equal((src.match(/const exampleNoPage = row\.variant === EXAMPLE_VARIANT && !slug;/g) || []).length, 2);
  assert.match(src, /exampleNoPage \? buildExampleFollowUpEmail :/);
  assert.match(src, /exampleNoPage \? buildExampleSecondFollowUpEmail :/);
});

await test("routes: build_* are public (before the cron/admin gate); build_start is POST-only, capped and claimed", () => {
  const route = src.indexOf('req.query.action === "build_page" || req.query.action === "build_start"');
  assert.ok(route > 0 && route < src.indexOf("Vercel Cron authenticates by sending Authorization"));
  const start = src.slice(src.indexOf("async function handleBuildStart"), src.indexOf("async function handleBuildStatus"));
  assert.match(start, /if \(req\.method !== "POST"\)/);
  assert.match(start, /BUILD_ON_CLICK_DAILY_MAX/);
  assert.ok(start.indexOf("BUILD_ON_CLICK_DAILY_MAX") < start.indexOf("generatePreviewForProspect("));
  assert.ok(start.indexOf('.is("preview_url", null)') < start.indexOf("generatePreviewForProspect("));
  assert.match(start, /gate: false/);
  assert.match(start, /noteOwnerBuiltPage\(/);
  assert.ok(OUTREACH_CLICK_EVENTS.has("outreach_build_click") && OUTREACH_CLICK_EVENTS.has("outreach_example_click"));
});

await test("example pages: one per trade, labeled made-up, noindex, inert, made-up 555 numbers only", () => {
  for (const key of Object.keys(EXAMPLE_PAGES)) {
    const html = read(`public/examples/${key}.html`);
    assert.match(html, /class="ex-banner"/, key);
    assert.match(html, /is a made-up business, and its reviews are samples/, key);
    assert.match(html, /noindex/, key);
    assert.match(html, new RegExp(`<link rel="canonical" href="https://enoma.io/examples/${key}.html"`), key);
    assert.match(html, /document\.addEventListener\("submit"/, key);
    const tels = [...html.matchAll(/href="tel:(\d+)"/g)].map(m => m[1]);
    assert.ok(tels.length && tels.every(t => /^508555\d{4}$/.test(t)), `${key}: ${tels}`);
    assert.ok((html.match(/class="ex-tag"/g) || []).length >= 6, key);
    assert.doesNotMatch(html, /googletagmanager/, key);
  }
});

console.log(`\n${passed} passed`);
