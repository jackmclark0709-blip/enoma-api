// Run with: node tests/preview-landing.test.js (also wired into `npm test`)

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { detectCallouts, workingPoints, validateContactRequest, buildContactAlert, renderLanding, MAX_CALLOUTS, instantPreviewPath, landingSource, CALLOUT_ANCHORS, SELLING_POINTS } from "../api/_lib/preview-landing.js";
import { bannedWordsIn } from "../api/_lib/copy-lint.js";
// Page styles live in the one Enoma stylesheet, scoped to body.page-preview.
const css = readFileSync(new URL("../public/styles/enoma.css", import.meta.url), "utf8");

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (err) {
    console.error(`  FAIL - ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

// Shaped like the real unclaimed previews (Nov 2026): no photos, no logo,
// one town, 3 Google reviews shown out of many.
const thin = {
  business_name: "Robbins Plumbing", phone: "(555) 010-0002", city: "Gilbert", state: "AZ",
  services: [{ service_name: "Drain cleaning" }, { service_name: "Water heaters" }],
  service_area: ["Gilbert"], testimonials: [{}, {}, {}], average_rating: 5, review_count: 110,
  why_choose_us: ["Licensed and Insured", "Free estimates"], attachments: [], logo_url: null
};
const full = {
  ...thin, logo_url: "https://x/logo.png",
  attachments: ["https://x/job1.jpg", "https://x/job2.jpg"], attachment_kinds: {},
  services: [{ service_name: "A" }, { service_name: "B" }, { service_name: "C" }],
  service_area: ["Gilbert", "Mesa", "Chandler"], testimonials: [{}, {}, {}, {}, {}], review_count: 5,
  why_choose_us: ["17 years of plumbing experience"], hero_response_time: "Same day"
};
const keys = cs => cs.map(c => c.key);

console.log("detectCallouts");
await test("a thin preview gets notes for what's actually missing, photos first", () => {
  const k = keys(detectCallouts(thin));
  assert.equal(k[0], "photos");
  for (const want of ["reviews", "services", "service_pages", "towns", "numbers"]) assert.ok(k.includes(want), want);
  assert.ok(k.length <= MAX_CALLOUTS);
});
await test("says how many reviews are shown out of how many", () => {
  const r = detectCallouts(thin).find(c => c.key === "reviews");
  assert.match(r.title, /110 Google reviews/);
  assert.match(r.body, /shows 3/);
});
await test("a fuller page gets fewer notes, none for what it already has", () => {
  const k = keys(detectCallouts(full, { spotlightCount: 2 }));
  for (const gone of ["photos", "reviews", "towns", "numbers", "logo", "service_pages", "response_time"]) assert.ok(!k.includes(gone), gone);
  assert.deepEqual(k, ["services"]);
});
await test("years in the copy count as numbers; then it asks for response time", () => {
  const k = keys(detectCallouts({ ...thin, why_choose_us: ["Over 20 years experience"] }));
  assert.ok(!k.includes("numbers"));
  assert.ok(k.includes("response_time") || k.length === MAX_CALLOUTS);
});
await test("fewer than 3 services asks for the rest", () => {
  const s = detectCallouts({ ...thin, services: [{ service_name: "One" }] }).find(c => c.key === "services");
  assert.match(s.title, /rest of your services/);
  assert.match(s.body, /one service/);
});
await test("no phone is called out", () => {
  assert.ok(keys(detectCallouts({ ...full, phone: null }, { spotlightCount: 1 })).includes("phone"));
});
await test("the logo note offers the three starter logos", () => {
  const c = detectCallouts({ ...full, logo_url: null }, { spotlightCount: 2 }).find(x => x.key === "logo");
  assert.equal(c.body, "You don't have a logo yet, so I made you a simple starter one. Pick from three, or send me yours (a photo of your truck works too).");
  assert.ok(!/\$\d/.test(c.body), "no price");
});
await test("notes follow the house copy rules", () => {
  for (const c of detectCallouts(thin)) assert.deepEqual(bannedWordsIn(`${c.title} ${c.body}`), [], c.key);
});

console.log("workingPoints");
await test("leads with what works, and only claims a strong rating", () => {
  const w = workingPoints(thin);
  assert.match(w[0], /tap-to-call/);
  assert.ok(w.some(x => /5★ rating from 110/.test(x)));
  assert.ok(!workingPoints({ ...thin, average_rating: 4.1 }).some(x => /★/.test(x)));
});

console.log("validateContactRequest");
const M = "3f2b8c1e-9d4a-4b6e-8f1a-2c3d4e5f6a7b";
await test("email needs only a kind and slug", () => {
  const r = validateContactRequest({ kind: "email", slug: "robbins-plumbing", m: M });
  assert.equal(r.ok, true);
  assert.equal(r.m, M);
});
await test("text and book need a real 10-digit phone, normalized", () => {
  assert.equal(validateContactRequest({ kind: "text", slug: "a", phone: "555-1234" }).error, "bad_phone");
  assert.equal(validateContactRequest({ kind: "text", slug: "a", phone: "+1 (555) 010-0002" }).phone, "(555) 010-0002");
});
await test("book needs an allowed day and window", () => {
  assert.equal(validateContactRequest({ kind: "book", slug: "a", phone: "5550100002", day: "someday", window: "morning" }).error, "bad_day");
  const ok = validateContactRequest({ kind: "book", slug: "a", phone: "5550100002", day: "tomorrow", window: "evening" });
  assert.equal(ok.ok, true);
});
await test("rejects bad kinds, odd slugs, junk m, and trims notes", () => {
  assert.equal(validateContactRequest({ kind: "call", slug: "a" }).error, "bad_kind");
  assert.equal(validateContactRequest({ kind: "email", slug: "../etc" }).error, "bad_slug");
  assert.equal(validateContactRequest({ kind: "email", slug: "a", m: "x" }).m, null);
  assert.equal(validateContactRequest({ kind: "email", slug: "a", note: "x".repeat(500) }).note.length, 300);
});

console.log("buildContactAlert");
await test("book alert says when and where to call", () => {
  const a = buildContactAlert({ kind: "book", businessName: "Robbins Plumbing", city: "Gilbert", state: "AZ", phone: "(555) 010-0002", day: "tomorrow", window: "evening", slug: "robbins-plumbing" });
  assert.equal(a.subject, "Robbins Plumbing booked 10 minutes: Tomorrow, evening, at (555) 010-0002");
  assert.match(a.text, /Call them in that window/);
});
await test("text alert notes it's opt-in; notes are escaped in HTML", () => {
  const a = buildContactAlert({ kind: "text", businessName: "R", phone: "(555) 010-0002", note: "<b>hi</b>", slug: "r" });
  assert.match(a.text, /asked for it/);
  assert.doesNotMatch(a.html, /<b>hi/);
});

console.log("renderLanding");
const html = renderLanding({ ...thin, business_name: "Robbins <Plumbing>" }, { slug: "robbins-plumbing", m: M, callouts: detectCallouts(thin), working: workingPoints(thin) });
const visible = h => h.replace(/<style>[\s\S]*?<\/style>|<script[^>]*>[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ");
const at = s => html.indexOf(s);
await test("has every section in order", () => {
  const order = ["class=\"top\"", "Here's your page", "Built to be found on Google", "Your page, with my notes", "What's the catch?", "id=\"contact-h\">Talk to Jack", "<footer>"].map(at);
  order.forEach((i, n) => assert.ok(i > 0, `section ${n} missing`));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});
await test("nav: Enoma logo home, From Jack, and a small Claim my page button", () => {
  assert.match(html, /<a class="brand" href="\/"[^>]*><img src="\/brand\/enoma-wordmark-blue-notagline-cropped\.svg"/);
  assert.match(html, /<span class="from">From Jack at Enoma<\/span>/);
  assert.match(html, new RegExp(`class="top-cta" href="/robbins-plumbing\\?claim=1&amp;m=${M}"[^>]*>Claim my page<`));
});
await test("hero: headline, one-line lede, the 4 selling points and what's already on it", () => {
  assert.match(html, /<h1 id="hero-h">Here's your page, Robbins &lt;Plumbing&gt;<\/h1>/);
  assert.match(html, /A page that gets you found online and gets you the call, not a shared lead\./);
  assert.equal(SELLING_POINTS.length, 4);
  for (const t of ["Built to be found on Google and AI assistants", "Tap-to-call and a quote form on every page",
    "Your leads only: no shared leads, no per-lead fees", "A real person (Jack) makes your changes for you"]) {
    assert.ok(html.includes(t), t);
  }
  assert.equal((html.match(/<span class="ic"><svg /g) || []).length, 4, "inline SVG icons");
  for (const w of workingPoints(thin)) assert.ok(html.includes(w), w);
  assert.ok(at("Your leads only") < at("Already on your page"));
});
await test("hero CTAs: claim, Text Jack, Email Jack and subscribe-now, with the right links", () => {
  const hero = html.slice(at("<section class=\"hero"), at("<section class=\"review\""));
  assert.match(hero, new RegExp(`id="cta-claim" href="/robbins-plumbing\\?claim=1&amp;m=${M}"[^>]*>Claim my page, free<`));
  assert.match(hero, /id="cta-text" type="button" data-panel="hero-text"[^>]*>Text Jack</);
  assert.match(hero, /<form class="panel" id="panel-hero-text" data-kind="text">/);
  assert.match(hero, /id="hero-text-phone"[^>]*value="\(555\) 010-0002"/);
  assert.match(hero, /id="cta-email" href="mailto:jack@enoma\.io\?subject=[^"]+"[^>]*data-email[^>]*>Email Jack</);
  assert.match(hero, new RegExp(`id="cta-subscribe" href="/robbins-plumbing\\?claim=1&amp;plan=year&amp;m=${M}"[^>]*>Or go live now: \\$1 for your first month<`));
  assert.doesNotMatch(hero, /Book 10 minutes/, "booking lives in Talk to Jack, not the hero");
});
await test("the full price line sits right next to the claim button and the $1", () => {
  const i = at("Claim my page, free");
  const j = at("$1 for your first month, then $19.99/month or $199/year. Cancel anytime. No contract.");
  assert.ok(i > 0 && j > i && j - i < 700, "price line under the hero CTAs");
  assert.match(html, /Claiming and editing your page is free, with no card\.<\/li>\s*<li>Going live is \$1 for your first month, then \$19\.99\/month or \$199\/year/);
  assert.doesNotMatch(html, /first month free|free month/i);
  assert.match(html, /\$9\.99\/month each/);
});
await test("every note renders as a numbered comment card, in order, plus a no-JS list", () => {
  const cs = detectCallouts(thin);
  const list = html.slice(at("<ol class=\"cards\" id=\"notes-list\">"), at("</aside>"));
  assert.ok(list.length > 0, "server-rendered notes list");
  cs.forEach((c, i) => {
    assert.ok(list.includes(`id="note-${i + 1}" data-key="${c.key}"`), c.key);
    assert.ok(list.includes(c.title.replace(/'/g, "&#039;")) || list.includes(c.title), c.title);
  });
  assert.equal((list.match(/Suggested change/g) || []).length, cs.length);
  assert.equal((list.match(/Jack · Enoma/g) || []).length, cs.length);
  assert.ok(at("id=\"page-frame\"") < at("id=\"notes-list\""), "list comes after the page");
  assert.match(html, /<body class="page-preview">/);
  assert.match(css, /html\.js body\.page-preview \.rail \{ display: none; \}/, "the list is only swapped out when JS runs");
  assert.match(css, /body\.page-preview \.browser iframe \{[^}]*height: 1400px/, "fixed height without JS");
});
await test("notes: bottom bar and sheet for phones, the closing line and CTA", () => {
  const n = detectCallouts(thin).length;
  assert.ok(html.includes(`Jack's notes (${n})`.replace("'", "&#039;")) || html.includes(`Jack's notes (${n})`));
  assert.match(html, /id="notes-bar" type="button"[^>]*hidden/);
  assert.match(html, /Each one is a few minutes of your time, and I do the work\.<\/p>\s*<a class="b b-primary" href="[^"]*claim=1[^"]*"[^>]*>Claim my page, free</);
});
await test("passes the anchors for each note to the page script", () => {
  const m = html.match(/var D = (\{.*?\});\n/);
  assert.ok(m, "notes data");
  const d = JSON.parse(m[1]);
  assert.deepEqual(d.notes.map(x => x.key), keys(detectCallouts(thin)));
  for (const x of d.notes) assert.deepEqual(d.anchors[x.key], CALLOUT_ANCHORS[x.key]);
});
await test("shows the price and the three contact buttons", () => {
  assert.match(html, /\$19\.99/);
  assert.match(html, /\$1 for your first month/);
  assert.match(html, /Email me/);
  assert.match(html, /Text me/);
  assert.match(html, /Book 10 minutes/);
  assert.match(html, /<form class="panel" id="panel-text" data-kind="text">/);
  assert.match(html, /<form class="panel" id="panel-book" data-kind="book">/);
});
await test("embeds the page without logging a page view, and keeps m on claim", () => {
  assert.match(html, /src="\/robbins-plumbing\?embed=1"/);
  assert.match(html, new RegExp(`robbins-plumbing\\?claim=1&amp;m=${M}`));
  assert.match(html, /<span class="url">enoma\.io\/robbins-plumbing<\/span>/);
});
await test("escapes the business name and stays out of search", () => {
  assert.doesNotMatch(html, /Robbins <Plumbing>/);
  assert.match(html, /<meta name="robots" content="noindex,nofollow">/);
});
await test("no new external scripts or fonts", () => {
  const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map(x => x[1]);
  assert.deepEqual(scripts, ["/scripts/funnel-track.js"]);
  const sheets = [...html.matchAll(/<link[^>]*href="([^"]+)"[^>]*rel="stylesheet"|<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)];
  assert.deepEqual(sheets.map(x => x[1] || x[2]).map(h => /fonts\.googleapis\.com/.test(h) ? "fonts" : h), ["fonts", "/styles/enoma.css"]);
  assert.match(html, /family=Fraunces[^"]*family=Instrument\+Sans[^"]*family=IBM\+Plex\+Mono/);
  assert.doesNotMatch(html, /<style/);
});
await test("tracking: CTA taps and comment views go to the funnel allowlist", async () => {
  const { FUNNEL_EVENTS } = await import("../api/_lib/tracking.js");
  for (const e of ["landing_comment_seen", "landing_cta_click", "preview_shown"]) {
    assert.ok(FUNNEL_EVENTS.has(e), `${e} allowlisted`);
    assert.ok(html.includes(`"${e}"`), `${e} sent`);
  }
  for (const cta of ["claim", "text", "email", "subscribe", "book"]) assert.ok(html.includes(`data-cta="${cta}"`), cta);
  assert.match(html, /cta: "marker"/);
  // Jack's devices are sent and tagged internal (not dropped): the landing
  // view carries the flag, funnel events go through funnel-track.js.
  assert.match(html, /event: "landing_view", internal: isInternal\(\) \|\| undefined/);
  assert.ok(html.includes('track("preview_shown"'), "preview_shown sent");
  assert.match(html, /if \(ctx\.m\) meta\.m = ctx\.m;/);
  assert.match(html, /if \(ctx\.src\) meta\.src = ctx\.src;/);
});
await test("markers are labelled buttons; reduced motion turns off pulse and smooth scroll", () => {
  assert.match(html, /mk\.setAttribute\("aria-label", "Note " \+ note\.n \+ ": " \+ note\.title\)/);
  assert.match(html, /prefers-reduced-motion: reduce/);
  assert.match(html, /still\.matches \? "auto" : "smooth"/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\) \{\s*body\.page-preview \.card\.is-pulse \{ animation: none; \}/);
});
await test("page copy follows the house copy rules", () => {
  assert.deepEqual(bannedWordsIn(visible(html)), []);
});

await test("no copy says the page was built from the Google listing, and names no customer", () => {
  assert.doesNotMatch(html, /Google listing/);
  assert.doesNotMatch(html, /I built this/);
  assert.doesNotMatch(html, /conway/i);
  for (const c of detectCallouts(thin)) assert.doesNotMatch(c.body, /Google listing/, c.key);
  for (const w of workingPoints({ ...thin, website: "https://x" })) assert.doesNotMatch(w, /Google listing/);
});

console.log("CALLOUT_ANCHORS");
await test("has an anchor for every key detectCallouts can return", () => {
  const src = readFileSync(new URL("../api/_lib/preview-landing.js", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("export function detectCallouts"), src.indexOf("export function workingPoints"));
  const declared = [...body.matchAll(/key: "([a-z_]+)"/g)].map(x => x[1]);
  assert.ok(declared.length >= 9, "found the keys");
  const seen = new Set([...keys(detectCallouts(thin)), ...keys(detectCallouts({ ...full, phone: null }, { spotlightCount: 1 })),
    ...keys(detectCallouts({ ...thin, why_choose_us: ["20 years"], attachments: ["https://x/a.jpg"], testimonials: [{}, {}, {}, {}, {}, {}, {}, {}, {}, {}], review_count: 10, logo_url: "x", phone: null }))]);
  for (const k of new Set([...declared, ...seen])) {
    assert.ok(Array.isArray(CALLOUT_ANCHORS[k]) && CALLOUT_ANCHORS[k].length, `anchor for ${k}`);
  }
});
await test("every first-choice anchor exists in public/profile.html", () => {
  const profile = readFileSync(new URL("../public/profile.html", import.meta.url), "utf8");
  for (const [k, sels] of Object.entries(CALLOUT_ANCHORS)) {
    const s = sels[0];
    const ok = s.startsWith("#") ? profile.includes(`id="${s.slice(1)}"`) : new RegExp(`class="[^"]*\\b${s.slice(1)}\\b`).test(profile);
    assert.ok(ok, `${k}: ${s}`);
  }
});

console.log("renderLanding src=instant");
const instant = renderLanding(thin, { slug: "robbins-plumbing", src: "instant", callouts: detectCallouts(thin), working: workingPoints(thin) });
await test("headline is in the visitor's voice, not Jack's greeting", () => {
  assert.match(instant, /<h1 id="hero-h">Here's your page, Robbins Plumbing<\/h1>/);
  assert.match(instant, /<span class="eyebrow">Live as a preview<\/span>/);
  assert.doesNotMatch(visible(instant), /Hi, it&#039;s Jack|Hi, it's Jack|I built/);
});
await test("cold email gets the 'Ready to go live' eyebrow", () => {
  assert.match(html, /<span class="eyebrow">Ready to go live<\/span>/);
});
await test("never mentions the Google listing", () => {
  assert.doesNotMatch(instant, /Google listing/);
});
await test("price sits with every 'free' (hero and the catch)", () => {
  assert.match(instant, /\$1 for your first month, then \$19\.99\/month or \$199\/year/);
  assert.match(instant, /\$1<\/b><span>for your first month, then \$19\.99\/month or \$199\/year\. Cancel anytime\./);
});
await test("keeps the callouts, the catch and all three contact buttons", () => {
  assert.match(instant, /class="card"/);
  assert.match(instant, /What's the catch\?/);
  for (const b of ["Email me", "Text me", "Book 10 minutes"]) assert.ok(instant.includes(b), b);
});
await test("claim links have no m; contact taps carry src=instant", () => {
  assert.match(instant, /href="\/robbins-plumbing\?claim=1"/);
  assert.match(instant, /href="\/robbins-plumbing\?claim=1&amp;plan=year"/);
  assert.match(instant, /var ctx = \{"slug":"robbins-plumbing","m":null,"src":"instant"\}/);
});
await test("a cold-email visit with m stays a cold-email visit", () => {
  const cold = renderLanding(thin, { slug: "robbins-plumbing", m: M, src: "instant", callouts: [], working: [] });
  assert.match(cold, /Ready to go live/);
  assert.match(cold, /"src":null/);
});
await test("instant copy follows the house copy rules", () => {
  assert.deepEqual(bannedWordsIn(visible(instant)), []);
});

console.log("plan intent (subscribe now -> claim -> dashboard)");
await test("the claim page saves ?plan= and the plan picker preselects it", async () => {
  const profileJs = readFileSync(new URL("../public/scripts/profile.js", import.meta.url), "utf8");
  assert.match(profileJs, /sessionStorage\.setItem\('enoma_plan_intent', planIntent\)/);
  const vm = await import("node:vm");
  const src = readFileSync(new URL("../public/scripts/plan-picker.js", import.meta.url), "utf8");
  const ctx = { window: {} };
  vm.runInNewContext(src, ctx);
  const store = v => ({ getItem: () => v });
  const { planIntent } = ctx.window.EnomaPlanPicker;
  assert.equal(planIntent(store("year")), "year");
  assert.equal(planIntent(store("month")), "month");
  assert.equal(planIntent(store("lifetime")), null);
  assert.equal(planIntent(store(null)), null);
  assert.equal(planIntent({ getItem() { throw new Error("blocked"); } }), null);
});

console.log("landingSource / instantPreviewPath");
await test("only 'instant' without a valid m counts", () => {
  assert.equal(landingSource({ src: "instant" }), "instant");
  assert.equal(landingSource({ src: "instant", m: M }), null);
  assert.equal(landingSource({ src: "instant", m: "junk" }), "instant");
  assert.equal(landingSource({ src: "<script>" }), null);
  assert.equal(landingSource({}), null);
});
await test("redirect target is the preview landing with src=instant", () => {
  assert.equal(instantPreviewPath("robbins-plumbing"), "/robbins-plumbing/preview?src=instant");
});
await test("contact requests keep src=instant only without m, and the alert says so", () => {
  const r = validateContactRequest({ kind: "email", slug: "robbins-plumbing", src: "instant" });
  assert.equal(r.ok, true);
  assert.equal(r.m, null);
  assert.equal(r.src, "instant");
  assert.equal(validateContactRequest({ kind: "email", slug: "a", m: M, src: "instant" }).src, null);
  const a = buildContactAlert({ ...r, businessName: "Robbins Plumbing" });
  assert.match(a.text, /src=instant/);
  assert.doesNotMatch(buildContactAlert({ kind: "email", slug: "r" }).text, /src=instant/);
});

console.log("/get-your-website copy");
const gyw = readFileSync(new URL("../public/get-your-website.html", import.meta.url), "utf8");
await test("sends a built instant preview to the landing, using the same path", () => {
  assert.ok(gyw.includes("'/' + encodeURIComponent(data.slug) + '/preview?src=instant'"));
  assert.ok(!gyw.includes("'?new=1'"));
  assert.equal(instantPreviewPath("x"), "/" + "x" + "/preview?src=instant");
});
await test("names no customer and has no example iframe", () => {
  assert.doesNotMatch(gyw, /conway/i);
  assert.doesNotMatch(gyw, /browser-mini/);
});
await test("no 'from your listing' copy, one speed claim", () => {
  assert.doesNotMatch(gyw, /from your (Google )?listing/i);
  assert.doesNotMatch(gyw, /under 5 minutes|20 seconds/);
  assert.match(gyw, /Type in your business name and see your page in about 30 seconds/);
  assert.match(gyw, /Not on Google yet, or your info is out of date\? I'll build it with you\./);
});
await test("the full price line shows in the form header, next to the free preview", () => {
  assert.match(gyw, /Free to see your page, no card · \$1 for your first month, then \$19\.99\/month or \$199\/year\. Cancel anytime\./);
});
await test("logs place_search_used once per page", () => {
  assert.equal((gyw.match(/enomaTrack\('place_search_used'/g) || []).length, 1);
  assert.match(gyw, /if \(!searchLogged\) \{ searchLogged = true;/);
});

console.log(`\n${passed} passed`);
