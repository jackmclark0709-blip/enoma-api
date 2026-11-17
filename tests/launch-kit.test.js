// Run with: node tests/launch-kit.test.js (also wired into `npm test`)
// Page v2 PR 3, the launch kit: caption lint (banned words, no prices unless
// the owner gave them, no invented claims), real facts only on the images,
// the "Preview" watermark on everything shown before the $1 claim, downloads
// only after it, storage split (clean files private), freshness, the QR card
// PDF, the one outreach line, and the brand kit keeping the launch kit.

import assert from "node:assert/strict";
import fs from "node:fs";
import {
  piecesFor, seasonFor, seasonalTopic, specialtyHeadline, scanLine, kitTowns, townsLine, pageUrlFor, qrTarget,
  itemIds, launchKitFingerprint, launchKitFresh, captionPrompt, captionFlags, fallbackCaptions, finalizeCaptions,
  ownerPrices, launchKitView, OUTREACH_LINE, COVER, LAUNCH_KIT_VERSION,
} from "../api/_lib/launch-kit.js";
import { treeFor, hasWatermark, watermarkLayer, qrSvg, sizeFor } from "../api/_lib/launch-kit-art.js";
import {
  jpegToPdf, generateLaunchKit, renderLaunchKitImages, ownPath, signedDownloadUrl, captionsFor, buildInFlight,
  PREVIEW_BUCKET, FILE_BUCKET, CREATION_BUILDS_PER_RUN, takeCreationBuild,
} from "../api/_lib/launch-kit-render.js";
import { renderLaunchKitPage, kitHref, ownerBarKitStrip } from "../api/_lib/launch-kit-page.js";
import { lintCaption } from "../api/_lib/copy-lint.js";
import { deriveKit, buildBrandKit } from "../api/_lib/brand-kit.js";
import { renderBlocksV2 } from "../api/_lib/page-v2.js";
import { buildOutreachEmail } from "../api/_lib/outreach-email.js";
import { buildOutreachEmailB } from "../api/_lib/outreach-variant-b.js";
import { buildTextMessage } from "../api/_lib/text-outreach.js";
import { FUNNEL_EVENTS } from "../api/_lib/tracking.js";

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { console.error(`  FAIL - ${name}`); console.error(err); process.exitCode = 1; }
}
const read = rel => fs.readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const offline = async () => { throw new Error("offline in tests"); };

// Let It Roll Painting (Ewing, NJ), as its page reads today.
const PAINTER = {
  business_id: "c44cca15-6d3f-479d-9179-2c723c081b0f", username: "let-it-roll-painting", business_name: "Let It Roll Painting",
  city: "Ewing", state: "NJ", phone: "(732) 948-4046", primary_category: "painter", page_version: 2, is_claimed: false, is_public: true,
  service_area: ["Ewing"], offers_free_estimates: null,
  trust_badges: ["Licensed & Insured", "20+ Years Experience", "Free Estimates", "American Owned & Operated"],
  why_choose_us: ["More than 20 years of experience", "Specialists in cathedral and high ceilings", "No job too small"],
  about: "Rick and Patrick bring more than 20 years of experience to every job.",
  services: [
    { service_name: "Cathedral & High Ceiling Painting", service_description: "Vaulted, cathedral and two-story rooms." },
    { service_name: "Custom Interior Painting", service_description: "Walls, ceilings and trim." },
    { service_name: "Popcorn Ceiling Removal", service_description: "Remove textured popcorn ceilings." },
  ],
  owner_token: "abcdefghijklmnopqrstuvwx",
};
// A landscaper with a priced service and a snow service.
const LANDSCAPER = {
  business_id: "6ec4d119-4fc0-450e-8a89-27a372986903", username: "conways-landscaping", business_name: "Conway's Landscaping",
  city: "Agawam", state: "MA", phone: "(413)-896-5392", primary_category: "landscaping", page_version: 2, is_claimed: true, is_public: true,
  service_area: ["West Springfield", "Agawam", "Feeding Hills"], offers_free_estimates: true,
  services: [
    { service_name: "Mowing", service_description: "Weekly or bi-weekly mowing.", price: "From $45" },
    { service_name: "Seasonal Cleanup", service_description: "Spring and fall cleanups." },
    { service_name: "Snow Removal", service_description: "Driveways plowed after every storm." },
  ],
  owner_token: "zyxwvutsrqponmlkjihgfedc",
};
const kitOf = p => deriveKit(p, { townCoords: [] });

// ── Caption lint ──────────────────────────────────────────────────────────

await test("caption lint: banned puffery words are caught", () => {
  const kinds = lintCaption("Your trusted, reliable painters in Ewing.", {}).map(i => i.kind);
  assert.ok(kinds.includes("banned_word"));
  assert.deepEqual(lintCaption("Cathedral ceilings are our specialty. Call us.", {}), []);
});

await test("caption lint: no prices, discounts or 'per hour' unless the owner gave that exact price", () => {
  for (const t of ["Rooms from $199 this month!", "Just 150 dollars a room", "We charge $45 per hour", "Ask about our discount", "20% off fall cleanups"]) {
    assert.ok(lintCaption(t, {}).some(i => i.kind === "price"), t);
  }
  assert.deepEqual(lintCaption("Mowing From $45, every week.", { allowed_prices: ["From $45"] }), []);
  assert.ok(lintCaption("Mowing from $40, every week.", { allowed_prices: ["From $45"] }).some(i => i.kind === "price"), "only the owner's own price");
});

await test("caption lint: free estimates and years only when the business gave them; no ratings, links, phones or hashtags", () => {
  const flags = captionFlags(PAINTER, kitOf(PAINTER));
  assert.equal(flags.offers_free_estimates, false, "Let It Roll never told us 'free' (page-claims rule)");
  assert.ok(lintCaption("Call for a free estimate today.", flags).some(i => i.kind === "unsupported_claim"));
  assert.ok(lintCaption("Over 30 years of painting.", { years_in_business: null }).some(i => i.kind === "unsupported_claim"));
  assert.ok(lintCaption("Rated 5 stars by our customers.", {}).some(i => i.kind === "rating"));
  assert.ok(lintCaption("Call (732) 948-4046 now", {}).some(i => i.kind === "contact"));
  assert.ok(lintCaption("See enoma.io/let-it-roll-painting", {}).some(i => i.kind === "contact"));
  assert.ok(lintCaption("New site! #painting", {}).some(i => i.kind === "hashtag"));
});

await test("caption lint: ad copy is caught (the first live kit's real captions all fail)", () => {
  const live = [
    "Exciting news! Our new website is live! 🎉 Explore our services in Ewing, NJ, from custom interior painting to drywall repair. Visit us online to see how we can transform your space!",
    "Got cathedral or high ceilings? We've got you covered! Our team specializes in painting those hard-to-reach areas, ensuring every inch of your space looks its best. Chat with Patrick or Rick to learn more!",
    "Getting ready for holiday guests? Now's the perfect time to refresh your rooms! Let us handle the painting, so you can focus on the festivities. Reach out to Patrick or Rick to get started!",
  ];
  for (const t of live) assert.ok(lintCaption(t, {}).some(i => i.kind === "ad_copy"), t);
  for (const t of [
    "Got a cathedral ceiling nobody wants to touch? That's most of what we do. Call Rick or Patrick and we'll come take a look.",
    "Our website is up. Interior painting in Ewing, including drywall repair and popcorn ceiling removal.",
    "Holiday guests coming? We can get a room or two painted before then.",
  ]) assert.deepEqual(lintCaption(t, {}), [], t);
  assert.ok(lintCaption("Big job? No problem!! Call us.", {}).some(i => /exclamation/.test(i.message)));
});

await test("captions: the prompt asks for the owner's voice and its example names no real business", () => {
  const kit = kitOf(PAINTER);
  const prompt = captionPrompt(PAINTER, kit, piecesFor(PAINTER, kit, { month: 10 }));
  assert.match(prompt, /VOICE: the owner talking to a neighbor/);
  assert.match(prompt, /DIFFERENT business \(copy the tone, never its facts\)/);
  const example = prompt.match(/DIFFERENT business[^\n]*/)[0];
  assert.doesNotMatch(example, /Rick|Patrick|Ewing|ceiling/i, "no facts that could leak into another business's post");
});

await test("captions: kits made under the old caption rules are remade on the next visit", () => {
  const fp = launchKitFingerprint(PAINTER, kitOf(PAINTER));
  assert.equal(launchKitFresh({ version: 1, status: "ready", fingerprint: fp, items: [{}] }, fp), false);
  assert.equal(launchKitFresh({ version: LAUNCH_KIT_VERSION, status: "ready", fingerprint: fp, items: [{}] }, fp), true);
});

await test("captions: a model caption that fails the lint is replaced; contact lines are always ours", () => {
  const kit = kitOf(PAINTER), pieces = piecesFor(PAINTER, kit, { month: 10 });
  const raw = {
    post_online: "We're online! See what we do in Ewing.",
    post_specialty: "High ceilings from $299! Best painters around.",
    post_seasonal: "Get a free estimate before the holidays.",
  };
  const { captions, issues } = finalizeCaptions(raw, PAINTER, kit, pieces);
  assert.match(captions.post_online, /^We're online! See what we do in Ewing\.\n\nCall or text \(732\) 948-4046\nhttps:\/\/enoma\.io\/let-it-roll-painting$/);
  assert.doesNotMatch(captions.post_specialty, /\$|best/i);
  assert.doesNotMatch(captions.post_seasonal, /free/i);
  assert.deepEqual([...new Set(issues.map(i => i.id))].sort(), ["post_seasonal", "post_specialty"]);
});

await test("captions: the fallbacks pass the lint for every sample business and month", () => {
  for (const p of [PAINTER, LANDSCAPER]) {
    const kit = kitOf(p);
    for (let month = 0; month < 12; month++) {
      const pieces = piecesFor(p, kit, { month });
      const fb = fallbackCaptions(p, kit, pieces);
      for (const [id, t] of Object.entries(fb)) assert.deepEqual(lintCaption(t, captionFlags(p, kit)), [], `${p.username} ${id} m${month}: ${t}`);
    }
  }
});

await test("captions: the prompt carries only real facts; prices only when the owner gave them", () => {
  const pk = kitOf(PAINTER), lk = kitOf(LANDSCAPER);
  const painter = captionPrompt(PAINTER, pk, piecesFor(PAINTER, pk, { month: 10 }));
  assert.match(painter, /No prices or dollar amounts/);
  const facts = painter.slice(painter.lastIndexOf("FACTS\n"));
  assert.doesNotMatch(facts, /Prices the owner gave/);
  assert.doesNotMatch(facts, /Offers free estimates: yes/);
  assert.match(painter, /Specialty \(their own words\): Cathedral & high ceilings/);
  assert.deepEqual(ownerPrices(LANDSCAPER), ["From $45"]);
  assert.match(captionPrompt(LANDSCAPER, lk, piecesFor(LANDSCAPER, lk, { month: 3 })), /Prices the owner gave: From \$45/);
});

await test("captions: no API key or a failing model → deterministic captions (never thrown)", async () => {
  const kit = kitOf(PAINTER), pieces = piecesFor(PAINTER, kit, { month: 10 });
  const a = await captionsFor(PAINTER, kit, pieces, { apiKey: "" });
  assert.equal(a.source, "fallback");
  const b = await captionsFor(PAINTER, kit, pieces, { apiKey: "k", fetchImpl: offline, log: { warn() {} } });
  assert.equal(b.source, "fallback");
  assert.equal(Object.keys(b.captions).length, 3);
  // Cached by the prompt: the same facts never call the model twice.
  let calls = 0;
  const c = await captionsFor(PAINTER, kit, pieces, { apiKey: "k", cached: a, fetchImpl: async () => { calls++; throw new Error("no"); } });
  assert.equal(calls, 0);
  assert.equal(c.reused, true);
});

await test("captions: one gpt-4o call when the first answer is clean", async () => {
  const kit = kitOf(PAINTER), pieces = piecesFor(PAINTER, kit, { month: 10 });
  const bodies = [];
  const fetchImpl = async (url, init) => {
    bodies.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({
      post_online: "We're online. Interior painting for homes and businesses in Ewing.",
      post_specialty: "Cathedral and high ceilings are what most painters skip. They're our specialty.",
      post_seasonal: "Fresh paint before the holidays: rooms, ceilings and trim.",
    }) } }] }) };
  };
  const out = await captionsFor(PAINTER, kit, pieces, { apiKey: "k", fetchImpl });
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].model, "gpt-4o");
  assert.ok(!JSON.stringify(bodies[0]).includes("image_url"), "no vision call for captions");
  assert.equal(out.source, "gpt-4o");
});

// ── What the pictures say ─────────────────────────────────────────────────

await test("pieces: Let It Roll's specialty post, cover line and QR card use its own facts", () => {
  const kit = kitOf(PAINTER), pieces = piecesFor(PAINTER, kit, { month: 10 });
  assert.equal(kit.specialty, "Cathedral & high ceilings");
  assert.equal(specialtyHeadline(PAINTER, kit), "Cathedral & high ceilings? That's our specialty.");
  assert.equal(pieces.cover.line, "Cathedral & high ceilings · Ewing, NJ");
  assert.equal(pieces.qr_card.scan, "Scan for an estimate", "no 'free' unless the business says so");
  assert.equal(scanLine(LANDSCAPER), "Scan for a free estimate");
  assert.equal(pieces.qr_card.target, "https://enoma.io/let-it-roll-painting?utm_source=qr_card&utm_medium=print");
  assert.equal(pieces.post_specialty.sub, "Call for an estimate");
});

await test("pieces: no specialty → the first listed service, never called a specialty", () => {
  const kit = kitOf(LANDSCAPER);
  assert.equal(kit.specialty, null);
  assert.equal(specialtyHeadline(LANDSCAPER, kit), "Mowing? Give us a call.");
  assert.doesNotMatch(piecesFor(LANDSCAPER, kit).post_specialty.kicker, /specialty/i);
});

await test("pieces: towns are confirmed towns only (suggested towns never show)", () => {
  const kit = { ...kitOf(LANDSCAPER), towns: { confirmed: ["Agawam", "West Springfield"], suggested: ["Southwick", "Westfield"] } };
  const t = kitTowns(LANDSCAPER, kit);
  assert.deepEqual(t, ["Agawam", "West Springfield"]);
  assert.equal(townsLine(t), "Agawam & West Springfield");
  assert.doesNotMatch(JSON.stringify(piecesFor(LANDSCAPER, kit)), /Southwick|Westfield/);
  assert.equal(townsLine(["A", "B", "C", "D", "E"]), "A, B, C, D and nearby");
});

await test("seasons: topic by trade and month, and only for services the business lists", () => {
  assert.equal(seasonFor(11), "winter"); assert.equal(seasonFor(3), "spring"); assert.equal(seasonFor(10), "fall");
  assert.equal(seasonalTopic(PAINTER, 10).headline, "Fresh paint before the holidays.");
  assert.equal(seasonalTopic(PAINTER, 0).headline, "Cold outside? Good time to paint inside.");
  assert.equal(seasonalTopic(LANDSCAPER, 0).headline, "Snow's here. We plow.");
  const noSnow = { ...LANDSCAPER, services: [{ service_name: "Mowing" }] };
  assert.equal(seasonalTopic(noSnow, 0).headline, "Planning a winter project?", "no plow post for a crew that doesn't plow");
  assert.equal(seasonalTopic(LANDSCAPER, 3).headline, "Spring cleanup time.");
  // A painter with no exterior service gets no exterior-painting post in spring.
  assert.equal(seasonalTopic(PAINTER, 3).headline, "Fresh rooms for spring.");
});

await test("items: the round badge only without a usable logo", () => {
  assert.deepEqual(itemIds({ logo: { quality: "none" } }), ["cover", "post_online", "post_specialty", "post_seasonal", "qr_card", "badge"]);
  assert.ok(!itemIds({ logo: { quality: "usable" } }).includes("badge"));
  assert.ok(itemIds({ logo: { quality: "badge_only" } }).includes("badge"));
});

await test("page url: a connected custom domain wins", () => {
  assert.equal(pageUrlFor({ username: "x", custom_domain: "grilloplumbing.com" }), "https://grilloplumbing.com");
  assert.equal(qrTarget({ username: "x" }), "https://enoma.io/x?utm_source=qr_card&utm_medium=print");
});

// ── Watermark + unlock ────────────────────────────────────────────────────

await test("watermark: preview trees and the stamped layer carry it; clean trees never do", () => {
  const kit = kitOf(PAINTER), pieces = piecesFor(PAINTER, kit, { month: 10 });
  for (const id of itemIds(kit)) {
    assert.equal(hasWatermark(treeFor(id, PAINTER, kit, pieces)), false, `${id} clean`);
    assert.equal(hasWatermark(treeFor(id, PAINTER, kit, pieces, { watermark: true })), true, `${id} preview`);
    const { w, h } = sizeFor(id);
    const layer = watermarkLayer(w, h);
    assert.ok(hasWatermark(layer.tree));
    assert.ok(layer.left + layer.w === w && layer.top === 0, "top-right corner");
    assert.ok(layer.w <= Math.max(w, h) * 0.4, "a small mark, not a full overlay");
  }
});

await test("cover: every word sits inside the area both Facebook crops show", () => {
  const kit = kitOf(PAINTER), pieces = piecesFor(PAINTER, kit);
  const content = treeFor("cover", PAINTER, kit, pieces).props.children.find(c => c.props.style.left === COVER.safe.x0);
  assert.ok(content, "content block at the safe-area left edge");
  assert.ok(COVER.safe.x0 >= 291 && COVER.safe.x1 <= 1120, "inside both the 16:9 (left 1120px) and a centered crop");
  assert.equal(content.props.style.left + content.props.style.width, COVER.safe.x1);
});

const LK = {
  version: LAUNCH_KIT_VERSION, status: "ready", fingerprint: "f",
  items: [
    { id: "cover", w: 1702, h: 630, format: "png", preview_url: "https://cdn.example/launch-kit/b/f/cover-preview.jpg", file_path: "b/f/cover.png", thumb_path: "b/f/cover.png", caption: null },
    { id: "post_online", w: 1080, h: 1080, format: "png", preview_url: "https://cdn.example/launch-kit/b/f/post_online-preview.jpg", file_path: "b/f/post_online.png", caption: "We're online.\n\nCall or text (732) 948-4046" },
    { id: "qr_card", w: 1200, h: 1800, format: "pdf", preview_url: "https://cdn.example/launch-kit/b/f/qr_card-preview.jpg", file_path: "b/f/qr_card.pdf", thumb_path: "b/f/qr_card-thumb.png" },
  ],
};

await test("kit page before the $1 claim: watermarked previews only, no download links, one claim button", () => {
  const kit = { ...kitOf(PAINTER), launch_kit: LK };
  const html = renderLaunchKitPage(PAINTER, kit, { slug: PAINTER.username, token: PAINTER.owner_token, unlocked: false, thumbs: { cover: "https://signed.example/clean" } });
  for (const it of LK.items) assert.ok(html.includes(it.preview_url), `${it.id} preview shown`);
  assert.doesNotMatch(html, /signed\.example|dl=|b\/f\/cover\.png|qr_card\.pdf/, "no clean file or download link before the claim");
  assert.match(html, /Keep my page for \$1/);
  assert.match(html, /claim=1/);
  assert.match(html, /noindex/);
  assert.doesNotMatch(html.replace(/\$1\b/g, ""), /\$\d/, "no price other than the $1");
});

await test("kit page after the claim: clean pictures and a download button per item", () => {
  const kit = { ...kitOf(PAINTER), launch_kit: LK };
  const thumbs = { cover: "https://signed.example/cover", post_online: "https://signed.example/post", qr_card: "https://signed.example/qr" };
  const html = renderLaunchKitPage(PAINTER, kit, { slug: PAINTER.username, token: PAINTER.owner_token, unlocked: true, thumbs });
  for (const id of ["cover", "post_online", "qr_card"]) assert.ok(html.includes(`dl=${id}`), id);
  assert.doesNotMatch(html, /-preview\.jpg/, "no watermarked picture once unlocked");
  assert.doesNotMatch(html, /Keep my page for \$1/);
  assert.match(html, /Download PDF/);
});

await test("kit page: no items yet → 'making it now' and a refresh, never an empty grid", () => {
  const html = renderLaunchKitPage(PAINTER, kitOf(PAINTER), { slug: PAINTER.username, token: PAINTER.owner_token, unlocked: false });
  assert.match(html, /Making your launch kit now/);
  assert.match(html, /http-equiv="refresh"/);
});

await test("launchKitView: downloads only when unlocked", () => {
  assert.ok(launchKitView(LK, { unlocked: false }).items.every(i => i.download === null && /-preview\.jpg$/.test(i.thumb)));
  assert.ok(launchKitView(LK, { unlocked: true }).items.every(i => i.download));
});

await test("owner bar: thumbnails (watermarked previews) visible before claiming, linked to the kit", () => {
  const kit = { ...kitOf(PAINTER), launch_kit: LK };
  const blocks = renderBlocksV2(PAINTER, kit, { slug: PAINTER.username, owner: true, token: PAINTER.owner_token, launchKit: true });
  const header = blocks["{{BLOCK_HEADER}}"];
  assert.match(header, /Your launch kit \(3\)/);
  assert.ok(header.includes(LK.items[0].preview_url));
  assert.ok(header.includes(kitHref(PAINTER.username, PAINTER.owner_token).replace(/&/g, "&amp;")));
  assert.doesNotMatch(header, /b\/f\/cover\.png/, "never a clean file path");
  const visitor = renderBlocksV2(PAINTER, kit, { slug: PAINTER.username, owner: false, launchKit: true })["{{BLOCK_HEADER}}"];
  assert.doesNotMatch(visitor, /launch kit|preview\.jpg/i, "visitors never see it");
  assert.equal(ownerBarKitStrip(null, "/x"), "");
});

await test("downloads: only this business's own files are ever signed", async () => {
  assert.equal(ownPath("biz-1", "biz-1/f/cover.png"), true);
  assert.equal(ownPath("biz-1", "biz-2/f/cover.png"), false);
  assert.equal(ownPath("biz-1", "biz-1/../biz-2/cover.png"), false);
  let asked = null;
  const sb = { storage: { from: b => ({ createSignedUrl: async (path, secs, opts) => { asked = { b, path, secs, opts }; return { data: { signedUrl: "https://signed/x" } }; } }) } };
  assert.equal(await signedDownloadUrl(sb, "s", { id: "cover", file_path: "biz-2/f/cover.png" }, "biz-1"), null);
  assert.equal(asked, null);
  assert.equal(await signedDownloadUrl(sb, "let-it-roll-painting", { id: "cover", format: "png", file_path: "biz-1/f/cover.png" }, "biz-1"), "https://signed/x");
  assert.equal(asked.b, FILE_BUCKET);
  assert.ok(asked.secs <= 600);
  assert.equal(asked.opts.download, "let-it-roll-painting-facebook-cover.png");
});

// ── Rendering + storage (real satori + sharp, default font, no network) ───

function fakeSupabase(profile) {
  const uploads = [];
  const row = { ...profile };
  return {
    uploads, row,
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { brand_kit: row.brand_kit } }) }) }),
      update: patch => ({ eq: async () => { Object.assign(row, patch); return { error: null }; } }),
    }),
    storage: { from: bucket => ({
      upload: async (path, buf, opts) => { uploads.push({ bucket, path, buf, type: opts.contentType }); return { error: null }; },
      getPublicUrl: path => ({ data: { publicUrl: `https://storage.example/${bucket}/${path}` } }),
    }) },
  };
}

const sharp = (await import("sharp")).default;
const KIT = { ...kitOf(PAINTER), built_at: "2026-11-16T00:00:00.000Z" };
const SAVED_PROFILE = { ...PAINTER, brand_kit: KIT };
const sb = fakeSupabase(SAVED_PROFILE);
const NOW = Date.parse("2026-11-16T15:00:00Z");
const built = await generateLaunchKit(SAVED_PROFILE, { supabase: sb, fetchImpl: offline, openaiKey: "", now: NOW, log: { warn() {} } });

await test("generate: every item stored, clean files private, previews public and watermarked", async () => {
  assert.equal(built.status, "ready", built.error);
  assert.deepEqual(built.items.map(i => i.id), itemIds(KIT));
  const pub = sb.uploads.filter(u => u.bucket === PREVIEW_BUCKET), priv = sb.uploads.filter(u => u.bucket === FILE_BUCKET);
  assert.ok(pub.every(u => /^launch-kit\/c44cca15-[^/]+\/[0-9a-f]{16}\/[a-z_]+-(preview|mini)\.jpg$/.test(u.path) && u.type === "image/jpeg"), "public = previews only");
  for (const u of pub.filter(x => x.path.endsWith("-mini.jpg"))) assert.ok((await sharp(u.buf).metadata()).height <= 120, "owner-bar thumbs are tiny");
  assert.ok(priv.every(u => u.path.startsWith(`${PAINTER.business_id}/`)));
  assert.ok(!pub.some(u => /\.pdf$|\.png$/.test(u.path)), "no clean file in the public bucket");
  for (const it of built.items) {
    assert.ok(ownPath(PAINTER.business_id, it.file_path), it.id);
    assert.match(it.preview_url, /^https:\/\/storage\.example\/business-images\/launch-kit\//);
  }
  // The preview's top-right corner differs from the clean file's (the ribbon); the rest doesn't.
  const clean = priv.find(u => u.path.endsWith("/post_online.png")).buf;
  const prev = pub.find(u => u.path.endsWith("/post_online-preview.jpg")).buf;
  const px = async (buf, x, y) => [...(await sharp(buf).resize(1080, 1080).extract({ left: x, top: y, width: 1, height: 1 }).raw().toBuffer())].slice(0, 3);
  const diff = (a, b) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0);
  assert.ok(diff(await px(clean, 940, 140), await px(prev, 940, 140)) > 60, "ribbon in the corner");
  assert.ok(diff(await px(clean, 300, 800), await px(prev, 300, 800)) < 30, "rest of the picture unchanged");
});

await test("generate: saved onto brand_kit.launch_kit without touching the rest of the kit", () => {
  assert.equal(sb.row.brand_kit.colors.identity, KIT.colors.identity);
  assert.equal(sb.row.brand_kit.specialty, KIT.specialty);
  assert.equal(sb.row.brand_kit.launch_kit.status, "ready");
  assert.equal(sb.row.brand_kit.launch_kit.captions.source, "fallback");
  assert.equal(sb.row.brand_kit.launch_kit.items.find(i => i.id === "post_online").caption.split("\n\n").length, 2);
});

await test("generate: fresh kit is not rebuilt; a new season, phone or logo makes it stale", async () => {
  const again = { ...SAVED_PROFILE, brand_kit: sb.row.brand_kit };
  const n = sb.uploads.length;
  await generateLaunchKit(again, { supabase: sb, fetchImpl: offline, openaiKey: "", now: NOW + 3600e3 });
  assert.equal(sb.uploads.length, n, "no work when nothing changed");
  const fp = launchKitFingerprint(again, again.brand_kit, { month: 10 });
  assert.ok(launchKitFresh(again.brand_kit.launch_kit, fp));
  assert.notEqual(launchKitFingerprint(again, again.brand_kit, { month: 0 }), fp, "winter");
  assert.notEqual(launchKitFingerprint({ ...again, phone: "(609) 555-0100" }, again.brand_kit, { month: 10 }), fp);
  assert.notEqual(launchKitFingerprint(again, { ...again.brand_kit, logo: { url: "https://x/logo.png", quality: "usable" } }, { month: 10 }), fp);
});

await test("generate: a build in flight isn't started twice; a dead one is retried", () => {
  assert.equal(buildInFlight({ status: "building", started_at: new Date(NOW - 30e3).toISOString() }, NOW), true);
  assert.equal(buildInFlight({ status: "building", started_at: new Date(NOW - 10 * 60e3).toISOString() }, NOW), false);
});

await test("generate: creation-time builds are capped per function run", () => {
  let ok = 0;
  for (let i = 0; i < 10; i++) if (takeCreationBuild()) ok++;
  assert.equal(ok, CREATION_BUILDS_PER_RUN);
});

await test("QR card: a 4x6 in PDF holding the card; the QR encodes the page", async () => {
  const pdf = sb.uploads.find(u => u.path.endsWith("/qr_card.pdf"));
  assert.equal(pdf.type, "application/pdf");
  const s = pdf.buf.toString("latin1");
  assert.match(s, /^%PDF-1\.4/);
  assert.match(s, /\/MediaBox \[0 0 288 432\]/);
  assert.match(s, /\/Width 1200 \/Height 1800/);
  assert.match(s, /\/DCTDecode/);
  assert.match(s, /%%EOF\n$/);
  const tiny = jpegToPdf(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), { pxW: 1, pxH: 1 });
  const xref = Number(tiny.toString("latin1").match(/startxref\n(\d+)/)[1]);
  assert.equal(tiny.toString("latin1").slice(xref, xref + 4), "xref", "xref offset is exact");
  assert.match(qrSvg("https://enoma.io/x"), /^<svg[^>]+viewBox="0 0 \d+ \d+"/);
});

await test("render: the badge and cover are their stated sizes", async () => {
  const kit = kitOf(PAINTER);
  const imgs = await renderLaunchKitImages(PAINTER, kit, piecesFor(PAINTER, kit, { month: 10 }), { fetchImpl: offline, sharp });
  const meta = async id => sharp(imgs.find(i => i.id === id).clean).metadata();
  assert.deepEqual([(await meta("cover")).width, (await meta("cover")).height], [1702, 630]);
  assert.deepEqual([(await meta("badge")).width, (await meta("badge")).height], [640, 640]);
  assert.deepEqual([(await meta("post_seasonal")).width, (await meta("post_seasonal")).height], [1080, 1080]);
});

// ── Brand kit, outreach, events, CSS ──────────────────────────────────────

await test("brand kit rebuilds keep the launch kit (its fingerprint decides when to remake it)", async () => {
  const prev = { ...KIT, launch_kit: { status: "ready", fingerprint: "x", items: [{ id: "cover" }] } };
  const rebuilt = await buildBrandKit({ ...PAINTER, brand_kit: prev }, { fetchImpl: offline, openaiKey: "", placesKey: "", env: {}, townCoords: [], log: { warn() {} } });
  assert.deepEqual(rebuilt.launch_kit, prev.launch_kit);
});

await test("outreach: one optional line under the link, nothing else changes", () => {
  const base = { intro: "Hi there,\n\nI built you a page.", businessName: "Let It Roll Painting", messageId: "11111111-1111-4111-8111-111111111111", slug: "let-it-roll-painting", unsubscribeUrl: "https://enoma.io/u", mailingAddress: "183 Fairway Dr, Attleboro, MA 02703" };
  const plain = buildOutreachEmail(base), withKit = buildOutreachEmail({ ...base, kitLine: OUTREACH_LINE });
  assert.equal(OUTREACH_LINE, "I also made you a Facebook cover and a few posts to go with it.");
  assert.equal(withKit.text.replace(`${OUTREACH_LINE}\n\n`, ""), plain.text);
  assert.equal(withKit.text.split(OUTREACH_LINE).length, 2);
  assert.ok(withKit.text.indexOf(OUTREACH_LINE) > withKit.text.indexOf("Here it is:"));
  assert.ok(withKit.html.includes(OUTREACH_LINE) && !plain.html.includes(OUTREACH_LINE));
  const b = buildOutreachEmailB({ ...base, kitLine: OUTREACH_LINE });
  assert.equal(b.text.split(OUTREACH_LINE).length, 2);
  assert.equal(buildOutreachEmailB(base).text, b.text.replace(`${OUTREACH_LINE}\n\n`, ""));
  const t0 = buildTextMessage({ id: "p1", businessName: "Let It Roll Painting", previewUrl: "https://enoma.io/x?o=t" });
  const t1 = buildTextMessage({ id: "p1", businessName: "Let It Roll Painting", previewUrl: "https://enoma.io/x?o=t", kitLine: OUTREACH_LINE });
  assert.equal(t1.replace(`${OUTREACH_LINE}\n\n`, ""), t0);
  assert.equal(t1.split(OUTREACH_LINE).length, 2);
});

await test("events: launch_kit_viewed and launch_kit_downloaded are known funnel events", () => {
  assert.ok(FUNNEL_EVENTS.has("launch_kit_viewed"));
  assert.ok(FUNNEL_EVENTS.has("launch_kit_downloaded"));
});

await test("routes + flags: /<slug>/kit is owner-token gated, page v2 + PAGE_LAUNCH_KIT only; get-business hides the token", () => {
  const p = read("api/p.js");
  const fn = p.slice(p.indexOf("async function serveLaunchKit"), p.indexOf("async function serveSpotlight"));
  assert.match(fn, /PAGE_LAUNCH_KIT !== "on"/);
  assert.match(fn, /isPageV2\(profile\)/);
  assert.match(fn, /ownerTokenMatches\(profile, o\)/);
  assert.match(fn, /if \(!unlocked\) return res\.redirect/);
  assert.match(fn, /private, no-store/);
  assert.match(read("api/get-business.js"), /owner_token: _ownerToken, \.\.\.publicData/);
  assert.match(read("api/ga-metrics.js"), /PAGE_LAUNCH_KIT === "on" && takeCreationBuild\(\)/);
  assert.doesNotMatch(read("vercel.json"), /launch_kit/, "no new cron");
});

await test("css: launch kit rules are scoped to the owner bar / launch-kit page", () => {
  const css = read("public/styles/business-base.css");
  const lk = css.slice(css.indexOf("16. LAUNCH KIT"));
  assert.ok(lk.length > 500);
  for (const line of lk.split("\n").filter(l => /\{/.test(l) && !/^\s*@media/.test(l))) {
    const sel = line.slice(0, line.indexOf("{"));
    assert.match(sel, /v2-owner__|launch-kit|lk-/, `scoped: ${sel.trim()}`);
  }
});

console.log(`\n${passed} passed`);
