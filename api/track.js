import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BLOCKED_IPS = [
  "127.0.0.1",
  "::1",
  "75.69.76.70"
];

function getClientIP(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  const { slug, event, metadata } = req.body;

  if (!slug || !event) {
    return res.status(400).json({ error: "Missing slug or event" });
  }

  const ip = getClientIP(req);

  // 🔒 Block internal traffic
  if (!ip || BLOCKED_IPS.includes(ip)) {
    return res.status(204).end();
  }

  try {
    await supabase.from("page_events").insert({
      slug,
      event,
      metadata: metadata || {},
      referrer: req.headers.referer || null,
      user_agent: req.headers["user-agent"] || null,
      ip,
      is_internal: false
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Analytics insert failed:", err);
    res.status(500).json({ error: "Failed to track event" });
  }
}

