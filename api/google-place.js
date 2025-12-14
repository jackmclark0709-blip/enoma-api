export default async function handler(req, res) {
  const { place_id } = req.query;

  if (!place_id) {
    return res.status(400).json({ error: "Missing place_id" });
  }

  const url =
    "https://maps.googleapis.com/maps/api/place/details/json" +
    `?place_id=${place_id}` +
    "&fields=name,rating,reviews,opening_hours,geometry,formatted_address" +
    `&key=${process.env.GOOGLE_SERVER_PLACES_KEY}`;

  try {
    const r = await fetch(url);
    const data = await r.json();
    res.status(200).json(data.result);
  } catch (err) {
    res.status(500).json({ error: "Google Places fetch failed" });
  }
}
