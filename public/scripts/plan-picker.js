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
// Yearly is the default (or the plan the owner picked before claiming; see
// planIntent). It posts { business_id, interval } to
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


  // "year" | "month" if the owner picked a plan before claiming (the preview
  // landing's "subscribe now" link, saved by public/scripts/profile.js), else null.
  var INTENT_KEY = "enoma_plan_intent";
  function planIntent(storage) {
    try {
      var s = storage || (typeof sessionStorage !== "undefined" ? sessionStorage : null);
      var v = s && s.getItem(INTENT_KEY);
      return v === "year" || v === "month" ? v : null;
    } catch (e) { return null; }
  }

  var seq = 0;
  function mount(el, opts) {
    if (!el || !opts || !opts.businessId) return null;
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
    var intent = planIntent();
    if (intent) {
      var pick = el.querySelector('input[name="' + name + '"][value="' + intent + '"]');
      if (pick) { pick.checked = true; btn.textContent = label(); }
    }

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
          body: JSON.stringify({
            business_id: opts.businessId, interval: chosen(),
            // funnel_events checkout_started (api/create-checkout.js)
            anon_id: (function () { try { return localStorage.getItem("enoma_anon_id"); } catch (e) { return null; } })()
          }),
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

  var api = { mount: mount, firstChargeDate: firstChargeDate, planIntent: planIntent, MIN_TRIAL_END_LEAD_MS: MIN_TRIAL_END_LEAD_MS };
  if (typeof window !== "undefined") window.EnomaPlanPicker = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
