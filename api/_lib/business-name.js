// api/_lib/business-name.js
// Google business names often carry a tagline or a claim after the name:
// "Maynard Roofing /40 yrs Family Business", "Bilco Electric and Datacom -
// Security camera installations". The page shows the clean name, and the
// claims (years, family-owned, veteran-owned) become proof items cited to the
// Google listing (g), where the raw name still lives.
//
// Pure. Never strips a name below two words or down to the trade alone.

const str = v => (v == null ? "" : String(v).trim());

// What a stripped tail must look like to be a claim or a list of services,
// not part of the name.
const CLAIM_WORDS = /\b(\d+\s*\+?\s*(yrs?|years?)|since\s+(19|20)\d\d|est\.?\s*(19|20)\d\d|established\s+(19|20)\d\d|family|veteran|locally|owned|operated|licensed|insured|bonded|free\s+estimates?|installations?|services?|repairs?|specialists?|experts?|serving|cleaning|removal|residential|commercial|24\/7|emergency)\b/i;
// Separators that introduce a tagline. "&" and "and" never do.
const SEPARATORS = [/\s+\/\s*/, /\s*\/\s+/, /\s+[-–—|]\s+/, /\s*\|\s*/];
const TRADE_ONLY = /^(roofing|plumbing|electric(al)?|painting|landscaping|cleaning|paving|hvac|heating|cooling|contracting|construction|lawn care|services?)$/i;
const SMALL_WORDS = new Set(["and", "of", "the", "for", "in", "at", "on", "by", "with", "a", "an"]);

function words(s) { return str(s).split(/\s+/).filter(Boolean); }

/** "Arno Plumbing And Heating" → "Arno Plumbing and Heating". Acronyms and the first word stay. */
export function fixJoinCasing(name) {
  return words(name).map((w, i) => {
    if (i === 0) return w;
    const lower = w.toLowerCase();
    if (SMALL_WORDS.has(lower) && /^[A-Z][a-z]+$/.test(w)) return lower;
    return w;
  }).join(" ");
}

/** Claims a name tail makes: years in business, family / veteran owned. */
export function claimsFrom(text, now = new Date()) {
  const t = str(text);
  const out = [];
  const year = now.getFullYear();
  const yrs = t.match(/\b(\d{1,3})\s*\+?\s*(?:yrs?|years?)\b/i);
  const since = t.match(/\b(?:since|est\.?|established)\s+((?:19|20)\d\d)\b/i);
  if (yrs && Number(yrs[1]) > 0 && Number(yrs[1]) < 150) out.push({ kind: "years", value: Number(yrs[1]) });
  else if (since && Number(since[1]) <= year) out.push({ kind: "years", value: year - Number(since[1]), since: Number(since[1]) });
  if (/\bfamily[\s-]*(owned|business|run|operated)?\b/i.test(t)) out.push({ kind: "family" });
  if (/\bveteran[\s-]*owned\b/i.test(t)) out.push({ kind: "veteran" });
  return out;
}

/**
 * The name to show, and the claims its tail made.
 * → { name, raw, claims: [{ kind: "years"|"family"|"veteran", value? }] }
 */
export function cleanBusinessName(raw, { now = new Date() } = {}) {
  const r = str(raw).replace(/\s+/g, " ");
  if (!r) return { name: "", raw: "", claims: [] };
  let name = r;
  let tail = "";
  // Parenthetical tail: "Acme Roofing (Family Owned)".
  const paren = name.match(/^(.*\S)\s*\(([^)]*)\)\s*$/);
  if (paren && CLAIM_WORDS.test(paren[2])) { name = paren[1]; tail = paren[2]; }
  for (const sep of SEPARATORS) {
    const m = name.split(sep);
    if (m.length < 2) continue;
    const head = m[0].trim();
    const rest = m.slice(1).join(" ").trim();
    if (!CLAIM_WORDS.test(rest)) continue;
    if (words(head).length < 2 || TRADE_ONLY.test(head)) continue;
    name = head;
    tail = [tail, rest].filter(Boolean).join(" ");
    break;
  }
  name = fixJoinCasing(name.replace(/[\s,/|–—-]+$/, ""));
  return { name, raw: r, claims: tail ? claimsFrom(tail, now) : [] };
}
