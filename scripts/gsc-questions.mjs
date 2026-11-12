// Monthly "question queries" report from Google Search Console.
//
// Finds the questions people type that already surface enoma.io pages, and
// flags the ones with plenty of impressions but few clicks: cheap wins where a
// guide's title should answer the question ("retitle") or a /for/ page should
// answer it in its FAQ ("add FAQ").
//
// Run (local script, not an api function):
//   node scripts/gsc-questions.mjs                      # Search Console API, last 90 days
//   node scripts/gsc-questions.mjs path/to/export.csv   # a CSV export instead
//
// Options:
//   --min-impressions N   impressions floor for an opportunity (default 20)
//   --top N               rows in the table (default 15)
//   --month YYYY-MM       report month for the file name (default: this month)
//   --no-write            print only; don't write reports/gsc-questions-YYYY-MM.md
//
// API mode uses the same service account as api/ga-metrics.js
// (GA_CLIENT_EMAIL + GA_PRIVATE_KEY; it's a user on the Search Console
// property). Set GSC_SITE_URL to override the property (default sc-domain:enoma.io).
//
// CSV mode accepts any export with query, page, impressions, clicks and
// position columns (Search Console API/Looker Studio/Supermetrics headers all
// work: "Query"/"Top queries", "Page"/"Landing page"/"Full URL",
// "Average position"/"Position"). CTR is recomputed from clicks/impressions.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { GUIDES } from "../data/guides.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const QUESTION_RE = /^(who|what|when|where|why|how|which|can|does|do|is|are|should|will)\b/i;
export const BRAND_RE = /enoma/i;
const GUIDE_SLUGS = new Set(GUIDES.map(g => g.slug));

export const isQuestion = q => QUESTION_RE.test(q.trim()) || q.includes("?");
export const isBrand = q => BRAND_RE.test(q);

/** Path of a landing page URL ("https://enoma.io/for/x?y" -> "/for/x"). */
export function pagePath(page) {
  if (!page) return "";
  try { return new URL(page).pathname.replace(/\/+$/, "") || "/"; }
  catch { return page; }
}

/**
 * Suggested action for a page: guides (data/guides.mjs) get "retitle", other
 * /for/ pages get "add FAQ". Anything else (home, pricing, client pages) is
 * "review": the fix isn't a guide edit.
 */
export function suggestAction(page) {
  const m = pagePath(page).match(/^\/for\/([a-z0-9-]+)$/);
  if (!m) return "review";
  return GUIDE_SLUGS.has(m[1]) ? "retitle" : "add FAQ";
}

export function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// ---- CSV ------------------------------------------------------------------

/** Minimal RFC 4180 parser: quoted fields, "" escapes, commas/newlines in quotes. */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some(f => f !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(f => f !== "")) rows.push(row);
  return rows;
}

const HEADERS = {
  query: ["query", "top queries", "queries", "search query"],
  page: ["page", "landing page", "full url", "url", "top pages", "pages"],
  impressions: ["impressions"],
  clicks: ["clicks"],
  position: ["position", "average position", "avg. position", "avg position"],
};

/** CSV text -> [{query, page, impressions, clicks, position}] */
export function rowsFromCsv(text) {
  const [header, ...body] = parseCsv(text);
  if (!header) return [];
  const norm = header.map(h => h.trim().toLowerCase());
  const col = {};
  for (const [key, names] of Object.entries(HEADERS)) col[key] = norm.findIndex(h => names.includes(h));
  for (const key of ["query", "impressions", "clicks"]) {
    if (col[key] < 0) throw new Error(`CSV is missing a "${key}" column (found: ${header.join(", ")})`);
  }
  const num = v => Number(String(v ?? "").replace(/[,%\s]/g, "")) || 0;
  return body.map(r => ({
    query: (r[col.query] || "").trim(),
    page: col.page >= 0 ? (r[col.page] || "").trim() : "",
    impressions: num(r[col.impressions]),
    clicks: num(r[col.clicks]),
    position: col.position >= 0 ? num(r[col.position]) : 0,
  }));
}

// ---- Search Console API ---------------------------------------------------

async function rowsFromApi({ days = 90 } = {}) {
  if (!process.env.GA_CLIENT_EMAIL || !process.env.GA_PRIVATE_KEY) {
    throw new Error("No Search Console credentials (GA_CLIENT_EMAIL / GA_PRIVATE_KEY). Pass a CSV export path instead.");
  }
  const { JWT } = await import("google-auth-library");
  const auth = new JWT({
    email: process.env.GA_CLIENT_EMAIL,
    key: process.env.GA_PRIVATE_KEY.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
  });
  const { token } = await auth.getAccessToken();
  const site = process.env.GSC_SITE_URL || "sc-domain:enoma.io";
  const end = new Date(Date.now() - 2 * 86400e3); // GSC data lags ~2 days
  const start = new Date(end.getTime() - (days - 1) * 86400e3);
  const ymd = d => d.toISOString().slice(0, 10);
  const rows = [];
  for (let startRow = 0; ; startRow += 25000) {
    const res = await fetch(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ startDate: ymd(start), endDate: ymd(end), dimensions: ["query", "page"], rowLimit: 25000, startRow }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || `Search Console query failed (${res.status})`);
    for (const r of data.rows || []) {
      rows.push({ query: r.keys[0], page: r.keys[1], impressions: r.impressions, clicks: r.clicks, position: r.position });
    }
    if ((data.rows || []).length < 25000) break;
  }
  return rows;
}

// ---- Ranking --------------------------------------------------------------

/**
 * Keep non-brand question queries with at least `minImpressions` and a CTR
 * below the site median. The site median is the median CTR of every non-brand
 * query+page row that clears the same impressions floor. When that median is
 * 0 (a young site where most rows have no clicks yet), nothing can be "below"
 * it, so rows with zero clicks count as below.
 * Ranked by missed clicks: impressions × (median − CTR), then impressions.
 */
export function findOpportunities(rows, { minImpressions = 20, top = 15 } = {}) {
  const clean = rows
    .filter(r => r.query && r.query !== "(unknown)" && !isBrand(r.query))
    .map(r => ({ ...r, ctr: r.impressions ? r.clicks / r.impressions : 0 }));
  const eligible = clean.filter(r => r.impressions >= minImpressions);
  const siteMedianCtr = median(eligible.map(r => r.ctr));
  const below = r => (siteMedianCtr > 0 ? r.ctr < siteMedianCtr : r.clicks === 0);
  const questions = clean.filter(r => isQuestion(r.query));
  const opportunities = questions
    .filter(r => r.impressions >= minImpressions && below(r))
    .map(r => ({ ...r, action: suggestAction(r.page), missed: r.impressions * Math.max(siteMedianCtr - r.ctr, 0) }))
    .sort((a, b) => b.missed - a.missed || b.impressions - a.impressions || a.position - b.position)
    .slice(0, top);
  return { opportunities, siteMedianCtr, questionCount: questions.length, eligibleCount: eligible.length };
}

// ---- Output ---------------------------------------------------------------

const pct = x => `${(x * 100).toFixed(1)}%`;
const cell = s => String(s).replace(/\|/g, "\\|");

export function renderTable(opportunities) {
  const lines = [
    "| # | Query | Page | Impr. | Clicks | CTR | Avg. pos. | Suggested action |",
    "|---|---|---|---:|---:|---:|---:|---|",
  ];
  opportunities.forEach((r, i) => lines.push(
    `| ${i + 1} | ${cell(r.query)} | ${cell(pagePath(r.page) || "(no page column)")} | ${r.impressions} | ${r.clicks} | ${pct(r.ctr)} | ${r.position ? r.position.toFixed(1) : "–"} | ${r.action} |`
  ));
  return lines.join("\n");
}

export function renderReport(result, { month, source, minImpressions }) {
  const { opportunities, siteMedianCtr, questionCount, eligibleCount } = result;
  return `# Search Console question queries: ${month}

Source: ${source}. Non-brand question queries (start with who/what/when/where/why/how/which/can/does/do/is/are/should/will, or contain "?") with at least ${minImpressions} impressions and a CTR below the site median.

- Question query+page rows found: ${questionCount}
- Site median CTR (${eligibleCount} non-brand rows with ${minImpressions}+ impressions): ${pct(siteMedianCtr)}${siteMedianCtr === 0 ? " (so any question row with zero clicks counts as below it)" : ""}
- Opportunities: ${opportunities.length}

${opportunities.length ? renderTable(opportunities) : "_No question queries cleared the bar this month._"}

**retitle**: a guide in data/guides.mjs. Rewrite \`title\` so it answers the query in the searcher's words (keep it under 75 characters).
**add FAQ**: a /for/ page. Answer the query in 2–4 sentences as a visible FAQ entry.
**review**: not a guide or /for/ page; decide by hand.
`;
}

function parseArgs(argv) {
  const opts = { minImpressions: 20, top: 15, write: true, csv: null, month: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--min-impressions") opts.minImpressions = Number(argv[++i]);
    else if (a === "--top") opts.top = Number(argv[++i]);
    else if (a === "--month") opts.month = argv[++i];
    else if (a === "--no-write") opts.write = false;
    else if (!a.startsWith("--")) opts.csv = a;
    else throw new Error(`Unknown option ${a}`);
  }
  return opts;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const opts = parseArgs(process.argv.slice(2));
  const month = opts.month || new Date().toISOString().slice(0, 7);
  try {
    const rows = opts.csv ? rowsFromCsv(readFileSync(opts.csv, "utf8")) : await rowsFromApi();
    const source = opts.csv ? `CSV export (${rows.length} rows)` : `Search Console API, last 90 days (${rows.length} rows)`;
    const result = findOpportunities(rows, opts);
    const report = renderReport(result, { month, source, minImpressions: opts.minImpressions });
    console.log(report);
    if (opts.write) {
      mkdirSync(join(ROOT, "reports"), { recursive: true });
      const out = join(ROOT, "reports", `gsc-questions-${month}.md`);
      writeFileSync(out, report);
      console.error(`wrote ${out.replace(ROOT + "/", "")}`);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
