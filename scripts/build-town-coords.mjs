// scripts/build-town-coords.mjs
// Builds data/towns/<ST>.json (town centers for page v2's suggested towns)
// from the US Census Gazetteer files, which are public domain:
//   https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html
//   <year>_Gaz_place_national.txt    incorporated places + CDPs
//   <year>_Gaz_cousubs_national.txt  county subdivisions: the New England and
//                                    NJ/PA/NY/MI/... towns and townships
//                                    (e.g. Ewing township, NJ) that aren't places
//
//   node scripts/build-town-coords.mjs <place.txt> <cousubs.txt>
//
// Each file: { asOf, source, towns: [[name, state, lat, lng], ...] }. Places
// win over a same-named county subdivision within 3 miles (the same town).

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Legal/statistical words the Census appends to names ("Ewing township").
const SUFFIXES = [
  "city and borough", "consolidated government \\(balance\\)", "unified government \\(balance\\)", "metro government \\(balance\\)",
  "metropolitan government \\(balance\\)", "urban county", "\\(balance\\)", "charter township", "township", "borough", "city", "town",
  "village", "CDP", "municipality", "plantation", "comunidad", "zona urbana", "corporation", "location", "gore", "grant", "purchase",
];
const SUFFIX_RE = new RegExp(`\\s+(?:${SUFFIXES.join("|")})$`, "i");

export function cleanName(name) {
  let n = String(name || "").trim();
  for (let i = 0; i < 3; i++) { const next = n.replace(SUFFIX_RE, "").trim(); if (next === n) break; n = next; }
  return n;
}

// Places: incorporated (A), CDPs (S), and other active/statistical ones.
const PLACE_FUNCSTAT = new Set(["A", "B", "C", "N", "S"]); // N: e.g. Washington, DC (consolidated)
// County subdivisions: only those with a functioning government (the towns
// people name as where they live); CCDs and unorganized territory are out.
const COUSUB_FUNCSTAT = new Set(["A", "B", "C"]);

// CDPs that are a campus, base, prison or hospital rather than a town
// ("The College of New Jersey CDP", "Joint Base Lewis McChord CDP"). Only
// statistical places (S): incorporated towns like College Station keep their name.
const INSTITUTION_RE = /\b(university|college of|polytechnic|institute|academy|seminary|naval|navy|air force|air station|air facility|joint base|marine corps|coast guard|arsenal|correctional|prison|penitentiary|hospital|campus)\b|\bbase(?: cdp)?$/i;
export function isInstitutionCdp(name, funcstat) {
  return funcstat === "S" && INSTITUTION_RE.test(String(name || ""));
}

export function parseGazetteer(text, { kind }) {
  const lines = String(text).split(/\r?\n/).filter(Boolean);
  const head = lines.shift().split("|").map(h => h.trim());
  const col = k => head.indexOf(k);
  const iSt = col("USPS"), iName = col("NAME"), iFs = col("FUNCSTAT"), iLat = col("INTPTLAT"), iLng = col("INTPTLONG");
  const keep = kind === "place" ? PLACE_FUNCSTAT : COUSUB_FUNCSTAT;
  const out = [];
  for (const line of lines) {
    const f = line.split("|").map(s => s.trim());
    if (!keep.has(f[iFs])) continue;
    const raw = f[iName];
    if (kind === "cousub" && /\b(CCD|UT|unorganized|district|precinct|island|reservation)\b/i.test(raw)) continue;
    if (isInstitutionCdp(raw, f[iFs])) continue;
    const name = cleanName(raw);
    const lat = Number(f[iLat]), lng = Number(f[iLng]);
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    out.push([name, f[iSt], Math.round(lat * 1000) / 1000, Math.round(lng * 1000) / 1000]);
  }
  return out;
}

function miles([a1, o1], [a2, o2]) {
  const r = Math.PI / 180, dLat = (a2 - a1) * r, dLng = (o2 - o1) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a1 * r) * Math.cos(a2 * r) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

/** Places first; a county subdivision is added unless a same-named place is within 3 miles. */
export function mergeTowns(places, cousubs) {
  const byKey = new Map();
  const key = t => `${t[1]}|${t[0].toLowerCase()}`;
  const add = t => { const k = key(t); if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(t); };
  places.forEach(add);
  for (const c of cousubs) {
    const same = byKey.get(key(c)) || [];
    if (same.some(t => miles([t[2], t[3]], [c[2], c[3]]) <= 3)) continue;
    add(c);
  }
  const byState = {};
  for (const rows of byKey.values()) for (const t of rows) (byState[t[1]] ||= []).push(t);
  for (const st of Object.keys(byState)) byState[st].sort((a, b) => a[0].localeCompare(b[0]) || a[2] - b[2]);
  return byState;
}

function main() {
  const [placeFile, cousubFile] = process.argv.slice(2);
  if (!placeFile || !cousubFile) { console.error("usage: node scripts/build-town-coords.mjs <place.txt> <cousubs.txt>"); process.exit(1); }
  const year = (path.basename(placeFile).match(/^(\d{4})_/) || [])[1] || "";
  const places = parseGazetteer(fs.readFileSync(placeFile, "utf8"), { kind: "place" });
  const cousubs = parseGazetteer(fs.readFileSync(cousubFile, "utf8"), { kind: "cousub" });
  const byState = mergeTowns(places, cousubs);
  const dir = path.join(ROOT, "data", "towns");
  fs.mkdirSync(dir, { recursive: true });
  let total = 0, bytes = 0;
  for (const [st, towns] of Object.entries(byState)) {
    const body = JSON.stringify({ asOf: new Date().toISOString().slice(0, 10), source: `US Census Bureau ${year} Gazetteer (places + county subdivisions), public domain`, towns });
    fs.writeFileSync(path.join(dir, `${st}.json`), body + "\n");
    total += towns.length; bytes += body.length;
  }
  console.log(`${Object.keys(byState).length} states, ${total} towns, ${(bytes / 1024).toFixed(0)} KB total`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) main();
