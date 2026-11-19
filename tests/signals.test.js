// Run with: node tests/signals.test.js (also wired into `npm test`)
// The signal ledger: rule selection, quiet hours, per-person cap, cancel on
// reply / claim / unsubscribe, scanner and internal traffic ignored, dedupe,
// and dry_run sending nothing. The queue runs against an in-memory store.

import assert from "node:assert/strict";
import { fakeSupabase, fakeResend } from "./_fake-supabase.js";

process.env.UNSUBSCRIBE_SECRET = process.env.UNSUBSCRIBE_SECRET || "test-secret";
const { FOLLOWUP_RULES, ruleFor, plannedSteps, GUARDRAILS } = await import("../api/_lib/followup-rules.js");
const S = await import("../api/_lib/signals.js");
const store = await import("../api/_lib/signal-store.js");

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { console.error(`  FAIL - ${name}`); console.error(err); process.exitCode = 1; }
}

// Monday 2026-11-16, 11:00 ET (16:00 UTC): inside everyone's send window.
const T0 = Date.parse("2026-11-16T16:00:00Z");
const MIN = 60e3, HOUR = 36e5, DAY = 864e5;
const PROSPECT = "11111111-1111-4111-8111-111111111111";
const BIZ = "22222222-2222-4222-8222-222222222222";
const MSG = "33333333-3333-4333-8333-333333333333";
const OWNER = "owner@acme-plumbing.com";

function world({ mode = "dry_run", seed = {}, ntfy } = {}) {
  let clock = T0;
  const supabase = fakeSupabase({
    prospects: [{ id: PROSPECT, business_name: "Acme Plumbing LLC", email: OWNER, status: "sent", state: "MA", city: "Attleboro", trade: "plumbing", phone: "508-555-0101", preview_url: "https://enoma.io/acme-plumbing", preview_business_id: BIZ }],
    businesses: [{ id: BIZ, slug: "acme-plumbing", is_internal: false, name: "Acme Plumbing" }],
    small_business_profiles: [{ business_id: BIZ, username: "acme-plumbing", business_name: "Acme Plumbing LLC", is_claimed: false, state: "MA" }],
    outreach_messages: [{ id: MSG, prospect_id: PROSPECT, channel: "email", sent_at: new Date(T0 - 5 * DAY).toISOString(), draft_subject: "I built Acme Plumbing a new page" }],
    ...seed
  }, { now: () => clock });
  const resend = fakeResend();
  const pushes = [];
  const deps = {
    supabase, resend, env: { FOLLOWUPS_MODE: mode, ...(ntfy ? { NTFY_TOPIC: ntfy } : {}) },
    now: () => clock, log: { log() {}, warn() {} },
    fetch: async (url, init) => { pushes.push({ url, init }); return { ok: true }; }
  };
  return { deps, supabase, resend, pushes, tick: (ms) => { clock += ms; }, at: (ms) => { clock = ms; } };
}

const click = (extra = {}) => ({
  type: "email_click", source: "resend", prospectId: PROSPECT, businessId: BIZ, outreachMessageId: MSG,
  email: OWNER, trafficClass: "human", at: T0, person: { slug: "acme-plumbing" }, keyParts: { messageId: MSG },
  alertInfo: { businessName: "Acme Plumbing LLC", phone: "508-555-0101", previewUrl: "https://enoma.io/acme-plumbing" }, ...extra
});

console.log("rule selection");
await test("every signal type has a rule, and the starter rules are what was asked", () => {
  for (const t of ["email_click", "preview_visit", "repeat_visit", "preview_started_no_email", "preview_no_claim", "claim_no_checkout", "checkout_abandoned", "email_reply", "unsubscribe", "bounce", "complaint", "fb_message", "fb_comment", "payment_failed", "subscription_canceled"]) {
    assert.ok(ruleFor(t), t);
  }
  assert.equal(ruleFor("nope"), null);
  assert.deepEqual(plannedSteps("email_click", T0).map(s => [s.template, Date.parse(s.scheduled_for) - T0]), [["visit_followup", 45 * MIN]]);
  assert.deepEqual(plannedSteps("preview_no_claim", T0).map(s => Date.parse(s.scheduled_for) - T0), [2 * HOUR, 2 * DAY]);
  assert.deepEqual(plannedSteps("claim_no_checkout", T0).map(s => Date.parse(s.scheduled_for) - T0), [1 * DAY, 3 * DAY]);
  assert.deepEqual(plannedSteps("checkout_abandoned", T0).map(s => Date.parse(s.scheduled_for) - T0), [1 * HOUR]);
  for (const t of ["repeat_visit", "email_reply", "fb_message", "payment_failed"]) {
    assert.equal(plannedSteps(t, T0).length, 0, t);
    assert.equal(FOLLOWUP_RULES[t].queueForJack, true, t);
    assert.equal(FOLLOWUP_RULES[t].alert, true, t);
  }
  assert.equal(FOLLOWUP_RULES.preview_started_no_email.recordOnly, true);
  assert.equal(plannedSteps("preview_started_no_email", T0).length, 0);
});

console.log("quiet hours");
await test("8am-7pm in the prospect's own time zone, else the next 8:15am", () => {
  const evening = Date.parse("2026-11-17T00:30:00Z"); // 7:30pm ET Nov 16
  const r = S.canSend({ recipient: OWNER, signalType: "email_click", timeZone: "America/New_York", now: evening });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "quiet_hours");
  assert.equal(r.retryAt, "2026-11-17T13:15:00.000Z"); // 8:15am ET Nov 17
  const early = Date.parse("2026-11-16T11:00:00Z"); // 6am ET
  assert.equal(S.canSend({ recipient: OWNER, signalType: "email_click", timeZone: "America/New_York", now: early }).retryAt, "2026-11-16T13:15:00.000Z");
  // Same instant is 4:30pm in California: fine there.
  assert.equal(S.canSend({ recipient: OWNER, signalType: "email_click", timeZone: S.timeZoneForState("CA"), now: evening }).ok, true);
  assert.equal(S.timeZoneForState("Texas"), "America/Chicago");
  assert.equal(S.timeZoneForState(""), "America/New_York");
  assert.equal(S.timeZoneForState("ZZ"), "America/New_York");
});

console.log("per-person cap");
await test("at most 3 automated emails ever, and at most 1 per 24 h", () => {
  const base = { recipient: OWNER, signalType: "preview_no_claim", timeZone: "America/New_York", now: T0 };
  assert.equal(S.canSend({ ...base, automatedSentEver: 2 }).ok, true);
  assert.deepEqual(S.canSend({ ...base, automatedSentEver: 3 }), { ok: false, status: "cancelled", reason: "lifetime_cap" });
  const gap = S.canSend({ ...base, lastAutomatedAt: new Date(T0 - 10 * HOUR).toISOString() });
  assert.equal(gap.reason, "gap_24h");
  // 24 h after the last one is 2am ET, outside the window: 8:15am ET instead.
  assert.equal(gap.retryAt, "2026-11-17T13:15:00.000Z");
});
await test("the cold sequence's follow-ups count toward the cap", async () => {
  const w = world({ seed: { outreach_messages: [{ id: MSG, prospect_id: PROSPECT, channel: "email", sent_at: new Date(T0 - 20 * DAY).toISOString(), followup_sent_at: new Date(T0 - 15 * DAY).toISOString(), followup2_sent_at: new Date(T0 - 8 * DAY).toISOString() }], visit_followups: [{ prospect_id: PROSPECT, status: "sent", scheduled_for: new Date(T0 - 3 * DAY).toISOString() }] } });
  const ctx = await store.gatherSendContext(w.deps, { type: "preview_no_claim", prospect_id: PROSPECT, business_id: BIZ, payload: {} }, OWNER);
  assert.equal(ctx.automatedSentEver, 3);
  assert.equal(S.canSend({ ...ctx, now: T0 }).reason, "lifetime_cap");
});

console.log("guardrails");
await test("suppressed, replied, claimed, customer and internal recipients are never sent to", () => {
  const base = { recipient: OWNER, signalType: "email_click", timeZone: "America/New_York", now: T0 };
  assert.equal(S.canSend({ ...base, suppressed: true }).status, "suppressed");
  assert.equal(S.canSend({ ...base, replied: true }).reason, "replied");
  assert.equal(S.canSend({ ...base, claimed: true }).reason, "claimed");
  assert.equal(S.canSend({ ...base, isCustomer: true }).reason, "customer");
  assert.equal(S.canSend({ ...base, isInternal: true }).reason, "internal");
  assert.equal(S.canSend({ ...base, visitFollowupSent: true }).reason, "visit_followup_already_sent");
  // A claim doesn't stop the post-claim rules.
  assert.equal(S.canSend({ ...base, signalType: "claim_no_checkout", claimed: true }).ok, true);
  assert.equal(S.canSend({ ...base, recipient: "not-an-email" }).reason, "no_email");
});

console.log("scanner / internal ignored");
await test("a click within 120 s of delivery is a scanner", () => {
  const d = "2026-11-16T15:00:00Z";
  assert.equal(S.isScannerClick({ clickedAt: "2026-11-16T15:01:00Z", deliveredAt: d }), true);
  assert.equal(S.isScannerClick({ clickedAt: "2026-11-16T15:03:00Z", deliveredAt: d }), false);
  assert.equal(S.isScannerClick({ clickedAt: "2026-11-16T15:00:30Z", sentAt: d }), true);
});
await test("scanner and other non-human traffic records nothing", async () => {
  const w = world();
  const r = await store.recordSignal(w.deps, click({ trafficClass: "link_scanner" }));
  assert.equal(r.recorded, false);
  assert.equal((w.supabase.tables.signals || []).length, 0);
  assert.equal((await store.recordSignal(w.deps, click({ type: "preview_visit", trafficClass: "crawler", keyParts: { prospectId: PROSPECT } }))).recorded, false);
});
await test("internal businesses, internal slugs, enoma.test and Jack's addresses record nothing", async () => {
  const w = world();
  assert.equal((await store.recordSignal(w.deps, click({ person: { isInternal: true } }))).recorded, false);
  assert.equal((await store.recordSignal(w.deps, click({ person: { slug: "qc-test-plumbing" }, keyParts: { messageId: "a" } }))).recorded, false);
  assert.equal((await store.recordSignal(w.deps, click({ email: "qa@enoma.test", keyParts: { messageId: "b" } }))).recorded, false);
  assert.equal((await store.recordSignal(w.deps, click({ email: "jack@enoma.io", keyParts: { messageId: "c" } }))).recorded, false);
  assert.equal((await store.recordSignal(w.deps, { type: "email_reply", source: "resend", email: "Jack@Enoma.io", keyParts: { inboundId: "x" } })).recorded, false);
  assert.equal(S.isInternalPerson({ email: "me@example.com" }, { SIGNAL_INTERNAL_EMAILS: "me@example.com" }), true);
  assert.equal((w.supabase.tables.signals || []).length, 0);
  assert.equal(w.resend.sent.length, 0);
});

console.log("dedupe");
await test("the same event twice is one signal, one schedule, one alert", async () => {
  const w = world();
  const a = await store.recordSignal(w.deps, click());
  const b = await store.recordSignal(w.deps, click());
  assert.equal(a.recorded, true);
  assert.equal(b.recorded, false);
  assert.equal(b.reason, "duplicate");
  assert.equal(w.supabase.tables.signals.length, 1);
  assert.equal(w.supabase.tables.followup_sends.length, 1);
  assert.equal(w.resend.sent.length, 1);
  assert.equal(S.dedupeKey("repeat_visit", { prospectId: "p", at: T0 }), "repeat_visit:p:2026-11-16");
  assert.equal(S.dedupeKey("checkout_abandoned", { businessId: "b", sessionId: "cs_1", at: T0 }), S.dedupeKey("checkout_abandoned", { businessId: "b", at: T0 + HOUR }));
});

console.log("dry_run");
await test("dry_run schedules and renders, sends nothing to the prospect", async () => {
  const w = world({ mode: "dry_run" });
  await store.recordSignal(w.deps, click());
  assert.equal(w.supabase.tables.signals[0].state, "auto_followup_scheduled");
  const alerts = w.resend.sent.length; // the HOT alert to Jack
  w.tick(46 * MIN);
  const out = await store.processDue(w.deps);
  assert.equal(out.sent, 0);
  assert.equal(out.would_send, 1);
  assert.equal(w.resend.sent.length, alerts);
  assert.ok(w.resend.sent.every(m => m.to === "jack@enoma.io"));
  const row = w.supabase.tables.followup_sends[0];
  assert.equal(row.status, "scheduled");
  assert.equal(row.decision, "would_send");
  assert.equal(row.dry_run, true);
  assert.match(row.rendered_text, /Saw you had a look at the page I made for Acme Plumbing/);
  // Judged once: the next run leaves it alone.
  assert.equal((await store.processDue(w.deps)).considered, 0);
});
await test("rows scheduled in dry_run never send after going live", async () => {
  const w = world({ mode: "dry_run" });
  await store.recordSignal(w.deps, click());
  w.deps.env.FOLLOWUPS_MODE = "live";
  w.tick(46 * MIN);
  const out = await store.processDue(w.deps);
  assert.equal(out.sent, 0);
});
await test("off records the signal only", async () => {
  const w = world({ mode: "off" });
  const r = await store.recordSignal(w.deps, click());
  assert.equal(r.recorded, true);
  assert.equal((w.supabase.tables.followup_sends || []).length, 0);
  assert.equal(w.resend.sent.length, 0);
});
await test("live sends once, from Jack, with the footer, and marks visit_followups", async () => {
  const w = world({ mode: "live" });
  await store.recordSignal(w.deps, click());
  w.tick(46 * MIN);
  const out = await store.processDue(w.deps);
  assert.equal(out.sent, 1);
  const mail = w.resend.sent.find(m => m.to === OWNER);
  assert.ok(mail);
  assert.match(mail.text, /utm_source=followup&utm_medium=email&utm_campaign=visit_followup/);
  assert.ok(mail.text.includes(S.PRICE_LINE));
  assert.match(mail.text, /action=unsubscribe/);
  assert.ok(mail.headers["List-Unsubscribe"]);
  assert.equal(w.supabase.tables.followup_sends[0].status, "sent");
  assert.equal(w.supabase.tables.visit_followups[0].status, "sent");
  assert.equal(w.supabase.tables.signals[0].state, "auto_followup_sent");
  // One visit follow-up per prospect, ever: a later preview_visit can't send another.
  await store.recordSignal(w.deps, click({ type: "preview_visit", keyParts: { prospectId: PROSPECT } }));
  w.tick(2 * DAY);
  await store.processDue(w.deps);
  assert.equal(w.resend.sent.filter(m => m.to === OWNER).length, 1);
});
await test("live in quiet hours reschedules to 8:15am local", async () => {
  const w = world({ mode: "live" });
  w.at(Date.parse("2026-11-16T23:50:00Z")); // 6:50pm ET
  await store.recordSignal(w.deps, click({ at: Date.parse("2026-11-16T23:50:00Z") }));
  w.tick(46 * MIN);
  const out = await store.processDue(w.deps);
  assert.equal(out.rescheduled, 1);
  assert.equal(w.supabase.tables.followup_sends[0].scheduled_for, "2026-11-17T13:15:00.000Z");
});

console.log("cancel on reply / claim / unsubscribe");
await test("a reply cancels scheduled follow-ups and queues the reply for Jack", async () => {
  const w = world({ mode: "live" });
  await store.recordSignal(w.deps, click());
  const r = await store.recordSignal(w.deps, { type: "email_reply", source: "resend", prospectId: PROSPECT, email: OWNER, keyParts: { inboundId: "in_1" }, alertInfo: { businessName: "Acme", replyText: "How much is it?" } });
  assert.equal(r.signal.state, "queued_for_jack");
  const click1 = w.supabase.tables.signals.find(s => s.type === "email_click");
  assert.equal(click1.state, "handled");
  assert.equal(w.supabase.tables.followup_sends[0].status, "cancelled");
  assert.equal(w.supabase.tables.followup_sends[0].cancel_reason, "replied");
  w.tick(DAY);
  assert.equal((await store.processDue(w.deps)).sent, 0);
});
await test("a claim cancels pre-claim follow-ups only", async () => {
  const w = world({ mode: "live" });
  await store.recordSignal(w.deps, click());
  await store.recordSignal(w.deps, { type: "claim_no_checkout", source: "track", businessId: BIZ, email: OWNER, keyParts: { businessId: BIZ } });
  await store.resolvePerson(w.deps, { email: OWNER, prospectIds: [PROSPECT], businessId: BIZ, reason: "claimed", scope: "pre_claim" });
  const byTemplate = Object.fromEntries(w.supabase.tables.followup_sends.map(f => [f.template, f.status]));
  assert.equal(byTemplate.visit_followup, "cancelled");
  assert.equal(byTemplate.claim_no_checkout_1, "scheduled");
});
await test("a claim noticed at send time also cancels", async () => {
  const w = world({ mode: "live" });
  await store.recordSignal(w.deps, click());
  w.supabase.tables.small_business_profiles[0].is_claimed = true;
  w.tick(46 * MIN);
  const out = await store.processDue(w.deps);
  assert.equal(out.sent, 0);
  assert.equal(w.supabase.tables.followup_sends[0].cancel_reason, "claimed");
});
await test("an unsubscribe suppresses everything scheduled and closes their signals", async () => {
  const w = world({ mode: "live" });
  await store.recordSignal(w.deps, click());
  const r = await store.recordSignal(w.deps, { type: "unsubscribe", source: "resend", email: OWNER, keyParts: { email: OWNER } });
  assert.equal(r.signal.state, "closed");
  assert.equal(w.supabase.tables.followup_sends[0].status, "suppressed");
  const c = w.supabase.tables.signals.find(s => s.type === "email_click");
  assert.equal(c.state, "closed");
  assert.equal(c.closed_reason, "unsubscribed");
});
await test("a suppression_list entry found at send time suppresses", async () => {
  const w = world({ mode: "live", seed: { suppression_list: [{ email: OWNER, reason: "bounced" }] } });
  await store.recordSignal(w.deps, click());
  w.tick(46 * MIN);
  await store.processDue(w.deps);
  assert.equal(w.supabase.tables.followup_sends[0].status, "suppressed");
});

console.log("HOT alerts");
await test("one alert per prospect per type per day, plus an ntfy push", async () => {
  const w = world({ ntfy: "enoma-test-topic" });
  await store.recordSignal(w.deps, { type: "repeat_visit", source: "track", prospectId: PROSPECT, email: OWNER, trafficClass: "human", keyParts: { prospectId: PROSPECT }, at: T0, alertInfo: { businessName: "Acme Plumbing LLC", phone: "508-555-0101", previewUrl: "https://enoma.io/acme-plumbing" } });
  await store.recordSignal(w.deps, { type: "repeat_visit", source: "track", prospectId: PROSPECT, email: OWNER, trafficClass: "human", keyParts: { prospectId: PROSPECT, x: 1 }, at: T0 + HOUR, payload: {}, alertInfo: {} });
  const alerts = w.resend.sent.filter(m => m.to === "jack@enoma.io");
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].subject, /^HOT: Acme Plumbing LLC — came back to their page$/);
  assert.match(alerts[0].html, /tel:5085550101/);
  assert.match(alerts[0].html, /mailto:owner@acme-plumbing\.com/);
  assert.equal(w.pushes.length, 1);
  assert.equal(w.pushes[0].url, "https://ntfy.sh/enoma-test-topic");
  assert.equal(w.supabase.tables.signals[0].state, "queued_for_jack");
});
await test("the next day alerts again", async () => {
  const w = world();
  const sig = { type: "fb_message", source: "manychat", email: "pat@example.com", keyParts: { externalId: "m1" }, alertInfo: {} };
  await store.recordSignal(w.deps, sig);
  w.tick(DAY);
  await store.recordSignal(w.deps, { ...sig, keyParts: { externalId: "m2" }, at: T0 + DAY });
  assert.equal(w.resend.sent.length, 2);
});

console.log("templates and copy rules");
await test("every template passes the copy rules and carries the price line and footer", () => {
  for (const t of Object.keys(S.FOLLOWUP_TEMPLATES)) {
    const e = S.renderFollowup(t, { businessName: "Acme Plumbing LLC", pageUrl: "https://enoma.io/acme-plumbing", dashboardUrl: "https://enoma.io/dashboard", originalSubject: "I built Acme Plumbing a new page" }, { unsubscribeUrl: "https://enoma.io/api/ga-metrics?action=unsubscribe&x=1", mailingAddress: "Enoma, 183 Fairway Dr, Attleboro, MA 02703" });
    assert.deepEqual(e.issues, [], t);
    assert.ok(e.text.includes("$1 for your first month, then $39/month or $390/year. Cancel anytime."), t);
    assert.match(e.text, /Don't want these emails\? https:\/\/enoma\.io\/api\/ga-metrics\?action=unsubscribe/, t);
    assert.match(e.html, /Unsubscribe/, t);
  }
});
await test("the copy rules catch free, ranking promises, banned words and Conway's", () => {
  assert.deepEqual(S.emailCopyIssues("Get it free today"), ["says free"]);
  assert.deepEqual(S.emailCopyIssues("Your free preview is ready"), []);
  assert.ok(S.emailCopyIssues("We'll get you ranking on the first page").includes("ranking promise"));
  assert.ok(S.emailCopyIssues("Like Conway's Landscaping").includes("names Conway's"));
  assert.ok(S.emailCopyIssues("A reliable page").some(i => i.startsWith("banned word")));
});

console.log("closing the loop");
await test("14 days after the last automated touch with no response closes it", () => {
  assert.deepEqual(S.sweepDecision({ state: "auto_followup_sent", createdAt: T0 - 20 * DAY, lastTouchAt: T0 - 15 * DAY, now: T0 }), { close: "no_response" });
  assert.equal(S.sweepDecision({ state: "auto_followup_sent", createdAt: T0 - 20 * DAY, lastTouchAt: T0 - 5 * DAY, now: T0 }), null);
  assert.equal(S.sweepDecision({ state: "auto_followup_scheduled", createdAt: T0 - 20 * DAY, hasScheduled: true, now: T0 }), null);
  assert.equal(S.sweepDecision({ state: "queued_for_jack", createdAt: T0 - 30 * DAY, now: T0 }), null);
});
await test("markHandled closes a signal and cancels its sends", async () => {
  const w = world();
  const r = await store.recordSignal(w.deps, click());
  assert.deepEqual(await store.markHandled(w.deps, r.signal.id), { ok: true });
  assert.equal(w.supabase.tables.signals[0].state, "handled");
  assert.equal(w.supabase.tables.followup_sends[0].status, "cancelled");
  assert.equal((await store.markHandled(w.deps, "00000000-0000-4000-8000-000000000000")).status, 404);
});
await test("FOLLOWUPS_MODE defaults to dry_run", () => {
  assert.equal(S.followupsMode({}), "dry_run");
  assert.equal(S.followupsMode({ FOLLOWUPS_MODE: "LIVE" }), "live");
  assert.equal(S.followupsMode({ FOLLOWUPS_MODE: "yes" }), "dry_run");
  assert.equal(GUARDRAILS.maxAutomatedPerPersonEver, 3);
});

console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
