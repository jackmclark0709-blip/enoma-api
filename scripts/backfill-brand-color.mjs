// scripts/backfill-brand-color.mjs
// One-off: read the color of every uploaded logo that doesn't have a stored
// brand_color yet (logos uploaded before migration 20261114_brand_color).
// New uploads get their color on upload (api/_lib/logo-color.js).
//
//   node scripts/backfill-brand-color.mjs           # dry run: lists, writes nothing
//   node scripts/backfill-brand-color.mjs --apply   # writes brand_color
//
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (env or .env).

import { pathToFileURL } from "node:url";
import { logoBrandColor } from "../api/_lib/logo-color.js";

/** Every profile with a logo_url and no brand_color (paged). */
async function profilesToFill(supabase) {
  const out = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await supabase.from("small_business_profiles")
      .select("business_id, username, logo_url, brand_color")
      .not("logo_url", "is", null).is("brand_color", null)
      .order("business_id", { ascending: true }).range(from, from + 499);
    if (error) throw new Error(`profiles: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < 500) return out;
  }
}

async function fetchImage(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

/**
 * Returns [{ business_id, username, logo_url, brand_color, status }].
 * status: "would_set" (dry run), "set", "no_color" or "error: …".
 */
export async function backfillBrandColors({ supabase, apply = false, fetchBytes = fetchImage, readColor = logoBrandColor, log = console } = {}) {
  const rows = await profilesToFill(supabase);
  const results = [];
  for (const p of rows) {
    const r = { business_id: p.business_id, username: p.username, logo_url: p.logo_url, brand_color: null, status: "" };
    try {
      r.brand_color = await readColor(await fetchBytes(p.logo_url), { log });
      if (!r.brand_color) r.status = "no_color";
      else if (!apply) r.status = "would_set";
      else {
        const { error } = await supabase.from("small_business_profiles")
          .update({ brand_color: r.brand_color }).eq("business_id", p.business_id).is("brand_color", null);
        r.status = error ? `error: ${error.message}` : "set";
      }
    } catch (e) {
      r.status = `error: ${e?.message || e}`;
    }
    log.log(`${r.status.padEnd(10)} ${r.brand_color || "-      "}  ${r.username || r.business_id}  ${r.logo_url}`);
    results.push(r);
  }
  const count = s => results.filter(x => x.status === s).length;
  log.log(`\n${results.length} logos without a brand_color: ${apply ? `${count("set")} set` : `${count("would_set")} would be set (dry run, nothing written; add --apply)`}, ${count("no_color")} without a usable color, ${results.filter(x => x.status.startsWith("error")).length} errors.`);
  return results;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  await import("dotenv/config");
  const { createClient } = await import("@supabase/supabase-js");
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  await backfillBrandColors({ supabase, apply: process.argv.includes("--apply") });
}
