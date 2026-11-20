// api/_lib/preview-cleanup.js
// Unclaimed previews nobody wants: which to remove, and why.
//
// A preview is a page Enoma built for a business that didn't ask for it. It
// holds Google listing content (reviews, hours, rating) copied from the
// Places API, which Google's Places policies say not to store beyond their
// allowed exceptions (place_id is exempt). So a preview that isn't going
// anywhere is deleted: its profile (fact sheet, copy, reviews), its business
// row and what cascades from it. The prospect row stays, with only its
// place_id and contact status, so the business is never rebuilt or emailed
// against its wishes.
//
// Pure: the I/O lives in api/ga-metrics.js (action=preview_cleanup), which
// only deletes when PREVIEW_CLEANUP_APPLY=1; otherwise it reports.

const DAY = 86400000;
export const PREVIEW_WINDOW_DAYS = 90; // matches PREVIEW_TRIAL_DAYS
export const PREVIEW_IDLE_DAYS = 45;   // no visit at all after the outreach follow-ups are done

const str = v => (v == null ? "" : String(v).trim());
const t = v => { const n = Date.parse(v || ""); return Number.isFinite(n) ? n : null; };

/**
 * rows: {
 *   profiles:  [{ business_id, username, is_claimed, is_public, created_at }]   (unclaimed only is fine)
 *   businesses:[{ id, is_internal, created_at }]
 *   subs:      [{ business_id, provider, status, is_trial, trial_expires_at, stripe_subscription_id }]
 *   members:   [{ business_id }]           (anyone signed up to manage it)
 *   leads:     [{ business_id }]           (contact_submissions: real customer leads)
 *   visited:   Set of slugs with a human page view
 *   prospects: [{ preview_business_id, preview_first_viewed_at, status }]
 * }
 * → { remove: [{ business_id, slug, reason }], kept: { reason: count } }
 */
export function pickPreviewsToRemove(rows, { now = Date.now(), windowDays = PREVIEW_WINDOW_DAYS, idleDays = PREVIEW_IDLE_DAYS, keepSlugs = [] } = {}) {
  const biz = new Map((rows.businesses || []).map(b => [b.id, b]));
  const subsBy = new Map();
  for (const s of rows.subs || []) (subsBy.get(s.business_id) || subsBy.set(s.business_id, []).get(s.business_id)).push(s);
  const members = new Set((rows.members || []).map(m => m.business_id));
  const leads = new Set((rows.leads || []).map(l => l.business_id));
  const visited = rows.visited instanceof Set ? rows.visited : new Set(rows.visited || []);
  const prospectBy = new Map((rows.prospects || []).filter(p => p.preview_business_id).map(p => [p.preview_business_id, p]));
  const keep = new Set(keepSlugs.map(s => str(s).toLowerCase()).filter(Boolean));
  const kept = {};
  const remove = [];
  const hold = r => { kept[r] = (kept[r] || 0) + 1; };

  for (const p of rows.profiles || []) {
    const id = p.business_id;
    const slug = str(p.username);
    const b = biz.get(id);
    const subs = subsBy.get(id) || [];
    const prospect = prospectBy.get(id);
    if (!b) { hold("no_business_row"); continue; }
    if (b.is_internal) { hold("internal"); continue; }
    if (p.is_claimed) { hold("claimed"); continue; }
    if (keep.has(slug.toLowerCase())) { hold("keep_list"); continue; }
    if (members.has(id)) { hold("has_account"); continue; }
    if (leads.has(id)) { hold("has_leads"); continue; }
    // Anything that ever became a real subscription (paid, card on file, comped).
    if (subs.some(s => s.provider === "comped" || str(s.stripe_subscription_id) || (s.status === "active" && !s.is_trial))) { hold("customer"); continue; }

    // The owner asked us to take it down, or it was unpublished (unsubscribe, spam complaint).
    if (prospect?.status === "removed_by_owner") { remove.push({ business_id: id, slug, reason: "owner_removed" }); continue; }
    if (p.is_public === false) { remove.push({ business_id: id, slug, reason: "unpublished" }); continue; }

    const created = t(b.created_at) ?? t(p.created_at) ?? now;
    const ends = subs.map(s => t(s.trial_expires_at)).filter(x => x != null);
    const windowEnd = ends.length ? Math.max(...ends) : created + windowDays * DAY;
    if (now >= windowEnd) { remove.push({ business_id: id, slug, reason: "window_ended" }); continue; }

    const seen = visited.has(slug) || !!prospect?.preview_first_viewed_at;
    if (!seen && now - created >= idleDays * DAY) { remove.push({ business_id: id, slug, reason: "never_visited" }); continue; }
    hold(seen ? "visited_in_window" : "in_window");
  }
  return { remove, kept };
}

// What's left of prospects.raw after cleanup: only the inbound form's
// ip_hash (rate limiting). Everything copied from Google/Outscraper goes.
export function trimProspectRaw(raw) {
  return raw && typeof raw === "object" && raw.ip_hash ? { ip_hash: raw.ip_hash } : null;
}
