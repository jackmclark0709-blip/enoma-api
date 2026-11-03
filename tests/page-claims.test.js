// Run with: node tests/page-claims.test.js (also wired into `npm test`)

import assert from "node:assert/strict";
import {
  parseAvailability, openSchedule, isOpenAt, faqDeniesEmergency, showEmergencyBadge, townsLine, ctaNote,
} from "../api/_lib/page-claims.js";

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (err) {
    console.error(`  FAIL - ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

const WEEKDAYS = [1, 2, 3, 4, 5];

console.log("parseAvailability");
test("Conway's format", () => {
  assert.deepEqual(parseAvailability("M-F. 8am-6pm."), { days: WEEKDAYS, open: 480, close: 1080 });
});
test("en dashes and a dot separator", () => {
  assert.deepEqual(parseAvailability("Mon–Sat · 7am–6pm"), { days: [1, 2, 3, 4, 5, 6], open: 420, close: 1080 });
});
test("long day names, minutes, spaced AM/PM", () => {
  assert.deepEqual(parseAvailability("Monday - Friday, 7:30 AM - 5 PM"), { days: WEEKDAYS, open: 450, close: 1020 });
});
test("shared am/pm suffix", () => {
  assert.deepEqual(parseAvailability("Mon-Fri 8-5pm"), { days: WEEKDAYS, open: 480, close: 1020 });
});
test("24/7 and daily", () => {
  assert.equal(parseAvailability("Available 24/7").days.length, 7);
  assert.deepEqual(parseAvailability("Daily 9am-5pm").days, [0, 1, 2, 3, 4, 5, 6]);
});
test("unparseable or missing days gives null (no badge)", () => {
  assert.equal(parseAvailability(""), null);
  assert.equal(parseAvailability("By appointment"), null);
  assert.equal(parseAvailability("8am-6pm"), null);
});

console.log("isOpenAt");
const conway = openSchedule({ state: "MA", hero_availability: "M-F. 8am-6pm." });
test("closed Monday 7:21pm Eastern (the bug Jack saw)", () => {
  assert.equal(isOpenAt(conway, new Date("2026-11-03T00:21:00Z")), false);
});
test("closed 3am", () => {
  assert.equal(isOpenAt(conway, new Date("2026-11-03T08:00:00Z")), false);
});
test("open Tuesday 10am Eastern", () => {
  assert.equal(isOpenAt(conway, new Date("2026-11-03T15:00:00Z")), true);
});
test("closed Saturday midday", () => {
  assert.equal(isOpenAt(conway, new Date("2026-11-07T16:00:00Z")), false);
});
test("no state or no hours means no schedule", () => {
  assert.equal(openSchedule({ hero_availability: "M-F 8am-6pm" }), null);
  assert.equal(openSchedule({ state: "MA" }), null);
  assert.equal(isOpenAt(null), false);
});

console.log("emergency badge");
const conwayFaqs = [{ question: "Do you offer emergency services?", answer: "At this time, we do not offer emergency or after-hours services." }];
test("FAQ denial hides the badge", () => {
  assert.equal(faqDeniesEmergency(conwayFaqs), true);
  assert.equal(showEmergencyBadge({ offers_emergency: true, faqs: conwayFaqs }), false);
});
test("badge shows when flagged and not denied", () => {
  const faqs = [{ q: "Do you do emergency calls?", a: "Yes, 24/7 for burst pipes and no-heat calls." }];
  assert.equal(showEmergencyBadge({ offers_emergency: true, faqs }), true);
});
test("never shows when not flagged", () => {
  assert.equal(showEmergencyBadge({ offers_emergency: false, faqs: [] }), false);
});

console.log("townsLine");
test("residential specialist page that also says commercial reads homeowners", () => {
  assert.equal(townsLine({ trust_badges: ["Residential Specialist"], about: "We serve commercial and homes" }), "Serving homeowners across:");
});
test("both stated", () => {
  assert.equal(townsLine({ about: "Residential and commercial snow plowing." }), "Serving residential and commercial customers across:");
});
test("nothing stated", () => {
  assert.equal(townsLine({ about: "Lawn care in Agawam." }), "Serving customers across:");
});

console.log("ctaNote");
test("only what the business said", () => {
  assert.equal(ctaNote({ trust_badges: ["Free Estimates"], hero_response_time: "Typically responds within a few hours", city: "Agawam" }),
    "Free estimates · Typically responds within a few hours · Local to Agawam");
});
test("empty when nothing to say", () => {
  assert.equal(ctaNote({}), "");
});

console.log(`\n${passed} passed`);
