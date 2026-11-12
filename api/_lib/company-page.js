// api/_lib/company-page.js
// The company page (enoma.io/<business>): every block, rendered on the
// server from the business's own data, then filled into public/profile.html.
// api/p.js only fetches (profile, published spotlights, approved reviews,
// billing state) and calls renderCompanyPage; this file is pure so each
// block can be tested with and without data (tests/company-page.test.js).
//
// The rule for every block: it renders from real data or it isn't in the
// HTML at all. Nothing is invented to fill a block. The only text that isn't
// the business's own is the "How it works" fallback, which describes the
// process and says nothing about the business.
//
// Top to bottom: sticky header · hero (headline, proof line, Call + Get a
// quote, Open now / Usually replies, best photo) · trust strip · services ·
// how it works · recent work · reviews · meet the owner · about · areas
// served · FAQ · quote form · footer · mobile bottom bar.

import { renderSections, normalizeProfile, faqSchema } from "./page-ssr.js";
import { personaFor, isStrongRating } from "./page-style.js";
import {
  offersFreeEstimates, responseTime, isLocalRadius, openSchedule, parseAvailability,
  showEmergencyBadge, callCtaLabel,
} from "./page-claims.js";
import { heroPhoto, visibleAttachments, isImageUrl } from "./photo-kinds.js";
import { linkServicesToSpotlights } from "./spotlight-render.js";
import { renderQuoteForm } from "./quote-form.js";
import { normalizeSteps } from "./page-copy.js";

export const MAX_REVIEWS = 6;

const esc = s => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const slugify = t => String(t || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const list = v => {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") { try { const j = JSON.parse(v); return Array.isArray(j) ? j : []; } catch { return []; } }
  return [];
};
const towns = p => list(p?.service_area).map(t => String(t || "").trim()).filter(Boolean);

// ── Links ────────────────────────────────────────────────────────────────
export const telHref = phone => `tel:${String(phone || "").replace(/[^\d+]/g, "")}`;
export const smsHref = phone => `sms:${String(phone || "").replace(/[^\d+]/g, "")}`;
export const serviceSlug = name => slugify(name);
/** The business's Google Maps listing (also "Read all on Google"). */
export function googleMapsUrl(p) {
  if (!p?.google_place_id) return null;
  const q = encodeURIComponent(p.business_name || "business");
  return `https://www.google.com/maps/search/?api=1&query=${q}&query_place_id=${encodeURIComponent(p.google_place_id)}`;
}
const httpUrl = u => (/^https?:\/\//i.test(String(u || "").trim()) ? String(u).trim() : null);

// ── Facts ────────────────────────────────────────────────────────────────

/**
 * The hero's proof line, only from fields that exist, in this order:
 * Google rating, license, insured, years, free estimates.
 * The rating shows only when it helps (isStrongRating: 4.5+ from 5+ reviews).
 */
export function proofFacts(p = {}) {
  const out = [];
  const rating = Number(p.average_rating), count = Number(p.review_count);
  if (isStrongRating(rating, count)) out.push({ key: "rating", text: `★ ${rating.toFixed(1)} · ${count} Google reviews` });
  const lic = String(p.license_number || "").trim();
  if (lic) {
    const st = /^[A-Za-z]{2}$/.test(String(p.state || "").trim()) ? String(p.state).trim().toUpperCase() : "";
    out.push({ key: "license", text: `Licensed${st ? ` ${st}` : ""} #${lic.replace(/^#/, "")}` });
  }
  if (p.is_insured === true) out.push({ key: "insured", text: "Insured" });
  const years = Number(p.years_in_business);
  if (Number.isInteger(years) && years > 0) out.push({ key: "years", text: `${years} year${years === 1 ? "" : "s"} in business` });
  if (offersFreeEstimates(p)) out.push({ key: "free_estimates", text: "Free estimates" });
  return out;
}

/** "Serving Agawam, Westfield and Feeding Hills" / "+ 4 more towns" / "Serving customers nationwide". */
export function areaSummary(p = {}) {
  const t = towns(p);
  if (!t.length) return "";
  if (t.some(x => /nation-?wide|national|across the (us|u\.s\.|country)|united states/i.test(x))) return "Serving customers nationwide";
  if (t.length <= 3) return `Serving ${t.length === 1 ? t[0] : `${t.slice(0, -1).join(", ")} and ${t[t.length - 1]}`}`;
  return `Serving ${t.slice(0, 2).join(", ")} + ${t.length - 2} more`;
}

/** Trust strip: the proof facts plus the service-area summary. Hidden under 2. */
export function trustFacts(p = {}) {
  const facts = proofFacts(p);
  const area = areaSummary(p);
  if (area) facts.push({ key: "area", text: area });
  return facts.length >= 2 ? facts : [];
}

/** Hero picture: best work photo, else a before/after "after", else the owner, else the real logo. */
export function heroVisual(p = {}) {
  const name = p.business_name || "";
  const work = heroPhoto(p);
  if (work && !/\.gif(\?.*)?$/i.test(work)) return { url: work, kind: "work", alt: `Recent work by ${name}`.trim() };
  const ba = list(p.before_after_images).find(i => i && i.after && isImageUrl(i.after));
  if (ba) return { url: ba.after, kind: "work", alt: ba.caption || `Recent work by ${name}`.trim() };
  if (httpUrl(p.owner_photo_url)) return { url: p.owner_photo_url, kind: "owner", alt: p.owner_name || `Owner of ${name}` };
  if (httpUrl(p.logo_url)) return { url: p.logo_url, kind: "logo", alt: `${name} logo` };
  return null;
}

/**
 * Reviews: Google quotes already stored in testimonials plus approved Enoma
 * review-request reviews (review_submissions), newest first, at most 6.
 * Approved reviews are also copied into testimonials when approved, so they
 * are matched by quote and keep their date. Undated quotes follow dated ones.
 */
export function mergeReviews(testimonials, approved = [], max = MAX_REVIEWS) {
  const norm = q => String(q || "").replace(/\s+/g, " ").trim().toLowerCase();
  const out = [];
  const seen = new Set();
  const dated = (Array.isArray(approved) ? approved : [])
    .filter(r => r && String(r.quote || "").trim())
    .map(r => ({ quote: String(r.quote).trim(), author: r.name || "Customer", rating: Number(r.rating) || null, source: "enoma", at: r.decided_at || r.created_at || null }))
    .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
  for (const r of dated) { if (!seen.has(norm(r.quote))) { seen.add(norm(r.quote)); out.push(r); } }
  for (const t of Array.isArray(testimonials) ? testimonials : []) {
    const quote = String(t?.quote || t?.text || "").trim();
    if (!quote || seen.has(norm(quote))) continue;
    seen.add(norm(quote));
    out.push({ quote, author: t.author || t.name || "Customer", rating: Number(t.rating) || null, source: t.source || null, at: null });
  }
  return out.slice(0, max);
}

/** "Usually replies within 2 hours" or "". */
export function replyLine(p = {}) {
  const rt = responseTime(p);
  return rt ? `Usually replies ${rt}` : "";
}

// "How it works" when the owner hasn't written their own. Process only: no
// times, prices or promises about the business. Step 2 uses the owner's own
// reply time when they gave one.
const STEP_ONE = {
  landscaping: "Tell us about your yard and what you'd like done.",
  plumbing: "Tell us what's going on and where the problem is.",
  hvac: "Tell us what your system is doing.",
  electrical: "Tell us what you need wired, fixed or installed.",
  cleaning: "Tell us about the space and how often you'd like it cleaned.",
  painting: "Tell us which rooms or surfaces need painting.",
  contractor: "Tell us about the project.",
  default: "Tell us what you need.",
};
export function defaultSteps(p = {}) {
  const rt = responseTime(p);
  return [
    { title: "Tell us the job", text: STEP_ONE[personaFor(p.primary_category)] || STEP_ONE.default },
    { title: `Get a quote ${rt || "fast"}`, text: "We look at what you need and send you a price." },
    { title: "We do the work", text: "Pick a time that works for you." },
  ];
}
export function howItWorksSteps(p = {}) {
  const own = normalizeSteps(p.how_it_works);
  return own.length ? own : defaultSteps(p);
}

/** Paying customers' pages never pitch Enoma; previews and unpaid pages do. */
export function showEnomaPitch(p = {}, { paying = false } = {}) {
  return p.is_claimed === false || !paying;
}

// ── Schema (LocalBusiness) ───────────────────────────────────────────────
const BUSINESS_TYPE_MAP = {
  landscaping: "LandscapingBusiness", plumber: "Plumber", plumbing: "Plumber", hvac: "HVACBusiness",
  heating: "HVACBusiness", electrician: "Electrician", locksmith: "Locksmith", painter: "HousePainter",
  roofing: "RoofingContractor", cleaning: "CleaningService",
};
export const schemaTypeFor = c => BUSINESS_TYPE_MAP[String(c || "").toLowerCase().trim()] || "LocalBusiness";
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const hhmm = m => `${String(Math.floor(Math.min(m, 1439) / 60)).padStart(2, "0")}:${String(Math.min(m, 1439) % 60).padStart(2, "0")}`;

/** schema.org opening hours from the hours text, or undefined when we can't read them. */
export function openingHoursSpecification(p = {}) {
  const s = parseAvailability(p.hero_availability);
  if (!s) return undefined;
  return [{
    "@type": "OpeningHoursSpecification",
    dayOfWeek: s.days.map(d => `https://schema.org/${DAY_NAMES[d]}`),
    opens: hhmm(s.open),
    closes: s.close >= 1440 ? "23:59" : hhmm(s.close),
  }];
}

export function sameAsLinks(p = {}) {
  const urls = new Set();
  if (httpUrl(p.website)) urls.add(httpUrl(p.website));
  const sl = p.social_links;
  const vals = Array.isArray(sl) ? sl : sl && typeof sl === "object" ? Object.values(sl) : [];
  vals.forEach(u => { if (httpUrl(u)) urls.add(httpUrl(u)); });
  const maps = googleMapsUrl(p);
  if (maps) urls.add(maps);
  return [...urls];
}

const priceNumber = t => { const m = String(t || "").replace(/,/g, "").match(/\$\s*(\d+(?:\.\d+)?)/); return m ? Number(m[1]) : null; };

/**
 * LocalBusiness JSON-LD. Only facts the page itself shows. No
 * aggregateRating: Google doesn't allow it for a business's own reviews
 * on its own site, and the page shows the real Google rating as text.
 */
export function localBusinessSchema(p = {}, { canonical, image } = {}) {
  const services = list(p.services).filter(s => s && (s.service_name || s.name));
  const areas = towns(p);
  const local = isLocalRadius(p);
  const schema = {
    "@context": "https://schema.org",
    "@type": schemaTypeFor(p.primary_category),
    "@id": canonical,
    name: p.business_name || undefined,
    url: canonical,
    telephone: p.phone || undefined,
    image: image || undefined,
    address: (p.address || p.city || p.state) ? {
      "@type": "PostalAddress",
      ...(p.address ? { streetAddress: p.address } : {}),
      ...(p.city ? { addressLocality: p.city } : {}),
      ...(p.state ? { addressRegion: p.state } : {}),
      addressCountry: "US",
    } : undefined,
    areaServed: areas.length ? areas.map(name => ({ "@type": local ? "City" : "AdministrativeArea", name })) : undefined,
    openingHoursSpecification: openingHoursSpecification(p),
    sameAs: sameAsLinks(p),
    makesOffer: services.length ? services.map(s => {
      const min = priceNumber(s.price_from);
      return {
        "@type": "Offer",
        itemOffered: {
          "@type": "Service",
          name: s.service_name || s.name,
          ...(s.service_description ? { description: s.service_description } : {}),
          ...(areas.length && local ? { areaServed: areas.map(name => ({ "@type": "City", name })) } : {}),
        },
        ...(min != null ? { priceSpecification: { "@type": "PriceSpecification", minPrice: min, priceCurrency: "USD" } } : {}),
      };
    }) : undefined,
  };
  if (!schema.sameAs.length) delete schema.sameAs;
  return JSON.parse(JSON.stringify(schema)); // drop undefined
}

// ── Blocks ───────────────────────────────────────────────────────────────
const ICON = {
  call: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.08 4.18 2 2 0 0 1 4.06 2h3a2 2 0 0 1 2 1.72c.12.86.31 1.7.57 2.5a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.58-1.09a2 2 0 0 1 2.11-.45c.8.26 1.64.45 2.5.57A2 2 0 0 1 22 16.92z"/></svg>',
  sms: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  quote: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><path d="M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2H9V5z"/><path d="M9 12h6M9 16h6"/></svg>',
  check: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>',
  star: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>',
  pin: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
};
const FACT_ICON = { rating: ICON.star, area: ICON.pin };

function headerBlock(p) {
  const name = esc(p.business_name || "");
  const brand = httpUrl(p.logo_url)
    ? `<img id="navLogo" class="nav-logo" src="${esc(p.logo_url)}" alt="${name}" width="140" height="30" />`
    : `<span id="businessName" class="brand-text">${name}</span>`;
  const phone = String(p.phone || "").trim();
  return `<header class="contact-strip site-header" id="contactStrip">
  <div class="contact-strip-inner">
    <a class="contact-brand" href="#top" aria-label="${name}, back to top">${brand}</a>
    <nav class="contact-actions" aria-label="Contact ${name}">
      ${phone ? `<a class="contact-pill call" href="${esc(telHref(phone))}" data-contact="call">${ICON.call}Call</a>
      <a class="contact-pill text" href="${esc(smsHref(phone))}" data-contact="sms">${ICON.sms}Text</a>` : ""}
      <a class="contact-pill quote" href="#contact" data-contact="quote">${ICON.quote}Get a quote</a>
    </nav>
  </div>
</header>`;
}

/** The hero's buttons: Call (or the owner's own email / link CTA) + Get a quote. */
function heroButtons(p) {
  const phone = String(p.phone || "").trim();
  const type = String(p.primary_cta_type || "").toLowerCase();
  let first = "";
  if (phone) {
    first = `<a class="primary-cta" href="${esc(telHref(phone))}" data-contact="call">${ICON.call}Call ${esc(phone)}</a>`;
  } else if (type === "email" && p.primary_cta_value) {
    first = `<a class="primary-cta" href="mailto:${esc(p.primary_cta_value)}" data-contact="email">${esc(p.primary_cta_label || "Email us")}</a>`;
  } else if (type === "link" && httpUrl(p.primary_cta_value)) {
    first = `<a class="primary-cta" href="${esc(p.primary_cta_value)}" data-contact="link" rel="noopener">${esc(p.primary_cta_label || "Visit our site")}</a>`;
  }
  const quote = `<a class="${first ? "secondary-btn" : "primary-cta"}" href="#contact" data-contact="quote">Get a quote</a>`;
  return `<div class="hero-actions" id="primaryAction">${first}${quote}</div>`;
}

function heroBlock(p) {
  const visual = heroVisual(p);
  const proof = proofFacts(p);
  const reply = replyLine(p);
  const schedule = openSchedule(p);
  const status = [
    schedule ? `<span class="hero-open" id="heroOpen" data-open-schedule='${esc(JSON.stringify(schedule))}' hidden>● Open now</span>` : "",
    showEmergencyBadge(p) ? `<span class="hero-emergency">Emergency service</span>` : "",
    reply ? `<span class="hero-reply">${esc(reply)}</span>` : "",
  ].filter(Boolean);
  const fig = visual ? `
      <figure class="hero-visual hero-visual--${visual.kind}" id="heroVisual">
        <img src="${esc(visual.url)}" alt="${esc(visual.alt)}" fetchpriority="high" decoding="async" />
      </figure>` : "";
  return `<section class="hero-wrapper${visual ? " hero--split" : " hero--text"}" aria-labelledby="heroHeadline">
  <div class="hero-grain" aria-hidden="true"></div>
  <div class="hero-inner">
    <div class="hero-layout">
      <div class="hero-content">
        <h1 id="heroHeadline" class="hero-headline">${esc(p.hero_headline || p.business_name || "")}</h1>
        ${p.hero_tagline ? `<p id="tagline" class="hero-tagline">${esc(p.hero_tagline)}</p>` : ""}
        ${proof.length ? `<p class="proof-line" id="proofLine">${proof.map(f => `<span class="proof-fact proof-fact--${f.key}">${esc(f.text)}</span>`).join('<span class="proof-sep" aria-hidden="true"> · </span>')}</p>` : ""}
        ${heroButtons(p)}
        ${status.length ? `<p class="hero-status" id="heroStatus">${status.join("")}</p>` : ""}
      </div>${fig}
    </div>
  </div>
</section>`;
}

function trustBlock(p) {
  const facts = trustFacts(p);
  if (!facts.length) return "";
  return `<section class="trust-strip" id="trustStrip" aria-label="Why customers choose ${esc(p.business_name || "us")}">
  <ul class="trust-strip__list">${facts.map(f => `<li class="trust-fact trust-fact--${f.key}">${FACT_ICON[f.key] || ICON.check}<span>${esc(f.text.replace(/^★\s*/, ""))}</span></li>`).join("")}</ul>
</section>`;
}

function serviceCard(s, i) {
  const name = s.service_name || s.name || "";
  const slug = serviceSlug(name);
  const meta = [
    s.price_from ? `From ${String(s.price_from).replace(/^from\s+/i, "")}` : (s.price ? String(s.price) : ""),
    s.turnaround ? String(s.turnaround) : "",
  ].filter(Boolean);
  return `
      <article class="service-card${i === 0 ? " service-card--primary" : ""}" id="service-${esc(slug)}">
        <h3>${esc(name)}</h3>
        ${s.service_description ? `<p class="service-desc">${esc(s.service_description)}</p>` : ""}
        ${meta.length ? `<p class="service-meta">${meta.map(m => `<span>${esc(m)}</span>`).join("")}</p>` : ""}
        <div class="service-actions">
          <a class="service-quote" href="#quote?service=${esc(slug)}" data-service-quote="${esc(slug)}">Get a quote</a>
          ${s.spotlight_url ? `<a class="service-more" href="${esc(s.spotlight_url)}" data-spotlight-link="${esc(slug)}">More about ${esc(name)} →</a>` : ""}
        </div>
      </article>`;
}

function servicesBlock(p, { spotlights = [], slug }) {
  const { services, unmatched } = linkServicesToSpotlights(list(p.services).filter(s => s && (s.service_name || s.name)), spotlights, slug);
  if (!services.length && !unmatched.length) return "";
  const more = unmatched.length
    ? `<p class="spotlight-links">Learn more: ${unmatched.map(sl =>
      `<a href="/${encodeURIComponent(slug)}/${encodeURIComponent(sl.service_slug)}" data-spotlight-link="${esc(sl.service_slug)}">${esc(sl.service_name || sl.service_slug)} →</a>`).join(" ")}</p>`
    : "";
  return `<section class="section services-section" id="servicesSection" aria-labelledby="servicesHeading">
  <h2 id="servicesHeading">Services</h2>
  ${p.services_intro ? `<p id="services-intro" class="services-intro">${esc(p.services_intro)}</p>` : ""}
  <div id="services-grid" class="service-grid">${services.map(serviceCard).join("")}
  </div>
  ${more}
</section>`;
}

function howBlock(p) {
  const steps = howItWorksSteps(p);
  return `<section class="section how-section" id="howItWorks" aria-labelledby="howHeading">
  <h2 id="howHeading">How it works</h2>
  <ol class="how-steps">${steps.map((s, i) => `
    <li class="how-step"><span class="how-step__n" aria-hidden="true">${i + 1}</span><div><h3>${esc(s.title)}</h3>${s.text ? `<p>${esc(s.text)}</p>` : ""}</div></li>`).join("")}
  </ol>
</section>`;
}

const GALLERY_TITLES = {
  landscaping: "Recent lawn and garden work", plumbing: "Recent projects", electrical: "Recent electrical work",
  hvac: "Recent HVAC work", cleaning: "Recent cleaning work", contractor: "Recent projects", painting: "Recent paint work",
};

function workBlock(p, sections) {
  const gallery = sections["{{SSR_GALLERY_SECTION}}"];
  const ba = sections["{{SSR_BA_SECTION}}"];
  if (!gallery && !ba) return "";
  const title = GALLERY_TITLES[personaFor(p.primary_category)] || "Recent work";
  return `<div class="work-block" id="recentWork">${gallery.replace(">Recent Work<", `>${esc(title)}<`)}${ba}</div>`;
}

function reviewsBlock(p, approved) {
  const reviews = mergeReviews(p.testimonials, approved);
  const rating = Number(p.average_rating), count = Number(p.review_count);
  const strong = isStrongRating(rating, count);
  const maps = googleMapsUrl(p);
  if (!reviews.length && !strong) return "";
  const summary = strong
    ? `<p class="reviews-summary"><span class="reviews-summary__stars" aria-hidden="true">★★★★★</span> <strong>${rating.toFixed(1)}</strong> from ${count} Google reviews</p>`
    : "";
  return `<section class="section reviews-section" id="testimonialsWrap" aria-labelledby="reviewsHeading">
  <h2 id="reviewsHeading">What customers say</h2>
  ${summary}
  ${reviews.length ? `<ul class="review-grid" id="testimonialList">${reviews.map(r => {
    const n = r.rating ? Math.min(5, Math.max(1, Math.round(r.rating))) : 0;
    return `
    <li class="review-card">
      ${n ? `<p class="stars" aria-label="${n} out of 5 stars">${"★".repeat(n)}${"☆".repeat(5 - n)}</p>` : ""}
      <blockquote><p>${esc(r.quote)}</p></blockquote>
      <p class="review-author">${esc(r.author)}${r.source === "google" ? ' <span class="testimonial-source">via Google</span>' : ""}</p>
    </li>`;
  }).join("")}
  </ul>` : ""}
  ${maps && (strong || reviews.some(r => r.source === "google")) ? `<p class="reviews-more"><a href="${esc(maps)}" target="_blank" rel="noopener">Read all on Google →</a></p>` : ""}
</section>`;
}

function ownerBlock(p) {
  const blurb = String(p.owner_blurb || "").trim();
  if (!blurb) return "";
  const first = String(p.owner_name || "").trim().split(/\s+/)[0];
  const photo = httpUrl(p.owner_photo_url);
  return `<section class="section owner-section" id="meetOwner" aria-labelledby="ownerHeading">
  <div class="owner-card${photo ? " owner-card--photo" : ""}">
    ${photo ? `<img class="owner-photo" src="${esc(photo)}" alt="${esc(p.owner_name || "The owner")}" loading="lazy" width="160" height="160" />` : ""}
    <div>
      <h2 id="ownerHeading">${first ? `Meet ${esc(first)}` : "Meet the owner"}</h2>
      ${blurb.split(/\n\n+/).map(par => `<p>${esc(par)}</p>`).join("")}
    </div>
  </div>
</section>`;
}

const SOCIAL_LABEL = { facebook: "Facebook", instagram: "Instagram", twitter: "X (Twitter)", linkedin: "LinkedIn", google: "Google", youtube: "YouTube", tiktok: "TikTok", nextdoor: "Nextdoor", yelp: "Yelp" };

function aboutBlock(p, sections) {
  const lead = sections["{{SSR_ABOUT_LEAD}}"];
  const body = sections["{{SSR_ABOUT_BODY}}"];
  const why = sections["{{SSR_WHY}}"];
  const sl = p.social_links && typeof p.social_links === "object" && !Array.isArray(p.social_links) ? p.social_links : {};
  const socials = Object.entries(sl).filter(([, u]) => httpUrl(u));
  if (!lead && !why && !socials.length) return "";
  return `<section class="section about-section" id="aboutSection" aria-labelledby="aboutHeading">
  <h2 id="aboutHeading">About ${esc(p.business_name || "us")}</h2>
  ${lead ? `<p id="about-lead" class="about-lead">${lead}</p>` : ""}
  ${body ? `<p id="about-body" class="about-body">${body}</p>` : ""}
  ${why ? `<div class="why-main" id="whySection"><h3>Why choose us</h3><ul class="why-list" id="why">${why}</ul></div>` : ""}
  ${socials.length ? `<p class="social-strip" id="socialLinks">${socials.map(([k, u]) =>
    `<a class="social-link" href="${esc(u)}" target="_blank" rel="noopener">${esc(SOCIAL_LABEL[k] || k)}</a>`).join("")}</p>` : ""}
</section>`;
}

function areasBlock(p, sections) {
  const html = sections["{{SSR_TOWNS_SECTION}}"];
  if (!html) return "";
  const phone = String(p.phone || "").trim();
  const textUs = phone
    ? `<p class="areas-text-us">Not sure we cover you? <a href="${esc(smsHref(phone))}" data-contact="sms">Text us your town.</a></p>`
    : "";
  return html.replace("</section>", `${textUs}\n  </section>`);
}

/** Non-image files the owner uploaded (menus, price sheets): links. */
function resourcesBlock(p) {
  const files = (Array.isArray(p.attachments) ? p.attachments : [])
    .map(a => (typeof a === "string" ? { url: a } : a))
    .filter(a => a && httpUrl(a.url) && !isImageUrl(a.url));
  if (!files.length) return "";
  const label = a => a.label || a.filename || decodeURIComponent(String(a.url).split("/").pop().split("?")[0]) || "Resource";
  return `<section class="section" id="attachments" aria-labelledby="resourcesHeading">
  <h2 id="resourcesHeading">Resources</h2>
  <ul id="attachmentList">${files.map(a => `<li><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(label(a))}</a></li>`).join("")}</ul>
</section>`;
}

function hoursText(p) { return String(p.hero_availability || "").trim().replace(/\.+$/, ""); }

function footerBlock(p, { paying = false } = {}) {
  const lic = String(p.license_number || "").trim();
  const rows = [
    hoursText(p) ? `<p><span class="footer-label">Hours</span> ${esc(hoursText(p))}</p>` : "",
    String(p.address || "").trim() ? `<p><span class="footer-label">Address</span> ${esc(p.address)}</p>` : "",
    p.phone ? `<p><span class="footer-label">Phone</span> <a href="${esc(telHref(p.phone))}" data-contact="call">${esc(p.phone)}</a></p>` : "",
    lic ? `<p><span class="footer-label">License</span> #${esc(lic.replace(/^#/, ""))}</p>` : "",
  ].filter(Boolean);
  const pitch = showEnomaPitch(p, { paying });
  return `<footer class="site-footer" id="siteFooter">
  <div class="site-footer__inner">
    <div class="site-footer__biz">
      <p class="site-footer__name">${esc(p.business_name || "")}</p>
      ${rows.join("\n      ")}
    </div>
    <p class="site-footer__enoma">
      <a href="https://enoma.io" target="_blank" rel="noopener" class="enoma-powered">Powered by Enoma</a>
      ${pitch ? `<a href="https://enoma.io" target="_blank" rel="noopener" class="enoma-pitch" id="enomaPitch">Get your own website →</a>` : ""}
    </p>
  </div>
</footer>`;
}

function mobileBar(p) {
  const phone = String(p.phone || "").trim();
  return `<nav class="mobile-call-bar" id="mobileCallBar" aria-label="Contact">
  ${phone ? `<a class="mcb-call" href="${esc(telHref(phone))}" data-contact="mobile_bar_call">${ICON.call}Call</a>
  <a class="mcb-text" href="${esc(smsHref(phone))}" data-contact="sms">${ICON.sms}Text</a>` : ""}
  <a class="mcb-quote" href="#contact" data-contact="mobile_bar_quote">${ICON.quote}Get a quote</a>
</nav>`;
}

/**
 * All template replacements for public/profile.html except the <head> ones
 * api/p.js computes (title, OG image, brand colours). `p` is the raw profile.
 * ctx: { slug, spotlights, approvedReviews, paying, quoteStatus }
 */
export function renderBlocks(rawProfile, ctx = {}) {
  const p = normalizeProfile(rawProfile || {});
  p.attachments = visibleAttachments(p);
  const slug = ctx.slug || p.username || "";
  const sections = renderSections(p);
  return {
    "{{BLOCK_HEADER}}": headerBlock(p),
    "{{BLOCK_HERO}}": heroBlock(p),
    "{{BLOCK_TRUST}}": trustBlock(p),
    "{{BLOCK_SERVICES}}": servicesBlock(p, { spotlights: ctx.spotlights || [], slug }),
    "{{BLOCK_HOW}}": howBlock(p),
    "{{BLOCK_WORK}}": workBlock(p, sections),
    "{{BLOCK_REVIEWS}}": reviewsBlock(p, ctx.approvedReviews || []),
    "{{BLOCK_OWNER}}": ownerBlock(p),
    "{{BLOCK_ABOUT}}": aboutBlock(p, sections),
    "{{BLOCK_AREAS}}": areasBlock(p, sections),
    "{{BLOCK_FAQ}}": sections["{{SSR_FAQS_SECTION}}"],
    "{{BLOCK_RESOURCES}}": resourcesBlock(p),
    "{{SSR_QUOTE_HEADING}}": sections["{{SSR_QUOTE_HEADING}}"],
    "{{BLOCK_FOOTER}}": footerBlock(p, { paying: !!ctx.paying }),
    "{{BLOCK_MOBILE_BAR}}": mobileBar(p),
    // Last: business text above is never re-read as a placeholder after it.
    "{{QUOTE_FORM}}": renderQuoteForm(rawProfile || {}, { returnPath: `/${slug}`, status: ctx.quoteStatus || "", trackContactClick: true }),
  };
}

/** The data profile.js reads (window.__PROFILE__): behaviour only, no markup. */
export function clientProfile(rawProfile = {}) {
  const p = normalizeProfile(rawProfile);
  return {
    business_id: p.business_id || null,
    username: p.username || null,
    business_name: p.business_name || "",
    primary_category: p.primary_category || null,
    phone: p.phone || null,
    logo_url: p.logo_url || null,
    is_claimed: p.is_claimed,
    google_place_id: p.google_place_id || null,
    address: p.address || null,
    city: p.city || null,
    state: p.state || null,
    service_area: towns(p),
    is_local_radius: isLocalRadius(p),
    open_schedule: openSchedule(p),
    before_after_images: list(p.before_after_images).filter(i => i && i.before && i.after),
    attachments: visibleAttachments(p),
    hero_availability: p.hero_availability || null,
    hero_response_time: p.hero_response_time || null,
    call_cta_label: callCtaLabel(p),
    // page-checklist.js (owner view of an unclaimed preview)
    services: list(p.services).map(s => ({ service_name: s.service_name })),
    average_rating: p.average_rating ?? null,
    testimonials: (p.testimonials || []).map(() => ({ quote: 1 })),
    images: p.images || null,
    owner_blurb: p.owner_blurb ? 1 : null,
    response_time: p.response_time || null,
    license_number: p.license_number ? 1 : null,
    is_insured: p.is_insured ?? null,
    offers_free_estimates: p.offers_free_estimates ?? null,
  };
}

/**
 * Fill public/profile.html. ctx: { head: {placeholder: html}, slug,
 * canonical, image, spotlights, approvedReviews, paying, quoteStatus }.
 */
export function renderCompanyPage(template, rawProfile, ctx = {}) {
  const p = rawProfile || {};
  const schema = localBusinessSchema(normalizeProfile(p), { canonical: ctx.canonical, image: ctx.image });
  const faq = faqSchema(normalizeProfile(p), ctx.canonical);
  const json = o => JSON.stringify(o).replace(/<\//g, "<\\/");
  const replacements = {
    ...(ctx.head || {}),
    "{{PROFILE_JSON}}": json(clientProfile(p)),
    "{{LOCAL_BUSINESS_SCHEMA}}": json(schema),
    "{{FAQ_SCHEMA_TAG}}": faq ? `  <script type="application/ld+json">${json(faq)}</script>` : "",
    ...renderBlocks(p, ctx),
  };
  let html = template;
  for (const [needle, value] of Object.entries(replacements)) html = html.split(needle).join(value ?? "");
  return html;
}
