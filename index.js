import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import fetch from "node-fetch";
import 'dotenv/config';

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Quick health test
app.get("/", (req, res) => {
  res.send("Enoma API running");
});

// Generate profile endpoint
app.post("/generate-profile", async (req, res) => {
  try {
    const { name, role, company, bio, links } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Name is required" });
    }

    const linksText = Array.isArray(links) ? links.join(", ") : (links || "");

 const prompt = `
Create a professional public identity profile for a startup founder.

Return ONLY raw JSON.

Rules:
- Do not include markdown
- Do not wrap output in backticks
- Do not add commentary

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

const text = data?.choices?.[0]?.message?.content;
if (!text) {
  return res.status(500).json({ error: "No output from AI", raw: data });
}

    let profile;
try {
  // Remove ```json and ``` if present
  const cleaned = text.replace(/```json|```/g, "").trim();
  profile = JSON.parse(cleaned);
} catch (e) {
  console.error("Parse error:", text);
  return res.status(500).json({ error: "Invalid JSON from AI" });
}


    return res.json(profile);

  } catch (err) {
    console.error("Error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Enoma API listening on port ${PORT}`);
});
