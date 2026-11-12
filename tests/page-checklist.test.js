// Run with: node tests/page-checklist.test.js (also wired into `npm test`)
import assert from "node:assert/strict";
import { pageChecklist, nextSteps } from "../public/scripts/page-checklist.js";

// Shaped like the Deslandes Construction preview (Oct 2026).
const preview = {
  services: [{ service_name: "Remodeling" }], phone: "(401) 467-7600", average_rating: 4.6,
  attachments: [], images: null, logo_url: null, service_area: ["Warwick"],
  testimonials: [{ quote: "Great work" }, { quote: "Classy team" }],
};
const c = pageChecklist(preview);
assert.deepEqual(c.items.filter(i => i.done).map(i => i.id), ["services", "contact", "rating"]);
assert.deepEqual(c.items.filter(i => !i.done).map(i => i.id), ["photos", "owner_blurb", "response_time", "license_insured", "free_estimates", "logo", "towns", "reviews"]);
assert.equal(c.percent, 30);

// The new owner answers count, ranked by impact: photos, owner blurb, reply time, license/insured, free estimates.
assert.deepEqual(nextSteps({ ...preview, logo_url: "x.png" }).slice(0, 5).map(i => i.id), ["photos", "owner_blurb", "response_time", "license_insured", "free_estimates"]);
assert.deepEqual(nextSteps({ ...preview, attachments: ["a.jpg"], owner_blurb: "Hi", response_time: "within 2 hours" }).map(i => i.id).slice(0, 3), ["license_insured", "free_estimates", "logo"]);
// "No" is an answer: free estimates and insurance count as done when answered either way.
assert.equal(pageChecklist({ offers_free_estimates: false }).items.find(i => i.id === "free_estimates").done, true);
assert.equal(pageChecklist({ is_insured: false }).items.find(i => i.id === "license_insured").done, true);
assert.equal(pageChecklist({ offers_free_estimates: null }).items.find(i => i.id === "free_estimates").done, false);

const full = pageChecklist({ ...preview, logo_url: "x.png", attachments: [{ url: "a.jpg" }], service_area: ["A", "B", "C"], testimonials: [{ quote: 1 }, { quote: 2 }, { quote: 3 }],
  owner_blurb: "Hi", response_time: "within 2 hours", license_number: "123", offers_free_estimates: true });
assert.equal(full.done, 11);
assert.equal(full.percent, 90, "never claims 100%");
assert.deepEqual(nextSteps({ ...preview, logo_url: "x.png", attachments: [{ url: "a.jpg" }], service_area: ["A", "B", "C"], testimonials: [{ quote: 1 }, { quote: 2 }, { quote: 3 }], owner_blurb: "Hi", response_time: "x", license_number: "1", offers_free_estimates: true }), []);

assert.equal(pageChecklist({}).percent, 0);
console.log("page-checklist: ok");
