// api/_lib/profile-fields.js
// The owner's optional answers about their business (migration
// 20261114_profile_upgrade), read from the create/edit form
// (api/generate-business.js) and cleaned before they're stored. The page
// prints these as facts, so anything unclear is stored as "not given" (null)
// rather than guessed. Pure; tested in tests/profile-upgrade.test.js.

import { normalizeSteps } from "./page-copy.js";

export const OWNER_FACT_FIELDS = [
  "years_in_business", "license_number", "is_insured", "offers_free_estimates",
  "response_time", "owner_blurb", "how_it_works",
];

const text = (v, max) => {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
};

/** "yes"/"true"/"1"/"on" → true, "no"/"false"/"0" → false, anything else → null (not answered). */
export function yesNo(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (["yes", "true", "1", "on", "y"].includes(s)) return true;
  if (["no", "false", "0", "off", "n"].includes(s)) return false;
  return null;
}

/** Whole years, 0–150, else null. Accepts "12", "12 years", "12+". */
export function cleanYears(v) {
  const m = String(v ?? "").match(/\d{1,3}/);
  if (!m) return null;
  const n = Number(m[0]);
  return n >= 0 && n <= 150 ? n : null;
}

/** "MA-12345" / "#12345" → "MA-12345" / "12345". Letters, digits, - and space. */
export function cleanLicense(v) {
  const s = String(v ?? "").replace(/^\s*(lic(ense)?\.?\s*)?(no\.?|number|#)?\s*/i, "").replace(/[^A-Za-z0-9\- ]/g, "").trim();
  return s ? s.slice(0, 40) : null;
}

/** "within 2 hours" — the answer to "How fast do you usually reply?". */
export function cleanResponseTime(v) {
  const s = text(v, 60);
  if (!s) return null;
  return s.replace(/^(we\s+)?(usually |typically )?(reply|replies|respond|responds)\s+/i, "").replace(/\.$/, "") || null;
}

/** Steps from the form: JSON [{title,text}] or three "Title — text" lines. Exactly 3 or null. */
export function cleanSteps(v) {
  let list = v;
  if (typeof v === "string") {
    const t = v.trim();
    if (!t) return null;
    try { list = JSON.parse(t); } catch {
      list = t.split("\n").map(l => l.trim()).filter(Boolean).map(l => {
        const [title, ...rest] = l.split(/\s+[—–-]\s+/);
        return { title, text: rest.join(" — ") };
      });
    }
  }
  const steps = normalizeSteps(list);
  return steps.length ? steps : null;
}

/**
 * The owner-fact columns to write. `get(name)` returns the submitted value
 * (undefined when the field wasn't sent); a field that wasn't sent keeps
 * the existing value, a field sent empty clears it.
 */
export function ownerFactsFromForm(get, existing = {}) {
  const pick = (name, clean) => {
    const v = get(name);
    return v === undefined ? (existing?.[name] ?? null) : clean(v);
  };
  return {
    years_in_business: pick("years_in_business", cleanYears),
    license_number: pick("license_number", cleanLicense),
    is_insured: pick("is_insured", yesNo),
    offers_free_estimates: pick("offers_free_estimates", yesNo),
    response_time: pick("response_time", cleanResponseTime),
    owner_blurb: pick("owner_blurb", v => {
      const s = String(v ?? "").trim().replace(/\n{3,}/g, "\n\n");
      return s ? s.slice(0, 700) : null;
    }),
  };
}

/** Per-service extras the owner can add: "From $150", "Same week". */
export function cleanServiceExtras(s = {}) {
  const out = {};
  const from = text(s.price_from, 30);
  const turn = text(s.turnaround, 40);
  if (from) out.price_from = from.replace(/^from\s+/i, "");
  if (turn) out.turnaround = turn;
  return out;
}

/** Only https URLs (our storage bucket, or a public image link). */
export function cleanPhotoUrl(v) {
  const s = String(v ?? "").trim();
  return /^https:\/\/[^\s"'<>]+$/i.test(s) ? s.slice(0, 500) : null;
}
