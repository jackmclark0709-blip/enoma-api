// scripts/approve-stock.mjs
// Approve stock photos by hand (only approved photos are ever used on pages).
// The contact sheet's "Copy approved IDs" button copies this command.
//
//   node scripts/approve-stock.mjs <unsplash_id…>            # approve
//   node scripts/approve-stock.mjs --revoke <unsplash_id…>   # un-approve
//
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (env or .env).

import "dotenv/config";
import { pathToFileURL } from "node:url";

export function parseArgs(argv) {
  const revoke = argv.includes("--revoke");
  const ids = [...new Set(argv.filter(a => !a.startsWith("--")).flatMap(a => a.split(/[\s,]+/)).filter(Boolean))];
  return { approved: !revoke, ids };
}

export async function setApproved(supabase, ids, approved = true) {
  if (!ids.length) return { updated: [], missing: [] };
  const { data, error } = await supabase.from("stock_photos")
    .update({ approved, updated_at: new Date().toISOString() })
    .in("unsplash_id", ids).select("unsplash_id");
  if (error) throw new Error(`stock_photos: ${error.message}`);
  const updated = (data || []).map(r => r.unsplash_id);
  return { updated, missing: ids.filter(id => !updated.includes(id)) };
}

async function main() {
  const { approved, ids } = parseArgs(process.argv.slice(2));
  if (!ids.length) { console.error("usage: node scripts/approve-stock.mjs [--revoke] <unsplash_id…>"); process.exit(2); }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { updated, missing } = await setApproved(supabase, ids, approved);
  console.log(`${approved ? "approved" : "revoked"} ${updated.length} photo(s)`);
  if (missing.length) console.log(`not in stock_photos: ${missing.join(" ")}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch(e => { console.error(e.message || e); process.exit(1); });
}
