import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // server-only env var on Vercel
);

const BUSINESS_TYPE_MAP = {
  landscaping: "LandscapingBusiness",
  plumber: "Plumber",
  plumbing: "Plumber",
  hvac: "HVACBusiness",
  heating: "HVACBusiness",
  electrician: "Electrician",
  locksmith: "Locksmith",
  painter: "HousePainter",
  roofing: "RoofingContractor",
  cleaning: "CleaningService"
};

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

function safeJsonForInlineScript(obj) {
  // Prevent closing the script tag: </script>
  return JSON.stringify(obj).replace(/<\//g, "<\\/");
}

function guessSchemaType(primaryCategory) {
  if (!primaryCategory) return "LocalBusiness";
  const key = String(primaryCategory).toLowerCase().trim();
  return BUSINESS_TYPE_MAP[key] || "LocalBusiness";
}

export default async function handler(req, res) {
  try {
    const slug = (req.query.slug || "").toString().trim();
    if (!slug) return res.status(400).send("Missing slug");

    // -----------------------------
    // Canonical source of truth:
    // small_business_profiles.username = slug
    // -----------------------------
    const { data: profile, error } = await supabase
      .from("small_business_profiles")
      .select("*")
      .eq("username", slug)
      .eq("is_public", true)
      .maybeSingle();

    if (error) {
      console.error("Profile lookup error:", error);
      return res.status(500).send("Server error");
    }

    if (!profile) {
      return res.status(404).send("Not found");
    }

    const baseUrl = absoluteBaseUrl(req);
    const canonical = `${baseUrl}/${encodeURIComponent(slug)}`;

    // -----------------------------
    // SEO values (profiles only)
    // -----------------------------
    const businessName = profile.business_name || slug;

    const seoTitle =
      profile.seo_title ||
      `${businessName} | Business Profile`;

    const seoDescription =
      profile.seo_description ||
      `Learn about ${businessName}, services, and how to get in touch.`;

    const ogImage =
      profile.logo_url ||
      "";

    const robots = profile.is_public ? "index,follow" : "noindex,nofollow";

    // -----------------------------
    // Structured data helpers
    // -----------------------------
    function collectSameAs(p) {
      const urls = new Set();

      // Website (if provided)
      if (p?.website) urls.add(p.website);

      // social_links jsonb (supports object or array)
      const sl = p?.social_links;
      if (Array.isArray(sl)) {
        sl.forEach(u => {
          if (typeof u === "string" && u.trim()) urls.add(u.trim());
        });
      } else if (sl && typeof sl === "object") {
        Object.values(sl).forEach(u => {
          if (typeof u === "string" && u.trim()) urls.add(u.trim());
        });
      }

      // Google Maps link from place_id (if present)
      if (p?.google_place_id) {
        urls.add(
          `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(
            p.google_place_id
          )}`
        );
      }

      return Array.from(urls).filter(Boolean);
    }

    // -----------------------------
    // Build LocalBusiness schema (profiles only)
    // -----------------------------
    const schemaType = guessSchemaType(profile.primary_category);

    const localBusinessSchema = {
      "@context": "https://schema.org",
      "@type": schemaType,
      "@id": canonical,
      name: businessName,
      url: canonical,
      telephone: profile.phone || undefined,
      address: profile.address || profile.city || profile.state
        ? {
            "@type": "PostalAddress",
            ...(profile.address ? { streetAddress: profile.address } : {}),
            ...(profile.city ? { addressLocality: profile.city } : {}),
            ...(profile.state ? { addressRegion: profile.state } : {}),
            addressCountry: "US"
          }
        : undefined,
      areaServed: Array.isArray(profile.service_area)
        ? profile.service_area.map((a) => ({ "@type": "AdministrativeArea", name: a }))
        : undefined,
      sameAs: collectSameAs(profile)
    };

    // -----------------------------
    // Load template and replace tokens
    // -----------------------------
    const templatePath = path.join(process.cwd(), "public", "profile.html");
    let html = fs.readFileSync(templatePath, "utf8");

    const replacements = {
      "{{FINAL_TITLE}}": escapeHtml(seoTitle),
      "{{FINAL_DESCRIPTION}}": escapeHtml(seoDescription),
      "{{FINAL_OG_IMAGE}}": escapeHtml(ogImage),
      "{{FINAL_CANONICAL_URL}}": escapeHtml(canonical),

      "{{ROBOTS}}": escapeHtml(robots),

      // Server-injected profile for fast render / consistent SEO
      "{{PROFILE_JSON}}": safeJsonForInlineScript(profile || {}),

      // Minimal SSR body content (JS will overwrite, but crawlers get text immediately)
      "{{BUSINESS_NAME}}": escapeHtml(profile.business_name || ""),
      "{{HERO_HEADLINE}}": escapeHtml(profile.hero_headline || ""),
      "{{HERO_TAGLINE}}": escapeHtml(profile.hero_tagline || ""),
      "{{ABOUT}}": escapeHtml(profile.about || ""),
      "{{SERVICES_INTRO}}": escapeHtml(profile.services_intro || ""),

      // Structured data
      "{{LOCAL_BUSINESS_SCHEMA}}": escapeHtml(JSON.stringify(localBusinessSchema))
    };

    for (const [needle, value] of Object.entries(replacements)) {
      html = html.split(needle).join(value);
    }

    // -----------------------------
    // Return HTML
    // -----------------------------
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=300");
    return res.status(200).send(html);
  } catch (e) {
    console.error(e);
    return res.status(500).send("Server error");
  }
}
