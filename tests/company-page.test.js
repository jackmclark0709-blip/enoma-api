// Run with: node tests/company-page.test.js (also wired into `npm test`)
// The upgraded company page (api/_lib/company-page.js into public/profile.html):
// every block renders from real data or is absent from the HTML, the proof
// line only states facts that exist, service quote deep links, the schema,
// and old rows still rendering.

import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {
  renderCompanyPage, renderBlocks, proofFacts, trustFacts, areaSummary, heroVisual, mergeReviews,
  defaultSteps, howItWorksSteps, showEnomaPitch, localBusinessSchema, openingHoursSpecification,
  serviceSlug, clientProfile, googleMapsUrl,
} from "../api/_lib/company-page.js";
import { serviceChoices } from "../api/_lib/quote-form.js";

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { console.error(`  FAIL - ${name}`); console.error(err); process.exitCode = 1; }
}

const TEMPLATE = fs.readFileSync(new URL("../public/profile.html", import.meta.url), "utf8");
const body = html => html.slice(html.indexOf("<body"))
  .replace(/<script>window\.__PROFILE__[\s\S]*?<\/script>/, "")
  .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, "");
const page = (p, ctx = {}) => body(renderCompanyPage(TEMPLATE, p, { slug: p.username || "x", ...ctx }));
const headings = html => [...html.matchAll(/<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/g)].map(m => [Number(m[1]), m[2].replace(/<[^>]+>/g, "").trim()]);
const ids = html => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));

// A landscaper with everything filled in.
const FULL = {
  business_id: "11111111-1111-4111-8111-111111111111", username: "green-acres", business_name: "Green Acres Lawn",
  is_claimed: true, primary_category: "landscaping", phone: "(413) 555-0100", email: "owner@example.com",
  address: "12 Elm St, Agawam, MA", city: "Agawam", state: "MA", google_place_id: "ChIJabc123defGHI",
  service_area: ["Agawam", "Westfield", "Feeding Hills"],
  hero_headline: "Lawn care in Agawam", hero_tagline: "Weekly mowing and cleanups.",
  about: "We mow lawns.\n\nOwner on every job.", why_choose_us: "Owner on every job\nSame crew each week",
  services: [
    { service_name: "Weekly Mowing", service_description: "Mowing, edging and blowing.", price_from: "$45", turnaround: "Starts next week" },
    { service_name: "Spring Cleanup", service_description: "Leaves, beds and debris." },
  ],
  faqs: [{ q: "Do you mulch?", a: "Yes." }],
  testimonials: [
    { quote: "Great crew, always on time.", author: "Pat G.", rating: 5, source: "google" },
    { quote: "Fixed our lawn.", author: "Sam", rating: 5, source: "enoma" },
  ],
  attachments: ["https://cdn.example.com/job1.jpg", "https://cdn.example.com/prices.pdf"],
  attachment_kinds: { "https://cdn.example.com/job1.jpg": "work" },
  before_after_images: [{ before: "https://cdn.example.com/b.jpg", after: "https://cdn.example.com/a.jpg" }],
  logo_url: "https://cdn.example.com/logo.png", social_links: { facebook: "https://facebook.com/greenacres" },
  average_rating: 4.9, review_count: 37, hero_availability: "Mon-Fri 8am-6pm",
  years_in_business: 12, license_number: "HIC-12345", is_insured: true, offers_free_estimates: true,
  response_time: "within 2 hours", owner_name: "Maria Lopez", owner_photo_url: "https://cdn.example.com/maria.jpg",
  owner_blurb: "I started Green Acres in 2013.\n\nI still mow every lawn myself.",
  how_it_works: [{ title: "Send a photo", text: "Text us your yard." }, { title: "Get a price", text: "Same day." }, { title: "We mow", text: "Every week." }],
};
const SPOTS = [{ service_slug: "spring-cleanup", service_name: "Spring Cleanup" }];
const APPROVED = [{ name: "Jo", rating: 5, quote: "Best yard on the street now.", created_at: "2026-11-01T10:00:00Z", decided_at: "2026-11-02T10:00:00Z" }];

// An unclaimed instant preview with the bare minimum.
const BARE = { username: "arno-plumbing", business_name: "Arno Plumbing", is_claimed: false, primary_category: "plumbing", services: [] };

console.log("blocks with data");
const full = page(FULL, { spotlights: SPOTS, approvedReviews: APPROVED, paying: true });
const fullIds = ids(full);
await test("every block renders for a fully filled profile", () => {
  for (const id of ["contactStrip", "heroHeadline", "proofLine", "heroVisual", "heroStatus", "trustStrip", "servicesSection",
    "howItWorks", "recentWork", "gallerySection", "baSection", "testimonialsWrap", "meetOwner", "aboutSection", "whySection",
    "townsWrap", "faqsBand", "contact", "contactForm", "attachments", "siteFooter", "mobileCallBar"]) {
    assert.ok(fullIds.has(id), id);
  }
});
await test("header: name/logo · Call · Text (sms: to the same phone) · Get a quote", () => {
  const header = full.slice(full.indexOf('id="contactStrip"'), full.indexOf("</header>"));
  assert.match(header, /<img id="navLogo" class="nav-logo" src="https:\/\/cdn\.example\.com\/logo\.png" alt="Green Acres Lawn"/);
  assert.match(header, /href="tel:4135550100" data-contact="call"[^>]*>.*Call<\/a>/s);
  assert.match(header, /href="sms:4135550100" data-contact="sms"[^>]*>.*Text<\/a>/s);
  assert.match(header, /href="#contact" data-contact="quote"[^>]*>.*Get a quote<\/a>/s);
});
await test("hero: proof line in order, Call + Get a quote, Open now slot, Usually replies, best photo", () => {
  assert.match(full, /<p class="proof-line" id="proofLine">.*★ 4\.9 · 37 Google reviews.*Licensed MA #HIC-12345.*Insured.*12 years in business.*Free estimates<\/span><\/p>/s);
  assert.match(full, /<a class="primary-cta" href="tel:4135550100" data-contact="call">.*Call \(413\) 555-0100<\/a><a class="secondary-btn" href="#contact" data-contact="quote">Get a quote<\/a>/s);
  assert.match(full, /id="heroOpen" data-open-schedule='[^']+' hidden>● Open now/);
  assert.match(full, /<span class="hero-reply">Usually replies within 2 hours<\/span>/);
  assert.match(full, /<figure class="hero-visual hero-visual--work" id="heroVisual">\s*<img src="https:\/\/cdn\.example\.com\/job1\.jpg"/);
});
await test("trust strip: the same facts plus the service-area summary", () => {
  const strip = full.slice(full.indexOf('id="trustStrip"'), full.indexOf("</section>", full.indexOf('id="trustStrip"')));
  for (const t of ["4.9 · 37 Google reviews", "Licensed MA #HIC-12345", "Insured", "12 years in business", "Free estimates", "Serving Agawam, Westfield and Feeding Hills"]) assert.ok(strip.includes(t), t);
  assert.ok(!strip.includes("★ 4.9"), "no double star next to the star icon");
});
await test("services as cards: description, From / turnaround, Get a quote deep link, More about → when a spotlight exists", () => {
  assert.match(full, /<h3>Weekly Mowing<\/h3>\s*<p class="service-desc">Mowing, edging and blowing\.<\/p>\s*<p class="service-meta"><span>From \$45<\/span><span>Starts next week<\/span><\/p>/);
  assert.match(full, /<a class="service-quote" href="#quote\?service=weekly-mowing" data-service-quote="weekly-mowing">Get a quote<\/a>/);
  assert.match(full, /<a class="service-more" href="\/green-acres\/spring-cleanup" data-spotlight-link="spring-cleanup">More about Spring Cleanup →<\/a>/);
  assert.equal((full.match(/class="service-more"/g) || []).length, 1);
});
await test("how it works: the owner's own three steps", () => {
  assert.deepEqual(headings(full).filter(([, t]) => ["Send a photo", "Get a price", "We mow"].includes(t)).map(([, t]) => t), ["Send a photo", "Get a price", "We mow"]);
});
await test("reviews: stored Google quotes + approved review requests, newest first, rating summary, Read all on Google", () => {
  const sec = full.slice(full.indexOf('id="testimonialsWrap"'), full.indexOf("</section>", full.indexOf('id="testimonialsWrap"')));
  const quotes = [...sec.matchAll(/<blockquote><p>([^<]+)<\/p>/g)].map(m => m[1]);
  assert.deepEqual(quotes, ["Best yard on the street now.", "Great crew, always on time.", "Fixed our lawn."]);
  assert.match(sec, /<strong>4\.9<\/strong> from 37 Google reviews/);
  assert.match(sec, /href="https:\/\/www\.google\.com\/maps\/search\/\?api=1&amp;query=Green%20Acres%20Lawn&amp;query_place_id=ChIJabc123defGHI"[^>]*>Read all on Google →/);
});
await test("meet the owner: photo, first name, blurb paragraphs", () => {
  const sec = full.slice(full.indexOf('id="meetOwner"'), full.indexOf("</section>", full.indexOf('id="meetOwner"')));
  assert.match(sec, /<img class="owner-photo" src="https:\/\/cdn\.example\.com\/maria\.jpg" alt="Maria Lopez"/);
  assert.match(sec, /<h2 id="ownerHeading">Meet Maria<\/h2>/);
  assert.equal((sec.match(/<p>/g) || []).length, 2);
});
await test("areas: chips, a map for a local business, and 'Text us your town' with the sms link", () => {
  assert.match(full, /<span class="town">Feeding Hills<\/span>/);
  assert.ok(fullIds.has("serviceMapWrap"));
  assert.match(full, /Not sure we cover you\? <a href="sms:4135550100" data-contact="sms">Text us your town\.<\/a>/);
});
await test("footer: hours, address, license #, Powered by Enoma; no pitch on a paying customer's page", () => {
  const f = full.slice(full.indexOf('id="siteFooter"'), full.indexOf("</footer>"));
  assert.match(f, /Hours<\/span> Mon-Fri 8am-6pm/);
  assert.match(f, /Address<\/span> 12 Elm St, Agawam, MA/);
  assert.match(f, /License<\/span> #HIC-12345/);
  assert.match(f, /Powered by Enoma/);
  assert.doesNotMatch(f, /Get your own website/);
});
await test("mobile bottom bar: Call / Text / Get a quote", () => {
  const bar = full.slice(full.indexOf('id="mobileCallBar"'), full.indexOf("</nav>", full.indexOf('id="mobileCallBar"')));
  assert.match(bar, /class="mcb-call" href="tel:4135550100"/);
  assert.match(bar, /class="mcb-text" href="sms:4135550100" data-contact="sms"/);
  assert.match(bar, /class="mcb-quote" href="#contact"/);
});
await test("headings are in order: one h1, no level skipped", () => {
  const h = headings(full);
  assert.equal(h.filter(([l]) => l === 1).length, 1);
  assert.equal(h[0][0], 1);
  for (let i = 1; i < h.length; i++) assert.ok(h[i][0] <= h[i - 1][0] + 1, `${h[i - 1][1]} → ${h[i][1]}`);
});

console.log("blocks without data");
const bare = page(BARE);
const bareIds = ids(bare);
await test("an empty preview profile: every data block is absent from the HTML, not hidden", () => {
  for (const id of ["proofLine", "heroVisual", "heroStatus", "trustStrip", "servicesSection", "recentWork", "gallerySection", "baSection",
    "testimonialsWrap", "meetOwner", "aboutSection", "townsWrap", "faqsBand", "attachments", "navLogo", "tagline"]) {
    assert.ok(!bareIds.has(id), `${id} should be absent`);
  }
  for (const gone of ["Meet ", "What customers say", "Areas We Serve", "Frequently Asked Questions", "Resources", "Licensed", "Insured", "years in business", "Free estimates", "Usually replies", "Text us your town"]) {
    assert.ok(!bare.includes(gone), gone);
  }
  assert.doesNotMatch(bare.replace('class="{{BODY_CLASS}}"', ""), /\{\{[A-Z_]+\}\}/);
});
await test("no phone: no Call or Text anywhere, Get a quote stays", () => {
  assert.doesNotMatch(bare, /href="tel:|href="sms:/);
  assert.match(bare, /<a class="primary-cta" href="#contact" data-contact="quote">Get a quote<\/a>/);
  assert.match(bare, /class="mcb-quote"/);
});
await test("no photo at all: no card, the headline takes the full width", () => {
  assert.match(bare, /<section class="hero-wrapper hero--text"/);
  assert.equal(heroVisual(BARE), null);
});
await test("still there with no data: header name, hero headline, how it works defaults, quote form, footer", () => {
  assert.match(bare, /<span id="businessName" class="brand-text">Arno Plumbing<\/span>/);
  assert.match(bare, /<h1 id="heroHeadline" class="hero-headline">Arno Plumbing<\/h1>/);
  assert.ok(bareIds.has("howItWorks") && bareIds.has("contactForm") && bareIds.has("siteFooter"));
});
await test("unclaimed previews and unpaid pages carry the Enoma pitch; paying pages never", () => {
  assert.match(bare, /Get your own website →/);
  assert.equal(showEnomaPitch({ is_claimed: false }, { paying: true }), true);
  assert.equal(showEnomaPitch({ is_claimed: true }, { paying: false }), true);
  assert.equal(showEnomaPitch({ is_claimed: true }, { paying: true }), false);
});

console.log("proof line");
await test("only fields that exist, in order", () => {
  assert.deepEqual(proofFacts({}), []);
  assert.deepEqual(proofFacts({ is_insured: true }).map(f => f.text), ["Insured"]);
  assert.deepEqual(proofFacts({ license_number: "12345" }).map(f => f.text), ["Licensed #12345"], "no state: no state");
  assert.deepEqual(proofFacts({ license_number: "12345", state: "Massachusetts" }).map(f => f.text), ["Licensed #12345"], "only a 2-letter state");
  assert.deepEqual(proofFacts({ years_in_business: 1 }).map(f => f.text), ["1 year in business"]);
  assert.deepEqual(proofFacts({ years_in_business: 0 }), []);
  assert.deepEqual(proofFacts({ offers_free_estimates: true, is_insured: true, license_number: "9", state: "CT", years_in_business: 3, average_rating: 4.8, review_count: 20 }).map(f => f.key),
    ["rating", "license", "insured", "years", "free_estimates"]);
});
await test("no invented values: false, unanswered and weak facts say nothing", () => {
  assert.deepEqual(proofFacts({ is_insured: false, offers_free_estimates: false, years_in_business: null, license_number: "  " }), []);
  assert.deepEqual(proofFacts({ is_insured: null, offers_free_estimates: null }), []);
  assert.deepEqual(proofFacts({ average_rating: 4.2, review_count: 50 }), [], "a middling rating is left off");
  assert.deepEqual(proofFacts({ average_rating: 5, review_count: 2 }), [], "a thin rating is left off");
  // Old AI copy saying "free estimates" or "licensed" never becomes a proof fact.
  assert.deepEqual(proofFacts({ trust_badges: ["Free Estimates", "Licensed & Insured"], about: "Free estimates. Licensed and insured. 30 years." }), []);
  // Every fact traces to its own field.
  const p = { average_rating: 4.7, review_count: 12, license_number: "77", state: "RI", is_insured: true, years_in_business: 4, offers_free_estimates: true };
  for (const f of proofFacts(p)) {
    const src = { rating: "4.7 · 12", license: "RI #77", insured: "Insured", years: "4 years", free_estimates: "Free estimates" }[f.key];
    assert.ok(f.text.includes(src), f.text);
  }
});
await test("trust strip hides under 2 facts; area summary", () => {
  assert.deepEqual(trustFacts({ service_area: ["Agawam"] }), []);
  assert.equal(trustFacts({ service_area: ["Agawam"], is_insured: true }).length, 2);
  assert.equal(areaSummary({ service_area: ["A", "B", "C", "D", "E"] }), "Serving A, B + 3 more");
  assert.equal(areaSummary({ service_area: ["Marlborough", "Nationwide (shipped kits)"] }), "Serving customers nationwide");
  assert.equal(areaSummary({}), "");
});

console.log("hero picture and reviews");
await test("hero picture: work photo, else before/after, else owner, else the real logo, else none", () => {
  assert.equal(heroVisual({ attachments: ["https://x/flyer.jpg"], attachment_kinds: { "https://x/flyer.jpg": "flyer" }, logo_url: "https://x/l.png" }).kind, "logo", "a flyer never");
  assert.equal(heroVisual({ before_after_images: [{ before: "https://x/b.jpg", after: "https://x/a.jpg" }], owner_photo_url: "https://x/o.jpg" }).url, "https://x/a.jpg");
  assert.equal(heroVisual({ owner_photo_url: "https://x/o.jpg", logo_url: "https://x/l.png" }).kind, "owner");
  assert.equal(heroVisual({ logo_url: "https://x/l.png" }).kind, "logo");
  assert.equal(heroVisual({ starter_logo_id: "badge" }), null, "a generated starter logo isn't a real logo");
});
await test("reviews: deduped, newest first, at most 6", () => {
  const t = Array.from({ length: 8 }, (_, i) => ({ quote: `Quote ${i}`, author: `A${i}` }));
  const merged = mergeReviews([{ quote: "Approved one", author: "Jo", source: "enoma" }, ...t],
    [{ name: "Jo", quote: "Approved one", rating: 5, decided_at: "2026-10-01" }, { name: "Kim", quote: "Newer", rating: 4, decided_at: "2026-11-01" }]);
  assert.equal(merged.length, 6);
  assert.deepEqual(merged.slice(0, 3).map(r => r.quote), ["Newer", "Approved one", "Quote 0"]);
  assert.equal(merged.filter(r => r.quote === "Approved one").length, 1);
  assert.deepEqual(mergeReviews([], []), []);
});

console.log("how it works defaults");
await test("defaults contain no facts about the business", () => {
  const p = { business_name: "Zed's Heating", city: "Springfield", primary_category: "hvac", years_in_business: 30, license_number: "999", offers_free_estimates: true, phone: "413-555-0199" };
  const text = JSON.stringify(defaultSteps(p));
  for (const fact of ["Zed", "Springfield", "30", "999", "free", "Free", "licen", "insur", "413", "guarantee", "same day", "24/7"]) assert.ok(!text.includes(fact), fact);
  assert.deepEqual(defaultSteps(p).map(s => s.title), ["Tell us the job", "Get a quote fast", "We do the work"]);
  assert.equal(defaultSteps({ response_time: "within 2 hours" })[1].title, "Get a quote within 2 hours");
  assert.equal(howItWorksSteps({ how_it_works: [{ title: "Only one" }] }).length, 3, "a partial list falls back to defaults");
});

console.log("service quote deep link");
await test("each card's link matches its chip in the quote form (same slug rule as quote-form.js)", () => {
  const qf = fs.readFileSync(new URL("../public/scripts/quote-form.js", import.meta.url), "utf8");
  const clientSlug = new Function(`${qf.match(/function serviceSlug\(t\) \{[\s\S]*?\n  \}/)[0]}; return serviceSlug;`)();
  for (const name of ["Weekly Mowing", "Snow Removal & Salting", "HVAC (Install)", "Re-piping"]) assert.equal(clientSlug(name), serviceSlug(name), name);
  for (const name of serviceChoices(FULL)) assert.match(full, new RegExp(`href="#quote\\?service=${serviceSlug(name)}"`));
});
await test("#quote?service=<slug> preselects that service and opens step 2 (quote-form.js in a sandbox)", () => {
  const box = value => ({ value, checked: false });
  const boxes = [box("Weekly Mowing"), box("Spring Cleanup"), box("Something else")];
  const classes = el => ({ set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, contains(c) { return this.set.has(c); }, toggle(c, on) { on ? this.set.add(c) : this.set.delete(c); } });
  const steps = [1, 2, 3, 4].map(n => ({ n, classList: classes(), getAttribute: () => String(n), querySelector: () => ({ focus() {} }) }));
  const form = {
    classList: classes(), elements: { location: { value: "", addEventListener() {} } },
    getAttribute: a => ({ "data-slug": "", "data-start-step": "1", "data-page-type": "company" })[a] ?? null,
    hasAttribute: () => false, addEventListener() {},
    querySelectorAll: s => (s === ".qf-step" ? steps : s === 'input[name="services"]' ? boxes : []),
    querySelector: () => null,
  };
  const progress = { textContent: "" };
  const window = { matchMedia: () => ({ matches: true }), fetch: () => Promise.resolve() };
  const ctx = { window, fetch: window.fetch, URLSearchParams, location: { search: "" }, setTimeout,
    document: { querySelector: () => form, getElementById: id => (id === "qfProgress" ? progress : id === "qfBack" ? { hidden: true, addEventListener() {} } : null), cookie: "" },
    localStorage: { getItem: () => null } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(new URL("../public/scripts/quote-form.js", import.meta.url), "utf8"), ctx);
  assert.equal(progress.textContent, "Step 1 of 4");
  assert.equal(window.enomaQuoteForm.preselectService("no-such-service"), false);
  assert.equal(window.enomaQuoteForm.preselectService("spring-cleanup"), true);
  assert.deepEqual(boxes.map(b => b.checked), [false, true, false]);
  assert.equal(progress.textContent, "Step 2 of 4");
  assert.ok(steps[1].classList.contains("is-current"));
});
await test("profile.js reads the deep link from the hash", () => {
  const js = fs.readFileSync(new URL("../public/scripts/profile.js", import.meta.url), "utf8");
  const parse = new Function(`${js.match(/function quoteServiceFromHash\(hash\) \{[\s\S]*?\n\}/)[0]}; return quoteServiceFromHash;`)();
  assert.equal(parse("#quote?service=weekly-mowing"), "weekly-mowing");
  assert.equal(parse("#quote"), "");
  assert.equal(parse("#contact"), null);
});

console.log("schema");
const schema = localBusinessSchema(FULL, { canonical: "https://enoma.io/green-acres", image: "https://cdn.example.com/job1.jpg" });
await test("areaServed (towns), openingHoursSpecification (from hours), sameAs (Maps + socials), makesOffer services", () => {
  assert.equal(schema["@type"], "LandscapingBusiness");
  assert.deepEqual(schema.areaServed.map(a => a.name), ["Agawam", "Westfield", "Feeding Hills"]);
  assert.deepEqual(schema.openingHoursSpecification, [{ "@type": "OpeningHoursSpecification",
    dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map(d => `https://schema.org/${d}`), opens: "08:00", closes: "18:00" }]);
  assert.ok(schema.sameAs.includes(googleMapsUrl(FULL)));
  assert.ok(schema.sameAs.includes("https://facebook.com/greenacres"));
  assert.deepEqual(schema.makesOffer.map(o => o.itemOffered.name), ["Weekly Mowing", "Spring Cleanup"]);
  assert.equal(schema.makesOffer[0].itemOffered["@type"], "Service");
  assert.deepEqual(schema.makesOffer[0].priceSpecification, { "@type": "PriceSpecification", minPrice: 45, priceCurrency: "USD" });
});
await test("no aggregateRating, and nothing the page doesn't show (no made-up priceRange)", () => {
  const json = JSON.stringify(schema);
  assert.doesNotMatch(json, /aggregateRating|AggregateRating|ratingValue|reviewCount/);
  assert.equal(schema.priceRange, undefined);
  const html = renderCompanyPage(TEMPLATE, FULL, { slug: "green-acres", canonical: "https://enoma.io/green-acres" });
  const tag = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(tag["@id"], "https://enoma.io/green-acres");
  assert.doesNotMatch(html, /aggregateRating/);
});
await test("schema without data leaves the fields out", () => {
  const s = localBusinessSchema({ business_name: "X" }, { canonical: "https://enoma.io/x" });
  for (const k of ["areaServed", "openingHoursSpecification", "sameAs", "makesOffer", "address"]) assert.equal(s[k], undefined, k);
  assert.equal(openingHoursSpecification({ hero_availability: "call anytime" }), undefined, "unreadable hours: none");
});

console.log("old rows");
// A row from before the upgrade (no new columns): same content, new layout.
const OLD = {
  username: "conways-landscaping", business_name: "Conway's Landscaping", is_claimed: true, primary_category: "landscaping",
  phone: "(413)-896-5392", city: "Agawam", state: "MA", service_area: ["West Springfield", "Agawam", "Feeding Hills"],
  hero_headline: "Lawn Care in Agawam", hero_tagline: "Weekly mowing.", about: "Founded in 2021.\r\n\r\nWe help homeowners.",
  why_choose_us: "Owner-operated", services: [{ service_name: "Mowing", service_description: "Weekly mowing.", price: "" }],
  faqs: [{ question: "What areas do you serve?", answer: "Agawam." }], testimonials: [{ quote: "Highly recommend.", author: "Shana" }],
  trust_badges: ["Free Estimates", "Since 2021"], hero_availability: "M-F. 8am-6pm.", hero_response_time: "Typically responds within a few hours",
  primary_cta_label: "Call Us Today", primary_cta_type: "call", primary_cta_value: "(413)-896-5392",
};
await test("an old row's own content all still renders", () => {
  const html = page(OLD);
  for (const text of ["Lawn Care in Agawam", "Weekly mowing.", "Founded in 2021.", "We help homeowners.", "Owner-operated", "Mowing",
    "What areas do you serve?", "Agawam.", "Highly recommend.", "West Springfield", "Feeding Hills", "M-F. 8am-6pm"]) {
    assert.ok(html.includes(text), text);
  }
});
await test("an old row gains no claims it never made", () => {
  const html = page(OLD);
  for (const claim of ["Free estimates", "Licensed", "Insured", "years in business", "Usually replies", "Meet "]) assert.ok(!html.includes(claim), claim);
  assert.ok(!ids(html).has("trustStrip"), "only one fact (the area): no strip");
});

console.log("client data");
await test("window.__PROFILE__ carries behaviour data only, not the owner's email", () => {
  const c = clientProfile(FULL);
  assert.equal(c.email, undefined);
  assert.equal(c.owner_blurb, 1, "the checklist only needs to know it's there");
  assert.equal(c.username, "green-acres");
  assert.equal(c.is_local_radius, true);
});

console.log(`\n${passed} passed`);
