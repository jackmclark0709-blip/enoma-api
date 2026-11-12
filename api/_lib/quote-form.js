// api/_lib/quote-form.js
// The multi-step quote form on every customer page (public/profile.html via
// api/p.js) and Service Spotlight page (public/spotlight.html via
// spotlight-render.js). One component, two places.
//
// The server renders all four steps as ONE plain form (fieldsets, radios,
// checkboxes) that posts to /api/send-contact, so it works with JavaScript
// off. public/scripts/quote-form.js then turns it into a step-by-step form
// (one fieldset at a time) and submits it with fetch, same endpoint.
//
// Also here: cleaning the answers on the server and the labelled summary line
// that goes at the top of the owner's lead email and Jack's alert
// ("Needs: Spring cleanup, Mulching · When: This week · Where: Agawam · Prefers: Text").
// Pure functions, no network, no DB (tests/quote-form.test.js).
//
// Step 3 depends on the business: on-site trades ask "Where's the job?";
// a business whose work isn't at the customer's address (no trade persona, or
// a nationwide service area) asks for the visitor's company instead, which
// reaches the owner as "Company: ..." (askForCompany).

import { personaFor } from "./page-style.js";

const esc = s => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export const MAX_SERVICE_CHIPS = 8;
export const MAX_TOWN_CHIPS = 8;
export const SOMETHING_ELSE = "Something else";

export const TIMING_OPTIONS = [
  { value: "asap", label: "As soon as possible" },
  { value: "this_week", label: "This week" },
  { value: "this_month", label: "This month" },
  { value: "just_prices", label: "Just getting prices" },
];
// Short labels for the summary line / dashboard ("When: This week").
const TIMING_SHORT = { asap: "ASAP", this_week: "This week", this_month: "This month", just_prices: "Just getting prices" };

export const PREFERENCE_OPTIONS = [
  { value: "text", label: "Text me", short: "Text" },
  { value: "call", label: "Call me", short: "Call" },
  { value: "email", label: "Email me", short: "Email" },
];

const slugify = t => String(t || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

function parseMaybeJson(v) {
  if (Array.isArray(v) || (v && typeof v === "object")) return v;
  if (typeof v === "string") { try { return JSON.parse(v); } catch { return null; } }
  return null;
}

/** Service names for step 1, from the same list as #services-grid. */
export function serviceChoices(profile, preselect) {
  const names = [];
  const seen = new Set();
  const add = n => {
    const name = String(n || "").trim();
    const key = slugify(name);
    if (!name || !key || seen.has(key) || name.toLowerCase() === SOMETHING_ELSE.toLowerCase()) return;
    seen.add(key);
    names.push(name);
  };
  // A spotlight's own service always gets a chip, first, even if the company
  // page lists it under a slightly different name.
  if (preselect) add(preselect);
  for (const s of parseMaybeJson(profile?.services) || []) add(s?.service_name || s?.name);
  return names.slice(0, MAX_SERVICE_CHIPS);
}

/** Service-area towns offered as chips on step 3 (empty when there are none). */
export function townChoices(profile) {
  const towns = (parseMaybeJson(profile?.service_area) || []).map(t => String(t || "").trim()).filter(Boolean);
  return [...new Set(towns)].slice(0, MAX_TOWN_CHIPS);
}

/**
 * True when step 3 should ask for the visitor's company rather than where the
 * job is: the business's category has no trade persona (personaFor() is
 * "default"), or its service area includes "Nationwide".
 */
export function askForCompany(profile) {
  const areas = (parseMaybeJson(profile?.service_area) || []).map(t => String(t || ""));
  // No category at all is unknown, not "not a trade": keep the job question.
  const category = String(profile?.primary_category || "").trim();
  return (!!category && personaFor(category) === "default") || areas.some(a => /nationwide/i.test(a));
}

/** "How should Mike reach you?" — owner's first name, else the business name. */
export function reachName(profile) {
  const first = String(profile?.owner_name || "").trim().split(/\s+/)[0];
  return first || String(profile?.business_name || "").trim() || "we";
}

/**
 * Normalise what a visitor sent (JSON from the stepped form, or
 * form-urlencoded from the no-JS form) into
 *   { services: string[], timing, location, preference[, company] }
 * Returns null when the submission carries no quote-form answers at all
 * (old cached pages, other sources) so nothing changes for them.
 */
export function cleanAnswers(body = {}) {
  const list = v => (Array.isArray(v) ? v : v == null || v === "" ? [] : [v]);
  const text = (v, max) => String(Array.isArray(v) ? v[0] ?? "" : v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const services = [...new Set(list(body.services).map(s => text(s, 80)).filter(Boolean))].slice(0, MAX_SERVICE_CHIPS + 1);
  const timingRaw = text(body.timing, 40);
  const timing = TIMING_OPTIONS.some(o => o.value === timingRaw) ? timingRaw : null;
  const location = text(body.location, 80) || text(body.location_town, 80) || null;
  const prefRaw = text(body.contact_pref, 20);
  const preference = PREFERENCE_OPTIONS.some(o => o.value === prefRaw) ? prefRaw : null;
  const company = text(body.company, 120) || null;
  if (!services.length && !timing && !location && !preference && !company && body.quote_form == null) return null;
  return { services, timing, location, preference, ...(company ? { company } : {}) };
}

/** Labelled pairs for the summary, in order, skipping blanks. */
export function answerLabels(a) {
  if (!a) return [];
  const out = [];
  if (a.services?.length) out.push(["Needs", a.services.join(", ")]);
  if (a.timing) out.push(["When", TIMING_SHORT[a.timing] || a.timing]);
  if (a.location) out.push(["Where", a.location]);
  if (a.company) out.push(["Company", a.company]);
  if (a.preference) out.push(["Prefers", PREFERENCE_OPTIONS.find(o => o.value === a.preference)?.short || a.preference]);
  return out;
}

/** "Needs: Spring cleanup, Mulching · When: This week · Where: Agawam · Prefers: Text" (or "Company: Acme Labs" in place of Where) */
export function answersSummary(a) {
  return answerLabels(a).map(([k, v]) => `${k}: ${v}`).join(" · ");
}

/** The summary as an email block (escaped), for the top of a lead email. "" when empty. */
export function answersEmailHtml(a) {
  const rows = answerLabels(a);
  if (!rows.length) return "";
  return `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:14px 16px;margin:0 0 18px;">
                <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#166534;letter-spacing:0.06em;text-transform:uppercase;">Quote request</p>
                <p style="margin:0;font-size:14px;line-height:1.6;color:#0a1628;">${rows.map(([k, v]) => `<strong>${esc(k)}:</strong> ${esc(v)}`).join(" &middot; ")}</p>
              </div>`;
}

/**
 * The form's HTML. Options:
 *   slug, businessId     where the lead goes (also sent by JS)
 *   source, subject      kept as today (spotlight: "spotlight:<slug>" / "<Service> request")
 *   preselect            spotlight's service name: checked chip, JS starts on step 2
 *   returnPath           where the no-JS form lands after posting (same page)
 *   status               "sent" | "error" from ?sent= after a no-JS post
 *   submitLabel          button text on step 4
 *   trackContactClick    profile page only: also log contact_click on submit, as before
 */
export function renderQuoteForm(profile, opts = {}) {
  const p = profile || {};
  const services = serviceChoices(p, opts.preselect);
  const preKey = slugify(opts.preselect);
  const company = askForCompany(p);
  const towns = company ? [] : townChoices(p);
  const phone = String(p.phone || "").trim();
  const tel = phone.replace(/[^\d+]/g, "");
  const startStep = opts.preselect && services.length ? 2 : 1;
  const submitLabel = opts.submitLabel || "Send my request";
  const hidden = (n, v) => (v == null || v === "" ? "" : `<input type="hidden" name="${n}" value="${esc(v)}" />`);
  const chip = (type, name, value, label, checked) =>
    `<label class="qf-chip"><input type="${type}" name="${name}" value="${esc(value)}"${checked ? " checked" : ""} /><span>${esc(label)}</span></label>`;

  const status = opts.status === "sent"
    ? `<p class="qf-done" role="status">✓ Thanks! Your request was sent. ${esc(p.business_name || "We")} will be in touch shortly.</p>`
    : opts.status === "error"
      ? `<p class="qf-error" role="alert">Something went wrong sending that.${phone ? ` Please call <a href="tel:${esc(tel)}">${esc(phone)}</a>.` : " Please try again."}</p>`
      : "";

  return `<div class="quote-form-wrap" id="quoteFormWrap">
  ${phone ? `<a class="qf-call" href="tel:${esc(tel)}" data-qf-call><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.08 4.18 2 2 0 0 1 4.06 2h3a2 2 0 0 1 2 1.72c.12.86.31 1.7.57 2.5a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.58-1.09a2 2 0 0 1 2.11-.45c.8.26 1.64.45 2.5.57A2 2 0 0 1 22 16.92z"/></svg>Call ${esc(phone)}</a>
  <p class="qf-or">or get a quote in 4 quick steps</p>` : ""}
  ${status}
  <form class="quote-form" id="contactForm" action="/api/send-contact" method="post" novalidate
    data-quote-form data-slug="${esc(p.username || opts.slug || "")}" data-start-step="${startStep}" data-page-type="${opts.preselect ? "spotlight" : "company"}"${opts.trackContactClick ? " data-track-contact-click" : ""}>
    <!-- Honeypot: hidden from people; bots that fill it are ignored (api/send-contact.js) -->
    <input name="website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0" />
    <input type="hidden" name="quote_form" value="1" />
    ${hidden("business_id", p.business_id || opts.businessId)}
    ${hidden("slug", p.username || opts.slug)}
    ${hidden("source", opts.source)}
    ${hidden("subject", opts.subject)}
    ${hidden("return_path", opts.returnPath)}
    <div class="qf-head">
      <p class="qf-progress" id="qfProgress" aria-live="polite"></p>
      <button type="button" class="qf-back" id="qfBack" hidden>← Back</button>
    </div>
    <p class="qf-status" id="contactStatus" role="status" aria-live="polite"></p>

    <fieldset class="qf-step" data-step="1">
      <legend tabindex="-1">What do you need?</legend>
      <p class="qf-hint">Pick all that apply.</p>
      <div class="qf-chips">
        ${services.map(s => chip("checkbox", "services", s, s, preKey && slugify(s) === preKey)).join("\n        ")}
        ${chip("checkbox", "services", SOMETHING_ELSE, SOMETHING_ELSE, false)}
      </div>
      <button type="button" class="qf-next" data-next>Next →</button>
    </fieldset>

    <fieldset class="qf-step" data-step="2" data-single>
      <legend tabindex="-1">When do you need it?</legend>
      <div class="qf-chips qf-chips--stack">
        ${TIMING_OPTIONS.map(o => chip("radio", "timing", o.value, o.label, false)).join("\n        ")}
      </div>
    </fieldset>

    ${company ? `<fieldset class="qf-step" data-step="3" data-optional>
      <legend tabindex="-1">Your company or organization <span>(optional)</span></legend>
      <label class="qf-label" for="qfCompany">Company name</label>
      <input class="qf-input" id="qfCompany" name="company" autocomplete="organization" maxlength="120" />
      <button type="button" class="qf-next" data-next>Next →</button>
    </fieldset>` : `<fieldset class="qf-step" data-step="3">
      <legend tabindex="-1">Where's the job?</legend>
      ${towns.length ? `<div class="qf-chips" data-town-chips>
        ${towns.map(t => chip("radio", "location_town", t, t, false)).join("\n        ")}
      </div>` : ""}
      <label class="qf-label" for="qfLocation">${towns.length ? "Or type your town or ZIP" : "Town or ZIP"}</label>
      <input class="qf-input" id="qfLocation" name="location" autocomplete="postal-code" placeholder="e.g. ${esc(towns[0] || p.city || "your town")} or 01001" maxlength="80" />
      <button type="button" class="qf-next" data-next>Next →</button>
    </fieldset>`}

    <fieldset class="qf-step" data-step="4">
      <legend tabindex="-1">How should ${esc(reachName(p))} reach you?</legend>
      <label class="qf-label" for="qfName">Your name</label>
      <input class="qf-input" id="qfName" name="name" autocomplete="name" required maxlength="120" />
      <label class="qf-label" for="qfPhone">Phone</label>
      <input class="qf-input" id="qfPhone" name="phone" type="tel" autocomplete="tel" maxlength="40" aria-describedby="qfReachHint" />
      <label class="qf-label" for="qfEmail">Email</label>
      <input class="qf-input" id="qfEmail" name="email" type="email" autocomplete="email" maxlength="200" aria-describedby="qfReachHint" />
      <p class="qf-hint" id="qfReachHint">Phone or email is fine, you don't need both.</p>
      <div class="qf-pref" role="group" aria-label="Best way to reach you">
        <div class="qf-chips">
          ${PREFERENCE_OPTIONS.map(o => chip("radio", "contact_pref", o.value, o.label, false)).join("\n          ")}
        </div>
      </div>
      <label class="qf-label" for="qfMessage">Anything else? <span>(optional)</span></label>
      <textarea class="qf-input" id="qfMessage" name="message" rows="3" maxlength="4000"></textarea>
      <button type="submit" class="qf-submit">${esc(submitLabel)}</button>
    </fieldset>
  </form>
</div>`;
}

/** Safe same-site return path for the no-JS form: "/slug" or "/slug/service". */
export function safeReturnPath(v, slug) {
  const s = String(v || "");
  if (/^\/[a-z0-9-]+(\/[a-z0-9-]+)?$/i.test(s)) return s;
  return slug && /^[a-z0-9-]+$/i.test(slug) ? `/${slug}` : "/";
}
