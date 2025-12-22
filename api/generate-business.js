import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";
import formidable from "formidable";

// ----------------------------------------------------
// SUPABASE CLIENT
// ----------------------------------------------------
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);


// Disable Next.js bodyParser so FormData works
export const config = {
  api: { bodyParser: false }
};

// ----------------------------------------------------
// Helpers
// ----------------------------------------------------
function first(val) {
  if (!val) return "";
  if (Array.isArray(val)) return val[0];
  if (typeof val === "object" && val._fields?.[0]) return val._fields[0];
  return val;
}

function safeJSON(val, fallback = []) {
  try {
    if (!val) return fallback;
    return typeof val === "string" ? JSON.parse(val) : val;
  } catch {
    return fallback;
  }
}

function slugify(text) {
  if (!text) return "";
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// ----------------------------------------------------
// Handler
// ----------------------------------------------------
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  // ----------------------------------------------------
  // 🔐 ADMIN AUTHORIZATION CHECK
  // ----------------------------------------------------
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: "Missing Authorization header" });
  }

  const token = authHeader.replace("Bearer ", "");

  // Verify Supabase session
  const {
    data: { user },
    error: authError
  } = await supabaseAdmin.auth.getUser(token);

  if (authError || !user) {
    return res.status(401).json({ error: "Invalid session" });
  }

  // Verify admin role
  const { data: member, error: memberError } = await supabaseAdmin
    .from("business_members")
    .select("role")
    .eq("user_id", user.id)
    .single();

  if (memberError || member?.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }

  // ✅ Admin verified — continue

if (existingProfile && existingProfile.auth_id !== user.id) {
  return res.status(403).json({ error: "Not authorized to update this profile" });
}

created_at: existingProfile ? undefined : new Date().toISOString(),


  console.log("⚡ generate-business invoked");

  // ✅ FIX: allow empty files
  const form = formidable({
    multiples: true,
    keepExtensions: true,
    allowEmptyFiles: true,
    minFileSize: 0
  });

  let fields, files;
  try {
    ({ fields, files } = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        else resolve({ fields, files });
      });
    }));
} catch (err) {
  console.error("❌ generate-business crashed:", err);
  return res.status(500).json({
    error: "Server error",
    details: err?.message || String(err)
  });
}

  // ----------------------------------------------------
  // Normalize fields
  // ----------------------------------------------------
  const business_name = first(fields.business_name);
  const owner_name    = first(fields.name);
  const address       = first(fields.address);
  const phone         = first(fields.phone);
  const email         = first(fields.email);
  const website       = first(fields.website);
  const about_input   = first(fields.about);
  const tone          = first(fields.tone);

  if (!business_name || !email) {
    return res.status(400).json({ error: "Business name and email required." });
  }

// ----------------------------------------------------
// Determine canonical username (slug)
// ----------------------------------------------------
const { data: existingProfile } = await supabaseAdmin
  .from("small_business_profiles")
  .select("username, auth_id")
  .eq("auth_id", user.id)
  .single();

const username = existingProfile?.username || slugify(business_name);

// Safety check: prevent overwriting someone else's profile
if (existingProfile && existingProfile.auth_id !== user.id) {
  return res.status(403).json({ error: "Unauthorized update" });
}


  // JSON fields from form
  const service_area = safeJSON(fields.service_area);
  const services     = safeJSON(fields.services);
  const testimonials = safeJSON(fields.testimonials);
  const attachments  = safeJSON(fields.attachments);

  // ----------------------------------------------------
  // Handle images (metadata only for now)
  // ----------------------------------------------------
  let images = [];
  if (files?.images) {
    const arr = Array.isArray(files.images) ? files.images : [files.images];
    images = arr
      .filter(f => f.size > 0)
      .map(f => ({
        filename: f.originalFilename,
        mimetype: f.mimetype
      }));
  }

  // ----------------------------------------------------
  // AI ENRICHMENT (augment, not overwrite)
  // ----------------------------------------------------
  const prompt = `
Create SEO-optimized copy for a business profile.

Return ONLY valid JSON:
{
  "seo_title": "",
  "seo_description": "",
  "hero_tagline": "",
  "about": "",
  "why_choose_us": ""
}

Business Name: ${business_name}
Owner: ${owner_name}
Address: ${address}
Phone: ${phone}
Website: ${website}

Tone: ${tone}
Service Area: ${service_area.join(", ")}

Business Description:
${about_input}
`;

  console.log("🤖 Calling OpenAI");

  const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
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

  const ai = await aiResponse.json();

  if (!aiResponse.ok || ai.error) {
    console.error("❌ OpenAI error:", ai);
    return res.status(500).json({ error: "AI generation failed" });
  }

  let generated = {};
  try {
    generated = JSON.parse(
      ai.choices[0].message.content.replace(/```json|```/g, "").trim()
    );
  } catch {
    console.error("❌ AI JSON invalid:", ai.choices[0].message.content);
  }

  // ----------------------------------------------------
  // Final profile object
  // ----------------------------------------------------
  const finalProfile = {
    username,
    business_name,
    owner_name,
    address,
    phone,
    email,
    website,

    auth_id: user.id, // 🔑 CRITICAL


    about: generated.about || about_input,
    hero_tagline: generated.hero_tagline,
    seo_title: generated.seo_title,
    seo_description: generated.seo_description,
    why_choose_us: generated.why_choose_us,

    services,        // includes pricing
    testimonials,
    attachments,
    service_area,

    images,
    is_public: true,
    updated_at: new Date().toISOString()
  };

  console.log("🧾 Upserting profile:", username);
console.log("🧪 finalProfile payload:", JSON.stringify(finalProfile, null, 2));


const { error } = await supabaseAdmin
  .from("small_business_profiles")
  .upsert(finalProfile, { onConflict: "username" });


  if (error) {
    console.error("❌ Supabase error:", error);
    return res.status(500).json({ error: "Database error", details: error });
  }

  console.log("✅ Business profile created:", username);
res.json({
  success: true,
  username,
  url: `/p/${username}`
});}
