// api/og-image.js
// Generates a branded Open Graph image for each business page.
// Returns an SVG rendered as an image — works on all social platforms.
// Usage: /api/og-image?slug=conways-landscaping

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const TRADE_COLORS = {
  landscaping:  { bg: "#0d1f0f", accent: "#2d6a2d", light: "#4a9e3a", label: "Landscaping" },
  plumbing:     { bg: "#0a1628", accent: "#1e5a96", light: "#3882dc", label: "Plumbing & Heating" },
  hvac:         { bg: "#0b1a24", accent: "#1a7a9a", light: "#2aa8cc", label: "HVAC" },
  electrical:   { bg: "#1a1400", accent: "#c09010", light: "#f0b820", label: "Electrical" },
  cleaning:     { bg: "#091820", accent: "#1a8a6a", light: "#22b894", label: "Cleaning" },
  contractor:   { bg: "#1a1208", accent: "#8a5a20", light: "#c08030", label: "Contractor" },
  retail:       { bg: "#1a0a18", accent: "#9a3a8a", light: "#c050b0", label: "Retail" },
};

const DEFAULT_COLORS = { bg: "#0a1628", accent: "#3882dc", light: "#5aa8f0", label: "Local Business" };

function escapeXml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function truncate(str, max) {
  if (!str) return "";
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + "…";
}

function generateSvg(profile) {
  const cat = (profile.primary_category || "").toLowerCase();
  const colors = TRADE_COLORS[cat] || DEFAULT_COLORS;

  const name = truncate(profile.business_name || "Local Business", 36);
  const city = profile.city && profile.state ? `${profile.city}, ${profile.state}` : (profile.city || "");
  const tagline = truncate(profile.hero_tagline || profile.seo_description || "", 80);
  const phone = profile.phone || "";
  const tradeLabel = colors.label;

  // Service pills — first 3
  const services = Array.isArray(profile.services)
    ? profile.services.slice(0, 4).map(s => truncate(s.service_name || s.name || "", 18))
    : [];

  // Trust badges — first 2
  const badges = Array.isArray(profile.trust_badges)
    ? profile.trust_badges.slice(0, 2)
    : [];

  const svgWidth = 1200;
  const svgHeight = 630;

  const servicesPillsXml = services.map((s, i) => {
    const x = 60 + i * 220;
    return `
      <rect x="${x}" y="490" width="200" height="36" rx="18" fill="rgba(255,255,255,0.1)" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>
      <text x="${x + 100}" y="513" font-family="system-ui,sans-serif" font-size="14" font-weight="600" fill="rgba(255,255,255,0.85)" text-anchor="middle">${escapeXml(s)}</text>
    `;
  }).join("");

  const badgesXml = badges.map((b, i) => {
    const x = 60 + i * 200;
    return `
      <rect x="${x}" y="555" width="180" height="30" rx="15" fill="${colors.accent}" opacity="0.5"/>
      <text x="${x + 90}" y="575" font-family="system-ui,sans-serif" font-size="13" font-weight="700" fill="white" text-anchor="middle">✓ ${escapeXml(truncate(b, 20))}</text>
    `;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}"
     xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${colors.bg}"/>
      <stop offset="100%" stop-color="${colors.accent}" stop-opacity="0.3"/>
    </linearGradient>
    <linearGradient id="accent-bar" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${colors.light}"/>
      <stop offset="100%" stop-color="${colors.accent}"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="${svgWidth}" height="${svgHeight}" fill="url(#bg)"/>

  <!-- Left accent bar -->
  <rect x="0" y="0" width="8" height="${svgHeight}" fill="url(#accent-bar)"/>

  <!-- Trade type pill -->
  <rect x="60" y="60" width="${tradeLabel.length * 9 + 40}" height="32" rx="16"
        fill="${colors.accent}" opacity="0.7"/>
  <text x="${60 + (tradeLabel.length * 9 + 40) / 2}" y="81"
        font-family="system-ui,sans-serif" font-size="13" font-weight="700"
        fill="white" text-anchor="middle" letter-spacing="0.5">${escapeXml(tradeLabel.toUpperCase())}</text>

  <!-- Business name -->
  <text x="60" y="170"
        font-family="system-ui,sans-serif" font-size="${name.length > 24 ? 52 : 62}"
        font-weight="800" fill="white" letter-spacing="-1">
    ${escapeXml(name)}
  </text>

  <!-- Location -->
  ${city ? `
  <text x="60" y="220"
        font-family="system-ui,sans-serif" font-size="24" font-weight="500"
        fill="${colors.light}">
    📍 ${escapeXml(city)}
  </text>` : ""}

  <!-- Divider -->
  <rect x="60" y="250" width="120" height="4" rx="2" fill="${colors.light}" opacity="0.7"/>

  <!-- Tagline -->
  ${tagline ? `
  <text x="60" y="305"
        font-family="system-ui,sans-serif" font-size="22" font-weight="400"
        fill="rgba(255,255,255,0.7)" style="max-width:900px">
    ${escapeXml(truncate(tagline, 60))}
  </text>
  ${tagline.length > 60 ? `
  <text x="60" y="335"
        font-family="system-ui,sans-serif" font-size="22" font-weight="400"
        fill="rgba(255,255,255,0.7)">
    ${escapeXml(tagline.slice(60, 120))}
  </text>` : ""}` : ""}

  <!-- Phone -->
  ${phone ? `
  <text x="60" y="400"
        font-family="system-ui,sans-serif" font-size="26" font-weight="700"
        fill="${colors.light}">
    📞 ${escapeXml(phone)}
  </text>` : ""}

  <!-- Services pills -->
  ${servicesPillsXml}

  <!-- Trust badges -->
  ${badgesXml}

  <!-- Enoma branding — bottom right -->
  <rect x="${svgWidth - 200}" y="${svgHeight - 52}" width="180" height="40" rx="8"
        fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
  <text x="${svgWidth - 110}" y="${svgHeight - 26}"
        font-family="system-ui,sans-serif" font-size="15" font-weight="700"
        fill="rgba(255,255,255,0.5)" text-anchor="middle">
    Powered by Enoma
  </text>

  <!-- Right glow -->
  <circle cx="${svgWidth}" cy="0" r="400" fill="${colors.light}" opacity="0.05"/>
  <circle cx="${svgWidth}" cy="${svgHeight}" r="300" fill="${colors.accent}" opacity="0.08"/>
</svg>`;
}

export default async function handler(req, res) {
  try {
    const slug = req.query.slug;
    if (!slug) {
      return res.status(400).send("Missing slug");
    }

    const { data: profile, error } = await supabase
      .from("small_business_profiles")
      .select("business_name, city, state, phone, primary_category, hero_tagline, seo_description, trust_badges, services")
      .eq("username", slug)
      .maybeSingle();

    if (error || !profile) {
      return res.status(404).send("Not found");
    }

    const svg = generateSvg(profile);

    // Cache for 7 days — business data rarely changes
    res.setHeader("Content-Type", "image/svg+xml");
    res.setHeader("Cache-Control", "public, max-age=604800, s-maxage=604800");
    return res.status(200).send(svg);
  } catch (e) {
    console.error("OG image error:", e);
    return res.status(500).send("Error generating image");
  }
}
