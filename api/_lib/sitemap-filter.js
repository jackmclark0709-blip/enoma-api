// api/_lib/sitemap-filter.js
// Which business pages belong in the sitemap. Test pages, QA pages and
// Enoma's own internal/demo pages are real, visitable URLs but must not be
// handed to Google as if they were customer businesses.

const TEST_LIKE = /(^|[-\s])(test|qc|demo|sample)([-\s]|\d|$)/i;
// One-off junk pages with no test-like name. Add a username here to drop it.
const EXCLUDED_USERNAMES = new Set(["cars"]);

export function isSitemapListable(profile) {
  if (!profile?.username) return false;
  if (EXCLUDED_USERNAMES.has(profile.username)) return false;
  if (profile.businesses?.is_internal) return false;
  if (TEST_LIKE.test(profile.username) || TEST_LIKE.test(profile.business_name || "")) return false;
  return true;
}
