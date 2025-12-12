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
    .eq("username", slug) // keep using username column for now
    .single();

  if (error || !data) {
    console.error("❌ Business profile not found:", error);
    return res.status(404).json({ error: "Business profile not found" });
  }

  const clean = {
    ...data,
    services: safeParse(data.services),
    service_area: safeParse(data.service_area),
    town_sections: safeParse(data.town_sections),
  };

  return res.status(200).json(clean);
}

// Helper to prevent crashes from malformed JSON
function safeParse(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;

  try {
    return JSON.parse(val);
  } catch {
    return [];
  }
}

