// bulk-generate-pages.mjs
//
// Bulk-creates Enoma profile pages for a list of target businesses:
//   1. Looks up each business on Google Places (name, address, phone, category, rating, photos)
//   2. Calls the admin JSON path of api/generate-business.js to create the page (AI-generated copy)
//   3. Patches in the Places data the admin endpoint doesn't accept (address, google_place_id,
//      rating, review_count, photos) directly via Supabase, and sets is_claimed = false
//   4. Skips businesses that already have a profile (matched by google_place_id, or name+city)
//
// DOES NOT RUN AGAINST PRODUCTION UNTIL YOU RUN IT — this file just needs to exist and be
// reviewed first. See TARGET_BUSINESSES below for the placeholder list.
//
// Required env vars:
//   GOOGLE_SERVER_PLACES_KEY   - Google Places API (New) server key (same one api/google-place.js uses)
//   ADMIN_SECRET               - matches process.env.ADMIN_SECRET on the Vercel deployment
//   SUPABASE_URL               - same Supabase project as the app
//   SUPABASE_SERVICE_ROLE_KEY  - service role key (bypasses RLS, needed to set is_claimed)
// Optional:
//   ADMIN_API_BASE             - defaults to https://enoma.io

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const ADMIN_API_BASE = process.env.ADMIN_API_BASE || "https://enoma.io";
const GOOGLE_KEY = process.env.GOOGLE_SERVER_PLACES_KEY;
const ADMIN_SECRET = process.env.ADMIN_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ── PLACEHOLDER list — replace with the real 10 target businesses before running for real ──
const TARGET_BUSINESSES = [
  { name: "Example Landscaping Co", city: "Springfield", state: "MA", trade: "landscaping" },
  { name: "Example Plumbing & Heating", city: "Worcester", state: "MA", trade: "plumbing" },
  { name: "Example Electrical Services", city: "Lowell", state: "MA", trade: "electrical" },
];

function requireEnv() {
  const missing = [];
  if (!GOOGLE_KEY) missing.push("GOOGLE_SERVER_PLACES_KEY");
  if (!ADMIN_SECRET) missing.push("ADMIN_SECRET");
  if (!SUPABASE_URL) missing.push("SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (missing.length) {
    console.error(`Missing required env vars: ${missing.join(", ")}`);
    process.exit(1);
  }
}

const slugify = text =>
  String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

// Google Places "primaryType" → the trade keywords profile.html's persona system understands
const PLACE_TYPE_TO_TRADE = {
  landscaper: "landscaping",
  lawn_care: "landscaping",
  plumber: "plumbing",
  hvac_contractor: "hvac",
  electrician: "electrical",
  house_cleaning_service: "cleaning",
  general_contractor: "contractor",
  roofing_contractor: "contractor",
  painter: "contractor",
};

async function findPlace(business) {
  const textQuery = `${business.name}, ${business.city}, ${business.state}`;
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_KEY,
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.addressComponents,places.nationalPhoneNumber,places.rating,places.userRatingCount,places.primaryType,places.photos",
    },
    body: JSON.stringify({ textQuery, maxResultCount: 1 }),
  });
  if (!res.ok) throw new Error(`Places search failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  const place = data.places?.[0];
  if (!place) return null;

  const comp = (place.addressComponents || []);
  const cityComp = comp.find(c => c.types?.includes("locality"));
  const stateComp = comp.find(c => c.types?.includes("administrative_area_level_1"));

  return {
    place_id: place.id,
    name: place.displayName?.text || business.name,
    address: place.formattedAddress || null,
    city: cityComp?.longText || business.city,
    state: stateComp?.shortText || business.state,
    phone: place.nationalPhoneNumber || null,
    rating: place.rating ?? null,
    review_count: place.userRatingCount ?? null,
    trade: PLACE_TYPE_TO_TRADE[place.primaryType] || business.trade || null,
    photos: (place.photos || []).slice(0, 6),
  };
}

// Downloads Google Place photo bytes server-side and re-uploads to our own Supabase Storage
// bucket, so we never expose GOOGLE_SERVER_PLACES_KEY in a public-facing image URL.
async function uploadPlacePhotos(supabase, businessId, photos) {
  const urls = [];
  for (const [i, photo] of photos.entries()) {
    try {
      const mediaUrl = `https://places.googleapis.com/v1/${photo.name}/media?maxWidthPx=1000&key=${GOOGLE_KEY}`;
      const imgRes = await fetch(mediaUrl);
      if (!imgRes.ok) continue;
      const buffer = Buffer.from(await imgRes.arrayBuffer());
      const contentType = imgRes.headers.get("content-type") || "image/jpeg";
      const ext = contentType.includes("png") ? "png" : "jpg";
      const storagePath = `${businessId}/google-photo-${i}-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("business-images").upload(storagePath, buffer, {
        contentType,
        upsert: true,
      });
      if (error) { console.warn(`  photo upload failed: ${error.message}`); continue; }
      const { data: pub } = supabase.storage.from("business-images").getPublicUrl(storagePath);
      if (pub?.publicUrl) urls.push(pub.publicUrl);
    } catch (e) {
      console.warn(`  photo download/upload error: ${e.message}`);
    }
  }
  return urls;
}

async function findExistingProfile(supabase, place, business) {
  if (place?.place_id) {
    const { data } = await supabase
      .from("small_business_profiles")
      .select("id, username")
      .eq("google_place_id", place.place_id)
      .maybeSingle();
    if (data) return data;
  }
  const { data } = await supabase
    .from("small_business_profiles")
    .select("id, username")
    .ilike("business_name", business.name)
    .ilike("city", business.city)
    .maybeSingle();
  return data || null;
}

async function callAdminGenerate(business, place) {
  const businessName = place?.name || business.name;
  const slug = slugify(businessName);
  const payload = {
    businessName,
    slug,
    phone: place?.phone || "",
    town: place?.city || business.city,
    state: place?.state || business.state,
    trade: place?.trade || business.trade || "general contractor",
    areasServed: [place?.city || business.city],
  };
  const res = await fetch(`${ADMIN_API_BASE}/api/generate-business`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-admin-secret": ADMIN_SECRET },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    throw new Error(data.error || `generate-business failed (${res.status})`);
  }
  return data; // { success, business_id, slug, url }
}

async function run() {
  requireEnv();
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const results = { created: [], skipped: [], failed: [] };

  for (const business of TARGET_BUSINESSES) {
    const label = `${business.name} (${business.city}, ${business.state})`;
    console.log(`\n→ ${label}`);
    try {
      const place = await findPlace(business);
      if (!place) console.log("  (no Google Places match found — proceeding with input data only)");

      const existing = await findExistingProfile(supabase, place, business);
      if (existing) {
        console.log(`  SKIPPED — profile already exists (username: ${existing.username})`);
        results.skipped.push({ business: label, reason: `already exists as /${existing.username}` });
        continue;
      }

      const created = await callAdminGenerate(business, place);
      console.log(`  created page: ${created.url}`);

      let photoUrls = [];
      if (place?.photos?.length) {
        photoUrls = await uploadPlacePhotos(supabase, created.business_id, place.photos);
        console.log(`  uploaded ${photoUrls.length}/${place.photos.length} photos`);
      }

      const patch = {
        is_claimed: false,
        address: place?.address || null,
        google_place_id: place?.place_id || null,
        average_rating: place?.rating ?? null,
        review_count: place?.review_count ?? null,
      };
      if (photoUrls.length) patch.attachments = photoUrls;

      const { error: patchErr } = await supabase
        .from("small_business_profiles")
        .update(patch)
        .eq("business_id", created.business_id);
      if (patchErr) throw new Error(`Supabase patch failed: ${patchErr.message}`);

      console.log(`  is_claimed=false set, Places data patched`);
      results.created.push({ business: label, url: created.url });
    } catch (e) {
      console.error(`  FAILED — ${e.message}`);
      results.failed.push({ business: label, reason: e.message });
    }
  }

  console.log("\n" + "=".repeat(50));
  console.log("SUMMARY");
  console.log("=".repeat(50));
  console.log(`Created: ${results.created.length}`);
  results.created.forEach(r => console.log(`  ✓ ${r.business} → ${r.url}`));
  console.log(`Skipped: ${results.skipped.length}`);
  results.skipped.forEach(r => console.log(`  - ${r.business} (${r.reason})`));
  console.log(`Failed: ${results.failed.length}`);
  results.failed.forEach(r => console.log(`  ✗ ${r.business} (${r.reason})`));
}

run().catch(e => {
  console.error("Fatal error:", e);
  process.exit(1);
});
