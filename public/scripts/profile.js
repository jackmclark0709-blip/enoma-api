// Devices flagged with ?internal=1 (set by the GA snippet) don't count
// toward a page's views or contact clicks. See api/track.js.
function enomaIsInternal() {
  try { return localStorage.getItem('enoma_internal') === '1'; } catch (e) { return false; }
}

// public/scripts/profile.js
// Behaviour for Enoma company pages (public/profile.html). The page content
// itself is rendered on the server (api/p.js + api/_lib/page-ssr.js); this
// script only adds behaviour: nav call button, hero pills ("Open now"), logo
// colour, carousel, FAQ toggles, maps, Google reviews fallback, contact form,
// claim banner and preview poll. It reads window.__PROFILE__, set inline by
// the page. Loaded as a normal (blocking) script in the same position the
// inline code used to sit, so behaviour and timing are unchanged.
/* ── Utilities ── */
const getEl = id => document.getElementById(id);
const escapeHtml = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const safeParse = v => {
  try {
    if (Array.isArray(v) || (v && typeof v === 'object')) return v;
    if (typeof v === 'string') return JSON.parse(v);
    return null;
  } catch { return null; }
};
function truncateText(text, max = 300) {
  if (!text || text.length <= max) return text;
  return text.slice(0, max).trim() + '…';
}
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
  // "Or subscribe now: $199/year" on the preview landing claims with
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
    if (sub) sub.textContent = "Here's a first draft of your page. Keep it and I'll make it better with you.";
    submit.textContent = 'Keep my page';
    // What's done and what's still missing, from this page's own data, so
    // $19.99 reads as "it keeps getting better", not just "it stays up".
    const extras = getEl('ownerExtras');
    if (extras) {
      extras.classList.remove('hidden');
      import('/scripts/page-checklist.js').then(({ pageChecklist }) => {
        const c = pageChecklist(window.__PROFILE__ || {});
        getEl('ownerPercent').textContent = `Your page is ${c.percent}% done`;
        getEl('ownerBar').style.width = `${c.percent}%`;
        const list = getEl('ownerList');
        list.innerHTML = '';
        // Missing items first: they're the point.
        [...c.items.filter(i => !i.done), ...c.items.filter(i => i.done)].forEach(i => {
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
function setupPreviewPoll(pageSlug) {
  const poll = getEl('previewPoll');
  if (!poll || !pageSlug) return;
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
  // Also update the SVG checkmark color in why-list
  document.querySelectorAll('.why-list li::before').forEach(() => {});
  // Inject dynamic CSS for why-list checkmarks
  let dynStyle = document.getElementById('dyn-brand-css');
  if (!dynStyle) { dynStyle = document.createElement('style'); dynStyle.id = 'dyn-brand-css'; document.head.appendChild(dynStyle); }
  dynStyle.textContent = `.why-list li::before { background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='${encodeURIComponent(color)}' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='20 6 9 17 4 12'/%3E%3C/svg%3E"); }`;
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

/* ── Main ── */
async function loadProfile() {
  const urlParams = new URLSearchParams(location.search);
  const businessId = urlParams.get('business_id');
  let slug = urlParams.get('slug');
  if (!slug) {
    const parts = location.pathname.split('/').filter(Boolean);
    if (parts[0] === 'p' && parts[1]) slug = parts[1];
    else if (parts.length === 1) slug = parts[0];
  }
  if (!slug && !businessId) return;

  let p = null;
  if (window.__PROFILE__ && Object.keys(window.__PROFILE__).length) {
    p = window.__PROFILE__;
  } else {
    const res = await fetch(businessId ? `/api/get-business?id=${businessId}` : `/api/get-business?slug=${slug}`);
    p = await res.json();
  }
  window.profileData = p;
  window.dispatchEvent(new CustomEvent('profileDataReady', { detail: p }));

  // ── Apply persona class based on trade category ──
  const categoryMap = {
    landscaping: 'landscaping', lawn: 'landscaping', gardening: 'landscaping',
    plumber: 'plumbing', plumbing: 'plumbing', heating: 'plumbing',
    hvac: 'hvac', air_conditioning: 'hvac',
    electrician: 'electrical', electrical: 'electrical',
    cleaning: 'cleaning', cleaning_service: 'cleaning',
    general_contractor: 'contractor', contractor: 'contractor', roofing: 'contractor', painting: 'contractor',
    retail: 'retail', gifts: 'retail', florist: 'retail',
  };
  const rawCat = (p.primary_category || '').toLowerCase().replace(/[^a-z_]/g, '');
  const persona = categoryMap[rawCat] || null;
  if (persona) document.body.classList.add(`persona-${persona}`);

  /* ── Unclaimed-page banner ── */
  if (p.is_claimed === false) {
    const unclaimedBanner = getEl('unclaimedBanner');
    const unclaimedText = getEl('unclaimedText');
    const unclaimedCta = getEl('unclaimedCta');
    if (unclaimedBanner) {
      if (unclaimedText) unclaimedText.textContent = `This is a preview page for ${p.business_name || 'this business'} — not yet claimed by the business owner.`;
      if (unclaimedCta) unclaimedCta.href = `/signup?business=${encodeURIComponent(p.username || slug || '')}`;
      unclaimedBanner.classList.remove('hidden');
      setupClaimBox(p.username || slug || '', p.business_name || '');
      setupPreviewPoll(p.username || slug || '');
      loadClarity();
    }
  }

  // ── Set brand RGB for CSS glow effects ──
  // (applied after logo color extraction; this sets a default)
  const defaultRgb = persona === 'landscaping' ? '26,90,42'
    : persona === 'plumbing' ? '20,60,120'
    : persona === 'hvac' ? '20,100,140'
    : persona === 'electrical' ? '160,120,10'
    : persona === 'retail' ? '130,40,120'
    : '26,60,80';
  document.documentElement.style.setProperty('--brand-rgb', defaultRgb);

  // Embedded in the preview landing page (?embed=1): that page logs its own view.
  if (new URLSearchParams(location.search).get('embed') !== '1') fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug, event: 'page_view', internal: enomaIsInternal() || undefined, referrer: document.referrer || null, metadata: (function () { try { var m = new URLSearchParams(location.search).get('m'); return m ? { m: m } : {}; } catch (e) { return {}; } })() }) }).catch(() => {});

  /* ── Sticky nav ── */
  const navBrand = getEl('businessName');
  if (navBrand) navBrand.textContent = p.business_name || '';
  const navLogoImg = getEl('navLogo');
  if (navLogoImg && p.logo_url) {
    navLogoImg.src = p.logo_url;
    navLogoImg.alt = `${p.business_name || ''} logo`;
    navLogoImg.onload = () => {
      navLogoImg.classList.remove('hidden');
      navBrand?.classList.add('hidden');
    };
  }
  const contactCall = getEl('contactCall');
  if (contactCall && p.phone) {
    contactCall.href = `tel:${p.phone}`;
    contactCall.classList.remove('hidden');
    contactCall.addEventListener('click', () => trackContactClick('call'));
  }

  /* ── Sticky mobile call bar ── */
  const mobileCallBar = getEl('mobileCallBar');
  const mcbCall = getEl('mcbCall');
  if (mobileCallBar && mcbCall && p.phone && !document.body.classList.contains('is-owner-view')) {
    mcbCall.href = `tel:${p.phone}`;
    mcbCall.addEventListener('click', () => trackContactClick('mobile_bar_call'));
    const mcbQuote = getEl('mcbQuote');
    if (mcbQuote) mcbQuote.addEventListener('click', () => trackContactClick('mobile_bar_quote'));
    mobileCallBar.classList.remove('hidden');
    document.body.classList.add('has-mobile-call-bar');
  }

  /* Hero headline/tagline, About, Services, Areas, Why, Testimonials and
     FAQs are rendered on the server (api/_lib/page-ssr.js + api/p.js). This
     script only adds behaviour to that markup — don't redraw them here. */

  /* ── Hero logo + brand color ── */
  const heroLogoWrap = getEl('heroLogo');
  const logoImg = getEl('logoImage');
  if (p.logo_url && logoImg && heroLogoWrap) {
    // Business has a real logo — load and extract dominant color to override server-side brand color
    logoImg.crossOrigin = 'anonymous';
    logoImg.src = p.logo_url;
    logoImg.alt = `${p.business_name} logo`;
    logoImg.onload = () => {
      extractDominantColor(logoImg, color => applyBrandColor(color || '#1a3a2a'));
      heroLogoWrap.classList.remove('hidden');
    };
    logoImg.onerror = () => {
      // Logo URL failed — show monogram if available, else plain initial
      if (logoImg.getAttribute('data-monogram')) {
        logoImg.src = logoImg.getAttribute('data-monogram');
      } else {
        heroLogoWrap.innerHTML = `<div class="profile-fallback">${(p.business_name || '?')[0].toUpperCase()}</div>`;
      }
      heroLogoWrap.classList.remove('hidden');
    };
  } else if (!p.logo_url && heroLogoWrap) {
    // No logo — server injected monogram SVG as img src, brand color set server-side
    // Just unhide the element — monogram is already rendered
    heroLogoWrap.classList.remove('hidden');
  }

  /* ── Primary CTA button ── */
  const primaryAction = getEl('primaryAction');
  const primaryCtaBtn = getEl('primaryCtaButton');
  if (primaryCtaBtn) primaryCtaBtn.addEventListener('click', () => trackContactClick(p.primary_cta_type || (p.phone ? 'call' : 'primary_cta')));
  if (p.primary_cta_label && p.primary_cta_type && p.primary_cta_value) {
    let href = '#contact';
    if (p.primary_cta_type === 'call') href = `tel:${p.primary_cta_value}`;
    if (p.primary_cta_type === 'email') href = `mailto:${p.primary_cta_value}`;
    if (p.primary_cta_type === 'link') href = p.primary_cta_value;
    primaryCtaBtn.textContent = p.primary_cta_label;
    primaryCtaBtn.href = href;
    primaryAction.classList.remove('hidden');
  } else if (p.phone) {
    primaryCtaBtn.textContent = 'Call for a Free Quote';
    primaryCtaBtn.href = `tel:${p.phone}`;
    primaryAction.classList.remove('hidden');
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

  /* ── Hero meta pills ── */
  const heroMeta = getEl('heroMeta');
  if (heroMeta) {
    const pills = [];
    if (p.city) pills.push(`<span>${p.city}${p.state ? ', ' + p.state : ''}</span>`);
    if (p.accepting_clients) pills.push('<span>Accepting clients</span>');
    if (p.offers_emergency) pills.push('<span class="pill-emergency">⚡ Emergency service</span>');
    if (isOpenNow(p.open_schedule)) pills.push('<span class="pill-open">● Open now</span>');
    heroMeta.innerHTML = pills.join('');
    if (!pills.length) heroMeta.style.display = 'none';
  }

  /* ── Hero trust strip ── */
  const heroTrust = getEl('heroTrust');
  if (heroTrust) {
    const badges = Array.isArray(p.trust_badges) && p.trust_badges.length ? p.trust_badges : [];
    const items = [];

    // Trust badges (Licensed & Insured, etc.)
    // Skip badges that just repeat the location pill (e.g. "Mansfield, MA").
    const cityLc = String(p.city || '').toLowerCase();
    badges.filter(b => !(cityLc && String(b).toLowerCase().startsWith(cityLc + ','))).forEach(b => {
      items.push(`<span class="hero-trust-item"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>${b}</span>`);
    });

    // Owner name
    if (p.owner_name) items.push(`<span class="hero-trust-item"><svg viewBox="0 0 24 24"><circle cx="12" cy="7" r="4"/><path d="M20 21a8 8 0 10-16 0"/></svg>Owner: ${p.owner_name}</span>`);

    // Availability hours (e.g. "Mon–Sat · 7am–6pm")
    if (p.hero_availability) items.push(`<span class="hero-trust-item"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>${p.hero_availability}</span>`);

    // Response time (e.g. "Responds within 2 hours")
    if (p.hero_response_time) items.push(`<span class="hero-trust-item"><svg viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.8 19.8 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.8 19.8 0 012.08 4.18 2 2 0 014.06 2h3a2 2 0 012 1.72c.12.86.31 1.7.57 2.5a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.58-1.09a2 2 0 012.11-.45c.8.26 1.64.45 2.5.57A2 2 0 0122 16.92z"/></svg>${p.hero_response_time}</span>`);

    // Add Google rating pill if available
    // show_rating is decided server-side (isStrongRating): a thin or middling
    // rating ("4★ from 1 review") does more harm than showing nothing.
    if (p.show_rating && p.average_rating && p.review_count) {
      items.unshift(`<span class="hero-trust-item"><svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="currentColor" stroke="none"/></svg>${Number(p.average_rating).toFixed(1)}★ from ${p.review_count} Google reviews</span>`);
    }
    if (items.length) { heroTrust.innerHTML = items.join(''); heroTrust.classList.remove('hidden'); }
  }

  /* ── Social links — with section header and CTA ── */
  const socialSectionWrap = getEl('socialSectionWrap');
  const socialLinksEl = getEl('socialLinks');
  const socialCtaEl = getEl('socialCta');
  const socials = p.social_links || {};
  const socialIcons = {
    facebook: `<svg viewBox="0 0 24 24"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>`,
    instagram: `<svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>`,
    twitter: `<svg viewBox="0 0 24 24"><path d="M23 3a10.9 10.9 0 0 1-3.14 1.53 4.48 4.48 0 0 0-7.86 3v1A10.66 10.66 0 0 1 3 4s-4 9 5 13a11.64 11.64 0 0 1-7 2c9 5 20 0 20-11.5a4.5 4.5 0 0 0-.08-.83A7.72 7.72 0 0 0 23 3z"/></svg>`,
    linkedin: `<svg viewBox="0 0 24 24"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/></svg>`,
    google: `<svg viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>`
  };
  const socialLinks = Object.entries(socials).filter(([k, v]) => v).map(([platform, url]) => {
    const icon = socialIcons[platform] || '';
    const label = platform.charAt(0).toUpperCase() + platform.slice(1);
    return `<a href="${url}" target="_blank" rel="noopener" class="social-link">${icon}${label}</a>`;
  });
  if (socialLinks.length && socialLinksEl) {
    socialLinksEl.innerHTML = socialLinks.join('');
    if (socialCtaEl) socialCtaEl.textContent = `Stay up to date with ${p.business_name || 'us'} online.`;
    socialSectionWrap?.classList.remove('hidden');
    // Also ensure the about section grid is visible
    getEl('aboutSection')?.classList.remove('hidden');
  }

  /* ── Gallery — dynamic title + inline CTA ── */
  const gallerySection = getEl('gallerySection');
  const galleryEl = getEl('gallery');
  const galleryTitle = getEl('galleryTitle');
  const galleryCtaBtn = getEl('galleryCtaBtn');
  const isImageUrl = (url = '') => /\.(png|jpe?g|webp|gif)(\?.*)?$/i.test(url);

  // Dynamic title based on trade
  const galleryTitleMap = {
    landscaping: 'Recent Lawn & Garden Work',
    plumbing: 'Recent Projects',
    electrical: 'Recent Electrical Work',
    hvac: 'Recent HVAC Work',
    cleaning: 'Before & After',
    contractor: 'Recent Projects',
    roofing: 'Recent Roofing Work',
    painting: 'Recent Paint Work',
    retail: 'Our Products',
  };
  if (galleryTitle && persona) {
    galleryTitle.textContent = galleryTitleMap[persona] || 'Recent Work';
  }

  // Wire gallery CTA button
  if (galleryCtaBtn) {
    if (p.phone) {
      galleryCtaBtn.href = `tel:${p.phone}`;
      galleryCtaBtn.textContent = `Have a project in mind? Call ${p.phone} →`;
    } else {
      galleryCtaBtn.href = '#contact';
      galleryCtaBtn.textContent = 'Have a project in mind? Get in touch →';
    }
  }

  const attachmentImages = Array.isArray(p.attachments)
    ? p.attachments.map(a => typeof a === 'string' ? { url: a } : a).filter(a => a?.url && isImageUrl(a.url))
    : [];
  if (galleryEl && attachmentImages.length) {
    galleryEl.innerHTML = attachmentImages.slice(0, 12).map(a =>
      `<a href="${a.url}" target="_blank" rel="noopener"><img src="${a.url}" alt="${a.filename || p.business_name || 'Photo'}" loading="lazy" /></a>`
    ).join('');
    gallerySection.classList.remove('hidden');
  } else {
    gallerySection.classList.add('hidden');
    // Show nudge only if this is the owner viewing their own page
    const ownedBizId = p.business_id;
    if (ownedBizId) {
      setTimeout(() => {
        import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm').then(({ createClient }) => {
          const sb = createClient('https://qhsivcenpnxwmvwznqie.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFoc2l2Y2VucG54d212d3pucWllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ2ODQ4NjMsImV4cCI6MjA4MDI2MDg2M30.g_3eHoqfo7R15Q_9OoBy0DTq66a3BPA838VFd1aZtnc');
          sb.auth.getSession().then(({ data: { session } }) => {
            if (!session) return;
            sb.from('business_members').select('business_id').eq('user_id', session.user.id).eq('business_id', ownedBizId).maybeSingle().then(({ data }) => {
              if (data) {
                const nudge = getEl('noPhotosNudge');
                const addLink = getEl('addPhotosLink');
                if (nudge) nudge.style.display = 'block';
                if (addLink) addLink.href = `/create?business_id=${ownedBizId}`;
              }
            });
          });
        });
      }, 800);
    }
  }

  /* ── Before/After slider ── */
  const baSection = getEl('baSection');
  const baList = getEl('baList');
  let baImages = Array.isArray(p.before_after_images) ? p.before_after_images : [];
  if (!baImages.length && urlParams.get('demoBA') === '1') baImages = BA_DEMO_IMAGES;
  const validBaImages = baImages.filter(item => item && item.before && item.after);
  if (baSection && baList && validBaImages.length) {
    baList.innerHTML = '';
    validBaImages.forEach(item => baList.appendChild(buildBASlider(item)));
    baSection.classList.remove('hidden');
  }

  /* ── Service area map — handled in location section below ── */

  /* ── Services (server-rendered) — wire up the call button ── */
  const quickCall = getEl('quickCall');
  if (quickCall) {
    if (p.phone) { quickCall.href = `tel:${p.phone}`; quickCall.onclick = () => trackContactClick('services_cta_call'); }
    else if (p.email) { quickCall.href = `mailto:${p.email}`; quickCall.onclick = () => trackContactClick('services_cta_email'); }
    else { quickCall.href = '#contact'; }
  }

  /* ── Contact form ── */
  const contactIntro = getEl('contactIntro');
  if (contactIntro && p.business_name) {
    contactIntro.textContent = `Tell ${p.business_name} what you need in four quick taps and get a quote back.`;
  }
  /* ── Testimonials — carousel ── */
  // The business's own testimonials are rendered on the server. This adds the
  // carousel to whatever is in the list; renderTestimonials() only writes
  // markup for the Google-review fallback (see Google data below).
  let carouselTimer = null;
  const setupCarousel = () => {
    const testimonialList = getEl('testimonialList');
    if (!testimonialList) return 0;
    const count = testimonialList.querySelectorAll('.testimonial').length;
    const carouselNav = getEl('carouselNav');
    const carouselDots = getEl('carouselDots');
    const prevBtn = getEl('carouselPrev');
    const nextBtn = getEl('carouselNext');
    let currentIdx = 0;
    const showSlide = (idx) => {
      const cards = testimonialList.querySelectorAll('.testimonial');
      const dots = carouselDots?.querySelectorAll('.carousel-dot');
      cards.forEach((c, i) => c.classList.toggle('active', i === idx));
      dots?.forEach((d, i) => d.classList.toggle('active', i === idx));
      currentIdx = idx;
    };
    if (carouselTimer) { clearInterval(carouselTimer); carouselTimer = null; }
    if (count > 1) {
      if (carouselDots) {
        carouselDots.innerHTML = Array.from({ length: count }, (_, i) =>
          `<button class="carousel-dot${i === 0 ? ' active' : ''}" data-i="${i}" aria-label="Review ${i+1}"></button>`
        ).join('');
        carouselDots.querySelectorAll('.carousel-dot').forEach(dot => {
          dot.addEventListener('click', () => showSlide(Number(dot.dataset.i)));
        });
      }
      if (prevBtn) prevBtn.onclick = () => showSlide((currentIdx - 1 + count) % count);
      if (nextBtn) nextBtn.onclick = () => showSlide((currentIdx + 1) % count);
      carouselTimer = setInterval(() => showSlide((currentIdx + 1) % count), 6000);
      if (carouselNav) carouselNav.style.display = 'flex';
    } else if (carouselNav) {
      carouselNav.style.display = 'none';
    }
    return count;
  };
  const renderTestimonials = (testimonials) => {
    const testimonialList = getEl('testimonialList');
    const testimonialsWrap = getEl('testimonialsWrap');
    if (!Array.isArray(testimonials) || !testimonials.length || !testimonialList) return false;
    testimonialList.innerHTML = testimonials.map((t, i) => {
      const initial = (t.author || '?')[0].toUpperCase();
      const starCount = Math.min(5, Math.max(1, Math.round(Number(t.rating) || 5)));
      const stars = '★'.repeat(starCount) + '☆'.repeat(5 - starCount);
      const sourceLabel = t.source === 'google' ? '<span class="testimonial-source">— via Google</span>' : '';
      return `<div class="testimonial${i === 0 ? ' active' : ''}" data-idx="${i}">
        <div class="testimonial-accent"></div>
        <span class="quote-mark">&#8220;</span>
        <div class="stars">${stars}</div>
        <p>${escapeHtml(t.quote)}</p>
        <div class="testimonial-author">
          <div class="testimonial-avatar">${escapeHtml(initial)}</div>
          <strong>${escapeHtml(t.author)}</strong>${sourceLabel}
        </div>
      </div>`;
    }).join('');
    setupCarousel();
    testimonialsWrap?.classList.remove('hidden');
    getEl('whyOuterSection')?.classList.remove('hidden');
    return true;
  };
  const hasOwnTestimonials = setupCarousel() > 0;

  /* ── FAQs (server-rendered) — open/close on click ── */
  getEl('faqList')?.querySelectorAll('.faq-item').forEach(btn => {
    btn.addEventListener('click', () => btn.classList.toggle('active'));
  });

  /* ── Google data ── */
  const locationBand = getEl('locationBand');
  let google = null;
  if (p.google_place_id) {
    try {
      const r = await fetch(`/api/google-place?place_id=${p.google_place_id}`);
      if (r.ok) { const text = await r.text(); google = text ? JSON.parse(text) : null; }
    } catch (e) { console.warn('Google data unavailable', e); }
  }
  // Google place map now rendered in placesMapWrap inside Areas We Serve
  const hoursEl = getEl('hours');
  if (hoursEl && google?.regularOpeningHours?.weekdayDescriptions) {
    hoursEl.innerHTML = `<h3>Hours</h3><ul>${google.regularOpeningHours.weekdayDescriptions.map(d => `<li>${d}</li>`).join('')}</ul>`;
  }
  const ratingEl = getEl('rating');
  if (ratingEl && google?.rating) { ratingEl.innerHTML = `${google.rating} <span>on Google (${google.userRatingCount || ''} reviews)</span>`; ratingEl.classList.remove('hidden'); }
  // Same rules as api/_lib/page-style.js pickReviewQuotes (kept in sync by hand):
  // 4–5 stars, at least 40 characters, trimmed to ~360.
  if (!hasOwnTestimonials && google?.reviews?.length) {
    const quotes = google.reviews
      .map(r => ({ quote: String(r?.text?.text || '').trim(), author: r?.authorAttribution?.displayName || 'Google reviewer', rating: Number(r?.rating) || 0, source: 'google' }))
      .filter(r => r.rating >= 4 && r.quote.length >= 40)
      .sort((a, b) => b.rating - a.rating || Math.abs(a.quote.length - 220) - Math.abs(b.quote.length - 220))
      .slice(0, 3)
      .map(r => ({ ...r, quote: r.quote.length > 360 ? r.quote.slice(0, 357).replace(/\s+\S*$/, '') + '…' : r.quote }));
    renderTestimonials(quotes);
  }
  const reviewsEl = getEl('reviews');
  if (reviewsEl && google?.reviews?.length) {
    const best = google.reviews.filter(r => r.rating === 5).sort((a, b) => (b.publishTime || 0) - (a.publishTime || 0))[0];
    if (best) reviewsEl.innerHTML = `<div class="review"><strong>${best.authorAttribution?.displayName || 'Google User'} ⭐ ${best.rating}</strong><p>${truncateText(best.text?.text || '', 320)}</p></div>`;
  }
  const hasTowns = Array.isArray(p.service_area) && p.service_area.length;
  const hasGoogleData = !!google?.rating || !!google?.reviews?.length;
  const hasMap = !!p.google_place_id;
  // Map is now shown inside Areas We Serve section
  const hasAddressMap = !!(p.address || (p.city && p.state));
  const serviceMapWrap = getEl('serviceMapWrap');
  const serviceMap = getEl('serviceMap');
  const placesMapWrap = getEl('placesMapWrap');

  if (hasMap && placesMapWrap) {
    // Google Place ID available — inject map directly into placesMapWrap
    const loadPlaceMap = () => {
      placesMapWrap.innerHTML = `<iframe
        width="100%" height="280" loading="lazy"
        referrerpolicy="no-referrer-when-downgrade"
        style="border:0;border-radius:14px"
        src="https://www.google.com/maps/embed/v1/place?key=AIzaSyD2DZjVEIuq6luIvl-lVeOaxqd3BG2V7IA&q=place_id:${p.google_place_id}">
      </iframe>`;
      placesMapWrap.classList.remove('hidden');
    };
    'requestIdleCallback' in window ? requestIdleCallback(loadPlaceMap) : setTimeout(loadPlaceMap, 1200);
  } else if (hasAddressMap && serviceMapWrap && serviceMap) {
    // No Place ID — embed address-based map in service area section
    const mapQuery = p.address
      ? encodeURIComponent(`${p.address}, ${p.city || ''} ${p.state || ''}`.trim())
      : encodeURIComponent(`${p.city}, ${p.state}`);
    const zoom = (Array.isArray(p.service_area) && p.service_area.length > 3) ? 10 : 12;
    const loadAddrMap = () => {
      serviceMap.innerHTML = `<iframe
        width="100%" height="280" loading="lazy"
        referrerpolicy="no-referrer-when-downgrade"
        style="border:0;border-radius:14px"
        src="https://www.google.com/maps/embed/v1/place?key=AIzaSyD2DZjVEIuq6luIvl-lVeOaxqd3BG2V7IA&q=${mapQuery}&zoom=${zoom}">
      </iframe>`;
      serviceMapWrap.classList.remove('hidden');
    };
    'requestIdleCallback' in window ? requestIdleCallback(loadAddrMap) : setTimeout(loadAddrMap, 1200);
  }

  /* ── Quote form — hours note below ──
     The form itself (4 steps, submit, tracking) is public/scripts/quote-form.js
     on markup from api/_lib/quote-form.js. Its tap-to-call button sits above
     the form, so the note only adds hours and response time. */
  const quoteWrap = getEl('quoteFormWrap');
  if (quoteWrap) {
    const infoItems = [];
    if (p.hero_availability) infoItems.push(`<span>🕐 ${escapeHtml(p.hero_availability)}</span>`);
    if (p.hero_response_time) infoItems.push(`<span>💬 ${escapeHtml(p.hero_response_time)}</span>`);
    if (infoItems.length) {
      const infoDiv = document.createElement('div');
      infoDiv.style.cssText = 'display:flex;flex-wrap:wrap;gap:0.75rem;justify-content:center;margin-top:1rem;font-size:0.82rem;color:#6b7280;';
      infoDiv.innerHTML = infoItems.join('');
      quoteWrap.after(infoDiv);
    }
  }

  /* ── Non-image attachments ── */
  const attachmentsSection = getEl('attachments');
  const attachmentList = getEl('attachmentList');
  if (Array.isArray(p.attachments) && p.attachments.length) {
    const nonImages = p.attachments.map(a => typeof a === 'string' ? { url: a } : a).filter(a => a?.url && !isImageUrl(a.url));
    if (nonImages.length && attachmentList) {
      nonImages.forEach(a => {
        const label = a.label || a.filename || (a.url ? a.url.split('/').pop().split('?')[0] : 'Resource');
        const li = document.createElement('li');
        li.innerHTML = `<a href="${a.url}" target="_blank" rel="noopener">${label}</a>`;
        attachmentList.appendChild(li);
      });
      attachmentsSection?.classList.remove('hidden');
    } else attachmentsSection?.classList.add('hidden');
  } else attachmentsSection?.classList.add('hidden');

  // enoma-io is a demo page — no special overrides needed
}

document.addEventListener('DOMContentLoaded', loadProfile);
