// public/scripts/password-card.js
// "Set a password (optional)" on the dashboard (public/dashboard/index.html).
//
// Owners usually sign in with an emailed 6-digit code (claim box, /claim,
// /dashboard/login). This card offers a password as a second way in. It is
// hidden when:
//   - user_metadata.password_set is true (set by this card, and by password
//     sign-ups in public/dashboard/signup.html), or
//   - this sign-in was by password (login.html sets sessionStorage
//     "enoma_signed_in_with_password"; we then record password_set once, so
//     accounts from before this card never see it), or
//   - the owner tapped "Not now" in the last 30 days (localStorage).
//
// Saving: sb.auth.updateUser({ password, data: { password_set: true } }).
// If Supabase wants a fresh confirmation first (Secure password change),
// sb.auth.reauthenticate() emails a 6-digit code and the save is retried
// with { nonce: code }.
//
// Loaded as a plain script (window.EnomaPasswordCard) and by tests
// (module.exports): tests/password-card.test.js.
(function () {
  var SNOOZE_KEY = "enoma_password_card_snooze_until";
  var DONE_KEY = "enoma_password_set";
  var PASSWORD_FLAG = "enoma_signed_in_with_password";
  var SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;
  var MIN_LENGTH = 8;

  function get(store, key) { try { return store ? store.getItem(key) : null; } catch (e) { return null; } }
  function set(store, key, value) { try { if (store) store.setItem(key, value); } catch (e) {} }
  function remove(store, key) { try { if (store) store.removeItem(key); } catch (e) {} }

  /** Should the card show for this user right now? */
  function shouldShow(user, storage, now) {
    if (!user) return false;
    var meta = user.user_metadata || {};
    if (meta.password_set === true) return false;
    if (get(storage, DONE_KEY) === "1") return false;
    var until = Number(get(storage, SNOOZE_KEY) || 0);
    if (until && now < until) return false;
    return true;
  }

  /** The first problem with what was typed, or "". */
  function validate(password, confirm) {
    if (String(password || "").length < MIN_LENGTH) return "Passwords must be at least 8 characters";
    if (password !== confirm) return "Those don't match";
    return "";
  }

  /** Does this updateUser error mean "confirm it's you first"? */
  function needsReauth(err) {
    if (!err) return false;
    var code = err.code || "", msg = err.message || "";
    return /reauthentication|nonce/i.test(code) || /reauthenticat|nonce/i.test(msg);
  }

  /** Plain words for a failed save. */
  function errorMessage(err) {
    var code = (err && err.code) || "", msg = (err && err.message) || "";
    if (/weak_password/.test(code) || /at least|too short|weak/i.test(msg)) return "Passwords must be at least 8 characters";
    if (/same_password/.test(code) || /different from the old/i.test(msg)) return "That's already your password.";
    if (/reauthentication_not_valid/.test(code) || /nonce|expired|invalid/i.test(msg)) return "That code didn't work or has expired. Tap Save password to get a new one.";
    if (/rate/i.test(code) || /rate limit|seconds/i.test(msg)) return "Too many tries. Wait a minute and try again.";
    return "Something went wrong. Try again, or email jack@enoma.io.";
  }

  // deps: { doc, sb, user, storage (localStorage), session (sessionStorage), now() }
  // Elements (index.html): pw-card, pw-form, pw-new, pw-toggle, pw-confirm,
  // pw-nonce-wrap, pw-nonce-copy, pw-nonce, pw-save, pw-later, pw-msg, pw-body, pw-done.
  async function init(deps) {
    var doc = deps.doc, sb = deps.sb, user = deps.user;
    var now = deps.now || function () { return Date.now(); };
    var $ = function (id) { return doc.getElementById(id); };
    var card = $("pw-card");
    if (!card || !user) return "none";

    // Signed in with a password: record it once, and don't offer one.
    if (get(deps.session, PASSWORD_FLAG) === "1") {
      remove(deps.session, PASSWORD_FLAG);
      if (!(user.user_metadata && user.user_metadata.password_set === true)) {
        try { await sb.auth.updateUser({ data: { password_set: true } }); } catch (e) {}
      }
      set(deps.storage, DONE_KEY, "1");
      card.hidden = true;
      return "password-user";
    }

    if (!shouldShow(user, deps.storage, now())) { card.hidden = true; return "hidden"; }
    card.hidden = false;

    var form = $("pw-form"), pw = $("pw-new"), confirm = $("pw-confirm"), save = $("pw-save"), msg = $("pw-msg");
    var awaitingCode = false;
    function say(text, isError) {
      msg.textContent = text || ""; msg.hidden = !text;
      msg.className = "pw-msg" + (isError ? " is-error" : "");
    }
    function saved() {
      set(deps.storage, DONE_KEY, "1");
      $("pw-body").hidden = true;
      $("pw-done").hidden = false;
      return "saved";
    }

    $("pw-toggle").addEventListener("click", function () {
      var showing = pw.type === "text";
      pw.type = confirm.type = showing ? "password" : "text";
      this.textContent = showing ? "Show" : "Hide";
      this.setAttribute("aria-pressed", showing ? "false" : "true");
    });

    $("pw-later").addEventListener("click", function () {
      set(deps.storage, SNOOZE_KEY, String(now() + SNOOZE_MS));
      card.hidden = true;
    });

    form.addEventListener("submit", async function (e) {
      if (e && e.preventDefault) e.preventDefault();
      var problem = validate(pw.value, confirm.value);
      if (problem) { say(problem, true); return; }
      save.disabled = true; say("");
      var attrs = { password: pw.value, data: { password_set: true } };
      if (awaitingCode) {
        var digits = String($("pw-nonce").value || "").replace(/\D/g, "");
        if (digits.length !== 6) { save.disabled = false; say("Enter the 6-digit code from the email.", true); return; }
        attrs.nonce = digits;
      }
      var r = (await sb.auth.updateUser(attrs)) || {};
      if (!r.error) { saved(); return; }
      if (!awaitingCode && needsReauth(r.error)) {
        var re = (await sb.auth.reauthenticate()) || {};
        save.disabled = false;
        if (re.error) { say(errorMessage(re.error), true); return; }
        awaitingCode = true;
        $("pw-nonce-wrap").hidden = false;
        $("pw-nonce-copy").textContent = "To keep your account safe, we emailed a 6-digit code to " + (user.email || "you") + ". Type it here, then tap Save password.";
        try { $("pw-nonce").focus(); } catch (err) {}
        return;
      }
      save.disabled = false;
      say(errorMessage(r.error), true);
    });
    return "shown";
  }

  var api = {
    shouldShow: shouldShow, validate: validate, needsReauth: needsReauth, errorMessage: errorMessage, init: init,
    SNOOZE_KEY: SNOOZE_KEY, DONE_KEY: DONE_KEY, PASSWORD_FLAG: PASSWORD_FLAG, SNOOZE_MS: SNOOZE_MS,
  };
  if (typeof window !== "undefined") window.EnomaPasswordCard = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
