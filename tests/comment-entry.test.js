// Run with: node tests/comment-entry.test.js (also wired into `npm test`)
// Comment-keyword entry: /page → /get-your-website?src=comment&ch=fb&kw=PAGE.
// Hero swap, the /page redirect, src/ch/kw carried into the claim and
// checkout, and the brief's source labels (JS + SQL twin).
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {
  cleanAttribution, cleanCommentParams, chooseFirstTouch, selfServeFirstTouch, utmMetadata
} from "../api/_lib/attribution.js";
import { funnelRow } from "../api/_lib/tracking.js";
import { sourceLabel, funnelSourceLabel, SOURCE_LABELS } from "../api/_lib/traffic-sources.js";

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok - ${name}`); } catch (err) { console.error(`  FAIL - ${name}`); throw err; }
}
const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// ── Hero swap ────────────────────────────────────────────────────────────────
const ORIGINAL = { headline: "Start getting leads", subhead: "Landscapers. Plumbers.", line: "Your page: your services" };
function fakeDoc() {
  const el = (text) => ({ textContent: text });
  const nodes = { ".copy .headline": el(ORIGINAL.headline), ".copy .subhead": el(ORIGINAL.subhead), ".copy .page-line": el(ORIGINAL.line) };
  const input = { focused: 0, focus() { this.focused++; } };
  const classes = new Set();
  return {
    nodes, input, classes,
    querySelector: (s) => nodes[s] || null,
    getElementById: (id) => (id === "biz_lookup" ? input : null),
    body: { classList: { add: (c) => classes.add(c) } }
  };
}
function loadEntry(search) {
  const doc = fakeDoc();
  const win = { document: doc, location: { search }, URLSearchParams };
  vm.runInNewContext(read("public/scripts/comment-entry.js"), { window: win, URLSearchParams, globalThis: win });
  return { doc, api: win.EnomaCommentEntry };
}

test("src=comment swaps the hero, adds the price line and focuses the search box", () => {
  const { doc, api } = loadEntry("?src=comment&ch=fb&kw=PAGE");
  assert.equal(doc.nodes[".copy .headline"].textContent, "Here’s the free preview you asked for");
  assert.equal(doc.nodes[".copy .subhead"].textContent, "Find your business below and see your page in about a minute.");
  assert.equal(doc.nodes[".copy .page-line"].textContent, "First month free, then $19.99/month or $199/year. Cancel anytime.");
  assert.equal(doc.input.focused, 1);
  assert.ok(doc.classes.has("from-comment"));
  assert.deepEqual({ ...api.params("?src=comment&ch=ig&kw=page") }, { src: "comment", ch: "ig", kw: "PAGE" });
});

test("the hero stays as is without src=comment", () => {
  for (const search of ["", "?ch=fb&kw=PAGE", "?src=instant", "?src=commentx", "?utm_source=facebook", "?ref=get-started"]) {
    const { doc } = loadEntry(search);
    assert.equal(doc.nodes[".copy .headline"].textContent, ORIGINAL.headline, search);
    assert.equal(doc.nodes[".copy .subhead"].textContent, ORIGINAL.subhead, search);
    assert.equal(doc.nodes[".copy .page-line"].textContent, ORIGINAL.line, search);
    assert.equal(doc.input.focused, 0, search);
    assert.equal(doc.classes.size, 0, search);
  }
});

test("get-your-website.html has the elements the swap targets and loads the script", () => {
  const html = read("public/get-your-website.html");
  const copy = html.slice(html.indexOf('<div class="copy">'), html.indexOf("<!-- RIGHT: FORM CARD -->"));
  for (const cls of ["headline", "subhead", "page-line"]) assert.ok(copy.includes(`class="${cls}"`), cls);
  assert.ok(html.includes('id="biz_lookup"'));
  assert.ok(html.includes('<script src="/scripts/comment-entry.js"></script>'));
  // enomaAttribution() (sent with gyw_viewed and the instant preview) carries src/ch/kw.
  assert.match(html, /'utm_term', 'src', 'ch', 'kw'/);
  assert.match(html, /EnomaCommentEntry\.params\(location\.search\)/);
});

// ── /page redirect ──────────────────────────────────────────────────────────
test("/page redirects to /get-your-website?src=comment, keeping ch/kw", () => {
  const cfg = JSON.parse(read("vercel.json"));
  const r = cfg.redirects.find((x) => x.source === "/page");
  assert.ok(r, "missing /page redirect");
  assert.equal(r.destination, "/get-your-website?src=comment");
  assert.equal(r.permanent, false);
  // Vercel appends the request's query string to a redirect destination, so
  // /page?ch=fb&kw=PAGE → /get-your-website?src=comment&ch=fb&kw=PAGE. The
  // destination must not hard-code ch/kw or they'd clash with the incoming ones.
  assert.ok(!/[?&](ch|kw)=/.test(r.destination));
  const merged = new URL(r.destination, "https://enoma.io");
  for (const [k, v] of new URLSearchParams("ch=fb&kw=PAGE")) merged.searchParams.set(k, v);
  assert.equal(merged.pathname + merged.search, "/get-your-website?src=comment&ch=fb&kw=PAGE");
  // A redirect, not a function: no rewrite or api route for /page.
  assert.ok(!cfg.rewrites.some((x) => x.source === "/page"));
  assert.ok(!fs.existsSync(new URL("../api/page.js", import.meta.url)));
});

// ── Carried through instant preview → claim → subscribe ─────────────────────
function runRefCapture(store, search, pathname = "/get-your-website") {
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); }
  };
  const ctx = { location: { search, pathname, protocol: "https:" }, document: { referrer: "https://l.facebook.com/", cookie: "" }, localStorage, URLSearchParams, JSON, Date, Object };
  vm.runInNewContext(read("public/scripts/ref-capture.js"), ctx);
  return store;
}

test("ref-capture stores src/ch/kw in both stored touches", () => {
  const store = runRefCapture({}, "?src=comment&ch=fb&kw=page");
  const first = JSON.parse(store.enoma_first_touch);
  const attr = JSON.parse(store.enoma_attr);
  for (const t of [first, attr]) {
    assert.equal(t.src, "comment"); assert.equal(t.ch, "fb"); assert.equal(t.kw, "PAGE");
    assert.equal(t.landing, "/get-your-website");
  }
});

test("a returning browser gains src/ch/kw without losing its first touch", () => {
  const old = JSON.stringify({ t: Date.now() - 864e5, landing: "/pricing", referrer: "" });
  const store = runRefCapture({ enoma_first_touch: old, enoma_attr: old }, "?src=comment&ch=ig&kw=PAGE");
  const first = JSON.parse(store.enoma_first_touch);
  assert.equal(first.landing, "/pricing");
  assert.equal(first.ch, "ig");
  // A later non-comment visit doesn't strip it.
  runRefCapture(store, "?src=instant", "/acme-plumbing/preview");
  assert.equal(JSON.parse(store.enoma_first_touch).src, "comment");
  // Other src values are never stored.
  const other = runRefCapture({}, "?src=instant");
  assert.equal(JSON.parse(other.enoma_first_touch).src, undefined);
});

test("src/ch/kw survive into the claim and the claimed page's signup source", () => {
  const store = runRefCapture({}, "?src=comment&ch=fb&kw=PAGE");
  const browser = JSON.parse(store.enoma_first_touch); // what claim.html sends as first_touch

  // Instant preview: prospect.raw.attribution, then businesses.first_touch at generation.
  const attribution = cleanAttribution({ ...browser, ...cleanCommentParams({ src: "comment", ch: "fb", kw: "PAGE" }) });
  assert.deepEqual(selfServeFirstTouch(attribution, "instant_preview"),
    { landing: "/get-your-website", referrer: "https://l.facebook.com/", src: "comment", ch: "fb", kw: "PAGE", created_via: "instant_preview" });

  // Claim (api/claim-business.js): the browser's touch counts as a campaign touch.
  const prospect = { source: "inbound_lookup", raw: { attribution: { landing: "/" } } };
  const chosen = chooseFirstTouch({ browser, prospect });
  assert.equal(chosen.src, "comment"); assert.equal(chosen.ch, "fb"); assert.equal(chosen.kw, "PAGE");
  assert.equal(sourceLabel(chosen), "Comment (FB)");

  // business_claimed funnel row.
  const row = funnelRow({ event: "business_claimed", trafficClass: "human", attribution: browser, metadata: { slug: "x" } });
  assert.deepEqual({ src: row.metadata.first_touch.src, ch: row.metadata.first_touch.ch, kw: row.metadata.first_touch.kw }, { src: "comment", ch: "fb", kw: "PAGE" });

  // Subscribe: Stripe metadata + checkout_started.
  assert.deepEqual(utmMetadata(chosen), { src: "comment", ch: "fb", kw: "PAGE" });
});

test("cleanCommentParams keeps only the comment tag, a known channel and a plain keyword", () => {
  assert.equal(cleanCommentParams({ src: "instant", ch: "fb" }), null);
  assert.equal(cleanCommentParams(null), null);
  assert.deepEqual(cleanCommentParams({ src: " Comment ", ch: "tiktok", kw: "<b>x</b>" }), { src: "comment" });
  assert.deepEqual(cleanCommentParams({ src: "comment", ch: "IG", kw: "website-now" }), { src: "comment", ch: "ig", kw: "WEBSITE-NOW" });
  assert.equal(cleanAttribution({ src: "instant", landing: "/x" }).src, undefined);
  assert.equal(cleanCommentParams({ src: "comment", kw: "A".repeat(80) }).kw.length, 30);
});

test("internal devices stay internal on comment visits", () => {
  const row = funnelRow({ event: "gyw_viewed", trafficClass: "internal", metadata: { src: "comment", ch: "fb" } });
  assert.equal(row.traffic_class, "internal");
  const sql = read("supabase/migrations/20261113_comment_keyword_sources.sql");
  assert.match(sql, /where e\.traffic_class = 'human'/);
  assert.match(sql, /coalesce\(b\.is_internal, false\) = false/);
});

// ── The brief's source labels ───────────────────────────────────────────────
test("sourceLabel groups comment traffic as its own sources", () => {
  assert.equal(sourceLabel({ src: "comment", ch: "fb", kw: "PAGE" }), "Comment (FB)");
  assert.equal(sourceLabel({ src: "comment", ch: "ig" }), "Comment (IG)");
  assert.equal(sourceLabel({ src: "comment" }), "Comment");
  // Comment wins over the Facebook referrer the DM link click carries.
  assert.equal(sourceLabel({ src: "comment", ch: "fb", referrer: "https://l.facebook.com/" }), "Comment (FB)");
  assert.equal(sourceLabel({ referrer: "https://l.facebook.com/" }), "Facebook / Instagram");
  assert.equal(sourceLabel({ src: "instant" }), "Direct");
  assert.equal(sourceLabel({ utm_source: "cold_email" }), "Cold email");
  assert.equal(sourceLabel({ referrer: "https://www.google.com/" }), "Google");
  assert.equal(sourceLabel({ referrer: "https://enoma.io/for/x" }), "Direct");
  assert.equal(sourceLabel(null), "Direct");
});

test("funnelSourceLabel: the visit's own comment tag beats an older first touch", () => {
  assert.equal(funnelSourceLabel({ metadata: { src: "comment", ch: "ig", first_touch: { utm_source: "google" } } }), "Comment (IG)");
  assert.equal(funnelSourceLabel({ metadata: { first_touch: { src: "comment", ch: "fb" } } }), "Comment (FB)");
  assert.equal(funnelSourceLabel({ metadata: { first_touch: { utm_source: "google" } } }), "Google");
  assert.equal(funnelSourceLabel({}), "Direct");
});

test("the SQL twin has the same labels and the brief's views", () => {
  const sql = read("supabase/migrations/20261113_comment_keyword_sources.sql");
  for (const label of Object.values(SOURCE_LABELS)) assert.ok(sql.includes(`'${label}'`), label);
  for (const name of ["attribution_source_label", "funnel_source_label", "v_funnel_sources_daily", "v_signups_by_source"]) {
    assert.ok(sql.includes(`public.${name}`), name);
  }
  // Runs after the migration that adds funnel_events.traffic_class.
  const files = fs.readdirSync(new URL("../supabase/migrations/", import.meta.url)).sort();
  assert.ok(files.indexOf("20261113_comment_keyword_sources.sql") > files.indexOf("20261112_traffic_class.sql"));
});

console.log(`comment-entry: ${passed} passed`);
