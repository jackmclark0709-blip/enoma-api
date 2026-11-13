// Run with: node tests/dashboard-status.test.js (also wired into `npm test`)
// public/dashboard/index.html: what the status line says for an unpaid v2
// preview (never "Active"), a v2 owner in their paid $1 month, and a paid
// plan; the monthly total during the first month; the "Managed by Enoma"
// card first in the main column.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { console.error(`  FAIL - ${name}`); console.error(err); process.exitCode = 1; }
}

const html = fs.readFileSync("public/dashboard/index.html", "utf8");
const fmtET = (d, opts) => d.toLocaleDateString("en-US", Object.assign({ timeZone: "America/New_York" }, opts));
// Stripe trial_end for a $1 checkout on Nov 13, 2026: Dec 13 23:59 Eastern.
const chargeOn = new Date("2026-12-14T04:59:00Z");

// Run the page's billing-line helpers against a stub document.
function helpers() {
  const start = html.indexOf("function money(cents)");
  const end = html.indexOf("async function loadSpotlights");
  const els = { "monthly-total": { style: {}, textContent: "" }, "renewal-date": { textContent: "" } };
  const ctx = { document: { getElementById: (id) => els[id] || null } };
  vm.runInNewContext(html.slice(start, end) + "\nthis.set = (v) => { firstMonth = v; }; this.renderMonthlyTotal = renderMonthlyTotal; this.renderFirstMonthLine = renderFirstMonthLine;", ctx);
  return { ctx, els };
}

test("paid first month: 'Paid $1 for your first month · Next charge $19.99 on Dec 13, 2026' ($199 yearly)", () => {
  const { ctx, els } = helpers();
  ctx.renderFirstMonthLine(els["renewal-date"], { chargeOn, yearly: false, fmtET }, null);
  assert.equal(els["renewal-date"].textContent, "Paid $1 for your first month · Next charge $19.99 on Dec 13, 2026");
  ctx.renderFirstMonthLine(els["renewal-date"], { chargeOn, yearly: true, fmtET }, null);
  assert.equal(els["renewal-date"].textContent, "Paid $1 for your first month · Next charge $199 on Dec 13, 2026");
  ctx.renderFirstMonthLine(els["renewal-date"], { chargeOn, yearly: false, fmtET }, 999);
  assert.equal(els["renewal-date"].textContent, "Paid $1 for your first month · Next charge $9.99 on Dec 13, 2026", "live price (partner)");
});

test("monthly total in the first month says when it starts", () => {
  const { ctx, els } = helpers();
  ctx.set({ chargeOn, yearly: false, fmtET });
  ctx.renderMonthlyTotal({ billing: "subscription", total: 1999, page_amount: 1999, published: 0, total_interval: "month" });
  assert.equal(els["monthly-total"].textContent, "Monthly total: $19.99/month (starting Dec 13)");
  ctx.renderMonthlyTotal({ billing: "subscription", total: 2998, page_amount: 1999, published: 1, spotlight_amount: 999, total_interval: "month" });
  assert.equal(els["monthly-total"].textContent, "Monthly total: $29.98/month ($19.99 page + 1 service page × $9.99, starting Dec 13)");
  ctx.set(null);
  ctx.renderMonthlyTotal({ billing: "subscription", total: 1999, page_amount: 1999, published: 0, total_interval: "month" });
  assert.equal(els["monthly-total"].textContent, "Monthly total: $19.99/month ($19.99 page)", "after the first month: unchanged");
});

const chain = html.slice(html.indexOf("const v2Preview ="), html.indexOf("} else if (sub.status === 'past_due')"));
test("unpaid v2 preview is checked before 'active' and says Preview, Not on Google yet, with the date", () => {
  assert.ok(chain.indexOf("if (v2Preview && !trialExpired)") < chain.indexOf("sub.status === 'active'"), "preview first");
  const preview = chain.slice(chain.indexOf("if (v2Preview && !trialExpired)"), chain.indexOf("} else if (v2Preview)"));
  assert.match(preview, /statusEl\.textContent = 'Preview'/);
  assert.doesNotMatch(preview, /Active/);
  assert.match(preview, /`Not on Google yet · Preview available until \$\{fmtET\(trialExpiry, \{ month: 'short', day: 'numeric', year: 'numeric' \}\)\}`/);
  assert.match(preview, /showPlanPicker\(sub\)/, "the go-live box");
  assert.equal(fmtET(new Date("2026-02-10T20:00:00Z"), { month: "short", day: "numeric", year: "numeric" }), "Feb 10, 2026");
});

test("paid: 'Live on Google' next to the status; first month replaces 'First charge'", () => {
  const active = chain.slice(chain.indexOf("} else if (sub.status === 'active')"), chain.indexOf("} else if (v2FirstMonth)"));
  assert.match(active, /'Live on Google' \+/);
  assert.match(active, /Renews/);
  const first = chain.slice(chain.indexOf("} else if (v2FirstMonth)"), chain.indexOf("} else if (subscribedInFreeMonth)"));
  assert.match(first, /statusEl\.textContent = '● Live on Google'/);
  assert.doesNotMatch(first, /First charge/);
  assert.match(chain, /const v2FirstMonth = sub\.pricing_version === 'v2_1dollar' && subscribedInFreeMonth;/);
  assert.match(html, /Canceled — active until/, "canceled copy kept");
});

test("'Managed by Enoma' card is the first card in the main column, above 'Your live page'", () => {
  const main = html.slice(html.indexOf("<!-- LEFT COLUMN -->"), html.indexOf("<!-- RIGHT COLUMN"));
  const upsell = main.indexOf('class="card upsell-card"');
  assert.ok(upsell > 0, "in the main column");
  assert.ok(upsell < main.indexOf("Your live page"));
  assert.equal(main.indexOf('class="card'), upsell, "first card");
  assert.match(main, /Want hands-on help\?/);
  assert.equal((html.match(/upsell-card"/g) || []).length, 1, "moved, not copied");
});

console.log(`dashboard-status: ${passed} passed`);
