// Run with: node tests/site-checks.test.js (also wired into `npm test`)

import assert from "node:assert/strict";
import { siteChecks, decideSiteTier } from "../api/_lib/site-checks.js";

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (err) {
    console.error(`  FAIL - ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

const NOW = new Date("2026-09-30T12:00:00Z");
const words = n => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
const good = `<html><head><meta name="viewport" content="width=device-width"></head><body>
  <a href="tel:5085551234">Call</a><form><input></form><p>${words(300)}</p><footer>© 2026 Acme</footer></body></html>`;
const bad = `<html><body><p>Welcome to our site</p><footer>Copyright 2017 Acme</footer></body></html>`;

console.log("siteChecks");
test("a modern site trips nothing", () => {
  const c = siteChecks(good, "https://acme.com", NOW);
  assert.equal(c.score, 0, c.signals.join(","));
});
test("an old site trips the obvious problems", () => {
  const c = siteChecks(bad, "http://acme.com", NOW);
  for (const id of ["not_mobile_friendly", "no_tap_to_call", "no_contact_form", "not_https", "stale_copyright", "thin_content"]) {
    assert.ok(c.signals.includes(id), `missing ${id}`);
  }
  assert.equal(c.pitches.length, c.score);
});
test("copyright ranges use the latest year", () => {
  const c = siteChecks(good.replace("© 2026", "© 2015-2026"), "https://acme.com", NOW);
  assert.ok(!c.signals.includes("stale_copyright"));
});
test("empty html is not scored", () => {
  assert.deepEqual(siteChecks("", "https://x.com", NOW), { score: 0, signals: [], pitches: [] });
});

console.log("decideSiteTier");
test("objective signals decide, llm only breaks a tie", () => {
  assert.equal(decideSiteTier({ score: 3 }, "good_site"), "weak_site");
  assert.equal(decideSiteTier({ score: 0 }, "weak_site"), "good_site");
  assert.equal(decideSiteTier({ score: 1 }, "good_site"), "good_site");
  assert.equal(decideSiteTier({ score: 1 }, "weak_site"), "weak_site");
});

console.log(`${passed} passed`);
