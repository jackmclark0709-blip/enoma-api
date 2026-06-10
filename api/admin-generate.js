// api/admin-generate.js
// Admin-only bulk page generation endpoint.
// Accepts JSON body, authenticates via ADMIN_SECRET env var.
// Bypasses user auth and formidable — intended for internal/Claude use only.

import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ADMIN_USER_ID = "b2f87fe4-4d1e-4038-8754-5ab64969e975";

const slugify = text =>
  String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

const normalizeSeoBusinessName = name =>
  name ? String(name).replace(/['']/g, "").replace(/\s+/g, " ").trim() : null;

const extractJSON = text => {
  if (!text || typeof text !== "string") return "";
  return text.replace(/```json/gi, "").replace(/```/g, "").trim();
};

const safeJSON = (v, fallback = []) => {
  try { return v ? JSON.parse(v) : fallback; } catch { return fallback; }
};

async function generateUniqueSlug(base) {
  let slug = base;
  let i = 1;
  while (true) {
    const { data } = await supabaseAdmin
      .from("small_business_profiles")
      .select("id")
      .eq("username", slug)
      .maybeSingle();
    if (!data) return slug;
    slug = `${base}-${i++}`;
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-secret");
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const secret = req.headers["x-admin-secret"];
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const {
    businessName, slug: requestedSlug, phone, town, state, trade,
    ownerFirstName, services = [], areasServed = [], yearsInBusiness,
    email = "jack@enoma.io"
  } = req.body;

  if (!businessName || !requestedSlug) {
    return res.status(400).json({ error: "businessName and slug required" });
  }

  try {
    const baseSlug = slugify(requestedSlug);
    const slug = await generateUniqueSlug(baseSlug);

    const { data: newBiz, error: bizErr } = await supabaseAdmin
      .from("businesses")
      .insert({ name: businessName, slug, ai_generated_at: new Date().toISOString() })
      .select("id, slug")
      .single();
    if (bizErr) throw bizErr;
    const business_id = newBiz.id;

    await supabaseAdmin.from("business_members").insert({
      user_id: ADMIN_USER_ID,
      business_id,
      role: "owner"
    });

    await supabaseAdmin.from("subscriptions").upsert({
      business_id,
      provider: "stripe",
      plan_code: "starter",
      status: "trialing",
      is_trial: true,
      trial_starts_at: new Date().toISOString(),
      trial_expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      cancel_at_period_end: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }, { onConflict: "business_id" });

    const servicesList = services.join(", ") || "general landscaping services";
    const areasStr = areasServed.join(", ") || town;
    const yearsStr = yearsInBusiness ? `${yearsInBusiness} years` : "several years";

    const prompt = `You are a copywriter for local trade businesses. Write copy that sounds like it was written by someone who actually knows this business — not a generic template.
Return ONLY valid JSON (no markdown, no commentary).

JSON SCHEMA:
{
  "seo_title": "",
  "seo_description": "",
  "hero_headline": "",
  "hero_tagline": "",
  "about": "",
  "why_choose_us": "",
  "services_intro": "",
  "trust_badges": [],
  "faqs": [{ "q": "", "a": "" }],
  "services": [{ "service_name": "", "service_description": "" }],
  "primary_cta": { "label": "", "type": "call", "value": "" }
}

BUSINESS:
Name: ${businessName}
Owner first name: ${ownerFirstName || "the owner"}
Trade: ${trade}
Phone: ${phone}
Town: ${town}, ${state}
Service areas: ${areasStr}
Years in business: ${yearsStr}
Services: ${servicesList}

COPY RULES:
hero_headline: Include town name and trade. Be direct and specific. AVOID: trusted, reliable, professional, quality, dedicated.
hero_tagline: One sentence. Mention owner name, years in business, towns served. Be factual.
about: 2 paragraphs separated by \\n\\n. Origin story + who they serve. Use owner name. BANNED: trusted, reliable, professional, quality, dedicated, passionate, commitment, excellence, proud, strive, ensure, seamless.
why_choose_us: 4-5 lines separated by \\n, no bullet characters. Each line = specific concrete fact, not a vague claim.
services_intro: One specific sentence about what they do and where.
faqs: 5 questions real customers ask before hiring. Include pricing, service area, scheduling.
trust_badges: 3-5 short factual phrases. Years in business, licensed & insured, free estimates.
seo_title: "[Business Name] — [Trade] in [City], MA | [Short differentiator]"
seo_description: 1-2 sentences with business name, city, trade, phone.
primary_cta: type="call", value="${phone}", label="Call for a Free Estimate"`;

    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o",
        temperature: 0.2,
        messages: [
          { role: "system", content: "You are a JSON API. Return ONLY valid JSON. No text, no markdown." },
          { role: "user", content: prompt }
        ]
      })
    });

    if (!aiRes.ok) throw new Error(`OpenAI error: ${await aiRes.text()}`);

    const ai = await aiRes.json();
    const rawAI = ai?.choices?.[0]?.message?.content;
    const generated = safeJSON(extractJSON(rawAI), null);
    if (!generated) throw new Error("AI returned invalid JSON");

    const finalServices = (Array.isArray(generated.services) ? generated.services : [])
      .filter(s => s?.service_name)
      .map(s => ({
        service_name: String(s.service_name).trim(),
        service_description: String(s.service_description || "").trim()
      }));

    const finalFaqs = (Array.isArray(generated.faqs) ? generated.faqs : [])
      .map(f => ({
        q: String(f.q || f.question || "").trim(),
        a: String(f.a || f.answer || "").trim()
      }))
      .filter(f => f.q && f.a);

    const finalTrustBadges = Array.isArray(generated.trust_badges) ? generated.trust_badges : [];

    const { error: profileErr } = await supabaseAdmin
      .from("small_business_profiles")
      .upsert({
        business_id,
        auth_id: ADMIN_USER_ID,
        username: slug,
        business_name: businessName,
        seo_business_name: normalizeSeoBusinessName(businessName),
        owner_name: ownerFirstName || null,
        email,
        phone: phone || null,
        city: town || null,
        state: state || null,
        primary_category: trade || null,
        service_area: areasServed,
        hero_headline: generated.hero_headline || "",
        hero_tagline: generated.hero_tagline || "",
        about: generated.about || "",
        why_choose_us: generated.why_choose_us || "",
        services_intro: generated.services_intro || "",
        seo_title: generated.seo_title || "",
        seo_description: generated.seo_description || "",
        services: finalServices,
        faqs: finalFaqs,
        trust_badges: finalTrustBadges,
        primary_cta_label: generated.primary_cta?.label || "Call for a Free Estimate",
        primary_cta_type: "call",
        primary_cta_value: phone || "",
        testimonials: [],
        attachments: [],
        is_open_now: true,
        accepting_clients: true,
        offers_emergency: false,
        is_public: true,
        updated_at: new Date().toISOString()
      }, { onConflict: "business_id" });
    if (profileErr) throw profileErr;

    await supabaseAdmin
      .from("businesses")
      .update({ name: businessName, slug, is_published: true, updated_at: new Date().toISOString() })
      .eq("id", business_id);

    return res.json({ success: true, business_id, slug, url: `https://enoma.io/${slug}` });

  } catch (err) {
    console.error("admin-generate error:", err);
    return res.status(500).json({ error: err.message });
  }
}
