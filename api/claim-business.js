// api/claim-business.js
// Lets a signed-up, email-confirmed user claim an unclaimed business profile
// (small_business_profiles.is_claimed === false). Adds them as an owner in
// business_members and flips is_claimed to true. Called from public/claim.html
// after the user completes signup/login via the unclaimed-page banner CTA.

import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function logNotificationFailure(source, recipient, error, context) {
  console.error(`🚨 Notification email failed [${source}]:`, error?.message || error);
  try {
    await supabaseAdmin.from("notification_failures").insert({
      source,
      recipient,
      error: error?.message || String(error),
      context
    });
  } catch (e) {
    console.error("🚨 Also failed to record notification_failures row:", e?.message);
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: "Missing Authorization header" });

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ error: "Invalid session" });

    if (!user.email_confirmed_at) {
      return res.status(403).json({ error: "Please confirm your email before claiming a page." });
    }

    const slug = (req.body?.slug || "").toString().trim();
    if (!slug) return res.status(400).json({ error: "Missing slug" });

    const { data: profile, error: profileErr } = await supabaseAdmin
      .from("small_business_profiles")
      .select("business_id, business_name, username, is_claimed")
      .eq("username", slug)
      .maybeSingle();
    if (profileErr) throw profileErr;
    if (!profile) return res.status(404).json({ error: "No business found for this page" });

    if (profile.is_claimed) {
      const { data: membership } = await supabaseAdmin
        .from("business_members")
        .select("user_id")
        .eq("business_id", profile.business_id)
        .eq("user_id", user.id)
        .maybeSingle();
      if (membership) {
        return res.json({ success: true, already_claimed_by_you: true, business_id: profile.business_id, slug: profile.username });
      }
      return res.status(409).json({ error: "This page has already been claimed by someone else." });
    }

    const { error: memberErr } = await supabaseAdmin
      .from("business_members")
      .upsert({ user_id: user.id, business_id: profile.business_id, role: "owner" }, { onConflict: "user_id,business_id" });
    if (memberErr) throw memberErr;

    const { error: updateErr } = await supabaseAdmin
      .from("small_business_profiles")
      .update({ is_claimed: true, auth_id: user.id, updated_at: new Date().toISOString() })
      .eq("business_id", profile.business_id);
    if (updateErr) throw updateErr;

    await supabaseAdmin.from("funnel_events").insert({
      event: "business_claimed",
      business_id: profile.business_id,
      metadata: { slug: profile.username }
    }).then(({ error }) => { if (error) console.warn("funnel_events insert failed:", error.message); });

    if (process.env.RESEND_API_KEY) {
      try {
        await resend.emails.send({
          from: "Enoma <noreply@enoma.io>",
          to: "jack@enoma.io",
          reply_to: user.email,
          subject: `Page claimed: ${profile.business_name || slug}`,
          html: `<p><strong>${profile.business_name || slug}</strong> (/${slug}) was just claimed by ${user.email}.</p>`
        });
      } catch (e) {
        await logNotificationFailure("claim-business", "jack@enoma.io", e, { slug, claimed_by: user.email });
      }
    } else {
      await logNotificationFailure("claim-business", "jack@enoma.io", new Error("RESEND_API_KEY not set"), { slug, claimed_by: user.email });
    }

    return res.json({ success: true, business_id: profile.business_id, slug: profile.username });
  } catch (err) {
    console.error("🔥 claim-business error:", err);
    return res.status(500).json({ error: "Server error", message: err.message });
  }
}
