// api/_lib/founding.js
// Founding price (decided Nov 18, 2026): $29/month for the first 25 paying
// customers, locked while they stay subscribed (it's the price on their
// Stripe subscription, so it never changes under them).
//
// "Paying customer" = a non-internal business whose subscriptions row has
// ever had a Stripe subscription (provider 'stripe' and a
// stripe_subscription_id). Comped businesses (provider 'comped') and the
// preview-trial placeholder rows (no stripe_subscription_id) don't count.
// Checkout uses the founding price while fewer than 25 have; after that the
// standard $39/month. Yearly is always $390/year.

export const FOUNDING_LIMIT = 25;

/** Pure: how many founding spots are left after `paidCount` paying customers. */
export function foundingSpotsLeft(paidCount, limit = FOUNDING_LIMIT) {
  const n = Number.isInteger(paidCount) && paidCount > 0 ? paidCount : 0;
  return Math.max(0, limit - n);
}

/** Pure: does the next monthly checkout get the founding price? */
export function foundingOpen(paidCount, limit = FOUNDING_LIMIT) {
  return foundingSpotsLeft(paidCount, limit) > 0;
}

/** Pure: the paid count from subscriptions rows + the internal business ids. */
export function countPaid(subRows, internalIds = new Set()) {
  const ids = new Set();
  for (const r of Array.isArray(subRows) ? subRows : []) {
    if (r?.provider === "stripe" && r.stripe_subscription_id && !internalIds.has(r.business_id)) ids.add(r.business_id);
  }
  return ids.size;
}

/**
 * Paying customers so far (two reads). Throws on a read error: checkout then
 * falls back to the standard price rather than over-granting the founding one.
 */
export async function loadPaidCount(supabase) {
  const { data: subs, error } = await supabase.from("subscriptions")
    .select("business_id, provider, stripe_subscription_id")
    .eq("provider", "stripe").not("stripe_subscription_id", "is", null);
  if (error) throw new Error(error.message);
  const ids = [...new Set((subs || []).map(r => r.business_id))];
  if (!ids.length) return 0;
  const { data: biz, error: bErr } = await supabase.from("businesses").select("id, is_internal").in("id", ids);
  if (bErr) throw new Error(bErr.message);
  return countPaid(subs, new Set((biz || []).filter(b => b.is_internal === true).map(b => b.id)));
}

/** { limit, paid, left, open } for checkout and the pages that show the offer. */
export async function foundingState(supabase) {
  const paid = await loadPaidCount(supabase);
  return { limit: FOUNDING_LIMIT, paid, left: foundingSpotsLeft(paid), open: foundingOpen(paid) };
}
