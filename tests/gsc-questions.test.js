// Run with: node tests/gsc-questions.test.js (also wired into `npm test`)
// Covers scripts/gsc-questions.mjs (question filter, brand filter, CSV input,
// ranking) and optional FAQs in scripts/build-guides.mjs (visible FAQ section +
// valid FAQPage JSON-LD only when a guide has FAQs).
import assert from "node:assert/strict";
import { GUIDES } from "../data/guides.mjs";
import { renderGuide } from "../scripts/build-guides.mjs";
import {
  isQuestion, isBrand, rowsFromCsv, parseCsv, findOpportunities, suggestAction, median, renderReport,
} from "../scripts/gsc-questions.mjs";

// ---- Question / brand filter ------------------------------------------------
for (const q of [
  "why is my business not showing up on google",
  "How to get snow customers fast",
  "what is a google business profile",
  "is thumbtack or angi better",
  "are yelp ads worth it",
  "does yelp advertising work",
  "do i need a website",
  "can you recommend a painter in attleboro, ma?",
  "which is better angi or thumbtack",
  "should i pay for leads",
  "will google show my business",
  "who builds contractor websites",
  "when to start marketing snow removal",
  "where do plumbers get leads",
  "thumbtack vs angi: which is more user-friendly for homeowners?", // contains "?"
]) assert.ok(isQuestion(q), `should keep question: ${q}`);

for (const q of [
  "plumber franklin ma",
  "angi alternatives",
  "showing up on google",   // "how" mid-word is not a question word
  "issues with google maps", // "is" must be a whole word
  "doing seo for contractors",
  "website for home service business",
]) assert.ok(!isQuestion(q), `should drop non-question: ${q}`);

assert.ok(isBrand("what is enoma"));
assert.ok(isBrand("Enoma pricing?"));
assert.ok(!isBrand("why is my business not showing up on google"));

// ---- CSV parsing ------------------------------------------------------------
assert.deepEqual(parseCsv('a,b\n"x, y","say ""hi"""\r\n'), [["a", "b"], ["x, y", 'say "hi"']]);
const csvRows = rowsFromCsv("﻿Top queries,Landing page,Clicks,Impressions,CTR,Average position\nhow do i get reviews?,https://enoma.io/for/x,1,\"1,200\",0.08%,12.5\n");
assert.deepEqual(csvRows, [{ query: "how do i get reviews?", page: "https://enoma.io/for/x", impressions: 1200, clicks: 1, position: 12.5 }]);
assert.throws(() => rowsFromCsv("page,clicks\nx,1\n"), /missing a "query" column/);

// ---- Actions and ranking ----------------------------------------------------
const guide = GUIDES[0].slug;
assert.equal(suggestAction(`https://enoma.io/for/${guide}`), "retitle");
assert.equal(suggestAction("https://enoma.io/for/website-for-plumbing-business"), "add FAQ");
assert.equal(suggestAction("https://enoma.io/pricing"), "review");
assert.equal(median([3, 1, 2]), 2);
assert.equal(median([1, 2, 3, 4]), 2.5);
assert.equal(median([]), 0);

const page = `https://enoma.io/for/${guide}`;
const rows = [
  { query: "enoma", page: "https://enoma.io/", impressions: 5000, clicks: 0, position: 3 },          // brand: dropped
  { query: "what is enoma", page: "https://enoma.io/", impressions: 500, clicks: 0, position: 3 },  // brand question: dropped
  { query: "(unknown)", page: "(unknown)", impressions: 900, clicks: 9, position: 11 },
  { query: "plumber franklin ma", page, impressions: 100, clicks: 10, position: 5 },               // 10% (not a question)
  { query: "landscaper agawam", page, impressions: 100, clicks: 2, position: 5 },                  // 2%
  { query: "why is my business not on google", page, impressions: 200, clicks: 0, position: 8 },   // 0%  -> opportunity
  { query: "how to get snow customers", page, impressions: 50, clicks: 1, position: 6 },           // 2%  -> opportunity
  { query: "is yelp worth it", page, impressions: 100, clicks: 20, position: 2 },                  // 20% -> above median
  { query: "does thumbtack check insurance?", page, impressions: 19, clicks: 0, position: 9 },     // under 20 impressions
];
const { opportunities, siteMedianCtr } = findOpportunities(rows);
// Median over non-brand rows with 20+ impressions: 0, 0.02, 0.02, 0.1, 0.2 -> 0.02
assert.equal(siteMedianCtr, 0.02);
assert.deepEqual(opportunities.map(r => r.query), ["why is my business not on google"],
  "2% isn't below a 2% median; brand, non-question, low-impression and high-CTR rows are dropped");
assert.equal(opportunities[0].action, "retitle");

const lower = findOpportunities(rows, { minImpressions: 1 });
assert.ok(lower.opportunities.some(r => r.query === "does thumbtack check insurance?"), "--min-impressions lowers the floor");
assert.ok(!lower.opportunities.some(r => isBrand(r.query)));

// Zero median (young site, almost no clicks): zero-click questions still qualify.
const zero = findOpportunities([
  { query: "why is my business not on google", page, impressions: 30, clicks: 0, position: 57 },
  { query: "plumber franklin ma", page, impressions: 90, clicks: 0, position: 11 },
  { query: "how do i get reviews", page, impressions: 25, clicks: 1, position: 4 },
]);
assert.equal(zero.siteMedianCtr, 0);
assert.deepEqual(zero.opportunities.map(r => r.query), ["why is my business not on google"]);

// Top N cap.
const many = Array.from({ length: 30 }, (_, i) => ({ query: `how to fix thing ${i}`, page, impressions: 20 + i, clicks: 0, position: 10 }));
assert.equal(findOpportunities(many).opportunities.length, 15);
assert.equal(findOpportunities(many).opportunities[0].impressions, 49, "ranked by impressions when missed clicks tie");

const report = renderReport(findOpportunities(rows), { month: "2026-11", source: "test", minImpressions: 20 });
assert.match(report, /\| 1 \| why is my business not on google \| \/for\/[a-z0-9-]+ \| 200 \| 0 \| 0\.0% \| 8\.0 \| retitle \|/);

// ---- Optional FAQs in guides --------------------------------------------------
const ldBlocks = html => [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map(m => JSON.parse(m[1]));
const base = GUIDES[0];

const withFaqs = renderGuide({ ...base, faqs: [
  { q: "Does Thumbtack check if contractors are \"insured\"?", a: "Ask for a certificate & keep it <handy>." },
  { q: "How do I advertise snow removal?", a: "Start with customers you already have." },
] });
const faq = ldBlocks(withFaqs).find(b => b["@type"] === "FAQPage");
assert.ok(faq, "FAQPage JSON-LD present when faqs exist");
assert.equal(faq["@context"], "https://schema.org");
assert.equal(faq.mainEntity.length, 2);
for (const e of faq.mainEntity) {
  assert.equal(e["@type"], "Question");
  assert.equal(e.acceptedAnswer["@type"], "Answer");
  assert.ok(e.name && e.acceptedAnswer.text);
}
assert.equal(faq.mainEntity[0].acceptedAnswer.text, "Ask for a certificate & keep it <handy>.", "JSON-LD round-trips special characters");
assert.ok(!/<handy>/.test(withFaqs.split("</head>")[0]), "no raw < inside JSON-LD");
// Every FAQ in the schema is visible on the page (escaped), and nothing extra.
const visibleQs = [...withFaqs.matchAll(/<h3 class="lp-faq__q">(.*?)<\/h3>/g)].map(m => m[1]);
assert.deepEqual(visibleQs, ["Does Thumbtack check if contractors are &quot;insured&quot;?", "How do I advertise snow removal?"]);
assert.ok(withFaqs.includes('<p class="lp-faq__a">Ask for a certificate &amp; keep it &lt;handy&gt;.</p>'));
assert.equal((withFaqs.match(/<section class="lp-faq">/g) || []).length, 1);
// FAQ section sits after the article and before the closing CTA.
assert.ok(withFaqs.indexOf("</article>") < withFaqs.indexOf('class="lp-faq"'));
assert.ok(withFaqs.indexOf('class="lp-faq"') < withFaqs.indexOf('class="lp-cta"'));

for (const faqs of [[], undefined, [{ q: "", a: "" }]]) {
  const html = renderGuide({ ...base, faqs });
  const blocks = ldBlocks(html);
  assert.ok(!blocks.some(b => b["@type"] === "FAQPage"), `no FAQPage JSON-LD when faqs is ${JSON.stringify(faqs)}`);
  assert.ok(!html.includes('class="lp-faq"'), "no empty FAQ section");
  assert.ok(blocks.some(b => b["@type"] === "Article"), "other schema still emitted");
}

console.log("gsc-questions: ok");
