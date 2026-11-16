// A tiny in-memory stand-in for the supabase-js query builder: enough of
// select / insert / upsert / update with eq, in, is, lt(e), gt(e), ilike,
// not, or, order, limit, maybeSingle, plus the two embeds the signal store
// uses (followup_sends -> signals, signals -> followup_sends). Test-only.

import crypto from "node:crypto";

const EMBEDS = {
  followup_sends: { signals: { many: false, local: "signal_id", foreign: "id" } },
  signals: { followup_sends: { many: true, local: "id", foreign: "signal_id" } }
};
const UNIQUE = { signals: ["dedupe_key"], followup_sends: ["signal_id,step"], signal_alerts: ["alert_key"], visit_followups: ["prospect_id"] };

function splitTop(str) {
  const out = []; let cur = ""; let depth = 0; let q = false;
  for (const ch of str) {
    if (ch === '"') q = !q;
    if (!q && ch === "(") depth++;
    if (!q && ch === ")") depth--;
    if (!q && depth === 0 && ch === ",") { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out.map(s => s.trim());
}

const unq = (v) => (typeof v === "string" && v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v);
const cmp = (a, b) => (a === b ? 0 : a === null || a === undefined ? -1 : b === null || b === undefined ? 1 : a < b ? -1 : 1);

class Query {
  constructor(db, table) {
    this.db = db; this.table = table; this.filters = []; this.op = "select"; this.cols = "*";
    this._order = null; this._limit = null; this._single = null; this._returning = false;
  }
  select(cols = "*") { if (this.op === "select") this.cols = cols; else this._returning = true; this.retCols = cols; return this; }
  insert(rows) { this.op = "insert"; this.rows = [].concat(rows); return this; }
  upsert(rows, opts = {}) { this.op = "upsert"; this.rows = [].concat(rows); this.opts = opts; return this; }
  update(patch) { this.op = "update"; this.patch = patch; return this; }
  delete() { this.op = "delete"; return this; }
  eq(c, v) { this.filters.push(r => r[c] === v); return this; }
  neq(c, v) { this.filters.push(r => r[c] !== v); return this; }
  in(c, vs) { this.filters.push(r => vs.includes(r[c])); return this; }
  is(c, v) { this.filters.push(r => (v === null ? r[c] === null || r[c] === undefined : r[c] === v)); return this; }
  lt(c, v) { this.filters.push(r => r[c] !== null && r[c] !== undefined && r[c] < v); return this; }
  lte(c, v) { this.filters.push(r => r[c] !== null && r[c] !== undefined && r[c] <= v); return this; }
  gt(c, v) { this.filters.push(r => r[c] !== null && r[c] !== undefined && r[c] > v); return this; }
  gte(c, v) { this.filters.push(r => r[c] !== null && r[c] !== undefined && r[c] >= v); return this; }
  ilike(c, v) { this.filters.push(r => String(r[c] ?? "").toLowerCase() === String(v).toLowerCase()); return this; }
  not(c, op, v) {
    if (op === "in") { const vs = String(v).replace(/^\(|\)$/g, "").split(","); this.filters.push(r => !vs.includes(r[c])); }
    else if (op === "is") this.filters.push(r => !(r[c] === null || r[c] === undefined));
    else this.filters.push(r => r[c] !== v);
    return this;
  }
  or(expr) {
    const parts = splitTop(expr).map(p => { const [c, op, ...rest] = p.split("."); return { c, op, v: unq(rest.join(".")) }; });
    this.filters.push(r => parts.some(p => (p.op === "eq" ? String(r[p.c]) === p.v : false)));
    return this;
  }
  order(c, { ascending = true } = {}) { this._order = { c, ascending }; return this; }
  limit(n) { this._limit = n; return this; }
  maybeSingle() { this._single = "maybe"; return this; }
  single() { this._single = "one"; return this; }
  then(res, rej) { return Promise.resolve().then(() => this.run()).then(res, rej); }

  rowsOf() { return (this.db.tables[this.table] ||= []); }
  match(r) { return this.filters.every(f => f(r)); }
  embed(r) {
    const out = { ...r };
    const emb = EMBEDS[this.table] || {};
    for (const name of Object.keys(emb)) {
      if (!String(this.cols).includes(`${name}(`)) continue;
      const e = emb[name];
      const rows = (this.db.tables[name] || []).filter(x => x[e.foreign] === r[e.local]);
      out[name] = e.many ? rows.map(x => ({ ...x })) : rows[0] ? { ...rows[0] } : null;
    }
    return out;
  }
  finish(rows) {
    if (this._single === "maybe") return { data: rows[0] ?? null, error: null };
    if (this._single === "one") return rows.length ? { data: rows[0], error: null } : { data: null, error: { message: "no rows" } };
    return { data: rows, error: null, count: rows.length };
  }
  run() {
    const all = this.rowsOf();
    if (this.op === "select") {
      let rows = all.filter(r => this.match(r));
      if (this._order) rows = rows.sort((a, b) => cmp(a[this._order.c], b[this._order.c]) * (this._order.ascending ? 1 : -1));
      if (this._limit !== null) rows = rows.slice(0, this._limit);
      return this.finish(rows.map(r => this.embed(r)));
    }
    if (this.op === "insert" || this.op === "upsert") {
      const keys = this.opts?.onConflict ? [this.opts.onConflict] : (UNIQUE[this.table] || []);
      const inserted = [];
      for (const row of this.rows) {
        const dup = keys.map(k => k.split(",")).find(cols => all.some(r => cols.every(c => r[c] === row[c])));
        if (dup) {
          if (this.op === "upsert" && !this.opts?.ignoreDuplicates) {
            const existing = all.find(r => dup.every(c => r[c] === row[c]));
            Object.assign(existing, row); inserted.push({ ...existing });
          }
          continue;
        }
        const full = { id: crypto.randomUUID(), created_at: new Date(this.db.now()).toISOString(), ...row };
        all.push(full); inserted.push({ ...full });
      }
      return this.finish(inserted);
    }
    if (this.op === "update") {
      const hit = all.filter(r => this.match(r));
      for (const r of hit) Object.assign(r, this.patch);
      return this.finish(hit.map(r => ({ ...r })));
    }
    if (this.op === "delete") {
      const keep = all.filter(r => !this.match(r));
      this.db.tables[this.table] = keep;
      return this.finish([]);
    }
    throw new Error(`unsupported op ${this.op}`);
  }
}

export function fakeSupabase(seed = {}, { now = () => Date.now() } = {}) {
  const db = { tables: JSON.parse(JSON.stringify(seed)), now };
  return {
    tables: db.tables,
    from: (t) => new Query(db, t),
    auth: { admin: { getUserById: async (id) => ({ data: { user: (db.tables.auth_users || []).find(u => u.id === id) || null } }) } }
  };
}

export function fakeResend() {
  const sent = [];
  return { sent, emails: { send: async (msg) => { sent.push(msg); return { data: { id: `re_${sent.length}` }, error: null }; } } };
}
