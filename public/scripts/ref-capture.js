// Referral link capture. A referrer's link looks like https://enoma.io/?ref=conways.
// The code is kept in a first-party cookie for 90 days so it survives the
// visitor browsing around before signing up or claiming their page; the API
// (api/_lib/referral.js) reads it and only credits codes registered in the
// referrers table. First touch wins: an existing cookie is never replaced.
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
