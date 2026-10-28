import { createClient } from "@supabase/supabase-js";
import { parseFeedback } from "./_lib/feedback.js";

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

// Onboarding-funnel events recognized when no `slug` is sent (there's no
// published page yet at these steps) — see funnel_events table. Allowlisted
// so this endpoint can't become an arbitrary free-text event sink.
const FUNNEL_EVENTS = new Set([
  "get_your_website_submitted",
  "choose_path_viewed",
  "choose_path_selected",
  "create_page_viewed",
  "create_step_viewed",
  "create_form_submitted",
  "create_generation_succeeded",
  "create_generation_failed",
  "instant_preview_started",
  "instant_preview_failed",
  "claim_link_requested",
  "cta_clicked"
]);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  const { slug, event, metadata, anon_id, business_id } = req.body;

  if (!event) {
    return res.status(400).json({ error: "Missing event" });
  }

  const ip = getClientIP(req);

  // 🔒 Block internal traffic
  if (!ip || BLOCKED_IPS.includes(ip)) {
    return res.status(204).end();
  }

  try {
    // Owner feedback (preview-page poll, outreach 👍/👎). Its own table so
    // answers are easy to read back; a second call adds the optional comment.
    if (event === "feedback") {
      const parsed = parseFeedback(req.body);
      if (!parsed.ok) return res.status(400).json({ error: parsed.error });
      if (parsed.kind === "comment") {
        const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        await supabase.from("feedback").update({ comment: parsed.comment })
          .eq("id", parsed.id).is("comment", null).gte("created_at", since);
        return res.json({ success: true });
      }
      const { data, error } = await supabase.from("feedback").insert({
        ...parsed.row,
        referrer: req.headers.referer || null,
        user_agent: req.headers["user-agent"] || null
      }).select("id").single();
      if (error) throw error;
      return res.json({ success: true, id: data.id });
    }

    if (slug) {
      await supabase.from("page_events").insert({
        slug,
        event,
        metadata: metadata || {},
        referrer: req.headers.referer || null,
        user_agent: req.headers["user-agent"] || null,
        ip,
        is_internal: false
      });
    } else if (FUNNEL_EVENTS.has(event)) {
      await supabase.from("funnel_events").insert({
        event,
        anon_id: anon_id || null,
        business_id: business_id || null,
        metadata: metadata || {},
        referrer: req.headers.referer || null,
        user_agent: req.headers["user-agent"] || null
      });
    } else {
      return res.status(400).json({ error: "Missing slug or unrecognized event" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Analytics insert failed:", err);
    res.status(500).json({ error: "Failed to track event" });
  }
}

