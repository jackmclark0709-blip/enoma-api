// api/_lib/site-checks.js
// Objective, checkable signals that a prospect's existing website is weak —
// things you can point to on a call ("your site has no tap-to-call button on
// a phone"), not an LLM's opinion. Pure: takes the fetched HTML, no network.
//
// Why this exists: the LLM-only gap assessment in ga-metrics.js labeled
// ~98% of crawled sites "weak_site", so the label didn't separate anyone.
// These signals decide the tier; the LLM still adds color to the pitch.

const SIGNALS = [
  {
    id: "not_mobile_friendly",
    pitch: "Doesn't resize for phones — most homeowners search on mobile",
    test: html => !/<meta[^>]+name=["']?viewport/i.test(html),
  },
  {
    id: "no_tap_to_call",
    pitch: "No tap-to-call phone link, so mobile visitors can't call in one tap",
    test: html => !/href=["']?tel:/i.test(html),
  },
  {
    id: "no_contact_form",
    pitch: "No quote or contact form on the homepage",
    test: html => !/<form[\s>]/i.test(html),
  },
  {
    id: "not_https",
    pitch: "Not secure (no HTTPS) — browsers warn visitors away",
    test: (html, url) => /^http:\/\//i.test(String(url || "")),
  },
  {
    id: "stale_copyright",
    pitch: "Copyright year is years out of date, so the site looks abandoned",
    test: (html, url, now) => {
      const years = [...String(html).matchAll(/(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})/gi)].map(m => Number(m[1]));
      if (!years.length) return false;
      return Math.max(...years) <= now.getFullYear() - 3;
    },
  },
  {
    id: "thin_content",
    pitch: "Very little text, so Google has almost nothing to rank",
    test: html => {
      const text = String(html).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      return text.split(" ").length < 150;
    },
  },
];

/**
 * @param {string} html  raw HTML of the page actually fetched
 * @param {string} url   the URL we fetched (protocol matters for not_https)
 * @param {Date}   now
 * @returns {{ score: number, signals: string[], pitches: string[] }}
 */
export function siteChecks(html, url, now = new Date()) {
  if (!html) return { score: 0, signals: [], pitches: [] };
  const hits = SIGNALS.filter(s => {
    try { return s.test(String(html), url, now); } catch { return false; }
  });
  return { score: hits.length, signals: hits.map(h => h.id), pitches: hits.map(h => h.pitch) };
}

/**
 * Tier decision. Two or more objective problems = weak, zero = good, and
 * exactly one lets the LLM's read break the tie.
 */
export function decideSiteTier(checks, llmTier) {
  if (checks.score >= 2) return "weak_site";
  if (checks.score === 0) return "good_site";
  return llmTier === "good_site" ? "good_site" : "weak_site";
}
