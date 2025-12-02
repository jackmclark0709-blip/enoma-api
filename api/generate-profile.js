import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"");
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({error:"POST only"});

  const t0 = Date.now();
  console.log("⚡ generate-profile invoked");


  const {
    name, type, image, headline, bio,
    role, company,
    email, phone, website,
    linkedin, twitter, github, instagram, youtube,
    expertise, timeline
  } = req.body;

  const username = slugify(name);

  const prompt = `
Create a professional ${type} identity profile.

Return ONLY JSON:
{
  "display_name":"",
  "headline":"",
  "summary":"",
  "expertise":[],
  "timeline":[]
}

Name: ${name}
Headline: ${headline}
Bio: ${bio}
Company: ${company}
Role: ${role}
Expertise: ${expertise}
`;

 console.log("🤖 Calling OpenAI...");
const aiStart = Date.now();

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 10_000); // 10 sec hard timeout

let ai;
try {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_KEY}`,
      "Content-Type": "application/json"
    },
    signal: controller.signal,
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: prompt }]
    })
  });

  clearTimeout(timeout);

  ai = await response.json();

  console.log("✅ OpenAI returned in", Date.now() - aiStart, "ms");

  if (!response.ok || ai.error) {
    console.error("OpenAI error:", ai);
    return res.status(500).json({ error: "OpenAI failed", raw: ai });
  }

} catch (err) {
  console.error("🚨 OpenAI timeout or crash:", err);
  return res.status(504).json({ error: "OpenAI timeout" });
}

// SAFE PARSE
const raw = ai.choices?.[0]?.message?.content;

if (!raw) {
  console.error("Empty OpenAI output:", ai);
  return res.status(500).json({ error: "AI returned no content" });
}

let profile;
try {
  profile = JSON.parse(raw.replace(/```json|```/g, "").trim());
} catch (err) {
  console.error("JSON parse failed:", raw);
  return res.status(500).json({ error: "Invalid AI JSON", raw });
}


  const finalProfile = {
    username,
    type,
    profile_image: image,
    display_name: profile.display_name || name,
    headline: profile.headline || headline,
    summary: profile.summary || bio,
    expertise: profile.expertise || expertise || [],
    timeline: profile.timeline || timeline || [],
    contact: { email, phone, website },
    social: { linkedin, twitter, github, instagram, youtube },
    is_public: true
  };

  await supabase
    .from("profiles")
    .upsert(finalProfile, { onConflict: "username" });

console.log("✅ Total request time:", Date.now() - t0, "ms");

  res.json(finalProfile);
}

