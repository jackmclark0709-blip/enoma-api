// public/scripts/claim-login.js
// Signing in to keep a page, in a way email link scanners can't break.
//
// Why: Outlook / Microsoft 365 / Gmail open links in an email before the
// owner does. A one-time sign-in link that verifies on open is used up by the
// scanner, and the owner's own tap then fails with "Email link is invalid or
// has expired". So:
//   1. The email carries a 6-digit code. The claim box (public/profile.html
//      via public/scripts/profile.js) and /claim take the code and call
//      sb.auth.verifyOtp({ email, token, type: "email" }).
//   2. The email's button goes to /claim?business=…&m=…&token_hash=…&type=email
//      (supabase/templates/*.html). /claim shows the business name and one
//      button; only the click calls sb.auth.verifyOtp({ token_hash, type: "email" }).
//      Nothing verifies on page load, so a scanner opening the link does nothing.
// Either way the owner then lands on /claim with a session, which claims the
// page and goes to the dashboard, exactly as the old link did.
//
// Loaded as a plain script (window.EnomaClaimLogin) and by tests
// (module.exports): tests/claim-login.test.js.
(function () {
  var SUPABASE_URL = "https://qhsivcenpnxwmvwznqie.supabase.co";
  var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFoc2l2Y2VucG54d212d3pucWllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ2ODQ4NjMsImV4cCI6MjA4MDI2MDg2M30.g_3eHoqfo7R15Q_9OoBy0DTq66a3BPA838VFd1aZtnc";
  var CODE_LENGTH = 6;

  /** "Acme Inc." stays "Acme Inc."; "Acme" becomes "Acme." (no double period). */
  function withPeriod(text) {
    var s = String(text == null ? "" : text).trim();
    if (!s) return s;
    return /[.!?]$/.test(s) ? s : s + ".";
  }

  /** The claim box title on Jack's outreach link (?m=). */
  function outreachTitle(businessName) {
    return "Hi, it's Jack. This page is for " + withPeriod(businessName || "you");
  }

  /** What the claim box says once the email is on its way. */
  function sentCopy(email) {
    return "Check your inbox at " + email + ". We sent a 6-digit code and a link. Type the code here, or tap the link.";
  }

  /** The 6 digits from whatever was typed or pasted ("123 456", "123-456"), or null. */
  function normalizeCode(value) {
    var digits = String(value == null ? "" : value).replace(/\D/g, "");
    return digits.length === CODE_LENGTH ? digits : null;
  }

  /** /claim?business=<slug>[&m=<message id>] (path only). */
  function claimPath(slug, m) {
    return "/claim?business=" + encodeURIComponent(slug) + (m ? "&m=" + encodeURIComponent(m) : "");
  }

  /**
   * Sends the email (code + link). The link's RedirectTo is /claim with the
   * business (and m): the template appends &token_hash=…&type=email, so the
   * redirect must already carry a "?".
   */
  function sendCode(sb, opts) {
    return sb.auth.signInWithOtp({
      email: opts.email,
      options: { emailRedirectTo: "https://enoma.io" + claimPath(opts.slug, opts.m), shouldCreateUser: true },
    });
  }

  /** Path 1: the 6-digit code typed in the claim box or on /claim. */
  function verifyCode(sb, email, code) {
    return sb.auth.verifyOtp({ email: String(email || "").trim(), token: code, type: "email" });
  }

  /** Path 2: the email's button. Call only from a click, never on load. */
  function verifyLink(sb, tokenHash) {
    return sb.auth.verifyOtp({ token_hash: tokenHash, type: "email" });
  }

  /** A friendly message for a failed verify. */
  function verifyErrorMessage(err) {
    var msg = (err && err.message) || "";
    if (/expired|invalid/i.test(msg)) return "That code didn't work or has expired. Check the newest email, or send a new code.";
    if (/rate|seconds/i.test(msg)) return "Too many tries. Wait a minute and try again.";
    return "Something went wrong. Try again, or email jack@enoma.io.";
  }

  function loadSupabase(win) {
    win = win || window;
    if (win.supabase) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var sc = win.document.createElement("script");
      sc.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js";
      sc.onload = resolve; sc.onerror = reject; win.document.head.appendChild(sc);
    });
  }
  function client(win) {
    win = win || window;
    return win.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }

  // ── /claim (public/claim.html) ──────────────────────────────────────────
  // deps: { doc, search, hash, sb, fetch, go(url), storage, gtag, wait(ms) }
  // Elements (claim.html): claim-spinner, claim-heading, claim-message,
  // claim-link, confirm-view, confirm-btn, code-view, code-form, code-email,
  // code-input, code-submit, code-resend, code-msg, password-link.
  function initClaimPage(deps) {
    var doc = deps.doc;
    var $ = function (id) { return doc.getElementById(id); };
    var params = new URLSearchParams(deps.search || "");
    var slug = params.get("business") || "";
    var m = params.get("m") || "";
    var tokenHash = params.get("token_hash") || "";
    // Password sign-ups (public/dashboard/signup.html) without a page to
    // claim confirm here too, then go on to /create.
    var nextCreate = params.get("next") === "create";
    var sb = deps.sb;
    var wait = deps.wait || function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    var show = function (id, on) { var el = $(id); if (el) el.hidden = !on; };

    function setStatus(heading, message, isError) {
      show("claim-spinner", false);
      $("claim-heading").textContent = heading;
      var msgEl = $("claim-message");
      msgEl.textContent = message;
      msgEl.className = "auth-subtitle" + (isError ? " is-error" : "");
    }

    function firstTouch() {
      try { return JSON.parse(deps.storage.getItem("enoma_first_touch") || "null"); } catch (e) { return null; }
    }
    function anonId() { try { return deps.storage.getItem("enoma_anon_id"); } catch (e) { return null; } }

    // Signed in: claim the page, then the dashboard (the old link flow).
    async function claim(session) {
      show("confirm-view", false); show("code-view", false); show("claim-spinner", true);
      if (nextCreate && !slug) { setStatus("You're signed in", "Taking you to build your page…", false); deps.go("/create"); return "create"; }
      setStatus("Keeping your page…", "Just a moment.", false);
      show("claim-spinner", true);
      try {
        var res = await deps.fetch("/api/claim-business", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token },
          body: JSON.stringify({ slug: slug, m: m || undefined, first_touch: firstTouch(), anon_id: anonId() }),
        });
        var data = await res.json();
        if (!res.ok) { setStatus("Could not claim this page", data.error || "Something went wrong.", true); return "error"; }
        try { deps.gtag && deps.gtag("event", "business_claimed", { slug: slug, transport_type: "beacon" }); } catch (e) {}
        setStatus(data.already_claimed_by_you ? "You already claimed this page" : "It's yours!", "Taking you to your dashboard…", false);
        var link = $("claim-link");
        link.href = "/dashboard?business_id=" + encodeURIComponent(data.business_id);
        link.hidden = false;
        await wait(1200);
        deps.go("/dashboard?business_id=" + encodeURIComponent(data.business_id));
        return "claimed";
      } catch (e) {
        setStatus("Something went wrong", "Please refresh and try again, or email jack@enoma.io.", true);
        return "error";
      }
    }

    function codeView(heading, message, isError) {
      show("confirm-view", false);
      setStatus(heading, message, isError);
      show("code-view", true);
      var pw = $("password-link");
      if (pw) pw.href = "/login?next=" + encodeURIComponent(claimPath(slug, m));
      var form = $("code-form"), emailEl = $("code-email"), codeEl = $("code-input"), submit = $("code-submit"), resend = $("code-resend"), msg = $("code-msg");
      var say = function (t, err) { msg.textContent = t; msg.hidden = false; msg.className = "code-msg" + (err ? " is-error" : ""); };
      form.addEventListener("submit", async function (e) {
        if (e && e.preventDefault) e.preventDefault();
        var email = String(emailEl.value || "").trim();
        var code = normalizeCode(codeEl.value);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { say("Enter the email the code went to.", true); return; }
        if (!code) { say("Enter the 6-digit code from the email.", true); return; }
        submit.disabled = true;
        var r = await verifyCode(sb, email, code);
        if (r.error || !r.data || !r.data.session) { submit.disabled = false; say(verifyErrorMessage(r.error), true); return; }
        await claim(r.data.session);
      });
      if (resend) resend.addEventListener("click", async function () {
        var email = String(emailEl.value || "").trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { say("Enter your email first, then tap Send a new code.", true); return; }
        resend.disabled = true;
        var r = await sendCode(sb, { email: email, slug: slug, m: m });
        resend.disabled = false;
        say(r && r.error ? verifyErrorMessage(r.error) : sentCopy(email), !!(r && r.error));
      });
      return "code";
    }

    async function run() {
      if (!slug && !nextCreate) { setStatus("Missing business", "No business was specified to claim.", true); return "missing"; }

      // The email's button: show the business and one button. Verify only
      // when it's clicked (a link scanner loads the page but never clicks).
      if (tokenHash) {
        show("claim-spinner", false);
        $("claim-heading").textContent = nextCreate && !slug ? "Confirm your email" : "Keep your page";
        $("claim-message").textContent = nextCreate && !slug ? "Tap the button to finish signing up." : "Tap the button to confirm it's you.";
        show("confirm-view", true);
        var btn = $("confirm-btn");
        if (nextCreate && !slug) btn.textContent = "Confirm my email";
        if (slug && deps.fetch) {
          deps.fetch("/api/get-business?slug=" + encodeURIComponent(slug))
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (b) { if (b && b.business_name) $("claim-heading").textContent = b.business_name; })
            .catch(function () {});
        }
        return new Promise(function (resolve) {
          btn.addEventListener("click", async function () {
            btn.disabled = true; btn.textContent = "Confirming…";
            var r = await verifyLink(sb, tokenHash);
            if (r.error || !r.data || !r.data.session) {
              // Expired or already used: the code in the same email still works.
              resolve(codeView("That link has expired", "Type the 6-digit code from the same email instead, or send a new one.", true));
              return;
            }
            resolve(await claim(r.data.session));
          });
        });
      }

      var got = await sb.auth.getSession();
      var session = got && got.data && got.data.session;
      if (session) return claim(session);

      // No session. An old one-time link a scanner already used lands here
      // with #error=…; either way, offer the code.
      var expired = /error_code=otp_expired|error=access_denied/.test(deps.hash || "");
      return codeView(
        expired ? "That link has expired" : "Enter your code",
        expired ? "Email scanners sometimes use up sign-in links. Type the 6-digit code from the same email instead." : "Type the 6-digit code from your email to keep your page.",
        expired
      );
    }
    return run();
  }

  var api = {
    withPeriod: withPeriod, outreachTitle: outreachTitle, sentCopy: sentCopy, normalizeCode: normalizeCode,
    claimPath: claimPath, sendCode: sendCode, verifyCode: verifyCode, verifyLink: verifyLink,
    verifyErrorMessage: verifyErrorMessage, loadSupabase: loadSupabase, client: client,
    initClaimPage: initClaimPage, CODE_LENGTH: CODE_LENGTH,
  };
  if (typeof window !== "undefined") window.EnomaClaimLogin = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
