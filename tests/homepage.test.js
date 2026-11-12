// Run with: node tests/homepage.test.js (also wired into `npm test`)
// The enoma.io homepage (public/index.html), Nov 2026 refresh: "$1 first
// month" pricing copy, trade chips built from data/guides.mjs, and the
// Operating Doc copy rules (full price line next to every "$1", nothing
// "built from your Google listing", no customer names, no ranking or AI
// recommendation promises).
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { TRADE_PAGES, HOMEPAGE_TRADE_CHIPS } from "../data/guides.mjs";
import { renderTradeChips, TRADE_CHIPS_START, TRADE_CHIPS_END } from "../scripts/build-guides.mjs";
import { PRICE_LINE } from "../api/_lib/pricing.js";

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { console.error(`  FAIL - ${name}`); console.error(err.message); process.exitCode = 1; }
}

const html = readFileSync("public/index.html", "utf8");
const DOLLAR_ONE = /\$1(?![\d,.])/;
const stripTags = (s) => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");

// Each place a price can be seen on its own: a <section>, a <meta> tag, a
// JSON-LD script.
function blocks(src) {
  return [
    ...[...src.matchAll(/<section[\s\S]*?<\/section>/g)].map((m) => ({ kind: "section", text: m[0] })),
    ...[...src.matchAll(/<meta[^>]+content="([^"]*)"/g)].map((m) => ({ kind: "meta", text: m[1] })),
    ...[...src.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => ({ kind: "json-ld", text: m[1] })),
  ];
}

test("no old pricing copy on the homepage", () => {
  assert.doesNotMatch(html, /first month (is )?free|free month|free to start|\$0 to start|no credit card|free trial/i);
  assert.doesNotMatch(stripTags(html), /\$0 to start/i);
});

test("the full price line is in the same view wherever $1 appears", () => {
  const withDollarOne = blocks(html).filter((b) => DOLLAR_ONE.test(stripTags(b.text)));
  assert.ok(withDollarOne.length >= 5, "hero, system section, FAQ, final CTA, meta");
  for (const b of withDollarOne) {
    assert.ok(stripTags(b.text).includes(PRICE_LINE), `${b.kind} without the full price line: ${stripTags(b.text).slice(0, 120)}`);
  }
});

test("hero: new headline and subhead, CTAs and search bar kept, price line under the CTAs", () => {
  assert.match(stripTags(html), /Get found on Google and in AI answers\. Get the call, not a shared lead\./);
  assert.ok(html.includes("Someone searching for a business like yours, on Google or by asking ChatGPT, finds a page built for your trade and town, and the call comes straight to you."));
  assert.ok(html.includes("See your page in 30 seconds →"));
  assert.ok(html.includes("See live examples"));
  assert.ok(html.includes('id="queryText"'));
  assert.ok(html.includes("Not techy? We'll set it up with you."));
  const hero = html.slice(html.indexOf('<section class="hero">'), html.indexOf("</section>"));
  assert.ok(stripTags(hero).includes(PRICE_LINE));
  assert.match(stripTags(hero), /No per-lead fees · No contract/);
});

test("search bar alternates Google and AI questions, and stays on Google with reduced motion", () => {
  assert.match(html, /kind: 'Google', text: '"landscaper near me"'/);
  assert.match(html, /kind: 'Ask AI', text: '"Who\\'s a good landscaper in Attleboro\?"'/);
  const script = html.slice(html.indexOf("cycling search hook"), html.indexOf("product-preview mock bar chart"));
  assert.match(script, /prefers-reduced-motion: reduce\)'\)\.matches;\s*if \(reduced\) return;/);
  assert.match(html, /id="queryKind">Google</);
});

test("trade chips are rendered from data/guides.mjs, and only link to /for/ pages that exist", () => {
  const start = html.indexOf(TRADE_CHIPS_START);
  const end = html.indexOf(TRADE_CHIPS_END);
  assert.ok(start > 0 && end > start, "markers present");
  const block = html.slice(start + TRADE_CHIPS_START.length, end).trim();
  assert.equal(block, renderTradeChips().trim(), "re-run node scripts/build-guides.mjs");
  const hrefs = [...block.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  const chips = hrefs.filter((h) => h !== "/for/");
  assert.ok(chips.length > 0 && chips.length <= HOMEPAGE_TRADE_CHIPS);
  for (const h of chips) {
    const slug = h.replace(/^\/for\//, "");
    assert.ok(TRADE_PAGES.some((t) => t.slug === slug), `${h} not in TRADE_PAGES`);
    assert.ok(existsSync(join("public", "for", `${slug}.html`)), `${h} has no page`);
  }
  // "More trades" only when there's an index to go to (or more than fit).
  assert.equal(hrefs.includes("/for/"), existsSync("public/for/index.html") || TRADE_PAGES.length > HOMEPAGE_TRADE_CHIPS);
  // The chips sit directly under the hero CTAs.
  const hero = html.slice(html.indexOf('<section class="hero">'), html.indexOf("</section>"));
  assert.ok(hero.indexOf("hero__actions") < hero.indexOf("trade-chips") && hero.indexOf("trade-chips") < hero.indexOf("hero__proof"));
});

test("renderTradeChips skips trades without a page and caps the count", () => {
  const fake = [{ label: "Nope", slug: "no-such-page" }, ...TRADE_PAGES];
  assert.doesNotMatch(renderTradeChips(fake), /no-such-page/);
  const many = Array.from({ length: 10 }, () => TRADE_PAGES[0]);
  const out = renderTradeChips(many, { max: 8 });
  assert.equal((out.match(/class="trade-chip"/g) || []).length, 8);
  assert.match(out, /More trades →/);
});

test("system section replaces 'One page, built for one job', with the $1 stat", () => {
  assert.doesNotMatch(html, /One page, built for one job/);
  assert.match(stripTags(html), /More than a website\. Getting found, handled\./);
  assert.ok(html.includes("Showing up when customers search isn't a one-time job. Enoma keeps working after your page goes live."));
  const tiles = [...html.matchAll(/<h3 class="systemtile__title">([^<]+)<\/h3>/g)].map((m) => m[1]);
  assert.ok(tiles.length >= 4 && tiles.length <= 6);
  assert.match(html, /statline__num">\$1<\/div><div class="statline__label">first month/);
  assert.match(html, /statline__num">\$0<\/div><div class="statline__label">per lead, ever/);
  assert.match(html, /competitors on your page/);
});

test("promises strip", () => {
  assert.match(html, /<h2>Our promises<\/h2>/);
  for (const p of ["See your page before you pay.", "Your business, in your words. Edit anything.", "Nothing goes on Google without your OK.", "No per-lead fees, no contract. Cancel anytime."]) {
    assert.ok(html.includes(`<li>${p}</li>`), p);
  }
});

test("How it works and the walkthrough say no card is needed to see your page", () => {
  assert.ok(html.includes("No card needed to see your page."));
});

test("FAQ: honest Google answer with the $1 line, its own AI-assistant question, schema in step", () => {
  const faqs = [...html.matchAll(/<summary>([^<]+)<svg/g)].map((m) => m[1]);
  assert.ok(faqs.includes("Will this help me show up in ChatGPT and other AI assistants?"));
  const schema = JSON.parse(html.match(/<script type="application\/ld\+json" id="faq-schema">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(schema.mainEntity.map((q) => q.name), faqs.map((q) => q.replace(/&#x27;|&#39;/g, "'")));
  const google = schema.mainEntity.find((q) => q.name === "Will this actually get me on Google?").acceptedAnswer.text;
  assert.match(google, /No one can honestly promise you a ranking/);
  assert.match(google, /first month is \$1/);
  const gbp = schema.mainEntity.find((q) => /Google Business Profile/.test(q.name)).acceptedAnswer.text;
  assert.doesNotMatch(gbp, /ChatGPT|AI assistant/, "AI moved to its own FAQ");
  const ai = schema.mainEntity.find((q) => /ChatGPT/.test(q.name)).acceptedAnswer.text;
  assert.match(ai, /Nobody can guarantee what an AI assistant recommends/);
});

test("founder section and the per-lead comparison are kept", () => {
  assert.ok(html.includes("A real person, not a call center."));
  assert.ok(html.includes("Lead sites (Angi, Thumbtack, Yelp)"));
});

// ── Copy guard (Operating Doc) ──
test("copy guard: no 'Google listing', no customer names", () => {
  assert.doesNotMatch(html, /google listing/i);
  assert.doesNotMatch(html, /conway/i);
});

test("copy guard: 'guarantee' only in the honest negative FAQ; no ranking or AI-recommendation promises", () => {
  const text = stripTags(html);
  const guarantees = [...text.matchAll(/[^.]*\bguarantee\w*[^.]*\./gi)].map((m) => m[0].trim());
  assert.ok(guarantees.length > 0);
  for (const g of guarantees) assert.match(g, /^Nobody can guarantee what an AI assistant recommends/, g);
  assert.doesNotMatch(text, /(rank|get you) (#|number )?1\b|top of google|first page of google|page one of google/i);
  assert.doesNotMatch(text, /(chatgpt|ai assistants?) will (recommend|suggest|send)/i);
  assert.doesNotMatch(text, /\b\d+% more (calls|leads)|\b\d+ (new )?leads\b/i);
});

// ── Price copy everywhere else ──
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.html$/.test(name)) out.push(p);
  }
  return out;
}

test("no public page still sells the old free month", () => {
  const re = /first month (is )?(completely )?free|free month|free to start|month on us|30-day free trial|first 30 days are completely free/i;
  const hits = [...walk("public"), "data/guides.mjs"].flatMap((f) => readFileSync(f, "utf8").split("\n")
    .map((line, i) => (re.test(line) ? `${f}:${i + 1}` : null)).filter(Boolean))
    // Legacy owners still see their own free month in the dashboard and on /website-live.
    .filter((h) => !/^public\/(dashboard\/index|website-live\/index|upgrade\/index)\.html/.test(h));
  assert.deepEqual(hits, []);
});

test("every public page that shows $1 also shows the full price line", () => {
  const missing = walk("public").filter((f) => !f.startsWith("public/admin/")).filter((f) => {
    const t = stripTags(readFileSync(f, "utf8"));
    return DOLLAR_ONE.test(t) && !t.includes(PRICE_LINE);
  });
  assert.deepEqual(missing, []);
});

console.log(`homepage: ${passed} passed`);
