// Run with: node tests/starter-logo.test.js (also wired into `npm test`)

import assert from "node:assert/strict";
import {
  starterLogoOptions, starterLogoSvg, STARTER_LOGO_IDS, TRADE_ICONS, tradeIconFor,
  logoName, logoText, nameLines, chosenStarterLogoId, isStarterLogoId, escapeXml,
} from "../api/_lib/starter-logo.js";
import { pickPalette } from "../api/_lib/page-style.js";

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { console.error(`  FAIL - ${name}`); console.error(err); process.exitCode = 1; }
}

// Minimal XML well-formedness parser: balanced tags, quoted attributes,
// no duplicate attributes, only known entities, no stray "<" or "&" in text.
// Returns the element tree so tests can look inside.
function parseXml(src) {
  let i = 0;
  const root = { name: "#root", attrs: {}, children: [], text: "" };
  const stack = [root];
  const checkText = t => {
    assert.ok(!/<|>/.test(t), `stray angle bracket in text: ${t}`);
    for (const m of t.matchAll(/&([^;\s]*);?/g)) {
      assert.ok(/^&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);$/i.test(m[0]), `bad entity: ${m[0]}`);
    }
  };
  while (i < src.length) {
    if (src[i] === "<") {
      const end = src.indexOf(">", i);
      assert.ok(end > 0, "unterminated tag");
      const tag = src.slice(i + 1, end);
      i = end + 1;
      if (tag.startsWith("/")) {
        const name = tag.slice(1).trim();
        const top = stack.pop();
        assert.equal(top.name, name, `mismatched </${name}>`);
        continue;
      }
      const selfClose = tag.endsWith("/");
      const body = selfClose ? tag.slice(0, -1) : tag;
      const m = body.match(/^([A-Za-z][\w:-]*)([\s\S]*)$/);
      assert.ok(m, `bad tag <${tag}>`);
      const attrs = {};
      let rest = m[2].trim();
      while (rest) {
        const a = rest.match(/^([A-Za-z_:][\w:.-]*)="([^"<]*)"\s*/);
        assert.ok(a, `bad attribute in <${m[1]}>: ${rest.slice(0, 40)}`);
        assert.ok(!(a[1] in attrs), `duplicate attribute ${a[1]}`);
        checkText(a[2]);
        attrs[a[1]] = a[2];
        rest = rest.slice(a[0].length);
      }
      const el = { name: m[1], attrs, children: [], text: "" };
      stack[stack.length - 1].children.push(el);
      if (!selfClose) stack.push(el);
    } else {
      const next = src.indexOf("<", i);
      const t = src.slice(i, next < 0 ? src.length : next);
      checkText(t);
      stack[stack.length - 1].text += t;
      i = next < 0 ? src.length : next;
    }
  }
  assert.equal(stack.length, 1, "unclosed tags");
  assert.equal(root.children.length, 1, "exactly one root element");
  return root.children[0];
}
const all = (el, name, out = []) => { if (el.name === name) out.push(el); el.children.forEach(c => all(c, name, out)); return out; };
const textOf = el => el.text + el.children.map(textOf).join("");
const unescape = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

const SAMPLES = [
  { business_name: "Robbins Plumbing & Heating LLC", primary_category: "Plumber" },
  { business_name: "Foley & Sons Landscaping Inc", primary_category: "Landscaping" },
  { business_name: "Bright Line Electric", primary_category: "Electrician" },
  { business_name: "Sparkle & Shine Residential and Commercial Cleaning Services, LLC", primary_category: "House cleaning service" },
  { business_name: "", primary_category: "" },
];

console.log("starterLogoOptions");
test("returns exactly three options with stable ids", () => {
  for (const p of SAMPLES) {
    const opts = starterLogoOptions(p);
    assert.equal(opts.length, 3);
    assert.deepEqual(opts.map(o => o.id), ["badge", "stacked", "wordmark"]);
    assert.deepEqual(STARTER_LOGO_IDS, ["badge", "stacked", "wordmark"]);
    for (const o of opts) assert.equal(typeof o.svg, "string");
  }
});

test("every option is well-formed, self-contained SVG", () => {
  for (const p of SAMPLES) for (const tone of ["light", "dark"]) for (const o of starterLogoOptions(p, { tone })) {
    const svg = parseXml(o.svg);
    assert.equal(svg.name, "svg");
    assert.equal(svg.attrs.xmlns, "http://www.w3.org/2000/svg");
    assert.match(svg.attrs.viewBox, /^0 0 \d+ \d+$/);
    const [, , w, h] = svg.attrs.viewBox.split(" ").map(Number);
    assert.ok(w > 40 && w < 460 && h > 30 && h < 220, `size ${w}x${h}`);
    // No external fonts, images, links or scripts.
    assert.ok(!/<image|<script|<foreignObject|href=|url\(|@import|@font-face|https?:\/\/(?!www\.w3\.org\/2000\/svg)/i.test(o.svg), o.id);
    for (const t of all(svg, "text")) {
      assert.match(t.attrs["font-family"], /^Archivo, .*sans-serif$/, "Archivo (the customer-page font) with a system sans fallback");
      assert.doesNotMatch(t.attrs["font-family"], /Fraunces|DM Sans|Georgia/);
    }
    // No ids, so three inline SVGs on one page can't collide.
    assert.ok(!/\sid="/.test(o.svg));
  }
});

test("deterministic: same profile, same three options", () => {
  for (const p of SAMPLES) assert.deepEqual(starterLogoOptions({ ...p }), starterLogoOptions({ ...p }));
});

test("uses the page's brand palette", () => {
  const p = SAMPLES[0];
  const pal = pickPalette(p.primary_category, p.business_name);
  const [badge] = starterLogoOptions(p);
  assert.ok(badge.svg.includes(`fill="${pal.primary}"`), "badge chip in palette primary");
  assert.ok(badge.svg.includes(`fill="${pal.bg}"`), "name in palette ink");
  const dark = starterLogoSvg(p, "wordmark", { tone: "dark" });
  assert.ok(dark.includes('fill="#ffffff"') && dark.includes(pal.light));
});

test("escapes the business name", () => {
  const p = { business_name: `Bob's <script>alert("x")</script> & "Sons"`, primary_category: "plumber" };
  for (const o of starterLogoOptions(p)) {
    assert.ok(!o.svg.includes("<script"), "no raw script tag");
    const svg = parseXml(o.svg);
    const title = unescape(textOf(all(svg, "title")[0]));
    assert.ok(title.includes(`<script>`), "name survives escaping intact");
    assert.ok(!/alert\("x"\)<\/script>/.test(o.svg));
  }
  assert.equal(escapeXml(`<a href="x">&'`), "&lt;a href=&quot;x&quot;&gt;&amp;&apos;");
});

console.log("names");
test("drops LLC / Inc / Corp / Ltd from the logo, keeps & Sons and Co.", () => {
  assert.equal(logoName("Robbins Plumbing & Heating LLC"), "Robbins Plumbing & Heating");
  assert.equal(logoName("Foley & Sons Landscaping, Inc."), "Foley & Sons Landscaping");
  assert.equal(logoName("Acme Corp"), "Acme");
  assert.equal(logoName("Smith Electric L.L.C."), "Smith Electric");
  assert.equal(logoName("Blue Sky Painting Co., LLC"), "Blue Sky Painting Co.");
  assert.equal(logoName("Smith & Sons"), "Smith & Sons");
  assert.equal(logoName("LLC"), "LLC", "a name that is only a suffix is left alone");
  for (const o of starterLogoOptions({ business_name: "Foley & Sons Landscaping Inc", primary_category: "landscaping" })) {
    const text = unescape(all(parseXml(o.svg), "text").map(textOf).join(" "));
    assert.ok(!/\bInc\b|\bLLC\b/i.test(text), o.id);
    assert.ok(text.includes("Foley & Sons"), o.id);
  }
});

test("short names stay on one line; descriptor comes from the trade words", () => {
  assert.deepEqual(logoText("Foley & Sons Landscaping Inc"), { name: "Foley & Sons Landscaping", lines: ["Foley & Sons"], descriptor: "Landscaping" });
  assert.deepEqual(logoText("Bright Line Electric").lines, ["Bright Line"]);
});

test("long names wrap to two lines or shorten to the first three words", () => {
  assert.deepEqual(nameLines("Bob Smith & Sons Family Builders"), ["Bob Smith & Sons", "Family Builders"]);
  // never ends a line on "&" / "and"
  for (const n of ["Bob Smith & Sons Family Builders", "Greater Boston and Metro West Home", "Johnson & Johnson Family Property Group"]) {
    const lines = nameLines(n);
    assert.ok(lines.length <= 2, n);
    for (const l of lines) assert.ok(!/(\s&|\sand)$/i.test(l), `${n} -> ${l}`);
  }
  const huge = "Sparkle & Shine Residential and Commercial Window Washing Experts";
  assert.deepEqual(nameLines(huge), ["Sparkle & Shine"]);
  const t = logoText("Sparkle & Shine Residential and Commercial Cleaning Services, LLC");
  assert.deepEqual(t.lines, ["Sparkle & Shine"]);
  assert.equal(t.descriptor, "Cleaning Services");
  // "Bob Smith & Sons" keeps the "& Sons" together when shortened
  assert.deepEqual(nameLines("Bob Smith & Sons Plumbing Heating Cooling Drains Gas Fitting").join(" "), "Bob Smith & Sons");
  // every rendered line fits the viewBox estimate
  for (const o of starterLogoOptions({ business_name: huge, primary_category: "cleaning" })) {
    assert.ok(all(parseXml(o.svg), "tspan").length <= 2, o.id);
  }
});

console.log("trade icons");
test("each persona gets its icon", () => {
  const cases = {
    plumber: "plumbing", "hvac contractor": "hvac", electrician: "electrical", landscaping: "landscaping",
    "snow removal": "snow", "house cleaning service": "cleaning", "roofing contractor": "roofing",
    "painting contractor": "painting", handyman: "handyman", "general contractor": "handyman",
    contractor: "handyman", bakery: "default", "": "default",
  };
  for (const [cat, icon] of Object.entries(cases)) assert.equal(tradeIconFor(cat), icon, cat);
  for (const key of ["plumbing", "hvac", "electrical", "landscaping", "snow", "cleaning", "roofing", "painting", "handyman", "default"]) {
    assert.ok(Array.isArray(TRADE_ICONS[key]) && TRADE_ICONS[key].length, key);
  }
});

test("badge and stacked draw the trade icon; wordmark is name only", () => {
  const p = { business_name: "North Shore Snow Removal", primary_category: "snow removal" };
  const firstPath = `<path d="${TRADE_ICONS.snow[0]}"/>`;
  const [badge, stacked, wordmark] = starterLogoOptions(p);
  assert.ok(badge.svg.includes(firstPath));
  assert.ok(stacked.svg.includes(firstPath));
  assert.ok(!wordmark.svg.includes("<path"));
  // Different trades, different icons.
  const icons = new Set(Object.keys(TRADE_ICONS).map(k => TRADE_ICONS[k][0]));
  assert.equal(icons.size, Object.keys(TRADE_ICONS).length);
});

console.log("choice");
test("chosenStarterLogoId defaults to the badge and ignores junk", () => {
  assert.equal(chosenStarterLogoId({}), "badge");
  assert.equal(chosenStarterLogoId({ starter_logo_id: "stacked" }), "stacked");
  assert.equal(chosenStarterLogoId({ starter_logo_id: "<svg>" }), "badge");
  assert.ok(isStarterLogoId("wordmark") && !isStarterLogoId("x") && !isStarterLogoId(null));
  assert.equal(starterLogoSvg(SAMPLES[0], "nope"), starterLogoSvg(SAMPLES[0], "badge"));
});

console.log(`\n${passed} passed`);
