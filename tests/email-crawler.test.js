// Lightweight, dependency-free tests for the email-crawler pure helpers.
// Run with: node tests/email-crawler.test.js (also wired into `npm test`)

import assert from "node:assert/strict";
import { extractEmails, pickBestEmail, htmlToText, isPrivateOrReservedIp } from "../api/_lib/email-crawler.js";

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

console.log("extractEmails");

test("finds a mailto: link", () => {
  const html = `<a href="mailto:info@conwayslandscaping.com">Email us</a>`;
  assert.deepEqual(extractEmails(html), ["info@conwayslandscaping.com"]);
});

test("finds a bare email in visible text", () => {
  const html = `<p>Reach us at contact@joesplumbing.com any time.</p>`;
  assert.deepEqual(extractEmails(html), ["contact@joesplumbing.com"]);
});

test("dedupes the same address found via mailto and bare text", () => {
  const html = `<a href="mailto:info@site.com">Email</a><p>info@site.com</p>`;
  assert.deepEqual(extractEmails(html), ["info@site.com"]);
});

test("ignores emails inside <style> blocks (e.g. font license comments)", () => {
  const html = `<style>/* Copyright Micah Rich micah@micahrich.com, Reserved Font Name */ body{color:red}</style><p>Welcome to our landscaping site.</p>`;
  assert.deepEqual(extractEmails(html), []);
});

test("ignores emails inside <script> blocks", () => {
  const html = `<script>var config = {supportEmail: "widget@thirdpartytracker.io"};</script><p>Call us for a quote.</p>`;
  assert.deepEqual(extractEmails(html), []);
});

test("still finds a real mailto: link even when the page also has script/style noise", () => {
  const html = `<script>var x = "noise@tracker.io";</script><a href="mailto:owner@realbusiness.com">Email us</a>`;
  assert.deepEqual(extractEmails(html), ["owner@realbusiness.com"]);
});

test("drops known junk/platform domains", () => {
  const html = `<a href="mailto:test@example.com">x</a><p>widget@sentry-next.wixpress.com</p>`;
  assert.deepEqual(extractEmails(html), []);
});

test("drops noreply-style prefixes", () => {
  const html = `<p>noreply@realbusiness.com</p>`;
  assert.deepEqual(extractEmails(html), []);
});

test("drops image-shaped false positives", () => {
  const html = `<p>logo@2x.png</p>`;
  assert.deepEqual(extractEmails(html), []);
});

test("returns empty array for no HTML", () => {
  assert.deepEqual(extractEmails(null), []);
  assert.deepEqual(extractEmails(""), []);
});

console.log("pickBestEmail");

test("prefers an email on the business's own domain", () => {
  const emails = ["someone@gmail.com", "info@joesplumbing.com"];
  assert.equal(pickBestEmail(emails, "joesplumbing.com"), "info@joesplumbing.com");
});

test("falls back to the first email when none match the domain", () => {
  const emails = ["someone@gmail.com", "other@yahoo.com"];
  assert.equal(pickBestEmail(emails, "joesplumbing.com"), "someone@gmail.com");
});

test("returns null for an empty list", () => {
  assert.equal(pickBestEmail([], "joesplumbing.com"), null);
});

console.log("htmlToText");

test("strips tags, scripts, and styles", () => {
  const html = `<html><head><style>.a{color:red}</style></head><body><script>track()</script><h1>Joe's Plumbing</h1><p>We fix pipes.</p></body></html>`;
  assert.equal(htmlToText(html), "Joe's Plumbing We fix pipes.");
});

test("collapses whitespace and truncates to maxLen", () => {
  const html = `<p>${"a".repeat(20)}</p>`;
  assert.equal(htmlToText(html, 10).length, 10);
});

test("returns empty string for no HTML", () => {
  assert.equal(htmlToText(null), "");
});

console.log("isPrivateOrReservedIp");

test("blocks loopback", () => {
  assert.equal(isPrivateOrReservedIp("127.0.0.1"), true);
});

test("blocks the AWS/GCP-style cloud metadata address", () => {
  assert.equal(isPrivateOrReservedIp("169.254.169.254"), true);
});

test("blocks RFC1918 private ranges", () => {
  assert.equal(isPrivateOrReservedIp("10.0.0.5"), true);
  assert.equal(isPrivateOrReservedIp("172.16.0.5"), true);
  assert.equal(isPrivateOrReservedIp("192.168.1.1"), true);
});

test("does not block adjacent public-looking ranges", () => {
  assert.equal(isPrivateOrReservedIp("172.15.0.5"), false);
  assert.equal(isPrivateOrReservedIp("172.32.0.5"), false);
});

test("blocks CGNAT (100.64.0.0/10)", () => {
  assert.equal(isPrivateOrReservedIp("100.64.0.1"), true);
  assert.equal(isPrivateOrReservedIp("100.100.0.1"), true);
});

test("allows a real public IP", () => {
  assert.equal(isPrivateOrReservedIp("8.8.8.8"), false);
  assert.equal(isPrivateOrReservedIp("93.184.216.34"), false);
});

test("blocks IPv6 loopback and link-local/unique-local", () => {
  assert.equal(isPrivateOrReservedIp("::1"), true);
  assert.equal(isPrivateOrReservedIp("fe80::1"), true);
  assert.equal(isPrivateOrReservedIp("fd00::1"), true);
});

test("resolves IPv4-mapped IPv6 addresses before checking", () => {
  assert.equal(isPrivateOrReservedIp("::ffff:127.0.0.1"), true);
  assert.equal(isPrivateOrReservedIp("::ffff:8.8.8.8"), false);
});

test("treats empty/missing input as blocked", () => {
  assert.equal(isPrivateOrReservedIp(""), true);
  assert.equal(isPrivateOrReservedIp(null), true);
});

console.log(`\n${passed} passed`);
