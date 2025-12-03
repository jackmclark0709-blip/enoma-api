
✅ Accepts file uploads
✅ Extracts resume text
✅ Feeds resume into AI
✅ Hard-limits size + file types
✅ Times out safely
✅ Writes profile to Supabase
✅ Returns username + profile
✅ Never blocks UI forever

✅ STEP 0 — Install required packages (run once locally)
npm install formidable pdf-parse mammoth


Commit after install:

git add package.json package-lock.json
git commit -m "Add resume parsing libraries"
git push


Vercel will auto-deploy.

✅ STEP 1 — Replace api/generate-profile.js FULLY with this

Delete your current file and paste this entire implementation:

import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";
import formidable from "formidable";
import fs from "fs";
import pdf from "pdf-parse";
import mammoth from "mammoth";

// ✅ Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ✅ Disable Next.js bodyParser
export const config = {
  api: {
    bodyParser: false,
  },
};

// ✅ Helper: username slug
function slugify(name) {
  return name.toLowerCase()
    .replace(/[^a-z0-9]+/g,"-")
    .replace(/(^-|-$)/g,"");
}

// ✅ Resume extraction
async function extractResumeText(file) {
  const buffer = fs.readFileSync(file.filepath);

  // File size guard: 5 MB
  if (buffer.length > 5 * 1024 * 1024) {
    throw new Error("Resume too large (5MB limit)");
  }

  if (file.mimetype === "application/pdf") {
    const parsed = await pdf(buffer);
    return parsed.text;
  }

  if (
    file.mimetype ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  if (file.mimetype === "text/plain") {
    return buffer.toString("utf-8");
  }

  throw new Error("Unsupported file format");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  const started = Date.now();
  console.log("⚡ generate-profile invoked");

  // ✅ Parse incoming form-data
  const form = formidable({ keepExtensions: true });

  const { fields, files } = await new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });

  // ✅ Extract inputs
  const {
    name, type, image, headline, bio,
    role, company,
    email, phone, website,
    linkedin, twitter, github, instagram, youtube,
    expertise, timeline
  } = fields;

  if (!name) return res.status(400).json({ error:"Name required" });

  const username = slugify(name);

  // ✅ Parse expertise + timeline (JSON strings from frontend)
  let parsedExpertise = [];
  let parsedTimeline = [];

  try { parsedExpertise = JSON.parse(expertise || "[]"); } catch {}
  try { parsedTimeline = JSON.parse(timeline || "[]"); } catch {}

  // ✅ Resume ingestion
  let resumeText = "";

  if (files.resume?.[0]) {
    console.log("📄 Resume uploaded, extracting...");
    resumeText = await extractResumeText(files.resume[0]);
    resumeText = resumeText.slice(0, 6000); // token safety
  }

  // ✅ AI Prompt
  const prompt = `
You are constructing a public identity profile.

If resume is present, trust resume facts over form.

Return ONLY JSON in this format:

{
  "display_name":"",
  "headline":"",
  "summary":"",
  "expertise":[],
  "timeline":[]
}

FORM INFO:
Name: ${name}
Headline: ${headline}
Bio: ${bio}
Role: ${role}
Company: ${company}
Expertise: ${parsedExpertise.join(", ")}

RESUME CONTENT:
${resumeText}
`;

  console.log("🤖 Calling OpenAI...");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  let ai;
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }]
      })
    });

    clearTimeout(timeout);
    ai = await response.json();

    if (!response.ok || ai.error) {
      console.error("OpenAI error:", ai);
      return res.status(500).json({ error:"OpenAI failed", raw: ai });
    }

  } catch (e) {
    console.error("OpenAI timeout", e);
    return res.status(504).json({ error: "AI timeout" });
  }

  // ✅ Parse output
  const raw = ai.choices?.[0]?.message?.content;

  if (!raw) return res.status(500).json({ error:"AI empty" });

  let profile;
  try {
    profile = JSON.parse(raw.replace(/```json|```/g,"").trim());
  } catch (err) {
    console.error("JSON invalid:", raw);
    return res.status(500).json({ error:"Bad AI JSON", raw });
  }

  // ✅ Final profile shape
  const finalProfile = {
    username,
    type,
    profile_image: image,
    display_name: profile.display_name || name,
    headline: profile.headline || headline,
    summary: profile.summary || bio,
    expertise: profile.expertise || parsedExpertise,
    timeline: profile.timeline || parsedTimeline,
    contact: { email, phone, website },
    social: { linkedin, twitter, github, instagram, youtube },
    is_public: true
  };

  // ✅ Save to DB
  console.log("🧾 Saving profile:", username);

  const { error } = await supabase
    .from("profiles")
    .upsert(finalProfile, { onConflict: "username" });

  if (error) {
    console.error("❌ Supabase insert failed:", error);
    return res.status(500).json({ error:"DB failure", supabase:error });
  }

  console.log("✅ Saved in", Date.now() - started, "ms");
  res.json(finalProfile);
}