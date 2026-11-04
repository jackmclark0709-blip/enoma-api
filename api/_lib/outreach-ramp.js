// Gradual send-volume ramp for outreach@mail.enoma.io — a brand-new sending
// domain with zero history. Jumping straight to the steady-state 20/day cap
// (vercel.json's cron) is exactly the kind of spike that gets a fresh domain
// flagged by spam filters before it's built any reputation. This throttles
// the EFFECTIVE cap further during the first two weeks regardless of what
// limit the caller/cron requests — vercel.json's &limit=20 stays the eventual
// ceiling, this just clamps below it early on.
const WARMUP_START = new Date("2026-09-01T00:00:00Z");

// Each step's cap applies from `afterDays` (days since WARMUP_START) onward.
const RAMP_SCHEDULE = [
  { afterDays: 0, cap: 5 },
  { afterDays: 3, cap: 10 },
  { afterDays: 7, cap: 15 },
  { afterDays: 14, cap: 20 },
  // Nov 3 2026: two months at 15-20/day with the bounce brake never firing
  // (and ZeroBounce verifying every address since Oct 27), so step to 30.
  { afterDays: 63, cap: 30 }
];

export function rampCapForDate(date, startDate = WARMUP_START) {
  const daysSinceStart = Math.floor((date.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));
  let cap = RAMP_SCHEDULE[0].cap;
  for (const step of RAMP_SCHEDULE) {
    if (daysSinceStart >= step.afterDays) cap = step.cap;
  }
  return cap;
}

// Bounce brake: a sending domain's reputation drops fast once more than a
// few percent of mail bounces. If the last 7 days ran above BOUNCE_BRAKE_RATE
// (and there's enough volume to judge), the daily cap falls back to
// BRAKE_CAP until the rate recovers.
export const BOUNCE_BRAKE_RATE = 0.03;
export const BOUNCE_BRAKE_MIN_SENDS = 30;
export const BRAKE_CAP = 10;

export function capWithBounceBrake(cap, { sends7d = 0, bounces7d = 0 } = {}) {
  if (sends7d < BOUNCE_BRAKE_MIN_SENDS) return cap;
  return bounces7d / sends7d > BOUNCE_BRAKE_RATE ? Math.min(cap, BRAKE_CAP) : cap;
}

// Follow-ups used to share the whole daily cap and went first, so on busy
// follow-up days (Oct 28-31 2026) no new prospect got a first email at all.
// Now at most FOLLOWUP_DAILY_CAP a day, never past the overall cap; first
// emails get whatever is left.
export const FOLLOWUP_DAILY_CAP = 10;

export function followUpAllowance({ dailyCap, sentToday = 0, followupsToday = 0, followUpCap = FOLLOWUP_DAILY_CAP }) {
  const totalLeft = dailyCap - (sentToday || 0) - (followupsToday || 0);
  const followUpLeft = followUpCap - (followupsToday || 0);
  return Math.max(0, Math.min(totalLeft, followUpLeft));
}
