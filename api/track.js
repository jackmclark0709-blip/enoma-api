import { createClient } from "@supabase/supabase-js";
import { parseFeedback } from "./_lib/feedback.js";
import { FUNNEL_EVENTS, classifyRequest, markBurstPartners, funnelRow } from "./_lib/tracking.js";
import { INTERNAL_COOKIE } from "./_lib/traffic-classifier.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Every event is stored with a traffic_class (api/_lib/traffic-classifier.js);
// Jack's own devices are kept too, as is_internal / traffic_class 'internal',
// instead of being dropped, so nothing raw is lost and reports filter them out.

const ONE_YEAR_S = 365 * 24 * 60 * 60;

// GET /internal-optout (rewrite in vercel.json). Hidden page that tags this
// browser as Jack's for a year: the enoma_internal=1 cookie (read here and by
// the GA snippet, which then sends traffic_type=internal) plus the older
// localStorage flag. /internal-optout?off=1 undoes it.
function handleInternalOptout(req, res) {
  const off = req.query?.off === "1";
  const secure = String(req.headers["x-forwarded-proto"] || "").includes("https") ? "; Secure" : "";
  res.setHeader("Set-Cookie", off
    ? `${INTERNAL_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax${secure}`
    : `${INTERNAL_COOKIE}=1; Max-Age=${ONE_YEAR_S}; Path=/; SameSite=Lax${secure}`);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  const title = off ? "This browser counts as a visitor again" : "This browser is marked as Jack's";
  const body = off
    ? "Your visits from this browser will show up in analytics again."
    : "Visits from this browser are tagged internal for a year: left out of Enoma's numbers and GA4 (once the Internal Traffic filter is active). Do this once on every phone and browser you use.";
  return res.status(200).send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${title}</title></head>
<body style="font-family:Inter,Arial,sans-serif;background:#f0f6ff;display:flex;align-items:center;justify-content:center;min-height:90vh;margin:0;padding:24px;">
<div style="background:#fff;border:1px solid #d4e2f4;border-radius:16px;padding:28px;max-width:440px;text-align:center;">
<h1 style="font-size:20px;color:#0a1628;margin:0 0 8px;">${title}</h1><p style="color:#2a4060;margin:0 0 16px;">${body}</p>
<p style="margin:0;font-size:14px;"><a href="/internal-optout${off ? "" : "?off=1"}">${off ? "Mark it as Jack's again" : "Undo"}</a></p></div>
<script>try{localStorage.setItem("enoma_internal","${off ? "0" : "1"}")}catch(e){}</script>
</body></html>`);
}

export default async function handler(req, res) {
  if (req.method === "GET" && req.query?.action === "internal_optout") return handleInternalOptout(req, res);
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  const { slug, event, metadata, anon_id, business_id } = req.body || {};

  if (!event) {
    return res.status(400).json({ error: "Missing event" });
  }

  const at = Date.now();
  const meta = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {};
  const messageId = typeof meta.m === "string" ? meta.m : null;
  // The page's own document.referrer (the external referrer). Pages that
  // send the field get exactly that (null = direct visit); older callers
  // that don't send it fall back to the Referer header (the page itself).
  const referrer = "referrer" in (req.body || {})
    ? (typeof req.body.referrer === "string" && req.body.referrer ? req.body.referrer.slice(0, 500) : null)
    : (req.headers.referer || null);

  try {
    const c = await classifyRequest(supabase, req, {
      event, at,
      messageId: slug ? messageId : null,
      internalFlag: req.body.internal === true
    });

    // Owner feedback (preview-page poll, outreach 👍/👎). Its own table so
    // answers are easy to read back; a second call adds the optional comment.
    // Jack's own test votes aren't stored.
    if (event === "feedback") {
      if (c.trafficClass === "internal") return res.status(204).end();
      const parsed = parseFeedback(req.body);
      if (!parsed.ok) return res.status(400).json({ error: parsed.error });
      if (parsed.kind === "comment") {
        const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        await supabase.from("feedback").update({ comment: parsed.comment })
          .eq("id", parsed.id).is("comment", null).gte("created_at", since);
        return res.json({ success: true });
      }
      const { data, error } = await supabase.from("feedback").insert({
        ...parsed.row,
        referrer: req.headers.referer || null,
        user_agent: req.headers["user-agent"] || null
      }).select("id").single();
      if (error) throw error;
      return res.json({ success: true, id: data.id });
    }

    if (slug) {
      const { error } = await supabase.from("page_events").insert({
        slug,
        event,
        metadata: meta,
        referrer,
        user_agent: c.userAgent || null,
        ip: c.ip,
        is_internal: c.trafficClass === "internal",
        traffic_class: c.trafficClass
      });
      if (error) throw error;
      await markBurstPartners(supabase, c, { event, at });
    } else if (FUNNEL_EVENTS.has(event)) {
      const { error } = await supabase.from("funnel_events").insert(funnelRow({
        event,
        trafficClass: c.trafficClass,
        ip: c.ip,
        userAgent: c.userAgent,
        anonId: anon_id,
        businessId: business_id,
        referrer,
        metadata: meta,
        attribution: req.body.attribution
      }));
      if (error) throw error;
    } else {
      return res.status(400).json({ error: "Missing slug or unrecognized event" });
    }

    res.json({ success: true, traffic_class: c.trafficClass });
  } catch (err) {
    console.error("Analytics insert failed:", err);
    res.status(500).json({ error: "Failed to track event" });
  }
}
