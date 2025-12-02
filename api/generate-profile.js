import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// ✅ Supabase client using env variables (already configured in Vercel)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  const { name, role, company, bio, links } = req.body;

  if (!name) {
    return res.status(400).json({ error: "Name required" });
  }

  const linksText = Array.isArray(links) ? links.join(", ") : "";

  const prompt = `
Create a professional public identity profile for a startup founder.

Return ONLY raw JSON.
No markdown.
No backticks.
No commentary.

Output format:

{
  "display_name": "",
  "headline": "",
  "summary": "",
  "timeline": [],
  "expertise": [],
  "links": []
}

Input:
Name: ${name}
Role: ${role || ""}
Company: ${company || ""}
Bio: ${bio || ""}
Links: ${linksText}
`;

  try {

    // ✅ CALL OPENAI
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }]
      })
    });

    const data = await response.json();

    if (data.error) {
      return res.status(500).json({ error: "OpenAI error", details: data.error });
    }

    const text = data?.choices?.[0]?.message?.content;

    if (!text) {
      return res.status(500).json({ error: "No output from AI", raw: data });
    }

    // ✅ PARSE JSON
    const cleaned = text.replace(/```json|```/g, "").trim();
    let profile;

    try {
      profile = JSON.parse(cleaned);
    } catch (err) {
      return res.status(500).json({ error: "Invalid JSON", raw: cleaned });
    }

    // ✅ CREATE USERNAME
    let baseUsername = slugify(profile.display_name || name);
    let username = baseUsername;

    // ✅ ENSURE UNIQUE USERNAMES
    const { data: existing } = await supabase
      .from("profiles")
      .select("username")
      .like("username", `${baseUsername}%`);

    if (existing?.length) {
      const suffix = existing.length + 1;
      username = `${baseUsername}-${suffix}`;
    }

    profile.username = username;
    profile.is_public = true;
    profile.created_at = new Date().toISOString();

    // ✅ SAVE TO DATABASE
    const { error: insertError } = await supabase
      .from("profiles")
      .insert([profile]);

    if (insertError) {
      console.error(insertError);
      return res.status(500).json({ error: "Database insert failed" });
    }

    // ✅ RETURN
    return res.json(profile);

  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({ error: "Server crash", details: err.message });
  }
}
