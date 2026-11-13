// Run with: node tests/business-fonts.test.js (also wired into `npm test`)
// Typography split between the two kinds of page:
//  - Customer pages (enoma.io/<slug>, Service Spotlights, /<slug>/review and
//    the page embedded in /<slug>/preview) use Archivo + Inter from one Google
//    Fonts request, with the families in --biz-font-display / --biz-font-body.
//  - Enoma's own pages keep Fraunces, but "&" in display text comes from the
//    self-hosted "Enoma Amp" face listed first in --font-display.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderCompanyPage } from "../api/_lib/company-page.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = rel => fs.readFileSync(path.join(ROOT, rel), "utf8");

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { console.error(`  FAIL - ${name}`); console.error(err); process.exitCode = 1; }
}

const BIZ_FONTS_HREF = "https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@75..100,500..800&family=Inter:wght@400;500;600&display=swap";
const CUSTOMER_TEMPLATES = ["public/profile.html", "public/spotlight.html", "public/review.html"];
const CUSTOMER_CSS = ["public/styles/business-base.css", "public/styles/business-pages.css", "public/styles/quote-form.css"];
const OLD_FONTS = /Fraunces|DM Sans|DM\+Sans/;
const googleFontRequests = html => [...html.matchAll(/https:\/\/fonts\.googleapis\.com\/css2\?[^"')\s]+/g)].map(m => m[0]);

const PROFILE = {
  business_id: "11111111-1111-4111-8111-111111111111", username: "ralph-e-geiselman-plumbing",
  business_name: "Ralph E Geiselman Plumbing", is_claimed: true, primary_category: "plumbing",
  phone: "(508) 555-0100", city: "Attleboro", state: "MA", service_area: ["Attleboro"],
  services: [{ service_name: "Drain cleaning", service_description: "Clogged drains cleared." }],
};

console.log("customer pages: Archivo + Inter");

test("rendered company page loads Archivo + Inter in one request and never Fraunces/DM Sans", () => {
  const html = renderCompanyPage(read("public/profile.html"), PROFILE, { slug: PROFILE.username });
  assert.deepEqual(googleFontRequests(html), [BIZ_FONTS_HREF]);
  assert.match(html, /Archivo/);
  assert.doesNotMatch(html, OLD_FONTS);
});

test("every customer template makes the same single font request", () => {
  for (const rel of CUSTOMER_TEMPLATES) {
    const html = read(rel);
    assert.deepEqual(googleFontRequests(html), [BIZ_FONTS_HREF], rel);
    assert.doesNotMatch(html, OLD_FONTS, rel);
  }
});

test("customer stylesheets don't import or name Fraunces/DM Sans", () => {
  for (const rel of CUSTOMER_CSS) {
    const css = read(rel);
    assert.doesNotMatch(css, OLD_FONTS, rel);
    assert.doesNotMatch(css, /@import/, rel);
  }
});

test("font families are defined once, in business-pages.css", () => {
  const defs = [...CUSTOMER_TEMPLATES, ...CUSTOMER_CSS]
    .flatMap(rel => [...read(rel).matchAll(/--biz-font-(display|body)\s*:\s*([^;]+);/g)].map(m => [rel, m[1], m[2].trim()]));
  assert.deepEqual(defs.map(([rel, name]) => [rel, name]), [
    ["public/styles/business-pages.css", "display"],
    ["public/styles/business-pages.css", "body"],
  ]);
  assert.match(defs[0][2], /^'Archivo'/);
  assert.match(defs[1][2], /^'Inter'/);
});

console.log("Enoma pages: Fraunces with a plain ampersand");

test("enoma.css declares the Enoma Amp face and lists it first in --font-display", () => {
  const css = read("public/styles/enoma.css");
  const face = css.match(/@font-face\s*\{[^}]*font-family:\s*"Enoma Amp"[^}]*\}/);
  assert.ok(face, "Enoma Amp @font-face");
  assert.match(face[0], /src:\s*url\("\/fonts\/instrument-sans-amp\.woff2"\)\s*format\("woff2"\)/);
  assert.match(face[0], /unicode-range:\s*U\+0026;/);
  assert.match(face[0], /font-weight:\s*400 800;/);
  assert.match(face[0], /font-display:\s*swap;/);
  const display = css.match(/--font-display:\s*([^;]+);/);
  assert.ok(display, "--font-display");
  const families = display[1].split(",").map(s => s.trim());
  assert.equal(families[0], '"Enoma Amp"');
  assert.equal(families[1], "'Fraunces'");
});

test("the ampersand font file is committed and is WOFF2", () => {
  const buf = fs.readFileSync(path.join(ROOT, "public/fonts/instrument-sans-amp.woff2"));
  assert.equal(buf.subarray(0, 4).toString("latin1"), "wOF2");
  assert.ok(buf.length < 4096, `expected a tiny subset, got ${buf.length} bytes`);
});

test("no Enoma page sets Fraunces inline instead of using --font-display", () => {
  const files = [];
  const walk = dir => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = path.posix.join(dir, e.name);
      if (e.isDirectory()) walk(rel);
      else if (/\.(html|css|js|mjs)$/.test(e.name)) files.push(rel);
    }
  };
  ["public", "api", "scripts"].forEach(walk);
  // starter-logo.js draws SVG logos owners may already have picked; out of scope.
  const allowed = new Set(["api/_lib/starter-logo.js"]);
  const offenders = files.filter(rel => !allowed.has(rel))
    .filter(rel => /font-family\s*[:=]\s*["']?(?:\\?['"])?Fraunces/i.test(read(rel)));
  assert.deepEqual(offenders, []);
});

console.log(`\n${passed} passed`);
