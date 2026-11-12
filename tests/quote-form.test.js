// Run with: node tests/quote-form.test.js (also wired into `npm test`)
// The multi-step quote form: rendering (company page + spotlight), the no-JS
// fallback, cleaning answers, and the lead row / owner email / Jack alert,
// including a run of the real api/send-contact.js handler with fetch stubbed
// (Supabase and Resend both go through fetch).

import assert from "node:assert/strict";
import fs from "node:fs";
import {
  renderQuoteForm, serviceChoices, townChoices, reachName, cleanAnswers, answersSummary, answersEmailHtml,
  safeReturnPath, MAX_SERVICE_CHIPS, SOMETHING_ELSE, askForCompany,
} from "../api/_lib/quote-form.js";
import { leadRow, ownerLeadEmail, jackLeadAlert } from "../api/_lib/lead-email.js";
import { renderSpotlight } from "../api/_lib/spotlight-render.js";

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (err) {
    console.error(`  FAIL - ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

const landscaper = {
  business_id: "b-1", username: "green-acres", business_name: "Green Acres Landscaping", owner_name: "Mike Rossi",
  phone: "(413) 555-0101", city: "Agawam", state: "MA",
  services: [
    { service_name: "Spring Cleanup" }, { service_name: "Mulching" }, { name: "Lawn Mowing" },
    { service_name: "Hedge Trimming" }, { service_name: "Snow Removal" }, { service_name: "Leaf Removal" },
    { service_name: "Patios" }, { service_name: "Retaining Walls" }, { service_name: "Irrigation" },
    { service_name: "Mulching" }, // duplicate
  ],
  service_area: ["Agawam", "West Springfield", "Feeding Hills"],
};
const plumber = { business_id: "b-2", username: "arno-plumbing", business_name: "Arno Plumbing", phone: "", services: [], service_area: [] };

const SAMPLE = { services: ["Spring cleanup", "Mulching"], timing: "this_week", location: "Agawam", preference: "text" };
const SAMPLE_LINE = "Needs: Spring cleanup, Mulching · When: This week · Where: Agawam · Prefers: Text";

const count = (html, re) => (html.match(re) || []).length;

console.log("quote form: rendering");

await test("renders four steps, each a fieldset with a legend", () => {
  const html = renderQuoteForm(landscaper);
  assert.equal(count(html, /<fieldset class="qf-step" data-step="\d"/g), 4);
  assert.equal(count(html, /<legend/g), 4);
  assert.match(html, /What do you need\?/);
  assert.match(html, /When do you need it\?/);
  assert.match(html, /Where's the job\?/);
  assert.match(html, /How should Mike reach you\?/);
  assert.match(html, /aria-live="polite"/);
});

await test("step 1 chips are the business's own services, max 8, plus Something else", () => {
  const html = renderQuoteForm(landscaper);
  const chips = [...html.matchAll(/name="services" value="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(chips.slice(0, MAX_SERVICE_CHIPS), ["Spring Cleanup", "Mulching", "Lawn Mowing", "Hedge Trimming", "Snow Removal", "Leaf Removal", "Patios", "Retaining Walls"]);
  assert.equal(chips.length, MAX_SERVICE_CHIPS + 1);
  assert.equal(chips.at(-1), SOMETHING_ELSE);
  assert.match(html, /type="checkbox" name="services"/); // multi-select
});

await test("same service source as #services-grid (service_name || name), deduped", () => {
  assert.deepEqual(serviceChoices({ services: JSON.stringify([{ name: "Drain Cleaning" }, { service_name: "drain cleaning" }]) }), ["Drain Cleaning"]);
  assert.deepEqual(serviceChoices(plumber), []);
});

// The AssayQuant-style page: a lab services company that works nationwide.
const nationwideLab = { business_id: "b-3", username: "assayquant-technologies-inc", business_name: "AssayQuant Technologies Inc", primary_category: "Biotechnology company", phone: "(508) 555-0102", city: "Marlborough", state: "MA", services: [{ service_name: "Kinase assays" }], service_area: ["Nationwide"] };

await test("step 3 asks a landscaper where the job is", () => {
  const html = renderQuoteForm({ ...landscaper, primary_category: "landscaping" });
  assert.equal(askForCompany({ ...landscaper, primary_category: "landscaping" }), false);
  assert.match(html, /<legend tabindex="-1">Where's the job\?<\/legend>/);
  assert.match(html, /name="location"/);
  assert.doesNotMatch(html, /name="company"/);
});

await test("step 3 asks a nationwide or no-trade business for the visitor's company instead", () => {
  assert.equal(askForCompany({ ...landscaper, primary_category: "" }), false, "no category: keep the job question");
  for (const p of [nationwideLab, { ...nationwideLab, service_area: ["Worcester"] }, { ...landscaper, primary_category: "landscaping", service_area: ["Agawam", "Nationwide"] }]) {
    assert.equal(askForCompany(p), true);
    const html = renderQuoteForm(p);
    assert.match(html, /Your company or organization <span>\(optional\)<\/span>/);
    assert.match(html, /name="company" autocomplete="organization"/);
    assert.doesNotMatch(html, /Where's the job|name="location"|name="location_town"/);
    assert.equal(count(html, /<fieldset class="qf-step" data-step="\d"/g), 4);
  }
});

await test("the company answer reaches the owner as \"Company: ...\"", () => {
  const a = cleanAnswers({ quote_form: "1", services: ["Kinase assays"], timing: "this_month", company: " Acme Bio ", contact_pref: "email" });
  assert.deepEqual(a, { services: ["Kinase assays"], timing: "this_month", location: null, preference: "email", company: "Acme Bio" });
  assert.equal(answersSummary(a), "Needs: Kinase assays · When: This month · Company: Acme Bio · Prefers: Email");
  assert.match(ownerLeadEmail({ bName: "AssayQuant", name: "Pat", email: "p@x.com", answers: a }).html, /<strong>Company:<\/strong> Acme Bio/);
  assert.match(jackLeadAlert({ bName: "AssayQuant", name: "Pat", email: "p@x.com", answers: a }).text || JSON.stringify(jackLeadAlert({ bName: "AssayQuant", name: "Pat", email: "p@x.com", answers: a })), /Company: Acme Bio/);
});

await test("step 2 timing choices are single-choice radios", () => {
  const html = renderQuoteForm(landscaper);
  for (const label of ["As soon as possible", "This week", "This month", "Just getting prices"]) assert.ok(html.includes(label), label);
  assert.equal(count(html, /type="radio" name="timing"/g), 4);
  assert.match(html, /data-step="2" data-single/);
});

await test("step 3 offers service towns as chips above one text input; none when no towns", () => {
  const html = renderQuoteForm(landscaper);
  assert.equal(count(html, /name="location_town"/g), 3);
  assert.ok(html.indexOf('name="location_town"') < html.indexOf('name="location"'));
  const bare = renderQuoteForm(plumber);
  assert.equal(count(bare, /name="location_town"/g), 0);
  assert.match(bare, /name="location"/);
  assert.deepEqual(townChoices({ service_area: ["A", "A", "", "B"] }), ["A", "B"]);
});

await test("step 4: name, phone, email (neither required in HTML), optional notes, contact preference chips", () => {
  const html = renderQuoteForm(landscaper);
  assert.match(html, /name="name"[^>]*required/);
  assert.doesNotMatch(html, /name="phone"[^>]*required/);
  assert.doesNotMatch(html, /name="email"[^>]*required/);
  assert.match(html, /<textarea[^>]*name="message"/);
  for (const v of ["text", "call", "email"]) assert.match(html, new RegExp(`name="contact_pref" value="${v}"`));
  for (const l of ["Text me", "Call me", "Email me"]) assert.ok(html.includes(l));
});

await test("step 4 falls back to the business name when there's no owner name", () => {
  assert.equal(reachName({ business_name: "Arno Plumbing" }), "Arno Plumbing");
  assert.match(renderQuoteForm(plumber), /How should Arno Plumbing reach you\?/);
});

await test("tap-to-call sits above the form; no call button without a phone", () => {
  const html = renderQuoteForm(landscaper);
  assert.ok(html.indexOf('class="qf-call" href="tel:4135550101"') > -1);
  assert.ok(html.indexOf("qf-call") < html.indexOf("<form"));
  assert.doesNotMatch(renderQuoteForm(plumber), /qf-call/);
});

await test("business text is escaped", () => {
  const html = renderQuoteForm({ ...landscaper, owner_name: "", business_name: `<b>"X"</b>`, services: [{ service_name: "<script>alert(1)</script>" }] });
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /How should &lt;b&gt;&quot;X&quot;&lt;\/b&gt; reach you/);
});

console.log("quote form: no-JS fallback");

await test("it's one plain form posting to the same endpoint, with every step and one submit", () => {
  const html = renderQuoteForm(landscaper, { returnPath: "/green-acres", trackContactClick: true });
  assert.equal(count(html, /<form/g), 1);
  assert.match(html, /<form class="quote-form" id="contactForm" action="\/api\/send-contact" method="post"/);
  assert.equal(count(html, /type="submit"/g), 1);
  assert.match(html, /<input name="website" tabindex="-1"/); // honeypot kept
  assert.match(html, /name="quote_form" value="1"/);
  assert.match(html, /name="business_id" value="b-1"/);
  assert.match(html, /name="slug" value="green-acres"/);
  assert.match(html, /name="return_path" value="\/green-acres"/);
  // Next buttons are type="button": they never submit, and CSS hides them without JS.
  assert.doesNotMatch(html, /class="qf-next"[^>]*type="submit"/);
  const css = fs.readFileSync(new URL("../public/styles/quote-form.css", import.meta.url), "utf8");
  assert.match(css, /form:not\(\.is-stepped\) \.qf-next \{ display: none; \}/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /min-height: 44px/);
});

await test("shows the thank-you or error note after a no-JS post", () => {
  assert.match(renderQuoteForm(landscaper, { status: "sent" }), /class="qf-done" role="status"/);
  assert.match(renderQuoteForm(landscaper, { status: "error" }), /class="qf-error" role="alert"[^]*tel:4135550101/);
  assert.doesNotMatch(renderQuoteForm(landscaper), /qf-done|qf-error/);
});

await test("return path is limited to this site's page paths", () => {
  assert.equal(safeReturnPath("/green-acres", "green-acres"), "/green-acres");
  assert.equal(safeReturnPath("/green-acres/snow-removal", "x"), "/green-acres/snow-removal");
  assert.equal(safeReturnPath("https://evil.example/", "green-acres"), "/green-acres");
  assert.equal(safeReturnPath("//evil.example", "green-acres"), "/green-acres");
  assert.equal(safeReturnPath("", ""), "/");
});

console.log("quote form: pages");

await test("company page template: same #contact anchor, quote form placeholder, stepper script and CSS", () => {
  const tpl = fs.readFileSync(new URL("../public/profile.html", import.meta.url), "utf8");
  const section = tpl.slice(tpl.indexOf('id="contact"'), tpl.indexOf("</section>", tpl.indexOf('id="contact"')));
  assert.ok(section.includes("{{QUOTE_FORM}}"));
  assert.doesNotMatch(tpl, /<form id="contactForm">/); // old blank form gone
  assert.match(tpl, /href="#contact"/); // quote links still land on it
  assert.match(tpl, /\/scripts\/quote-form\.js/);
  assert.match(tpl, /\/styles\/quote-form\.css/);
  const pjs = fs.readFileSync(new URL("../api/p.js", import.meta.url), "utf8");
  assert.match(pjs, /"\{\{QUOTE_FORM\}\}": renderQuoteForm\(profile/);
});

await test("spotlight page: same component, its service preselected, starts on step 2, source/subject kept", () => {
  const spot = { service_slug: "snow-removal", status: "published", content: { service_name: "Snow Removal", hero: { headline: "x", cta_label: "Get on the plow list" } } };
  const out = renderSpotlight(spot, landscaper, { baseUrl: "https://enoma.io", quoteStatus: "" });
  const html = out["{{QUOTE_FORM_HTML}}"];
  assert.match(html, /data-start-step="2"/);
  assert.match(html, /data-page-type="spotlight"/);
  assert.match(html, /name="services" value="Snow Removal" checked/);
  assert.equal(count(html, /checked/g), 1);
  assert.match(html, /name="source" value="spotlight:snow-removal"/);
  assert.match(html, /name="subject" value="Snow Removal request"/);
  assert.match(html, /name="return_path" value="\/green-acres\/snow-removal"/);
  assert.match(html, />Get on the plow list<\/button>/);
  const tpl = fs.readFileSync(new URL("../public/spotlight.html", import.meta.url), "utf8");
  assert.ok(tpl.includes("{{QUOTE_FORM_HTML}}"));
  assert.match(tpl, /\/scripts\/quote-form\.js/);
});

await test("a spotlight service missing from the services list still gets a preselected chip, first", () => {
  const html = renderQuoteForm({ ...plumber, services: [{ service_name: "Drain Cleaning" }] }, { preselect: "Water Heater Repair" });
  const chips = [...html.matchAll(/name="services" value="([^"]+)"( checked)?/g)];
  assert.equal(chips[0][1], "Water Heater Repair");
  assert.equal(chips[0][2], " checked");
});

await test("company page starts on step 1 with nothing preselected", () => {
  const html = renderQuoteForm(landscaper);
  assert.match(html, /data-start-step="1"/);
  assert.doesNotMatch(html, / checked/);
});

await test("tracking: step/submit events go through /api/track with the slug, internal flag, no personal data", () => {
  const js = fs.readFileSync(new URL("../public/scripts/quote-form.js", import.meta.url), "utf8");
  assert.match(js, /track\('quote_step_viewed', \{ step: /);
  assert.match(js, /track\('quote_step_completed', \{ step: /);
  assert.match(js, /track\('quote_submitted', \{ services_count: payload\.services\.length, timing: payload\.timing \|\| null \}\)/);
  assert.match(js, /JSON\.stringify\(\{ slug: slug, event: event, metadata: meta, internal: isInternal\(\) \|\| undefined \}\)/);
  // every track() call's metadata is one of the three shapes above
  const metas = [...js.matchAll(/track\('quote_[a-z_]+', (\{[^}]*\})/g)].map(m => m[1]);
  assert.ok(metas.length >= 4);
  for (const m of metas) assert.doesNotMatch(m, /name|email|phone|location|message/);
  // the company page's old form logged contact_click on submit; still does
  assert.match(js, /trackContactClick\('contact_form'\)/);
});

console.log("quote form: answers and lead emails");

await test("cleanAnswers reads the JSON payload and the no-JS form post alike", () => {
  assert.deepEqual(cleanAnswers({ quote_form: "1", services: ["Spring cleanup", "Mulching"], timing: "this_week", location: " Agawam ", contact_pref: "text" }), SAMPLE);
  // urlencoded: one checkbox arrives as a string; a tapped town but empty text box
  assert.deepEqual(cleanAnswers({ quote_form: "1", services: "Mulching", timing: "asap", location: "", location_town: "Agawam" }),
    { services: ["Mulching"], timing: "asap", location: "Agawam", preference: null });
  // made-up values are dropped
  assert.deepEqual(cleanAnswers({ quote_form: "1", timing: "yesterday", contact_pref: "fax" }), { services: [], timing: null, location: null, preference: null });
  // old-style submissions carry no answers at all
  assert.equal(cleanAnswers({ name: "A", email: "a@b.co", message: "hi" }), null);
});

await test("summary line is labelled and in order", () => {
  assert.equal(answersSummary(SAMPLE), SAMPLE_LINE);
  assert.equal(answersSummary({ services: [], timing: "just_prices", location: null, preference: null }), "When: Just getting prices");
  assert.equal(answersSummary(null), "");
  assert.equal(answersEmailHtml(null), "");
});

await test("lead row stores the answers; phone-only leads fit the NOT NULL email/message columns", () => {
  const row = leadRow({ businessId: "b-1", slug: "green-acres", name: "Dana", email: "", phone: "4135550199", message: "", answers: SAMPLE });
  assert.deepEqual(row.answers, SAMPLE);
  assert.equal(row.email, "");
  assert.equal(row.message, SAMPLE_LINE);
  assert.equal(row.source, "profile_page");
  const old = leadRow({ businessId: "b-1", slug: "green-acres", name: "Dana", email: "d@x.co", phone: "", message: "Hi", source: undefined, answers: null });
  assert.deepEqual(old, { business_id: "b-1", slug: "green-acres", name: "Dana", email: "d@x.co", phone: null, subject: null, message: "Hi", source: "profile_page", is_read: false });
});

await test("owner email has the labelled summary at the top; Jack's alert has the summary line", () => {
  const owner = ownerLeadEmail({ bName: "Green Acres Landscaping", name: "Dana", email: "dana@example.com", phone: "4135550199", message: "Back gate is locked", answers: SAMPLE });
  assert.ok(owner.html.indexOf("Quote request") < owner.html.indexOf(">From<"));
  assert.match(owner.html, /<strong>Needs:<\/strong> Spring cleanup, Mulching &middot; <strong>When:<\/strong> This week &middot; <strong>Where:<\/strong> Agawam &middot; <strong>Prefers:<\/strong> Text/);
  assert.match(owner.html, /Back gate is locked/);
  assert.equal(owner.replyTo, "dana@example.com");
  const jack = jackLeadAlert({ bName: "Green Acres Landscaping", name: "Dana", email: "dana@example.com", phone: "4135550199", message: "", answers: SAMPLE });
  assert.ok(jack.html.startsWith(`<p><b>${SAMPLE_LINE}</b></p>`));
  assert.match(jack.html, /\(dana@example\.com · 4135550199\)/);
});

await test("phone-only lead: owner email offers a call button, no empty email row", () => {
  const owner = ownerLeadEmail({ bName: "Arno Plumbing", name: "Dana", email: "", phone: "(413) 555-0199", message: "", answers: SAMPLE });
  assert.equal(owner.replyTo, undefined);
  assert.doesNotMatch(owner.html, />Email</);
  assert.match(owner.html, /href="tel:4135550199"[^>]*>Call Dana at \(413\) 555-0199/);
});

await test("old-style lead: emails unchanged (no summary block, email-only contact in Jack's alert)", () => {
  const owner = ownerLeadEmail({ bName: "B", name: "A", email: "a@b.co", phone: "", subject: "", message: "hello", answers: null });
  assert.doesNotMatch(owner.html, /Quote request/);
  assert.equal(owner.subject, "New message from A via your Enoma page");
  assert.match(owner.html, /mailto:a@b\.co\?subject=Re: Your enquiry to B/);
  const jack = jackLeadAlert({ bName: "B", name: "A", email: "a@b.co", phone: "555", message: "hello", answers: null });
  assert.equal(jack.html, "<p><b>A</b> (a@b.co) sent a message to <b>B</b> via their Enoma page.</p><p>hello</p>");
  assert.equal(jack.subject, "[Lead] A contacted B");
});

await test("visitor text in answers is escaped in emails", () => {
  const evil = { services: ["<img src=x>"], timing: null, location: "<a href=//x>", preference: null };
  const owner = ownerLeadEmail({ bName: "B", name: "A", email: "a@b.co", message: "", answers: evil });
  const jack = jackLeadAlert({ bName: "B", name: "A", email: "a@b.co", message: "", answers: evil });
  for (const h of [owner.html, jack.html]) { assert.doesNotMatch(h, /<img src=x>|<a href=\/\/x>/); }
});

console.log("quote form: /api/send-contact handler (fetch stubbed)");

process.env.SUPABASE_URL = "https://stub.supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "stub-key";
process.env.RESEND_API_KEY = "re_stub";
const calls = [];
let insertError = null;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input?.url || input);
  const method = (init.method || "GET").toUpperCase();
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ url, method, body });
  const json = (obj, status = 200, headers = {}) => new Response(obj == null ? null : JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...headers } });
  if (url.includes("api.resend.com")) return json({ id: "email_1" });
  if (url.includes("/rest/v1/contact_submissions") && method === "HEAD") return new Response(null, { status: 200, headers: { "content-range": "*/0" } });
  if (url.includes("/rest/v1/contact_submissions") && method === "POST") {
    if (insertError && body && !Array.isArray(body) && "answers" in body) return json({ message: insertError, code: "PGRST204" }, 400);
    return new Response(null, { status: 201 });
  }
  if (url.includes("/rest/v1/small_business_profiles")) {
    return json({ email: "owner@greenacres.test", business_name: "Green Acres Landscaping", business_id: "b-1", username: "green-acres" });
  }
  return json({}, 404);
};
const { default: handler } = await import("../api/send-contact.js");

function fakeRes() {
  const r = { statusCode: 200, body: null, location: null };
  r.status = c => { r.statusCode = c; return r; };
  r.json = b => { r.body = b; return r; };
  r.redirect = (c, loc) => { r.statusCode = c; r.location = loc; return r; };
  return r;
}
const post = (body, contentType = "application/json") => {
  const res = fakeRes();
  return handler({ method: "POST", headers: { "content-type": contentType }, body }, res).then(() => res);
};
const inserted = () => calls.filter(c => c.method === "POST" && c.url.includes("/rest/v1/contact_submissions")).map(c => c.body).at(-1);
const emails = () => calls.filter(c => c.url.includes("api.resend.com")).map(c => c.body);

// The payload public/scripts/quote-form.js sends (FormData + services array + location).
const jsPayload = {
  website: "", quote_form: "1", business_id: "b-1", slug: "green-acres",
  services: ["Spring cleanup", "Mulching"], timing: "this_week", location: "Agawam",
  name: "Dana Smith", phone: "(413) 555-0199", email: "", contact_pref: "text", message: "",
};

await test("stepped form submission: answers stored, owner email and Jack alert carry the summary", async () => {
  calls.length = 0;
  const res = await post(jsPayload);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  const row = inserted();
  assert.deepEqual(row.answers, SAMPLE);
  assert.equal(row.email, "");
  assert.equal(row.phone, "(413) 555-0199");
  assert.equal(row.source, "profile_page");
  const [owner, jack] = emails();
  assert.equal(owner.to, "owner@greenacres.test");
  assert.match(owner.html, /<strong>Needs:<\/strong> Spring cleanup, Mulching/);
  assert.equal(jack.to, "jack@enoma.io");
  assert.ok(jack.html.includes(SAMPLE_LINE));
});

await test("quote form needs a name and a phone OR an email", async () => {
  calls.length = 0;
  const res = await post({ ...jsPayload, phone: "", email: "" });
  assert.equal(res.statusCode, 400);
  assert.equal(inserted(), undefined);
  assert.equal((await post({ ...jsPayload, phone: "", email: "dana@example.com" })).statusCode, 200);
});

await test("no-JS form post (urlencoded) is stored the same way and redirects back to the page", async () => {
  calls.length = 0;
  const res = await post({ ...jsPayload, services: "Mulching", location: "", location_town: "Agawam", return_path: "/green-acres" }, "application/x-www-form-urlencoded");
  assert.equal(res.statusCode, 303);
  assert.equal(res.location, "/green-acres?sent=1#contact");
  assert.deepEqual(inserted().answers.services, ["Mulching"]);
  assert.equal(inserted().answers.location, "Agawam");
  const bad = await post({ ...jsPayload, name: "", source: "spotlight:snow-removal", return_path: "/green-acres/snow-removal" }, "application/x-www-form-urlencoded");
  assert.equal(bad.location, "/green-acres/snow-removal?sent=0#request");
  const offsite = await post({ ...jsPayload, return_path: "https://evil.example" }, "application/x-www-form-urlencoded");
  assert.equal(offsite.location, "/green-acres?sent=1#contact");
});

await test("honeypot still swallows bots (JSON and no-JS)", async () => {
  calls.length = 0;
  assert.deepEqual((await post({ ...jsPayload, website: "spam.example" })).body, { ok: true });
  assert.equal((await post({ ...jsPayload, website: "spam.example" }, "application/x-www-form-urlencoded")).statusCode, 303);
  assert.equal(inserted(), undefined);
  assert.equal(emails().length, 0);
});

await test("before the answers column exists, the lead is still stored (without answers)", async () => {
  calls.length = 0;
  insertError = "Could not find the 'answers' column of 'contact_submissions' in the schema cache";
  const res = await post(jsPayload);
  insertError = null;
  assert.equal(res.statusCode, 200);
  const posts = calls.filter(c => c.method === "POST" && c.url.includes("/rest/v1/contact_submissions"));
  assert.equal(posts.length, 2);
  assert.equal("answers" in posts[1].body, false);
  assert.equal(emails().length, 2);
});

await test("old-style submission (cached pages): same validation and same row as before", async () => {
  calls.length = 0;
  assert.equal((await post({ name: "A", email: "a@b.co", phone: "", business_id: "b-1", slug: "green-acres" })).statusCode, 400);
  const res = await post({ name: "A", email: "a@b.co", phone: "", message: "hi", business_id: "b-1", slug: "green-acres" });
  assert.equal(res.statusCode, 200);
  assert.equal("answers" in inserted(), false);
  assert.equal(emails().at(-1).html, "<p><b>A</b> (a@b.co) sent a message to <b>Green Acres Landscaping</b> via their Enoma page.</p><p>hi</p>");
});

console.log(`\n${passed} passed`);
