// Lightweight, dependency-free tests for the email-crawler pure helpers.
// Run with: node tests/email-crawler.test.js (also wired into `npm test`)

import assert from "node:assert/strict";
import { extractEmails, pickBestEmail, classifyEmail, htmlToText, isPrivateOrReservedIp, websiteCandidates, decodeCfEmail, contactLinks, alternateOrigins } from "../api/_lib/email-crawler.js";

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

test("falls back to a personal mailbox when none match the domain", () => {
  const emails = ["someone@gmail.com", "other@yahoo.com"];
  assert.equal(pickBestEmail(emails, "joesplumbing.com"), "someone@gmail.com");
});

test("skips addresses that were mis-parsed, off-site or role mailboxes (real bounces)", () => {
  assert.equal(pickBestEmail(["office@www.richardbros.com"], "richardbros.com"), null);
  assert.equal(pickBestEmail(["mailtocontact@glowcleaningcompany.com"], "glowcleaningcompany.com"), null);
  assert.equal(pickBestEmail(["slhr@ruc.edu.cn"], "nrgelectricalinc.com"), null);
  assert.equal(pickBestEmail(["webmaster@rpiannuccillo.com"], "rpiannuccillo.com"), null);
  assert.equal(pickBestEmail(["designer@someagency.com", "info@joesplumbing.com"], "www.joesplumbing.com"), "info@joesplumbing.com");
});

test("classifyEmail explains its decision", () => {
  assert.deepEqual(classifyEmail("info@joesplumbing.com", "joesplumbing.com"), { ok: true, reason: "on_domain" });
  assert.deepEqual(classifyEmail("joe@mail.joesplumbing.com", "www.joesplumbing.com"), { ok: true, reason: "on_domain" });
  assert.deepEqual(classifyEmail("joe@comcast.net", "joesplumbing.com"), { ok: true, reason: "free_mail" });
  assert.equal(classifyEmail("someone@otherco.com", "joesplumbing.com").reason, "off_domain");
  assert.equal(classifyEmail("admin@joesplumbing.com", "joesplumbing.com").reason, "role_address");
  assert.equal(classifyEmail("not-an-email", "joesplumbing.com").reason, "malformed");
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

test("websiteCandidates: strips percent-encoded GBP query", () => {
  assert.deepEqual(
    websiteCandidates("https://strongroofingsrq.com/%3Futm_source%3Dgoogle%26utm_medium%3Dorganic"),
    ["https://strongroofingsrq.com/"]
  );
  assert.deepEqual(websiteCandidates("http://www.wdelectriciansharonma.com/%3F"), ["http://www.wdelectriciansharonma.com/"]);
});

test("websiteCandidates: strips real query and hash", () => {
  assert.deepEqual(websiteCandidates("https://acme.com/?utm_source=gbp#top"), ["https://acme.com/"]);
});

test("websiteCandidates: deep listing page falls back to origin", () => {
  assert.deepEqual(
    websiteCandidates("https://www.veteranair.com/service-area/sarasota/%3Futm_source%3Dgoogle-gbp"),
    ["https://www.veteranair.com/service-area/sarasota/", "https://www.veteranair.com/"]
  );
});

test("websiteCandidates: bare domain, junk and non-http", () => {
  assert.deepEqual(websiteCandidates("acme.com"), ["https://acme.com/"]);
  assert.deepEqual(websiteCandidates(""), []);
  assert.deepEqual(websiteCandidates(null), []);
  assert.deepEqual(websiteCandidates("http://"), []);
  assert.deepEqual(websiteCandidates("ftp://acme.com"), []);
});

console.log("obfuscated emails");

test("decodes WordPress antispambot entity-encoded mailto", () => {
  const enc = [..."mailto:info@acmeroofing.com"].map(c => `&#${c.charCodeAt(0)};`).join("");
  const html = `<a href="${enc}">${[..."info@acmeroofing.com"].map(c => `&#x${c.charCodeAt(0).toString(16)};`).join("")}</a>`;
  assert.deepEqual(extractEmails(html), ["info@acmeroofing.com"]);
});

test("decodes Cloudflare data-cfemail and email-protection links", () => {
  const key = 0x42;
  const hex = key.toString(16).padStart(2, "0") + [..."office@bluesky.com"].map(c => (c.charCodeAt(0) ^ key).toString(16).padStart(2, "0")).join("");
  assert.equal(decodeCfEmail(hex), "office@bluesky.com");
  assert.deepEqual(extractEmails(`<span class="__cf_email__" data-cfemail="${hex}">[email&#160;protected]</span>`), ["office@bluesky.com"]);
  assert.deepEqual(extractEmails(`<a href="/cdn-cgi/l/email-protection#${hex}">Email</a>`), ["office@bluesky.com"]);
});

test("rejects garbage cf hex", () => {
  assert.equal(decodeCfEmail("zz"), null);
  assert.equal(decodeCfEmail("4242"), null);
});

test("reads email from JSON-LD even though other scripts are ignored", () => {
  const html = `<script type="application/ld+json">{"@type":"LocalBusiness","email":"mailto:jobs@pelicanroofing.com"}</script><script>var x="dev@vendor.io"</script>`;
  assert.deepEqual(extractEmails(html), ["jobs@pelicanroofing.com"]);
});

test("reads spelled-out [at] [dot] addresses", () => {
  assert.deepEqual(extractEmails(`<p>Email: mike [at] fogleelectric [dot] com</p>`), ["mike@fogleelectric.com"]);
  assert.deepEqual(extractEmails(`<p>sales(at)gregoryelectric.com</p>`), ["sales@gregoryelectric.com"]);
});

test("strips trailing punctuation from bare-text matches", () => {
  assert.deepEqual(extractEmails(`<p>Write to info@site.com.</p>`), ["info@site.com"]);
});

console.log("contactLinks");

test("finds same-site contact/quote links, contact first, skips external and tel/mailto", () => {
  const html = `
    <a href="/about-us/">About Us</a>
    <a href="https://www.acme.com/get-a-quote">Free Quote</a>
    <a href="/reach-us.html">Contact</a>
    <a href="https://facebook.com/acme/contact">FB</a>
    <a href="tel:5551234">Call</a>
    <a href="/services">Services</a>`;
  const links = contactLinks(html, "https://acme.com/");
  assert.equal(links[0], "https://acme.com/reach-us.html");
  assert.ok(links.includes("https://www.acme.com/get-a-quote"));
  assert.ok(links.includes("https://acme.com/about-us/"));
  assert.ok(!links.some(l => l.includes("facebook") || l.includes("services")));
});

test("caps the number of links and handles empty input", () => {
  const html = Array.from({ length: 8 }, (_, i) => `<a href="/contact-${i}">Contact</a>`).join("");
  assert.equal(contactLinks(html, "https://a.com/", 3).length, 3);
  assert.deepEqual(contactLinks("", "https://a.com/"), []);
});

console.log("alternateOrigins");

test("flips scheme and www", () => {
  assert.deepEqual(alternateOrigins("http://boyerconstruction.net/"), ["https://boyerconstruction.net/", "https://www.boyerconstruction.net/"]);
  assert.deepEqual(alternateOrigins("https://www.axiselectric.llc/"), ["http://www.axiselectric.llc/", "https://axiselectric.llc/"]);
  assert.deepEqual(alternateOrigins("not a url"), []);
});

console.log(`\n${passed} passed`);
