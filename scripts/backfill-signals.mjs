// scripts/backfill-signals.mjs
// What the signal ledger would have done over the last N days (default 14):
// the signals it would have recorded, by type, and the follow-up emails it
// would have sent, with the guardrails applied (internal, scanners,
// suppression, replies, claims, customers, 3-ever / 1-per-24h, 8am-7pm local).
//
//   node scripts/backfill-signals.mjs                 # dry run: prints, writes nothing
//   node scripts/backfill-signals.mjs --days 14
//   node scripts/backfill-signals.mjs --rows rows.json  # plan from an exported row dump
//   node scripts/backfill-signals.mjs --apply         # writes the signals (FOLLOWUPS_MODE
//                                                     # forced to dry_run, no alerts)
//
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (env or .env), except --rows.
// Not covered: Stripe events (not stored locally; expired checkouts show up
// through the checkout_started scan) and Facebook messages (no source yet).

import { pathToFileURL } from "node:url";
import fs from "node:fs";
import { plannedSteps, ruleFor, GUARDRAILS } from "../api/_lib/followup-rules.js";
import { isHumanSignal, isInternalPerson, dedupeKey, normEmail, canSend, nextSendTime, timeZoneForState, isScannerClick } from "../api/_lib/signals.js";
import { slugFromPreviewUrl } from "../api/_lib/outreach-email.js";
import { JACK_USER_ID } from "../api/_lib/trial-reminders.js";

const HOUR = 36e5, DAY = 864e5;
const etDay = (ms) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/New_York" });

/** Everything the planner reads, for the window. */
export async function loadRows(supabase, { days = 14, now = Date.now() } = {}) {
  const since = new Date(now - days * DAY).toISOString();
  const all = async (q) => { const { data, error } = await q; if (error) throw new Error(error.message); return data || []; };
  const [outreach_messages, page_events, funnel_events, outreach_replies, suppression_list, visit_followups] = await Promise.all([
    all(supabase.from("outreach_messages").select("id, prospect_id, sent_at, delivered_at, first_clicked_at, click_count, followup_sent_at, followup2_sent_at, response_status, response_at, draft_subject").eq("channel", "email").not("sent_at", "is", null)),
    all(supabase.from("page_events").select("id, slug, event, created_at, traffic_class, is_internal, metadata").gte("created_at", since).in("event", ["page_view", "landing_view", "outreach_page_click", "outreach_claim_click"]).eq("traffic_class", "human")),
    all(supabase.from("funnel_events").select("id, event, anon_id, business_id, created_at, traffic_class, metadata").gte("created_at", since)),
    all(supabase.from("outreach_replies").select("id, resend_inbound_id, prospect_id, from_email, intent, received_at, subject")),
    all(supabase.from("suppression_list").select("email, reason, created_at")),
    all(supabase.from("visit_followups").select("prospect_id, status, scheduled_for"))
  ]);
  const prospects = await all(supabase.from("prospects").select("id, business_name, email, status, state, city, phone, preview_url, preview_business_id"));
  const businesses = await all(supabase.from("businesses").select("id, slug, name, is_internal"));
  const profiles = await all(supabase.from("small_business_profiles").select("business_id, username, business_name, email, is_claimed, state"));
  const subscriptions = await all(supabase.from("subscriptions").select("business_id, status, stripe_subscription_id"));
  const members = await all(supabase.from("business_members").select("business_id, user_id, role").eq("role", "owner"));
  return { now, days, outreach_messages, page_events, funnel_events, outreach_replies, suppression_list, visit_followups, prospects, businesses, profiles, subscriptions, members };
}

/** Pure: the signals and would-send list for a row dump. */
export function planBackfill(rows, { now = rows.now || Date.now(), days = rows.days || 14 } = {}) {
  const since = now - days * DAY;
  const byId = (list, k = "id") => new Map((list || []).map(r => [r[k], r]));
  const prospects = byId(rows.prospects);
  const businesses = byId(rows.businesses);
  const profiles = byId(rows.profiles, "business_id");
  const profileBySlug = new Map((rows.profiles || []).map(p => [p.username, p]));
  const prospectBySlug = new Map();
  for (const p of rows.prospects || []) { const s = slugFromPreviewUrl(p.preview_url); if (s) prospectBySlug.set(s, p); }
  const owners = new Map();
  for (const m of rows.members || []) if (m.user_id !== JACK_USER_ID) owners.set(m.business_id, true);
  const suppressed = new Set((rows.suppression_list || []).map(s => normEmail(s.email)).filter(Boolean));
  const internalFor = (p) => {
    const biz = p?.preview_business_id ? businesses.get(p.preview_business_id) : null;
    return { isInternal: biz?.is_internal === true, slug: biz?.slug || slugFromPreviewUrl(p?.preview_url) };
  };

  const signals = new Map();
  const add = (type, s) => {
    if (!isHumanSignal({ ...(s.person || {}), email: s.email, trafficClass: s.trafficClass })) return;
    const key = dedupeKey(type, { ...s.keyParts, at: s.at, email: s.email });
    if (signals.has(key)) return;
    signals.set(key, { type, key, at: s.at, email: normEmail(s.email), prospectId: s.prospectId || null, businessId: s.businessId || null, label: s.label });
  };

  // email_click: human clicks recorded on the cold email (first one per email).
  for (const m of rows.outreach_messages || []) {
    if (!m.first_clicked_at || !(m.click_count > 0)) continue;
    const at = Date.parse(m.first_clicked_at);
    if (at < since) continue;
    if (isScannerClick({ clickedAt: m.first_clicked_at, deliveredAt: m.delivered_at, sentAt: m.sent_at })) continue;
    const p = prospects.get(m.prospect_id);
    if (!p) continue;
    add("email_click", { at, email: p.email, prospectId: p.id, businessId: p.preview_business_id, person: internalFor(p), trafficClass: "human", keyParts: { messageId: m.id }, label: p.business_name });
  }

  // preview_visit / repeat_visit: human views of an unclaimed prospect page.
  const visits = [...(rows.page_events || [])].filter(e => e.traffic_class === "human").sort((a, b) => a.created_at.localeCompare(b.created_at));
  const seenDays = new Map();
  for (const e of visits) {
    const p = prospectBySlug.get(e.slug);
    if (!p) continue;
    const prof = profileBySlug.get(e.slug);
    if (prof?.is_claimed === true || p.status === "claimed") continue;
    const at = Date.parse(e.created_at);
    const days = seenDays.get(p.id) || new Set();
    const earlierDay = [...days].some(d => d !== etDay(at));
    days.add(etDay(at)); seenDays.set(p.id, days);
    if (at < since) continue;
    const base = { at, email: p.email, prospectId: p.id, businessId: p.preview_business_id, person: internalFor(p), trafficClass: "human", label: p.business_name };
    add("preview_visit", { ...base, keyParts: { prospectId: p.id } });
    if (earlierDay) add("repeat_visit", { ...base, keyParts: { prospectId: p.id } });
  }

  // Funnel: started with no email, and the absence signals.
  const fe = [...(rows.funnel_events || [])].sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const e of fe) {
    if (e.traffic_class !== "human") continue;
    if ((e.event === "gyw_submitted" || e.event === "preview_shown") && e.anon_id && Date.parse(e.created_at) >= since) {
      add("preview_started_no_email", { at: Date.parse(e.created_at), trafficClass: "human", keyParts: { anonId: e.anon_id }, label: `anon ${String(e.anon_id).slice(0, 8)}` });
    }
  }
  const byBiz = new Map();
  for (const e of fe) if (e.business_id) { if (!byBiz.has(e.business_id)) byBiz.set(e.business_id, []); byBiz.get(e.business_id).push(e); }
  for (const [bid, evs] of byBiz) {
    const human = evs.filter(e => e.traffic_class === "human");
    const biz = businesses.get(bid); const prof = profiles.get(bid);
    const person = { isInternal: biz?.is_internal === true, slug: biz?.slug || prof?.username };
    if (!human.length || isInternalPerson(person)) continue;
    const completed = evs.find(e => e.event === "checkout_completed" || e.event === "subscription_activated");
    const gen = human.find(e => e.event === "generation_succeeded");
    const claim = human.find(e => e.event === "business_claimed");
    const checkout = human.filter(e => e.event === "checkout_started").pop();
    const label = prof?.business_name || biz?.name;
    if (gen && !claim && !owners.get(bid) && prof?.email && prof?.is_claimed !== true && now - Date.parse(gen.created_at) >= 2 * HOUR) {
      add("preview_no_claim", { at: Date.parse(gen.created_at), email: prof.email, businessId: bid, person, keyParts: { businessId: bid }, label });
    }
    const claimedAt = claim ? Date.parse(claim.created_at) : (gen && owners.get(bid) ? Date.parse(gen.created_at) : null);
    if (claimedAt && !checkout && !completed && now - claimedAt >= DAY) {
      add("claim_no_checkout", { at: claimedAt, email: prof?.email, businessId: bid, person, keyParts: { businessId: bid }, label: `${label} (owner email looked up at run time)` });
    }
    if (checkout && !(completed && completed.created_at >= checkout.created_at) && now - Date.parse(checkout.created_at) >= HOUR) {
      add("checkout_abandoned", { at: Date.parse(checkout.created_at), email: prof?.email, businessId: bid, person, keyParts: { businessId: bid }, label });
    }
  }

  // Replies and the terminal events.
  for (const r of rows.outreach_replies || []) {
    const at = Date.parse(r.received_at);
    if (!(at >= since) || r.intent === "auto_reply") continue;
    const p = prospects.get(r.prospect_id);
    add(r.intent === "opt_out" ? "unsubscribe" : "email_reply", { at, email: r.from_email, prospectId: r.prospect_id, person: internalFor(p), keyParts: { inboundId: r.resend_inbound_id || r.id, email: r.from_email }, label: p?.business_name || r.from_email });
  }
  for (const s of rows.suppression_list || []) {
    const at = Date.parse(s.created_at);
    if (!(at >= since) || !s.email) continue;
    add(s.reason === "bounced" ? "bounce" : "unsubscribe", { at, email: s.email, keyParts: { email: s.email }, label: s.email });
  }

  // Would-send: walk the planned steps in time order through canSend.
  const list = [...signals.values()].sort((a, b) => a.at - b.at);
  const sentBy = new Map(); // recipient -> [ms]
  const priorCount = (email) => {
    let n = 0; let last = null;
    const pids = (rows.prospects || []).filter(p => normEmail(p.email) === email).map(p => p.id);
    for (const m of rows.outreach_messages || []) {
      if (!pids.includes(m.prospect_id)) continue;
      for (const [t, counts] of [[m.sent_at, false], [m.followup_sent_at, true], [m.followup2_sent_at, true]]) {
        if (!t) continue; if (counts) n++; if (!last || t > last) last = t;
      }
    }
    const visited = (rows.visit_followups || []).some(v => pids.includes(v.prospect_id) && ["sending", "sent", "skipped"].includes(v.status));
    return { n: n + (visited ? 1 : 0), last, visited };
  };
  const answered = (email, prospectId, at) => {
    const replied = list.some(s => s.at > at && (s.type === "email_reply" || s.type === "unsubscribe" || s.type === "bounce") && (s.email === email || (prospectId && s.prospectId === prospectId)));
    return replied;
  };
  const wouldSend = []; const cancelled = [];
  for (const s of list) {
    const rule = ruleFor(s.type);
    if (!rule?.steps || !s.email) continue;
    const p = s.prospectId ? prospects.get(s.prospectId) : null;
    const prof = s.businessId ? profiles.get(s.businessId) : null;
    const tz = timeZoneForState(p?.state || prof?.state);
    for (const step of plannedSteps(s.type, s.at)) {
      let when = nextSendTime(Date.parse(step.scheduled_for), tz).getTime();
      if (when > now) { cancelled.push({ ...s, template: step.template, reason: "not_due_yet" }); continue; }
      const prior = priorCount(s.email);
      const ours = sentBy.get(s.email) || [];
      const last = [prior.last, ...ours.map(t => new Date(t).toISOString())].filter(Boolean).sort().pop() || null;
      if (last && when - Date.parse(last) < GUARDRAILS.minGapMs) when = nextSendTime(Date.parse(last) + GUARDRAILS.minGapMs, tz).getTime();
      const sub = s.businessId ? (rows.subscriptions || []).find(x => x.business_id === s.businessId) : null;
      const verdict = canSend({
        recipient: s.email, signalType: s.type, timeZone: tz, now: when,
        suppressed: suppressed.has(s.email), replied: answered(s.email, s.prospectId, s.at),
        claimed: p?.status === "claimed" || prof?.is_claimed === true,
        isCustomer: !!sub?.stripe_subscription_id && ["active", "trialing", "past_due"].includes(sub?.status),
        visitFollowupSent: prior.visited || ours.visit === true,
        automatedSentEver: prior.n + ours.length
      });
      if (!verdict.ok) { cancelled.push({ ...s, template: step.template, reason: verdict.reason }); continue; }
      ours.push(when); if (step.template === "visit_followup") ours.visit = true; sentBy.set(s.email, ours);
      wouldSend.push({ ...s, template: step.template, sendAt: new Date(when).toISOString() });
    }
  }
  const counts = {};
  for (const s of list) counts[s.type] = (counts[s.type] || 0) + 1;
  return { signals: list, counts, wouldSend, cancelled, queuedForJack: list.filter(s => ruleFor(s.type)?.queueForJack) };
}

export function printPlan(plan, log = console) {
  log.log(`Signals by type (${plan.signals.length}):`);
  for (const [t, n] of Object.entries(plan.counts).sort()) log.log(`  ${t.padEnd(26)} ${n}`);
  log.log(`\nWould send (${plan.wouldSend.length}):`);
  for (const w of plan.wouldSend) log.log(`  ${w.sendAt}  ${w.template.padEnd(20)} ${w.label || ""}  <${w.email}>`);
  log.log(`\nWould queue for Jack (${plan.queuedForJack.length}):`);
  for (const q of plan.queuedForJack) log.log(`  ${new Date(q.at).toISOString()}  ${q.type.padEnd(14)} ${q.label || ""}`);
  log.log(`\nStopped by a guardrail (${plan.cancelled.length}):`);
  for (const c of plan.cancelled) log.log(`  ${c.template.padEnd(20)} ${c.reason.padEnd(26)} ${c.label || ""}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
  const days = parseInt(arg("--days"), 10) || 14;
  const apply = process.argv.includes("--apply");
  let rows;
  let supabase = null;
  if (arg("--rows")) {
    rows = JSON.parse(fs.readFileSync(arg("--rows"), "utf8"));
  } else {
    await import("dotenv/config");
    const { createClient } = await import("@supabase/supabase-js");
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or pass --rows <dump.json>.");
      process.exit(1);
    }
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    rows = await loadRows(supabase, { days });
  }
  const plan = planBackfill(rows, { days, now: rows.now ? Date.parse(rows.now) || rows.now : Date.now() });
  printPlan(plan);
  if (!apply) {
    console.log("\nDry run: nothing written. Add --apply to record these signals (as dry_run, no alerts).");
  } else {
    if (!supabase) { console.error("--apply needs a database, not --rows."); process.exit(1); }
    const { recordSignal } = await import("../api/_lib/signal-store.js");
    const deps = { supabase, resend: null, env: { ...process.env, FOLLOWUPS_MODE: "dry_run" } };
    let n = 0;
    for (const s of plan.signals) {
      const r = await recordSignal(deps, {
        type: s.type, source: s.type === "email_reply" || s.type === "unsubscribe" || s.type === "bounce" || s.type === "email_click" ? "resend" : "track",
        prospectId: s.prospectId, businessId: s.businessId, email: s.email, at: s.at, trafficClass: "human",
        keyParts: { messageId: s.key.split(":")[1], prospectId: s.prospectId, businessId: s.businessId, anonId: s.key.split(":")[1], inboundId: s.key.split(":")[1], email: s.email },
        payload: { backfill: true, business_name: s.label || null }, skipAlert: true
      });
      if (r.recorded) n++;
    }
    console.log(`\nRecorded ${n} signals (FOLLOWUPS_MODE forced to dry_run for these rows; nothing sent).`);
  }
}
