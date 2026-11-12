// Run with: node tests/profile-upgrade.test.js (also wired into `npm test`)
// The owner's new optional answers (migration 20261114_profile_upgrade):
// the migration itself, reading them from the form, the per-service extras,
// offersFreeEstimates on the new column, and the new page events.

import assert from "node:assert/strict";
import fs from "node:fs";
import {
  ownerFactsFromForm, yesNo, cleanYears, cleanLicense, cleanResponseTime, cleanSteps, cleanServiceExtras, cleanPhotoUrl,
} from "../api/_lib/profile-fields.js";
import { mergeUserServicePrices } from "../api/_lib/service-utils.js";
import { offersFreeEstimates, callCtaLabel, responseTime } from "../api/_lib/page-claims.js";
import { FUNNEL_EVENTS } from "../api/_lib/tracking.js";

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { console.error(`  FAIL - ${name}`); console.error(err); process.exitCode = 1; }
}

console.log("migration");
const sql = fs.readFileSync(new URL("../supabase/migrations/20261114_profile_upgrade.sql", import.meta.url), "utf8");
const code = sql.replace(/--.*$/gm, "");
await test("adds exactly the new columns, all nullable, no defaults", () => {
  const cols = [...code.matchAll(/add column if not exists (\w+) (\w+)/g)].map(m => `${m[1]} ${m[2]}`);
  assert.deepEqual(cols, ["years_in_business int", "license_number text", "is_insured boolean", "offers_free_estimates boolean",
    "response_time text", "owner_photo_url text", "owner_blurb text", "how_it_works jsonb"]);
  assert.doesNotMatch(code, /not null|default\s/i);
  assert.doesNotMatch(code, /price_from|turnaround/, "per-service fields live inside services jsonb");
});
await test("changes no existing column and can run twice", () => {
  assert.doesNotMatch(code, /alter column|drop column|rename|update\s+public|delete from|truncate/i);
  // Every add is "if not exists"; constraints are dropped before they're re-added.
  assert.equal((code.match(/add column (?!if not exists)/gi) || []).length, 0);
  for (const c of [...code.matchAll(/add constraint (\w+)/g)].map(m => m[1])) assert.match(code, new RegExp(`drop constraint if exists ${c}`));
});

console.log("form answers");
await test("yes / no / skip", () => {
  assert.equal(yesNo("yes"), true);
  assert.equal(yesNo("no"), false);
  assert.equal(yesNo(""), null);
  assert.equal(yesNo("maybe"), null);
});
await test("years, license, reply time, steps, photo URL are cleaned, unclear means not given", () => {
  assert.equal(cleanYears("12 years"), 12);
  assert.equal(cleanYears("999"), null);
  assert.equal(cleanYears(""), null);
  assert.equal(cleanLicense("Lic. #HIC-12345"), "HIC-12345");
  assert.equal(cleanLicense("  "), null);
  assert.equal(cleanResponseTime("We usually reply within 2 hours."), "within 2 hours");
  assert.equal(cleanSteps(JSON.stringify([{ title: "A" }, { title: "B" }, { title: "C", text: "c" }])).length, 3);
  assert.equal(cleanSteps("Call us — tell us the job\nGet a price — same day\nWe do it — on your day")[1].text, "same day");
  assert.equal(cleanSteps("only one"), null);
  assert.equal(cleanPhotoUrl("https://x.supabase.co/a.jpg"), "https://x.supabase.co/a.jpg");
  assert.equal(cleanPhotoUrl("javascript:alert(1)"), null);
});
await test("a field the form didn't send keeps the stored value; one sent empty clears it", () => {
  const existing = { years_in_business: 9, license_number: "OLD-1", is_insured: true, offers_free_estimates: false, response_time: "the same day", owner_blurb: "Hi" };
  const sent = { years_in_business: "", is_insured: "no", owner_blurb: "  New words  " };
  const out = ownerFactsFromForm(k => sent[k], existing);
  assert.deepEqual(out, { years_in_business: null, license_number: "OLD-1", is_insured: false, offers_free_estimates: false, response_time: "the same day", owner_blurb: "New words" });
  assert.deepEqual(ownerFactsFromForm(() => undefined, {}), { years_in_business: null, license_number: null, is_insured: null, offers_free_estimates: null, response_time: null, owner_blurb: null });
});

console.log("per-service extras");
await test("price-from and turnaround survive an AI rewrite of the services, matched by name", () => {
  const ai = [{ service_name: "Spring Cleanup", service_description: "AI text" }, { service_name: "Mowing", service_description: "AI text" }];
  const mine = JSON.stringify([{ service_name: "mowing", price_from: "$45", turnaround: "Weekly" }, { service_name: "Spring cleanup", price: "Call for quote" }]);
  const out = mergeUserServicePrices(ai, mine);
  assert.equal(out[1].price_from, "$45");
  assert.equal(out[1].turnaround, "Weekly");
  assert.equal(out[0].price, "Call for quote");
  assert.equal(out[0].price_from, undefined, "no empty extras added");
});
await test("cleanServiceExtras: strips a leading 'From', drops blanks", () => {
  assert.deepEqual(cleanServiceExtras({ price_from: "From $150", turnaround: "  " }), { price_from: "$150" });
  assert.deepEqual(cleanServiceExtras({}), {});
});

console.log("offersFreeEstimates on the new column");
await test("only the owner's yes counts; AI copy saying free never does", () => {
  assert.equal(offersFreeEstimates({ offers_free_estimates: true }), true);
  assert.equal(offersFreeEstimates({ offers_free_estimates: false }), false);
  assert.equal(offersFreeEstimates({ offers_free_estimates: null, trust_badges: ["Free Estimates"], about: "Free estimates always." }), false);
  assert.equal(callCtaLabel({ offers_free_estimates: true }), "Call for a free estimate");
  assert.equal(callCtaLabel({}), "Call for a quote");
  assert.equal(responseTime({ response_time: "Usually replies within 2 hours." }), "within 2 hours");
});

console.log("tracking");
await test("the new page events are allowlisted", () => {
  for (const e of ["contact_click", "service_quote_click", "spotlight_link_click"]) assert.ok(FUNNEL_EVENTS.has(e), e);
});
await test("profile.js sends sms taps as contact_click type sms, service and spotlight clicks with the slug only, and respects the internal flag", () => {
  const js = fs.readFileSync(new URL("../public/scripts/profile.js", import.meta.url), "utf8");
  assert.match(js, /trackPageEvent\('service_quote_click', \{ service \}\)/);
  assert.match(js, /trackPageEvent\('spotlight_link_click', \{ service: spot \}\)/);
  assert.match(js, /const contact = a\.getAttribute\('data-contact'\);\s*if \(contact\) trackContactClick\(contact\);/);
  assert.match(js, /event: 'contact_click', metadata: \{ type \}, internal: enomaIsInternal\(\) \|\| undefined/);
  assert.match(js, /body: JSON\.stringify\(\{ slug, event, metadata: metadata \|\| \{\}, internal: enomaIsInternal\(\) \|\| undefined \}\)/);
  assert.match(js, /enoma_internal=1/, "the internal cookie counts, not just localStorage");
  const lib = fs.readFileSync(new URL("../api/_lib/company-page.js", import.meta.url), "utf8");
  assert.ok((lib.match(/data-contact="sms"/g) || []).length >= 3, "header, mobile bar and areas all tag sms");
});

console.log(`\n${passed} passed`);
