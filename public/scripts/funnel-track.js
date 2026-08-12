// Lightweight, first-party onboarding-funnel instrumentation.
// Not analytics in the GA4 sense — just enough to answer "where do people
// quit between choosing a path and having a live site?" (see funnel_events
// table / api/track.js). No PII, no cross-site tracking: anon_id is a random
// id generated once per browser and stored in localStorage.
(function () {
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

  window.enomaTrack = function (event, metadata, businessId) {
    try {
      fetch("/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({
          event: event,
          anon_id: getAnonId(),
          business_id: businessId || null,
          metadata: metadata || {}
        })
      }).catch(function () {});
    } catch (e) {}
  };
})();
