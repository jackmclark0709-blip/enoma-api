// scripts/rollout-page-v3.mjs
// Website v3 PR C rollout: move chosen pages to page_version 3, with their
// included service page (api/_lib/service-page-v3.js).
//
//   node --env-file=.env scripts/rollout-page-v3.mjs
//       Dry run (the default). Renders the test set to
//       out/v3/<slug>/index.html and out/v3/<slug>/<service-slug>.html, plus
//       390px screenshots (…/index.png, …/<service-slug>.png) and
//       out/v3/index.html (all of them on one page). Reads the database;
//       writes NOTHING to it.
//   node --env-file=.env scripts/rollout-page-v3.mjs --slugs a,b
//       Dry run for those slugs only.
//   node --env-file=.env scripts/rollout-page-v3.mjs --apply --slugs a,b
//       Sets page_version = 3 for exactly those slugs, and creates their auto
//       service page draft from the stored page_copy_v3 (no AI call). There
//       is no --all flag in this PR.
//
// Copy: the row's stored page_copy_v3 + fact_sheet; when the row has none
// yet, the cached PR A dry-run output (out/v3-copy/<slug>.json, or
// --copy-dir) for the dry run only. --apply never writes cached copy: a row
// without stored copy is skipped (it would render as v2 anyway).
//
// Never touches Conway's Landscaping or any paying page (a live Stripe
// subscription, or comped). No Places calls: Google listing photos are never
// requested (the render is a visitor's view of an unclaimed page), and no
// Unsplash or OpenAI calls either. Stock photos come from the approved
// library already in the database (read-only).

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The 10 test businesses (PR A's dry run, out/v3-copy). */
export const TEST_SET = [
  "anchor-property-maintenance", "arno-plumbing-and-heating-2", "c-ryan-asphalt-paving", "feathers-touch-electric",
  "john-patrie-electric", "let-it-roll-painting", "mainely-grass", "maynard-roofing-40-yrs-family-business",
  "qs-pressure-wash-and-paint", "rangel-cleaning",
];

const PROTECTED_RE = /conway/i;

export function parseArgs(argv) {
  const val = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  const slugs = String(val("--slugs") || "").split(",").map(s => s.trim()).filter(Boolean);
  return {
    apply: argv.includes("--apply"),
    all: argv.includes("--all"),
    slugs,
    noShots: argv.includes("--no-shots"),
    copyDir: val("--copy-dir"),
    out: val("--out") || path.join(HERE, "out", "v3"),
  };
}

/** Why a page must not be touched, or null. sub: its subscriptions row. */
export function protectedReason(profile = {}, sub = null) {
  if (PROTECTED_RE.test(`${profile.username || ""} ${profile.business_name || ""}`)) return "conway";
  if (sub?.provider === "comped") return "comped";
  if (sub?.stripe_subscription_id && ["active", "trialing", "past_due"].includes(sub.status)) return "paying";
  if (sub?.status === "active" && sub?.provider === "stripe") return "paying";
  return null;
}

/** Validate the flags. Returns an error string or null. */
export function argError(a) {
  if (a.all) return "--all isn't available in this PR. Name the pages with --slugs.";
  if (a.apply && !a.slugs.length) return "--apply needs --slugs a,b,c (only those pages change).";
  return null;
}

const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

/** Local asset paths, no scripts (nothing calls production from a dry-run file). */
export function forFile(html, publicDir) {
  const base = pathToFileURL(publicDir).href.replace(/\/?$/, "/");
  return html.replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/(href|src)="\/(?!\/)/g, `$1="${base}`)
    // Full-page screenshots: the phone bar sits at the end of the page
    // instead of the bottom of a tall viewport.
    .replace(/<\/head>/i, "<style>#mobileCallBar{position:static!important}</style></head>");
}

const CHROME = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
].filter(Boolean).find(p => { try { return fs.existsSync(p); } catch { return false; } });

/** 390px-wide screenshot of the whole page (headless Chrome renders it in a 390px iframe). */
async function screenshot(htmlFile, pngFile, { width = 390, height = 10000 } = {}) {
  if (!CHROME) throw new Error("no Chrome/Edge found (set CHROME_PATH)");
  const frame = htmlFile.replace(/\.html$/, ".frame.html");
  fs.writeFileSync(frame, `<!doctype html><html><body style="margin:0;background:#fff"><iframe src="${path.basename(htmlFile)}" width="${width}" height="${height}" style="border:0;display:block"></iframe></body></html>`);
  const raw = pngFile.replace(/\.png$/, ".raw.png");
  execFileSync(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--allow-file-access-from-files", `--window-size=800,${height}`,
    "--virtual-time-budget=10000", `--screenshot=${raw}`, pathToFileURL(frame).href], { stdio: "ignore", timeout: 120000 });
  const sharp = (await import("sharp")).default;
  // Trim the white space under the page: find the last non-white row.
  const { data, info } = await sharp(raw).extract({ left: 0, top: 0, width, height }).raw().toBuffer({ resolveWithObject: true });
  let last = 0;
  for (let y = info.height - 1; y >= 0 && !last; y--) {
    for (let x = 0; x < info.width; x += 3) {
      const i = (y * info.width + x) * info.channels;
      if (data[i] < 250 || data[i + 1] < 250 || data[i + 2] < 250) { last = y; break; }
    }
  }
  await sharp(raw).extract({ left: 0, top: 0, width, height: Math.max(200, Math.min(height, last + 24)) }).toFile(pngFile);
  fs.unlinkSync(raw);
  fs.unlinkSync(frame);
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const err = argError(a);
  if (err) { console.error(err); process.exit(2); }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) { console.error("needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (node --env-file=.env …)"); process.exit(2); }
  process.chdir(HERE); // loadTownCoords reads data/towns relative to cwd

  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { renderCompanyPage } = await import("../api/_lib/company-page.js");
  const { kitFor, loadTownCoords } = await import("../api/_lib/brand-kit.js");
  const { isPageV3, v3PageParts, loadServiceStock } = await import("../api/_lib/page-v3.js");
  const { ogTitleFor } = await import("../api/_lib/page-v2.js");
  const { personaFor } = await import("../api/_lib/page-style.js");
  const { autoServicePageRow, servicePageV3Parts, syncAutoServicePage } = await import("../api/_lib/service-page-v3.js");

  const slugs = a.slugs.length ? a.slugs : TEST_SET;
  const copyDirs = [a.copyDir, path.join(HERE, "out", "v3-copy"), path.join(HERE, "..", "enoma-v3-facts", "out", "v3-copy")].filter(Boolean);
  const cached = slug => {
    for (const d of copyDirs) {
      const f = path.join(d, `${slug}.json`);
      if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8"));
    }
    return null;
  };
  const template = fs.readFileSync(path.join(HERE, "public", "profile.html"), "utf8");
  const results = [];

  for (const slug of slugs) {
    const { data: profile } = await supabase.from("small_business_profiles").select("*").eq("username", slug).maybeSingle();
    if (!profile) { results.push({ slug, status: "not_found" }); console.log(`- ${slug}: not found`); continue; }
    const { data: sub } = await supabase.from("subscriptions").select("provider, status, stripe_subscription_id").eq("business_id", profile.business_id).maybeSingle();
    const why = protectedReason(profile, sub);
    if (why) { results.push({ slug, status: `skipped_${why}` }); console.log(`- ${slug}: skipped (${why})`); continue; }

    const storedCopy = profile.page_copy_v3?.hero_headline ? profile.page_copy_v3 : null;

    if (a.apply) {
      if (!storedCopy) { results.push({ slug, status: "skipped_no_stored_copy" }); console.log(`- ${slug}: skipped (no stored page_copy_v3; build the fact sheet with PAGE_COPY_V3=on first)`); continue; }
      const { error } = await supabase.from("small_business_profiles").update({ page_version: 3, updated_at: new Date().toISOString() }).eq("business_id", profile.business_id);
      if (error) { results.push({ slug, status: "error", error: error.message }); console.log(`- ${slug}: ERROR ${error.message}`); continue; }
      const sp = await syncAutoServicePage(supabase, profile.business_id, storedCopy, profile.fact_sheet || {}, { profile });
      results.push({ slug, status: "applied", service_page: sp.op });
      console.log(`- ${slug}: page_version 3 (was ${profile.page_version}); service page: ${sp.op}`);
      continue;
    }

    // ── Dry run: render, never write ──
    const c = storedCopy ? null : cached(slug);
    const p = {
      ...profile,
      page_version: 3,
      page_copy_v3: storedCopy || c?.page_copy_v3 || null,
      fact_sheet: storedCopy ? profile.fact_sheet : (c?.fact_sheet || profile.fact_sheet),
      is_claimed: false, // a visitor's view of a preview: no Google listing photos (no Places calls)
    };
    if (!isPageV3(p)) { results.push({ slug, status: "no_copy" }); console.log(`- ${slug}: no v3 copy stored or cached`); continue; }
    const townCoords = await loadTownCoords(p.state);
    const kit = kitFor(p, { townCoords });
    const { stockRows, stockUsage } = await loadServiceStock(supabase, p);
    const auto = autoServicePageRow(p.page_copy_v3, p.fact_sheet || {}, p);
    const spot = auto ? { ...auto, status: "draft" } : null;
    const spotlights = spot ? [{ service_slug: spot.service_slug, service_name: spot.content.service_name }] : [];
    const canonical = `https://enoma.io/${slug}`;
    const ctx = { slug, spotlights, townCoords, stockRows, stockUsage, now: new Date(), canonical, owner: false, launchKit: false };
    const head = (title, desc, canon, bodyClass, v2head, style) => ({
      "{{FINAL_TITLE}}": esc(title), "{{OG_TITLE}}": esc(ogTitleFor(p, kit)), "{{FINAL_DESCRIPTION}}": esc(desc),
      "{{FINAL_OG_IMAGE}}": "", "{{FINAL_CANONICAL_URL}}": esc(canon), "{{ROBOTS}}": "noindex,nofollow",
      "{{HERO_PRELOAD}}": "", "{{V2_HEAD}}": v2head, "{{BRAND_COLOR_STYLE}}": style, "{{BODY_CLASS}}": esc(bodyClass),
    });
    const parts = v3PageParts(p, kit, ctx);
    const homeHtml = renderCompanyPage(template, p, {
      ...ctx, blocks: parts.blocks, schema: parts.schema, faqs: parts.faqs, clientExtra: { owner_view: false },
      head: head(p.seo_title || p.business_name, p.seo_description || "", canonical, `page-v3 persona-${personaFor(p.primary_category)}`, parts.head, parts.style),
    });
    const dir = path.join(a.out, slug);
    fs.mkdirSync(dir, { recursive: true });
    const publicDir = path.join(HERE, "public");
    const homeFile = path.join(dir, "index.html");
    // Links between the two dry-run files point at each other, not at enoma.io paths.
    const local = (html, svcSlug) => (svcSlug ? html.split(`href="/${slug}/${svcSlug}"`).join(`href="${svcSlug}.html"`) : html)
      .split(`href="/${slug}#`).join('href="index.html#').split(`href="/${slug}"`).join('href="index.html"');
    fs.writeFileSync(homeFile, forFile(local(homeHtml, spot?.service_slug), publicDir));
    const entry = { slug, name: p.business_name, status: storedCopy ? "dry_run_stored_copy" : "dry_run_cached_copy", home: `${slug}/index.html`, service: null, service_name: spot?.content?.service_name || null, shots: [] };

    if (spot) {
      const sctx = { ...ctx, canonical: `${canonical}/${spot.service_slug}`, homeCanonical: canonical };
      const sp = servicePageV3Parts(p, kit, spot, sctx);
      const svcHtml = renderCompanyPage(template, p, {
        ...sctx, blocks: sp.blocks, schema: sp.schema, faqs: sp.faqs, clientExtra: { owner_view: false },
        head: head(sp.title, sp.description, sctx.canonical, `page-v3 page-v3-service persona-${personaFor(p.primary_category)}`, parts.head, parts.style),
      });
      const svcFile = path.join(dir, `${spot.service_slug}.html`);
      fs.writeFileSync(svcFile, forFile(local(svcHtml, spot.service_slug), publicDir));
      entry.service = `${slug}/${spot.service_slug}.html`;
    }
    if (!a.noShots) {
      for (const rel of [entry.home, entry.service].filter(Boolean)) {
        const png = path.join(a.out, rel.replace(/\.html$/, ".png"));
        try { await screenshot(path.join(a.out, rel), png); entry.shots.push(path.relative(a.out, png).replace(/\\/g, "/")); }
        catch (e) { entry.shot_error = e?.message || String(e); }
      }
    }
    results.push(entry);
    console.log(`- ${slug}: rendered (${entry.status})${entry.service_name ? `, service page "${entry.service_name}"` : ", no service page in the copy"}${entry.shot_error ? ` [screenshot failed: ${entry.shot_error}]` : ""}`);
  }

  if (!a.apply) {
    fs.mkdirSync(a.out, { recursive: true });
    fs.writeFileSync(path.join(a.out, "summary.json"), JSON.stringify(results, null, 2));
    fs.writeFileSync(path.join(a.out, "index.html"), `<!doctype html><meta charset="utf-8"><title>Website v3 dry run</title>
<style>body{font:14px system-ui;margin:20px}figure{display:inline-block;vertical-align:top;margin:0 16px 24px 0;width:390px}img{width:390px;border:1px solid #ccc}</style>
<h1>Website v3 dry run (${new Date().toISOString().slice(0, 10)})</h1><p>Nothing was written to the database.</p>
${results.map(r => `<h2>${esc(r.name || r.slug)} <small>${esc(r.status)}${r.service_name ? ` · service page: ${esc(r.service_name)}` : ""}</small></h2>${(r.shots || []).map(s => `<figure><a href="${esc(s.replace(/\.png$/, ".html"))}"><img src="${esc(s)}" alt=""></a><figcaption>${esc(s)}</figcaption></figure>`).join("")}`).join("\n")}`);
    console.log(`\nDry run: nothing written to the database. Open ${path.join(a.out, "index.html")}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch(e => { console.error(e); process.exit(1); });
}
