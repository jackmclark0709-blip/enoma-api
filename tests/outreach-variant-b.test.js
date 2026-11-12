// Run with: node tests/outreach-variant-b.test.js (also wired into `npm test`)
// Copy guards for cold-email variant B (api/_lib/outreach-variant-b.js).

import assert from "node:assert/strict";
import {
  variantForProspect, variantBEnabled, proofLineFromEnv, pickSubject, allSubjectOptions, nameForms,
  openingLine, buildOutreachIntroB, buildOutreachEmailB, buildFollowUpEmailB, buildSecondFollowUpEmailB,
  pickFirstEmail, bodyWordCount, SUBJECT_MAX, BANNED_SUBJECT_RE, PRICE_LINE
} from "../api/_lib/outreach-variant-b.js";
import { buildOutreachIntro } from "../api/_lib/outreach-email.js";

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

const MSG = "3f2b8c1e-9d4a-4b6e-8f1a-2c3d4e5f6a7b";
const UNSUB = "https://enoma.io/api/ga-metrics?action=unsubscribe&email=a%40b.com&token=t";
const ADDR = "Enoma, 183 Fairway Dr, Attleboro, MA 02703";
const PAGE = `https://enoma.io/api/ga-metrics?action=go&m=${MSG}&to=page`;
// Operating Doc rule #5 (same pattern as tests/public-copy.test.js).
const CUSTOMER_NAMES = /conway/i;

const uuid = (i) => `${String(i).padStart(8, "0")}-0000-4000-8000-${String(i).padStart(12, "0")}`;
const PROSPECTS = [
  { id: uuid(1), business_name: "Arno Plumbing & Heating LLC", trade: "plumber", city: "Plano", state: "TX" },
  { id: uuid(2), business_name: "Tavares Landscaping", trade: "landscaping", city: "Boise", state: "ID" },
  { id: uuid(3), business_name: "Comfort Aire Heating & Cooling Inc.", trade: "hvac contractor", city: "Knoxville", state: "TN" },
  { id: uuid(4), business_name: "Maynard Roofing /40 yrs Family Business", trade: "roofing contractor", city: "Reno", state: "Nevada" },
  { id: uuid(5), business_name: "Free State Plumbing", trade: "plumber", city: "Lawrence", state: "KS" },
  { id: uuid(6), business_name: "Bright Spark", trade: "electrician", city: null, state: null },
  { id: uuid(7), business_name: "Supercalifragilisticexpialidocious Window Washing", trade: "window washing", city: "Tulsa", state: "OK" },
  { id: uuid(8), business_name: "J & R", trade: "painting contractor", city: "Akron", state: "OH" },
];

function allEmailsFor(p, { proofLine = "" } = {}) {
  const intro = buildOutreachIntroB(p);
  const first = buildOutreachEmailB({ intro: intro.body, businessName: p.business_name, messageId: MSG, slug: "x", unsubscribeUrl: UNSUB, mailingAddress: ADDR, proofLine });
  const f1 = buildFollowUpEmailB({ businessName: p.business_name, prospectId: p.id, messageId: MSG, slug: "x", unsubscribeUrl: UNSUB, mailingAddress: ADDR });
  const f2 = buildSecondFollowUpEmailB({ businessName: p.business_name, prospectId: p.id, messageId: MSG, slug: "x", unsubscribeUrl: UNSUB, mailingAddress: ADDR });
  return [
    { kind: "first", subject: intro.subject, ...first, maxWords: 110 },
    { kind: "followup1", ...f1, maxWords: 70 },
    { kind: "followup2", ...f2, maxWords: 70 },
  ];
}
const ALL = PROSPECTS.flatMap(p => allEmailsFor(p).map(e => ({ ...e, p })));

console.log("copy guards (every email, every sample prospect)");
await test("never says 'Google listing'", () => {
  for (const e of ALL) assert.ok(!/google listing/i.test(e.subject + e.text + e.html), `${e.kind} for ${e.p.business_name}`);
});
await test("never names a customer", () => {
  for (const e of ALL) assert.ok(!CUSTOMER_NAMES.test(e.subject + e.text + e.html), `${e.kind} for ${e.p.business_name}`);
});
await test("wherever 'free' appears, the full price line is there too", () => {
  for (const e of ALL) {
    for (const part of [e.text, e.html]) {
      // The business name can contain "Free"; only our own words count.
      const own = part.split(e.p.business_name.replace(/\s+(LLC|Inc\.)$/, "")).join("");
      if (/\bfree\b/i.test(own)) assert.ok(part.includes(PRICE_LINE), `${e.kind} for ${e.p.business_name}`);
    }
    assert.ok(e.text.includes(PRICE_LINE), `${e.kind} has the price line`);
  }
});
await test("one link only: the tracked preview landing link (m token) plus the unsubscribe footer", () => {
  for (const e of ALL) {
    const hrefs = [...e.html.matchAll(/href="([^"]+)"/g)].map(m => m[1].replace(/&amp;/g, "&"));
    assert.equal(hrefs.length, 2, `${e.kind}: ${hrefs}`);
    assert.ok(hrefs[0].startsWith(PAGE), `${e.kind} links the preview landing with m=`);
    assert.ok(hrefs[1].startsWith(UNSUB), `${e.kind} footer is unsubscribe`);
    const textUrls = e.text.match(/https?:\/\/\S+/g);
    assert.equal(textUrls.length, 2, `${e.kind} text: ${textUrls}`);
    assert.ok(textUrls[0].startsWith(PAGE));
    assert.ok(!/to=claim/.test(e.text + e.html), "no claim link");
  }
});
await test("no images", () => {
  for (const e of ALL) assert.ok(!/<img/i.test(e.html));
});
await test("one ask: reply yes", () => {
  for (const e of ALL) assert.equal((e.text.match(/reply "yes"|Reply "yes"/g) || []).length, 1, e.kind);
});
await test("signed by Jack, a real person who keeps the page updated", () => {
  for (const e of ALL) {
    assert.match(e.text, /\n\nJack\nI'm a real person, and I keep your page updated for you\./);
    assert.match(e.html, /Jack<br>I&#039;m a real person, and I keep your page updated for you\./);
  }
});
await test("word limits: first email under 110, follow-ups under 70 (footer excluded)", () => {
  for (const e of ALL) assert.ok(bodyWordCount(e.text) < e.maxWords, `${e.kind} for ${e.p.business_name}: ${bodyWordCount(e.text)} words`);
});
await test("never a web-design pitch in the body", () => {
  for (const e of ALL) assert.ok(!/\b(redesign\w*|new website|built you)\b/i.test(e.text), e.kind);
});

console.log("subjects");
await test(`every subject sent is at most ${SUBJECT_MAX} characters`, () => {
  for (const e of ALL) assert.ok(e.subject.length <= SUBJECT_MAX, `${e.subject} (${e.subject.length})`);
  // Also across many ids, so every option and fallback path gets exercised.
  for (let i = 0; i < 300; i++) {
    for (const kind of ["first", "followup1", "followup2"]) {
      for (const p of PROSPECTS) {
        const s = pickSubject(kind, p.business_name, uuid(1000 + i));
        assert.ok(s.length <= SUBJECT_MAX, `${s} (${s.length})`);
      }
    }
  }
});
await test("banned words never appear in a subject: website, redesign, built you, free", () => {
  for (const e of ALL) assert.ok(!BANNED_SUBJECT_RE.test(e.subject), e.subject);
  for (const kind of ["first", "followup1", "followup2"]) {
    for (const s of allSubjectOptions(kind, "Bob's Plumbing")) assert.ok(!BANNED_SUBJECT_RE.test(s), s);
    // A business name with a banned word drops to the no-name subject.
    const s = pickSubject(kind, "Free State Plumbing", uuid(5));
    assert.ok(!BANNED_SUBJECT_RE.test(s), s);
    const w = pickSubject(kind, "Website Pros Electric", uuid(5));
    assert.ok(!BANNED_SUBJECT_RE.test(w), w);
  }
  assert.ok(BANNED_SUBJECT_RE.test("I built you a page") && BANNED_SUBJECT_RE.test("Your new website") && BANNED_SUBJECT_RE.test("Free page") && BANNED_SUBJECT_RE.test("A redesign"));
});
await test("three options per email, each with the business name, all under the limit for a short name", () => {
  for (const kind of ["first", "followup1", "followup2"]) {
    const opts = allSubjectOptions(kind, "Ace Co");
    assert.equal(opts.length, 3);
    assert.equal(new Set(opts).size, 3);
    for (const s of opts) { assert.ok(s.includes("Ace Co")); assert.ok(s.length <= SUBJECT_MAX, s); }
  }
});
await test("an option too long for the name is skipped for one that fits, name intact", () => {
  for (let i = 0; i < 30; i++) {
    const s = pickSubject("first", "Ace Plumbing", uuid(i));
    assert.ok(s.includes("Ace Plumbing") && s.length <= SUBJECT_MAX, s);
  }
});
await test("long names shorten at a word boundary, never mid-word or on a dangling '&'", () => {
  assert.deepEqual(nameForms("Comfort Aire Heating & Cooling"), ["Comfort Aire Heating & Cooling", "Comfort Aire Heating", "Comfort Aire", "Comfort"]);
  const s = pickSubject("first", "Comfort Aire Heating & Cooling Inc.", uuid(3));
  assert.ok(s.length <= SUBJECT_MAX);
  assert.ok(!/&\s*[:,']|&$/.test(s), s);
});
await test("the subject is stable for a prospect", () => {
  assert.equal(pickSubject("first", "Ace Plumbing", uuid(9)), pickSubject("first", "Ace Plumbing", uuid(9)));
});

console.log("opening line: only what the prospect row says");
await test("trade + town when we have both", () => {
  assert.equal(openingLine(PROSPECTS[0]), "I was looking at plumbers around Plano, TX and came across Arno Plumbing & Heating.");
  assert.equal(openingLine(PROSPECTS[1]), "I was looking at landscapers around Boise, ID and came across Tavares Landscaping.");
});
await test("full state names are left out rather than guessed", () => {
  assert.equal(openingLine(PROSPECTS[3]), "I was looking at roofers around Reno and came across Maynard Roofing.");
});
await test("an unknown trade isn't named", () => {
  assert.equal(openingLine(PROSPECTS[6]), "I came across Supercalifragilisticexpialidocious Window Washing while looking at local businesses around Tulsa, OK.");
});
await test("no town: no place claimed", () => {
  assert.equal(openingLine(PROSPECTS[5]), "I came across Bright Spark on Google.");
});
await test("the second line is the plain what-it-is line", () => {
  const { body } = buildOutreachIntroB(PROSPECTS[0]);
  assert.ok(body.endsWith("I put together a page for Arno Plumbing & Heating that's built to get you found on Google and turn visitors into calls. The leads go straight to you: no shared leads, no per-lead fees."));
  assert.ok(body.startsWith("Hi there,\n\nI was looking at plumbers"));
});

console.log("proof line (ENOMA_PROOF_LINE)");
await test("off by default: unset or blank env means no proof line", () => {
  assert.equal(proofLineFromEnv({}), "");
  assert.equal(proofLineFromEnv({ ENOMA_PROOF_LINE: "   " }), "");
  const [first] = allEmailsFor(PROSPECTS[0]);
  const paras = first.text.split("\n\n");
  assert.ok(paras[2].startsWith("I put together a page"));
  assert.ok(paras[3].startsWith("Take a look: "), "link follows the second line directly");
});
await test("when set, its exact text goes right after the second line, in text and HTML", () => {
  const proof = "PLACEHOLDER proof text <exactly as Jack writes it> & nothing else.";
  assert.equal(proofLineFromEnv({ ENOMA_PROOF_LINE: `  ${proof}  ` }), proof);
  const [first] = allEmailsFor(PROSPECTS[0], { proofLine: proofLineFromEnv({ ENOMA_PROOF_LINE: proof }) });
  const paras = first.text.split("\n\n");
  assert.ok(paras[2].startsWith("I put together a page"));
  assert.equal(paras[3], proof);
  assert.ok(paras[4].startsWith("Take a look: "));
  assert.ok(first.html.includes("PLACEHOLDER proof text &lt;exactly as Jack writes it&gt; &amp; nothing else."));
});
await test("follow-ups never carry the proof line", () => {
  const [, f1, f2] = allEmailsFor(PROSPECTS[0], { proofLine: "PROOF" });
  assert.ok(!f1.text.includes("PROOF") && !f2.text.includes("PROOF"));
});

console.log("the split");
await test("deterministic by prospect id, close to 50/50", () => {
  assert.equal(variantForProspect(uuid(42)), variantForProspect(uuid(42)));
  let b = 0;
  const n = 2000;
  for (let i = 0; i < n; i++) if (variantForProspect(uuid(i)) === "b") b++;
  assert.ok(b > n * 0.45 && b < n * 0.55, `${b}/${n} in b`);
});
await test("OUTREACH_VARIANT_B=off is the kill switch; on by default", () => {
  assert.equal(variantBEnabled({}), true);
  assert.equal(variantBEnabled({ OUTREACH_VARIANT_B: "on" }), true);
  for (const v of ["off", "0", "false", "OFF"]) assert.equal(variantBEnabled({ OUTREACH_VARIANT_B: v }), false);
});

console.log("pickFirstEmail");
const idA = [...Array(50).keys()].map(uuid).find(id => variantForProspect(id) === "a");
const idB = [...Array(50).keys()].map(uuid).find(id => variantForProspect(id) === "b");
const base = { business_name: "Ace Plumbing", trade: "plumber", city: "Plano", state: "TX", website: "https://ace.example", site_gaps: ["Phone number isn't tap-to-call"], raw: {} };
await test("a template A draft on a B prospect goes out as B (queued before the test)", () => {
  const p = { ...base, id: idB };
  const a = buildOutreachIntro(p);
  const pick = pickFirstEmail({ ...p, draft_subject: a.subject, draft_body: a.body });
  assert.equal(pick.variant, "b");
  assert.equal(pick.intro, buildOutreachIntroB(p).body);
  assert.equal(pick.subject, buildOutreachIntroB(p).subject);
});
await test("an A prospect keeps the existing copy exactly", () => {
  const p = { ...base, id: idA };
  const a = buildOutreachIntro(p);
  const pick = pickFirstEmail({ ...p, draft_subject: a.subject, draft_body: a.body });
  assert.deepEqual(pick, { variant: "a", subject: a.subject, intro: a.body });
});
await test("a hand-edited draft is sent as written and kept out of the test (variant null)", () => {
  const p = { ...base, id: idB, draft_subject: "Custom subject", draft_body: "Hi there,\n\nJack's own words." };
  assert.deepEqual(pickFirstEmail(p), { variant: null, subject: "Custom subject", intro: "Hi there,\n\nJack's own words." });
});
await test("with the kill switch, B drafts go out as A", () => {
  const p = { ...base, id: idB };
  const b = buildOutreachIntroB(p);
  const pick = pickFirstEmail({ ...p, draft_subject: b.subject, draft_body: b.body }, { enabled: false });
  assert.equal(pick.variant, "a");
  assert.equal(pick.intro, buildOutreachIntro(p).body);
});

console.log(`\n${passed} passed`);
