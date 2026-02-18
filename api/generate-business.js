import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";
import formidable from "formidable";
import { Resend } from "resend";
import fs from "fs";

const resend = new Resend(process.env.RESEND_API_KEY);

/* --------------------------------------------------
   CONFIG
-------------------------------------------------- */
export const config = {
  api: { bodyParser: false }
};

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* --------------------------------------------------
   HELPERS
-------------------------------------------------- */
const first = v => (Array.isArray(v) ? v[0] : v || "");

const hasField = (fields, key) =>
  fields && Object.prototype.hasOwnProperty.call(fields, key);

const safeJSON = (v, fallback = []) => {
  try {
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
};

const slugify = text =>
  String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const normalizeSeoBusinessName = name => {
  if (!name) return null;
  return String(name)
    .replace(/[’']/g, "")
    .replace(/\s+/g, " ")
    .trim();
};

const safeFilename = (name = "image") =>
  String(name)
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/(^-|-$)/g, "");

const isImageMimetype = (mt = "") => /^image\/(png|jpe?g|webp|gif)$/i.test(mt);
const isLogoMimetype = (mt = "") => /^image\/(png|jpe?g)$/i.test(mt);

const BUCKET = "business-images"; // Supabase Storage bucket

const parseCSV = v =>
  first(v)
    ? first(v).split(",").map(s => s.trim()).filter(Boolean)
    : [];

const toBool = v => {
  const s = String(first(v)).toLowerCase().trim();
  return s === "true" || s === "on" || s === "1" || s === "yes";
};

const extractJSON = text => {
  if (!text || typeof text !== "string") return "";
  return text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
};

const normalizeCtaType = (t = "") => {
  const v = String(t).toLowerCase().trim();
  if (v === "phone") return "call";
  return v;
};

const contentTypeForExt = (ext = "") => {
  const e = String(ext).toLowerCase();
  if (e === "jpg") return "image/jpeg";
  if (e === "jpeg") return "image/jpeg";
  if (e === "png") return "image/png";
  if (e === "webp") return "image/webp";
  if (e === "gif") return "image/gif";
  return `image/${e}`;
};

async function generateUniqueSlug(base, supabase) {
  let slug = base;
  let i = 1;

  while (true) {
    // Canonical slug source: small_business_profiles.username
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


/* --------------------------------------------------
   HANDLER
-------------------------------------------------- */
export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "POST only" });
    }

    /* ---------- AUTH ---------- */
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: "Missing Authorization header" });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } =
      await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ error: "Invalid session" });
    }

 // Require confirmed email (basic abuse prevention + ensures they own the account)
if (!user.email_confirmed_at) {
  return res.status(403).json({
    error: "Please confirm your email before creating a page."
  });
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

    /* ---------- CORE FIELDS ---------- */
    const business_name = first(fields.business_name);
    const seo_business_name = normalizeSeoBusinessName(business_name);

    const email = first(fields.email);
    const about_input = first(fields.about);
    const tone = first(fields.tone);
    const incomingBusinessId = first(fields.business_id);
    const owner_name = first(fields.owner_name);
    let logo_url = first(fields.logo_url); // may be overridden by uploaded logo file

    if (!business_name || !email) {
      return res.status(400).json({ error: "Business name and email required" });
    }

    // Email yourself on new submissions (optional)
    if (!incomingBusinessId && process.env.RESEND_API_KEY) {
      try {
        await resend.emails.send({
          from: "Enoma <notifications@enoma.io>",
          to: "jack@enoma.io",
          reply_to: email,
          subject: `New Enoma submission: ${business_name || "Unknown business"}`,
          html: `
            <h2>New Business Submission</h2>
            <p><strong>Business:</strong> ${business_name || "—"}</p>
            <p><strong>Owner:</strong> ${owner_name || "—"}</p>
            <p><strong>Email:</strong> ${email || "—"}</p>
            <p><strong>Phone:</strong> ${first(fields.phone) || "—"}</p>
            <p><strong>City:</strong> ${first(fields.city) || "—"}</p>
            <p><strong>Service Areas:</strong> ${first(fields.service_area) || "—"}</p>
            <p><strong>Submitted at:</strong> ${new Date().toLocaleString()}</p>
            <hr />
            <p><strong>Raw About Notes:</strong></p>
            <pre style="white-space:pre-wrap">${about_input || "—"}</pre>
          `
        });
      } catch (err) {
        console.warn("⚠️ Submission email failed:", err);
      }
    }

    /* --------------------------------------------------
       BUSINESS RESOLUTION
    -------------------------------------------------- */
    let business_id;
    let slug;

    if (incomingBusinessId) {
      business_id = incomingBusinessId;

      const { data: membership } = await supabaseAdmin
        .from("business_members")
        .select("role")
        .eq("user_id", user.id)
        .eq("business_id", business_id)
        .maybeSingle();

      if (!membership) {
        return res.status(403).json({ error: "Not authorized for this business" });
      }

      // Prefer canonical username from small_business_profiles
      const { data: profSlug } = await supabaseAdmin
        .from("small_business_profiles")
        .select("username")
        .eq("business_id", business_id)
        .maybeSingle();

      if (profSlug?.username) {
        slug = profSlug.username;
      } else {
        // Fallback (older rows): businesses.slug
        const { data: biz, error: bizErr } = await supabaseAdmin
          .from("businesses")
          .select("slug")
          .eq("id", business_id)
          .single();

        if (bizErr) throw bizErr;
        slug = biz.slug;
      }


    } else {
      const baseSlug = slugify(business_name);
      slug = await generateUniqueSlug(baseSlug, supabaseAdmin);

      const { data: newBiz, error } = await supabaseAdmin
        .from("businesses")
        .insert({ name: business_name, slug })
        .select("id, slug")
        .single();

      if (error) throw error;
      business_id = newBiz.id;

      await supabaseAdmin.from("business_members").insert({
        user_id: user.id,
        business_id,
        role: "admin"
      });
    }

    const isEdit = Boolean(incomingBusinessId);
    const shouldRegenerate = !isEdit || toBool(fields.regenerate_ai);

    /* --------------------------------------------------
       LOGO UPLOAD (optional)
    -------------------------------------------------- */
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

        if (!okExt || !okMime) {
          console.warn("⚠️ Invalid logo type (PNG/JPG only).");
        } else if (logoFile.size > maxBytes) {
          console.warn("⚠️ Logo too large (>3MB).");
        } else {
          const storagePath = `${business_id}/logo-${Date.now()}.${ext}`;
          const buffer = fs.readFileSync(localPath);

          const { error: upErr } = await supabaseAdmin.storage
            .from(BUCKET)
            .upload(storagePath, buffer, {
              contentType: logoFile.mimetype || contentTypeForExt(ext),
              upsert: true
            });

          if (upErr) {
            console.warn("⚠️ Logo upload failed:", upErr.message);
          } else {
            const { data: pub } = supabaseAdmin.storage
              .from(BUCKET)
              .getPublicUrl(storagePath);

            if (pub?.publicUrl) {
              logo_url = pub.publicUrl;
            }
          }
        }
      }
    } catch (e) {
      console.warn("⚠️ Logo upload block error:", e?.message || e);
    }

    /* --------------------------------------------------
       IMAGE UPLOADS (optional) → store URL strings
    -------------------------------------------------- */
    let newAttachments = [];
    try {
      if (files?.images) {
        const arr = Array.isArray(files.images) ? files.images : [files.images];

        const valid = arr.filter(f =>
          f &&
          f.size > 0 &&
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

          if (upErr) {
            console.warn("⚠️ Image upload failed:", upErr.message);
            continue;
          }

          const { data: pub } = supabaseAdmin.storage
            .from(BUCKET)
            .getPublicUrl(storagePath);

          if (pub?.publicUrl) {
            newAttachments.push(pub.publicUrl); // ✅ URL strings only
          }
        }
      }
    } catch (e) {
      console.warn("⚠️ Image upload block error:", e?.message || e);
    }

    /* --------------------------------------------------
       LOAD EXISTING PROFILE (for edit safety)
    -------------------------------------------------- */
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

// Preserve existing logo if edit form didn't send one and no file upload replaced it
if (!logo_url && existingProfile?.logo_url) {
  logo_url = existingProfile.logo_url;
}


    /* --------------------------------------------------
       SERVICES JSON (for prompt + manual)
    -------------------------------------------------- */
    let servicesJSON = "[]";
    const rawServices = first(fields.services);

    if (rawServices) {
      try {
        JSON.parse(rawServices);
        servicesJSON = rawServices;
      } catch {
        servicesJSON = JSON.stringify(
          rawServices
            .split(",")
            .map(s => s.trim())
            .filter(Boolean)
            .map(name => ({
              service_name: name,
              service_description: ""
            }))
        );
      }
    } else if (existingProfile?.services) {
      servicesJSON = JSON.stringify(existingProfile.services);
    }

    /* --------------------------------------------------
       AI COPY (optional)
    -------------------------------------------------- */
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
Tone preference: ${tone}

Owner notes:
${about_input}

Services (JSON):
${servicesJSON}

Address: ${first(fields.address)}
Phone: ${first(fields.phone)}
Website: ${first(fields.website)}
City: ${first(fields.city)}
State: ${first(fields.state)}
Service areas: ${first(fields.service_area)}

Operational flags:
- Open now: ${toBool(fields.is_open_now)}
- Accepting clients: ${toBool(fields.accepting_clients)}
- Emergency services: ${toBool(fields.offers_emergency)}
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
        console.error("❌ OpenAI HTTP error:", text);
        return res.status(500).json({ error: "AI request failed" });
      }

      const ai = await aiRes.json();
      const rawAI = ai?.choices?.[0]?.message?.content;

      if (!rawAI) {
        console.error("❌ OpenAI malformed response:", ai);
        return res.status(500).json({ error: "AI generation failed" });
      }

      const cleanedAI = extractJSON(rawAI);
      generated = safeJSON(cleanedAI, null);

      if (!generated || typeof generated !== "object") {
        console.error("❌ AI returned invalid JSON:", rawAI);
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
        .map(f => ({
          q: String(f.q || f.question || "").trim(),
          a: String(f.a || f.answer || "").trim()
        }))
        .filter(f => f.q && f.a);

      primaryCTA = generated.primary_cta || {};
    }

    /* --------------------------------------------------
       FINAL VALUES (manual edit vs AI rewrite)
    -------------------------------------------------- */
    const manualSeoTitle = hasField(fields, "seo_title") ? first(fields.seo_title) : existingProfile?.seo_title;
    const manualSeoDescription = hasField(fields, "seo_description") ? first(fields.seo_description) : existingProfile?.seo_description;

    const manualHeroHeadline = hasField(fields, "hero_headline") ? first(fields.hero_headline) : existingProfile?.hero_headline;
    const manualHeroTagline = hasField(fields, "hero_tagline") ? first(fields.hero_tagline) : existingProfile?.hero_tagline;

    const manualWhyChooseUs = hasField(fields, "why_choose_us") ? first(fields.why_choose_us) : existingProfile?.why_choose_us;
    const manualServicesIntro = hasField(fields, "services_intro") ? first(fields.services_intro) : existingProfile?.services_intro;
    const manualAbout = hasField(fields, "about") ? first(fields.about) : existingProfile?.about;

    const manualTrustBadges = hasField(fields, "trust_badges")
      ? safeJSON(first(fields.trust_badges), [])
      : (existingProfile?.trust_badges ?? []);

    const manualServices = hasField(fields, "services")
      ? safeJSON(first(fields.services), [])
      : (existingProfile?.services ?? []);

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

    const finalPrimaryCtaLabel = shouldRegenerate
      ? (primaryCTA?.label || manualPrimaryCtaLabel || "Contact Us")
      : (manualPrimaryCtaLabel || "Contact Us");

    const finalPrimaryCtaType = shouldRegenerate
      ? normalizeCtaType(primaryCTA?.type || manualPrimaryCtaType || "call")
      : normalizeCtaType(manualPrimaryCtaType || "call");

    const finalPrimaryCtaValue = shouldRegenerate
      ? (primaryCTA?.value || manualPrimaryCtaValue || first(fields.phone) || first(fields.website) || "")
      : (manualPrimaryCtaValue || first(fields.phone) || first(fields.website) || "");

    /* --------------------------------------------------
       ATTACHMENTS (support removals)
    -------------------------------------------------- */
    const attachmentsRemove = safeJSON(first(fields.attachments_remove), []);
    const normalizeAttachmentUrl = a =>
      typeof a === "string" ? a : (a && typeof a === "object" ? a.url : "");

    const existingAttachmentUrls =
      Array.isArray(existingProfile?.attachments)
        ? existingProfile.attachments.map(normalizeAttachmentUrl).filter(Boolean)
        : [];

    const keptExistingAttachments = existingAttachmentUrls.filter(
      u => !attachmentsRemove.includes(u)
    );

    let finalAttachments = [
      ...keptExistingAttachments,
      ...newAttachments
    ];

    if (finalAttachments.length > 24) {
      finalAttachments = finalAttachments.slice(-24);
    }

    /* --------------------------------------------------
       PROFILE UPSERT
    -------------------------------------------------- */
    const profilePayload = {
      business_id,
      auth_id,
      username: slug,
      business_name,
      seo_business_name,
      owner_name,

      email,
      phone: first(fields.phone),
      address: first(fields.address),
      website: first(fields.website),
google_place_id: first(fields.google_place_id) || existingProfile?.google_place_id || null,
primary_category: first(fields.primary_category) || existingProfile?.primary_category || null,

city: first(fields.city) || existingProfile?.city || null,
state: first(fields.state) || existingProfile?.state || null,


      logo_url,

      hero_headline: finalHeroHeadline,
      hero_tagline: finalHeroTagline,
      about: finalAbout,
      why_choose_us: finalWhyChooseUs,
      services_intro: finalServicesIntro,

      seo_title: finalSeoTitle,
      seo_description: finalSeoDescription,

      services: finalServices,
      faqs: finalFaqs,
      trust_badges: finalTrustBadges,

      primary_cta_label: finalPrimaryCtaLabel,
      primary_cta_type: finalPrimaryCtaType,
      primary_cta_value: finalPrimaryCtaValue,

      service_area: parseCSV(fields.service_area),

      testimonials: hasField(fields, "testimonials")
        ? safeJSON(first(fields.testimonials), [])
        : (existingProfile?.testimonials ?? []),

      attachments: finalAttachments,

      is_open_now: toBool(fields.is_open_now),
      accepting_clients: toBool(fields.accepting_clients),
      offers_emergency: toBool(fields.offers_emergency),

      is_public: true,
      updated_at: new Date().toISOString()
    };

    const { error: profileError } = await supabaseAdmin
      .from("small_business_profiles")
      .upsert(profilePayload, { onConflict: "business_id" });

    if (profileError) throw profileError;


       /* --------------------------------------------------
       MINIMAL BUSINESSES UPDATE (identity only)
       We keep businesses as the FK anchor table, but ALL page content lives in small_business_profiles.
    -------------------------------------------------- */
    try {
      await supabaseAdmin
        .from("businesses")
        .update({
          name: business_name,
          slug, // keep in sync with profile username
          is_published: true,
          updated_at: new Date().toISOString()
        })
        .eq("id", business_id);
    } catch (e) {
      console.warn("⚠️ Failed to update businesses identity:", e?.message || e);
    }



    return res.json({
      success: true,
      business_id,
      username: slug,
      url: `/${slug}`
    });

  } catch (err) {
    console.error("🔥 generate-business error:", err);
    return res.status(500).json({ error: "Server error", message: err.message });
  }
}
