// Lightweight, first-party onboarding-funnel instrumentation.
// Not analytics in the GA4 sense — just enough to answer "where do people
// quit between finding Enoma and paying?" (see funnel_events table /
// api/track.js). No PII, no cross-site tracking: anon_id is a random id
// generated once per browser and stored in localStorage.
//
// Every event also goes to GA4. A few funnel steps go under the GA4 key-event
// names the ads/conversions are built on (GA_NAMES below), so renaming a step
// here never silently breaks a conversion.
//
// The server classifies every event (traffic_class: internal / crawler /
// link_scanner / social_preview / human). Jack's devices are still sent, so
// nothing is lost, but tagged internal: the ?internal=1 localStorage flag or
// the enoma_internal=1 cookie set by /internal-optout.
(function () {
  var GA_NAMES = {
    gyw_submitted: "get_your_website_submitted",
    account_created: "sign_up"
  };

  function getAnonId() {
    try {
      var key = "enoma_anon_id";
      var id = localStorage.getItem(key);
      if (!id) {
        id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
        localStorage.setItem(key, id);
      }
      return id;
    } catch (e) {
      return null;
    }
  }

  function isInternal() {
    // ?internal=1 on any enoma.io page (undo with ?internal=0), or
    // /internal-optout (a one-year cookie). Same flags the GA snippet uses.
    try { if (/(?:^|;\s*)enoma_internal=1(?:;|$)/.test(document.cookie)) return true; } catch (e) {}
    try { return localStorage.getItem("enoma_internal") === "1"; } catch (e) { return false; }
  }

  // First landing page + utm_* + external referrer, kept forever by
  // /scripts/ref-capture.js (enoma_first_touch). Pages without ref-capture
  // send nothing here; the server keeps only known keys.
  function firstTouch() {
    try { return JSON.parse(localStorage.getItem("enoma_first_touch") || "null"); } catch (e) { return null; }
  }

  window.enomaAnonId = getAnonId;
  window.enomaIsInternal = window.enomaIsInternal || isInternal;
  window.enomaFirstTouch = firstTouch;

  window.enomaTrack = function (event, metadata, businessId) {
    var meta = Object.assign({}, metadata || {});
    try {
      if (typeof window.gtag === "function") {
        window.gtag("event", GA_NAMES[event] || event, Object.assign({ transport_type: "beacon" }, meta));
      }
    } catch (e) {}
    try {
      if (!meta.page) meta.page = location.pathname;
      fetch("/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({
          event: event,
          anon_id: getAnonId(),
          business_id: businessId || null,
          metadata: meta,
          referrer: document.referrer || null,
          attribution: firstTouch(),
          internal: isInternal() || undefined
        })
      }).catch(function () {});
    } catch (e) {}
  };
})();
