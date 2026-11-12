// api/_lib/page-ssr.js
// Server-side HTML for the content sections of a business page.
//
// This is the ONLY renderer for these sections. The server puts the content
// in the HTML (so crawlers and AI answer engines that don't run JavaScript
// see it), and public/scripts/profile.js no longer redraws them — it only
// adds behaviour (testimonial carousel, FAQ toggles) to this markup. Change a
// section's markup here, not in profile.html.
//
// One exception: when a business has no testimonials of its own, the browser
// may fill that slot with Google reviews after the page loads
// (testimonialsAside, mirrored in profile.js).
//
// A section with nothing in it is not in the HTML at all (no empty heading
// hidden with CSS): Areas We Serve, Recent Work, Before & After, Why Choose
// Us, What Clients Say and the FAQs each render only when they have content.

import { townsLine, isLocalRadius, callCtaLabel, offersFreeEstimates } from "./page-claims.js";
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

/** The "What Clients Say" aside. profile.js builds the same markup for Google reviews. */
export function testimonialsAside(innerHtml, count) {
  return `<aside class="why-sidebar" id="testimonialsWrap">
    <h2>What Clients Say</h2>
    <div class="testimonial-carousel" id="testimonialCarousel">
      <div class="testimonial-carousel-track" id="testimonialList" data-count="${Number(count) || 0}">${innerHtml}</div>
      <div class="carousel-nav" id="carouselNav" style="display:none;">
        <div class="carousel-dots" id="carouselDots"></div>
        <div class="carousel-arrows">
          <button class="carousel-arrow" id="carouselPrev" aria-label="Previous">&#8592;</button>
          <button class="carousel-arrow" id="carouselNext" aria-label="Next">&#8594;</button>
        </div>
      </div>
    </div>
  </aside>`;
}

function imageAttachments(p) {
  return (Array.isArray(p.attachments) ? p.attachments : [])
    .map(a => (typeof a === "string" ? { url: a } : a))
    .filter(a => a?.url && isImageUrl(a.url));
}

/**
 * @returns {Record<string,string>} template replacements for public/profile.html
 */
export function renderSections(p) {
  const out = {};

  // CTA wording: "free" only when the business offers free estimates.
  out["{{SSR_CALL_LABEL}}"] = esc(callCtaLabel(p));
  out["{{SSR_QUOTE_HEADING}}"] = offersFreeEstimates(p) ? "Get a free quote" : "Get a quote";

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
  // The map only for a business that works around a home base (isLocalRadius);
  // statewide, nationwide and online businesses keep the area chips alone.
  const mapSlots = isLocalRadius(p) ? `
    <!-- Map — Google Place ID takes priority, falls back to address -->
    <div id="serviceMapWrap" class="service-map-wrap hidden">
      <div id="serviceMap" class="service-map"></div>
    </div>
    <!-- Google Place map slot (used when place_id available) -->
    <div id="placesMapWrap" class="service-map-wrap hidden" style="margin-top:0.75rem;">
      <div id="map" style="width:100%;height:280px;border-radius:14px;overflow:hidden;"></div>
    </div>` : "";
  out["{{SSR_TOWNS_SECTION}}"] = towns.length ? `<div id="townsWrap">
  <section class="section" id="towns" style="border-bottom:1px solid #e8f0f8;">
    <h2>Areas We Serve</h2>
    <p class="towns-sub" id="townsSub">${esc(townsLine(p))}</p>
    <div id="townList" style="margin-bottom:1.25rem;">${out["{{SSR_TOWNS}}"]}</div>${mapSlots}
  </section>
</div>` : "";

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
  out["{{SSR_FAQS_SECTION}}"] = faqs.length ? `<div class="band" id="faqsBand">
<div class="faq-wrap" id="faqs" style="border-bottom:none;">
  <h2 class="faq-heading">Frequently Asked Questions</h2>
  <div class="faq-list" id="faqList">${out["{{SSR_FAQS}}"]}</div>
</div>
</div>` : "";

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

  // Why Choose Us + What Clients Say share a two-column section. With
  // neither, the section stays (hidden, no headings) only as the place the
  // browser puts Google reviews; #testimonialsSlot marks where they go.
  const whyHtml = why.length ? `<div class="why-main" id="whySection">
    <h2>Why Choose Us</h2>
    <ul class="why-list" id="why">${out["{{SSR_WHY}}"]}</ul>
  </div>` : "";
  const testimonialsHtml = testimonials.length
    ? testimonialsAside(out["{{SSR_TESTIMONIALS}}"], testimonials.length)
    : `<div id="testimonialsSlot" hidden></div>`;
  out["{{SSR_WHY_SECTION}}"] = `<section class="section why-with-testimonials${why.length || testimonials.length ? "" : " hidden"}" id="whyOuterSection">
  ${whyHtml}
  ${testimonialsHtml}
</section>`;

  // Recent Work and Before & After: only with photos. profile.js sets the
  // trade-specific gallery title and the call link.
  const photos = imageAttachments(p).slice(0, 12);
  out["{{SSR_GALLERY_SECTION}}"] = photos.length ? `<div class="gallery-section" id="gallerySection">
  <div class="gallery-header">
    <h2 id="galleryTitle">Recent Work</h2>
    <a href="#contact" class="gallery-cta-btn" id="galleryCtaBtn">Have a project in mind? →</a>
  </div>
  <div id="gallery" class="image-grid">${photos.map(a =>
    `<a href="${esc(a.url)}" target="_blank" rel="noopener"><img src="${esc(a.url)}" alt="${esc(a.filename || p.business_name || "Photo")}" loading="lazy" /></a>`).join("")}</div>
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
