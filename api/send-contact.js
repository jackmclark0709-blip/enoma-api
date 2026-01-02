import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const {
    name,
    email,
    business_name,
    city,
    industry,
    plan,
    to
  } = req.body;

  if (!name || !email || !business_name || !city || !to) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    await resend.emails.send({
      from: "Enoma <no-reply@enoma.io>",
      to: ["jack@enoma.io"],
      reply_to: email,
      subject: `New Enoma page request — ${business_name}`,
      html: `
        <h2>New Enoma Business Page Request</h2>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Business Name:</strong> ${business_name}</p>
        <p><strong>City & State:</strong> ${city}</p>
        <p><strong>Industry:</strong> ${industry || "Not provided"}</p>
        <p><strong>Plan:</strong> ${plan || "default"}</p>
      `
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Email send failed:", err);
    return res.status(500).json({ error: "Email failed to send" });
  }
}

