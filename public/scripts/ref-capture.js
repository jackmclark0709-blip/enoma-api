// Referral link capture. A referrer's link looks like https://enoma.io/?ref=smith-plumbing.
// The code is kept in a first-party cookie for 90 days so it survives the
// visitor browsing around before signing up or claiming their page; the API
// (api/_lib/referral.js) reads it and only credits codes registered in the
// referrers table. First touch wins: an existing cookie is never replaced.
// Marketing attribution (separate from referrals): the first landing page and
// any utm_* params on it are kept in localStorage as "enoma_attr" (first touch
// wins, 90 days), and the latest content CTA (?from=&cta=, set by
// cta-track.js) is kept as "enoma_cta". get-your-website.html sends both with
// the instant-preview request so each signup can be traced to a guide/channel.
// "enoma_first_touch" is the same first landing + utm_* but never expires or
// gets replaced; claim.html sends it with the claim and it ends up in
// businesses.first_touch and the Stripe metadata (api/_lib/attribution.js).
// Comment-keyword visits (/page → /get-your-website?src=comment&ch=fb&kw=PAGE)
// are carried the same way: src/ch/kw go into both stored touches. A browser
// that already has a stored touch keeps it, but gains src/ch/kw if it has no
// src yet, so a returning visitor who came back through a comment DM is still
// attributed to the comment (api/_lib/attribution.js cleanCommentParams).
(function () {
  try {
    var q = new URLSearchParams(location.search);
    var now = Date.now();
    var comment = null;
    if ((q.get("src") || "").toLowerCase() === "comment") {
      comment = { src: "comment" };
      var ch = (q.get("ch") || "").toLowerCase();
      if (ch === "fb" || ch === "ig") comment.ch = ch;
      var kw = (q.get("kw") || "").trim().toUpperCase().slice(0, 30);
      if (/^[A-Z0-9_-]+$/.test(kw)) comment.kw = kw;
    }
    var touch = function () {
      var attr = { t: now, landing: location.pathname, referrer: (document.referrer || "").slice(0, 200) };
      ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].forEach(function (k) {
        var v = q.get(k);
        if (v) attr[k] = v.slice(0, 80);
      });
      if (comment) Object.assign(attr, comment);
      return JSON.stringify(attr);
    };
    var addComment = function (key) {
      if (!comment) return;
      try {
        var cur = JSON.parse(localStorage.getItem(key) || "null");
        if (cur && !cur.src) localStorage.setItem(key, JSON.stringify(Object.assign(cur, comment)));
      } catch (e) {}
    };
    var existing = null;
    try { existing = JSON.parse(localStorage.getItem("enoma_attr") || "null"); } catch (e) {}
    if (!existing || !existing.t || now - existing.t > 90 * 864e5) {
      localStorage.setItem("enoma_attr", touch());
    } else {
      addComment("enoma_attr");
    }
    if (!localStorage.getItem("enoma_first_touch")) {
      localStorage.setItem("enoma_first_touch", touch());
    } else {
      addComment("enoma_first_touch");
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
