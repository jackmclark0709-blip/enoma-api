// scripts/rollout-page-v2.mjs
// Move every unclaimed preview from page v1 to page v2: brand kit, owner
// token, launch kit. Runs locally with the service key (not in a serverless
// function, so no 60 s limit and no 3-kits-per-run cap).
//
//   node scripts/rollout-page-v2.mjs                 # dry run (default): reads only, writes the report
//   node scripts/rollout-page-v2.mjs --live --limit 10
//   node scripts/rollout-page-v2.mjs --live          # the rest (resumes from the state file)
//   node scripts/rollout-page-v2.mjs --slug <slug>   # one business (dry run unless --live)
//   node scripts/rollout-page-v2.mjs --revert        # put back page_version from the state file
//   node scripts/rollout-page-v2.mjs --report-only   # rebuild the dry-run report from saved state (no API calls)
//   node scripts/rollout-page-v2.mjs --rebuild --live  # rebuild kits for rows already on v2
//
// Who's in: page_version 1, not claimed, no subscription other than the
// auto-created preview trial, not internal, not Conway's.
//
// Dry run: builds kits and captions in memory (same Places + vision calls,
// cached for the live run), picks stock photos WITHOUT the Unsplash download
// ping, writes nothing to the DB, then writes reports/v2-rollout-dryrun.html.
// Live: per business, brand kit → page_version 2 + owner token → launch kit,
// checkpointed to reports/v2-rollout-state.json after each one. Unsplash
// download pings are throttled under 45/hour (demo key limit is 50/hour).
//
// Never prints owner tokens or keys, except --live --print-links prints the
// owner links for the businesses this run moved, to the terminal only.
// Needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_KEY,
// GOOGLE_SERVER_PLACES_KEY, UNSPLASH_ACCESS_KEY (live only) in env or .env.

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import { buildBrandKit, saveBrandKit, googlePhotoUri } from "../api/_lib/brand-kit.js";
import { promoteToPageV2, ownerPageUrl } from "../api/_lib/owner-link.js";
import { piecesFor } from "../api/_lib/launch-kit.js";
import { captionsFor, generateLaunchKit } from "../api/_lib/launch-kit-render.js";
import { trackStockAssignment } from "../api/_lib/stock-photos.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const STATE_FILE = path.join(ROOT, "reports", "v2-rollout-state.json");
export const DRY_FILE = path.join(ROOT, "reports", "v2-rollout-dryrun.json");
export const REPORT_FILE = path.join(ROOT, "reports", "v2-rollout-dryrun.html");
export const SHOTS_DIR = path.join(ROOT, "reports", "v2-rollout-shots");
export const MISSING_LOGOS_FILE = path.join(ROOT, "reports", "v2-missing-logos.csv");

// ── Selection ─────────────────────────────────────────────────────────────

export const INTERNAL_SLUGS = ["enoma-io", "assayquant-technologies-inc", "qc-test-plumbing", "cars"];
export const EXCLUDED_SLUGS = ["conways-landscaping"];
const INTERNAL_EMAILS = ["jack@enoma.io", "jclark22@une.edu"];

export function isInternalEmail(email) {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return false;
  return INTERNAL_EMAILS.includes(e) || /(^|[@.])enoma\.test$/.test(e);
}

/**
 * The trial row preview generation inserts for every unclaimed preview
 * (stripe / trialing / is_trial, no Stripe customer or subscription). It
 * isn't a subscription anyone chose; anything else (a real Stripe
 * subscription, comped, another provider, any other status) is.
 */
export function isPreviewTrialPlaceholder(sub) {
  return !!sub && sub.provider === "stripe" && sub.status === "trialing" && sub.is_trial === true
    && !sub.stripe_subscription_id && !sub.stripe_customer_id;
}

/** Why this profile is out of the rollout, or null if it's in. mode: "rollout" | "rebuild". */
export function exclusionReason({ profile = {}, business = {}, subs = [] } = {}, { mode = "rollout" } = {}) {
  const want = mode === "rebuild" ? 2 : 1;
  if (Number(profile.page_version || 1) !== want) return `page_version_${Number(profile.page_version || 1)}`;
  if (profile.is_claimed === true) return "claimed";
  if ((subs || []).some(s => !isPreviewTrialPlaceholder(s))) return "subscribed";
  const slugs = [profile.username, business.slug].filter(Boolean);
  if (business.is_internal === true || slugs.some(s => INTERNAL_SLUGS.includes(s)) || isInternalEmail(profile.email)) return "internal";
  if (slugs.some(s => EXCLUDED_SLUGS.includes(s))) return "excluded_slug";
  return null;
}

export function hasPhone(profile = {}) {
  return String(profile.phone || "").replace(/\D/g, "").length >= 10;
}

async function fetchAll(q) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q().range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) return out;
  }
}

export async function loadCandidates(supabase, { mode = "rollout", slug = null } = {}) {
  const profiles = await fetchAll(() => {
    let q = supabase.from("small_business_profiles").select("*").order("business_id");
    if (slug) q = q.eq("username", slug);
    return q;
  });
  const ids = profiles.map(p => p.business_id).filter(Boolean);
  const businesses = new Map(), subs = new Map();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { data: b, error: be } = await supabase.from("businesses").select("id, slug, is_internal").in("id", chunk);
    if (be) throw new Error(`businesses: ${be.message}`);
    for (const r of b || []) businesses.set(r.id, r);
    const { data: s, error: se } = await supabase.from("subscriptions")
      .select("business_id, provider, status, is_trial, stripe_subscription_id, stripe_customer_id").in("business_id", chunk);
    if (se) throw new Error(`subscriptions: ${se.message}`);
    for (const r of s || []) { if (!subs.has(r.business_id)) subs.set(r.business_id, []); subs.get(r.business_id).push(r); }
  }
  const included = [], excluded = {};
  for (const p of profiles) {
    if (!p.business_id) { excluded.no_business_id = (excluded.no_business_id || 0) + 1; continue; }
    const why = exclusionReason({ profile: p, business: businesses.get(p.business_id) || {}, subs: subs.get(p.business_id) || [] }, { mode });
    if (why) excluded[why] = (excluded[why] || 0) + 1;
    else included.push(p);
  }
  included.sort((a, b) => String(a.username).localeCompare(String(b.username)));
  return { included, excluded };
}

// ── Throttles and cost ────────────────────────────────────────────────────

const sleepReal = ms => new Promise(r => setTimeout(r, ms));
const HOUR = 3600_000;

/**
 * Unsplash download pings, at most perHour in any rolling hour. history is
 * the ping times (ms), kept in the state file so a resumed run still counts
 * the pings made before it stopped.
 */
export class PingThrottle {
  constructor({ perHour = 45, now = () => Date.now(), sleep = sleepReal, history = [] } = {}) {
    this.perHour = perHour; this.now = now; this.sleep = sleep; this.history = [...history];
  }
  prune() { const cut = this.now() - HOUR; this.history = this.history.filter(t => t > cut); }
  delayMs() {
    this.prune();
    if (this.history.length < this.perHour) return 0;
    return this.history[this.history.length - this.perHour] + HOUR - this.now() + 1000;
  }
  async wait(onWait) {
    for (let d = this.delayMs(); d > 0; d = this.delayMs()) {
      onWait?.(d);
      await this.sleep(d);
    }
  }
  record() { this.history.push(this.now()); this.prune(); }
}

// Rough unit costs (USD) for the running total; the real bill is per SKU.
export const UNIT_COST = { places_details: 0.02, places_media: 0.007, openai: 0.01 };

export function callKind(url) {
  const u = String(url || "");
  if (/^https:\/\/places\.googleapis\.com\/v1\/.+\/media/.test(u)) return "places_media";
  if (/^https:\/\/places\.googleapis\.com\/v1\/places\//.test(u)) return "places_details";
  if (/^https:\/\/api\.openai\.com\//.test(u)) return "openai";
  return null;
}

/**
 * fetch with a minimum gap between Places calls and between OpenAI calls
 * (well under quota), counting each billable call for the running cost.
 */
export function meteredFetch(fetchImpl = globalThis.fetch, { gapMs = { places: 150, openai: 400 }, now = () => Date.now(), sleep = sleepReal } = {}) {
  const counts = { places_details: 0, places_media: 0, openai: 0 };
  const last = { places: 0, openai: 0 };
  const f = async (url, opts) => {
    const kind = callKind(url);
    if (kind) {
      const lane = kind === "openai" ? "openai" : "places";
      const wait = last[lane] + gapMs[lane] - now();
      if (wait > 0) await sleep(wait);
      last[lane] = now();
      counts[kind]++;
    }
    return fetchImpl(url, opts);
  };
  f.counts = counts;
  f.cost = () => Object.entries(counts).reduce((s, [k, n]) => s + n * UNIT_COST[k], 0);
  return f;
}

// ── State ─────────────────────────────────────────────────────────────────

export function readState(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return { entries: {}, pings: [] }; }
}

export function writeState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 1));
  fs.renameSync(tmp, file);
}

const DONE = new Set(["v2", "stayed_v1", "rebuilt", "would_v2", "would_stay_v1", "would_rebuild"]);
export function isDone(entry) { return !!entry && DONE.has(entry.result); }

export function heroKindLabel(kit) {
  const h = kit?.hero || {};
  if (h.kind === "stock") return "stock_photo";
  if (h.kind === "scene") return "drawn_scene";
  if (h.kind === "work_photo") return /^google:/.test(String(h.ref || "")) ? "google_work_photo" : "owner_photo";
  return "unknown";
}

function kitSummary(kit) {
  return {
    logo_source: kit?.logo?.source || "none",
    logo_quality: kit?.logo?.quality || "none",
    color_source: kit?.colors?.source || null,
    specialty: kit?.specialty || null,
    owner_names: kit?.owner_names || [],
    hero_kind: heroKindLabel(kit),
    stock_photo: kit?.hero?.kind === "stock" ? kit.hero.ref?.unsplash_id || null : null,
  };
}

// ── One business ──────────────────────────────────────────────────────────

/**
 * Process one profile. deps (all injectable for tests):
 *   supabase, dryRun, mode, buildKit, saveKit, promote, makeLaunchKit,
 *   makeCaptions, ping (photo, businessId) → { triggered, reason },
 *   lookupPhoto (unsplash_id) → { unsplash_id, download_location },
 *   throttle (PingThrottle), cached ({ kit, captions } from the dry run), log
 * Returns { entry, token, kit, captions }. token is never written to the entry.
 */
export async function processBusiness(profile, deps) {
  const { dryRun = true, mode = "rollout", log = console } = deps;
  const entry = {
    slug: profile.username, business_id: profile.business_id, business_name: profile.business_name,
    city: profile.city || null, state: profile.state || null, trade: profile.primary_category || null,
    website: profile.website || null, facebook_url: profile.facebook_url || profile.facebook || null,
    prev_page_version: Number(profile.page_version || 1), at: new Date().toISOString(), mode,
  };
  const cached = deps.cached || null;
  const prevKit = cached?.kit || (profile.brand_kit && typeof profile.brand_kit === "object" ? profile.brand_kit : null);
  // Reuse the dry run's captions in the live run (captionsFor matches on its key).
  const seeded = prevKit && cached?.captions ? { ...prevKit, launch_kit: { ...(prevKit.launch_kit || {}), captions: cached.captions } } : prevKit;
  const forBuild = { ...profile, brand_kit: seeded };
  const stay = reason => ({ entry: { ...entry, result: dryRun ? "would_stay_v1" : "stayed_v1", reason }, token: null });

  if (mode === "rollout" && !hasPhone(profile)) return stay("no_phone");
  let kit;
  try {
    kit = await deps.buildKit(forBuild, { supabase: deps.supabase, trackStock: false, log });
  } catch (e) {
    return stay(`brand_kit_threw: ${String(e?.message || e).slice(0, 160)}`);
  }
  if (!kit?.colors?.identity) return stay("brand_kit_empty");
  Object.assign(entry, kitSummary(kit));

  if (dryRun) {
    let captions = null;
    try {
      captions = await deps.makeCaptions({ ...profile, page_version: 2, brand_kit: kit }, kit);
      entry.captions_source = captions?.source || null;
      entry.caption_issues = captions?.issues || [];
    } catch (e) { entry.captions_source = `error: ${String(e?.message || e).slice(0, 120)}`; }
    entry.result = mode === "rebuild" ? "would_rebuild" : "would_v2";
    return { entry, token: null, kit, captions };
  }

  // Live. 1) Unsplash's download ping, throttled, once per business.
  if (kit.hero?.kind === "stock" && kit.hero.ref?.unsplash_id) {
    const photo = await deps.lookupPhoto(kit.hero.ref.unsplash_id);
    if (photo?.download_location) {
      await deps.throttle.wait(ms => log.log?.(`  waiting ${Math.ceil(ms / 60000)} min for the Unsplash ping limit`));
      const r = await deps.ping(photo, profile.business_id);
      if (r?.triggered) deps.throttle.record();
      entry.ping = r?.reason || "unknown"; // a failed ping releases its row; the next kit build retries it
    } else entry.ping = "photo_not_found";
  }
  // 2) Store the kit.
  const saved = await deps.saveKit(deps.supabase, profile.business_id, kit, { log });
  if (!saved) return stay("kit_not_saved");
  if (mode === "rebuild") {
    entry.result = "rebuilt";
    return { entry, token: null, kit };
  }
  // 3) page_version 2 + owner token.
  const promoted = await deps.promote(deps.supabase, profile, { log });
  if (!promoted?.ok) return stay(`promote_failed: ${promoted?.error || "unknown"}`);
  entry.result = "v2";
  entry.token_minted = !!promoted.token;
  // 4) Launch kit (same code as page creation).
  try {
    const lk = await deps.makeLaunchKit({ ...profile, page_version: 2, brand_kit: kit }, { supabase: deps.supabase, log });
    entry.kit_status = lk?.status || "skipped";
    if (lk?.error) entry.kit_error = lk.error;
  } catch (e) {
    entry.kit_status = "error";
    entry.kit_error = String(e?.message || e).slice(0, 160);
  }
  return { entry, token: promoted.token, kit };
}

// ── Revert ────────────────────────────────────────────────────────────────

/** Put back page_version for every business this rollout moved. Tokens and kits stay. */
export async function revert(supabase, state, { log = console } = {}) {
  const out = { reverted: [], failed: [] };
  for (const e of Object.values(state.entries || {})) {
    if (e.result !== "v2" || e.reverted_at) continue;
    const { error } = await supabase.from("small_business_profiles")
      .update({ page_version: e.prev_page_version || 1 }).eq("business_id", e.business_id);
    if (error) { out.failed.push(e.slug); log.warn?.(`revert ${e.slug}: ${error.message}`); continue; }
    e.reverted_at = new Date().toISOString();
    e.result = "reverted";
    out.reverted.push(e.slug);
  }
  return out;
}

// ── Summary and report ────────────────────────────────────────────────────

export function summarize(entries) {
  const list = Object.values(entries || {});
  const count = key => list.reduce((m, e) => { const k = e[key] ?? "n/a"; m[k] = (m[k] || 0) + 1; return m; }, {});
  const built = list.filter(e => e.hero_kind);
  return {
    total: list.length,
    results: count("result"),
    reasons: list.filter(e => e.reason).reduce((m, e) => { const k = e.reason.split(":")[0]; m[k] = (m[k] || 0) + 1; return m; }, {}),
    logo_source: built.reduce((m, e) => { m[e.logo_source] = (m[e.logo_source] || 0) + 1; return m; }, {}),
    color_source: built.reduce((m, e) => { m[e.color_source || "none"] = (m[e.color_source || "none"] || 0) + 1; return m; }, {}),
    with_specialty: built.filter(e => e.specialty).length,
    with_owner_names: built.filter(e => (e.owner_names || []).length).length,
    hero_kind: built.reduce((m, e) => { m[e.hero_kind] = (m[e.hero_kind] || 0) + 1; return m; }, {}),
    kit_status: count("kit_status"),
    captions_source: built.reduce((m, e) => { if (e.captions_source) m[e.captions_source] = (m[e.captions_source] || 0) + 1; return m; }, {}),
    built: built.length,
  };
}

export function missingLogosCsv(entries) {
  const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = Object.values(entries || {}).filter(e => (e.result === "v2" || e.result === "would_v2") && e.logo_source === "none");
  return ["business_name,city,state,website,facebook_url,slug", ...rows.map(e => [e.business_name, e.city, e.state, e.website, e.facebook_url, e.slug].map(q).join(","))].join("\n") + "\n";
}

/** Up to n businesses, spread across trades, picked the same way every time. */
export function pickSpread(entries, n = 12) {
  const byTrade = new Map();
  const list = Object.values(entries).filter(e => e.result === "would_v2" || e.result === "v2")
    .sort((a, b) => hash(a.slug) - hash(b.slug));
  for (const e of list) { const t = e.trade || "Other"; if (!byTrade.has(t)) byTrade.set(t, []); byTrade.get(t).push(e); }
  const out = [];
  const queues = [...byTrade.values()];
  for (let i = 0; out.length < n && queues.some(q => q.length); i = (i + 1) % queues.length) {
    if (queues[i].length) out.push(queues[i].shift());
  }
  return out;
}

function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function table(title, obj, total) {
  const rows = Object.entries(obj).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `<tr><td>${esc(k)}</td><td class="n">${v}</td><td class="n">${total ? Math.round((100 * v) / total) + "%" : ""}</td></tr>`).join("");
  return `<section><h2>${esc(title)}</h2><table>${rows || "<tr><td>none</td></tr>"}</table></section>`;
}

export function reportHtml({ summary, candidates, excluded, cost, counts, shots, generatedAt }) {
  const s = summary;
  const wouldFail = Object.entries(s.results).filter(([k]) => /stay/.test(k)).reduce((a, [, v]) => a + v, 0);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Page v2 rollout: dry run</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font:15px/1.45 system-ui,sans-serif;margin:24px;color:#1a1714;background:#faf8f5}h1{margin:0 0 4px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px}section{background:#fff;border:1px solid #e5e0d8;border-radius:10px;padding:12px 16px}
table{border-collapse:collapse;width:100%}td{padding:3px 6px;border-bottom:1px solid #f0ece6}.n{text-align:right;font-variant-numeric:tabular-nums}
.big{font-size:28px;font-weight:700}.shots{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px;margin-top:16px}
.shot img{width:100%;border:1px solid #ddd;border-radius:8px;display:block}.shot p{margin:4px 0 0;font-size:13px}.muted{color:#6b645c}</style></head><body>
<h1>Page v2 rollout: dry run</h1><p class="muted">${esc(generatedAt)} · nothing was written to the database and no Unsplash download pings were sent.</p>
<div class="grid">
<section><h2>Headline</h2><p class="big">${s.results.would_v2 || 0} / ${candidates}</p><p>would move to v2. ${wouldFail} would fail the gate and stay on v1.</p>
<p>Estimated API cost: <b>$${cost.toFixed(2)}</b><br><span class="muted">Places details ${counts.places_details}, Places photos ${counts.places_media}, OpenAI ${counts.openai}</span></p></section>
${table("Excluded before the run", excluded)}
${table("Would fail the gate (reason)", s.reasons, candidates)}
${table("Logo found (source)", s.logo_source, s.built)}
${table("Colors from", s.color_source, s.built)}
<section><h2>Specialty and owner names</h2><table><tr><td>Has a specialty</td><td class="n">${s.with_specialty}</td><td class="n">${s.built ? Math.round(100 * s.with_specialty / s.built) : 0}%</td></tr><tr><td>Has owner names</td><td class="n">${s.with_owner_names}</td><td class="n">${s.built ? Math.round(100 * s.with_owner_names / s.built) : 0}%</td></tr></table></section>
${table("Hero", s.hero_kind, s.built)}
${table("Captions", s.captions_source, s.built)}
</div>
<h2>12 businesses across trades (phone width, rendered locally from the dry-run kits)</h2>
<div class="shots">${shots.map(x => `<figure class="shot">${x.png ? `<img src="${esc(x.png)}" alt="">` : `<p class="muted">no screenshot: ${esc(x.error || "")}</p>`}<p><b>${esc(x.entry.business_name)}</b><br>${esc(x.entry.trade || "")} · ${esc([x.entry.city, x.entry.state].filter(Boolean).join(", "))}<br><span class="muted">logo ${esc(x.entry.logo_source)} · colors ${esc(x.entry.color_source)} · hero ${esc(x.entry.hero_kind)}${x.entry.specialty ? ` · specialty “${esc(x.entry.specialty)}”` : ""}</span></p></figure>`).join("")}</div>
</body></html>`;
}

// ── Local renders for the report ──────────────────────────────────────────

const CHROME = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
].filter(Boolean).find(p => { try { return fs.existsSync(p); } catch { return false; } });

/**
 * The page as a visitor would see it, rendered from a dry-run kit: same
 * template and blocks as api/p.js, scripts stripped (so nothing calls
 * production), assets from enoma.io, Google photos resolved directly.
 */
export async function renderForShot(profile, kit, { resolvePhoto } = {}) {
  const { renderCompanyPage } = await import("../api/_lib/company-page.js");
  const { renderBlocksV2, kitStyle, v2Head, ogTitleFor } = await import("../api/_lib/page-v2.js");
  const { personaFor } = await import("../api/_lib/page-style.js");
  const p = { ...profile, page_version: 2, brand_kit: kit };
  const slug = p.username;
  const template = fs.readFileSync(path.join(ROOT, "public", "profile.html"), "utf8");
  let html = renderCompanyPage(template, p, {
    slug, spotlights: [], approvedReviews: [], paying: false,
    blocks: renderBlocksV2(p, kit, { slug, spotlights: [], approvedReviews: [] }),
    head: {
      "{{FINAL_TITLE}}": esc(p.business_name), "{{OG_TITLE}}": esc(ogTitleFor(p, kit)), "{{FINAL_DESCRIPTION}}": "",
      "{{FINAL_OG_IMAGE}}": "", "{{FINAL_CANONICAL_URL}}": "", "{{ROBOTS}}": "noindex", "{{HERO_PRELOAD}}": "",
      "{{V2_HEAD}}": v2Head(kit), "{{BRAND_COLOR_STYLE}}": kitStyle(kit),
      "{{BODY_CLASS}}": esc(`page-v2 persona-${personaFor(p.primary_category)}`),
    },
  });
  html = html.replace(/<script\b[\s\S]*?<\/script>/gi, "").replace(/<head>/i, '<head><base href="https://enoma.io/">');
  const re = /\/api\/p\?gphoto=1&(?:amp;)?slug=[^&"]+&(?:amp;)?i=(\d+)/g;
  const idx = [...new Set([...html.matchAll(re)].map(m => Number(m[1])))];
  for (const i of idx) {
    const name = kit.google_photos?.[i]?.name;
    const uri = name && resolvePhoto ? await resolvePhoto(name).catch(() => null) : null;
    html = html.replace(new RegExp(`/api/p\\?gphoto=1&(?:amp;)?slug=[^&"]+&(?:amp;)?i=${i}(?!\\d)`, "g"), uri || "");
  }
  return html;
}

/**
 * Phone-width screenshot. Headless Chrome won't make a window narrower than
 * ~500px, so the page renders in a 390px iframe and the PNG is cropped to it.
 */
async function screenshot(htmlFile, pngFile, { width = 390, height = 1600 } = {}) {
  if (!CHROME) throw new Error("no Chrome/Edge found (set CHROME_PATH)");
  const frame = htmlFile.replace(/\.html$/, ".frame.html");
  fs.writeFileSync(frame, `<!doctype html><html><body style="margin:0;background:#fff"><iframe src="${path.basename(htmlFile)}" width="${width}" height="${height}" style="border:0;display:block"></iframe></body></html>`);
  const raw = pngFile.replace(/\.png$/, ".raw.png");
  execFileSync(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--window-size=800,${height}`,
    "--virtual-time-budget=10000", `--screenshot=${raw}`, pathToFileURL(frame).href], { stdio: "ignore", timeout: 90000 });
  const sharp = (await import("sharp")).default;
  await sharp(raw).extract({ left: 0, top: 0, width, height }).toFile(pngFile);
  fs.unlinkSync(raw);
}

// ── Main ──────────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const val = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  return {
    live: argv.includes("--live"),
    revert: argv.includes("--revert"),
    rebuild: argv.includes("--rebuild"),
    printLinks: argv.includes("--print-links"),
    noShots: argv.includes("--no-shots"),
    reportOnly: argv.includes("--report-only"),
    limit: val("--limit") ? Math.max(0, parseInt(val("--limit"), 10) || 0) : null,
    slug: val("--slug"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  if (args.revert) {
    const state = readState(STATE_FILE);
    const r = await revert(supabase, state);
    writeState(STATE_FILE, state);
    console.log(`Reverted ${r.reverted.length} to their previous page_version; ${r.failed.length} failed.`);
    return;
  }

  const dryRun = !args.live;
  const mode = args.rebuild ? "rebuild" : "rollout";
  const stateFile = dryRun ? DRY_FILE : STATE_FILE;
  const state = readState(stateFile);
  state.entries ||= {}; state.kits ||= {}; state.pings ||= [];
  const dry = dryRun ? state : readState(DRY_FILE);

  const { included, excluded } = await loadCandidates(supabase, { mode, slug: args.slug });
  console.log(`${dryRun ? "DRY RUN" : "LIVE"} · ${mode} · ${included.length} businesses selected` +
    (Object.keys(excluded).length ? ` (excluded: ${Object.entries(excluded).map(([k, v]) => `${k} ${v}`).join(", ")})` : ""));

  const todo = included.filter(p => !isDone(state.entries[p.business_id]) || args.slug);
  const batch = args.reportOnly ? [] : args.limit != null ? todo.slice(0, args.limit) : todo;
  console.log(`${included.length - todo.length} already done in ${path.relative(ROOT, stateFile)}; processing ${batch.length} now.`);

  const fetchImpl = meteredFetch(globalThis.fetch);
  const sharp = (await import("sharp")).default;
  const env = { ...process.env, PAGE_STOCK_HERO: process.env.PAGE_STOCK_HERO || "on" };
  const throttle = new PingThrottle({ perHour: 45, history: state.pings });
  const quietLog = { log: (...a) => console.log(...a), warn: () => {} };
  const links = [];

  const deps = {
    supabase, dryRun, mode, log: quietLog, throttle,
    // No shared townCoords: buildBrandKit loads each business's own state (and its neighbors).
    buildKit: (p, d) => buildBrandKit(p, { ...d, sharp, env, fetchImpl }),
    saveKit: saveBrandKit,
    promote: promoteToPageV2,
    makeLaunchKit: (p, d) => generateLaunchKit(p, { ...d, sharp, fetchImpl }),
    makeCaptions: (p, kit) => captionsFor(p, kit, piecesFor(p, kit), { fetchImpl, cached: p.brand_kit?.launch_kit?.captions || null, log: quietLog }),
    lookupPhoto: async id => (await supabase.from("stock_photos").select("unsplash_id, download_location").eq("unsplash_id", id).maybeSingle()).data,
    ping: (photo, businessId) => trackStockAssignment(photo, businessId, { supabase, fetchImpl, log: quietLog }),
  };

  const costBefore = state.cost_total || 0;
  let i = 0;
  for (const p of batch) {
    i++;
    const cached = { kit: dry.kits?.[p.business_id] || null, captions: dry.entries?.[p.business_id]?.captions || null };
    const r = await processBusiness(p, { ...deps, cached });
    if (dryRun && r.captions) r.entry.captions = { key: r.captions.key, source: r.captions.source, captions: r.captions.captions };
    state.entries[p.business_id] = r.entry;
    if (dryRun && r.kit) state.kits[p.business_id] = r.kit;
    state.pings = throttle.history;
    state.cost_total = costBefore + fetchImpl.cost();
    state.updated_at = new Date().toISOString();
    writeState(stateFile, state);
    if (r.token && args.printLinks) links.push(`${p.business_name}: ${ownerPageUrl(p.username, r.token)}`);
    console.log(`[${i}/${batch.length}] ${p.username}: ${r.entry.result}${r.entry.reason ? ` (${r.entry.reason})` : ""}` +
      `${r.entry.hero_kind ? ` · logo ${r.entry.logo_source} · colors ${r.entry.color_source} · hero ${r.entry.hero_kind}` : ""}` +
      `${r.entry.kit_status ? ` · launch kit ${r.entry.kit_status}` : ""} · est. $${fetchImpl.cost().toFixed(2)}`);
  }

  const summary = summarize(state.entries);
  console.log("\nSummary:", JSON.stringify(summary, null, 1));
  console.log(`Estimated API cost this run: $${fetchImpl.cost().toFixed(2)} (${JSON.stringify(fetchImpl.counts)}); all runs: $${(costBefore + fetchImpl.cost()).toFixed(2)}`);

  if (!dryRun) {
    fs.writeFileSync(MISSING_LOGOS_FILE, missingLogosCsv(state.entries));
    console.log(`Missing logos: ${path.relative(ROOT, MISSING_LOGOS_FILE)}`);
    if (links.length) { console.log("\nOwner links (not saved anywhere):"); for (const l of links) console.log("  " + l); }
    return;
  }

  // Report with 12 phone-width renders across trades.
  const shots = [];
  if (!args.noShots) {
    fs.mkdirSync(SHOTS_DIR, { recursive: true });
    const byId = new Map(included.map(p => [p.business_id, p]));
    for (const e of pickSpread(state.entries, 12)) {
      const p = byId.get(e.business_id); const kit = state.kits[e.business_id];
      const shot = { entry: e };
      try {
        const html = await renderForShot(p, kit, { resolvePhoto: name => googlePhotoUri(name, { fetchImpl, maxWidthPx: 1200 }) });
        const htmlFile = path.join(SHOTS_DIR, `${e.slug}.html`), pngFile = path.join(SHOTS_DIR, `${e.slug}.png`);
        fs.writeFileSync(htmlFile, html);
        await screenshot(htmlFile, pngFile);
        shot.png = `v2-rollout-shots/${e.slug}.png`;
      } catch (err) { shot.error = String(err?.message || err).slice(0, 120); }
      shots.push(shot);
    }
  }
  fs.writeFileSync(REPORT_FILE, reportHtml({
    summary, candidates: included.length, excluded, cost: costBefore + fetchImpl.cost(), counts: fetchImpl.counts, shots,
    generatedAt: new Date().toISOString(),
  }));
  console.log(`Report: ${path.relative(ROOT, REPORT_FILE)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch(e => { console.error(e?.stack || e); process.exit(1); });
}
