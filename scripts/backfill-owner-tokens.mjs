// scripts/backfill-owner-tokens.mjs
// One-off: give every page v2 profile without an owner token one, so
// scheduled agents reading Supabase can build owner links. Idempotent: rows
// that already have a token are never touched, and a re-run finds nothing.
//
//   node scripts/backfill-owner-tokens.mjs           # dry run: count only
//   node scripts/backfill-owner-tokens.mjs --apply   # mint the tokens
//
// Prints counts and slugs only, never tokens.
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (env or .env).

import "dotenv/config";
import { pathToFileURL } from "node:url";
import { ensureOwnerToken } from "../api/_lib/owner-link.js";

export async function backfillOwnerTokens(supabase, { apply = false, log = console } = {}) {
  const { data, error } = await supabase.from("small_business_profiles")
    .select("business_id, username, page_version, owner_token")
    .eq("page_version", 2).is("owner_token", null);
  if (error) throw new Error(`small_business_profiles: ${error.message}`);
  const rows = data || [];
  const minted = [], failed = [];
  if (apply) {
    for (const row of rows) {
      const token = await ensureOwnerToken(supabase, row, { log });
      (token ? minted : failed).push(row.username);
    }
  }
  return { missing: rows.map(r => r.username), minted, failed };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const r = await backfillOwnerTokens(supabase, { apply });
  console.log(`v2 profiles without an owner token: ${r.missing.length}`);
  if (r.missing.length) console.log("  " + r.missing.join(", "));
  if (apply) console.log(`minted: ${r.minted.length}, failed: ${r.failed.length}${r.failed.length ? " (" + r.failed.join(", ") + ")" : ""}`);
  else if (r.missing.length) console.log("Dry run. Re-run with --apply to mint them.");
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch(e => { console.error(e?.message || e); process.exit(1); });
}
