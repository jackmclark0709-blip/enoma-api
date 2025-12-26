import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  const { id, slug, username } = req.query;

  let query = supabase
    .from("small_business_profiles")
    .select("*")
    .limit(1);

  // =============================
  // CANONICAL FETCH PRIORITY
  // =============================
  if (id) {
    query = query.eq("id", id);
  } else if (slug || username) {
    query = query
      .eq("username", slug || username)
      .eq("is_public", true);
  } else {
    return res.status(400).json({ error: "No identifier provided" });
  }

  const { data, error } = await query.single();

  if (error || !data) {
    console.error("❌ Business profile not found:", {
      id,
      slug,
      username,
      error
    });
    return res.status(404).json({ error: "Business profile not found" });
  }

  // =============================
  // HARD NORMALIZATION LAYER
  // =============================
  const clean = {
    ...data,
    services: normalizeArray(data.services),
    testimonials: normalizeArray(data.testimonials),
    attachments: normalizeArray(data.attachments),
    service_area: normalizeArray(data.service_area),
    town_sections: normalizeArray(data.town_sections),
    faqs: normalizeArray(data.faqs)
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

  if (Array.isArray(val)) {
    // Handle array of JSON strings
    if (val.length === 1 && typeof val[0] === "string") {
      try {
        const parsed = JSON.parse(val[0]);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return val;
  }

  if (typeof val === "object") {
    return Object.values(val);
  }

  if (typeof val === "string") {
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed;
      if (typeof parsed === "object") return Object.values(parsed);
    } catch {}
  }

  return [];
}
