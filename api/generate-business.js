
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

/* ---------------- HANDLER ---------------- */

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
    const {
      data: { user },
      error: authError
    } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ error: "Invalid session" });
    }

    // TEMP hard lock (safe for now)
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

    /* ---------- FIELDS ---------- */
    const business_name = first(fields.business_name);
    const email = first(fields.email);
    const about_input = first(fields.about);
    const tone = first(fields.tone);

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

    /* ---------- BUSINESS (SOURCE OF TRUTH) ---------- */

    const candidateSlug = slugify(business_name);

    const { data: existingBusiness } = await supabaseAdmin
      .from("businesses")
      .select("id, slug")
      .eq("slug", candidateSlug)
      .maybeSingle();

    let business_id;
    let slug;

    if (!existingBusiness) {
      // CREATE business
      const { data: newBiz, error } = await supabaseAdmin
        .from("businesses")
        .insert({
          name: business_name,
          slug: candidateSlug
        })
        .select("id, slug")
        .single();

      if (error) throw error;

      business_id = newBiz.id;
      slug = newBiz.slug;

      // creator becomes admin
      await supabaseAdmin.from("business_members").insert({
        user_id: user.id,
        business_id,
        role: "admin"
      });
    } else {
      // UPDATE existing business
      business_id = existingBusiness.id;
      slug = existingBusiness.slug;

      // 🔐 AUTH CHECK (ONLY place this happens)
      const { data: membership } = await supabaseAdmin
        .from("business_members")
        .select("id")
        .eq("user_id", user.id)
        .eq("business_id", business_id)
        .maybeSingle();

      if (!membership) {
        return res.status(403).json({
          error: "Not authorized for this business"
        });
      }
    }

    /* ---------- AI ---------- */
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

    /* ---------- PROFILE (BUSINESS-LOCKED) ---------- */
    const profilePayload = {
      business_id,           // 🔒 PRIMARY AUTHORITY
      username: slug,        // display only
      email,
      about: generated.about || about_input,
      hero_tagline: generated.hero_tagline,
      seo_title: generated.seo_title,
      seo_description: generated.seo_description,
      images,
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
