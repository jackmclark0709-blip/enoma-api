// Run with: node tests/towns.test.js (also wired into `npm test`)
// Suggested towns work anywhere in the US: Census Gazetteer places + county
// subdivisions (data/towns/<ST>.json), loaded per state plus neighbors.

import assert from "node:assert/strict";
import fs from "node:fs";
import { townsFor, loadTownCoords, STATE_NEIGHBORS, stateCode } from "../api/_lib/brand-kit.js";
import { cleanName, parseGazetteer, mergeTowns, isInstitutionCdp } from "../scripts/build-town-coords.mjs";

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { console.error(`  FAIL - ${name}`); console.error(err); process.exitCode = 1; }
}
const dir = new URL("../data/towns/", import.meta.url);

await test("Ewing NJ (a township, not a Census place) now gets suggestions", async () => {
  const p = { city: "Ewing", state: "NJ", service_area: [] };
  const t = townsFor(p, await loadTownCoords(p.state));
  assert.deepEqual(t.confirmed, ["Ewing"]);
  assert.ok(t.suggested.length >= 3 && t.suggested.length <= 6, t.suggested.join(", "));
  assert.ok(t.suggested.includes("Trenton"), t.suggested.join(", "));
  assert.equal(new Set(t.suggested).size, t.suggested.length, "no duplicate names");
});

await test("towns across a state line are suggested (neighbor files load)", async () => {
  const coords = await loadTownCoords("NJ");
  assert.ok(coords.some(([, s]) => s === "PA"));
  assert.ok(!coords.some(([, s]) => s === "CA"), "only NJ and its neighbors");
  const t = townsFor({ city: "Ewing", state: "New Jersey" }, coords);
  assert.ok(t.suggested.length > 0, "full state name works too");
});

await test("works anywhere: a town in every state file resolves", async () => {
  for (const [st, city] of [["MA", "Attleboro"], ["TX", "Austin"], ["CA", "Fresno"], ["MI", "Lansing"], ["VT", "Brattleboro"], ["NH", "Keene"]]) {
    const t = townsFor({ city, state: st }, await loadTownCoords(st));
    assert.ok(t.suggested.length > 0, `${city}, ${st}`);
  }
  assert.deepEqual(await loadTownCoords("ZZ"), []);
  assert.deepEqual(townsFor({ city: "Nowhere", state: "ZZ" }, []).suggested, []);
});

await test("an ambiguous town name gets no suggestions unless another listed town pins it down", async () => {
  const coords = await loadTownCoords("NJ");
  const franklins = coords.filter(([c, s]) => s === "NJ" && c === "Franklin");
  assert.ok(franklins.length > 1, "NJ has several Franklins");
  assert.deepEqual(townsFor({ city: "Franklin", state: "NJ" }, coords).suggested, []);
  // Franklin Township, Somerset County, next to New Brunswick.
  const pinned = townsFor({ city: "Franklin", state: "NJ", service_area: ["New Brunswick"] }, coords);
  assert.ok(pinned.suggested.length > 0);
});

await test("bundle: one file per state, every file small, every neighbor has a file", () => {
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".json"));
  assert.ok(files.length >= 51);
  for (const f of files) {
    assert.ok(fs.statSync(new URL(f, dir)).size < 200_000, `${f} is too big`);
    const j = JSON.parse(fs.readFileSync(new URL(f, dir), "utf8"));
    assert.match(j.source, /Census/);
    assert.ok(j.towns.every(t => t.length === 4 && typeof t[2] === "number"));
  }
  for (const [st, ns] of Object.entries(STATE_NEIGHBORS)) for (const n of [st, ...ns]) {
    if (n === "PR") continue;
    assert.ok(files.includes(`${n}.json`), `missing ${n}.json`);
  }
  assert.equal(stateCode("New Jersey"), "NJ");
});

await test("campus, base and prison CDPs are never suggested as towns; real towns with those words stay", async () => {
  assert.equal(isInstitutionCdp("The College of New Jersey CDP", "S"), true);
  assert.equal(isInstitutionCdp("Fairfield University CDP", "S"), true);
  assert.equal(isInstitutionCdp("Homestead Base CDP", "S"), true);
  assert.equal(isInstitutionCdp("College Station CDP", "S"), false);
  assert.equal(isInstitutionCdp("University Park city", "A"), false, "incorporated towns keep their name");
  const t = townsFor({ city: "Ewing", state: "NJ" }, await loadTownCoords("NJ"));
  assert.ok(!t.suggested.some(n => /college|university/i.test(n)), t.suggested.join(", "));
});

await test("build script: names cleaned, CCDs dropped, places win over a same-named subdivision", () => {
  assert.equal(cleanName("Ewing township"), "Ewing");
  assert.equal(cleanName("North Attleborough town"), "North Attleborough");
  assert.equal(cleanName("Nashville-Davidson metropolitan government (balance)"), "Nashville-Davidson");
  assert.equal(cleanName("Abanda CDP"), "Abanda");
  const head = "USPS|GEOID|GEOIDFQ|ANSICODE|NAME|FUNCSTAT|ALAND|AWATER|ALAND_SQMI|AWATER_SQMI|INTPTLAT|INTPTLONG";
  const cs = parseGazetteer([head,
    "NJ|1|x|x|Ewing township|A|0|0|0|0|40.263|-74.799",
    "AL|2|x|x|Autaugaville CCD|S|0|0|0|0|32.45|-86.72",
    "NJ|3|x|x|Princeton|A|0|0|0|0|40.35|-74.66"].join("\n"), { kind: "cousub" });
  assert.deepEqual(cs.map(t => t[0]), ["Ewing", "Princeton"]);
  const pl = [["Princeton", "NJ", 40.351, -74.66]];
  const merged = mergeTowns(pl, cs);
  assert.deepEqual(merged.NJ.map(t => t[0]), ["Ewing", "Princeton"], "one Princeton");
});

console.log(`\n${passed} passed`);
