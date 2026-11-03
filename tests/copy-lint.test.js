// Run with: node tests/copy-lint.test.js (also wired into `npm test`)

import assert from "node:assert/strict";
import { lintCopy, scrubCopy, bannedWordsIn, fixInstructions } from "../api/_lib/copy-lint.js";
import { workPhotos, heroPhoto, visibleAttachments, mergeKinds } from "../api/_lib/photo-kinds.js";

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

// Conway's page as it shipped before the review.
const conway = {
  hero_headline: "Reliable Lawn Care in Agawam & West Springfield",
  trust_badges: ["Owner-Operated", "Residential Specialist", "Free Estimates", "Reliable Scheduling"],
  about: "We serve residential homes only. Commercial properties welcome too.",
  services: [
    { service_name: "Mowing", service_description: "Weekly or bi-weekly mowing to keep your lawn neat, healthy, and evenly cut all season long." },
    { service_name: "Trimming", service_description: "Our trimming services ensure your hedges and shrubs are perfectly shaped." },
    { service_name: "Snow Removal", service_description: "Stay safe during winter with our reliable snow removal services." },
  ],
  faqs: [{ q: "Do you offer emergency services?", a: "At this time, we do not offer emergency or after-hours services." }],
};

console.log("lintCopy");
test("finds the banned words Conway's shipped with", () => {
  const kinds = lintCopy(conway, { offers_emergency: false }).filter(i => i.kind === "banned_word").map(i => i.field);
  assert.ok(kinds.includes("hero_headline"));
  assert.ok(kinds.includes("trust_badges[3]"));
});
test("flags generic service lines, passes specific ones", () => {
  const vague = lintCopy(conway, {}).filter(i => i.kind === "vague_service").map(i => i.field);
  assert.deepEqual(vague, ["services[1]", "services[2]"]);
});
test("flags emergency badge vs FAQ", () => {
  assert.ok(lintCopy(conway, { offers_emergency: true }).some(i => i.kind === "contradiction" && i.field === "faqs"));
  assert.ok(!lintCopy(conway, { offers_emergency: false }).some(i => i.field === "faqs"));
});
test("flags residential-only vs commercial", () => {
  assert.ok(lintCopy(conway, {}).some(i => i.kind === "contradiction" && i.field === "about"));
});
test("clean copy passes", () => {
  const clean = {
    hero_headline: "Lawn Care in Agawam — Owner on Every Job",
    trust_badges: ["Since 2021", "Free Estimates"],
    services: [{ service_name: "Fall Cleanup", service_description: "Leaf blowing, bed edging and debris haul-away from October to early December." }],
    faqs: [{ q: "Do you plow?", a: "Yes, driveways in Agawam." }],
  };
  assert.deepEqual(lintCopy(clean, { offers_emergency: false }), []);
});

console.log("scrubCopy");
test("drops filler badges and cleans the headline", () => {
  const out = scrubCopy(conway);
  assert.equal(out.hero_headline, "Lawn Care in Agawam & West Springfield");
  assert.deepEqual(out.trust_badges, ["Owner-Operated", "Residential Specialist", "Free Estimates"]);
});
test("bannedWordsIn is case-insensitive and deduped", () => {
  assert.deepEqual(bannedWordsIn("Reliable, RELIABLE and top-notch"), ["reliable", "top-notch"]);
});
test("fixInstructions lists every problem", () => {
  assert.match(fixInstructions([{ message: "a" }, { message: "b" }]), /- a\n- b/);
  assert.equal(fixInstructions([]), "");
});

console.log("photo kinds");
const photos = { attachments: ["https://x/flyer.jpg", "https://x/yard.jpg", "https://x/old.png", "https://x/menu.pdf"],
  attachment_kinds: { "https://x/flyer.jpg": "flyer", "https://x/yard.jpg": "work" } };
test("flyers never show; untagged older photos still do", () => {
  assert.deepEqual(workPhotos(photos), ["https://x/yard.jpg", "https://x/old.png"]);
});
test("hero prefers a tagged job photo over an untagged one", () => {
  assert.equal(heroPhoto(photos), "https://x/yard.jpg");
  assert.equal(heroPhoto({ attachments: ["https://x/f.jpg"], attachment_kinds: { "https://x/f.jpg": "flyer" } }), null);
});
test("visible attachments keep non-image resources", () => {
  assert.deepEqual(visibleAttachments(photos), ["https://x/yard.jpg", "https://x/old.png", "https://x/menu.pdf"]);
});
test("mergeKinds keeps, overrides, defaults new uploads to work, drops removed", () => {
  const out = mergeKinds({ a: "flyer", gone: "work" }, { b: "logo" }, ["a", "b", "c", "d"], ["c"]);
  assert.deepEqual(out, { a: "flyer", b: "logo", c: "work" });
});

console.log(`\n${passed} passed`);
