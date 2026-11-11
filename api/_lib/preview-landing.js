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
 * Where each margin note points on the embedded page (public/profile.html).
 * Each key lists CSS selectors, best first; the landing uses the first one
 * that's on the page and visible. A note whose anchors are all missing still
 * shows, stacked after the note before it.
 * - photos: the photo gallery when it's rendered, else the hero.
 * - reviews: #reviews in profile.html is a hidden data holder, so the
 *   visible review carousel (#testimonialsWrap) is the anchor.
 * - services vs service_pages: the whole services section vs its grid, so
 *   the two notes (which often come together) don't share one marker.
 */
export const CALLOUT_ANCHORS = {
  photos: ["#gallerySection", ".hero-wrapper"],
  reviews: ["#testimonialsWrap", "#whyOuterSection"],
  services: ["#servicesSection", "#services-grid"],
  service_pages: ["#services-grid", "#servicesSection"],
  towns: ["#towns", "#townsWrap"],
  numbers: ["#about-body", "#about-lead", "#why"],
  response_time: ["#tagline", ".hero-wrapper"],
  logo: ["#heroLogo", "#navLogo"],
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
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Instrument+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500&display=swap" rel="stylesheet">
<style>
  /* Same tokens and type as the enoma.io homepage (public/index.html, light theme). */
  :root { --ink:#0B1B33; --ink2:#3B4A63; --muted:#55647D; --line:#DCE3ED; --bg:#F6F8FB; --card:#fff; --blue:#1F5FBF; --blue-ink:#163F7F; --blue-bg:#EEF4FD; --blue-line:#C9DAF3; --red:#c62828; --green:#1e7d4f;
    --display:'Fraunces',Georgia,serif; --sans:'Instrument Sans',-apple-system,system-ui,sans-serif; --mono:'IBM Plex Mono',ui-monospace,monospace; --nav:60px; }
  * { box-sizing:border-box; }
  html { scroll-padding-top:calc(var(--nav) + 12px); }
  body { margin:0; font-family:var(--sans); color:var(--ink); background:var(--bg); line-height:1.5; -webkit-font-smoothing:antialiased; }
  .wrap { max-width:1120px; margin:0 auto; padding:0 16px; }
  .sr { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }
  a:focus-visible, button:focus-visible, .card:focus-visible { outline:3px solid #9cc2ff; outline-offset:2px; }

  /* 1. Nav */
  header.top { position:sticky; top:0; z-index:50; background:#fff; border-bottom:1px solid var(--line); }
  header.top .wrap { display:flex; align-items:center; justify-content:space-between; height:var(--nav); max-width:1180px; }
  .brand { display:block; text-decoration:none; }
  .brand img { display:block; height:26px; width:auto; }
  .from { color:var(--muted); font-size:14px; }
  .top-right { display:flex; align-items:center; gap:16px; }
  .top-cta { display:inline-flex; align-items:center; background:var(--blue); color:#fff; font-weight:700; font-size:14px; padding:8px 16px; border-radius:999px; text-decoration:none; white-space:nowrap; transition:background .15s; }
  .top-cta:hover { background:var(--blue-ink); }

  /* 2. Hero */
  .hero { padding-top:36px; padding-bottom:32px; }
  .hero-grid { display:grid; grid-template-columns:minmax(0,1.1fr) minmax(0,.9fr); grid-template-areas:"copy side" "ctas side"; column-gap:48px; align-items:start; }
  .hero-copy { grid-area:copy; } .hero-side { grid-area:side; } .hero-ctas { grid-area:ctas; }
  .eyebrow { display:inline-block; font-family:var(--mono); font-size:12px; font-weight:500; letter-spacing:.16em; text-transform:uppercase; color:var(--blue); }
  h1, h2, .price b { font-family:var(--display); font-optical-sizing:auto; font-weight:600; color:var(--ink); }
  h1 { font-size:clamp(30px,4.4vw,48px); line-height:1.08; letter-spacing:-.025em; margin:10px 0 12px; }
  .lede { color:var(--ink2); font-size:19px; max-width:560px; margin:0 0 22px; }
  .hero-side { background:var(--card); border:1px solid var(--line); border-radius:20px; padding:22px 22px 20px; margin-top:6px; }
  .sells { list-style:none; margin:0; padding:0; display:grid; gap:12px; }
  .sells li { display:flex; gap:12px; align-items:center; font-weight:600; font-size:16px; line-height:1.3; color:var(--ink); }
  .sells .ic { flex:0 0 36px; height:36px; border-radius:10px; background:var(--blue-bg); border:1px solid var(--blue-line); color:var(--blue); display:grid; place-items:center; }
  .sells svg { width:19px; height:19px; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
  .already { margin:18px 0 8px; font-family:var(--mono); font-size:11px; font-weight:500; letter-spacing:.14em; text-transform:uppercase; color:var(--muted); }
  .working { list-style:none; padding:0; margin:0; display:flex; flex-wrap:wrap; gap:6px; }
  .working li { background:var(--bg); border:1px solid var(--line); border-radius:999px; padding:4px 11px; font-size:13px; color:var(--ink2); }
  .working li::before { content:"✓ "; color:var(--blue); font-weight:700; }
  .cta-row { display:flex; flex-wrap:wrap; gap:10px; align-items:center; }
  .b { display:inline-flex; align-items:center; justify-content:center; gap:8px; min-height:50px; padding:0 22px; border-radius:999px; border:1.5px solid transparent; font:inherit; font-weight:700; font-size:16px; text-decoration:none; cursor:pointer; white-space:nowrap; transition:background .15s, border-color .15s; }
  .b-primary { background:var(--blue); color:#fff; box-shadow:0 12px 30px -12px rgba(31,95,191,.6); }
  .b-primary:hover { background:var(--blue-ink); }
  .b-secondary { background:var(--card); color:var(--ink); border-color:#C9D3E0; }
  .b-secondary:hover { border-color:var(--blue); background:var(--blue-bg); }
  .sub-link { display:inline-block; margin-top:14px; color:var(--blue); font-weight:600; font-size:15px; text-underline-offset:3px; }
  .fine { margin:6px 0 0; color:var(--muted); font-size:13px; }

  /* 3. Their page, with margin comments */
  section.review { padding:40px 0 32px; border-top:1px solid var(--line); background:#fff; }
  h2 { font-size:30px; letter-spacing:-.02em; line-height:1.15; margin:0 0 6px; }
  .sub { color:var(--muted); margin:0 0 22px; max-width:680px; }
  .doc { position:relative; max-width:1180px; margin:0 auto; padding:0 16px; }
  .browser { background:#fff; border:1px solid var(--line); border-radius:14px; overflow:hidden; box-shadow:0 30px 70px -40px rgba(11,27,51,.35); }
  .browser-bar { display:flex; align-items:center; gap:12px; height:40px; padding:0 14px; background:#F1F4F8; border-bottom:1px solid var(--line); }
  .dots { display:flex; gap:6px; flex:0 0 auto; } .dots i { width:10px; height:10px; border-radius:50%; background:#D3DAE4; display:block; }
  .url { flex:1; max-width:360px; margin:0 auto; height:24px; display:flex; align-items:center; justify-content:center; background:#fff; border:1px solid var(--line); border-radius:999px; font-family:var(--mono); font-size:12px; color:var(--muted); overflow:hidden; white-space:nowrap; text-overflow:ellipsis; padding:0 10px; }
  .browser iframe { display:block; width:100%; height:1400px; border:0; background:#fff; }
  .open-full { display:inline-block; margin-top:10px; font-size:14px; color:var(--blue); font-weight:600; }
  .rail { position:relative; margin-top:24px; }
  .cards { list-style:none; margin:0; padding:0; display:grid; gap:12px; }
  .card { background:#fff; border:1px solid var(--line); border-radius:10px; padding:12px 14px 14px; box-shadow:0 1px 3px rgba(11,27,51,.07); transition:border-color .15s, box-shadow .15s; }
  .card:hover, .card.is-on { border-color:var(--blue); box-shadow:0 0 0 3px rgba(31,95,191,.14); }
  .card-head { display:flex; align-items:center; gap:9px; margin-bottom:6px; }
  .av { flex:0 0 28px; width:28px; height:28px; border-radius:50%; background:var(--blue); color:#fff; font-weight:700; font-size:13px; display:grid; place-items:center; }
  .who { display:flex; flex-direction:column; line-height:1.25; min-width:0; flex:1; }
  .who b { font-size:13px; } .who .where { font-size:12px; color:var(--muted); }
  .n { flex:0 0 auto; min-width:22px; height:22px; padding:0 6px; border-radius:999px; background:var(--blue-bg); border:1px solid var(--blue-line); color:var(--blue); font-family:var(--mono); font-weight:500; font-size:12px; display:grid; place-items:center; }
  .card h3 { margin:2px 0 4px; font-size:15px; font-weight:700; line-height:1.3; }
  .card p { margin:0 0 10px; color:var(--ink2); font-size:14px; }
  .chip { display:inline-block; font-size:12px; font-weight:600; color:#7A5A10; background:#FFF6D6; border:1px solid #F0DFA0; border-radius:999px; padding:1px 9px; }
  .card.is-pulse { animation:pulse 1.2s ease-out 1; }
  @keyframes pulse { 0% { box-shadow:0 0 0 0 rgba(31,95,191,.5); } 100% { box-shadow:0 0 0 16px rgba(31,95,191,0); } }
  .connectors { position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none; overflow:visible; }
  .connectors path { fill:none; stroke:rgba(31,95,191,.32); stroke-width:1; stroke-dasharray:3 3; }
  .connectors path.is-on { stroke:var(--blue); stroke-width:1.5; stroke-dasharray:none; }
  .notes-after { text-align:center; padding:28px 16px 4px; }
  .notes-after p { margin:0 0 14px; color:var(--ink2); font-size:17px; }
  .js .rail { display:none; }
  @media (min-width:1024px) {
    .js .doc { display:grid; grid-template-columns:minmax(0,820px) 320px; gap:32px; justify-content:center; align-items:start; }
    .js .rail { display:block; margin-top:0; }
    .js .rail.is-placed .cards { display:block; }
    .js .rail.is-placed .card { position:absolute; left:0; right:0; transition:top .2s ease, border-color .15s, box-shadow .15s; }
  }
  .notes-bar { position:fixed; left:12px; right:12px; bottom:12px; z-index:60; display:flex; align-items:center; justify-content:center; gap:10px; max-width:480px; margin:0 auto; min-height:52px; border:0; border-radius:999px; background:var(--ink); color:#fff; font:inherit; font-weight:700; font-size:16px; cursor:pointer; box-shadow:0 14px 34px -12px rgba(11,27,51,.55); }
  .notes-bar[hidden], .sheet[hidden], .sheet-back[hidden], .pin[hidden] { display:none; }
  .sheet-back { position:fixed; inset:0; z-index:70; background:rgba(11,27,51,.42); }
  .sheet { position:fixed; left:0; right:0; bottom:0; z-index:71; max-height:78vh; overflow:auto; background:#fff; border-radius:18px 18px 0 0; padding:6px 16px 20px; box-shadow:0 -20px 50px -20px rgba(11,27,51,.4); }
  .sheet-head { display:flex; align-items:center; justify-content:space-between; padding:12px 0 8px; }
  .sheet-head h2 { font-size:20px; margin:0; }
  .x { width:40px; height:40px; border-radius:50%; border:1px solid var(--line); background:#fff; font-size:22px; line-height:1; cursor:pointer; color:var(--ink); }
  .sheet ol { list-style:none; margin:0; padding:0; }
  .sheet-note { display:flex; gap:12px; align-items:flex-start; width:100%; text-align:left; background:none; border:0; border-top:1px solid var(--line); padding:14px 2px; font:inherit; color:var(--ink); cursor:pointer; }
  .sheet-note b { display:block; font-size:15px; } .sheet-note small { color:var(--muted); font-size:13px; }
  .pin { position:fixed; left:12px; right:12px; bottom:74px; z-index:65; max-width:480px; margin:0 auto; }
  .pin .card { position:relative; padding-right:44px; box-shadow:0 20px 44px -16px rgba(11,27,51,.5); border-color:var(--blue); }
  .pin .x { position:absolute; top:8px; right:8px; width:32px; height:32px; font-size:18px; }

  /* 4. What's the catch */
  .catch { background:var(--card); border:1px solid var(--line); border-radius:20px; padding:26px 28px; margin:36px 0 28px; display:grid; grid-template-columns:1fr auto; gap:20px; align-items:center; }
  .catch ul { margin:8px 0 0; padding-left:20px; color:var(--ink2); }
  .catch li + li { margin-top:4px; }
  .price { text-align:right; }
  .price b { display:block; font-size:40px; letter-spacing:-.02em; line-height:1.1; color:var(--blue); }
  .price span { color:var(--muted); font-size:14px; }

  /* 5. Talk to Jack */
  .contact { padding:8px 0 48px; }
  .buttons { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; }
  .btn { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px; min-height:72px; border-radius:16px; border:1px solid #C9D3E0; background:var(--card); color:#22314A; font:inherit; font-weight:700; font-size:17px; text-decoration:none; cursor:pointer; padding:12px; transition:border-color .15s, background .15s; }
  .btn:hover { border-color:var(--blue); background:var(--blue-bg); color:var(--ink); }
  .btn small { font-weight:400; color:var(--muted); font-size:13px; }
  .btn.primary { background:var(--blue); border-color:var(--blue); color:#fff; box-shadow:0 12px 32px -12px rgba(31,95,191,.55); }
  .btn.primary:hover { background:var(--blue-ink); border-color:var(--blue-ink); }
  .btn.primary small { color:#dbe8ff; }
  .panel { display:none; background:var(--card); border:1px solid var(--line); border-radius:16px; padding:18px; margin-top:12px; max-width:640px; }
  .panel.open { display:block; }
  .panel label { display:block; font-size:14px; font-weight:600; margin:0 0 4px; }
  .panel input, .panel select, .panel textarea { width:100%; font:inherit; font-size:16px; padding:10px 12px; border:1.5px solid var(--line); border-radius:10px; margin:0 0 12px; background:#fff; color:var(--ink); }
  .panel input:focus, .panel select:focus, .panel textarea:focus { outline:none; border-color:var(--blue); }
  .row { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .panel button[type=submit] { background:var(--blue); color:#fff; border:0; border-radius:999px; padding:12px 22px; font:inherit; font-weight:700; cursor:pointer; }
  .panel button[type=submit]:hover { background:var(--blue-ink); }
  .msg { margin:10px 0 0; font-weight:600; }
  .msg.ok { color:var(--green); } .msg.err { color:var(--red); }
  .keep { text-align:center; color:var(--muted); margin:20px 0 0; }
  .keep a { color:var(--blue); font-weight:600; }
  footer { border-top:1px solid var(--line); color:var(--muted); font-size:13px; padding:20px 0 32px; }
  @media (max-width:860px) {
    .hero-grid { grid-template-columns:1fr; grid-template-areas:"copy" "side" "ctas"; }
    .hero-side { background:none; border:0; padding:0; margin:0 0 22px; }
    .lede { margin-bottom:18px; }
    .catch { grid-template-columns:1fr; }
    .price { text-align:left; }
  }
  @media (max-width:560px) {
    .from { display:none; }
    .hero { padding-top:24px; }
    .lede { font-size:17px; }
    .sells { gap:9px; } .sells li { font-size:15px; } .sells .ic { flex-basis:32px; height:32px; }
    .already { margin-top:14px; }
    .b-primary { width:100%; }
    .cta-row .b-secondary { flex:1 1 0; padding:0 10px; min-width:0; }
    .buttons, .row { grid-template-columns:1fr; }
    .browser iframe { height:900px; }
    .browser-bar { height:34px; } .dots i { width:8px; height:8px; }
    .doc { padding:0 10px; }
  }
  @media (prefers-reduced-motion:reduce) {
    .card.is-pulse { animation:none; }
    .js .rail.is-placed .card { transition:none; }
  }
</style>
</head>
<body>
<header class="top"><div class="wrap"><a class="brand" href="/" aria-label="Enoma home"><img src="/assets/logos/enoma-color-name.svg" alt="Enoma" width="90" height="26"></a><div class="top-right"><span class="from">From Jack at Enoma</span><a class="top-cta" href="${esc(links.claim)}" data-cta="claim" data-where="nav">Claim my page</a></div></div></header>

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
          <a class="b b-primary" id="cta-claim" href="${esc(links.claim)}" data-cta="claim" data-where="hero">Claim my page, first month free</a>
          <button class="b b-secondary" id="cta-text" type="button" data-panel="hero-text" data-cta="text" data-where="hero">Text Jack</button>
          <a class="b b-secondary" id="cta-email" href="${esc(mailto)}" data-email data-cta="email" data-where="hero">Email Jack</a>
        </div>
        <p class="fine">First month free, then $19.99/month or $199/year. No contract, cancel anytime.</p>
        <a class="sub-link" id="cta-subscribe" href="${esc(links.subscribe)}" data-cta="subscribe" data-where="hero">Or subscribe now: $19.99/month or $199/year</a>
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
      <a class="b b-primary" href="${esc(links.claim)}" data-cta="claim" data-where="notes">Claim my page, first month free</a>
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
        <li>Your first month is free.</li>
        <li>Then $19.99/month or $199/year, with me as your account manager: your changes go live within two business days.</li>
        <li>No per-lead fees, no contract. Cancel anytime.</li>
        <li>A page for any extra service you want found for: $9.99/month each.</li>
      </ul>
    </div>
    <div class="price"><b>$19.99</b><span>a month after the free month, or $199/year</span></div>
  </section>

  <section class="contact" aria-labelledby="contact-h">
    <h2 id="contact-h">Talk to Jack</h2>
    <p class="sub">Pick whatever's easiest. I'm a real person and I'll get back to you.</p>
    <div class="buttons">
      <a class="btn" id="btn-email" href="${esc(mailto)}" data-email data-cta="email" data-where="contact">Email me<small>jack@enoma.io</small></a>
      <button class="btn" type="button" data-panel="text" data-cta="text" data-where="contact">Text me<small>I'll text you</small></button>
      <button class="btn primary" type="button" data-panel="book" data-cta="book" data-where="contact">Book 10 minutes<small>Pick a time, I'll call</small></button>
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

    <p class="keep">Ready already? <a href="${esc(links.claim)}" data-cta="claim" data-where="contact">Keep this page</a></p>
  </section>
  </div>
</main>

<footer><div class="wrap">Enoma builds one page for local service businesses, made to be found. This preview isn't listed on Google until you keep it.</div></footer>

<script src="/scripts/funnel-track.js"></script>
<script>
(function () {
  var ctx = ${data};
  var api = "/api/ga-metrics?action=landing_contact";
  // Jack's devices: ?internal=1 flags this browser (same flag as the GA snippet).
  try { var im = location.search.match(/[?&]internal=([01])(?:&|$)/); if (im) localStorage.setItem("enoma_internal", im[1]); } catch (e) {}
  function isInternal() { try { return localStorage.getItem("enoma_internal") === "1"; } catch (e) { return false; } }
  function track(event, extra) {
    if (isInternal() || typeof window.enomaTrack !== "function") return;
    var meta = { slug: ctx.slug };
    if (ctx.m) meta.m = ctx.m;
    if (ctx.src) meta.src = ctx.src;
    for (var k in extra) if (extra[k] != null) meta[k] = extra[k];
    window.enomaTrack(event, meta);
  }
  window.enomaLandingTrack = track;
  function send(payload) {
    return fetch(api, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({}, ctx, payload)), keepalive: true })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok && j.success, error: j.error }; }); })
      .catch(function () { return { ok: false }; });
  }
  try { fetch("/api/track", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug: ctx.slug, event: "landing_view", internal: isInternal() || undefined, metadata: ctx.m ? { m: ctx.m } : ctx.src ? { src: ctx.src } : {} }), keepalive: true }); } catch (e) {}

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
    ".enl-box{position:absolute;border:2px dashed rgba(31,95,191,.55);background:rgba(255,222,89,.13);border-radius:8px;transition:background .15s,border-color .15s,box-shadow .15s}" +
    ".enl-box.is-on{border-color:#1F5FBF;background:rgba(255,214,51,.3);box-shadow:0 0 0 4px rgba(31,95,191,.18)}" +
    ".enl-mark{position:absolute;pointer-events:auto;width:28px;height:28px;padding:0;border-radius:50%;border:2px solid #fff;background:#1F5FBF;color:#fff;font:500 13px/24px 'IBM Plex Mono',ui-monospace,monospace;text-align:center;cursor:pointer;box-shadow:0 3px 10px rgba(11,27,51,.35);transition:transform .15s}" +
    ".enl-mark.is-on{transform:scale(1.18)}" +
    ".enl-mark:focus-visible{outline:3px solid #9cc2ff;outline-offset:2px}" +
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
