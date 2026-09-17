// Rotates the daily_pipeline prospect pull across nearby towns so the raw
// "new" pool doesn't saturate. Attleboro, MA alone was fully mined after
// ~a month at limit=25/trade/day -- repeat pulls returned zero new listings
// (see enoma-dev-practices memory). An explicit ?location= query param on
// the cron path still overrides this for one-off/manual pulls. Widened
// 2026-09-17 beyond the original 7-town Attleboro-area cluster to cover more
// of the surrounding MA/RI market at the same per-pull Outscraper cost.
const TOWNS = [
  "Attleboro, MA",
  "North Attleborough, MA",
  "Norton, MA",
  "Mansfield, MA",
  "Seekonk, MA",
  "Rehoboth, MA",
  "Pawtucket, RI",
  "Taunton, MA",
  "Foxborough, MA",
  "Franklin, MA",
  "Cumberland, RI",
  "Providence, RI"
];

// Trades the daily_pipeline cron rotates through (see handleDailyPipeline in
// ga-metrics.js). Landscaping/plumber were the only two ever pulled -- every
// other category the site's own concierge form lists (choose-path.html) got
// zero prospecting. Rotating widens the addressable market at the same
// Outscraper cost per pull, rather than pulling more of the same two trades
// whose backlog is already dominated by unemailable prospects.
const TRADES = [
  "landscaping",
  "plumber",
  "hvac contractor",
  "electrician",
  "house cleaning service",
  "painting contractor",
  "roofing contractor",
  "general contractor"
];

function dayOfYear(date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const today = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.floor((today - start) / (24 * 60 * 60 * 1000));
}

export function townForDate(date, towns = TOWNS) {
  return towns[dayOfYear(date) % towns.length];
}

// `offset` lets two same-day cron entries pick different trades from the
// same rotating list — see vercel.json's two daily_pipeline crons, one at
// offset 0 and one at offset 4 (half the list length), so they're always
// pulling two distinct trades on any given day rather than colliding.
export function tradeForDate(date, offset = 0, trades = TRADES) {
  return trades[(dayOfYear(date) + offset) % trades.length];
}

export { TOWNS, TRADES };
