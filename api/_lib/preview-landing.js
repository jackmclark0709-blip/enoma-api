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
      body: "We made a placeholder from your name. Send us your logo, or a photo of your truck, and it goes in." });
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

/** The full landing page HTML. */
export function renderLanding(profile, { callouts = [], working = [], slug, m = null, src = null } = {}) {
  const p = profile || {};
  const name = p.business_name || slug;
  const instant = landingSource({ src, m }) === "instant";
  const q = m ? `?m=${encodeURIComponent(m)}` : "";
  const pageUrl = `/${encodeURIComponent(slug)}`;
  const claimUrl = `/${encodeURIComponent(slug)}?claim=1${m ? `&m=${encodeURIComponent(m)}` : ""}`;
  const phone = p.phone || "";
  const mailto = `mailto:jack@enoma.io?subject=${encodeURIComponent(`My Enoma page: ${name}`)}&body=${encodeURIComponent(`Hi Jack,\n\nAbout my page (enoma.io/${slug}):\n\n`)}`;
  const calloutHtml = callouts.map((c, i) => `
        <li class="note" data-key="${esc(c.key)}">
          <span class="num">${i + 1}</span>
          <div><p class="where">${esc(c.where)}</p><h3>${esc(c.title)}</h3><p>${esc(c.body)}</p></div>
        </li>`).join("");
  const dayOpts = BOOK_DAYS.map(d => `<option value="${d}">${DAY_LABEL[d]}</option>`).join("");
  const winOpts = BOOK_WINDOWS.map(w => `<option value="${w}">${WINDOW_LABEL[w]}</option>`).join("");
  const data = JSON.stringify({ slug, m, src: instant ? "instant" : null }).replace(/</g, "\\u003c");
  const eyebrow = instant ? "Live as a preview" : "Ready to go live";
  const headline = instant ? `Here's your page, ${esc(name)}` : `Here's a preview of your page, ${esc(name)}`;
  const lede = instant
    ? "It's live as a preview. Keep it free for a month, then $19.99/month or $199/year. Here's what's already on it:"
    : "It's ready to go. Here's what's already on it:";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Your page preview: ${esc(name)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Instrument+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500&display=swap" rel="stylesheet">
<style>
  /* Same tokens and type as the enoma.io homepage (public/index.html, light theme). */
  :root { --ink:#0B1B33; --ink2:#3B4A63; --muted:#55647D; --line:#DCE3ED; --bg:#F6F8FB; --card:#fff; --blue:#1F5FBF; --blue-ink:#163F7F; --blue-bg:#EEF4FD; --blue-line:#C9DAF3; --red:#c62828; --green:#1e7d4f;
    --display:'Fraunces',Georgia,serif; --sans:'Instrument Sans',-apple-system,system-ui,sans-serif; --mono:'IBM Plex Mono',ui-monospace,monospace; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:var(--sans); color:var(--ink); background:var(--bg); line-height:1.5; -webkit-font-smoothing:antialiased; }
  .wrap { max-width:1120px; margin:0 auto; padding:0 16px; }
  header.top { background:rgba(255,255,255,.96); border-bottom:1px solid var(--line); }
  header.top .wrap { display:flex; align-items:center; justify-content:space-between; height:60px; }
  .brand { display:block; text-decoration:none; }
  .brand img { display:block; height:26px; width:auto; }
  .from { color:var(--muted); font-size:14px; }
  .hero { padding:44px 0 24px; }
  .eyebrow { display:inline-block; font-family:var(--mono); font-size:12px; font-weight:500; letter-spacing:.16em; text-transform:uppercase; color:var(--blue); }
  h1, h2, .price b { font-family:var(--display); font-optical-sizing:auto; font-weight:600; color:var(--ink); }
  h1 { font-size:clamp(28px,4.5vw,44px); line-height:1.1; letter-spacing:-.025em; margin:12px 0 10px; }
  .lede { color:var(--ink2); font-size:18px; max-width:680px; margin:0 0 20px; }
  .working { list-style:none; padding:0; margin:0; display:flex; flex-wrap:wrap; gap:8px; }
  .working li { background:var(--card); border:1px solid var(--line); border-radius:999px; padding:7px 14px; font-size:14px; color:var(--ink2); }
  .working li::before { content:"✓ "; color:var(--blue); font-weight:700; }
  .values { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin:28px 0 8px; }
  .value { background:var(--card); border:1px solid var(--line); border-radius:16px; padding:16px 18px; }
  .value h3 { font-size:15px; font-weight:700; margin:0 0 4px; }
  .value p { margin:0; color:var(--muted); font-size:14px; }
  section.review { padding:28px 0; }
  h2 { font-size:28px; letter-spacing:-.02em; line-height:1.15; margin:0 0 6px; }
  .sub { color:var(--muted); margin:0 0 18px; }
  .redline { display:grid; grid-template-columns:minmax(0,420px) minmax(0,1fr); gap:28px; align-items:start; }
  .device { position:sticky; top:16px; background:#0B1B33; border-radius:34px; padding:12px; box-shadow:0 30px 70px -30px rgba(11,27,51,.35); }
  .device iframe { display:block; width:100%; height:min(760px,78vh); border:0; border-radius:24px; background:#fff; }
  .open-full { display:block; text-align:center; margin-top:10px; font-size:14px; color:var(--blue); font-weight:600; }
  .notes { list-style:none; margin:0; padding:0; display:grid; gap:12px; }
  .note { display:flex; gap:14px; background:var(--card); border:1px solid var(--line); border-left:3px solid var(--blue); border-radius:14px; padding:16px 18px; }
  .note .num { flex:0 0 28px; height:28px; border-radius:50%; background:var(--blue-bg); border:1px solid var(--blue-line); color:var(--blue); font-family:var(--mono); font-weight:500; font-size:13px; display:grid; place-items:center; }
  .note .where { margin:0; font-family:var(--mono); font-size:11px; font-weight:500; text-transform:uppercase; letter-spacing:.14em; color:var(--blue); }
  .note h3 { margin:3px 0 4px; font-size:16px; font-weight:700; }
  .note p { margin:0; color:var(--ink2); font-size:14px; }
  .notes-foot { color:var(--muted); font-size:14px; margin:14px 0 0; }
  .catch { background:var(--card); border:1px solid var(--line); border-radius:20px; padding:26px 28px; margin:12px 0 28px; display:grid; grid-template-columns:1fr auto; gap:20px; align-items:center; }
  .catch ul { margin:8px 0 0; padding-left:20px; color:var(--ink2); }
  .price { text-align:right; }
  .price b { display:block; font-size:40px; letter-spacing:-.02em; line-height:1.1; color:var(--blue); }
  .price span { color:var(--muted); font-size:14px; }
  .contact { padding:8px 0 48px; }
  .buttons { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; }
  .btn { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px; min-height:72px; border-radius:16px; border:1px solid #C9D3E0; background:var(--card); color:#22314A; font:inherit; font-weight:700; font-size:17px; text-decoration:none; cursor:pointer; padding:12px; transition:border-color .15s, background .15s; }
  .btn:hover { border-color:var(--blue); background:var(--blue-bg); color:var(--ink); }
  .btn small { font-weight:400; color:var(--muted); font-size:13px; }
  .btn.primary { background:var(--blue); border-color:var(--blue); color:#fff; box-shadow:0 12px 32px -12px rgba(31,95,191,.55); }
  .btn.primary:hover { background:var(--blue-ink); border-color:var(--blue-ink); }
  .btn.primary small { color:#dbe8ff; }
  .btn:focus-visible { outline:3px solid #9cc2ff; outline-offset:2px; }
  .panel { display:none; background:var(--card); border:1px solid var(--line); border-radius:16px; padding:18px; margin-top:12px; }
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
    .values { grid-template-columns:1fr 1fr; }
    .redline { grid-template-columns:1fr; }
    .device { position:static; max-width:420px; margin:0 auto; }
    .catch { grid-template-columns:1fr; }
    .price { text-align:left; }
  }
  @media (max-width:560px) {
    .values, .buttons, .row { grid-template-columns:1fr; }
    .device iframe { height:70vh; }
  }
</style>
</head>
<body>
<header class="top"><div class="wrap"><a class="brand" href="/" aria-label="Enoma home"><img src="/assets/logos/enoma-color-name.svg" alt="Enoma" width="90" height="26"></a><span class="from">From Jack at Enoma</span></div></header>

<main class="wrap">
  <section class="hero">
    <span class="eyebrow">${eyebrow}</span>
    <h1>${headline}</h1>
    <p class="lede">${lede}</p>
    <ul class="working">${working.map(w => `<li>${esc(w)}</li>`).join("")}</ul>

    <div class="values">
      <div class="value"><h3>Built to be found</h3><p>Made for Google and AI assistants, so people searching nearby can find you.</p></div>
      <div class="value"><h3>Tap to call</h3><p>One tap from the page to your phone.</p></div>
      <div class="value"><h3>Your leads only</h3><p>Every call and request goes to you. Nothing is shared with other companies.</p></div>
      <div class="value"><h3>No per-lead fees</h3><p>One flat monthly price, however many people call.</p></div>
    </div>
  </section>

  <section class="review" aria-labelledby="review-h">
    <h2 id="review-h">What I'd add with you</h2>
    <p class="sub">My notes on your page. Each one is a few minutes of your time, and I do the work.</p>
    <div class="redline">
      <div>
        <div class="device"><iframe src="${pageUrl}?embed=1" title="Preview of ${esc(name)}'s page" loading="lazy"></iframe></div>
        <a class="open-full" href="${pageUrl}${q}" target="_blank" rel="noopener">Open your page full screen ↗</a>
      </div>
      <div>
        <ol class="notes">${calloutHtml}
        </ol>
        <p class="notes-foot">Nothing on your page changes until you say so.</p>
      </div>
    </div>
  </section>

  <section class="catch" aria-labelledby="catch-h">
    <div>
      <h2 id="catch-h">What's the catch?</h2>
      <ul>
        <li>Your first month is free.</li>
        <li>No per-lead fees, no contract. Cancel anytime.</li>
        <li>Not techy? I'll set it up with you over the phone.</li>
      </ul>
    </div>
    <div class="price"><b>$19.99</b><span>a month after the free month, or $199/year</span></div>
  </section>

  <section class="contact" aria-labelledby="contact-h">
    <h2 id="contact-h">Talk to Jack</h2>
    <p class="sub">Pick whatever's easiest. I'm a real person and I'll get back to you.</p>
    <div class="buttons">
      <a class="btn" id="btn-email" href="${esc(mailto)}">Email me<small>jack@enoma.io</small></a>
      <button class="btn" type="button" data-panel="text">Text me<small>I'll text you</small></button>
      <button class="btn primary" type="button" data-panel="book">Book 10 minutes<small>Pick a time, I'll call</small></button>
    </div>

    <form class="panel" id="panel-text" data-kind="text">
      <label for="text-phone">Your cell number</label>
      <input id="text-phone" name="phone" type="tel" autocomplete="tel" inputmode="tel" value="${esc(phone)}" required>
      <label for="text-note">Anything you want me to know? (optional)</label>
      <textarea id="text-note" name="note" rows="2" maxlength="300"></textarea>
      <button type="submit">Text me</button>
      <p class="msg" role="status" aria-live="polite"></p>
    </form>

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

    <p class="keep">Ready already? <a href="${esc(claimUrl)}">Keep this page</a></p>
  </section>
</main>

<footer><div class="wrap">Enoma builds one page for local service businesses, made to be found. This preview isn't listed on Google until you keep it.</div></footer>

<script>
(function () {
  var ctx = ${data};
  var api = "/api/ga-metrics?action=landing_contact";
  function send(payload) {
    return fetch(api, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({}, ctx, payload)), keepalive: true })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok && j.success, error: j.error }; }); })
      .catch(function () { return { ok: false }; });
  }
  try { fetch("/api/track", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug: ctx.slug, event: "landing_view", metadata: ctx.m ? { m: ctx.m } : ctx.src ? { src: ctx.src } : {} }), keepalive: true }); } catch (e) {}

  document.getElementById("btn-email").addEventListener("click", function () { send({ kind: "email" }); });
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
</body>
</html>`;
}
