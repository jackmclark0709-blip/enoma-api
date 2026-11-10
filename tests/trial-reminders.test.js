// Run with: node tests/trial-reminders.test.js (also wired into `npm test`)
// Free-month reminder emails (api/_lib/trial-reminders.js): when each one is
// due, what it says (including grandfathered pages, which never turn off),
// and who must never get one.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  reminderDue, buildTrialReminderEmail, buildSubscribeUrl, formatEndsOn,
  reminderSkipReason, planTrialReminders, buildJackSummary, isInternalEmail,
  JACK_USER_ID, MAX_SENDS_PER_RUN,
} from "../api/_lib/trial-reminders.js";

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (err) { console.error(`FAIL: ${name}`); throw err; }
}

const HOUR = 3600 * 1000, DAY = 24 * HOUR;
const NOW = Date.parse("2026-11-09T14:30:00Z");
const at = (ms) => new Date(NOW + ms).toISOString();
const due = (ms, sent = []) => reminderDue({ trialExpiresAt: at(ms), now: NOW, sent });

// ── reminderDue ──
test("7d: due with 6 to 7 days left", () => {
  assert.equal(due(7 * DAY), "7d");
  assert.equal(due(6.5 * DAY), "7d");
  assert.equal(due(6 * DAY), "7d");
});
test("7d: not due just outside the window", () => {
  assert.equal(due(7 * DAY + 1), null);
  assert.equal(due(6 * DAY - 1), null);
  assert.equal(due(3 * DAY), null);
  assert.equal(due(36 * HOUR), null);
});
test("1d: due with under 36 hours left", () => {
  assert.equal(due(36 * HOUR - 1), "1d");
  assert.equal(due(20 * HOUR), "1d");
  assert.equal(due(1), "1d");
});
test("ended: due on the first run after expiry, within 3 days", () => {
  assert.equal(due(0), "ended");
  assert.equal(due(-1 * HOUR), "ended");
  assert.equal(due(-3 * DAY), "ended");
  assert.equal(due(-3 * DAY - 1), null);
  assert.equal(due(-30 * DAY), null);
});
test("each kind is sent at most once", () => {
  assert.equal(due(6.5 * DAY, ["7d"]), null);
  assert.equal(due(20 * HOUR, ["7d", "1d"]), null);
  assert.equal(due(20 * HOUR, ["7d"]), "1d");
  assert.equal(due(-HOUR, ["ended"]), null);
  assert.equal(due(-HOUR, ["7d", "1d"]), "ended");
});
test("bad or missing dates are never due", () => {
  assert.equal(reminderDue({ trialExpiresAt: null, now: NOW }), null);
  assert.equal(reminderDue({ trialExpiresAt: "soon", now: NOW }), null);
  assert.equal(reminderDue(), null);
});
test("now can be a Date", () => {
  assert.equal(reminderDue({ trialExpiresAt: at(20 * HOUR), now: new Date(NOW) }), "1d");
});

// ── links and dates ──
test("subscribe link goes to the dashboard subscribe box with UTM tags", () => {
  const u = new URL(buildSubscribeUrl("biz-1", "7d"));
  assert.equal(u.origin + u.pathname, "https://enoma.io/dashboard");
  assert.equal(u.hash, "#upgrade-banner");
  assert.equal(u.searchParams.get("business_id"), "biz-1");
  assert.equal(u.searchParams.get("utm_source"), "enoma");
  assert.equal(u.searchParams.get("utm_medium"), "email");
  assert.equal(u.searchParams.get("utm_campaign"), "trial_reminder");
  assert.equal(u.searchParams.get("utm_content"), "7d");
});
test("ends-on date reads like 'Nov 16' in Eastern time", () => {
  assert.equal(formatEndsOn("2026-11-16T15:00:00Z"), "Nov 16");
  // 2am UTC on Dec 1 is still Nov 30 in Boston.
  assert.equal(formatEndsOn("2026-12-01T02:00:00Z"), "Nov 30");
  assert.equal(formatEndsOn("nope"), null);
});

// ── emails ──
const base = {
  businessName: "Smith Landscaping", ownerFirstName: "Dana", pageUrl: "https://enoma.io/smith-landscaping",
  endsOn: "Nov 16", monthlyPrice: "$19.99", yearlyPrice: "$199",
  subscribeUrl: "https://enoma.io/dashboard?business_id=b1&utm_content=7d#upgrade-banner",
  unsubscribeUrl: "https://enoma.io/api/ga-metrics?action=unsubscribe&email=dana%40x.com&token=t",
};
const email = (o) => buildTrialReminderEmail({ ...base, ...o });
const TURNS_OFF = /turns? off|paused|goes offline|go offline/i;

test("7d (turns off): subject, what they get, price, one button, reply line", () => {
  const e = email({ kind: "7d", turnsOff: true });
  assert.equal(e.subject, "Your free month on Enoma ends Nov 16");
  assert.match(e.text, /^Hi Dana,/);
  assert.match(e.text, /https:\/\/enoma\.io\/smith-landscaping/);
  assert.match(e.text, /call button and a quote form/);
  assert.match(e.text, /\$19\.99\/month, or \$199\/year with me as your account manager — text or email me any change and it's on your page within two business days\./);
  assert.match(e.text, /your page turns off/);
  assert.match(e.text, /Keep my page live: https:\/\/enoma\.io\/dashboard/);
  assert.match(e.text, /Questions\? Just reply\./);
  assert.match(e.text, /Jack\nEnoma/);
  assert.equal((e.html.match(/<a href=/g) || []).length, 2); // the button + unsubscribe
  assert.match(e.html, />Keep my page live</);
  assert.match(e.html, /utm_content=7d#upgrade-banner/);
});
test("7d (grandfathered): never says the page turns off; invites updates and support", () => {
  const e = email({ kind: "7d", turnsOff: false });
  assert.equal(e.subject, "Your free month on Enoma ends Nov 16");
  assert.doesNotMatch(e.subject + e.text + e.html, TURNS_OFF);
  assert.doesNotMatch(e.text + e.html, /Keep my page live/);
  assert.match(e.text, /free month for Smith Landscaping on Enoma ends Nov 16/);
  assert.match(e.text, /Subscribe to keep getting updates and support/);
  assert.match(e.text, /\$19\.99\/month, or \$199\/year/);
  assert.match(e.html, />Subscribe</);
});
test("7d without a yearly price (partner price) shows the monthly price only", () => {
  const e = email({ kind: "7d", turnsOff: true, monthlyPrice: "$9.99", yearlyPrice: null });
  assert.match(e.text, /It's \$9\.99\/month with me as your account manager/);
  assert.doesNotMatch(e.text, /\/year/);
});
test("1d (turns off): subject and one line, same button", () => {
  const e = email({ kind: "1d", turnsOff: true });
  assert.equal(e.subject, "Your page turns off tomorrow");
  assert.match(e.text, /ends tomorrow, and your page turns off unless you subscribe/);
  assert.match(e.html, />Keep my page live</);
  assert.doesNotMatch(e.text, /\/month/);
});
test("1d (grandfathered): free month ends, nothing about turning off", () => {
  const e = email({ kind: "1d", turnsOff: false });
  assert.equal(e.subject, "Your free month ends tomorrow");
  assert.doesNotMatch(e.subject + e.text + e.html, TURNS_OFF);
  assert.match(e.text, /Subscribe to keep getting updates and support/);
});
test("ended: only when the page turns off", () => {
  const e = email({ kind: "ended", turnsOff: true });
  assert.equal(e.subject, "Your page is paused");
  assert.match(e.text, /Your page is paused\. Subscribe and it's back on right away\./);
  assert.match(e.html, />Turn my page back on</);
  assert.equal(email({ kind: "ended", turnsOff: false }), null);
});
test("unknown kind sends nothing", () => {
  assert.equal(email({ kind: "3d", turnsOff: true }), null);
});
test("no first name falls back to 'Hi,'", () => {
  assert.match(email({ kind: "1d", turnsOff: true, ownerFirstName: null }).text, /^Hi,\n/);
});
test("business names are escaped in HTML", () => {
  const e = email({ kind: "1d", turnsOff: true, businessName: "A&B <Lawn>" });
  assert.match(e.html, /A&amp;B &lt;Lawn&gt;/);
  assert.doesNotMatch(e.html, /<Lawn>/);
});
test("unsubscribe link is in both parts", () => {
  const e = email({ kind: "7d", turnsOff: true });
  assert.match(e.text, /Unsubscribe: https:\/\/enoma\.io\/api\/ga-metrics\?action=unsubscribe/);
  assert.match(e.html, />Unsubscribe<\/a>/);
});

// ── who gets one ──
const OWNER = "11111111-1111-1111-1111-111111111111";
const cand = (o = {}) => ({
  businessId: "b1", slug: "smith-landscaping", businessName: "Smith Landscaping",
  isInternal: false, isClaimed: true, ownerUserIds: [OWNER], ownerEmail: "dana@smithlandscaping.com",
  profileEmail: "dana@smithlandscaping.com", createdAt: "2026-11-01T00:00:00Z",
  sub: { is_trial: true, status: "trialing", provider: "stripe", stripe_subscription_id: null, trial_expires_at: at(6.5 * DAY) },
  suppressed: false, sent: [], ...o,
});

test("a claimed, unpaid, real owner is eligible", () => {
  assert.equal(reminderSkipReason(cand()), null);
});
test("unclaimed prospect previews never get one", () => {
  assert.equal(reminderSkipReason(cand({ isClaimed: false, ownerUserIds: [], ownerEmail: null, profileEmail: null })), "unclaimed");
});
test("pages owned only by Jack's account (the Aug 3 landscaping pages) never get one", () => {
  // Unclaimed and Jack-owned: caught as unclaimed.
  assert.equal(reminderSkipReason(cand({ isClaimed: false, ownerUserIds: [JACK_USER_ID], ownerEmail: null })), "unclaimed");
  // Even if one were marked claimed, a Jack-only owner list is skipped.
  assert.equal(reminderSkipReason(cand({ ownerUserIds: [JACK_USER_ID], ownerEmail: "someone@example.com", profileEmail: null })), "jack_owned");
});
test("internal pages, slugs and emails are skipped", () => {
  assert.equal(reminderSkipReason(cand({ isInternal: true })), "internal");
  for (const slug of ["enoma-io", "assayquant-technologies-inc", "qc-test-plumbing", "cars"]) {
    assert.equal(reminderSkipReason(cand({ slug })), "internal", slug);
  }
  assert.equal(reminderSkipReason(cand({ ownerEmail: "jack@enoma.io" })), "internal");
  assert.equal(reminderSkipReason(cand({ ownerEmail: "Enoma.Test.v1@gmail.com" })), "internal");
  assert.equal(reminderSkipReason(cand({ profileEmail: "jclark22@une.edu" })), "internal");
  assert.equal(isInternalEmail("dana@smithlandscaping.com"), false);
  assert.equal(isInternalEmail(null), false);
});
test("no owner or no owner email is skipped", () => {
  assert.equal(reminderSkipReason(cand({ ownerUserIds: [] })), "no_owner");
  assert.equal(reminderSkipReason(cand({ ownerEmail: null })), "no_owner_email");
});
test("already paying (active, or subscribed in the free month with a card) is skipped", () => {
  assert.equal(reminderSkipReason(cand({ sub: { ...cand().sub, status: "active" } })), "already_paying");
  assert.equal(reminderSkipReason(cand({ sub: { ...cand().sub, status: "trialing", stripe_subscription_id: "sub_123" } })), "already_paying");
});
test("comped, not on a free month, and suppressed are skipped", () => {
  assert.equal(reminderSkipReason(cand({ sub: { ...cand().sub, provider: "comped" } })), "comped");
  assert.equal(reminderSkipReason(cand({ sub: { ...cand().sub, is_trial: false } })), "not_on_free_month");
  assert.equal(reminderSkipReason(cand({ suppressed: true })), "suppressed");
  assert.equal(reminderSkipReason(null), "missing");
});

// ── planning a run ──
const TRIAL_ON = { PRICING_TRIAL_STARTS_AT: "2026-10-14T04:00:00Z" };

test("a run with an unclaimed row and a Jack-owned row sends only to the real owner", () => {
  const rows = [
    cand({ businessId: "real", slug: "real" }),
    cand({ businessId: "u", slug: "prospect-preview", isClaimed: false, ownerUserIds: [], ownerEmail: null, profileEmail: null }),
    cand({ businessId: "j", slug: "landscaper-aug3", isClaimed: false, ownerUserIds: [JACK_USER_ID], ownerEmail: null,
      sub: { ...cand().sub, trial_expires_at: "2026-12-01T05:00:00Z" } }),
  ];
  const { due: d, skipped } = planTrialReminders(rows, { now: NOW, env: TRIAL_ON });
  assert.deepEqual(d.map((x) => x.slug), ["real"]);
  assert.equal(d[0].kind, "7d");
  assert.equal(d[0].turnsOff, true);
  assert.deepEqual(skipped.map((s) => s.reason).sort(), ["unclaimed", "unclaimed"]);
  // And on the days the Aug 3 pages would be due, still nothing for them.
  for (const t of [Date.parse("2026-11-24T14:30:00Z"), Date.parse("2026-11-30T14:30:00Z"), Date.parse("2026-12-02T14:30:00Z")]) {
    assert.deepEqual(planTrialReminders([rows[2]], { now: t, env: TRIAL_ON }).due, []);
  }
});
test("without PRICING_TRIAL_STARTS_AT every page is grandfathered (never turns off)", () => {
  const { due: d } = planTrialReminders([cand()], { now: NOW, env: {} });
  assert.equal(d[0].turnsOff, false);
});
test("pages created before PRICING_TRIAL_STARTS_AT are grandfathered", () => {
  const { due: d } = planTrialReminders([cand({ createdAt: "2026-09-01T00:00:00Z" })], { now: NOW, env: TRIAL_ON });
  assert.equal(d[0].turnsOff, false);
});
test("grandfathered pages get no 'ended' reminder; pages that turn off do", () => {
  const ended = { sub: { ...cand().sub, trial_expires_at: at(-HOUR) } };
  const g = planTrialReminders([cand({ ...ended, createdAt: "2026-09-01T00:00:00Z" })], { now: NOW, env: TRIAL_ON });
  assert.deepEqual(g.due, []);
  assert.equal(g.skipped[0].reason, "grandfathered_no_ended");
  const t = planTrialReminders([cand(ended)], { now: NOW, env: TRIAL_ON });
  assert.equal(t.due[0].kind, "ended");
});
test("already-sent kinds and out-of-window rows are skipped as nothing due", () => {
  const r = planTrialReminders([cand({ sent: ["7d"] }), cand({ sub: { ...cand().sub, trial_expires_at: at(3 * DAY) } })], { now: NOW, env: TRIAL_ON });
  assert.deepEqual(r.due, []);
  assert.deepEqual(r.skipped.map((s) => s.reason), ["nothing_due", "nothing_due"]);
});
test("at most 30 per run; the rest wait", () => {
  assert.equal(MAX_SENDS_PER_RUN, 30);
  const rows = Array.from({ length: 35 }, (_, i) => cand({ businessId: `b${i}`, slug: `s${i}` }));
  const r = planTrialReminders(rows, { now: NOW, env: TRIAL_ON });
  assert.equal(r.due.length, 30);
  assert.equal(r.skipped.filter((s) => s.reason === "cap").length, 5);
});

// ── Jack's summary ──
test("Jack's summary is one line, and only when something went out", () => {
  assert.equal(buildJackSummary([]), null);
  assert.equal(buildJackSummary(null), null);
  const s = buildJackSummary([{ businessName: "Smith Landscaping", kind: "7d" }, { businessName: "Ace Plumbing", kind: "1d" }]);
  assert.equal(s.text, "Trial reminders sent: Smith Landscaping (7d), Ace Plumbing (1d)");
  assert.doesNotMatch(s.text, /\n/);
});

// ── wiring ──
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

test("daily cron at 14:30 UTC", () => {
  const { crons } = JSON.parse(read("vercel.json"));
  const c = crons.filter((x) => x.path === "/api/ga-metrics?action=trial_reminders");
  assert.equal(c.length, 1);
  assert.equal(c[0].schedule, "30 14 * * *");
});
test("the action is behind the cron/admin check", () => {
  const src = read("api/ga-metrics.js");
  const guard = src.indexOf("if (secret !== process.env.ADMIN_SECRET && !isValidCron)");
  const action = src.indexOf('req.query.action === "trial_reminders"');
  assert.ok(guard > 0 && action > guard);
});
test("sends from Jack with reply-to, a List-Unsubscribe header, and claims the row before sending", () => {
  const src = read("api/ga-metrics.js");
  const body = src.slice(src.indexOf("async function handleTrialReminders"), src.indexOf("async function handleGeneratePreview"));
  assert.match(body, /from: "Jack at Enoma <jack@enoma\.io>", to: c\.ownerEmail, replyTo: "jack@enoma\.io"/);
  assert.match(body, /"List-Unsubscribe": `<\$\{buildUnsubscribeUrl\(c\.ownerEmail\)\}>`/);
  assert.ok(body.indexOf('.from("trial_reminders")\n      .insert') < body.indexOf("resend.emails.send"));
  assert.match(body, /from: "Enoma <noreply@enoma\.io>", to: "jack@enoma\.io"/);
});
test("migration: unique (business_id, kind), kinds checked, RLS on with no policies", () => {
  const sql = read("supabase/migrations/20261110_trial_reminders.sql");
  assert.match(sql, /unique \(business_id, kind\)/);
  assert.match(sql, /check \(kind in \('7d', '1d', 'ended'\)\)/);
  assert.match(sql, /enable row level security/);
  assert.doesNotMatch(sql, /create policy/i);
});
test("a signed-out owner keeps the business and subscribe box through sign-in", () => {
  const html = read("public/dashboard/index.html");
  assert.match(html, /'\/login\?next=' \+ encodeURIComponent\(back\)/);
  assert.match(html, /id="upgrade-banner"/);
});

console.log(`trial-reminders: ${passed} passed`);
