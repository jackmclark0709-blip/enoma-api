import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";
import formidable from "formidable";

export const config = {
  api: { bodyParser: false }
};

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/* ---------------- HELPERS ---------------- */

const first = v =>
  Array.isArray(v) ? v[0] : v || "";

const safeJSON = (v, fallback = []) => {
  try {
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
};

const slugify = text =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

/* ---------------- HANDLER ---------------- */

export default async function handler(req, res) {
  console.log("🔥 handler reached", {
    method: req.method,
    hasAuth: !!req.headers.authorization
  });


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

    // TEMP: hard lock to you
    if (user.email !== "jack@enoma.io") {
      return res.status(403).json({ error: "Unauthorized" });
    }

    /* ---------- PARSE FORM ---------- */
const form = formidable({
  multiples: true,
  keepExtensions: true,
  allowEmptyFiles: true,
  minFileSize: 0,
  filter: ({ originalFilename }) => {
    // Ignore empty file inputs entirely
    return !!originalFilename;
  }
});

    const business_name = first(fields.business_name);
    const email = first(fields.email);
    const about_input = first(fields.about);
    const tone = first(fields.tone);

    if (!business_name || !email) {
      return res.status(400).json({ error: "Business name and email required" });
    }

    const slug = slugify(business_name);

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


    /* ---------- BUSINESS ---------- */

    // 1. Does a business already exist with this slug?
    const { data: existingBusiness } = await supabaseAdmin
      .from("businesses")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();

    let business_id;

    if (!existingBusiness) {
      // Create business
      const { data: newBiz, error } = await supabaseAdmin
        .from("businesses")
        .insert({ name: business_name, slug })
        .select("id")
        .single();

      if (error) throw error;
      business_id = newBiz.id;

      // Link creator
      await supabaseAdmin.from("business_members").insert({
        user_id: user.id,
        business_id,
        role: "admin"
      });
    } else {
      business_id = existingBusiness.id;

      // Verify permission
      const { data: membership } = await supabaseAdmin
        .from("business_members")
        .select("id")
        .eq("user_id", user.id)
        .eq("business_id", business_id)
        .maybeSingle();

      if (!membership) {
        return res.status(403).json({ error: "Not a member of this business" });
      }
    }

    /* ---------- AI COPY ---------- */

    const prompt = `
Return valid JSON only:
{
  "seo_title": "",
  "seo_description": "",
  "hero_tagline": "",
  "about": ""
}

Business: ${business_name}
Tone: ${tone}

Description:
${about_input}
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

    /* ---------- PROFILE ---------- */

    const profilePayload = {
      business_id,
      username: slug,
      email,
      about: generated.about || about_input,
      hero_tagline: generated.hero_tagline,
      seo_title: generated.seo_title,
      seo_description: generated.seo_description,
      is_public: true,
      updated_at: new Date().toISOString()
    };

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
