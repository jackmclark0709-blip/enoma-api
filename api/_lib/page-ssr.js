// api/_lib/page-ssr.js
// Server-side HTML for some content sections of a company page: About text,
// Why choose us lines, Areas served (+ map slots), FAQs, the photo gallery
// and the before/after slots. api/_lib/company-page.js places these and
// renders the rest (header, hero, services, reviews, owner, footer).
//
// The server puts the content in the HTML (so crawlers and AI answer
// engines that don't run JavaScript see it); public/scripts/profile.js only
// adds behaviour (FAQ toggles, maps, sliders). A section with nothing in it
// is not in the HTML at all (no empty heading hidden with CSS).

import { townsLine, isLocalRadius, offersFreeEstimates, callCtaLabel } from "./page-claims.js";
import { isImageUrl } from "./photo-kinds.js";

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

function imageAttachments(p) {
  return (Array.isArray(p.attachments) ? p.attachments : [])
    .map(a => (typeof a === "string" ? { url: a } : a))
    .filter(a => a?.url && isImageUrl(a.url));
}

/**
 * @returns {Record<string,string>} section HTML for api/_lib/company-page.js
 */
export function renderSections(p) {
  const out = {};

  // "free" only when the business says it offers free estimates.
  out["{{SSR_QUOTE_HEADING}}"] = offersFreeEstimates(p) ? "Get a free quote" : "Get a quote";

  const about = splitAbout(p.about);
  out["{{SSR_ABOUT_LEAD}}"] = esc(about.lead);
  out["{{SSR_ABOUT_BODY}}"] = about.body.split(/\n\n+/).map(esc).join("<br><br>");

  const towns = (parseMaybeJson(p.service_area) || []).filter(Boolean);
  // The map only for a business that works around a home base (isLocalRadius);
  // statewide, nationwide and online businesses keep the area chips alone.
  const mapSlots = isLocalRadius(p) ? `
    <div id="serviceMapWrap" class="service-map-wrap hidden"><div id="serviceMap" class="service-map"></div></div>
    <div id="placesMapWrap" class="service-map-wrap hidden"></div>` : "";
  out["{{SSR_TOWNS_SECTION}}"] = towns.length ? `<div id="townsWrap">
  <section class="section" id="towns" aria-labelledby="townsHeading">
    <h2 id="townsHeading">Areas We Serve</h2>
    <p class="towns-sub" id="townsSub">${esc(townsLine(p))}</p>
    <div id="townList">${towns.map(t => `<span class="town">${esc(t)}</span>`).join("")}</div>${mapSlots}
  </section>
</div>` : "";

  out["{{SSR_WHY}}"] = splitWhy(p.why_choose_us).map(i => `<li>${esc(i)}</li>`).join("");

  const faqs = normalizeFaqs(p.faqs);
  out["{{SSR_FAQS_SECTION}}"] = faqs.length ? `<div class="band" id="faqsBand">
<section class="faq-wrap" id="faqs" aria-labelledby="faqHeading">
  <h2 class="faq-heading" id="faqHeading">Frequently Asked Questions</h2>
  <div class="faq-list" id="faqList">${faqs.map(f => `
    <div class="faq-item-wrapper">
      <button class="faq-item" type="button">
        <span class="faq-question">${esc(f.q)}</span>
        <span class="faq-icon" aria-hidden="true">+</span>
      </button>
      <div class="faq-answer"><p>${esc(f.a)}</p></div>
    </div>`).join("")}</div>
</section>
</div>` : "";

  // Recent work and Before & After: only with photos. company-page.js sets
  // the trade's gallery title; profile.js the call link and the sliders.
  const photos = imageAttachments(p).slice(0, 12);
  out["{{SSR_GALLERY_SECTION}}"] = photos.length ? `<div class="gallery-section" id="gallerySection">
  <div class="gallery-header">
    <h2 id="galleryTitle">Recent Work</h2>
    <a href="#contact" class="gallery-cta-btn" id="galleryCtaBtn">Have a project in mind? →</a>
  </div>
  <div id="gallery" class="image-grid">${photos.map(a =>
    `<a href="${esc(a.url)}" target="_blank" rel="noopener"><img src="${esc(a.url)}" alt="${esc(a.filename || `Work by ${p.business_name || "the business"}`)}" loading="lazy" /></a>`).join("")}</div>
</div>` : "";
  const ba = (Array.isArray(p.before_after_images) ? p.before_after_images : []).filter(i => i && i.before && i.after);
  out["{{SSR_BA_SECTION}}"] = ba.length ? `<div class="ba-section" id="baSection">
  <div class="ba-header">
    <h2>Before &amp; After</h2>
  </div>
  <div id="baList" class="ba-list"></div>
</div>` : "";

  return out;
}

/**
 * normalizeProfile — standardize polymorphic fields before sending to client.
 *
 * The DB schema allows some fields to be stored as either a plain string
 * OR a JSON object/array (depending on how the record was created).
 * The frontend JS renderer only handles the string format for why_choose_us
 * and expects {q,a} or {question,answer} keys for faqs.
 * This function normalizes everything so the renderer always gets a consistent shape.
 * Rows written before the generator used one schema (faqs as {question, answer},
 * why_choose_us as an array, a "Call for a Free Estimate" label) still render.
 */
export function normalizeProfile(p) {
  if (!p) return p;
  const out = { ...p };

  // ── why_choose_us ──
  // Accept: string | [{title,description}] | [{title}] | any array
  // Emit:   newline-separated string
  if (Array.isArray(out.why_choose_us)) {
    out.why_choose_us = out.why_choose_us
      .map(item => {
        if (typeof item === "string") return item.trim();
        if (item && typeof item === "object") {
          const title = item.title || item.name || "";
          const desc  = item.description || item.text || "";
          return desc ? `${title} — ${desc}` : title;
        }
        return String(item);
      })
      .filter(Boolean)
      .join("\n");
  }

  // ── faqs ──
  // Accept: [{question,answer}] | [{q,a}] | JSON string of either
  // Emit:   [{q, a}] array (what the renderer uses)
  if (out.faqs != null) out.faqs = normalizeFaqs(out.faqs);

  // ── primary CTA label ──
  // The generator used to store "Call for a Free Estimate" whether or not the
  // business offers one. On unclaimed previews (AI copy nobody has approved)
  // only offersFreeEstimates() may say free. A claimed page's label is the
  // owner's own wording ("Call Steve for a Free Estimate") and is left alone.
  if (out.is_claimed === false && out.primary_cta_label && /\bfree\b/i.test(out.primary_cta_label) && !offersFreeEstimates(out)) {
    const type = String(out.primary_cta_type || "call").toLowerCase();
    out.primary_cta_label = type === "call" || type === "phone"
      ? callCtaLabel(out)
      : out.primary_cta_label.replace(/\bfree,?\s+(no[- ]obligation\s+)?/i, "").replace(/^\w/, c => c.toUpperCase()).trim();
  }

  // ── testimonials ──
  // Accept: [{quote,author}] | [{text,name}] | string
  // Emit:   [{quote, author}] array
  if (Array.isArray(out.testimonials)) {
    out.testimonials = out.testimonials.map(t => {
      if (!t || typeof t !== "object") return null;
      return {
        quote:  t.quote  || t.text    || t.review || "",
        author: t.author || t.name    || t.reviewer || "Customer",
        ...(t.rating ? { rating: t.rating } : {}),
        ...(t.source ? { source: t.source } : {}),
      };
    }).filter(t => t && t.quote);
  }

  // ── services ──
  // Normalize price: strip "Call for quote" if present — renderer shows it,
  // but it's visually cleaner to omit the redundant label
  if (Array.isArray(out.services)) {
    out.services = out.services.map(s => ({
      ...s,
      service_name: s.service_name || s.name || "",
      service_description: s.service_description || s.description || "",
      price: (s.price === "Call for quote" || s.price === "call for quote") ? "" : (s.price || ""),
    }));
  }

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
