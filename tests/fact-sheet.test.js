// Website v3, PR A: the fact sheet (api/_lib/fact-sheet.js) and the one
// prompt + evidence check (api/_lib/page-copy.js). Plain Node assert, no deps.
import assert from "node:assert/strict";
import {
  buildFactSheet, reviewsFrom, reviewAuthor, evidenceMap, photosBlock, FACT_SHEET_VERSION,
} from "../api/_lib/fact-sheet.js";
import {
  buildPagePrompt, pageRequestBody, checkPageCopyV3, filterByEvidence, buildEyebrow, buildCodeProof,
  PAGE_V3_SCHEMA, costOf, applyFactRules, factChecker, hasBannedWord,
} from "../api/_lib/page-copy.js";
import { scrubCopy } from "../api/_lib/copy-lint.js";

let passed = 0;
const pending = [];
const test = (name, fn) => pending.push([name, fn]);

// Places (New) review objects, as fetchPlaceDetails returns them.
const placeReview = (rating, text, name = "Russell Brown", when = "2 months ago") =>
  ({ rating, text: { text }, authorAttribution: { displayName: name }, relativePublishTimeDescription: when });

const PLACE = {
  displayName: { text: "Arno Plumbing And Heating" },
  rating: 4.6, userRatingCount: 22,
  primaryTypeDisplayName: { text: "Plumber" },
  types: ["plumber", "point_of_interest"],
  regularOpeningHours: { weekdayDescriptions: ["Monday: 7 AM–5 PM", "Tuesday: 7 AM–5 PM", "Wednesday: 7 AM–5 PM", "Thursday: 7 AM–5 PM", "Friday: 7 AM–5 PM", "Saturday: 8 AM–12 PM", "Sunday: Closed"] },
  reviews: [
    placeReview(5, "Came the next morning and cleared our sewer line. Roots in the pipe, he showed us on the camera."),
    placeReview(5, "Found the leak behind the wall in an hour.", "Dana K"),
    placeReview(3, "Fine but late.", "Pat Q"),
    placeReview(4, "Replaced our water heater the same week. Fair price.", "Lee"),
    placeReview(5, "Fixed the boiler on a Sunday.", "Maria Lopez-Diaz"),
    placeReview(5, "Unclogged the kitchen drain fast.", "Tom W."),
    placeReview(5, "Sixth good review, one too many.", "Extra Person"),
  ],
};
const PROFILE = {
  business_name: "Arno Plumbing And Heating", primary_category: "plumber", phone: "(774) 534-1403",
  address: "3 Kendall St, North Attleborough, MA 02760", city: "North Attleborough", state: "MA",
  google_place_id: "ChIJabc", offers_emergency: false,
  // A preview's AI-written services: never owner answers.
  services: [{ service_name: "Plumbing Services" }],
  attachments: ["https://x.supabase.co/a.jpg", "https://x.supabase.co/flyer.jpg", "https://x.supabase.co/old.jpg"],
  attachment_kinds: { "https://x.supabase.co/a.jpg": "work", "https://x.supabase.co/flyer.jpg": "flyer" },
  brand_kit: { owner_names: ["Rick"], towns: { confirmed: ["North Attleborough", "Plainville"], suggested: ["Attleboro", "Wrentham"] }, google_photos: [{ name: "places/x/photos/1" }, { name: "places/x/photos/2" }] },
};
const sheet = (extra = {}) => buildFactSheet({ profile: PROFILE, place: PLACE, reviews: PLACE.reviews, siteText: "", now: Date.UTC(2026, 10, 18), ...extra });

// ── The fact sheet ───────────────────────────────────────────────────────
console.log("fact sheet");
test("has the contract's shape", () => {
  const fs = sheet();
  assert.equal(fs.version, FACT_SHEET_VERSION);
  assert.equal(fs.built_at, "2026-11-18T00:00:00.000Z");
  assert.deepEqual(Object.keys(fs).sort(), ["built_at", "business", "owner", "photos", "reviews", "site_text", "towns", "version"]);
  assert.deepEqual(Object.keys(fs.business).sort(), ["address", "google_types", "hours", "name", "phone", "place_id", "primary_type", "rating", "review_count", "state", "town", "trade"].sort());
  for (const k of ["names", "years_in_business", "license_number", "is_insured", "offers_free_estimates", "offers_emergency", "blurb", "service_for_page"]) assert.ok(k in fs.owner, k);
  assert.deepEqual(Object.keys(fs.towns).sort(), ["confirmed", "home", "suggested"]);
  assert.deepEqual(Object.keys(fs.photos).sort(), ["google_work_count", "owner", "work"]);
  assert.equal(fs.business.rating, 4.6);
  assert.equal(fs.business.review_count, 22);
  assert.equal(fs.business.primary_type, "Plumber");
  assert.equal(fs.business.hours.length, 7);
  assert.deepEqual(fs.towns, { home: "North Attleborough", confirmed: ["North Attleborough", "Plainville"], suggested: ["Attleboro", "Wrentham"] });
  assert.deepEqual(fs.owner.names, ["Rick"]);
});
test("keeps 5 reviews, all 4★+, full text, ids r1..r5", () => {
  const fs = sheet();
  assert.equal(fs.reviews.length, 5);
  assert.deepEqual(fs.reviews.map(r => r.id), ["r1", "r2", "r3", "r4", "r5"]);
  assert.ok(fs.reviews.every(r => r.rating >= 4));
  assert.ok(!fs.reviews.some(r => /late/.test(r.text)), "the 3★ review is out");
  assert.equal(fs.reviews[0].text, PLACE.reviews[0].text.text, "full text, not cut");
  assert.equal(fs.reviews[0].relative_time, "2 months ago");
});
test("review author is first name + last initial", () => {
  assert.equal(reviewAuthor("Russell Brown"), "Russell B.");
  assert.equal(reviewAuthor("russ brown"), "Russ B.");
  assert.equal(reviewAuthor("Maria Lopez-Diaz"), "Maria L.");
  assert.equal(reviewAuthor("Lee"), "Lee");
  assert.equal(reviewAuthor(""), "Google reviewer");
  assert.equal(sheet().reviews[1].author, "Dana K.");
});
test("stored google testimonials work as reviews too", () => {
  const r = reviewsFrom([{ quote: "Great job on the roof.", author: "Sam Smith", rating: 5, source: "google" }]);
  assert.deepEqual(r, [{ id: "r1", author: "Sam S.", rating: 5, text: "Great job on the roof.", relative_time: null }]);
});
test("photos: owner uploads only, Google photos counted not stored", () => {
  const fs = sheet();
  assert.deepEqual(fs.photos.work, ["https://x.supabase.co/a.jpg"], "work-tagged only");
  assert.equal(fs.photos.google_work_count, 2);
  assert.ok(!JSON.stringify(fs).includes("places/x/photos"), "no Google photo refs in the sheet");
  assert.deepEqual(photosBlock({ owner_photo_url: "https://x.supabase.co/me.jpg" }).owner, ["https://x.supabase.co/me.jpg"]);
});
test("owner services: only what the owner typed, never the AI-written column", () => {
  assert.deepEqual(sheet().owner.services, []);
  assert.deepEqual(sheet({ owner: { services: [{ service_name: "Boiler repair" }, "Drain cleaning"] } }).owner.services, ["Boiler repair", "Drain cleaning"]);
});
test("a rebuild keeps stored reviews, site text and the page choice", () => {
  const prev = sheet({ siteText: "We fix boilers.", owner: { service_for_page: "Boiler repair" } });
  const next = buildFactSheet({ profile: { ...PROFILE, years_in_business: 12 }, previous: prev });
  assert.equal(next.reviews.length, 5);
  assert.equal(next.site_text, "We fix boilers.");
  assert.equal(next.owner.service_for_page, "Boiler repair");
  assert.equal(next.owner.years_in_business, 12);
  assert.equal(next.business.rating, 4.6);
});
test("evidence ids: r1..r5, g, s, o.<field>", () => {
  const ids = Object.keys(evidenceMap(sheet({ siteText: "Since 2004.", profile: { ...PROFILE, license_number: "MP-123", years_in_business: 20 } })));
  for (const id of ["r1", "r5", "g", "s", "o.names", "o.license_number", "o.years_in_business", "o.towns", "o.photos"]) assert.ok(ids.includes(id), id);
  assert.ok(!ids.includes("o.is_insured"), "unanswered fields aren't evidence");
});

// ── The one prompt ───────────────────────────────────────────────────────
console.log("prompt");
test("one prompt: reviews as r1: \"…\", the ids, the rules", () => {
  const p = buildPagePrompt(sheet());
  assert.match(p, /^r1: "Came the next morning/m);
  assert.match(p, /The ids you may cite: r1, r2, r3, r4, r5, g, o\.names, o\.towns, o\.photos/);
  assert.match(p, /Never invent: years/);
  assert.match(p, /Backed-up drains and sewer lines/);
  assert.ok(!/Attleboro, Wrentham|Wrentham/.test(p), "suggested (unconfirmed) towns stay out of the prompt");
});
test("gpt-4o, temperature 0.2, strict schema", () => {
  const b = pageRequestBody(sheet());
  assert.equal(b.model, "gpt-4o");
  assert.equal(b.temperature, 0.2);
  assert.equal(b.response_format.json_schema.strict, true);
  assert.equal(b.response_format.json_schema.schema, PAGE_V3_SCHEMA);
  assert.ok(!("eyebrow" in PAGE_V3_SCHEMA.properties), "the AI doesn't write the eyebrow");
});
test("thin facts: the headline falls back to trade + town", () => {
  const thin = buildFactSheet({ profile: { business_name: "C Ryan", primary_category: "Contractor", city: "Attleboro", state: "Massachusetts" }, raw: { type: "Paving contractor" } });
  assert.match(buildPagePrompt(thin), /use the trade and the town: "Paving contractor in Attleboro"/);
});

// ── The evidence check ───────────────────────────────────────────────────
console.log("evidence check");
const DRAFT = () => ({
  hero_headline: "Sewer lines cleared and leaks found fast", hero_headline_evidence: ["r1", "r2"],
  hero_sub: "Plumbing in North Attleborough since 1998. They came the next morning.", hero_sub_evidence: ["g", "r1"],
  proof: [
    { value: "4.9 ★", label: "on Google", evidence: ["g"] },
    { value: "Next morning", label: "how fast they came", evidence: ["r1", "r2"] },
    { value: "Honest pricing", label: "pricing", evidence: ["r1", "r4"] },
    { value: "Found it fast", label: "the leak", evidence: ["r2"] },
  ],
  services: [
    { name: "Backed-up sewer lines", description: "Roots in the pipe, found on camera. Licensed master plumber.", evidence: ["r1"], stock_subject: "sewer camera inspection" },
    { name: "Hidden leaks", description: "Found the leak behind the wall.", evidence: ["r9"], stock_subject: "wall leak" },
    { name: "Gas fitting", description: "Gas lines.", evidence: [], stock_subject: "gas line" },
  ],
  owner_section: { heading: "Meet Rick", body: "Rick answers the phone.", evidence: ["o.names"] },
  faqs: [{ q: "Do you offer free estimates?", a: "Yes, estimates are always free.", evidence: ["g"] }, { q: "Where do you work?", a: "North Attleborough and Plainville.", evidence: ["o.towns"] }],
  closing: { heading: "Got a leak?", line: "Call Rick." },
  service_page: null,
});
test("drops items citing ids that don't exist or nothing at all", () => {
  const { copy, removed } = filterByEvidence(DRAFT(), sheet());
  assert.deepEqual(copy.services.map(s => s.name), ["Backed-up sewer lines"]);
  assert.ok(removed.some(r => r.reason === "unknown_evidence" && /Hidden leaks/.test(r.text)));
  assert.ok(removed.some(r => r.reason === "no_evidence" && /Gas fitting/.test(r.text)));
});
test("an invented year or license is removed; the true sentence stays", () => {
  const { copy, removed } = filterByEvidence(DRAFT(), sheet());
  assert.equal(copy.hero_sub, "They came the next morning.");
  assert.ok(removed.some(r => r.reason === "unsupported_number" && /1998/.test(r.text)));
  assert.equal(copy.services[0].description, "Roots in the pipe, found on camera.");
  assert.ok(removed.some(r => r.reason === "unsupported_claim" && /Licensed/.test(r.text)));
  assert.deepEqual(copy.faqs.map(f => f.q), ["Where do you work?"], "free-estimate claim out with its FAQ");
});
test("a license the owner gave, cited, is kept", () => {
  const fs = sheet({ profile: { ...PROFILE, license_number: "MP-12345" } });
  const d = DRAFT();
  d.services[0] = { ...d.services[0], description: "Licensed master plumber.", evidence: ["r1", "o.license_number"] };
  assert.equal(filterByEvidence(d, fs).copy.services[0].description, "Licensed master plumber.");
});
test("unconfirmed (suggested) towns are dropped", () => {
  const d = DRAFT();
  d.faqs[1].a = "North Attleborough and Wrentham.";
  const { removed } = filterByEvidence(d, sheet());
  assert.ok(removed.some(r => r.reason === "unconfirmed_town"));
});

// ── No mid-sentence deletion ─────────────────────────────────────────────
console.log("no mid-sentence deletion");
const SENT = "We fix pipes, ensuring quality and integrity.";
test("v3: a sentence with a banned word is rewritten or dropped, never cut", async () => {
  const d = { ...DRAFT(), hero_sub: SENT, hero_sub_evidence: ["r1"] };
  const noRewrite = await checkPageCopyV3(d, sheet());
  assert.ok(!JSON.stringify(noRewrite).includes("ensuring and integrity"));
  assert.equal(noRewrite.hero_sub, "", "dropped whole without a rewrite");
  assert.ok(noRewrite.removed.some(r => r.reason === "banned_word" && r.text === SENT));

  const rewrite = async items => items.map(it => (it.text === SENT ? { id: it.id, keep: false, text: "We fix pipes and do it right." } : { id: it.id, keep: true, text: it.text }));
  const out = await checkPageCopyV3(d, sheet(), { rewrite });
  assert.equal(out.hero_sub, "We fix pipes and do it right.");
  assert.ok(out.removed.some(r => r.reason === "puffery_rewritten" && r.replacement === "We fix pipes and do it right."));
});
test("v3: a rewrite that adds a fact or keeps the word loses", async () => {
  const d = { ...DRAFT(), hero_sub: SENT, hero_sub_evidence: ["r1"] };
  const adds = async items => items.map(it => ({ id: it.id, keep: false, text: it.text === SENT ? "We fix pipes, 25 years running." : it.text }));
  assert.equal((await checkPageCopyV3(d, sheet(), { rewrite: adds })).hero_sub, "");
  const keeps = async items => items.map(it => ({ id: it.id, keep: false, text: it.text === SENT ? "We fix pipes with quality." : it.text }));
  assert.equal((await checkPageCopyV3(d, sheet(), { rewrite: keeps })).hero_sub, "");
});
test("v3: a clean sentence is never rewritten", async () => {
  const d = DRAFT();
  const churn = async items => items.map(it => ({ id: it.id, keep: false, text: "Something else entirely." }));
  const out = await checkPageCopyV3(d, sheet(), { rewrite: churn });
  assert.equal(out.hero_headline, "Sewer lines cleared and leaks found fast");
});
test("legacy paths: puffery drops the sentence, never the word", () => {
  const out = applyFactRules({ about: `${SENT} We clear drains.` }, "We fix pipes. We clear drains. integrity");
  assert.equal(out.about, "We clear drains.");
  assert.equal(factChecker("x").clean("ensuring quality and integrity"), "Ensuring quality and integrity");
  const scrubbed = scrubCopy({ hero_headline: "Reliable Lawn Care in Agawam", seo_title: "Quality lawns. Agawam mowing." });
  assert.equal(scrubbed.hero_headline, "");
  assert.equal(scrubbed.seo_title, "Agawam mowing.");
});

test("v3: a rewrite that is really another sentence is rejected; duplicates go", async () => {
  const d = { ...DRAFT(), hero_sub: `${SENT} They came the next morning.`, hero_sub_evidence: ["r1"] };
  const swap = async items => items.map(it => ({ id: it.id, keep: it.text !== SENT, text: it.text === SENT ? "They came the next morning." : it.text }));
  const out = await checkPageCopyV3(d, sheet(), { rewrite: swap });
  assert.equal(out.hero_sub, "They came the next morning.");
  assert.ok(out.removed.some(r => r.reason === "banned_word" && r.text === SENT));
});
test("v3: ad language counts as banned (transform your, expert, comprehensive)", async () => {
  for (const line of ["Transform your yard with mulch.", "Expert drain cleaning.", "Comprehensive plumbing services."]) {
    const out = await checkPageCopyV3({ ...DRAFT(), hero_sub: line, hero_sub_evidence: ["r1"] }, sheet());
    assert.equal(out.hero_sub, "", line);
  }
});
test("a generic Google type ('Services') gives way to the listing's own", () => {
  const fs = buildFactSheet({ profile: { primary_category: "services", city: "Bedford", state: "NH" }, place: { primaryTypeDisplayName: { text: "Services" } }, raw: { type: "Lawn care service" } });
  assert.equal(fs.business.primary_type, "Lawn care service");
  assert.equal(buildEyebrow(fs), "Lawn care service in Bedford, NH");
});

test("trade terms aren't puffery: a dedicated circuit is fine, a dedicated team isn't", () => {
  assert.equal(hasBannedWord("Install dedicated circuits for hot tubs"), false);
  assert.equal(hasBannedWord("A dedicated team"), true);
  assert.equal(hasBannedWord("Transforming lawns"), true);
});
test("only one service may rest on the listing alone", () => {
  const d = DRAFT();
  d.services = [
    { name: "Plumbing", description: "Plumbing in town.", evidence: ["g"], stock_subject: "pipes" },
    { name: "Driveway paving", description: "Paved driveways.", evidence: ["g"], stock_subject: "asphalt" },
    { name: "Backed-up sewer lines", description: "Roots in the pipe.", evidence: ["r1"], stock_subject: "sewer" },
  ];
  const { copy, removed } = filterByEvidence(d, sheet());
  assert.deepEqual(copy.services.map(s => s.name), ["Plumbing", "Backed-up sewer lines"]);
  assert.ok(removed.some(r => r.reason === "listing_only_service"));
});
test("people reviews name aren't named in copy unless they're owners", () => {
  const fs = sheet({ reviews: [placeReview(5, "Great crew. Jamie checked on the work every day and Rick was on time.")] });
  const d = { ...DRAFT(), hero_sub: "Jamie checks on the work every day.", hero_sub_evidence: ["r1"], services: [], faqs: [] };
  const { copy, removed } = filterByEvidence(d, fs);
  assert.equal(copy.hero_sub, "");
  assert.ok(removed.some(r => r.reason === "unconfirmed_name"));
  const ok = filterByEvidence({ ...d, hero_sub: "Rick was on time." }, fs);
  assert.equal(ok.copy.hero_sub, "Rick was on time.", "Rick is a confirmed owner name");
});
test("a headline rewritten into a long sentence is rejected; the service name stands in", async () => {
  const sp = { service_name: "Interior painting", headline: "Transform Your Home's Interior", intro: "Roots in the pipe, found on camera.", signs: [], what_we_do: [], review_ids: ["r1"], faqs: [], evidence: ["r1"] };
  const long = async items => items.map(it => ({ id: it.id, keep: !hasBannedWord(it.text), text: hasBannedWord(it.text) ? "Our team paints your home's interior rooms to give your whole house a brand new look." : it.text }));
  const out = await checkPageCopyV3({ ...DRAFT(), service_page: sp }, sheet(), { rewrite: long });
  assert.equal(out.service_page.headline, "Interior painting");
});

// ── Code-built parts ─────────────────────────────────────────────────────
console.log("code-built parts");
test("eyebrow is built in code from the fact sheet", async () => {
  assert.equal(buildEyebrow(sheet()), "Plumber in North Attleborough, MA");
  const generic = buildFactSheet({ profile: { primary_category: "services", city: "Cumberland", state: "RI" }, raw: { type: "House cleaning service" } });
  assert.equal(buildEyebrow(generic), "House cleaning service in Cumberland, RI");
  const out = await checkPageCopyV3({ ...DRAFT(), eyebrow: "Best plumber in Boston" }, sheet());
  assert.equal(out.eyebrow, "Plumber in North Attleborough, MA");
});
test("rating and hours proof come from code; AI rating items are ignored", async () => {
  assert.deepEqual(buildCodeProof(sheet()), [
    { value: "4.6 ★", label: "22 Google reviews", evidence: ["g"] },
    { value: "Saturdays", label: "Open on Saturdays", evidence: ["g"] },
  ]);
  const out = await checkPageCopyV3(DRAFT(), sheet());
  assert.deepEqual(out.proof.map(p => p.value), ["4.6 ★", "Saturdays", "Next morning"]);
  assert.ok(!out.proof.some(p => p.value === "4.9 ★"), "the AI's invented rating is gone");
  assert.ok(out.removed.some(r => r.reason === "label_repeats_value"));
  assert.ok(out.removed.some(r => r.reason === "fewer_than_2_reviews"));
});
test("banned words count in any form: ensuring, professionals", async () => {
  const d = { ...DRAFT(), hero_sub: "Roof work in Taunton, ensuring quick jobs.", hero_sub_evidence: ["r1"] };
  const out = await checkPageCopyV3(d, sheet());
  assert.equal(out.hero_sub, "");
  assert.ok(out.removed.some(r => r.reason === "banned_word" && /ensuring/.test(r.text)));
});
test("no strong rating, no rating proof", () => {
  const weak = buildFactSheet({ profile: { city: "X" }, place: { rating: 4.1, userRatingCount: 40 } });
  assert.deepEqual(buildCodeProof(weak), []);
});
test("service page is null when nothing backs it", async () => {
  const d = { ...DRAFT(), service_page: { service_name: "Gas fitting", headline: "Gas lines", intro: "We run gas lines.", signs: [], what_we_do: [], review_ids: [], faqs: [], evidence: ["g"] } };
  const out = await checkPageCopyV3(d, sheet());
  assert.equal(out.service_page, null);
  assert.ok(out.removed.some(r => r.field === "service_page" && r.reason === "no_review_or_owner_evidence"));
});
test("service page backed by a review is kept, with a slug and the owner's pick", async () => {
  const sp = { service_name: "Sewer lines", headline: "Backed-up sewer lines", intro: "Roots in the pipe, found on camera.", signs: ["Slow drains"], what_we_do: ["Camera the line"], review_ids: ["r1", "r9"], faqs: [], evidence: ["r1"] };
  const out = await checkPageCopyV3({ ...DRAFT(), service_page: sp }, sheet());
  assert.equal(out.service_page.slug, "sewer-lines");
  assert.deepEqual(out.service_page.review_ids, ["r1"], "unknown review ids dropped");
  const picked = await checkPageCopyV3({ ...DRAFT(), service_page: sp }, sheet({ owner: { service_for_page: "Sewer line repair" } }));
  assert.equal(picked.service_page.service_name, "Sewer line repair");
});
test("owner section is null without owner names or blurb", async () => {
  const fs = sheet({ profile: { ...PROFILE, brand_kit: { ...PROFILE.brand_kit, owner_names: [] } } });
  const d = { ...DRAFT(), owner_section: { heading: "Meet the team", body: "A family crew.", evidence: ["g"] } };
  assert.equal((await checkPageCopyV3(d, fs)).owner_section, null);
});
test("cost: one gpt-4o + one gpt-4o-mini call", () => {
  const c = costOf([{ model: "gpt-4o", input: 2000, output: 1000 }, { model: "gpt-4o-mini", input: 1500, output: 1000 }]);
  assert.equal(Number(c.toFixed(6)), Number((0.005 + 0.01 + 0.000225 + 0.0006).toFixed(6)));
});

for (const [name, fn] of pending) {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (e) { console.log(`  FAIL - ${name}`); console.error(e); process.exit(1); }
}
console.log(`\n${passed} passed`);
