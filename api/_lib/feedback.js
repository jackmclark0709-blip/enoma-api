// Validation for owner feedback posted to /api/track (event: "feedback").
// Pure, so it can be unit tested without Supabase.
//
// Two sources:
//  - preview_poll: the one-question poll on unclaimed preview pages
//  - email_vote:   the 👍/👎 links in cold outreach emails (/feedback page)
// A follow-up comment is sent as a second call with the row's id.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,99}$/;

export const FEEDBACK_ANSWERS = {
  preview_poll: new Set(["yes", "maybe", "no"]),
  email_vote: new Set(["up", "down"])
};

export const MAX_COMMENT = 1000;

function cleanComment(value) {
  const s = String(value ?? "").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, MAX_COMMENT) : null;
}

// Returns { ok: true, kind: "insert", row } | { ok: true, kind: "comment", id, comment }
// | { ok: false, error }
export function parseFeedback(body = {}) {
  const b = body || {};

  if (b.feedback_id != null) {
    if (!UUID_RE.test(String(b.feedback_id))) return { ok: false, error: "bad_feedback_id" };
    const comment = cleanComment(b.comment);
    if (!comment) return { ok: false, error: "empty_comment" };
    return { ok: true, kind: "comment", id: String(b.feedback_id).toLowerCase(), comment };
  }

  const source = String(b.source || "");
  const allowed = FEEDBACK_ANSWERS[source];
  if (!allowed) return { ok: false, error: "bad_source" };
  const answer = String(b.answer || "").toLowerCase();
  if (!allowed.has(answer)) return { ok: false, error: "bad_answer" };

  const slug = b.slug == null || b.slug === "" ? null : String(b.slug).toLowerCase();
  if (slug !== null && !SLUG_RE.test(slug)) return { ok: false, error: "bad_slug" };
  const m = b.m == null || b.m === "" ? null : String(b.m).toLowerCase();
  if (m !== null && !UUID_RE.test(m)) return { ok: false, error: "bad_message_id" };

  if (source === "preview_poll" && !slug) return { ok: false, error: "missing_slug" };
  if (source === "email_vote" && !m) return { ok: false, error: "missing_message_id" };

  const anon = b.anon_id == null ? null : String(b.anon_id).slice(0, 64) || null;

  return {
    ok: true,
    kind: "insert",
    row: {
      source,
      answer,
      comment: cleanComment(b.comment),
      slug,
      outreach_message_id: m,
      anon_id: anon
    }
  };
}

export function feedbackLinks(messageId) {
  const base = "https://enoma.io/feedback?m=" + encodeURIComponent(messageId);
  return { up: base + "&v=up", down: base + "&v=down" };
}
