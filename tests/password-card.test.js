// Run with: node tests/password-card.test.js (also wired into `npm test`)
// "Set a password (optional)" on the dashboard (public/scripts/password-card.js):
// who sees it, "Not now", saving (with and without Supabase's reauthentication
// step), and password sign-ups/sign-ins never seeing it.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { console.error(`  FAIL - ${name}`); console.error(err); process.exitCode = 1; }
}

const src = fs.readFileSync("public/scripts/password-card.js", "utf8");
const ctx = { window: {} };
vm.runInNewContext(src, ctx);
const P = ctx.window.EnomaPasswordCard;
const dash = fs.readFileSync("public/dashboard/index.html", "utf8");

const IDS = ["pw-card", "pw-body", "pw-form", "pw-new", "pw-toggle", "pw-confirm", "pw-nonce-wrap", "pw-nonce-copy", "pw-nonce", "pw-save", "pw-later", "pw-msg", "pw-done"];
function fakeDoc() {
  const els = {};
  for (const id of IDS) {
    const tag = dash.match(new RegExp(`<[a-z]+[^>]*id="${id}"[^>]*>`));
    assert.ok(tag, `index.html has #${id}`);
    els[id] = {
      id, hidden: /\shidden[\s>]/.test(tag[0]), disabled: false, textContent: "", value: "", className: "", type: "password", attrs: {},
      listeners: {}, focus() {}, setAttribute(k, v) { this.attrs[k] = v; },
      addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
      async fire(type) { for (const fn of this.listeners[type] || []) await fn.call(this, { preventDefault() {} }); },
    };
  }
  return { els, getElementById: (id) => els[id] || null };
}
function store(init = {}) {
  const data = { ...init };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, removeItem: (k) => { delete data[k]; } };
}
function fakeSb(updates = [{ data: { user: {} }, error: null }]) {
  const calls = { updateUser: [], reauthenticate: 0 };
  let i = 0;
  return {
    calls,
    auth: {
      updateUser: async (a) => { calls.updateUser.push(JSON.parse(JSON.stringify(a))); return updates[Math.min(i++, updates.length - 1)]; },
      reauthenticate: async () => { calls.reauthenticate++; return { data: {}, error: null }; },
    },
  };
}
const NOW = Date.UTC(2026, 10, 13);
async function card({ meta = {}, local = store(), session = store(), sb = fakeSb(), now = NOW } = {}) {
  const doc = fakeDoc();
  const state = await P.init({ doc, sb, user: { email: "owner@example.com", user_metadata: meta }, storage: local, session, now: () => now });
  return { state, doc, els: doc.els, sb, local, session };
}

await test("markup: first card in the main column, hidden until the script shows it; copy as written", () => {
  const main = dash.slice(dash.indexOf("<!-- LEFT COLUMN -->"));
  assert.equal(main.indexOf('class="card'), main.indexOf('id="pw-card"') - 'class="card pw-card" '.length);
  assert.ok(main.indexOf('id="pw-card"') < main.indexOf("Managed by Enoma"));
  assert.match(dash, />Set a password \(optional\)</);
  assert.match(dash, /You signed in with a code\. Add a password if you'd like another way in\. You can always sign in with a code instead\./);
  assert.match(dash, /id="pw-save">Save password</);
  assert.match(dash, /id="pw-later">Not now</);
  assert.match(dash, /Password saved\. You can sign in with either\./);
  assert.match(dash, /id="pw-nonce"[^>]*inputmode="numeric"[^>]*autocomplete="one-time-code"/);
  assert.match(dash, /<script src="\/scripts\/password-card\.js"><\/script>/);
  const cardHtml = dash.slice(dash.indexOf('id="pw-card"'), dash.indexOf("Managed by Enoma"));
  assert.doesNotMatch(cardHtml, /\bfree\b/i, "no 'free'");
});

await test("shown to a code-signed-in owner without a password", async () => {
  const c = await card();
  assert.equal(c.state, "shown");
  assert.equal(c.els["pw-card"].hidden, false);
});

await test("hidden when user_metadata.password_set is true", async () => {
  const c = await card({ meta: { password_set: true } });
  assert.equal(c.state, "hidden");
  assert.equal(c.els["pw-card"].hidden, true);
  assert.equal(c.sb.calls.updateUser.length, 0);
});

await test("'Not now' hides it for 30 days (localStorage), then it comes back", async () => {
  const local = store();
  const c = await card({ local });
  await c.els["pw-later"].fire("click");
  assert.equal(c.els["pw-card"].hidden, true);
  assert.equal(Number(local.data[P.SNOOZE_KEY]), NOW + 30 * 24 * 3600 * 1000);
  assert.equal((await card({ local, now: NOW + 29 * 24 * 3600 * 1000 })).state, "hidden");
  assert.equal((await card({ local, now: NOW + 31 * 24 * 3600 * 1000 })).state, "shown");
});

await test("storage that throws (private mode) doesn't break it", async () => {
  const bad = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
  const c = await card({ local: bad, session: bad });
  assert.equal(c.state, "shown");
  await c.els["pw-later"].fire("click");
  assert.equal(c.els["pw-card"].hidden, true);
});

await test("validation: at least 8 characters, and both must match", async () => {
  assert.equal(P.validate("short", "short"), "Passwords must be at least 8 characters");
  assert.equal(P.validate("longenough", "longenougH"), "Those don't match");
  assert.equal(P.validate("longenough", "longenough"), "");
  const c = await card();
  c.els["pw-new"].value = "abc"; c.els["pw-confirm"].value = "abc";
  await c.els["pw-form"].fire("submit");
  assert.equal(c.els["pw-msg"].textContent, "Passwords must be at least 8 characters");
  assert.equal(c.sb.calls.updateUser.length, 0);
});

await test("show/hide toggles both fields", async () => {
  const c = await card();
  await c.els["pw-toggle"].fire("click");
  assert.equal(c.els["pw-new"].type, "text");
  assert.equal(c.els["pw-confirm"].type, "text");
  assert.equal(c.els["pw-toggle"].textContent, "Hide");
  await c.els["pw-toggle"].fire("click");
  assert.equal(c.els["pw-new"].type, "password");
});

await test("save: updateUser({ password, data: { password_set: true } }), then the saved message; never shown again", async () => {
  const local = store();
  const c = await card({ local });
  c.els["pw-new"].value = "correct horse"; c.els["pw-confirm"].value = "correct horse";
  await c.els["pw-form"].fire("submit");
  assert.deepEqual(c.sb.calls.updateUser, [{ password: "correct horse", data: { password_set: true } }]);
  assert.equal(c.els["pw-body"].hidden, true);
  assert.equal(c.els["pw-done"].hidden, false);
  assert.equal((await card({ local })).state, "hidden", "even before the session's metadata refreshes");
});

await test("reauthentication: reauthenticate() sends a code, then updateUser with { nonce }", async () => {
  const sb = fakeSb([
    { data: {}, error: { message: "Password update requires reauthentication.", code: "reauthentication_needed", status: 400 } },
    { data: { user: {} }, error: null },
  ]);
  const c = await card({ sb });
  c.els["pw-new"].value = "correct horse"; c.els["pw-confirm"].value = "correct horse";
  await c.els["pw-form"].fire("submit");
  assert.equal(sb.calls.reauthenticate, 1);
  assert.equal(c.els["pw-nonce-wrap"].hidden, false);
  assert.match(c.els["pw-nonce-copy"].textContent, /owner@example\.com/);
  assert.equal(c.els["pw-done"].hidden, true, "not saved yet");
  c.els["pw-nonce"].value = "123 456";
  await c.els["pw-form"].fire("submit");
  assert.deepEqual(sb.calls.updateUser, [
    { password: "correct horse", data: { password_set: true } },
    { password: "correct horse", nonce: "123456", data: { password_set: true } },
  ]);
  assert.equal(sb.calls.reauthenticate, 1);
  assert.equal(c.els["pw-done"].hidden, false);
});

await test("reauthentication: a nonce error also triggers it; a bad code says so", async () => {
  assert.equal(P.needsReauth({ message: "Missing nonce" }), true);
  assert.equal(P.needsReauth({ code: "reauthentication_needed" }), true);
  assert.equal(P.needsReauth({ message: "Password should be at least 8 characters", code: "weak_password" }), false);
  const sb = fakeSb([
    { data: {}, error: { message: "Missing nonce", code: "reauthentication_needed" } },
    { data: {}, error: { message: "Invalid nonce", code: "reauthentication_not_valid" } },
  ]);
  const c = await card({ sb });
  c.els["pw-new"].value = "correct horse"; c.els["pw-confirm"].value = "correct horse";
  await c.els["pw-form"].fire("submit");
  c.els["pw-nonce"].value = "999999";
  await c.els["pw-form"].fire("submit");
  assert.match(c.els["pw-msg"].textContent, /didn't work or has expired/);
  assert.equal(c.els["pw-done"].hidden, true);
});

await test("signed in with a password: card hidden, password_set recorded once", async () => {
  const session = store({ [P.PASSWORD_FLAG]: "1" });
  const c = await card({ session });
  assert.equal(c.state, "password-user");
  assert.equal(c.els["pw-card"].hidden, true);
  assert.deepEqual(c.sb.calls.updateUser, [{ data: { password_set: true } }]);
  assert.equal(session.data[P.PASSWORD_FLAG], undefined, "flag cleared");
  assert.equal((await card({ local: c.local })).state, "hidden");
});

await test("password sign-ups set data.password_set = true", () => {
  const signup = fs.readFileSync("public/dashboard/signup.html", "utf8");
  const call = signup.slice(signup.indexOf("sb.auth.signUp({"), signup.indexOf("if (res.error)"));
  assert.match(call, /data: \{[\s\S]*password_set: true/);
});

await test("dashboard wires the card with the signed-in user", () => {
  assert.match(dash, /EnomaPasswordCard\?\.init\(\{ doc: document, sb: supabase, user: session\.user, storage: local, session: sess \}\)/);
});

console.log(`password-card: ${passed} passed`);
