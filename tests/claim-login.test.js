// Run with: node tests/claim-login.test.js (also wired into `npm test`)
// Sign-in that survives email link scanners (public/scripts/claim-login.js):
// the claim box and /claim verify a 6-digit code, and the email's button
// lands on /claim with a token_hash that is verified only on a click, never
// on page load. Also: the claim box title helper, the Supabase templates.
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

// ── A tiny DOM: elements by id, with listeners we can fire ──
function fakeDoc(ids) {
  const els = {};
  for (const id of ids) {
    els[id] = {
      // As in claim.html: these start hidden.
      id, hidden: ["confirm-view", "code-view", "claim-link", "code-msg"].includes(id), disabled: false, textContent: "", value: "", href: "", className: "",
      listeners: {},
      addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
      async fire(type) { for (const fn of this.listeners[type] || []) await fn({ preventDefault() {} }); },
    };
  }
  return { els, getElementById: (id) => els[id] || null };
}
const IDS = ["claim-spinner", "claim-heading", "claim-message", "claim-link", "confirm-view", "confirm-btn",
  "code-view", "code-form", "code-email", "code-input", "code-submit", "code-resend", "code-msg", "password-link"];

function fakeSb({ session = null, verify = { data: { session: { access_token: "tok" } }, error: null } } = {}) {
  const calls = { verifyOtp: [], signInWithOtp: [] };
  return {
    calls,
    auth: {
      getSession: async () => ({ data: { session } }),
      verifyOtp: async (args) => { calls.verifyOtp.push(args); return verify; },
      signInWithOtp: async (args) => { calls.signInWithOtp.push(args); return { error: null }; },
    },
  };
}
function fakeFetch(log) {
  return async (url, opts) => {
    log.push({ url, opts });
    if (url.startsWith("/api/get-business")) return { ok: true, json: async () => ({ business_name: "AssayQuant Technologies, Inc." }) };
    return { ok: true, json: async () => ({ business_id: "biz-1" }) };
  };
}
const storage = { getItem: () => null };
const tick = () => new Promise((r) => setTimeout(r, 0));

function page({ search, hash = "", sb = fakeSb() }) {
  const doc = fakeDoc(IDS);
  const fetched = [], went = [];
  const done = L.initClaimPage({ doc, search, hash, sb, fetch: fakeFetch(fetched), go: (u) => went.push(u), storage, wait: async () => {} });
  return { doc, sb, fetched, went, done };
}

// ── Claim box title (bug: "AssayQuant Technologies, Inc..") ──
await test("title: no second period when the business name already ends in one", () => {
  assert.equal(L.outreachTitle("AssayQuant Technologies, Inc."), "Hi, it's Jack. This page is for AssayQuant Technologies, Inc.");
  assert.equal(L.outreachTitle("Robbins Plumbing"), "Hi, it's Jack. This page is for Robbins Plumbing.");
  assert.equal(L.outreachTitle("Yes Electric!"), "Hi, it's Jack. This page is for Yes Electric!");
  assert.equal(L.outreachTitle("  Smith Co.  "), "Hi, it's Jack. This page is for Smith Co.");
  assert.equal(L.outreachTitle(""), "Hi, it's Jack. This page is for you.");
  assert.equal(L.outreachTitle(null), "Hi, it's Jack. This page is for you.");
  assert.equal(L.withPeriod("A.B. Landscaping LLC"), "A.B. Landscaping LLC.");
});

await test("after sending: the code-and-link copy", () => {
  assert.equal(L.sentCopy("owner@example.com"), "Check your inbox at owner@example.com. We sent a 6-digit code and a link. Type the code here, or tap the link.");
});

await test("code: 6 digits from whatever was typed or pasted", () => {
  assert.equal(L.normalizeCode("123456"), "123456");
  assert.equal(L.normalizeCode(" 123 456 "), "123456");
  assert.equal(L.normalizeCode("123-456"), "123456");
  assert.equal(L.normalizeCode("12345"), null);
  assert.equal(L.normalizeCode("1234567"), null);
  assert.equal(L.normalizeCode(""), null);
});

// ── The two verify paths ──
await test("code path: verifyOtp({ email, token, type: 'email' })", async () => {
  const sb = fakeSb();
  await L.verifyCode(sb, " owner@example.com ", "123456");
  assert.deepEqual(JSON.parse(JSON.stringify(sb.calls.verifyOtp)), [{ email: "owner@example.com", token: "123456", type: "email" }]);
});

await test("link path: verifyOtp({ token_hash, type: 'email' })", async () => {
  const sb = fakeSb();
  await L.verifyLink(sb, "pkce_abc123");
  assert.deepEqual(JSON.parse(JSON.stringify(sb.calls.verifyOtp)), [{ token_hash: "pkce_abc123", type: "email" }]);
});

await test("sending: signInWithOtp with RedirectTo = /claim?business=…&m=… (has a ?, so the template can append &token_hash)", async () => {
  const sb = fakeSb();
  await L.sendCode(sb, { email: "owner@example.com", slug: "robbins-plumbing", m: "abc-123" });
  const opts = sb.calls.signInWithOtp[0].options;
  assert.equal(opts.emailRedirectTo, "https://enoma.io/claim?business=robbins-plumbing&m=abc-123");
  assert.equal(opts.shouldCreateUser, true);
  await L.sendCode(sb, { email: "owner@example.com", slug: "robbins-plumbing" });
  assert.equal(sb.calls.signInWithOtp[1].options.emailRedirectTo, "https://enoma.io/claim?business=robbins-plumbing");
});

// ── /claim with a token_hash: a scanner opening the link does nothing ──
await test("/claim with token_hash: never calls verifyOtp on load; shows the business name and one button", async () => {
  const p = page({ search: "?business=assayquant&m=abc-123&token_hash=pkce_abc123&type=email" });
  await tick(); await tick();
  assert.equal(p.sb.calls.verifyOtp.length, 0, "no verify on load");
  assert.equal(p.doc.els["confirm-view"].hidden, false);
  assert.equal(p.doc.els["code-view"].hidden, true, "one button, no form");
  assert.equal(p.doc.els["claim-heading"].textContent, "AssayQuant Technologies, Inc.");
  assert.equal(p.fetched.filter((f) => f.url === "/api/claim-business").length, 0, "nothing claimed before the click");
  assert.equal(p.went.length, 0);
});

await test("/claim with token_hash: the click verifies with type email, then claims and opens the dashboard", async () => {
  const p = page({ search: "?business=assayquant&m=abc-123&token_hash=pkce_abc123&type=email" });
  await tick();
  await p.doc.els["confirm-btn"].fire("click");
  assert.deepEqual(JSON.parse(JSON.stringify(p.sb.calls.verifyOtp)), [{ token_hash: "pkce_abc123", type: "email" }]);
  const claim = p.fetched.find((f) => f.url === "/api/claim-business");
  assert.ok(claim, "claimed");
  assert.equal(claim.opts.headers.Authorization, "Bearer tok");
  assert.deepEqual(JSON.parse(claim.opts.body).slug, "assayquant");
  assert.deepEqual(JSON.parse(claim.opts.body).m, "abc-123");
  assert.deepEqual(p.went, ["/dashboard?business_id=biz-1"]);
});

await test("/claim with a used-up token_hash: falls back to the code from the same email", async () => {
  const sb = fakeSb({ verify: { data: { session: null }, error: { message: "Email link is invalid or has expired" } } });
  const p = page({ search: "?business=assayquant&token_hash=used&type=email", sb });
  await tick();
  await p.doc.els["confirm-btn"].fire("click");
  assert.equal(p.doc.els["code-view"].hidden, false);
  assert.equal(p.doc.els["claim-heading"].textContent, "That link has expired");
  assert.equal(p.went.length, 0);
});

// ── /claim without a token_hash ──
await test("/claim signed in (old link, or after the claim box code): claims, then the dashboard", async () => {
  const p = page({ search: "?business=assayquant", sb: fakeSb({ session: { access_token: "tok" } }) });
  await p.done;
  assert.equal(p.sb.calls.verifyOtp.length, 0);
  assert.deepEqual(p.went, ["/dashboard?business_id=biz-1"]);
});

await test("/claim signed out: asks for the code (no redirect away, no verify on load); the code verifies with type email", async () => {
  const p = page({ search: "?business=assayquant&m=abc-123", hash: "#error=access_denied&error_code=otp_expired" });
  await p.done;
  assert.equal(p.sb.calls.verifyOtp.length, 0, "no verify on load");
  assert.equal(p.doc.els["code-view"].hidden, false);
  assert.equal(p.doc.els["claim-heading"].textContent, "That link has expired");
  assert.equal(p.doc.els["password-link"].href, "/login?next=" + encodeURIComponent("/claim?business=assayquant&m=abc-123"));
  p.doc.els["code-email"].value = "owner@example.com";
  p.doc.els["code-input"].value = "123 456";
  await p.doc.els["code-form"].fire("submit");
  assert.deepEqual(JSON.parse(JSON.stringify(p.sb.calls.verifyOtp)), [{ email: "owner@example.com", token: "123456", type: "email" }]);
  assert.deepEqual(p.went, ["/dashboard?business_id=biz-1"]);
});

await test("/claim?next=create (password sign-up confirm, no page to claim): confirm on click, then /create", async () => {
  const p = page({ search: "?next=create&token_hash=pkce_x&type=email" });
  await tick();
  assert.equal(p.sb.calls.verifyOtp.length, 0);
  assert.equal(p.doc.els["confirm-btn"].textContent, "Confirm my email");
  await p.doc.els["confirm-btn"].fire("click");
  assert.deepEqual(p.went, ["/create"]);
  assert.equal(p.fetched.filter((f) => f.url === "/api/claim-business").length, 0);
});

// ── The pages use it ──
await test("claim.html: no verifyOtp of its own; hands everything to initClaimPage", () => {
  const html = fs.readFileSync("public/claim.html", "utf8");
  assert.doesNotMatch(html, /verifyOtp/);
  assert.match(html, /<script src="\/scripts\/claim-login\.js"><\/script>/);
  assert.match(html, /L\.initClaimPage\(\{/);
  assert.match(html, /id="confirm-btn">Confirm and keep my page</);
  assert.match(html, /id="code-input"[^>]*autocomplete="one-time-code"/);
});

await test("claim box (profile.js): sends via sendCode, verifies the code with verifyCode, then /claim", () => {
  const js = fs.readFileSync("public/scripts/profile.js", "utf8");
  const html = fs.readFileSync("public/profile.html", "utf8");
  assert.match(html, /<script src="\/scripts\/claim-login\.js"><\/script>\s*<script src="\/scripts\/profile\.js">/);
  assert.match(js, /L\.sendCode\(await getClient\(\), \{ email, slug: pageSlug, m: outreachMsg \}\)/);
  assert.match(js, /L\.verifyCode\(await getClient\(\), sentTo, code\)/);
  assert.match(js, /window\.location\.href = L\.claimPath\(pageSlug, outreachMsg\)/);
  assert.match(js, /say\(L\.sentCopy\(email\)\)/);
  assert.match(js, /L\.outreachTitle\(businessName\)/);
  assert.doesNotMatch(js, /signInWithOtp|verifyOtp/, "all auth calls go through claim-login.js");
  assert.match(html, /id="claimCode"[^>]*autocomplete="one-time-code"/);
});

await test("signup.html: the confirm link's RedirectTo always carries a ? (template appends &token_hash)", () => {
  const html = fs.readFileSync("public/dashboard/signup.html", "utf8");
  const redirects = [...html.matchAll(/'(https:\/\/enoma\.io\/[^']*)'/g)].map((x) => x[1]).filter((u) => /claim|create/.test(u));
  assert.ok(redirects.length >= 2);
  for (const u of redirects) assert.match(u, /\?/, u);
});

// ── Supabase email templates ──
for (const name of ["magic_link", "confirm_signup"]) {
  await test(`supabase/templates/${name}.html: code, scanner-safe button, plain inline HTML under 30 KB`, () => {
    const html = fs.readFileSync(`supabase/templates/${name}.html`, "utf8");
    assert.ok(Buffer.byteLength(html) < 30 * 1024, "under 30 KB");
    assert.match(html, /\{\{ \.Token \}\}/);
    assert.match(html, /href="\{\{ \.RedirectTo \}\}&token_hash=\{\{ \.TokenHash \}\}&type=email"/);
    assert.doesNotMatch(html, /ConfirmationURL/, "the one-time verify URL is what scanners use up");
    assert.match(html, />\s*Confirm and keep my page\s*</);
    assert.match(html, /Here's your code to keep your page/);
    assert.match(html, /Didn't ask for this\? Ignore this email\./);
    assert.match(html, /— Jack, Enoma/);
    assert.doesNotMatch(html, /<link\b|<style\b|\.svg/i, "no external CSS, no <style>, no SVG");
  });
}
await test("both templates are the same email", () => {
  assert.equal(fs.readFileSync("supabase/templates/magic_link.html", "utf8"), fs.readFileSync("supabase/templates/confirm_signup.html", "utf8"));
});

console.log(`claim-login: ${passed} passed`);
