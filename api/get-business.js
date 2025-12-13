import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  // Canonical identifier
  const slug = req.query.slug || req.query.username;

  if (!slug) {
    return res.status(400).json({ error: "No slug provided" });
  }

  const { data, error } = await supabase
    .from("small_business_profiles")
    .select("*")
    .eq("username", slug)
    .single();

  if (error || !data) {
    console.error("❌ Business profile not found:", error);
    return res.status(404).json({ error: "Business profile not found" });
  }

  // 🔐 HARD NORMALIZATION LAYER
  const clean = {
    ...data,
    services: normalizeArray(data.services),
    testimonials: normalizeArray(data.testimonials),
    attachments: normalizeArray(data.attachments),
    service_area: normalizeArray(data.service_area),
    town_sections: normalizeArray(data.town_sections),
  };

  return res.status(200).json(clean);
}

/**
 * Normalizes values into arrays.
 * Handles:
 * - real arrays
 * - objects like { "0": {...} }
 * - stringified JSON
 * - null / undefined
 */
function normalizeArray(val) {
  if (!val) return [];

  // Already correct
  if (Array.isArray(val)) return val;

  // Object (Formidable / legacy case)
  if (typeof val === "object") {
    return Object.values(val);
  }

  // Stringified JSON
  if (typeof val === "string") {
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed;
      if (typeof parsed === "object") return Object.values(parsed);
      return [];
    } catch {
      return [];
    }
  }

  return [];
}
