// enoma.io/<slug>/preview — the page the cold email links to. It shows the
// owner the page we built them, what already works, margin notes on what
// we'd add with them (each one from what's actually missing on THEIR page,
// never a fixed list), the price with no catch, and one-tap ways to reach
// Jack. Every tap alerts Jack (api/ga-metrics.js action=landing_contact).
// Self-serve visitors from /get-your-website land here too (?src=instant),
// with the headline in their voice instead of Jack's cold-email greeting.

import { workPhotos } from "./photo-kinds.js";
import { isStrongRating } from "./page-style.js";

export const LANDING_SLUG = "preview";
export const CONTACT_KINDS = ["email", "text", "book"];
export const BOOK_DAYS = ["today", "tomorrow", "this_week", "next_week"];
export const BOOK_WINDOWS = ["morning", "afternoon", "evening"];
const DAY_LABEL = { today: "Today", tomorrow: "Tomorrow", this_week: "Later this week", next_week: "Next week" };
const WINDOW_LABEL = { morning: "Morning", afternoon: "Afternoon", evening: "Evening" };
export const MAX_CALLOUTS = 6;
export const LANDING_SOURCES = ["instant"];

/** Where /get-your-website sends a visitor once their instant preview is built. */
export function instantPreviewPath(slug) {
  return `/${encodeURIComponent(slug)}/${LANDING_SLUG}?src=instant`;
}

/**
 * The landing's source: "instant" for a self-serve visitor. A valid `m`
 * (the cold-email message id) always wins, so cold-email owners keep their
 * own attribution even if a src param tags along.
 */
export function landingSource({ src, m } = {}) {
  const hasM = /^[0-9a-f-]{36}$/i.test(String(m || ""));
  return !hasM && LANDING_SOURCES.includes(String(src || "")) ? String(src) : null;
}

const arr = v => (Array.isArray(v) ? v : []);
const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");

function allText(p) {
  return [p?.about, p?.hero_tagline, p?.hero_headline, p?.services_intro,
    typeof p?.why_choose_us === "string" ? p.why_choose_us : JSON.stringify(p?.why_choose_us || ""),
    JSON.stringify(p?.trust_badges || "")].join(" ").toLowerCase();
}

// Numbers an owner would brag about: years in business, jobs done.
function hasProofNumbers(p) {
  return /\b\d+\+?\s*(years?|yrs?)\b|\bsince (19|20)\d\d\b|\b\d[\d,]*\+?\s*(jobs|projects|homes|customers|clients|installs?)\b/.test(allText(p));
}

/**
 * The margin notes, most valuable first, from what this page is missing.
 * Each: { key, title, body, where } — `where` names the part of the page.
 */
export function detectCallouts(profile, { spotlightCount = 0 } = {}) {
  const p = profile || {};
  const services = arr(p.services);
  const towns = arr(p.service_area);
  const shownReviews = arr(p.testimonials).length;
  const reviewCount = Number(p.review_count) || 0;
  const out = [];

  if (workPhotos(p).length === 0) {
    out.push({ key: "photos", where: "Top of the page", title: "Add real photos of your work",
      body: "Right now there's a pattern where your photos would go. A few phone pictures of real jobs make people trust you faster than anything we can write." });
  }
  if (reviewCount > shownReviews && reviewCount >= 5) {
    out.push({ key: "reviews", where: "Reviews", title: `Show more of your ${reviewCount} Google reviews`,
      body: `Your page shows ${shownReviews || "none"} of them. We can pull in more of your best ones so visitors see what customers say about you.` });
  }
  if (services.length < 3) {
    out.push({ key: "services", where: "Services", title: "Add the rest of your services",
      body: `We only found ${services.length === 1 ? "one service" : services.length ? `${services.length} services` : "no services"} to list. Tell us what else you do and it goes on the page.` });
  } else {
    out.push({ key: "services", where: "Services", title: "Confirm your services",
      body: "We wrote these up for you. Tell us what's wrong, what's missing, and what you want more of." });
  }
  if (services.length >= 2 && !spotlightCount) {
    out.push({ key: "service_pages", where: "Each service", title: "Give each service its own page",
      body: "A page just for, say, one service in your town gives Google and AI assistants something specific to show when people search for exactly that." });
  }
  if (towns.length <= 1) {
    out.push({ key: "towns", where: "Service area", title: "Add the towns you serve",
      body: `${towns.length ? `We only listed ${towns[0]}.` : "We didn't list any towns."} Naming every town you work in helps people nearby find you.` });
  }
  if (!hasProofNumbers(p)) {
    out.push({ key: "numbers", where: "About", title: "Add your numbers",
      body: "Years in business, jobs done, how fast you call back. Real numbers beat adjectives." });
  } else if (!p.hero_response_time) {
    out.push({ key: "response_time", where: "Top of the page", title: "Say how fast you get back to people",
      body: "\"Calls back same day\" is one of the first things people look for. We'll add it if it's true for you." });
  }
  if (!p.logo_url) {
    out.push({ key: "logo", where: "Header", title: "Add your logo",
      body: "You don't have a logo yet, so I made you a simple starter one. Pick from three, or send me yours (a photo of your truck works too)." });
  }
  if (!p.phone) {
    out.push({ key: "phone", where: "Contact", title: "Add a phone number",
      body: "We couldn't find one, so the call button is missing. Most of your customers will want to call." });
  }
  return out.slice(0, MAX_CALLOUTS);
}

// What already works, so the margin notes don't read as criticism.
export function workingPoints(profile) {
  const p = profile || {};
  const pts = [];
  if (p.phone) pts.push("A tap-to-call button with your number");
  const n = arr(p.services).length;
  if (n) pts.push(`Your ${n === 1 ? "service" : `${n} services`}, written up and ready to edit`);
  if (isStrongRating(p.average_rating, p.review_count)) pts.push(`Your ${Number(p.average_rating)}★ rating from ${p.review_count} Google reviews`);
  const towns = arr(p.service_area);
  if (towns.length > 1) pts.push(`The ${towns.length} towns you serve`);
  pts.push("Works on phones, where most of your customers will see it");
  return pts;
}

export function validateContactRequest(body = {}) {
  const kind = String(body.kind || "");
  if (!CONTACT_KINDS.includes(kind)) return { ok: false, error: "bad_kind" };
  const slug = String(body.slug || "").trim();
  if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(slug)) return { ok: false, error: "bad_slug" };
  const m = /^[0-9a-f-]{36}$/i.test(String(body.m || "")) ? String(body.m) : null;
  const src = landingSource({ src: body.src, m });
  const out = { ok: true, kind, slug, m, src, phone: null, day: null, window: null, note: null };
  if (kind === "text" || kind === "book") {
    const digits = String(body.phone || "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
    if (digits.length !== 10) return { ok: false, error: "bad_phone" };
    out.phone = `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (kind === "book") {
    if (!BOOK_DAYS.includes(body.day)) return { ok: false, error: "bad_day" };
    if (!BOOK_WINDOWS.includes(body.window)) return { ok: false, error: "bad_window" };
    out.day = body.day;
    out.window = body.window;
  }
  if (body.note) out.note = String(body.note).replace(/\s+/g, " ").trim().slice(0, 300) || null;
  return out;
}

export function buildContactAlert({ kind, businessName, city, state, phone, day, window: win, note, slug, src = null }) {
  const name = String(businessName || slug || "A business").trim();
  const where = [city, state].filter(Boolean).join(", ");
  const what = kind === "text" ? `wants a text at ${phone}`
    : kind === "book" ? `booked 10 minutes: ${DAY_LABEL[day]}, ${WINDOW_LABEL[win].toLowerCase()}, at ${phone}`
    : "tapped Email me on their preview";
  const subject = `${name} ${what}`;
  const page = `https://enoma.io/${slug}`;
  const next = kind === "email" ? "Their email app just opened to you. Watch your inbox."
    : kind === "text" ? "They asked for it, so texting them back is fine."
    : "Call them in that window. A quick text to confirm the time is fine too.";
  const from = src === "instant" ? "From: a self-serve instant preview they built on /get-your-website (src=instant)." : "";
  const lines = [`${name}${where ? ` (${where})` : ""} ${what}.`, note ? `Their note: "${note}"` : "", from, `Page: ${page}`, next].filter(Boolean);
  const html = lines.map(l => `<p>${esc(l)}</p>`).join("\n").replace(esc(page), `<a href="${esc(page)}">${esc(page)}</a>`);
  return { subject, text: lines.join("\n"), html };
}

/**
 * Where each margin note points on the embedded page (public/profile.html,
 * rendered by api/_lib/company-page.js: a block with no data isn't there).
 * Each key lists CSS selectors, best first; the landing uses the first one
 * that's on the page and visible. A note whose anchors are all missing still
 * shows, stacked after the note before it.
 * - photos: the photo gallery when it's rendered, else the hero.
 * - reviews: the reviews section (#testimonialsWrap), else the hero.
 * - logo: the header logo, else the business name in the header.
 * - services vs service_pages: the whole services section vs its grid, so
 *   the two notes (which often come together) don't share one marker.
 */
export const CALLOUT_ANCHORS = {
  photos: ["#gallerySection", ".hero-wrapper"],
  reviews: ["#testimonialsWrap", ".hero-wrapper"],
  services: ["#servicesSection", "#services-grid"],
  service_pages: ["#services-grid", "#servicesSection"],
  towns: ["#towns", "#townsWrap"],
  numbers: ["#about-body", "#about-lead", "#why"],
  response_time: ["#tagline", ".hero-wrapper"],
  logo: ["#navLogo", "#businessName"],
  phone: ["#contact"],
};

export const SELLING_POINTS = [
  { icon: "search", text: "Built to be found on Google and AI assistants" },
  { icon: "phone", text: "Tap-to-call and a quote form on every page" },
  { icon: "shield", text: "Your leads only: no shared leads, no per-lead fees" },
  { icon: "person", text: "A real person (Jack) makes your changes for you" },
];

const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.08 4.18 2 2 0 0 1 4.06 2h3a2 2 0 0 1 2 1.72c.12.86.31 1.7.57 2.5a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.58-1.09a2 2 0 0 1 2.11-.45c.8.26 1.64.45 2.5.57A2 2 0 0 1 22 16.92z"/>',
  shield: '<path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3z"/><path d="m9 12 2 2 4-4"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;

/** The landing's links: claim (and subscribe-now, which claims with plan=year). */
export function landingLinks(slug, m = null) {
  const s = encodeURIComponent(slug);
  const mq = m ? `&m=${encodeURIComponent(m)}` : "";
  return {
    page: `/${s}`,
    pageFull: `/${s}${m ? `?m=${encodeURIComponent(m)}` : ""}`,
    embed: `/${s}?embed=1`,
    claim: `/${s}?claim=1${mq}`,
    subscribe: `/${s}?claim=1&plan=year${mq}`,
  };
}

/** The full landing page HTML. */
export function renderLanding(profile, { callouts = [], working = [], slug, m = null, src = null } = {}) {
  const p = profile || {};
  const name = p.business_name || slug;
  const instant = landingSource({ src, m }) === "instant";
  const links = landingLinks(slug, m);
  const phone = p.phone || "";
  const mailto = `mailto:jack@enoma.io?subject=${encodeURIComponent(`My Enoma page: ${name}`)}&body=${encodeURIComponent(`Hi Jack,\n\nAbout my page (enoma.io/${slug}):\n\n`)}`;
  const n = callouts.length;
  const cardHtml = callouts.map((c, i) => `
          <li class="card" id="note-${i + 1}" data-key="${esc(c.key)}" data-n="${i + 1}" tabindex="0" aria-labelledby="note-${i + 1}-t">
            <div class="card-head"><span class="av" aria-hidden="true">J</span><span class="who"><b>Jack · Enoma</b><span class="where">${esc(c.where)}</span></span><span class="n" aria-hidden="true">${i + 1}</span></div>
            <h3 id="note-${i + 1}-t"><span class="sr">Note ${i + 1}: </span>${esc(c.title)}</h3>
            <p>${esc(c.body)}</p>
            <span class="chip">Suggested change</span>
          </li>`).join("");
  const sheetHtml = callouts.map((c, i) => `
        <li><button type="button" class="sheet-note" data-key="${esc(c.key)}"><span class="n">${i + 1}</span><span><b>${esc(c.title)}</b><small>${esc(c.where)}</small></span></button></li>`).join("");
  const dayOpts = BOOK_DAYS.map(d => `<option value="${d}">${DAY_LABEL[d]}</option>`).join("");
  const winOpts = BOOK_WINDOWS.map(w => `<option value="${w}">${WINDOW_LABEL[w]}</option>`).join("");
  const json = o => JSON.stringify(o).replace(/</g, "\\u003c");
  const data = json({ slug, m, src: instant ? "instant" : null });
  const businessId = json(p.business_id || null);
  const notesData = json({
    notes: callouts.map((c, i) => ({ n: i + 1, key: c.key, title: c.title })),
    anchors: Object.fromEntries(callouts.map(c => [c.key, CALLOUT_ANCHORS[c.key] || []])),
  });
  const eyebrow = instant ? "Live as a preview" : "Ready to go live";
  const textForm = id => `
    <form class="panel" id="panel-${id}" data-kind="text">
      <label for="${id}-phone">Your cell number</label>
      <input id="${id}-phone" name="phone" type="tel" autocomplete="tel" inputmode="tel" value="${esc(phone)}" required>
      <label for="${id}-note">Anything you want me to know? (optional)</label>
      <textarea id="${id}-note" name="note" rows="2" maxlength="300"></textarea>
      <button type="submit">Text me</button>
      <p class="msg" role="status" aria-live="polite"></p>
    </form>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Your page preview: ${esc(name)}</title>
<script>document.documentElement.className += " js";</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700;9..144,800&family=Instrument+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="/styles/enoma.css">
<link rel="icon" href="/brand/favicon.ico" sizes="any">
<link rel="icon" href="/brand/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/brand/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="#0A1628">
<meta property="og:image" content="https://enoma.io/brand/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="https://enoma.io/brand/og-image.png">
</head>
<body class="page-preview">
<header class="top"><div class="wrap"><a class="brand" href="/" aria-label="Enoma home"><img src="/brand/enoma-wordmark-blue-notagline-cropped.svg" alt="Enoma" width="125" height="24"></a><div class="top-right"><span class="from">From Jack at Enoma</span><a class="top-cta" href="${esc(links.claim)}" data-cta="claim" data-where="nav">Keep my page for $1</a></div></div></header>

<main>
  <section class="hero wrap" aria-labelledby="hero-h">
    <div class="hero-grid">
      <div class="hero-copy">
        <span class="eyebrow">${eyebrow}</span>
        <h1 id="hero-h">Here's your page, ${esc(name)}</h1>
        <p class="lede">A page that gets you found online and gets you the call, not a shared lead.</p>
      </div>
      <div class="hero-side">
        <ul class="sells">${SELLING_POINTS.map(s => `
          <li><span class="ic">${icon(s.icon)}</span>${esc(s.text)}</li>`).join("")}
        </ul>
        <p class="already">Already on your page</p>
        <ul class="working">${working.map(w => `<li>${esc(w)}</li>`).join("")}</ul>
      </div>
      <div class="hero-ctas">
        <div class="cta-row">
          <a class="b b-primary" id="cta-claim" href="${esc(links.claim)}" data-cta="claim" data-where="hero">Keep my page: $1 first month</a>
          <button class="b b-secondary" id="cta-text" type="button" data-panel="hero-text" data-cta="text" data-where="hero">Text Jack</button>
          <a class="b b-secondary" id="cta-email" href="${esc(mailto)}" data-email data-cta="email" data-where="hero">Email Jack</a>
        </div>
        <p class="fine">$1 for your first month, then $19.99/month or $199/year. Cancel anytime. No contract.</p>
        <a class="sub-link" id="cta-subscribe" href="${esc(links.subscribe)}" data-cta="subscribe" data-where="hero">Prefer to pay yearly? $199/year</a>
${textForm("hero-text")}
      </div>
    </div>
  </section>

  <section class="review" id="notes" aria-labelledby="review-h">
    <div class="wrap" style="max-width:1180px">
      <h2 id="review-h">Your page, with my notes</h2>
      <p class="sub">Scroll through your page. My notes on the right are the changes I'd make with you. Nothing changes until you say so.</p>
    </div>
    <div class="doc" id="doc">
      <div class="doc-page">
        <div class="browser">
          <div class="browser-bar" aria-hidden="true"><span class="dots"><i></i><i></i><i></i></span><span class="url">enoma.io/${esc(slug)}</span></div>
          <iframe id="page-frame" src="${esc(links.embed)}" title="Your page: ${esc(name)}"></iframe>
        </div>
        <a class="open-full" href="${esc(links.pageFull)}" target="_blank" rel="noopener">Open your page full screen ↗</a>
      </div>
      <aside class="rail" id="rail" aria-label="Jack's notes on your page">
        <ol class="cards" id="notes-list">${cardHtml}
        </ol>
      </aside>
      <svg class="connectors" id="connectors" aria-hidden="true"></svg>
    </div>
    <div class="notes-after">
      <p>Each one is a few minutes of your time, and I do the work.</p>
      <a class="b b-primary" href="${esc(links.claim)}" data-cta="claim" data-where="notes">Keep my page: $1 first month</a>
    </div>
    <button class="notes-bar" id="notes-bar" type="button" aria-haspopup="dialog" aria-controls="notes-sheet" hidden><span class="av" aria-hidden="true">J</span>Jack's notes (${n})</button>
    <div class="sheet-back" id="sheet-back" hidden></div>
    <div class="sheet" id="notes-sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-h" hidden>
      <div class="sheet-head"><h2 id="sheet-h">Jack's notes (${n})</h2><button type="button" class="x" id="sheet-close" aria-label="Close notes">×</button></div>
      <ol>${sheetHtml}
      </ol>
    </div>
    <div class="pin" id="notes-pin" role="status" hidden></div>
  </section>

  <div class="wrap">
  <section class="catch" aria-labelledby="catch-h">
    <div>
      <h2 id="catch-h">What's the catch?</h2>
      <ul>
        <li>Look it over and tell me what to change first. You don't enter a card until you go live.</li>
        <li>Going live is $1 for your first month, then $19.99/month or $199/year, with me as your account manager: your changes go live within two business days.</li>
        <li>No per-lead fees, no contract. Cancel anytime.</li>
        <li>A page for any extra service you want found for: $9.99/month each.</li>
      </ul>
    </div>
    <div class="price"><b>$1</b><span>for your first month, then $19.99/month or $199/year. Cancel anytime.</span></div>
  </section>

  <section class="contact" aria-labelledby="contact-h">
    <h2 id="contact-h">Talk to Jack</h2>
    <p class="sub">Pick whatever's easiest. I'm a real person and I'll get back to you.</p>
    <div class="buttons">
      <a class="contact-btn" id="btn-email" href="${esc(mailto)}" data-email data-cta="email" data-where="contact">Email me<small>jack@enoma.io</small></a>
      <button class="contact-btn" type="button" data-panel="text" data-cta="text" data-where="contact">Text me<small>I'll text you</small></button>
      <button class="contact-btn primary" type="button" data-panel="book" data-cta="book" data-where="contact">Book 10 minutes<small>Pick a time, I'll call</small></button>
    </div>
${textForm("text")}

    <form class="panel" id="panel-book" data-kind="book">
      <div class="row">
        <div><label for="book-day">Day</label><select id="book-day" name="day">${dayOpts}</select></div>
        <div><label for="book-window">Time</label><select id="book-window" name="window">${winOpts}</select></div>
      </div>
      <label for="book-phone">Best number to call</label>
      <input id="book-phone" name="phone" type="tel" autocomplete="tel" inputmode="tel" value="${esc(phone)}" required>
      <label for="book-note">Anything you want me to know? (optional)</label>
      <textarea id="book-note" name="note" rows="2" maxlength="300"></textarea>
      <button type="submit">Book my 10 minutes</button>
      <p class="msg" role="status" aria-live="polite"></p>
    </form>

    <p class="keep">Ready already? <a href="${esc(links.claim)}" data-cta="claim" data-where="contact">Keep this page for $1</a></p>
  </section>
  </div>
</main>

<footer><div class="wrap">Enoma builds one page for local service businesses, made to be found. This preview isn't listed on Google until you keep it.</div></footer>

<script src="/scripts/funnel-track.js"></script>
<script>
(function () {
  var ctx = ${data};
  var businessId = ${businessId}; // funnel_events.business_id
  var api = "/api/ga-metrics?action=landing_contact";
  // Jack's devices: ?internal=1 flags this browser (same flag as the GA snippet).
  try { var im = location.search.match(/[?&]internal=([01])(?:&|$)/); if (im) localStorage.setItem("enoma_internal", im[1]); } catch (e) {}
  function isInternal() { try { return localStorage.getItem("enoma_internal") === "1"; } catch (e) { return false; } }
  // Jack's devices are still sent, tagged internal (funnel-track.js), so
  // nothing raw is lost; reports filter on traffic_class.
  function track(event, extra) {
    if (typeof window.enomaTrack !== "function") return;
    var meta = { slug: ctx.slug };
    if (ctx.m) meta.m = ctx.m;
    if (ctx.src) meta.src = ctx.src;
    for (var k in extra) if (extra[k] != null) meta[k] = extra[k];
    window.enomaTrack(event, meta, businessId);
  }
  window.enomaLandingTrack = track;
  function send(payload) {
    return fetch(api, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({}, ctx, payload)), keepalive: true })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok && j.success, error: j.error }; }); })
      .catch(function () { return { ok: false }; });
  }
  try { fetch("/api/track", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug: ctx.slug, event: "landing_view", internal: isInternal() || undefined, referrer: document.referrer || null, metadata: ctx.m ? { m: ctx.m } : ctx.src ? { src: ctx.src } : {} }), keepalive: true }); } catch (e) {}
  // Funnel step: the visitor's own preview is on screen.
  track("preview_shown", {});

  document.querySelectorAll("[data-cta]").forEach(function (el) {
    el.addEventListener("click", function () { track("landing_cta_click", { cta: el.getAttribute("data-cta"), where: el.getAttribute("data-where") }); });
  });
  document.querySelectorAll("[data-email]").forEach(function (el) {
    el.addEventListener("click", function () { send({ kind: "email" }); });
  });
  document.querySelectorAll("[data-panel]").forEach(function (b) {
    b.addEventListener("click", function () {
      document.querySelectorAll(".panel").forEach(function (p) { p.classList.remove("open"); });
      var panel = document.getElementById("panel-" + b.getAttribute("data-panel"));
      panel.classList.add("open");
      panel.querySelector("input,select").focus();
    });
  });
  document.querySelectorAll("form.panel").forEach(function (f) {
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var msg = f.querySelector(".msg"), btn = f.querySelector("button[type=submit]");
      var fd = new FormData(f), payload = { kind: f.getAttribute("data-kind") };
      fd.forEach(function (v, k) { payload[k] = v; });
      btn.disabled = true; msg.className = "msg"; msg.textContent = "Sending…";
      send(payload).then(function (r) {
        btn.disabled = false;
        if (r.ok) {
          msg.className = "msg ok";
          msg.textContent = payload.kind === "text" ? "Got it. I'll text you shortly." : "Booked. I'll call you then.";
          btn.disabled = true;
        } else {
          msg.className = "msg err";
          msg.textContent = r.error === "bad_phone" ? "That number doesn't look right. Use 10 digits." : "That didn't go through. Email me at jack@enoma.io instead.";
        }
      });
    });
  });
})();
</script>
<script>
// Margin notes: the embedded page grows to its full height (the visitor
// scrolls this page, not the iframe), each note is anchored to its section,
// and the sections get a Word-style highlight with a numbered marker. All of
// it is drawn from here into the same-origin iframe; the public page's own
// CSS is untouched for everyone else.
(function () {
  var D = ${notesData};
  var track = window.enomaLandingTrack || function () {};
  var frame = document.getElementById("page-frame");
  var doc = document.getElementById("doc");
  var rail = document.getElementById("rail");
  var svg = document.getElementById("connectors");
  var bar = document.getElementById("notes-bar");
  var sheet = document.getElementById("notes-sheet");
  var back = document.getElementById("sheet-back");
  var pin = document.getElementById("notes-pin");
  var cards = [].slice.call(document.querySelectorAll("#notes-list .card"));
  if (!frame || !cards.length) return;
  var wide = window.matchMedia("(min-width: 1024px)");
  var still = window.matchMedia("(prefers-reduced-motion: reduce)");
  var fwin = null, fdoc = null, layer = null, raf = 0, sectionInView = false;
  var marks = {};   // key -> { el, top, right, box, marker }
  var byKey = {};
  cards.forEach(function (c) { byKey[c.getAttribute("data-key")] = c; });
  var behavior = function () { return still.matches ? "auto" : "smooth"; };
  var navH = function () { var h = document.querySelector("header.top"); return h ? h.offsetHeight : 0; };

  // landing_comment_seen: once per key per page load, when a card is half visible.
  var seen = {};
  function markSeen(key) { if (key && !seen[key]) { seen[key] = true; track("landing_comment_seen", { key: key }); } }
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting && e.intersectionRatio >= 0.5) markSeen(e.target.getAttribute("data-key")); });
    }, { threshold: [0.5] });
    cards.forEach(function (c) { io.observe(c); });
  }

  var CSS = ".unclaimed-banner,.preview-poll,.mobile-call-bar{display:none!important}" +
    "body.has-mobile-call-bar{padding-bottom:0!important}" +
    "html{overflow:hidden!important;scroll-behavior:auto!important}" +
    "#enoma-notes-layer{position:absolute;top:0;left:0;width:0;height:0;z-index:2147483000;pointer-events:none}" +
    ".enl-box{position:absolute;border:2px dashed rgba(10,114,196,.55);background:rgba(255,222,89,.13);border-radius:8px;transition:background .15s,border-color .15s,box-shadow .15s}" +
    ".enl-box.is-on{border-color:#0A72C4;background:rgba(255,214,51,.3);box-shadow:0 0 0 4px rgba(10,114,196,.18)}" +
    ".enl-mark{position:absolute;pointer-events:auto;width:28px;height:28px;padding:0;border-radius:50%;border:2px solid #fff;background:#0A72C4;color:#fff;font:500 13px/24px 'IBM Plex Mono',ui-monospace,monospace;text-align:center;cursor:pointer;box-shadow:0 3px 10px rgba(10,22,40,.35);transition:transform .15s}" +
    ".enl-mark.is-on{transform:scale(1.18)}" +
    ".enl-mark:focus-visible{outline:2px solid #0A72C4;outline-offset:2px}" +
    "@media (prefers-reduced-motion:reduce){.enl-box,.enl-mark{transition:none}}";

  function anchorFor(key) {
    var sels = D.anchors[key] || [];
    for (var i = 0; i < sels.length; i++) {
      var el = fdoc.querySelector(sels[i]);
      if (el && el.getClientRects().length && el.getBoundingClientRect().height > 4) return el;
    }
    return null;
  }

  function setOn(key, on) {
    var m = marks[key];
    if (m && m.box) { m.box.classList.toggle("is-on", on); m.marker.classList.toggle("is-on", on); }
    if (byKey[key]) byKey[key].classList.toggle("is-on", on);
    var path = svg.querySelector('[data-key="' + key + '"]');
    if (path) path.classList.toggle("is-on", on);
  }
  function allOff() { D.notes.forEach(function (x) { setOn(x.key, false); }); }

  function build() {
    if (fdoc.getElementById("enoma-notes-style")) return;
    var st = fdoc.createElement("style");
    st.id = "enoma-notes-style";
    st.textContent = CSS;
    fdoc.head.appendChild(st);
    layer = fdoc.createElement("div");
    layer.id = "enoma-notes-layer";
    fdoc.body.appendChild(layer);
    D.notes.forEach(function (note) {
      var box = fdoc.createElement("div");
      box.className = "enl-box";
      var mk = fdoc.createElement("button");
      mk.type = "button";
      mk.className = "enl-mark";
      mk.textContent = String(note.n);
      mk.setAttribute("aria-label", "Note " + note.n + ": " + note.title);
      mk.addEventListener("click", function () { track("landing_cta_click", { cta: "marker", key: note.key }); openNote(note.key, true); });
      mk.addEventListener("mouseenter", function () { setOn(note.key, true); });
      mk.addEventListener("mouseleave", function () { setOn(note.key, false); });
      box.hidden = true; mk.hidden = true;
      layer.appendChild(box); layer.appendChild(mk);
      marks[note.key] = { box: box, marker: mk, top: null };
    });
  }

  // Height of the page's content (shrinks too, unlike scrollHeight once the
  // iframe is already taller than the content).
  function contentHeight() {
    var b = fdoc.body, de = fdoc.documentElement;
    var mb = parseFloat(fwin.getComputedStyle(b).marginBottom) || 0;
    var h = b.getBoundingClientRect().bottom + mb + (fwin.scrollY || 0);
    if (!(h > 200)) h = de.scrollHeight;
    return Math.ceil(h);
  }

  function placeMarks() {
    var sy = fwin.scrollY || 0;
    D.notes.forEach(function (note) {
      var m = marks[note.key], el = anchorFor(note.key);
      if (!el) { m.top = null; m.box.hidden = true; m.marker.hidden = true; return; }
      var r = el.getBoundingClientRect();
      var top = r.top + sy;
      m.top = top; m.right = r.right;
      m.box.hidden = false; m.marker.hidden = false;
      m.box.style.cssText = "top:" + (top + 2) + "px;left:" + (r.left + 2) + "px;width:" + Math.max(0, r.width - 4) + "px;height:" + Math.max(0, r.height - 4) + "px";
      var small = r.height < 64;
      m.mt = small ? top - 12 : top + 10;
      m.marker.style.top = m.mt + "px";
      var maxLeft = fdoc.documentElement.clientWidth - 34;
      m.marker.style.left = Math.max(4, Math.min(small ? r.right - 16 : r.right - 40, maxLeft)) + "px";
    });
  }

  // Word-style stacking: each card at its section's height; overlapping cards
  // push the next one down with a 12px gap; a note with no section on the
  // page goes right after the note before it.
  function placeCards() {
    svg.innerHTML = "";
    if (!wide.matches) {
      rail.classList.remove("is-placed");
      cards.forEach(function (c) { c.style.top = ""; });
      document.querySelector("#notes-list").style.height = "";
      return;
    }
    var railTop = rail.getBoundingClientRect().top;
    var fr = frame.getBoundingClientRect();
    var off = fr.top - railTop;
    var items = [], prev = 0;
    cards.forEach(function (c, i) {
      var m = marks[c.getAttribute("data-key")];
      var want = m && m.top != null ? off + Math.max(0, m.mt - 4) : prev + 0.5;
      prev = want;
      items.push({ c: c, i: i, want: want });
    });
    items.sort(function (a, b) { return a.want - b.want || a.i - b.i; });
    rail.classList.add("is-placed");
    var y = 0, bottom = 0;
    items.forEach(function (it) {
      y = Math.max(it.want, bottom ? bottom + 12 : 0);
      it.c.style.top = y + "px";
      it.y = y;
      bottom = y + it.c.offsetHeight;
    });
    document.querySelector("#notes-list").style.height = bottom + "px";
    // Connectors: card's left edge -> just past the page frame -> the marker.
    var dr = doc.getBoundingClientRect(), rr = rail.getBoundingClientRect();
    var ns = "http://www.w3.org/2000/svg";
    svg.setAttribute("viewBox", "0 0 " + dr.width + " " + dr.height);
    items.forEach(function (it) {
      var key = it.c.getAttribute("data-key"), m = marks[key];
      if (!m || m.top == null) return;
      var x1 = rr.left - dr.left, y1 = rr.top - dr.top + it.y + 20;
      var xm = fr.right - dr.left + 10;
      var x2 = Math.min(fr.left + m.right, fr.right) - dr.left - 26, y2 = fr.top - dr.top + m.mt + 14;
      var p = document.createElementNS(ns, "path");
      p.setAttribute("d", "M" + x1 + " " + y1 + " H" + xm + " L" + x2 + " " + y2);
      p.setAttribute("data-key", key);
      if (it.c.classList.contains("is-on")) p.classList.add("is-on");
      svg.appendChild(p);
    });
  }

  function layout() {
    raf = 0;
    if (!fdoc || !fdoc.body) return;
    var h = contentHeight();
    if (Math.abs(frame.offsetHeight - h) > 1) frame.style.height = h + "px";
    placeMarks();
    placeCards();
    updateBar();
  }
  function schedule() { if (!raf) raf = requestAnimationFrame(layout); }

  function attach() {
    var d;
    try { d = frame.contentDocument; } catch (e) { return; }
    if (!d || !d.body || d === fdoc || d.URL === "about:blank") return;
    fdoc = d; fwin = frame.contentWindow;
    frame.setAttribute("scrolling", "no");
    build();
    layout();
    if (fwin.ResizeObserver) new fwin.ResizeObserver(schedule).observe(fdoc.body);
    // Late images and fonts move sections without resizing the body.
    [300, 1000, 2500, 5000].forEach(function (t) { setTimeout(schedule, t); });
  }
  frame.addEventListener("load", attach);
  attach();
  window.addEventListener("resize", schedule);
  if (wide.addEventListener) wide.addEventListener("change", function () { closeSheet(); hidePin(); schedule(); });

  // Card <-> section
  cards.forEach(function (c) {
    var key = c.getAttribute("data-key");
    c.addEventListener("mouseenter", function () { setOn(key, true); });
    c.addEventListener("mouseleave", function () { if (fdoc && document.activeElement !== c) setOn(key, false); });
    c.addEventListener("focus", function () { setOn(key, true); });
    c.addEventListener("blur", function () { setOn(key, false); });
  });

  function pulse(c) {
    if (still.matches) return;
    c.classList.remove("is-pulse"); void c.offsetWidth; c.classList.add("is-pulse");
    setTimeout(function () { c.classList.remove("is-pulse"); }, 1300);
  }

  // A marker (or a note in the sheet) was chosen.
  function openNote(key, fromMarker) {
    var c = byKey[key];
    if (!c) return;
    if (wide.matches) {
      var r = c.getBoundingClientRect();
      var target = window.scrollY + r.top - Math.max(navH() + 16, (window.innerHeight - r.height) / 2);
      window.scrollTo({ top: Math.max(0, target), behavior: behavior() });
      allOff(); setOn(key, true);
      try { c.focus({ preventScroll: true }); } catch (e) {}
      pulse(c);
      return;
    }
    // Phone/tablet: scroll to the section, highlight it, pin the note above the bar.
    var m = marks[key];
    if (m && m.top != null) {
      var fr = frame.getBoundingClientRect();
      window.scrollTo({ top: Math.max(0, window.scrollY + fr.top + m.top - navH() - 16), behavior: behavior() });
    }
    allOff(); setOn(key, true);
    showPin(key);
  }

  var pinKey = null, pinGuard = 0, pinBase = null;
  function showPin(key) {
    var clone = byKey[key].cloneNode(true);
    clone.removeAttribute("id"); clone.removeAttribute("tabindex"); clone.removeAttribute("aria-labelledby");
    clone.classList.remove("is-pulse");
    var t = clone.querySelector("h3"); if (t) t.removeAttribute("id");
    var x = document.createElement("button");
    x.type = "button"; x.className = "x"; x.setAttribute("aria-label", "Close note"); x.textContent = "×";
    x.addEventListener("click", hidePin);
    clone.appendChild(x);
    pin.innerHTML = ""; pin.appendChild(clone); pin.hidden = false;
    pinKey = key; pinBase = null; pinGuard = Date.now() + 1200;
    markSeen(key);
  }
  function hidePin() { if (pinKey) setOn(pinKey, false); pinKey = null; pin.hidden = true; pin.innerHTML = ""; }
  window.addEventListener("scroll", function () {
    if (!pinKey || Date.now() < pinGuard) return;
    if (pinBase == null) { pinBase = window.scrollY; return; }
    if (Math.abs(window.scrollY - pinBase) > 160) hidePin();
  }, { passive: true });
  if ("onscrollend" in window) window.addEventListener("scrollend", function () { if (pinKey && pinBase == null) pinGuard = 0; });

  // Sticky "Jack's notes (N)" bar, phone/tablet only, while the page is on screen.
  function updateBar() { bar.hidden = wide.matches || !sectionInView || !sheet.hidden; }
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (es) { sectionInView = es[0].isIntersecting; updateBar(); }, { rootMargin: "0px 0px -40% 0px" }).observe(doc);
  }
  var lastFocus = null;
  function openSheet() {
    hidePin();
    lastFocus = document.activeElement;
    sheet.hidden = false; back.hidden = false; updateBar();
    var first = sheet.querySelector(".sheet-note"); if (first) first.focus();
  }
  function closeSheet() {
    if (sheet.hidden) return;
    sheet.hidden = true; back.hidden = true; updateBar();
    if (lastFocus && lastFocus.focus) try { lastFocus.focus({ preventScroll: true }); } catch (e) {}
  }
  bar.addEventListener("click", openSheet);
  back.addEventListener("click", closeSheet);
  document.getElementById("sheet-close").addEventListener("click", closeSheet);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") { closeSheet(); hidePin(); } });
  sheet.querySelectorAll(".sheet-note").forEach(function (b) {
    b.addEventListener("click", function () { closeSheet(); openNote(b.getAttribute("data-key")); });
  });
})();
</script>
</body>
</html>`;
}
