// api/_lib/owner-link.js
// The owner's link to their own page: enoma.io/<slug>?o=<owner_token>&m=<message id>.
// Page v2 only. The token is unguessable (144 random bits), stored on the
// profile (owner_token), and is what makes the page show the owner bar;
// visitors without it never see the bar. /<slug>/preview keeps working for
// links already sent.

import crypto from "node:crypto";
import { isUuid } from "./outreach-email.js";

const BASE = "https://enoma.io";
const TOKEN_RE = /^[A-Za-z0-9_-]{24}$/;

export function newOwnerToken() {
  return crypto.randomBytes(18).toString("base64url"); // 24 chars
}

export function isOwnerTokenShape(t) {
  return TOKEN_RE.test(String(t || ""));
}

/** Constant-time check of a ?o= value against the profile's stored token. */
export function ownerTokenMatches(profile, given) {
  const stored = String(profile?.owner_token || "");
  const g = String(given || "");
  if (!isOwnerTokenShape(stored) || !isOwnerTokenShape(g)) return false;
  return crypto.timingSafeEqual(Buffer.from(stored), Buffer.from(g));
}

/** Is this a v2 page (the only kind with owner links and the owner bar)? */
export function isPageV2(profile) {
  return Number(profile?.page_version) === 2;
}

/**
 * The owner's link. m (an outreach_messages id) is kept for attribution when
 * the link came from a cold email; texts and drafts have none.
 */
export function ownerPageUrl(slug, token, { m = null, claim = false, base = BASE } = {}) {
  const u = new URL(`${base}/${encodeURIComponent(slug)}`);
  u.searchParams.set("o", token);
  if (isUuid(m)) u.searchParams.set("m", m);
  if (claim) u.searchParams.set("claim", "1");
  return u.toString();
}

/**
 * The profile's owner token, creating and storing one the first time it's
 * needed. Returns null (and the caller falls back to /preview) when the page
 * isn't v2 or the token can't be saved.
 */
export async function ensureOwnerToken(supabase, profile, { log = console } = {}) {
  if (!isPageV2(profile) || !profile?.business_id) return null;
  if (isOwnerTokenShape(profile.owner_token)) return profile.owner_token;
  const token = newOwnerToken();
  try {
    // Only fill an empty token, so two concurrent sends agree on one.
    const { data, error } = await supabase.from("small_business_profiles")
      .update({ owner_token: token }).eq("business_id", profile.business_id).is("owner_token", null)
      .select("owner_token").maybeSingle();
    if (error) { log.warn?.("owner token: not saved:", error.message || error); return null; }
    if (data?.owner_token) return data.owner_token;
    const { data: again } = await supabase.from("small_business_profiles").select("owner_token").eq("business_id", profile.business_id).maybeSingle();
    return isOwnerTokenShape(again?.owner_token) ? again.owner_token : null;
  } catch (e) {
    log.warn?.("owner token: not saved:", e?.message || e);
    return null;
  }
}

/**
 * Where an owner link for this profile should go: the v2 page with the token,
 * or (v1 / no token) the legacy /preview landing. Used by the cold-email
 * redirect, text outreach and follow-up drafts so they agree.
 */
export async function ownerDestination(supabase, profile, slug, { m = null, claim = false, log } = {}) {
  const token = await ensureOwnerToken(supabase, profile, { log });
  if (token) return ownerPageUrl(slug, token, { m, claim });
  const mq = isUuid(m) ? `m=${encodeURIComponent(m)}` : "";
  return claim
    ? `${BASE}/${slug}?claim=1${mq ? `&${mq}` : ""}`
    : `${BASE}/${slug}/preview${mq ? `?${mq}` : ""}`;
}
