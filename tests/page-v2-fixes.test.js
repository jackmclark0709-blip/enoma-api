// Run with: node tests/page-v2-fixes.test.js (also wired into `npm test`)
// Review follow-ups for page v2: license verify links, thin-page headlines
// (first service, never "specialty"), and the "What are you known for?"
// field on the owner bar and claim box.

import assert from "node:assert/strict";
import fs from "node:fs";
import { LICENSE_VERIFY_URLS, licenseFrom, deriveKit, buildBrandKit, cleanOwnerSpecialty } from "../api/_lib/brand-kit.js";
import { headlineFor, firstService, renderBlocksV2, knownForHtml } from "../api/_lib/page-v2.js";
import { setSpecialty, handleOwnerAction } from "../api/_lib/owner-actions.js";
import { newOwnerToken } from "../api/_lib/owner-link.js";
import { mainService, loadTownCoords } from "../api/_lib/brand-kit.js";
import { featuredFor, launchKitFingerprint } from "../api/_lib/launch-kit.js";
import { refreshedTowns, refreshKitTowns } from "../scripts/refresh-kit-towns.mjs";

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { console.error(`  FAIL - ${name}`); console.error(err); process.exitCode = 1; }
}
const read = rel => fs.readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

// ── License links ─────────────────────────────────────────────────────────

await test("license verify links: MA moved to the Contractor Hub, NH via OPLC, NY has none", () => {
  assert.equal(LICENSE_VERIFY_URLS.MA, "https://contractorhub.mass.gov/s/hic-contractor-search");
  assert.equal(LICENSE_VERIFY_URLS.NH, "https://www.oplc.nh.gov/license-lookup");
  assert.equal(LICENSE_VERIFY_URLS.NY, undefined, "no statewide contractor license in NY");
  for (const st of ["NJ", "PA", "MA", "CT", "RI", "NH", "ME", "VT"]) assert.match(LICENSE_VERIFY_URLS[st], /^https:\/\//, st);
  assert.equal(licenseFrom({ license_number: "123456", state: "NY" }).verify_url, null, "NY shows the number without a link");
  assert.equal(licenseFrom({ license_number: "HIC.0123456", state: "Massachusetts" }).verify_url, LICENSE_VERIFY_URLS.MA);
});

// ── Thin pages ────────────────────────────────────────────────────────────

const ANCHOR = { username: "anchor-property-maintenance", business_name: "Anchor Property Maintenance", primary_category: "Landscaping",
  city: "Attleboro", state: "MA", phone: "(508) 685-5658", hero_headline: "Attleboro Landscaping", page_version: 2,
  services: [{ service_name: "Landscaping & Property Maintenance." }, { service_name: "Mulching" }] };

await test("thin page (no specialty, no owner names): the headline leads with the first service", () => {
  const kit = deriveKit(ANCHOR, {});
  assert.equal(kit.specialty, null);
  assert.deepEqual(kit.owner_names, []);
  const h = headlineFor(ANCHOR, kit);
  assert.equal(h, "Landscaping & Property Maintenance in Attleboro");
  assert.doesNotMatch(h, /specialt/i, "never called a specialty");
  assert.equal(firstService(ANCHOR), "Landscaping & Property Maintenance");
});

await test("headline: specialty still wins; owner names keep the old headline; a service equal to the trade falls back", () => {
  assert.equal(headlineFor(ANCHOR, { specialty: "Stone walls", owner_names: [] }), "Stone walls, done right.");
  assert.equal(headlineFor(ANCHOR, { specialty: null, owner_names: ["Dave"] }), "Attleboro Landscaping");
  assert.equal(headlineFor({ ...ANCHOR, services: [{ service_name: "Landscaping" }], hero_headline: "" }, { owner_names: [] }), "Landscaping in Attleboro");
  assert.equal(headlineFor({ ...ANCHOR, services: [] }, { owner_names: [] }), "Attleboro Landscaping");
});

// ── What are you known for? ───────────────────────────────────────────────

await test("cleanOwnerSpecialty: a few plain words; links, emails, phones and essays are refused", () => {
  assert.equal(cleanOwnerSpecialty("  cathedral   ceilings. "), "Cathedral ceilings");
  assert.equal(cleanOwnerSpecialty("We're known for: stone walls"), "Stone walls");
  assert.equal(cleanOwnerSpecialty("Decks & porches"), "Decks & porches");
  assert.equal(cleanOwnerSpecialty(""), "", "empty clears");
  assert.equal(cleanOwnerSpecialty("ab"), null);
  assert.equal(cleanOwnerSpecialty("x".repeat(41)), null);
  assert.equal(cleanOwnerSpecialty("see www.joe.com"), null);
  assert.equal(cleanOwnerSpecialty("call 508-555-0100"), null);
  assert.equal(cleanOwnerSpecialty("me@x.io"), null);
  assert.equal(cleanOwnerSpecialty("<script>"), null);
});

await test("the owner's answer becomes the specialty and survives a kit rebuild", async () => {
  const kit = deriveKit(ANCHOR, { ownerSpecialty: "stone walls" });
  assert.deepEqual([kit.specialty, kit.owner_specialty], ["Stone walls", "Stone walls"]);
  assert.equal(headlineFor(ANCHOR, kit), "Stone walls, done right.");
  const offline = async () => { throw new Error("offline"); };
  const rebuilt = await buildBrandKit({ ...ANCHOR, brand_kit: kit }, { fetchImpl: offline, openaiKey: "", placesKey: "", env: {}, townCoords: [], log: { warn() {} } });
  assert.equal(rebuilt.specialty, "Stone walls");
  assert.equal(rebuilt.owner_specialty, "Stone walls");
});

await test("setSpecialty: sets, clears, refuses junk", () => {
  const p = { brand_kit: { specialty: "Old", colors: { identity: "#000" } } };
  assert.deepEqual(setSpecialty(p, "Stone walls").brand_kit, { specialty: "Stone walls", owner_specialty: "Stone walls", colors: { identity: "#000" } });
  assert.equal(setSpecialty(p, "").brand_kit.owner_specialty, null);
  assert.ok(setSpecialty(p, "http://spam.example").error);
});

function ownerDb(profile) {
  const updates = [];
  return {
    updates,
    from: () => {
      let cols = "", patch = null;
      const q = {
        select(c) { cols = c || ""; return q; }, update(p) { patch = p; return q; }, eq() { return patch ? Promise.resolve(updates.push(patch) && { error: null }) : q; },
        // rebuildBrandKit's select("*") gets nothing, so the background rebuild is a no-op here.
        maybeSingle: async () => ({ data: cols === "*" ? null : profile }),
      };
      return q;
    },
  };
}
function fakeRes() {
  const r = { code: 0, body: null };
  r.status = c => { r.code = c; return r; };
  r.json = b => { r.body = b; return r; };
  return r;
}

await test("owner action set_specialty: needs the owner token, saves the cleaned text, starts a rebuild", async () => {
  const token = newOwnerToken();
  const profile = { business_id: "b", username: "anchor-property-maintenance", page_version: 2, owner_token: token, brand_kit: { colors: { identity: "#123" } } };
  const jobs = [];
  const call = async (body) => {
    const db = ownerDb(profile), res = fakeRes();
    await handleOwnerAction({ method: "POST", query: { action: "set_specialty" }, body }, res, { supabaseAdmin: db, waitUntil: j => jobs.push(j) });
    return { res, db };
  };
  const bad = await call({ slug: profile.username, o: newOwnerToken(), specialty: "Stone walls" });
  assert.equal(bad.res.code, 403);
  assert.equal(bad.db.updates.length, 0);
  const junk = await call({ slug: profile.username, o: token, specialty: "visit www.spam.com" });
  assert.equal(junk.res.code, 400);
  const ok = await call({ slug: profile.username, o: token, specialty: "stone walls" });
  assert.equal(ok.res.code, 200);
  assert.equal(ok.db.updates[0].brand_kit.specialty, "Stone walls");
  assert.equal(jobs.length, 1, "kit rebuild queued");
  await Promise.all(jobs);
});

await test("owner bar shows the field (prefilled); visitors never see it; claim box has it only on the owner link", () => {
  const kit = deriveKit(ANCHOR, { ownerSpecialty: "Stone walls" });
  const t = newOwnerToken();
  const owner = Object.values(renderBlocksV2(ANCHOR, kit, { slug: ANCHOR.username, owner: true, token: t })).join("");
  assert.match(owner, /What are you known for\?/);
  assert.match(owner, /id="ownerKnownForInput"[^>]*value="Stone walls"/);
  assert.match(owner, /action=set_specialty/);
  const visitor = Object.values(renderBlocksV2(ANCHOR, kit, { slug: ANCHOR.username })).join("");
  assert.doesNotMatch(visitor, /known for\?|set_specialty/i);
  assert.match(knownForHtml({ specialty: '"x"' }, "k"), /value="&quot;x&quot;"/, "escaped");
  const html = read("public/profile.html"), js = read("public/scripts/profile.js");
  assert.match(html, /id="claimKnownWrap"[^>]*hidden|class="[^"]*hidden[^"]*" id="claimKnownWrap"/);
  assert.match(js, /querySelector\('\.v2-owner\[data-o\]'\)/);
  assert.match(js, /action=set_specialty/);
});

// ── Main service ──────────────────────────────────────────────────────────

const svc = (cat, names) => ({ primary_category: cat, city: "Milford", services: names.map(n => ({ service_name: n })) });

await test("main service: the first one that names the trade, else the first listed", () => {
  assert.equal(mainService(svc("painter", ["Pressure Washing", "Carpentry Services", "Exterior Painting"])).name, "Exterior Painting");
  assert.equal(mainService(svc("roofing contractor", ["Gutters", "Roof Repair"])).name, "Roof Repair", "category words count too");
  assert.equal(mainService(svc("electrician", ["Generators", "Panel Upgrades"])).name, "Panel Upgrades");
  assert.equal(mainService(svc("general contractor", ["Decks", "Kitchens"])).name, "Decks", "no trade words: first listed");
  assert.equal(mainService(svc("painter", [])), null);
  const abc = svc("painter", ["Pressure Washing", "Exterior Painting"]);
  assert.equal(headlineFor(abc, { owner_names: [] }), "Exterior Painting in Milford");
  assert.equal(featuredFor(abc, {}).name, "Exterior Painting", "launch kit agrees with the page");
});

await test("launch kit fingerprint changes only where the main service changed", () => {
  const kit = { colors: { identity: "#123" }, towns: { confirmed: ["Milford"] } };
  const same = svc("painter", ["Exterior Painting", "Pressure Washing"]);
  const moved = svc("painter", ["Pressure Washing", "Exterior Painting"]);
  // "featured" joins the fingerprint only when the main service differs from
  // the first listed, so every other existing kit stays fresh.
  assert.match(read("api/_lib/launch-kit.js"), /\.\.\.\(featuredDiffersFromFirst\(p, kit\) \? \{ featured: featuredFor\(p, kit\)\.name \} : \{\}\)/);
  assert.notEqual(launchKitFingerprint(moved, kit, { month: 5 }), launchKitFingerprint(same, kit, { month: 5 }));
  // Suggested towns aren't in the fingerprint, so the towns refresh remakes nothing.
  assert.equal(launchKitFingerprint(same, { ...kit, towns: { ...kit.towns, suggested: ["Hopedale"] } }, { month: 5 }),
    launchKitFingerprint(same, kit, { month: 5 }));
});

// ── Towns refresh ─────────────────────────────────────────────────────────

await test("towns refresh: new suggestions, confirmed towns untouched, no-op when nothing changes", async () => {
  const coords = await loadTownCoords("NJ");
  const lir = { username: "let-it-roll-painting", city: "Ewing", state: "NJ", brand_kit: { towns: { confirmed: ["Ewing", "Hopewell"], suggested: [] }, colors: {} } };
  const t = refreshedTowns(lir, coords);
  assert.deepEqual(t.confirmed, ["Ewing", "Hopewell"]);
  assert.ok(t.suggested.includes("Trenton"));
  assert.ok(!t.suggested.includes("Hopewell"), "a confirmed town is never suggested");
  assert.equal(refreshedTowns({ ...lir, brand_kit: { ...lir.brand_kit, towns: t } }, coords), null);
  assert.equal(refreshedTowns({ ...lir, brand_kit: null }, coords), null);
});

await test("towns refresh: dry run writes nothing; apply skips claimed pages and keeps the rest of the kit", async () => {
  const rows = [
    { business_id: "a", username: "ewing-painter", city: "Ewing", state: "NJ", page_version: 2, is_claimed: false, brand_kit: { colors: { identity: "#1" }, towns: { confirmed: ["Ewing"], suggested: [] } } },
    { business_id: "b", username: "claimed-one", city: "Ewing", state: "NJ", page_version: 2, is_claimed: true, brand_kit: { towns: { confirmed: ["Ewing"], suggested: [] } } },
  ];
  const writes = [];
  const db = { from: () => {
    let id = null, patch = null;
    const q = {
      select() { return q; }, update(p) { patch = p; return q; },
      eq(k, v) { if (k === "page_version") return Promise.resolve({ data: rows, error: null }); id = v; if (patch) { writes.push([id, patch]); return Promise.resolve({ error: null }); } return q; },
      maybeSingle: async () => ({ data: { brand_kit: rows.find(r => r.business_id === id).brand_kit } }),
    };
    return q;
  } };
  const dry = await refreshKitTowns(db, { log: { warn() {} } });
  assert.deepEqual([dry.checked, dry.changed, dry.gained, writes.length], [1, 1, 1, 0]);
  const live = await refreshKitTowns(db, { apply: true, log: { warn() {} } });
  assert.equal(live.written, 1);
  assert.equal(writes[0][0], "a");
  assert.deepEqual(writes[0][1].brand_kit.colors, { identity: "#1" }, "rest of the kit kept");
  assert.deepEqual(writes[0][1].brand_kit.towns.confirmed, ["Ewing"]);
  assert.ok(writes[0][1].brand_kit.towns.suggested.length > 0);
});

console.log(`\n${passed} passed`);
