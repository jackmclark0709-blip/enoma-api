// Run with: node tests/email-html.test.js (also wired into `npm test`)

import assert from "node:assert/strict";
import { escapeHtml, linkify, plainTextToHtml, wrapEmailHtml } from "../api/_lib/email-html.js";

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

console.log("escapeHtml");

test("escapes the five HTML-significant characters", () => {
  assert.equal(escapeHtml(`<script>alert("hi") & 'bye'</script>`), "&lt;script&gt;alert(&quot;hi&quot;) &amp; &#039;bye&#039;&lt;/script&gt;");
});

test("a business name that looks like a tag can't inject markup", () => {
  assert.equal(escapeHtml(`Bob's <b>Plumbing</b>`), "Bob&#039;s &lt;b&gt;Plumbing&lt;/b&gt;");
});

console.log("linkify");

test("turns a bare URL into a real anchor tag with the URL as both href and text", () => {
  const result = linkify("Check this out: https://enoma.io/signup");
  assert.equal(result, `Check this out: <a href="https://enoma.io/signup" style="color:#1a73e8;">https://enoma.io/signup</a>`);
});

test("preserves & inside a query string (already escaped to &amp; upstream) as part of the href", () => {
  const result = linkify("https://enoma.io/signup?utm_source=cold_email&amp;utm_medium=email");
  assert.ok(result.startsWith('<a href="https://enoma.io/signup?utm_source=cold_email&amp;utm_medium=email"'));
});

test("strips trailing sentence punctuation from the link, keeps it outside the anchor", () => {
  const result = linkify("start here: https://enoma.io/signup.");
  assert.equal(result, `start here: <a href="https://enoma.io/signup" style="color:#1a73e8;">https://enoma.io/signup</a>.`);
});

test("leaves plain text with no URL untouched", () => {
  assert.equal(linkify("no links here"), "no links here");
});

test("a signup link with a query string gets descriptive anchor text instead of the raw URL", () => {
  const url = "https://enoma.io/signup?utm_source=cold_email&amp;utm_medium=email&amp;utm_campaign=outreach_plumber";
  const result = linkify(`start here: ${url} to get going`);
  assert.equal(result, `start here: <a href="${url}" style="color:#1a73e8;">click here</a> to get going`);
});

test("the unsubscribe action URL gets \"Unsubscribe\" as its anchor text", () => {
  const url = "https://enoma.io/api/ga-metrics?action=unsubscribe&amp;email=prospect%40example.com&amp;token=abc123";
  const result = linkify(url);
  assert.equal(result, `<a href="${url}" style="color:#1a73e8;">Unsubscribe</a>`);
});

test("a signup URL with no query string (doesn't match the label rule) still falls back to using the URL as its own text", () => {
  const result = linkify("https://enoma.io/signup");
  assert.equal(result, `<a href="https://enoma.io/signup" style="color:#1a73e8;">https://enoma.io/signup</a>`);
});

test("an unrelated URL (e.g. the case-study link) is unaffected and still uses itself as anchor text", () => {
  const result = linkify("https://enoma.io/case-studies/conways-landscaping");
  assert.equal(result, `<a href="https://enoma.io/case-studies/conways-landscaping" style="color:#1a73e8;">https://enoma.io/case-studies/conways-landscaping</a>`);
});

console.log("plainTextToHtml");

test("wraps paragraphs (blank-line separated) in <p>, single newlines become <br>", () => {
  const result = plainTextToHtml("Hi there,\nfirst line.\n\nSecond paragraph.");
  assert.equal(result, `<p style="margin:0 0 16px;">Hi there,<br>first line.</p>\n<p style="margin:0 0 16px;">Second paragraph.</p>`);
});

test("escapes before linkifying, so an unsafe business name can't break out of the markup", () => {
  const result = plainTextToHtml(`Hi <b>Bob's</b> Plumbing, visit https://enoma.io/signup`);
  assert.ok(!result.includes("<b>Bob"));
  assert.ok(result.includes("&lt;b&gt;"));
  assert.ok(result.includes('<a href="https://enoma.io/signup"'));
});

console.log("wrapEmailHtml");

test("produces a full HTML document containing the body content", () => {
  const result = wrapEmailHtml("<p>hello</p>");
  assert.ok(result.includes("<!doctype html>"));
  assert.ok(result.includes("<p>hello</p>"));
});

console.log(`\n${passed} passed`);
