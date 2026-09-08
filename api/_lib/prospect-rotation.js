// Rotates the daily_pipeline prospect pull across nearby towns so the raw
// "new" pool doesn't saturate. Attleboro, MA alone was fully mined after
// ~a month at limit=25/trade/day -- repeat pulls returned zero new listings
// (see enoma-dev-practices memory). An explicit ?location= query param on
// the cron path still overrides this for one-off/manual pulls.
const TOWNS = [
  "Attleboro, MA",
  "North Attleborough, MA",
  "Norton, MA",
  "Mansfield, MA",
  "Seekonk, MA",
  "Rehoboth, MA",
  "Pawtucket, RI"
];

function dayOfYear(date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const today = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.floor((today - start) / (24 * 60 * 60 * 1000));
}

export function townForDate(date, towns = TOWNS) {
  return towns[dayOfYear(date) % towns.length];
}

export { TOWNS };
