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

/**
 * normalizeProfile — standardize polymorphic fields before sending to client.
 *
 * The DB schema allows some fields to be stored as either a plain string
 * OR a JSON object/array (depending on how the record was created).
 * The frontend JS renderer only handles the string format for why_choose_us
 * and expects {q,a} or {question,answer} keys for faqs.
 * This function normalizes everything so the renderer always gets a consistent shape.
 */
function normalizeProfile(p) {
  if (!p) return p;
  const out = { ...p };

  // ── why_choose_us ──
  // Accept: string | [{title,description}] | [{title}] | any array
  // Emit:   newline-separated string
  if (Array.isArray(out.why_choose_us)) {
    out.why_choose_us = out.why_choose_us
      .map(item => {
        if (typeof item === "string") return item.trim();
        if (item && typeof item === "object") {
          const title = item.title || item.name || "";
          const desc  = item.description || item.text || "";
          return desc ? `${title} — ${desc}` : title;
        }
        return String(item);
      })
      .filter(Boolean)
      .join("\n");
  }

  // ── faqs ──
  // Accept: [{question,answer}] | [{q,a}] | string
  // Emit:   [{q, a}] array (what the renderer uses)
  if (Array.isArray(out.faqs)) {
    out.faqs = out.faqs.map(f => {
      if (!f || typeof f !== "object") return null;
      return {
        q: f.q || f.question || "",
        a: f.a || f.answer   || "",
      };
    }).filter(Boolean);
  }

  // ── testimonials ──
  // Accept: [{quote,author}] | [{text,name}] | string
  // Emit:   [{quote, author}] array
  if (Array.isArray(out.testimonials)) {
    out.testimonials = out.testimonials.map(t => {
      if (!t || typeof t !== "object") return null;
      return {
        quote:  t.quote  || t.text    || t.review || "",
        author: t.author || t.name    || t.reviewer || "Customer",
      };
    }).filter(t => t && t.quote);
  }

  // ── services ──
  // Normalize price: strip "Call for quote" if present — renderer shows it,
  // but it's visually cleaner to omit the redundant label
  if (Array.isArray(out.services)) {
    out.services = out.services.map(s => ({
      ...s,
      service_name: s.service_name || s.name || "",
      service_description: s.service_description || s.description || "",
      price: (s.price === "Call for quote" || s.price === "call for quote") ? "" : (s.price || ""),
    }));
  }

  return out;
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

// ── Trade color system ──
// Used for OG images, server-side brand color injection, and monogram generation.
// primary = --brand-primary CSS var (buttons, accents, section bars)
// light   = lighter accent (hero glow, trust strip icons)
// bg      = hero dark background gradient start
// rgb     = --brand-rgb for radial glow effects
const TRADE_COLORS = {
  landscaping:  { bg: "#0d1f0f", primary: "#2d6a2d", light: "#4a9e3a", rgb: "45,106,45",   label: "Landscaping" },
  plumbing:     { bg: "#0a1628", primary: "#1e5a96", light: "#3882dc", rgb: "30,90,150",   label: "Plumbing & Heating" },
  hvac:         { bg: "#0b1a24", primary: "#1a7a9a", light: "#2aa8cc", rgb: "26,122,154",  label: "HVAC" },
  electrical:   { bg: "#1a1400", primary: "#a07010", light: "#f0b820", rgb: "160,112,16",  label: "Electrical" },
  cleaning:     { bg: "#091820", primary: "#1a8a6a", light: "#22b894", rgb: "26,138,106",  label: "Cleaning" },
  contractor:   { bg: "#1a1208", primary: "#7a4a18", light: "#c08030", rgb: "122,74,24",   label: "Contractor" },
  default:      { bg: "#0a1628", primary: "#3882dc", light: "#5aa8f0", rgb: "56,130,220",  label: "Local Business" },
};

// Keep TRADE_COLORS_OG as alias for OG image generation
const TRADE_COLORS_OG = Object.fromEntries(
  Object.entries(TRADE_COLORS).map(([k, v]) => [k, { ...v, accent: v.primary }])
);

/**
 * getTradeColors — returns the color set for a given primary_category.
 */
function getTradeColors(primaryCategory) {
  const key = (primaryCategory || "").toLowerCase().trim();
  return TRADE_COLORS[key] || TRADE_COLORS.default;
}

/**
 * generateMonogramSvg — creates a branded SVG data URI for businesses without a logo.
 * Uses trade category colors so the monogram matches the page persona.
 * Returns a data: URI string suitable for use as an img src.
 */
function generateMonogramSvg(businessName, primaryCategory) {
  const colors = getTradeColors(primaryCategory);

  // Build initials: up to 3 chars from words, e.g. "BCM Landscaping Inc" → "BCM"
  const words = (businessName || "?").trim().split(/\s+/);
  let initials;
  if (words.length === 1) {
    initials = words[0].slice(0, 2).toUpperCase();
  } else if (words.length === 2) {
    initials = (words[0][0] + words[1][0]).toUpperCase();
  } else {
    // 3+ words: use first letter of each word up to 3, but skip common suffixes
    const skip = new Set(["inc", "llc", "co", "corp", "ltd", "the"]);
    const letters = words
      .filter(w => !skip.has(w.toLowerCase()) && w.length > 0)
      .map(w => w[0].toUpperCase())
      .slice(0, 3);
    initials = letters.join("");
    if (!initials) initials = words[0][0].toUpperCase();
  }

  const size = 220;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 2;
  const fontSize = initials.length > 2 ? 64 : 72;

  const svg = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="mg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${colors.primary}"/>
      <stop offset="100%" stop-color="${colors.bg}"/>
    </linearGradient>
    <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${colors.light}" stop-opacity="0.6"/>
      <stop offset="100%" stop-color="${colors.primary}" stop-opacity="0.2"/>
    </linearGradient>
  </defs>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#mg)"/>
  <circle cx="${cx}" cy="${cy}" r="${r - 6}" fill="none" stroke="url(#ring)" stroke-width="1.5"/>
  <text
    x="${cx}" y="${cy}"
    font-family="system-ui,-apple-system,sans-serif"
    font-size="${fontSize}"
    font-weight="800"
    fill="rgba(255,255,255,0.92)"
    text-anchor="middle"
    dominant-baseline="central"
    letter-spacing="-2"
  >${initials}</text>
</svg>`;

  // Return as data URI
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * getBrandColorStyle — returns a <style> block that sets CSS custom properties
 * from trade category when no logo is present.
 * When a logo IS present, the client-side JS will override these via extractDominantColor().
 */
function getBrandColorStyle(primaryCategory) {
  const c = getTradeColors(primaryCategory);
  return `<style id="server-brand-colors">
  :root {
    --brand-primary: ${c.primary};
    --brand-primary-10: color-mix(in srgb, ${c.primary} 10%, white);
    --brand-primary-30: color-mix(in srgb, ${c.primary} 28%, white);
    --brand-rgb: ${c.rgb};
  }
</style>`;
}

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

    // Normalize polymorphic fields before sending to client renderer
    const normalizedProfile = normalizeProfile(profile);

    // Monogram: only generated when no logo — client-side logo color extraction takes over when logo exists
    const monogramUri = profile.logo_url
      ? ""
      : generateMonogramSvg(profile.business_name, profile.primary_category);

    // Server-side brand color style — sets --brand-primary from trade on first paint.
    // Prevents flash of wrong color before JS loads.
    // When a logo exists, client-side extractDominantColor() overrides these vars.
    const brandColorStyle = getBrandColorStyle(profile.primary_category);

    const templatePath = path.join(process.cwd(), "public", "profile.html");
    let html = fs.readFileSync(templatePath, "utf8");

    const replacements = {
      "{{FINAL_TITLE}}": escapeHtml(seoTitle),
      "{{FINAL_DESCRIPTION}}": escapeHtml(seoDescription),
      "{{FINAL_OG_IMAGE}}": escapeHtml(ogImage),
      "{{FINAL_CANONICAL_URL}}": escapeHtml(canonical),
      "{{ROBOTS}}": escapeHtml(robots),
      "{{PROFILE_JSON}}": safeJsonForInlineScript(normalizedProfile || {}),
      "{{BUSINESS_NAME}}": escapeHtml(profile.business_name || ""),
      "{{HERO_HEADLINE}}": escapeHtml(profile.hero_headline || ""),
      "{{HERO_TAGLINE}}": escapeHtml(profile.hero_tagline || ""),
      "{{ABOUT}}": escapeHtml(profile.about || ""),
      "{{SERVICES_INTRO}}": escapeHtml(profile.services_intro || ""),
      "{{LOCAL_BUSINESS_SCHEMA}}": safeJsonForInlineScript(localBusinessSchema),
      // Monogram URI — data:image/svg+xml string when no logo, empty string when logo exists
      "{{MONOGRAM_URI}}": monogramUri,
      // Server-side brand colors injected into <head> — no flash on first paint
      "{{BRAND_COLOR_STYLE}}": brandColorStyle,
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
