// api/generate-business.js
// CHANGES FROM PREVIOUS VERSION:
// 1. Added one-page-per-account gate (blocks repeat free AI generations)
// 2. After creating a new business, creates a 30-day trial subscription
// 3. Redirects to /website-live?slug=...&business_id=... instead of just /slug
// 4. Stamps ai_generated_at on the businesses table

import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";
import formidable from "formidable";
import { Resend } from "resend";
import fs from "fs";

const resend = new Resend(process.env.RESEND_API_KEY);

export const config = {
  api: { bodyParser: false }
};

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const first = v => (Array.isArray(v) ? v[0] : v || "");
const hasField = (fields, key) =>
  fields && Object.prototype.hasOwnProperty.call(fields, key);
const safeJSON = (v, fallback = []) => {
  try { return v ? JSON.parse(v) : fallback; } catch { return fallback; }
};
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
const parseCSV = v =>
  first(v) ? first(v).split(",").map(s => s.trim()).filter(Boolean) : [];
const toBool = v => {
  const s = String(first(v)).toLowerCase().trim();
  return s === "true" || s === "on" || s === "1" || s === "yes";
};
const extractJSON = text => {
  if (!text || typeof text !== "string") return "";
  return text.replace(/```json/gi, "").replace(/```/g, "").trim();
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

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "POST only" });
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
    const about_input = first(fields.about);
    const tone = first(fields.tone);
    const incomingBusinessId = first(fields.business_id);
    const owner_name = first(fields.owner_name);
    let logo_url = first(fields.logo_url);

    if (!business_name || !email) {
      return res.status(400).json({ error: "Business name and email required" });
    }

    /* ---------- ONE-PAGE GATE (new users only) ---------- */
    // If this is a NEW creation (not an edit), check if they already have a business.
    // Exception: Jack's admin account (b2f87fe4) is allowed to create pages for clients.
    const ENOMA_ADMIN_ID = "b2f87fe4-4d1e-4038-8754-5ab64969e975";
    const isEnomaSuperAdmin = user.id === ENOMA_ADMIN_ID;

    if (!incomingBusinessId && !isEnomaSuperAdmin) {
      const { data: existingMemberships } = await supabaseAdmin
        .from("business_members")
        .select("business_id, role")
        .eq("user_id", user.id)
        .eq("role", "owner"); // Only count businesses they OWN (not admin-access ones)

      // Filter to memberships where they are the original owner
      // (admin rows added by the trigger for Jack don't count)
      const ownedBusinesses = existingMemberships || [];

      if (ownedBusinesses.length >= 1) {
        // They already have a website — find their first one to show in dashboard
        const firstBizId = ownedBusinesses[0].business_id;

        // Check subscription status
        const { data: sub } = await supabaseAdmin
          .from("subscriptions")
          .select("status, is_trial, trial_expires_at")
          .eq("business_id", firstBizId)
          .maybeSingle();

        const isPaid = sub?.status === "active";

        if (!isPaid) {
          return res.status(403).json({
            error: "free_limit_reached",
            message: "Your free website has already been created. Visit your dashboard to edit your existing page or subscribe to keep it live.",
            business_id: firstBizId,
            dashboard_url: `/dashboard?business_id=${firstBizId}`
          });
        }

        // Paid but still one-site limit for now
        return res.status(403).json({
          error: "one_site_limit",
          message: "Each account currently supports one website. Contact us if you need more.",
          business_id: firstBizId
        });
      }
    }

    /* ---------- NOTIFICATION EMAIL ---------- */
    if (!incomingBusinessId && process.env.RESEND_API_KEY) {
      try {
        await resend.emails.send({
          from: "Enoma <notifications@enoma.io>",
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
        console.warn("⚠️ Notification email failed:", err);
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
        .insert({ name: business_name, slug, ai_generated_at: new Date().toISOString() })
        .select("id, slug")
        .single();

      if (error) throw error;
      business_id = newBiz.id;

      // Use 'owner' role so we can distinguish their own business from
      // admin-access rows added automatically (e.g. Jack's super-admin access)
      await supabaseAdmin.from("business_members").insert({
        user_id: user.id,
        business_id,
        role: "owner"
      });

      // Create 30-day trial subscription for new businesses
      await supabaseAdmin.from("subscriptions").upsert({
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
      }, { onConflict: "business_id" });
    }

    const isEdit = Boolean(incomingBusinessId);
    const shouldRegenerate = !isEdit || toBool(fields.regenerate_ai);

    /* ---------- LOGO UPLOAD ---------- */
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
            if (pub?.publicUrl) logo_url = pub.publicUrl;
          }
        }
      }
    } catch (e) {
      console.warn("⚠️ Logo upload error:", e?.message);
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

    /* ---------- AI COPY ---------- */
    let generated = null;
    let primaryCTA = null;

    if (shouldRegenerate) {
      const prompt = `
You are an expert local-business marketer and SEO copywriter.
Return ONLY valid JSON (no markdown, no commentary).

JSON SCHEMA:
{
  "seo_title": "",
  "seo_description": "",
  "hero_headline": "",
  "hero_tagline": "",
  "about": "",
  "why_choose_us": "",
  "services_intro": "",
  "trust_badges": [],
  "faqs": [{ "question": "", "answer": "" }],
  "services": [{ "service_name": "", "service_description": "" }],
  "primary_cta": { "label": "", "type": "call|email|form|link", "value": "" }
}

BUSINESS INPUT:
Business name: ${business_name}
Trade/category: ${first(fields.primary_category) || "general service"}
Tone preference: ${tone}
Owner notes: ${about_input}
Services (JSON): ${servicesJSON}
Address: ${first(fields.address)}
Phone: ${first(fields.phone)}
Website: ${first(fields.website)}
City: ${first(fields.city)}
State: ${first(fields.state)}
Service areas: ${first(fields.service_area)}
Owner name: ${owner_name || "not provided"}
Existing trust badges: ${first(fields.trust_badges) || "none"}
Existing testimonials: ${first(fields.testimonials) || "none"}
Operational flags:
- Open now: ${toBool(fields.is_open_now)}
- Accepting clients: ${toBool(fields.accepting_clients)}
- Emergency services: ${toBool(fields.offers_emergency)}

INSTRUCTIONS:
- Write the "about" field as 2-3 short paragraphs separated by \\n\\n, personal and specific to this business.
- Write "why_choose_us" as 4-5 short bullet points separated by \\n, each starting with a strong differentiator (no dashes or bullets, just plain text one per line).
- Write "hero_headline" as a single strong local SEO headline (include city/town name if provided).
- Write "faqs" with 5-6 realistic questions a customer would actually ask this type of business.
- "trust_badges" should be an array of 3-5 short trust signals (e.g. "Licensed & Insured", "Free Estimates", "Owner-Operated").
- If phone is provided, set primary_cta type to "call" and value to the phone number.
- Keep all copy concise, direct, and professional. Avoid generic filler phrases.
`.trim();

      const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-4o",
          temperature: 0.2,
          messages: [
            { role: "system", content: "You are a JSON API. You ONLY return valid JSON. No text." },
            { role: "user", content: prompt }
          ]
        })
      });

      if (!aiRes.ok) {
        const text = await aiRes.text();
        console.error("❌ OpenAI error:", text);
        return res.status(500).json({ error: "AI request failed" });
      }

      const ai = await aiRes.json();
      const rawAI = ai?.choices?.[0]?.message?.content;
      if (!rawAI) return res.status(500).json({ error: "AI generation failed" });

      generated = safeJSON(extractJSON(rawAI), null);
      if (!generated || typeof generated !== "object") {
        return res.status(500).json({ error: "AI generation failed", details: "Invalid JSON" });
      }

      if (!Array.isArray(generated.services)) generated.services = [];
      if (!Array.isArray(generated.faqs)) generated.faqs = [];
      if (!Array.isArray(generated.trust_badges)) generated.trust_badges = [];
      if (!generated.primary_cta || typeof generated.primary_cta !== "object") generated.primary_cta = {};

      generated.services = generated.services
        .filter(s => s && (s.service_name || s.name))
        .map(s => ({
          service_name: String(s.service_name || s.name || "").trim(),
          service_description: String(s.service_description || s.description || "").trim()
        }))
        .filter(s => s.service_name);

      generated.faqs = generated.faqs
        .map(f => ({ q: String(f.q || f.question || "").trim(), a: String(f.a || f.answer || "").trim() }))
        .filter(f => f.q && f.a);

      primaryCTA = generated.primary_cta || {};
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
    const finalServices = shouldRegenerate ? (generated?.services ?? []) : (manualServices ?? []);
    const finalFaqs = shouldRegenerate ? (generated?.faqs ?? []) : (existingProfile?.faqs ?? []);

    const manualPrimaryCtaLabel = hasField(fields, "primary_cta_label") ? first(fields.primary_cta_label) : existingProfile?.primary_cta_label;
    const manualPrimaryCtaType = hasField(fields, "primary_cta_type") ? first(fields.primary_cta_type) : existingProfile?.primary_cta_type;
    const manualPrimaryCtaValue = hasField(fields, "primary_cta_value") ? first(fields.primary_cta_value) : existingProfile?.primary_cta_value;

    const finalPrimaryCtaLabel = shouldRegenerate ? (primaryCTA?.label || manualPrimaryCtaLabel || "Contact Us") : (manualPrimaryCtaLabel || "Contact Us");
    const finalPrimaryCtaType = shouldRegenerate ? normalizeCtaType(primaryCTA?.type || manualPrimaryCtaType || "call") : normalizeCtaType(manualPrimaryCtaType || "call");
    const finalPrimaryCtaValue = shouldRegenerate
      ? (primaryCTA?.value || manualPrimaryCtaValue || first(fields.phone) || first(fields.website) || "")
      : (manualPrimaryCtaValue || first(fields.phone) || first(fields.website) || "");

    /* ---------- ATTACHMENTS ---------- */
    const attachmentsRemove = safeJSON(first(fields.attachments_remove), []);
    const normalizeAttachmentUrl = a => typeof a === "string" ? a : (a && typeof a === "object" ? a.url : "");
    const existingAttachmentUrls = Array.isArray(existingProfile?.attachments)
      ? existingProfile.attachments.map(normalizeAttachmentUrl).filter(Boolean)
      : [];
    const keptExistingAttachments = existingAttachmentUrls.filter(u => !attachmentsRemove.includes(u));
    let finalAttachments = [...keptExistingAttachments, ...newAttachments];
    if (finalAttachments.length > 24) finalAttachments = finalAttachments.slice(-24);

    /* ---------- PROFILE UPSERT ---------- */
    const profilePayload = {
      business_id, auth_id, username: slug, business_name, seo_business_name, owner_name,
      email, phone: first(fields.phone), address: first(fields.address), website: first(fields.website),
      google_place_id: first(fields.google_place_id) || existingProfile?.google_place_id || null,
      primary_category: first(fields.primary_category) || existingProfile?.primary_category || null,
      city: first(fields.city) || existingProfile?.city || null,
      state: first(fields.state) || existingProfile?.state || null,
      logo_url,
      hero_headline: finalHeroHeadline, hero_tagline: finalHeroTagline,
      about: finalAbout, why_choose_us: finalWhyChooseUs, services_intro: finalServicesIntro,
      seo_title: finalSeoTitle, seo_description: finalSeoDescription,
      services: finalServices, faqs: finalFaqs, trust_badges: finalTrustBadges,
      primary_cta_label: finalPrimaryCtaLabel, primary_cta_type: finalPrimaryCtaType, primary_cta_value: finalPrimaryCtaValue,
      service_area: parseCSV(fields.service_area),
      testimonials: hasField(fields, "testimonials") ? safeJSON(first(fields.testimonials), []) : (existingProfile?.testimonials ?? []),
      attachments: finalAttachments,
      is_open_now: toBool(fields.is_open_now),
      accepting_clients: toBool(fields.accepting_clients),
      offers_emergency: toBool(fields.offers_emergency),
      // Preserve hero_availability and hero_response_time if set in form or DB
      hero_availability: first(fields.hero_availability) || existingProfile?.hero_availability || null,
      hero_response_time: first(fields.hero_response_time) || existingProfile?.hero_response_time || null,
      // Preserve social_links if not submitted (don't wipe existing)
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

    try {
      await supabaseAdmin
        .from("businesses")
        .update({ name: business_name, slug, is_published: true, updated_at: new Date().toISOString() })
        .eq("id", business_id);
    } catch (e) {
      console.warn("⚠️ Failed to sync businesses table:", e?.message);
    }

    // For new businesses, redirect to the success/subscribe page
    // For edits, redirect directly to the live page
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
    console.error("🔥 generate-business error:", err);
    return res.status(500).json({ error: "Server error", message: err.message });
  }
}
