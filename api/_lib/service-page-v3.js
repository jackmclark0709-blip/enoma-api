// api/_lib/service-page-v3.js
// Website v3 PR C: the one service page that comes with the website.
//
// page_copy_v3.service_page (written by PR A's prompt, docs/website-v3-contract.md)
// becomes a service_spotlights row with source = 'auto':
//   - status 'draft' until the owner approves it in the owner bar, then
//     published when the business goes live (approve now on a live site =
//     publish now; approve on a preview = published by the Stripe webhook
//     when checkout completes).
//   - content = the service_page copy (plus hero/seo so the rest of the
//     spotlight code treats it as written), intake = the fact-sheet evidence
//     it used. Auto drafts never go through the 13-question gap check
//     (spotlight.js gapCheck); that stays for the manual intake page.
//   - at most one per business (partial unique index, migration
//     20261120_service_page_v3).
//   - served at enoma.io/<slug>/<service-slug> in the v3 shell (top bar,
//     header + menu, footer, phone bar from page-v3.js), noindex while it's
//     a draft or the home page is a preview; indexed once both are live.
//
// Billing: the first published service page is included in the plan
// (spotlight-billing.js billedQuantity = max(0, published − 1)).

import { telHref } from "./company-page.js";
import { normalizeFaqs } from "./page-ssr.js";
import { renderQuoteForm } from "./quote-form.js";
import { mobileBar, ownerBar } from "./page-v2.js";
import {
  v3Plan, topBar, headerBlock, footerBlock, proofBlock, reviewCard, closingBlock, img, servicePhoto, stockTagFor,
  estimateLabelV3, ICON_CALL, localBusinessSchemaV3,
} from "./page-v3.js";

export const AUTO_SOURCE = "auto";

const esc = s => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const str = v => (v == null ? "" : String(v).trim());
const list = v => (Array.isArray(v) ? v : []);
const obj = v => {
  if (v && typeof v === "object" && !Array.isArray(v)) return v;
  if (typeof v === "string") { try { const j = JSON.parse(v); return j && typeof j === "object" && !Array.isArray(j) ? j : null; } catch { return null; } }
  return null;
};
export const slugifyService = t => {
  const s = str(t).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60);
  return s === "review" ? "review-service" : s;
};
const cleanTown = t => str(t).replace(/,\s*[A-Za-z .]+$/, "").trim();

// ── C1: the row ────────────────────────────────────────────────────────────

/**
 * The evidence a service page used, from the fact sheet: the review texts it
 * cites and the owner answers it names. Stored as the row's intake.
 */
export function evidenceUsed(sp, fs = {}) {
  const ids = [...new Set([...list(sp?.evidence), ...list(sp?.review_ids), ...list(sp?.faqs).flatMap(f => list(f?.evidence))].map(str).filter(Boolean))];
  const reviews = list(fs.reviews).filter(r => ids.includes(str(r?.id))).map(r => ({ id: r.id, author: r.author, rating: r.rating, text: r.text }));
  const owner = {};
  for (const id of ids.filter(x => x.startsWith("o."))) {
    const key = id.slice(2);
    if (fs.owner && key in fs.owner) owner[key] = fs.owner[key];
  }
  return { source: AUTO_SOURCE, evidence: ids, reviews, owner, fact_sheet_built_at: fs.built_at || null };
}

/**
 * page_copy_v3 (+ fact sheet) → the service_spotlights fields for the auto
 * page, or null when there's no service page in the copy.
 */
export function autoServicePageRow(copy, fs = {}, profile = {}) {
  const sp = obj(copy)?.service_page;
  if (!sp || !str(sp.service_name) || !str(sp.headline) || !str(sp.intro)) return null;
  const name = str(sp.service_name);
  const slug = slugifyService(sp.slug || name);
  if (!slug) return null;
  const town = cleanTown(fs.business?.town || profile.city);
  const state = str(fs.business?.state || profile.state);
  const business = str(fs.business?.name || profile.business_name);
  const title = `${name}${town ? ` in ${town}${state ? `, ${state}` : ""}` : ""}${business ? ` | ${business}` : ""}`.slice(0, 70);
  return {
    service_slug: slug,
    source: AUTO_SOURCE,
    status: "draft",
    intake: evidenceUsed(sp, fs),
    content: {
      kind: "v3",
      service_name: name,
      headline: str(sp.headline),
      intro: str(sp.intro),
      signs: list(sp.signs).map(str).filter(Boolean),
      what_we_do: list(sp.what_we_do).map(str).filter(Boolean),
      review_ids: list(sp.review_ids).map(str).filter(Boolean),
      faqs: list(sp.faqs).filter(f => str(f?.q) && str(f?.a)).map(f => ({ q: str(f.q), a: str(f.a), evidence: list(f.evidence) })),
      evidence: list(sp.evidence),
      // Shared with manual spotlights: "written" check, title, nav names.
      hero: { headline: str(sp.headline), subhead: str(sp.intro) },
      seo: { title, description: str(sp.intro).slice(0, 158) },
    },
  };
}

/**
 * What to do with the stored rows given a new auto row (pure).
 *   existingAuto: this business's source='auto' row, or null
 *   slugTaken:    a manual row already uses the new slug (manual wins)
 * → { op: "none" | "insert" | "update" | "replace" | "skip", fields?, unbill? }
 *
 * An approved or published page keeps the content the owner approved; a new
 * service (different slug) replaces it and needs approving again.
 */
export function autoPagePlan(next, existingAuto = null, { slugTaken = false } = {}) {
  if (!next) return { op: "none" };
  if (slugTaken) return { op: "skip", reason: "manual_page_has_slug" };
  if (!existingAuto) return { op: "insert", fields: next };
  if (existingAuto.status === "archived") return { op: "none", reason: "archived" };
  if (existingAuto.service_slug === next.service_slug) {
    if (existingAuto.status === "published" || existingAuto.approved_at) return { op: "none", reason: "approved_content_kept" };
    return { op: "update", fields: { content: next.content, intake: next.intake } };
  }
  return {
    op: "replace",
    fields: { ...next, status: "draft", approved_at: null, published_at: null },
    unbill: existingAuto.status === "published",
  };
}

/**
 * Creates or updates the one auto service page after page_copy_v3 is
 * written (fact-sheet.js saveFactSheet, scripts/rollout-page-v3.mjs).
 * Best effort: logs and returns { op: "error" } instead of throwing.
 */
export async function syncAutoServicePage(supabase, businessId, copy, fs = {}, { profile = {}, onUnbill = null } = {}) {
  try {
    const next = autoServicePageRow(copy, fs, profile);
    if (!next) return { op: "none" };
    const { data: rows, error } = await supabase.from("service_spotlights")
      .select("id, service_slug, status, source, approved_at").eq("business_id", businessId);
    if (error) throw new Error(error.message);
    const existingAuto = (rows || []).find(r => r.source === AUTO_SOURCE) || null;
    const slugTaken = (rows || []).some(r => r.source !== AUTO_SOURCE && r.service_slug === next.service_slug);
    const plan = autoPagePlan(next, existingAuto, { slugTaken });
    const now = new Date().toISOString();
    if (plan.op === "insert") {
      const { error: e } = await supabase.from("service_spotlights").insert({ business_id: businessId, ...plan.fields, generation_status: "ready", updated_at: now });
      if (e) throw new Error(e.message);
    } else if (plan.op === "update" || plan.op === "replace") {
      const { error: e } = await supabase.from("service_spotlights").update({ ...plan.fields, updated_at: now }).eq("id", existingAuto.id);
      if (e) throw new Error(e.message);
      if (plan.unbill && onUnbill) await onUnbill();
    }
    return plan;
  } catch (e) {
    console.warn("auto service page not saved:", e?.message || e);
    return { op: "error", error: e?.message || String(e) };
  }
}

/** True when an auto page's approval should publish it: approved and the site is live. */
export function shouldPublishAuto(row, { live }) {
  return !!row && row.source === AUTO_SOURCE && row.status === "draft" && !!row.approved_at && !!row.content?.hero && !!live;
}

/**
 * Publishes this business's approved auto page (Stripe webhook on
 * checkout.session.completed; owner approval on a live site). Returns the
 * row id or null. The caller syncs billing afterwards (first page included).
 */
export async function publishApprovedAutoPage(supabase, businessId, { live = true } = {}) {
  const { data: row } = await supabase.from("service_spotlights").select("id, source, status, approved_at, content")
    .eq("business_id", businessId).eq("source", AUTO_SOURCE).maybeSingle();
  if (!shouldPublishAuto(row, { live })) return null;
  const now = new Date().toISOString();
  const { error } = await supabase.from("service_spotlights").update({ status: "published", published_at: now, updated_at: now }).eq("id", row.id);
  if (error) { console.warn("auto service page publish failed:", error.message); return null; }
  return row.id;
}

// ── C2: the page ───────────────────────────────────────────────────────────

/** The reviews that mention this service: the ones the copy cites, else ones naming it. */
export function serviceReviews(reviews, content) {
  const ids = list(content?.review_ids);
  const cited = reviews.filter(r => ids.includes(r.id));
  if (cited.length) return cited;
  const words = str(content?.service_name).toLowerCase().split(/[^a-z]+/).filter(w => w.length > 3);
  return words.length ? reviews.filter(r => words.some(w => r.quote.toLowerCase().includes(w))) : [];
}

/** The services list entry this page is about (for the photo), or a stand-in. */
function matchingService(facts, content) {
  const slug = slugifyService(content.service_name);
  return facts.services.find(s => s.slug === slug || slug.startsWith(`${s.slug}-`) || s.slug.startsWith(`${slug}-`))
    || { name: content.service_name, slug, stock_subject: stockTagFor("", content.service_name, facts.trade), work_photo: null, photo: null };
}

/** Robots for a service page: indexed only when it's published and the home page is. */
export function servicePageRobots(spot, homeIndexable) {
  return spot?.status === "published" && homeIndexable ? "index,follow" : "noindex,nofollow";
}

function listBand(id, heading, items, tint) {
  if (!items.length) return "";
  return `<section class="v3-band${tint ? " v3-band--tint" : ""}" id="${id}" aria-labelledby="${id}Heading">
  <div class="v3-wrap v3-wrap--narrow">
    <h2 id="${id}Heading" class="v3-h2">${esc(heading)}</h2>
    <ul class="v3-list">${items.map(x => `<li>${esc(x)}</li>`).join("")}</ul>
  </div>
</section>`;
}

/**
 * Template replacements for public/profile.html, so the service page is the
 * same website as the home page. ctx is the home page's ctx (slug, owner,
 * token, townCoords, stockRows, stockUsage, quoteStatus, now, homeIndexable).
 */
export function renderServicePageV3(rawProfile, kit, spot, ctx = {}) {
  const slug = ctx.slug || rawProfile?.username || "";
  const home = `/${encodeURIComponent(slug)}`;
  const content = spot?.content || {};
  const plan = v3Plan(rawProfile, kit, { ...ctx, slug, spotlights: ctx.spotlights || [] });
  const { facts, copy, nav } = plan;
  const c = { ...plan.ctx, base: home };
  const town = facts.towns.home || facts.address.town;
  const name = str(content.service_name);
  const label = estimateLabelV3(facts);

  const call = facts.phone
    ? `<a class="v3-btn v3-btn--cta v3-btn--lg" href="${esc(telHref(facts.phone))}" data-contact="call">${ICON_CALL}Call ${esc(facts.phone)}</a>` : "";
  const hero = `<section class="v3-hero v3-hero--service" aria-labelledby="heroHeadline">
  <div class="v3-wrap v3-hero__in v3-hero--form">
    <div class="v3-hero__copy">
      <p class="v3-eyebrow"><a href="${esc(home)}">${esc(facts.name)}</a></p>
      <h1 id="heroHeadline" class="v3-h1">${esc(name)}${town ? ` in ${esc(town)}` : ""}</h1>
      ${content.headline ? `<p class="v3-sub"><strong>${esc(content.headline)}</strong></p>` : ""}
      ${content.intro ? `<p class="v3-sub">${esc(content.intro)}</p>` : ""}
      <div class="v3-actions" id="primaryAction">${call}<a class="v3-btn v3-btn--ghost v3-btn--lg" href="#contact" data-contact="quote">${esc(label)}</a></div>
    </div>
  </div>
</section>`;

  // Photo slot: the same fallback as the service cards (work photo → stock → none).
  const photo = servicePhoto(matchingService(facts, content), kit, c, new Set());
  const photoBand = photo ? `<section class="v3-band" id="work" aria-label="${esc(name)}">
  <div class="v3-wrap"><figure class="v3-service-photo" data-v3-media>${img({ src: photo.src, srcset: photo.srcset, alt: photo.alt || name, sizes: "(min-width: 900px) 900px, 100vw" })}${photo.credit}</figure></div>
</section>` : "";

  const reviews = serviceReviews(facts.reviews, content);
  const reviewsBand = reviews.length ? `<section class="v3-band" id="reviews" aria-labelledby="reviewsHeading">
  <div class="v3-wrap">
    <h2 id="reviewsHeading" class="v3-h2">What customers say about our ${esc(name.toLowerCase())}</h2>
    <div class="v3-reviews">${reviews.map(r => reviewCard(r, facts, "v3-review")).join("")}</div>
  </div>
</section>` : "";

  const faqs = normalizeFaqs(list(content.faqs));
  const faqBand = faqs.length ? `<section class="v3-band v3-band--tint" id="faqs" aria-labelledby="faqHeading">
  <div class="v3-wrap v3-wrap--narrow">
    <h2 id="faqHeading" class="v3-h2">${esc(name)}: common questions</h2>
    ${faqs.map((f, i) => `<details class="v3-faq"${i === 0 ? " open" : ""}><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join("")}
  </div>
</section>` : "";

  const backLink = `<section class="v3-band" id="more" aria-label="More from ${esc(facts.name)}">
  <div class="v3-wrap"><p class="v3-back"><a class="v3-more" href="${esc(home)}"><span aria-hidden="true">←</span> More about ${esc(facts.name)}: all services, reviews and the area we cover</a></p></div>
</section>`;

  const closingCopy = {
    closing: {
      heading: `Need help with ${name.toLowerCase()}${town ? ` in ${town}` : ""}?`,
      line: facts.phone ? `Call ${facts.phone}, or send the form and we'll get back to you.` : "Send the form and we'll get back to you.",
    },
  };
  const p = { ...rawProfile, business_name: facts.name };
  const bar = ctx.owner && ctx.token ? ownerBar(p, kit, { ...c, hasPhotos: true }) : "";
  const quoteProfile = {
    ...rawProfile, business_name: facts.name, phone: facts.phone,
    services: facts.services.map(s => ({ service_name: s.name })),
    service_area: facts.towns.confirmed.length ? facts.towns.confirmed : rawProfile?.service_area,
  };

  return {
    "{{BLOCK_TOPBAR}}": bar + topBar(facts, c),
    "{{BLOCK_HEADER}}": headerBlock(rawProfile, facts, kit, c, nav, home),
    "{{BLOCK_HERO}}": hero,
    "{{BLOCK_PROOF}}": proofBlock(copy),
    "{{BLOCK_TRUST}}": "",
    "{{BLOCK_SERVICES}}": listBand("whatWeDo", "What we do", list(content.what_we_do), true) + listBand("signs", "Signs you need it", list(content.signs), false),
    "{{BLOCK_HOW}}": "",
    "{{BLOCK_WORK}}": photoBand,
    "{{BLOCK_REVIEWS}}": reviewsBand,
    "{{BLOCK_OWNER}}": "",
    "{{BLOCK_ABOUT}}": "",
    "{{BLOCK_AREAS}}": "",
    "{{BLOCK_FAQ}}": faqBand,
    "{{BLOCK_RESOURCES}}": backLink,
    "{{BLOCK_CLOSING}}": closingBlock(facts, closingCopy, false),
    "{{SSR_QUOTE_HEADING}}": "",
    "{{BLOCK_FOOTER}}": footerBlock(facts, c),
    "{{BLOCK_MOBILE_BAR}}": mobileBar({ phone: facts.phone }),
    "{{QUOTE_FORM}}": renderQuoteForm(quoteProfile, {
      preselect: name, source: `spotlight:${spot.service_slug}`, subject: `${name} request`,
      returnPath: `${home}/${spot.service_slug}`, status: ctx.quoteStatus || "", trackContactClick: true, submitLabel: label,
    }),
  };
}

/** Service + LocalBusiness provider schema, FAQs, and head fields for a v3 service page. */
export function servicePageV3Parts(rawProfile, kit, spot, ctx = {}) {
  const blocks = renderServicePageV3(rawProfile, kit, spot, ctx);
  const plan = v3Plan(rawProfile, kit, { ...ctx, spotlights: ctx.spotlights || [] });
  const content = spot.content || {};
  const homeUrl = ctx.homeCanonical || ctx.canonical;
  const provider = localBusinessSchemaV3(plan.facts, { canonical: homeUrl, image: ctx.image, rawProfile });
  const schema = {
    "@context": "https://schema.org", "@type": "Service",
    name: content.service_name, description: content.intro || "", url: ctx.canonical,
    areaServed: plan.facts.towns.confirmed.length ? plan.facts.towns.confirmed : [plan.facts.towns.home].filter(Boolean),
    provider: { ...provider, "@context": undefined },
  };
  return {
    blocks,
    schema: JSON.parse(JSON.stringify(schema)),
    faqs: normalizeFaqs(list(content.faqs)),
    title: content.seo?.title || `${content.service_name} | ${plan.facts.name}`,
    description: content.seo?.description || content.intro || "",
  };
}

// ── C3: owner bar ask ──────────────────────────────────────────────────────

/**
 * "Your <service> page is ready: approve it / pick a different service".
 * servicePage: the auto row ({ service_slug, status, approved_at, content }).
 * choices: the page's other service names (from page_copy_v3.services).
 */
export function servicePageAskHtml(slug, servicePage, choices = []) {
  if (!servicePage?.content?.service_name) return "";
  const name = servicePage.content.service_name;
  const url = `/${encodeURIComponent(slug)}/${encodeURIComponent(servicePage.service_slug)}`;
  const others = choices.filter(n => slugifyService(n) !== servicePage.service_slug);
  const pick = others.length ? `<form class="v3-svcask__pick" data-svc-pick>
      <label>Pick a different service <select name="service">${others.map(n => `<option>${esc(n)}</option>`).join("")}</select></label>
      <button type="submit" class="v2-owner__town">Use this one</button>
    </form>` : "";
  if (servicePage.status === "published") {
    return `<div class="v3-svcask" id="svcAsk"><p><b>Your <a class="v2-owner__link" href="${esc(url)}">${esc(name.toLowerCase())} page</a> is live.</b> It's included in your plan.</p></div>`;
  }
  if (servicePage.approved_at) {
    return `<div class="v3-svcask" id="svcAsk"><p><b>✓ Approved.</b> Your <a class="v2-owner__link" href="${esc(url)}">${esc(name.toLowerCase())} page</a> goes live with your website. It's included in your plan.</p>${pick}</div>`;
  }
  return `<div class="v3-svcask" id="svcAsk">
    <p><b>Your <a class="v2-owner__link" href="${esc(url)}">${esc(name.toLowerCase())} page</a> is ready.</b> It's included in your plan.</p>
    <button type="button" class="v2-owner__town" data-svc-approve>Approve it</button>
    ${pick}
    <p class="v3-svcask__msg" role="status"></p>
  </div>`;
}

/** The script for the ask (posts to /api/generate-business?kind=owner). */
export const SERVICE_ASK_SCRIPT = `<script>
(function () {
  var box = document.getElementById("svcAsk"), bar = document.getElementById("ownerBar"); if (!box || !bar) return;
  var slug = bar.getAttribute("data-slug"), o = bar.getAttribute("data-o"), msg = box.querySelector(".v3-svcask__msg");
  function post(action, body, done) {
    body.slug = slug; body.o = o;
    fetch("/api/generate-business?kind=owner&action=" + action, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || "x"); return j; }); })
      .then(done).catch(function (e) { if (msg) msg.textContent = e && e.message && e.message !== "x" ? e.message : "Couldn't save. Try again."; });
  }
  var ok = box.querySelector("[data-svc-approve]");
  if (ok) ok.addEventListener("click", function () { ok.disabled = true; post("approve_service_page", {}, function (j) { ok.textContent = "✓ Approved"; if (msg) msg.textContent = j.published ? "It's live now." : "It goes live with your website."; }); });
  var pick = box.querySelector("[data-svc-pick]");
  if (pick) pick.addEventListener("submit", function (e) { e.preventDefault(); var b = pick.querySelector("button"); b.disabled = true; if (msg) msg.textContent = "Writing your new page…";
    post("pick_service_page", { service: pick.querySelector("select").value }, function () { if (msg) msg.textContent = "Done. Reload in a minute to see it."; }); });
})();
</script>`;
