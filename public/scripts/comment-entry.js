// Comment-keyword entry on /get-your-website.
// A ManyChat DM sends people who comment a keyword (e.g. PAGE) on an Enoma
// Facebook/Instagram post to https://enoma.io/page?ch=fb&kw=PAGE, which
// vercel.json redirects to /get-your-website?src=comment&ch=fb&kw=PAGE.
// With src=comment the hero picks up the conversation ("Here's the free
// preview you asked for") and the business search box gets focus, so the
// next step is typing the business name. The rest of the flow is unchanged.
// src/ch/kw are stored by /scripts/ref-capture.js and sent with every funnel
// event, the instant preview and the claim (api/_lib/attribution.js).
(function (root) {
  var COPY = {
    headline: "Here’s the free preview you asked for",
    subhead: "Find your business below and see your page in about a minute.",
    price: "$1 for your first month, then $19.99/month or $199/year. Cancel anytime."
  };

  // { src: "comment", ch?: "fb"|"ig", kw?: "PAGE" } or null. Same rules as
  // cleanCommentParams in api/_lib/attribution.js.
  function params(search) {
    var q;
    try { q = new URLSearchParams(search || ""); } catch (e) { return null; }
    if ((q.get("src") || "").trim().toLowerCase() !== "comment") return null;
    var out = { src: "comment" };
    var ch = (q.get("ch") || "").trim().toLowerCase();
    if (ch === "fb" || ch === "ig") out.ch = ch;
    var kw = (q.get("kw") || "").trim().toUpperCase().slice(0, 30);
    if (/^[A-Z0-9_-]+$/.test(kw)) out.kw = kw;
    return out;
  }

  // Swap the hero copy and focus the search box. Returns true when applied.
  function apply(doc, search) {
    if (!doc || !params(search)) return false;
    var h = doc.querySelector(".copy .headline");
    var sub = doc.querySelector(".copy .subhead");
    var line = doc.querySelector(".copy .page-line");
    if (h) h.textContent = COPY.headline;
    if (sub) sub.textContent = COPY.subhead;
    if (line) line.textContent = COPY.price;
    if (doc.body && doc.body.classList) doc.body.classList.add("from-comment");
    var input = doc.getElementById("biz_lookup");
    if (input && typeof input.focus === "function") {
      try { input.focus({ preventScroll: false }); } catch (e) { input.focus(); }
    }
    return true;
  }

  root.EnomaCommentEntry = { COPY: COPY, params: params, apply: apply };
  if (root.document && root.location) apply(root.document, root.location.search);
})(typeof window !== "undefined" ? window : globalThis);
