// Monthly / Yearly choice + subscribe button, used wherever an owner
// subscribes: the dashboard banner, /upgrade and /website-live.
//
//   EnomaPlanPicker.mount(el, {
//     businessId,                 // required
//     getToken: async () => token, // Supabase access token, or null if signed out
//     sub,                        // the business's subscriptions row (or null)
//     theme: "light" | "dark",
//     onSignedOut: () => {},      // optional; default sends them to /login
//   });
//
// Yearly is the default. It posts { business_id, interval } to
// /api/create-checkout. "Your first charge is on …" shows only when the
// server will set a trial_end: the same rule as api/_lib/billing.js
// trialEndFor (free month running, more than 48 hours left). Keep the two in
// step; tests/billing.test.js checks that they agree.
(function () {
  var MIN_TRIAL_END_LEAD_MS = 48 * 60 * 60 * 1000;
  var ACCOUNT_MANAGER = "A real person as your account manager: text or email Jack any change and it’s on your page within two business days.";
  var PLANS = {
    year: { label: "Yearly", price: "$199/year — about $16.58 a month, saves $40.88", button: "Subscribe — $199/year →" },
    month: { label: "Monthly", price: "$19.99/month", button: "Subscribe — $19.99/month →" },
  };

  // Date of the first charge if checkout will defer it to the end of the
  // free month, else null (charged at checkout).
  function firstChargeDate(sub, now) {
    if (now === undefined) now = Date.now();
    if (!sub || sub.is_trial !== true || !sub.trial_expires_at) return null;
    var ends = new Date(sub.trial_expires_at).getTime();
    if (!isFinite(ends)) return null;
    if (ends - now <= MIN_TRIAL_END_LEAD_MS) return null;
    return new Date(Math.floor(ends / 1000) * 1000);
  }

  function fmtDate(d) {
    return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  }

  var CSS =
    ".epp{--epp-fg:#0a1628;--epp-muted:#5a7a9a;--epp-line:#d4e2f4;--epp-card:#fff;--epp-on:#0a1628;--epp-on-bg:#f0f6ff;--epp-btn:#0a1628;--epp-btn-fg:#fff;--epp-save:#0f7a3d;--epp-save-bg:#e3f6ea;display:flex;flex-direction:column;gap:.75rem;width:100%;text-align:left;font-family:inherit}" +
    ".epp--dark{--epp-fg:#fff;--epp-muted:rgba(220,238,255,.75);--epp-line:rgba(255,255,255,.22);--epp-card:rgba(255,255,255,.04);--epp-on:#7ab3e0;--epp-on-bg:rgba(122,179,224,.14);--epp-btn:#fff;--epp-btn-fg:#0a1628;--epp-save:#0a1628;--epp-save-bg:#9be3b4}" +
    ".epp-choices{display:grid;grid-template-columns:1fr 1fr;gap:.6rem;border:0;margin:0;padding:0;min-width:0}" +
    "@media (max-width:520px){.epp-choices{grid-template-columns:1fr}}" +
    ".epp-opt{position:relative;display:flex;flex-direction:column;gap:.3rem;padding:.8rem .9rem .85rem 2.4rem;border:1.5px solid var(--epp-line);border-radius:14px;background:var(--epp-card);cursor:pointer;color:var(--epp-fg);min-width:0}" +
    ".epp-opt:has(input:checked){border-color:var(--epp-on);background:var(--epp-on-bg)}" +
    ".epp-opt:has(input:focus-visible){outline:2px solid var(--epp-on);outline-offset:2px}" +
    ".epp-opt input{position:absolute;left:.9rem;top:.95rem;margin:0;width:1rem;height:1rem;accent-color:var(--epp-on)}" +
    ".epp-opt__head{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;font-weight:700;font-size:.95rem}" +
    ".epp-save{font-size:.68rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--epp-save);background:var(--epp-save-bg);border-radius:999px;padding:.12rem .5rem}" +
    ".epp-opt__price{font-size:.86rem;color:var(--epp-fg);line-height:1.4}" +
    ".epp-opt__perk{font-size:.8rem;color:var(--epp-muted);line-height:1.45}" +
    ".epp-btn{width:100%;padding:.85rem 1rem;border:none;border-radius:999px;background:var(--epp-btn);color:var(--epp-btn-fg);font:inherit;font-weight:700;font-size:.95rem;cursor:pointer}" +
    ".epp-btn:disabled{opacity:.6;cursor:wait}" +
    ".epp-note{margin:0;font-size:.82rem;color:var(--epp-muted);text-align:center;line-height:1.45}";

  function injectCss() {
    if (document.getElementById("epp-css")) return;
    var s = document.createElement("style");
    s.id = "epp-css";
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  var seq = 0;
  function mount(el, opts) {
    if (!el || !opts || !opts.businessId) return null;
    injectCss();
    var name = "epp-interval-" + ++seq;
    var chargeOn = firstChargeDate(opts.sub);
    el.innerHTML =
      '<div class="epp' + (opts.theme === "dark" ? " epp--dark" : "") + '">' +
      '<fieldset class="epp-choices"><legend class="sr-only" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Billing</legend>' +
      '<label class="epp-opt"><input type="radio" name="' + name + '" value="year" checked>' +
      '<span class="epp-opt__head">' + PLANS.year.label + ' <span class="epp-save">Save $40.88</span></span>' +
      '<span class="epp-opt__price">' + PLANS.year.price + "</span>" +
      '<span class="epp-opt__perk">' + ACCOUNT_MANAGER + "</span></label>" +
      '<label class="epp-opt"><input type="radio" name="' + name + '" value="month">' +
      '<span class="epp-opt__head">' + PLANS.month.label + "</span>" +
      '<span class="epp-opt__price">' + PLANS.month.price + "</span></label>" +
      "</fieldset>" +
      '<button type="button" class="epp-btn">' + PLANS.year.button + "</button>" +
      '<p class="epp-note">' + (chargeOn ? "Your first charge is on " + fmtDate(chargeOn) + ". Cancel anytime." : "Cancel anytime.") + "</p>" +
      "</div>";

    var btn = el.querySelector(".epp-btn");
    var chosen = function () { var c = el.querySelector('input[name="' + name + '"]:checked'); return c ? c.value : "year"; };
    var label = function () { return PLANS[chosen()].button; };
    el.querySelectorAll('input[name="' + name + '"]').forEach(function (r) {
      r.addEventListener("change", function () { btn.textContent = label(); });
    });

    btn.addEventListener("click", async function () {
      var token = opts.getToken ? await opts.getToken() : null;
      if (!token) {
        if (opts.onSignedOut) opts.onSignedOut();
        else location.href = "/login?next=" + encodeURIComponent(location.pathname + location.search);
        return;
      }
      btn.disabled = true;
      btn.textContent = "Loading checkout…";
      try {
        var r = await fetch("/api/create-checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
          body: JSON.stringify({ business_id: opts.businessId, interval: chosen() }),
        });
        var j = await r.json().catch(function () { return {}; });
        if (j.url) { location.href = j.url; return; }
        alert(j.error || "Could not start checkout. Email jack@enoma.io and we’ll sort it out.");
      } catch (e) {
        alert("Something went wrong. Please try again.");
      }
      btn.disabled = false;
      btn.textContent = label();
    });
    return { interval: chosen };
  }

  var api = { mount: mount, firstChargeDate: firstChargeDate, MIN_TRIAL_END_LEAD_MS: MIN_TRIAL_END_LEAD_MS };
  if (typeof window !== "undefined") window.EnomaPlanPicker = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
