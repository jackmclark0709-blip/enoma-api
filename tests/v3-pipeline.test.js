// Run with: node tests/v3-pipeline.test.js (also wired into `npm test`)
// New previews on page v3: the readiness floor a page must pass before any
// outreach email shows it, and the pipeline wiring in api/ga-metrics.js
// (checked in source, like tests/outreach-*.test.js, since the handler needs
// live Supabase).

import assert from "node:assert/strict";
import fs from "node:fs";
import { outreachReadiness, READY_MIN_REVIEWS } from "../api/_lib/page-v3.js";

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { console.error(`  FAIL - ${name}`); console.error(err); process.exitCode = 1; }
}
const read = rel => fs.readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const fixture = name => JSON.parse(read(`tests/fixtures/page-v3/${name}.json`));
const clone = o => JSON.parse(JSON.stringify(o));

await test("readiness: a full page (Arno) passes", () => {
  assert.deepEqual(outreachReadiness(fixture("arno")), { ok: true, reasons: [] });
});

await test("readiness: thin pages are held back, with reasons", () => {
  const cr = outreachReadiness(fixture("c-ryan"));
  assert.equal(cr.ok, false);
  assert.ok(cr.reasons.includes("few_reviews") && cr.reasons.includes("few_services"), cr.reasons.join());
  assert.equal(outreachReadiness(fixture("let-it-roll")).ok, false);
});

await test("readiness: not v3, no copy, not public, no phone, empty card", () => {
  const v2 = clone(fixture("arno")); v2.page_version = 2;
  assert.ok(outreachReadiness(v2).reasons.includes("not_v3"));
  const none = clone(fixture("arno")); none.page_copy_v3 = null;
  assert.deepEqual(outreachReadiness(none), { ok: false, reasons: ["no_v3_copy"] });
  const hidden = clone(fixture("arno")); hidden.is_public = false;
  assert.ok(outreachReadiness(hidden).reasons.includes("not_public"));
  const nophone = clone(fixture("arno")); nophone.phone = ""; nophone.fact_sheet.business.phone = "";
  assert.ok(outreachReadiness(nophone).reasons.includes("no_phone"));
  const empty = clone(fixture("arno")); empty.page_copy_v3.services[1].description = ""; empty.page_copy_v3.service_page = null;
  assert.ok(outreachReadiness(empty).reasons.includes("empty_service_card"));
  const few = clone(fixture("arno")); few.fact_sheet.business.review_count = READY_MIN_REVIEWS - 1; few.review_count = READY_MIN_REVIEWS - 1;
  assert.ok(outreachReadiness(few).reasons.includes("few_reviews"));
});

const src = read("api/ga-metrics.js");

await test("pipeline: v3 builds only with PAGE_V3_NEW and PAGE_COPY_V3 on, capped per day", () => {
  assert.match(src, /env\.PAGE_V3_NEW === "on" && env\.PAGE_COPY_V3 === "on"/);
  assert.match(src, /PAGE_V3_DAILY_MAX/);
  assert.match(src, /reason: "v3_daily_cap"/);
});

await test("pipeline: new previews wait at preview_building; drafts only after the floor", () => {
  assert.match(src, /status: "preview_building"/);
  assert.match(src, /outreachReadiness\(prof, prof\.brand_kit \|\| null\)/);
  assert.match(src, /status: "page_not_ready"/);
});

await test("pipeline: every send re-checks the page when v3 is on", () => {
  const send = src.slice(src.indexOf("async function handleSendOutreach"), src.indexOf("async function handleSendOutreach") + 8000);
  assert.match(send, /if \(v3PipelineOn\(\)\) \{\s*const \{ data: page \}/);
  assert.match(send, /reason: "page_not_ready"/);
});

await test("pipeline: draft_all never re-drafts parked or building prospects", () => {
  assert.match(src, /no_preview,preview_building,page_not_ready,preview_removed,removed_by_owner\)/);
});

console.log(`\n${passed} passed`);
