// Run with: node tests/owner-token.test.js (also wired into `npm test`)
// Owner tokens are minted when a page becomes v2 (not on first use only), a
// backfill covers older v2 rows, no public path ever returns the token, and
// owner links keep working (and keep their UTM tags) with extra query params.

import assert from "node:assert/strict";
import fs from "node:fs";
import { pageV2Fields, promoteToPageV2, isOwnerTokenShape, newOwnerToken, ownerTokenMatches, ownerPageUrl } from "../api/_lib/owner-link.js";
import { backfillOwnerTokens } from "../scripts/backfill-owner-tokens.mjs";
import { utmFromQuery } from "../api/_lib/attribution.js";
import { clientProfile, renderCompanyPage } from "../api/_lib/company-page.js";
import { renderBlocksV2 } from "../api/_lib/page-v2.js";
import { deriveKit } from "../api/_lib/brand-kit.js";

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { console.error(`  FAIL - ${name}`); console.error(err); process.exitCode = 1; }
}
const read = rel => fs.readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

// A tiny in-memory stand-in for the supabase-js query builder (only the
// calls owner-link.js and the backfill make).
function fakeSupabase(rows) {
  const writes = [];
  const from = () => {
    const filters = [];
    let patch = null;
    const match = r => filters.every(([k, op, v]) => (op === "is" ? (r[k] ?? null) === v : r[k] === v));
    const run = () => {
      const hit = rows.filter(match);
      if (patch) { for (const r of hit) Object.assign(r, patch); writes.push({ patch, n: hit.length }); }
      return hit.map(r => ({ ...r }));
    };
    const q = {
      select() { return q; },
      update(p) { patch = p; return q; },
      eq(k, v) { filters.push([k, "eq", v]); return q; },
      is(k, v) { filters.push([k, "is", v]); return q; },
      maybeSingle: async () => ({ data: run()[0] || null, error: null }),
      then(res, rej) { return Promise.resolve({ data: run(), error: null }).then(res, rej); },
    };
    return q;
  };
  return { from, writes };
}

const quiet = { warn() {} };

await test("pageV2Fields: page_version 2 with a fresh 144-bit token; keeps a valid existing one", () => {
  const f = pageV2Fields();
  assert.equal(f.page_version, 2);
  assert.ok(isOwnerTokenShape(f.owner_token));
  assert.equal(Buffer.from(f.owner_token, "base64url").length, 18, "18 bytes = 144 bits");
  assert.notEqual(pageV2Fields().owner_token, f.owner_token);
  const t = newOwnerToken();
  assert.equal(pageV2Fields({ owner_token: t }).owner_token, t);
  assert.ok(isOwnerTokenShape(pageV2Fields({ owner_token: "short" }).owner_token));
});

await test("preview generation sets page_version 2 and the token in one update", () => {
  const src = read("api/ga-metrics.js");
  assert.match(src, /update\(pageV2Fields\(\)\)\.eq\("business_id", biz\.id\)/);
  assert.doesNotMatch(src, /update\(\{ page_version: 2 \}\)/, "no v2 flip without a token");
});

await test("promoteToPageV2: flips to v2 and mints a token only where none is stored", async () => {
  const t = newOwnerToken();
  const rows = [
    { business_id: "a", page_version: 1, owner_token: null },
    { business_id: "b", page_version: 1, owner_token: t },
  ];
  const sb = fakeSupabase(rows);
  const a = await promoteToPageV2(sb, { ...rows[0] }, { log: quiet });
  assert.equal(a.ok, true);
  assert.ok(isOwnerTokenShape(a.token));
  assert.deepEqual([rows[0].page_version, rows[0].owner_token], [2, a.token]);
  const b = await promoteToPageV2(sb, { ...rows[1] }, { log: quiet });
  assert.equal(b.token, t, "existing token kept");
  assert.equal(rows[1].owner_token, t);
  assert.equal((await promoteToPageV2(sb, {}, { log: quiet })).ok, false);
});

await test("backfill: dry run writes nothing; apply mints; a re-run finds nothing (idempotent)", async () => {
  const keep = newOwnerToken();
  const rows = [
    { business_id: "1", username: "v2-no-token", page_version: 2, owner_token: null },
    { business_id: "2", username: "v2-has-token", page_version: 2, owner_token: keep },
    { business_id: "3", username: "v1-no-token", page_version: 1, owner_token: null },
  ];
  const sb = fakeSupabase(rows);
  const dry = await backfillOwnerTokens(sb, { log: quiet });
  assert.deepEqual(dry.missing, ["v2-no-token"]);
  assert.equal(sb.writes.length, 0);
  assert.equal(rows[0].owner_token, null);
  const live = await backfillOwnerTokens(sb, { apply: true, log: quiet });
  assert.deepEqual(live.minted, ["v2-no-token"]);
  assert.ok(isOwnerTokenShape(rows[0].owner_token));
  assert.equal(rows[1].owner_token, keep, "existing token untouched");
  assert.equal(rows[2].owner_token, null, "v1 rows untouched");
  const again = await backfillOwnerTokens(sb, { apply: true, log: quiet });
  assert.deepEqual([again.missing, again.minted], [[], []]);
});

// ── Never public ──────────────────────────────────────────────────────────

const t = newOwnerToken();
const PROFILE = {
  business_id: "c0ffee00-0000-4000-8000-000000000000", username: "let-it-roll-painting", business_name: "Let It Roll Painting",
  primary_category: "Painter", city: "Ewing", state: "NJ", phone: "(732) 948-4046", page_version: 2, is_claimed: false,
  services: [{ service_name: "Interior painting" }], owner_token: t,
};

await test("window.__PROFILE__ (clientProfile) never carries the token", () => {
  const cp = clientProfile(PROFILE);
  assert.ok(!("owner_token" in cp));
  assert.ok(!JSON.stringify(cp).includes(t));
});

await test("a visitor's rendered v2 page never contains the token", () => {
  const kit = deriveKit(PROFILE, {});
  const blocks = renderBlocksV2(PROFILE, kit, { slug: PROFILE.username });
  const html = renderCompanyPage(read("public/profile.html"), PROFILE, { slug: PROFILE.username, blocks });
  assert.ok(!html.includes(t));
  // Even when the page is asked for owner mode without a valid token.
  const wrong = renderBlocksV2(PROFILE, kit, { slug: PROFILE.username, owner: false, token: null });
  assert.ok(!Object.values(wrong).join("").includes(t));
});

await test("public JSON endpoints strip owner_token", () => {
  assert.match(read("api/get-business.js"), /owner_token: _ownerToken, \.\.\.publicData/);
  // Every select("*") of profiles in a public endpoint either strips the
  // token or never returns the row as JSON.
  for (const f of ["api/p.js", "api/get-business.js", "api/sitemap.js", "api/send-contact.js", "api/track.js", "api/get-messages.js"]) {
    const src = read(f);
    assert.doesNotMatch(src, /json\(\s*(profile|data)\s*\)/, `${f} returns a raw profile row`);
  }
});

// ── Owner links with extra params ─────────────────────────────────────────

const LINK = `${ownerPageUrl(PROFILE.username, t)}&utm_source=facebook&utm_medium=dm&utm_campaign=fb_page_msg&utm_content=20261117`;

await test("owner link still matches with UTM params added", () => {
  const q = Object.fromEntries(new URL(LINK).searchParams);
  assert.equal(ownerTokenMatches(PROFILE, q.o), true);
});

await test("utmFromQuery: keeps plain utm_* values, drops the rest", () => {
  const q = new URL(LINK).searchParams;
  assert.deepEqual(utmFromQuery(q), { utm_source: "facebook", utm_medium: "dm", utm_campaign: "fb_page_msg", utm_content: "20261117" });
  assert.deepEqual(utmFromQuery(Object.fromEntries(q)), utmFromQuery(q));
  assert.deepEqual(utmFromQuery({ utm_source: "<script>", utm_medium: ["email", "x"], o: t, m: "x" }), { utm_medium: "email" });
  assert.deepEqual(utmFromQuery(null), {});
});

await test("landing_view from the owner bar carries the UTM tags (like m)", () => {
  const kit = deriveKit(PROFILE, {});
  const utm = utmFromQuery(new URL(LINK).searchParams);
  const html = renderBlocksV2(PROFILE, kit, { slug: PROFILE.username, owner: true, token: t, m: null, utm })["{{BLOCK_HEADER}}"];
  assert.match(html, /var utm = \{"utm_source":"facebook","utm_medium":"dm","utm_campaign":"fb_page_msg","utm_content":"20261117"\};/);
  assert.match(html, /event: "landing_view", metadata: meta/);
  assert.match(read("api/p.js"), /utm: utmFromQuery\(req\.query\)/);
});

await test("page_view (profile.js) carries the UTM tags too", () => {
  const src = read("public/scripts/profile.js");
  assert.match(src, /event: 'page_view'[^\n]*\['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'\]/);
});

console.log(`\n${passed} passed`);
