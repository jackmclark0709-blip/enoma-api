// Enoma's plans, in one place. Stripe holds the real amounts (looked up by
// `lookupKey`); `fallbackAmount` is what the pricing page shows before the
// live amount loads, or if Stripe can't be reached. Keep it in step with
// Stripe: tests/plans.test.js checks the pricing page against this file.
//
// To add a plan: create the Stripe price with a lookup key, add an entry
// here, and add a card to public/pricing/index.html with
// data-price-key="<lookupKey>".

// Prices decided Nov 18, 2026: $39/month or $390/year, and a founding price
// of $29/month for the first 25 paying customers (api/_lib/founding.js),
// locked while they stay subscribed. The $1 first month stays. The old
// 19.99/199 prices stay here only so existing subscriptions keep showing
// their own amounts; new checkouts never use them.
export const PLANS = [
  {
    id: "website",
    lookupKey: "website_monthly_39",
    name: "Your website",
    description: "We build your website from your Google reviews. You approve it. Cancel anytime.",
    fallbackAmount: 3900,
    interval: "month",
    public: true,
  },
  {
    id: "website_annual",
    lookupKey: "website_yearly_390",
    name: "Your website (yearly)",
    description: "We build your website from your Google reviews. You approve it. Billed yearly.",
    fallbackAmount: 39000,
    interval: "year",
    public: true,
  },
  {
    id: "website_founding",
    lookupKey: "website_founding_29",
    name: "Your website (founding price)",
    description: "Founding price for our first 25 customers: $29/month for as long as you stay.",
    fallbackAmount: 2900,
    interval: "month",
    // Monthly only. Checkout picks it while founding spots are left.
    founding: true,
    public: true,
  },
  {
    id: "page",
    lookupKey: "enoma_page_monthly",
    name: "Your website (2026 price)",
    fallbackAmount: 1999,
    interval: "month",
    // Legacy: existing subscriptions only.
    legacy: true,
    public: false,
  },
  {
    id: "page_annual",
    lookupKey: "enoma_page_annual",
    name: "Your website (yearly, 2026 price)",
    fallbackAmount: 19900,
    interval: "year",
    legacy: true,
    public: false,
  },
  {
    id: "page_partner",
    lookupKey: "enoma_page_partner_monthly",
    name: "Your website (partner price)",
    fallbackAmount: 999,
    interval: "month",
    // Only for businesses referred by a partner with partner_pricing on
    // (public.referrers). Never listed on the public pricing page.
    public: false,
  },
  {
    id: "page_first_month",
    lookupKey: "enoma_page_first_month",
    name: "Your website: first month",
    // One-time $1 price on the "Enoma Business Website" product (pricing v2,
    // api/_lib/pricing.js). Added as an extra Checkout line item next to the
    // recurring plan, which gets a 30-day trial. Not a plan of its own.
    fallbackAmount: 100,
    interval: null,
    oneTime: true,
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
    // $99/year per published page (Jack, Nov 11, 2026). Checkout and the
    // dashboard use the live Stripe amount; publishing on a yearly plan is
    // refused while the Stripe price is missing.
    fallbackAmount: 9900,
    interval: "year",
    // Only for owners on the yearly page plan (Stripe can't mix a monthly
    // item into a yearly subscription).
    public: true,
  },
];

export const LOOKUP_KEYS = PLANS.map((p) => p.lookupKey);

export function planById(id) {
  return PLANS.find((p) => p.id === id) || null;
}

export const MONTHLY_KEY = "website_monthly_39";
export const YEARLY_KEY = "website_yearly_390";
export const FOUNDING_KEY = "website_founding_29";

// Which website price a business pays. The partner price applies only when
// the business was referred by an active partner whose referrer row has
// partner_pricing on, and it is monthly-only (there is no partner yearly
// price). Otherwise the owner's chosen interval picks the price: "year" ->
// $390/year; anything else -> $29/month while founding spots are left
// (founding: true, api/_lib/founding.js), else $39/month.
export function pageLookupKeyFor(referrer, interval = "month", { founding = false } = {}) {
  if (referrer && referrer.active === true && referrer.partner_pricing === true) {
    return "enoma_page_partner_monthly";
  }
  if (interval === "year") return YEARLY_KEY;
  return founding ? FOUNDING_KEY : MONTHLY_KEY;
}

export function planByLookupKey(lookupKey) {
  return PLANS.find((p) => p.lookupKey === lookupKey) || null;
}

// 3900 -> "$39", 2999 -> "$29.99" (whole dollars drop the cents).
export function formatAmount(cents) {
  if (!Number.isInteger(cents) || cents < 0) return null;
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}
