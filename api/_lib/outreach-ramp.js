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
  { afterDays: 14, cap: 20 }
];

export function rampCapForDate(date, startDate = WARMUP_START) {
  const daysSinceStart = Math.floor((date.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));
  let cap = RAMP_SCHEDULE[0].cap;
  for (const step of RAMP_SCHEDULE) {
    if (daysSinceStart >= step.afterDays) cap = step.cap;
  }
  return cap;
}
