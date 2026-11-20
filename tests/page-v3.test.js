// Run with: node tests/page-v3.test.js (also wired into `npm test`)
// Page v3 (api/_lib/page-v3.js): each section's show/hide rules, from the
// hand-written fixtures in tests/fixtures/page-v3, which follow PR A's
// contract (fact_sheet + page_copy_v3, docs/website-v3-contract.md on
// feat/fact-sheet-v3). Plus the gates that keep v1 and v2 as they were: v3
// needs page_version 3 *and* copy, and the new template slots are empty on
// v1/v2.

import assert from "node:assert/strict";
import fs from "node:fs";
import {
  isPageV3, factsFor, copyFor, seasonalLine, heroMode, heroReview, pullQuote, pickServiceStock, summarizeHours, reviewExcerpt,
  stockTagFor, v3PageParts, localBusinessSchemaV3, areaMapSvg, estimateLabelV3, STOCK_MAX_BUSINESSES,
} from "../api/_lib/page-v3.js";
import { renderBlocks, renderCompanyPage, clientProfile, CONTACT_SECTION } from "../api/_lib/company-page.js";
import { kitFor } from "../api/_lib/brand-kit.js";
import { isPageV2, pageV2Fields, newOwnerToken } from "../api/_lib/owner-link.js";

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { console.error(`  FAIL - ${name}`); console.error(err); process.exitCode = 1; }
}
const read = rel => fs.readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const fixture = name => JSON.parse(read(`tests/fixtures/page-v3/${name}.json`));
const clone = o => JSON.parse(JSON.stringify(o));
const TEMPLATE = read("public/profile.html");
const NOV = new Date(2026, 10, 18);

// Small coordinate table so the map renders without reading data/towns.
const COORDS = [
  ["North Attleborough", "MA", 41.972, -71.33], ["Plainville", "MA", 42.004, -71.333], ["Mansfield", "MA", 42.022, -71.218],
  ["Attleboro", "MA", 41.931, -71.295], ["Cumberland", "RI", 41.967, -71.432], ["Ewing", "NJ", 40.265, -74.8],
];

function render(profile, ctx = {}) {
  const kit = kitFor(profile);
  const c = { slug: profile.username, spotlights: [], townCoords: COORDS, stockRows: [], stockUsage: {}, now: NOV, canonical: `https://enoma.io/${profile.username}`, ...ctx };
  const parts = v3PageParts(profile, kit, c);
  const html = renderCompanyPage(TEMPLATE, profile, { ...c, blocks: parts.blocks, schema: parts.schema, faqs: parts.faqs, head: { "{{BODY_CLASS}}": "page-v3", "{{V2_HEAD}}": parts.head, "{{BRAND_COLOR_STYLE}}": parts.style } });
  return { html, blocks: parts.blocks, schema: parts.schema };
}
const count = (html, re) => (html.match(re) || []).length;
const jsonLd = html => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));
const BODY_SLOTS = /\{\{(BLOCK|SSR|QUOTE|LOCAL|FAQ|PROFILE|V2|BRAND|BODY)_?[A-Z_]*\}\}/;

// ── Gates ────────────────────────────────────────────────────────────────

await test("v3 renders only with page_version 3 and written copy", () => {
  const a = fixture("arno");
  assert.equal(isPageV3(a), true);
  assert.equal(isPageV3({ ...a, page_version: 2 }), false);
  assert.equal(isPageV3({ ...a, page_copy_v3: null }), false, "no copy: renders as v2");
  assert.equal(isPageV3({ ...a, page_copy_v3: { hero_headline: " " } }), false);
});

await test("owner links, owner bar and kit apply to v3; promoting to v2 never downgrades a v3 page", () => {
  assert.equal(isPageV2({ page_version: 3 }), true);
  assert.equal(isPageV2({ page_version: 1 }), false);
  assert.equal(pageV2Fields({ page_version: 3 }).page_version, 3);
  assert.equal(pageV2Fields({ page_version: 1 }).page_version, 2);
  assert.equal(clientProfile({ page_version: 3 }).page_version, 3);
  assert.equal(clientProfile({ page_version: 7 }).page_version, 1);
});

await test("v1/v2 fill the new slots with nothing and keep their quote section as-is", () => {
  for (const slot of ["{{BLOCK_TOPBAR}}", "{{BLOCK_PROOF}}", "{{BLOCK_CLOSING}}"]) assert.equal(TEMPLATE.split(slot).length - 1, 1, slot);
  const b = renderBlocks({ business_name: "X", phone: "(555) 555-1212", username: "x" });
  assert.equal(b["{{BLOCK_TOPBAR}}"], "");
  assert.equal(b["{{BLOCK_PROOF}}"], "");
  assert.equal(b["{{BLOCK_CLOSING}}"], CONTACT_SECTION);
  const keys = Object.keys(b);
  assert.ok(keys.indexOf("{{BLOCK_CLOSING}}") < keys.indexOf("{{SSR_QUOTE_HEADING}}") && keys.indexOf("{{BLOCK_CLOSING}}") < keys.indexOf("{{QUOTE_FORM}}"), "closing is filled before the heading and form inside it");
  const html = renderCompanyPage(TEMPLATE, { business_name: "X", username: "x" }, {});
  assert.match(html, /<section class="section contact" id="contact"/);
  assert.doesNotMatch(html, /\{\{(BLOCK|SSR|QUOTE)_[A-Z_]*\}\}/, "every body slot filled");
});

// ── Contract → page ──────────────────────────────────────────────────────

await test("hours: Google's weekday lines → one short line and schema specs", () => {
  const every = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map(d => `${d}: 8:00 AM – 4:00 PM`);
  assert.deepEqual(summarizeHours(every), { text: "Open every day, 8am–4pm", spec: [{ days: [1, 2, 3, 4, 5, 6, 0], opens: "08:00", closes: "16:00" }] });
  const week = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map(d => `${d}: 7:30 AM – 5:00 PM`).concat(["Saturday: 9:00 AM – 12:00 PM", "Sunday: Closed"]);
  const h = summarizeHours(week);
  assert.equal(h.text, "Mon–Fri 7:30am–5pm · Sat 9am–12pm");
  assert.equal(h.spec.length, 2);
  assert.equal(summarizeHours(["Monday: Open 24 hours", "Tuesday: Open 24 hours", "Wednesday: Open 24 hours", "Thursday: Open 24 hours", "Friday: Open 24 hours", "Saturday: Open 24 hours", "Sunday: Open 24 hours"]).text, "Open 24 hours, every day");
  assert.equal(summarizeHours([]), null);
});

await test("reviews: the quotable, concrete part of a full Google review", () => {
  const russ = fixture("arno").fact_sheet.reviews[2].text;
  const ex = reviewExcerpt(russ);
  assert.match(ex.text, /^Not only did Peter answer his telephone on the first call/);
  assert.ok(ex.text.length <= 200);
  assert.equal(reviewExcerpt("Great job, fast and clean.").text, "Great job, fast and clean.");
  const long = reviewExcerpt(`${"word ".repeat(80)}end.`, 100).text;
  assert.ok(long.length <= 101 && long.endsWith("…"), "cut at a word, with an ellipsis");
});

await test("stock_subject briefs map to the stock library's tags", () => {
  assert.equal(stockTagFor("copper pipe repair close-up", "Leaks and broken pipes", "plumbing"), "plumbing/pipes");
  assert.equal(stockTagFor("drain cleaning machine at work", "Backed-up drains", "plumbing"), "plumbing/drain");
  assert.equal(stockTagFor("boiler gauge close-up", "Heating", "plumbing"), "plumbing/boiler");
  assert.equal(stockTagFor("fresh asphalt driveway", "Asphalt paving", "contractor"), "contractor/paving");
  assert.equal(stockTagFor("anything", "Anything", "default"), "", "no library for the persona");
});

await test("copy items without evidence ids aren't shown", () => {
  const a = clone(fixture("arno"));
  a.page_copy_v3.services[0].evidence = [];
  a.page_copy_v3.faqs[0].evidence = undefined;
  a.page_copy_v3.proof[2].evidence = [];
  const facts = factsFor(a), copy = copyFor(a, facts);
  assert.deepEqual(facts.services.map(s => s.name), ["Backed-up drains and sewer lines", "Heating"]);
  assert.ok(!copy.faqs.some(f => f.q === "How soon can you come out?"), "AI question without evidence dropped");
  assert.ok(copy.faqs.some(f => f.q === "My sink, toilet and tub are all backing up. Can you help?"), "evidence-backed AI question kept");
  assert.equal(copy.proof.length, 2);
  const o = clone(fixture("let-it-roll")); o.page_copy_v3.owner_section.evidence = [];
  assert.equal(copyFor(o).owner_section, null);
});

// ── Arno: the full page ──────────────────────────────────────────────────

await test("Arno: every section from real content, nothing left over", () => {
  const { html } = render(fixture("arno"));
  assert.doesNotMatch(html, BODY_SLOTS, "no unfilled body slots");
  assert.equal(count(html, /data-quote-form/g), 1, "one quote form");
  assert.equal(count(html, /id="contact"/g), 1, "one #contact");
  assert.match(html, /<body class="page-v3"/);
  const body = html.slice(html.indexOf("<body"));
  for (const id of ["services", "reviews", "area", "faqs"]) assert.match(body, new RegExp(`id="${id}"`), id);
  for (const gone of ['id="howItWorks"', 'id="aboutSection"', 'id="trustStrip"', 'id="owner"', 'id="work"']) assert.ok(!body.includes(gone), gone);
  assert.match(html, /No heat\? Call us\./, "heating line in November");
  assert.match(html, /Open every day, 8am–4pm · North Attleborough, MA/);
  assert.match(html, /What we fix/);
});

await test("menu links only to sections that render", () => {
  const { blocks } = render(fixture("arno"));
  const nav = blocks["{{BLOCK_HEADER}}"].match(/<nav class="v3-nav"[\s\S]*?<\/nav>/)[0];
  assert.deepEqual([...nav.matchAll(/>([^<]+)<\/a>/g)].map(m => m[1]), ["Services", "Reviews", "Area", "Contact"], "no Our work without photos");
  assert.equal(count(blocks["{{BLOCK_HEADER}}"], /v3-btn--cta/g), 1, "one estimate button");
  const cr = render(fixture("c-ryan")).blocks["{{BLOCK_HEADER}}"].match(/<nav class="v3-nav"[\s\S]*?<\/nav>/)[0];
  assert.deepEqual([...cr.matchAll(/>([^<]+)<\/a>/g)].map(m => m[1]), ["Services", "Area", "Contact"], "no Reviews without reviews");
});

await test("one estimate label everywhere: free only when the owner says so", () => {
  const arno = render(fixture("arno")).html;
  assert.ok(!/free estimate/i.test(arno.slice(arno.indexOf("<body"))), "Arno never says free");
  assert.ok(arno.includes("Get an estimate"));
  const lir = render(fixture("let-it-roll")).html;
  assert.ok(lir.includes("Get a free estimate"));
  assert.ok(!lir.includes("Get an estimate"), "no mixed labels");
  assert.equal(estimateLabelV3(factsFor({ fact_sheet: { owner: { offers_free_estimates: null } } })), "Get an estimate");
});

// ── Hero ─────────────────────────────────────────────────────────────────

await test("hero: owner photo + review card → review card alone → estimate form; placeholder photo behind", () => {
  const a = fixture("arno");
  assert.equal(heroMode(factsFor(a)), "review");
  const hero = render(a).blocks["{{BLOCK_HERO}}"];
  assert.match(hero, /v3-review--big/);
  assert.match(hero, /Plumber in North Attleborough, MA/);
  assert.match(hero, /class="v3-hero has-photo"/, "a placeholder photo behind the headline");
  assert.match(hero, /<img data-v3-img src="\/stock\/[\w-]+-1600\.webp"/, "self-hosted, not hotlinked");
  assert.match(hero, /Sample photo/, "labeled on an unclaimed preview");
  assert.doesNotMatch(hero, /unsplash|Photo by/i, "no credit line, no Unsplash URL");
  const claimed = clone(a); claimed.is_claimed = true;
  assert.doesNotMatch(render(claimed).blocks["{{BLOCK_HERO}}"], /Sample photo/, "no label once claimed");
  const unknown = clone(a); unknown.primary_category = "Notary"; unknown.fact_sheet.business.trade = "Notary"; unknown.fact_sheet.business.primary_type = "Notary"; unknown.fact_sheet.business.google_types = []; unknown.page_copy_v3.services = [];
  assert.doesNotMatch(render(unknown).blocks["{{BLOCK_HERO}}"], /has-photo/, "no library for the trade: plain brand-color hero");

  const withOwner = clone(a); withOwner.fact_sheet.photos.owner = ["https://example.com/peter.jpg"];
  const ho = render(withOwner).blocks["{{BLOCK_HERO}}"];
  assert.equal(heroMode(factsFor(withOwner)), "owner");
  assert.match(ho, /src="https:\/\/example\.com\/peter\.jpg"/);
  assert.match(ho, /v3-review--hero/);
  assert.doesNotMatch(ho, /has-photo/, "owner photo layout, no stock behind it");

  const withWork = clone(a); withWork.fact_sheet.photos.work = ["https://example.com/leak.jpg"];
  const hw = render(withWork).blocks["{{BLOCK_HERO}}"];
  assert.match(hw, /v3-hero__bg[\s\S]*example\.com\/leak\.jpg/, "the owner's own work photo beats stock");
  assert.doesNotMatch(hw, /Sample photo/);

  const noReviews = clone(a); noReviews.fact_sheet.reviews = [];
  const r = render(noReviews);
  assert.equal(heroMode(factsFor(noReviews)), "form");
  assert.match(r.blocks["{{BLOCK_HERO}}"], /id="contact"[\s\S]*\{\{QUOTE_FORM\}\}/, "form in the hero");
  assert.doesNotMatch(r.blocks["{{BLOCK_CLOSING}}"], /QUOTE_FORM/, "and not repeated in the closing");
  assert.equal(count(r.html, /data-quote-form/g), 1);
  assert.equal(heroMode(factsFor(fixture("c-ryan"))), "form", "C Ryan pattern");
});

// ── Proof ────────────────────────────────────────────────────────────────

await test("proof strip: 2–4 items, hidden under 2", () => {
  // Rating and hours built in code, plus the review-backed time phrase.
  const arno = render(fixture("arno")).blocks["{{BLOCK_PROOF}}"];
  assert.equal(count(arno, /<li>/g), 3);
  assert.match(arno, /Next morning<\/span><span class="v3-proof__small">in 3 reviews/);
  assert.equal(render(fixture("c-ryan")).blocks["{{BLOCK_PROOF}}"], "", "C Ryan has none");
  const one = clone(fixture("arno")); one.page_copy_v3.proof = []; one.fact_sheet.business.hours = [];
  assert.equal(render(one).blocks["{{BLOCK_PROOF}}"], "", "rating alone is under 2");
  const five = clone(fixture("arno"));
  five.fact_sheet.owner.license_number = "12345"; five.fact_sheet.owner.years_in_business = 20;
  five.page_copy_v3.proof.push({ value: "Same day", label: "x", evidence: ["r1", "r2"] });
  assert.equal(count(render(five).blocks["{{BLOCK_PROOF}}"], /<li>/g), 4);
});

// ── Services ─────────────────────────────────────────────────────────────

const row = (id, tag, persona = "plumbing") => ({ unsplash_id: id, persona, service_tag: tag, approved: true, raw_url: `https://images.unsplash.com/photo-${id}?ixid=x`, alt: `${tag} ${id}`, photographer_name: "A B", photographer_username: "ab" });

await test("services: no service page → estimate link; service page → See <service>", () => {
  const a = fixture("arno");
  const s = render(a).blocks["{{BLOCK_SERVICES}}"];
  assert.match(s, /href="#quote\?service=leaks-and-broken-pipes"[^>]*>Get an estimate/);
  assert.doesNotMatch(s, /See /);
  const withPage = render(a, { spotlights: [{ service_slug: "leaks-and-broken-pipes", service_name: "Leaks and broken pipes" }] });
  assert.match(withPage.blocks["{{BLOCK_SERVICES}}"], /href="\/arno-plumbing-and-heating-2\/leaks-and-broken-pipes"[^>]*>See leaks and broken pipes/);
  assert.match(withPage.blocks["{{BLOCK_HEADER}}"], /<a href="\/arno-plumbing-and-heating-2\/leaks-and-broken-pipes">Services<\/a>/, "menu Services goes to the service page");
});

await test("service photos: self-hosted placeholders on every card, no credit, never twice on a page", () => {
  const a = fixture("arno");
  const { blocks } = render(a);
  const all = blocks["{{BLOCK_SERVICES}}"];
  assert.equal(count(all, /<img data-v3-img/g), 3);
  assert.doesNotMatch(all, /unsplash|Photo by/i);
  const ids = [...(blocks["{{BLOCK_HERO}}"] + all).matchAll(/src="\/stock\/([\w-]+?)-(?:800|1600)\.webp"/g)].map(m => m[1]);
  assert.equal(new Set(ids).size, ids.length, "hero and cards all different photos");
  const own = clone(a); own.page_copy_v3.services[0].work_photo = undefined;
  const unknown = clone(a); unknown.primary_category = "Notary"; unknown.fact_sheet.business.trade = "Notary"; unknown.fact_sheet.business.primary_type = "Notary"; unknown.fact_sheet.business.google_types = [];
  unknown.page_copy_v3.services = [{ name: "Signings", description: "x", evidence: ["g"] }];
  assert.doesNotMatch(render(unknown).blocks["{{BLOCK_SERVICES}}"], /<img/, "unknown trade: finished cards without images");
});

await test("stock picker: never on more than 3 other businesses, never twice on a page", () => {
  const rows = [row("a", "pipes"), row("b", "pipes")];
  assert.equal(pickServiceStock(rows, "plumbing/pipes", { businessId: "me", usage: { a: ["x1", "x2", "x3"], b: ["x1"] } }).unsplash_id, "b");
  assert.equal(pickServiceStock(rows, "pipes", { businessId: "me", usage: { a: ["x1", "x2", "x3"], b: ["1", "2", "3"] } }), null);
  assert.ok(pickServiceStock(rows, "pipes", { businessId: "x1", usage: { a: ["x1", "x2", "x3"] } }), "its own assignment doesn't count");
  assert.equal(pickServiceStock(rows, "pipes", { taken: new Set(["a", "b"]) }), null);
  assert.equal(pickServiceStock(rows, "painting/pipes"), null, "persona must match");
  assert.equal(pickServiceStock([{ ...rows[0], approved: false }], "pipes"), null, "approved only");
  assert.equal(STOCK_MAX_BUSINESSES, 3);
});

// ── Owner, work, reviews ─────────────────────────────────────────────────

await test("meet the owner: only with owner_section; photo when uploaded, else text only", () => {
  assert.equal(render(fixture("arno")).blocks["{{BLOCK_OWNER}}"], "");
  const lir = render(fixture("let-it-roll")).blocks["{{BLOCK_OWNER}}"];
  assert.match(lir, /Meet Patrick and Rick/);
  assert.equal(count(lir, /<p>/g), 2, "body paragraphs");
  assert.doesNotMatch(lir, /<img/);
  const withPhoto = clone(fixture("let-it-roll")); withPhoto.fact_sheet.photos.owner = ["https://example.com/pr.jpg"];
  assert.match(render(withPhoto).blocks["{{BLOCK_OWNER}}"], /<img[^>]*pr\.jpg/);
  assert.equal(copyFor({ page_copy_v3: { owner_section: { heading: "Meet X", body: "", evidence: ["o.names"] } } }).owner_section, null, "no body: no section");
});

await test("recent work: hidden without real photos; captioned by town; Google only when allowed", () => {
  assert.equal(render(fixture("arno")).blocks["{{BLOCK_WORK}}"], "", "no placeholders for visitors");
  const a = clone(fixture("arno"));
  a.fact_sheet.photos.work = ["https://example.com/leak.jpg"];
  const w = render(a);
  assert.match(w.blocks["{{BLOCK_WORK}}"], /src="https:\/\/example\.com\/leak\.jpg"/);
  assert.match(w.blocks["{{BLOCK_WORK}}"], /<figcaption>North Attleborough<\/figcaption>/);
  assert.match(w.blocks["{{BLOCK_HEADER}}"], /href="#work">Our work/);

  const g = clone(fixture("arno"));
  g.brand_kit.google_photos = [{ name: "places/x/photos/1", kind: "work", attributions: [{ displayName: "Jane D", uri: "https://maps.google.com/jane" }] }];
  assert.equal(render(g).blocks["{{BLOCK_WORK}}"], "", "unclaimed public preview: no Google photos");
  const owner = render(g, { owner: true, token: newOwnerToken() }).blocks["{{BLOCK_WORK}}"];
  assert.match(owner, /\/api\/p\?gphoto=1/);
  assert.match(owner, /Jane D/, "author credited");
  g.is_claimed = true;
  assert.match(render(g).blocks["{{BLOCK_WORK}}"], /gphoto=1/, "claimed page: allowed");
});

await test("reviews: rating + count + Read all on Google; pull quote only with 3+", () => {
  const r = render(fixture("arno")).blocks["{{BLOCK_REVIEWS}}"];
  assert.match(r, /What neighbors say/);
  assert.match(r, /4\.6 out of 5 from 22 reviews on Google/);
  assert.match(r, /Read all 22 on Google/);
  assert.match(r, /query_place_id=ChIJ___T0axn5IkRogBUGMKq0cI/);
  assert.equal(count(r, /v3-review--pull/g), 1);
  const reviews = factsFor(fixture("arno")).reviews;
  assert.notEqual(heroReview(reviews), pullQuote(reviews), "hero card and pull quote are different reviews");
  assert.equal(count(r, /<figure class="v3-review">/g), 2, "the other two as cards");
  const one = clone(fixture("arno")); one.fact_sheet.reviews = one.fact_sheet.reviews.slice(0, 1);
  const r1 = render(one).blocks["{{BLOCK_REVIEWS}}"];
  assert.doesNotMatch(r1, /v3-review--pull/);
  assert.equal(count(r1, /<figure class="v3-review">/g), 1);
  assert.equal(pullQuote(factsFor(one).reviews), null);
  assert.equal(render(fixture("c-ryan")).blocks["{{BLOCK_REVIEWS}}"], "", "no reviews, no rating: no section");
  const low = clone(fixture("arno")); low.fact_sheet.reviews[0].rating = 2;
  assert.equal(factsFor(low).reviews.length, 2, "never a review under 4 stars");
});

// ── Area, FAQ, closing, footer ───────────────────────────────────────────

await test("where we work: Google's free embedded map, confirmed chips, text us your town", () => {
  const a = render(fixture("arno")).blocks["{{BLOCK_AREAS}}"];
  assert.match(a, /<iframe class="v3-gmap" src="https:\/\/www\.google\.com\/maps\/embed\/v1\/place\?key=[^"&]+&amp;q=place_id%3AChIJ___T0axn5IkRogBUGMKq0cI"/);
  assert.match(a, /loading="lazy"/);
  assert.match(a, /href="sms:\+?7745341403"[^>]*>Text us your town/);
  assert.match(a, /<ul class="v3-chips"><li>North Attleborough<\/li><\/ul>/, "chips are confirmed towns only");
  const noPlace = clone(fixture("arno")); noPlace.fact_sheet.business.place_id = null; noPlace.google_place_id = null;
  assert.match(render(noPlace).blocks["{{BLOCK_AREAS}}"], /q=3%20Kendall%20St%2C%20North%20Attleborough%2C%20MA&amp;zoom=11/, "no place id: the address");
  assert.ok(areaMapSvg(factsFor(fixture("arno")), COORDS).startsWith("<svg"), "drawn map still available");
});

await test("FAQ: trade questions + facts + evidence-backed copy, with FAQPage schema", () => {
  const { html, blocks } = render(fixture("arno"));
  const n = count(blocks["{{BLOCK_FAQ}}"], /<details/g);
  assert.ok(n >= 4 && n <= 6, `4–6 questions, got ${n}`);
  const faq = jsonLd(html).find(j => j["@type"] === "FAQPage");
  assert.equal(faq.mainEntity.length, n);
  const qs = faq.mainEntity.map(x => x.name);
  assert.equal(qs[0], "Should I use a chemical drain cleaner on a clog?", "leads with a question about their main service");
  assert.ok(qs.includes("How soon can you come out?"), "evidence-backed copy question kept");
  assert.ok(qs.includes("What towns do you serve?"));
  assert.ok(!qs.includes("What are your hours?"), "the copy's hours question is covered by the fact version");
  assert.ok(qs.every(q => !/\bthey\b|\btheir\b/i.test(q)), "\"we\" voice only");
  assert.ok(!/free estimate/i.test(blocks["{{BLOCK_FAQ}}"]), "never says free unless the owner did");
  const lir = render(fixture("let-it-roll")).html;
  assert.match(lir, /Are estimates free\?/, "free only when the owner says so");
  const none = clone(fixture("arno")); none.page_copy_v3.faqs = [];
  assert.ok(count(render(none).blocks["{{BLOCK_FAQ}}"], /<details/g) >= 4, "the bank still fills the section");
});

await test("LocalBusiness schema: confirmed towns only, no aggregateRating", () => {
  const { html } = render(fixture("arno"));
  const lb = jsonLd(html).find(j => j["@type"] === "Plumber");
  assert.equal(lb.name, "Arno Plumbing & Heating");
  assert.equal(lb.telephone, "(774) 534-1403");
  assert.equal(lb.address.streetAddress, "3 Kendall St");
  assert.equal(lb.address.postalCode, "02760");
  assert.deepEqual(lb.areaServed.map(a => a.name), ["North Attleborough, MA"]);
  assert.equal(lb.aggregateRating, undefined, "Google's rules: don't aggregate ratings from other sites");
  assert.equal(lb.openingHoursSpecification[0].opens, "08:00");
  assert.equal(lb.openingHoursSpecification[0].dayOfWeek.length, 7);
  const cr = localBusinessSchemaV3(factsFor(fixture("c-ryan")), { canonical: "x", rawProfile: fixture("c-ryan") });
  assert.equal(cr.aggregateRating, undefined, "no rating shown, none in schema");
  assert.equal(cr.openingHoursSpecification, undefined);
});

await test("closing ask, footer and phone bar", () => {
  const { blocks } = render(fixture("let-it-roll"));
  assert.match(blocks["{{BLOCK_CLOSING}}"], /Have a high room that needs painting\?/);
  assert.match(blocks["{{BLOCK_CLOSING}}"], /href="tel:/);
  const f = blocks["{{BLOCK_FOOTER}}"];
  for (const s of ["Let It Roll Painting", "(732) 948-4046", "NJ HIC #13VH08800400", "Popcorn ceiling removal", "Ewing, NJ", "Website by Enoma"]) assert.ok(f.includes(s), s);
  assert.match(f, /newjersey\.mylicense\.com/, "the kit's verify link when the numbers match");
  const bar = blocks["{{BLOCK_MOBILE_BAR}}"].replace(/<svg[\s\S]*?<\/svg>/g, "");
  for (const s of [">Call<", ">Text<", ">Estimate<"]) assert.ok(bar.includes(s), s);
});

await test("owner view keeps the owner bar; visitors never see it", () => {
  const a = fixture("arno"); const token = newOwnerToken(); a.owner_token = token;
  const bar = render(a, { owner: true, token }).blocks["{{BLOCK_TOPBAR}}"];
  assert.match(bar, /id="ownerBar"/);
  assert.match(bar, /Made for <b>Arno Plumbing &amp; Heating<\/b>/);
  assert.doesNotMatch(render(a).blocks["{{BLOCK_TOPBAR}}"], /ownerBar/);
});

await test("images fall back instead of breaking", () => {
  const { html } = render(fixture("arno"), { stockRows: [row("p1", "pipes"), row("d1", "drain"), row("b1", "boiler")] });
  assert.match(html, /addEventListener\("error"/);
  assert.match(html, /data-v3-media/);
});

await test("css: v3 rules are scoped to body.page-v3 and take color only from kit and neutral tokens", () => {
  const css = read("public/styles/business-base.css");
  const v3 = css.slice(css.indexOf("17. PAGE V3"));
  assert.ok(v3.length > 2000);
  // Rule lines only (skip comment lines).
  for (const line of v3.split(/\r?\n/).filter(l => /\{/.test(l) && !/^\s*@media/.test(l) && !/^\s*\/?\*/.test(l))) {
    const sel = line.slice(0, line.indexOf("{"));
    for (const part of sel.split(",")) assert.match(part, /page-v3/, `scoped: ${part.trim()}`);
  }
  assert.doesNotMatch(v3, /var\(--brand-/, "v3 styles use --kit-* tokens");
  // Hex colors only as neutrals (grays/white/black) or the one star amber.
  const hexes = [...new Set(v3.match(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi))].map(h => h.toLowerCase());
  const neutral = h => { const x = h.length === 4 ? h.replace(/#(.)(.)(.)/, "#$1$1$2$2$3$3") : h; const [r, g, b] = [1, 3, 5].map(i => parseInt(x.slice(i, i + 2), 16)); return Math.max(r, g, b) - Math.min(r, g, b) <= 24; };
  assert.deepEqual(hexes.filter(h => !neutral(h) && h !== "#a35208"), []);
});

// ── Seasonal line ────────────────────────────────────────────────────────

await test("seasonal top-bar line by trade, month and a matching service", () => {
  const f = (trade, names) => ({ trade, services: names.map(name => ({ name })) });
  const at = m => new Date(2026, m - 1, 10);
  assert.equal(seasonalLine(f("plumbing", ["Heating"]), at(11)), "No heat? Call us.");
  assert.equal(seasonalLine(f("plumbing", ["Heating"]), at(7)), "");
  assert.equal(seasonalLine(f("plumbing", ["Drains"]), at(11)), "", "no heating service, no heating line");
  assert.equal(seasonalLine(f("landscaping", ["Lawn care", "Snow plowing"]), at(1)), "Snow plowing this winter? Call or text us.");
  assert.equal(seasonalLine(f("landscaping", ["Lawn care"]), at(1)), "");
  assert.equal(seasonalLine(f("hvac", ["AC repair"]), at(6)), "AC not cooling? Call us.");
  assert.equal(seasonalLine(f("painting", ["Exterior painting"]), at(4)), "Planning exterior painting this spring? Call us.");
  assert.equal(seasonalLine(f("painting", ["Interior painting"]), at(4)), "");
});

await test("a service card can use one of the owner's own work photos (named in the copy), never an outside URL", () => {
  const a = clone(fixture("arno"));
  a.fact_sheet.photos.work = ["https://example.com/drain-job.jpg"];
  a.page_copy_v3.services[0].work_photo = "https://example.com/drain-job.jpg";
  a.page_copy_v3.services[1].work_photo = "https://evil.example/not-theirs.jpg";
  const s = render(a).blocks["{{BLOCK_SERVICES}}"];
  assert.match(s, /src="https:\/\/example\.com\/drain-job\.jpg"/);
  assert.doesNotMatch(s, /not-theirs/);
});

console.log(`\n${passed} passed`);
