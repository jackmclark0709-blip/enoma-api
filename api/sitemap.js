import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Static SEO landing pages — add new ones here as you build them
const STATIC_PAGES = [
  {
    url: "https://enoma.io",
    lastmod: "2026-03-28",
    changefreq: "weekly",
    priority: "1.0",
  },
  {
    url: "https://enoma.io/examples",
    lastmod: "2026-03-28",
    changefreq: "weekly",
    priority: "0.9",
  },
  {
    url: "https://enoma.io/for/landscaping-websites-massachusetts",
    lastmod: "2026-03-28",
    changefreq: "monthly",
    priority: "0.9",
  },
  {
    url: "https://enoma.io/for/plumber-websites-massachusetts",
    lastmod: "2026-03-28",
    changefreq: "monthly",
    priority: "0.9",
  },
  {
    url: "https://enoma.io/for/lawn-care-website-agawam-ma",
    lastmod: "2026-03-28",
    changefreq: "monthly",
    priority: "0.85",
  },
  {
    url: "https://enoma.io/for/plumber-website-attleboro-ma",
    lastmod: "2026-03-28",
    changefreq: "monthly",
    priority: "0.85",
  },
  {
    url: "https://enoma.io/for/website-for-local-service-business",
    lastmod: "2026-03-28",
    changefreq: "monthly",
    priority: "0.85",
  },
];

export default async function handler(req, res) {
  try {
    // Fetch all public business profile pages
    const { data: profiles, error } = await supabase
      .from("small_business_profiles")
      .select("username, updated_at")
      .eq("is_public", true)
      .not("username", "is", null)
      .order("updated_at", { ascending: false });

    if (error) throw error;

    // Build static page entries
    const staticEntries = STATIC_PAGES.map(
      (page) => `
      <url>
        <loc>${page.url}</loc>
        <lastmod>${page.lastmod}</lastmod>
        <changefreq>${page.changefreq}</changefreq>
        <priority>${page.priority}</priority>
      </url>`
    ).join("");

    // Build dynamic profile page entries
    const profileEntries = (profiles || [])
      .map(
        (p) => `
      <url>
        <loc>https://enoma.io/${p.username}</loc>
        <lastmod>${p.updated_at}</lastmod>
        <changefreq>weekly</changefreq>
        <priority>0.8</priority>
      </url>`
      )
      .join("");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${staticEntries}
${profileEntries}
</urlset>`;

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=3600");
    res.status(200).send(xml);
  } catch (err) {
    console.error("Sitemap error:", err);
    res.status(500).send("Error generating sitemap");
  }
}
