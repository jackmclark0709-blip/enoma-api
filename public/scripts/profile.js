// Devices flagged as Jack's (the enoma_internal cookie from /internal-optout,
// or ?internal=1 via the GA snippet) don't count toward a page's views or
// clicks: events are sent with internal:true. See api/track.js.
function enomaIsInternal() {
  try { if (/(?:^|;\s*)enoma_internal=1(?:;|$)/.test(document.cookie)) return true; } catch (e) {}
  try { return localStorage.getItem('enoma_internal') === '1'; } catch (e) { return false; }
}

// public/scripts/profile.js
// Behaviour for Enoma company pages (public/profile.html). Every block is
// rendered on the server (api/_lib/company-page.js) and is absent when it has
// no data; this script never draws content. It adds: "Open now", logo colour,
// before/after sliders, FAQ toggles, maps, the #quote?service=<slug> deep
// link, click tracking, the claim banner and the preview poll. It reads
// window.__PROFILE__ (behaviour data only), set inline by the page.
/* ── Utilities ── */
const getEl = id => document.getElementById(id);
const escapeHtml = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/* ── Claim by email link (no password) ──
   The owner gets a Supabase sign-in link that lands on /claim, which claims
   the page with the new session. Fresh instant previews (?new=1) open the
   form straight away; other unclaimed previews open it from the banner. */
// The funnel's anonymous browser id (public/scripts/funnel-track.js), so a
// claim request joins up with the instant-preview events before it.
function anonId() {
  if (typeof window.enomaAnonId === 'function') { const id = window.enomaAnonId(); if (id) return id; }
  try { return localStorage.getItem('enoma_anon_id') || null; } catch (_) { return null; }
}
function setupClaimBox(pageSlug, businessName) {
  const banner = getEl('unclaimedBanner'), box = getEl('claimBox'), line = getEl('unclaimedLine');
  const form = getEl('claimForm'), input = getEl('claimEmail'), submit = getEl('claimSubmit'), msg = getEl('claimMsg');
  const cta = getEl('unclaimedCta');
  if (!banner || !box || !form || !pageSlug) return;
  const qs = new URLSearchParams(window.location.search);
  const outreachMsg = qs.get('m') || '';
  // "Prefer to pay yearly? $199/year" on the preview landing claims with
  // ?plan=year. Checkout only happens after the claim, so remember the choice
  // for this tab and the dashboard's plan picker preselects it.
  const planIntent = qs.get('plan');
  if (planIntent === 'year' || planIntent === 'month') { try { sessionStorage.setItem('enoma_plan_intent', planIntent); } catch (_) {} }
  const open = () => { box.classList.remove('hidden'); line.classList.add('hidden'); };
  // "Questions? Talk to Jack" goes to the preview landing (email, text or book
  // 10 minutes). Cold-email owners keep their message id for attribution.
  const help = getEl('claimHelp');
  if (help) help.href = '/' + encodeURIComponent(pageSlug) + '/preview' + (outreachMsg ? '?m=' + encodeURIComponent(outreachMsg) : '');
  if (qs.get('claim') === '1') { banner.classList.add('is-new'); open(); }
  // The owner arrived from Jack's email (?m=<message id>): greet them, open
  // the claim box and say plainly what keeping it costs. Jack's contact only
  // shows here, never to a customer who finds the page on Google.
  if (outreachMsg) {
    banner.classList.add('is-new'); open();
    const t = getEl('claimTitle'), sub = getEl('claimSub');
    if (t) t.textContent = `Hi, it's Jack. This page is for ${businessName || 'you'}.`;
    if (sub) sub.textContent = "Here's a first draft of your page. Keep it for $1 your first month and I'll make it better with you.";
    submit.textContent = 'Keep my page';
    // What's done and what's still missing, from this page's own data, so
    // $19.99 reads as "it keeps getting better", not just "it stays up".
    const extras = getEl('ownerExtras');
    if (extras) {
      extras.classList.remove('hidden');
      import('/scripts/page-checklist.js').then(({ pageChecklist, nextSteps }) => {
        const c = pageChecklist(window.__PROFILE__ || {});
        getEl('ownerPercent').textContent = `Your page is ${c.percent}% done`;
        getEl('ownerBar').style.width = `${c.percent}%`;
        const list = getEl('ownerList');
        list.innerHTML = '';
        // Missing items first, most useful first: they're the point.
        [...nextSteps(window.__PROFILE__ || {}), ...c.items.filter(i => i.done)].forEach(i => {
          const li = document.createElement('li');
          li.textContent = i.label;
          if (i.done) li.className = 'is-done';
          list.appendChild(li);
        });
      }).catch(() => { extras.querySelector('.owner-progress')?.remove(); });
    }
    // This visitor is the owner, so the "Call Now" bar would only call
    // themselves; hide it and give the claim box the room.
    const bar = getEl('mobileCallBar');
    if (bar) { bar.classList.add('hidden'); document.body.classList.remove('has-mobile-call-bar'); }
    document.body.classList.add('is-owner-view');
    // Prefill with the address the email went to, so keeping it is one tap.
    fetch('/api/ga-metrics?action=claim_hint&m=' + encodeURIComponent(outreachMsg) + '&slug=' + encodeURIComponent(pageSlug))
      .then(r => r.ok ? r.json() : {}).then(d => { if (d && d.email && !input.value) input.value = d.email; }).catch(() => {});
    if (window.gtag) try { gtag('event', 'outreach_preview_viewed', { page_slug: pageSlug }); } catch (e) {}
  }
  const submitLabel = submit.textContent;
  if (qs.get('new') === '1') {
    banner.classList.add('is-new'); open();
    if (window.gtag) try { gtag('event', 'instant_preview_viewed', { page_slug: pageSlug }); } catch (e) {}
  }
  if (cta) cta.addEventListener('click', e => { e.preventDefault(); open(); input.focus(); });
  const say = (text, isError) => { msg.textContent = text; msg.classList.remove('hidden'); msg.classList.toggle('is-error', !!isError); };
  const loadSupabase = () => window.supabase ? Promise.resolve() : new Promise((resolve, reject) => {
    const sc = document.createElement('script');
    sc.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js';
    sc.onload = resolve; sc.onerror = reject; document.head.appendChild(sc);
  });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const email = input.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { say('Please enter a valid email address.', true); input.focus(); return; }
    submit.disabled = true; submit.textContent = 'Sending…';
    try {
      await loadSupabase();
      const sb = window.supabase.createClient('https://qhsivcenpnxwmvwznqie.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFoc2l2Y2VucG54d212d3pucWllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ2ODQ4NjMsImV4cCI6MjA4MDI2MDg2M30.g_3eHoqfo7R15Q_9OoBy0DTq66a3BPA838VFd1aZtnc');
      const redirect = 'https://enoma.io/claim?business=' + encodeURIComponent(pageSlug) + (outreachMsg ? '&m=' + encodeURIComponent(outreachMsg) : '');
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect, shouldCreateUser: true } });
      if (error) throw error;
      form.classList.add('hidden');
      say(`Check your inbox at ${email}. Tap the link in the email and the page is yours. (It can take a minute; check spam if you don't see it.)`);
      try { fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true, body: JSON.stringify({ event: 'claim_link_requested', anon_id: anonId(), business_id: (window.__PROFILE__ || {}).business_id || null, metadata: { slug: pageSlug } }) }); } catch (_) {}
      if (window.gtag) try { gtag('event', 'claim_link_requested', { page_slug: pageSlug, transport_type: 'beacon' }); } catch (_) {}
    } catch (err) {
      submit.disabled = false; submit.textContent = submitLabel;
      say(/rate|seconds/i.test(err?.message || '') ? 'We just sent a link. Please wait a minute before asking for another.' : 'Something went wrong sending your link. Try again, or email jack@enoma.io.', true);
    }
  });
}

/* Session recording (Microsoft Clarity) only on unclaimed previews, never on
   a customer's live page. No-op until a project id is set in clarity.js. */
function loadClarity() {
  const sc = document.createElement('script');
  sc.src = '/scripts/clarity.js'; sc.defer = true; document.head.appendChild(sc);
}

/* ── Preview-page poll ──
   One question on unclaimed preview pages, once per page per browser, after
   the visitor has had a moment with the page. Answers land in the feedback
   table via /api/track. Stays out of the way of the claim form. */
// The poll asks a stranger "would you use a page like this?". Jack's cold
// email (?m=<message id>) brings the owner, with the claim box open and
// prefilled with their address: the poll would sit on top of that, so it
// stays off for them, and whenever the claim box is open.
function previewPollAllowed(search, claimBox, claimInput) {
  let m = null;
  try { m = new URLSearchParams(search || '').get('m'); } catch (_) {}
  if (m) return false;
  if (claimBox && !claimBox.classList.contains('hidden')) return false;
  if (claimInput && claimInput.value) return false;
  return true;
}
function setupPreviewPoll(pageSlug) {
  const poll = getEl('previewPoll');
  if (!poll || !pageSlug) return;
  const allowed = () => previewPollAllowed(window.location.search, getEl('claimBox'), getEl('claimEmail'));
  if (!allowed()) return;
  const key = 'enoma_poll_' + pageSlug;
  try { if (localStorage.getItem(key)) return; } catch (_) {}
  const remember = () => { try { localStorage.setItem(key, '1'); } catch (_) {} };
  const step1 = getEl('pollStep1'), step2 = getEl('pollStep2'), thanks = getEl('pollThanks');
  const claimInput = getEl('claimEmail');
  let shown = false, votePending = null, answer = null;
  const post = (body) => fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true, body: JSON.stringify(body) })
    .then(r => r.ok ? r.json() : {}).catch(() => ({}));
  const show = () => {
    if (shown) return;
    if (claimInput && document.activeElement === claimInput) return; // don't interrupt a claim
    if (!allowed()) return; // the claim box opened since the page loaded
    shown = true;
    poll.classList.remove('hidden');
    requestAnimationFrame(() => poll.classList.add('is-shown'));
    window.removeEventListener('scroll', onScroll);
  };
  const hide = () => { poll.classList.remove('is-shown'); setTimeout(() => poll.classList.add('hidden'), 250); };
  const onScroll = () => {
    const h = document.documentElement.scrollHeight - window.innerHeight;
    if (h > 0 && window.scrollY / h > 0.4) show();
  };
  setTimeout(show, 15000);
  window.addEventListener('scroll', onScroll, { passive: true });
  getEl('pollClose').addEventListener('click', () => { remember(); hide(); });
  const m = new URLSearchParams(window.location.search).get('m') || null;
  step1.querySelectorAll('button[data-answer]').forEach(btn => btn.addEventListener('click', () => {
    answer = btn.getAttribute('data-answer');
    remember();
    votePending = post({ event: 'feedback', source: 'preview_poll', answer, slug: pageSlug, m: /^[0-9a-f-]{36}$/i.test(m || '') ? m : null });
    try { if (window.gtag) gtag('event', 'preview_poll', { answer, page_slug: pageSlug }); } catch (_) {}
    step1.classList.add('hidden');
    getEl('pollQ2').textContent = answer === 'yes' ? 'Great! Anything you\u2019d change?' : answer === 'maybe' ? 'What would make it a yes?' : 'What\u2019s missing, or why not?';
    step2.classList.remove('hidden');
  }));
  step2.addEventListener('submit', e => {
    e.preventDefault();
    const text = getEl('pollComment').value.trim();
    // Wait for the vote's row id so the comment attaches to it instead of
    // inserting a second vote while the first request is still in flight.
    if (text && votePending) votePending.then(r => { if (r && r.id) post({ event: 'feedback', feedback_id: r.id, comment: text }); });
    step2.classList.add('hidden');
    thanks.classList.remove('hidden');
    setTimeout(hide, 2500);
  });
}

/* ── Page events (page_events via /api/track, with the page slug) ──
   No personal data: a type or a service slug, never what a visitor typed. */
function trackPageEvent(event, metadata) {
  const slug = window.profileData?.username;
  if (!slug) return;
  try { if (new URLSearchParams(location.search).get('embed') === '1') return; } catch (e) {}
  try { if (typeof window.gtag === 'function') window.gtag('event', event, Object.assign({ page_slug: slug, transport_type: 'beacon' }, metadata || {})); } catch (e) {}
  try {
    fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true, body: JSON.stringify({ slug, event, metadata: metadata || {}, internal: enomaIsInternal() || undefined }) }).catch(() => {});
  } catch (e) {}
}

function trackContactClick(type) {
  if (!window.profileData?.username) return;
  // Mirror to GA4 so calls/quote taps on client pages show up as a key event.
  // Beacon transport: most of these clicks open the dialer or navigate away.
  try { if (typeof window.gtag === 'function') window.gtag('event', 'client_contact_click', { contact_type: type, page_slug: window.profileData.username, transport_type: 'beacon' }); } catch (e) {}
  fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true, body: JSON.stringify({ slug: window.profileData.username, event: 'contact_click', metadata: { type }, internal: enomaIsInternal() || undefined }) }).catch(() => {});
}

/* ── Brand color extraction from logo ── */
function luminance(r, g, b) {
  const a = [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}
function ensureUsableBrandColor([r, g, b]) {
  let lum = luminance(r, g, b);
  while (lum > 0.55) { r *= 0.88; g *= 0.88; b *= 0.88; lum = luminance(r, g, b); }
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}
function applyBrandColor(color) {
  const root = document.documentElement;
  root.style.setProperty('--brand-primary', color);
  root.style.setProperty('--brand-primary-10', `color-mix(in srgb, ${color} 10%, white)`);
  root.style.setProperty('--brand-primary-30', `color-mix(in srgb, ${color} 28%, white)`);
  // Extract RGB components for use in radial glows
  const m = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (m) root.style.setProperty('--brand-rgb', `${m[1]},${m[2]},${m[3]}`);
}
function extractDominantColor(img, callback) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const size = 64;
  canvas.width = canvas.height = size;
  ctx.drawImage(img, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size).data;
  const colors = {};
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
    if (a < 200 || (r > 235 && g > 235 && b > 235)) continue;
    const key = `${Math.round(r/16)*16},${Math.round(g/16)*16},${Math.round(b/16)*16}`;
    colors[key] = (colors[key] || 0) + 1;
  }
  const dominant = Object.entries(colors).sort((a, b) => b[1] - a[1])[0];
  if (!dominant) { callback(null); return; }
  const [r, g, b] = dominant[0].split(',').map(Number);
  callback(ensureUsableBrandColor([r, g, b]));
}

/* ── Before/After slider ── */
function baDemoSvg(label, bg) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='800' height='600'><rect width='100%' height='100%' fill='${bg}'/><text x='50%' y='50%' font-family='sans-serif' font-size='42' fill='white' text-anchor='middle' dominant-baseline='middle'>${label}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
const BA_DEMO_IMAGES = [
  { before: baDemoSvg('BEFORE (demo)', '#8a6d3b'), after: baDemoSvg('AFTER (demo)', '#2d6a2d'), caption: 'Demo placeholder — front yard renovation' },
  { before: baDemoSvg('BEFORE (demo)', '#5a4a3a'), after: baDemoSvg('AFTER (demo)', '#1a5a3a'), caption: 'Demo placeholder — backyard patio install' }
];
function buildBASlider(item) {
  const outer = document.createElement('div');
  const frame = document.createElement('div');
  frame.className = 'ba-slider';
  frame.innerHTML = `
    <img class="ba-after" src="${item.after}" alt="After" loading="lazy" />
    <span class="ba-tag ba-tag-after">After</span>
    <div class="ba-before-wrap"><img class="ba-before" src="${item.before}" alt="Before" loading="lazy" /></div>
    <span class="ba-tag ba-tag-before">Before</span>
    <div class="ba-handle"></div>
    <input type="range" class="ba-range" min="0" max="100" value="50" aria-label="Drag to compare before and after photos" />
  `;
  outer.appendChild(frame);
  if (item.caption) {
    const cap = document.createElement('p');
    cap.className = 'ba-caption';
    cap.textContent = item.caption;
    outer.appendChild(cap);
  }

  const beforeWrap = frame.querySelector('.ba-before-wrap');
  const beforeImg = frame.querySelector('.ba-before');
  const afterImg = frame.querySelector('.ba-after');
  const handle = frame.querySelector('.ba-handle');
  const range = frame.querySelector('.ba-range');

  const syncWidth = () => { beforeImg.style.width = frame.clientWidth + 'px'; };
  const setPos = val => { beforeWrap.style.width = val + '%'; handle.style.left = val + '%'; };
  range.addEventListener('input', () => setPos(range.value));
  window.addEventListener('resize', syncWidth);
  if (afterImg.complete) syncWidth(); else afterImg.addEventListener('load', syncWidth);
  setPos(50);

  return outer;
}

/* ── Service quote deep link: #quote?service=<slug> ──
   Opens the quote form with that service ticked (quote-form.js
   preselectService), from a service card's "Get a quote" or a shared link. */
function quoteServiceFromHash(hash) {
  const m = String(hash || '').match(/^#quote(?:\?(.*))?$/);
  if (!m) return null;
  try { return new URLSearchParams(m[1] || '').get('service') || ''; } catch (e) { return ''; }
}
function openQuoteForService(slug) {
  const form = window.enomaQuoteForm;
  if (slug && form && typeof form.preselectService === 'function') form.preselectService(slug);
  const target = getEl('contact');
  if (target) {
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }
}
function setupQuoteDeepLinks() {
  const fromHash = () => { const slug = quoteServiceFromHash(location.hash); if (slug !== null) openQuoteForService(slug); };
  // quote-form.js is deferred: it has run by now (DOMContentLoaded), but
  // wait a tick so its stepper is set up before we move it to step 2.
  setTimeout(fromHash, 0);
  window.addEventListener('hashchange', fromHash);
}

/* ── Clicks: one listener for every tracked link on the page ── */
function setupClickTracking() {
  document.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('a');
    if (!a) return;
    const service = a.getAttribute('data-service-quote');
    if (service !== null) {
      e.preventDefault();
      trackPageEvent('service_quote_click', { service });
      try { history.replaceState(null, '', '#quote?service=' + encodeURIComponent(service)); } catch (_) {}
      openQuoteForService(service);
      return;
    }
    const spot = a.getAttribute('data-spotlight-link');
    if (spot !== null) { trackPageEvent('spotlight_link_click', { service: spot }); return; }
    const contact = a.getAttribute('data-contact');
    if (contact) trackContactClick(contact);
  });
}

// "Open now" from the parsed hours, checked at view time in the business's
// time zone. Mirrors isOpenAt in api/_lib/page-claims.js. No hours, no badge.
function isOpenNow(s) {
  if (!s || !Array.isArray(s.days)) return false;
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: s.tz, weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
      .formatToParts(new Date()).map(x => [x.type, x.value]));
    const day = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(parts.weekday);
    const mins = Number(parts.hour) * 60 + Number(parts.minute);
    return s.days.includes(day) && mins >= s.open && mins < s.close;
  } catch { return false; }
}

/* ── Main ── */
async function loadProfile() {
  const urlParams = new URLSearchParams(location.search);
  let slug = urlParams.get('slug');
  if (!slug) {
    const parts = location.pathname.split('/').filter(Boolean);
    if (parts[0] === 'p' && parts[1]) slug = parts[1];
    else if (parts.length === 1) slug = parts[0];
  }
  const p = window.__PROFILE__ || {};
  if (!slug) slug = p.username;
  if (!slug) return;
  window.profileData = p;
  window.dispatchEvent(new CustomEvent('profileDataReady', { detail: p }));

  /* ── Unclaimed-page banner ── */
  if (p.is_claimed === false) {
    const unclaimedBanner = getEl('unclaimedBanner');
    const unclaimedText = getEl('unclaimedText');
    const unclaimedCta = getEl('unclaimedCta');
    if (unclaimedBanner) {
      if (unclaimedText) unclaimedText.textContent = `This is a preview page for ${p.business_name || 'this business'}, not yet claimed by the business owner.`;
      if (unclaimedCta) unclaimedCta.href = `/signup?business=${encodeURIComponent(p.username || slug || '')}`;
      unclaimedBanner.classList.remove('hidden');
      setupClaimBox(p.username || slug || '', p.business_name || '');
      setupPreviewPoll(p.username || slug || '');
      loadClarity();
    }
  }

  // Embedded in the preview landing page (?embed=1): that page logs its own view.
  if (urlParams.get('embed') !== '1') fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug, event: 'page_view', internal: enomaIsInternal() || undefined, referrer: document.referrer || null, metadata: (function () { try { var m = urlParams.get('m'); return m ? { m: m } : {}; } catch (e) { return {}; } })() }) }).catch(() => {});

  setupClickTracking();
  setupQuoteDeepLinks();

  /* ── "Open now" (the server renders the badge hidden with the schedule) ── */
  const openEl = getEl('heroOpen');
  if (openEl) {
    let schedule = null;
    try { schedule = JSON.parse(openEl.getAttribute('data-open-schedule') || 'null'); } catch (e) {}
    if (isOpenNow(schedule)) openEl.hidden = false; else openEl.remove();
  }

  /* ── Brand colour from the real logo (the server sets the palette first) ── */
  if (p.logo_url) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { try { extractDominantColor(img, color => { if (color) applyBrandColor(color); }); } catch (e) {} };
    img.src = p.logo_url;
  }

  /* ── Recent work: gallery call link; no-photos nudge for the owner ── */
  const galleryCtaBtn = getEl('galleryCtaBtn');
  if (galleryCtaBtn) {
    if (p.phone) {
      galleryCtaBtn.href = `tel:${String(p.phone).replace(/[^\d+]/g, '')}`;
      galleryCtaBtn.setAttribute('data-contact', 'gallery_call');
      galleryCtaBtn.textContent = `Have a project in mind? Call ${p.phone} →`;
    } else {
      galleryCtaBtn.textContent = 'Have a project in mind? Get a quote →';
    }
  }
  if (!getEl('gallerySection') && p.business_id) {
    // Show the nudge only if this is the owner viewing their own page.
    const ownedBizId = p.business_id;
    setTimeout(() => {
      import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm').then(({ createClient }) => {
        const sb = createClient('https://qhsivcenpnxwmvwznqie.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFoc2l2Y2VucG54d212d3pucWllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ2ODQ4NjMsImV4cCI6MjA4MDI2MDg2M30.g_3eHoqfo7R15Q_9OoBy0DTq66a3BPA838VFd1aZtnc');
        sb.auth.getSession().then(({ data: { session } }) => {
          if (!session) return;
          sb.from('business_members').select('business_id').eq('user_id', session.user.id).eq('business_id', ownedBizId).maybeSingle().then(({ data }) => {
            if (!data) return;
            const nudge = getEl('noPhotosNudge');
            const addLink = getEl('addPhotosLink');
            if (nudge) nudge.style.display = 'block';
            if (addLink) addLink.href = `/create?business_id=${ownedBizId}`;
          });
        });
      }).catch(() => {});
    }, 800);
  }

  /* ── Before/After sliders (section rendered by the server only with photos) ── */
  const baList = getEl('baList');
  let baImages = Array.isArray(p.before_after_images) ? p.before_after_images : [];
  if (!baImages.length && urlParams.get('demoBA') === '1') baImages = BA_DEMO_IMAGES; // only where #baSection exists
  if (baList && baImages.length) {
    baList.innerHTML = '';
    baImages.filter(item => item && item.before && item.after).forEach(item => baList.appendChild(buildBASlider(item)));
  }

  /* ── Quote form intro + hours note ── */
  const contactIntro = getEl('contactIntro');
  if (contactIntro && p.business_name) {
    contactIntro.textContent = `Tell ${p.business_name} what you need in four quick taps and get a quote back.`;
  }
  const quoteWrap = getEl('quoteFormWrap');
  if (quoteWrap) {
    const infoItems = [];
    if (p.hero_availability) infoItems.push(`<span>Hours: ${escapeHtml(p.hero_availability)}</span>`);
    if (p.hero_response_time) infoItems.push(`<span>${escapeHtml(p.hero_response_time)}</span>`);
    if (infoItems.length) {
      const infoDiv = document.createElement('p');
      infoDiv.className = 'quote-info';
      infoDiv.innerHTML = infoItems.join('');
      quoteWrap.after(infoDiv);
    }
  }

  /* ── FAQs (server-rendered) — open/close on click ── */
  getEl('faqList')?.querySelectorAll('.faq-item').forEach(btn => {
    btn.setAttribute('aria-expanded', 'false');
    btn.addEventListener('click', () => {
      const open = btn.classList.toggle('active');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  });

  /* ── Map, only for local businesses (the server leaves the slots out otherwise) ── */
  const MAPS_KEY = 'AIzaSyD2DZjVEIuq6luIvl-lVeOaxqd3BG2V7IA';
  const later = fn => ('requestIdleCallback' in window ? requestIdleCallback(fn) : setTimeout(fn, 1200));
  const placesMapWrap = getEl('placesMapWrap');
  const serviceMapWrap = getEl('serviceMapWrap');
  const serviceMap = getEl('serviceMap');
  const iframe = src => `<iframe width="100%" height="260" loading="lazy" referrerpolicy="no-referrer-when-downgrade" style="border:0;border-radius:14px" title="Map of ${escapeHtml(p.business_name || 'the business')}" src="${src}"></iframe>`;
  if (p.is_local_radius && p.google_place_id && placesMapWrap) {
    later(() => {
      placesMapWrap.innerHTML = iframe(`https://www.google.com/maps/embed/v1/place?key=${MAPS_KEY}&q=place_id:${encodeURIComponent(p.google_place_id)}`);
      placesMapWrap.classList.remove('hidden');
    });
  } else if (p.is_local_radius && (p.address || (p.city && p.state)) && serviceMapWrap && serviceMap) {
    const q = encodeURIComponent(p.address ? `${p.address}, ${p.city || ''} ${p.state || ''}`.trim() : `${p.city}, ${p.state}`);
    const zoom = (p.service_area || []).length > 3 ? 10 : 12;
    later(() => {
      serviceMap.innerHTML = iframe(`https://www.google.com/maps/embed/v1/place?key=${MAPS_KEY}&q=${q}&zoom=${zoom}`);
      serviceMapWrap.classList.remove('hidden');
    });
  }

}

document.addEventListener('DOMContentLoaded', loadProfile);
