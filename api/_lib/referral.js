// Referral attribution. public/scripts/ref-capture.js puts the ?ref= code
// from a referral link into the `enoma_ref` cookie; the API reads it here
// when a business is created or a preview page is claimed.
//
// Only codes that exist in public.referrers (and are active) count, so stray
// or made-up ?ref= values never land on a business. First touch wins: a
// business that already has referred_by is never re-attributed.

export const REF_COOKIE = "enoma_ref";
const CODE_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;

export function normalizeRefCode(value) {
  if (typeof value !== "string") return null;
  let v;
  try { v = decodeURIComponent(value); } catch { return null; }
  v = v.trim().toLowerCase();
  return CODE_RE.test(v) ? v : null;
}

export function readRefCookie(cookieHeader) {
  if (!cookieHeader || typeof cookieHeader !== "string") return null;
  for (const part of cookieHeader.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    if (part.slice(0, i).trim() === REF_COOKIE) return normalizeRefCode(part.slice(i + 1));
  }
  return null;
}

// Stamps businesses.referred_by when the request carries a valid, active
// referral code and the business isn't already attributed. Never throws:
// referral tracking must not break signup or claiming.
export async function attributeReferral(supabase, req, businessId) {
  try {
    const code = readRefCookie(req?.headers?.cookie);
    if (!code || !businessId) return null;

    const { data: referrer } = await supabase
      .from("referrers").select("code").eq("code", code).eq("active", true).maybeSingle();
    if (!referrer) return null;

    const { data, error } = await supabase
      .from("businesses")
      .update({ referred_by: code, referred_at: new Date().toISOString() })
      .eq("id", businessId)
      .is("referred_by", null)
      .select("id");
    if (error) { console.warn("referral attribution failed:", error.message); return null; }
    return data?.length ? code : null;
  } catch (e) {
    console.warn("referral attribution failed:", e?.message || e);
    return null;
  }
}
