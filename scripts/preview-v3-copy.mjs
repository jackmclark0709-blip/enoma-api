#!/usr/bin/env node
// scripts/preview-v3-copy.mjs — website v3 copy, dry run.
//
//   node scripts/preview-v3-copy.mjs --slugs arno-plumbing-and-heating-2,c-ryan-asphalt-paving
//   node scripts/preview-v3-copy.mjs --slugs ... --refresh-reviews
//
// For each slug: builds the fact sheet (api/_lib/fact-sheet.js) from the
// stored profile row, its brand kit and the prospect's stored listing
// (prospects.raw), runs the v3 prompt + evidence check (api/_lib/page-copy.js
// generatePageCopyV3: one gpt-4o call, one gpt-4o-mini call) and writes
// out/v3-copy/<slug>.json. Never writes to the database.
//
// Reviews: the stored Google testimonials (up to 3, cut at ~360 characters
// when they were saved). --refresh-reviews makes at most ONE Places Details
// call per slug for up to 5 reviews in full plus hours and Google types
// (a paid Google call; off by default). No other paid calls except OpenAI.
//
// Needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_KEY (and
// GOOGLE_SERVER_PLACES_KEY with --refresh-reviews) in env or .env.

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { buildFactSheet, googleTestimonials } from "../api/_lib/fact-sheet.js";
import { generatePageCopyV3, buildPagePrompt } from "../api/_lib/page-copy.js";

const args = process.argv.slice(2);
const arg = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const slugs = String(arg("--slugs") || "").split(",").map(s => s.trim()).filter(Boolean);
const refresh = args.includes("--refresh-reviews");
const outDir = arg("--out") || path.join("out", "v3-copy");

if (!slugs.length) {
  console.error("usage: node scripts/preview-v3-copy.mjs --slugs a,b,c [--refresh-reviews] [--out dir]");
  process.exit(1);
}
for (const k of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "OPENAI_KEY"]) {
  if (!process.env[k]) { console.error(`missing ${k}`); process.exit(1); }
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// One Places Details call, only with --refresh-reviews.
async function placeDetails(placeId) {
  const key = process.env.GOOGLE_SERVER_PLACES_KEY;
  if (!placeId || !key) return null;
  const fields = "id,displayName,rating,userRatingCount,reviews,regularOpeningHours.weekdayDescriptions,types,primaryTypeDisplayName";
  const r = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": fields },
  });
  if (!r.ok) { console.warn(`  places ${r.status}`); return null; }
  return r.json();
}

fs.mkdirSync(outDir, { recursive: true });
let total = 0;
const summary = [];
for (const slug of slugs) {
  const { data: profile, error } = await supabase.from("small_business_profiles").select("*").eq("username", slug).maybeSingle();
  if (error || !profile) { console.warn(`${slug}: not found`); continue; }
  const { data: prospect } = await supabase.from("prospects").select("raw, website, trade")
    .eq("preview_business_id", profile.business_id).maybeSingle();

  const place = refresh ? await placeDetails(profile.google_place_id) : null;
  const reviews = place?.reviews?.length ? place.reviews : googleTestimonials(profile.testimonials);
  const factSheet = buildFactSheet({
    profile, place, raw: prospect?.raw || null, reviews,
    kit: profile.brand_kit || null,
    // The stored fact sheet's choice, if this row has one already.
    owner: { service_for_page: profile.fact_sheet?.owner?.service_for_page ?? null },
  });

  try {
    const { copy, usage, cost_usd } = await generatePageCopyV3(factSheet);
    total += cost_usd;
    const file = path.join(outDir, `${slug}.json`);
    fs.writeFileSync(file, JSON.stringify({ slug, reviews_source: place ? "places_refresh" : "stored_testimonials", fact_sheet: factSheet, page_copy_v3: copy, usage, cost_usd, prompt: buildPagePrompt(factSheet) }, null, 2));
    summary.push({ slug, reviews: factSheet.reviews.length, services: copy.services.length, service_page: copy.service_page?.service_name || null, removed: copy.removed.length, cost_usd });
    console.log(`${slug}: ${factSheet.reviews.length} reviews, headline "${copy.hero_headline}", ${copy.removed.length} removed, $${cost_usd} -> ${file}`);
  } catch (e) {
    console.warn(`${slug}: failed: ${e?.message || e}`);
  }
}
console.table(summary);
console.log(`total OpenAI cost: $${total.toFixed(4)} for ${summary.length} page(s)`);
