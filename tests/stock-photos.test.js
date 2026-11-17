// Run with: node tests/stock-photos.test.js (also wired into `npm test`)

import assert from "node:assert/strict";
import {
  chooseStockPhoto, pickStockPhoto, creditHtml, creditFor, trackStockAssignment, sizedUrls, colorDistance,
  identityColorFor, stockPersonasFor, serviceTagsFor, STOCK_QUERIES, UTM,
} from "../api/_lib/stock-photos.js";
import { waitBeforeNext, verdictPasses, allQueries, buildHours, rowFromUnsplash, contactSheetHtml, countsByPersona } from "../scripts/build-stock-library.mjs";
import { parseArgs } from "../scripts/approve-stock.mjs";

let passed = 0;
const pending = [];
function test(name, fn) {
  pending.push((async () => {
    try { await fn(); passed++; console.log(`  ok - ${name}`); }
    catch (err) { console.error(`  FAIL - ${name}`); console.error(err); process.exitCode = 1; }
  })());
}

const RAW = id => `https://images.unsplash.com/photo-${id}?ixid=M3w${id}&ixlib=rb-4.0.3`;
function row(id, over = {}) {
  return {
    unsplash_id: id, persona: "painting", service_tag: "interior", raw_url: RAW(id), width: 4000, height: 2667,
    color: "#a0a0a0", approved: true, photographer_name: "Ana Lee", photographer_username: "analee",
    photographer_url: "https://unsplash.com/@analee", photo_page_url: `https://unsplash.com/photos/${id}`,
    download_location: `https://api.unsplash.com/photos/${id}/download?ixid=M3w${id}`, ...over,
  };
}
const painter = (over = {}) => ({ business_id: "b-1", business_name: "Let It Roll Painting", primary_category: "Painting contractor", services: [{ service_name: "Interior painting" }], ...over });

console.log("sizedUrls");
test("keeps raw params (ixid) and adds the Imgix sizes", () => {
  const u = sizedUrls(RAW("abc"));
  assert.equal(u.w2400, `${RAW("abc")}&w=2400&q=75&fm=webp&fit=crop`);
  assert.ok(u.w1200.includes("ixid=M3wabc") && u.w1200.endsWith("&w=1200&q=75&fm=webp&fit=crop"));
  assert.ok(u.w600.endsWith("&w=600&q=75&fm=webp&fit=crop"));
  assert.match(u.srcset, /600w, .* 1200w, .* 2400w$/);
});
test("refuses anything that isn't an images.unsplash.com hotlink", () => {
  assert.equal(sizedUrls("https://our-bucket.supabase.co/x.jpg"), null);
  assert.equal(sizedUrls(""), null);
});

console.log("chooseStockPhoto");
test("approved-only: unapproved rows are never picked", () => {
  const rows = [row("a", { approved: false }), row("b", { approved: null }), row("c", { approved: "true" })];
  assert.equal(chooseStockPhoto(rows, painter()), null);
  const pick = chooseStockPhoto([...rows, row("d")], painter());
  assert.equal(pick.unsplash_id, "d");
});
test("deterministic: same business, same photo, regardless of row order", () => {
  const rows = ["a", "b", "c", "d", "e"].map(id => row(id));
  const one = chooseStockPhoto(rows, painter()).unsplash_id;
  for (let i = 0; i < 5; i++) assert.equal(chooseStockPhoto([...rows].reverse(), painter()).unsplash_id, one);
});
test("ties spread across businesses by business_id hash", () => {
  const rows = ["a", "b", "c", "d", "e", "f"].map(id => row(id));
  const picks = new Set(Array.from({ length: 30 }, (_, i) => chooseStockPhoto(rows, painter({ business_id: `biz-${i}` })).unsplash_id));
  assert.ok(picks.size >= 3, `only ${picks.size} distinct picks`);
});
test("color: picks the photo nearest the brand kit identity color", () => {
  const rows = [row("red", { color: "#8c2a1e" }), row("blue", { color: "#1d3d6b" }), row("green", { color: "#2c5a2e" })];
  assert.equal(chooseStockPhoto(rows, painter(), { identity: "#1f4f8f" }).unsplash_id, "blue");
  assert.equal(chooseStockPhoto(rows, painter(), { identity: "#b0543a" }).unsplash_id, "red");
  assert.equal(chooseStockPhoto(rows, painter(), { identity: "#2f6b3a" }).unsplash_id, "green");
});
test("color: no kit falls back to logo color, then the persona palette", () => {
  assert.equal(identityColorFor(painter({ brand_color: "#123456" }), null), "#123456");
  const pal = identityColorFor(painter(), null);
  assert.match(pal, /^#[0-9a-f]{6}$/);
  const rows = [row("near", { color: pal }), row("far", { color: "#00ff00" })];
  assert.equal(chooseStockPhoto(rows, painter(), null).unsplash_id, "near");
});
test("colorDistance: identical is 0, missing is Infinity", () => {
  assert.equal(colorDistance("#336699", "#336699"), 0);
  assert.equal(colorDistance("#336699", null), Infinity);
  assert.ok(colorDistance("#1f4f8f", "#1d3d6b") < colorDistance("#1f4f8f", "#8c2a1e"));
});
test("filters by persona and by the business's services", () => {
  const rows = [row("plumb", { persona: "plumbing", service_tag: "pipes" }), row("ext", { service_tag: "exterior" }), row("int", { service_tag: "interior" })];
  assert.equal(chooseStockPhoto(rows, painter({ services: [{ service_name: "Exterior house painting" }] })).unsplash_id, "ext");
  assert.equal(chooseStockPhoto(rows, painter({ primary_category: "Plumber", services: [] })).unsplash_id, "plumb");
  // No service match: any photo in the persona, never another trade's.
  const p = chooseStockPhoto([row("x", { service_tag: "deck-stain" }), row("p", { persona: "plumbing" })], painter()).unsplash_id;
  assert.equal(p, "x");
});
test("snow businesses draw from the snow library first", () => {
  assert.deepEqual(stockPersonasFor({ primary_category: "Snow removal service" }), ["snow", "landscaping"]);
  assert.deepEqual(stockPersonasFor({ primary_category: "Landscaper", services: [{ service_name: "Snow plowing" }] }), ["snow", "landscaping"]);
  assert.deepEqual(stockPersonasFor({ primary_category: "Landscaper" }), ["landscaping"]);
  assert.deepEqual(stockPersonasFor({ primary_category: "Dentist" }), []);
});
test("service matching doesn't fire on substrings (ac, ev)", () => {
  assert.ok(!serviceTagsFor({ primary_category: "Furnace repair", services: ["Fireplace inserts"] }, "hvac").includes("outdoor-unit"));
  assert.ok(serviceTagsFor({ primary_category: "Furnace repair", services: ["AC tune-ups"] }, "hvac").includes("outdoor-unit"));
  assert.ok(!serviceTagsFor({ primary_category: "electrician", services: ["Panel upgrades", "Every outlet"] }, "electrical").includes("ev-charger"));
  assert.ok(serviceTagsFor({ primary_category: "electrician", services: ["EV charger install"] }, "electrical").includes("ev-charger"));
});
test("every persona has queries and every tag is unique within it", () => {
  for (const [p, qs] of Object.entries(STOCK_QUERIES)) {
    assert.ok(qs.length >= 6 && qs.length <= 8, p);
    assert.equal(new Set(qs.map(q => q.tag)).size, qs.length, p);
  }
});

console.log("pickStockPhoto");
test("returns urls, credit and unsplash_id, never calling Unsplash", async () => {
  const calls = [];
  const fakeDb = { from: t => ({ select: () => ({ eq: (c, v) => ({ in: (c2, v2) => { calls.push([t, c, v, c2, v2]); return Promise.resolve({ data: [row("a"), row("b", { approved: false })], error: null }); } }) }) }) };
  const pick = await pickStockPhoto(painter(), null, { supabase: fakeDb });
  assert.equal(pick.unsplash_id, "a");
  assert.ok(pick.urls.w2400 && pick.urls.w1200 && pick.urls.w600);
  assert.deepEqual(Object.keys(pick.credit).sort(), ["name", "photoUrl", "profileUrl"]);
  assert.deepEqual(calls, [["stock_photos", "approved", true, "persona", ["painting"]]]);
});
test("DB failure → null (page keeps its pattern hero)", async () => {
  const fakeDb = { from: () => ({ select: () => ({ eq: () => ({ in: () => Promise.resolve({ data: null, error: { message: "relation does not exist" } }) }) }) }) };
  assert.equal(await pickStockPhoto(painter(), null, { supabase: fakeDb, log: {} }), null);
});

console.log("creditHtml");
test("both links carry utm_source=enoma&utm_medium=referral", () => {
  const html = creditHtml(creditFor(row("a")));
  assert.match(html, /^<p class="stock-credit">Photo by <a href="https:\/\/unsplash\.com\/@analee\?utm_source=enoma&amp;utm_medium=referral"/);
  assert.ok(html.includes('href="https://unsplash.com/?utm_source=enoma&amp;utm_medium=referral"'));
  assert.ok(html.includes(">Ana Lee</a> on <a"));
  assert.ok(html.includes(">Unsplash</a></p>"));
  assert.equal((html.match(/utm_source=enoma&amp;utm_medium=referral/g) || []).length, 2);
});
test("escapes names and doesn't double the UTM params", () => {
  const html = creditHtml({ name: '<b>"X"</b>', profileUrl: `https://unsplash.com/@x?${UTM}`, photoUrl: "" });
  assert.ok(html.includes("&lt;b&gt;&quot;X&quot;&lt;/b&gt;"));
  assert.equal((html.match(/utm_source/g) || []).length, 2);
  assert.equal(creditHtml(null), "");
});

console.log("trackStockAssignment");
function assignmentsDb() {
  const rows = new Map();
  const db = {
    rows,
    from: () => ({
      upsert(r, opts) {
        assert.equal(opts.onConflict, "business_id,unsplash_id");
        assert.equal(opts.ignoreDuplicates, true);
        const k = `${r.business_id}|${r.unsplash_id}`;
        const inserted = !rows.has(k);
        if (inserted) rows.set(k, { ...r, download_triggered: false });
        return { select: () => Promise.resolve({ data: inserted ? [{ business_id: r.business_id }] : [], error: null }) };
      },
      update(patch) { return { eq: (_, b) => ({ eq: (__, u) => { Object.assign(rows.get(`${b}|${u}`) || {}, patch); return Promise.resolve({ error: null }); } }) }; },
      delete() { return { eq: (_, b) => ({ eq: (__, u) => { rows.delete(`${b}|${u}`); return Promise.resolve({ error: null }); } }) }; },
    }),
  };
  return db;
}
test("fires download_location once per business, with our client_id", async () => {
  const db = assignmentsDb();
  const hits = [];
  const fetchImpl = async (url, init) => { hits.push({ url, auth: init.headers.Authorization }); return { ok: true, status: 200 }; };
  const photo = { unsplash_id: "a", download_location: row("a").download_location };
  const opts = { supabase: db, fetchImpl, accessKey: "KEY" };
  assert.deepEqual(await trackStockAssignment(photo, "biz-1", opts), { triggered: true, reason: "assigned" });
  assert.deepEqual(await trackStockAssignment(photo, "biz-1", opts), { triggered: false, reason: "already_assigned" });
  assert.deepEqual(await trackStockAssignment(photo, "biz-1", opts), { triggered: false, reason: "already_assigned" });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].url, photo.download_location);
  assert.equal(hits[0].auth, "Client-ID KEY");
  assert.equal(db.rows.get("biz-1|a").download_triggered, true);
  assert.ok(db.rows.get("biz-1|a").stock_assigned_at);
  // Another business using the same photo is its own download.
  assert.equal((await trackStockAssignment(photo, "biz-2", opts)).triggered, true);
  assert.equal(hits.length, 2);
});
test("a failed ping releases the row so a later assignment retries", async () => {
  const db = assignmentsDb();
  let n = 0;
  const fetchImpl = async () => (++n === 1 ? { ok: false, status: 500 } : { ok: true, status: 200 });
  const photo = { unsplash_id: "a", download_location: "https://api.unsplash.com/photos/a/download" };
  assert.deepEqual(await trackStockAssignment(photo, "biz-1", { supabase: db, fetchImpl, accessKey: "K", log: {} }), { triggered: false, reason: "http_500" });
  assert.equal(db.rows.size, 0);
  assert.equal((await trackStockAssignment(photo, "biz-1", { supabase: db, fetchImpl, accessKey: "K" })).triggered, true);
  assert.equal(n, 2);
});
test("refuses slots other than hero and service cards", async () => {
  const db = assignmentsDb();
  const r = await trackStockAssignment({ unsplash_id: "a", download_location: "x" }, "b", { supabase: db, accessKey: "K", slot: "recent_work", fetchImpl: async () => { throw new Error("no"); } });
  assert.deepEqual(r, { triggered: false, reason: "slot_not_allowed" });
  assert.equal(db.rows.size, 0);
});

console.log("build script");
test("throttle: 45 per rolling hour", () => {
  const now = 10_000_000;
  assert.equal(waitBeforeNext([], now), 0);
  const times = Array.from({ length: 44 }, (_, i) => now - i * 1000);
  assert.equal(waitBeforeNext(times, now), 0);
  times.push(now - 50 * 60_000); // 45th request, 50 min ago
  const w = waitBeforeNext(times, now);
  assert.ok(w > 9 * 60_000 && w <= 10 * 60_000 + 1000, String(w));
  assert.equal(waitBeforeNext(times.map(t => t - 3_600_000), now), 0);
});
test("62 searches, ~1.4 h at 45/h", () => {
  assert.equal(allQueries().length, 62);
  assert.ok(Math.abs(buildHours() - 62 / 45) < 1e-9);
});
test("vision verdict must clear every check", () => {
  const ok = { recognizable_faces: false, logo_or_text: false, staged_pose: false, looks_like_trade: true, reason: "" };
  assert.equal(verdictPasses(ok), true);
  for (const k of ["recognizable_faces", "logo_or_text", "staged_pose"]) assert.equal(verdictPasses({ ...ok, [k]: true }), false);
  assert.equal(verdictPasses({ ...ok, looks_like_trade: false }), false);
  assert.equal(verdictPasses({ refused: true }), false);
  assert.equal(verdictPasses(undefined), false);
});
test("rowFromUnsplash maps the API photo", () => {
  const r = rowFromUnsplash({
    id: "xyz", width: 5000, height: 3333, color: "#C0A080", blur_hash: "LKO2", alt_description: "a painted room",
    urls: { raw: RAW("xyz") }, links: { html: "https://unsplash.com/photos/xyz", download_location: "https://api.unsplash.com/photos/xyz/download?ixid=1" },
    user: { name: "Sam P", username: "samp", links: { html: "https://unsplash.com/@samp" } },
  }, "painting", "interior");
  assert.equal(r.color, "#c0a080");
  assert.equal(r.raw_url, RAW("xyz"));
  assert.equal(r.download_location, "https://api.unsplash.com/photos/xyz/download?ixid=1");
  assert.equal(r.photographer_url, "https://unsplash.com/@samp");
  assert.equal(r.approved, undefined); // never set by the build
});
test("contact sheet: 600px hotlinks, checkboxes, copy button, counts", () => {
  const ok = { recognizable_faces: false, logo_or_text: false, staged_pose: false, looks_like_trade: true, reason: "fine" };
  const state = { searches: { "painting/interior": {} }, photos: { a: row("a"), b: row("b") }, verdicts: { a: ok, b: { ...ok, recognizable_faces: true } } };
  const html = contactSheetHtml(state, new Set());
  assert.ok(html.includes("&amp;w=600&amp;q=75&amp;fm=webp&amp;fit=crop"));
  assert.ok(html.includes('data-id="a"') && html.includes('id="copy"') && html.includes("approve-stock.mjs"));
  const c = countsByPersona(state, new Set(["a"]));
  assert.deepEqual({ found: c.painting.found, passed: c.painting.passed, waiting: c.painting.waiting, approved: c.painting.approved }, { found: 2, passed: 1, waiting: 0, approved: 1 });
});
test("approve-stock parses ids and --revoke", () => {
  assert.deepEqual(parseArgs(["a", "b,c", "a"]), { approved: true, ids: ["a", "b", "c"] });
  assert.deepEqual(parseArgs(["--revoke", "a"]), { approved: false, ids: ["a"] });
});

console.log("page v2 hook (brand-kit.js → page-v2.js)");
// One fake DB for both tables the hook touches.
function hookDb(rows) {
  const assign = assignmentsDb();
  const reads = [];
  return {
    assign, reads,
    from(t) {
      if (t === "stock_photo_assignments") return assign.from(t);
      assert.equal(t, "stock_photos");
      return { select: () => ({ eq: (c, v) => ({ in: (c2, v2) => { reads.push([c, v, c2, v2]); return Promise.resolve({ data: rows, error: null }); } }) }) };
    },
  };
}
const { buildBrandKit } = await import("../api/_lib/brand-kit.js");
const { renderBlocksV2 } = await import("../api/_lib/page-v2.js");
const { ogSafeImageUrl } = await import("../api/_lib/stock-photos.js");
const lir = { business_id: "11111111-1111-1111-1111-111111111111", business_name: "Let It Roll Painting", username: "let-it-roll-painting", primary_category: "Painting contractor", city: "Ewing", state: "NJ", services: [{ service_name: "Interior painting" }], page_version: 2 };
const lib = [row("int1", { alt: "a freshly painted living room", color: "#5a4a3a" }), row("ext1", { service_tag: "exterior", color: "#5a4a3a" }), row("nope", { approved: false })];

test("hook: PAGE_STOCK_HERO off → no DB read, scene hero", async () => {
  const db = hookDb(lib);
  const kit = await buildBrandKit(lir, { supabase: db, env: {}, townCoords: [], fetchImpl: async () => { throw new Error("no network"); }, log: {} });
  assert.equal(kit.hero.kind, "scene");
  assert.equal(db.reads.length, 0);
});
test("hook: PAGE_STOCK_HERO=on → stock hero from pickStockPhoto, one download ping across rebuilds", async () => {
  const db = hookDb(lib);
  const pings = [];
  const fetchImpl = async (url) => { pings.push(url); return { ok: true, status: 200 }; };
  const deps = { supabase: db, env: { PAGE_STOCK_HERO: "on", UNSPLASH_ACCESS_KEY: "KEY" }, townCoords: [], fetchImpl, log: {} };
  {
    const kit = await buildBrandKit(lir, deps);
    assert.equal(kit.hero.kind, "stock");
    const ref = kit.hero.ref;
    assert.equal(ref.unsplash_id, "int1"); // services say interior
    assert.equal(ref.url, sizedUrls(RAW("int1")).w1200);
    assert.equal(ref.srcset, sizedUrls(RAW("int1")).srcset);
    assert.equal(ref.alt, "a freshly painted living room");
    assert.equal(ref.credit.name, "Ana Lee");
    assert.deepEqual(db.reads, [["approved", true, "persona", ["painting"]]]);
    // Rebuilding the kit (logo/photo change) must not ping Unsplash again.
    await buildBrandKit(lir, deps);
    await buildBrandKit(lir, deps);
    assert.deepEqual(pings, [row("int1").download_location]);

    // Rendered hero: the hotlink, its alt, and the credit with UTM exactly once per link.
    const html = renderBlocksV2(lir, kit, { slug: "let-it-roll-painting" })["{{BLOCK_HERO}}"];
    assert.ok(html.includes(`src="${sizedUrls(RAW("int1")).w1200.replace(/&/g, "&amp;")}"`));
    assert.ok(html.includes('alt="a freshly painted living room"'));
    const credit = html.match(/<figcaption class="v2-credit">Photo by .*?<\/figcaption>/)[0];
    assert.ok(credit.includes('href="https://unsplash.com/@analee?utm_source=enoma&amp;utm_medium=referral"'), credit);
    assert.equal((credit.match(/utm_source/g) || []).length, 2, credit);
  }
});
test("hook: trackStock false (rollout dry run) picks the photo but never pings or assigns", async () => {
  const db = hookDb(lib);
  const pings = [];
  const kit = await buildBrandKit(lir, { supabase: db, env: { PAGE_STOCK_HERO: "on", UNSPLASH_ACCESS_KEY: "KEY" }, townCoords: [], trackStock: false,
    fetchImpl: async (url) => { pings.push(url); return { ok: true, status: 200 }; }, log: {} });
  assert.equal(kit.hero.kind, "stock");
  assert.equal(kit.hero.ref.unsplash_id, "int1");
  assert.deepEqual(pings, []);
  assert.equal(db.assign.rows.size, 0);
});
test("hook: an owner photo still beats stock (no library read)", async () => {
  const db = hookDb(lib);
  const kit = await buildBrandKit({ ...lir, attachments: ["https://cdn.example.com/job.jpg"] }, { supabase: db, env: { PAGE_STOCK_HERO: "on" }, townCoords: [], fetchImpl: async () => ({ ok: false }), log: {} });
  assert.equal(kit.hero.kind, "work_photo");
  assert.equal(db.reads.length, 0);
});
test("share card gets a JPEG of the stock hero (satori can't read WebP)", () => {
  const u = sizedUrls(RAW("int1")).w1200;
  assert.equal(ogSafeImageUrl(u), u.replace("fm=webp", "fm=jpg"));
  assert.ok(ogSafeImageUrl(u).includes("ixid=M3wint1"));
  assert.equal(ogSafeImageUrl("https://cdn.example.com/a.webp"), "https://cdn.example.com/a.webp");
});

await Promise.all(pending);
console.log(`\n${passed} passed`);
