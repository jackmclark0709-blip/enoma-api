// Run with: node tests/logo-settings.test.js (also wired into `npm test`)
// Owner dashboard logo settings (api/_lib/logo-settings.js) against a fake
// Supabase client: only the business's members (or the Enoma admin) can
// change the logo; picks are validated; an upload sets logo_url and clears
// starter_logo_id; picking a starter logo over an uploaded one clears logo_url.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handleLogo, decodeLogoUpload, ADMIN_ID, BUCKET, MAX_LOGO_BYTES } from "../api/_lib/logo-settings.js";

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { console.error(`  FAIL - ${name}`); console.error(err); process.exitCode = 1; }
}

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 2)]);
const dataUrl = (buf, type = "image/png") => `data:${type};base64,${buf.toString("base64")}`;

function fakeDb({ users = { tok: { id: "owner-1" }, other: { id: "stranger" }, admin: { id: ADMIN_ID } },
  members = [{ user_id: "owner-1", business_id: "biz-1", role: "owner" }],
  profile = { business_id: "biz-1", business_name: "Robbins Plumbing LLC", primary_category: "plumber", logo_url: null, starter_logo_id: null },
  uploadError = null } = {}) {
  const calls = { updates: [], uploads: [] };
  const rows = { business_members: members, small_business_profiles: profile ? [profile] : [] };
  const query = table => {
    const filters = {};
    const q = {
      select() { return q; },
      eq(k, v) { filters[k] = v; return q; },
      async maybeSingle() {
        const row = rows[table].find(r => Object.entries(filters).every(([k, v]) => r[k] === v));
        return { data: row || null, error: null };
      },
      update(patch) {
        return { eq: async (k, v) => { calls.updates.push({ table, patch, where: { [k]: v } }); Object.assign(rows[table].find(r => r[k] === v) || {}, patch); return { error: null }; } };
      },
    };
    return q;
  };
  return {
    calls,
    profile,
    auth: { getUser: async t => ({ data: { user: users[t] || null } }) },
    from: query,
    storage: {
      from: bucket => ({
        upload: async (path, buf, opts) => { calls.uploads.push({ bucket, path, size: buf.length, opts }); return { error: uploadError }; },
        getPublicUrl: path => ({ data: { publicUrl: `https://cdn.test/${bucket}/${path}` } }),
      }),
    },
  };
}

function call(db, { action, token = "tok", body = {} } = {}) {
  const req = { headers: token ? { authorization: `Bearer ${token}` } : {}, query: { kind: "logo", action }, body };
  return new Promise((resolve, reject) => {
    const res = {
      code: 200,
      status(c) { this.code = c; return this; },
      json(j) { resolve({ status: this.code, body: j }); return this; },
    };
    handleLogo(req, res, { supabaseAdmin: db, now: () => 1700000000000 }).catch(reject);
  });
}

console.log("auth");
await test("needs a session", async () => {
  const r = await call(fakeDb(), { action: "options", token: null, body: { business_id: "biz-1" } });
  assert.equal(r.status, 401);
  assert.equal((await call(fakeDb(), { action: "options", token: "expired", body: { business_id: "biz-1" } })).status, 401);
});
await test("only the business's members can read or change the logo", async () => {
  const db = fakeDb();
  for (const action of ["options", "choose", "upload"]) {
    const r = await call(db, { action, token: "other", body: { business_id: "biz-1", starter_logo_id: "stacked", file: dataUrl(PNG) } });
    assert.equal(r.status, 403, action);
  }
  assert.equal(db.calls.updates.length, 0);
  assert.equal(db.calls.uploads.length, 0);
});
await test("the Enoma admin account can act on any business", async () => {
  const r = await call(fakeDb(), { action: "choose", token: "admin", body: { business_id: "biz-1", starter_logo_id: "wordmark" } });
  assert.equal(r.status, 200);
});
await test("business_id is required", async () => {
  assert.equal((await call(fakeDb(), { action: "options", body: {} })).status, 400);
});

console.log("options / choose");
await test("options: three starter logos, default pick is the badge", async () => {
  const r = await call(fakeDb(), { action: "options", body: { business_id: "biz-1" } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.options.map(o => o.id), ["badge", "stacked", "wordmark"]);
  assert.equal(r.body.chosen, "badge");
  assert.equal(r.body.logo_url, null);
  assert.match(r.body.background, /^#[0-9a-f]{6}$/i);
  assert.ok(r.body.options.every(o => o.svg.startsWith("<svg")));
  assert.ok(!JSON.stringify(r.body).includes("$"), "no price anywhere");
});
await test("choose saves starter_logo_id", async () => {
  const db = fakeDb();
  const r = await call(db, { action: "choose", body: { business_id: "biz-1", starter_logo_id: "stacked" } });
  assert.equal(r.status, 200);
  assert.equal(r.body.chosen, "stacked");
  assert.equal(db.calls.updates.length, 1);
  assert.equal(db.calls.updates[0].table, "small_business_profiles");
  assert.equal(db.calls.updates[0].patch.starter_logo_id, "stacked");
  assert.ok(!("logo_url" in db.calls.updates[0].patch), "doesn't touch logo_url when there isn't one");
  assert.deepEqual(db.calls.updates[0].where, { business_id: "biz-1" });
});
await test("choose rejects anything but the three ids", async () => {
  const db = fakeDb();
  for (const bad of ["", "fancy", "<svg>", null]) {
    assert.equal((await call(db, { action: "choose", body: { business_id: "biz-1", starter_logo_id: bad } })).status, 400);
  }
  assert.equal(db.calls.updates.length, 0);
});
await test("picking a starter logo over an uploaded one switches the page to it", async () => {
  const db = fakeDb({ profile: { business_id: "biz-1", business_name: "X", primary_category: "", logo_url: "https://cdn/x.png", starter_logo_id: null } });
  const r = await call(db, { action: "choose", body: { business_id: "biz-1", starter_logo_id: "badge" } });
  assert.equal(r.status, 200);
  assert.equal(db.calls.updates[0].patch.logo_url, null);
  assert.equal(db.calls.updates[0].patch.starter_logo_id, "badge");
});

console.log("upload");
await test("upload stores the file in the photos bucket, sets logo_url, clears starter_logo_id", async () => {
  const db = fakeDb({ profile: { business_id: "biz-1", business_name: "X", primary_category: "", logo_url: null, starter_logo_id: "stacked" } });
  const r = await call(db, { action: "upload", body: { business_id: "biz-1", file: dataUrl(PNG) } });
  assert.equal(r.status, 200);
  assert.deepEqual(db.calls.uploads.map(u => [u.bucket, u.path, u.opts.contentType]), [[BUCKET, "biz-1/logo-1700000000000.png", "image/png"]]);
  assert.equal(BUCKET, "business-images");
  assert.equal(r.body.logo_url, `https://cdn.test/business-images/biz-1/logo-1700000000000.png`);
  assert.equal(db.calls.updates[0].patch.logo_url, r.body.logo_url);
  assert.equal(db.calls.updates[0].patch.starter_logo_id, null);
});
await test("upload sniffs the real type and refuses non-images", async () => {
  const db = fakeDb();
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`);
  assert.equal((await call(db, { action: "upload", body: { business_id: "biz-1", file: dataUrl(svg, "image/png") } })).status, 400);
  assert.equal((await call(db, { action: "upload", body: { business_id: "biz-1", file: "not base64!!" } })).status, 400);
  assert.equal((await call(db, { action: "upload", body: { business_id: "biz-1" } })).status, 400);
  assert.equal(db.calls.uploads.length, 0);
  const j = decodeLogoUpload(dataUrl(JPG, "image/png"));
  assert.equal(j.ext, "jpg");
  assert.equal(j.contentType, "image/jpeg");
});
await test("upload refuses files over 3 MB", async () => {
  const big = Buffer.concat([PNG, Buffer.alloc(MAX_LOGO_BYTES)]);
  const d = decodeLogoUpload(dataUrl(big));
  assert.equal(d.ok, false);
  assert.match(d.error, /3 MB/);
});
await test("a storage error doesn't change the page", async () => {
  const db = fakeDb({ uploadError: { message: "boom" } });
  const r = await call(db, { action: "upload", body: { business_id: "biz-1", file: dataUrl(PNG) } });
  assert.equal(r.status, 500);
  assert.equal(db.calls.updates.length, 0);
});

console.log("wiring");
await test("generate-business routes kind=logo and clears the pick when /create uploads a logo", () => {
  const src = readFileSync("api/generate-business.js", "utf8");
  assert.match(src, /kind === "logo"[\s\S]{0,80}handleLogo\(req, res, \{ supabaseAdmin \}\)/);
  assert.match(src, /uploadedLogo \? \{ starter_logo_id: null \} : \{\}/);
});
await test("migration adds a nullable starter_logo_id limited to the three ids", () => {
  const sql = readFileSync("supabase/migrations/20261111_starter_logo.sql", "utf8");
  assert.match(sql, /add column if not exists starter_logo_id text/);
  assert.match(sql, /starter_logo_id is null or starter_logo_id in \('badge', 'stacked', 'wordmark'\)/);
});
await test("dashboard shows the picker copy and no price", () => {
  const html = readFileSync("public/dashboard/index.html", "utf8");
  assert.ok(html.includes("Starter logo, free. Upload your own anytime."));
  const card = html.slice(html.indexOf('id="logoCard"'), html.indexOf("<!-- Service pages"));
  assert.ok(!/\$\d/.test(card));
});

console.log(`\n${passed} passed`);
