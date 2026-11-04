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
];

export const LOOKUP_KEYS = PLANS.map((p) => p.lookupKey);

export function planById(id) {
  return PLANS.find((p) => p.id === id) || null;
}

// Which lead-page price a business pays: the partner price only when the
// business was referred by an active partner whose referrer row has
// partner_pricing on. Everything else gets the standard price.
export function pageLookupKeyFor(referrer) {
  return referrer && referrer.active === true && referrer.partner_pricing === true
    ? "enoma_page_partner_monthly"
    : "enoma_page_monthly";
}

// 1999 -> "$19.99"
export function formatAmount(cents) {
  if (!Number.isInteger(cents) || cents < 0) return null;
  return `$${(cents / 100).toFixed(2)}`;
}
