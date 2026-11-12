// Run with: node tests/copy-guard.test.js (also wired into `npm test`)
// Pricing v2: going live is "$1 for your first month, then $19.99/month or
// $199/year". "Free" is only for seeing and claiming the preview. This fails
// if any page, script or email template in public/ or api/ still sells the
// old free month or the old no-card subscription.
//
// Code comments are skipped (they describe legacy billing rules, not copy).
// LEGACY_OK lists files whose copy goes only to owners who really are on the
// old free month (pricing_version null), with the reason.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const OBSOLETE = [
  "free for the first month",
  "first month free",
  "free first month",
  "free month",
  "free to start",
  "no card now",
  "no credit card",
];
const OBSOLETE_RE = new RegExp(OBSOLETE.map(s => s.replace(/ /g, "\\s+")).join("|"), "i");

const LEGACY_OK = {
  // Reminder emails for legacy owners whose free month is ending; v2 owners
  // get the preview wording (tests/trial-reminders.test.js, pricing.test.js).
  "api/_lib/trial-reminders.js": "legacy free-month reminder emails",
};

const TEXT = /\.(html?|js|mjs|css|json|txt|md)$/i;
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (TEXT.test(name)) out.push(p);
  }
  return out;
}

// Blank out comments but keep line numbers. Good enough for our own files:
// "//" inside a string (URLs) is kept when it follows ":" (https://).
export function stripComments(src) {
  const keepLines = m => m.replace(/[^\n]/g, " ");
  return String(src)
    .replace(/<!--[\s\S]*?-->/g, keepLines)
    .replace(/\/\*[\s\S]*?\*\//g, keepLines)
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, pre) => pre + " ".repeat(m.length - pre.length));
}

export function obsoleteHits(files) {
  const hits = [];
  for (const f of files) {
    if (LEGACY_OK[f.replace(/\\/g, "/")]) continue;
    stripComments(readFileSync(f, "utf8")).split("\n").forEach((line, i) => {
      const m = line.match(OBSOLETE_RE);
      if (m) hits.push(`${f}:${i + 1}: "${m[0]}"`);
    });
  }
  return hits;
}

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { console.error(`  FAIL - ${name}`); console.error(err.message); process.exitCode = 1; }
}

test("no page, script or email template in public/ or api/ sells the old free month", () => {
  assert.deepEqual(obsoleteHits([...walk("public"), ...walk("api")]), []);
});

test("the guide source and generator are clean too", () => {
  assert.deepEqual(obsoleteHits(["data/guides.mjs", "scripts/build-guides.mjs"]), []);
});

test("the guard catches each obsolete phrase in copy, and ignores comments", () => {
  for (const s of OBSOLETE) assert.match(stripComments(`<p>${s[0].toUpperCase()}${s.slice(1)}</p>`), OBSOLETE_RE, s);
  assert.doesNotMatch(stripComments("// legacy: the free month lives in our DB"), OBSOLETE_RE);
  assert.doesNotMatch(stripComments("<!-- free month -->"), OBSOLETE_RE);
  assert.doesNotMatch(stripComments("/* first month free */"), OBSOLETE_RE);
  assert.match(stripComments('const url = "https://x"; const t = "free month";'), OBSOLETE_RE);
});

test("free is fine for the preview", () => {
  assert.doesNotMatch("Seeing and claiming your page is free, no card.", OBSOLETE_RE);
});

console.log(`\n${passed} passed`);
