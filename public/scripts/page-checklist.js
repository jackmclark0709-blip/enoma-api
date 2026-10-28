// What's done and what's still missing on a business's page, shown to the
// owner in the claim box ("Your page is 40% done"). The open items are the
// concrete improvements $19.99/month buys: Jack adds them with the owner.
// Pure, read from the page's own profile data, so every line is true for
// this business. Used by profile.html; tested in tests/page-checklist.test.js.

const isImageUrl = (u) => /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(String(u || ""));

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
    { id: "photos", label: "Your photos", done: photos },
    { id: "logo", label: "Your logo", done: !!p.logo_url },
    { id: "towns", label: "Every town you serve", done: towns >= 3 },
    { id: "reviews", label: "More of your reviews", done: reviews >= 3 },
  ];
  const done = items.filter(i => i.done).length;
  // Rounded to the nearest 10, and never shown as 100%: there's always more.
  const percent = Math.min(90, Math.round((done / items.length) * 10) * 10);
  return { items, done, total: items.length, percent };
}
