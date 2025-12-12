import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";
import formidable from "formidable";
import fs from "fs";

// ----------------------------------------------------
// SUPABASE CLIENT
// ----------------------------------------------------
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Disable Next.js bodyParser so FormData works
export const config = {
  api: { bodyParser: false }
};

// ----------------------------------------------------
// Helper: Convert business name → clean slug
// ----------------------------------------------------
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  console.log("⚡ Business profile generation invoked");

  // Parse incoming form-data (supports file uploads)
  const form = formidable({ multiples: true, keepExtensions: true });

  const { fields, files } = await new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });

  // ----------------------------------------------------
  // Extract inputs
  // ----------------------------------------------------
  const {
    business_name,
    name,
    address,
    phone,
    email,
    website,
    service_area,
    services,
    about,
    tone,
  } = fields;

  if (!business_name || !email) {
    return res.status(400).json({ error: "Business name and email required." });
  }

  const username = slugify(business_name);

  // Arrays (passed as JSON strings from client)
  let parsedServices = [];
  let parsedServiceArea = [];

  try { parsedServices = JSON.parse(services || "[]"); } catch {}
  try { parsedServiceArea = JSON.parse(service_area || "[]"); } catch {}

  // ----------------------------------------------------
  // Optional image upload → store raw files in /tmp for now
  // (Future upgrade: upload to Supabase Storage)
  // ----------------------------------------------------
  let imageURLs = [];

  if (files.images) {
    const arr = Array.isArray(files.images) ? files.images : [files.images];

    imageURLs = arr.map((f) => ({
      filename: f.originalFilename,
      type: f.mimetype
    }));
  }

  // ----------------------------------------------------
  // BUILD AI PROMPT
  // ----------------------------------------------------
  const prompt = `
Create an SEO-optimized business profile.

Return ONLY JSON in this structure:

{
  "seo_title": "",
  "seo_description": "",
  "hero_tagline": "",
  "about_section": "",
  "why_choose_us": "",
  "services_expanded": [],
  "town_sections": []
}

DATA PROVIDED:
Business Name: ${business_name}
Owner Name: ${name}
Address: ${address}
Phone: ${phone}
Email: ${email}
Website: ${website}

Tone requested: ${tone}

Service Area: ${parsedServiceArea.join(", ")}
Services Offered: ${parsedServices.join(", ")}

About business:
${about}

TASKS:
1. Generate a powerful SEO page title.
2. Write a compelling meta description using local SEO.
3. Create a strong hero tagline.
4. Expand "about" into a polished, persuasive business overview.
5. Create a “Why Choose Us” section listing 3–5 reasons.
6. Rewrite each service into a professional, polished 2–3 sentence description using benefit-driven language.
7. For EACH town in the service area, write a paragraph explaining service availability + add local SEO keywords.
`;

  console.log("🤖 Calling OpenAI...");

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
    console.error(ai);
    return res.status(500).json({ error: "OpenAI failed", raw: ai });
  }

  let generated;
  try {
    generated = JSON.parse(
      ai.choices[0].message.content.replace(/```json|```/g, "").trim()
    );
  } catch (err) {
    console.error("JSON parsing failed:", ai.choices[0].message.content);
    return res.status(500).json({ error: "Bad AI JSON" });
  }

  // ----------------------------------------------------
  // Build final profile object for Supabase
  // ----------------------------------------------------
  const finalProfile = {
    username,
    business_name,
    owner_name: name,
    address,
    phone,
    email,
    website,
    about: generated.about_section,
    hero_tagline: generated.hero_tagline,
    seo_title: generated.seo_title,
    seo_description: generated.seo_description,
    services: generated.services_expanded,
    service_area: parsedServiceArea,
    town_sections: generated.town_sections,
    why_choose_us: generated.why_choose_us,
    images: imageURLs,
    is_public: true,
    updated_at: new Date().toISOString()
  };

  // ----------------------------------------------------
  // WRITE TO SUPABASE
  // ----------------------------------------------------
  console.log("🧾 Saving business profile:", username);

  const { error } = await supabase
    .from("small_business_profiles")
    .upsert(finalProfile, { onConflict: "username" });

  if (error) {
    console.error("❌ Supabase insert failed:", error);
    return res.status(500).json({ error: "Database error", details: error });
  }

  console.log("✅ Business saved");

  // return minimal payload for redirect
  res.json({ username, success: true });
}
