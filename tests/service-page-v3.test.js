// Run with: node tests/service-page-v3.test.js (also wired into `npm test`)
// Website v3 PR C (api/_lib/service-page-v3.js): page_copy_v3.service_page
// becomes one auto service_spotlights row; auto drafts skip the 13-question
// gap check; at most one per business; the page renders in the v3 shell;
// home card + menu link to it; noindex until it's published on a live site;
// the owner approves it (or picks another service) from the owner bar.

import assert from "node:assert/strict";
import fs from "node:fs";
import {
  autoServicePageRow, autoPagePlan, syncAutoServicePage, evidenceUsed, renderServicePageV3, servicePageV3Parts,
  servicePageRobots, servicePageAskHtml, serviceReviews, shouldPublishAuto, publishApprovedAutoPage, AUTO_SOURCE,
} from "../api/_lib/service-page-v3.js";
import { gapCheck } from "../api/_lib/spotlight.js";
import { v3PageParts } from "../api/_lib/page-v3.js";
import { renderCompanyPage } from "../api/_lib/company-page.js";
import { kitFor } from "../api/_lib/brand-kit.js";
import { handleOwnerAction, pickableService } from "../api/_lib/owner-actions.js";

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { console.error(`  FAIL - ${name}`); console.error(err); process.exitCode = 1; }
}
const read = rel => fs.readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const clone = o => JSON.parse(JSON.stringify(o));
const TEMPLATE = read("public/profile.html");
const NOV = new Date(2026, 10, 18);
const TOK = "abcdefghijklmnopqrstuvwx"; // owner-link token shape (24 chars)
const COORDS = [["North Attleborough", "MA", 41.972, -71.33], ["Plainville", "MA", 42.004, -71.333], ["Attleboro", "MA", 41.931, -71.295]];

const SERVICE_PAGE = {
  service_name: "Backed-up drains and sewer lines", slug: "backed-up-drains-and-sewer-lines",
  headline: "Drains running again, the same visit",
  intro: "When the kitchen sink or the basement drain backs up, Matt comes out, finds the clog and clears it.",
  signs: ["Water pooling in the basement floor drain", "Gurgling when the toilet flushes"],
  what_we_do: ["Clear the line with a snake", "Show you what caused it"],
  review_ids: ["r2"], faqs: [{ q: "Do you clear main sewer lines?", a: "Yes, from the cleanout.", evidence: ["r2"] }], evidence: ["r2", "o.service_for_page"],
};
function arno(withPage = true) {
  const a = JSON.parse(read("tests/fixtures/page-v3/arno.json"));
  if (withPage) a.page_copy_v3.service_page = clone(SERVICE_PAGE);
  a.fact_sheet.owner = { ...(a.fact_sheet.owner || {}), service_for_page: "Backed-up drains and sewer lines" };
  return a;
}
const autoSpot = (over = {}) => ({ ...autoServicePageRow(arno().page_copy_v3, arno().fact_sheet, arno()), id: "s1", ...over });

function fakeSupabase(tables) {
  class Q {
    constructor(n) { this.n = n; this.f = []; this.op = "select"; }
    select() { return this; } order() { return this; }
    eq(k, v) { this.f.push(r => r[k] === v); return this; }
    neq(k, v) { this.f.push(r => r[k] !== v); return this; }
    in(k, vs) { this.f.push(r => vs.includes(r[k])); return this; }
    insert(row) { this.op = "insert"; this.row = row; return this; }
    update(p) { this.op = "update"; this.patch = p; return this; }
    rows() { return (tables[this.n] ||= []).filter(r => this.f.every(f => f(r))); }
    maybeSingle() { const r = this.rows()[0]; return Promise.resolve({ data: r ? clone(r) : null, error: null }); }
    then(ok, fail) {
      if (this.op === "insert") {
        // the partial unique index: one auto row per business
        if (this.row.source === AUTO_SOURCE && tables[this.n].some(r => r.business_id === this.row.business_id && r.source === AUTO_SOURCE)) {
          return Promise.resolve({ data: null, error: { message: "duplicate key value violates unique constraint service_spotlights_one_auto_per_business" } }).then(ok, fail);
        }
        tables[this.n].push({ id: `id${tables[this.n].length + 1}`, ...clone(this.row) });
        return Promise.resolve({ data: null, error: null }).then(ok, fail);
      }
      if (this.op === "update") { for (const r of this.rows()) Object.assign(r, this.patch); return Promise.resolve({ data: null, error: null }).then(ok, fail); }
      return Promise.resolve({ data: this.rows().map(clone), error: null }).then(ok, fail);
    }
  }
  return { from: n => new Q(n) };
}
function fakeRes() { return { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } }; }

// ── C1: the row ──────────────────────────────────────────────────────────

await test("service_page → an auto draft: content from the copy, intake = the evidence it used", () => {
  const a = arno();
  const row = autoServicePageRow(a.page_copy_v3, a.fact_sheet, a);
  assert.equal(row.source, "auto");
  assert.equal(row.status, "draft");
  assert.equal(row.service_slug, "backed-up-drains-and-sewer-lines");
  assert.equal(row.content.service_name, SERVICE_PAGE.service_name);
  assert.deepEqual(row.content.signs, SERVICE_PAGE.signs);
  assert.ok(row.content.hero.headline, "hero set, so the rest of the spotlight code treats it as written");
  assert.match(row.content.seo.title, /^Backed-up drains and sewer lines in North Attleborough, MA/);
  assert.deepEqual(row.intake.evidence.sort(), ["o.service_for_page", "r2"]);
  assert.equal(row.intake.reviews.length, 1);
  assert.equal(row.intake.reviews[0].id, "r2");
  assert.equal(row.intake.owner.service_for_page, "Backed-up drains and sewer lines");
  assert.equal(autoServicePageRow({ ...a.page_copy_v3, service_page: null }, a.fact_sheet), null, "no service_page: no row");
  assert.equal(autoServicePageRow({ service_page: { ...SERVICE_PAGE, intro: "" } }, a.fact_sheet), null);
});

await test("auto drafts skip the REQUIRED gap check; the manual intake page keeps it", () => {
  const manual = gapCheck({});
  assert.equal(manual.ready, false);
  assert.ok(manual.missing.length >= 10, "the 13 questions still required for manual pages");
  const auto = gapCheck(autoSpot().intake, { source: "auto" });
  assert.equal(auto.ready, true);
  assert.deepEqual(auto.missing, []);
  assert.equal(gapCheck({ source: "auto" }).ready, false, "the intake can't claim to be auto");
});

await test("plan: insert, refresh a draft, keep approved content, replace on a new service, manual slug wins", () => {
  const next = autoServicePageRow(arno().page_copy_v3, arno().fact_sheet);
  assert.equal(autoPagePlan(next, null).op, "insert");
  assert.equal(autoPagePlan(next, { service_slug: next.service_slug, status: "draft" }).op, "update");
  assert.equal(autoPagePlan(next, { service_slug: next.service_slug, status: "draft", approved_at: "x" }).op, "none");
  assert.equal(autoPagePlan(next, { service_slug: next.service_slug, status: "published" }).op, "none");
  const rep = autoPagePlan(next, { service_slug: "heating", status: "published", approved_at: "x" });
  assert.equal(rep.op, "replace");
  assert.equal(rep.fields.status, "draft");
  assert.equal(rep.fields.approved_at, null, "a new service needs approving again");
  assert.equal(rep.unbill, true);
  assert.equal(autoPagePlan(next, null, { slugTaken: true }).op, "skip");
  assert.equal(autoPagePlan(null, null).op, "none");
});

await test("at most one auto service page per business", async () => {
  const tables = { service_spotlights: [] };
  const sb = fakeSupabase(tables);
  const a = arno();
  assert.equal((await syncAutoServicePage(sb, "biz", a.page_copy_v3, a.fact_sheet)).op, "insert");
  assert.equal((await syncAutoServicePage(sb, "biz", a.page_copy_v3, a.fact_sheet)).op, "update");
  const other = clone(a.page_copy_v3);
  other.service_page = { ...SERVICE_PAGE, service_name: "Heating", slug: "heating" };
  assert.equal((await syncAutoServicePage(sb, "biz", other, a.fact_sheet)).op, "replace");
  assert.equal(tables.service_spotlights.filter(r => r.source === "auto").length, 1);
  assert.equal(tables.service_spotlights[0].service_slug, "heating");
  // A manual page already on that slug: the owner's own page wins.
  const t2 = { service_spotlights: [{ id: "m", business_id: "biz", service_slug: SERVICE_PAGE.slug, source: "manual", status: "published" }] };
  assert.equal((await syncAutoServicePage(fakeSupabase(t2), "biz", a.page_copy_v3, a.fact_sheet)).op, "skip");
  assert.equal(t2.service_spotlights.length, 1);
});

// ── C2: the page ─────────────────────────────────────────────────────────

function renderService(spot, ctx = {}) {
  const a = arno();
  const kit = kitFor(a);
  const c = { slug: a.username, spotlights: [], townCoords: COORDS, stockRows: [], stockUsage: {}, now: NOV, canonical: `https://enoma.io/${a.username}/${spot.service_slug}`, ...ctx };
  const parts = servicePageV3Parts(a, kit, spot, c);
  const html = renderCompanyPage(TEMPLATE, a, { ...c, blocks: parts.blocks, schema: parts.schema, faqs: parts.faqs, head: { "{{BODY_CLASS}}": "page-v3" } });
  return { html, parts };
}

await test("the service page uses the v3 shell: top bar, header + menu, footer, phone bar", () => {
  const { html, parts } = renderService(autoSpot());
  const b = parts.blocks;
  assert.match(b["{{BLOCK_TOPBAR}}"], /class="v3-top/);
  assert.match(b["{{BLOCK_HEADER}}"], /class="v3-header"/);
  assert.match(b["{{BLOCK_FOOTER}}"], /class="v3-footer"/);
  assert.match(b["{{BLOCK_MOBILE_BAR}}"], /id="mobileCallBar"/);
  // Same header/footer HTML as the home page, apart from the links back home.
  const a = arno();
  const home = v3PageParts(a, kitFor(a), { slug: a.username, spotlights: [], townCoords: COORDS, now: NOV }).blocks;
  assert.equal(b["{{BLOCK_TOPBAR}}"], home["{{BLOCK_TOPBAR}}"]);
  assert.equal(b["{{BLOCK_MOBILE_BAR}}"], home["{{BLOCK_MOBILE_BAR}}"]);
  const nav = b["{{BLOCK_HEADER}}"].match(/<nav class="v3-nav"[\s\S]*?<\/nav>/)[0];
  assert.match(nav, /href="\/arno-plumbing-and-heating-2#reviews">Reviews/, "menu goes back to the home page's sections");
  assert.match(b["{{BLOCK_HEADER}}"], /class="v3-brand" href="\/arno-plumbing-and-heating-2"/);
  assert.doesNotMatch(html, /\{\{(BLOCK|SSR|QUOTE)_?[A-Z_]*\}\}/, "no body template slots left (head slots are p.js's)");
});

await test("service page sections: service + town H1, proof, call + estimate, what/signs, reviews, FAQ, form, link home", () => {
  const { parts } = renderService(autoSpot());
  const b = parts.blocks;
  assert.match(b["{{BLOCK_HERO}}"], /<h1[^>]*>Backed-up drains and sewer lines in North Attleborough<\/h1>/);
  assert.match(b["{{BLOCK_HERO}}"], /href="tel:/);
  assert.match(b["{{BLOCK_HERO}}"], /href="#contact"[^>]*>Get an estimate/);
  assert.match(b["{{BLOCK_PROOF}}"], /v3-proof/);
  assert.match(b["{{BLOCK_SERVICES}}"], /What we do[\s\S]*Clear the line with a snake/);
  assert.match(b["{{BLOCK_SERVICES}}"], /Signs you need it[\s\S]*Gurgling when the toilet flushes/);
  assert.match(b["{{BLOCK_REVIEWS}}"], /v3-review/);
  assert.equal((b["{{BLOCK_REVIEWS}}"].match(/<figure/g) || []).length, 1, "only the reviews about this service");
  assert.match(b["{{BLOCK_FAQ}}"], /Do you clear main sewer lines\?/);
  assert.match(b["{{BLOCK_CLOSING}}"], /Need help with backed-up drains and sewer lines in North Attleborough\?/);
  assert.match(b["{{QUOTE_FORM}}"], /data-page-type="spotlight"/, "form with this service preselected");
  assert.match(b["{{BLOCK_RESOURCES}}"], /href="\/arno-plumbing-and-heating-2"/);
  assert.equal(parts.schema["@type"], "Service");
  assert.equal(parts.schema.provider.name, "Arno Plumbing & Heating");
});

await test("photo: the service's placeholder sits behind the headline (no credit), no extra band", () => {
  const b = renderService(autoSpot()).parts.blocks;
  assert.match(b["{{BLOCK_HERO}}"], /class="v3-hero v3-hero--service has-photo"/);
  assert.match(b["{{BLOCK_HERO}}"], /<img data-v3-img src="\/stock\/[\w-]+-1600\.webp"/, "from the library, hero size");
  assert.match(b["{{BLOCK_HERO}}"], /Sample photo/);
  assert.doesNotMatch(b["{{BLOCK_HERO}}"], /unsplash|Photo by/i, "no credit line");
  assert.equal(b["{{BLOCK_WORK}}"], "", "placeholder isn't repeated as a band");
});

await test("reviews: the cited ones, else ones naming the service", () => {
  const reviews = [{ id: "r1", quote: "Fixed our boiler" }, { id: "r2", quote: "Cleared the drain fast" }];
  assert.deepEqual(serviceReviews(reviews, { review_ids: ["r1"], service_name: "Drains" }).map(r => r.id), ["r1"]);
  assert.deepEqual(serviceReviews(reviews, { review_ids: [], service_name: "Boiler repair" }).map(r => r.id), ["r1"]);
});

await test("home page: the matching service card and the menu link to the service page", () => {
  const a = arno();
  const spot = autoSpot();
  const b = v3PageParts(a, kitFor(a), { slug: a.username, spotlights: [{ service_slug: spot.service_slug, service_name: spot.content.service_name }], townCoords: COORDS, now: NOV }).blocks;
  assert.match(b["{{BLOCK_SERVICES}}"], /href="\/arno-plumbing-and-heating-2\/backed-up-drains-and-sewer-lines"[^>]*>See backed-up drains and sewer lines/);
  assert.match(b["{{BLOCK_HEADER}}"], /<a href="\/arno-plumbing-and-heating-2\/backed-up-drains-and-sewer-lines">Services<\/a>/);
  assert.match(b["{{BLOCK_FOOTER}}"], /href="\/arno-plumbing-and-heating-2\/backed-up-drains-and-sewer-lines"/);
});

await test("index rules: noindex while a draft or while the home page is a preview; indexed once both are live", () => {
  assert.equal(servicePageRobots({ status: "draft" }, true), "noindex,nofollow");
  assert.equal(servicePageRobots({ status: "draft" }, false), "noindex,nofollow");
  assert.equal(servicePageRobots({ status: "published" }, false), "noindex,nofollow");
  assert.equal(servicePageRobots({ status: "published" }, true), "index,follow");
});

// ── C3: owner approval ───────────────────────────────────────────────────

await test("owner bar ask: approve / pick a different service; approved and live states", () => {
  const spot = autoSpot();
  const ask = servicePageAskHtml("arno", spot, ["Leaks and broken pipes", "Backed-up drains and sewer lines", "Heating"]);
  assert.match(ask, /Your <a[^>]*href="\/arno\/backed-up-drains-and-sewer-lines"[^>]*>backed-up drains and sewer lines page<\/a> is ready/);
  assert.match(ask, /data-svc-approve>Approve it/);
  assert.match(ask, /Pick a different service/);
  assert.deepEqual([...ask.matchAll(/<option>([^<]+)/g)].map(m => m[1]), ["Leaks and broken pipes", "Heating"], "not the current one");
  assert.match(servicePageAskHtml("arno", { ...spot, approved_at: "2026-11-18" }), /Approved\.<\/b>[\s\S]*goes live with your website/);
  assert.match(servicePageAskHtml("arno", { ...spot, status: "published" }), /is live/);
  assert.equal(servicePageAskHtml("arno", null), "");
});

await test("pick a different service: only one of the page's own services", () => {
  const copy = arno().page_copy_v3;
  assert.equal(pickableService(copy, "heating"), "Heating");
  assert.equal(pickableService(copy, "Leaks and Broken Pipes"), "Leaks and broken pipes");
  assert.equal(pickableService(copy, "Roofing"), null);
  assert.equal(pickableService(copy, ""), null);
});

function ownerTables({ claimed = false, sub = null } = {}) {
  const a = arno();
  return {
    small_business_profiles: [{ business_id: "biz", username: "arno", page_version: 3, owner_token: TOK, is_claimed: claimed, is_public: true, page_copy_v3: a.page_copy_v3, brand_kit: {} }],
    service_spotlights: [{ ...autoSpot(), id: "s1", business_id: "biz" }],
    subscriptions: sub ? [{ business_id: "biz", ...sub }] : [],
    businesses: [{ id: "biz", is_internal: false }],
  };
}
const ownerReq = (action, body = {}) => ({ method: "POST", query: { kind: "owner", action }, body: { slug: "arno", o: TOK, ...body } });

await test("approve on a preview: approved, published later when the business goes live", async () => {
  const tables = ownerTables({ claimed: false });
  const res = fakeRes();
  await handleOwnerAction(ownerReq("approve_service_page"), res, { supabaseAdmin: fakeSupabase(tables) });
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.equal(res.body.published, false);
  assert.ok(tables.service_spotlights[0].approved_at);
  assert.equal(tables.service_spotlights[0].status, "draft");
  // The Stripe webhook on checkout: the approved page goes live with the site.
  assert.equal(shouldPublishAuto(tables.service_spotlights[0], { live: true }), true);
  assert.equal(await publishApprovedAutoPage(fakeSupabase(tables), "biz"), "s1");
  assert.equal(tables.service_spotlights[0].status, "published");
});

await test("approve on a live site: published now (first page included, no Stripe change)", async () => {
  const tables = ownerTables({ claimed: true, sub: { provider: "comped", status: "active" } });
  const res = fakeRes();
  await handleOwnerAction(ownerReq("approve_service_page"), res, { supabaseAdmin: fakeSupabase(tables) });
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.equal(res.body.published, true);
  assert.equal(tables.service_spotlights[0].status, "published");
});

await test("not approved → never published by the webhook; wrong token → 403", async () => {
  const tables = ownerTables();
  assert.equal(await publishApprovedAutoPage(fakeSupabase(tables), "biz"), null);
  assert.equal(tables.service_spotlights[0].status, "draft");
  const res = fakeRes();
  await handleOwnerAction({ ...ownerReq("approve_service_page"), body: { slug: "arno", o: "nope" } }, res, { supabaseAdmin: fakeSupabase(tables) });
  assert.equal(res.code, 403);
});

await test("pick: rejects a service that isn't on the page; needs PAGE_COPY_V3", async () => {
  let res = fakeRes();
  await handleOwnerAction(ownerReq("pick_service_page", { service: "Roofing" }), res, { supabaseAdmin: fakeSupabase(ownerTables()), env: { PAGE_COPY_V3: "on" } });
  assert.equal(res.code, 400);
  res = fakeRes();
  await handleOwnerAction(ownerReq("pick_service_page", { service: "Heating" }), res, { supabaseAdmin: fakeSupabase(ownerTables()), env: {} });
  assert.equal(res.code, 503);
});

await test("evidence: review ids from the faqs count too; unknown owner keys are skipped", () => {
  const e = evidenceUsed({ evidence: ["o.nope"], faqs: [{ evidence: ["r1"] }] }, { reviews: [{ id: "r1", text: "x" }], owner: {} });
  assert.deepEqual(e.evidence.sort(), ["o.nope", "r1"]);
  assert.deepEqual(e.owner, {});
});

console.log(`\n${passed} passed`);
