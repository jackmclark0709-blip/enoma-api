// Run with: node tests/guides.test.js (also wired into `npm test`)
// Guards the things that make guides work for SEO/AEO and tracking:
// one CTA wording, visible FAQs matching FAQ schema, no utm_* on internal
// links, internal links that resolve, and sane title/description lengths.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { GUIDES, CTA_LABEL } from "../data/guides.mjs";
import { renderGuide } from "../scripts/build-guides.mjs";

const slugs = new Set(GUIDES.map(g => g.slug));
assert.equal(slugs.size, GUIDES.length, "duplicate guide slug");

for (const g of GUIDES) {
  const html = renderGuide(g);
  const name = g.slug;

  // Committed output is up to date with the source data.
  const file = `public/for/${g.slug}.html`;
  assert.ok(existsSync(file), `${name}: run node scripts/build-guides.mjs`);
  assert.equal(readFileSync(file, "utf8"), html, `${name}: generated HTML is stale — run node scripts/build-guides.mjs`);

  assert.ok(g.title.length <= 75, `${name}: title too long (${g.title.length})`);
  assert.ok(g.description.length >= 110 && g.description.length <= 165, `${name}: description length ${g.description.length}`);

  // One CTA wording; every signup link carries a data-cta position.
  const signupLinks = html.match(/<a href="\/get-your-website"[^>]*>/g) || [];
  assert.ok(signupLinks.length >= 3, `${name}: expected hero, inline and final CTAs`);
  for (const a of signupLinks) assert.match(a, /data-cta="/, `${name}: CTA missing data-cta: ${a}`);
  assert.equal((html.match(new RegExp(CTA_LABEL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length, 2, `${name}: hero + final buttons use CTA_LABEL`);
  assert.ok(!/Build my page free|Get my free page|free website/i.test(g.article + g.ctaSub + g.heroSub), `${name}: old "free" CTA wording`);

  // Internal links: no UTMs (they break GA4 attribution), and they resolve.
  for (const [, href] of html.matchAll(/href="(\/[^"]*)"/g)) {
    assert.ok(!/utm_/.test(href), `${name}: utm on internal link ${href}`);
    const m = href.match(/^\/for\/([a-z0-9-]+)$/);
    if (m) assert.ok(existsSync(`public/for/${m[1]}.html`) || slugs.has(m[1]), `${name}: broken link ${href}`);
  }

  // FAQ schema parses and matches the visible FAQ questions.
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map(m => JSON.parse(m[1]));
  const faq = blocks.find(b => b["@type"] === "FAQPage");
  assert.ok(faq, `${name}: no FAQPage schema`);
  assert.ok(faq.mainEntity.length >= 4, `${name}: fewer than 4 FAQs`);
  for (const q of faq.mainEntity) assert.ok(html.includes(q.name.replace(/"/g, "&quot;")), `${name}: FAQ not visible: ${q.name}`);
  assert.ok(blocks.find(b => b["@type"] === "Article"), `${name}: no Article schema`);

  // Exactly one h1.
  assert.equal((html.match(/<h1/g) || []).length, 1, `${name}: h1 count`);
}
console.log(`guides: ${GUIDES.length} ok`);
