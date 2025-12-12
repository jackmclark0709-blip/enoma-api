

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
// Helpers
// ----------------------------------------------------
function first(val) {
  if (!val) return "";

  // Formidable often wraps fields in arrays
  if (Array.isArray(val)) return val[0];

  // Sometimes returns objects like { _fields: ["value"] }
  if (typeof val === "object" && val._fields?.[0]) {
    return val._fields[0];
  }

  return val;
}

function slugify(text) {
  if (!text) return "";
  text = Array.isArray(text) ? text[0] : text;
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  console.log("⚡ Business profile generation invoked");

  const form = formidable({ multiples: true, keepExtensions: true });

  const { fields, files } = await new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });

  // ----------------------------------------------------
  // Normalize fields
  // ----------------------------------------------------

  const business_name = first(fields.business_name);
  const owner_name    = first(fields.name);
  const address       = first(fields.address);
  const phone         = first(fields.phone);
  const email         = first(fields.email);
  const website       = first(fields.website);
  const about         = first(fields.about);
  const tone          = first(fields.tone);

  const service_area_raw = first(fields.service_area);
  const services_raw     = first(fields.services);

  if (!business_name || !email) {
    return res.status(400).json({ error: "Business name and email required." });
  }

  // Arrays
  let parsedServiceArea = [];
  let parsedServices = [];

  try { parsedServiceArea = JSON.parse(service_area_raw || "[]"); } catch {}
  try { parsedServices     = JSON.parse(services_raw || "[]"); } catch {}

  // Username slug
  const username = slugify(business_name);

  // ----------------------------------------------------
  // Handle images (later upgrade to Supabase Storage)
  // ----------------------------------------------------
  let imageURLs = [];

  if (files.images) {
    const arr = Array.isArray(files.images) ? files.images : [files.images];
    imageURLs = arr.map(f => ({
      filename: f.originalFilename,
      type: f.mimetype
    }));
  }

  // ----------------------------------------------------
  // AI Prompt
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
Owner Name: ${owner_name}
Address: ${address}
Phone: ${phone}
Email: ${email}
Website: ${website}

Tone requested: ${tone}

Service Area: ${parsedServiceArea.join(", ")}
Services Offered: ${parsedServices.join(", ")}

About business:
${about}
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
  // Build final profile object
  // ----------------------------------------------------
  const finalProfile = {
    username,
    business_name,
    owner_name,
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

  console.log("🧾 Saving business profile:", username);

  const { error } = await supabase
    .from("small_business_profiles")
    .upsert(finalProfile, { onConflict: "username" });

  if (error) {
    console.error("❌ Supabase insert failed:", error);
    return res.status(500).json({ error: "Database error", details: error });
  }

  console.log("✅ Business profile saved");
  res.json({ username, success: true });
}
