// Run with: node tests/brand-kit.test.js (also wired into `npm test`)
// Page v2 (PR 1 of 3): brand kit color mapping and contrast, the badge
// whitelist, badge_only logos, the owner-name call button, owner-token
// gating, suggested towns never public, and the share meta per page.

import assert from "node:assert/strict";
import fs from "node:fs";
import {
  paletteFromPixels, kitColors, darkenForWhite, ctaCandidateOk, logoQuality, badgesFrom, isValidBadge,
  ownerNamesFrom, ownerCallLabel, specialtyFrom, licenseFrom, yearsFrom, townsFor, deriveKit, kitFor,
  websiteLogoCandidates, logoCandidates, wordmarkFor, heroFor, CHARCOAL, BADGE_IDS,
} from "../api/_lib/brand-kit.js";
import { renderBlocksV2, kitStyle, ogTitleFor, ogImageUrl, headlineFor, subLineFor, trustStats, estimateLabel, specialtyServiceIndex } from "../api/_lib/page-v2.js";
import { renderCompanyPage } from "../api/_lib/company-page.js";
import { ownerTokenMatches, newOwnerToken, ownerPageUrl, isOwnerTokenShape } from "../api/_lib/owner-link.js";
import { confirmTown } from "../api/_lib/owner-actions.js";
import { sceneSvg, SCENE_KEYS } from "../api/_lib/trade-scenes.js";
import { cardTree, factsLine } from "../api/_lib/og-card.js";
import { headerWordmarkSvg } from "../api/_lib/starter-logo.js";
import { contrastRatio, hexToRgb, rgbToHsl, AMBER, TEAL } from "../api/_lib/page-style.js";

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { console.error(`  FAIL - ${name}`); console.error(err); process.exitCode = 1; }
}
const read = rel => fs.readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const TEMPLATE = read("public/profile.html");
const COORDS = JSON.parse(read("data/town-coords.json")).towns;

// 64x64 RGBA "logos": [rgb, pixel count] regions, the rest transparent.
function logo(regions) {
  const data = new Uint8Array(64 * 64 * 4);
  let i = 0;
  for (const [[r, g, b], n] of regions) for (let k = 0; k < n; k++, i += 4) { data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255; }
  return data;
}
const RWB = logo([[[31, 58, 147], 1500], [[214, 40, 40], 700], [[255, 255, 255], 1200]]);    // navy, red, white
const GREEN_BROWN = logo([[[46, 125, 50], 1400], [[121, 85, 61], 800], [[250, 250, 250], 900]]);
const BLACK_GOLD = logo([[[12, 12, 12], 1600], [[212, 175, 55], 1000], [[255, 255, 255], 400]]);
const lightness = hex => rgbToHsl(hexToRgb(hex)).l;

// Every kit's colors must pass these, whatever the logo.
function assertReadable(c, label) {
  assert.ok(contrastRatio(c.identity, "#ffffff") >= 4.5, `${label}: white on identity ${c.identity}`);
  assert.ok(contrastRatio(c.cta, c.ctaText) >= 4.5, `${label}: text on CTA ${c.cta}/${c.ctaText}`);
  assert.ok(Math.abs(lightness(c.cta) - lightness(c.identity)) >= 0.25, `${label}: CTA differs from identity in lightness`);
}

// ── Colors ────────────────────────────────────────────────────────────────

await test("palette: skips white, black and grey; keeps the brand colors in order", () => {
  const p = paletteFromPixels(RWB);
  assert.equal(p.colors.length, 2);
  assert.ok(p.colors[0].share > p.colors[1].share);
  assert.deepEqual(hexToRgb(p.colors[0].hex).map(v => Math.abs(v - [31, 58, 147][hexToRgb(p.colors[0].hex).indexOf(v)]) <= 24), [true, true, true]);
  assert.equal(paletteFromPixels(logo([[[128, 128, 128], 2000], [[255, 255, 255], 500]])).colors.length, 0, "grey + white: no colors");
  assert.ok(paletteFromPixels(BLACK_GOLD).darkShare > 0.4);
});

await test("red/white/blue logo: navy identity; the logo red isn't light enough against navy, so the CTA system decides", () => {
  const c = kitColors(paletteFromPixels(RWB), { business_name: "Let It Roll Painting", primary_category: "painter" });
  assert.equal(c.source, "logo");
  const h = rgbToHsl(hexToRgb(c.identity)).h;
  assert.ok(h > 200 && h < 250, `identity is blue (${c.identity})`);
  assert.equal(ctaCandidateOk("#d62828", c.identity), false, "red vs navy: under 0.25 lightness apart");
  assert.equal(c.cta, AMBER.cta);
  assertReadable(c, "rwb");
});

await test("a logo red that passes the contrast rules can be the CTA", () => {
  // A dark navy identity and a bright coral-red: far apart in lightness, ink reads on it.
  const p = { colors: [{ hex: "#0b1f4d", share: 0.6 }, { hex: "#ff6b5e", share: 0.2 }], darkShare: 0 };
  const c = kitColors(p, {});
  assert.equal(c.cta, "#ff6b5e");
  assertReadable(c, "navy+coral");
});

await test("green/brown logo: green identity, brown accent, CTA from the CTA system (brown is too dark)", () => {
  const c = kitColors(paletteFromPixels(GREEN_BROWN), { primary_category: "landscaping" });
  const h = rgbToHsl(hexToRgb(c.identity)).h;
  assert.ok(h > 90 && h < 150, `identity is green (${c.identity})`);
  assert.ok(rgbToHsl(hexToRgb(c.accent)).h < 40, `accent is brown (${c.accent})`);
  assert.equal(c.cta, AMBER.cta);
  assertReadable(c, "green/brown");
});

await test("black/gold logo: charcoal identity, the logo gold is the CTA", () => {
  const c = kitColors(paletteFromPixels(BLACK_GOLD), { primary_category: "electrician" });
  assert.equal(c.identity, CHARCOAL);
  const g = rgbToHsl(hexToRgb(c.cta));
  assert.ok(g.h > 35 && g.h < 60, `CTA is the gold (${c.cta})`);
  assert.equal(c.ctaText, "#1a1714");
  assertReadable(c, "black/gold");
});

await test("one-color logo: the accent is a light tint of the identity, not the same color", () => {
  const c = kitColors({ colors: [{ hex: "#003060", share: 0.5 }], darkShare: 0 }, {});
  assert.notEqual(c.accent, c.identity);
  assert.ok(lightness(c.accent) > lightness(c.identity) + 0.25);
  assertReadable(c, "one-color");
});

await test("no logo: today's persona palette, identity darkened for white text", () => {
  const p = { business_name: "Anchor Property Maintenance", primary_category: "Landscaping" };
  const c = kitColors(null, p);
  assert.equal(c.source, "persona");
  assert.ok([AMBER.cta, TEAL.cta].includes(c.cta));
  assertReadable(c, "persona");
  assert.ok(contrastRatio(darkenForWhite("#f2cf5b"), "#ffffff") >= 4.5);
});

// ── Logo quality, badges, names ──────────────────────────────────────────

await test("badge_only: mascot, under 300px, or busy; usable otherwise; none without a logo", () => {
  assert.equal(logoQuality({}).quality, "none");
  assert.equal(logoQuality({ url: "https://x/l.png", width: 800, height: 400, analysis: {} }).quality, "usable");
  assert.equal(logoQuality({ url: "https://x/l.png", width: 192, height: 192, analysis: {} }).quality, "badge_only");
  assert.equal(logoQuality({ url: "https://x/l.png", width: 900, height: 900, analysis: { has_character_or_mascot: true } }).quality, "badge_only");
  assert.equal(logoQuality({ url: "https://x/l.png", width: 900, height: 900, analysis: { is_busy_or_low_res: true } }).reason, "busy_or_low_res");
});

await test("badges: only whitelisted ones, only when the text says them; nothing invented", () => {
  assert.deepEqual(badgesFrom(["LET IT ROLL", "American Owned & Operated"]), ["american_owned"]);
  assert.deepEqual(badgesFrom(["Proudly veteran-owned", "Since 1998"]), ["veteran_owned", "since_1998"]);
  assert.deepEqual(badgesFrom(["Licensed & insured", "Best painter in Ewing", "20+ years", "Proud American"]), [], "near misses aren't badges");
  assert.deepEqual(badgesFrom(["Since 2099"]), [], "a future year isn't a badge");
  assert.equal(isValidBadge("best_in_town"), false);
  const kit = deriveKit({ business_name: "X", trust_badges: ["Woman owned", "Award winning"] }, {});
  assert.deepEqual(kit.badges, ["woman_owned"]);
  for (const b of kit.badges) assert.ok(isValidBadge(b));
  assert.deepEqual(BADGE_IDS, ["american_owned", "veteran_owned", "family_owned", "woman_owned"]);
});

const LET_IT_ROLL = {
  username: "let-it-roll-painting", business_name: "Let It Roll Painting", primary_category: "painter", city: "Ewing", state: "NJ",
  phone: "(732) 948-4046", is_claimed: false, page_version: 2, business_id: "c44cca15-6d3f-479d-9179-2c723c081b0f",
  hero_headline: "Interior Painting for Cathedral & High Ceilings",
  hero_tagline: "Custom interior painting in Ewing, NJ and nearby. Call Rick or Patrick at (732) 948-4046 for a free estimate.",
  about: "Let It Roll Painting does custom interior painting.\n\nRick and Patrick bring more than 20 years of experience to every job. Jobs are kept clean and neat, and no job is too small.",
  trust_badges: ["Licensed & Insured", "20+ Years Experience", "Free Estimates", "American Owned & Operated"],
  why_choose_us: ["More than 20 years of experience", "Specialists in cathedral and high ceilings", "Fully licensed and insured (NJ HIC #13VH08800400)", "No job too small"],
  services: [
    { service_name: "Cathedral & High Ceiling Painting", service_description: "Vaulted, cathedral and two-story rooms." },
    { service_name: "Custom Interior Painting", service_description: "Walls, ceilings and trim." },
    { service_name: "Drywall & Water Damage Repair", service_description: "Repair, then paint." },
    { service_name: "Popcorn Ceiling Removal", service_description: "Ready for paint." },
  ],
  faqs: [{ q: "Are you licensed and insured?", a: "Yes. We're fully licensed and insured, NJ HIC #13VH08800400." }],
  service_area: ["Ewing"], attachments: [],
};

await test("owner names come from the business's own words; the call button uses them", () => {
  assert.deepEqual(ownerNamesFrom(LET_IT_ROLL), ["Rick", "Patrick"]);
  assert.equal(ownerCallLabel(["Rick", "Patrick"]), "Call Rick or Patrick");
  assert.equal(ownerCallLabel(["Scott"]), "Call Scott");
  assert.equal(ownerCallLabel([]), "Call us");
  assert.deepEqual(ownerNamesFrom({ business_name: "Ewing Paint", city: "Ewing", hero_tagline: "Call Ewing today. Call Us now." }), [], "town and filler words aren't names");
  assert.deepEqual(ownerNamesFrom({ owner_name: "Scott Hargrove" }), ["Scott"]);
  const html = renderBlocksV2(LET_IT_ROLL, deriveKit(LET_IT_ROLL, {}), { slug: LET_IT_ROLL.username })["{{BLOCK_HERO}}"];
  assert.match(html, /<a class="v2-cta" href="tel:7329484046" data-contact="call"><span class="v2-cta__label">[\s\S]*Call Rick or Patrick<\/span><span class="v2-cta__num">\(732\) 948-4046<\/span><\/a>/);
});

await test("specialty, license, years from existing page facts", () => {
  assert.equal(specialtyFrom(LET_IT_ROLL), "Cathedral & high ceilings");
  assert.equal(specialtyFrom({ about: "We mow lawns." }), null);
  assert.equal(specialtyFrom({ business_name: "Blue Lightning Pressure Washing", primary_category: "pressure washing service" }, { specialty_phrases: ["Pressure Washing"] }), null, "the trade isn't a specialty");
  assert.equal(specialtyFrom({ business_name: "Anchor Property Maintenance", primary_category: "Landscaping" }, { specialty_phrases: ["Property Maintenance"] }), null, "the business name isn't a specialty");
  assert.equal(specialtyFrom({}, { specialty_phrases: ["Cathedral Ceiling Specialists"] }), "Cathedral ceiling");
  assert.deepEqual(licenseFrom(LET_IT_ROLL), { number: "13VH08800400", state: "NJ", kind: "HIC", verify_url: "https://newjersey.mylicense.com/verification/" });
  assert.deepEqual(licenseFrom({ license_number: "12345", state: "Texas" }), { number: "12345", state: "TX", kind: "License", verify_url: null }, "unmapped state: number, no link");
  assert.equal(licenseFrom({ about: "Licensed and insured." }), null);
  assert.equal(yearsFrom(LET_IT_ROLL), "20+");
  assert.equal(yearsFrom({ years_in_business: 12 }), "12");
  assert.equal(yearsFrom({ about: "We have 3 trucks." }), null);
  const kit = deriveKit(LET_IT_ROLL, {});
  assert.equal(headlineFor(LET_IT_ROLL, kit), "Cathedral & high ceilings, painted right.");
  assert.equal(subLineFor(LET_IT_ROLL, kit), "Painting in Ewing, NJ · 20+ years · No job too big or too small");
  assert.equal(specialtyServiceIndex(LET_IT_ROLL.services, kit.specialty), 0);
  assert.deepEqual(trustStats(LET_IT_ROLL, kit).map(s => s.small), ["years experience", "Licensed & insured"], "free estimates only when the owner said so");
  assert.equal(estimateLabel(LET_IT_ROLL), "Get an estimate");
  assert.equal(estimateLabel({ offers_free_estimates: true }), "Get a free estimate");
});

await test("wordmark strips the trade into line 2", () => {
  assert.deepEqual(wordmarkFor(LET_IT_ROLL), { line1: "LET IT ROLL", line2: "PAINTING · EWING NJ", icon: "painting" });
  assert.deepEqual(wordmarkFor({ business_name: "Blue Lightning Pressure Washing", primary_category: "pressure washing service", city: "Texas City", state: "TX" }),
    { line1: "BLUE LIGHTNING", line2: "PRESSURE WASHING · TEXAS CITY TX", icon: "cleaning" });
  const svg = headerWordmarkSvg(wordmarkFor(LET_IT_ROLL));
  assert.match(svg, /font-weight="900" font-stretch="85%"/);
  assert.match(svg, /<circle cx="22" cy="22" r="22" fill="var\(--kit-cta\)"\/>/);
  assert.doesNotMatch(headerWordmarkSvg(wordmarkFor(LET_IT_ROLL), {}, { icon: false }), /<circle/);
});

// ── Towns ─────────────────────────────────────────────────────────────────

const ATTLEBORO = { username: "anchor-property-maintenance", business_name: "Anchor Property Maintenance", primary_category: "Landscaping",
  city: "Attleboro", state: "Massachusetts", phone: "(508) 685-5658", service_area: ["Attleboro, MA"], page_version: 2, is_claimed: false,
  services: [{ service_name: "Landscaping & Property Maintenance" }], owner_token: newOwnerToken() };

await test("towns: confirmed is what we know; suggested are nearby (≤12 mi), never confirmed ones", () => {
  const t = townsFor(ATTLEBORO, COORDS);
  assert.deepEqual(t.confirmed, ["Attleboro"]);
  assert.ok(t.suggested.length > 0 && t.suggested.length <= 6);
  assert.ok(!t.suggested.includes("Attleboro"));
  assert.ok(t.suggested.includes("North Attleborough") || t.suggested.includes("Seekonk"));
  assert.ok(!t.suggested.includes("Worcester"), "Worcester is ~35 miles away");
  assert.deepEqual(townsFor({ city: "Nowhere", state: "ZZ" }, COORDS).suggested, []);
});

await test("suggested towns never render publicly; only the owner bar shows them", () => {
  const kit = deriveKit(ATTLEBORO, { townCoords: COORDS });
  const sug = kit.towns.suggested[0];
  const visitor = Object.values(renderBlocksV2(ATTLEBORO, kit, { slug: ATTLEBORO.username })).join("\n");
  assert.ok(!visitor.includes(sug), `visitor page must not mention ${sug}`);
  const owner = renderBlocksV2(ATTLEBORO, kit, { slug: ATTLEBORO.username, owner: true, token: ATTLEBORO.owner_token });
  const all = Object.values(owner).join("\n");
  const bar = all.slice(all.indexOf('id="ownerBar"'), all.indexOf("</script>", all.indexOf('id="ownerBar"')));
  assert.ok(bar.includes(`data-town="${sug}"`), "owner bar offers it");
  assert.equal(all.split(sug).length - 1, bar.split(sug).length - 1, "and nowhere else on the owner's page");
  // Schema (areaServed) and towns section stay confirmed-only too.
  const html = renderCompanyPage(TEMPLATE, ATTLEBORO, { slug: ATTLEBORO.username, blocks: renderBlocksV2(ATTLEBORO, kit, { slug: ATTLEBORO.username }) });
  assert.ok(!html.includes(sug));
});

await test("confirming a town moves only a suggested town into the service area", () => {
  const kit = deriveKit(ATTLEBORO, { townCoords: COORDS });
  const sug = kit.towns.suggested[0];
  const next = confirmTown({ ...ATTLEBORO, brand_kit: kit }, sug.toUpperCase());
  assert.deepEqual(next.service_area, ["Attleboro, MA", sug]);
  assert.ok(next.brand_kit.towns.confirmed.includes(sug));
  assert.ok(!next.brand_kit.towns.suggested.includes(sug));
  assert.equal(confirmTown({ ...ATTLEBORO, brand_kit: kit }, "Paris").error, "not_suggested");
});

// ── Owner token ───────────────────────────────────────────────────────────

await test("owner token: unguessable, constant-time match, and the bar only with a valid one", () => {
  const t = newOwnerToken();
  assert.ok(isOwnerTokenShape(t) && t !== newOwnerToken());
  assert.equal(ownerTokenMatches({ owner_token: t }, t), true);
  assert.equal(ownerTokenMatches({ owner_token: t }, t.slice(0, -1) + (t.endsWith("A") ? "B" : "A")), false);
  assert.equal(ownerTokenMatches({ owner_token: null }, ""), false, "no stored token: nobody is the owner");
  assert.equal(ownerTokenMatches({ owner_token: t }, undefined), false);
  assert.equal(ownerPageUrl("abc", t, { m: "11111111-1111-4111-8111-111111111111" }), `https://enoma.io/abc?o=${t}&m=11111111-1111-4111-8111-111111111111`);
  assert.equal(ownerPageUrl("abc", t, { m: "not-a-uuid", claim: true }), `https://enoma.io/abc?o=${t}&claim=1`);

  const kit = deriveKit(LET_IT_ROLL, {});
  const visitor = renderBlocksV2(LET_IT_ROLL, kit, { slug: LET_IT_ROLL.username })["{{BLOCK_HEADER}}"];
  assert.doesNotMatch(visitor, /ownerBar|Keep it for \$1|Made for/);
  const noToken = renderBlocksV2(LET_IT_ROLL, kit, { slug: LET_IT_ROLL.username, owner: true, token: null })["{{BLOCK_HEADER}}"];
  assert.doesNotMatch(noToken, /ownerBar/);
  const owner = renderBlocksV2(LET_IT_ROLL, kit, { slug: LET_IT_ROLL.username, owner: true, token: t, m: "11111111-1111-4111-8111-111111111111" })["{{BLOCK_HEADER}}"];
  assert.match(owner, /Made for <b>Let It Roll Painting<\/b> by Jack/);
  assert.match(owner, new RegExp(`<a class="v2-owner__keep" href="/let-it-roll-painting\\?o=${t}&amp;m=11111111-1111-4111-8111-111111111111&amp;claim=1"`));
  assert.doesNotMatch(owner, /launch kit/, "launch kit link waits for PR 3 (PAGE_LAUNCH_KIT=on)");
  assert.match(renderBlocksV2(LET_IT_ROLL, kit, { slug: LET_IT_ROLL.username, owner: true, token: t, launchKit: true })["{{BLOCK_HEADER}}"], /Your launch kit \(3\)/);
});

await test("no photos: visitors see no work section; the owner sees one specific ask", () => {
  const kit = deriveKit(LET_IT_ROLL, {});
  assert.equal(renderBlocksV2(LET_IT_ROLL, kit, { slug: "x" })["{{BLOCK_WORK}}"], "");
  assert.match(renderBlocksV2(LET_IT_ROLL, kit, { slug: "x", owner: true, token: newOwnerToken() })["{{BLOCK_WORK}}"], /one wide shot of a finished high ceiling/);
  const withPhoto = { ...LET_IT_ROLL, attachments: ["https://cdn.example.com/job.jpg"], attachment_kinds: { "https://cdn.example.com/job.jpg": "work" } };
  const k2 = kitFor(withPhoto);
  assert.deepEqual(k2.hero, { kind: "work_photo", ref: "https://cdn.example.com/job.jpg" });
  assert.match(renderBlocksV2(withPhoto, k2, { slug: "x" })["{{BLOCK_WORK}}"], /<h2 id="workHeading" class="v2-h2">Recent work<\/h2>/);
});

await test("hero rule: owner photo, then Google work photo, then stock, then the drawn scene", () => {
  assert.deepEqual(heroFor({ primary_category: "painter" }), { kind: "scene", ref: "painting" });
  assert.deepEqual(heroFor({ primary_category: "snow removal" }), { kind: "scene", ref: "snow" });
  assert.deepEqual(heroFor({}, { googlePhotos: [{ kind: "storefront" }, { kind: "work" }] }), { kind: "work_photo", ref: "google:1" });
  assert.deepEqual(heroFor({}, { stock: { url: "https://x/s.jpg" } }), { kind: "stock", ref: { url: "https://x/s.jpg" } });
  // A stock hero (PR 2) carries Unsplash's credit, linked with UTM tags.
  const stockHtml = renderBlocksV2(LET_IT_ROLL, { ...deriveKit(LET_IT_ROLL, {}), hero: { kind: "stock", ref: {
    url: "https://images.unsplash.com/photo-1?w=1200", srcset: "a 600w", alt: "A painted ceiling", credit: { name: "Ann Lee", profileUrl: "https://unsplash.com/@ann" } } } }, { slug: "x" })["{{BLOCK_HERO}}"];
  assert.match(stockHtml, /<img src="https:\/\/images\.unsplash\.com\/photo-1\?w=1200" srcset="a 600w"/);
  assert.match(stockHtml, /Photo by <a href="https:\/\/unsplash\.com\/@ann\?utm_source=enoma&amp;utm_medium=referral"[^>]*>Ann Lee<\/a> on <a href="https:\/\/unsplash\.com\/\?utm_source=enoma&amp;utm_medium=referral"/);
  for (const k of SCENE_KEYS) {
    const css = sceneSvg(k);
    assert.match(css, /var\(--kit-identity\)/, `${k} uses the kit colors`);
    assert.doesNotMatch(css, /\{[IACD]\}/);
    assert.doesNotMatch(sceneSvg(k, { identity: "#112233", accent: "#445566", cta: "#f2a93b" }), /var\(/, `${k} as hex for the share image`);
  }
  assert.deepEqual(SCENE_KEYS.sort(), ["cleaning", "contractor", "electrical", "hvac", "landscaping", "painting", "plumbing", "snow"]);
});

// ── Logo sources ──────────────────────────────────────────────────────────

await test("logo candidates: owner, admin paste, Google, website, Outscraper; never Facebook", () => {
  const html = `<link rel="icon" sizes="32x32" href="/f32.png"><link rel="apple-touch-icon" sizes="192x192" href="/f192.png">
    <meta property="og:image" content="https://site.com/og.jpg"><img src="/img/hero.jpg"><img class="site-logo" src="/img/brand.png">`;
  assert.deepEqual(websiteLogoCandidates(html, "https://site.com/"), ["https://site.com/img/brand.png", "https://site.com/f192.png", "https://site.com/og.jpg"]);
  const c = logoCandidates({
    profile: { logo_url: "https://cdn/owner.png", admin_logo_url: "https://cdn/admin.png", website: "https://site.com/" },
    prospect: { raw: { logo: "https://lh3.googleusercontent.com/o.png" } }, websiteHtml: html, googleLogoUrl: "https://g/l.jpg",
  });
  assert.deepEqual(c.map(x => x.source), ["owner", "admin", "google", "website", "website", "website", "outscraper"]);
  assert.equal(logoCandidates({ profile: { logo_url: "https://cdn/x.png", is_claimed: false } })[0].source, "profile", "an unclaimed preview's logo isn't an owner upload");
  assert.match(logoCandidates({ prospect: { raw: { logo: "https://lh5.googleusercontent.com/a/s44-p-k-no-ns-nd/photo.jpg" } } })[0].url, /\/s400-p-k-no/);
  assert.deepEqual(logoCandidates({ profile: { logo_url: "https://scontent.fbcdn.net/x.jpg" } }), []);
});

// ── Page + share meta ─────────────────────────────────────────────────────

await test("og meta per page: v2 share image + title; v1 unchanged", () => {
  const kit = deriveKit(LET_IT_ROLL, { now: Date.parse("2026-11-17T12:00:00Z") });
  assert.equal(ogTitleFor(LET_IT_ROLL, kit), "Let It Roll Painting · Cathedral & high ceilings · Ewing, NJ");
  assert.equal(ogTitleFor(ATTLEBORO, deriveKit(ATTLEBORO, {})), "Anchor Property Maintenance · Landscaping · Attleboro, MA");
  const img = ogImageUrl("https://enoma.io", LET_IT_ROLL.username, kit);
  assert.match(img, /^https:\/\/enoma\.io\/og\/let-it-roll-painting\.png\?v=[a-z0-9]+$/);
  const html = renderCompanyPage(TEMPLATE, LET_IT_ROLL, {
    slug: LET_IT_ROLL.username, blocks: renderBlocksV2(LET_IT_ROLL, kit, { slug: LET_IT_ROLL.username }),
    head: { "{{FINAL_TITLE}}": "Let It Roll Painting — Interior Painting in Ewing, NJ", "{{OG_TITLE}}": ogTitleFor(LET_IT_ROLL, kit), "{{FINAL_OG_IMAGE}}": img, "{{BRAND_COLOR_STYLE}}": kitStyle(kit) },
  });
  assert.ok(html.includes(`<meta property="og:image" content="${img}" />`));
  assert.ok(html.includes(`<meta name="twitter:image" content="${img}" />`));
  assert.ok(html.includes('<meta property="og:title" content="Let It Roll Painting · Cathedral & high ceilings · Ewing, NJ" />'));
  assert.ok(html.includes("<title>Let It Roll Painting — Interior Painting in Ewing, NJ</title>"));
  assert.ok(html.includes("--kit-identity: "));
  assert.ok(!html.includes("{{OG_TITLE}}") && !html.includes("{{V2_HEAD}}"), "the v2 slots are filled");
  // v1: og:title is still the page title, and no v2 head lines.
  const v1 = renderCompanyPage(TEMPLATE, { ...LET_IT_ROLL, page_version: 1 }, { slug: "x", head: { "{{FINAL_TITLE}}": "T1" } });
  assert.ok(v1.includes('<meta property="og:title" content="T1" />'));
  assert.doesNotMatch(v1, /page-v2|v2-hero|ownerBar|Archivo:wdth,wght@75/);
});

await test("v2 page: real links and buttons, kit colors readable, the flag band only for American/Veteran owned", () => {
  const kit = deriveKit(LET_IT_ROLL, {});
  const b = renderBlocksV2(LET_IT_ROLL, kit, { slug: LET_IT_ROLL.username });
  assert.match(b["{{BLOCK_HEADER}}"], /class="v2-flag"/);
  assert.match(b["{{BLOCK_HEADER}}"], /<a class="v2-callicon" href="tel:7329484046"/);
  assert.match(b["{{BLOCK_HERO}}"], /<p class="v2-chip">American Owned &amp; Operated<\/p>/);
  assert.match(b["{{BLOCK_TRUST}}"], /NJ HIC #13VH08800400 · <a href="https:\/\/newjersey\.mylicense\.com\/verification\/" target="_blank" rel="noopener">Verify it with the state/);
  assert.match(b["{{BLOCK_TRUST}}"], /You'll talk to the guys doing the work\./);
  assert.match(b["{{BLOCK_SERVICES}}"], /<a class="v2-feature" href="#quote\?service=cathedral-and-high-ceiling-painting"/);
  assert.match(b["{{BLOCK_MOBILE_BAR}}"], /Call<\/a>[\s\S]*Text<\/a>[\s\S]*Estimate<\/a>/);
  const plain = renderBlocksV2(ATTLEBORO, deriveKit(ATTLEBORO, {}), { slug: "a" });
  assert.match(plain["{{BLOCK_HEADER}}"], /class="v2-rule"/);
  assert.doesNotMatch(plain["{{BLOCK_HEADER}}"], /v2-flag/);
  assert.equal(plain["{{BLOCK_TRUST}}"], "", "no facts, no trust card, no crew card");
  assert.doesNotMatch(Object.values(plain).join(""), /href="#"/, "no dead links");
  // Services dropdown links to Service Spotlight pages when there are some.
  const withSpot = renderBlocksV2(LET_IT_ROLL, kit, { slug: "let-it-roll-painting", spotlights: [{ service_slug: "popcorn-ceiling-removal", service_name: "Popcorn Ceiling Removal" }] });
  assert.match(withSpot["{{BLOCK_HEADER}}"], /<details class="v2-nav__drop"><summary>Services<\/summary>[\s\S]*href="\/let-it-roll-painting\/popcorn-ceiling-removal"/);
});

await test("share card: wordmark, H1, facts line, phone frame; literal colors only", () => {
  const kit = deriveKit(LET_IT_ROLL, {});
  assert.equal(factsLine(LET_IT_ROLL, kit), "Ewing, NJ · 20+ years · (732) 948-4046");
  const tree = JSON.stringify(cardTree(LET_IT_ROLL, kit));
  assert.ok(tree.includes("Cathedral & high ceilings, painted right."));
  assert.ok(tree.includes("Call Rick or Patrick"));
  assert.ok(tree.includes("rotate(6deg)"));
  assert.doesNotMatch(tree, /var\(--/, "satori can't read CSS variables");
});

await test("css: v2 rules are scoped to the v2 classes and read only --kit-* / neutral tokens for color", () => {
  const css = read("public/styles/business-base.css");
  const v2 = css.slice(css.indexOf("15. PAGE V2"));
  assert.ok(v2.length > 1000);
  for (const line of v2.split("\n").filter(l => /\{/.test(l) && !/^\s*@media/.test(l))) {
    const sel = line.slice(0, line.indexOf("{"));
    assert.match(sel, /v2|page-v2/, `scoped: ${sel.trim()}`);
  }
  assert.doesNotMatch(v2, /var\(--brand-/, "v2 styles use --kit-* tokens");
});

console.log(`\n${passed} passed`);
