// scripts/build-example-pages.mjs
// Builds the per-trade example pages (public/examples/<key>.html) from the
// made-up businesses in scripts/example-businesses.mjs, through the same v3
// renderer real pages use (scripts/preview-page-v3.mjs renderFixture).
//
//   node scripts/build-example-pages.mjs
//
// Each page gets: a banner saying it's a made-up example, yellow tags on the
// parts we fill in from the owner's own listing, and a small script that
// keeps the page inert (no form posts, no calls, no tracking calls).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderFixture } from "./preview-page-v3.mjs";
import { exampleProfiles } from "./example-businesses.mjs";
import { EXAMPLE_PAGES, examplePath, exampleUrl } from "../api/_lib/example-pages.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public", "examples");
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// [class on the element, tag text, where]. The tag goes right before the
// element, or as its first child with "inside".
export const CALLOUTS = [
  ["v3-header", "Your business name and logo"],
  ["v3-h1", "Written from your Google reviews"],
  ["v3-actions", "Calls go straight to your phone"],
  ["v3-proof", "Your rating, review count and years in business"],
  ["v3-cards", "Your services, with photos of your work"],
  ["v3-reviews", "Your real Google reviews"],
  ["v3-chips", "The towns you serve"],
  ["v3-formcard", "Quote requests go to your phone and email", "inside"],
];

const STYLE = `<style id="example-page-style">
.ex-banner{position:sticky;top:0;z-index:1000;background:#111827;color:#fff;font:500 14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:10px 16px;text-align:center}
.ex-banner strong{color:#ffe14d}
.ex-banner a{color:#111827;background:#ffe14d;border-radius:999px;padding:5px 12px;margin-left:10px;font-weight:700;text-decoration:none;white-space:nowrap;display:inline-block}
.ex-banner .ex-short{display:none}
@media (max-width:640px){.ex-banner{padding:8px 12px;font-size:13px}.ex-banner .ex-long{display:none}.ex-banner .ex-short{display:inline}.ex-banner a{margin-left:8px;padding:4px 10px}}
/* !important: the page's own rules (white hero text, gray area text) are
   more specific than one class and turned the pill text white or gray. */
.ex-tag{display:block;width:max-content;max-width:calc(100% - 24px);margin:10px auto 6px;background:#ffe14d!important;color:#111827!important;font:700 12px/1.3 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif!important;letter-spacing:.01em;text-transform:none!important;text-shadow:none!important;opacity:1!important;padding:5px 11px;border-radius:999px;box-shadow:0 1px 4px rgba(0,0,0,.18);text-align:center}
.ex-tag::before{content:"\\270E  "}
.ex-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#111827;color:#fff;font:500 14px/1.4 system-ui,sans-serif;padding:12px 16px;border-radius:10px;z-index:1001;max-width:90vw;box-shadow:0 4px 18px rgba(0,0,0,.3)}
.claim-box,#claimForm,#claimCodeForm,.v3-top{display:none!important}
</style>`;

// Keeps the example inert: forms don't post, call buttons explain instead of
// dialing a made-up number, and nothing is sent to /api/.
const SHIM = `<script>(function(){
function toast(t){var d=document.createElement("div");d.className="ex-toast";d.textContent=t;document.body.appendChild(d);setTimeout(function(){d.remove()},3200)}
document.addEventListener("submit",function(e){e.preventDefault();e.stopImmediatePropagation();toast("This is an example. On your page, quote requests go straight to your phone and email.")},true);
document.addEventListener("click",function(e){var a=e.target.closest&&e.target.closest('a[href^="tel:"],a[href^="sms:"],a[href^="mailto:"]');if(a){e.preventDefault();e.stopImmediatePropagation();toast("This is an example. On your page, this button calls your phone.")}},true);
var f=window.fetch;window.fetch=function(u,o){if(String(u).indexOf("/api/")>-1)return Promise.resolve(new Response("{}",{status:200,headers:{"Content-Type":"application/json"}}));return f.apply(this,arguments)};
if(navigator.sendBeacon){navigator.sendBeacon=function(){return true}}
})();</script>`;

export function decorateExample(html, entry) {
  let out = html;
  // Canonical and robots: examples are for people, not search.
  out = out.replace(/<link rel="canonical" href="[^"]*"/, `<link rel="canonical" href="${esc(exampleUrl(entry))}"`);
  out = out.replace("</head>", `${STYLE}\n${SHIM}\n</head>`);
  const banner = `<div class="ex-banner" role="note"><strong>Example page.</strong> <span class="ex-long">${esc(entry.business)} is a made-up business, and its reviews are samples. Yours is built from your own Google listing: your name, services, reviews and towns.</span><span class="ex-short">A made-up business.</span> <a href="https://enoma.io/get-your-website?ref=example-${esc(entry.key)}">Get yours free</a></div>`;
  out = out.replace(/(<body[^>]*>)/, `$1\n${banner}`);
  for (const [cls, text, where] of CALLOUTS) {
    const re = new RegExp(`(<[a-z0-9]+[^>]*class="${cls}(?:\\s[^"]*)?"[^>]*>)`);
    const tag = `<p class="ex-tag">${esc(text)}</p>`;
    out = out.replace(re, where === "inside" ? `$1${tag}` : `${tag}$1`);
  }
  return out;
}

export async function buildExamplePages({ write = true } = {}) {
  const built = [];
  for (const { key, profile } of exampleProfiles()) {
    const entry = EXAMPLE_PAGES[key];
    if (!entry) throw new Error(`no EXAMPLE_PAGES entry for ${key}`);
    const html = decorateExample(await renderFixture(key, { profile, canonical: exampleUrl(entry) }), entry);
    if (write) fs.writeFileSync(path.join(OUT, `${key}.html`), html);
    built.push({ key, path: examplePath(entry), bytes: html.length });
  }
  return built;
}

if (String(process.argv[1] || "").endsWith("build-example-pages.mjs")) {
  const built = await buildExamplePages();
  for (const b of built) console.log(`${b.path}  ${Math.round(b.bytes / 1024)} KB`);
}
