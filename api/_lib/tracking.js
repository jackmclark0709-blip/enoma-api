// Server-side helpers that put a traffic_class on every page_events /
// funnel_events row (rules: api/_lib/traffic-classifier.js).

import {
  classifyTraffic, requestTrafficInput, OUTREACH_CLICK_EVENTS, SCANNER_BURST_MS, SCANNER_FOLLOW_MS
} from "./traffic-classifier.js";
import { cleanAttribution } from "./attribution.js";
import { isUuid } from "./outreach-email.js";

// Onboarding-funnel events accepted by /api/track without a `slug` (there's
// no published page yet at these steps). Allowlisted so the endpoint can't
// become an arbitrary free-text event sink.
export const FUNNEL_EVENTS = new Set([
  // Self-serve funnel, in order (Nov 2026). Server-side steps
  // (generation_*, checkout_started, subscription_activated, business_claimed)
  // are written by the API, not the browser.
  "gyw_viewed",
  "gyw_step_completed",
  "gyw_submitted",
  "preview_shown",
  "signup_viewed",
  "signup_submitted",
  "account_created",
  // Older names, still sent by some pages.
  "get_your_website_submitted",
  "choose_path_viewed",
  "choose_path_selected",
  "create_page_viewed",
  "create_step_viewed",
  "create_form_submitted",
  "create_generation_succeeded",
  "create_generation_failed",
  "place_search_used",
  "instant_preview_started",
  "instant_preview_failed",
  "claim_link_requested",
  "cta_clicked",
  // /<slug>/preview landing (api/_lib/preview-landing.js); metadata carries slug, m, src.
  "landing_comment_seen",
  "landing_cta_click"
]);

/** Outreach email times + recent events for the same email, for the timing rules. */
export async function outreachContext(supabase, messageId, at = Date.now()) {
  if (!isUuid(messageId)) return {};
  const since = new Date(at - SCANNER_FOLLOW_MS).toISOString();
  const [{ data: msg }, { data: prior }] = await Promise.all([
    supabase.from("outreach_messages")
      .select("id, sent_at, delivered_at, followup_sent_at, followup2_sent_at").eq("id", messageId).maybeSingle(),
    supabase.from("page_events")
      .select("id, created_at, event, ip, traffic_class").eq("metadata->>m", messageId).gte("created_at", since)
      .order("created_at", { ascending: false }).limit(25)
  ]);
  if (!msg) return {};
  return {
    outreach: { sentAt: msg.sent_at, deliveredAt: msg.delivered_at, followupSentAt: msg.followup_sent_at, followup2SentAt: msg.followup2_sent_at },
    priorForMessage: (prior || []).map(p => ({ id: p.id, at: p.created_at, event: p.event, ip: p.ip, trafficClass: p.traffic_class }))
  };
}

/**
 * Classify the request behind an event. Pass messageId for anything tied to
 * an outreach email (metadata.m) so the timing rules apply.
 * Never throws: a lookup failure just skips the timing rules.
 */
export async function classifyRequest(supabase, req, { event, messageId, internalFlag, outreach, at = Date.now() } = {}) {
  const base = requestTrafficInput(req);
  let ctx = {};
  if (messageId) {
    try { ctx = await outreachContext(supabase, messageId, at); } catch (e) { console.warn("outreachContext failed:", e?.message || e); }
  }
  if (outreach) ctx.outreach = outreach;
  const r = classifyTraffic({ ...base, internalFlag: internalFlag === true, event, at, ...ctx });
  return { ...r, ip: base.ip, userAgent: base.userAgent, priorForMessage: ctx.priorForMessage || [] };
}

/** Ids of earlier rows that form a scanner burst with this event. */
export function burstPartnerIds({ event, at, priorForMessage }) {
  return (priorForMessage || [])
    .filter(p => {
      const gap = at - new Date(p.at).getTime();
      const pair = p.event === event || (OUTREACH_CLICK_EVENTS.has(p.event) && OUTREACH_CLICK_EVENTS.has(event));
      return p.id && gap >= 0 && gap < SCANNER_BURST_MS && pair && p.trafficClass === "human";
    })
    .map(p => p.id);
}

/** A burst is only visible on its second event: re-label the first one too. */
export async function markBurstPartners(supabase, classification, { event, at }) {
  if (classification.reason !== "burst") return;
  const ids = burstPartnerIds({ event, at, priorForMessage: classification.priorForMessage });
  if (!ids.length) return;
  const { error } = await supabase.from("page_events").update({ traffic_class: "link_scanner" }).in("id", ids).eq("traffic_class", "human");
  if (error) console.warn("markBurstPartners failed:", error.message);
}

const clip = (v, n) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);

/** The funnel_events row for an event (pure, so it can be unit tested). */
export function funnelRow({ event, trafficClass, ip, userAgent, anonId, businessId, referrer, metadata, attribution }) {
  const meta = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? { ...metadata } : {};
  const firstTouch = cleanAttribution(attribution);
  if (firstTouch) meta.first_touch = firstTouch;
  return {
    event,
    anon_id: clip(anonId, 64),
    business_id: isUuid(businessId) ? businessId : null,
    metadata: meta,
    referrer: clip(referrer, 500),
    user_agent: clip(userAgent, 500),
    ip: ip || null,
    traffic_class: trafficClass
  };
}

/**
 * Insert one funnel_events row for a request. Never throws (tracking must
 * not break the request it's describing).
 * trafficClass overrides classification (e.g. a Stripe webhook, where the
 * request comes from Stripe, not the visitor).
 */
export async function logFunnelEvent(supabase, req, { event, anonId, businessId, metadata, attribution, referrer, trafficClass, internalFlag } = {}) {
  try {
    const c = trafficClass ? { trafficClass, ...requestTrafficInput(req) } : await classifyRequest(supabase, req, { event, internalFlag });
    const row = funnelRow({
      event, trafficClass: c.trafficClass, ip: trafficClass ? null : c.ip, userAgent: trafficClass ? null : c.userAgent,
      anonId, businessId, metadata, attribution,
      referrer: referrer !== undefined ? referrer : (req?.headers?.referer || null)
    });
    const { error } = await supabase.from("funnel_events").insert(row);
    if (error) console.warn(`funnel_events insert failed (${event}):`, error.message);
    return row;
  } catch (e) {
    console.warn(`funnel_events insert failed (${event}):`, e?.message || e);
    return null;
  }
}
