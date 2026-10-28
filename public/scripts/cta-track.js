// Content-page CTA tracking.
//
// Every link into the signup flow (/get-your-website) gets two query params so
// a signup can be traced back to the page and button that sent it:
//   ?from=<page slug>&cta=<hero|inline|final|...>
// These are deliberately NOT utm_* params: UTMs on internal links restart the
// GA4 session and overwrite the real source (e.g. Google organic) with a fake
// one. UTMs belong only on links we post off-site (social, email, ads); those
// are captured on landing by ref-capture.js.
//
// Clicks are also sent as a `cta_clicked` event (GA4 + funnel_events) so we can
// compare which guides and which button positions actually drive signups.
(function () {
  var page = (document.body && document.body.getAttribute("data-page")) ||
    location.pathname.replace(/^\/+|\/+$/g, "").replace(/\.html$/, "").replace(/\//g, "_") || "home";

  var links = document.querySelectorAll('a[href^="/get-your-website"]');
  links.forEach(function (a, i) {
    var cta = a.getAttribute("data-cta") || ("link_" + (i + 1));
    try {
      var u = new URL(a.getAttribute("href"), location.origin);
      if (!u.searchParams.has("from")) u.searchParams.set("from", page);
      if (!u.searchParams.has("cta")) u.searchParams.set("cta", cta);
      a.setAttribute("href", u.pathname + u.search + u.hash);
    } catch (e) {}
    a.addEventListener("click", function () {
      var meta = { from: page, cta: cta, label: (a.textContent || "").trim().slice(0, 60) };
      if (typeof window.enomaTrack === "function") window.enomaTrack("cta_clicked", meta);
      else if (typeof window.gtag === "function") window.gtag("event", "cta_clicked", Object.assign({ transport_type: "beacon" }, meta));
    });
  });
})();
