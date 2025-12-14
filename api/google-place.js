export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const place_id = searchParams.get("place_id");

  if (!place_id) {
    return new Response(
      JSON.stringify({ error: "Missing place_id" }),
      { status: 400 }
    );
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
      return new Response(
        JSON.stringify({ error: data.status }),
        { status: 500 }
      );
    }

    return new Response(JSON.stringify(data.result), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    console.error(err);
    return new Response(
      JSON.stringify({ error: "Google fetch failed" }),
      { status: 500 }
    );
  }
}


