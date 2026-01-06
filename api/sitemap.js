import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  try {
    // 1. Fetch all public business slugs
    const { data, error } = await supabase
      .from("businesses")
      .select("slug, updated_at")
      .eq("is_published", true);

    if (error) throw error;

    const baseUrl =
      (req.headers["x-forwarded-proto"] || "https") +
      "://" +
      (req.headers["x-forwarded-host"] || req.headers.host);

    // 2. Build XML
    const urls = data.map(biz => `
      <url>
        <loc>${baseUrl}/${biz.slug}</loc>
        <lastmod>${new Date(biz.updated_at).toISOString()}</lastmod>
        <changefreq>weekly</changefreq>
        <priority>0.8</priority>
      </url>
    `).join("");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;

    // 3. Send response
    res.setHeader("Content-Type", "application/xml");
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=3600");
    res.status(200).send(xml);

  } catch (err) {
    console.error("Sitemap error:", err);
    res.status(500).send("Error generating sitemap");
  }
}
