// Run with: node tests/generator-prompt.test.js (also wired into `npm test`)
// The AI copy prompts and post-processing in api/_lib/generator-prompt.js.

import assert from "node:assert/strict";
import {
  buildAdminPrompt, buildSelfServePrompt, seoTitleFormat, yearsInBusinessFrom,
  normalizeGenerated, whyToString, honestCtaLabel, lintFlagsFor, finishGenerated,
} from "../api/_lib/generator-prompt.js";
import { lintCopy, scrubCopy } from "../api/_lib/copy-lint.js";
import { splitWhy, normalizeFaqs } from "../api/_lib/page-ssr.js";

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { console.error(`  FAIL - ${name}`); console.error(err); process.exitCode = 1; }
}

const admin = { businessName: "Pioneer Lawn", slug: "pioneer-lawn", phone: "413-555-0100", town: "Agawam", state: "CT", trade: "landscaping", services: ["Mowing"], areasServed: ["Agawam"] };
const form = { business_name: "Pioneer Lawn", primary_category: "landscaping", notes: "We mow lawns.", phone: "413-555-0100", city: "Agawam", state: "", service_area: "Agawam" };

console.log("prompts");
await test('no "several years", and years are "not provided" when not given', () => {
  for (const p of [buildAdminPrompt(admin), buildSelfServePrompt(form)]) {
    assert.doesNotMatch(p, /several years/i);
    assert.match(p, /Years in business: not provided/);
    assert.match(p, /Do not mention years/);
  }
});
await test("given years are passed through", () => {
  assert.match(buildAdminPrompt({ ...admin, yearsInBusiness: 12 }), /Years in business: 12 years/);
  assert.match(buildSelfServePrompt({ ...form, notes: "Mowing in Agawam since 2010." }), /Years in business: \d+ years/);
});
await test('no hard-coded "MA": the business\'s state, or none', () => {
  const a = buildAdminPrompt(admin);
  assert.doesNotMatch(a, /\bMA\b/);
  assert.match(a, /\[City\], CT \|/);
  const s = buildSelfServePrompt(form);
  assert.doesNotMatch(s, /\bMA\b/);
  assert.match(s, /\[City\] \| \[Short differentiator\]" \(no state was given/);
  assert.doesNotMatch(buildAdminPrompt({ ...admin, state: "" }), /\bMA\b|\[City\], /);
});
await test('CTA label is "Call for a quote" while free estimates are unknown', () => {
  for (const p of [buildAdminPrompt(admin), buildSelfServePrompt(form)]) {
    assert.match(p, /"Call for a quote"/);
    assert.doesNotMatch(p, /Call for a Free|Get a Free|"Free Estimates"/i);
    assert.match(p, /Free estimates: not provided/);
  }
});
await test('both prompts ask for faqs as {q, a} and why_choose_us as one string', () => {
  for (const p of [buildAdminPrompt(admin), buildSelfServePrompt(form)]) {
    assert.match(p, /"faqs": \[\{ "q": "", "a": "" \}\]/);
    assert.doesNotMatch(p, /"question"/);
    assert.match(p, /"why_choose_us": ""/);
  }
});
await test("seoTitleFormat", () => {
  assert.match(seoTitleFormat("NY"), /\[City\], NY \|/);
  assert.doesNotMatch(seoTitleFormat(undefined), /undefined|, \w\w \|/);
});
await test("yearsInBusinessFrom", () => {
  assert.equal(yearsInBusinessFrom(8), 8);
  assert.equal(yearsInBusinessFrom(undefined, "We've mowed for 15 years."), 15);
  assert.equal(yearsInBusinessFrom(null, "since 2016", new Date("2026-11-12")), 10);
  assert.equal(yearsInBusinessFrom(null, "We mow lawns."), null);
});

console.log("normalizeGenerated");
await test("old {question, answer} FAQs and array why_choose_us come out in the renderer's shape", () => {
  const g = normalizeGenerated({
    faqs: [{ question: "Q1?", answer: "A1." }, { q: "Q2?", a: "A2." }, { q: "", a: "x" }],
    why_choose_us: [{ title: "Owner on every job", description: "Mike mows" }, "Weekly visits"],
  });
  assert.deepEqual(g.faqs, [{ q: "Q1?", a: "A1." }, { q: "Q2?", a: "A2." }]);
  assert.equal(g.why_choose_us, "Owner on every job — Mike mows\nWeekly visits");
  assert.deepEqual(splitWhy(g.why_choose_us), ["Owner on every job — Mike mows", "Weekly visits"]);
  assert.deepEqual(normalizeFaqs(g.faqs), g.faqs);
  assert.equal(whyToString("a\nb"), "a\nb");
});

console.log("honest copy");
await test("CTA labels never say free while free estimates are unknown", () => {
  assert.equal(honestCtaLabel({ type: "call", label: "Call for a Free Estimate" }), "Call for a quote");
  assert.equal(honestCtaLabel({ type: "link", label: "Get a Free Quote" }), "Get a Quote");
  assert.equal(honestCtaLabel({ type: "email", label: "Email us" }), "Email us");
});
const invented = {
  hero_tagline: "Mike has mowed Agawam lawns for several years. Weekly visits.",
  about: "Over 20 years of experience.\n\nWe serve Agawam.",
  trust_badges: ["Free Estimates", "Licensed & Insured", "In business since 2004"],
  faqs: [
    { q: "Do you offer free estimates?", a: "Yes, estimates are always free." },
    { q: "How do I get a price?", a: "Call us. We give free, no-obligation quotes. Most lawns are $40 a visit." },
  ],
  services: [{ service_name: "Mowing", service_description: "Weekly mowing, edging and blowing from April to November." }],
  primary_cta: { type: "call", label: "Call for a Free Estimate" },
};
const flags = lintFlagsFor({ yearsInBusiness: null });
await test("lint flags invented years and free estimates in every field, FAQs included", () => {
  const fields = lintCopy(invented, flags).filter(i => i.kind === "unsupported_claim").map(i => i.field);
  for (const f of ["hero_tagline", "about", "trust_badges[0]", "trust_badges[2]", "faqs[0]", "faqs[1]", "primary_cta"]) assert.ok(fields.includes(f), f);
  assert.ok(!fields.includes("trust_badges[1]"));
  assert.equal(lintCopy(invented, {}).filter(i => i.kind === "unsupported_claim").length, 0, "no flags, no new checks");
});
await test("scrub drops the invented sentences, badges and FAQs and keeps the rest", () => {
  const s = scrubCopy(invented, flags);
  assert.equal(s.hero_tagline, "Weekly visits.");
  assert.equal(s.about, "We serve Agawam.");
  assert.deepEqual(s.trust_badges, ["Licensed & Insured"]);
  assert.deepEqual(s.faqs, [{ q: "How do I get a price?", a: "Call us. Most lawns are $40 a visit." }]);
  assert.equal(lintCopy(s, flags).filter(i => i.kind === "unsupported_claim" && i.field !== "primary_cta").length, 0);
});
await test("given years are fine", () => {
  const ok = lintCopy({ hero_tagline: "Mowing Agawam for 12 years." }, lintFlagsFor({ yearsInBusiness: 12 }));
  assert.equal(ok.filter(i => i.kind === "unsupported_claim").length, 0);
});

console.log("finishGenerated (both paths)");
await test("retries once with the problems listed and keeps the better draft", async () => {
  let asked = "";
  const better = { ...invented, hero_tagline: "Weekly mowing in Agawam.", trust_badges: [], faqs: [{ q: "How do I get a price?", a: "Call for a quote." }], about: "We serve Agawam." };
  const { generated, issues } = await finishGenerated(invented, { flags, retry: async extra => { asked = extra; return better; } });
  assert.match(asked, /mentions free estimates/);
  assert.equal(generated.hero_tagline, "Weekly mowing in Agawam.");
  assert.equal(generated.primary_cta.label, "Call for a quote");
  assert.equal(issues.filter(i => i.kind === "unsupported_claim").length, 0);
});
await test("a failed or worse retry falls back to the scrubbed first draft", async () => {
  const a = await finishGenerated(invented, { flags, retry: async () => { throw new Error("down"); } });
  const b = await finishGenerated(invented, { flags, retry: async () => invented });
  for (const { generated } of [a, b]) {
    assert.equal(generated.hero_tagline, "Weekly visits.");
    assert.equal(generated.primary_cta.label, "Call for a quote");
    assert.deepEqual(generated.faqs.map(f => Object.keys(f).sort()), [["a", "q"]]);
  }
});

console.log(`\n${passed} passed`);
