// Run with: node tests/page-v3-prefinalize.test.js (also wired into `npm test`)
// The v3 pre-finalize fixes (Nov 19, 2026): clean business names and their
// claims, people named in reviews, a facts-only proof strip, card fixes, the
// hero sub check, one Call in the closing, no aggregateRating, titles from
// Google's type. Fixtures: tests/fixtures/page-v3 plus small inline reviews
// taken from the live test pages.

import assert from "node:assert/strict";
import fs from "node:fs";
import { cleanBusinessName, claimsFrom, fixJoinCasing } from "../api/_lib/business-name.js";
import { peopleInReviews, leadPerson, personLine } from "../api/_lib/review-people.js";
import {
  factsFor, copyFor, proofItemsV3, weakSub, factSub, serviceLineFallback, closingCopyV3, GENERIC_CLOSING,
  tradeWordFor, v3Seo, v3PageParts, localBusinessSchemaV3, servicePhoto,
} from "../api/_lib/page-v3.js";
import { tagForService } from "../api/_lib/stock-library.js";
import { serviceHeadlineShown, serviceIntroShown, serviceTitle, servicePageV3Parts } from "../api/_lib/service-page-v3.js";
import { buildFactSheet } from "../api/_lib/fact-sheet.js";
import { kitFor } from "../api/_lib/brand-kit.js";

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { console.error(`  FAIL - ${name}`); console.error(err); process.exitCode = 1; }
}
const read = rel => fs.readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const fixture = name => JSON.parse(read(`tests/fixtures/page-v3/${name}.json`));
const clone = o => JSON.parse(JSON.stringify(o));
const NOW = new Date(2026, 10, 19);

// ── 1. Business names ─────────────────────────────────────────────────────

await test("clean name: tagline claims come off and become claims", () => {
  const m = cleanBusinessName("Maynard Roofing /40 yrs Family Business", { now: NOW });
  assert.equal(m.name, "Maynard Roofing");
  assert.deepEqual(m.claims, [{ kind: "years", value: 40 }, { kind: "family" }]);
  assert.equal(cleanBusinessName("Bilco Electric and Datacom - Security camera installations").name, "Bilco Electric and Datacom");
  assert.equal(cleanBusinessName("Pete's Plumbing | Drain Cleaning").name, "Pete's Plumbing");
  assert.equal(cleanBusinessName("Acme Roofing (Family Owned)").name, "Acme Roofing");
});

await test("clean name: names without a claim tail are left alone", () => {
  assert.equal(cleanBusinessName("Joe's Plumbing & Heating").name, "Joe's Plumbing & Heating");
  assert.equal(cleanBusinessName("Since 1984 Roofing").name, "Since 1984 Roofing");
  assert.equal(cleanBusinessName("Ace Roofing - Taunton").name, "Ace Roofing - Taunton", "a town is part of the name");
  assert.equal(cleanBusinessName("Roofing / Family Owned").name, "Roofing / Family Owned", "never down to the trade alone");
  assert.equal(cleanBusinessName("A-1 Plumbing").name, "A-1 Plumbing");
});

await test("clean name: joining-word casing, years from a founding year", () => {
  assert.equal(fixJoinCasing("Arno Plumbing And Heating"), "Arno Plumbing and Heating");
  assert.equal(fixJoinCasing("The Blooming Daisy Co."), "The Blooming Daisy Co.");
  assert.equal(fixJoinCasing("AND Electric"), "AND Electric");
  assert.deepEqual(claimsFrom("Since 1984", NOW), [{ kind: "years", value: 42, since: 1984 }]);
  assert.deepEqual(claimsFrom("Veteran Owned"), [{ kind: "veteran" }]);
});

await test("fact sheet keeps the raw name as evidence and stores claims", () => {
  const fs1 = buildFactSheet({ profile: { business_name: "Maynard Roofing /40 yrs Family Business", city: "Taunton", state: "MA" }, now: NOW.getTime() });
  assert.equal(fs1.business.name, "Maynard Roofing");
  assert.equal(fs1.business.raw_name, "Maynard Roofing /40 yrs Family Business");
  assert.equal(fs1.business.name_claims.length, 2);
});

await test("page: clean name everywhere, claims in the proof strip", () => {
  const p = clone(fixture("arno"));
  p.fact_sheet.business.name = "Arno Plumbing And Heating /40 yrs Family Business";
  p.business_name = p.fact_sheet.business.name;
  const parts = v3PageParts(p, kitFor(p), { slug: p.username, now: NOW });
  assert.match(parts.seo.title, /^Arno Plumbing and Heating — Plumbing in North Attleborough, MA$/);
  assert.doesNotMatch(parts.blocks["{{BLOCK_HEADER}}"], /40 yrs/i);
  const raw = clone(fixture("arno")); raw.business_name = "Maynard Roofing /40 yrs Family Business"; raw.fact_sheet.business.name = raw.business_name;
  raw.brand_kit = { ...kitFor(raw), wordmark: { line1: "MAYNARD", line2: "ROOFING /40 YRS FAMILY BUSINESS · TAUNTON MA", icon: "contractor" } };
  assert.doesNotMatch(v3PageParts(raw, raw.brand_kit, { slug: "x", now: NOW }).blocks["{{BLOCK_HEADER}}"], /40 YRS/, "stored wordmark rebuilt from the clean name");
  assert.doesNotMatch(parts.blocks["{{BLOCK_FOOTER}}"], /40 yrs/i);
  assert.match(parts.blocks["{{BLOCK_PROOF}}"], /40 years<\/span><span class="v3-proof__small">Family business/);
  assert.equal(parts.schema.name, "Arno Plumbing and Heating");
});

// ── 2. People named in reviews ────────────────────────────────────────────

const MAYNARD = [
  { id: "r1", author: "JOSEPHINE R.", text: "Maynard Roofing was able to come out quickly. Barry and Jack came out, found the problem right away. Thank you again, Barry and Jack!" },
  { id: "r2", author: "Crystal S.", text: "Barry and his guys are outstanding! Before the next rainstorm Barry and crew were at my house." },
  { id: "r3", author: "Marc C.", text: "Barry and his crew did an excellent job replacing my roof." },
  { id: "r4", author: "Raymond G.", text: "Barry and his crew just finished my roof." },
  { id: "r5", author: "Susan F.", text: "Maynard roofing did an amazing job on my home." },
];
const ARNO = [
  { id: "r1", author: "Ms. A.", text: "this plumber (Richard?), and I can't recommend him highly enough." },
  { id: "r2", author: "Bob L.", text: "Pete was the plumber who came out to me. It took Pete and his assistant about an hour. Arno Plumbing will be my first call." },
  { id: "r3", author: "Kaitlyn S.", text: "I would highly recommend Arno plumbing to anyone." },
  { id: "r4", author: "Russ B.", text: "Peter and his apprentice Nick worked exceptionally hard." },
];

await test("people: Barry and his crew (4 reviews); brand uses never count", () => {
  const ps = peopleInReviews(MAYNARD, { skip: ["Taunton"] });
  const lead = leadPerson(ps);
  assert.equal(lead.name, "Barry");
  assert.equal(lead.reviews.length, 4);
  assert.equal(personLine(lead), "Customers mention Barry and his crew by name in 4 Google reviews.");
  assert.ok(!ps.some(p => /maynard|roofing/i.test(p.name)));
});

await test("people: Pete and Peter are one person, shown as Peter", () => {
  const lead = leadPerson(peopleInReviews(ARNO, { skip: ["North Attleborough"] }));
  assert.equal(lead.name, "Peter");
  assert.equal(lead.reviews.length, 2);
});

await test("people: owner only when a review says so; reviewer, towns and single mentions are not used", () => {
  const rangel = [
    { id: "r3", author: "Andrea H.", text: "We had a wonderful experience with Andre and his team." },
    { id: "r5", author: "Noly M.", text: "Andre, the company owner, arrived first to do a little walkthrough." },
  ];
  assert.equal(personLine(leadPerson(peopleInReviews(rangel))), "Customers mention Andre, the owner, by name in 2 Google reviews.");
  const selfNamed = [{ id: "r1", author: "David F.", text: "David was here. Thanks David." }, { id: "r2", author: "David F.", text: "David is great" }];
  assert.equal(peopleInReviews(selfNamed).length, 0, "the reviewer's own name");
  const town = [{ id: "r1", author: "A", text: "Thanks Taunton was great" }, { id: "r2", author: "B", text: "Taunton is lucky" }];
  assert.equal(peopleInReviews(town, { skip: ["Taunton"] }).length, 0);
  assert.equal(leadPerson(peopleInReviews([{ id: "r1", author: "A", text: "Shelby offered a quick response." }])), null, "one review is not enough");
});

await test("people: line shows under the hero sub; skipped when the owner gave names", () => {
  const p = clone(fixture("arno"));
  p.fact_sheet.reviews = ARNO.map(r => ({ ...r, rating: 5 }));
  p.fact_sheet.owner.names = [];
  const kit = { ...kitFor(p), owner_names: [] };
  const facts = factsFor(p, kit);
  assert.equal(facts.person?.name, "Peter");
  const hero = v3PageParts(p, kit, { slug: p.username, now: NOW }).blocks["{{BLOCK_HERO}}"];
  assert.match(hero, /class="v3-person">Customers mention Peter by name in 2 Google reviews\./);
  p.fact_sheet.owner.names = ["Peter"];
  assert.equal(factsFor(p, kit).person, null);
});

await test("people: the business name's own words never count, even used like a person", () => {
  const p = clone(fixture("arno"));
  p.fact_sheet.business.name = "Maynard Roofing"; p.business_name = "Maynard Roofing";
  p.fact_sheet.owner.names = [];
  p.fact_sheet.reviews = [
    { id: "r1", author: "A B.", rating: 5, text: "Maynard always answers the phone." },
    { id: "r2", author: "C D.", rating: 5, text: "Maynard did great work on our roof." },
  ];
  assert.equal(factsFor(p, { ...kitFor(p), owner_names: [] }).person, null);
});

// ── 3. Proof strip ───────────────────────────────────────────────────────

await test("proof: vague review labels are dropped; time phrases get 'in N reviews'", () => {
  const p = fixture("arno");
  const facts = factsFor(p);
  const items = proofItemsV3(p.fact_sheet, facts, [
    { value: "Quick response", label: "how fast they showed up", evidence: ["r1", "r2", "r3"] },
    { value: "Detailed explanations", label: "how they communicate", evidence: ["r1", "r3"] },
    { value: "Same day", label: "when they can come", evidence: ["r2", "r3"] },
    { value: "Family owned", label: "business type", evidence: ["r1", "r3"] },
    { value: "Next morning", label: "x", evidence: ["r1"] },
  ]);
  const text = items.map(i => `${i.big}|${i.small}`);
  assert.ok(!text.some(t => /Quick response|Detailed/.test(t)));
  assert.ok(text.includes("Same day|in 2 reviews"));
  assert.ok(!text.some(t => /Next morning/.test(t)), "one review is not enough");
  assert.ok(items.length <= 4);
});

await test("proof: license and insured from owner answers; owner years beat name claims", () => {
  const p = clone(fixture("arno"));
  p.fact_sheet.owner.license_number = "PL-123";
  p.fact_sheet.owner.is_insured = true;
  p.fact_sheet.owner.years_in_business = 12;
  p.fact_sheet.business.name_claims = [{ kind: "years", value: 40 }];
  const items = proofItemsV3(p.fact_sheet, factsFor(p), []);
  const text = items.map(i => `${i.big}|${i.small}`);
  assert.ok(text.includes("12 years|In business"), text.join(" / "));
  assert.ok(text.some(t => /^Licensed & insured\|.*#PL-123/.test(t)), text.join(" / "));
});

// ── 4. Service cards ─────────────────────────────────────────────────────

await test("cards: an empty description falls back to the service page's first sentence", () => {
  const sp = { service_name: "Pipe leaks", intro: "We find the leak and fix it the same visit when we can. Then we check the rest of the line.", what_we_do: ["Find the leak"] };
  assert.equal(serviceLineFallback("Pipe leaks", sp), "We find the leak and fix it the same visit when we can.");
  assert.equal(serviceLineFallback("Drain clogs", sp), "", "only the same service");
  assert.equal(serviceLineFallback("Pipe leaks", { service_name: "Pipe leaks", intro: "We specialize in leaks.", what_we_do: ["Find the leak behind the wall"] }), "Find the leak behind the wall.");
  const p = clone(fixture("arno"));
  p.page_copy_v3.services[0].description = "";
  p.page_copy_v3.service_page = { ...(p.page_copy_v3.service_page || {}), service_name: p.page_copy_v3.services[0].name, intro: "Same-day leak repair. More text." };
  assert.equal(factsFor(p).services[0].line, "Same-day leak repair.");
});

await test("cards: water heaters never get a bathroom vanity", () => {
  assert.notEqual(tagForService("plumbing", "Hot water tank failures"), "plumbing/fixtures");
  assert.notEqual(tagForService("plumbing", "Water heater installs"), "plumbing/fixtures");
  assert.equal(tagForService("plumbing", "Drain clogs"), "plumbing/drain");
});

await test("cards: alt text names the service unless the photo is the service's own tag", () => {
  const ctx = { persona: "plumbing", businessId: "b1" };
  const own = servicePhoto({ name: "Pipe leaks" }, null, ctx, new Set());
  assert.equal(own.alt, "Copper pipes");
  const taken = new Set();
  // Use up every pipes photo so the next card falls back to another tag.
  for (let i = 0; i < 6; i++) servicePhoto({ name: `Pipe leaks ${i}` }, null, ctx, taken);
  const other = servicePhoto({ name: "Pipe leaks" }, null, ctx, taken);
  if (other && other.alt !== "Copper pipes") assert.equal(other.alt, "Pipe leaks");
});

await test("cards: grid class carries the count (4 → 2 x 2)", () => {
  const p = clone(fixture("arno"));
  const n = factsFor(p).services.length;
  assert.match(v3PageParts(p, kitFor(p), { slug: p.username, now: NOW }).blocks["{{BLOCK_SERVICES}}"], new RegExp(`v3-cards--n${Math.min(n, 6)}`));
  const css = read("public/styles/business-base.css");
  assert.match(css, /\.v3-cards\.v3-cards--n4 \{ grid-template-columns: repeat\(2/);
});

// ── 5. Hero sub ──────────────────────────────────────────────────────────

await test("hero sub: weak subs are replaced by one built from facts", () => {
  assert.ok(weakSub("Providing painting services in Ewing, NJ.", "Painter in Ewing"));
  assert.ok(weakSub("Fixing roof leaks and replacements in Taunton with quick response and detailed explanations.", "Roof leaks and replacements in Taunton"));
  assert.ok(weakSub("Arno Plumbing And Heating solves plumbing issues in North Attleborough, offering quick responses and thorough repairs.", "Fixing leaks and clogs in North Attleborough", "Arno Plumbing and Heating"));
  assert.ok(weakSub("We specialize in roofs.", "Roofs in Taunton"));
  assert.ok(!weakSub("Same-day help for leaks, clogs and no hot water, from a crew customers name in their reviews.", "Fixing leaks and clogs in North Attleborough", "Arno Plumbing and Heating"));
  const facts = { services: [{ name: "Interior and Exterior Painting" }], towns: { home: "Ewing" }, address: {}, offers_free_estimates: false };
  assert.equal(factSub(facts), "Help with interior and exterior painting in Ewing.");
  assert.equal(factSub({ ...facts, offers_free_estimates: true }), "Help with interior and exterior painting in Ewing. Free estimates.");
  assert.equal(factSub({ ...facts, services: [{ name: "Hot water tank failures" }, { name: "Drain clogs" }, { name: "Pipe leaks" }], towns: { home: "North Attleborough" } }),
    "Help with hot water tank failures, drain clogs and pipe leaks in North Attleborough.");
});

// ── 6. Closing ───────────────────────────────────────────────────────────

await test("closing: generic AI headings fall back; specific ones stay; one Call with the form", () => {
  assert.ok(GENERIC_CLOSING.test("Need plumbing help?"));
  assert.ok(GENERIC_CLOSING.test("Ready to Paint?"));
  assert.ok(!GENERIC_CLOSING.test("Have a high room that needs painting?"));
  const facts = { phone: "(508) 631-3839" };
  assert.deepEqual(closingCopyV3(facts, { heading: "Need Roofing Help?", line: "Call us today to schedule your service." }),
    { heading: "Let's get you on the schedule.", line: "Call (508) 631-3839, or send a few details and we'll get back to you." });
  const p = clone(fixture("arno"));
  const closing = v3PageParts(p, kitFor(p), { slug: p.username, now: NOW }).blocks["{{BLOCK_CLOSING}}"];
  const leftCall = closing.split('class="v3-formcard"')[0];
  assert.doesNotMatch(leftCall, /data-contact="call"/, "the form card has the Call button; the left column doesn't repeat it");
});

// ── 8. Head ──────────────────────────────────────────────────────────────

await test("schema: no aggregateRating on any v3 page", () => {
  for (const name of ["arno", "c-ryan", "let-it-roll"]) {
    const p = fixture(name);
    assert.equal(localBusinessSchemaV3(factsFor(p), { canonical: "x", rawProfile: p }).aggregateRating, undefined, name);
  }
});

await test("titles: trade word from Google's type, not 'Contracting'", () => {
  assert.equal(tradeWordFor("Roofing contractor", "contractor"), "Roofing");
  assert.equal(tradeWordFor("Paving contractor", "contractor"), "Paving");
  assert.equal(tradeWordFor("Lawn care service", "landscaping"), "Lawn care");
  assert.equal(tradeWordFor("Services", "contractor"), "Contracting");
  assert.equal(tradeWordFor("House cleaning service", "cleaning"), "House cleaning");
  const facts = { name: "Maynard Roofing", primary_type: "Roofing contractor", trade: "contractor", towns: { home: "Taunton" }, address: { state: "MA", town: "Taunton" }, google: { rating: 4.9, count: 55 }, phone: "(508) 631-3839" };
  const seo = v3Seo(facts, { hero: { h1: "Roof leaks and replacements in Taunton" } });
  assert.equal(seo.title, "Maynard Roofing — Roofing in Taunton, MA");
  assert.ok(seo.description.length <= 155, seo.description);
  assert.match(seo.description, /^Roof leaks and replacements in Taunton\. Roofing in Taunton, MA\. 4\.9★ from 55 Google reviews\./);
});

// ── Service page ─────────────────────────────────────────────────────────

await test("service page: filler headlines and 'we specialize' sentences are not shown; title uses the clean name", () => {
  assert.equal(serviceHeadlineShown("Fast and Effective Roof Leak Repairs", "Roof Leak Repairs"), "");
  assert.equal(serviceHeadlineShown("Found and fixed before the next rain", "Roof Leak Repairs"), "Found and fixed before the next rain");
  assert.equal(serviceIntroShown("Leaks spread fast. We specialize in finding leaks. We show you a photo of the problem."), "Leaks spread fast. We show you a photo of the problem.");
  const facts = { name: "Maynard Roofing", towns: { home: "Taunton" }, address: { state: "MA" } };
  assert.equal(serviceTitle("Roof Leak Repairs", facts), "Roof Leak Repairs in Taunton, MA | Maynard Roofing");
});

await test("service page metadata uses the filtered intro", () => {
  const p = fixture("arno");
  const intro = "Leaks spread fast. We specialize in finding leaks. We show you a photo.";
  const spot = { service_slug: "pipe-leaks", content: { kind: "v3", service_name: "Pipe leaks", headline: "x", intro, seo: { title: "t", description: intro.slice(0, 158) }, what_we_do: [], signs: [], faqs: [], review_ids: [], hero: { headline: "x", subhead: intro } } };
  const parts = servicePageV3Parts(p, kitFor(p), spot, { slug: p.username, canonical: "https://enoma.io/x/pipe-leaks", now: NOW });
  assert.doesNotMatch(parts.description, /specialize/i);
  assert.doesNotMatch(parts.schema.description, /specialize/i);
});

console.log(`\n${passed} passed`);
