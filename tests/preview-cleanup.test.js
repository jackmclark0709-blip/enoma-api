// Run with: node tests/preview-cleanup.test.js (also wired into `npm test`)
// Which unclaimed previews the cleanup job removes, and what it never touches.

import assert from "node:assert/strict";
import fs from "node:fs";
import { pickPreviewsToRemove, trimProspectRaw, PREVIEW_WINDOW_DAYS, PREVIEW_IDLE_DAYS } from "../api/_lib/preview-cleanup.js";
import { ownerBar } from "../api/_lib/page-v2.js";

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { console.error(`  FAIL - ${name}`); console.error(err); process.exitCode = 1; }
}
const DAY = 86400000;
const NOW = Date.parse("2026-11-20T12:00:00Z");
const ago = d => new Date(NOW - d * DAY).toISOString();
const ahead = d => new Date(NOW + d * DAY).toISOString();

function world(over = {}) {
  const id = over.id || "b1";
  return {
    profiles: [{ business_id: id, username: over.slug || "acme-roofing", is_claimed: false, is_public: true, created_at: ago(over.age ?? 10), ...(over.profile || {}) }],
    businesses: [{ id, is_internal: false, created_at: ago(over.age ?? 10), ...(over.biz || {}) }],
    subs: over.subs || [{ business_id: id, provider: "stripe", status: "trialing", is_trial: true, trial_expires_at: ahead(80), stripe_subscription_id: null }],
    members: over.members || [], leads: over.leads || [], visited: new Set(over.visited || []),
    prospects: over.prospects || [{ preview_business_id: id, preview_first_viewed_at: null, status: "sent" }],
  };
}
const run = (w, opts = {}) => pickPreviewsToRemove(w, { now: NOW, ...opts });

await test("a fresh preview stays", () => {
  assert.equal(run(world()).remove.length, 0);
});

await test("the 90-day window ending removes it", () => {
  const r = run(world({ age: 95, subs: [{ business_id: "b1", provider: "stripe", status: "trialing", is_trial: true, trial_expires_at: ago(5) }] }));
  assert.deepEqual(r.remove, [{ business_id: "b1", slug: "acme-roofing", reason: "window_ended" }]);
  assert.equal(PREVIEW_WINDOW_DAYS, 90);
});

await test(`never visited after ${PREVIEW_IDLE_DAYS} days removes it; any visit keeps it until the window ends`, () => {
  assert.equal(run(world({ age: 50 })).remove[0]?.reason, "never_visited");
  assert.equal(run(world({ age: 50, visited: ["acme-roofing"] })).remove.length, 0);
  assert.equal(run(world({ age: 50, prospects: [{ preview_business_id: "b1", preview_first_viewed_at: ago(40), status: "sent" }] })).remove.length, 0);
  assert.equal(run(world({ age: 30 })).remove.length, 0, "inside the idle period");
});

await test("owner removal and unpublished pages go right away", () => {
  assert.equal(run(world({ prospects: [{ preview_business_id: "b1", status: "removed_by_owner" }] })).remove[0]?.reason, "owner_removed");
  assert.equal(run(world({ profile: { is_public: false } })).remove[0]?.reason, "unpublished");
});

await test("never removed: claimed, internal, customers, accounts, leads, keep list", () => {
  const old = { age: 200, subs: [{ business_id: "b1", provider: "stripe", status: "trialing", is_trial: true, trial_expires_at: ago(100) }] };
  assert.equal(run(world({ ...old, profile: { is_claimed: true } })).remove.length, 0);
  assert.equal(run(world({ ...old, biz: { is_internal: true } })).remove.length, 0);
  assert.equal(run(world({ ...old, subs: [{ business_id: "b1", provider: "comped", status: "active" }] })).remove.length, 0);
  assert.equal(run(world({ ...old, subs: [{ business_id: "b1", provider: "stripe", status: "canceled", is_trial: false, stripe_subscription_id: "sub_1" }] })).remove.length, 0);
  assert.equal(run(world({ ...old, members: [{ business_id: "b1" }] })).remove.length, 0);
  assert.equal(run(world({ ...old, leads: [{ business_id: "b1" }] })).remove.length, 0);
  const kept = run(world(old), { keepSlugs: ["acme-roofing"] });
  assert.equal(kept.remove.length, 0); assert.equal(kept.kept.keep_list, 1);
});

await test("owner bar has the remove link with the owner token", () => {
  const html = ownerBar({ business_name: "Acme Roofing", business_id: "b1" }, { towns: {} }, { slug: "acme-roofing", token: "abcdefghijklmnopqrstuvwx" });
  assert.match(html, /action=remove_preview&amp;slug=acme-roofing&amp;o=abcdefghijklmnopqrstuvwx/);
  assert.match(html, /Not interested\? Remove this page/);
});

const src = fs.readFileSync(new URL("../api/ga-metrics.js", import.meta.url), "utf8");
await test("the job only deletes with PREVIEW_CLEANUP_APPLY=1, and remove_preview checks the owner token", () => {
  assert.match(src, /const apply = process\.env\.PREVIEW_CLEANUP_APPLY === "1";/);
  assert.match(src, /if \(apply\) \{\s*for \(const r of remove\.slice\(0, PREVIEW_CLEANUP_MAX_PER_RUN\)\)/);
  assert.match(src, /!ownerTokenMatches\(page, o\)/);
  // remove_preview is routed before the admin/cron gate (owners have no secret); preview_cleanup after it.
  const gate = src.indexOf("const isValidCron");
  assert.ok(src.indexOf('req.query.action === "remove_preview"') < gate);
  assert.ok(src.indexOf('req.query.action === "preview_cleanup"') > gate);
});

await test("cleanup: copied Google/Outscraper data is cleared from the kept prospect", () => {
  assert.equal(trimProspectRaw({ rating: 4.8, reviews: 52, phone: "x", type: "Plumber" }), null);
  assert.deepEqual(trimProspectRaw({ ip_hash: "abc", rating: 5 }), { ip_hash: "abc" });
  assert.equal(trimProspectRaw(null), null);
  const src = fs.readFileSync(new URL("../api/ga-metrics.js", import.meta.url), "utf8");
  assert.match(src, /update\(\{ raw: trimProspectRaw\(p\.raw\) \}\)/);
});

await test("cleanup: page views are looked up only for never-visited candidates; raw errors stop the delete", () => {
  const src = fs.readFileSync(new URL("../api/ga-metrics.js", import.meta.url), "utf8");
  const fn = src.slice(src.indexOf("async function handlePreviewCleanup"), src.indexOf("async function handleRemovePreview"));
  assert.ok(!/selectAll\("page_events"/.test(fn), "no full page_events scan");
  assert.match(fn, /\.eq\("slug", slug\)[^;]*\.limit\(1\)/);
  assert.match(fn, /if \(rawErr\) throw rawErr;/);
  assert.match(fn, /if \(upErr\) throw upErr;/);
  assert.ok(fn.indexOf("if (upErr) throw upErr;") < fn.indexOf('from("small_business_profiles").delete()'));
});

await test("cleanup + remove link: every write is checked before success is reported", () => {
  const src = fs.readFileSync(new URL("../api/ga-metrics.js", import.meta.url), "utf8");
  assert.match(src, /if \(unlinkErr\) throw unlinkErr;/);
  assert.match(src, /if \(hideErr \|\| !hidden\?\.length\)[^\n]*return failed\(\);/);
  assert.match(src, /if \(stErr \|\| supErr\)[^\n]*return failed\(\);/);
});

console.log(`\n${passed} passed`);
