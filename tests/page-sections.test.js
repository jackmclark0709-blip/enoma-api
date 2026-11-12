// Run with: node tests/page-sections.test.js (also wired into `npm test`)
// The company page's server-rendered sections (api/_lib/page-ssr.js into
// public/profile.html): empty sections are left out of the HTML, the map only
// for local businesses, no "free" in CTAs, old rows still render. Plus the
// preview poll's gate in public/scripts/profile.js.

import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { normalizeProfile } from "../api/_lib/page-ssr.js";
import { renderCompanyPage } from "../api/_lib/company-page.js";

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { console.error(`  FAIL - ${name}`); console.error(err); process.exitCode = 1; }
}

const TEMPLATE = fs.readFileSync(new URL("../public/profile.html", import.meta.url), "utf8");
// Same fill as api/p.js (api/_lib/company-page.js renderCompanyPage).
function page(profile) {
  const html = renderCompanyPage(TEMPLATE, profile, { slug: "arno-plumbing" });
  return html.replace(/<script>window\.__PROFILE__[\s\S]*?<\/script>/, "").replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, "");
}
const headings = html => [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/g)].map(m => m[1].replace(/<[^>]+>/g, "").trim());

const bare = { business_name: "Arno Plumbing", primary_category: "plumbing", about: "We fix pipes.", services: [{ service_name: "Drain cleaning" }] };
const full = {
  ...bare, city: "Agawam", state: "MA", service_area: ["Agawam", "Westfield"],
  why_choose_us: "Owner on every job\nSame-week visits",
  faqs: [{ question: "Do you do drains?", answer: "Yes." }],
  testimonials: [{ quote: "Fixed it fast.", author: "Pat" }],
  attachments: ["https://cdn.example.com/job1.jpg", "https://cdn.example.com/menu.pdf"],
  before_after_images: [{ before: "https://cdn.example.com/b.jpg", after: "https://cdn.example.com/a.jpg" }],
};

console.log("empty sections");
await test('no testimonials or photos: no reviews, "Recent projects" or "Before & After" in the HTML at all', () => {
  const html = page(bare);
  const h = headings(html);
  for (const gone of ["What customers say", "Recent projects", "Before &amp; After", "Why choose us", "Frequently Asked Questions", "Areas We Serve"]) {
    assert.ok(!h.includes(gone), gone);
    assert.ok(!html.includes(`>${gone}<`), `${gone} still in the HTML`);
  }
  for (const id of ["gallerySection", "baSection", "testimonialsWrap", "whySection", "faqsBand", "townsWrap"]) assert.ok(!html.includes(`id="${id}"`), id);
  assert.doesNotMatch(html.slice(html.indexOf("<body")).replace(/<body class="\{\{BODY_CLASS\}\}"/, ""), /\{\{[A-Z_]+\}\}/);
});
await test("each section renders when it has content", () => {
  const h = headings(page(full));
  for (const there of ["Areas We Serve", "Recent projects", "Before &amp; After", "Why choose us", "What customers say", "Frequently Asked Questions"]) assert.ok(h.includes(there), there);
  const html = page(full);
  assert.match(html, /<img src="https:\/\/cdn\.example\.com\/job1\.jpg"/);
  assert.doesNotMatch(html, /menu\.pdf" alt/);
});
await test("why without testimonials, and testimonials without why", () => {
  const a = page({ ...bare, why_choose_us: "Owner on every job" });
  assert.ok(headings(a).includes("Why choose us"));
  assert.ok(!headings(a).includes("What customers say"));
  const b = page({ ...bare, testimonials: [{ quote: "Great", author: "Sam" }] });
  assert.ok(!headings(b).includes("Why choose us"));
  assert.ok(headings(b).includes("What customers say"));
});

console.log("map and areas");
await test("the map only for a local-radius business; area chips for everyone", () => {
  const local = page(full);
  assert.match(local, /id="serviceMapWrap"/);
  const national = page({ ...full, service_area: ["Nationwide"] });
  assert.doesNotMatch(national, /id="serviceMapWrap"|id="placesMapWrap"/);
  assert.match(national, /<span class="town">Nationwide<\/span>/);
});

console.log("CTA copy");
await test('"Get a quote", never free', () => {
  const html = page({ ...full, phone: "(413) 555-0100" });
  assert.match(html, /<a class="secondary-btn" href="#contact" data-contact="quote">Get a quote<\/a>/);
  assert.match(html, /<h2 id="quoteHeading">Get a quote<\/h2>/);
  assert.doesNotMatch(html, /Free Quote|Free Estimate|free quote|free estimate/);
});
await test("profile.js has no hard-coded free CTA or Accepting clients pill", () => {
  const js = fs.readFileSync(new URL("../public/scripts/profile.js", import.meta.url), "utf8");
  assert.doesNotMatch(js, /Free Quote|Accepting clients/);
});

console.log("old rows");
await test("old FAQ shapes, array why_choose_us and (on previews) free CTA labels are normalized on read", () => {
  const p = normalizeProfile({
    faqs: JSON.stringify([{ question: "Q?", answer: "A." }]),
    why_choose_us: [{ title: "Owner on every job", description: "hands-on" }],
    primary_cta_label: "Call for a Free Estimate", primary_cta_type: "call", is_claimed: false,
  });
  assert.deepEqual(p.faqs, [{ q: "Q?", a: "A." }]);
  assert.equal(p.why_choose_us, "Owner on every job — hands-on");
  assert.equal(p.primary_cta_label, "Call for a quote");
  assert.equal(normalizeProfile({ primary_cta_label: "Get a Free Quote", primary_cta_type: "link", is_claimed: false }).primary_cta_label, "Get a Quote");
  // A claimed page's label is the owner's own wording.
  assert.equal(normalizeProfile({ primary_cta_label: "Call Steve for a Free Estimate", primary_cta_type: "call", is_claimed: true }).primary_cta_label, "Call Steve for a Free Estimate");
  assert.equal(normalizeProfile({ primary_cta_label: "Book online", primary_cta_type: "link" }).primary_cta_label, "Book online");
});

console.log("preview poll");
// Load profile.js in a sandbox with just enough DOM to run setupPreviewPoll.
function pollSandbox(search, { claimOpen = false, prefilled = "" } = {}) {
  const els = {};
  const el = (id, hidden = true) => (els[id] = {
    id, value: "", classList: { set: new Set(hidden ? ["hidden"] : []), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, contains(c) { return this.set.has(c); } },
    addEventListener() {}, querySelectorAll: () => [], textContent: "",
  });
  el("previewPoll"); el("pollStep1"); el("pollStep2"); el("pollThanks"); el("pollClose"); el("pollQ2"); el("pollComment");
  el("claimBox", !claimOpen);
  el("claimEmail").value = prefilled;
  const timers = [], listeners = [];
  const window = { location: { search }, addEventListener: (t) => listeners.push(t), removeEventListener() {} };
  const ctx = {
    window, location: window.location, URLSearchParams, console,
    document: { getElementById: id => els[id] || null, addEventListener() {}, activeElement: null, documentElement: { scrollHeight: 0 } },
    localStorage: { getItem: () => null, setItem() {} },
    setTimeout: (fn, ms) => { timers.push(ms); return 0; },
    requestAnimationFrame: () => {}, fetch: () => Promise.resolve({ ok: true, json: () => ({}) }),
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(new URL("../public/scripts/profile.js", import.meta.url), "utf8"), ctx);
  ctx.setupPreviewPoll("arno-plumbing");
  return { timers, listeners, poll: els.previewPoll, allowed: ctx.previewPollAllowed };
}
await test("the poll does not initialise when ?m= is present (Jack's cold email)", () => {
  const s = pollSandbox("?m=6b1f0c2e-1111-4222-8333-944455556666");
  assert.deepEqual(s.timers, []);
  assert.deepEqual(s.listeners, []);
  assert.ok(s.poll.classList.contains("hidden"));
});
await test("nor when the claim box is open or prefilled", () => {
  assert.deepEqual(pollSandbox("?new=1", { claimOpen: true }).timers, []);
  assert.deepEqual(pollSandbox("", { prefilled: "owner@example.com" }).timers, []);
});
await test("other preview visitors still get it", () => {
  const s = pollSandbox("");
  assert.deepEqual(s.timers, [15000]);
  assert.deepEqual(s.listeners, ["scroll"]);
});

console.log(`\n${passed} passed`);
