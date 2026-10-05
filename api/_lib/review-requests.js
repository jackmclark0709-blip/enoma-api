// api/_lib/review-requests.js
// "Ask for a Google review": an owner enters a recent customer's name +
// email on the dashboard, we email them a link that lands on Google's
// write-a-review screen for that business, and send one reminder if they
// haven't clicked after a few days.
//
// Routed from api/ga-metrics.js (actions send_review_request,
// list_review_requests, review_go, review_reminders) instead of new
// api/*.js files, so we don't add serverless functions.
//
// Compliance: every customer gets the same Google link. We never ask
// "were you happy?" first and only route happy customers to Google —
// that's review gating, which Google's policy and the FTC's 2024 review
// rule both prohibit.

import { plainTextToHtml, wrapEmailHtml } from "./email-html.js";

export const DAILY_LIMIT_PER_BUSINESS = 50;   // protects enoma.io's sender reputation
export const DEDUPE_DAYS = 30;                // don't re-ask the same customer within this window
export const REMINDER_AFTER_DAYS = 3;
export const REMINDER_MAX_AGE_DAYS = 14;      // past this, let it go
export const LINK_BASE = "https://enoma.io/r/";

const DAY_MS = 24 * 60 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/* ───────────── Pure helpers (unit tested) ───────────── */

/** Google's "write a review" URL for a Place ID, or null if there isn't one. */
export function googleReviewUrl(placeId) {
  const id = String(placeId || "").trim();
  if (!id) return null;
  return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(id)}`;
}

/** Tracked link that goes in the email. */
export function trackedReviewLink(requestId) {
  return `${LINK_BASE}${requestId}`;
}

export function isRequestId(id) {
  return UUID_RE.test(String(id || ""));
}

/** US phone to E.164 (+15085551234), or null if it doesn't look like one. */
export function normalizePhone(raw) {
  let digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  return digits.length === 10 ? `+1${digits}` : null;
}

/**
 * Validate what the owner typed. Email only for now; the phone is stored
 * (for text requests later) but not required.
 * @returns {{ ok: true, value: object } | { ok: false, error: string }}
 */
export function normalizeRequestInput({ name, email, phone } = {}) {
  const cleanName = String(name || "").trim().replace(/\s+/g, " ").slice(0, 80);
  const cleanEmail = String(email || "").trim().toLowerCase();
  if (!cleanEmail) return { ok: false, error: "Add the customer's email address." };
  if (!EMAIL_RE.test(cleanEmail) || cleanEmail.length > 254) {
    return { ok: false, error: "That email address doesn't look right." };
  }
  const cleanPhone = phone ? normalizePhone(phone) : null;
  return {
    ok: true,
    value: { customer_name: cleanName || null, customer_email: cleanEmail, customer_phone: cleanPhone, channel: "email" },
  };
}

/** First name only, so the email reads like a person wrote it. */
function firstName(full) {
  return String(full || "").trim().split(/\s+/)[0] || "";
}

/**
 * The email the customer receives. Plain and short on purpose: it should
 * read like a note from the owner, not a marketing blast.
 * @returns {{ subject: string, text: string, html: string }}
 */
export function buildReviewRequestEmail({ businessName, ownerName, customerName, link, isReminder = false }) {
  const greeting = firstName(customerName) ? `Hi ${firstName(customerName)},` : "Hi there,";
  const signoff = firstName(ownerName) ? `${firstName(ownerName)}\n${businessName}` : businessName;

  const subject = isReminder
    ? `Quick reminder from ${businessName}`
    : `Thanks for choosing ${businessName}`;

  const body = isReminder
    ? [
        greeting,
        "",
        `Just a quick follow-up in case my last note got buried. If you have a minute, a short Google review would mean a lot to a small business like ours:`,
        "",
        link,
        "",
        "No worries if not. Thanks again!",
      ]
    : [
        greeting,
        "",
        `Thanks for choosing ${businessName}. If you have a minute, would you leave us a quick Google review? Honest feedback helps other people in the area find us, and it means a lot to a small business like ours.`,
        "",
        link,
        "",
        "Thank you!",
      ];

  const footer = [
    "",
    signoff,
    "",
    `You're getting this because you recently worked with ${businessName}. We'll send at most one reminder.`,
  ];

  const text = [...body, ...footer].join("\n");
  return { subject, text, html: wrapEmailHtml(plainTextToHtml(text)) };
}

/** Which sent requests are due their one reminder right now. */
export function pickRemindersDue(rows, now = new Date()) {
  const t = now.getTime();
  return (rows || []).filter(r =>
    r.status === "sent" &&
    !r.reminder_sent_at &&
    !r.clicked_at &&
    r.customer_email &&
    r.sent_at &&
    t - new Date(r.sent_at).getTime() >= REMINDER_AFTER_DAYS * DAY_MS &&
    t - new Date(r.sent_at).getTime() <= REMINDER_MAX_AGE_DAYS * DAY_MS
  );
}

/** Start of "today" in US Eastern, as an ISO string, for the daily cap. */
export function startOfEasternDay(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(now).map(p => [p.type, p.value])
  );
  const sinceMidnightMs = ((+parts.hour * 60 + +parts.minute) * 60 + +parts.second) * 1000;
  return new Date(Math.floor(now.getTime() / 1000) * 1000 - sinceMidnightMs).toISOString();
}

/* ───────────── Handlers (deps injected by ga-metrics.js) ───────────── */

async function requireOwner(supabase, req, businessId) {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  if (!token) return { status: 401, error: "Unauthorized" };
  const { data: { user } = {}, error } = await supabase.auth.getUser(token);
  if (error || !user) return { status: 401, error: "Invalid session" };
  if (!isRequestId(businessId)) return { status: 400, error: "business_id required" };
  const { data: membership } = await supabase.from("business_members")
    .select("role").eq("business_id", businessId).eq("user_id", user.id).maybeSingle();
  if (!membership) return { status: 403, error: "Not your business" };
  return { user };
}

async function loadSender(supabase, businessId) {
  const { data } = await supabase.from("small_business_profiles")
    .select("business_name, owner_name, email, google_place_id")
    .eq("business_id", businessId).maybeSingle();
  return data;
}

function fromAddress(businessName) {
  // Display name is the business; strip characters that would break the header.
  const display = String(businessName || "Enoma").replace(/["<>\r\n]/g, "").slice(0, 60);
  return `${display} via Enoma <reviews@enoma.io>`;
}

/** POST ?action=send_review_request  body: { business_id, name, email, phone? } */
export async function handleSendReviewRequest(req, res, { supabase, resend }) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const businessId = req.body?.business_id;
  const auth = await requireOwner(supabase, req, businessId);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });

  const input = normalizeRequestInput(req.body);
  if (!input.ok) return res.status(400).json({ error: input.error });

  const sender = await loadSender(supabase, businessId);
  if (!sender?.google_place_id) {
    return res.status(409).json({
      error: "Your Google listing isn't connected yet. Message us and we'll hook it up.",
      code: "no_google_listing",
    });
  }
  if (!resend) return res.status(503).json({ error: "Email isn't configured right now. Try again later." });

  const { count: sentToday } = await supabase.from("review_requests")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId).gte("created_at", startOfEasternDay());
  if ((sentToday || 0) >= DAILY_LIMIT_PER_BUSINESS) {
    return res.status(429).json({ error: `You've hit today's limit of ${DAILY_LIMIT_PER_BUSINESS} requests. Try again tomorrow.` });
  }

  const since = new Date(Date.now() - DEDUPE_DAYS * DAY_MS).toISOString();
  const { data: recent } = await supabase.from("review_requests")
    .select("id").eq("business_id", businessId)
    .eq("customer_email", input.value.customer_email) // stored lowercased
    .gte("created_at", since).limit(1);
  if (recent?.length) {
    return res.status(409).json({ error: `You already asked this customer in the last ${DEDUPE_DAYS} days.`, code: "duplicate" });
  }

  const { data: row, error: insertError } = await supabase.from("review_requests")
    .insert({ business_id: businessId, created_by: auth.user.id, ...input.value })
    .select("id").single();
  if (insertError) return res.status(500).json({ error: insertError.message });

  const email = buildReviewRequestEmail({
    businessName: sender.business_name,
    ownerName: sender.owner_name,
    customerName: input.value.customer_name,
    link: trackedReviewLink(row.id),
  });

  try {
    await resend.emails.send({
      from: fromAddress(sender.business_name),
      to: input.value.customer_email,
      replyTo: sender.email || undefined,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });
    const at = new Date().toISOString();
    await supabase.from("review_requests").update({ status: "sent", sent_at: at }).eq("id", row.id);
    return res.status(200).json({ success: true, id: row.id });
  } catch (err) {
    await supabase.from("review_requests").update({ status: "failed", error: String(err.message || err).slice(0, 500) }).eq("id", row.id);
    return res.status(502).json({ error: "The email didn't go through. Try again in a minute." });
  }
}

/** GET ?action=list_review_requests&business_id=… → recent requests + 30-day totals */
export async function handleListReviewRequests(req, res, { supabase }) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  const businessId = req.query.business_id;
  const auth = await requireOwner(supabase, req, businessId);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });

  const { data: rows, error } = await supabase.from("review_requests")
    .select("id, customer_name, customer_email, status, sent_at, clicked_at, reminder_sent_at, created_at")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(25);
  if (error) return res.status(500).json({ error: error.message });

  const since = Date.now() - 30 * DAY_MS;
  const last30 = (rows || []).filter(r => new Date(r.created_at).getTime() >= since);
  const sender = await loadSender(supabase, businessId);
  return res.status(200).json({
    requests: rows || [],
    totals_30d: {
      sent: last30.filter(r => r.status === "sent" || r.status === "clicked").length,
      clicked: last30.filter(r => r.status === "clicked").length,
    },
    google_connected: !!sender?.google_place_id,
  });
}

/** Public: GET /r/<id> (rewritten to ?action=review_go&r=<id>) → Google review screen */
export async function handleReviewRedirect(req, res, { supabase }) {
  const id = String(req.query.r || "");
  if (!isRequestId(id)) return res.redirect(302, "https://enoma.io/");

  const { data: row } = await supabase.from("review_requests")
    .select("id, business_id, clicked_at").eq("id", id).maybeSingle();
  if (!row) return res.redirect(302, "https://enoma.io/");

  if (!row.clicked_at) {
    await supabase.from("review_requests")
      .update({ status: "clicked", clicked_at: new Date().toISOString() })
      .eq("id", id);
  }

  const sender = await loadSender(supabase, row.business_id);
  const target = googleReviewUrl(sender?.google_place_id);
  if (target) return res.redirect(302, target);

  const { data: biz } = await supabase.from("businesses")
    .select("google_maps_url, slug").eq("id", row.business_id).maybeSingle();
  return res.redirect(302, biz?.google_maps_url || (biz?.slug ? `https://enoma.io/${biz.slug}` : "https://enoma.io/"));
}

/** Cron (behind the CRON_SECRET gate): one reminder per unclicked request. */
export async function handleReviewReminders(req, res, { supabase, resend }) {
  if (!resend) return res.status(503).json({ success: false, error: "RESEND_API_KEY not configured" });
  const now = new Date();
  const oldest = new Date(now.getTime() - REMINDER_MAX_AGE_DAYS * DAY_MS).toISOString();
  const newest = new Date(now.getTime() - REMINDER_AFTER_DAYS * DAY_MS).toISOString();

  const { data: rows, error } = await supabase.from("review_requests")
    .select("id, business_id, customer_name, customer_email, status, sent_at, clicked_at, reminder_sent_at")
    .eq("status", "sent").is("reminder_sent_at", null)
    .gte("sent_at", oldest).lte("sent_at", newest)
    .limit(200);
  if (error) throw error;

  const due = pickRemindersDue(rows, now);
  const senders = new Map();
  let sent = 0, failed = 0;

  for (const r of due) {
    if (!senders.has(r.business_id)) senders.set(r.business_id, await loadSender(supabase, r.business_id));
    const sender = senders.get(r.business_id);
    if (!sender?.google_place_id) continue;

    const email = buildReviewRequestEmail({
      businessName: sender.business_name, ownerName: sender.owner_name,
      customerName: r.customer_name, link: trackedReviewLink(r.id), isReminder: true,
    });
    try {
      await resend.emails.send({
        from: fromAddress(sender.business_name), to: r.customer_email,
        replyTo: sender.email || undefined,
        subject: email.subject, text: email.text, html: email.html,
      });
      sent++;
    } catch (err) {
      console.error("review reminder failed", r.id, err.message);
      failed++;
    }
    // Mark either way, so a bad address isn't retried every day.
    await supabase.from("review_requests").update({ reminder_sent_at: new Date().toISOString() }).eq("id", r.id);
  }

  return res.status(200).json({ success: true, checked: rows?.length || 0, reminders_sent: sent, failed });
}
