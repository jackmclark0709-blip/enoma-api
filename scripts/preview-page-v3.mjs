// scripts/preview-page-v3.mjs
// Local preview of page v3 from the hand-written fixtures
// (tests/fixtures/page-v3/*.json), through the same renderCompanyPage path
// api/p.js uses. Serves public/ for the CSS and scripts.
//
//   node scripts/preview-page-v3.mjs            → http://localhost:4173/arno
//   node --env-file=.env scripts/preview-page-v3.mjs   (also reads the stock library, read-only)
//
// Routes: /<fixture> (arno, c-ryan, let-it-roll), ?owner=1 for the owner
// view, ?month=1..12 to try the seasonal line.
// /live/<slug>: a real page through api/p.js (needs .env; read-only), for
// comparing v1/v2 pages. --root=<repo checkout> serves another checkout's
// p.js and public/ (e.g. main, to compare); --port=<n>.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { renderCompanyPage } from "../api/_lib/company-page.js";
import { kitFor, loadTownCoords } from "../api/_lib/brand-kit.js";
import { v3PageParts, loadServiceStock } from "../api/_lib/page-v3.js";
import { ogTitleFor } from "../api/_lib/page-v2.js";
import { personaFor } from "../api/_lib/page-style.js";

const arg = k => (process.argv.find(a => a.startsWith(`--${k}=`)) || "").split("=").slice(1).join("=");
const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.resolve(arg("root") || HERE);
process.chdir(ROOT); // loadTownCoords and p.js read data/ and public/ relative to cwd
const PORT = Number(arg("port") || process.env.PORT || 4173);
const FIX = path.join(HERE, "tests", "fixtures", "page-v3");
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".webp": "image/webp", ".jpg": "image/jpeg" };
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  const { createClient } = await import("@supabase/supabase-js");
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// profile: render this object instead of tests/fixtures/page-v3/<name>.json
// (scripts/build-example-pages.mjs uses it for the per-trade example pages).
export async function renderFixture(name, { owner = false, month = null, profile: given = null, canonical: canon = null } = {}) {
  const profile = given ? structuredClone(given) : JSON.parse(fs.readFileSync(path.join(FIX, `${name}.json`), "utf8"));
  if (owner) profile.owner_token = "previewpreviewpreview123";
  const townCoords = await loadTownCoords(profile.state);
  const kit = kitFor(profile, { townCoords });
  const { stockRows, stockUsage } = await loadServiceStock(supabase, profile);
  const now = month ? new Date(2026, Number(month) - 1, 15) : new Date();
  const canonical = canon || `http://localhost:${PORT}/${name}`;
  const ctx = { slug: profile.username, spotlights: [], townCoords, stockRows, stockUsage, now, canonical,
    owner, token: owner ? profile.owner_token : null, launchKit: false };
  const parts = v3PageParts(profile, kit, ctx);
  const template = fs.readFileSync(path.join(ROOT, "public", "profile.html"), "utf8");
  return renderCompanyPage(template, profile, {
    ...ctx, blocks: parts.blocks, schema: parts.schema, faqs: parts.faqs, clientExtra: { owner_view: owner },
    head: {
      "{{FINAL_TITLE}}": esc(`${profile.business_name} | ${profile.city}`),
      "{{OG_TITLE}}": esc(ogTitleFor(profile, kit)),
      "{{FINAL_DESCRIPTION}}": esc(parts.blocks ? `${profile.business_name} in ${profile.city}` : ""),
      "{{FINAL_OG_IMAGE}}": "", "{{FINAL_CANONICAL_URL}}": esc(canonical), "{{ROBOTS}}": "noindex,nofollow",
      "{{HERO_PRELOAD}}": "", "{{V2_HEAD}}": parts.head, "{{BRAND_COLOR_STYLE}}": parts.style,
      "{{BODY_CLASS}}": esc(`page-v3 persona-${personaFor(profile.primary_category)}`),
    },
  })
    // No analytics or tracking from local previews.
    .replace(/<script async src="https:\/\/www\.googletagmanager[\s\S]*?<\/script>\s*<script>window\.dataLayer[\s\S]*?<\/script>/, "");
}

if (String(process.argv[1] || "").endsWith("preview-page-v3.mjs")) {
  http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, `http://localhost:${PORT}`);
      const file = path.join(ROOT, "public", path.normalize(u.pathname).replace(/^([/\\])+/, ""));
      if (file.startsWith(path.join(ROOT, "public")) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
        return fs.createReadStream(file).pipe(res);
      }
      if (u.pathname.startsWith("/api/")) { res.writeHead(204); return res.end(); }
      const live = u.pathname.match(/^\/live\/([a-z0-9-]+)$/);
      if (live) {
        const { default: handler } = await import(pathToFileURL(path.join(ROOT, "api", "p.js")).href);
        const out = { code: 200, body: "" };
        const fake = { setHeader() {}, status(c) { out.code = c; return fake; }, send(b) { out.body = b; return fake; },
          redirect(c, to) { out.code = c; out.body = `redirect ${to}`; return fake; }, json(o) { out.body = JSON.stringify(o); return fake; }, end() { return fake; } };
        await handler({ query: { slug: live[1] }, headers: { host: `localhost:${PORT}` }, method: "GET", url: `/${live[1]}` }, fake);
        res.writeHead(out.code, { "Content-Type": "text/html; charset=utf-8" });
        // No analytics from local previews.
        return res.end(String(out.body).replace(/<script async src="https:\/\/www\.googletagmanager[\s\S]*?<\/script>\s*<script>window\.dataLayer[\s\S]*?<\/script>/, ""));
      }
      // /__frame/<fixture>?w=390: the page in an iframe of exactly that width,
      // grown to the page's height, on magenta (for full-page screenshots;
      // headless Chrome won't open a window narrower than ~500px).
      const fr = u.pathname.match(/^\/__frame\/((?:live\/)?[a-z0-9-]+)$/);
      if (fr) {
        const w = Math.max(320, Math.min(2000, Number(u.searchParams.get("w")) || 390));
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(`<!doctype html><body style="margin:0;background:#ff00ff"><iframe id="f" src="/${fr[1]}${u.search.replace(/[?&]w=\d+/, "").replace(/^&/, "?")}" style="border:0;width:${w}px;height:900px;display:block"></iframe>
<script>var f=document.getElementById("f");f.onload=function(){setTimeout(function(){f.style.height=f.contentDocument.documentElement.scrollHeight+"px"},300)}</script>`);
      }
      const name = u.pathname.replace(/^\/+|\/+$/g, "") || "arno";
      if (!fs.existsSync(path.join(FIX, `${name}.json`))) { res.writeHead(404); return res.end("No such fixture"); }
      const html = await renderFixture(name, { owner: u.searchParams.get("owner") === "1", month: u.searchParams.get("month") });
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    } catch (e) {
      res.writeHead(500); res.end(String(e?.stack || e));
    }
  }).listen(PORT, () => console.log(`page v3 preview: http://localhost:${PORT}/arno  /c-ryan  /let-it-roll`));
}
