// Run with: node tests/email-verify.test.js (also wired into `npm test`)

import assert from "node:assert/strict";
import { hasValidMx } from "../api/_lib/email-verify.js";

let passed = 0;
async function asyncTest(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (err) {
    console.error(`  FAIL - ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

console.log("hasValidMx");

await asyncTest("no domain part returns false", async () => {
  assert.equal(await hasValidMx("not-an-email"), false);
  assert.equal(await hasValidMx(""), false);
  assert.equal(await hasValidMx(null), false);
});

await asyncTest("a domain with no mail server returns false", async () => {
  assert.equal(await hasValidMx("someone@this-domain-should-not-exist-enoma-test.invalid"), false);
});

await asyncTest("a real, well-known mail domain returns true", async () => {
  assert.equal(await hasValidMx("someone@gmail.com"), true);
});

console.log(`\n${passed} passed`);
