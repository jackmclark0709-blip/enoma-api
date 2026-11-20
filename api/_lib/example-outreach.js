// The "example" outreach arm (api/_lib/example-pages.js outreachArmFor): the
// cold email shows a per-trade example page and offers to build the
// prospect's own page, which is only built when they click (api/ga-metrics.js
// action=build_page). Same rules as outreach-email.js: deterministic copy,
// every link through our own tracked redirect (action=go), one ask.
import { escapeHtml, plainTextToHtml } from "./email-html.js";
import { cleanBusinessName, siteProblemLine } from "./outreach-email.js";
import { exampleForTrade, exampleUrl } from "./example-pages.js";

const BASE = "https://enoma.io";

export const EXAMPLE_VARIANT = "example";

export function exampleLinks(messageId) {
  const go = (to) => `${BASE}/api/ga-metrics?action=go&m=${encodeURIComponent(messageId)}&to=${to}`;
  return {
    build: go("build"),
    example: go("example"),
    // Where action=go sends a build click.
    buildDest: `${BASE}/api/ga-metrics?action=build_page&m=${encodeURIComponent(messageId)}`,
  };
}

const ASK = `Seeing your page is free, no card. If you want to keep it, going live is $1 for your first month, then $39/month or $390/year. Cancel anytime, no contract. If it's not for you, reply "no" and I won't email again.`;
const SIGNOFF_TEXT = "Jack Clark\nEnoma · jack@enoma.io";

/**
 * Subject and intro for the example arm, saved as the prospect's draft at
 * prepare time (so Jack can read or edit it like any other draft).
 */
export function buildExampleIntro(prospect = {}) {
  const name = cleanBusinessName(prospect.business_name) || "your business";
  const entry = exampleForTrade(prospect.trade || prospect.raw?.type);
  const noun = entry?.noun || "local business";
  const problem = siteProblemLine(prospect);
  const lines = ["Hi there,"];
  if (problem) lines.push(problem);
  lines.push(`I build websites for local businesses from their Google reviews. Here's one I made for a ${noun}, so you can see what I mean (it's a sample business):`);
  return { subject: `What a website for ${name} could look like`, body: lines.join("\n\n") };
}

const footerHtml = (mailingAddress, unsubscribeUrl) =>
  `<p style="margin:0;font-size:12px;color:#888888;border-top:1px solid #eeeeee;padding-top:12px;">${escapeHtml(mailingAddress)}<br><a href="${escapeHtml(unsubscribeUrl)}" style="color:#888888;">Unsubscribe</a></p>`;
const wrap = inner => `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#ffffff;">
<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#222222;max-width:560px;margin:0 auto;padding:24px 16px;">
${inner}
</div>
</body>
</html>`;
const boldYesNo = s => escapeHtml(s).replace(/&quot;no&quot;/, "<strong>no</strong>");

/** The first email: intro, the example link, the build link, the ask. */
export function buildExampleEmail({ intro, businessName, trade, messageId, unsubscribeUrl, mailingAddress }) {
  const links = exampleLinks(messageId);
  const entry = exampleForTrade(trade);
  const name = cleanBusinessName(businessName) || "your business";
  const exLabel = `Example ${entry?.noun || "business"} page`;
  const buildLine = `I can build one for ${name} the same way, from your own reviews, services and towns. It takes about a minute:`;
  const buildLabel = `Build ${name}'s page`;
  const text = [
    String(intro || "").trim(),
    `${exLabel}: ${links.example}`,
    `${buildLine} ${links.build}`,
    ASK,
    SIGNOFF_TEXT,
    `---\n${mailingAddress}\nDon't want these emails? ${unsubscribeUrl}`,
  ].join("\n\n");
  const html = wrap(`${plainTextToHtml(String(intro || "").trim())}
<p style="margin:0 0 16px;"><a href="${links.example}" style="color:#1a73e8;">${escapeHtml(exLabel)}</a></p>
<p style="margin:0 0 16px;">${escapeHtml(buildLine)} <a href="${links.build}" style="color:#1a73e8;font-weight:bold;">${escapeHtml(buildLabel)}</a></p>
<p style="margin:0 0 16px;">${boldYesNo(ASK)}</p>
<p style="margin:0 0 24px;">Jack Clark<br>Enoma &middot; jack@enoma.io</p>
${footerHtml(mailingAddress, unsubscribeUrl)}`);
  return { text, html, links, exampleUrl: exampleUrl(entry) };
}

/** First follow-up while their page hasn't been built yet. */
export function buildExampleFollowUpEmail({ businessName, trade, originalSubject, messageId, unsubscribeUrl, mailingAddress }) {
  const links = exampleLinks(messageId);
  const entry = exampleForTrade(trade);
  const name = cleanBusinessName(businessName) || "your business";
  const subject = `Re: ${String(originalSubject || `What a website for ${name} could look like`).replace(/^\s*re:\s*/i, "")}`;
  const p1 = `Following up: I can still build ${name} a page from your Google reviews, like this example ${entry?.noun ? `${entry.noun} page` : "page"}:`;
  const p2 = `It takes about a minute:`;
  const p3 = `If it's not for you, reply "no" and I won't email again.`;
  const text = ["Hi there,", `${p1} ${links.example}`, `${p2} ${links.build}`, p3, "Jack",
    `---\n${mailingAddress}\nDon't want these emails? ${unsubscribeUrl}`].join("\n\n");
  const html = wrap(`<p style="margin:0 0 16px;">Hi there,</p>
<p style="margin:0 0 16px;">${escapeHtml(p1)} <a href="${links.example}" style="color:#1a73e8;">see the example</a></p>
<p style="margin:0 0 16px;">${escapeHtml(p2)} <a href="${links.build}" style="color:#1a73e8;font-weight:bold;">Build ${escapeHtml(name)}'s page</a></p>
<p style="margin:0 0 16px;">${boldYesNo(p3)}</p>
<p style="margin:0 0 24px;">Jack</p>
${footerHtml(mailingAddress, unsubscribeUrl)}`);
  return { subject, text, html, links };
}

/** Second (last) follow-up while their page hasn't been built yet. */
export function buildExampleSecondFollowUpEmail({ businessName, originalSubject, messageId, unsubscribeUrl, mailingAddress }) {
  const links = exampleLinks(messageId);
  const name = cleanBusinessName(businessName) || "your business";
  const subject = `Re: ${String(originalSubject || `What a website for ${name} could look like`).replace(/^\s*re:\s*/i, "")}`;
  const p1 = `Last note from me: if you'd like to see a page for ${name}, built from your Google reviews, it's one click:`;
  const p2 = `$1 for your first month if you keep it, then $39/month or $390/year. Cancel anytime. If now's not the time, no problem, I won't email again.`;
  const text = ["Hi there,", `${p1} ${links.build}`, p2, "Jack",
    `---\n${mailingAddress}\nDon't want these emails? ${unsubscribeUrl}`].join("\n\n");
  const html = wrap(`<p style="margin:0 0 16px;">Hi there,</p>
<p style="margin:0 0 16px;">${escapeHtml(p1)} <a href="${links.build}" style="color:#1a73e8;font-weight:bold;">Build ${escapeHtml(name)}'s page</a></p>
<p style="margin:0 0 16px;">${escapeHtml(p2)}</p>
<p style="margin:0 0 24px;">Jack</p>
${footerHtml(mailingAddress, unsubscribeUrl)}`);
  return { subject, text, html, links };
}

/**
 * The page someone lands on after clicking "Build my page". It always shows
 * a "Build my page" button. With autoStart (the click was classed human) the
 * build also starts on the first sign of a person: a touch, a mouse move, a
 * scroll or a key. Mail scanners that run scripts do none of those, so they
 * never start a build. Then it polls action=build_status until the page is
 * ready and goes there.
 */
export function buildPageHtml({ messageId, businessName, autoStart, exampleHref = null }) {
  const name = escapeHtml(cleanBusinessName(businessName) || "your business");
  const m = encodeURIComponent(messageId);
  const ex = exampleHref ? `<p class="s">While you wait, <a href="${escapeHtml(exampleHref)}">see the example page</a>.</p>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Building ${name}'s page</title>
<style>body{margin:0;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#f4f7fb;color:#0f2340;display:flex;align-items:center;justify-content:center;min-height:92vh;padding:24px}
.c{background:#fff;border:1px solid #dbe4f0;border-radius:16px;padding:32px 28px;max-width:440px;text-align:center;box-shadow:0 6px 24px rgba(15,35,64,.08)}
h1{font-size:22px;margin:0 0 10px}p{margin:0 0 12px;line-height:1.5}.s{font-size:14px;color:#4b5d78}
.sp{width:44px;height:44px;border:4px solid #dbe4f0;border-top-color:#1a73e8;border-radius:50%;margin:8px auto 18px;animation:r 1s linear infinite}@keyframes r{to{transform:rotate(360deg)}}
button{font:inherit;font-weight:700;padding:13px 22px;border-radius:10px;border:0;background:#1a73e8;color:#fff;cursor:pointer}.h{display:none}</style></head>
<body><div class="c">
<div id="go"><h1>See ${name}'s page</h1><p>We'll build it from your Google listing: your name, services, reviews and towns. It takes about a minute.</p><button id="b" type="button">Build my page</button></div>
<div id="wait" class="h"><div class="sp"></div><h1>Building ${name}'s page…</h1><p>Pulling in your Google reviews, services and towns. This takes about a minute. Keep this tab open.</p>${ex}</div>
<div id="err" class="h"><h1>Almost there</h1><p id="em">We couldn't finish it automatically. Jack has been told and will send you the link himself shortly.</p></div>
</div>
<script>(function(){
var m="${m}",t0=0,started=false;
function show(id){["go","wait","err"].forEach(function(x){document.getElementById(x).className=x===id?"":"h"})}
function fail(msg){if(msg)document.getElementById("em").textContent=msg;show("err")}
function poll(){fetch("/api/ga-metrics?action=build_status&m="+m,{cache:"no-store"}).then(function(r){return r.json()}).then(function(j){
if(j.url){location.replace(j.url);return}
if(j.error){fail(j.message);return}
if(Date.now()-t0>180000){fail();return}
setTimeout(poll,3000)}).catch(function(){setTimeout(poll,5000)})}
function start(){if(started)return;started=true;show("wait");t0=Date.now();
fetch("/api/ga-metrics?action=build_start&m="+m,{method:"POST"}).then(function(r){return r.json()}).then(function(j){
if(j.url){location.replace(j.url);return}
if(!j.ok){fail(j.message);return}
poll()}).catch(function(){poll()})}
document.getElementById("b").addEventListener("click",start);
${autoStart ? `["pointermove","touchstart","scroll","keydown","wheel"].forEach(function(ev){window.addEventListener(ev,start,{once:true,passive:true})});` : ""}
})();</script></body></html>`;
}
