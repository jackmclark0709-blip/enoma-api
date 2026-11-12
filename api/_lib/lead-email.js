// api/_lib/lead-email.js
// What a company-page / Service Spotlight lead turns into (api/send-contact.js,
// standard path): the contact_submissions row, the owner's email and Jack's
// alert. Pure, so tests/quote-form.test.js can check them without Supabase or
// Resend. Old-style leads (name + email + message, no quote answers) render
// the same as before; quote-form leads get the labelled summary line on top
// ("Needs: … · When: … · Where: … · Prefers: …") and may be phone-only.

import { answersSummary, answersEmailHtml } from "./quote-form.js";
import { emailLogoHtml } from "./email-html.js";

// Visitor-typed text goes into email HTML: escape it so nobody can plant
// links or markup in an owner's inbox.
const esc = v => String(v ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/**
 * The contact_submissions row. `email` and `message` are NOT NULL columns, so a
 * phone-only quote request stores "" for email and the summary line as its
 * message when the visitor wrote nothing in "Anything else?". `answers` (jsonb,
 * supabase/migrations/20261112_lead_answers.sql) is only set for quote-form leads.
 */
export function leadRow({ businessId, slug, name, email, phone, subject, message, source, answers }) {
  const row = {
    business_id: businessId || null,
    slug: slug || null,
    name,
    email: email || "",
    phone: phone || null,
    subject: subject || null,
    message: message || answersSummary(answers) || "(no message)",
    source: source || "profile_page",
    is_read: false,
  };
  if (answers) row.answers = answers;
  return row;
}

/** { replyTo, subject, html } for the business owner's lead email. */
export function ownerLeadEmail({ bName, name, email, phone, subject, message, answers }) {
  const tel = String(phone || "").replace(/[^\d+]/g, "");
  return {
    replyTo: email || undefined,
    subject: `New message from ${name} via your Enoma page`,
    html: `
          <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a;">
            <div style="padding:0 0 14px;">${emailLogoHtml()}</div>
            <div style="background:#0a1628;padding:24px 28px;border-radius:12px 12px 0 0;">
              <p style="margin:0;font-size:13px;font-weight:700;color:rgba(220,238,255,0.7);letter-spacing:0.1em;text-transform:uppercase;">New message</p>
              <p style="margin:6px 0 0;font-size:20px;font-weight:800;color:#fff;">${esc(bName)}</p>
            </div>
            <div style="background:#fff;border:1px solid #e4edf5;border-top:none;border-radius:0 0 12px 12px;padding:24px 28px;">
              ${answersEmailHtml(answers)}
              <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
                <tr><td style="padding:6px 0;font-size:13px;color:#7ab3e0;width:80px;">From</td><td style="padding:6px 0;font-size:13px;font-weight:600;color:#0a1628;">${esc(name)}</td></tr>
                ${email ? `<tr><td style="padding:6px 0;font-size:13px;color:#7ab3e0;">Email</td><td style="padding:6px 0;font-size:13px;color:#0a1628;"><a href="mailto:${esc(email)}" style="color:#3882dc;">${esc(email)}</a></td></tr>` : ""}
                ${phone ? `<tr><td style="padding:6px 0;font-size:13px;color:#7ab3e0;">Phone</td><td style="padding:6px 0;font-size:13px;color:#0a1628;">${esc(phone)}</td></tr>` : ""}
                ${subject ? `<tr><td style="padding:6px 0;font-size:13px;color:#7ab3e0;">Topic</td><td style="padding:6px 0;font-size:13px;color:#0a1628;">${esc(subject)}</td></tr>` : ""}
              </table>
              ${message ? `<div style="background:#f7faff;border:1px solid #e4edf5;border-radius:10px;padding:16px 18px;margin-bottom:20px;">
                <p style="margin:0;font-size:14px;line-height:1.65;color:#374151;">${esc(message).replace(/\n/g, "<br>")}</p>
              </div>` : ""}
              ${email
                ? `<a href="mailto:${esc(email)}?subject=Re: Your enquiry to ${esc(bName)}" style="display:inline-block;background:#C84A12;color:#fff;padding:10px 20px;border-radius:999px;font-weight:700;font-size:13px;text-decoration:none;">Reply to ${esc(name)} →</a>`
                : `<a href="tel:${esc(tel)}" style="display:inline-block;background:#C84A12;color:#fff;padding:10px 20px;border-radius:999px;font-weight:700;font-size:13px;text-decoration:none;">Call ${esc(name)} at ${esc(phone)} →</a>`}
              <p style="margin:20px 0 0;font-size:12px;color:#9ca3af;">This message was sent through your Enoma business page. <a href="https://enoma.io/dashboard" style="color:#7ab3e0;">View your dashboard →</a></p>
            </div>
          </div>
        `,
  };
}

/** { subject, html } for Jack's [Lead] alert. */
export function jackLeadAlert({ bName, name, email, phone, message, answers }) {
  const summary = answersSummary(answers);
  // Old-style leads show the email, as before; quote requests may be phone-only.
  const contact = answers ? [email, phone].filter(Boolean).join(" · ") : email;
  return {
    subject: `[Lead] ${name} contacted ${bName}`,
    html: `${summary ? `<p><b>${esc(summary)}</b></p>` : ""}<p><b>${esc(name)}</b> (${esc(contact)}) sent a message to <b>${esc(bName)}</b> via their Enoma page.</p>${message || !answers ? `<p>${esc(message)}</p>` : ""}`,
  };
}
