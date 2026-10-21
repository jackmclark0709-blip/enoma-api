// Microsoft Clarity: free session recordings + heatmaps, so we can watch where
// owners get stuck in the lookup / claim flow. Inputs are masked by Clarity
// by default. Loaded on marketing + signup pages, and on unclaimed preview
// pages only (never on a customer's live page; see profile.html).
//
// Turn on: create a project at https://clarity.microsoft.com for enoma.io and
// paste its project id below. Until then this file does nothing.
(function () {
  var CLARITY_PROJECT_ID = "";
  if (!CLARITY_PROJECT_ID) return;
  (function (c, l, a, r, i, t, y) {
    c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); };
    t = l.createElement(r); t.async = 1; t.src = "https://www.clarity.ms/tag/" + i;
    y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y);
  })(window, document, "clarity", "script", CLARITY_PROJECT_ID);
})();
