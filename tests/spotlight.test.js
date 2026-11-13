// Run with: node tests/spotlight.test.js (also wired into `npm test`)

import assert from "node:assert/strict";
import fs from "node:fs";
import {
  gapCheck, slugifyService, normalizeDraft, scrubSpotlight, spotlightIssues, assembleContent, generateSpotlight, buildDraftPrompt,
  stripUnsupportedSpeed, buildFactCheckPrompt,
} from "../api/_lib/spotlight.js";
import { renderSpotlight, fillTemplate, priceLine, linkServicesToSpotlights } from "../api/_lib/spotlight-render.js";
import { renderBlocks } from "../api/_lib/company-page.js";

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (err) {
    console.error(`  FAIL - ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

const intake = {
  service_name: "Snow Removal",
  one_liner: "Driveway and walkway plowing and shoveling for homes in Agawam and West Springfield, all winter.",
  outcome: "A clear driveway and walkway after every storm of 2 inches or more.",
  buyers: "Homeowners, especially older residents and families with two working parents",
  trigger: "The first big storm, or their old plow guy stops answering",
  old_way: "Shovel it themselves or wait on a neighbor with a snowblower",
  cost_of_old_way: "An hour or more of shoveling per storm, late to work, risk of a fall on the steps",
  steps: "Call or send the form\nWe walk the property and give a per-storm price\nYou're on the route for the season\nWe clear after every 2-inch storm",
  turnaround: "Cleared within 6 hours of the snow stopping",
  deliverables: "Driveway plowed\nWalkway and front steps shoveled\nSeason-long spot on the route",
  objections: [{ q: "Do you do walkways and steps?", a: "Yes, both are included." }],
  pricing_mode: "request a quote",
  cta_type: "request a quote",
  cta_label: "Get on the plow list",
  do_not_say: "guaranteed, 24/7",
};
const profile = {
  business_id: "b1", username: "conways-landscaping", business_name: "Conway's Landscaping",
  primary_category: "landscaping", city: "Agawam", state: "MA", service_area: ["Agawam", "West Springfield"],
  phone: "(413)-896-5392", email: "owner@example.com",
};

console.log("gapCheck");
await test("complete intake is ready", () => {
  const g = gapCheck(intake);
  assert.equal(g.ready, true);
  assert.deepEqual(g.missing, []);
});
await test("missing answers are listed by field", () => {
  const g = gapCheck({ ...intake, outcome: "", steps: "Just one step", objections: [] });
  assert.equal(g.ready, false);
  assert.deepEqual(g.missing.map(m => m.field).sort(), ["objections", "outcome", "steps"]);
});
await test("vague answers get a follow-up question", () => {
  const g = gapCheck({ ...intake, turnaround: "Fast" });
  assert.equal(g.ready, true);
  assert.match(g.followUps[0].question, /how fast/i);
});

console.log("slugs, prompt, pricing");
await test("service slug", () => {
  assert.equal(slugifyService("Snow Removal & Salting"), "snow-removal-and-salting");
});
await test("prompt tags every survey answer and bans the owner's words", () => {
  const p = buildDraftPrompt(intake, profile);
  assert.match(p, /\[q1\] Service: Snow Removal/);
  assert.match(p, /\[q24\] Never say: guaranteed, 24\/7/);
});
await test("price line follows the pricing mode", () => {
  assert.equal(priceLine({ mode: "request a quote", price: "$45" }), "");
  assert.equal(priceLine({ mode: "starting price", price: "$45" }), "Starting at $45");
});

const aiDraft = {
  brief: { buyer: "Homeowners [q4]", promise: "Clear driveway after every 2-inch storm [q3]" },
  headline_options: [
    { angle: "outcome", headline: "Snow Removal in Agawam — Cleared Within 6 Hours", subhead: "Driveway and walkway cleared after every storm of 2 inches or more." },
    { angle: "pain", headline: "Done Shoveling? Get on Our Plow List", subhead: "No more hour-long shoveling before work." },
    { angle: "speed", headline: "Reliable 24/7 Snow Plowing", subhead: "Guaranteed fastest in town." },
  ],
  blocks: {
    cta_label: "Get on the plow list",
    who: { intro: "For homeowners in Agawam and West Springfield.", buyers: [{ title: "Older homeowners", situation: "Shoveling isn't safe anymore." }] },
    problem: { heading: "Shoveling costs more than an hour", body: "Every storm means an hour or more on the driveway, a late start at work and a real risk of a fall on icy steps." },
    steps: [{ title: "Call or send the form", detail: "Tell us your address." }, { title: "Get a per-storm price", detail: "We walk the property first." }],
    deliverables: { items: ["Driveway plowed", "Walkway and steps shoveled"], turnaround: "Within 6 hours of the snow stopping" },
    proof: { story: "", credentials: [] },
    faqs: [{ q: "Do you do walkways and steps?", a: "Yes, both are included." }, { q: "Are you 24/7?", a: "Yes, 24/7 guaranteed." }],
    specs: [],
    cta: { heading: "Get on the plow list", body: "Spots on the route are limited each season." },
  },
};

console.log("normalize + scrub");
await test("owner-banned and filler wording is removed", () => {
  const d = scrubSpotlight(normalizeDraft(aiDraft, intake), intake);
  assert.equal(d.headline_options.length, 2, "the '24/7 … guaranteed' headline is dropped");
  assert.equal(d.blocks.faqs.length, 1, "the 24/7 FAQ is dropped");
  assert.deepEqual(spotlightIssues(d, intake), []);
});
await test("assemble picks headline 0 and builds SEO", () => {
  const c = assembleContent(normalizeDraft(aiDraft, intake), intake, profile, 0);
  assert.equal(c.hero.headline, aiDraft.headline_options[0].headline);
  assert.equal(c.seo.title, "Snow Removal in Agawam, MA | Conway's Landscaping");
  assert.equal(c.chosen_headline, 0);
});

console.log("generateSpotlight (mocked OpenAI)");
await test("runs draft then fact check, keeps the checked copy and the removed list", async () => {
  const calls = [];
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body.messages[1].content.slice(0, 40));
    const reply = calls.length === 1
      ? aiDraft
      : { headline_options: aiDraft.headline_options.slice(0, 2), blocks: { ...aiDraft.blocks, cta: { heading: "Get on the plow list", body: "Call or send the form." } }, removed: ["'Spots on the route are limited' — not in the survey"] };
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(reply) } }] }) };
  };
  const out = await generateSpotlight(intake, profile, { fetchImpl });
  assert.equal(calls.length, 2);
  assert.match(calls[1], /fact checker/);
  assert.equal(out.content.cta.body, "Call or send the form.");
  assert.deepEqual(out.removed, ["'Spots on the route are limited' — not in the survey"]);
  assert.deepEqual(out.issues, []);
});

console.log("unsupported speed claims");
const noTimeIntake = { ...intake, turnaround: "After each storm; timing is set with you when you sign up", outcome: "A cleared driveway after a storm." };
const conwayDraft = normalizeDraft({
  headline_options: [
    { angle: "outcome", headline: "Snow Removal in Agawam", subhead: "Driveway and walkway cleared after a storm." },
    { angle: "speed", headline: "Quick Snow Removal", subhead: "Have your driveway cleared promptly after a storm." },
  ],
  blocks: { ...aiDraft.blocks, cta: { heading: "Book now", body: "We clear it fast. Call or send the form." } },
}, noTimeIntake);
await test("speed promises are removed when the survey gives no time", () => {
  const { draft, notes } = stripUnsupportedSpeed(conwayDraft, noTimeIntake);
  assert.deepEqual(draft.headline_options.map(h => h.headline), ["Snow Removal in Agawam"]);
  assert.equal(draft.blocks.cta.body, "Call or send the form.");
  assert.equal(notes.length, 2);
});
await test("speed claims stay when the survey states a time", () => {
  const { draft, notes } = stripUnsupportedSpeed(conwayDraft, { ...noTimeIntake, turnaround: "Within 6 hours of the snow stopping" });
  assert.equal(draft.headline_options.length, 2);
  assert.deepEqual(notes, []);
});
await test("prompts keep company facts and require the service name in headlines", () => {
  assert.match(buildFactCheckPrompt(intake, profile, conwayDraft), /business name, town, areas served, owner name\) are supported/);
  assert.match(buildDraftPrompt(intake, profile), /Every headline names the service/);
});

console.log("render");
await test("renders every block, escapes text, hides empty blocks, noindexes drafts", () => {
  const content = assembleContent(scrubSpotlight(normalizeDraft(aiDraft, intake), intake), intake, profile, 0);
  content.who.intro = 'Homes <script>alert(1)</script> {{TITLE}}';
  const map = renderSpotlight({ service_slug: "snow-removal", status: "draft", content, intake, removed_claims: [] }, profile, { baseUrl: "https://enoma.io", brandStyle: "", heroPhoto: null });
  const html = fillTemplate(fs.readFileSync(new URL("../public/spotlight.html", import.meta.url), "utf8"), map);
  assert.ok(!/\{\{[A-Z_]+\}\}/.test(html.replace("{{TITLE}}", "")), "no unfilled placeholders");
  assert.ok(html.includes("Homes &lt;script&gt;"), "user text escaped");
  assert.ok(html.includes("{{TITLE}}"), "text that looks like a placeholder is left alone");
  assert.match(html, /<meta name="robots" content="noindex,nofollow"/);
  assert.match(html, /<section class="sp-section hidden">/, "empty proof block is hidden");
  assert.match(html, /"@type":"FAQPage"/);
  assert.match(html, /Snow Removal request/);
});
await test("published page is indexable", () => {
  const content = assembleContent(normalizeDraft(aiDraft, intake), intake, profile, 0);
  const map = renderSpotlight({ service_slug: "snow-removal", status: "published", content, intake }, profile, { baseUrl: "https://enoma.io" });
  assert.equal(map["{{ROBOTS}}"], "index,follow");
  assert.equal(map["{{CANONICAL}}"], "https://enoma.io/conways-landscaping/snow-removal");
});

console.log("company page service links");
await test("service cards link to matching published spotlights", () => {
  const services = [{ service_name: "Mowing" }, { service_name: "Snow Removal", service_description: "Driveways." }];
  const { services: out, unmatched } = linkServicesToSpotlights(services,
    [{ service_slug: "snow-removal-and-salting", service_name: "Snow Removal & Salting" }, { service_slug: "gutter-cleaning", service_name: "Gutter Cleaning" }],
    "conways-landscaping");
  assert.equal(out[0].spotlight_url, undefined);
  assert.equal(out[1].spotlight_url, "/conways-landscaping/snow-removal-and-salting");
  assert.deepEqual(unmatched.map(u => u.service_slug), ["gutter-cleaning"]);
});
await test("a service with a published spotlight gets a \"More about\" link on its card", () => {
  const html = renderBlocks({ username: "conways-landscaping", services: [{ service_name: "Mowing" }, { service_name: "Snow Removal" }] },
    { slug: "conways-landscaping", spotlights: [{ service_slug: "snow-removal", service_name: "Snow Removal" }] })["{{BLOCK_SERVICES}}"];
  assert.match(html, /<article class="service-card service-card--primary" id="service-mowing">\s*<a class="service-card__link" href="#quote\?service=mowing" data-service-quote="mowing">\s*<h3>Mowing/);
  assert.match(html, /<a class="service-more" href="\/conways-landscaping\/snow-removal" data-spotlight-link="snow-removal">More about Snow Removal →<\/a>/);
  assert.equal((html.match(/class="service-more"/g) || []).length, 1, "only the service with a spotlight");
});

await test("company page blocks are absent server-side when empty", () => {
  const empty = renderBlocks({ about: "", services: [], why_choose_us: "", testimonials: [] });
  for (const k of ["{{BLOCK_SERVICES}}", "{{BLOCK_REVIEWS}}", "{{BLOCK_ABOUT}}", "{{BLOCK_OWNER}}", "{{BLOCK_TRUST}}"]) assert.equal(empty[k], "", k);
  const full = renderBlocks({ about: "A.\n\nB.", services: [{ service_name: "Mowing" }], services_intro: "Intro", why_choose_us: "Owner-operated", testimonials: [{ quote: "Great" }] });
  assert.match(full["{{BLOCK_ABOUT}}"], /id="about-body"/);
  assert.match(full["{{BLOCK_ABOUT}}"], /id="whySection"/);
  assert.match(full["{{BLOCK_SERVICES}}"], /id="services-intro"/);
  assert.equal((full["{{BLOCK_REVIEWS}}"].match(/class="review-card"/g) || []).length, 1);
});
await test("profile.html no longer redraws server-rendered sections", () => {
  // The page's behaviour script lives in public/scripts/profile.js.
  const html = fs.readFileSync(new URL("../public/profile.html", import.meta.url), "utf8")
    + fs.readFileSync(new URL("../public/scripts/profile.js", import.meta.url), "utf8");
  for (const id of ["services-grid", "about-lead", "townList", "why"]) {
    assert.ok(!new RegExp(`getEl\\('${id}'\\)[^\\n]*\\.innerHTML\\s*=|getEl\\('${id}'\\)`).test(html), `script still touches #${id}`);
  }
  assert.ok(!/faqList\.innerHTML\s*=/.test(html), "script still redraws FAQs");
});

console.log(`\n${passed} passed`);
