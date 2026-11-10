// api/_lib/spotlight.js
// Service Spotlight pages: one page that sells one service, at
// enoma.io/<business-slug>/<service-slug>. Built from an intake survey by a
// short prompt chain (see the Service Spotlight spec doc):
//   1. gap check      — deterministic: required answers present and specific
//   2. brief + 3. headline options + 4. blocks — one AI call, brief first
//   5. fact check     — second AI call removes claims the survey doesn't support,
//                       then copy-lint strips filler words
//   6. assemble + SEO — deterministic (title, description, slug, FAQ schema)
// Pages are saved as drafts; the owner approves before they're published.
//
// Served through api/generate-business.js?kind=spotlight (Vercel Hobby caps
// the number of functions, so this rides an existing one).

import { bannedWordsIn, lintCopy } from "./copy-lint.js";
import { waitUntil } from "@vercel/functions";
import {
  syncSpotlightQuantity,
} from "./spotlight-billing.js";

// Keep the last few versions so an owner can go back after a rewrite.
export const MAX_VERSIONS = 8;
export function pushVersion(versions, spot) {
  if (!spot?.content || !Object.keys(spot.content).length) return Array.isArray(versions) ? versions : [];
  const entry = {
    saved_at: spot.updated_at || new Date().toISOString(),
    headline: spot.content?.hero?.headline || "",
    intake: spot.intake || {}, brief: spot.brief || {}, content: spot.content, removed_claims: spot.removed_claims || [],
  };
  return [entry, ...(Array.isArray(versions) ? versions : [])].slice(0, MAX_VERSIONS);
}

export const SPOTLIGHT_ADMIN_ID = "b2f87fe4-4d1e-4038-8754-5ab64969e975";

// "review" is reserved for the review-request page (api/_lib/reviews.js).
export const slugifyService = text => {
  const s = String(text || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60);
  return s === "review" ? "review-service" : s;
};

const str = v => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());
const lines = v => (Array.isArray(v) ? v : str(v).split(/\n+/)).map(str).filter(Boolean);

// ── Step 1: gap check ─────────────────────────────────────────────
// Required answers, and the vague phrasings that get a follow-up question.
export const REQUIRED = {
  service_name: "Service name",
  one_liner: "One- or two-sentence description",
  outcome: "The result the customer walks away with",
  buyers: "Who usually buys this",
  trigger: "What's happening when they go looking",
  old_way: "What they do today instead",
  cost_of_old_way: "What that costs them",
  steps: "Steps from first contact to done",
  turnaround: "Typical turnaround or schedule",
  deliverables: "What they get",
  objections: "The questions buyers always ask, with answers",
  pricing_mode: "How to show pricing",
  cta_type: "What a visitor should do",
};

const VAGUE = [
  [/\b(fast|quick|quickly|asap|prompt)\b/i, n => `${n}: how fast, in hours or days?`],
  [/\b(affordable|competitive|reasonable|fair) pric/i, n => `${n}: what's a typical price or starting price?`],
  [/\b(high[- ]quality|best|top[- ]notch|great service)\b/i, n => `${n}: what specifically makes it better? A number, a method or a guarantee works.`],
  [/\b(everyone|anyone|all customers)\b/i, n => `${n}: who buys this most often? Name a type of customer.`],
];

// The quick form (home and local services) asks five things; the rest of the
// chain works from those plus the company page.
export const QUICK_REQUIRED = {
  service_name: REQUIRED.service_name,
  one_liner: "What it is, in a sentence or two",
  deliverables: "What's included",
  turnaround: "Where and when",
  pricing_mode: REQUIRED.pricing_mode,
  cta_type: REQUIRED.cta_type,
};
const QUICK_STEPS = "Call or send the form\nWe confirm the details and the price\nWe do the work";

// Quick-form answers become a full intake: neutral steps and the one-liner
// as the outcome. Nothing about the business is invented.
export function expandQuickIntake(intake = {}) {
  if (intake.mode !== "quick") return intake;
  const out = { ...intake };
  if (!lines(out.steps).length) out.steps = QUICK_STEPS;
  if (!str(out.outcome)) out.outcome = str(out.one_liner);
  return out;
}

export function gapCheck(intake = {}) {
  const required = intake.mode === "quick" ? QUICK_REQUIRED : REQUIRED;
  const missing = Object.entries(required)
    .filter(([k]) => {
      const v = intake[k];
      if (k === "objections") return !(Array.isArray(v) && v.some(o => str(o?.q) && str(o?.a)));
      if (k === "steps") return lines(v).length < 2;
      return !str(v);
    })
    .map(([k, label]) => ({ field: k, question: `${label} is required.` }));

  const followUps = [];
  for (const k of ["outcome", "turnaround", "buyers", "one_liner"]) {
    const v = str(intake[k]);
    if (!v) continue;
    for (const [re, ask] of VAGUE) if (re.test(v)) { followUps.push({ field: k, question: ask(REQUIRED[k]) }); break; }
  }
  if (str(intake.one_liner) && str(intake.one_liner).split(/\s+/).length < 5) {
    followUps.push({ field: "one_liner", question: "Description: add a few more words on what's actually included." });
  }
  return { missing, followUps: followUps.slice(0, 5), ready: !missing.length };
}

// ── Step 2–4: brief, headline options, blocks ─────────────────────
function intakeForPrompt(intake, profile) {
  const objections = (intake.objections || []).filter(o => str(o?.q) && str(o?.a))
    .map((o, i) => `  Q${i + 1}: ${str(o.q)}\n  A${i + 1}: ${str(o.a)}`).join("\n");
  return `COMPANY (from their existing Enoma page):
Name: ${profile.business_name || ""}
Trade: ${profile.primary_category || ""}
Town: ${[profile.city, profile.state].filter(Boolean).join(", ")}
Areas served: ${(Array.isArray(profile.service_area) ? profile.service_area : []).join(", ") || "not given"}
Owner: ${profile.owner_name || "not given"}

SURVEY ANSWERS (the ONLY source of facts — each tagged [qN]):
[q1] Service: ${str(intake.service_name)}
[q2] Description: ${str(intake.one_liner)}
[q3] Outcome for the customer: ${str(intake.outcome)}
[q4] Who buys it: ${str(intake.buyers)}
[q5] What's happening when they look for it: ${str(intake.trigger)}
[q6] Who else signs off: ${str(intake.decision_makers) || "not given"}
[q7] What they do today instead: ${str(intake.old_way)}
[q8] What that costs them: ${str(intake.cost_of_old_way)}
[q9] Why they finally switch: ${str(intake.switch_reason) || "not given"}
[q10] Steps:\n${lines(intake.steps).map((s, i) => `  ${i + 1}. ${s}`).join("\n")}
[q11] Needed from the customer to start: ${str(intake.needs_to_start) || "not given"}
[q12] Turnaround / schedule: ${str(intake.turnaround)}
[q13] Deliverables:\n${lines(intake.deliverables).map(s => `  - ${s}`).join("\n")}
[q15] Customer story: ${str(intake.proof_story) || "none"}
[q16] Credentials: ${str(intake.credentials) || "none"}
[q17] Customer quote: ${str(intake.quote) ? `"${str(intake.quote)}" — ${str(intake.quote_author) || "customer"}` : "none"}
[q18] Specs / details: ${lines(intake.specs).join("; ") || "none"}
[q19] Questions buyers ask, with answers:\n${objections}
[q20] Pricing: ${str(intake.pricing_mode)}${str(intake.price) ? ` — ${str(intake.price)}` : ""}
[q21] Call to action: ${str(intake.cta_type)}${str(intake.cta_label) ? ` ("${str(intake.cta_label)}")` : ""}
[q24] Never say: ${str(intake.do_not_say) || "nothing listed"}
[q25] Style notes: ${str(intake.style_notes) || "none"}`;
}

export function buildDraftPrompt(intake, profile) {
  return `You write single-service landing pages. One page sells ONE service to ONE buyer with ONE call to action.
Return ONLY valid JSON matching the schema. No markdown.

${intakeForPrompt(intake, profile)}

WORK IN THIS ORDER:
1. "brief": the positioning brief. Every value ends with the [qN] tags it came from.
2. "headline_options": 3 hero headline + subhead pairs from different angles: "outcome", "pain", "speed".
   Every headline names the service in plain words (e.g. "Snow Removal") and the town if one was given; under 70 characters.
   Subhead one sentence under 140 characters. The "speed" angle may only promise a time the survey states in [q12];
   if [q12] gives no time, make the third angle "trust" (the owner, the area, the credentials) instead.
3. "blocks": the page copy, written ONLY from the brief.

SCHEMA:
{
  "brief": { "buyer": "", "trigger": "", "old_way_and_cost": "", "promise": "", "points": ["", "", ""], "objections": [""], "tone": "" },
  "headline_options": [{ "angle": "outcome", "headline": "", "subhead": "" }],
  "blocks": {
    "cta_label": "",
    "who": { "intro": "", "buyers": [{ "title": "", "situation": "" }] },
    "problem": { "heading": "", "body": "" },
    "steps": [{ "title": "", "detail": "" }],
    "deliverables": { "items": [""], "turnaround": "" },
    "proof": { "story": "", "credentials": [""] },
    "faqs": [{ "q": "", "a": "" }],
    "specs": [{ "label": "", "value": "" }],
    "cta": { "heading": "", "body": "" }
  }
}

BLOCK RULES:
- cta_label: 2-5 words matching [q21]. Use their label if given.
- who: intro 1 sentence; 2-3 buyers, each a short title + one sentence on the situation they're in.
- problem: heading under 60 characters; body 50-90 words on what the old way costs them. No rhetorical questions.
- steps: 3-5 steps from [q10], titles 2-5 words, detail 1 sentence each.
- deliverables: items from [q13] (rewrite for clarity, don't add); turnaround from [q12].
- proof: story only if [q15] has one (2-3 sentences, no invented numbers); credentials only from [q16]. Use "" and [] when none.
- faqs: one per question in [q19], answers from the survey. Add a pricing FAQ only if [q20] gives a price.
- specs: only from [q18]; [] if none.
- cta: heading under 50 characters, body 1-2 sentences.

HARD RULES:
- Use ONLY facts in the survey answers. No invented numbers, years, customers, guarantees, certifications or towns.
- Never use: ${["trusted", "reliable", "professional", "quality", "dedicated", "passionate", "commitment", "excellence", "proud", "strive", "ensure", "seamless", "world-class", "top-notch"].join(", ")}.
- Never use anything listed in [q24].
- Plain words, short sentences, about a 9th-grade reading level; keep the buyer's own technical terms.`;
}

// ── Step 5: fact check ────────────────────────────────────────────
export function buildFactCheckPrompt(intake, profile, draft) {
  return `You are a fact checker for a landing page. Compare the PAGE COPY against the SURVEY ANSWERS.
Remove or rewrite any number, time frame, speed claim (quick, fast, prompt, same-day), guarantee, credential, quote, customer type, town or claim that the survey does not state.
The COMPANY facts (business name, town, areas served, owner name) are supported: keep them.
Keep everything that is supported. Keep the same JSON shape. Do not add new claims.
"removed" lists ONLY changes you actually made in the JSON you return, one short line each; [] if none.
Return ONLY JSON: { "headline_options": [...], "blocks": {...}, "removed": [...] }

${intakeForPrompt(intake, profile)}

PAGE COPY:
${JSON.stringify({ headline_options: draft.headline_options, blocks: draft.blocks }, null, 1)}`;
}

// ── Normalising AI output ─────────────────────────────────────────
export function normalizeDraft(raw, intake) {
  const b = raw?.blocks && typeof raw.blocks === "object" ? raw.blocks : {};
  const arr = v => (Array.isArray(v) ? v : []);
  const headlineOptions = arr(raw?.headline_options)
    .map(h => ({ angle: str(h?.angle), headline: str(h?.headline), subhead: str(h?.subhead) }))
    .filter(h => h.headline)
    .slice(0, 3);
  return {
    brief: raw?.brief && typeof raw.brief === "object" ? raw.brief : {},
    headline_options: headlineOptions,
    blocks: {
      cta_label: str(b.cta_label) || str(intake.cta_label) || "Get a Quote",
      who: { intro: str(b.who?.intro), buyers: arr(b.who?.buyers).map(x => ({ title: str(x?.title), situation: str(x?.situation) })).filter(x => x.title).slice(0, 3) },
      problem: { heading: str(b.problem?.heading), body: str(b.problem?.body) },
      steps: arr(b.steps).map(x => ({ title: str(x?.title), detail: str(x?.detail) })).filter(x => x.title).slice(0, 5),
      deliverables: { items: arr(b.deliverables?.items).map(str).filter(Boolean).slice(0, 8), turnaround: str(b.deliverables?.turnaround) },
      proof: { story: str(b.proof?.story), credentials: arr(b.proof?.credentials).map(str).filter(Boolean).slice(0, 6) },
      faqs: arr(b.faqs).map(f => ({ q: str(f?.q || f?.question), a: str(f?.a || f?.answer) })).filter(f => f.q && f.a).slice(0, 8),
      specs: arr(b.specs).map(s => ({ label: str(s?.label), value: str(s?.value) })).filter(s => s.label && s.value).slice(0, 10),
      cta: { heading: str(b.cta?.heading), body: str(b.cta?.body) },
    },
  };
}

// Words the owner banned (q24) plus filler words, checked across the page.
export function spotlightIssues(draft, intake) {
  const issues = [];
  const doNotSay = str(intake.do_not_say).split(/[,;\n]+/).map(s => s.trim().toLowerCase()).filter(s => s.length > 2);
  const walk = (v, path) => {
    if (typeof v === "string") {
      const hits = bannedWordsIn(v);
      if (hits.length) issues.push({ path, message: `${path} uses: ${hits.join(", ")}` });
      const lc = v.toLowerCase();
      doNotSay.forEach(w => { if (lc.includes(w)) issues.push({ path, message: `${path} uses "${w}", which the owner asked us never to say` }); });
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === "object") Object.entries(v).forEach(([k, x]) => walk(x, path ? `${path}.${k}` : k));
  };
  walk({ headline_options: draft.headline_options, blocks: draft.blocks }, "");
  return issues;
}

// Speed promises the owner never made ("quick", "promptly", "same-day",
// "within 2 hours") are the most common invented claim. If no survey answer
// mentions speed or a time, they're removed here even if the fact check missed them.
const SPEED_RE = /\b(quick(ly)?|fast(est)?|prompt(ly)?|speedy|same[- ]day|next[- ]day|immediate(ly)?|right away|in no time|asap|within \d+\s*(minutes?|hours?|days?))\b/i;
function intakeText(intake) {
  return Object.values(intake || {}).map(v => (typeof v === "string" ? v : JSON.stringify(v))).join(" ");
}
export function stripUnsupportedSpeed(draft, intake) {
  if (SPEED_RE.test(intakeText(intake))) return { draft, notes: [] };
  const notes = [];
  const out = JSON.parse(JSON.stringify(draft));
  const before = out.headline_options.length;
  out.headline_options = out.headline_options.filter(h => !SPEED_RE.test(`${h.headline} ${h.subhead}`));
  if (out.headline_options.length < before) notes.push(`Dropped ${before - out.headline_options.length} headline(s) promising speed your answers don't state.`);
  const dropSentences = (text, where) => {
    if (typeof text !== "string" || !SPEED_RE.test(text)) return text;
    const kept = text.split(/(?<=[.!?])\s+/).filter(sn => !SPEED_RE.test(sn)).join(" ");
    notes.push(`Removed a speed claim from ${where}.`);
    return kept;
  };
  const b = out.blocks;
  b.who.intro = dropSentences(b.who.intro, "who it's for");
  b.who.buyers = b.who.buyers.map(x => ({ ...x, situation: dropSentences(x.situation, "who it's for") })).filter(x => x.situation);
  b.problem.body = dropSentences(b.problem.body, "the problem");
  b.steps = b.steps.map(x => ({ ...x, detail: dropSentences(x.detail, "how it works") }));
  b.deliverables.items = b.deliverables.items.filter(i => !SPEED_RE.test(i));
  b.faqs = b.faqs.map(f => ({ ...f, a: dropSentences(f.a, "the FAQ") })).filter(f => f.a);
  b.cta.body = dropSentences(b.cta.body, "the call to action");
  return { draft: out, notes: [...new Set(notes)] };
}

// Last-resort cleanup: drop strings that still contain an owner-banned phrase.
export function scrubSpotlight(draft, intake) {
  const doNotSay = str(intake.do_not_say).split(/[,;\n]+/).map(s => s.trim().toLowerCase()).filter(s => s.length > 2);
  const bad = s => typeof s === "string" && (bannedWordsIn(s).length || doNotSay.some(w => s.toLowerCase().includes(w)));
  const clean = s => (typeof s === "string" ? s.replace(/\b(trusted|reliable|professional|quality|dedicated|seamless|top-notch|world-class)\s+/gi, "").trim() : s);
  const out = JSON.parse(JSON.stringify(draft));
  out.headline_options = out.headline_options.map(h => ({ ...h, headline: clean(h.headline), subhead: clean(h.subhead) })).filter(h => !bad(h.headline));
  const b = out.blocks;
  b.who.buyers = b.who.buyers.filter(x => !bad(x.title) && !bad(x.situation));
  b.steps = b.steps.map(s => ({ title: clean(s.title), detail: clean(s.detail) }));
  b.deliverables.items = b.deliverables.items.map(clean).filter(x => !bad(x));
  b.proof.credentials = b.proof.credentials.filter(x => !bad(x));
  b.faqs = b.faqs.filter(f => !bad(f.q) && !bad(f.a));
  for (const k of ["intro"]) b.who[k] = clean(b.who[k]);
  b.problem.body = clean(b.problem.body);
  b.cta.body = clean(b.cta.body);
  return out;
}

// ── Step 6: assemble + SEO ────────────────────────────────────────
export function assembleContent(draft, intake, profile, chosen = 0) {
  const town = profile.city || "";
  const service = str(intake.service_name);
  const options = draft.headline_options.length
    ? draft.headline_options
    : [{ angle: "outcome", headline: `${service}${town ? ` in ${town}` : ""}`, subhead: str(intake.one_liner) }];
  const pick = options[Math.min(Math.max(0, chosen | 0), options.length - 1)];
  const seoTitle = `${service}${town ? ` in ${town}${profile.state ? `, ${profile.state}` : ""}` : ""} | ${profile.business_name || ""}`.slice(0, 70);
  const seoDescription = `${pick.subhead || str(intake.one_liner)}`.slice(0, 158);
  return {
    service_name: service,
    hero: { headline: pick.headline, subhead: pick.subhead, cta_label: draft.blocks.cta_label },
    chosen_headline: options.indexOf(pick),
    headline_options: options,
    ...draft.blocks,
    pricing: { mode: str(intake.pricing_mode), price: str(intake.price) },
    cta_type: str(intake.cta_type),
    hero_photo: str(intake.hero_photo) || null,
    seo: { title: seoTitle, description: seoDescription },
  };
}

// ── OpenAI call ──────────────────────────────────────────────────
export async function aiJSON(prompt, { fetchImpl, model = "gpt-4o", temperature = 0.3 } = {}) {
  const r = await fetchImpl("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model, temperature,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You are a JSON API. Return ONLY valid JSON." },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  const text = j?.choices?.[0]?.message?.content || "";
  try { return JSON.parse(text.replace(/```json|```/g, "").trim()); } catch { throw new Error("AI returned invalid JSON"); }
}

// Runs steps 2–6. Returns { brief, content, removed, issues }.
export async function generateSpotlight(intake, profile, { fetchImpl }) {
  const raw = await aiJSON(buildDraftPrompt(intake, profile), { fetchImpl });
  let draft = normalizeDraft(raw, intake);
  let removed = [];
  try {
    const checked = await aiJSON(buildFactCheckPrompt(intake, profile, draft), { fetchImpl, temperature: 0 });
    const checkedDraft = normalizeDraft({ brief: draft.brief, ...checked }, intake);
    // Keep the checked version unless it gutted the page (a bad fact-check reply).
    if (checkedDraft.headline_options.length && checkedDraft.blocks.steps.length) draft = checkedDraft;
    removed = Array.isArray(checked?.removed) ? checked.removed.map(str).filter(Boolean).slice(0, 20) : [];
  } catch (e) {
    console.warn("spotlight fact check failed:", e?.message);
    removed = ["Fact check didn't run — review every claim before publishing."];
  }
  draft = scrubSpotlight(draft, intake);
  const speed = stripUnsupportedSpeed(draft, intake);
  draft = speed.draft;
  removed = [...removed, ...speed.notes];
  const issues = spotlightIssues(draft, intake);
  return { brief: draft.brief, content: assembleContent(draft, intake, profile, 0), removed, issues };
}

// ── HTTP handler (mounted at /api/generate-business?kind=spotlight) ──
async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

async function canEdit(supabaseAdmin, userId, businessId) {
  if (userId === SPOTLIGHT_ADMIN_ID) return true;
  const { data } = await supabaseAdmin.from("business_members").select("role")
    .eq("user_id", userId).eq("business_id", businessId).maybeSingle();
  return !!data;
}

const PROFILE_FIELDS = "business_id,username,business_name,primary_category,city,state,service_area,owner_name,phone,email,logo_url,attachments,attachment_kinds,services";

// Sets the service-page add-on quantity after a status change. Failures are
// logged, never thrown: the next publish/unpublish (or the Stripe webhook)
// recomputes the count from service_spotlights and corrects it.
async function syncQuietly(stripe, supabaseAdmin, businessId, why) {
  try {
    return await syncSpotlightQuantity({ stripe, supabase: supabaseAdmin, businessId });
  } catch (e) {
    console.error(`[spotlight-billing] quantity sync failed after ${why} for business ${businessId}:`, e?.message || e);
    return null;
  }
}

export async function handleSpotlight(req, res, { supabaseAdmin, fetchImpl, stripe = null }) {
  const action = String(req.query?.action || "generate");
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Please log in." });
  const { data: { user } = {}, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: "Your session expired. Please log in again." });

  let body;
  try { body = await readJson(req); } catch { return res.status(400).json({ error: "Invalid JSON" }); }

  // Businesses this user can make spotlights for (admin: look one up by slug).
  if (action === "businesses") {
    if (user.id === SPOTLIGHT_ADMIN_ID && body.slug) {
      const { data } = await supabaseAdmin.from("small_business_profiles").select("business_id,username,business_name").eq("username", str(body.slug)).maybeSingle();
      return res.status(200).json({ businesses: data ? [data] : [], is_admin: true });
    }
    const { data: members } = await supabaseAdmin.from("business_members").select("business_id").eq("user_id", user.id);
    const ids = (members || []).map(m => m.business_id);
    const { data } = ids.length
      ? await supabaseAdmin.from("small_business_profiles").select("business_id,username,business_name").in("business_id", ids)
      : { data: [] };
    return res.status(200).json({ businesses: data || [], is_admin: user.id === SPOTLIGHT_ADMIN_ID });
  }

  const businessId = str(body.business_id);
  if (!businessId) return res.status(400).json({ error: "business_id required" });
  if (!(await canEdit(supabaseAdmin, user.id, businessId))) return res.status(403).json({ error: "Not authorized for this business" });

  const { data: profile } = await supabaseAdmin.from("small_business_profiles").select(PROFILE_FIELDS).eq("business_id", businessId).maybeSingle();
  if (!profile) return res.status(404).json({ error: "Business page not found" });

  if (action === "context") {
    const { data: spotlights } = await supabaseAdmin.from("service_spotlights")
      .select("id,service_slug,status,service_name:content->>service_name,updated_at").eq("business_id", businessId).order("updated_at", { ascending: false });
    const kinds = profile.attachment_kinds || {};
    const photos = (Array.isArray(profile.attachments) ? profile.attachments : [])
      .map(a => (typeof a === "string" ? a : a?.url)).filter(u => u && (!kinds[u] || kinds[u] === "work"));
    return res.status(200).json({
      profile: { business_name: profile.business_name, username: profile.username, city: profile.city, state: profile.state, primary_category: profile.primary_category, services: profile.services || [] },
      photos, spotlights: spotlights || [],
    });
  }

  if (action === "check") {
    return res.status(200).json(gapCheck(body.intake || {}));
  }

  if (action === "generate") {
    const intake = expandQuickIntake(body.intake || {});
    const gap = gapCheck(intake);
    if (!gap.ready) return res.status(400).json({ error: "Some required answers are missing.", ...gap });
    if (!body.skip_followups && gap.followUps.length) return res.status(200).json({ needs_followup: true, ...gap });

    // The hero photo must be one of this business's own job photos.
    const kinds = profile.attachment_kinds || {};
    const ownPhotos = (Array.isArray(profile.attachments) ? profile.attachments : []).map(x => (typeof x === "string" ? x : x?.url));
    if (intake.hero_photo && !(ownPhotos.includes(intake.hero_photo) && (!kinds[intake.hero_photo] || kinds[intake.hero_photo] === "work"))) intake.hero_photo = "";
    const serviceSlug = slugifyService(body.service_slug || intake.service_name);
    if (!serviceSlug) return res.status(400).json({ error: "Service name required" });
    // Save the answers now and write the page in the background, so the
    // owner isn't waiting on a request that can time out. The form polls
    // action=get until generation_status is "ready" or "failed".
    const { data: existing } = await supabaseAdmin.from("service_spotlights")
      .select("id,status,generation_status,generation_started_at").eq("business_id", businessId).eq("service_slug", serviceSlug).maybeSingle();
    const startedMs = existing?.generation_started_at ? Date.parse(existing.generation_started_at) : 0;
    if (existing?.generation_status === "generating" && Date.now() - startedMs < 90 * 1000) {
      return res.status(409).json({ error: "This page is already being written. Give it a minute." });
    }
    const now = new Date().toISOString();
    const pending = {
      business_id: businessId, service_slug: serviceSlug, intake, created_by: user.id,
      generation_status: "generating", generation_error: null, generation_started_at: now,
      status: "draft", // a rewrite goes back to draft until the owner approves it again
    };
    const { data: saved, error } = await supabaseAdmin.from("service_spotlights")
      .upsert(pending, { onConflict: "business_id,service_slug" }).select("id,service_slug,status").single();
    if (error) { console.error("spotlight save failed:", error); return res.status(500).json({ error: "Couldn't save your answers." }); }
    // A rewrite of a live page sends it back to draft, so it stops being billed.
    if (existing?.status === "published") await syncQuietly(stripe, supabaseAdmin, businessId, "rewrite");

    const job = runGeneration({ supabaseAdmin, fetchImpl, id: saved.id, intake, profile });
    try { waitUntil(job); } catch { await job; } // outside Vercel (tests), just wait
    return res.status(202).json({
      ok: true, generating: true, id: saved.id, status: saved.status, service_slug: saved.service_slug,
      url: `/${profile.username}/${saved.service_slug}`,
    });
  }

  // Approval screen actions on an existing draft.
  const { data: spot } = await supabaseAdmin.from("service_spotlights").select("*")
    .eq("business_id", businessId).eq("service_slug", str(body.service_slug)).maybeSingle();
  if (!spot) return res.status(404).json({ error: "Spotlight not found" });

  if (action === "get") {
    return res.status(200).json({
      intake: spot.intake || {}, status: spot.status, service_slug: spot.service_slug,
      generation_status: spot.generation_status || "ready", generation_error: spot.generation_error || null,
      removed: spot.removed_claims || [],
      versions: (spot.versions || []).map((v, i) => ({ index: i, saved_at: v.saved_at, headline: v.headline })),
    });
  }
  if (action === "restore") {
    const versions = Array.isArray(spot.versions) ? spot.versions : [];
    const i = Number(body.index);
    if (!Number.isInteger(i) || !versions[i]) return res.status(400).json({ error: "That version no longer exists." });
    const chosen = versions[i];
    // The current page becomes a version too, so restoring can be undone.
    const rest = versions.filter((_, k) => k !== i);
    const nextVersions = pushVersion(rest, spot);
    await supabaseAdmin.from("service_spotlights").update({
      intake: chosen.intake, brief: chosen.brief, content: chosen.content, removed_claims: chosen.removed_claims || [],
      versions: nextVersions, updated_at: new Date().toISOString(),
    }).eq("id", spot.id);
    return res.status(200).json({ ok: true });
  }
  if (action === "choose_headline") {
    const opts = spot.content?.headline_options || [];
    const i = Number(body.index);
    if (!Number.isInteger(i) || !opts[i]) return res.status(400).json({ error: "Bad headline choice" });
    const content = { ...spot.content, chosen_headline: i, hero: { ...spot.content.hero, headline: opts[i].headline, subhead: opts[i].subhead } };
    await supabaseAdmin.from("service_spotlights").update({ content, updated_at: new Date().toISOString() }).eq("id", spot.id);
    return res.status(200).json({ ok: true });
  }
  if (action === "publish" || action === "unpublish") {
    // Billing (api/_lib/spotlight-billing.js): a published service page is
    // $9.99/month on the owner's plan (the yearly add-on on a yearly plan). The quantity is recomputed here, on the
    // server, from service_spotlights — the browser never sends a count.
    const published = action === "publish";
    const before = { status: spot.status, published_at: spot.published_at || null };
    const newlyPublished = published && before.status !== "published";
    const { error: upErr } = await supabaseAdmin.from("service_spotlights").update({
      status: published ? "published" : "draft",
      published_at: published ? (before.status === "published" && before.published_at ? before.published_at : new Date().toISOString()) : null,
      updated_at: new Date().toISOString(),
    }).eq("id", spot.id);
    if (upErr) { console.error("spotlight status update failed:", upErr); return res.status(500).json({ error: "That didn't save. Try again." }); }

    let sync;
    if (newlyPublished) {
      // Publishing must not go live unbilled: if Stripe refuses, put it back.
      try {
        sync = await syncSpotlightQuantity({ stripe, supabase: supabaseAdmin, businessId });
      } catch (e) {
        console.error(`[spotlight-billing] publish refused for business ${businessId}:`, e?.message || e);
        await supabaseAdmin.from("service_spotlights").update({
          status: before.status, published_at: before.published_at, updated_at: new Date().toISOString(),
        }).eq("id", spot.id);
        return res.status(502).json({
          error: e?.code === "price_missing" ? e.message
            : "We couldn't add this page to your plan just now, so it wasn't published. Try again in a minute, or email jack@enoma.io.",
          code: e?.code || "billing_failed",
        });
      }
    } else {
      // Unpublishing (or re-publishing a live page) always succeeds; the
      // quantity only goes down, and a failed sync is retried by the next one.
      sync = await syncQuietly(stripe, supabaseAdmin, businessId, action);
    }
    return res.status(200).json({
      ok: true, status: published ? "published" : "draft",
      billing: sync ? { billing: sync.billing, quantity: sync.quantity, published: sync.published } : { pending: true },
    });
  }
  return res.status(400).json({ error: `Unknown action ${action}` });
}

// Used by tests: the lint used for company pages also applies here.
export { lintCopy };

// Background job: writes the page, keeps the previous version, records failure.
export async function runGeneration({ supabaseAdmin, fetchImpl, id, intake, profile }) {
  try {
    const result = await generateSpotlight(intake, profile, { fetchImpl });
    const { data: before } = await supabaseAdmin.from("service_spotlights")
      .select("intake,brief,content,removed_claims,versions,updated_at").eq("id", id).maybeSingle();
    await supabaseAdmin.from("service_spotlights").update({
      brief: result.brief, content: result.content, removed_claims: result.removed,
      versions: pushVersion(before?.versions, before),
      generation_status: "ready", generation_error: null, updated_at: new Date().toISOString(),
    }).eq("id", id);
  } catch (e) {
    console.error("spotlight generation failed:", e);
    await supabaseAdmin.from("service_spotlights").update({
      generation_status: "failed",
      generation_error: "We couldn't write the page just now. Your answers are saved; try again in a minute.",
    }).eq("id", id);
  }
}
