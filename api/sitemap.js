import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function absoluteBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

export default async function handler(req, res) {
  try {
    // Canonical source of "published pages": small_business_profiles.is_public
    const { data, error } = await supabase
      .from("small_business_profiles")
      .select("username, updated_at")
      .eq("is_public", true);

    if (error) throw error;

    const baseUrl = absoluteBaseUrl(req);

    const urls = (data || [])
      .filter((row) => row.username)
      .map((row) => {
        const lastmod = row.updated_at
          ? new Date(row.updated_at).toISOString()
          : new Date().toISOString();

        return `
      <url>
        <loc>${baseUrl}/${encodeURIComponent(row.username)}</loc>
        <lastmod>${lastmod}</lastmod>
        <changefreq>weekly</changefreq>
        <priority>0.8</priority>
      </url>`;
      })
      .join("");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;

    res.setHeader("Content-Type", "application/xml");
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=3600");
    res.status(200).send(xml);
  } catch (err) {
    console.error("Sitemap error:", err);
    res.status(500).send("Error generating sitemap");
  }
}
