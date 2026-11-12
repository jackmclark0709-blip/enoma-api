// Cold-email variant "b" (Nov 2026): copy that reads as different from the
// "I redesigned your website" emails owners now get from freelancers.
// Not a web-design pitch: a page that gets them calls, leads go only to them,
// $19.99/month with no per-lead fees and no contract, and a real person
// (Jack) keeps it updated.
//
// Variant "a" is the existing copy in outreach-email.js, unchanged. The split
// is 50/50 by prospect id (variantForProspect), stored on
// outreach_messages.variant and reported by v_outreach_variant_stats.
//
// Rules for this copy (tests/outreach-variant-b.test.js enforces them):
//   - Subjects: never "website", "redesign", "built you" or "free"; at most
//     45 characters after the business name is filled in.
//   - The opening line only states what the prospect row already knows
//     (trade we searched, the listing's town). Never invent facts.
//   - One link (the tracked preview landing link, m token as before), one ask.
//   - "free" only ever appears next to the price.
//   - No customer names, no "Google listing", no images.
//   - First email under 110 words, follow-ups under 70 (sign-off included,
//     footer not).
//   - The optional proof line comes only from ENOMA_PROOF_LINE, verbatim.
import crypto from "node:crypto";
import { escapeHtml } from "./email-html.js";
import { cleanBusinessName, trackedLinks, withUtm, buildOutreachIntro } from "./outreach-email.js";

export const SUBJECT_MAX = 45;
export const BANNED_SUBJECT_RE = /\b(websites?|redesign\w*|built you|free)\b/i;

export const PRICE_LINE = "First month free, then $19.99/month or $199/year. Cancel anytime.";
export const SIGNOFF_LINES = ["Jack", "I'm a real person, and I keep your page updated for you.", "Enoma · jack@enoma.io"];

// ── The split ─────────────────────────────────────────────────────────────
function seedBytes(id) {
  return crypto.createHash("sha256").update(String(id || "")).digest();
}

/** "a" or "b", stable for a prospect id (hash mod 2). */
export function variantForProspect(prospectId) {
  return seedBytes(prospectId)[0] % 2 === 1 ? "b" : "a";
}

/**
 * Variant B is on unless OUTREACH_VARIANT_B is "off"/"0"/"false" (the kill
 * switch: everyone gets "a" again, nothing else changes).
 */
export function variantBEnabled(env = process.env) {
  return !/^(off|0|false|no)$/i.test(String(env.OUTREACH_VARIANT_B ?? "").trim());
}

/** ENOMA_PROOF_LINE, trimmed; "" (off) when unset or blank. */
export function proofLineFromEnv(env = process.env) {
  return String(env.ENOMA_PROOF_LINE ?? "").trim();
}

// ── Subjects ──────────────────────────────────────────────────────────────
const SUBJECTS = {
  first: [
    (n) => `${n}: a page that gets you the call`,
    (n) => `Calls for ${n}, not shared leads`,
    (n) => `Quick question about ${n}'s Google traffic`,
  ],
  followup1: [
    (n) => `${n}: your page is still ready`,
    (n) => `Calls for ${n} go only to you`,
    (n) => `${n}: no per-lead fees, no contract`,
  ],
  followup2: [
    (n) => `Last note about ${n}'s page`,
    (n) => `${n}: should I take the page down?`,
    (n) => `Closing the loop on ${n}`,
  ],
};
// Used only when no form of the name fits (or the name itself holds a word
// the subject rules ban, e.g. "Free State Plumbing").
const SUBJECT_FALLBACK = {
  first: "A page that gets you the call",
  followup1: "Your page is still ready",
  followup2: "Last note about your page",
};
// Which seed byte picks the option, so each email in the sequence varies on
// its own.
const SUBJECT_SEED_BYTE = { first: 1, followup1: 2, followup2: 3 };

const DANGLING = new Set(["&", "and", "of", "the", "a", "an", "-", "–", "—", "+", "by", "at", "in", "for", "&amp;"]);

/** The name, then shorter forms of it ("Comfort Aire Heating & Cooling" -> "Comfort Aire Heating" -> "Comfort Aire" -> "Comfort"). */
export function nameForms(name) {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  const forms = [];
  for (let k = words.length; k >= 1; k--) {
    const w = words.slice(0, k);
    const last = w[w.length - 1].toLowerCase().replace(/[,.:;]+$/, "");
    if (DANGLING.has(last)) continue;
    const form = w.join(" ").replace(/[,.:;]+$/, "");
    if (form.length < 3) continue;
    forms.push(form);
  }
  return forms;
}

export function pickSubject(kind, businessName, prospectId) {
  const templates = SUBJECTS[kind];
  const start = seedBytes(prospectId)[SUBJECT_SEED_BYTE[kind]] % templates.length;
  const name = cleanBusinessName(businessName);
  if (name && !BANNED_SUBJECT_RE.test(name)) {
    for (const form of nameForms(name)) {
      for (let k = 0; k < templates.length; k++) {
        const s = templates[(start + k) % templates.length](form);
        if (s.length <= SUBJECT_MAX) return s;
      }
    }
  }
  return SUBJECT_FALLBACK[kind];
}

/** Every subject this prospect could get, for tests and review. */
export function allSubjectOptions(kind, businessName) {
  const name = cleanBusinessName(businessName);
  return SUBJECTS[kind].map(t => t(name));
}

// ── Opening line ──────────────────────────────────────────────────────────
// prospects.trade is the search term the daily pipeline used to find them
// (prospect-rotation.js TRADES), so "I was looking at plumbers around X" is
// literally how we found them. Unknown trades fall back to a line without one.
const TRADE_PLURALS = {
  "landscaping": "landscapers",
  "landscaper": "landscapers",
  "plumber": "plumbers",
  "plumbing": "plumbers",
  "hvac contractor": "HVAC companies",
  "hvac": "HVAC companies",
  "electrician": "electricians",
  "house cleaning service": "house cleaners",
  "cleaning service": "cleaning companies",
  "painting contractor": "painters",
  "painter": "painters",
  "roofing contractor": "roofers",
  "roofer": "roofers",
  "general contractor": "general contractors",
};

export function tradePlural(trade) {
  return TRADE_PLURALS[String(trade || "").trim().toLowerCase()] || null;
}

function placeName(city, state) {
  const c = String(city || "").trim();
  if (!c) return "";
  const s = String(state || "").trim();
  return /^[A-Z]{2}$/.test(s) ? `${c}, ${s}` : c;
}

export function openingLine({ business_name, trade, city, state }) {
  const name = cleanBusinessName(business_name);
  const where = placeName(city, state);
  const plural = tradePlural(trade);
  if (plural && where) return `I was looking at ${plural} around ${where} and came across ${name}.`;
  if (where) return `I came across ${name} while looking at local businesses around ${where}.`;
  return `I came across ${name} on Google.`;
}

export function whatItIsLine(businessName) {
  return `I put together a page for ${cleanBusinessName(businessName)} that's built to get you found on Google and turn visitors into calls. The leads go straight to you: no shared leads, no per-lead fees.`;
}

// ── First email ───────────────────────────────────────────────────────────
/**
 * Subject + the stored draft (greeting, opening line, what-it-is line).
 * Same shape as buildOutreachIntro, so it lives in prospects.draft_body.
 */
export function buildOutreachIntroB(prospect) {
  return {
    subject: pickSubject("first", prospect.business_name, prospect.id),
    body: `Hi there,\n\n${openingLine(prospect)}\n\n${whatItIsLine(prospect.business_name)}`,
    reason: "variant_b",
  };
}

function htmlShell(paragraphsHtml, footerHtml) {
  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#ffffff;">
<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#222222;max-width:560px;margin:0 auto;padding:24px 16px;">
${paragraphsHtml}
${footerHtml}
</div>
</body>
</html>`;
}

const p = (inner) => `<p style="margin:0 0 16px;">${inner}</p>`;
const signoffHtml = () => `<p style="margin:0 0 24px;">${SIGNOFF_LINES.map(escapeHtml).join("<br>")}</p>`;
const footerHtml = (mailingAddress, unsubscribeUrl) =>
  `<p style="margin:0;font-size:12px;color:#888888;border-top:1px solid #eeeeee;padding-top:12px;">${escapeHtml(mailingAddress)}<br><a href="${escapeHtml(unsubscribeUrl)}" style="color:#888888;">Unsubscribe</a></p>`;
const footerText = (mailingAddress, unsubscribeUrl) => `---\n${mailingAddress}\nDon't want these emails? ${unsubscribeUrl}`;
const boldYes = (s) => escapeHtml(s).replace(/&quot;yes&quot;/, "<strong>yes</strong>");

/**
 * The full first email around a variant-B intro: intro, optional proof line
 * (verbatim, right after the what-it-is line), the one tracked link, the ask
 * with the price, Jack's sign-off, the CAN-SPAM footer.
 */
export function buildOutreachEmailB({ intro, businessName, messageId, slug, unsubscribeUrl, mailingAddress, proofLine = "" }) {
  const links = trackedLinks(messageId, slug);
  const proof = String(proofLine || "").trim();
  const ask = `If you want it live, reply "yes" and it's yours. ${PRICE_LINE}`;
  const introText = String(intro || "").trim();
  const name = cleanBusinessName(businessName) || "your page";

  const text = [
    introText,
    ...(proof ? [proof] : []),
    `Take a look: ${links.page}`,
    ask,
    SIGNOFF_LINES.join("\n"),
    footerText(mailingAddress, unsubscribeUrl),
  ].join("\n\n");

  const introHtml = introText.split(/\n{2,}/).map(par => p(escapeHtml(par).replace(/\n/g, "<br>"))).join("\n");
  const html = htmlShell(
    [
      introHtml,
      ...(proof ? [p(escapeHtml(proof))] : []),
      p(`Take a look: <a href="${escapeHtml(links.page)}" style="color:#1a73e8;">${escapeHtml(name)} on Enoma</a>`),
      p(boldYes(ask)),
      signoffHtml(),
    ].join("\n"),
    footerHtml(mailingAddress, unsubscribeUrl)
  );
  return { text, html, links };
}

/**
 * Which first email a queued prospect gets. Template drafts (variant A's
 * buildOutreachIntro or B's buildOutreachIntroB, as prepare_outreach writes
 * them) follow the split; a draft Jack had rewritten by hand is sent exactly
 * as written and recorded with variant null, so it stays out of the A/B
 * numbers.
 * @returns {{ variant: "a"|"b"|null, subject: string, intro: string }}
 */
export function pickFirstEmail(prospect, { enabled = true } = {}) {
  const a = buildOutreachIntro(prospect);
  const b = buildOutreachIntroB(prospect);
  const stored = prospect.draft_body;
  if (stored && stored !== a.body && stored !== b.body) {
    return { variant: null, subject: prospect.draft_subject, intro: stored };
  }
  const v = enabled ? variantForProspect(prospect.id) : "a";
  return v === "b"
    ? { variant: "b", subject: b.subject, intro: b.body }
    : { variant: "a", subject: a.subject, intro: a.body };
}

// ── Follow-ups ────────────────────────────────────────────────────────────
// Own subjects (no "Re:"), per the variant-B brief; one link, one ask.
function followUpEmail({ kind, lines, businessName, prospectId, links, unsubscribeUrl, mailingAddress }) {
  const subject = pickSubject(kind, businessName, prospectId);
  const name = cleanBusinessName(businessName) || "your page";
  const [lead, linkLabel, ask] = lines;
  const text = [
    "Hi there,", lead, `${linkLabel} ${links.page}`, ask, SIGNOFF_LINES.slice(0, 2).join("\n"),
    footerText(mailingAddress, links.unsubscribe || unsubscribeUrl),
  ].join("\n\n");
  const html = htmlShell(
    [
      p("Hi there,"),
      p(escapeHtml(lead)),
      p(`${escapeHtml(linkLabel)} <a href="${escapeHtml(links.page)}" style="color:#1a73e8;">${escapeHtml(name)} on Enoma</a>`),
      p(boldYes(ask)),
      `<p style="margin:0 0 24px;">${SIGNOFF_LINES.slice(0, 2).map(escapeHtml).join("<br>")}</p>`,
    ].join("\n"),
    footerHtml(mailingAddress, links.unsubscribe || unsubscribeUrl)
  );
  return { subject, text, html, links };
}

/** First follow-up (3-10 days after the first email; timing unchanged). */
export function buildFollowUpEmailB({ businessName, prospectId, messageId, slug, unsubscribeUrl, mailingAddress }) {
  const name = cleanBusinessName(businessName) || "your business";
  return followUpEmail({
    kind: "followup1", businessName, prospectId, unsubscribeUrl, mailingAddress,
    links: trackedLinks(messageId, slug),
    lines: [
      `Following up on the page I put together for ${name}. It's built to get you calls from Google, and the leads go only to you, with no per-lead fees.`,
      "Here it is:",
      `Reply "yes" and it's live. ${PRICE_LINE}`,
    ],
  });
}

/** Second and last follow-up (timing unchanged; same UTM tagging as variant A). */
export function buildSecondFollowUpEmailB({ businessName, prospectId, messageId, slug, unsubscribeUrl, mailingAddress }) {
  const name = cleanBusinessName(businessName) || "your business";
  const base = trackedLinks(messageId, slug);
  const links = { ...base, page: withUtm(base.page), claim: withUtm(base.claim), unsubscribe: withUtm(unsubscribeUrl) };
  return followUpEmail({
    kind: "followup2", businessName, prospectId, unsubscribeUrl, mailingAddress, links,
    lines: [
      `Last note from me about ${name}'s page. If it's not for you, no problem: I'll take it down and won't email again.`,
      "It's here if you want another look:",
      `Reply "yes" to keep it live. ${PRICE_LINE}`,
    ],
  });
}

/** Words in the email body, greeting through sign-off (footer excluded; a URL is one word). */
export function bodyWordCount(text) {
  const body = String(text || "").split(/\n---\n/)[0];
  return body.split(/\s+/).filter(w => /[A-Za-z0-9$]/.test(w)).length;
}
