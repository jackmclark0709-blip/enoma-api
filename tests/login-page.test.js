// Run with: node tests/login-page.test.js (also wired into `npm test`)
// /dashboard/login (public/dashboard/login.html, initLoginPage in
// public/scripts/claim-login.js): code first, password second. The code path
// never creates an account and its email button lands on /claim?next=dashboard;
// the code verifies with type email and opens /dashboard (or a safe ?next=);
// resend waits 60s; the password form signs in as before.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { console.error(`  FAIL - ${name}`); console.error(err); process.exitCode = 1; }
}

const src = fs.readFileSync("public/scripts/claim-login.js", "utf8");
const ctx = { window: {}, URLSearchParams, setTimeout, Promise };
vm.runInNewContext(src, ctx);
const L = ctx.window.EnomaClaimLogin;
const html = fs.readFileSync("public/dashboard/login.html", "utf8");

// Elements as in login.html, with their starting hidden state read from the markup.
const IDS = ["code-start", "login-email", "send-btn", "send-msg", "code-sent", "sent-copy", "verify-form", "login-code",
  "verify-btn", "verify-msg", "resend-btn", "change-email", "show-password", "password-view", "password-form", "email", "password", "error"];
function fakeDoc() {
  const els = {};
  for (const id of IDS) {
    const tag = html.match(new RegExp(`<[a-z]+[^>]*id="${id}"[^>]*>`));
    assert.ok(tag, `login.html has #${id}`);
    els[id] = {
      id, hidden: /\shidden[\s>]/.test(tag[0]), disabled: false, textContent: "", value: "", className: "",
      listeners: {}, focus() {},
      addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
      async fire(type) { for (const fn of this.listeners[type] || []) await fn({ preventDefault() {} }); },
    };
  }
  return { els, getElementById: (id) => els[id] || null };
}
function fakeSb({ otp = { data: {}, error: null }, verify = { data: { session: { access_token: "tok" } }, error: null }, password = { data: { session: {} }, error: null } } = {}) {
  const calls = { signInWithOtp: [], verifyOtp: [], signInWithPassword: [] };
  return {
    calls,
    auth: {
      signInWithOtp: async (a) => { calls.signInWithOtp.push(a); return typeof otp === "function" ? otp(a) : otp; },
      verifyOtp: async (a) => { calls.verifyOtp.push(a); return verify; },
      signInWithPassword: async (a) => { calls.signInWithPassword.push(a); return password; },
    },
  };
}
function page({ search = "", sb = fakeSb(), clock = { t: 1_000_000 } } = {}) {
  const doc = fakeDoc();
  const went = [], stored = {};
  const session = { setItem: (k, v) => { stored[k] = v; }, getItem: (k) => stored[k] ?? null };
  L.initLoginPage({ doc, search, sb, go: (u) => went.push(u), session, now: () => clock.t });
  return { doc, sb, went, stored, clock, els: doc.els };
}
const plain = (x) => JSON.parse(JSON.stringify(x));

await test("default view: email + 'Email me a sign-in code'; password form hidden behind 'Use a password instead'", () => {
  const p = page();
  assert.equal(p.els["code-start"].hidden, false);
  assert.equal(p.els["code-sent"].hidden, true);
  assert.equal(p.els["password-view"].hidden, true);
  assert.match(html, /id="send-btn">Email me a sign-in code</);
  assert.match(html, /id="show-password">Use a password instead</);
  assert.match(html, /id="login-code"[^>]*inputmode="numeric"[^>]*autocomplete="one-time-code"/);
  assert.match(html, /<script src="\/scripts\/claim-login\.js"><\/script>/);
  assert.doesNotMatch(html, /signInWithOtp|verifyOtp|signInWithPassword/, "all auth goes through claim-login.js");
});

await test("code path: signInWithOtp with shouldCreateUser:false and the /claim?next=dashboard redirect; shows the code view", async () => {
  const p = page();
  p.els["login-email"].value = " owner@example.com ";
  await p.els["code-start"].fire("submit");
  assert.deepEqual(plain(p.sb.calls.signInWithOtp), [{ email: "owner@example.com", options: { shouldCreateUser: false, emailRedirectTo: "https://enoma.io/claim?next=dashboard" } }]);
  assert.equal(p.els["code-start"].hidden, true);
  assert.equal(p.els["code-sent"].hidden, false);
  assert.equal(p.els["sent-copy"].textContent, "Check your inbox at owner@example.com. Type the 6-digit code, or tap the button in the email.");
});

await test("no account for that email: the plain message, and nothing else", async () => {
  const p = page({ sb: fakeSb({ otp: { data: {}, error: { message: "Signups not allowed for otp", code: "otp_disabled", status: 422 } } }) });
  p.els["login-email"].value = "stranger@example.com";
  await p.els["code-start"].fire("submit");
  assert.equal(p.els["send-msg"].textContent, "We couldn't find an account for that email. Looking for your page? Open the link Jack sent you, or email jack@enoma.io.");
  assert.equal(p.els["send-msg"].hidden, false);
  assert.equal(p.els["code-sent"].hidden, true);
  assert.equal(L.loginSendErrorMessage({ message: "User not found" }), L.NO_ACCOUNT_MESSAGE);
});

await test("a bad email is caught before anything is sent", async () => {
  const p = page();
  p.els["login-email"].value = "owner@";
  await p.els["code-start"].fire("submit");
  assert.equal(p.sb.calls.signInWithOtp.length, 0);
  assert.equal(p.els["send-msg"].textContent, "Enter the email you use for Enoma.");
});

await test("verify path: verifyOtp({ email, token, type: 'email' }), then /dashboard", async () => {
  const p = page();
  p.els["login-email"].value = "owner@example.com";
  await p.els["code-start"].fire("submit");
  p.els["login-code"].value = "123 456";
  await p.els["verify-form"].fire("submit");
  assert.deepEqual(plain(p.sb.calls.verifyOtp), [{ email: "owner@example.com", token: "123456", type: "email" }]);
  assert.deepEqual(p.went, ["/dashboard"]);
});

await test("verify path keeps a same-site ?next= and ignores an off-site one", async () => {
  for (const [search, want] of [["?next=%2Fdashboard%3Fbusiness_id%3Db1%23upgrade-banner", "/dashboard?business_id=b1#upgrade-banner"], ["?next=https%3A%2F%2Fevil.com", "/dashboard"], ["?next=%2F%2Fevil.com", "/dashboard"], ["?next=%2F%5Cevil.com", "/dashboard"]]) {
    const p = page({ search });
    p.els["login-email"].value = "owner@example.com";
    await p.els["code-start"].fire("submit");
    p.els["login-code"].value = "123456";
    await p.els["verify-form"].fire("submit");
    assert.deepEqual(p.went, [want], search);
  }
});

await test("a wrong code says so and stays put", async () => {
  const p = page({ sb: fakeSb({ verify: { data: { session: null }, error: { message: "Token has expired or is invalid" } } }) });
  p.els["login-email"].value = "owner@example.com";
  await p.els["code-start"].fire("submit");
  p.els["login-code"].value = "000000";
  await p.els["verify-form"].fire("submit");
  assert.equal(p.went.length, 0);
  assert.match(p.els["verify-msg"].textContent, /didn't work or has expired/);
  p.els["login-code"].value = "12";
  await p.els["verify-form"].fire("submit");
  assert.equal(p.els["verify-msg"].textContent, "Enter the 6-digit code from the email.");
});

await test("Resend code: at most once per 60s on this page; Supabase's rate limit maps to the same words", async () => {
  let n = 0;
  const p = page({ sb: fakeSb({ otp: () => (++n === 3 ? { error: { message: "For security purposes, you can only request this after 42 seconds.", code: "over_email_send_rate_limit" } } : { data: {}, error: null }) }) });
  p.els["login-email"].value = "owner@example.com";
  await p.els["code-start"].fire("submit");
  p.clock.t += 30_000;
  await p.els["resend-btn"].fire("click");
  assert.equal(p.sb.calls.signInWithOtp.length, 1, "not sent again inside 60s");
  assert.equal(p.els["verify-msg"].textContent, "We just sent one. Give it a minute.");
  p.clock.t += 31_000;
  await p.els["resend-btn"].fire("click");
  assert.equal(p.sb.calls.signInWithOtp.length, 2);
  assert.equal(p.sb.calls.signInWithOtp[1].options.shouldCreateUser, false);
  assert.equal(p.els["verify-msg"].textContent, "Sent a new code to owner@example.com.");
  p.clock.t += 61_000;
  await p.els["resend-btn"].fire("click");
  assert.equal(p.els["verify-msg"].textContent, "We just sent one. Give it a minute.", "server-side limit");
});

await test("Use a different email goes back to step 1", async () => {
  const p = page();
  p.els["login-email"].value = "owner@example.com";
  await p.els["code-start"].fire("submit");
  await p.els["change-email"].fire("click");
  assert.equal(p.els["code-start"].hidden, false);
  assert.equal(p.els["code-sent"].hidden, true);
});

await test("password path unchanged: signInWithPassword, then ?next= or /dashboard; flags the sign-in for the dashboard card", async () => {
  const p = page({ search: "?next=%2Fclaim%3Fbusiness%3Dacme" });
  p.els["login-email"].value = "owner@example.com";
  await p.els["show-password"].fire("click");
  assert.equal(p.els["password-view"].hidden, false);
  assert.equal(p.els["email"].value, "owner@example.com", "carries over what was typed");
  p.els["password"].value = "hunter22";
  await p.els["password-form"].fire("submit");
  assert.deepEqual(plain(p.sb.calls.signInWithPassword), [{ email: "owner@example.com", password: "hunter22" }]);
  assert.equal(p.sb.calls.signInWithOtp.length, 0);
  assert.deepEqual(p.went, ["/claim?business=acme"]);
  assert.equal(p.stored.enoma_signed_in_with_password, "1");
});

await test("password path: Supabase's error shown as before, no flag, no redirect", async () => {
  const p = page({ sb: fakeSb({ password: { data: {}, error: { message: "Invalid login credentials" } } }) });
  await p.els["show-password"].fire("click");
  p.els["email"].value = "owner@example.com";
  p.els["password"].value = "nope";
  await p.els["password-form"].fire("submit");
  assert.equal(p.els["error"].textContent, "Invalid login credentials");
  assert.equal(p.went.length, 0);
  assert.equal(p.stored.enoma_signed_in_with_password, undefined);
});

console.log(`login-page: ${passed} passed`);
