// Every follow-up rule in one place. A signal (api/_lib/signals.js) is
// matched to its rule here; the rule says what happens next:
//
//   steps        automated emails, each `delayMs` after the signal, rendered
//                from `template` (api/_lib/signals.js FOLLOWUP_TEMPLATES)
//   stopIf       conditions that cancel a still-scheduled step when it comes
//                due (on top of the global guardrails in canSend)
//   oncePer      "visit_followup": at most one per prospect, ever, shared
//                with the older visit_followups table
//   queueForJack no email; the signal waits for Jack (state queued_for_jack)
//   alert        send Jack a HOT alert right away (rate limited per day)
//   recordOnly   nothing to send (no email address), kept for audiences
//   closeAs      a terminal signal: close it, and close/cancel everything
//                open for the same person
//   resolves     a signal that marks the person's open signals handled
//
// Changing a delay, template or condition here is the whole change; the
// queue (api/_lib/signal-store.js) only reads these.

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const FOLLOWUP_RULES = {
  // A cold-email prospect really clicked or opened their preview, no claim.
  email_click: {
    steps: [{ delayMs: 45 * MIN, template: "visit_followup" }],
    oncePer: "visit_followup",
    stopIf: ["claimed"],
    alert: true,
    nextState: "auto_followup_scheduled"
  },
  preview_visit: {
    steps: [{ delayMs: 45 * MIN, template: "visit_followup" }],
    oncePer: "visit_followup",
    stopIf: ["claimed"],
    nextState: "auto_followup_scheduled"
  },
  // Inbound preview built with an email address, not claimed in 2 h.
  preview_no_claim: {
    steps: [
      { delayMs: 2 * HOUR, template: "preview_no_claim_1" },
      { delayMs: 2 * DAY, template: "preview_no_claim_2" }
    ],
    stopIf: ["claimed"],
    nextState: "auto_followup_scheduled"
  },
  // Claimed (or signed up), no checkout started within a day.
  claim_no_checkout: {
    steps: [
      { delayMs: 1 * DAY, template: "claim_no_checkout_1" },
      { delayMs: 3 * DAY, template: "claim_no_checkout_2" }
    ],
    stopIf: ["checkout_completed"],
    nextState: "auto_followup_scheduled"
  },
  checkout_abandoned: {
    steps: [{ delayMs: 1 * HOUR, template: "checkout_abandoned" }],
    stopIf: ["checkout_completed"],
    alert: true,
    nextState: "auto_followup_scheduled"
  },

  // A person has to answer these.
  repeat_visit: { queueForJack: true, alert: true, nextState: "queued_for_jack" },
  email_reply: { queueForJack: true, alert: true, resolves: true, nextState: "queued_for_jack" },
  fb_message: { queueForJack: true, alert: true, nextState: "queued_for_jack" },
  fb_comment: { queueForJack: true, alert: false, nextState: "queued_for_jack" },
  payment_failed: { queueForJack: true, alert: true, nextState: "queued_for_jack" },
  subscription_canceled: { queueForJack: true, alert: false, nextState: "queued_for_jack" },

  // No email address, nothing to send. Feeds the Meta retargeting audience.
  preview_started_no_email: { recordOnly: true, nextState: "new" },

  // Terminal: the person said no or the address is dead.
  unsubscribe: { closeAs: "unsubscribed", nextState: "closed" },
  bounce: { closeAs: "bounced", nextState: "closed" },
  complaint: { closeAs: "complained", nextState: "closed" }
};

export const SIGNAL_TYPES = Object.keys(FOLLOWUP_RULES);

// Global guardrails (enforced in canSend, api/_lib/signals.js).
export const GUARDRAILS = {
  maxAutomatedPerPersonEver: 3,
  minGapMs: 24 * HOUR,
  sendWindowStartHour: 8,   // local time, inclusive
  sendWindowEndHour: 19,    // local time, exclusive
  nextMorning: { hour: 8, minute: 15 },
  defaultTimeZone: "America/New_York",
  // No response this long after the last automated touch closes the signal.
  noResponseCloseMs: 14 * DAY,
  // A Resend click this soon after delivery is a mail scanner.
  scannerClickWindowMs: 120 * 1000
};

export function ruleFor(type) {
  return FOLLOWUP_RULES[type] || null;
}

// The followup_sends rows a new signal schedules (pure).
export function plannedSteps(type, signalAt) {
  const rule = ruleFor(type);
  if (!rule?.steps) return [];
  const t0 = new Date(signalAt).getTime();
  return rule.steps.map((s, i) => ({
    step: i + 1,
    template: s.template,
    scheduled_for: new Date(t0 + s.delayMs).toISOString()
  }));
}
