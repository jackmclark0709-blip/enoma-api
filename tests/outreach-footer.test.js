// Run with: node tests/outreach-footer.test.js (also wired into `npm test`)

process.env.UNSUBSCRIBE_SECRET = "test-secret-do-not-use-in-prod";

import assert from "node:assert/strict";
import { buildUnsubscribeToken, verifyUnsubscribeToken, appendComplianceFooter } from "../api/_lib/outreach-footer.js";

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

console.log("unsubscribe tokens");

test("a token verifies against the same email, case-insensitively", () => {
  const token = buildUnsubscribeToken("Prospect@Example.com");
  assert.equal(verifyUnsubscribeToken("prospect@example.com", token), true);
});

test("a token does not verify against a different email", () => {
  const token = buildUnsubscribeToken("prospect@example.com");
  assert.equal(verifyUnsubscribeToken("someone-else@example.com", token), false);
});

test("missing email or token fails closed", () => {
  const token = buildUnsubscribeToken("prospect@example.com");
  assert.equal(verifyUnsubscribeToken("", token), false);
  assert.equal(verifyUnsubscribeToken("prospect@example.com", ""), false);
});

console.log("appendComplianceFooter");

test("appends the physical address and a working unsubscribe link, leaves the original body untouched", () => {
  const body = "Hi there, this is the pitch.";
  const withFooter = appendComplianceFooter(body, "prospect@example.com");
  assert.ok(withFooter.startsWith(body));
  assert.ok(withFooter.includes("183 Fairway Dr"));
  assert.ok(withFooter.includes("action=unsubscribe"));
  assert.ok(withFooter.includes("email=prospect%40example.com"));
  const token = withFooter.match(/token=([a-f0-9]+)/)[1];
  assert.equal(verifyUnsubscribeToken("prospect@example.com", token), true);
});

console.log(`\n${passed} passed`);
