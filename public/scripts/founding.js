// public/scripts/founding.js
// The founding offer line ([data-founding]) shows the real number of spots
// left: GET /api/create-checkout?action=plans returns founding { limit, left }
// (api/_lib/founding.js). Writes "N of 25 spots left." into
// [data-founding-left]; hides [data-founding] when none are left. If the
// count can't be loaded, the line stays as written (no number).
(function () {
  var lines = document.querySelectorAll("[data-founding]");
  if (!lines.length || !window.fetch) return;
  fetch("/api/create-checkout?action=plans")
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      var f = j && j.founding;
      if (!f || typeof f.left !== "number") return;
      for (var i = 0; i < lines.length; i++) {
        if (f.left <= 0) { lines[i].hidden = true; continue; }
        var slot = lines[i].querySelector("[data-founding-left]");
        if (slot) slot.textContent = f.left + " of " + f.limit + " spots left.";
      }
    })
    .catch(function () {});
})();
