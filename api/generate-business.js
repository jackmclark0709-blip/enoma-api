import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";
import formidable from "formidable";

/* --------------------------------------------------
   CONFIG
-------------------------------------------------- */
export const config = {
  api: { bodyParser: false }
};

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
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
    const email         = first(fields.email);
    const about_input   = first(fields.about);
    const tone          = first(fields.tone);
    const incomingBusinessId = first(fields.business_id);
const owner_name = first(fields.owner_name);
const logo_url = first(fields.logo_url);


    if (!business_name || !email) {
      return res.status(400).json({
        error: "Business name and email required"
      });
    }

    /* ---------- IMAGES ---------- */
    let images = [];
    if (files?.images) {
      const arr = Array.isArray(files.images)
        ? files.images
        : [files.images];

      images = arr
        .filter(f => f && f.size > 0)
        .map(f => ({
          filename: f.originalFilename,
          mimetype: f.mimetype
        }));
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
      slug = slugify(business_name);

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

/* --------------------------------------------------
   LOAD EXISTING PROFILE (EDIT MODE SAFETY)
-------------------------------------------------- */
let existingProfile = null;

if (incomingBusinessId) {
  const { data } = await supabaseAdmin
    .from("small_business_profiles")
    .select("services, testimonials, attachments")
    .eq("business_id", business_id)
    .single();

  existingProfile = data;
}


    /* ---------- AI COPY ---------- */
const prompt = `
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
  "hero_tagline": "",
  "about": "",
  "why_choose_us": "",
  "trust_badges": [],
  "faqs": [
    { "question": "", "answer": "" }
  ],
  "services": [
    {
      "service_name": "",
      "service_description": "",
      "benefits": []
    }
  ],
  "primary_cta": {
    "label": "",
    "type": "phone|form|link",
    "value": ""
  }
}

--------------------------------
BUSINESS INPUT
--------------------------------
const prompt = `
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
  "hero_tagline": "",
  "about": "",
  "why_choose_us": "",
  "trust_badges": [],
  "faqs": [
    { "question": "", "answer": "" }
  ],
  "services": [
    {
      "service_name": "",
      "service_description": "",
      "benefits": []
    }
  ],
  "primary_cta": {
    "label": "",
    "type": "phone|form|link",
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

Services (raw JSON):
${first(fields.services)}

Location:
${first(fields.address)}

Phone:
${first(fields.phone)}

Website:
${first(fields.website)}

Operational flags:
- Open now: ${fields.is_open_now === "on"}
- Accepting clients: ${fields.accepting_clients === "on"}
- Emergency services: ${fields.offers_emergency === "on"}

--------------------------------
CONTENT RULES
--------------------------------
- Write clear, customer-facing language
- Prioritize trust and clarity
- Assume visitors are comparing providers
- Fill gaps intelligently if inputs are weak
- Rewrite services cleanly even if provided
- Default CTA to phone if phone exists

--------------------------------
SEO RULES
--------------------------------
- seo_title ≤ 60 characters
- seo_description ≤ 160 characters
- Use natural local-service SEO phrasing

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
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }]
      })
    });

    const ai = await aiRes.json();
    const generated = JSON.parse(ai.choices[0].message.content);

    /* ---------- PROFILE UPSERT ---------- */
const profilePayload = {
  /* Identity */
  business_id,
  auth_id,
  username: slug,
  business_name,
  owner_name,

  /* Contact */
  email,
  phone: first(fields.phone),
  address: first(fields.address),
  website: first(fields.website),

  /* Branding */
  logo_url,

  /* Core content (AI-owned) */
  hero_tagline: generated.hero_tagline,
  about: generated.about,
  why_choose_us: generated.why_choose_us,

  /* SEO (AI-owned) */
  seo_title: generated.seo_title,
  seo_description: generated.seo_description,

  /* Structured sections */
  services: generated.services,
  faqs: generated.faqs,
  trust_badges: generated.trust_badges,

  /* CTA */
  primary_cta_label: generated.primary_cta.label,
  primary_cta_type: generated.primary_cta.type,
  primary_cta_value: generated.primary_cta.value,

  /* Geography */
  service_area: parseCSV(fields.service_area),

  /* Social proof (user-owned but optional) */
  testimonials:
    fields.testimonials
      ? safeJSON(fields.testimonials)
      : existingProfile?.testimonials ?? [],

  /* Flags */
  is_open_now: fields.is_open_now === "on",
  accepting_clients: fields.accepting_clients === "on",
  offers_emergency: fields.offers_emergency === "on",

  is_public: true,
  updated_at: new Date().toISOString()
};
console.log("PROFILE PAYLOAD →", profilePayload);



const { error: profileError } = await supabaseAdmin
  .from("small_business_profiles")
  .upsert(profilePayload, {
    onConflict: "business_id"
  });

if (profileError) throw profileError;

    /* ---------- DONE ---------- */
    return res.json({
      success: true,
      business_id,
      username: slug,
      url: `/p/${slug}`
    });

  } catch (err) {
    console.error("🔥 generate-business error:", err);
    return res.status(500).json({
      error: "Server error",
      message: err.message
    });
  }
}
