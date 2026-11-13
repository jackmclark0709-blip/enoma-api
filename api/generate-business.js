// api/generate-business.js
// CHANGES FROM PREVIOUS VERSION:
// 1. Added one-page-per-account gate (blocks repeat free AI generations)
// 2. After creating a new business, creates a 30-day trial subscription
// 3. Redirects to /website-live?slug=...&business_id=... instead of just /slug
// 4. Stamps ai_generated_at on the businesses table
// 5. Admin JSON path: x-admin-secret header bypasses auth/formidable for bulk generation

import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";
import formidable from "formidable";
import { Resend } from "resend";
import { writeNewSubscription, pricingVersionForNewSignup } from "./_lib/pricing.js";
import { attributeReferral } from "./_lib/referral.js";
import { hasLiveStripeSubscription } from "./_lib/billing.js";
import fs from "fs";
import {
  first, safeJSON, mergeUserServicePrices, normalizeServiceAreas
} from "./_lib/service-utils.js";
import { buildAdminPrompt, buildSelfServePrompt, finishGenerated, lintFlagsFor, yearsInBusinessFrom, requestCopy, factSourceText } from "./_lib/page-copy.js";
import { ownerFactsFromForm, cleanServiceExtras, cleanPhotoUrl, cleanSteps } from "./_lib/profile-fields.js";
import { mergeKinds } from "./_lib/photo-kinds.js";
import { handleSpotlight } from "./_lib/spotlight.js";
import Stripe from "stripe";
import { handleReviews } from "./_lib/reviews.js";
import { handleLogo } from "./_lib/logo-settings.js";
import { logoBrandColor, saveBrandColor } from "./_lib/logo-color.js";
import { logFunnelEvent } from "./_lib/tracking.js";
import { selfServeFirstTouch } from "./_lib/attribution.js";

const resend = new Resend(process.env.RESEND_API_KEY);

export const config = {
  api: { bodyParser: false }
};

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function logNotificationFailure(source, recipient, error, context) {
  console.error(`🚨 Notification email failed [${source}]:`, error?.message || error);
  try {
    await supabaseAdmin.from("notification_failures").insert({
      source,
      recipient,
      error: error?.message || String(error),
      context
    });
  } catch (e) {
    console.error("🚨 Also failed to record notification_failures row:", e?.message);
  }
}

const hasField = (fields, key) =>
  fields && Object.prototype.hasOwnProperty.call(fields, key);
const slugify = text =>
  String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const normalizeSeoBusinessName = name => {
  if (!name) return null;
  return String(name).replace(/['']/g, "").replace(/\s+/g, " ").trim();
};
const safeFilename = (name = "image") =>
  String(name).toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/(^-|-$)/g, "");
const isImageMimetype = (mt = "") => /^image\/(png|jpe?g|webp|gif)$/i.test(mt);
const isLogoMimetype = (mt = "") => /^image\/(png|jpe?g)$/i.test(mt);
const BUCKET = "business-images";
const toBool = v => {
  const s = String(first(v)).toLowerCase().trim();
  return s === "true" || s === "on" || s === "1" || s === "yes";
};
const normalizeCtaType = (t = "") => {
  const v = String(t).toLowerCase().trim();
  if (v === "phone") return "call";
  return v;
};
const contentTypeForExt = (ext = "") => {
  const e = String(ext).toLowerCase();
  if (e === "jpg" || e === "jpeg") return "image/jpeg";
  if (e === "png") return "image/png";
  if (e === "webp") return "image/webp";
  if (e === "gif") return "image/gif";
  return `image/${e}`;
};

const ADMIN_USER_ID = "b2f87fe4-4d1e-4038-8754-5ab64969e975";

// Enoma already fetches a business's Google rating/reviews for the published
// page (api/google-place.js) but never used that data during onboarding,
// leaving owners to hand-type testimonials even when real reviews already
// exist. This pulls up to 3 real 4-5★ reviews at generation time — only when
// the owner hasn't provided/kept any testimonials of their own, so it never
// overwrites a real person's hand-picked quotes — and tags each one
// `source: "google"` so the page can attribute it honestly instead of
// presenting it as a generic testimonial. Never fabricates: any failure
// (missing key, no reviews, API error) just falls back to an empty list.
async function fetchGoogleReviewTestimonials(placeId) {
  if (!placeId || !process.env.GOOGLE_SERVER_PLACES_KEY) return [];
  try {
    const r = await fetch(
      `https://places.googleapis.com/v1/places/${placeId}?fields=reviews`,
      {
        headers: {
          "X-Goog-Api-Key": process.env.GOOGLE_SERVER_PLACES_KEY,
          "X-Goog-FieldMask": "reviews"
        }
      }
    );
    if (!r.ok) return [];
    const data = await r.json();
    const reviews = Array.isArray(data.reviews) ? data.reviews : [];

    return reviews
      .filter(rv => Number(rv.rating) >= 4 && (rv.text?.text || rv.originalText?.text))
      .slice(0, 3)
      .map(rv => ({
        quote: String(rv.text?.text || rv.originalText?.text || "").trim(),
        author: rv.authorAttribution?.displayName || "Google review",
        rating: Number(rv.rating) || 5,
        source: "google"
      }))
      .filter(t => t.quote);
  } catch (e) {
    console.warn("⚠️ Google reviews fetch failed, falling back to no auto-testimonials:", e?.message);
    return [];
  }
}

async function generateUniqueSlug(base, supabase) {
  let slug = base;
  let i = 1;
  while (true) {
    const { data } = await supabase
      .from("small_business_profiles")
      .select("id")
      .eq("username", slug)
      .maybeSingle();
    if (!data) return slug;
    slug = `${base}-${i}`;
    i++;
  }
}

async function handleAdminGenerate(req, res) {
  const secret = req.headers["x-admin-secret"];
  if (secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Manually parse raw JSON body (bodyParser: false blocks automatic parsing)
  const body = await new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => { data += chunk; });
    req.on("end", () => {
      try { resolve(JSON.parse(data)); }
      catch (e) { reject(new Error("Invalid JSON: " + e.message)); }
    });
    req.on("error", reject);
  });

  const {
    businessName, slug: requestedSlug, phone, town, state, trade,
    ownerFirstName, services = [], areasServed = [], yearsInBusiness,
    email = "jack@enoma.io"
  } = body;

  if (!businessName || !requestedSlug) {
    return res.status(400).json({ error: "businessName and slug required" });
  }

  const baseSlug = slugify(requestedSlug);
  const slug = await generateUniqueSlug(baseSlug, supabaseAdmin);

  const { data: newBiz, error: bizErr } = await supabaseAdmin
    .from("businesses")
    .insert({ name: businessName, slug, ai_generated_at: new Date().toISOString() })
    .select("id, slug")
    .single();
  if (bizErr) throw bizErr;
  const business_id = newBiz.id;

  await supabaseAdmin.from("business_members").insert({
    user_id: ADMIN_USER_ID, business_id, role: "owner"
  });

  // pricing_version: new pages are on the $1 first month (api/_lib/pricing.js).
  await writeNewSubscription((row) => supabaseAdmin.from("subscriptions").upsert(row, { onConflict: "business_id" }), {
    business_id, provider: "stripe", plan_code: "starter",
    status: "trialing", is_trial: true,
    trial_starts_at: new Date().toISOString(),
    trial_expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    cancel_at_period_end: false,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString()
  });

  // One generator for every path (api/_lib/page-copy.js): the prompt,
  // structured output, the facts-only rules, then lint / retry / scrub.
  const adminInput = { businessName, ownerFirstName, trade, phone, town, state, areasServed, yearsInBusiness, services };
  const prompt = buildAdminPrompt(adminInput);
  const askAI = (extra = "") => requestCopy(prompt + extra, { fetchImpl: fetch });

  const generatedRaw = await askAI();
  const { generated, issues: adminIssues } = await finishGenerated(generatedRaw, {
    flags: lintFlagsFor({ offersEmergency: false, yearsInBusiness: yearsInBusinessFrom(yearsInBusiness), profile: adminInput }),
    profile: adminInput,
    source: factSourceText(adminInput),
    retry: askAI,
    log: m => console.warn(m),
  });
  if (adminIssues.length) console.warn(`copy-lint [${slug}]:`, adminIssues.map(i => i.message).join(" | "));

  const finalServices = generated.services;
  const finalFaqs = generated.faqs;
  const { error: profileErr } = await supabaseAdmin
    .from("small_business_profiles")
    .upsert({
      business_id, auth_id: ADMIN_USER_ID, username: slug,
      business_name: businessName, seo_business_name: normalizeSeoBusinessName(businessName),
      owner_name: ownerFirstName || null, email, phone: phone || null,
      city: town || null, state: state || null, primary_category: trade || null,
      service_area: areasServed,
      hero_headline: generated.hero_headline || "",
      hero_tagline: generated.hero_tagline || "",
      about: generated.about || "",
      why_choose_us: generated.why_choose_us || "",
      services_intro: generated.services_intro || "",
      seo_title: generated.seo_title || "",
      seo_description: generated.seo_description || "",
      services: finalServices, faqs: finalFaqs,
      trust_badges: generated.trust_badges,
      primary_cta_label: generated.primary_cta.label,
      primary_cta_type: "call", primary_cta_value: phone || "",
      testimonials: [], attachments: [],
      // Owner facts (migration 20261114_profile_upgrade): only what was given.
      ...(yearsInBusinessFrom(yearsInBusiness) ? { years_in_business: yearsInBusinessFrom(yearsInBusiness) } : {}),
      ...(generated.how_it_works.length ? { how_it_works: generated.how_it_works } : {}),
      is_open_now: false, accepting_clients: true, offers_emergency: false,
      is_public: true, updated_at: new Date().toISOString()
    }, { onConflict: "business_id" });
  if (profileErr) throw profileErr;

  await supabaseAdmin.from("businesses")
    .update({ name: businessName, slug, is_published: true, updated_at: new Date().toISOString() })
    .eq("id", business_id);

  return res.json({ success: true, business_id, slug, url: `https://enoma.io/${slug}` });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-admin-secret");
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") return res.status(200).end();

  // Self-serve funnel steps for a brand-new page (not edits): set once the
  // form is parsed. No-op until then.
  let funnel = async () => {};

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "POST only" });
    }

    /* ---------- SERVICE SPOTLIGHT PAGES (api/_lib/spotlight.js) ---------- */
    if (req.query?.kind === "spotlight") {
      // Stripe: publishing / unpublishing changes the service-page add-on
      // quantity on the owner's subscription (api/_lib/spotlight-billing.js).
      const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
      return await handleSpotlight(req, res, { supabaseAdmin, fetchImpl: fetch, stripe });
    }
    /* ---------- REVIEW REQUESTS: owner list / approve / hide (api/_lib/reviews.js) ---------- */
    if (req.query?.kind === "review") {
      return await handleReviews(req, res, { supabaseAdmin });
    }

    /* ---------- LOGO: starter-logo pick / upload from the dashboard (api/_lib/logo-settings.js) ---------- */
    if (req.query?.kind === "logo") {
      return await handleLogo(req, res, { supabaseAdmin });
    }

    /* ---------- ADMIN SHORTCUT ---------- */
    if (req.headers["x-admin-secret"]) {
      return await handleAdminGenerate(req, res);
    }

    /* ---------- AUTH ---------- */
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: "Missing Authorization header" });

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ error: "Invalid session" });

    if (!user.email_confirmed_at) {
      return res.status(403).json({ error: "Please confirm your email before creating a website." });
    }

    const auth_id = user.id;

    /* ---------- PARSE FORM ---------- */
    const form = formidable({
      multiples: true,
      keepExtensions: true,
      allowEmptyFiles: true,
      minFileSize: 0,
      filter: ({ originalFilename }) => !!originalFilename
    });

    const { fields, files } = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        else resolve({ fields, files });
      });
    });

    const business_name = first(fields.business_name);
    const seo_business_name = normalizeSeoBusinessName(business_name);
    const email = first(fields.email);
    // "ai_notes" are the owner's notes for the AI (edit mode). On a new page
    // the "about" box is those notes; when editing, "about" is the page's
    // About text itself, and notes default to it if none are given.
    const about_input = first(fields.ai_notes) || first(fields.about);
    const tone = first(fields.tone);
    const incomingBusinessId = first(fields.business_id);
    const owner_name = first(fields.owner_name);
    let logo_url = first(fields.logo_url);

    if (!business_name || !email) {
      return res.status(400).json({ error: "Business name and email required" });
    }

    const firstTouchInput = safeJSON(first(fields.first_touch) || "", null);
    if (!incomingBusinessId) {
      funnel = (event, metadata = {}, businessId = null) => logFunnelEvent(supabaseAdmin, req, {
        event, anonId: first(fields.anon_id), businessId, attribution: firstTouchInput,
        referrer: first(fields.referrer) || null, metadata: { path: "create", pricing_version: pricingVersionForNewSignup() || "v1", ...metadata }
      });
      await funnel("generation_started");
    }

    /* ---------- ONE-PAGE GATE (new users only) ---------- */
    const ENOMA_ADMIN_ID = "b2f87fe4-4d1e-4038-8754-5ab64969e975";
    const isEnomaSuperAdmin = user.id === ENOMA_ADMIN_ID;

    if (!incomingBusinessId && !isEnomaSuperAdmin) {
      const { data: existingMemberships } = await supabaseAdmin
        .from("business_members")
        .select("business_id, role")
        .eq("user_id", user.id)
        .eq("role", "owner");

      const ownedBusinesses = existingMemberships || [];

      if (ownedBusinesses.length >= 1) {
        const firstBizId = ownedBusinesses[0].business_id;

        const { data: sub } = await supabaseAdmin
          .from("subscriptions")
          .select("status, is_trial, trial_expires_at, stripe_subscription_id")
          .eq("business_id", firstBizId)
          .maybeSingle();

        // Subscribed (active, or Stripe-trialing with a card on file).
        const isPaid = hasLiveStripeSubscription(sub);

        if (!isPaid) {
          return res.status(403).json({
            error: "free_limit_reached",
            message: "Your free website has already been created. Visit your dashboard to edit your existing page or subscribe to keep it live.",
            business_id: firstBizId,
            dashboard_url: `/dashboard?business_id=${firstBizId}`
          });
        }

        return res.status(403).json({
          error: "one_site_limit",
          message: "Each account currently supports one website. Contact us if you need more.",
          business_id: firstBizId
        });
      }
    }

    /* ---------- NOTIFICATION EMAIL ---------- */
    if (!incomingBusinessId) {
      if (process.env.RESEND_API_KEY) {
        try {
          await resend.emails.send({
            from: "Enoma <noreply@enoma.io>",
            to: "jack@enoma.io",
            reply_to: email,
            subject: `New Enoma website: ${business_name || "Unknown"}`,
            html: `
              <h2>New Website Created</h2>
              <p><strong>Business:</strong> ${business_name || "—"}</p>
              <p><strong>Owner:</strong> ${owner_name || "—"}</p>
              <p><strong>Email:</strong> ${email || "—"}</p>
              <p><strong>Phone:</strong> ${first(fields.phone) || "—"}</p>
              <p><strong>City:</strong> ${first(fields.city) || "—"}</p>
              <p><strong>Submitted:</strong> ${new Date().toLocaleString()}</p>
              <hr />
              <pre style="white-space:pre-wrap">${about_input || "—"}</pre>
            `
          });
        } catch (err) {
          await logNotificationFailure("generate-business:new-website", "jack@enoma.io", err, { business_name, email });
        }
      } else {
        await logNotificationFailure("generate-business:new-website", "jack@enoma.io", new Error("RESEND_API_KEY not set"), { business_name, email });
      }
    }

    /* ---------- BUSINESS RESOLUTION ---------- */
    let business_id;
    let slug;
    let isNewBusiness = false;

    if (incomingBusinessId) {
      business_id = incomingBusinessId;
      const { data: membership } = await supabaseAdmin
        .from("business_members")
        .select("role")
        .eq("user_id", user.id)
        .eq("business_id", business_id)
        .maybeSingle();

      if (!membership) return res.status(403).json({ error: "Not authorized for this business" });

      const { data: profSlug } = await supabaseAdmin
        .from("small_business_profiles")
        .select("username")
        .eq("business_id", business_id)
        .maybeSingle();

      if (profSlug?.username) {
        slug = profSlug.username;
      } else {
        const { data: biz, error: bizErr } = await supabaseAdmin
          .from("businesses")
          .select("slug")
          .eq("id", business_id)
          .single();
        if (bizErr) throw bizErr;
        slug = biz.slug;
      }
    } else {
      isNewBusiness = true;
      const baseSlug = slugify(business_name);
      slug = await generateUniqueSlug(baseSlug, supabaseAdmin);

      const { data: newBiz, error } = await supabaseAdmin
        .from("businesses")
        .insert({
          name: business_name, slug, ai_generated_at: new Date().toISOString(),
          first_touch: selfServeFirstTouch(firstTouchInput, "create", first(fields.referrer))
        })
        .select("id, slug")
        .single();

      if (error) throw error;
      business_id = newBiz.id;

      // Credit the referrer if this visitor arrived via a referral link.
      await attributeReferral(supabaseAdmin, req, business_id);

      await supabaseAdmin.from("business_members").insert({
        user_id: user.id,
        business_id,
        role: "owner"
      });

      // pricing_version: new pages are on the $1 first month (api/_lib/pricing.js).
      await writeNewSubscription((row) => supabaseAdmin.from("subscriptions").upsert(row, { onConflict: "business_id" }), {
        business_id,
        provider: "stripe",
        plan_code: "starter",
        status: "trialing",
        is_trial: true,
        trial_starts_at: new Date().toISOString(),
        trial_expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        cancel_at_period_end: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    }

    const isEdit = Boolean(incomingBusinessId);
    // mode=suggest (edit only): write new wording with the AI and return it
    // for the owner to review in the form. Nothing is saved.
    const suggestOnly = isEdit && first(fields.mode) === "suggest";
    const shouldRegenerate = !isEdit || toBool(fields.regenerate_ai) || suggestOnly;

    /* ---------- LOGO UPLOAD ---------- */
    let uploadedLogo = false; // a real logo replaces any starter logo pick
    let logoBuffer = null;    // read for its brand color after the profile is saved
    try {
      const logoFile = files?.logo
        ? (Array.isArray(files.logo) ? files.logo[0] : files.logo)
        : null;

      if (logoFile && logoFile.size > 0) {
        const original = logoFile.originalFilename || "logo";
        const localPath = logoFile.filepath || logoFile.path;
        const ext = (original.split(".").pop() || "png").toLowerCase();
        const okExt = ["png", "jpg", "jpeg"].includes(ext);
        const okMime = isLogoMimetype(logoFile.mimetype || "");
        const maxBytes = 3 * 1024 * 1024;

        if (okExt && okMime && logoFile.size <= maxBytes) {
          const storagePath = `${business_id}/logo-${Date.now()}.${ext}`;
          const buffer = fs.readFileSync(localPath);
          const { error: upErr } = await supabaseAdmin.storage
            .from(BUCKET)
            .upload(storagePath, buffer, {
              contentType: logoFile.mimetype || contentTypeForExt(ext),
              upsert: true
            });
          if (!upErr) {
            const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(storagePath);
            if (pub?.publicUrl) { logo_url = pub.publicUrl; uploadedLogo = true; logoBuffer = buffer; }
          }
        }
      }
    } catch (e) {
      console.warn("⚠️ Logo upload error:", e?.message);
    }

    /* ---------- OWNER PHOTO (optional, "Meet the owner") ---------- */
    let uploadedOwnerPhoto = null;
    try {
      const f = files?.owner_photo ? (Array.isArray(files.owner_photo) ? files.owner_photo[0] : files.owner_photo) : null;
      if (f && f.size > 0 && f.size <= 8 * 1024 * 1024
          && (isImageMimetype(f.mimetype) || /\.(png|jpe?g|webp)$/i.test(f.originalFilename || ""))) {
        const ext = ((f.originalFilename || "photo.jpg").split(".").pop() || "jpg").toLowerCase();
        const storagePath = `${business_id}/owner-${Date.now()}.${ext}`;
        const { error: upErr } = await supabaseAdmin.storage.from(BUCKET)
          .upload(storagePath, fs.readFileSync(f.filepath || f.path), { contentType: f.mimetype || contentTypeForExt(ext), upsert: true });
        if (!upErr) uploadedOwnerPhoto = supabaseAdmin.storage.from(BUCKET).getPublicUrl(storagePath).data?.publicUrl || null;
      }
    } catch (e) {
      console.warn("⚠️ Owner photo upload error:", e?.message);
    }

    /* ---------- IMAGE UPLOADS ---------- */
    let newAttachments = [];
    try {
      if (files?.images) {
        const arr = Array.isArray(files.images) ? files.images : [files.images];
        const valid = arr.filter(f =>
          f && f.size > 0 &&
          (isImageMimetype(f.mimetype) || /\.(png|jpe?g|webp|gif)$/i.test(f.originalFilename || ""))
        );
        for (const f of valid.slice(0, 12)) {
          const localPath = f.filepath || f.path;
          const original = f.originalFilename || "image";
          const ext = (original.split(".").pop() || "jpg").toLowerCase();
          const base = safeFilename(original).replace(/\.[a-z0-9]+$/i, "");
          const storagePath = `${business_id}/${Date.now()}-${base}.${ext}`;
          const buffer = fs.readFileSync(localPath);
          const { error: upErr } = await supabaseAdmin.storage
            .from(BUCKET)
            .upload(storagePath, buffer, {
              contentType: f.mimetype || contentTypeForExt(ext),
              upsert: true
            });
          if (!upErr) {
            const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(storagePath);
            if (pub?.publicUrl) newAttachments.push(pub.publicUrl);
          }
        }
      }
    } catch (e) {
      console.warn("⚠️ Image upload error:", e?.message);
    }

    /* ---------- LOAD EXISTING PROFILE ---------- */
    let existingProfile = null;
    if (isEdit) {
      const { data, error } = await supabaseAdmin
        .from("small_business_profiles")
        .select("*")
        .eq("business_id", business_id)
        .maybeSingle();
      if (error) throw error;
      existingProfile = data;
    }
    if (!logo_url && existingProfile?.logo_url) logo_url = existingProfile.logo_url;

    /* ---------- SERVICES JSON ---------- */
    let servicesJSON = "[]";
    const rawServices = first(fields.services);
    if (rawServices) {
      try {
        JSON.parse(rawServices);
        servicesJSON = rawServices;
      } catch {
        servicesJSON = JSON.stringify(
          rawServices.split(",").map(s => s.trim()).filter(Boolean)
            .map(name => ({ service_name: name, service_description: "" }))
        );
      }
    } else if (existingProfile?.services) {
      servicesJSON = JSON.stringify(existingProfile.services);
    }

    /* ---------- OWNER FACTS (all optional) ---------- */
    // A field the form didn't send keeps its stored value; one sent empty clears it.
    const formValue = name => (hasField(fields, name) ? first(fields[name]) : undefined);
    const ownerFacts = ownerFactsFromForm(formValue, existingProfile || {});

    /* ---------- AI COPY ---------- */
    let generated = null;
    let primaryCTA = null;

    if (shouldRegenerate) {
      // Prompt and honesty rules: api/_lib/page-copy.js (shared with the admin path).
      const promptProfile = {
        business_name, primary_category: first(fields.primary_category), tone, notes: about_input,
        services_json: servicesJSON, address: first(fields.address), phone: first(fields.phone),
        website: first(fields.website), city: first(fields.city), state: first(fields.state),
        service_area: first(fields.service_area), owner_name, trust_badges: first(fields.trust_badges),
        testimonials: first(fields.testimonials), accepting_clients: toBool(fields.accepting_clients),
        offers_emergency: toBool(fields.offers_emergency),
        // The owner's answers (years, license, insured, free estimates, reply time).
        ...ownerFacts, owner_blurb: undefined,
      };
      const prompt = buildSelfServePrompt(promptProfile);
      // Shared generator (api/_lib/page-copy.js): structured output, so the
      // reply is always JSON in one schema; the facts-only rules and the copy
      // check run in finishGenerated below.
      const askAI = (extra = "") => requestCopy(prompt + extra, { fetchImpl: fetch });
      try {
        generated = await askAI();
      } catch (e) {
        console.error("❌ OpenAI error:", e?.message);
        await funnel("generation_failed", { error: e?.code || "ai_request_failed" }, business_id);
        return res.status(500).json({
          error: "AI generation failed",
          message: "We couldn't generate your page copy just now. Nothing was lost — please try again in a moment."
        });
      }
      const askAgain = askAI;
      const finished = await finishGenerated(generated, {
        flags: lintFlagsFor({ offersEmergency: toBool(fields.offers_emergency), yearsInBusiness: yearsInBusinessFrom(ownerFacts.years_in_business, about_input), profile: promptProfile }),
        profile: promptProfile,
        source: factSourceText(promptProfile),
        retry: askAgain,
        log: m => console.warn(m),
      });
      generated = finished.generated;
      if (finished.issues.length) console.warn(`copy-lint [${business_name}]:`, finished.issues.map(i => i.message).join(" | "));

      primaryCTA = generated.primary_cta || {};
    }

    if (suggestOnly) {
      return res.status(200).json({
        ok: true,
        suggestions: {
          hero_headline: generated?.hero_headline || "",
          hero_tagline: generated?.hero_tagline || "",
          about: generated?.about || "",
          why_choose_us: generated?.why_choose_us || "",
          services_intro: generated?.services_intro || "",
          services: Array.isArray(generated?.services) ? generated.services : [],
          how_it_works: Array.isArray(generated?.how_it_works) ? generated.how_it_works : [],
          faqs: Array.isArray(generated?.faqs) ? generated.faqs : [],
          seo_title: generated?.seo_title || "",
          seo_description: generated?.seo_description || "",
        },
      });
    }

    /* ---------- FINAL VALUES ---------- */
    const manualSeoTitle = hasField(fields, "seo_title") ? first(fields.seo_title) : existingProfile?.seo_title;
    const manualSeoDescription = hasField(fields, "seo_description") ? first(fields.seo_description) : existingProfile?.seo_description;
    const manualHeroHeadline = hasField(fields, "hero_headline") ? first(fields.hero_headline) : existingProfile?.hero_headline;
    const manualHeroTagline = hasField(fields, "hero_tagline") ? first(fields.hero_tagline) : existingProfile?.hero_tagline;
    const manualWhyChooseUs = hasField(fields, "why_choose_us") ? first(fields.why_choose_us) : existingProfile?.why_choose_us;
    const manualServicesIntro = hasField(fields, "services_intro") ? first(fields.services_intro) : existingProfile?.services_intro;
    const manualAbout = hasField(fields, "about") ? first(fields.about) : existingProfile?.about;
    const manualTrustBadges = hasField(fields, "trust_badges") ? safeJSON(first(fields.trust_badges), []) : (existingProfile?.trust_badges ?? []);
    const manualServices = hasField(fields, "services") ? safeJSON(first(fields.services), []) : (existingProfile?.services ?? []);

    const finalSeoTitle = shouldRegenerate ? (generated?.seo_title || manualSeoTitle || "") : (manualSeoTitle || "");
    const finalSeoDescription = shouldRegenerate ? (generated?.seo_description || manualSeoDescription || "") : (manualSeoDescription || "");
    const finalHeroHeadline = shouldRegenerate ? (generated?.hero_headline || manualHeroHeadline || "") : (manualHeroHeadline || "");
    const finalHeroTagline = shouldRegenerate ? (generated?.hero_tagline || manualHeroTagline || "") : (manualHeroTagline || "");
    const finalAbout = shouldRegenerate ? (generated?.about || manualAbout || "") : (manualAbout || "");
    const finalWhyChooseUs = shouldRegenerate ? (generated?.why_choose_us || manualWhyChooseUs || "") : (manualWhyChooseUs || "");
    const finalServicesIntro = shouldRegenerate ? (generated?.services_intro || manualServicesIntro || "") : (manualServicesIntro || "");
    const finalTrustBadges = shouldRegenerate ? (generated?.trust_badges ?? []) : (manualTrustBadges ?? []);
    const finalServices = mergeUserServicePrices(
      shouldRegenerate ? (generated?.services ?? []) : (manualServices ?? []),
      rawServices
    ).map(sv => {
      // "From $150" / "Same week": cleaned, and dropped when blank.
      const { price_from, turnaround, ...rest } = sv || {};
      return { ...rest, ...cleanServiceExtras({ price_from, turnaround }) };
    });

    // How it works: the owner's own three steps win; otherwise the AI's
    // (facts-only, page-copy.js) when the copy is being rewritten; the page
    // falls back to plain defaults when there are none.
    const submittedSteps = hasField(fields, "how_it_works") ? cleanSteps(first(fields.how_it_works)) : undefined;
    const finalHowItWorks = submittedSteps
      || (shouldRegenerate ? (generated?.how_it_works?.length ? generated.how_it_works : (existingProfile?.how_it_works ?? null))
        : (submittedSteps === null ? null : (existingProfile?.how_it_works ?? null)));
    // FAQs: owners can now edit them directly (create.html sends "faqs").
    const submittedFaqs = hasField(fields, "faqs")
      ? (safeJSON(first(fields.faqs), []) || [])
          .map(f => ({ q: String(f?.q || f?.question || "").trim(), a: String(f?.a || f?.answer || "").trim() }))
          .filter(f => f.q && f.a)
      : null;
    const finalFaqs = shouldRegenerate ? (generated?.faqs ?? []) : (submittedFaqs ?? existingProfile?.faqs ?? []);

    const manualPrimaryCtaLabel = hasField(fields, "primary_cta_label") ? first(fields.primary_cta_label) : existingProfile?.primary_cta_label;
    const manualPrimaryCtaType = hasField(fields, "primary_cta_type") ? first(fields.primary_cta_type) : existingProfile?.primary_cta_type;
    const manualPrimaryCtaValue = hasField(fields, "primary_cta_value") ? first(fields.primary_cta_value) : existingProfile?.primary_cta_value;

    let finalPrimaryCtaLabel = shouldRegenerate ? (primaryCTA?.label || manualPrimaryCtaLabel || "Contact Us") : (manualPrimaryCtaLabel || "Contact Us");
    let finalPrimaryCtaType = shouldRegenerate ? normalizeCtaType(primaryCTA?.type || manualPrimaryCtaType || "call") : normalizeCtaType(manualPrimaryCtaType || "call");
    let finalPrimaryCtaValue = shouldRegenerate
      ? (primaryCTA?.value || manualPrimaryCtaValue || first(fields.phone) || first(fields.website) || "")
      : (manualPrimaryCtaValue || first(fields.phone) || first(fields.website) || "");

    // A business with neither phone nor website would otherwise end up with
    // type="call" and an empty value — profile.html correctly hides a CTA
    // it can't build a working link for, so the page would end up with no
    // primary call-to-action at all. Email is always present (required at
    // the top of this handler), so fall back to it rather than showing
    // nothing: every published page should have at least one working way
    // for a customer to reach the business.
    if (!finalPrimaryCtaValue) {
      finalPrimaryCtaType = "email";
      finalPrimaryCtaValue = email;
      finalPrimaryCtaLabel = finalPrimaryCtaLabel === "Contact Us" || /^call\b/i.test(finalPrimaryCtaLabel) ? "Email Us" : finalPrimaryCtaLabel;
    }

    /* ---------- ATTACHMENTS ---------- */
    const attachmentsRemove = safeJSON(first(fields.attachments_remove), []);
    const normalizeAttachmentUrl = a => typeof a === "string" ? a : (a && typeof a === "object" ? a.url : "");
    const existingAttachmentUrls = Array.isArray(existingProfile?.attachments)
      ? existingProfile.attachments.map(normalizeAttachmentUrl).filter(Boolean)
      : [];
    const keptExistingAttachments = existingAttachmentUrls.filter(u => !attachmentsRemove.includes(u));
    let finalAttachments = [...keptExistingAttachments, ...newAttachments];
    if (finalAttachments.length > 24) finalAttachments = finalAttachments.slice(-24);
    const finalAttachmentKinds = mergeKinds(
      existingProfile?.attachment_kinds,
      safeJSON(first(fields.attachment_kinds), {}),
      finalAttachments,
      newAttachments
    );

    /* ---------- TESTIMONIALS (owner-entered, else preserved, else real Google reviews) ---------- */
    const finalGooglePlaceId = first(fields.google_place_id) || existingProfile?.google_place_id || null;
    const submittedTestimonials = hasField(fields, "testimonials") ? safeJSON(first(fields.testimonials), []) : null;
    const hasOwnerTestimonials =
      (Array.isArray(submittedTestimonials) && submittedTestimonials.length > 0) ||
      (!submittedTestimonials && Array.isArray(existingProfile?.testimonials) && existingProfile.testimonials.length > 0);

    let finalTestimonials;
    if (submittedTestimonials) {
      finalTestimonials = submittedTestimonials;
    } else if (Array.isArray(existingProfile?.testimonials) && existingProfile.testimonials.length) {
      finalTestimonials = existingProfile.testimonials;
    } else {
      finalTestimonials = [];
    }
    if (!hasOwnerTestimonials && finalGooglePlaceId) {
      finalTestimonials = await fetchGoogleReviewTestimonials(finalGooglePlaceId);
    }

    /* ---------- PROFILE UPSERT ---------- */
    const profilePayload = {
      business_id, auth_id, username: slug, business_name, seo_business_name, owner_name,
      email, phone: first(fields.phone), address: first(fields.address), website: first(fields.website),
      google_place_id: finalGooglePlaceId,
      primary_category: first(fields.primary_category) || existingProfile?.primary_category || null,
      city: first(fields.city) || existingProfile?.city || null,
      state: first(fields.state) || existingProfile?.state || null,
      logo_url,
      ...(uploadedLogo ? { starter_logo_id: null } : {}),
      hero_headline: finalHeroHeadline, hero_tagline: finalHeroTagline,
      about: finalAbout, why_choose_us: finalWhyChooseUs, services_intro: finalServicesIntro,
      seo_title: finalSeoTitle, seo_description: finalSeoDescription,
      services: finalServices, faqs: finalFaqs, trust_badges: finalTrustBadges,
      primary_cta_label: finalPrimaryCtaLabel, primary_cta_type: finalPrimaryCtaType, primary_cta_value: finalPrimaryCtaValue,
      service_area: normalizeServiceAreas(fields.service_area),
      testimonials: finalTestimonials,
      attachments: finalAttachments,
      attachment_kinds: finalAttachmentKinds,
      is_open_now: toBool(fields.is_open_now),
      accepting_clients: toBool(fields.accepting_clients),
      offers_emergency: toBool(fields.offers_emergency),
      // Sent as "" when the owner clears the field, so it can be removed.
      hero_availability: hasField(fields, "hero_availability") ? (first(fields.hero_availability) || null) : (existingProfile?.hero_availability || null),
      hero_response_time: hasField(fields, "hero_response_time") ? (first(fields.hero_response_time) || null) : (existingProfile?.hero_response_time || null),
      // Owner facts (migration 20261114_profile_upgrade), all optional.
      ...ownerFacts,
      how_it_works: finalHowItWorks,
      owner_photo_url: uploadedOwnerPhoto
        || (hasField(fields, "owner_photo_url") ? cleanPhotoUrl(first(fields.owner_photo_url)) : (existingProfile?.owner_photo_url ?? null)),
      social_links: hasField(fields, "social_links")
        ? safeJSON(first(fields.social_links), null)
        : (existingProfile?.social_links ?? null),
      is_public: true,
      updated_at: new Date().toISOString()
    };

    const { error: profileError } = await supabaseAdmin
      .from("small_business_profiles")
      .upsert(profilePayload, { onConflict: "business_id" });

    if (profileError) throw profileError;

    // A new logo: store its color so the page renders in it from first paint.
    if (uploadedLogo) await saveBrandColor(supabaseAdmin, business_id, await logoBrandColor(logoBuffer));

    try {
      await supabaseAdmin
        .from("businesses")
        .update({ name: business_name, slug, is_published: true, updated_at: new Date().toISOString() })
        .eq("id", business_id);
    } catch (e) {
      console.warn("⚠️ Failed to sync businesses table:", e?.message);
    }

    if (isNewBusiness) await funnel("generation_succeeded", { slug }, business_id);

    const redirectUrl = isNewBusiness
      ? `/website-live?slug=${slug}&business_id=${business_id}`
      : `/${slug}`;

    return res.json({
      success: true,
      business_id,
      username: slug,
      url: redirectUrl,
      is_new: isNewBusiness
    });

  } catch (err) {
    // Log the real exception server-side only — err.message can be a raw
    // Postgres/Supabase/storage error and shouldn't reach a non-technical
    // business owner's screen.
    console.error("🔥 generate-business error:", err);
    await funnel("generation_failed", { error: String(err?.message || err).slice(0, 300) });
    return res.status(500).json({
      error: "Server error",
      message: "We couldn't finish creating your site. Your information is safe — please try again, or email jack@enoma.io if it keeps happening."
    });
  }
}
