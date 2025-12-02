import fetch from "node-fetch";
import fs from "fs";
import path from "path";

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

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

    const cleaned = text.replace(/```json|```/g, "").trim();

    let profile;
    try {
      profile = JSON.parse(cleaned);
    } catch (err) {
      console.error("Parse error:", cleaned);
      return res.status(500).json({ error: "Invalid JSON", raw: cleaned });
    }

    // ✅ generate username
    const username = slugify(profile.display_name || name);
    profile.username = username;

    // ✅ ensure folder exists
    const dir = path.join(process.cwd(), "profiles");
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir);
    }

    // ✅ store profile
    const filePath = path.join(dir, `${username}.json`);
    fs.writeFileSync(filePath, JSON.stringify(profile, null, 2));

    return res.json(profile);

  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({ error: "Server crash", details: err.message });
  }

}
