// Run with: node tests/traffic-sql-sync.test.js (also wired into `npm test`)
// public.traffic_class_for() (the SQL twin used by the backfill) must use the
// same IP ranges and user-agent regex as api/_lib/traffic-classifier.js.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_INTERNAL_IPS, GOOGLEBOT_RANGES, META_RANGES, MICROSOFT_RANGES, CLOUD_RANGES, ASIA_CLOUD_RANGES
} from "../api/_lib/traffic-ranges.js";
import { CRAWLER_UA, SCANNER_AFTER_SEND_MS } from "../api/_lib/traffic-classifier.js";

const sql = readFileSync(new URL("../supabase/migrations/20261112_traffic_class.sql", import.meta.url), "utf8");
const fn = sql.slice(sql.indexOf("create or replace function public.traffic_class_for"), sql.indexOf("-- ── Reporting views"));
const quoted = list => list.map(r => `'${r}'`);
const arrayAfter = marker => {
  const i = fn.indexOf(marker);
  assert.ok(i >= 0, `missing ${marker}`);
  return fn.slice(i, fn.indexOf("]", i));
};

let passed = 0;
function test(name, f) { try { f(); passed++; } catch (e) { console.error(`FAIL: ${name}`); throw e; } }

test("user agent regex matches", () => {
  assert.ok(fn.includes(`ua ~* '${CRAWLER_UA.source}'`), "CRAWLER_UA differs from the SQL regex");
});
test("default internal IPs match", () => {
  assert.ok(fn.includes(`array[${quoted(DEFAULT_INTERNAL_IPS).join(", ")}]`));
});
test("every range is in the SQL, in the same bucket", () => {
  const google = arrayAfter("-- Googlebot");
  const meta = arrayAfter("-- Meta link previews");
  const ms = arrayAfter("-- Microsoft / Azure");
  const cloud = arrayAfter("-- AWS / GCP\n");
  const datacenter = arrayAfter("-- AWS / GCP / Tencent");
  for (const r of quoted(GOOGLEBOT_RANGES)) assert.ok(google.includes(r), r);
  for (const r of quoted(META_RANGES)) assert.ok(meta.includes(r), r);
  for (const r of quoted(MICROSOFT_RANGES)) assert.ok(ms.includes(r), r);
  for (const r of quoted(CLOUD_RANGES)) { assert.ok(cloud.includes(r), r); assert.ok(datacenter.includes(r), r); }
  for (const r of quoted(ASIA_CLOUD_RANGES)) assert.ok(datacenter.includes(r), r);
});
test("timing window matches", () => {
  assert.ok(fn.includes(`interval '${SCANNER_AFTER_SEND_MS / 1000} seconds'`));
});

console.log(`traffic-sql-sync: ${passed} passed`);
