import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  const { slug, event, metadata } = req.body;

  if (!slug || !event) {
    return res.status(400).json({ error: "Missing slug or event" });
  }

  try {
    await supabase.from("page_events").insert({
      slug,
      event,
      metadata: metadata || {},
      referrer: req.headers.referer || null,
      user_agent: req.headers["user-agent"] || null
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Analytics insert failed:", err);
    res.status(500).json({ error: "Failed to track event" });
  }
}
