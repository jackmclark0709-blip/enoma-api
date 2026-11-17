// scripts/refresh-kit-towns.mjs
// Recompute the *suggested* towns on stored page v2 brand kits from the
// current town data (data/towns/<ST>.json). Kits store their towns when
// they're built, so kits built before the Census towns landed still carry the
// old 154-town suggestions (or none: Ewing NJ).
//
//   node scripts/refresh-kit-towns.mjs           # dry run: counts only
//   node scripts/refresh-kit-towns.mjs --apply   # write them
//
// Unclaimed v2 pages only. Confirmed towns (the public ones, and the launch
// kit's) are never changed, so no launch kit is remade and nothing a visitor
// sees changes. No API calls. Run it when nothing else is writing kits (not
// while scripts/rollout-page-v2.mjs is running).
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (env or .env).

import "dotenv/config";
import { pathToFileURL } from "node:url";
import { townsFor, loadTownCoords } from "../api/_lib/brand-kit.js";

/** The kit's towns with fresh suggestions, never touching confirmed ones. null = no change. */
export function refreshedTowns(profile, coords) {
  const kit = profile?.brand_kit;
  if (!kit || typeof kit !== "object") return null;
  const fresh = townsFor(profile, coords);
  const confirmed = Array.isArray(kit.towns?.confirmed) ? kit.towns.confirmed : fresh.confirmed;
  const taken = new Set(confirmed.map(t => String(t).toLowerCase()));
  const suggested = fresh.suggested.filter(t => !taken.has(t.toLowerCase()));
  const before = Array.isArray(kit.towns?.suggested) ? kit.towns.suggested : [];
  if (JSON.stringify(before) === JSON.stringify(suggested) && Array.isArray(kit.towns?.confirmed)) return null;
  return { confirmed, suggested };
}

export async function refreshKitTowns(supabase, { apply = false, load = loadTownCoords, log = console } = {}) {
  const { data, error } = await supabase.from("small_business_profiles")
    .select("business_id, username, city, state, service_area, is_claimed, page_version, brand_kit")
    .eq("page_version", 2);
  if (error) throw new Error(error.message);
  const rows = (data || []).filter(p => p.is_claimed !== true && p.brand_kit);
  const out = { checked: rows.length, changed: 0, gained: 0, still_none: 0, written: 0, failed: [] };
  for (const p of rows) {
    const towns = refreshedTowns(p, await load(p.state));
    const after = towns ? towns.suggested : (p.brand_kit.towns?.suggested || []);
    if (!after.length) out.still_none++;
    if (!towns) continue;
    out.changed++;
    if (!(p.brand_kit.towns?.suggested || []).length && towns.suggested.length) out.gained++;
    if (!apply) continue;
    // Re-read the kit right before writing so nothing else's change is lost.
    const { data: cur } = await supabase.from("small_business_profiles").select("brand_kit").eq("business_id", p.business_id).maybeSingle();
    if (!cur?.brand_kit) { out.failed.push(p.username); continue; }
    const { error: e } = await supabase.from("small_business_profiles")
      .update({ brand_kit: { ...cur.brand_kit, towns } }).eq("business_id", p.business_id);
    if (e) { out.failed.push(p.username); log.warn?.(`${p.username}: ${e.message}`); } else out.written++;
  }
  return out;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const r = await refreshKitTowns(supabase, { apply });
  console.log(`Unclaimed v2 kits: ${r.checked}. Suggestions change on ${r.changed} (${r.gained} go from none to some). ` +
    `${r.still_none} will have none (no nearby towns, or an ambiguous town name).`);
  if (apply) console.log(`Written: ${r.written}. Failed: ${r.failed.length}${r.failed.length ? ` (${r.failed.join(", ")})` : ""}.`);
  else console.log("Dry run. Re-run with --apply to write them.");
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch(e => { console.error(e?.message || e); process.exit(1); });
}
