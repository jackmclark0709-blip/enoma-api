// The signal ledger's database side (supabase/migrations/20261116_signals.sql).
//
//   recordSignal   write a signal once (dedupe_key), then apply its rule:
//                  schedule follow-ups, queue it for Jack, alert, or close
//   resolvePerson  a reply / claim / checkout: cancel what's scheduled for
//                  that person and mark their open signals handled
//   processDue     send (or, in dry_run, render and log) follow-ups that are
//                  due, each through canSend() with fresh facts
//   scanDerived    time-based signals nobody fires an event for
//                  (preview_no_claim, claim_no_checkout, checkout_abandoned)
//   sweep          close signals with no response 14 days after the last touch
//
// Every function takes `deps` ({ supabase, resend, stripe, env, now, log }) so
// the same code runs in api/ga-metrics.js, api/stripe-webhook.js, track.js,
// the backfill script and the tests (with an in-memory store).
// Nothing here throws into a caller's request: webhooks and page tracking
// must keep working if the ledger has a bad moment.

import { ruleFor, plannedSteps, GUARDRAILS } from "./followup-rules.js";
import {
  followupsMode, isHumanSignal, isInternalPerson, dedupeKey, normEmail, canSend, renderFollowup,
  shouldAlert, alertKey, buildHotAlert, timeZoneForState, sweepDecision
} from "./signals.js";
import { buildUnsubscribeUrl, MAILING_ADDRESS } from "./outreach-footer.js";
import { slugFromPreviewUrl } from "./outreach-email.js";
import { isPageV2, ensureOwnerToken, ownerPageUrl } from "./owner-link.js";
import { JACK_USER_ID } from "./trial-reminders.js";

export const FOLLOWUP_FROM = "Jack at Enoma <outreach@mail.enoma.io>";
export const ALERT_TO = "jack@enoma.io";
export const ALERT_FROM = "Enoma <noreply@enoma.io>";

// Types that don't come from page traffic, so there's no traffic_class to
// judge; only the internal rules apply.
const NO_TRAFFIC_TYPES = new Set(["unsubscribe", "bounce", "complaint", "email_reply", "payment_failed", "subscription_canceled", "fb_message", "fb_comment", "checkout_abandoned", "preview_no_claim", "claim_no_checkout"]);

const nowMs = (deps) => (deps.now ? deps.now() : Date.now());
const iso = (ms) => new Date(ms).toISOString();
const warn = (deps, ...a) => (deps.log || console).warn(...a);

// ── Writing a signal ────────────────────────────────────────────────────────
/**
 * input: { type, source, prospectId, businessId, outreachMessageId, email,
 *          trafficClass, payload, at, keyParts, person: { isInternal, slug },
 *          alertInfo: { businessName, city, state, trade, previewUrl, phone, replyText, detail } }
 * Returns { recorded, signal?, reason? }.
 */
export async function recordSignal(deps, input) {
  try {
    return await recordSignalInner(deps, input);
  } catch (e) {
    warn(deps, `recordSignal(${input?.type}) failed:`, e?.message || e);
    return { recorded: false, reason: "error", error: String(e?.message || e) };
  }
}

async function recordSignalInner(deps, input) {
  const { supabase } = deps;
  const env = deps.env || process.env;
  const rule = ruleFor(input.type);
  if (!rule) return { recorded: false, reason: "unknown_type" };
  const at = input.at ? new Date(input.at).getTime() : nowMs(deps);
  const email = normEmail(input.email);
  const person = { ...(input.person || {}), email };
  const trafficClass = NO_TRAFFIC_TYPES.has(input.type) ? undefined : (input.trafficClass || undefined);
  if (!isHumanSignal({ trafficClass, ...person })) {
    return { recorded: false, reason: trafficClass && trafficClass !== "human" ? `traffic_${trafficClass}` : "internal" };
  }

  const key = dedupeKey(input.type, { ...(input.keyParts || {}), at, email });
  const row = {
    type: input.type,
    source: input.source,
    prospect_id: input.prospectId || null,
    business_id: input.businessId || null,
    outreach_message_id: input.outreachMessageId || null,
    email,
    traffic_class: input.trafficClass || null,
    payload: input.payload || {},
    created_at: iso(at),
    dedupe_key: key
  };
  const { data: inserted, error } = await supabase.from("signals")
    .upsert(row, { onConflict: "dedupe_key", ignoreDuplicates: true })
    .select("*");
  if (error) throw error;
  const signal = Array.isArray(inserted) ? inserted[0] : inserted;
  if (!signal) return { recorded: false, reason: "duplicate", dedupe_key: key };

  const mode = followupsMode(env);
  let state = rule.nextState || "new";

  if (rule.closeAs) {
    await closePerson(deps, { email, prospectId: signal.prospect_id, reason: rule.closeAs, exceptId: signal.id });
    await setState(deps, signal.id, { state: "closed", closed_reason: rule.closeAs });
    return { recorded: true, signal: { ...signal, state: "closed" } };
  }

  if (rule.resolves) {
    await resolvePerson(deps, { email, prospectIds: signal.prospect_id ? [signal.prospect_id] : [], businessId: signal.business_id, reason: "replied", exceptId: signal.id });
  }

  if (rule.steps) {
    if (mode === "off" || !email) {
      state = "new";
    } else {
      const steps = plannedSteps(input.type, at);
      const rows = steps.map(s => ({
        signal_id: signal.id, recipient: email, template: s.template, step: s.step,
        scheduled_for: s.scheduled_for, status: "scheduled", dry_run: mode === "dry_run"
      }));
      const { error: sErr } = await supabase.from("followup_sends").upsert(rows, { onConflict: "signal_id,step", ignoreDuplicates: true });
      if (sErr) throw sErr;
    }
  }

  if (state !== "new") await setState(deps, signal.id, { state });

  if (mode !== "off" && !input.skipAlert && shouldAlert(input.type)) {
    await sendHotAlert(deps, { ...signal, state }, input.alertInfo || {});
  }
  return { recorded: true, signal: { ...signal, state } };
}

async function setState(deps, id, patch) {
  const t = iso(nowMs(deps));
  const extra = patch.state === "handled" ? { handled_at: t } : {};
  const { error } = await deps.supabase.from("signals").update({ ...patch, ...extra, updated_at: t }).eq("id", id);
  if (error) warn(deps, "signal state update failed:", error.message);
}

// ── Page visits ─────────────────────────────────────────────────────────────
const etDay = (ms) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/New_York" });

/**
 * A human visit to a prospect's (unclaimed) preview: preview_visit once per
 * prospect, and repeat_visit when they had already been there on an earlier
 * day (Eastern). Call it before inserting the current page_events row, or
 * pass `at` so the current row is excluded.
 */
export async function recordVisit(deps, { slug, at = nowMs(deps), trafficClass, messageId, prospect: known, source = "track" } = {}) {
  try {
    if (trafficClass !== "human" || !slug) return { recorded: false, reason: "not_human" };
    const { supabase } = deps;
    let prospect = known;
    if (!prospect) {
      const { data } = await supabase.from("prospects")
        .select("id, business_name, email, status, phone, city, state, trade, preview_url, preview_business_id")
        .eq("preview_url", `https://enoma.io/${slug}`).order("created_at", { ascending: false }).limit(1);
      prospect = data?.[0];
    }
    if (!prospect?.id) return { recorded: false, reason: "no_prospect" };
    const [{ data: profile }, { data: biz }] = await Promise.all([
      supabase.from("small_business_profiles").select("is_claimed").eq("username", slug).maybeSingle(),
      prospect.preview_business_id ? supabase.from("businesses").select("is_internal").eq("id", prospect.preview_business_id).maybeSingle() : { data: null }
    ]);
    if (profile?.is_claimed === true || prospect.status === "claimed") return { recorded: false, reason: "claimed" };
    const person = { isInternal: biz?.is_internal === true, slug };
    const info = { businessName: prospect.business_name, city: prospect.city, state: prospect.state, trade: prospect.trade, phone: prospect.phone, previewUrl: prospect.preview_url };
    const base = { source, prospectId: prospect.id, businessId: prospect.preview_business_id, outreachMessageId: messageId || null, email: prospect.email, trafficClass, person, at, alertInfo: info };
    const out = [];
    out.push(await recordSignal(deps, { ...base, type: "preview_visit", keyParts: { prospectId: prospect.id }, payload: { slug, business_name: prospect.business_name } }));

    const { data: prior } = await supabase.from("page_events").select("created_at")
      .eq("slug", slug).eq("traffic_class", "human").in("event", ["page_view", "landing_view", "outreach_page_click", "outreach_claim_click"])
      .lt("created_at", new Date(at).toISOString()).order("created_at", { ascending: false }).limit(50);
    const today = etDay(at);
    const earlier = (prior || []).find(p => etDay(Date.parse(p.created_at)) !== today);
    if (earlier) {
      out.push(await recordSignal(deps, { ...base, type: "repeat_visit", keyParts: { prospectId: prospect.id }, payload: { slug, business_name: prospect.business_name, previous_visit_at: earlier.created_at }, alertInfo: { ...info, detail: `Back again. Last visit: ${new Date(earlier.created_at).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" })} ET.` } }));
    }
    return { recorded: out.some(r => r.recorded), results: out };
  } catch (e) {
    warn(deps, "recordVisit failed:", e?.message || e);
    return { recorded: false, reason: "error" };
  }
}

// ── Cancelling / resolving ──────────────────────────────────────────────────
async function openSignalsFor(deps, { email, prospectIds = [], businessId }) {
  const { supabase } = deps;
  const ors = [];
  if (email) ors.push(`email.eq."${email.replace(/"/g, "")}"`);
  for (const p of prospectIds.filter(Boolean)) ors.push(`prospect_id.eq.${p}`);
  if (businessId) ors.push(`business_id.eq.${businessId}`);
  if (!ors.length) return [];
  const { data, error } = await supabase.from("signals").select("id, type, state")
    .or(ors.join(",")).not("state", "in", "(handled,closed)");
  if (error) { warn(deps, "openSignalsFor failed:", error.message); return []; }
  return data || [];
}

async function cancelScheduled(deps, { signalIds = [], email, status = "cancelled", reason }) {
  const { supabase } = deps;
  const t = iso(nowMs(deps));
  const patch = { status, cancel_reason: reason, updated_at: t };
  if (signalIds.length) {
    await supabase.from("followup_sends").update(patch).in("signal_id", signalIds).eq("status", "scheduled");
  }
  if (email) {
    await supabase.from("followup_sends").update(patch).eq("recipient", email).eq("status", "scheduled");
  }
}

/**
 * A reply, claim or completed checkout. scope "pre_claim" (a claim) only
 * cancels rules that stop on a claim; "all" cancels everything for them.
 */
export async function resolvePerson(deps, { email, prospectIds = [], businessId, reason, scope = "all", exceptId } = {}) {
  try {
    const e = normEmail(email);
    let open = await openSignalsFor(deps, { email: e, prospectIds, businessId });
    open = open.filter(s => s.id !== exceptId);
    if (scope === "pre_claim") open = open.filter(s => (ruleFor(s.type)?.stopIf || []).includes("claimed"));
    // Signals waiting on Jack stay with Jack, except that a reply/claim/payment answers them.
    const ids = open.map(s => s.id);
    await cancelScheduled(deps, { signalIds: ids, email: scope === "all" ? e : null, reason });
    for (const id of ids) await setState(deps, id, { state: "handled" });
    return { handled: ids.length };
  } catch (err) {
    warn(deps, "resolvePerson failed:", err?.message || err);
    return { handled: 0 };
  }
}

// Unsubscribe / bounce / complaint: nothing more goes to them, ever.
async function closePerson(deps, { email, prospectId, reason, exceptId }) {
  const open = (await openSignalsFor(deps, { email, prospectIds: prospectId ? [prospectId] : [] })).filter(s => s.id !== exceptId);
  await cancelScheduled(deps, { signalIds: open.map(s => s.id), email, status: "suppressed", reason });
  for (const s of open) await setState(deps, s.id, { state: "closed", closed_reason: reason });
}

// ── HOT alert ───────────────────────────────────────────────────────────────
export async function sendHotAlert(deps, signal, info = {}) {
  const { supabase, resend } = deps;
  const env = deps.env || process.env;
  try {
    const key = alertKey({ type: signal.type, prospectId: signal.prospect_id, businessId: signal.business_id, email: signal.email, at: nowMs(deps) });
    const { data: slot, error } = await supabase.from("signal_alerts")
      .upsert({ alert_key: key, signal_id: signal.id }, { onConflict: "alert_key", ignoreDuplicates: true }).select("alert_key");
    if (error) throw error;
    if (!slot?.length) return { sent: false, reason: "rate_limited" };
    const alert = buildHotAlert({ type: signal.type, email: signal.email, at: signal.created_at, ...info });
    let emailed = false;
    if (resend) {
      const { error: sendErr } = await resend.emails.send({
        from: ALERT_FROM, to: ALERT_TO, replyTo: signal.email || undefined,
        subject: alert.subject, text: alert.text, html: alert.html
      });
      if (sendErr) throw new Error(sendErr.message || "Resend send failed");
      emailed = true;
    }
    const pushed = await pushNtfy(deps, alert, info, env);
    return { sent: emailed || pushed, emailed, pushed };
  } catch (e) {
    warn(deps, "HOT alert failed:", e?.message || e);
    return { sent: false, reason: "error" };
  }
}

export async function pushNtfy(deps, alert, info = {}, env = process.env) {
  const topic = String(env.NTFY_TOPIC || "").trim();
  if (!topic) return false;
  const doFetch = deps.fetch || globalThis.fetch;
  try {
    const headers = { Title: "Enoma HOT", Priority: "high", Tags: "fire" };
    if (info.previewUrl) headers.Click = info.previewUrl;
    // HTTP headers must be ASCII; the em dash lives in the body only.
    const r = await doFetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, { method: "POST", headers, body: alert.oneLiner });
    return !!r?.ok;
  } catch (e) {
    warn(deps, "ntfy push failed:", e?.message || e);
    return false;
  }
}

// ── Facts about a recipient, read fresh at send time ────────────────────────
export async function gatherSendContext(deps, signal, recipient) {
  const { supabase } = deps;
  const email = normEmail(recipient);
  const prospectIds = new Set(signal.prospect_id ? [signal.prospect_id] : []);
  const { data: byEmail } = email
    ? await supabase.from("prospects").select("id, status, state, city, trade, business_name, phone, preview_url, preview_business_id").ilike("email", email)
    : { data: [] };
  for (const p of byEmail || []) prospectIds.add(p.id);
  const ids = [...prospectIds];
  const { data: prospects } = ids.length
    ? await supabase.from("prospects").select("id, status, state, city, trade, business_name, phone, preview_url, preview_business_id, email").in("id", ids)
    : { data: [] };
  const prospect = (prospects || []).find(p => p.id === signal.prospect_id) || (prospects || [])[0] || null;
  const businessId = signal.business_id || prospect?.preview_business_id || null;

  const [supp, profile, biz, sub, msgs, visitNotes, sends, replies] = await Promise.all([
    email ? supabase.from("suppression_list").select("reason").ilike("email", email).maybeSingle() : { data: null },
    businessId ? supabase.from("small_business_profiles").select("business_id, business_name, username, is_claimed, state, city, primary_category, page_version, owner_token").eq("business_id", businessId).maybeSingle() : { data: null },
    businessId ? supabase.from("businesses").select("is_internal, slug").eq("id", businessId).maybeSingle() : { data: null },
    businessId ? supabase.from("subscriptions").select("status, stripe_subscription_id").eq("business_id", businessId).maybeSingle() : { data: null },
    ids.length ? supabase.from("outreach_messages").select("id, sent_at, followup_sent_at, followup2_sent_at, response_status, draft_subject").in("prospect_id", ids).eq("channel", "email") : { data: [] },
    ids.length ? supabase.from("visit_followups").select("status, scheduled_for, updated_at").in("prospect_id", ids) : { data: [] },
    email ? supabase.from("followup_sends").select("template, sent_at, signal_id").eq("recipient", email).eq("status", "sent") : { data: [] },
    email ? supabase.from("outreach_replies").select("intent").ilike("from_email", email) : { data: [] }
  ]);

  const times = [];
  let automatedSentEver = 0;
  for (const m of msgs.data || []) {
    if (m.sent_at) times.push(m.sent_at); // the first cold email counts toward the 24 h gap only
    if (m.followup_sent_at) { times.push(m.followup_sent_at); automatedSentEver++; }
    if (m.followup2_sent_at) { times.push(m.followup2_sent_at); automatedSentEver++; }
  }
  let visitFollowupSent = false;
  for (const v of visitNotes.data || []) {
    // Jack tapped Skip on this prospect's visit note: the automatic one respects that.
    if (v.status === "skipped") visitFollowupSent = true;
    if (["sending", "sent"].includes(v.status)) {
      visitFollowupSent = true; automatedSentEver++;
      times.push(v.scheduled_for || v.updated_at);
    }
  }
  for (const s of sends.data || []) {
    automatedSentEver++;
    if (s.sent_at) times.push(s.sent_at);
    if (s.template === "visit_followup") visitFollowupSent = true;
  }
  const lastAutomatedAt = times.filter(Boolean).sort().pop() || null;
  const responses = (msgs.data || []).map(m => m.response_status).filter(Boolean);
  const replied = responses.includes("replied") || (replies.data || []).some(r => r.intent && r.intent !== "auto_reply");
  const claimed = (prospects || []).some(p => p.status === "claimed") || profile.data?.is_claimed === true;
  const isCustomer = !!sub.data?.stripe_subscription_id && ["active", "trialing", "past_due"].includes(sub.data?.status);
  const state = prospect?.state || profile.data?.state || null;
  const slug = biz.data?.slug || profile.data?.username || slugFromPreviewUrl(prospect?.preview_url);
  // Page v2: follow-ups link the owner to the page itself with the owner bar.
  let ownerUrl = null;
  if (slug && isPageV2(profile.data) && (deps.env || process.env).PAGE_V2 !== "off") {
    const token = await ensureOwnerToken(supabase, profile.data).catch(() => null);
    if (token) ownerUrl = ownerPageUrl(slug, token);
  }

  return {
    recipient: email,
    signalType: signal.type,
    isInternal: isInternalPerson({ isInternal: biz.data?.is_internal === true, slug, email }, deps.env || process.env),
    suppressed: !!supp.data,
    bounced: responses.includes("bounced"),
    unsubscribed: responses.includes("opted_out"),
    replied,
    claimed,
    isCustomer,
    visitFollowupSent,
    automatedSentEver,
    lastAutomatedAt,
    timeZone: timeZoneForState(state),
    // For rendering
    businessId,
    prospect,
    businessName: profile.data?.business_name || prospect?.business_name || signal.payload?.business_name || null,
    pageUrl: ownerUrl || (slug ? `https://enoma.io/${slug}` : prospect?.preview_url || null),
    originalSubject: (msgs.data || []).find(m => m.draft_subject)?.draft_subject || null
  };
}

// ── The queue ───────────────────────────────────────────────────────────────
/**
 * Due follow-ups. live: send through Resend. dry_run: decide and render once,
 * log it, leave the row status 'scheduled' with decision/decided_at set.
 * Rows scheduled while in dry_run never send, even after going live, so
 * flipping the switch can't release a backlog.
 */
export async function processDue(deps, { limit = 25, deadline } = {}) {
  const { supabase } = deps;
  const env = deps.env || process.env;
  const mode = followupsMode(env);
  const out = { mode, considered: 0, sent: 0, would_send: 0, rescheduled: 0, cancelled: 0, results: [] };
  if (mode === "off") return out;
  const now = nowMs(deps);
  const { data: rows, error } = await supabase.from("followup_sends")
    .select("id, signal_id, recipient, template, step, scheduled_for, status, dry_run, decided_at, signals(id, type, state, prospect_id, business_id, outreach_message_id, email, payload, created_at)")
    .eq("status", "scheduled").is("decided_at", null).lte("scheduled_for", iso(now))
    .order("scheduled_for", { ascending: true }).limit(limit);
  if (error) throw error;

  for (const row of rows || []) {
    if (deadline && nowMs(deps) > deadline) break;
    out.considered++;
    const signal = row.signals || {};
    const dry = row.dry_run === true || mode === "dry_run";
    const t = iso(nowMs(deps));
    try {
      if (["handled", "closed"].includes(signal.state)) {
        await supabase.from("followup_sends").update({ status: "cancelled", cancel_reason: `signal_${signal.state}`, updated_at: t }).eq("id", row.id);
        out.cancelled++; out.results.push({ id: row.id, cancelled: `signal_${signal.state}` });
        continue;
      }
      const ctx = await gatherSendContext(deps, signal, row.recipient);
      const verdict = canSend({ ...ctx, now: nowMs(deps) });
      if (!verdict.ok && verdict.retryAt) {
        await supabase.from("followup_sends").update({ scheduled_for: verdict.retryAt, updated_at: t }).eq("id", row.id);
        out.rescheduled++; out.results.push({ id: row.id, rescheduled: verdict.retryAt, reason: verdict.reason });
        continue;
      }
      if (!verdict.ok) {
        if (dry) {
          await supabase.from("followup_sends").update({ decision: `would_cancel:${verdict.reason}`, decided_at: t, updated_at: t }).eq("id", row.id);
        } else {
          await supabase.from("followup_sends").update({ status: verdict.status || "cancelled", cancel_reason: verdict.reason, updated_at: t }).eq("id", row.id);
        }
        out.cancelled++; out.results.push({ id: row.id, cancelled: verdict.reason, dry_run: dry });
        continue;
      }

      const vars = {
        businessName: ctx.businessName, pageUrl: ctx.pageUrl, originalSubject: ctx.originalSubject,
        dashboardUrl: "https://enoma.io/dashboard",
        checkoutUrl: null
      };
      if (row.template === "checkout_abandoned" && !dry) vars.checkoutUrl = await freshCheckoutUrl(deps, ctx.businessId, row.recipient);
      const email = renderFollowup(row.template, vars, { unsubscribeUrl: buildUnsubscribeUrl(row.recipient), mailingAddress: MAILING_ADDRESS });
      if (email.issues.length) {
        await supabase.from("followup_sends").update(dry
          ? { decision: `would_cancel:copy_lint`, decided_at: t, rendered_subject: email.subject, rendered_text: email.text, updated_at: t }
          : { status: "cancelled", cancel_reason: `copy_lint: ${email.issues.join("; ")}`, rendered_subject: email.subject, rendered_text: email.text, updated_at: t }).eq("id", row.id);
        out.cancelled++; out.results.push({ id: row.id, cancelled: "copy_lint", issues: email.issues });
        continue;
      }

      if (dry) {
        (deps.log || console).log(`[followups dry_run] would send ${row.template} to ${row.recipient}\nSubject: ${email.subject}\n${email.text}`);
        await supabase.from("followup_sends").update({ decision: "would_send", decided_at: t, rendered_subject: email.subject, rendered_text: email.text, updated_at: t }).eq("id", row.id);
        out.would_send++; out.results.push({ id: row.id, would_send: row.template, to: row.recipient, subject: email.subject });
        continue;
      }

      // live: reserve, so overlapping runs can't send twice
      const { data: reserved } = await supabase.from("followup_sends").update({ status: "sending", updated_at: t }).eq("id", row.id).eq("status", "scheduled").select("id");
      if (!reserved?.length) continue;
      // The visit follow-up is one per prospect, ever, shared with visit_followups.
      if (row.template === "visit_followup" && signal.prospect_id) {
        const ok = await reserveVisitFollowup(deps, signal, t);
        if (!ok) {
          await supabase.from("followup_sends").update({ status: "cancelled", cancel_reason: "visit_followup_already_sent", updated_at: t }).eq("id", row.id);
          out.cancelled++; continue;
        }
      }
      try {
        if (!deps.resend) throw new Error("RESEND_API_KEY not configured");
        const { data: sendData, error: sendErr } = await deps.resend.emails.send({
          from: FOLLOWUP_FROM, to: row.recipient, replyTo: "jack@enoma.io",
          subject: email.subject, text: email.text, html: email.html,
          headers: { "List-Unsubscribe": `<${buildUnsubscribeUrl(row.recipient)}>` },
          tags: [{ name: "kind", value: `signal_${row.template}` }, { name: "followup_send_id", value: row.id }]
        });
        if (sendErr) throw new Error(sendErr.message || "Resend send failed");
        const sentAt = iso(nowMs(deps));
        await supabase.from("followup_sends").update({ status: "sent", sent_at: sentAt, resend_id: sendData?.id || null, rendered_subject: email.subject, rendered_text: email.text, updated_at: sentAt }).eq("id", row.id);
        if (row.template === "visit_followup" && signal.prospect_id) {
          await supabase.from("visit_followups").update({ status: "sent", scheduled_for: sentAt, resend_email_id: sendData?.id || null, updated_at: sentAt }).eq("prospect_id", signal.prospect_id);
        }
        await setState(deps, signal.id, { state: "auto_followup_sent" });
        out.sent++; out.results.push({ id: row.id, sent: row.template, to: row.recipient });
      } catch (err) {
        await supabase.from("followup_sends").update({ status: "scheduled", updated_at: iso(nowMs(deps)) }).eq("id", row.id);
        if (row.template === "visit_followup" && signal.prospect_id) {
          await supabase.from("visit_followups").update({ status: "pending", updated_at: iso(nowMs(deps)) }).eq("prospect_id", signal.prospect_id).eq("status", "sending");
        }
        out.results.push({ id: row.id, error: String(err?.message || err) });
      }
    } catch (err) {
      warn(deps, `followup ${row.id} failed:`, err?.message || err);
      out.results.push({ id: row.id, error: String(err?.message || err) });
    }
  }
  return out;
}

// One visit follow-up per prospect, ever: claim the visit_followups row
// (create it, or move it from pending), the same row Jack's Approve link uses.
async function reserveVisitFollowup(deps, signal, t) {
  const { supabase } = deps;
  await supabase.from("visit_followups").upsert({
    prospect_id: signal.prospect_id, outreach_message_id: signal.outreach_message_id || null,
    visited_at: signal.created_at, status: "pending"
  }, { onConflict: "prospect_id", ignoreDuplicates: true });
  const { data } = await supabase.from("visit_followups")
    .update({ status: "sending", decided_at: t, updated_at: t })
    .eq("prospect_id", signal.prospect_id).eq("status", "pending").select("id");
  return !!data?.length;
}

// A new Stripe Checkout link for an abandoned checkout, when the business has
// an owner account to attach it to; otherwise the dashboard.
async function freshCheckoutUrl(deps, businessId, email) {
  if (!deps.stripe || !businessId) return null;
  try {
    const { createPageCheckoutSession } = await import("./page-checkout.js");
    const { data: members } = await deps.supabase.from("business_members").select("user_id").eq("business_id", businessId).eq("role", "owner");
    const owner = (members || []).find(m => m.user_id !== JACK_USER_ID);
    if (!owner) return null;
    const result = await createPageCheckoutSession({
      stripe: deps.stripe, supabase: deps.supabase, businessId, interval: "month",
      customer: { email, userId: owner.user_id }, source: "signal_followup"
    });
    return result.status === 200 ? result.url : null;
  } catch (e) {
    warn(deps, "fresh checkout link failed:", e?.message || e);
    return null;
  }
}

// ── Time-based signals ──────────────────────────────────────────────────────
const HOUR = 36e5;
async function ownerEmailFor(deps, businessId) {
  const { data: members } = await deps.supabase.from("business_members").select("user_id").eq("business_id", businessId).eq("role", "owner");
  const owner = (members || []).find(m => m.user_id !== JACK_USER_ID);
  if (!owner) return null;
  try {
    const { data } = await deps.supabase.auth.admin.getUserById(owner.user_id);
    return data?.user?.email || null;
  } catch { return null; }
}

/**
 * Scans funnel_events for the signals that are an absence of something:
 *   preview_no_claim    generation_succeeded, page has an email and no owner, 2 h on
 *   claim_no_checkout   business_claimed / account generation, no checkout in 24 h
 *   checkout_abandoned  checkout_started, no checkout_completed in 1 h
 * Only human, non-internal events. lookbackDays bounds the scan (the backfill
 * passes 14).
 */
export async function scanDerived(deps, { lookbackDays = 3, record = recordSignal } = {}) {
  const { supabase } = deps;
  const now = nowMs(deps);
  const since = iso(now - lookbackDays * 24 * HOUR);
  const { data: events, error } = await supabase.from("funnel_events")
    .select("id, event, business_id, created_at, traffic_class, metadata")
    .in("event", ["generation_succeeded", "business_claimed", "checkout_started", "checkout_completed", "subscription_activated"])
    .gte("created_at", since).not("business_id", "is", null).order("created_at", { ascending: true });
  if (error) throw error;
  const byBiz = new Map();
  for (const e of events || []) {
    if (!byBiz.has(e.business_id)) byBiz.set(e.business_id, []);
    byBiz.get(e.business_id).push(e);
  }
  const results = [];
  for (const [businessId, evs] of byBiz) {
    const human = evs.filter(e => e.traffic_class === "human");
    if (!human.length) continue;
    const completed = evs.find(e => e.event === "checkout_completed" || e.event === "subscription_activated");
    const [{ data: biz }, { data: profile }] = await Promise.all([
      supabase.from("businesses").select("is_internal, slug, name").eq("id", businessId).maybeSingle(),
      supabase.from("small_business_profiles").select("business_name, username, email, is_claimed, city, state, phone").eq("business_id", businessId).maybeSingle()
    ]);
    const person = { isInternal: biz?.is_internal === true, slug: biz?.slug || profile?.username };
    if (isInternalPerson(person)) continue;
    const info = { businessName: profile?.business_name || biz?.name, city: profile?.city, state: profile?.state, phone: profile?.phone, previewUrl: profile?.username ? `https://enoma.io/${profile.username}` : null };

    const gen = human.find(e => e.event === "generation_succeeded");
    const claim = human.find(e => e.event === "business_claimed");
    const checkout = human.filter(e => e.event === "checkout_started").pop();
    let ownerEmail = null;
    const getOwner = async () => (ownerEmail ??= (await ownerEmailFor(deps, businessId)) || "");

    if (gen && !claim && now - Date.parse(gen.created_at) >= 2 * HOUR) {
      const owner = await getOwner();
      if (!owner && profile?.email && profile?.is_claimed !== true) {
        results.push(await record(deps, { type: "preview_no_claim", source: "track", businessId, email: profile.email, person, at: Date.parse(gen.created_at), keyParts: { businessId }, payload: { business_name: info.businessName, slug: profile.username, funnel_event_id: gen.id }, alertInfo: info }));
      }
    }
    const claimedAt = claim ? Date.parse(claim.created_at) : (gen && await getOwner() ? Date.parse(gen.created_at) : null);
    if (claimedAt && !checkout && !completed && now - claimedAt >= 24 * HOUR) {
      const owner = await getOwner();
      if (owner) results.push(await record(deps, { type: "claim_no_checkout", source: "track", businessId, email: owner, person, at: claimedAt, keyParts: { businessId }, payload: { business_name: info.businessName, slug: profile?.username }, alertInfo: info }));
    }
    if (checkout && !(completed && Date.parse(completed.created_at) >= Date.parse(checkout.created_at)) && now - Date.parse(checkout.created_at) >= HOUR) {
      const owner = await getOwner();
      results.push(await record(deps, { type: "checkout_abandoned", source: "track", businessId, email: owner || profile?.email, person, at: Date.parse(checkout.created_at), keyParts: { businessId }, payload: { business_name: info.businessName, slug: profile?.username, funnel_event_id: checkout.id }, alertInfo: { ...info, detail: "Started checkout over an hour ago, no payment yet." } }));
    }
  }
  return results;
}

// ── Closing stale signals ───────────────────────────────────────────────────
export async function sweep(deps, { limit = 200 } = {}) {
  const { supabase } = deps;
  const now = nowMs(deps);
  const { data: open, error } = await supabase.from("signals")
    .select("id, state, created_at, followup_sends(status, sent_at)")
    .in("state", ["new", "auto_followup_scheduled", "auto_followup_sent"])
    .lte("created_at", iso(now - GUARDRAILS.noResponseCloseMs)).limit(limit);
  if (error) throw error;
  let closed = 0;
  for (const s of open || []) {
    const sends = s.followup_sends || [];
    const hasScheduled = sends.some(f => f.status === "scheduled" || f.status === "sending");
    const lastTouchAt = sends.map(f => f.sent_at).filter(Boolean).sort().pop() || null;
    const d = sweepDecision({ state: s.state, createdAt: s.created_at, lastTouchAt, hasScheduled, now });
    if (d?.close) { await setState(deps, s.id, { state: "closed", closed_reason: d.close }); closed++; }
  }
  return { closed };
}

/** Everything the hourly cron does, inside one time budget. */
export async function runSignalQueue(deps, { budgetMs = 8000 } = {}) {
  const deadline = nowMs(deps) + budgetMs;
  const out = {};
  try { out.derived = (await scanDerived(deps)).filter(r => r?.recorded).length; } catch (e) { out.derived_error = String(e?.message || e); }
  try { out.queue = await processDue(deps, { deadline }); } catch (e) { out.queue_error = String(e?.message || e); }
  try { out.sweep = await sweep(deps); } catch (e) { out.sweep_error = String(e?.message || e); }
  return out;
}

/** Mark one signal handled (POST /api/signals/:id/handle). */
export async function markHandled(deps, id, { note } = {}) {
  const { data: s } = await deps.supabase.from("signals").select("id, state, payload").eq("id", id).maybeSingle();
  if (!s) return { ok: false, status: 404 };
  if (s.state === "handled" || s.state === "closed") return { ok: true, already: s.state };
  await cancelScheduled(deps, { signalIds: [id], reason: "handled_by_jack" });
  const t = iso(nowMs(deps));
  await deps.supabase.from("signals").update({ state: "handled", handled_at: t, updated_at: t, ...(note ? { payload: { ...(s.payload || {}), handled_note: String(note).slice(0, 500) } } : {}) }).eq("id", id);
  return { ok: true };
}
