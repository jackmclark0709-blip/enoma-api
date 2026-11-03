// Run with: node tests/spotlight-versions.test.js (also wired into `npm test`)

import assert from "node:assert/strict";
import { pushVersion, runGeneration, MAX_VERSIONS } from "../api/_lib/spotlight.js";

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { console.error(`  FAIL - ${name}`); console.error(err); process.exitCode = 1; }
}

// Minimal stand-in for the Supabase client: one service_spotlights row.
function fakeDb(row) {
  const updates = [];
  return {
    updates, row,
    from() {
      const q = {
        select() { return q; }, eq() { return q; },
        maybeSingle: async () => ({ data: row }),
        update(patch) { updates.push(patch); Object.assign(row, patch); return { eq: async () => ({ error: null }) }; },
      };
      return q;
    },
  };
}
const aiReply = (obj) => async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(obj) } }] }) });
const draft = {
  headline_options: [{ angle: "outcome", headline: "Snow Removal in Agawam", subhead: "Cleared after a storm." }],
  blocks: { steps: [{ title: "Call", detail: "Or send the form." }], deliverables: { items: ["Driveway"] }, faqs: [], cta: { heading: "Ready?" } },
};
const intake = { service_name: "Snow Removal", cta_type: "request a quote", pricing_mode: "request a quote" };
const profile = { business_name: "Conway's Landscaping", city: "Agawam", state: "MA", username: "conways-landscaping" };

console.log("versions");
await test("first generation keeps no version", () => {
  assert.deepEqual(pushVersion([], { content: {} }), []);
});
await test("each rewrite keeps the previous page, newest first, capped", () => {
  let v = [];
  for (let i = 0; i < MAX_VERSIONS + 3; i++) v = pushVersion(v, { content: { hero: { headline: `H${i}` } }, updated_at: `t${i}` });
  assert.equal(v.length, MAX_VERSIONS);
  assert.equal(v[0].headline, `H${MAX_VERSIONS + 2}`);
});

console.log("background generation");
await test("success writes the page, marks ready and keeps the old version", async () => {
  const db = fakeDb({ id: "s1", content: { hero: { headline: "Old headline" } }, versions: [], intake: {}, generation_status: "generating" });
  await runGeneration({ supabaseAdmin: db, fetchImpl: aiReply(draft), id: "s1", intake, profile });
  assert.equal(db.row.generation_status, "ready");
  assert.equal(db.row.content.hero.headline, "Snow Removal in Agawam");
  assert.equal(db.row.versions[0].headline, "Old headline");
});
await test("an AI failure marks the row failed with a plain message", async () => {
  const db = fakeDb({ id: "s1", content: {}, versions: [], generation_status: "generating" });
  await runGeneration({ supabaseAdmin: db, fetchImpl: async () => ({ ok: false, status: 500, text: async () => "boom" }), id: "s1", intake, profile });
  assert.equal(db.row.generation_status, "failed");
  assert.match(db.row.generation_error, /answers are saved/);
});

console.log(`\n${passed} passed`);
