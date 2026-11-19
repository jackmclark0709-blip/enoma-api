// api/_lib/stock-library.js
// Enoma's own stock photo library: hand-picked photos copied into
// public/stock/ and served from enoma.io (/stock/<id>-800.webp and
// -1600.webp). No Unsplash API call at page time, no hotlinking, no
// credit line on the page.
//
// The photos are from Unsplash under the Unsplash License (free to copy
// and use, attribution not required). They were first found through the
// API (scripts/build-stock-library.mjs) and approved by hand; the copies
// were made once from scripts/stock-manifest.txt (a one-off GitHub Actions
// run on a temporary branch; hand review dropped the ids in
// scripts/stock-rejected.txt), re-encoded to ~1440px and 800px WebP.
// Do not add photos from Unsplash+ or any other source without checking
// its license.
//
// They are placeholders: a page shows them until the owner adds photos of
// their own work, and never captions one as the business's own work.
//
// Pure: tested in tests/stock-library.test.js.

import { STOCK_LIBRARY } from "./stock-library-data.js";
import { STOCK_QUERIES } from "./stock-photos.js";
import { hashString } from "./page-style.js";

const str = v => (v == null ? "" : String(v).trim());

// Plain-language alt text per tag (the photos are illustrative).
export const TAG_ALT = Object.freeze({
  "cleaning/bathroom": "A clean bathroom", "cleaning/kitchen": "A clean kitchen", "cleaning/living-room": "A clean, bright living room",
  "cleaning/move-out": "An empty, clean room", "cleaning/office": "A clean office", "cleaning/pressure-wash": "A clean driveway and house front",
  "cleaning/windows": "Clean windows with sunlight",
  "contractor/deck": "A wood deck", "contractor/framing": "House framing", "contractor/kitchen-remodel": "A remodeled kitchen",
  "contractor/masonry": "A brick wall", "contractor/paving": "An asphalt driveway", "contractor/roof": "A shingled roof", "contractor/siding": "House siding",
  "electrical/ceiling-fan": "A living room", "electrical/exterior-lighting": "A house lit up at night", "electrical/generator": "A home generator",
  "electrical/lighting": "Kitchen lighting", "electrical/outlets": "A wall outlet and switch", "electrical/panel": "An electrical panel", "electrical/wiring": "Electrical wiring",
  "hvac/cozy-home": "A warm living room", "hvac/ductwork": "Air ductwork", "hvac/furnace": "A furnace", "hvac/heat-pump": "A heat pump",
  "hvac/mini-split": "A room with a mini split", "hvac/outdoor-unit": "An outdoor AC unit", "hvac/rooftop": "Rooftop HVAC units", "hvac/thermostat": "A thermostat",
  "landscaping/cleanup": "A yard in autumn", "landscaping/design": "A landscaped yard", "landscaping/garden-beds": "Mulched garden beds",
  "landscaping/hardscape": "A stone patio", "landscaping/hedges": "Trimmed hedges", "landscaping/irrigation": "A lawn sprinkler",
  "landscaping/lawn": "A freshly mowed lawn", "landscaping/trees": "Trees in a backyard",
  "painting/cabinets": "Painted kitchen cabinets", "painting/commercial": "A painted office", "painting/deck-stain": "A stained deck",
  "painting/exterior": "A freshly painted house", "painting/interior": "A freshly painted room", "painting/trim": "Painted trim",
  "plumbing/bathroom": "A bathroom", "plumbing/boiler": "Heating pipes", "plumbing/drain": "A drain", "plumbing/fixtures": "A bathroom faucet",
  "plumbing/kitchen-sink": "A kitchen sink", "plumbing/pipes": "Copper pipes",
  "snow/driveway": "A snowy driveway", "snow/parking-lot": "A plowed lot", "snow/plow": "A snow plow", "snow/salt": "A winter road",
  "snow/shovel": "A cleared sidewalk", "snow/winter-house": "A house in the snow",
});

// Wide, calm shots that work behind the hero text, per persona.
export const HERO_TAGS = Object.freeze({
  plumbing: ["bathroom", "kitchen-sink", "fixtures"],
  hvac: ["cozy-home", "mini-split"],
  electrical: ["lighting", "ceiling-fan", "exterior-lighting"],
  landscaping: ["garden-beds", "hedges", "design", "lawn"],
  snow: ["winter-house", "plow", "driveway"],
  painting: ["exterior", "interior", "cabinets"],
  cleaning: ["living-room", "kitchen", "bathroom"],
  contractor: ["siding", "roof", "kitchen-remodel", "deck"],
});

// Specific services → a better persona/tag than the business's own persona
// (a painter who pressure washes, a roofer filed as "contractor").
const CROSS = [
  [/pressure|power wash/i, "cleaning/pressure-wash"],
  [/roof|shingle/i, "contractor/roof"],
  [/pav|asphalt|driveway|sealcoat/i, "contractor/paving"],
  [/snow|plow/i, "snow/plow"],
  [/carpet|rug/i, "cleaning/living-room"],
  [/ceiling/i, "painting/interior"],
  [/hot tub|spa|generator|inlet/i, "electrical/panel"],
  [/mini ?split|hvac/i, "hvac/mini-split"],
  [/tick|weed|restor|seed|aerat/i, "landscaping/lawn"],
  [/water heater|hot water|tank/i, "plumbing/fixtures"],
  [/root|sewer|drain|clog/i, "plumbing/kitchen-sink"],
  [/leak|pipe/i, "plumbing/pipes"],
];

const byKey = new Map();
for (const row of STOCK_LIBRARY) {
  const k = `${row.persona}/${row.tag}`;
  if (!byKey.has(k)) byKey.set(k, []);
  byKey.get(k).push(row);
}

/** All library keys ("persona/tag") that have photos. */
export function libraryKeys() { return [...byKey.keys()]; }

export function photoUrls(id) {
  return { src: `/stock/${id}-800.webp`, src1600: `/stock/${id}-1600.webp`, srcset: `/stock/${id}-800.webp 800w, /stock/${id}-1600.webp 1600w` };
}

/** The library tag for a service: cross-trade rules, then the persona's own STOCK_QUERIES rules. "" when none fits. */
export function tagForService(persona, text) {
  const t = str(text).toLowerCase();
  if (!t) return "";
  const qs = STOCK_QUERIES[persona] || [];
  const has = tag => byKey.has(`${persona}/${tag}`);
  // 1. The persona's own specific tags. 2. Cross-trade rules. 3. The persona's general tag.
  const own = qs.slice(1).find(q => q.match.test(t) && has(q.tag));
  if (own) return `${persona}/${own.tag}`;
  const cross = CROSS.find(([re, key]) => re.test(t) && byKey.has(key));
  if (cross) return cross[1];
  return qs[0] && qs[0].match.test(t) && has(qs[0].tag) ? `${persona}/${qs[0].tag}` : "";
}

function pickFrom(rows, seed, taken) {
  const pool = rows.filter(r => !taken.has(r.id));
  if (!pool.length) return null;
  const row = pool[hashString(seed) % pool.length];
  taken.add(row.id);
  return row;
}

function asPhoto(row) {
  const key = `${row.persona}/${row.tag}`;
  return { id: row.id, key, alt: TAG_ALT[key] || "", ...photoUrls(row.id), kind: "stock" };
}

/**
 * A placeholder photo for one service card: its own tag (unless that tag is
 * already on the page twice), then a photo from another of the persona's tags,
 * then anything of the persona not used on this page. null for an unknown persona.
 * taken: Set of ids already on the page (mutated).
 */
export function stockForService({ persona, name = "", brief = "", seed = "", taken = new Set() } = {}) {
  // The service's own name decides first; the AI's photo brief ("hot water
  // tank repair") only when the name matches nothing.
  const key = tagForService(persona, name) || tagForService(persona, brief);
  // At most two photos of a tag per page: three lawn shots in a row look like a template.
  const counts = {};
  for (const r of STOCK_LIBRARY) if (taken.has(r.id)) counts[`${r.persona}/${r.tag}`] = (counts[`${r.persona}/${r.tag}`] || 0) + 1;
  const usedKeys = new Set(Object.keys(counts).filter(k => counts[k] >= 2));
  // A service named for the tag ("Roof replacements" → roof) may repeat it;
  // a loose match (tick control → lawn) may not.
  const own = (STOCK_QUERIES[persona] || []).slice(1).some(q => `${persona}/${q.tag}` === key && q.match.test(str(name).toLowerCase()));
  const exact = key && (own || !usedKeys.has(key)) ? pickFrom(byKey.get(key) || [], `${seed}:${key}`, taken) : null;
  if (exact) return asPhoto(exact);
  const keys = libraryKeys().filter(k => k.startsWith(`${persona}/`));
  const general = (HERO_TAGS[persona] || []).map(t => `${persona}/${t}`).filter(k => byKey.has(k) && !usedKeys.has(k));
  const fresh = (general.length ? general : keys.filter(k => !usedKeys.has(k))).flatMap(k => byKey.get(k));
  const anyFresh = pickFrom(fresh, `${seed}:${persona}:${name}`, taken);
  if (anyFresh) return asPhoto(anyFresh);
  const same = key ? pickFrom(byKey.get(key) || [], `${seed}:${key}`, taken) : null;
  if (same) return asPhoto(same);
  const all = keys.flatMap(k => byKey.get(k));
  const any = pickFrom(all, `${seed}:${persona}:${name}`, taken);
  return any ? asPhoto(any) : null;
}

/** The hero's placeholder photo: a wide, calm shot for the persona (HERO_TAGS order; a contractor's main service first). */
export function stockForHero({ persona, mainService = "", seed = "", taken = new Set() } = {}) {
  const tags = HERO_TAGS[persona];
  if (!tags) return null;
  // "Contractor" covers roofers, pavers and masons: lead with their own work.
  const main = persona === "contractor" ? tagForService(persona, mainService) : "";
  const order = main.startsWith(`${persona}/`) ? [main.split("/")[1], ...tags] : tags;
  for (const tag of order) {
    const row = pickFrom(byKey.get(`${persona}/${tag}`) || [], `${seed}:hero:${tag}`, taken);
    if (row) return asPhoto(row);
  }
  return null;
}
