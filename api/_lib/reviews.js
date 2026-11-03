// api/_lib/reviews.js
// Review requests. An owner texts customers a link (enoma.io/<business>/review).
// The customer leaves stars and a quote, which waits in review_submissions
// until the owner approves it in the dashboard; approved reviews join the
// page's testimonials. If the business has a Google listing, the page also
// offers a one-tap link to post the review on Google.
//
// Owner actions ride /api/generate-business?kind=review (function cap);
// public submissions go through /api/send-contact (source "review").

export const REVIEW_SLUG = "review";

export const escHtml = v => String(v ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export function googleReviewUrl(placeId) {
  return placeId ? `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}` : null;
}

// Validates a public submission. Returns { ok, value } or { ok: false, error }.
export function cleanReview(body = {}) {
  const name = String(body.name || "").trim().slice(0, 80);
  const quote = String(body.quote || body.message || "").trim().slice(0, 800);
  const rating = Math.round(Number(body.rating));
  if (!name) return { ok: false, error: "Please add your name." };
  if (!(rating >= 1 && rating <= 5)) return { ok: false, error: "Please pick 1 to 5 stars." };
  if (quote.length < 5) return { ok: false, error: "Please write a few words about the job." };
  return { ok: true, value: { name, quote, rating } };
}

// Appends an approved review to a testimonials list, skipping duplicates.
export function addTestimonial(testimonials, review) {
  const list = Array.isArray(testimonials) ? [...testimonials] : [];
  const dup = list.some(t => String(t?.quote || "").trim() === review.quote.trim());
  if (!dup) list.unshift({ quote: review.quote, author: review.name, rating: review.rating, source: "enoma" });
  return list;
}

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const t = Buffer.concat(chunks).toString("utf8");
  return t ? JSON.parse(t) : {};
}

const ADMIN_ID = "b2f87fe4-4d1e-4038-8754-5ab64969e975";

export async function handleReviews(req, res, { supabaseAdmin }) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Please log in." });
  const { data: { user } = {} } = await supabaseAdmin.auth.getUser(token);
  if (!user) return res.status(401).json({ error: "Your session expired. Please log in again." });

  let body;
  try { body = await readJson(req); } catch { return res.status(400).json({ error: "Invalid JSON" }); }
  const businessId = String(body.business_id || "");
  if (!businessId) return res.status(400).json({ error: "business_id required" });
  if (user.id !== ADMIN_ID) {
    const { data: m } = await supabaseAdmin.from("business_members").select("role")
      .eq("user_id", user.id).eq("business_id", businessId).maybeSingle();
    if (!m) return res.status(403).json({ error: "Not authorized for this business" });
  }

  const action = String(req.query?.action || "list");
  if (action === "list") {
    const { data } = await supabaseAdmin.from("review_submissions")
      .select("id,name,rating,quote,status,created_at").eq("business_id", businessId)
      .order("created_at", { ascending: false }).limit(30);
    return res.status(200).json({ reviews: data || [] });
  }

  const { data: review } = await supabaseAdmin.from("review_submissions").select("*")
    .eq("id", String(body.id || "")).eq("business_id", businessId).maybeSingle();
  if (!review) return res.status(404).json({ error: "Review not found" });

  if (action === "approve") {
    const { data: profile } = await supabaseAdmin.from("small_business_profiles")
      .select("testimonials").eq("business_id", businessId).maybeSingle();
    const testimonials = addTestimonial(profile?.testimonials, review);
    const { error } = await supabaseAdmin.from("small_business_profiles")
      .update({ testimonials, updated_at: new Date().toISOString() }).eq("business_id", businessId);
    if (error) return res.status(500).json({ error: "Couldn't add the review to your page." });
    await supabaseAdmin.from("review_submissions").update({ status: "approved", decided_at: new Date().toISOString() }).eq("id", review.id);
    return res.status(200).json({ ok: true, status: "approved" });
  }
  if (action === "hide") {
    await supabaseAdmin.from("review_submissions").update({ status: "hidden", decided_at: new Date().toISOString() }).eq("id", review.id);
    return res.status(200).json({ ok: true, status: "hidden" });
  }
  return res.status(400).json({ error: `Unknown action ${action}` });
}
