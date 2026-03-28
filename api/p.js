// api/p.js
// CHANGES FROM PREVIOUS VERSION:
// 1. Checks website_is_active() before serving the page
// 2. If trial expired and no paid sub, shows a clean "inactive" page
//    with a subscribe CTA instead of the profile
// 3. Fixed LOCAL_BUSINESS_SCHEMA escaping (from previous fix session)

import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
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
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function absoluteBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

function safeJsonForInlineScript(obj) {
  return JSON.stringify(obj).replace(/<\//g, "<\\/");
}

function guessSchemaType(primaryCategory) {
  if (!primaryCategory) return "LocalBusiness";
  const key = String(primaryCategory).toLowerCase().trim();
  return BUSINESS_TYPE_MAP[key] || "LocalBusiness";
}

// Clean "inactive" page shown when trial has expired and no subscription
function inactivePage(businessName, baseUrl) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(businessName)} — Enoma</title>
  <meta name="robots" content="noindex,nofollow" />
  <link rel="stylesheet" href="/styles/enoma.css" />
  <style>
    body { background: #f6f7fb; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 2rem; }
    .card { background: white; border-radius: 20px; padding: 3rem 2.5rem; max-width: 480px; text-align: center; box-shadow: 0 20px 60px rgba(0,0,0,0.08); border: 1px solid #e5e7eb; }
    h1 { font-size: 1.4rem; color: #211551; margin: 0 0 0.75rem; }
    p { color: #6b7280; line-height: 1.6; margin: 0 0 1.5rem; }
    .btn { display: inline-block; background: #9A8CFF; color: #0b0a14; padding: 0.85rem 2rem; border-radius: 999px; font-weight: 700; text-decoration: none; }
    .business-name { font-size: 1rem; color: #9ca3af; margin-bottom: 1.5rem; }
  </style>
</head>
<body>
  <div class="card">
    <p class="business-name">${escapeHtml(businessName)}</p>
    <h1>This website is currently inactive</h1>
    <p>This Enoma website's free trial has ended. The business owner can reactivate it by subscribing.</p>
    <a href="${baseUrl}" class="btn">Learn about Enoma →</a>
  </div>
</body>
</html>`;
}

// ── OG Image generation (folded in to avoid Vercel function count limit) ──
const TRADE_COLORS_OG = {
  landscaping:  { bg: "#0d1f0f", accent: "#2d6a2d", light: "#4a9e3a", label: "Landscaping" },
  plumbing:     { bg: "#0a1628", accent: "#1e5a96", light: "#3882dc", label: "Plumbing & Heating" },
  hvac:         { bg: "#0b1a24", accent: "#1a7a9a", light: "#2aa8cc", label: "HVAC" },
  electrical:   { bg: "#1a1400", accent: "#c09010", light: "#f0b820", label: "Electrical" },
  cleaning:     { bg: "#091820", accent: "#1a8a6a", light: "#22b894", label: "Cleaning" },
  contractor:   { bg: "#1a1208", accent: "#8a5a20", light: "#c08030", label: "Contractor" },
};

function generateOgSvg(profile) {
  const cat = (profile.primary_category || "").toLowerCase();
  const c = TRADE_COLORS_OG[cat] || { bg: "#0a1628", accent: "#3882dc", light: "#5aa8f0", label: "Local Business" };
  const name = (profile.business_name || "Local Business").slice(0, 36);
  const city = profile.city && profile.state ? `${profile.city}, ${profile.state}` : (profile.city || "");
  const tagline = (profile.hero_tagline || profile.seo_description || "").slice(0, 80);
  const phone = profile.phone || "";
  const services = Array.isArray(profile.services) ? profile.services.slice(0, 4) : [];
  const xe = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const pills = services.map((s, i) => {
    const x = 60 + i * 220;
    return `<rect x="${x}" y="490" width="200" height="36" rx="18" fill="rgba(255,255,255,0.1)" stroke="rgba(255,255,255,0.2)" stroke-width="1"/><text x="${x+100}" y="513" font-family="system-ui,sans-serif" font-size="14" font-weight="600" fill="rgba(255,255,255,0.85)" text-anchor="middle">${xe((s.service_name||s.name||"").slice(0,18))}</text>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${c.bg}"/><stop offset="100%" stop-color="${c.accent}" stop-opacity="0.3"/></linearGradient><linearGradient id="ab" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="${c.light}"/><stop offset="100%" stop-color="${c.accent}"/></linearGradient></defs><rect width="1200" height="630" fill="url(#bg)"/><rect x="0" y="0" width="8" height="630" fill="url(#ab)"/><rect x="60" y="60" width="${c.label.length*9+40}" height="32" rx="16" fill="${c.accent}" opacity="0.7"/><text x="${60+(c.label.length*9+40)/2}" y="81" font-family="system-ui,sans-serif" font-size="13" font-weight="700" fill="white" text-anchor="middle">${xe(c.label.toUpperCase())}</text><text x="60" y="175" font-family="system-ui,sans-serif" font-size="${name.length>24?52:62}" font-weight="800" fill="white" letter-spacing="-1">${xe(name)}</text>${city?`<text x="60" y="225" font-family="system-ui,sans-serif" font-size="24" font-weight="500" fill="${c.light}">📍 ${xe(city)}</text>`:""}<rect x="60" y="252" width="120" height="4" rx="2" fill="${c.light}" opacity="0.7"/>${tagline?`<text x="60" y="306" font-family="system-ui,sans-serif" font-size="22" fill="rgba(255,255,255,0.7)">${xe(tagline.slice(0,75))}</text>`:""}${phone?`<text x="60" y="400" font-family="system-ui,sans-serif" font-size="26" font-weight="700" fill="${c.light}">📞 ${xe(phone)}</text>`:""}${pills}<rect x="1000" y="578" width="180" height="40" rx="8" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.1)" stroke-width="1"/><text x="1090" y="604" font-family="system-ui,sans-serif" font-size="15" font-weight="700" fill="rgba(255,255,255,0.5)" text-anchor="middle">Powered by Enoma</text><circle cx="1200" cy="0" r="400" fill="${c.light}" opacity="0.05"/></svg>`;
}

export default async function handler(req, res) {
  // ── OG image route: /api/p?og=1&slug=... ──
  if (req.query.og === "1") {
    const slug = req.query.slug;
    if (!slug) return res.status(400).send("Missing slug");
    try {
      const { data: profile } = await supabase
        .from("small_business_profiles")
        .select("business_name,city,state,phone,primary_category,hero_tagline,seo_description,services")
        .eq("username", slug)
        .maybeSingle();
      if (!profile) return res.status(404).send("Not found");
      res.setHeader("Content-Type", "image/svg+xml");
      res.setHeader("Cache-Control", "public, max-age=604800, s-maxage=604800");
      return res.status(200).send(generateOgSvg(profile));
    } catch(e) {
      return res.status(500).send("Error");
    }
  }
  try {
    const slug = (req.query.slug || "").toString().trim();
    if (!slug) return res.status(400).send("Missing slug");

    // Fetch profile
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

    if (!profile) return res.status(404).send("Not found");

    const baseUrl = absoluteBaseUrl(req);

    // Check if website is active (trial or paid subscription)
    if (profile.business_id) {
      const { data: activeCheck } = await supabase
        .rpc("website_is_active", { p_business_id: profile.business_id });

      if (activeCheck === false) {
        // Trial expired, no active subscription
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60");
        return res.status(200).send(inactivePage(profile.business_name || slug, baseUrl));
      }
    }

    const canonical = `${baseUrl}/${encodeURIComponent(slug)}`;
    const businessName = profile.business_name || slug;
    const seoTitle = profile.seo_title || `${businessName} | Business Website`;
    const seoDescription = profile.seo_description || `Learn about ${businessName}, services, and how to get in touch.`;
    // OG image: prefer first photo attachment, then logo, then fallback to generated card
    const firstPhoto = Array.isArray(profile.attachments) && profile.attachments.length
      ? (typeof profile.attachments[0] === "string" ? profile.attachments[0] : profile.attachments[0]?.url)
      : null;
    const ogImage = firstPhoto || profile.logo_url || `${baseUrl}/api/p?og=1&slug=${encodeURIComponent(slug)}`;
    const robots = profile.is_public ? "index,follow" : "noindex,nofollow";

    function collectSameAs(p) {
      const urls = new Set();
      if (p?.website) urls.add(p.website);
      const sl = p?.social_links;
      if (Array.isArray(sl)) {
        sl.forEach(u => { if (typeof u === "string" && u.trim()) urls.add(u.trim()); });
      } else if (sl && typeof sl === "object") {
        Object.values(sl).forEach(u => { if (typeof u === "string" && u.trim()) urls.add(u.trim()); });
      }
      if (p?.google_place_id) {
        urls.add(`https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(p.google_place_id)}`);
      }
      return Array.from(urls).filter(Boolean);
    }

    const schemaType = guessSchemaType(profile.primary_category);
    const localBusinessSchema = {
      "@context": "https://schema.org",
      "@type": schemaType,
      "@id": canonical,
      name: businessName,
      url: canonical,
      telephone: profile.phone || undefined,
      address: (profile.address || profile.city || profile.state)
        ? {
            "@type": "PostalAddress",
            ...(profile.address ? { streetAddress: profile.address } : {}),
            ...(profile.city ? { addressLocality: profile.city } : {}),
            ...(profile.state ? { addressRegion: profile.state } : {}),
            addressCountry: "US"
          }
        : undefined,
      areaServed: Array.isArray(profile.service_area)
        ? profile.service_area.map(a => ({ "@type": "AdministrativeArea", name: a }))
        : undefined,
      sameAs: collectSameAs(profile),
      priceRange: "$$",
      image: firstPhoto || profile.logo_url || undefined,
      ...(Array.isArray(profile.services) && profile.services.length ? {
        hasOfferCatalog: {
          "@type": "OfferCatalog",
          name: `${businessName} Services`,
          itemListElement: profile.services.map((s, i) => ({
            "@type": "Offer",
            itemOffered: {
              "@type": "Service",
              name: s.service_name || s.name || "",
              description: s.service_description || undefined
            }
          }))
        }
      } : {}),
      ...(profile.hero_availability ? {
        openingHoursSpecification: [{
          "@type": "OpeningHoursSpecification",
          description: profile.hero_availability
        }]
      } : {})
    };

    const templatePath = path.join(process.cwd(), "public", "profile.html");
    let html = fs.readFileSync(templatePath, "utf8");

    const replacements = {
      "{{FINAL_TITLE}}": escapeHtml(seoTitle),
      "{{FINAL_DESCRIPTION}}": escapeHtml(seoDescription),
      "{{FINAL_OG_IMAGE}}": escapeHtml(ogImage),
      "{{FINAL_CANONICAL_URL}}": escapeHtml(canonical),
      "{{ROBOTS}}": escapeHtml(robots),
      "{{PROFILE_JSON}}": safeJsonForInlineScript(profile || {}),
      "{{BUSINESS_NAME}}": escapeHtml(profile.business_name || ""),
      "{{HERO_HEADLINE}}": escapeHtml(profile.hero_headline || ""),
      "{{HERO_TAGLINE}}": escapeHtml(profile.hero_tagline || ""),
      "{{ABOUT}}": escapeHtml(profile.about || ""),
      "{{SERVICES_INTRO}}": escapeHtml(profile.services_intro || ""),
      // FIX: use safeJsonForInlineScript not escapeHtml for structured data
      "{{LOCAL_BUSINESS_SCHEMA}}": safeJsonForInlineScript(localBusinessSchema)
    };

    for (const [needle, value] of Object.entries(replacements)) {
      html = html.split(needle).join(value);
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=300");
    return res.status(200).send(html);
  } catch (e) {
    console.error(e);
    return res.status(500).send("Server error");
  }
}
