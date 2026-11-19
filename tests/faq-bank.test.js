// Run with: node tests/faq-bank.test.js (also wired into `npm test`)
// Common questions for v3 pages (api/_lib/faq-bank.js): fact questions only
// with the fact, trade questions picked by service, "we" voice, no claims.
import assert from "node:assert/strict";
import { TRADE_FAQS, tradeFaqs, factFaqs, usableAiFaq, buildFaqs } from "../api/_lib/faq-bank.js";

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { console.error(`  FAIL - ${name}`); console.error(err); process.exitCode = 1; }
}

await test("every persona has questions, all answered, none about this business's prices or guarantees", () => {
  for (const p of ["plumbing", "hvac", "electrical", "landscaping", "snow", "painting", "cleaning", "contractor"]) {
    assert.ok(TRADE_FAQS[p].length >= 2, p);
    for (const x of TRADE_FAQS[p]) {
      assert.ok(x.q.endsWith("?") && x.a.length > 30, x.q);
      assert.doesNotMatch(`${x.q} ${x.a}`, /\$\d|guarantee|warranty|licensed and insured|years of experience|24\/7|same[- ]day/i, x.q);
      assert.doesNotMatch(x.q, /\b(they|their)\b/i, x.q);
    }
  }
});

await test("trade questions: matched to the services first, then general ones", () => {
  const qs = tradeFaqs("plumbing", "Hot water tank failures | Drain clogs").map(x => x.q);
  assert.equal(qs[0], "How do I know if my water heater needs replacing?");
  assert.equal(qs[1], "Should I use a chemical drain cleaner on a clog?");
  assert.ok(!qs.includes("Why does my toilet keep running?"), "unrelated service question left out");
  assert.ok(qs.includes("What should I do in a plumbing emergency?"), "general question fills");
  assert.deepEqual(tradeFaqs("default", "anything"), []);
  assert.equal(tradeFaqs("contractor", "Asphalt paving")[0].q, "How long should I wait to drive on a new asphalt driveway?");
});

await test("fact questions only appear with the fact", () => {
  assert.deepEqual(Object.keys(factFaqs({})), ["estimate"]);
  const f = factFaqs({ phone: "(508) 555-1212", towns: { home: "Attleboro", confirmed: ["Attleboro", "Seekonk", "Norton"] }, hours: { text: "Mon–Fri 7am–5pm" }, offers_free_estimates: true, offers_emergency: true, license: { state: "MA", number: "#12345" }, is_insured: true });
  assert.equal(f.towns.a, "We're based in Attleboro and work in Seekonk and Norton. Not sure we cover your town? Text us at (508) 555-1212 and we'll let you know.");
  assert.equal(f.estimate.q, "Are estimates free?");
  assert.equal(f.license.q, "Are you licensed and insured?");
  assert.match(f.license.a, /MA license number is #12345, and we're insured/);
  assert.match(f.emergency.a, /\(508\) 555-1212/);
  assert.match(f.hours.a, /^Mon–Fri 7am–5pm\./);
  const plain = factFaqs({ phone: "1", offers_free_estimates: false, offers_emergency: false, towns: { home: "Ewing", confirmed: ["Ewing"] } });
  assert.equal(plain.estimate.q, "How do I get an estimate?");
  assert.doesNotMatch(plain.estimate.a, /free/i);
  assert.equal(plain.emergency, undefined);
  assert.equal(plain.towns.a, "We're based in Ewing. Not sure we cover your town? Text us at 1 and we'll let you know.", "no invented towns");
});

await test("AI questions: only in the business's own voice, and not ones the facts cover", () => {
  assert.equal(usableAiFaq({ q: "How quickly can they respond to plumbing issues?", a: "Fast." }), false);
  assert.equal(usableAiFaq({ q: "How soon can you come out?", a: "Call us." }), true);
  const out = buildFaqs({ persona: "plumbing", serviceText: "Drain clogs", facts: { phone: "1", towns: { home: "X", confirmed: ["X"] } },
    aiFaqs: [{ q: "What areas do they serve?", a: "x" }, { q: "What are your hours?", a: "y" }, { q: "How soon can you come out?", a: "Call us." }] });
  const qs = out.map(x => x.q);
  assert.equal(qs[0], "Should I use a chemical drain cleaner on a clog?");
  assert.ok(qs.includes("How soon can you come out?"));
  assert.ok(!qs.includes("What are your hours?") && !qs.includes("What areas do they serve?"));
  assert.ok(out.length <= 6);
  assert.equal(new Set(qs).size, qs.length, "no duplicates");
});

console.log(`\n${passed} passed`);
