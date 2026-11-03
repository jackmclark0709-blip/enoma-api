// api/_lib/spotlight-render.js
// Turns a service_spotlights row into HTML for public/spotlight.html. Every
// block renders server-side (crawlers and AI answer engines read it without
// JavaScript) and every block hides itself when it has nothing true to say.

const esc = (s = "") => String(s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#039;");

const hidden = cond => (cond ? "" : " hidden");

function ctaHref(profile, content) {
  const t = String(content.cta_type || "").toLowerCase();
  if (/call|phone/.test(t) && profile.phone) return `tel:${profile.phone.replace(/[^\d+]/g, "")}`;
  return "#request";
}

export function priceLine(pricing = {}) {
  const mode = String(pricing.mode || "").toLowerCase();
  if (!pricing.price || /quote/.test(mode)) return "";
  if (/start/.test(mode)) return `Starting at ${pricing.price}`;
  return pricing.price;
}

export function renderSpotlight(spot, profile, { baseUrl, brandStyle, heroPhoto, otherSpotlights = [] }) {
  const c = spot.content || {};
  const hero = c.hero || {};
  const who = c.who || {};
  const problem = c.problem || {};
  const steps = Array.isArray(c.steps) ? c.steps : [];
  const deliv = c.deliverables || {};
  const proof = c.proof || {};
  const faqs = Array.isArray(c.faqs) ? c.faqs : [];
  const specs = Array.isArray(c.specs) ? c.specs : [];
  const cta = c.cta || {};
  const quote = spot.intake?.quote ? { text: spot.intake.quote, author: spot.intake.quote_author } : null;
  const isDraft = spot.status !== "published";
  const companyUrl = `/${encodeURIComponent(profile.username)}`;
  const canonical = `${baseUrl}/${encodeURIComponent(profile.username)}/${encodeURIComponent(spot.service_slug)}`;
  const town = [profile.city, profile.state].filter(Boolean).join(", ");
  const price = priceLine(c.pricing);
  const href = ctaHref(profile, c);
  const ctaLabel = hero.cta_label || "Get a Quote";

  const blocks = {
    "{{WHO_HTML}}": who.buyers?.length ? `
      ${who.intro ? `<p class="sp-lead">${esc(who.intro)}</p>` : ""}
      <div class="sp-cards">${who.buyers.map(b => `
        <div class="sp-card"><h3>${esc(b.title)}</h3><p>${esc(b.situation)}</p></div>`).join("")}
      </div>` : "",
    "{{PROBLEM_HTML}}": problem.body ? `
      <h2>${esc(problem.heading || "Why it matters")}</h2>
      ${problem.body.split(/\n{2,}/).map(p => `<p>${esc(p)}</p>`).join("")}` : "",
    "{{STEPS_HTML}}": steps.map((s, i) => `
      <li class="sp-step"><span class="sp-step__n">${i + 1}</span><div><h3>${esc(s.title)}</h3>${s.detail ? `<p>${esc(s.detail)}</p>` : ""}</div></li>`).join(""),
    "{{DELIVERABLES_HTML}}": (deliv.items || []).map(i => `<li>${esc(i)}</li>`).join(""),
    "{{TURNAROUND_HTML}}": deliv.turnaround ? `<p class="sp-turnaround"><strong>Timing:</strong> ${esc(deliv.turnaround)}</p>` : "",
    "{{PRICE_HTML}}": price ? `<p class="sp-price"><strong>Price:</strong> ${esc(price)}</p>` : "",
    "{{PROOF_HTML}}": [
      quote ? `<figure class="sp-quote"><blockquote>“${esc(quote.text)}”</blockquote>${quote.author ? `<figcaption>— ${esc(quote.author)}</figcaption>` : ""}</figure>` : "",
      proof.story ? `<div class="sp-story"><h3>A recent job</h3><p>${esc(proof.story)}</p></div>` : "",
      proof.credentials?.length ? `<ul class="sp-creds">${proof.credentials.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : "",
    ].join(""),
    "{{SPECS_HTML}}": specs.length ? `<dl class="sp-specs">${specs.map(s => `<div><dt>${esc(s.label)}</dt><dd>${esc(s.value)}</dd></div>`).join("")}</dl>` : "",
    "{{FAQS_HTML}}": faqs.map(f => `
      <details class="sp-faq"><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join(""),
    "{{OTHER_SPOTLIGHTS_HTML}}": otherSpotlights.length ? `<p class="sp-more">More from ${esc(profile.business_name)}: ${otherSpotlights.map(o =>
      `<a href="/${encodeURIComponent(profile.username)}/${encodeURIComponent(o.service_slug)}">${esc(o.service_name || o.service_slug)}</a>`).join(" · ")}</p>` : "",
  };

  const proofHas = !!blocks["{{PROOF_HTML}}"];
  const faqSchema = faqs.length ? {
    "@context": "https://schema.org", "@type": "FAQPage",
    mainEntity: faqs.map(f => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  } : null;
  const serviceSchema = {
    "@context": "https://schema.org", "@type": "Service",
    name: c.service_name, description: c.seo?.description || hero.subhead || "",
    url: canonical,
    areaServed: (Array.isArray(profile.service_area) && profile.service_area.length ? profile.service_area : [profile.city]).filter(Boolean),
    provider: { "@type": "LocalBusiness", name: profile.business_name, telephone: profile.phone || undefined, url: `${baseUrl}${companyUrl}` },
    ...(price ? { offers: { "@type": "Offer", description: price } } : {}),
  };
  const json = o => JSON.stringify(o).replace(/</g, "\\u003c");

  return {
    "{{TITLE}}": esc(c.seo?.title || `${c.service_name} | ${profile.business_name}`),
    "{{DESCRIPTION}}": esc(c.seo?.description || hero.subhead || ""),
    "{{CANONICAL}}": esc(canonical),
    "{{ROBOTS}}": isDraft ? "noindex,nofollow" : "index,follow",
    "{{OG_IMAGE}}": esc(heroPhoto || profile.logo_url || `${baseUrl}/api/p?og=1&slug=${encodeURIComponent(profile.username)}`),
    "{{BRAND_STYLE}}": brandStyle || "",
    "{{BODY_CLASS}}": [heroPhoto ? "has-hero-photo" : "", isDraft ? "is-draft" : ""].filter(Boolean).join(" "),
    "{{SCHEMA}}": `<script type="application/ld+json">${json(serviceSchema)}</script>${faqSchema ? `\n<script type="application/ld+json">${json(faqSchema)}</script>` : ""}`,
    "{{BUSINESS_NAME}}": esc(profile.business_name),
    "{{COMPANY_URL}}": esc(companyUrl),
    "{{LOGO_HTML}}": profile.logo_url ? `<img src="${esc(profile.logo_url)}" alt="${esc(profile.business_name)} logo" class="sp-logo" />` : "",
    "{{PHONE_HTML}}": profile.phone ? `<a class="sp-nav__call" href="tel:${esc(profile.phone.replace(/[^\d+]/g, ""))}">Call ${esc(profile.phone)}</a>` : "",
    "{{SERVICE_NAME}}": esc(c.service_name),
    "{{TOWN}}": esc(town),
    "{{HEADLINE}}": esc(hero.headline || c.service_name),
    "{{SUBHEAD}}": esc(hero.subhead || ""),
    "{{CTA_LABEL}}": esc(ctaLabel),
    "{{CTA_HREF}}": esc(href),
    "{{CTA_HEADING}}": esc(cta.heading || `Ready for ${c.service_name}?`),
    "{{CTA_BODY}}": esc(cta.body || ""),
    "{{FORM_SUBJECT_JSON}}": json(`${c.service_name} request`),
    "{{WHO_CLASS}}": hidden(blocks["{{WHO_HTML}}"]),
    "{{PROBLEM_CLASS}}": hidden(blocks["{{PROBLEM_HTML}}"]),
    "{{STEPS_CLASS}}": hidden(steps.length),
    "{{DELIVERABLES_CLASS}}": hidden((deliv.items || []).length || deliv.turnaround || price),
    "{{PROOF_CLASS}}": hidden(proofHas),
    "{{DETAILS_CLASS}}": hidden(specs.length || faqs.length),
    "{{ABOUT_LINE}}": esc(profile.hero_tagline || profile.seo_description || ""),
    "{{SPOT_JSON}}": json({
      business_id: profile.business_id, username: profile.username, service_slug: spot.service_slug,
      status: spot.status, email: profile.email || null,
      headline_options: c.headline_options || [], chosen_headline: c.chosen_headline || 0,
      removed: spot.removed_claims || [],
    }),
    ...blocks,
  };
}

// One pass, so text inside a block can never be mistaken for a placeholder.
export function fillTemplate(html, map) {
  return html.replace(/\{\{[A-Z_]+\}\}/g, m => (Object.prototype.hasOwnProperty.call(map, m) ? map[m] : ""));
}
