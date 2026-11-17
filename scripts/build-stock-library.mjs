// scripts/build-stock-library.mjs
// Build the curated Unsplash stock library (table stock_photos) and the
// contact sheet Jack approves from (reports/stock-contact-sheet.html).
//
// For each persona x service in api/_lib/stock-photos.js STOCK_QUERIES:
//   1. one Unsplash search (orientation=landscape, per_page=30, page 1)
//   2. keep photos >= 2400px wide
//   3. one gpt-4o vision call per photo on its 600px URL (cached by photo id)
//      rejecting faces, logos/signage/text, staged poses, off-trade photos
//   4. upsert into stock_photos (approved stays false; never reset)
//
// Unsplash demo keys allow 50 API requests/hour. This throttles to 45 per
// rolling hour, checkpoints after every step, and resumes where it left off,
// so run it in the background and let it take a few hours:
//
//   nohup node scripts/build-stock-library.mjs > reports/stock-build.log 2>&1 &
//
// Flags:
//   --no-db            don't touch Supabase (state file + contact sheet only)
//   --sheet-only       rebuild the contact sheet from the checkpoint, no API calls
//   --personas=a,b     only these personas
//   --max-requests=N   stop after N Unsplash requests this run
//
// Env (or .env): UNSPLASH_ACCESS_KEY, OPENAI_KEY, and for DB writes
// SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
//
// Image URLs (images.unsplash.com) don't count against the rate limit; the
// contact sheet and pages hotlink them. No file is ever downloaded or stored.

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { STOCK_QUERIES, STOCK_PERSONAS, MIN_WIDTH, sizedUrls, UTM } from "../api/_lib/stock-photos.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const STATE_FILE = path.join(ROOT, "reports", "stock-build-state.json");
export const SHEET_FILE = path.join(ROOT, "reports", "stock-contact-sheet.html");
export const PER_HOUR = 45;
const HOUR = 3600_000;

// ── Throttle (pure) ──────────────────────────────────────────────────────

/** ms to wait before the next request, given past request timestamps. */
export function waitBeforeNext(requestTimes, now = Date.now(), perHour = PER_HOUR) {
  const recent = requestTimes.filter(t => now - t < HOUR).sort((a, b) => a - b);
  if (recent.length < perHour) return 0;
  return recent[recent.length - perHour] + HOUR - now + 1000;
}

/** Every query this build runs, in order. */
export function allQueries(personas = STOCK_PERSONAS) {
  return personas.flatMap(persona => (STOCK_QUERIES[persona] || []).map(q => ({ persona, tag: q.tag, query: q.query, key: `${persona}/${q.tag}` })));
}

/** Hours a full build takes at the throttle (search requests only). */
export function buildHours(personas = STOCK_PERSONAS, perHour = PER_HOUR) {
  return allQueries(personas).length / perHour;
}

// ── Unsplash → row ───────────────────────────────────────────────────────

export function rowFromUnsplash(p, persona, tag) {
  return {
    unsplash_id: p.id,
    persona,
    service_tag: tag,
    raw_url: p.urls?.raw,
    width: p.width,
    height: p.height,
    color: /^#[0-9a-f]{6}$/i.test(p.color || "") ? p.color.toLowerCase() : null,
    blur_hash: p.blur_hash || null,
    alt: p.alt_description || p.description || null,
    photographer_name: p.user?.name || p.user?.username,
    photographer_username: p.user?.username,
    photographer_url: p.user?.links?.html || `https://unsplash.com/@${p.user?.username}`,
    photo_page_url: p.links?.html,
    download_location: p.links?.download_location,
  };
}

// ── Vision (one call per image, cached) ──────────────────────────────────

const VERDICT_SCHEMA = {
  name: "stock_verdict",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["recognizable_faces", "logo_or_text", "staged_pose", "looks_like_trade", "reason"],
    properties: {
      recognizable_faces: { type: "boolean", description: "A person whose face could be recognized." },
      logo_or_text: { type: "boolean", description: "Brand logos, readable signage, watermarks or text overlays." },
      staged_pose: { type: "boolean", description: "Cheesy staged stock pose (thumbs up, fake smiles at camera, posed handshakes)." },
      looks_like_trade: { type: "boolean", description: "Looks like real work or results of the named trade/service." },
      reason: { type: "string", description: "One short sentence." },
    },
  },
};

export function verdictPasses(v) {
  return !!v && v.recognizable_faces === false && v.logo_or_text === false && v.staged_pose === false && v.looks_like_trade === true;
}

export function visionRequestBody(imageUrl, persona, tag, query) {
  return {
    model: "gpt-4o",
    temperature: 0,
    response_format: { type: "json_schema", json_schema: VERDICT_SCHEMA },
    messages: [
      { role: "system", content: "You vet stock photos for small trade-business websites (painters, landscapers, plumbers...). Be strict: when unsure about faces, logos or readable text, say true." },
      { role: "user", content: [
        { type: "text", text: `Trade: ${persona}. Service: ${tag} (search: "${query}"). Judge this photo.` },
        { type: "image_url", image_url: { url: imageUrl } },
      ] },
    ],
  };
}

async function askVision(row, q, { fetchImpl = fetch, apiKey = process.env.OPENAI_KEY } = {}) {
  const r = await fetchImpl("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(visionRequestBody(sizedUrls(row.raw_url).w600, q.persona, q.tag, q.query)),
  });
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const msg = (await r.json())?.choices?.[0]?.message;
  if (msg?.refusal || !msg?.content) return { refused: true, reason: String(msg?.refusal || "empty").slice(0, 200) };
  return JSON.parse(msg.content);
}

// ── State ────────────────────────────────────────────────────────────────

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
  catch { return { requests: [], searches: {}, photos: {}, verdicts: {} }; }
}
function saveState(s) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  const tmp = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(s, null, 1));
  fs.renameSync(tmp, STATE_FILE);
}

// ── Counts and contact sheet ─────────────────────────────────────────────

export function countsByPersona(state, approvedIds = new Set()) {
  const out = {};
  for (const p of STOCK_PERSONAS) out[p] = { queries_done: 0, queries: (STOCK_QUERIES[p] || []).length, found: 0, passed: 0, waiting: 0, approved: 0 };
  for (const key of Object.keys(state.searches || {})) { const p = key.split("/")[0]; if (out[p]) out[p].queries_done++; }
  for (const row of Object.values(state.photos || {})) {
    const c = out[row.persona]; if (!c) continue;
    c.found++;
    if (verdictPasses(state.verdicts?.[row.unsplash_id])) {
      c.passed++;
      if (approvedIds.has(row.unsplash_id)) c.approved++; else c.waiting++;
    }
  }
  return out;
}

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function contactSheetHtml(state, approvedIds = new Set()) {
  const counts = countsByPersona(state, approvedIds);
  const rows = Object.values(state.photos || {});
  const card = row => {
    const v = state.verdicts?.[row.unsplash_id];
    const ok = verdictPasses(v);
    const u = sizedUrls(row.raw_url);
    const flags = v ? ["recognizable_faces", "logo_or_text", "staged_pose"].filter(k => v[k]).concat(v.looks_like_trade === false ? ["off_trade"] : []) : ["no_verdict"];
    return `<label class="card${ok ? "" : " rej"}">
  <img loading="lazy" src="${esc(u.w600)}" alt="${esc(row.alt || "")}" width="300" height="${Math.round(300 * row.height / row.width)}">
  <span class="meta"><input type="checkbox" data-id="${esc(row.unsplash_id)}"${approvedIds.has(row.unsplash_id) ? " checked" : ""}>
  <code>${esc(row.unsplash_id)}</code> <i style="background:${esc(row.color || "#888")}"></i> ${row.width}px</span>
  <span class="why">${ok ? "" : `<b>${esc(flags.join(", "))}</b> `}${esc(v?.reason || "")}</span>
  <span class="credit">Photo by <a href="${esc(row.photographer_url)}?${UTM}" target="_blank">${esc(row.photographer_name)}</a> on <a href="https://unsplash.com/?${UTM}" target="_blank">Unsplash</a></span>
</label>`;
  };
  const sections = STOCK_PERSONAS.map(persona => {
    const mine = rows.filter(r => r.persona === persona);
    const c = counts[persona];
    const byTag = (STOCK_QUERIES[persona] || []).map(q => {
      const passed = mine.filter(r => r.service_tag === q.tag && verdictPasses(state.verdicts?.[r.unsplash_id]));
      return `<h3>${esc(q.tag)} <small>“${esc(q.query)}” · ${passed.length} passed</small></h3><div class="grid">${passed.map(card).join("") || "<p class=empty>none yet</p>"}</div>`;
    }).join("");
    const rejected = mine.filter(r => !verdictPasses(state.verdicts?.[r.unsplash_id]));
    return `<section><h2>${esc(persona)} <small>${c.queries_done}/${c.queries} searches · ${c.found} found · ${c.passed} passed vision · ${c.waiting} waiting · ${c.approved} approved</small></h2>
${byTag}
<details><summary>${rejected.length} rejected by vision</summary><div class="grid">${rejected.map(card).join("")}</div></details></section>`;
  }).join("\n");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Stock contact sheet</title>
<style>
body{font:14px/1.4 system-ui,sans-serif;margin:0;padding:16px 16px 80px;background:#f6f4f0;color:#1a1714}
h2{margin:32px 0 4px;text-transform:capitalize}h2 small,h3 small{font-weight:400;color:#6b655d;font-size:13px}
h3{margin:16px 0 6px;font-size:15px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px}
.card{display:flex;flex-direction:column;background:#fff;border:2px solid #e6e1d9;border-radius:8px;overflow:hidden;cursor:pointer}
.card:has(input:checked){border-color:#2f6b3a;box-shadow:0 0 0 2px #2f6b3a}.card.rej{opacity:.65}
.card img{width:100%;height:auto;display:block;background:#ddd}.meta,.why,.credit{padding:4px 8px;font-size:12px}
.meta i{display:inline-block;width:12px;height:12px;border-radius:2px;vertical-align:middle}.why{color:#6b655d}.credit{color:#6b655d}
.bar{position:fixed;left:0;right:0;bottom:0;background:#1a1714;color:#fff;padding:12px 16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.bar button{font:inherit;padding:8px 14px;border-radius:6px;border:0;background:#F2A93B;color:#1a1714;cursor:pointer}.empty{color:#6b655d}
</style></head><body>
<h1>Unsplash stock contact sheet</h1>
<p>Tick the photos to approve, then “Copy approved IDs” and run the copied command. Only approved photos are ever used on a page. Generated ${esc(new Date().toISOString())}.</p>
${sections}
<div class="bar"><button id="copy">Copy approved IDs</button><span id="n">0 selected</span><code id="out"></code></div>
<script>
const boxes=[...document.querySelectorAll('input[data-id]')];
const ids=()=>boxes.filter(b=>b.checked).map(b=>b.dataset.id);
const upd=()=>{document.getElementById('n').textContent=ids().length+' selected'};
boxes.forEach(b=>b.addEventListener('change',upd));upd();
document.getElementById('copy').onclick=async()=>{const cmd='node scripts/approve-stock.mjs '+ids().join(' ');
document.getElementById('out').textContent=cmd;try{await navigator.clipboard.writeText(cmd)}catch(e){}};
</script></body></html>`;
}

// ── Main ─────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString(), ...a);

async function dbClient(noDb) {
  if (noDb || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

async function approvedIdsFrom(db) {
  if (!db) return new Set();
  const { data, error } = await db.from("stock_photos").select("unsplash_id").eq("approved", true);
  if (error) { log("approved ids:", error.message); return new Set(); }
  return new Set((data || []).map(r => r.unsplash_id));
}

async function upsertRows(db, rows) {
  if (!db || !rows.length) return;
  // approved is deliberately not in the payload, so a rebuild never resets it.
  const { error } = await db.from("stock_photos").upsert(rows.map(r => ({ ...r, updated_at: new Date().toISOString() })), { onConflict: "unsplash_id" });
  if (error) log("upsert:", error.message);
}

export async function main(argv = process.argv.slice(2)) {
  const flag = n => argv.includes(`--${n}`);
  const opt = n => argv.find(a => a.startsWith(`--${n}=`))?.split("=")[1];
  const personas = opt("personas") ? opt("personas").split(",").filter(p => STOCK_QUERIES[p]) : STOCK_PERSONAS;
  const maxRequests = Number(opt("max-requests")) || Infinity;
  const state = loadState();
  const db = await dbClient(flag("no-db"));

  const writeSheet = async () => {
    const approved = await approvedIdsFrom(db);
    fs.writeFileSync(SHEET_FILE, contactSheetHtml(state, approved));
    return countsByPersona(state, approved);
  };

  if (flag("sheet-only")) { console.table(await writeSheet()); return; }
  if (!process.env.UNSPLASH_ACCESS_KEY) throw new Error("UNSPLASH_ACCESS_KEY is not set");
  if (!process.env.OPENAI_KEY) throw new Error("OPENAI_KEY is not set");
  if (!db) log("no Supabase credentials (or --no-db): state file + contact sheet only");
  else {
    // Verdicts already stored in the DB count as cached too (lost state file).
    const { data } = await db.from("stock_photos").select("unsplash_id, vision_verdict").not("vision_verdict", "is", null);
    for (const r of data || []) state.verdicts[r.unsplash_id] ??= r.vision_verdict;
  }

  const todo = allQueries(personas).filter(q => !state.searches[q.key]);
  log(`${todo.length} searches to go (~${(todo.length / PER_HOUR).toFixed(1)} h at ${PER_HOUR}/h)`);
  let made = 0;

  for (const q of todo) {
    if (made >= maxRequests) { log(`stopping: --max-requests=${maxRequests}`); break; }
    const wait = waitBeforeNext(state.requests);
    if (wait > 0) { log(`throttle: sleeping ${Math.ceil(wait / 60000)} min`); await sleep(wait); }

    const url = `https://api.unsplash.com/search/photos?${new URLSearchParams({ query: q.query, orientation: "landscape", per_page: "30", page: "1", content_filter: "high" })}`;
    state.requests.push(Date.now());
    state.requests = state.requests.filter(t => Date.now() - t < HOUR);
    saveState(state);
    made++;
    const r = await fetch(url, { headers: { Authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}`, "Accept-Version": "v1" } });
    const remaining = Number(r.headers.get("x-ratelimit-remaining"));
    if (r.status === 403 || r.status === 429) {
      log(`rate limited on ${q.key}; sleeping an hour then retrying`);
      await sleep(HOUR); todo.push(q); continue;
    }
    if (!r.ok) { log(`search ${q.key}: HTTP ${r.status}`); continue; }
    const body = await r.json();
    const wide = (body.results || []).filter(p => p.width >= MIN_WIDTH && p.urls?.raw && p.links?.download_location);
    const fresh = wide.filter(p => !state.photos[p.id]).map(p => rowFromUnsplash(p, q.persona, q.tag));
    for (const row of fresh) state.photos[row.unsplash_id] = row;
    state.searches[q.key] = { at: new Date().toISOString(), results: body.results?.length || 0, wide: wide.length, new: fresh.length };
    saveState(state);
    log(`${q.key}: ${body.results?.length || 0} results, ${wide.length} >= ${MIN_WIDTH}px, ${fresh.length} new (rate remaining ${remaining})`);

    // Vision: one call per new photo, cached in the state file by photo id.
    for (const row of fresh) {
      if (state.verdicts[row.unsplash_id]) continue;
      try { state.verdicts[row.unsplash_id] = await askVision(row, q); }
      catch (e) { log(`vision ${row.unsplash_id}: ${e.message}`); continue; }
      saveState(state);
    }
    await upsertRows(db, fresh.map(row => ({ ...row, vision_verdict: state.verdicts[row.unsplash_id] || null })));
    await writeSheet();
    if (Number.isFinite(remaining) && remaining <= 2) { log("Unsplash says the hour is nearly spent; sleeping an hour"); await sleep(HOUR); }
  }

  // Retry vision for any photo whose call failed earlier (no Unsplash calls).
  for (const row of Object.values(state.photos)) {
    if (state.verdicts[row.unsplash_id] || !personas.includes(row.persona)) continue;
    const q = allQueries([row.persona]).find(x => x.tag === row.service_tag) || { persona: row.persona, tag: row.service_tag, query: row.service_tag };
    try { state.verdicts[row.unsplash_id] = await askVision(row, q); saveState(state); }
    catch (e) { log(`vision retry ${row.unsplash_id}: ${e.message}`); continue; }
    await upsertRows(db, [{ ...row, vision_verdict: state.verdicts[row.unsplash_id] }]);
  }

  const counts = await writeSheet();
  log(`done. contact sheet: ${SHEET_FILE}`);
  console.table(counts);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch(e => { console.error(e); process.exit(1); });
}
