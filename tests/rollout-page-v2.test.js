// Run with: node tests/rollout-page-v2.test.js (also wired into `npm test`)
// scripts/rollout-page-v2.mjs: who's in, a failed kit stays v1, the dry run
// writes nothing and pings nothing, revert restores, the owner token gets
// minted, and the Unsplash ping throttle holds under 45/hour.

import assert from "node:assert/strict";
import {
  exclusionReason, isPreviewTrialPlaceholder, isInternalEmail, hasPhone, processBusiness, revert, PingThrottle,
  meteredFetch, callKind, summarize, missingLogosCsv, pickSpread, isDone, heroKindLabel, parseArgs,
} from "../scripts/rollout-page-v2.mjs";
import { promoteToPageV2, isOwnerTokenShape } from "../api/_lib/owner-link.js";

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { console.error(`  FAIL - ${name}`); console.error(err); process.exitCode = 1; }
}
const quiet = { log() {}, warn() {} };

const TRIAL = { provider: "stripe", status: "trialing", is_trial: true, stripe_subscription_id: null, stripe_customer_id: null };
const P = (over = {}) => ({ business_id: "b1", username: "joe-plumbing", business_name: "Joe Plumbing", primary_category: "Plumber",
  city: "Ewing", state: "NJ", phone: "(609) 555-0100", page_version: 1, is_claimed: false, email: "joe@example.com", ...over });
const IN = (over = {}, extra = {}) => exclusionReason({ profile: P(over), business: { slug: over.username || "joe-plumbing", is_internal: false, ...(extra.business || {}) }, subs: extra.subs ?? [TRIAL] });

// ── Selection ─────────────────────────────────────────────────────────────

await test("selection: an unclaimed v1 preview with only its preview-trial row is in", () => {
  assert.equal(IN(), null);
  assert.equal(IN({}, { subs: [] }), null);
  assert.equal(isPreviewTrialPlaceholder(TRIAL), true);
});

await test("selection: claimed, subscribed, comped, internal and Conway's are out", () => {
  assert.equal(IN({ is_claimed: true }), "claimed");
  assert.equal(IN({}, { subs: [{ ...TRIAL, stripe_subscription_id: "sub_123" }] }), "subscribed");
  assert.equal(IN({}, { subs: [{ ...TRIAL, stripe_customer_id: "cus_1" }] }), "subscribed");
  assert.equal(IN({}, { subs: [{ ...TRIAL, status: "active", is_trial: false }] }), "subscribed");
  assert.equal(IN({}, { subs: [{ provider: "comped", status: "active", is_trial: false }] }), "subscribed", "comped");
  assert.equal(IN({}, { subs: [TRIAL, { provider: "manual", status: "active" }] }), "subscribed", "anything else");
  assert.equal(IN({}, { business: { is_internal: true } }), "internal");
  for (const s of ["enoma-io", "assayquant-technologies-inc", "qc-test-plumbing", "cars"]) assert.equal(IN({ username: s }), "internal", s);
  assert.equal(IN({ email: "jack@enoma.io" }), "internal");
  assert.equal(IN({ email: "JCLARK22@une.edu" }), "internal");
  assert.equal(IN({ email: "someone@enoma.test" }), "internal");
  assert.equal(IN({ username: "conways-landscaping" }), "excluded_slug");
  assert.equal(IN({ page_version: 2 }), "page_version_2");
  assert.equal(isInternalEmail("bob@notenoma.test.com"), false);
});

await test("selection: --rebuild takes v2 rows with the same exclusions", () => {
  assert.equal(exclusionReason({ profile: P({ page_version: 2 }), business: {}, subs: [TRIAL] }, { mode: "rebuild" }), null);
  assert.equal(exclusionReason({ profile: P({ page_version: 1 }), business: {}, subs: [TRIAL] }, { mode: "rebuild" }), "page_version_1");
  assert.equal(exclusionReason({ profile: P({ page_version: 2, is_claimed: true }), business: {}, subs: [] }, { mode: "rebuild" }), "claimed");
});

// ── One business ──────────────────────────────────────────────────────────

const KIT = { colors: { identity: "#123456", source: "logo" }, logo: { source: "website", quality: "good" }, specialty: "Water heaters",
  owner_names: ["Joe"], hero: { kind: "stock", ref: { unsplash_id: "abc", url: "https://images.unsplash.com/x" } } };

function harness(over = {}) {
  const calls = { save: 0, promote: 0, launch: 0, ping: 0, captions: 0, build: [] };
  const deps = {
    supabase: {}, log: quiet, mode: "rollout",
    buildKit: async (p, d) => { calls.build.push(d); return KIT; },
    saveKit: async () => { calls.save++; return true; },
    promote: async () => { calls.promote++; return { ok: true, token: "T".repeat(24) }; },
    makeLaunchKit: async () => { calls.launch++; return { status: "ready" }; },
    makeCaptions: async () => { calls.captions++; return { key: "k", source: "gpt-4o", captions: {}, issues: [] }; },
    lookupPhoto: async id => ({ unsplash_id: id, download_location: "https://api.unsplash.com/photos/abc/download" }),
    ping: async () => { calls.ping++; return { triggered: true, reason: "assigned" }; },
    throttle: new PingThrottle({ sleep: async () => {} }),
    ...over,
  };
  return { deps, calls };
}

await test("dry run: builds the kit and captions, writes nothing, fires no download ping", async () => {
  const { deps, calls } = harness({ dryRun: true });
  const r = await processBusiness(P(), deps);
  assert.equal(r.entry.result, "would_v2");
  assert.deepEqual([calls.save, calls.promote, calls.launch, calls.ping], [0, 0, 0, 0]);
  assert.equal(calls.captions, 1);
  assert.equal(calls.build[0].trackStock, false, "buildBrandKit is told not to ping");
  assert.equal(r.entry.hero_kind, "stock_photo");
  assert.equal(r.token, null);
});

await test("a kit that throws, comes back empty, or a profile with no phone stays v1", async () => {
  for (const [over, reason] of [
    [{ buildKit: async () => { throw new Error("boom"); } }, /^brand_kit_threw: boom/],
    [{ buildKit: async () => ({}) }, /^brand_kit_empty$/],
  ]) {
    const { deps, calls } = harness({ dryRun: false, ...over });
    const r = await processBusiness(P(), deps);
    assert.equal(r.entry.result, "stayed_v1");
    assert.match(r.entry.reason, reason);
    assert.deepEqual([calls.save, calls.promote, calls.launch, calls.ping], [0, 0, 0, 0]);
  }
  const { deps, calls } = harness({ dryRun: false });
  const r = await processBusiness(P({ phone: "" }), deps);
  assert.deepEqual([r.entry.result, r.entry.reason], ["stayed_v1", "no_phone"]);
  assert.equal(calls.build.length, 0, "no phone: no API spend");
  const { deps: d2 } = harness({ dryRun: false, saveKit: async () => false });
  assert.equal((await processBusiness(P(), d2)).entry.reason, "kit_not_saved");
  const { deps: d3, calls: c3 } = harness({ dryRun: false, promote: async () => ({ ok: false, error: "db" }) });
  const r3 = await processBusiness(P(), d3);
  assert.equal(r3.entry.result, "stayed_v1");
  assert.equal(c3.launch, 0);
});

await test("live: ping (once) → save kit → v2 + token → launch kit; token never in the entry", async () => {
  const { deps, calls } = harness({ dryRun: false });
  const r = await processBusiness(P(), deps);
  assert.equal(r.entry.result, "v2");
  assert.deepEqual([calls.ping, calls.save, calls.promote, calls.launch], [1, 1, 1, 1]);
  assert.equal(r.entry.kit_status, "ready");
  assert.equal(r.entry.ping, "assigned");
  assert.equal(r.token, "T".repeat(24));
  assert.ok(!JSON.stringify(r.entry).includes("T".repeat(24)));
  assert.equal(deps.throttle.history.length, 1);
  // No stock hero: no ping.
  const { deps: d2, calls: c2 } = harness({ dryRun: false, buildKit: async () => ({ ...KIT, hero: { kind: "scene", ref: "plumbing" } }) });
  await processBusiness(P(), d2);
  assert.equal(c2.ping, 0);
});

await test("live: a failed ping doesn't block the page (the existing retry handles it)", async () => {
  const { deps, calls } = harness({ dryRun: false, ping: async () => ({ triggered: false, reason: "http_403" }) });
  const r = await processBusiness(P(), deps);
  assert.equal(r.entry.result, "v2");
  assert.equal(r.entry.ping, "http_403");
  assert.equal(deps.throttle.history.length, 0, "only successful pings count");
  assert.equal(calls.launch, 1);
});

await test("live run reuses the dry run's kit and captions as its cache", async () => {
  const seen = [];
  const { deps } = harness({ dryRun: false, buildKit: async p => { seen.push(p.brand_kit); return KIT; } });
  await processBusiness(P(), { ...deps, cached: { kit: { google_photos: [{ name: "x", kind: "work" }] }, captions: { key: "abc", captions: { post_online: "hi" } } } });
  assert.deepEqual(seen[0].google_photos, [{ name: "x", kind: "work" }]);
  assert.equal(seen[0].launch_kit.captions.key, "abc");
});

await test("the owner token is minted at the v2 flip (promoteToPageV2)", async () => {
  const row = { business_id: "b1", page_version: 1, owner_token: null };
  const sb = {
    from: () => {
      let patch = null; const f = [];
      const q = {
        update(p) { patch = p; return q; }, select() { return q; },
        eq(k, v) { f.push([k, v, "eq"]); return q; }, is(k, v) { f.push([k, v, "is"]); return q; },
        maybeSingle: async () => { const ok = f.every(([k, v, op]) => op === "is" ? (row[k] ?? null) === v : row[k] === v); if (ok && patch) Object.assign(row, patch); return { data: ok ? { ...row } : null, error: null }; },
        then(res) { const ok = f.every(([k, v, op]) => op === "is" ? (row[k] ?? null) === v : row[k] === v); if (ok && patch) Object.assign(row, patch); return Promise.resolve({ error: null }).then(res); },
      };
      return q;
    },
  };
  const r = await promoteToPageV2(sb, { business_id: "b1", page_version: 1 }, { log: quiet });
  assert.equal(row.page_version, 2);
  assert.ok(isOwnerTokenShape(row.owner_token));
  assert.equal(r.token, row.owner_token);
});

// ── Revert ────────────────────────────────────────────────────────────────

await test("revert puts back page_version for moved rows only; tokens and kits stay", async () => {
  const updates = [];
  const sb = { from: () => ({ update: p => ({ eq: async (k, v) => { updates.push([v, p]); return { error: null }; } }) }) };
  const state = { entries: {
    a: { slug: "a", business_id: "a", result: "v2", prev_page_version: 1 },
    b: { slug: "b", business_id: "b", result: "stayed_v1", prev_page_version: 1 },
    c: { slug: "c", business_id: "c", result: "v2", prev_page_version: 1, reverted_at: "x" },
  } };
  const r = await revert(sb, state, { log: quiet });
  assert.deepEqual(r.reverted, ["a"]);
  assert.deepEqual(updates, [["a", { page_version: 1 }]], "only page_version is written");
  assert.equal(state.entries.a.result, "reverted");
  assert.ok(state.entries.a.reverted_at);
  assert.deepEqual((await revert(sb, state, { log: quiet })).reverted, [], "idempotent");
});

// ── Throttles ─────────────────────────────────────────────────────────────

await test("ping throttle: never more than 45 in any rolling hour, and it survives a restart", async () => {
  let t = 0;
  const slept = [];
  const th = new PingThrottle({ perHour: 45, now: () => t, sleep: async ms => { slept.push(ms); t += ms; } });
  const at = [];
  for (let i = 0; i < 100; i++) { await th.wait(); at.push(t); th.record(); t += 1000; }
  for (let i = 45; i < at.length; i++) assert.ok(at[i] - at[i - 45] >= 3600_000, `ping ${i} too soon`);
  assert.ok(slept.length >= 2);
  // A resumed run reads the history back from the state file.
  const resumed = new PingThrottle({ perHour: 45, now: () => t, history: th.history });
  assert.equal(resumed.delayMs() > 0, th.history.length >= 45);
});

await test("metered fetch: counts billable calls, spaces them out, prices them", async () => {
  let t = 0; const slept = [];
  const f = meteredFetch(async () => ({ ok: true }), { now: () => t, sleep: async ms => { slept.push(ms); t += ms; } });
  await f("https://places.googleapis.com/v1/places/abc");
  await f("https://places.googleapis.com/v1/places/abc/photos/x/media?maxWidthPx=1200");
  await f("https://api.openai.com/v1/chat/completions");
  await f("https://example.com/logo.png");
  assert.deepEqual(f.counts, { places_details: 1, places_media: 1, openai: 1 });
  assert.ok(slept.length >= 1, "second Places call waited");
  assert.equal(f.cost().toFixed(3), "0.037");
  assert.equal(callKind("https://example.com"), null);
});

// ── Reporting ─────────────────────────────────────────────────────────────

await test("summary, missing-logo CSV, spread pick, done states, hero labels, args", () => {
  const entries = {
    a: { slug: "a", business_name: 'Al "The" Plumber', city: "Ewing", state: "NJ", trade: "Plumber", result: "v2", logo_source: "none", color_source: "persona", hero_kind: "stock_photo", owner_names: [] },
    b: { slug: "b", business_name: "B Paint", trade: "Painter", result: "v2", logo_source: "website", color_source: "logo", hero_kind: "google_work_photo", specialty: "Cabinets", owner_names: ["Bo"] },
    c: { slug: "c", trade: "Painter", result: "stayed_v1", reason: "no_phone" },
  };
  const s = summarize(entries);
  assert.deepEqual(s.results, { v2: 2, stayed_v1: 1 });
  assert.deepEqual(s.hero_kind, { stock_photo: 1, google_work_photo: 1 });
  assert.equal(s.with_specialty, 1);
  assert.deepEqual(s.reasons, { no_phone: 1 });
  const csv = missingLogosCsv(entries).trim().split("\n");
  assert.equal(csv.length, 2);
  assert.match(csv[1], /^"Al ""The"" Plumber","Ewing","NJ"/);
  assert.deepEqual(new Set(pickSpread(entries, 12).map(e => e.trade)), new Set(["Plumber", "Painter"]));
  assert.equal(isDone({ result: "v2" }), true);
  assert.equal(isDone({ result: "error" }), false);
  assert.equal(heroKindLabel({ hero: { kind: "work_photo", ref: "google:0" } }), "google_work_photo");
  assert.equal(heroKindLabel({ hero: { kind: "work_photo", ref: "https://x/y.jpg" } }), "owner_photo");
  assert.equal(heroKindLabel({ hero: { kind: "scene" } }), "drawn_scene");
  assert.equal(hasPhone({ phone: "555-0100" }), false);
  const a = parseArgs(["--live", "--limit", "10"]);
  assert.deepEqual([a.live, a.limit, a.revert], [true, 10, false]);
  assert.equal(parseArgs([]).live, false, "dry run is the default");
});

console.log(`\n${passed} passed`);
