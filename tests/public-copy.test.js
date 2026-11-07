// Run with: node tests/public-copy.test.js (also wired into `npm test`)
// Operating Doc rule #5: public content never names the customer below, or
// shows their page or results, without written permission. This scans every
// file the site serves from public/ plus the guide source and generator.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const NAMED = /conway/i;
const TEXT = /\.(html?|js|mjs|css|json|xml|txt|svg|md)$/i;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (TEXT.test(name)) out.push(p);
  }
  return out;
}

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { console.error(`  FAIL - ${name}`); console.error(err.message); process.exitCode = 1; }
}

test("no public file names the customer from rule #5", () => {
  const files = [...walk("public"), "data/guides.mjs", "scripts/build-guides.mjs"];
  const hits = files.flatMap(f => readFileSync(f, "utf8").split("\n")
    .map((line, i) => (NAMED.test(line) ? `${f}:${i + 1}` : null)).filter(Boolean));
  assert.deepEqual(hits, []);
});

test("the old case-study URLs redirect to /examples", () => {
  const { redirects = [], rewrites = [] } = JSON.parse(readFileSync("vercel.json", "utf8"));
  const old = redirects.filter(r => NAMED.test(r.source));
  assert.equal(old.length, 2);
  for (const r of old) assert.equal(r.destination, "/examples");
  assert.ok(!rewrites.some(r => NAMED.test(r.source) || NAMED.test(r.destination)));
});

// Public-copy rules: the page is never "built from your Google listing" (owners
// who aren't on Google, or whose info is stale, get built with Jack instead),
// and the only speed claim is "about 30 seconds". Progress labels such as
// "Pulling your Google listing" are fine; only "from your (Google) listing" fails.
const PAGES = () => [...walk("public").filter(f => /\.html?$/i.test(f)), "data/guides.mjs"];
function hitsFor(re) {
  return PAGES().flatMap(f => readFileSync(f, "utf8").split("\n")
    .map((line, i) => (re.test(line) ? `${f}:${i + 1}` : null)).filter(Boolean));
}

test('no public page says the page is built "from your listing"', () => {
  assert.deepEqual(hitsFor(/from your (google )?listing/i), []);
});

test('no public page claims "5 minutes" (the speed claim is "about 30 seconds")', () => {
  assert.deepEqual(hitsFor(/\b5[ -]?min(ute)?s?\b/i), []);
});

test("the rules allow progress labels like \"Pulling your Google listing\"", () => {
  assert.equal(/from your (google )?listing/i.test("Pulling your Google listing"), false);
  assert.equal(/from your (google )?listing/i.test("It's built from your Google listing"), true);
  assert.equal(/\b5[ -]?min(ute)?s?\b/i.test("Live in 5 minutes"), true);
  assert.equal(/\b5[ -]?min(ute)?s?\b/i.test("about 30 seconds"), false);
});

console.log(`public-copy: ${passed} passed`);
