// Run with: node tests/ga-guard.test.js (also wired into `npm test`)
// Every page (and every page generator) that configures GA4 must go through
// enomaGaConfig(), so ?internal=1 devices are tagged traffic_type=internal
// (dropped by GA4's "Internal Traffic" data filter) and headless browsers
// (navigator.webdriver) don't send hits at all.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (err) { console.error(`FAIL: ${name}`); throw err; }
}

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (p.endsWith(".html")) out.push(p);
  }
  return out;
}
const files = [
  ...walk(path.join(root, "public")),
  path.join(root, "api/_lib/town-pages.js"),
  path.join(root, "scripts/build-guides.mjs"),
];

test("no GA config call skips the internal/bot guard", () => {
  const bad = [];
  for (const f of files) {
    const s = fs.readFileSync(f, "utf8");
    const configs = s.match(/gtag\(\s*['"]config['"][^;]*/g) || [];
    for (const c of configs) if (!c.includes("enomaGaConfig(")) bad.push(path.relative(root, f));
  }
  assert.deepEqual(bad, []);
});

// Pull the helper out of one page and run it in a fake browser.
const page = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const helper = page.match(/function enomaGaConfig\(c\)\{.*?return c\}/)[0];
function run({ search = "", stored = null, webdriver = false, cfg = {}, cookie = "" }) {
  const store = new Map(stored == null ? [] : [["enoma_internal", stored]]);
  const win = {};
  const ctx = {
    location: { search },
    navigator: { webdriver },
    document: { cookie },
    window: win,
    localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) },
  };
  const out = vm.runInNewContext(`${helper}; enomaGaConfig(${JSON.stringify(cfg)})`, ctx);
  return { cfg: out, flag: store.get("enoma_internal") ?? null, disabled: win["ga-disable-G-S8XTG72Y2Y"] === true };
}

test("?internal=1 tags this visit and remembers the device", () => {
  const r = run({ search: "?internal=1" });
  assert.equal(r.cfg.traffic_type, "internal");
  assert.equal(r.flag, "1");
});

test("a remembered device stays internal on later visits", () => {
  assert.equal(run({ stored: "1" }).cfg.traffic_type, "internal");
});

test("?internal=0 clears the flag", () => {
  const r = run({ search: "?utm_source=x&internal=0", stored: "1" });
  assert.equal(r.cfg.traffic_type, undefined);
  assert.equal(r.flag, "0");
});

test("normal visitors are untouched and existing config is kept", () => {
  const r = run({ search: "?utm_source=facebook", cfg: { content_group: "guide" } });
  assert.deepEqual({ ...r.cfg }, { content_group: "guide" });
  assert.equal(r.disabled, false);
});

test("the enoma_internal cookie from /internal-optout tags the visit", () => {
  assert.equal(run({ cookie: "_ga=GA1.1.1; enoma_internal=1" }).cfg.traffic_type, "internal");
  assert.equal(run({ cookie: "enoma_internal=0" }).cfg.traffic_type, undefined);
  assert.equal(run({ cookie: "xenoma_internal=1" }).cfg.traffic_type, undefined);
});

test("the cookie still works when localStorage is blocked", () => {
  const out = vm.runInNewContext(`${helper}; enomaGaConfig({})`, {
    location: { search: "" }, navigator: {}, window: {}, document: { cookie: "enoma_internal=1" },
    localStorage: { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } },
  });
  assert.equal(out.traffic_type, "internal");
});

test("headless browsers don't send GA hits", () => {
  assert.equal(run({ webdriver: true }).disabled, true);
});

test("blocked localStorage doesn't break the page", () => {
  const out = vm.runInNewContext(`${helper}; enomaGaConfig({})`, {
    location: { search: "?internal=1" }, navigator: {}, window: {}, document: { cookie: "" },
    localStorage: { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } },
  });
  assert.deepEqual({ ...out }, {});
});

console.log(`ga-guard: ${passed} passed`);
