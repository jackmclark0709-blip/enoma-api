// Referral link capture. A referrer's link looks like https://enoma.io/?ref=conways.
// The code is kept in a first-party cookie for 90 days so it survives the
// visitor browsing around before signing up or claiming their page; the API
// (api/_lib/referral.js) reads it and only credits codes registered in the
// referrers table. First touch wins: an existing cookie is never replaced.
// Marketing attribution (separate from referrals): the first landing page and
// any utm_* params on it are kept in localStorage as "enoma_attr" (first touch
// wins, 90 days), and the latest content CTA (?from=&cta=, set by
// cta-track.js) is kept as "enoma_cta". get-your-website.html sends both with
// the instant-preview request so each signup can be traced to a guide/channel.
(function () {
  try {
    var q = new URLSearchParams(location.search);
    var now = Date.now();
    var existing = null;
    try { existing = JSON.parse(localStorage.getItem("enoma_attr") || "null"); } catch (e) {}
    if (!existing || !existing.t || now - existing.t > 90 * 864e5) {
      var attr = { t: now, landing: location.pathname, referrer: (document.referrer || "").slice(0, 200) };
      ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].forEach(function (k) {
        var v = q.get(k);
        if (v) attr[k] = v.slice(0, 80);
      });
      localStorage.setItem("enoma_attr", JSON.stringify(attr));
    }
    if (q.get("from")) {
      localStorage.setItem("enoma_cta", JSON.stringify({ t: now, from: q.get("from").slice(0, 80), cta: (q.get("cta") || "").slice(0, 40) }));
    }
  } catch (e) {}
})();

(function () {
  try {
    var ref = new URLSearchParams(location.search).get("ref");
    if (!ref) return;
    ref = ref.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(ref)) return;
    // "get-started" is an internal source tag on /get-your-website, not a referrer.
    if (ref === "get-started") return;
    if (/(?:^|;\s*)enoma_ref=/.test(document.cookie)) return;
    document.cookie = "enoma_ref=" + encodeURIComponent(ref) +
      "; Max-Age=" + 90 * 24 * 60 * 60 + "; Path=/; SameSite=Lax" +
      (location.protocol === "https:" ? "; Secure" : "");
  } catch (e) {}
})();
