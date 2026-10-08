// Run with: node tests/referral.test.js (also wired into `npm test`)

import assert from "node:assert/strict";
import { normalizeRefCode, readRefCookie, attributeReferral } from "../api/_lib/referral.js";

let passed = 0;
const pending = [];
function test(name, fn) {
  pending.push((async () => {
    try {
      await fn();
      passed++;
      console.log(`  ok - ${name}`);
    } catch (err) {
      console.error(`  FAIL - ${name}`);
      console.error(err);
      process.exitCode = 1;
    }
  })());
}

// Minimal stand-in for the supabase-js query builder.
function fakeSupabase({ referrers = {}, referredBy = null } = {}) {
  const calls = { updates: [] };
  const client = {
    calls,
    from(table) {
      const q = { table, filters: {}, isNull: [] , payload: null };
      const builder = {
        select() { return builder; },
        eq(col, val) { q.filters[col] = val; return builder; },
        is(col, val) { if (val === null) q.isNull.push(col); return builder; },
        update(payload) { q.payload = payload; return builder; },
        async maybeSingle() {
          const r = referrers[q.filters.code];
          return { data: r && (q.filters.active === undefined || r.active === q.filters.active) ? { code: q.filters.code } : null };
        },
        then(resolve) {
          // awaited update chain
          calls.updates.push({ ...q });
          const blocked = q.isNull.includes("referred_by") && referredBy;
          resolve({ data: blocked ? [] : [{ id: q.filters.id }], error: null });
        }
      };
      return builder;
    }
  };
  return client;
}

console.log("referral codes");

test("normalizes case and whitespace", () => {
  assert.equal(normalizeRefCode(" Conways "), "conways");
});

test("rejects junk, too-short and too-long codes", () => {
  assert.equal(normalizeRefCode("<script>"), null);
  assert.equal(normalizeRefCode("a"), null);
  assert.equal(normalizeRefCode("x".repeat(41)), null);
  assert.equal(normalizeRefCode(undefined), null);
});

test("reads the enoma_ref cookie among others", () => {
  assert.equal(readRefCookie("a=1; enoma_ref=supply-yard-1; b=2"), "supply-yard-1");
  assert.equal(readRefCookie("enoma_anon=x"), null);
  assert.equal(readRefCookie(""), null);
});

console.log("attribution");

test("stamps an active referrer onto an unattributed business", async () => {
  const sb = fakeSupabase({ referrers: { conways: { active: true } } });
  const code = await attributeReferral(sb, { headers: { cookie: "enoma_ref=conways" } }, "biz-1");
  assert.equal(code, "conways");
  assert.equal(sb.calls.updates[0].payload.referred_by, "conways");
  assert.deepEqual(sb.calls.updates[0].isNull, ["referred_by"]);
});

test("ignores codes that aren't registered or are inactive", async () => {
  const sb = fakeSupabase({ referrers: { old: { active: false } } });
  assert.equal(await attributeReferral(sb, { headers: { cookie: "enoma_ref=get-started" } }, "biz-1"), null);
  assert.equal(await attributeReferral(sb, { headers: { cookie: "enoma_ref=old" } }, "biz-1"), null);
  assert.equal(sb.calls.updates.length, 0);
});

test("first touch wins: an already-attributed business is left alone", async () => {
  const sb = fakeSupabase({ referrers: { conways: { active: true } }, referredBy: "someone-else" });
  assert.equal(await attributeReferral(sb, { headers: { cookie: "enoma_ref=conways" } }, "biz-1"), null);
});

test("no cookie or no business means no work and no throw", async () => {
  const sb = fakeSupabase();
  assert.equal(await attributeReferral(sb, { headers: {} }, "biz-1"), null);
  assert.equal(await attributeReferral(sb, null, "biz-1"), null);
});

Promise.all(pending).then(() => console.log(`\n${passed} passed`));
