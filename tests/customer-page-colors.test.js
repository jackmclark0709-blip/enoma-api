// Run with: node tests/customer-page-colors.test.js (also wired into `npm test`)
// Who uses which color on a customer page (enoma.io/<slug>, Service
// Spotlights, the page inside /<slug>/preview):
//   --brand-cta*     filled call-to-action buttons, and nothing else
//   --brand-primary  the identity color, small accents only
//   --ink / --line   everything else
// Checks the CSS the page actually loads (its <style> blocks plus the three
// shared stylesheets) against a rendered company page, plus the header's
// starter logo and the hero's trust-badge chips.

import assert from "node:assert/strict";
import fs from "node:fs";
import { renderCompanyPage, renderBlocks, headerLogo, heroBadges } from "../api/_lib/company-page.js";
import { brandColorStyle, AMBER, TEAL } from "../api/_lib/page-style.js";
import { cssRules, inlineCss } from "./_css-rules.js";

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { console.error(`  FAIL - ${name}`); console.error(err); process.exitCode = 1; }
}
const read = rel => fs.readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

const PROFILE = {
  business_id: "11111111-1111-4111-8111-111111111111", username: "let-it-roll-painting", business_name: "Let It Roll Painting",
  is_claimed: true, primary_category: "painting", phone: "(508) 555-0100", city: "Attleboro", state: "MA",
  service_area: ["Attleboro", "Norton"], about: "We paint houses.\n\nInside and out.", why_choose_us: "Owner on every job\nClean job sites",
  services: [{ service_name: "Interior painting", service_description: "Walls and trim." }],
  faqs: [{ q: "Do you do cabinets?", a: "Yes." }],
  trust_badges: ["Licensed & insured", "Free color consults", "15 years in business", "Family owned"],
};
const html = renderCompanyPage(read("public/profile.html"), PROFILE, {
  slug: PROFILE.username, head: { "{{BRAND_COLOR_STYLE}}": brandColorStyle(PROFILE) },
});

// Every rule the company page loads, in cascade order.
const PAGE_CSS = [
  ["business-base.css", read("public/styles/business-base.css")],
  ["business-pages.css", read("public/styles/business-pages.css")],
  ["profile.html", inlineCss(html)],
  ["quote-form.css", read("public/styles/quote-form.css")],
].flatMap(([file, css]) => cssRules(css).map(r => ({ file, ...r })));
const SPOTLIGHT_CSS = [
  ["business-pages.css", read("public/styles/business-pages.css")],
  ["quote-form.css", read("public/styles/quote-form.css")],
  ["spotlight.html", inlineCss(read("public/spotlight.html"))],
].flatMap(([file, css]) => cssRules(css).map(r => ({ file, ...r })));

const USES_CTA = /var\(--brand-cta/;
const USES_BRAND = /var\(--brand-(primary|cta)/;
const base = sel => sel.replace(/:(hover|focus-visible|focus|active)$/, "");

// The filled CTAs, and only these (hover states included).
const CTA_SELECTORS = new Set([
  ".contact-pill.call",                          // header Call pill
  ".primary-cta",                                // hero primary button, Service Spotlight primary buttons
  ".mobile-call-bar .mcb-call",                  // mobile call bar Call
  ".quote-form-wrap .qf-call",                   // quote form Call
  ".quote-form-wrap button.qf-next",             // quote form Next
  ".quote-form-wrap button.qf-submit",           // quote form Send
]);

await test("--brand-cta is used only by the filled call-to-action selectors", () => {
  for (const r of [...PAGE_CSS, ...SPOTLIGHT_CSS]) {
    if (r.selectors.some(s => s === ":root")) continue; // the token definitions
    if (!USES_CTA.test(r.body)) continue;
    for (const s of r.selectors) assert.ok(CTA_SELECTORS.has(base(s)), `${r.file}: "${s}" uses --brand-cta`);
  }
  const used = new Set([...PAGE_CSS, ...SPOTLIGHT_CSS].filter(r => USES_CTA.test(r.body) && !r.selectors.includes(":root")).flatMap(r => r.selectors.map(base)));
  assert.deepEqual([...used].sort(), [...CTA_SELECTORS].sort(), "every CTA selector is styled");
});

await test("no stylesheet hard-codes a CTA color outside the :root defaults", () => {
  const ctaHex = new RegExp(`${AMBER.cta}|${TEAL.cta}`, "i");
  for (const r of [...PAGE_CSS, ...SPOTLIGHT_CSS]) {
    if (r.selectors.includes(":root")) continue;
    assert.doesNotMatch(r.body, ctaHex, `${r.file}: ${r.selectors.join(", ")}`);
  }
});

await test("the rendered page has each CTA, with the classes the CTA rules target", () => {
  assert.match(html, /<a class="contact-pill call" href="tel:5085550100"/, "header Call pill");
  assert.match(html, /<div class="hero-actions" id="primaryAction"><a class="primary-cta" href="tel:5085550100"/, "hero primary");
  assert.match(html, /<a class="mcb-call" href="tel:5085550100"/, "mobile call bar");
  assert.match(html, /<a class="qf-call" href="tel:5085550100"/, "quote form Call");
  assert.match(html, /<button type="button" class="qf-next"/, "quote form Next");
  assert.match(html, /<button type="submit" class="qf-submit"/, "quote form Send");
  // Secondary actions stay outlined, not CTA-filled.
  assert.match(html, /<a class="contact-pill text"/);
  assert.match(html, /<a class="contact-pill quote"/);
  assert.match(html, /<a class="secondary-btn" href="#contact" data-contact="quote">Get a quote<\/a>/);
  assert.ok(html.includes(`--brand-cta: ${AMBER.cta};`), "the page sets its CTA color");
});

await test("the hero primary button has its own drop shadow; CTAs are weight 800", () => {
  assert.ok(PAGE_CSS.some(r => r.selectors.includes(".hero-actions .primary-cta") && /box-shadow:\s*0 6px 18px rgba\(0,0,0,\.25\)/.test(r.body)));
  for (const r of PAGE_CSS) {
    if (!USES_CTA.test(r.body) || !/background:\s*var\(--brand-cta\)/.test(r.body) || r.selectors.some(s => /:hover$/.test(s))) continue;
    if (r.selectors.includes(".contact-pill.call") && /:hover/.test(r.selectors.join())) continue;
    assert.match(r.body, /font-weight:\s*800/, `${r.file}: ${r.selectors.join(", ")}`);
  }
});

// Neutral elements: no rule that styles them may use the brand or CTA color.
const NEUTRAL_TARGETS = {
  "h2 headings": s => /(^|[\s>])(h2|\.faq-heading)$/.test(base(s)),
  "about lead": s => /\.about-lead$/.test(base(s)),
  "why-list checkmarks": s => /\.why-list li::before$/.test(s),
  "town chips": s => /\.town$/.test(base(s)),
  "FAQ icons": s => /\.faq-icon$/.test(base(s)),
  "how-it-works numbers": s => /\.how-step__n$/.test(base(s)),
  "service meta chips": s => /\.service-meta span$/.test(base(s)),
  "social links": s => /\.social-link$/.test(base(s)),
  "trust-fact icons": s => /\.trust-fact \.icon$/.test(base(s)),
  "quote form step label": s => /\.qf-progress$/.test(base(s)),
};

await test("h2, about lead, checkmarks, town chips, FAQ icons (and the other neutrals) use neither --brand-primary nor --brand-cta", () => {
  for (const [what, matches] of Object.entries(NEUTRAL_TARGETS)) {
    const rules = PAGE_CSS.filter(r => r.selectors.some(matches));
    assert.ok(rules.length, `${what}: some rule styles it`);
    for (const r of rules) assert.doesNotMatch(r.body, USES_BRAND, `${what} — ${r.file}: ${r.selectors.join(", ")}`);
  }
  // …and those elements are on the rendered page.
  for (const needle of ['id="servicesHeading"', 'class="about-lead"', 'class="why-list"', 'class="town"', 'class="faq-icon"', 'class="how-step__n"']) {
    assert.ok(html.includes(needle), needle);
  }
});

await test("the identity color is limited to small accents: section bars, the name underline, quote bars, the service-card link", () => {
  const allowed = [/::before$/, /::after$/, /^\.service-quote$/, /^\.testimonial$/, /^\.sp-quote$/];
  for (const r of [...PAGE_CSS, ...SPOTLIGHT_CSS]) {
    if (r.selectors.includes(":root") || !/var\(--brand-primary\b/.test(r.body)) continue;
    for (const s of r.selectors) assert.ok(allowed.some(re => re.test(s)), `${r.file}: "${s}" uses --brand-primary`);
  }
});

await test("footer uses the hero's dark color, not a fixed navy", () => {
  const footer = PAGE_CSS.filter(r => r.selectors.includes(".site-footer") && /background/.test(r.body)).at(-1);
  assert.match(footer.body, /background:\s*var\(--hero-bg/);
});

console.log("header logo");

await test("no logo_url: the starter logo inline as SVG, named by the business name", () => {
  const h = headerLogo({ business_name: "Arno & Sons Plumbing", primary_category: "plumbing" });
  assert.match(h, /^<span id="businessName" class="brand-logo"><svg class="nav-starter-logo" focusable="false" xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(h, /role="img" aria-label="Arno &amp; Sons Plumbing"/);
  assert.match(h, /<title>Arno &amp; Sons Plumbing<\/title>/);
  assert.match(h, /font-family="Archivo, system-ui/);
  assert.doesNotMatch(h, /<img/);
  // The chosen style is used.
  assert.doesNotMatch(headerLogo({ business_name: "Arno", starter_logo_id: "wordmark" }), /<rect x="0" y="[\d.]+" width="64"/);
  assert.match(headerLogo({ business_name: "Arno" }), /<rect x="0" y="[\d.]+" width="64" height="64"/, "badge by default");
});

await test("logo_url set: an <img>, no starter logo", () => {
  const h = headerLogo({ business_name: "Arno Plumbing", logo_url: "https://cdn.example.com/logo.png" });
  assert.equal(h, '<img id="navLogo" class="nav-logo" src="https://cdn.example.com/logo.png" alt="Arno Plumbing" width="140" height="30" />');
  const block = renderBlocks({ business_name: "Arno Plumbing", logo_url: "https://cdn.example.com/logo.png" })["{{BLOCK_HEADER}}"];
  assert.doesNotMatch(block, /<svg class="nav-starter-logo"/);
});

await test("the starter logo is capped at 40px in the header", () => {
  const r = PAGE_CSS.find(x => x.selectors.includes(".nav-starter-logo"));
  assert.match(r.body, /height:\s*40px/);
});

console.log("hero proof chips");

await test("no strong rating: up to 3 of the owner's trust_badges as chips under the tagline", () => {
  const hero = renderBlocks({ ...PROFILE, hero_tagline: "Interior and exterior painting." })["{{BLOCK_HERO}}"];
  assert.match(hero, /<p id="tagline" class="hero-tagline">Interior and exterior painting\.<\/p>\s*<ul class="hero-badges" id="heroBadges"/);
  const chips = [...hero.matchAll(/<li class="hero-badge"><span class="hero-badge__check" aria-hidden="true">✓<\/span>([^<]*)<\/li>/g)].map(m => m[1]);
  assert.deepEqual(chips, ["Licensed &amp; insured", "Free color consults", "15 years in business"]);
});

await test("a strong rating: no chips (the rating leads)", () => {
  const p = { ...PROFILE, average_rating: 4.8, review_count: 40 };
  assert.deepEqual(heroBadges(p), []);
  assert.doesNotMatch(renderBlocks(p)["{{BLOCK_HERO}}"], /hero-badges/);
});

await test("no trust_badges: no chips, nothing invented", () => {
  for (const tb of [undefined, null, [], ["", "  "]]) {
    assert.deepEqual(heroBadges({ ...PROFILE, trust_badges: tb }), []);
    assert.doesNotMatch(renderBlocks({ ...PROFILE, trust_badges: tb })["{{BLOCK_HERO}}"], /hero-badges/);
  }
});

await test("chips are light-on-dark with a ✓ in the palette's light color", () => {
  const r = PAGE_CSS.find(x => x.selectors.includes(".hero-badge"));
  assert.match(r.body, /background:\s*rgba\(255,255,255,\.08\)/);
  assert.match(r.body, /border:\s*1px solid rgba\(255,255,255,\.18\)/);
  assert.match(PAGE_CSS.find(x => x.selectors.includes(".hero-badge__check")).body, /color:\s*var\(--brand-light/);
});

console.log("service cards and fonts");

await test("service cards: no filled button; the card link keeps a 44px tap target", () => {
  const r = PAGE_CSS.find(x => x.selectors.includes(".service-card__link"));
  assert.match(r.body, /min-height:\s*44px/);
  const quote = PAGE_CSS.filter(x => x.selectors.includes(".service-quote")).at(-1);
  assert.doesNotMatch(quote.body, /background/);
  assert.match(quote.body, /color:\s*color-mix\(in srgb, var\(--brand-primary, #1a3a2a\), black 20%\)/);
});

await test("headings use the per-trade width; card titles, buttons and nav stay at 100%", () => {
  const h2 = PAGE_CSS.filter(r => r.selectors.includes(".section h2")).at(-1);
  assert.match(h2.body, /font-stretch:\s*var\(--biz-heading-stretch, 85%\)/);
  const h3 = PAGE_CSS.filter(r => r.selectors.includes(".section h3")).at(-1);
  assert.match(h3.body, /font-stretch:\s*100%/);
  for (const sel of [".primary-cta", ".contact-pill", ".secondary-btn"]) {
    const r = PAGE_CSS.filter(x => x.selectors.includes(sel) && /font-stretch/.test(x.body)).at(-1);
    assert.match(r.body, /font-stretch:\s*100%/, sel);
  }
});

console.log(`\n${passed} passed`);
