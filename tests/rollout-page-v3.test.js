// Run with: node tests/rollout-page-v3.test.js (also wired into `npm test`)
// scripts/rollout-page-v3.mjs: dry run by default, --apply only with
// --slugs, no --all, never Conway's or a paying/comped page, and dry-run
// files use local assets with no scripts (nothing calls production).

import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs, argError, protectedReason, forFile, TEST_SET } from "../scripts/rollout-page-v3.mjs";

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { console.error(`  FAIL - ${name}`); console.error(err); process.exitCode = 1; }
}

test("dry run is the default; --apply needs --slugs; there is no --all", () => {
  assert.equal(parseArgs([]).apply, false);
  assert.equal(argError(parseArgs([])), null);
  assert.match(argError(parseArgs(["--apply"])), /--slugs/);
  assert.equal(argError(parseArgs(["--apply", "--slugs", "a,b"])), null);
  assert.deepEqual(parseArgs(["--apply", "--slugs", "a, b,"]).slugs, ["a", "b"]);
  assert.match(argError(parseArgs(["--all"])), /isn't available/);
  assert.match(argError(parseArgs(["--apply", "--all", "--slugs", "a"])), /isn't available/);
});

test("never Conway's Landscaping, a paying page or a comped page", () => {
  assert.equal(protectedReason({ username: "conways-landscaping" }), "conway");
  assert.equal(protectedReason({ username: "x", business_name: "Conway's Landscaping" }), "conway");
  assert.equal(protectedReason({ username: "x" }, { provider: "stripe", status: "active", stripe_subscription_id: "sub_1" }), "paying");
  assert.equal(protectedReason({ username: "x" }, { provider: "stripe", status: "trialing", stripe_subscription_id: "sub_1" }), "paying");
  assert.equal(protectedReason({ username: "x" }, { provider: "comped", status: "active" }), "comped");
  assert.equal(protectedReason({ username: "x" }, { provider: "stripe", status: "trialing", stripe_subscription_id: null }), null, "preview-trial placeholder is fine");
  assert.equal(protectedReason({ username: "x" }, null), null);
});

test("the test set is the 10 PR A dry-run businesses", () => {
  assert.equal(TEST_SET.length, 10);
  assert.ok(!TEST_SET.some(s => /conway/i.test(s)));
});

test("dry-run files: no scripts, local assets", () => {
  // An absolute path on whatever OS runs the test (CI is Linux, Jack is Windows).
  const dir = resolve("repo-root", "public");
  const html = forFile('<head></head><link href="/styles/a.css"><script>fetch("/api/track")</script><img src="https://x/y.jpg"><a href="//cdn">', dir);
  assert.doesNotMatch(html, /<script/);
  assert.ok(html.includes(`href="${pathToFileURL(dir).href}/styles/a.css"`), html);
  assert.match(html, /src="https:\/\/x\/y\.jpg"/);
  assert.match(html, /href="\/\/cdn"/);
});

console.log(`\n${passed} passed`);
