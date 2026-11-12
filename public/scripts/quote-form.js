// public/scripts/quote-form.js
// Turns the server-rendered quote form (api/_lib/quote-form.js) into a
// 4-step form: one fieldset at a time, "Step 2 of 4", Back, tap-to-choose
// chips that advance on single-choice steps. Without this script the same
// markup is a plain form that posts to /api/send-contact.
//
// Tracking (page_events via /api/track, with the page slug; no personal data):
//   quote_step_viewed {step}  quote_step_completed {step}
//   quote_submitted {services_count, timing}
// Jack's devices are sent with internal:true like every other page event.
(function () {
  var form = document.querySelector('form[data-quote-form]');
  if (!form || !window.fetch) return;

  var TOTAL = 4;
  var slug = form.getAttribute('data-slug') || '';
  var startStep = Number(form.getAttribute('data-start-step')) || 1;
  var steps = Array.prototype.slice.call(form.querySelectorAll('.qf-step'));
  var progress = document.getElementById('qfProgress');
  var back = document.getElementById('qfBack');
  var status = form.querySelector('.qf-status');
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var params = new URLSearchParams(location.search);
  var isEmbed = params.get('embed') === '1';
  var pageType = form.getAttribute('data-page-type') || 'company';
  var current = startStep;
  var viewed = {}, completed = {};
  var formSeen = false;
  var lastKey = null;

  function isInternal() {
    try { if (/(?:^|;\s*)enoma_internal=1(?:;|$)/.test(document.cookie)) return true; } catch (e) {}
    try { return localStorage.getItem('enoma_internal') === '1'; } catch (e) { return false; }
  }
  function track(event, metadata) {
    if (!slug || isEmbed) return; // the preview landing's embedded copy isn't a visitor
    var meta = Object.assign({ page_type: pageType }, metadata || {});
    try { if (typeof window.gtag === 'function') window.gtag('event', event, Object.assign({ page_slug: slug, transport_type: 'beacon' }, meta)); } catch (e) {}
    try {
      fetch('/api/track', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
        body: JSON.stringify({ slug: slug, event: event, metadata: meta, internal: isInternal() || undefined })
      }).catch(function () {});
    } catch (e) {}
  }
  function stepEl(n) { return steps[n - 1]; }
  function say(text, isError) {
    if (!status) return;
    status.textContent = text || '';
    status.classList.toggle('is-error', !!isError);
  }

  function show(n, focus) {
    current = n;
    steps.forEach(function (s, i) { s.classList.toggle('is-current', i === n - 1); });
    if (progress) progress.textContent = 'Step ' + n + ' of ' + TOTAL;
    if (back) back.hidden = n === 1;
    say('');
    if (focus) { var lg = stepEl(n).querySelector('legend'); if (lg) lg.focus({ preventScroll: true }); }
    if (formSeen && !viewed[n]) { viewed[n] = true; track('quote_step_viewed', { step: n }); }
  }

  function checked(name) { return form.querySelector('input[name="' + name + '"]:checked'); }
  // Step 3 is "Where's the job?" (location) or, for businesses that don't work
  // at the customer's address, an optional "company" field (api/_lib/quote-form.js).
  var locationInput = form.elements.location || null;
  function locationValue() {
    if (!locationInput) return '';
    var typed = (locationInput.value || '').trim();
    if (typed) return typed;
    var town = checked('location_town');
    return town ? town.value : '';
  }

  function validate(n) {
    if (n === 1 && !checked('services')) return 'Pick at least one, or "Something else".';
    if (n === 2 && !checked('timing')) return 'Pick one.';
    if (n === 3 && locationInput && !locationValue()) { locationInput.focus(); return 'Add your town or ZIP.'; }
    if (n === 4) {
      var name = form.elements.name, phone = form.elements.phone, email = form.elements.email;
      [name, phone, email].forEach(function (el) { el.removeAttribute('aria-invalid'); });
      if (!name.value.trim()) { name.setAttribute('aria-invalid', 'true'); name.focus(); return 'Please add your name.'; }
      var p = phone.value.trim(), e = email.value.trim();
      if (!p && !e) { phone.setAttribute('aria-invalid', 'true'); phone.focus(); return 'Add a phone number or an email so they can reach you.'; }
      if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) { email.setAttribute('aria-invalid', 'true'); email.focus(); return 'That email doesn\'t look right.'; }
      if (p && p.replace(/\D/g, '').length < 7) { phone.setAttribute('aria-invalid', 'true'); phone.focus(); return 'That phone number looks too short.'; }
    }
    return '';
  }

  function next() {
    var err = validate(current);
    if (err) { say(err, true); return; }
    if (!completed[current]) { completed[current] = true; track('quote_step_completed', { step: current }); }
    if (current < TOTAL) show(current + 1, true);
  }

  // Single-choice steps advance on a tap (or Enter/Space), not on arrow keys,
  // so keyboard users can move through the options before choosing. Listening
  // for click (not change) means re-tapping the same answer after Back still
  // moves on.
  var advancing = false;
  function autoAdvance() {
    if (advancing) return;
    advancing = true;
    var go = function () { advancing = false; next(); };
    if (reduceMotion) go(); else setTimeout(go, 160);
  }
  form.addEventListener('keydown', function (e) {
    lastKey = e.key;
    var step = e.target.closest && e.target.closest('.qf-step');
    if (!step) return;
    var n = Number(step.getAttribute('data-step'));
    if (e.key === 'Enter' && n < TOTAL && e.target.tagName !== 'BUTTON' && e.target.type !== 'radio') { e.preventDefault(); next(); }
    if ((e.key === ' ' || e.key === 'Enter') && e.target.type === 'radio' && (e.target.name === 'timing' || e.target.name === 'location_town')) {
      e.preventDefault();
      e.target.checked = true;
      if (e.target.name === 'location_town' && locationInput) locationInput.value = e.target.value;
      next();
    }
  });
  form.addEventListener('pointerdown', function () { lastKey = null; });
  form.addEventListener('click', function (e) {
    var t = e.target;
    if (t.type !== 'radio') return;
    var arrow = /^Arrow/.test(lastKey || '');
    if (t.name === 'location_town' && locationInput) locationInput.value = t.value;
    if (arrow) return;
    if ((t.name === 'timing' && current === 2) || (t.name === 'location_town' && current === 3)) autoAdvance();
  });
  if (locationInput) locationInput.addEventListener('input', function () {
    var town = checked('location_town');
    if (town && town.value !== locationInput.value) town.checked = false;
  });
  form.addEventListener('click', function (e) {
    if (e.target.closest('[data-next]')) { e.preventDefault(); next(); }
  });
  if (back) back.addEventListener('click', function () { if (current > 1) show(current - 1, true); });

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    if (current !== TOTAL) { next(); return; } // Enter on an earlier step
    var err = validate(TOTAL);
    if (err) { say(err, true); return; }
    // Same contact_click the old company-page form sent (dashboard + monthly results).
    if (form.hasAttribute('data-track-contact-click') && typeof window.trackContactClick === 'function') window.trackContactClick('contact_form');
    var fd = new FormData(form);
    var payload = {};
    fd.forEach(function (v, k) { if (k !== 'services' && k !== 'return_path') payload[k] = v; });
    payload.services = fd.getAll('services');
    if (locationInput) payload.location = locationValue();
    delete payload.location_town;
    var submit = form.querySelector('.qf-submit');
    submit.disabled = true;
    say('Sending…');
    try {
      var res = await fetch('/api/send-contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) {
        var j = await res.json().catch(function () { return {}; });
        throw new Error(j.error || '');
      }
      if (!completed[TOTAL]) { completed[TOTAL] = true; track('quote_step_completed', { step: TOTAL }); }
      track('quote_submitted', { services_count: payload.services.length, timing: payload.timing || null });
      form.classList.add('is-sent');
      say('✓ Thanks! Your request was sent. We\'ll be in touch shortly.');
      status.setAttribute('tabindex', '-1'); status.focus();
    } catch (err2) {
      submit.disabled = false;
      var call = document.querySelector('[data-qf-call]');
      say((err2 && err2.message) || ('Something went wrong.' + (call ? ' Please call instead.' : ' Please try again.')), true);
    }
  });

  // Deep link from a service card / shared link: #quote?service=<slug>
  // (public/scripts/profile.js). Ticks that service and starts on step 2,
  // like a Service Spotlight page. Same slug rule as the server's
  // serviceSlug() in api/_lib/company-page.js. Returns true when it matched.
  function serviceSlug(t) {
    return String(t || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  }
  function preselectService(slugWanted) {
    var want = serviceSlug(slugWanted);
    if (!want || form.classList.contains('is-sent')) return false;
    var boxes = Array.prototype.slice.call(form.querySelectorAll('input[name="services"]'));
    var hit = boxes.filter(function (b) { return serviceSlug(b.value) === want; })[0];
    if (!hit) return false;
    hit.checked = true;
    if (current === 1) {
      if (!completed[1]) { completed[1] = true; track('quote_step_completed', { step: 1, via: 'service_link' }); }
      show(2, false);
    }
    return true;
  }
  window.enomaQuoteForm = { preselectService: preselectService, serviceSlug: serviceSlug };

  // Go stepped.
  form.classList.add('is-stepped');
  show(startStep, false);
  // Count the first step as viewed once the form is actually on screen.
  function seen() {
    if (formSeen) return;
    formSeen = true;
    viewed[current] = true;
    track('quote_step_viewed', { step: current });
  }
  // Touching the form also counts, in case the observer never reports
  // (old browsers, throttled background tabs). seen() only runs once.
  form.addEventListener('focusin', seen);
  form.addEventListener('pointerdown', seen);
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      if (entries.some(function (en) { return en.isIntersecting; })) { seen(); io.disconnect(); }
    }, { threshold: 0.4 });
    io.observe(form);
  } else seen();
})();
