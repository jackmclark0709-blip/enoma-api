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
    .replace(/[’']/g, "")   // remove straight + curly apostrophes
    .replace(/\s+/g, " ")   // collapse whitespace
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

async function generateUniqueSlug(base, supabase) {
  let slug = base;
  let i = 1;

  while (true) {
    const { data } = await supabase
      .from("businesses")
      .select("id")
      .eq("slug", slug)
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
    /* ---------- METHOD ---------- */
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

const auth_id = user.id;


    // TEMP: Enoma-only admin access
    if (user.email !== "jack@enoma.io") {
      return res.status(403).json({ error: "Unauthorized" });
    }

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

    const email         = first(fields.email);
    const about_input   = first(fields.about);
    const tone          = first(fields.tone);
const incomingBusinessId = first(fields.business_id);
const owner_name = first(fields.owner_name);
let logo_url = first(fields.logo_url); // may be overridden by uploaded logo file


if (!incomingBusinessId && process.env.RESEND_API_KEY) {
try {
  await resend.emails.send({
    from: "Enoma <notifications@enoma.io>",
    to: "jack@enoma.io",
    reply_to: email, // 🔥 very useful
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



    if (!business_name || !email) {
      return res.status(400).json({
        error: "Business name and email required"
      });
    }



    /* --------------------------------------------------
       BUSINESS RESOLUTION (CRITICAL LOGIC)
    -------------------------------------------------- */
    let business_id;
    let slug;

    if (incomingBusinessId) {
      // 🔁 UPDATE EXISTING BUSINESS
      business_id = incomingBusinessId;

      const { data: membership } = await supabaseAdmin
        .from("business_members")
        .select("role")
        .eq("user_id", user.id)
        .eq("business_id", business_id)
        .maybeSingle();

      if (!membership) {
        return res.status(403).json({
          error: "Not authorized for this business"
        });
      }

      const { data: biz } = await supabaseAdmin
        .from("businesses")
        .select("slug")
        .eq("id", business_id)
        .single();

      slug = biz.slug;

    } else {
      // 🆕 CREATE NEW BUSINESS
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


// --------------------------------------------------
// LOGO UPLOAD (PNG/JPG) → Supabase Storage (optional)
// - field name: "logo"
// - bucket: business-images
// - sets logo_url to public URL if uploaded
// --------------------------------------------------

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
          contentType: logoFile.mimetype || `image/${ext === "jpg" ? "jpeg" : ext}`,
          upsert: true
        });

      if (upErr) {
        console.warn("⚠️ Logo upload failed:", upErr.message);
      } else {
        const { data: pub } = supabaseAdmin.storage
          .from(BUCKET)
          .getPublicUrl(storagePath);

        if (pub?.publicUrl) {
          logo_url = pub.publicUrl; // ✅ override logo_url
        }
      }
    }
  }
} catch (e) {
  console.warn("⚠️ Logo upload block error:", e?.message || e);
}


/* --------------------------------------------------
   IMAGE UPLOADS → SUPABASE STORAGE (optional)
   - bucket: business-images (create it in Supabase)
   - stores public URLs into small_business_profiles.attachments
-------------------------------------------------- */

let newAttachments = [];
try {
  if (files?.images) {
    const arr = Array.isArray(files.images) ? files.images : [files.images];

    // Filter to real image files
    const valid = arr.filter(f =>
      f &&
      f.size > 0 &&
      (isImageMimetype(f.mimetype) || /\.(png|jpe?g|webp|gif)$/i.test(f.originalFilename || ""))
    );

    for (const f of valid.slice(0, 12)) {
      // formidable uses either `filepath` or `path` depending on version
      const localPath = f.filepath || f.path;
      const original = f.originalFilename || "image";
      const ext = (original.split(".").pop() || "jpg").toLowerCase();

const base = safeFilename(original).replace(/\.[a-z0-9]+$/i, "");
const storagePath = `${business_id}/${Date.now()}-${base}.${ext}`;

      const buffer = fs.readFileSync(localPath);

      const { error: upErr } = await supabaseAdmin.storage
        .from(BUCKET)
        .upload(storagePath, buffer, {
          contentType: f.mimetype || `image/${ext}`,
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
  newAttachments.push(pub.publicUrl); // store URL strings only
}

    }
  }
} catch (e) {
  console.warn("⚠️ Image upload block error:", e?.message || e);
}



/* --------------------------------------------------
   LOAD EXISTING PROFILE (EDIT MODE SAFETY)
-------------------------------------------------- */
let existingProfile = null;

if (incomingBusinessId) {
const { data } = await supabaseAdmin
  .from("small_business_profiles")
  .select("services, testimonials, attachments")
  .eq("business_id", business_id)
  .maybeSingle();


  existingProfile = data;
}

/* --------------------------------------------------
   SANITIZE SERVICES INPUT FOR AI
-------------------------------------------------- */
let servicesJSON = "[]";
const rawServices = first(fields.services);

if (rawServices) {
  try {
    // If already valid JSON, keep it
    JSON.parse(rawServices);
    servicesJSON = rawServices;
  } catch {
    // Otherwise, coerce comma-separated or free text into JSON
    servicesJSON = JSON.stringify(
      rawServices
        .split(",")
        .map(s => s.trim())
        .filter(Boolean)
        .map(name => ({
          service_name: name,
          service_description: "",
          benefits: []
        }))
    );
  }
}


    /* ---------- AI COPY ---------- */
const prompt = `

let generated = null;

if (shouldRegenerate) {
You are an expert local-business marketer and SEO copywriter.

Your task is to transform raw business input into polished, trustworthy,
SEO-optimized website content for a single-page business profile.

Return ONLY valid JSON that matches the schema below.
Do not include markdown, comments, or explanations.

--------------------------------
JSON SCHEMA (MUST MATCH EXACTLY)
--------------------------------

  {
  "seo_title": "",
  "seo_description": "",
  "hero_headline": "",
  "hero_tagline": "",
  "about": "",
  "why_choose_us": "",
  "services_intro": "",
  "trust_badges": [],
  "faqs": [
    { "question": "", "answer": "" }
  ],
  "services": [
    {
      "service_name": "",
      "service_description": ""
    }
  ],
  "primary_cta": {
    "label": "",
"type": "call|email|form|link",
    "value": ""
  }
}


--------------------------------
BUSINESS INPUT
--------------------------------
Business name: ${business_name}
Tone preference: ${tone}

Owner notes (raw, unedited):
${about_input}

Services (structured JSON):
${servicesJSON}


Location:
${first(fields.address)}

Phone:
${first(fields.phone)}

Website:
${first(fields.website)}

Primary city (if available):
${first(fields.city)}

State / Region:
${first(fields.state)}

Service areas (CSV):
${first(fields.service_area)}


Operational flags:
- Open now: ${toBool(fields.is_open_now)}
- Accepting clients: ${toBool(fields.accepting_clients)}
- Emergency services: ${toBool(fields.offers_emergency)}


--------------------------------
CONTENT RULES
--------------------------------
- Write clear, customer-facing language
- Prioritize trust and clarity
- Assume visitors are comparing providers
- Fill gaps intelligently if inputs are weak
- Rewrite services cleanly even if provided
- Default CTA to phone if phone exists
- Include one concise sentence indicating the primary service area when appropriate
- Write a concise 1–2 sentence introduction summarizing services and service area for use above the service list

--------------------------------
HERO HEADLINE RULES
--------------------------------
- 6–12 words max
- Do NOT include the business name
- Focus on primary service + location
- Confident, local, trustworthy
- No punctuation at the end
- Title Case (headline capitalization)
- Avoid marketing clichés

--------------------------------
SEO RULES
--------------------------------
- seo_title ≤ 60 characters
- seo_description ≤ 160 characters
- Use natural local-service SEO phrasing
--------------------------------
LOCAL SEO ENHANCEMENT RULES
--------------------------------
- Use natural "near me" phrasing sparingly (max 1–2 times total)
- Prioritize city and service-area mentions over generic keywords
- If service areas are provided:
  - Mention the primary city once
  - Reference surrounding areas collectively (e.g., "serving the greater [City] area")
- Do NOT invent cities or neighborhoods
- Avoid keyword stuffing or repetitive location phrases
- Write as if the business is competing in Google local results
- Use city or service-area context naturally in services_intro when available



--------------------------------
OUTPUT REQUIREMENTS
--------------------------------
- Return ONLY the JSON object
- All arrays must exist
- No null values
`;

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
      {
        role: "system",
        content: "You are a JSON API. You ONLY return valid JSON. No text."
      },
      {
        role: "user",
        content: prompt
      }
    ]
  })
});

if (!aiRes.ok) {
  const text = await aiRes.text();
  console.error("❌ OpenAI HTTP error:", text);
  return res.status(500).json({ error: "AI request failed" });
}

const ai = await aiRes.json();

if (!ai.choices?.[0]?.message?.content) {
  console.error("❌ OpenAI malformed response:", ai);
  return res.status(500).json({ error: "AI generation failed" });
}

const rawAI = ai.choices[0].message.content;
const cleanedAI = extractJSON(rawAI);

const generated = safeJSON(cleanedAI, null);

// 🚨 FIRST: validate object existence
if (!generated || typeof generated !== "object") {
  console.error("❌ AI returned invalid JSON:", rawAI);
  return res.status(500).json({
    error: "AI generation failed",
    details: "Invalid JSON returned from OpenAI"
  });
}

// ✅ THEN: normalize structure safely
if (!Array.isArray(generated.services)) generated.services = [];
if (!Array.isArray(generated.faqs)) generated.faqs = [];
if (!Array.isArray(generated.trust_badges)) generated.trust_badges = [];
if (!generated.primary_cta || typeof generated.primary_cta !== "object") {
  generated.primary_cta = {};
}

// ✅ Remove service "benefits" bullets (keep title + short description only)
generated.services = generated.services
  .filter(s => s && typeof s === "object")
  .map(s => ({
    service_name: String(s.service_name || "").trim(),
    service_description: String(s.service_description || "").trim(),
    benefits: [] // force empty so profile.html never renders bullets
  }))
  .filter(s => s.service_name);



// ------------------------------------
// SERVICES: enforce "title + description" only
// (kills bullets/benefits even if AI returns them)
// ------------------------------------
generated.services = (generated.services || [])
  .filter(s => s && (s.service_name || s.name))
  .map(s => ({
    service_name: String(s.service_name || s.name || "").trim(),
    service_description: String(s.service_description || s.description || "").trim()
  }))
  .filter(s => s.service_name);

// ------------------------------------
// FAQS: normalize {question,answer} -> {q,a}
// (profile.html expects faq.q and faq.a)
// ------------------------------------
generated.faqs = (generated.faqs || [])
  .map(f => ({
    q: String(f.q || f.question || "").trim(),
    a: String(f.a || f.answer || "").trim()
  }))
  .filter(f => f.q && f.a);


if (!generated.hero_headline || typeof generated.hero_headline !== "string") {
  generated.hero_headline =
    `Reliable ${first(fields.primary_service) || "Local Services"} in ${first(fields.city) || "Your Area"}`;
}

const normalizeCtaType = (t = "") => {
  const v = String(t).toLowerCase().trim();
  if (v === "phone") return "call";
  return v;
};



const primaryCTA = generated.primary_cta;
    /* ---------- PROFILE UPSERT ---------- */
const profilePayload = {
  /* Identity */
  business_id,
  auth_id,
  username: slug,
  business_name,
    seo_business_name,
  owner_name,

  /* Contact */
  email,
  phone: first(fields.phone),
  address: first(fields.address),
  website: first(fields.website),
  google_place_id: first(fields.google_place_id) || null,
  primary_category: first(fields.primary_category) || null,

  /* Branding */
  logo_url,


    /* Core content (AI-owned) */
/* Core content (AI-owned) */
hero_headline: finalHeroHeadline,
hero_tagline: finalHeroTagline,
about: finalAbout,
why_choose_us: finalWhyChooseUs,
services_intro: finalServicesIntro,




  /* SEO (AI-owned) */
seo_title: finalSeoTitle,
seo_description: finalSeoDescription,





  /* Structured sections */
services: finalServices,
faqs: finalFaqs,
trust_badges: finalTrustBadges,




primary_cta_label: primaryCTA.label || "Contact Us",
primary_cta_type: normalizeCtaType(primaryCTA.type) || "call",
primary_cta_value:
  primaryCTA.value ||
  first(fields.phone) ||
  first(fields.website) ||
  "",



  /* Geography */
  service_area: parseCSV(fields.service_area),

  /* Social proof (user-owned but optional) */
  testimonials:
    fields.testimonials
      ? safeJSON(fields.testimonials)
      : existingProfile?.testimonials ?? [],

  
// Images / media
// Images / media (support removals)
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

attachments: [
  ...keptExistingAttachments,
  ...newAttachments
],



/* Flags */
is_open_now: toBool(fields.is_open_now),
accepting_clients: toBool(fields.accepting_clients),
offers_emergency: toBool(fields.offers_emergency),


  is_public: true,
  updated_at: new Date().toISOString()
};
console.log("PROFILE PAYLOAD →", profilePayload);




if (Array.isArray(profilePayload.attachments) && profilePayload.attachments.length > 24) {
  profilePayload.attachments = profilePayload.attachments.slice(-24);
}

const { error: profileError } = await supabaseAdmin
  .from("small_business_profiles")
  .upsert(profilePayload, {
    onConflict: "business_id"
  });

if (profileError) throw profileError;

// Keep businesses table in sync (backward-compatible for older renderers/sitemaps)
try {
  const siteBase =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.SITE_URL ||
    "https://enoma.io";

  const canonicalUrl = `${siteBase.replace(/\/$/, "")}/${slug}`;

  await supabaseAdmin
    .from("businesses")
    .update({
      name: business_name,
      slug,
      phone: first(fields.phone) || null,
      city: first(fields.city) || null,
      state: first(fields.state) || null,
      service_area: parseCSV(fields.service_area),
      primary_category: first(fields.primary_category) || null,
final_title: finalSeoTitle,
final_description: finalSeoDescription,

      final_canonical_url: canonicalUrl,
final_og_image: logo_url || null,
      is_published: true,
      updated_at: new Date().toISOString()
    })
    .eq("id", business_id);
} catch (e) {
  console.warn("⚠️ Failed to sync businesses table:", e?.message || e);
}


    /* ---------- DONE ---------- */
    return res.json({
      success: true,
      business_id,
      username: slug,
url: `/${slug}`
    });

  } catch (err) {
    console.error("🔥 generate-business error:", err);
    return res.status(500).json({
      error: "Server error",
      message: err.message
    });
  }
}

} else {
  generated = null; // manual mode
}
