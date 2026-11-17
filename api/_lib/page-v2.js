// api/_lib/page-v2.js
// Page v2 (small_business_profiles.page_version = 2): the company page made
// to look like it was built for this one business, from its brand kit
// (api/_lib/brand-kit.js). Fills the same public/profile.html template as v1
// (api/_lib/company-page.js) with different blocks; reviews, about, FAQ, the
// quote form and the footer are v1's own blocks, restyled through the kit's
// CSS variables in the one shared stylesheet (public/styles/business-base.css,
// section 15, scoped to body.page-v2). No per-page CSS.
//
// Phone first (390px), then desktop. Real <a href>/<button>, 44px targets.
// The owner bar (owner link ?o=<token>) is rendered only for the owner;
// suggested towns and the photo ask live only inside it.

import { renderBlocks, telHref, smsHref, serviceSlug, howItWorksSteps } from "./company-page.js";
import { normalizeProfile } from "./page-ssr.js";
import { offersFreeEstimates } from "./page-claims.js";
import { workPhotos } from "./photo-kinds.js";
import { tidyHeadline, contrastRatio, hexToRgb, rgbToHex } from "./page-style.js";
import {
  badgeLabel, ownerCallLabel, stateCode, tradeLabel, usesNoJobTooSmall, sceneKeyFor,
} from "./brand-kit.js";
import { headerWordmarkSvg, tradeIconSvg, tradeIconFor } from "./starter-logo.js";
import { sceneSvg } from "./trade-scenes.js";
import { linkServicesToSpotlights } from "./spotlight-render.js";
import { ownerPageUrl } from "./owner-link.js";

const esc = s => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const list = v => (Array.isArray(v) ? v : []);
const cleanTown = t => String(t || "").replace(/,\s*[A-Za-z .]+$/, "").trim();

// ── Colors → CSS variables ────────────────────────────────────────────────

function deepen(hex, f = 0.72) {
  const rgb = hexToRgb(hex);
  return rgb ? rgbToHex(rgb.map(v => v * f)) : hex;
}

/**
 * The page's color variables from the kit. Sets the --kit-* tokens v2 styles
 * read, and the --brand-* tokens the shared quote form and footer read, so
 * every filled call button on the page is the kit's CTA color.
 */
export function kitStyle(kit) {
  const c = kit.colors;
  const deep = deepen(c.identity);
  const rgb = (hexToRgb(c.identity) || [0, 0, 0]).join(",");
  return `<style id="server-brand-colors">
  :root {
    --kit-identity: ${c.identity};
    --kit-identity-deep: ${deep};
    --kit-identity-rgb: ${rgb};
    --kit-accent: ${c.accent};
    --kit-cta: ${c.cta};
    --kit-cta-text: ${c.ctaText};
    --kit-cta-hover: color-mix(in srgb, ${c.cta}, black 10%);
    --brand-primary: ${c.identity};
    --brand-light: ${c.accent};
    --brand-primary-10: color-mix(in srgb, ${c.identity} 10%, white);
    --brand-primary-30: color-mix(in srgb, ${c.identity} 28%, white);
    --brand-rgb: ${rgb};
    --brand-cta: ${c.cta};
    --brand-cta-text: ${c.ctaText};
    --brand-cta-hover: color-mix(in srgb, ${c.cta}, black 10%);
    --ink: #1a1714; --ink-muted: #4a4540; --ink-faint: #6b655d; --line: #e6e1d9; --line-strong: #cfc7bb; --chip-bg: #ebe5dc;
    --biz-heading-stretch: 85%;
    --hero-bg: ${deep};
    --hero-bg2: ${c.identity};
  }
</style>`;
}

/** Contrast checks the page relies on (exported for tests). */
export function kitContrast(kit) {
  const c = kit.colors;
  return {
    heroText: contrastRatio(c.identity, "#ffffff"),
    ctaText: contrastRatio(c.cta, c.ctaText),
  };
}

// ── Text ──────────────────────────────────────────────────────────────────

const PAST = {
  painting: "painted right", landscaping: "done right", snow: "cleared right", plumbing: "fixed right", hvac: "fixed right",
  electrical: "wired right", cleaning: "cleaned right", contractor: "built right",
};

/** The H1: leads with the specialty when there is one. */
export function headlineFor(p, kit) {
  if (kit.specialty) return `${kit.specialty}, ${PAST[sceneKeyFor(p.primary_category)] || "done right"}.`;
  const h = tidyHeadline(p.hero_headline, p.business_name);
  if (h) return h;
  const town = cleanTown(p.city);
  return `${tradeLabel(p)}${town ? ` in ${town}` : ""}`;
}

/** "Interior painting in Ewing, NJ · 20+ years · No job too big or too small". */
export function subLineFor(p, kit) {
  const town = cleanTown(p.city), st = stateCode(p.state);
  const parts = [`${tradeLabel(p)}${town ? ` in ${town}${st ? `, ${st}` : ""}` : ""}`];
  if (kit.years) parts.push(`${kit.years} years`);
  if (usesNoJobTooSmall(p)) parts.push("No job too big or too small");
  return parts.join(" · ");
}

/** og:title: "<Business> · <Specialty or trade> · <Town>, <ST>". */
export function ogTitleFor(p, kit) {
  const town = cleanTown(p.city), st = stateCode(p.state);
  return [p.business_name, kit.specialty || tradeLabel(p), [town, st].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
}

/** The estimate button: "free" only when the business itself says so (page-claims.js). */
export function estimateLabel(p) {
  return offersFreeEstimates(p) ? "Get a free estimate" : "Get an estimate";
}

/** Trust card stats, from real facts only: years, licensed/insured, free estimates. */
export function trustStats(p, kit) {
  const out = [];
  if (kit.years) out.push({ key: "years", big: kit.years, small: "years experience" });
  const lic = !!kit.license, ins = kit.insured === true;
  if (lic || ins) out.push({ key: "licensed", big: "✓", small: lic && ins ? "Licensed & insured" : lic ? "Licensed" : "Insured" });
  if (offersFreeEstimates(p)) out.push({ key: "free", big: "$0", small: "Free estimates" });
  return out;
}

// ── Images ────────────────────────────────────────────────────────────────

/** Proxy URL for a Google listing photo stored on the kit (key stays server-side). */
export function googlePhotoSrc(slug, index) {
  return `/api/p?gphoto=1&slug=${encodeURIComponent(slug)}&i=${index}`;
}

function googleIndex(kit, ref) {
  const m = String(ref || "").match(/^google:(\d+)$/);
  if (m) return Number(m[1]);
  const n = String(ref || "").match(/^google:(places\/.+)$/);
  return n ? list(kit.google_photos).findIndex(g => g.name === n[1]) : -1;
}

/** The logo's displayable URL (Google logos go through the photo proxy). */
export function logoSrc(kit, slug) {
  const url = kit.logo?.url;
  if (!url) return null;
  if (/^google:/.test(url)) { const i = googleIndex(kit, url); return i >= 0 ? googlePhotoSrc(slug, i) : null; }
  return /^https:\/\//i.test(url) ? url : null;
}

function attributionHtml(g) {
  const a = list(g?.attributions)[0];
  if (!a?.displayName) return `<figcaption class="v2-credit">Photo from Google</figcaption>`;
  const who = a.uri ? `<a href="${esc(a.uri)}" target="_blank" rel="noopener">${esc(a.displayName)}</a>` : esc(a.displayName);
  return `<figcaption class="v2-credit">Photo: ${who} on Google</figcaption>`;
}

// Unsplash's required credit: "Photo by <name> on Unsplash", both linked with UTM tags.
const UNSPLASH_UTM = "utm_source=enoma&utm_medium=referral";
function stockCredit(c) {
  if (!c) return "";
  if (typeof c === "string") return `<figcaption class="v2-credit">${esc(c)}</figcaption>`;
  if (!c.name) return "";
  // stock-photos.js credits already carry the UTM tags; add them only if missing.
  const p = String(c.profileUrl || "");
  const prof = /^https:\/\/unsplash\.com\//.test(p) ? (/[?&]utm_source=/.test(p) ? p : `${p}${p.includes("?") ? "&" : "?"}${UNSPLASH_UTM}`) : null;
  const who = prof ? `<a href="${esc(prof)}" target="_blank" rel="noopener nofollow">${esc(c.name)}</a>` : esc(c.name);
  return `<figcaption class="v2-credit">Photo by ${who} on <a href="${esc(`https://unsplash.com/?${UNSPLASH_UTM}`)}" target="_blank" rel="noopener nofollow">Unsplash</a></figcaption>`;
}

/** Hero media per rule 1d: work photo → stock → drawn scene. */
export function heroMedia(p, kit, slug) {
  const h = kit.hero || { kind: "scene", ref: sceneKeyFor(p.primary_category) };
  const name = p.business_name || "";
  if (h.kind === "work_photo") {
    const gi = googleIndex(kit, h.ref);
    if (gi >= 0) {
      const g = list(kit.google_photos)[gi];
      return `<figure class="v2-hero__media v2-hero__media--photo"><img src="${esc(googlePhotoSrc(slug, gi))}" alt="${esc(`Work by ${name}`)}" fetchpriority="high" decoding="async" />${attributionHtml(g)}</figure>`;
    }
    if (/^https?:\/\//i.test(String(h.ref))) {
      return `<figure class="v2-hero__media v2-hero__media--photo"><img src="${esc(h.ref)}" alt="${esc(`Recent work by ${name}`)}" fetchpriority="high" decoding="async" /></figure>`;
    }
  }
  if (h.kind === "stock" && h.ref) {
    const s = typeof h.ref === "string" ? { url: h.ref } : h.ref;
    if (/^https?:\/\//i.test(String(s.url || ""))) {
      return `<figure class="v2-hero__media v2-hero__media--photo"><img src="${esc(s.url)}"${s.srcset ? ` srcset="${esc(s.srcset)}" sizes="(min-width: 900px) 520px, 100vw"` : ""} alt="${esc(s.alt || "")}" fetchpriority="high" decoding="async" />${stockCredit(s.credit)}</figure>`;
    }
  }
  const key = h.kind === "scene" && h.ref ? h.ref : sceneKeyFor(p.primary_category);
  return `<figure class="v2-hero__media v2-hero__media--scene">${sceneSvg(key, null, { title: `Drawing of ${tradeLabel(p).toLowerCase()} work` })}</figure>`;
}

// ── Blocks ────────────────────────────────────────────────────────────────

const ICON_CALL = '<svg class="v2-i" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.08 4.18 2 2 0 0 1 4.06 2h3a2 2 0 0 1 2 1.72c.12.86.31 1.7.57 2.5a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.58-1.09a2 2 0 0 1 2.11-.45c.8.26 1.64.45 2.5.57A2 2 0 0 1 22 16.92z"/></svg>';
const ICON_SMS = '<svg class="v2-i" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
const ICON_QUOTE = '<svg class="v2-i" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 5H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><path d="M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2H9V5z"/><path d="M9 12h6M9 16h6"/></svg>';
const ICON_SHIELD = '<svg class="v2-i" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3z"/><path d="m9 12 2 2 4-4"/></svg>';

function brandMark(p, kit, slug) {
  const name = esc(p.business_name || "");
  const src = logoSrc(kit, slug);
  if (src && kit.logo?.quality === "usable") {
    return `<img class="v2-logo" src="${esc(src)}" alt="${name}" height="44" />`;
  }
  const badge = !!(src && kit.logo?.quality === "badge_only");
  const svg = headerWordmarkSvg(kit.wordmark, {}, { title: p.business_name || "", icon: !badge })
    .replace(/^<svg /, `<svg class="v2-wordmark" focusable="false" `);
  // A mascot / small / busy logo: only ever a small round badge.
  return badge ? `<img class="v2-logo-badge" src="${esc(src)}" alt="" width="44" height="44" />${svg}` : svg;
}

function navBlock(p, ctx) {
  const spot = list(ctx.spotlights);
  const services = spot.length
    ? `<details class="v2-nav__drop"><summary>Services</summary><ul>${[`<li><a href="#services">All services</a></li>`, ...spot.map(s =>
      `<li><a href="/${encodeURIComponent(ctx.slug)}/${encodeURIComponent(s.service_slug)}">${esc(s.service_name || s.service_slug)}</a></li>`)].join("")}</ul></details>`
    : `<a href="#services">Services</a>`;
  return `<nav class="v2-nav" aria-label="Page">${services}${ctx.hasWork ? `<a href="#work">Recent work</a>` : ""}${ctx.hasTowns ? `<a href="#towns">Towns</a>` : ""}<a href="#contact">Estimate</a></nav>`;
}

function headerBlock(p, kit, ctx) {
  const phone = String(p.phone || "").trim();
  const flag = kit.badges.some(b => b === "american_owned" || b === "veteran_owned");
  return `<header class="v2-header" id="contactStrip">
  <div class="v2-header__inner">
    <a class="v2-brand" href="#top" aria-label="${esc(p.business_name || "")}, back to top">${brandMark(p, kit, ctx.slug)}</a>
    ${navBlock(p, ctx)}
    ${phone ? `<a class="v2-callicon" href="${esc(telHref(phone))}" data-contact="call" aria-label="Call ${esc(p.business_name || "")} at ${esc(phone)}">${ICON_CALL}</a>` : ""}
  </div>
  ${flag ? `<div class="v2-flag" aria-hidden="true"><span></span><span></span><span></span></div>` : `<div class="v2-rule" aria-hidden="true"></div>`}
</header>`;
}

function heroBlock(p, kit, ctx) {
  const phone = String(p.phone || "").trim();
  const chip = kit.badges.find(b => b === "american_owned" || b === "veteran_owned") || kit.badges[0];
  const call = phone
    ? `<a class="v2-cta" href="${esc(telHref(phone))}" data-contact="call"><span class="v2-cta__label">${ICON_CALL}${esc(ownerCallLabel(kit.owner_names))}</span><span class="v2-cta__num">${esc(phone)}</span></a>`
    : "";
  return `<section class="v2-hero" aria-labelledby="heroHeadline">
  <div class="v2-hero__inner">
    ${heroMedia(p, kit, ctx.slug)}
    <div class="v2-hero__copy">
      ${chip ? `<p class="v2-chip">${esc(badgeLabel(chip))}</p>` : ""}
      <h1 id="heroHeadline" class="v2-h1">${esc(headlineFor(p, kit))}</h1>
      <p class="v2-sub">${esc(subLineFor(p, kit))}</p>
      <div class="v2-actions" id="primaryAction">${call}<a class="v2-outline" href="#contact" data-contact="quote">${esc(estimateLabel(p))}</a></div>
    </div>
  </div>
</section>`;
}

function trustBlock(p, kit) {
  const stats = trustStats(p, kit);
  const lic = kit.license;
  const licLine = lic
    ? `<p class="v2-license">${esc([lic.state, lic.kind || "License"].filter(Boolean).join(" "))} #${esc(lic.number)}${lic.verify_url ? ` · <a href="${esc(lic.verify_url)}" target="_blank" rel="noopener">Verify it with the state <span aria-hidden="true">↗</span></a>` : ""}</p>`
    : "";
  if (!stats.length && !licLine) return "";
  return `<section class="v2-trust" aria-label="Why customers choose ${esc(p.business_name || "us")}">
  ${stats.length ? `<ul class="v2-stats">${stats.map(s => `<li class="v2-stat v2-stat--${s.key}"><span class="v2-stat__big">${s.key === "licensed" ? ICON_SHIELD : esc(s.big)}</span><span class="v2-stat__small">${esc(s.small)}</span></li>`).join("")}</ul>` : ""}
  ${licLine}
</section>`;
}

function crewBlock(p, kit) {
  const names = list(kit.owner_names);
  if (!names.length) return "";
  const phone = String(p.phone || "").trim();
  return `<section class="v2-crew" aria-labelledby="crewHeading">
  <div class="v2-avatars" aria-hidden="true">${names.map(n => `<span class="v2-avatar">${esc(n[0])}</span>`).join("")}</div>
  <div>
    <h2 id="crewHeading" class="v2-crew__h">You'll talk to the ${names.length > 1 ? "guys" : "person"} doing the work.</h2>
    <p class="v2-crew__names">${esc(names.join(" & "))}${phone ? ` · <a href="${esc(telHref(phone))}" data-contact="call">${esc(phone)}</a>` : ""}</p>
  </div>
</section>`;
}

const words = s => String(s || "").toLowerCase().replace(/&/g, " ").split(/[^a-z]+/).filter(w => w.length > 2 && !/^(and|the|for|painting|services?|work)$/.test(w));

/** Which service is the specialty (most shared words, at least one). */
export function specialtyServiceIndex(services, specialty) {
  if (!specialty) return -1;
  const want = new Set(words(specialty).map(w => w.replace(/s$/, "")));
  let best = -1, bestN = 0;
  services.forEach((s, i) => {
    const n = words(s.service_name || s.name).filter(w => want.has(w.replace(/s$/, "")) || want.has(w.replace(/-.*/, ""))).length;
    if (n > bestN) { best = i; bestN = n; }
  });
  return best;
}

function servicesBlock(p, kit, ctx) {
  const { services } = linkServicesToSpotlights(list(p.services).filter(s => s && (s.service_name || s.name)), list(ctx.spotlights), ctx.slug);
  if (!services.length) return "";
  const si = specialtyServiceIndex(services, kit.specialty);
  const featured = si >= 0 ? services[si] : null;
  const rest = services.filter((_, i) => i !== si);
  const persona = sceneKeyFor(p.primary_category);
  const href = s => s.spotlight_url || `#quote?service=${serviceSlug(s.service_name || s.name)}`;
  const iconFor = s => {
    const n = String(s.service_name || s.name || "").toLowerCase();
    // A few service words get their own icon; otherwise the trade's.
    const byWord = /drywall|repair|damage|fix|install/.test(n) ? "handyman" : /roof/.test(n) ? "roofing" : /commercial|office|building|house|home|interior|exterior/.test(n) && !/paint/.test(n) ? "default"
      : /wash|clean|graffiti|gum/.test(n) ? "cleaning" : /snow|plow/.test(n) ? "snow" : null;
    if (byWord) return tradeIconSvg(byWord);
    const k = tradeIconFor(s.service_name || s.name);
    return tradeIconSvg(k === "default" ? (persona === "contractor" ? "handyman" : persona) : k);
  };
  return `<section class="v2-section v2-services" id="services" aria-labelledby="servicesHeading">
  <h2 id="servicesHeading" class="v2-h2">What we do</h2>
  ${featured ? `<a class="v2-feature" href="${esc(href(featured))}" data-service-quote="${esc(serviceSlug(featured.service_name || featured.name))}">
    <span class="v2-feature__tag">Our specialty</span>
    <span class="v2-feature__title">${esc(featured.service_name || featured.name)}</span>
    ${featured.service_description ? `<span class="v2-feature__desc">${esc(featured.service_description)}</span>` : ""}
    <span class="v2-feature__go">${featured.spotlight_url ? "More about it →" : `${esc(estimateLabel(p))} →`}</span>
  </a>` : ""}
  ${rest.length ? `<ul class="v2-grid">${rest.map(s => `<li><a class="v2-svc" href="${esc(href(s))}" data-service-quote="${esc(serviceSlug(s.service_name || s.name))}"><span class="v2-svc__icon">${iconFor(s)}</span><span class="v2-svc__name">${esc(s.service_name || s.name)}</span></a></li>`).join("")}</ul>` : ""}
</section>`;
}

const PHOTO_ASK = {
  painting: "one wide shot of a finished room, ceiling to floor",
  landscaping: "one photo of a lawn or bed you just finished",
  snow: "one photo of a driveway you just plowed",
  plumbing: "one photo of a clean install you finished",
  hvac: "one photo of a unit you installed",
  electrical: "one photo of a panel you wired",
  cleaning: "one before-and-after of a job",
  contractor: "one photo of a finished project",
};

/** The one specific photo we ask the owner for. */
export function photoAskFor(p, kit) {
  if (/ceiling/i.test(kit.specialty || "")) return "one wide shot of a finished high ceiling";
  return PHOTO_ASK[sceneKeyFor(p.primary_category)] || PHOTO_ASK.contractor;
}

function photoAskHtml(p, kit, ctx) {
  const ask = photoAskFor(p, kit);
  const subject = encodeURIComponent(`Photo for ${p.business_name || ctx.slug}`);
  const jack = ctx.jackPhone
    ? `<a class="v2-owner__btn" href="${esc(smsHref(ctx.jackPhone))}?&body=${encodeURIComponent(`Photo for ${p.business_name || ""}: `)}">Text it to Jack</a>`
    : `<a class="v2-owner__btn" href="mailto:jack@enoma.io?subject=${subject}">Email it to Jack</a>`;
  return `<div class="v2-ask"><p><b>One photo makes this page yours:</b> ${esc(ask)}.</p>${jack}</div>`;
}

function workBlock(p, kit, ctx) {
  const own = workPhotos(p).slice(0, 8).map(u => ({ src: u, alt: `Work by ${p.business_name || ""}`, credit: "" }));
  const google = list(kit.google_photos).map((g, i) => ({ g, i })).filter(x => x.g.kind === "work")
    .map(({ g, i }) => ({ src: googlePhotoSrc(ctx.slug, i), alt: `Work by ${p.business_name || ""}`, credit: attributionHtml(g) }));
  const photos = [...own, ...google].slice(0, 8);
  if (!photos.length) {
    // Visitors see nothing; the owner sees one specific ask.
    return ctx.owner ? `<section class="v2-section v2-work v2-work--ask" id="work" aria-label="Photos">${photoAskHtml(p, kit, ctx)}</section>` : "";
  }
  return `<section class="v2-section v2-work" id="work" aria-labelledby="workHeading">
  <h2 id="workHeading" class="v2-h2">Recent work</h2>
  <ul class="v2-photos">${photos.map(ph => `<li><figure><img src="${esc(ph.src)}" alt="${esc(ph.alt)}" loading="lazy" decoding="async" />${ph.credit}</figure></li>`).join("")}</ul>
</section>`;
}

function howBlock(p) {
  const steps = howItWorksSteps(p);
  return `<section class="v2-section v2-how" id="howItWorks" aria-labelledby="howHeading">
  <h2 id="howHeading" class="v2-h2">How it works</h2>
  <ol class="v2-steps">${steps.map((s, i) => `<li><span class="v2-steps__n" aria-hidden="true">${i + 1}</span><div><h3>${esc(s.title)}</h3>${s.text ? `<p>${esc(s.text)}</p>` : ""}</div></li>`).join("")}</ol>
</section>`;
}

/** Public towns: confirmed only. Suggested towns never render here. */
function townsBlock(p, kit) {
  const towns = list(kit.towns?.confirmed);
  if (!towns.length) return "";
  const phone = String(p.phone || "").trim();
  return `<section class="v2-section v2-towns" id="towns" aria-labelledby="townsHeading">
  <h2 id="townsHeading" class="v2-h2">Towns we serve</h2>
  <ul class="v2-townlist">${towns.map(t => `<li>${esc(t)}</li>`).join("")}</ul>
  ${phone ? `<p class="v2-towns__ask">Not sure we cover you? <a href="${esc(smsHref(phone))}" data-contact="sms">Text us your town.</a></p>` : ""}
</section>`;
}

function mobileBar(p) {
  const phone = String(p.phone || "").trim();
  return `<nav class="v2-bar" id="mobileCallBar" aria-label="Contact">
  ${phone ? `<a class="v2-bar__call" href="${esc(telHref(phone))}" data-contact="mobile_bar_call">${ICON_CALL}Call</a>
  <a class="v2-bar__text" href="${esc(smsHref(phone))}" data-contact="sms">${ICON_SMS}Text</a>` : ""}
  <a class="v2-bar__quote" href="#contact" data-contact="mobile_bar_quote">${ICON_QUOTE}Estimate</a>
</nav>`;
}

// ── Owner bar (owner link only) ───────────────────────────────────────────

/**
 * "Made for <Business> by Jack · Keep it for $1 · Call or text Jack · Your
 * launch kit (3)". One line on a phone; the town confirmations and the
 * photo ask open beneath it. ctx: { slug, token, m, jackPhone, launchKit, hasPhotos }
 */
export function ownerBar(p, kit, ctx) {
  const name = p.business_name || "your business";
  const claim = ownerPageUrl(ctx.slug, ctx.token, { m: ctx.m, claim: true }).replace(/^https:\/\/enoma\.io/, "");
  const talk = ctx.jackPhone
    ? `<a class="v2-owner__link" href="${esc(telHref(ctx.jackPhone))}">Call</a> or <a class="v2-owner__link" href="${esc(smsHref(ctx.jackPhone))}">text Jack</a>`
    : `<a class="v2-owner__link" href="/${encodeURIComponent(ctx.slug)}/preview${ctx.m ? `?m=${encodeURIComponent(ctx.m)}` : ""}#contact">Call or text Jack</a>`;
  const suggested = list(kit.towns?.suggested);
  const towns = suggested.length
    ? `<div class="v2-owner__towns"><p><b>Do you also work in these towns?</b> Tap to confirm. Only towns you confirm go on your page.</p>
      <ul>${suggested.map(t => `<li><button type="button" class="v2-owner__town" data-town="${esc(t)}">+ ${esc(t)}</button></li>`).join("")}</ul></div>`
    : "";
  const ask = ctx.hasPhotos ? "" : photoAskHtml(p, kit, ctx);
  const more = towns || ask;
  const kitLink = ctx.launchKit ? ` <span class="v2-owner__sep" aria-hidden="true">·</span> <a class="v2-owner__link" href="/${encodeURIComponent(ctx.slug)}/kit?o=${encodeURIComponent(ctx.token)}">Your launch kit (3)</a>` : "";
  return `<div class="v2-owner" id="ownerBar" role="region" aria-label="Only you can see this bar" data-slug="${esc(ctx.slug)}" data-o="${esc(ctx.token)}">
  <div class="v2-owner__row">
    <p class="v2-owner__made">Made for <b>${esc(name)}</b> by Jack</p>
    <a class="v2-owner__keep" href="${esc(claim)}" data-cta="claim" data-where="owner_bar">Keep it for $1</a>
    <p class="v2-owner__extra">${talk}${kitLink}</p>
  </div>
  ${more ? `<details class="v2-owner__more"><summary>${towns && ask ? "2 quick things" : "1 quick thing"} for your page</summary>${towns}${ask}<p class="v2-owner__extra-phone">${talk}${kitLink}</p></details>` : ""}
</div>
<script src="/scripts/funnel-track.js"></script>
<script>
(function () {
  var bar = document.getElementById("ownerBar"); if (!bar) return;
  var slug = bar.getAttribute("data-slug"), o = bar.getAttribute("data-o");
  var m = ${JSON.stringify(ctx.m || null)};
  try { fetch("/api/track", { method: "POST", headers: { "Content-Type": "application/json" }, keepalive: true, body: JSON.stringify({ slug: slug, event: "landing_view", metadata: m ? { m: m, via: "owner_link" } : { via: "owner_link" } }) }); } catch (e) {}
  try { if (window.enomaTrack) window.enomaTrack("preview_shown", { slug: slug, m: m, via: "owner_link" }, ${JSON.stringify(p.business_id || null)}); } catch (e) {}
  bar.querySelectorAll(".v2-owner__town").forEach(function (b) {
    b.addEventListener("click", function () {
      b.disabled = true;
      fetch("/api/generate-business?kind=owner&action=confirm_town", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: slug, o: o, town: b.getAttribute("data-town") }) })
        .then(function (r) { if (!r.ok) throw 0; b.textContent = "✓ " + b.getAttribute("data-town"); b.classList.add("is-done"); })
        .catch(function () { b.disabled = false; b.textContent = "Try again: " + b.getAttribute("data-town"); });
    });
  });
})();
</script>`;
}

// ── Assembly ──────────────────────────────────────────────────────────────

/**
 * All template replacements for a v2 page. Starts from v1's blocks (reviews,
 * about, FAQ, quote form, footer) and replaces the rest.
 * ctx: { slug, spotlights, approvedReviews, paying, quoteStatus, owner, token, m, jackPhone, launchKit }
 */
export function renderBlocksV2(rawProfile, kit, ctx = {}) {
  const v1 = renderBlocks(rawProfile, ctx);
  const p = normalizeProfile(rawProfile || {});
  const slug = ctx.slug || p.username || "";
  const hasPhotos = workPhotos(p).length > 0 || list(kit.google_photos).some(g => g.kind === "work");
  const c = { ...ctx, slug, hasWork: hasPhotos, hasTowns: list(kit.towns?.confirmed).length > 0, hasPhotos };
  const bar = ctx.owner && ctx.token ? ownerBar(p, kit, c) : "";
  return {
    ...v1,
    "{{BLOCK_HEADER}}": bar + headerBlock(p, kit, c),
    "{{BLOCK_HERO}}": heroBlock(p, kit, c),
    "{{BLOCK_TRUST}}": trustBlock(p, kit) + crewBlock(p, kit),
    "{{BLOCK_SERVICES}}": servicesBlock(p, kit, c),
    "{{BLOCK_HOW}}": howBlock(p),
    "{{BLOCK_WORK}}": workBlock(p, kit, c),
    "{{BLOCK_AREAS}}": townsBlock(p, kit),
    "{{BLOCK_MOBILE_BAR}}": mobileBar(p),
  };
}

/** Extra <head> lines for v2: the 900-weight font, share-image size, scheme color. */
export function v2Head(kit) {
  return `  <link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@75..100,700..900&display=swap" rel="stylesheet" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="theme-color" content="${esc(kit.colors.identity)}" />`;
}

/** The share image URL, versioned by kit build time so a rebuild shows up. */
export function ogImageUrl(baseUrl, slug, kit) {
  const v = kit?.built_at ? Date.parse(kit.built_at).toString(36) : "0";
  return `${baseUrl}/og/${encodeURIComponent(slug)}.png?v=${v}`;
}
