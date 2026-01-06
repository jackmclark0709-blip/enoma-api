import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // server-only env var on Vercel
);

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function absoluteBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

export default async function handler(req, res) {
  try {
    const slug = (req.query.slug || "").toString().trim();
    if (!slug) {
      res.status(400).send("Missing slug");
      return;
    }

    // 1) Fetch business by slug
    const { data: biz, error } = await supabase
      .from("businesses")
      .select("slug, name, seo_title, seo_description, og_image_url")
      .eq("slug", slug)
      .single();

    if (error || !biz) {
      res.status(404).send("Not found");
      return;
    }

    // 2) Read your single template
    const templatePath = path.join(process.cwd(), "public", "profile.html");
    let html = fs.readFileSync(templatePath, "utf8");

    // 3) Compute SEO values (fallbacks if missing)
    const baseUrl = absoluteBaseUrl(req);
    const canonical = `${baseUrl}/p/${encodeURIComponent(slug)}`;

    const title = biz.seo_title || `${biz.name} — Business Profile`;
    const desc =
      biz.seo_description ||
      `Learn more about ${biz.name}. Contact for pricing, availability, and quotes.`;

    // Choose OG image
    const ogImage =
      biz.og_image_url ||
      `${baseUrl}/assets/og/default-og.jpg`; // make sure this file exists

    // 4) Inject into <head>
    const replacements = {
      "{{SEO_TITLE}}": escapeHtml(title),
      "{{SEO_DESCRIPTION}}": escapeHtml(desc),
      "{{OG_TITLE}}": escapeHtml(title),
      "{{OG_DESCRIPTION}}": escapeHtml(desc),
      "{{OG_IMAGE}}": escapeHtml(ogImage),
      "{{CANONICAL_URL}}": escapeHtml(canonical)
    };

    for (const [needle, value] of Object.entries(replacements)) {
      html = html.split(needle).join(value);
    }

    // 5) Return HTML
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=300"); // 5 min edge cache (tweak later)
    res.status(200).send(html);
  } catch (e) {
    console.error(e);
    res.status(500).send("Server error");
  }
}
