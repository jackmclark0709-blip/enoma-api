import { ImageResponse } from "@vercel/og";
import { createClient } from "@supabase/supabase-js";

export const runtime = "edge";

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const slug = searchParams.get("slug");

    if (!slug) {
      return new Response("Missing slug", { status: 400 });
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data: biz } = await supabase
      .from("businesses")
      .select("name, city, state, primary_category, brand_color")
      .eq("slug", slug)
      .single();

    if (!biz) {
      return new Response("Not found", { status: 404 });
    }

    return new ImageResponse(
      (
        <div
          style={{
            width: "1200px",
            height: "630px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            padding: "80px",
            background: biz.brand_color || "#2f8f3a",
            color: "white",
            fontFamily: "Inter",
          }}
        >
          <div style={{ fontSize: 64, fontWeight: 800 }}>
            {biz.name}
          </div>

          <div style={{ fontSize: 34, marginTop: 20 }}>
            {biz.primary_category} • {biz.city}, {biz.state}
          </div>

          <div style={{ marginTop: 40, fontSize: 26, opacity: 0.85 }}>
            Built with Enoma
          </div>
        </div>
      ),
      {
        width: 1200,
        height: 630,
        headers: {
          "Cache-Control": "public, max-age=86400, immutable",
        },
      }
    );
  } catch (err) {
    console.error(err);
    return new Response("OG Error", { status: 500 });
  }
}
