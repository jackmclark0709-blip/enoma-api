// Run with: node tests/preview-generator.test.js (also wired into `npm test`)

import assert from "node:assert/strict";
import { slugify, qualifiesForPreview, validateGenerated, assembleProfile, stateAbbr, buildFactsPrompt } from "../api/_lib/preview-generator.js";
import { renderSections, faqSchema, splitAbout } from "../api/_lib/page-ssr.js";

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { console.error(`  FAIL - ${name}`); console.error(err); process.exitCode = 1; }
}

const SITE = `Master Plumber #16283. Trusted Plumbers Servicing MetroWest MA. Up-front pricing. 100% Satisfaction Guaranteed.
Services at a Glance: Toilet Repairs, Water Heaters, Re-piping, Frozen pipe repairs, Gas pipe installation.
Service Areas: Franklin, Medway, Bellingham, Norfolk. 305 Union Street, Franklin, MA 02038. 508-298-5042`;

console.log("preview-generator");
test("slugify drops legal suffixes and punctuation", () => {
  assert.equal(slugify("Grillo Plumbing, Inc."), "grillo-plumbing");
  assert.equal(slugify("A&D Landscaping Services LLC"), "a-and-d-landscaping-services");
  assert.equal(slugify("Conway's Landscaping"), "conways-landscaping");
});
test("stateAbbr", () => { assert.equal(stateAbbr("Massachusetts"), "MA"); assert.equal(stateAbbr("RI"), "RI"); });
test("qualification gates on rating, phone and objective site weakness", () => {
  assert.equal(qualifiesForPreview({ rating: 5, reviewCount: 106, hasWebsite: true, siteCheckScore: 3, phone: "x" }).ok, true);
  assert.equal(qualifiesForPreview({ rating: 5, reviewCount: 106, hasWebsite: true, siteCheckScore: 1, phone: "x" }).reason, "site_not_weak_enough");
  assert.equal(qualifiesForPreview({ rating: 4, reviewCount: 1, hasWebsite: false, phone: "x" }).reason, "weak_or_thin_rating");
  assert.equal(qualifiesForPreview({ rating: 5, reviewCount: 20, hasWebsite: false, phone: "" }).reason, "no_phone");
  assert.equal(qualifiesForPreview({ rating: 4.8, reviewCount: 20, hasWebsite: false, phone: "x" }).ok, true);
});
test("prompt carries the source text and hard rules", () => {
  const p = buildFactsPrompt({ name: "Grillo", trade: "plumber", city: "Franklin", state: "MA", phone: "508", siteText: SITE });
  assert.ok(p.includes("Never invent facts") && p.includes("Master Plumber #16283"));
});
test("validation strips invented numbers, ratings, puffery and ungrounded claims", () => {
  const out = validateGenerated({
    hero_headline: "Trusted master plumbers for MetroWest homes",
    hero_tagline: "Serving MetroWest since 1985. Up-front pricing on every job.",
    about: "Licensed Master Plumber #16283. Rated 5 stars on Google. We have 30 years of experience.",
    services: [{ service_name: "Water Heaters", service_description: "Repair and replacement." }, { service_name: "Rated #1 drain cleaning" }],
    service_area: ["Franklin", "Medway, MA", "Boston"],
    why_choose_us: ["Up-front pricing", "Free estimates on all work", "100% satisfaction guaranteed"],
    trust_badges: ["Master Plumber #16283", "Family owned since 1990"],
    faqs: [{ q: "What areas do you serve?", a: "Franklin, Medway, Bellingham and Norfolk." }, { q: "How many reviews?", a: "Lots." }],
  }, { siteText: SITE, phone: "508-298-5042", city: "Franklin", trade: "plumber" });
  assert.equal(out.hero_headline, "Master plumbers for MetroWest homes");
  assert.equal(out.hero_tagline, "Up-front pricing on every job.");
  assert.equal(out.about, "Licensed Master Plumber #16283.");
  assert.deepEqual(out.services.map(s => s.service_name), ["Water Heaters"]);
  assert.deepEqual(out.service_area, ["Franklin", "Medway"]);
  assert.deepEqual(out.why_choose_us, ["Up-front pricing", "100% satisfaction guaranteed"]);
  assert.deepEqual(out.trust_badges, ["Master Plumber #16283"]);
  assert.equal(out.faqs.length, 1);
});
test("no services -> one entry for the trade, never empty", () => {
  const out = validateGenerated({ services: [] }, { siteText: "", city: "Mansfield", trade: "landscaping" });
  assert.deepEqual(out.services, [{ service_name: "Landscaping", service_description: "" }]);
  assert.deepEqual(out.service_area, ["Mansfield"]);
});
test("assembleProfile fills safe defaults and unclaimed flags", () => {
  const copy = validateGenerated({}, { siteText: "", city: "Mansfield", trade: "landscaping" });
  const p = assembleProfile({ slug: "x", name: "Stanos Landscaping", trade: "Landscaping", city: "Mansfield", state: "Massachusetts", phone: "(508) 339-9451", rating: 4.9, reviewCount: 30, googleReviews: [], copy });
  assert.equal(p.is_claimed, false);
  assert.equal(p.state, "MA");
  assert.equal(p.hero_headline, "Landscaping in Mansfield");
  assert.ok(p.hero_tagline.includes("(508) 339-9451"));
});

console.log("page-ssr");
test("about splits into lead and body", () => {
  assert.deepEqual(splitAbout("One.\n\nTwo.\n\nThree."), { lead: "One.", body: "Two.\n\nThree." });
  assert.deepEqual(splitAbout("Only."), { lead: "Only.", body: "" });
});
test("sections render escaped content and visibility classes", () => {
  const r = renderSections({ about: "A <b>", services: [{ service_name: "Mow & trim" }], service_area: ["Agawam"], why_choose_us: "One fact\nTwo fact", faqs: [{ question: "Q?", answer: "A." }], testimonials: [{ quote: "Great", author: "Pat", source: "google" }] });
  assert.equal(r["{{SSR_ABOUT_LEAD}}"], "A &lt;b&gt;");
  assert.ok(r["{{SSR_SERVICES}}"].includes("Mow &amp; trim"));
  assert.equal(r["{{SSR_TOWNS_CLASS}}"], "");
  assert.equal((r["{{SSR_WHY}}"].match(/<li>/g) || []).length, 2);
  assert.equal(r["{{SSR_FAQS_CLASS}}"], "band");
  assert.ok(r["{{SSR_TESTIMONIALS}}"].includes("via Google"));
  const empty = renderSections({});
  assert.equal(empty["{{SSR_TOWNS_CLASS}}"], "hidden");
  assert.equal(empty["{{SSR_FAQS_CLASS}}"], "band hidden");
});
test("faq schema only when there are faqs", () => {
  assert.equal(faqSchema({}), null);
  assert.equal(faqSchema({ faqs: [{ q: "Q", a: "A" }] }, "https://enoma.io/x").mainEntity[0].acceptedAnswer.text, "A");
});

console.log(`${passed} passed`);
