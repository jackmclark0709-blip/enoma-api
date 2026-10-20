// Run with: node tests/town-pages.test.js (also wired into `npm test`)
import assert from "node:assert/strict";
import fs from "node:fs";
import { TRADES, pageSlug, localFindings, siblings, renderTownPage } from "../api/_lib/town-pages.js";
import { TOWN_PAGE_SLUGS } from "../api/_lib/town-pages-slugs.js";

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (err) { console.error(`FAIL: ${name}`); throw err; }
}

const data = JSON.parse(fs.readFileSync(new URL("../data/town-pages.json", import.meta.url), "utf8"));

test("slugs read naturally and are unique", () => {
  assert.equal(pageSlug({ trade: "landscaping", city: "North Attleborough", st: "MA" }), "website-for-landscapers-north-attleborough-ma");
  assert.equal(pageSlug({ trade: "hvac contractor", city: "Pawtucket", st: "RI" }), "website-for-hvac-contractors-pawtucket-ri");
  const all = data.pairs.map(pageSlug);
  assert.equal(new Set(all).size, all.length);
});

test("every data pair uses a known trade", () => {
  for (const p of data.pairs) assert.ok(TRADES[p.trade], p.trade);
});

test("generated slug list matches the data (rebuild after editing data)", () => {
  assert.deepEqual(TOWN_PAGE_SLUGS, data.pairs.filter(p => !p.retired).map(pageSlug));
});

test("findings state only what the numbers support", () => {
  const f = localFindings({ trade: "landscaping", city: "Rehoboth", st: "MA", n: 27, noSite: 6, weakSite: 8, avgRating: 4.3 }, "October 2026").join(" ");
  assert.match(f, /27 landscapers in Rehoboth/);
  assert.match(f, /Six of them had no website/);
  assert.match(f, /At least eight more/);
  assert.match(f, /4\.3 stars/);
  const none = localFindings({ trade: "roofing contractor", city: "Smithfield", st: "RI", n: 5, noSite: 0, weakSite: 0, avgRating: 4.9 }, "October 2026").join(" ");
  assert.doesNotMatch(none, /no website at all/);
  assert.match(none, /Most of them already have a website/);
  const low = localFindings({ trade: "plumber", city: "Norton", st: "MA", n: 5, noSite: 0, weakSite: 1, avgRating: 3.4 }, "October 2026").join(" ");
  assert.doesNotMatch(low, /average Google rating/);
});

test("retired town pages are not built and are redirected", () => {
  const vercel = JSON.parse(fs.readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  const redirected = new Set(vercel.redirects.map(r => r.source));
  for (const p of data.pairs.filter(x => x.retired)) {
    const slug = pageSlug(p);
    assert.ok(!fs.existsSync(new URL(`../public/for/${slug}.html`, import.meta.url)), `${slug} should not be built`);
    assert.ok(redirected.has(`/for/${slug}`), `${slug} needs a redirect`);
  }
});

test("siblings are the same trade in other towns, max 5", () => {
  const p = data.pairs.find(x => x.trade === "landscaping" && x.city === "Rehoboth");
  const s = siblings(p, data.pairs);
  assert.ok(s.length > 0 && s.length <= 5);
  for (const o of s) { assert.equal(o.trade, "landscaping"); assert.notEqual(o.city, "Rehoboth"); }
});

test("a rendered page has the right title, canonical, price and no old pricing", () => {
  const p = data.pairs[0];
  const html = renderTownPage(p, data);
  assert.match(html, /<title>Website for Landscapers in Rehoboth, MA \| Enoma<\/title>/);
  assert.ok(html.includes('rel="canonical" href="https://enoma.io/for/website-for-landscapers-rehoboth-ma"'));
  assert.ok(html.includes('"price":"19.99"'));
  assert.match(html, /First month free/);
  assert.doesNotMatch(html, /\$49|\$99|free forever|for good/i);
  // valid JSON-LD
  for (const m of html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)) JSON.parse(m[1]);
});

console.log(`town-pages: ${passed} tests passed`);
