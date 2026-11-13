// Run with: node tests/brand-color.test.js (also wired into `npm test`)
// The CTA color system (api/_lib/page-style.js): every palette has its own
// CTA color, readable text on it, and an amber/teal choice that never looks
// like the identity color; logo colors read on the server (logo-color.js,
// sharp) and in the browser (public/scripts/brand-color.js) agree on one
// fixture; p.js's style block prefers a stored brand_color; the backfill
// script's dry run writes nothing.

import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {
  AMBER, TEAL, NEUTRALS, allPalettes, pickPalette, ctaFor, ctaHover, contrastRatio, hexToRgb,
  ensureUsableBrandColor, dominantColorFromPixels, brandTokens, brandColorStyle, headingStretchFor,
} from "../api/_lib/page-style.js";
import { logoBrandColor, saveBrandColor } from "../api/_lib/logo-color.js";
import { starterLogoSvg } from "../api/_lib/starter-logo.js";
import { backfillBrandColors } from "../scripts/backfill-brand-color.mjs";

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { console.error(`  FAIL - ${name}`); console.error(err); process.exitCode = 1; }
}
const quiet = { warn() {}, log() {} };

// The browser copy, loaded the way the page loads it (a classic script).
const browser = (() => {
  const ctx = {};
  vm.runInNewContext(fs.readFileSync(new URL("../public/scripts/brand-color.js", import.meta.url), "utf8"), ctx);
  return ctx.EnomaBrandColor;
})();

console.log("CTA tokens");

await test("ctaFor: amber by default, teal when the identity color is itself amber/gold", () => {
  const cases = { "#b0543a": AMBER, "#b8860b": TEAL, "#d08a1a": TEAL, "#1f4f8f": AMBER, "#f5c842": TEAL };
  for (const [hex, want] of Object.entries(cases)) assert.equal(ctaFor(hex), want, hex);
  // Brown, copper, red, green, blue, gray, and nonsense: amber.
  for (const hex of ["#8a5a24", "#b0643a", "#9a3f2c", "#2f6b3a", "#2a7fc0", "#777777", "nope", null]) assert.equal(ctaFor(hex), AMBER, String(hex));
});

await test("every palette (24) has cta and ctaText; only volt and graphite are teal", () => {
  const all = allPalettes();
  assert.equal(all.length, 24);
  for (const p of all) {
    assert.match(p.cta, /^#[0-9A-Fa-f]{6}$/, p.name);
    assert.match(p.ctaText, /^#[0-9A-Fa-f]{6}$/, p.name);
  }
  assert.deepEqual(all.filter(p => p.cta === TEAL.cta).map(p => `${p.persona}.${p.name}`), ["electrical.volt", "electrical.graphite"]);
  assert.equal(all.filter(p => p.cta === AMBER.cta).length, 22);
});

await test("ctaText on cta is at least 4.5:1 for every palette (computed)", () => {
  for (const p of allPalettes()) {
    const ratio = contrastRatio(p.cta, p.ctaText);
    assert.ok(ratio >= 4.5, `${p.name}: ${ratio.toFixed(2)}`);
  }
  assert.ok(Math.abs(contrastRatio(AMBER.cta, AMBER.ctaText) - 8.9) < 0.1);
  assert.ok(Math.abs(contrastRatio(TEAL.cta, TEAL.ctaText) - 6.9) < 0.1);
});

await test("the hand-set palettes and the logo rule agree: ctaFor(primary) is each palette's cta", () => {
  for (const p of allPalettes()) assert.equal(ctaFor(p.primary).cta, p.cta, p.name);
});

await test("the CTA never equals the identity color", () => {
  for (const p of allPalettes()) assert.notEqual(p.cta.toLowerCase(), p.primary.toLowerCase(), p.name);
});

await test("ctaHover is the CTA 10% toward black", () => {
  assert.equal(ctaHover("#F2A93B"), "#da9835");
  assert.equal(ctaHover("#2BB3A3"), "#27a193");
  assert.equal(ctaHover("bad"), "bad");
});

console.log("logo color: server and browser agree");

// One fixture for both copies: pixel buffers (RGBA) and identity colors.
const px = (...colors) => Uint8ClampedArray.from(colors.flatMap(([rgb, n, a = 255]) => Array.from({ length: n }, () => [...rgb, a]).flat()));
const PIXELS = [
  { name: "terracotta logo on white", data: px([[255, 255, 255], 50], [[176, 84, 58], 30], [[20, 20, 20], 10]), want: "#b05040" },
  { name: "near-black text is skipped", data: px([[10, 10, 10], 80], [[31, 79, 143], 5]), want: "#205090" },
  { name: "transparent is skipped", data: px([[200, 30, 30], 90, 0], [[47, 107, 58], 3]), want: "#307040" },
  { name: "a light yellow is darkened until usable", data: px([[250, 230, 120], 20]), want: null /* computed below */ },
  { name: "ties go to the first color seen", data: px([[176, 84, 58], 4], [[31, 79, 143], 4]), want: "#b05040" },
  { name: "nothing usable", data: px([[255, 255, 255], 30], [[0, 0, 0], 30]), want: null },
];
const IDENTITIES = ["#b0543a", "#b8860b", "#d08a1a", "#1f4f8f", "#f5c842", "#8a5a24", "#b0643a", "#2bb3a3", "#f2a93b", "#ffff00", "#3b44a8"];

await test("dominantColorFromPixels: buckets of 16, skips white / near-black / transparent", () => {
  for (const c of PIXELS) if (c.want) assert.equal(dominantColorFromPixels(c.data), c.want, c.name);
  assert.equal(dominantColorFromPixels(PIXELS[5].data), null);
  const yellow = dominantColorFromPixels(PIXELS[3].data);
  assert.ok(yellow && yellow !== "#f0e080", "darkened");
  assert.equal(yellow, ensureUsableBrandColor([256, 224, 128].map(v => Math.min(255, v))));
});

await test("browser copy gives the same answers on the same fixture", () => {
  for (const c of PIXELS) assert.equal(browser.dominantColorFromPixels(c.data), dominantColorFromPixels(c.data), c.name);
  for (const hex of IDENTITIES) assert.deepEqual({ ...browser.ctaFor(hex) }, { ...ctaFor(hex) }, hex);
  for (const rgb of [[250, 230, 120], [255, 255, 255], [10, 120, 200]]) assert.equal(browser.ensureUsableBrandColor(rgb), ensureUsableBrandColor(rgb));
  assert.deepEqual({ ...browser.AMBER }, { ...AMBER });
  assert.deepEqual({ ...browser.TEAL }, { ...TEAL });
});

await test("logoBrandColor reads a real PNG with sharp", async () => {
  const sharp = (await import("sharp")).default;
  // 128x128: a terracotta square on white, with a thin black frame.
  const png = await sharp({ create: { width: 128, height: 128, channels: 4, background: "#ffffff" } })
    .composite([
      { input: await sharp({ create: { width: 128, height: 6, channels: 4, background: "#000000" } }).png().toBuffer(), top: 0, left: 0 },
      { input: await sharp({ create: { width: 80, height: 80, channels: 4, background: "#b0543a" } }).png().toBuffer(), top: 24, left: 24 },
    ]).png().toBuffer();
  assert.equal(await logoBrandColor(png, { log: quiet }), "#b05040");
});

await test("logoBrandColor returns null (and doesn't throw) when sharp fails or the bytes aren't an image", async () => {
  const warnings = [];
  const log = { warn: (...a) => warnings.push(a.join(" ")) };
  assert.equal(await logoBrandColor(Buffer.from("not an image"), { log }), null);
  assert.equal(await logoBrandColor(Buffer.from("x"), { sharp: () => { throw new Error("no sharp"); }, log }), null);
  assert.equal(await logoBrandColor(null, { log }), null);
  assert.equal(warnings.length, 2);
});

await test("saveBrandColor writes brand_color, and only logs when the column isn't there yet", async () => {
  const writes = [];
  const db = err => ({ from: t => ({ update: patch => ({ eq: async (k, v) => { writes.push({ t, patch, k, v }); return { error: err }; } }) }) });
  assert.equal(await saveBrandColor(db(null), "biz-1", "#b05040", { log: quiet }), true);
  assert.deepEqual(writes[0], { t: "small_business_profiles", patch: { brand_color: "#b05040" }, k: "business_id", v: "biz-1" });
  assert.equal(await saveBrandColor(db({ message: "column brand_color does not exist" }), "biz-1", null, { log: quiet }), false);
  assert.deepEqual(writes[1].patch, { brand_color: null });
});

console.log("p.js brand style");

const PAINTER = { business_name: "Let It Roll Painting", primary_category: "painting" };

await test("brandColorStyle sets the CTA, hover, neutral and heading-width variables", () => {
  const pal = pickPalette(PAINTER.primary_category, PAINTER.business_name);
  const css = brandColorStyle(PAINTER);
  assert.ok(css.includes(`--brand-primary: ${pal.primary};`));
  assert.ok(css.includes(`--brand-cta: ${pal.cta};`));
  assert.ok(css.includes(`--brand-cta-text: ${pal.ctaText};`));
  assert.ok(css.includes(`--brand-cta-hover: color-mix(in srgb, ${pal.cta}, black 10%);`));
  for (const [name, v] of [["ink", NEUTRALS.ink], ["ink-muted", NEUTRALS.inkMuted], ["ink-faint", NEUTRALS.inkFaint], ["line", NEUTRALS.line], ["line-strong", NEUTRALS.lineStrong], ["chip-bg", NEUTRALS.chipBg]]) {
    assert.ok(css.includes(`--${name}: ${v};`), name);
  }
  assert.ok(css.includes("--biz-heading-stretch: 92%;"), "painting is a wider-heading trade");
});

await test("business-base.css :root has the same defaults, so a page without the block still works", () => {
  const base = fs.readFileSync(new URL("../public/styles/business-base.css", import.meta.url), "utf8");
  const root = base.slice(base.indexOf(":root {"), base.indexOf("}", base.indexOf(":root {")));
  const def = n => (root.match(new RegExp(`--${n}:\\s*([^;]+);`)) || [])[1]?.trim();
  assert.equal(def("brand-cta"), AMBER.cta);
  assert.equal(def("brand-cta-text"), AMBER.ctaText);
  assert.equal(def("brand-cta-hover"), `color-mix(in srgb, ${AMBER.cta}, black 10%)`);
  assert.equal(def("ink"), NEUTRALS.ink);
  assert.equal(def("ink-muted"), NEUTRALS.inkMuted);
  assert.equal(def("ink-faint"), NEUTRALS.inkFaint);
  assert.equal(def("line"), NEUTRALS.line);
  assert.equal(def("line-strong"), NEUTRALS.lineStrong);
  assert.equal(def("chip-bg"), NEUTRALS.chipBg);
});

await test("a stored brand_color wins over the palette, and picks its own CTA", () => {
  const blue = brandColorStyle({ ...PAINTER, brand_color: "#1F4F8F", logo_url: "https://x/logo.png" });
  assert.ok(blue.includes("--brand-primary: #1f4f8f;"));
  assert.ok(blue.includes("--brand-rgb: 31,79,143;"));
  assert.ok(blue.includes(`--brand-cta: ${AMBER.cta};`));
  const gold = brandColorStyle({ ...PAINTER, brand_color: "#b8860b" });
  assert.ok(gold.includes("--brand-primary: #b8860b;"));
  assert.ok(gold.includes(`--brand-cta: ${TEAL.cta};`), "a gold logo gets the teal CTA");
  // Hero background stays the palette's (only the accent and glow change).
  const pal = pickPalette(PAINTER.primary_category, PAINTER.business_name);
  assert.ok(gold.includes(`--hero-bg: ${pal.bg};`));
});

await test("a malformed brand_color is ignored (palette instead)", () => {
  const pal = pickPalette(PAINTER.primary_category, PAINTER.business_name);
  for (const bad of ["red", "#fff", "rgb(1,2,3)", "", null, "#12345g"]) {
    assert.equal(brandTokens({ ...PAINTER, brand_color: bad }).primary, pal.primary, String(bad));
  }
});

await test("heading width per trade: 85% for building trades, 92% for the rest", () => {
  for (const p of ["contractor", "electrical", "hvac", "plumbing"]) assert.equal(headingStretchFor(p), "85%", p);
  for (const p of ["landscaping", "cleaning", "painting", "default"]) assert.equal(headingStretchFor(p), "92%", p);
  assert.ok(brandColorStyle({ business_name: "Acme Roofing", primary_category: "roofing" }).includes("--biz-heading-stretch: 85%;"), "roofing is a contractor persona");
});

await test("starter logo badge uses brand_color when set", () => {
  const svg = starterLogoSvg({ ...PAINTER, brand_color: "#1f4f8f" }, "badge");
  assert.ok(svg.includes('fill="#1f4f8f"'));
});

console.log("backfill script");

function fakeSupabase(rows) {
  const writes = [];
  return {
    writes,
    from() {
      const q = {
        select() { return q; }, not() { return q; }, is() { return q; }, order() { return q; },
        async range(from, to) { return { data: rows.slice(from, to + 1), error: null }; },
        update(patch) { writes.push(patch); return { eq: () => ({ is: async () => ({ error: null }) }) }; },
      };
      return q;
    },
  };
}
const ROWS = [
  { business_id: "a", username: "blue-co", logo_url: "https://x/a.png", brand_color: null },
  { business_id: "b", username: "blank-co", logo_url: "https://x/b.png", brand_color: null },
  { business_id: "c", username: "broken-co", logo_url: "https://x/c.png", brand_color: null },
];
const fetchBytes = async url => { if (url.endsWith("c.png")) throw new Error("HTTP 404"); return Buffer.from(url); };
const readColor = async buf => (String(buf).endsWith("a.png") ? "#1f4f8f" : null);

await test("dry run lists what it would set and writes nothing", async () => {
  const db = fakeSupabase(ROWS);
  const lines = [];
  const out = await backfillBrandColors({ supabase: db, fetchBytes, readColor, log: { log: l => lines.push(l), warn() {} } });
  assert.deepEqual(out.map(r => [r.username, r.status, r.brand_color]), [
    ["blue-co", "would_set", "#1f4f8f"], ["blank-co", "no_color", null], ["broken-co", "error: HTTP 404", null],
  ]);
  assert.equal(db.writes.length, 0);
  assert.match(lines.at(-1), /1 would be set \(dry run, nothing written; add --apply\)/);
});

await test("--apply writes only the colors it found", async () => {
  const db = fakeSupabase(ROWS);
  const out = await backfillBrandColors({ supabase: db, apply: true, fetchBytes, readColor, log: quiet });
  assert.deepEqual(db.writes, [{ brand_color: "#1f4f8f" }]);
  assert.equal(out[0].status, "set");
});

await test("migration adds a nullable, hex-checked brand_color", () => {
  const sql = fs.readFileSync(new URL("../supabase/migrations/20261114_brand_color.sql", import.meta.url), "utf8");
  assert.match(sql, /alter table public\.small_business_profiles\s+add column if not exists brand_color text/i);
  assert.ok(sql.includes("check (brand_color ~ '^#[0-9a-fA-F]{6}$')"));
  assert.doesNotMatch(sql, /not null/i);
});

console.log(`\n${passed} passed`);
