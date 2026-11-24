// Run with: node tests/pipeline-fixes.test.js (also wired into `npm test`)
// Outreach pipeline fixes after the first v3 days (Nov 20-23, 2026):
//   - franchise dealers are skipped (api/_lib/prospect-filters.js)
//   - optional OUTREACH_STATES allowlist
//   - failed page builds are recorded on the prospect, give back their daily
//     slot, and stop after 3 tries (api/_lib/build-errors.js)
//   - v3 builds run one at a time
// The handler wiring in api/ga-metrics.js is checked in source, like
// tests/v3-pipeline.test.js, since it needs live Supabase.

import assert from "node:assert/strict";
import fs from "node:fs";
import { isFranchiseDealer, parseStateAllowlist, stateAllowed, stateQueryValues, stateCodeOf, outreachExclusion } from "../api/_lib/prospect-filters.js";
import { noteBuildFailure, noteNotReady, BUILD_MAX_ATTEMPTS, errorMessage } from "../api/_lib/build-errors.js";

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { console.error(`  FAIL - ${name}`); console.error(err); process.exitCode = 1; }
}
const src = fs.readFileSync(new URL("../api/ga-metrics.js", import.meta.url), "utf8");
const slice = (from, len = 4000) => { const i = src.indexOf(from); assert.ok(i >= 0, `missing: ${from}`); return src.slice(i, i + len); };

await test("franchise: brand names are caught, local businesses aren't", () => {
  for (const name of ["Roof Maxx of Lafayette, LA", "Mr. Rooter Plumbing of Providence", "Mr Electric of Cranston",
    "One Hour Air Conditioning and Heating", "Molly Maid of Greater Attleboro", "CertaPro Painters of Boston",
    "Benjamin Franklin Plumbing", "Chem-Dry of the South Coast", "SERVPRO of Taunton"]) {
    assert.equal(isFranchiseDealer({ business_name: name }), true, name);
  }
  for (const name of ["Ferreira Company", "JMH Mechanical LLC", "Maxx Roofing", "Rooter Brothers Plumbing",
    "Five Star Roofing & Gutters", "Meticulous Painting", "The Maidstone Group", "Hourly Handyman"]) {
    assert.equal(isFranchiseDealer({ business_name: name }), false, name);
  }
});

await test("franchise: a dealer-locator website marks a dealer; a locations page doesn't", () => {
  assert.equal(isFranchiseDealer({ business_name: "Gutter Pros", website: "https://brand.com/find-a-dealer/louisiana/lafayette/" }), true);
  assert.equal(isFranchiseDealer({ business_name: "Gutter Pros", website: "https://brand.com/dealers/ri/" }), true);
  assert.equal(isFranchiseDealer({ business_name: "Gutter Pros", website: "https://gutterpros.com/locations/attleboro/" }), false);
  assert.equal(isFranchiseDealer({ business_name: "Gutter Pros", website: "not a url" }), false);
});

await test("states: allowlist parsing ignores junk and never blocks everything by typo", () => {
  assert.equal(parseStateAllowlist(""), null);
  assert.equal(parseStateAllowlist(undefined), null);
  assert.equal(parseStateAllowlist("xx, zz"), null);
  assert.deepEqual([...parseStateAllowlist("ma, RI,Connecticut, zz")], ["MA", "RI", "CT"]);
  assert.equal(stateCodeOf("Rhode Island"), "RI");
  assert.equal(stateCodeOf("XX"), "");
});

await test("states: prospects are matched by code or full name", () => {
  const allow = parseStateAllowlist("MA,RI");
  assert.equal(stateAllowed({ state: "Massachusetts" }, allow), true);
  assert.equal(stateAllowed({ state: "RI" }, allow), true);
  assert.equal(stateAllowed({ state: "Louisiana" }, allow), false);
  assert.equal(stateAllowed({ state: null }, allow), false);
  assert.equal(stateAllowed({ state: "Louisiana" }, null), true);
  assert.deepEqual(stateQueryValues(allow), ["MA", "Massachusetts", "RI", "Rhode Island"]);
  assert.equal(stateQueryValues(null), null);
  assert.equal(outreachExclusion({ business_name: "Roof Maxx", state: "MA" }, {}), "franchise_dealer");
  assert.equal(outreachExclusion({ business_name: "Acme", state: "Texas" }, { OUTREACH_STATES: "MA" }), "out_of_area");
  assert.equal(outreachExclusion({ business_name: "Acme", state: "Texas" }, {}), null);
});

await test("build errors: attempts count up, keep the rest of raw, give up at 3", () => {
  const raw = { name: "JMH Mechanical", reviews: 40 };
  const err = Object.assign(new Error("OpenAI error: {\n \"error\": \"Rate limit reached\" }"), { code: "ai_request_failed" });
  const one = noteBuildFailure(raw, err, new Date("2026-11-23T12:00:00Z"));
  assert.equal(one.raw.name, "JMH Mechanical");
  assert.equal(one.raw.reviews, 40);
  assert.deepEqual(one.raw.enoma_build, { attempts: 1, last_error: "OpenAI error: { \"error\": \"Rate limit reached\" }", last_code: "ai_request_failed", last_at: "2026-11-23T12:00:00.000Z" });
  assert.equal(one.giveUp, false);
  const two = noteBuildFailure(one.raw, new Error("x"));
  const three = noteBuildFailure(two.raw, "plain string");
  assert.equal(three.attempts, BUILD_MAX_ATTEMPTS);
  assert.equal(three.giveUp, true);
  assert.equal(three.raw.enoma_build.last_error, "plain string");
  assert.equal(noteBuildFailure(null, new Error("y")).raw.enoma_build.attempts, 1);
  assert.equal(errorMessage(new Error("a".repeat(500))).length, 300);
});

await test("not ready: reasons are kept on raw", () => {
  const raw = noteNotReady({ a: 1 }, ["thin_proof", "few_review_quotes"], new Date("2026-11-23T00:00:00Z"));
  assert.deepEqual(raw, { a: 1, enoma_ready: { reasons: ["thin_proof", "few_review_quotes"], at: "2026-11-23T00:00:00.000Z" } });
});

await test("wiring: prepare filters by state and skips franchises before paying for checks", () => {
  const q = slice("let prospectQuery = supabase", 1200);
  assert.match(q, /stateQueryValues\(parseStateAllowlist\(process\.env\.OUTREACH_STATES\)\)/);
  assert.match(q, /if \(stateValues\) prospectQuery = prospectQuery\.in\("state", stateValues\)/);
  const free = slice("// 1. Free checks.", 2500);
  const f = free.indexOf("isFranchiseDealer(prospect)");
  assert.ok(f > 0 && f < free.indexOf("classifyEmail("), "franchise check comes before the email and site checks");
  assert.match(free, /fail\(prospect, "excluded_franchise", "franchise_dealer"\)/);
});

await test("wiring: v3 builds run one at a time and failures give the slot back", () => {
  const b = slice("const buildFailed = async", 9000);
  assert.match(b, /const buildConcurrency = v3PipelineOn\(\) \? 1 : BUILD_CONCURRENCY;/);
  assert.match(b, /mapWithConcurrency\(toBuild, buildConcurrency,/);
      assert.match(b, /console\.warn\(`prepare: page build failed/);
  assert.match(b, /claimedV3 = true;/);
    assert.match(b, /if \(claimedV3\) await supabase\.from\("prospects"\)\.update\(\{ v3_queued_at: null \}\)/);
});

await test("wiring: send holds out-of-area drafts and parks franchise drafts", () => {
  const q = slice("const sendStates = ", 600);
  assert.match(q, /if \(sendStates\) q = q\.in\("state", sendStates\);/);
  const loop = slice("// Drafted before the franchise filter existed", 500);
  assert.match(loop, /status: "excluded_franchise"/);
  assert.ok(src.indexOf("// Drafted before the franchise filter existed") < src.indexOf("const ready = page ? outreachReadiness(page"), "checked before the page");
});

await test("wiring: page_not_ready keeps its reasons; parked statuses aren't re-drafted or texted", () => {
  assert.equal((src.match(/raw: noteNotReady\(/g) || []).length, 2);
  assert.match(src, /removed_by_owner,excluded_franchise\)"\)/);
  const text = fs.readFileSync(new URL("../api/_lib/text-outreach.js", import.meta.url), "utf8");
  assert.match(text, /"excluded_franchise"/);
});

await test("wiring: follow-ups and parked v3 drafts respect franchises and OUTREACH_STATES (Codex review)", () => {
  for (const fn of ["async function sendFollowUpsOnce", "async function sendSecondFollowUpsOnce"]) {
    const f = slice(fn, 3500);
    assert.match(f, /prospects\(id, business_name, email, preview_url, status, trade, state, website\)/, fn);
    assert.match(f, /const excluded = outreachExclusion\(p\);\n    if \(excluded\) \{ skip\(excluded\); continue; \}/, fn);
  }
  const fin = slice("async function finishV3Drafts", 4000);
  assert.match(fin, /if \(states\) rowsQuery = rowsQuery\.in\("state", states\);/);
  assert.ok(fin.indexOf("rowsQuery.in(") < fin.indexOf("generateDraftCopy"), "filtered before any draft");
});

await test("review 2: DC keeps its stored capitalization; a failed draft on a built page isn't parked", () => {
  assert.deepEqual(stateQueryValues(parseStateAllowlist("DC")), ["DC", "District of Columbia"]);
  const b = slice("const buildFailed = async", 9000);
  assert.match(b, /const giveUp = note\.giveUp && !pageReady;/);
  assert.match(b, /if \(claimedV3 && !pageReady\) patch\.v3_queued_at = null;/);
  assert.match(b, /if \(giveUp\) patch\.status = "no_preview";/);
  assert.ok(b.indexOf("pageReady = true;") > b.indexOf("generatePreviewForProspect(prospect"), "set once the page exists");
  assert.ok(b.indexOf("pageReady = true;") < b.indexOf("generateDraftCopy("), "before the draft is written");
  assert.match(b, /return buildFailed\(prospect, err, \{ claimedV3, mailbox, pageReady \}\);/);
});

console.log(`\n${passed} passed`);
