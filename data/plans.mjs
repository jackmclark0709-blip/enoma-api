// Enoma's plans, in one place. Stripe holds the real amounts (looked up by
// `lookupKey`); `fallbackAmount` is what the pricing page shows before the
// live amount loads, or if Stripe can't be reached. Keep it in step with
// Stripe: tests/plans.test.js checks the pricing page against this file.
//
// To add a plan: create the Stripe price with a lookup key, add an entry
// here, and add a card to public/pricing/index.html with
// data-price-key="<lookupKey>".

export const PLANS = [
  {
    id: "page",
    lookupKey: "enoma_page_monthly",
    name: "Your Enoma page",
    fallbackAmount: 1999,
    interval: "month",
    public: true,
  },
  {
    id: "page_annual",
    lookupKey: "enoma_page_annual",
    name: "Your Enoma page (yearly)",
    fallbackAmount: 19900,
    interval: "year",
    public: true,
  },
  {
    id: "page_partner",
    lookupKey: "enoma_page_partner_monthly",
    name: "Your Enoma page (partner price)",
    fallbackAmount: 999,
    interval: "month",
    // Only for businesses referred by a partner with partner_pricing on
    // (public.referrers). Never listed on the public pricing page.
    public: false,
  },
  {
    id: "spotlight",
    lookupKey: "enoma_spotlight_monthly",
    name: "Service Spotlight page",
    fallbackAmount: 999,
    interval: "month",
    public: true,
  },
  {
    id: "spotlight_annual",
    lookupKey: "enoma_spotlight_yearly",
    name: "Service Spotlight page (yearly)",
    // Placeholder until Jack creates the Stripe price: the dashboard and
    // checkout always use the live Stripe amount, and publishing on a yearly
    // plan is refused while the price is missing.
    fallbackAmount: 9900,
    interval: "year",
    // Only for owners on the yearly page plan (Stripe can't mix a monthly
    // item into a yearly subscription). Not on the pricing page until the
    // amount is confirmed.
    public: false,
  },
];

export const LOOKUP_KEYS = PLANS.map((p) => p.lookupKey);

export function planById(id) {
  return PLANS.find((p) => p.id === id) || null;
}

// Which lead-page price a business pays. The partner price applies only when
// the business was referred by an active partner whose referrer row has
// partner_pricing on, and it is monthly-only (there is no partner yearly
// price). Otherwise the owner's chosen interval picks the price: "year" ->
// $199/year, anything else -> $19.99/month.
export function pageLookupKeyFor(referrer, interval = "month") {
  if (referrer && referrer.active === true && referrer.partner_pricing === true) {
    return "enoma_page_partner_monthly";
  }
  return interval === "year" ? "enoma_page_annual" : "enoma_page_monthly";
}

export function planByLookupKey(lookupKey) {
  return PLANS.find((p) => p.lookupKey === lookupKey) || null;
}

// 1999 -> "$19.99", 19900 -> "$199" (whole dollars drop the cents).
export function formatAmount(cents) {
  if (!Number.isInteger(cents) || cents < 0) return null;
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}
