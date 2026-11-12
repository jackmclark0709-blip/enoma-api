// Run with: node tests/page-copy.test.js (also wired into `npm test`)
// The AI copy prompts and post-processing in api/_lib/page-copy.js.

import assert from "node:assert/strict";
import {
  buildAdminPrompt, buildSelfServePrompt, seoTitleFormat, yearsInBusinessFrom,
  normalizeGenerated, whyToString, honestCtaLabel, lintFlagsFor, finishGenerated,
} from "../api/_lib/page-copy.js";
import { lintCopy, scrubCopy } from "../api/_lib/copy-lint.js";
import {
  COPY_SCHEMA, copyRequestBody, requestCopy, applyFactRules, factSourceText, normalizeSteps, buildFactsPrompt,
} from "../api/_lib/page-copy.js";
import fs from "node:fs";
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

console.log("structured output");
await test("one strict JSON schema for every path, sent as response_format json_schema", () => {
  const body = copyRequestBody("prompt");
  assert.equal(body.response_format.type, "json_schema");
  assert.equal(body.response_format.json_schema.strict, true);
  assert.equal(body.response_format.json_schema.schema, COPY_SCHEMA);
  // Strict mode: every object lists all its keys as required and allows no others.
  const walk = node => {
    if (node.type === "object") {
      assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort());
      assert.equal(node.additionalProperties, false);
      Object.values(node.properties).forEach(walk);
    }
    if (node.type === "array") walk(node.items);
  };
  walk(COPY_SCHEMA);
  for (const k of ["how_it_works", "services", "faqs", "why_choose_us", "service_area"]) assert.ok(COPY_SCHEMA.properties[k], k);
  assert.deepEqual(Object.keys(COPY_SCHEMA.properties.how_it_works.items.properties), ["title", "text"]);
});
await test("requestCopy parses the reply and fails with a code, never with half-parsed JSON", async () => {
  const reply = (status, message) => async () => ({ ok: status === 200, status, text: async () => "boom", json: async () => ({ choices: [{ message }] }) });
  const ok = await requestCopy("p", { fetchImpl: reply(200, { content: JSON.stringify({ hero_headline: "Hi" }) }), apiKey: "k" });
  assert.equal(ok.hero_headline, "Hi");
  await assert.rejects(requestCopy("p", { fetchImpl: reply(500, {}), apiKey: "k" }), e => e.code === "ai_request_failed");
  await assert.rejects(requestCopy("p", { fetchImpl: reply(200, { refusal: "no" }), apiKey: "k" }), e => e.code === "ai_refused");
  await assert.rejects(requestCopy("p", { fetchImpl: reply(200, { content: "" }), apiKey: "k" }), e => e.code === "ai_empty_response");
  let sent;
  await requestCopy("the prompt", { fetchImpl: async (url, init) => { sent = JSON.parse(init.body); return reply(200, { content: "{}" })(); }, apiKey: "k" });
  assert.equal(sent.response_format.type, "json_schema");
  assert.equal(sent.messages.at(-1).content, "the prompt");
});

console.log("facts-only rules (all paths)");
const ownerSource = factSourceText({ business_name: "Pioneer Lawn", notes: "We mow lawns in Agawam. Weekly or every two weeks.", services_json: JSON.stringify([{ service_name: "Mowing" }]), city: "Agawam", phone: "413-555-0100" });
await test("the validator rejects invented years and licenses", () => {
  const out = applyFactRules({
    about: "We mow lawns in Agawam. Serving the area since 1998. We have 20 years of experience. Fully licensed and insured. License #12345 on file.",
    why_choose_us: "Licensed and insured\nDecades of experience\nWeekly mowing in Agawam",
    trust_badges: ["Licensed & Insured", "Since 1998", "Weekly mowing"],
    faqs: [{ q: "Are you licensed?", a: "Yes, fully licensed." }, { q: "Where do you mow?", a: "Agawam." }],
    hero_headline: "Agawam lawn care since 1998",
  }, ownerSource);
  assert.equal(out.about, "We mow lawns in Agawam.");
  assert.equal(out.why_choose_us, "Weekly mowing in Agawam");
  assert.deepEqual(out.trust_badges, ["Weekly mowing"]);
  assert.deepEqual(out.faqs.map(f => f.q), ["Where do you mow?"]);
  assert.equal(out.hero_headline, "");
});
await test("facts the owner gave are kept", () => {
  const src = factSourceText({ business_name: "Pioneer Lawn", notes: "We mow lawns.", years_in_business: 12, license_number: "HIC-555", is_insured: true, offers_free_estimates: true, response_time: "within 2 hours" });
  const out = applyFactRules({ about: "We have mowed for 12 years. Licensed (HIC-555) and insured. Estimates are free." }, src);
  assert.equal(out.about, "We have mowed for 12 years. Licensed (HIC-555) and insured. Estimates are free.");
  // Not given: the prompt's own "not provided" lines never count as a source.
  assert.doesNotMatch(factSourceText({ is_insured: null, offers_free_estimates: null }), /insur|free/);
});
await test("how_it_works: three steps with no invented facts, or none at all", () => {
  const good = applyFactRules({ how_it_works: [{ title: "Tell us the job", text: "Call or send the form." }, { title: "Get a quote", text: "We send a price." }, { title: "We do the work", text: "On a day that suits you." }] }, ownerSource);
  assert.equal(good.how_it_works.length, 3);
  const invented = applyFactRules({ how_it_works: [{ title: "Call us", text: "We answer 24/7." }, { title: "Get a quote in 15 minutes", text: "" }, { title: "Done", text: "" }] }, ownerSource);
  assert.deepEqual(invented.how_it_works, []);
  assert.deepEqual(normalizeSteps([{ title: "One" }, { title: "Two" }]), [], "fewer than 3: none");
});
await test("service descriptions stay grounded in the input", () => {
  const out = applyFactRules({ services: [{ service_name: "Mowing", service_description: "Weekly or every two weeks. Starting at $35 per visit. 100% satisfaction guaranteed." }] }, ownerSource);
  assert.equal(out.services[0].service_description, "Weekly or every two weeks.");
});
await test("finishGenerated runs the facts-only rules when given a source", async () => {
  const { generated } = await finishGenerated({ about: "We mow lawns in Agawam. Family owned since 1990.", services: [{ service_name: "Mowing", service_description: "Weekly mowing." }] }, { source: ownerSource, flags: {} });
  assert.equal(generated.about, "We mow lawns in Agawam.");
});

console.log("one generator for every path");
await test("both generate-business.js paths and the preview generator call page-copy.js", () => {
  const gb = fs.readFileSync(new URL("../api/generate-business.js", import.meta.url), "utf8");
  assert.match(gb, /from "\.\/_lib\/page-copy\.js"/);
  assert.doesNotMatch(gb, /chat\/completions/, "no private OpenAI calls left");
  assert.match(gb.slice(gb.indexOf("async function handleAdminGenerate"), gb.indexOf("export default async function handler")), /requestCopy\(prompt \+ extra[\s\S]*source: factSourceText\(adminInput\)/);
  const form = gb.slice(gb.indexOf("export default async function handler"));
  assert.match(form, /buildSelfServePrompt\(promptProfile\)[\s\S]*requestCopy\(prompt \+ extra[\s\S]*source: factSourceText\(promptProfile\)/);
  const pg = fs.readFileSync(new URL("../api/_lib/preview-generator.js", import.meta.url), "utf8");
  assert.match(pg, /from "\.\/page-copy\.js"/);
  assert.match(pg, /applyFactRules\(/);
  const ga = fs.readFileSync(new URL("../api/ga-metrics.js", import.meta.url), "utf8");
  const preview = ga.slice(ga.indexOf("async function generatePreviewForProspect"), ga.indexOf("// ── Monthly results email"));
  assert.match(preview, /requestCopy\(prompt/);
  assert.doesNotMatch(preview, /chat\/completions/);
});
await test("the banned-word list and copy-lint still apply", () => {
  const issues = lintCopy({ hero_headline: "Trusted lawn care", services: [] }, {});
  assert.ok(issues.some(i => i.kind === "banned_word"));
  for (const p of [buildAdminPrompt(admin), buildSelfServePrompt(form)]) assert.match(p, /BANNED|AVOID/);
  assert.match(buildFactsPrompt({ name: "X", trade: "plumber", city: "A", state: "MA", phone: "1", siteText: "" }), /No puffery words/);
});
await test("prompts carry the owner's new answers, or say they weren't given", () => {
  const p = buildSelfServePrompt({ ...form, license_number: "HIC-1", is_insured: true, response_time: "within 2 hours", offers_free_estimates: true, years_in_business: 7 });
  assert.match(p, /License number: HIC-1/);
  assert.match(p, /Insured: yes/);
  assert.match(p, /Usually replies: within 2 hours/);
  assert.match(p, /Free estimates: yes/);
  assert.match(p, /Years in business: 7 years/);
  const none = buildAdminPrompt(admin);
  assert.match(none, /License number: not provided/);
  assert.match(none, /Insured: not provided/);
  assert.match(none, /how_it_works: exactly 3 short steps/);
});

console.log(`\n${passed} passed`);
