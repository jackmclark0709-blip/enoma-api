import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  const { username } = req.query;

  if (!username) {
    return res.status(400).json({ error: "No username provided" });
  }

  // Fetch the matching business
  const { data, error } = await supabase
    .from("small_business_profiles")
    .select("*")
    .eq("username", username)
    .single();

  if (error || !data) {
    console.error("❌ Business profile not found:", error);
    return res.status(404).json({ error: "Business profile not found" });
  }

  // Normalize the JSON columns (services, service_area, town_sections)
  const clean = {
    ...data,
    services: safeParse(data.services),
    service_area: safeParse(data.service_area),
    town_sections: safeParse(data.town_sections),
  };

  return res.json(clean);
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
