// api/_lib/trial-policy.js
// Pricing: the first month is free, then $19.99/month keeps a page live (with
// personalized support). After the free month an unpaid page shows the
// inactive screen. That rule only applies to pages created on or after
// PRICING_TRIAL_STARTS_AT. Pages created before it were promised "free for
// good" by the Oct 2026 pricing, and they stay live until Jack decides
// otherwise.
//
// PRICING_TRIAL_STARTS_AT is an ISO timestamp set in Vercel at deploy time.
// Until it is set, no page ever turns off, so deploying this before setting
// the variable can't take anyone's page down by surprise.

export function trialStartsAt(env = process.env) {
  const raw = env.PRICING_TRIAL_STARTS_AT;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** True when this page keeps the old free-for-good promise and must never turn off. */
export function isGrandfathered(businessCreatedAt, env = process.env) {
  const start = trialStartsAt(env);
  if (!start) return true;
  const created = new Date(businessCreatedAt);
  if (Number.isNaN(created.getTime())) return true;
  return created < start;
}
