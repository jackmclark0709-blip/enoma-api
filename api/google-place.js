export default async function handler(req, res) {
  const { place_id } = req.query;

  if (!place_id) {
    return res.status(400).json({ error: "Missing place_id" });
  }

  try {
    const url = `https://places.googleapis.com/v1/places/${place_id}?fields=rating,reviews,regularOpeningHours.weekdayDescriptions`;

    const r = await fetch(url, {
headers: {
  "X-Goog-Api-Key": process.env.GOOGLE_SERVER_PLACES_KEY,
  "X-Goog-FieldMask": "rating,reviews,regularOpeningHours.weekdayDescriptions"
}

    });

    const data = await r.json();

    if (!r.ok) {
      console.error("Google error:", data);
      return res.status(r.status).json(data);
    }

    return res.json(data);
  } catch (err) {
    console.error("Google Places fetch failed:", err);
    return res.status(500).json({ error: "Google Places fetch failed" });
  }
}



