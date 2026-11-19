// api/_lib/owner-actions.js
// What the owner bar on a page v2 can do without an account, authorized by
// the owner link's token (?o=, api/_lib/owner-link.js) instead of a login.
// Routed from POST /api/generate-business?kind=owner (no new function: the
// project is at Vercel's function cap).
//
//   action=confirm_town  { slug, o, town }  move one *suggested* town into the
//                        page's service area. Only towns we suggested can be
//                        confirmed this way, so the token can't write free text.
//   action=set_specialty { slug, o, specialty }  "What are you known for?"
//                        (owner bar, claim box). The one free-text field:
//                        cleanOwnerSpecialty keeps it to a few plain words.
//                        Saved on the kit at once, then the kit is rebuilt
//                        (and the launch kit remakes on the next visit).
//   action=approve_service_page { slug, o }  website v3: the owner approves the
//                        auto-drafted service page (api/_lib/service-page-v3.js).
//                        Live site: published now. Preview: published by the
//                        Stripe webhook when the owner goes live.
//   action=pick_service_page { slug, o, service }  write the service page for a
//                        different service; only one of the page's own services.

import { ownerTokenMatches, isPageV2 } from "./owner-link.js";
import { cleanOwnerSpecialty, rebuildBrandKit } from "./brand-kit.js";
import { rebuildFactSheet } from "./fact-sheet.js";
import { AUTO_SOURCE, publishApprovedAutoPage, slugifyService } from "./service-page-v3.js";
import { pageIndexable } from "./pricing.js";
import { syncSpotlightQuantity } from "./spotlight-billing.js";

// The website v3 fact sheet follows the owner's answers (api/_lib/fact-sheet.js).
function refreshFacts(supabaseAdmin, businessId, waitUntil) {
  const job = rebuildFactSheet(supabaseAdmin, businessId).catch(e => console.warn("fact sheet rebuild failed:", e?.message || e));
  try { if (waitUntil) waitUntil(job); } catch { /* the job still runs */ }
  return job;
}

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  let size = 0;
  for await (const c of req) { size += c.length; if (size > 10_000) throw new Error("too_large"); chunks.push(c); }
  const t = Buffer.concat(chunks).toString("utf8");
  return t ? JSON.parse(t) : {};
}

/** Pure: the profile + kit after confirming `town`, or { error }. */
export function confirmTown(profile, town) {
  const kit = profile?.brand_kit;
  const suggested = Array.isArray(kit?.towns?.suggested) ? kit.towns.suggested : [];
  const pick = suggested.find(t => t.toLowerCase() === String(town || "").trim().toLowerCase());
  if (!pick) return { error: "not_suggested" };
  const area = Array.isArray(profile.service_area) ? profile.service_area.map(String) : [];
  const service_area = area.some(t => t.replace(/,.*$/, "").trim().toLowerCase() === pick.toLowerCase()) ? area : [...area, pick];
  const confirmed = Array.isArray(kit.towns.confirmed) ? kit.towns.confirmed : [];
  const brand_kit = {
    ...kit,
    towns: {
      confirmed: confirmed.some(t => t.toLowerCase() === pick.toLowerCase()) ? confirmed : [...confirmed, pick],
      suggested: suggested.filter(t => t !== pick),
    },
  };
  return { town: pick, service_area, brand_kit };
}

/** Pure: the kit with the owner's specialty set (or cleared), or { error }. */
export function setSpecialty(profile, raw) {
  const s = cleanOwnerSpecialty(raw);
  if (s === null) return { error: "Keep it to a few words, like \u201cCathedral ceilings\u201d." };
  const kit = profile?.brand_kit && typeof profile.brand_kit === "object" ? profile.brand_kit : {};
  // Cleared: the next rebuild finds the specialty from the listing again.
  return { specialty: s || null, brand_kit: { ...kit, owner_specialty: s || null, specialty: s || null } };
}

/** Pure: the service the owner picked, if it's one of the page's own services. */
export function pickableService(pageCopy, raw) {
  const services = Array.isArray(pageCopy?.services) ? pageCopy.services : [];
  const want = slugifyService(raw);
  if (!want) return null;
  const hit = services.find(s => slugifyService(s?.name) === want);
  return hit ? String(hit.name).trim() : null;
}

/** Is this business's site live (indexable, the same rule as the home page)? */
async function siteIsLive(supabaseAdmin, profile) {
  const [{ data: sub }, { data: biz }] = await Promise.all([
    supabaseAdmin.from("subscriptions").select("pricing_version, provider, status, stripe_subscription_id, current_period_end").eq("business_id", profile.business_id).maybeSingle(),
    supabaseAdmin.from("businesses").select("is_internal").eq("id", profile.business_id).maybeSingle(),
  ]);
  return pageIndexable({ profile, sub: sub || null, isInternal: biz?.is_internal === true });
}

export async function handleOwnerAction(req, res, { supabaseAdmin, waitUntil = null, stripe = null, env = process.env }) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  let body;
  try { body = await readJson(req); } catch { return res.status(400).json({ error: "Invalid JSON" }); }
  const slug = String(body.slug || "");
  if (!/^[a-z0-9][a-z0-9-]{0,99}$/i.test(slug)) return res.status(400).json({ error: "slug required" });
  const { data: profile } = await supabaseAdmin.from("small_business_profiles")
    .select("business_id, username, page_version, owner_token, service_area, brand_kit, is_claimed, is_public, page_copy_v3")
    .eq("username", slug).maybeSingle();
  // Same answer for "no such page" and "wrong token": nothing to probe.
  if (!profile || !isPageV2(profile) || !ownerTokenMatches(profile, body.o)) return res.status(403).json({ error: "Not allowed" });

  const action = String(req.query?.action || "");
  if (action === "confirm_town") {
    const next = confirmTown(profile, body.town);
    if (next.error) return res.status(400).json({ error: "That town isn't one we suggested." });
    const { error } = await supabaseAdmin.from("small_business_profiles")
      .update({ service_area: next.service_area, brand_kit: next.brand_kit, updated_at: new Date().toISOString() })
      .eq("business_id", profile.business_id);
    if (error) return res.status(500).json({ error: "Couldn't save. Try again." });
    const facts = refreshFacts(supabaseAdmin, profile.business_id, waitUntil);
    if (!waitUntil) await facts;
    return res.status(200).json({ ok: true, town: next.town });
  }
  if (action === "set_specialty") {
    const next = setSpecialty(profile, body.specialty);
    if (next.error) return res.status(400).json({ error: next.error });
    const { error } = await supabaseAdmin.from("small_business_profiles")
      .update({ brand_kit: next.brand_kit, updated_at: new Date().toISOString() })
      .eq("business_id", profile.business_id);
    if (error) return res.status(500).json({ error: "Couldn't save. Try again." });
    const job = rebuildBrandKit(supabaseAdmin, profile.business_id).catch(e => console.warn("brand kit rebuild failed:", e?.message || e))
      .then(() => rebuildFactSheet(supabaseAdmin, profile.business_id)).catch(e => console.warn("fact sheet rebuild failed:", e?.message || e));
    try { waitUntil ? waitUntil(job) : await job; } catch { /* the job still runs */ }
    return res.status(200).json({ ok: true, specialty: next.specialty });
  }
  if (action === "approve_service_page") {
    const { data: row } = await supabaseAdmin.from("service_spotlights").select("id, status, approved_at, source, content")
      .eq("business_id", profile.business_id).eq("source", AUTO_SOURCE).maybeSingle();
    if (!row || row.status === "archived") return res.status(404).json({ error: "There's no service page to approve yet." });
    if (row.status === "published") return res.status(200).json({ ok: true, published: true });
    const approvedAt = row.approved_at || new Date().toISOString();
    const { error } = await supabaseAdmin.from("service_spotlights").update({ approved_at: approvedAt, updated_at: new Date().toISOString() }).eq("id", row.id);
    if (error) return res.status(500).json({ error: "Couldn't save. Try again." });
    if (!(await siteIsLive(supabaseAdmin, profile))) return res.status(200).json({ ok: true, published: false });
    // Live site: publish now. The first page is included; a later one is an
    // add-on, and it never goes live unbilled (same rule as spotlight.js).
    const id = await publishApprovedAutoPage(supabaseAdmin, profile.business_id, { live: true });
    if (id) {
      try {
        await syncSpotlightQuantity({ stripe, supabase: supabaseAdmin, businessId: profile.business_id });
      } catch (e) {
        console.error(`[spotlight-billing] auto page publish refused for ${profile.business_id}:`, e?.message || e);
        await supabaseAdmin.from("service_spotlights").update({ status: "draft", published_at: null, updated_at: new Date().toISOString() }).eq("id", id);
        return res.status(200).json({ ok: true, published: false, error: "Approved. We couldn't add it to your plan just now; Jack will publish it." });
      }
    }
    return res.status(200).json({ ok: true, published: !!id });
  }
  if (action === "pick_service_page") {
    const name = pickableService(profile.page_copy_v3, body.service);
    if (!name) return res.status(400).json({ error: "Pick one of the services on your page." });
    if (env.PAGE_COPY_V3 !== "on") return res.status(503).json({ error: "We can't rewrite pages right now. Text Jack and he'll switch it." });
    // The fact sheet records the pick; saving it rewrites page_copy_v3, which
    // replaces the auto service page (back to draft until approved again).
    const job = rebuildFactSheet(supabaseAdmin, profile.business_id, { owner: { service_for_page: name } })
      .catch(e => console.warn("fact sheet rebuild failed:", e?.message || e));
    try { waitUntil ? waitUntil(job) : await job; } catch { /* the job still runs */ }
    return res.status(202).json({ ok: true, service: name });
  }
  return res.status(400).json({ error: `Unknown action ${action}` });
}
