// What's done and what's still missing on a business's page. Shown to the
// owner in the claim box ("Your page is 40% done") and as "Quick wins" on
// the dashboard. The open items are the concrete improvements $19.99/month
// buys: Jack adds them with the owner. Pure, read from the page's own
// profile data, so every line is true for this business. Used by
// public/scripts/profile.js and public/dashboard/index.html; tested in
// tests/page-checklist.test.js.

const isImageUrl = (u) => /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(String(u || ""));
const answered = v => v === true || v === false;

// Missing items are nudged in this order: what moves a stranger to call
// most first. Items not listed here follow in checklist order.
export const IMPACT_ORDER = ["photos", "owner_blurb", "response_time", "license_insured", "free_estimates"];

export function pageChecklist(p = {}) {
  const attachments = Array.isArray(p.attachments) ? p.attachments : [];
  const photos = attachments.some(a => isImageUrl(typeof a === "string" ? a : a?.url))
    || (Array.isArray(p.images) && p.images.length > 0)
    || (Array.isArray(p.before_after_images) && p.before_after_images.length > 0);
  const towns = Array.isArray(p.service_area) ? p.service_area.filter(Boolean).length : 0;
  const reviews = Array.isArray(p.testimonials) ? p.testimonials.filter(t => t?.quote).length : 0;

  const items = [
    { id: "services", label: "Services", done: Array.isArray(p.services) && p.services.length > 0 },
    { id: "contact", label: "Phone and quote form", done: !!p.phone },
    { id: "rating", label: "Google rating", done: Number(p.average_rating) > 0 },
    { id: "photos", label: "Your photos", done: photos, tip: "Photos of real jobs are the first thing people look for." },
    { id: "owner_blurb", label: "A few words about you", done: !!p.owner_blurb, tip: "People hire people. Two or three sentences in your own words." },
    { id: "response_time", label: "How fast you reply", done: !!String(p.response_time || "").trim(), tip: "Shows \"Usually replies within 2 hours\" by your call button." },
    { id: "license_insured", label: "License and insurance", done: !!p.license_number || answered(p.is_insured), tip: "Your license number and whether you're insured, if you are." },
    { id: "free_estimates", label: "Free estimates (yes or no)", done: answered(p.offers_free_estimates), tip: "If your estimates are free, your page can say so." },
    { id: "logo", label: "Your logo", done: !!p.logo_url },
    { id: "towns", label: "Every town you serve", done: towns >= 3 },
    { id: "reviews", label: "More of your reviews", done: reviews >= 3 },
  ];
  const done = items.filter(i => i.done).length;
  // Rounded to the nearest 10, and never shown as 100%: there's always more.
  const percent = Math.min(90, Math.round((done / items.length) * 10) * 10);
  return { items, done, total: items.length, percent };
}

/** The missing items, most useful first (IMPACT_ORDER, then the rest). */
export function nextSteps(p = {}) {
  const rank = id => { const i = IMPACT_ORDER.indexOf(id); return i === -1 ? IMPACT_ORDER.length : i; };
  return pageChecklist(p).items
    .map((item, i) => ({ ...item, i }))
    .filter(item => !item.done)
    .sort((a, b) => rank(a.id) - rank(b.id) || a.i - b.i)
    .map(({ i, ...item }) => item);
}
