// Run with: node tests/stock-library.test.js (also wired into `npm test`)
// Enoma's self-hosted stock library (api/_lib/stock-library.js).
import assert from "node:assert/strict";
import fs from "node:fs";
import { STOCK_LIBRARY } from "../api/_lib/stock-library-data.js";
import { tagForService, stockForService, stockForHero, HERO_TAGS, TAG_ALT, libraryKeys } from "../api/_lib/stock-library.js";

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { console.error(`  FAIL - ${name}`); console.error(err); process.exitCode = 1; }
}

await test("every photo is in public/stock at both sizes, small enough to serve", () => {
  assert.ok(STOCK_LIBRARY.length >= 120);
  for (const r of STOCK_LIBRARY) for (const w of [800, 1600]) {
    const f = new URL(`../public/stock/${r.id}-${w}.webp`, import.meta.url);
    assert.ok(fs.existsSync(f), `${r.id}-${w}`);
    assert.ok(fs.statSync(f).size < 400_000, `${r.id}-${w} under 400 KB`);
  }
  assert.equal(new Set(STOCK_LIBRARY.map(r => r.id)).size, STOCK_LIBRARY.length, "no duplicate ids");
});

await test("every tag has alt text; every persona has a hero photo", () => {
  for (const k of libraryKeys()) assert.ok(TAG_ALT[k], k);
  for (const p of Object.keys(HERO_TAGS)) assert.ok(stockForHero({ persona: p, seed: "s" }), p);
  assert.equal(stockForHero({ persona: "default" }), null);
});

await test("services map to the right photo, across trades when needed", () => {
  assert.equal(tagForService("plumbing", "Drain clogs"), "plumbing/drain");
  assert.equal(tagForService("painting", "Pressure Washing"), "cleaning/pressure-wash");
  assert.equal(tagForService("contractor", "Roof Leak Repairs"), "contractor/roof");
  assert.equal(tagForService("contractor", "Asphalt paving"), "contractor/paving");
  assert.equal(tagForService("landscaping", "Mulch Installation"), "landscaping/garden-beds");
});

await test("never the same photo twice on a page; stable for a business; persona fallback", () => {
  const taken = new Set();
  const hero = stockForHero({ persona: "plumbing", seed: "biz", taken });
  const cards = ["Drain clogs", "Drain cleaning", "Sewer lines", "Pipe leaks", "Heating"].map(name => stockForService({ persona: "plumbing", name, seed: "biz", taken }));
  const ids = [hero, ...cards].map(x => x.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(stockForService({ persona: "plumbing", name: "Drain clogs", seed: "biz" }).id, stockForService({ persona: "plumbing", name: "Drain clogs", seed: "biz" }).id);
  assert.ok(stockForService({ persona: "electrical", name: "Something unusual", seed: "x" }), "falls back to any photo of the trade");
  assert.equal(stockForService({ persona: "default", name: "x" }), null);
});

console.log(`\n${passed} passed`);
