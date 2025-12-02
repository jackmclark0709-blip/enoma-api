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

  const ai = await fetch("https://api.openai.com/v1/chat/completions",{
    method:"POST",
    headers:{
      Authorization:`Bearer ${process.env.OPENAI_KEY}`,
      "Content-Type":"application/json"
    },
    body:JSON.stringify({
      model:"gpt-4o-mini",
      messages:[{role:"user", content:prompt}]
    })
  }).then(res=>res.json());

  const text = ai.choices?.[0]?.message?.content;
  const profile = JSON.parse(text.replace(/```json|```/g,"").trim());

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

  res.json(finalProfile);
}

