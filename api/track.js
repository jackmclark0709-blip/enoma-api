import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { looksLikeBot } from "./_lib/reply-tracking.js";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PREVIEW_ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

// A prospect opening the unclaimed preview page built for them is the
// strongest buying signal the funnel has — far better than an email open.
// Stamps first-view time on the prospect (and on the outreach message, when
// the link carried ?m=<message id>), and emails Jack at most once a day per
// prospect so he can call while they're looking. Never throws: analytics
// must not fail because an alert did.
async function handlePreviewView(slug, metadata, userAgent) {
  try {
    if (looksLikeBot(userAgent)) return;
    const { data: prospect } = await supabase
      .from("prospects")
      .select("id, business_name, trade, city, state, phone, email, preview_url, preview_first_viewed_at, preview_alerted_at")
      .eq("preview_url", `https://enoma.io/${slug}`)
      .limit(1)
      .maybeSingle();
    if (!prospect) return;

    const now = new Date();
    const updates = {};
    if (!prospect.preview_first_viewed_at) updates.preview_first_viewed_at = now.toISOString();

    const messageId = typeof metadata?.m === "string" && UUID_RE.test(metadata.m) ? metadata.m : null;
    if (messageId) {
      await supabase.from("outreach_messages")
        .update({ preview_visited_at: now.toISOString(), updated_at: now.toISOString() })
        .eq("id", messageId).eq("prospect_id", prospect.id).is("preview_visited_at", null);
    }

    const cooledDown = !prospect.preview_alerted_at ||
      now - new Date(prospect.preview_alerted_at) > PREVIEW_ALERT_COOLDOWN_MS;
    if (cooledDown && resend) {
      const where = [prospect.city, prospect.state].filter(Boolean).join(", ");
      const lines = [
        `${prospect.business_name}${where ? ` (${where})` : ""} just opened their Enoma preview page.`,
        "",
        prospect.phone ? `Call now: ${prospect.phone}` : null,
        prospect.email ? `Email: ${prospect.email}` : null,
        `Page: ${prospect.preview_url}`,
        messageId ? "They clicked through from your cold email." : "Came in without an email link (shared, typed, or found).",
        prospect.preview_first_viewed_at ? `First viewed: ${prospect.preview_first_viewed_at}` : "This is their first view."
      ].filter(v => v !== null);
      const { error } = await resend.emails.send({
        from: "Enoma Alerts <alerts@mail.enoma.io>",
        to: "jack@enoma.io",
        subject: `Preview opened: ${prospect.business_name}`,
        text: lines.join("\n")
      });
      if (!error) updates.preview_alerted_at = now.toISOString();
      else console.error("Preview alert send failed:", error.message);
    }

    if (Object.keys(updates).length) {
      await supabase.from("prospects").update(updates).eq("id", prospect.id);
    }
  } catch (err) {
    console.error("Preview view handling failed:", err);
  }
}

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
  "create_generation_failed"
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
      if (event === "page_view") {
        await handlePreviewView(slug, metadata, req.headers["user-agent"] || "");
      }
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

