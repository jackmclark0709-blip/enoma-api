export default async function handler(req, res) {
  const { place_id } = req.query;

  if (!place_id) {
    return res.status(400).json({ error: "Missing place_id" });
  }

  try {
    const url =
      "https://maps.googleapis.com/maps/api/place/details/json" +
      `?place_id=${place_id}` +
      `&fields=rating,reviews,opening_hours` +
      `&key=${process.env.GOOGLE_SERVER_PLACES_KEY}`;

    const r = await fetch(url);
    const data = await r.json();

    if (data.status !== "OK") {
      return res.status(500).json({ error: data.status });
    }

    return res.json(data.result);
  } catch (err) {
    console.error("Google Places error:", err);
    return res.status(500).json({ error: "Google fetch failed" });
  }
}

