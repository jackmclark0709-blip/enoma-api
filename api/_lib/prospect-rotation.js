// Rotates the daily_pipeline prospect pull across towns so the raw "new"
// pool doesn't saturate (Attleboro alone was fully mined in about a month at
// limit=25/trade/day). An explicit ?location= on the cron path still
// overrides this for one-off pulls.
//
// Oct 2026: national. Enoma is self-serve and every prospect gets their own
// page before we reach out, so nothing about the pitch needs a local market.
// Mid-size cities and suburbs with lots of owner-operated trades businesses,
// spread across regions and time zones; consecutive days land in different
// states so one bad market (or a local competitor) doesn't dominate a week.
const TOWNS = [
  "Plano, TX", "Boise, ID", "Knoxville, TN", "Chesapeake, VA", "Fort Collins, CO",
  "Grand Rapids, MI", "Sarasota, FL", "Columbia, SC", "Overland Park, KS", "Spokane, WA",
  "Lancaster, PA", "Huntsville, AL", "Fort Wayne, IN", "Gilbert, AZ", "Wilmington, NC",
  "Madison, WI", "Rochester, NY", "Tulsa, OK", "Des Moines, IA", "Reno, NV",
  "Lexington, KY", "Murfreesboro, TN", "Akron, OH", "Round Rock, TX", "Cape Coral, FL",
  "Greenville, SC", "Springfield, MO", "Salem, OR", "Rockford, IL", "Ogden, UT",
  "Manchester, NH", "Worcester, MA", "Lafayette, LA", "Fredericksburg, VA", "Savannah, GA",
  "Rochester, MN", "Santa Rosa, CA", "Allentown, PA", "Omaha, NE", "Albuquerque, NM",
  "Chattanooga, TN", "Lakeland, FL", "Toms River, NJ", "Frederick, MD", "Kalamazoo, MI",
  "Colorado Springs, CO", "Waco, TX", "Hartford, CT"
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
