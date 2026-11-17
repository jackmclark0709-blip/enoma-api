// api/_lib/launch-kit-page.js
// enoma.io/<slug>/kit?o=<owner token>: the owner's launch kit (launch-kit.js).
// Before the $1 claim: watermarked previews, captions, and one button to keep
// the page. After: the clean files, each with a download button. Same page v2
// colors (kitStyle) and stylesheet (business-base.css section 16). Pure.

import { kitStyle } from "./page-v2.js";
import { ownerPageUrl } from "./owner-link.js";
import { ITEM_LABELS } from "./launch-kit.js";

const esc = s => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export const KIT_SLUG = "kit";

const HOW = {
  cover: "On your Facebook Page: tap the camera on your cover photo, then Upload photo.",
  post_online: "Post it on Facebook and on your Google Business Profile (Add update), with the caption below.",
  post_specialty: "Post it on Facebook and on your Google Business Profile, with the caption below.",
  post_seasonal: "Post it this month on Facebook and Google, with the caption below.",
  qr_card: "Print it at 4x6 (any drugstore photo counter takes a PDF). Leave one with every estimate, or tape one in the truck window.",
  badge: "Use it as your Facebook and Google profile picture. It's made to be cropped to a circle.",
};

/** The owner's launch-kit link (and the download link for one item). */
export function kitHref(slug, token, { dl = null, from = null } = {}) {
  const q = new URLSearchParams({ o: token });
  if (dl) q.set("dl", dl);
  if (from) q.set("from", from);
  return `/${encodeURIComponent(slug)}/${KIT_SLUG}?${q}`;
}

/**
 * ctx: { slug, token, unlocked, building, thumbs: { [id]: url } (clean, after
 * unlock), m }. The launch kit is kit.launch_kit.
 */
export function renderLaunchKitPage(p, kit, ctx) {
  const lk = kit.launch_kit || {};
  const items = Array.isArray(lk.items) ? lk.items : [];
  const name = p.business_name || ctx.slug;
  const pageHref = ownerPageUrl(ctx.slug, ctx.token, { m: ctx.m }).replace(/^https:\/\/enoma\.io/, "");
  const claimHref = ownerPageUrl(ctx.slug, ctx.token, { m: ctx.m, claim: true }).replace(/^https:\/\/enoma\.io/, "");
  const waiting = !items.length;

  const lockNote = ctx.unlocked ? "" : `<div class="v2-lk-lock">
    <p><b>These are yours once you keep your page.</b> Keep it for $1 and the downloads open up, without the "Preview" mark.</p>
    <a class="v2-lk-btn v2-lk-btn--cta" href="${esc(claimHref)}" data-cta="claim" data-where="launch_kit">Keep my page for $1</a>
  </div>`;

  const cards = items.map(it => {
    const src = ctx.unlocked && ctx.thumbs?.[it.id] ? ctx.thumbs[it.id] : it.preview_url;
    const caption = it.caption ? `<div class="v2-lk-caption"><p class="v2-lk-caption__label">Caption</p><pre class="v2-lk-caption__text" id="cap-${esc(it.id)}">${esc(it.caption)}</pre><button type="button" class="v2-lk-btn v2-lk-btn--ghost" data-copy="cap-${esc(it.id)}">Copy caption</button></div>` : "";
    const action = ctx.unlocked
      ? `<a class="v2-lk-btn v2-lk-btn--cta" href="${esc(kitHref(ctx.slug, ctx.token, { dl: it.id }))}" download>Download ${it.format === "pdf" ? "PDF" : "image"}</a>`
      : `<span class="v2-lk-locked" aria-label="Download unlocks when you keep your page">🔒 Download unlocks with your $1</span>`;
    return `<li class="v2-lk-item v2-lk-item--${esc(it.id)}">
    <figure class="v2-lk-fig v2-lk-fig--${esc(it.id)}"><img src="${esc(src)}" alt="${esc(`${ITEM_LABELS[it.id] || it.id} for ${name}`)}" loading="lazy" decoding="async" /></figure>
    <div class="v2-lk-body">
      <h2 class="v2-lk-h">${esc(ITEM_LABELS[it.id] || it.id)}</h2>
      <p class="v2-lk-how">${esc(HOW[it.id] || "")}</p>
      ${caption}
      ${action}
    </div>
  </li>`;
  }).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Your launch kit · ${esc(name)}</title>
  <meta name="robots" content="noindex,nofollow" />
  ${waiting || ctx.building ? '<meta http-equiv="refresh" content="15" />' : ""}
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@75..100,700..900&family=Inter:wght@400;600;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/styles/business-base.css" />
  ${kitStyle(kit)}
</head>
<body class="page-v2 launch-kit">
  <header class="v2-lk-top">
    <a class="v2-lk-back" href="${esc(pageHref)}">← Back to your page</a>
    <p class="v2-lk-made">Made for <b>${esc(name)}</b> by Jack</p>
  </header>
  <main class="v2-lk-main">
    <h1 class="v2-lk-title">Your launch kit</h1>
    <p class="v2-lk-lede">A Facebook cover, three ready-to-post pictures with captions, and a printable card, all in ${esc(name)}'s colors and pointing at your page.</p>
    ${waiting ? `<p class="v2-lk-wait" role="status">${lk.status === "failed" ? "We couldn't finish your launch kit. Jack's been told; check back soon." : "Making your launch kit now. This takes about a minute; the page refreshes itself."}</p>` : lockNote}
    ${waiting ? "" : `<ul class="v2-lk-grid">${cards}</ul>`}
    ${!waiting && !ctx.unlocked ? lockNote : ""}
  </main>
  <script>
  document.querySelectorAll("[data-copy]").forEach(function (b) {
    b.addEventListener("click", function () {
      var t = document.getElementById(b.getAttribute("data-copy")).textContent;
      (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { b.textContent = "Copied ✓"; }, function () { b.textContent = "Select and copy the text above"; });
    });
  });
  </script>
</body>
</html>`;
}

/** The owner-bar strip: small previews linking to the kit page (owner only). */
export function ownerBarKitStrip(launchKit, href) {
  const items = (Array.isArray(launchKit?.items) ? launchKit.items : []).filter(i => i.preview_url && i.id !== "badge").slice(0, 5);
  if (!items.length) return "";
  return `<a class="v2-owner__kit" href="${esc(href)}" aria-label="Open your launch kit"><span class="v2-owner__kit-go">Your launch kit →</span>${items.map(i =>
    `<img class="v2-owner__thumb v2-owner__thumb--${esc(i.id)}" src="${esc(i.mini_url || i.preview_url)}" alt="" height="44" decoding="async" />`).join("")}</a>`;
}
