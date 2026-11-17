// api/_lib/launch-kit.js
// The launch kit (PR 3 of page v2): marketing pieces made for one business
// from its brand kit, so the owner gets something they can post the day
// their page goes up.
//
//   cover          Facebook Page cover, 1702x630 (2x Meta's 851x315)
//   post_online    1080x1080 "We're online": page link, what we do, towns
//   post_specialty 1080x1080 "High ceilings? That's our specialty."
//   post_seasonal  1080x1080 a post for this season and trade
//   qr_card        4x6 in printable PDF: wordmark, QR to the page, phone
//   badge          round profile picture (only when there's no usable logo)
//
// Stored on small_business_profiles.brand_kit.launch_kit; the files live in
// Supabase storage (watermarked previews public, clean files private). See
// api/_lib/launch-kit-render.js for the I/O.
//
// This file is pure (no network, no DB) and tested in tests/launch-kit.test.js.
// The rule from brand-kit.js holds here too: every fact on a piece comes from
// the business (its kit, its page) or is left off.

import crypto from "node:crypto";
import { sceneKeyFor, tradeLabel, stateCode } from "./brand-kit.js";
import { offersFreeEstimates } from "./page-claims.js";
import { lintCaption } from "./copy-lint.js";

export const LAUNCH_KIT_VERSION = 1;

// Meta Help Center ("Facebook Page profile picture and cover photo
// dimensions", checked 2026-11-16): the cover loads fastest as 851x315, is
// left-aligned full bleed at 16:9 on computers and 2.4:1 on phones, and the
// profile picture covers part of its left side. A 2.7:1 image shown at 16:9
// keeps only its left ~1120 of 1702 px (at 2x); centered crops keep ~291-1411.
// So every word sits in x 330-1090 and the photo/scene fills the edges.
export const COVER = { w: 1702, h: 630, safe: { x0: 330, x1: 1090, y0: 70, y1: 560 } };
export const POST = { w: 1080, h: 1080 };
// 4x6 in at 300 dpi; the PDF page is 288x432 pt.
export const CARD = { w: 1200, h: 1800, pt: { w: 288, h: 432 } };
// Meta: Page profile pictures should be 320x320 (2x here); cropped to a circle.
export const BADGE = { w: 640, h: 640 };

export const ITEM_LABELS = {
  cover: "Facebook cover photo",
  post_online: "Post: We're online",
  post_specialty: "Post: Our specialty",
  post_seasonal: "Post: This season",
  qr_card: "Printable QR card (4x6)",
  badge: "Round profile picture",
};

// The one line the outreach drafts may add (and nothing else changes).
export const OUTREACH_LINE = "I also made you a Facebook cover and a few posts to go with it.";

const list = v => (Array.isArray(v) ? v : []);
const cleanTown = t => String(t || "").replace(/,\s*[A-Za-z .]+$/, "").trim();
const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : s);

// ── Facts ─────────────────────────────────────────────────────────────────

/** The page's public address: a connected custom domain, else enoma.io/<slug>. */
export function pageUrlFor(p = {}, { base = "https://enoma.io" } = {}) {
  const dom = String(p.custom_domain || "").trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return dom ? `https://${dom}` : `${base}/${encodeURIComponent(p.username || "")}`;
}

/** "enoma.io/let-it-roll-painting" for printing (no scheme). */
export function displayUrl(url) {
  return String(url || "").replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
}

/** Where the QR card's code points: the page, tagged so scans show up as their own source. */
export function qrTarget(p = {}) {
  return `${pageUrlFor(p)}?utm_source=qr_card&utm_medium=print`;
}

/** Confirmed towns only (suggested towns are never public). */
export function kitTowns(p = {}, kit = {}) {
  const confirmed = list(kit.towns?.confirmed).map(cleanTown).filter(Boolean);
  const own = cleanTown(p.city);
  return [...new Set(confirmed.length ? confirmed : own ? [own] : [])];
}

/** "Ewing, Trenton & Hopewell" (at most `max`, then "and nearby"). */
export function townsLine(towns, max = 4) {
  const t = list(towns).slice(0, max);
  const more = list(towns).length > max;
  if (!t.length) return "";
  if (t.length === 1) return more ? `${t[0]} and nearby` : t[0];
  if (more) return `${t.join(", ")} and nearby`;
  return `${t.slice(0, -1).join(", ")} & ${t[t.length - 1]}`;
}

/** The specialty, or the first service when there isn't one. */
export function featuredFor(p = {}, kit = {}) {
  if (kit.specialty) return { kind: "specialty", name: kit.specialty };
  const s = list(p.services).find(x => x && String(x.service_name || x.name || "").trim());
  if (s) return { kind: "service", name: String(s.service_name || s.name).trim(), description: String(s.service_description || s.description || "").trim() };
  return { kind: "trade", name: tradeLabel(p) };
}

/** "High ceilings? That's our specialty." Only says "specialty" when the business does. */
export function specialtyHeadline(p = {}, kit = {}) {
  const f = featuredFor(p, kit);
  if (f.kind === "specialty") return `${f.name}? That's our specialty.`;
  return `${f.name}? Give us a call.`;
}

/** The estimate line: "free" only when the business itself says so (page-claims.js). */
export function estimateWords(p = {}) {
  return offersFreeEstimates(p) ? "a free estimate" : "an estimate";
}

/** "Scan for a free estimate" / "Scan for an estimate". */
export function scanLine(p = {}) {
  return `Scan for ${estimateWords(p)}`;
}

/** The cover's specialty line: "Cathedral & high ceilings · Ewing, NJ". */
export function coverLine(p = {}, kit = {}) {
  const where = [cleanTown(p.city), stateCode(p.state)].filter(Boolean).join(", ");
  const what = kit.specialty || `${tradeLabel(p)}`;
  return [what, where].filter(Boolean).join(" · ");
}

// ── Seasons ───────────────────────────────────────────────────────────────

/** Northern-US seasons (where every current page is). month: 0-11. */
export function seasonFor(month) {
  const m = ((Number(month) % 12) + 12) % 12;
  if (m === 11 || m <= 1) return "winter";
  if (m <= 4) return "spring";
  if (m <= 7) return "summer";
  return "fall";
}

// Per trade and season, the first topic whose `re` matches one of the
// business's own services wins; `any: true` topics are advice that claims no
// service. The headline is drawn on the image as written (no model).
const SEASONAL = {
  painting: {
    winter: [{ re: /interior|ceiling|drywall|popcorn|cabinet/, h: "Cold outside? Good time to paint inside.", theme: "interior painting while it's cold out" }],
    spring: [{ re: /exterior|house|siding|deck|stain/, h: "Exterior painting season is here.", theme: "exterior painting now that the weather is warming up" },
      { re: /interior|ceiling|room/, h: "Fresh rooms for spring.", theme: "repainting rooms in the spring" }],
    summer: [{ re: /exterior|house|siding|deck|stain/, h: "Dry days are made for exterior paint.", theme: "exterior painting in dry summer weather" },
      { re: /commercial|office|restaurant/, h: "Summer is a good time to paint the office.", theme: "painting commercial spaces in the quieter summer months" }],
    fall: [{ re: /exterior|house|siding/, h: "Get the exterior done before the cold.", theme: "finishing exterior painting before winter" },
      { re: /interior|ceiling|room/, h: "Fresh paint before the holidays.", theme: "painting rooms before holiday guests arrive" }],
  },
  landscaping: {
    winter: [{ re: /snow|plow/, h: "Snow's here. We plow.", theme: "snow removal this winter" }],
    spring: [{ re: /clean ?up|cleanup/, h: "Spring cleanup time.", theme: "spring yard cleanups" },
      { re: /mulch/, h: "Fresh mulch for spring.", theme: "spring mulching" },
      { re: /mow|lawn/, h: "Mowing season starts now.", theme: "getting on the weekly mowing schedule for the season" }],
    summer: [{ re: /mow|lawn/, h: "Mowing all summer long.", theme: "regular summer mowing" },
      { re: /trim|hedge|shrub/, h: "Overgrown hedges? We trim.", theme: "summer trimming" }],
    fall: [{ re: /clean ?up|cleanup|leaf|leaves/, h: "Fall cleanup time.", theme: "fall leaf and yard cleanups" },
      { re: /snow|plow/, h: "Get on the snow list before the first storm.", theme: "signing up for snow removal before winter" }],
  },
  snow: {
    winter: [{ any: true, h: "Snow's here. We plow.", theme: "snow removal this winter" }],
    fall: [{ any: true, h: "Get on the snow list before the first storm.", theme: "signing up for snow removal before winter" }],
  },
  plumbing: {
    winter: [{ any: true, h: "Cold nights are hard on pipes.", theme: "watching for frozen pipes in cold weather" }],
    spring: [{ re: /sump/, h: "Spring rain? Check the sump pump.", theme: "sump pumps in the spring rains" }],
    summer: [{ re: /water heater|heater/, h: "Water heater acting up?", theme: "water heater repairs and replacements" }],
    fall: [{ re: /water heater|heater|boiler/, h: "Before winter: check the water heater.", theme: "water heater checks before winter" }],
  },
  hvac: {
    winter: [{ re: /heat|furnace|boiler/, h: "Heat not keeping up?", theme: "heating repairs in winter" }],
    spring: [{ re: /a\/?c\b|air condition|cool|tune|maint/, h: "Is your AC ready for summer?", theme: "AC tune-ups before summer" }],
    summer: [{ re: /a\/?c\b|air condition|cool/, h: "AC not keeping up?", theme: "air conditioning repairs in summer" }],
    fall: [{ re: /heat|furnace|boiler|tune|maint/, h: "Furnace tune-up season.", theme: "heating tune-ups before winter" }],
  },
  electrical: {
    winter: [{ re: /generator/, h: "Ready for the next outage?", theme: "generators for winter outages" }],
    spring: [{ re: /panel|upgrade/, h: "Spring is a good time for a panel upgrade.", theme: "electrical panel upgrades" }],
    summer: [{ re: /light|outdoor|landscape/, h: "Planning outdoor lighting?", theme: "outdoor lighting for summer" }],
    fall: [{ re: /generator/, h: "Get a generator before winter.", theme: "generators before winter storms" }],
  },
  cleaning: {
    winter: [{ any: true, h: "A clean start to the new year.", theme: "a deep clean for the new year" }],
    spring: [{ any: true, h: "Spring cleaning season.", theme: "spring cleaning" }],
    summer: [{ re: /move/, h: "Moving this summer?", theme: "move-in and move-out cleaning" }],
    fall: [{ any: true, h: "Get the house ready for the holidays.", theme: "cleaning before holiday guests" }],
  },
  contractor: {
    spring: [{ any: true, h: "Spring projects start with an estimate.", theme: "planning spring projects" }],
  },
};

const GENERIC_SEASON = {
  winter: "Planning a winter project?", spring: "Planning a spring project?",
  summer: "Planning a summer project?", fall: "Planning a fall project?",
};

/**
 * The seasonal post for this business and month: { season, headline, theme }.
 * A topic tied to a service is only used when the business lists it.
 */
export function seasonalTopic(p = {}, month = new Date().getMonth()) {
  const season = seasonFor(month);
  const key = sceneKeyFor(p.primary_category);
  const names = list(p.services).map(s => `${s?.service_name || s?.name || ""} ${s?.service_description || ""}`.toLowerCase()).join(" | ");
  for (const t of SEASONAL[key]?.[season] || []) {
    if (t.any || (t.re && t.re.test(names))) return { season, headline: t.h, theme: t.theme };
  }
  return { season, headline: GENERIC_SEASON[season], theme: `planning ${tradeLabel(p).toLowerCase()} work this ${season}` };
}

// ── The pieces (what each one says) ───────────────────────────────────────

/** Everything drawn on the images. Pure; the art (launch-kit-art.js) only lays it out. */
export function piecesFor(p = {}, kit = {}, { month = new Date().getMonth() } = {}) {
  const url = pageUrlFor(p);
  const towns = kitTowns(p, kit);
  const seasonal = seasonalTopic(p, month);
  const trade = tradeLabel(p);
  const town = cleanTown(p.city);
  return {
    url, display: displayUrl(url), phone: String(p.phone || "").trim(),
    cover: { line: coverLine(p, kit) },
    post_online: {
      kicker: "We're online",
      headline: `${p.business_name || "Our new website"} has a website.`,
      what: kit.specialty ? `${trade} · ${kit.specialty}` : trade,
      towns: towns.length ? `Serving ${townsLine(towns)}` : "",
    },
    post_specialty: {
      kicker: featuredFor(p, kit).kind === "specialty" ? "Our specialty" : (town ? `${trade} in ${town}` : trade),
      headline: specialtyHeadline(p, kit),
      sub: `Call for ${estimateWords(p)}`,
    },
    post_seasonal: { kicker: cap(seasonal.season), headline: seasonal.headline, sub: `Call for ${estimateWords(p)}`, theme: seasonal.theme },
    qr_card: { scan: scanLine(p), line: coverLine(p, kit), target: qrTarget(p) },
  };
}

/** Which items this business gets. The round badge only when there's no usable logo. */
export function itemIds(kit = {}) {
  const ids = ["cover", "post_online", "post_specialty", "post_seasonal", "qr_card"];
  if (kit.logo?.quality !== "usable") ids.push("badge");
  return ids;
}

// ── Freshness ─────────────────────────────────────────────────────────────

/**
 * Hash of everything a piece depends on. A stored launch kit with a different
 * fingerprint is stale (logo/colors/phone changed, a town confirmed, a new
 * season) and is remade on demand the next time the owner opens it.
 */
export function launchKitFingerprint(p = {}, kit = {}, { month = new Date().getMonth() } = {}) {
  const src = JSON.stringify({
    v: LAUNCH_KIT_VERSION,
    name: p.business_name || "", phone: p.phone || "", url: pageUrlFor(p), cat: p.primary_category || "",
    city: p.city || "", state: p.state || "", free: offersFreeEstimates(p),
    services: list(p.services).map(s => s?.service_name || s?.name || ""),
    colors: kit.colors || null, wordmark: kit.wordmark || null, specialty: kit.specialty || null, years: kit.years || null,
    logo: [kit.logo?.url || null, kit.logo?.quality || null],
    hero: kit.hero?.kind === "stock" ? ["stock", kit.hero.ref?.url || kit.hero.ref] : [kit.hero?.kind, kit.hero?.ref],
    towns: kitTowns(p, kit), season: seasonFor(month),
  });
  return crypto.createHash("sha256").update(src).digest("hex").slice(0, 16);
}

/** Is the stored launch kit complete and current? */
export function launchKitFresh(launchKit, fingerprint) {
  return !!(launchKit && launchKit.version === LAUNCH_KIT_VERSION && launchKit.status === "ready"
    && launchKit.fingerprint === fingerprint && list(launchKit.items).length);
}

// ── Captions ──────────────────────────────────────────────────────────────

export const CAPTION_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["post_online", "post_specialty", "post_seasonal"],
  properties: {
    post_online: { type: "string" }, post_specialty: { type: "string" }, post_seasonal: { type: "string" },
  },
};

/** The prices the owner typed onto their own services ("$150", "From $95"); captions may use only these. */
export function ownerPrices(p = {}) {
  return list(p.services).flatMap(s => [s?.price, s?.price_from]).map(v => String(v || "").trim()).filter(Boolean);
}

/** Facts the caption model may use, and only these. */
export function captionFacts(p = {}, kit = {}, pieces) {
  const towns = kitTowns(p, kit);
  const services = list(p.services).filter(s => s && (s.service_name || s.name)).slice(0, 8)
    .map(s => `- ${s.service_name || s.name}${s.service_description ? `: ${s.service_description}` : ""}`);
  return [
    `Business: ${p.business_name || ""}`,
    `Trade: ${tradeLabel(p)}`,
    `Town: ${[cleanTown(p.city), stateCode(p.state)].filter(Boolean).join(", ")}`,
    towns.length ? `Towns served: ${towns.join(", ")}` : null,
    kit.specialty ? `Specialty (their own words): ${kit.specialty}` : null,
    list(kit.owner_names).length ? `People customers talk to: ${kit.owner_names.join(" and ")}` : null,
    kit.years ? `Years of experience: ${kit.years}` : null,
    offersFreeEstimates(p) ? "Offers free estimates: yes" : null,
    ownerPrices(p).length ? `Prices the owner gave: ${ownerPrices(p).join("; ")}` : null,
    services.length ? `Services:\n${services.join("\n")}` : null,
    `Seasonal theme for this month: ${pieces.post_seasonal.theme}`,
  ].filter(Boolean).join("\n");
}

/** The one gpt-4o prompt for all three captions (no image input). */
export function captionPrompt(p = {}, kit = {}, pieces) {
  return `You are writing three short Facebook / Google Business posts for a small local service business, in the owner's voice ("we"). Use ONLY the facts below.

RULES
- Never invent anything: no years, prices, discounts, guarantees, awards, ratings, reviews, licenses, towns, services or names that FACTS don't state.
- No prices or dollar amounts unless FACTS lists "Prices the owner gave", and then only those exact prices.
- Do not say "free" about estimates unless FACTS says "Offers free estimates: yes".
- No puffery: trusted, reliable, professional, quality, dedicated, passionate, excellence, premier, top-notch, best, #1, leading, proud, ensure.
- Plain, friendly, specific. 1-3 short sentences each, under 280 characters. At most one emoji. No hashtags.
- Do NOT include the phone number or any link; they are added after your text.

POSTS
post_online: announcing the new website: what they do and where.
post_specialty: about ${featuredFor(p, kit).kind === "specialty" ? `their specialty (${kit.specialty})` : `one service they list (${featuredFor(p, kit).name})`}.
post_seasonal: about ${pieces.post_seasonal.theme}, tied to what they actually offer.

FACTS
${captionFacts(p, kit, pieces)}

Return JSON with post_online, post_specialty, post_seasonal.`;
}

/** The chat/completions body (exported for tests). */
export function captionRequestBody(prompt) {
  return {
    model: "gpt-4o", temperature: 0.4,
    response_format: { type: "json_schema", json_schema: { name: "launch_kit_captions", strict: true, schema: CAPTION_SCHEMA } },
    messages: [{ role: "user", content: prompt }],
  };
}

/** Lint flags for this business (what's known false or unknown). */
export function captionFlags(p = {}, kit = {}) {
  return { offers_free_estimates: offersFreeEstimates(p), years_in_business: kit.years || null, allowed_prices: ownerPrices(p) };
}

/** The contact lines added under every caption (never left to the model). */
export function contactLines(p = {}, pieces) {
  return [pieces.phone ? `Call or text ${pieces.phone}` : "", pieces.url].filter(Boolean).join("\n");
}

/** Deterministic captions: used when the model is off, fails, or can't pass the lint twice. */
export function fallbackCaptions(p = {}, kit = {}, pieces) {
  const name = p.business_name || "We";
  const towns = kitTowns(p, kit);
  const f = featuredFor(p, kit);
  const where = towns.length ? ` in ${townsLine(towns)}` : "";
  return {
    post_online: `We're online! ${name} has a new website where you can see what we do${where} and get in touch.`,
    post_specialty: f.kind === "specialty"
      ? `${f.name}? That's our specialty. Give us a call.`
      : f.description ? `${f.name}: ${f.description}` : `Need ${f.name.toLowerCase()}? Give us a call.`,
    post_seasonal: `${pieces.post_seasonal.headline} Call for ${estimateWords(p)}.`,
  };
}

/**
 * Lint the model's captions; returns { captions, issues } where captions
 * have contact lines appended. Any caption that fails is replaced with the
 * deterministic one (callers retry the model once before this).
 */
export function finalizeCaptions(raw, p = {}, kit = {}, pieces) {
  const flags = captionFlags(p, kit);
  const fb = fallbackCaptions(p, kit, pieces);
  const out = {}, issues = [];
  for (const id of ["post_online", "post_specialty", "post_seasonal"]) {
    const text = String(raw?.[id] || "").trim();
    const problems = text ? lintCaption(text, flags) : [{ kind: "empty", message: `${id} is empty` }];
    problems.forEach(pr => issues.push({ id, ...pr }));
    const body = problems.length ? fb[id] : text;
    out[id] = `${body}\n\n${contactLines(p, pieces)}`;
  }
  return { captions: out, issues };
}

// ── Unlock + view ─────────────────────────────────────────────────────────

/**
 * What the owner sees for each item. Before the $1 claim: watermarked
 * previews only, no file links. After: the download link for each.
 */
export function launchKitView(launchKit, { unlocked = false, downloadHref = id => `?dl=${id}` } = {}) {
  const items = list(launchKit?.items).map(it => ({
    id: it.id, label: ITEM_LABELS[it.id] || it.id, w: it.w, h: it.h,
    thumb: it.preview_url, caption: it.caption || "",
    download: unlocked ? downloadHref(it.id) : null,
    format: it.format || "png",
  }));
  return { ready: launchKit?.status === "ready", unlocked, items };
}
