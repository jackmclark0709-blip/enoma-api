// Run with: node tests/page-checklist.test.js (also wired into `npm test`)
import assert from "node:assert/strict";
import { pageChecklist } from "../public/scripts/page-checklist.js";

// Shaped like the Deslandes Construction preview (Oct 2026).
const preview = {
  services: [{ service_name: "Remodeling" }], phone: "(401) 467-7600", average_rating: 4.6,
  attachments: [], images: null, logo_url: null, service_area: ["Warwick"],
  testimonials: [{ quote: "Great work" }, { quote: "Classy team" }],
};
const c = pageChecklist(preview);
assert.deepEqual(c.items.filter(i => i.done).map(i => i.id), ["services", "contact", "rating"]);
assert.deepEqual(c.items.filter(i => !i.done).map(i => i.label), ["Your photos", "Your logo", "Every town you serve", "More of your reviews"]);
assert.equal(c.percent, 40);

const full = pageChecklist({ ...preview, logo_url: "x.png", attachments: [{ url: "a.jpg" }], service_area: ["A", "B", "C"], testimonials: [{ quote: 1 }, { quote: 2 }, { quote: 3 }] });
assert.equal(full.done, 7);
assert.equal(full.percent, 90, "never claims 100%");

assert.equal(pageChecklist({}).percent, 0);
console.log("page-checklist: ok");
