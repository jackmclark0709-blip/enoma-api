// api/_lib/page-ssr.js
// Server-side HTML for the content sections of a business page.
//
// This is the ONLY renderer for these sections. The server puts the content
// in the HTML (so crawlers and AI answer engines that don't run JavaScript
// see it), and public/profile.html's script no longer redraws them — it only
// adds behaviour (testimonial carousel, FAQ toggles) to this markup. Change a
// section's markup here, not in profile.html.
//
// One exception: when a business has no testimonials of its own, the browser
// may fill that slot with Google reviews after the page loads.

const esc = s => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function parseMaybeJson(v) {
  if (Array.isArray(v) || (v && typeof v === "object")) return v;
  if (typeof v === "string") { try { return JSON.parse(v); } catch { return null; } }
  return null;
}

export function splitAbout(about) {
  const text = String(about || "").trim();
  if (!text) return { lead: "", body: "" };
  let paragraphs = text.split(/\n\n+/).map(s => s.trim()).filter(Boolean);
  if (paragraphs.length <= 1) paragraphs = text.split("\n").map(s => s.trim()).filter(Boolean);
  if (paragraphs.length >= 2) return { lead: paragraphs[0], body: paragraphs.slice(1).join("\n\n") };
  return { lead: text, body: "" };
}

// Mirrors the client's why_choose_us splitting.
export function splitWhy(why) {
  if (Array.isArray(why)) {
    return why.map(w => (typeof w === "string" ? w : [w?.title, w?.description].filter(Boolean).join(" — ")).trim()).filter(Boolean);
  }
  const text = String(why || "");
  let items = text.split("\n").map(s => s.trim()).filter(Boolean);
  if (items.length <= 1) {
    items = text.split(/\. |—|;/).map(s => s.trim().replace(/^[-•·]\s*/, "").replace(/\.\s*$/, "").trim()).filter(s => s.length > 4);
  }
  return items.map(i => i.replace(/^[-•·]\s*/, ""));
}

export function normalizeFaqs(faqs) {
  const list = parseMaybeJson(faqs) || [];
  return (Array.isArray(list) ? list : [])
    .map(f => ({ q: String(f?.q || f?.question || "").trim(), a: String(f?.a || f?.answer || "").trim() }))
    .filter(f => f.q && f.a);
}

/**
 * @returns {Record<string,string>} template replacements for public/profile.html
 */
export function renderSections(p) {
  const out = {};

  const about = splitAbout(p.about);
  out["{{SSR_ABOUT_LEAD}}"] = esc(about.lead);
  out["{{SSR_ABOUT_BODY}}"] = about.body.split(/\n\n+/).map(esc).join("<br><br>");
  out["{{SSR_ABOUT_BODY_HIDDEN}}"] = about.body ? "" : " hidden";

  const services = (parseMaybeJson(p.services) || []).filter(s => s && (s.service_name || s.name));
  out["{{SSR_SERVICES_INTRO}}"] = esc(p.services_intro || "");
  out["{{SSR_SERVICES_INTRO_HIDDEN}}"] = String(p.services_intro || "").trim() ? "" : " hidden";
  out["{{SSR_SERVICES_SECTION_HIDDEN}}"] = services.length ? "" : " hidden";
  // A service with a published spotlight page renders as a link to it.
  out["{{SSR_SERVICES}}"] = services.map((s, i) => {
    const tag = s.spotlight_url ? "a" : "div";
    const href = s.spotlight_url ? ` href="${esc(s.spotlight_url)}"` : "";
    const side = s.spotlight_url
      ? `<div class="service-price">${s.price ? `${esc(s.price)} ` : ""}<span class="service-more">Details →</span></div>`
      : (s.price ? `<div class="service-price">${esc(s.price)}</div>` : "");
    return `
      <${tag} class="service-card${i === 0 ? " service-card--primary" : ""}${s.spotlight_url ? " service-card--linked" : ""}"${href}>
        <h3>${esc(s.service_name || s.name)}</h3>
        ${s.service_description ? `<p>${esc(s.service_description)}</p>` : ""}
        ${side}
      </${tag}>`;
  }).join("");

  const towns = (parseMaybeJson(p.service_area) || []).filter(Boolean);
  out["{{SSR_TOWNS}}"] = towns.map(t => `<span class="town">${esc(t)}</span>`).join("");
  out["{{SSR_TOWNS_CLASS}}"] = towns.length ? "" : "hidden";

  const why = splitWhy(p.why_choose_us);
  out["{{SSR_WHY}}"] = why.map(i => `<li>${esc(i)}</li>`).join("");
  out["{{SSR_WHY_HIDDEN}}"] = why.length ? "" : " hidden";

  const faqs = normalizeFaqs(p.faqs);
  out["{{SSR_FAQS}}"] = faqs.map(f => `
      <div class="faq-item-wrapper">
        <button class="faq-item" type="button">
          <span class="faq-question">${esc(f.q)}</span>
          <span class="faq-icon">+</span>
        </button>
        <div class="faq-answer"><p>${esc(f.a)}</p></div>
      </div>`).join("");
  out["{{SSR_FAQS_CLASS}}"] = faqs.length ? "band" : "band hidden";

  const testimonials = (Array.isArray(p.testimonials) ? p.testimonials : []).filter(t => t?.quote);
  out["{{SSR_TESTIMONIALS}}"] = testimonials.map((t, i) => {
    const n = Math.min(5, Math.max(1, Math.round(Number(t.rating) || 5)));
    return `<div class="testimonial${i === 0 ? " active" : ""}" data-idx="${i}">
        <div class="testimonial-accent"></div>
        <span class="quote-mark">&#8220;</span>
        <div class="stars">${"★".repeat(n)}${"☆".repeat(5 - n)}</div>
        <p>${esc(t.quote)}</p>
        <div class="testimonial-author">
          <div class="testimonial-avatar">${esc((t.author || "?")[0].toUpperCase())}</div>
          <strong>${esc(t.author || "Customer")}</strong>${t.source === "google" ? '<span class="testimonial-source">— via Google</span>' : ""}
        </div>
      </div>`;
  }).join("");
  out["{{SSR_TESTIMONIALS_CLASS}}"] = testimonials.length ? "why-sidebar" : "why-sidebar hidden";
  out["{{SSR_TESTIMONIALS_COUNT}}"] = String(testimonials.length);

  return out;
}

/** schema.org FAQPage for the page's FAQs, or null when there are none. */
export function faqSchema(p, url) {
  const faqs = normalizeFaqs(p.faqs);
  if (!faqs.length) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    ...(url ? { "@id": `${url}#faqs` } : {}),
    mainEntity: faqs.map(f => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}
