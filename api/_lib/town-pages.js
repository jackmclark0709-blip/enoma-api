// api/_lib/town-pages.js
// "Website for <trade> in <town>" landing pages, one per trade + town where
// Enoma's own prospect research found 5+ businesses. Each page leads with that
// town's real numbers (how many businesses we found on Google Maps, how many
// had no website, how many had a weak one), so no two pages say the same thing.
// Pure: data in, HTML out. scripts/build-town-pages.mjs writes the files.

export const TRADES = {
  "landscaping": {
    slug: "landscapers", plural: "landscapers", one: "landscaper", business: "landscaping business",
    searches: ["landscaper near me", "lawn care {town}", "fall cleanup {town}", "snow removal {town}"],
    jobs: "cleanups, mowing contracts, hardscape quotes and snow removal",
  },
  "plumber": {
    slug: "plumbers", plural: "plumbers", one: "plumber", business: "plumbing business",
    searches: ["plumber near me", "emergency plumber {town}", "water heater replacement {town}", "drain cleaning {town}"],
    jobs: "emergency calls, water heaters, drain cleaning and remodels",
  },
  "hvac contractor": {
    slug: "hvac-contractors", plural: "HVAC contractors", one: "HVAC contractor", business: "HVAC business",
    searches: ["furnace repair near me", "heat pump install {town}", "AC repair {town}", "boiler service {town}"],
    jobs: "no-heat calls, heat pump installs, tune-ups and service plans",
  },
  "electrician": {
    slug: "electricians", plural: "electricians", one: "electrician", business: "electrical business",
    searches: ["electrician near me", "panel upgrade {town}", "EV charger install {town}", "generator install {town}"],
    jobs: "panel upgrades, EV chargers, generators and service calls",
  },
  "house cleaning service": {
    slug: "house-cleaners", plural: "house cleaning businesses", one: "house cleaner", business: "cleaning business",
    searches: ["house cleaning near me", "deep cleaning {town}", "move-out cleaning {town}", "weekly cleaning service {town}"],
    jobs: "deep cleans, move-outs and recurring weekly clients",
  },
  "painting contractor": {
    slug: "painters", plural: "painters", one: "painter", business: "painting business",
    searches: ["house painter near me", "interior painting {town}", "exterior painting {town}", "cabinet painting {town}"],
    jobs: "interior rooms, exteriors, cabinets and estimate requests",
  },
  "roofing contractor": {
    slug: "roofers", plural: "roofers", one: "roofer", business: "roofing business",
    searches: ["roofer near me", "roof repair {town}", "roof replacement {town}", "leak repair {town}"],
    jobs: "leak repairs, replacements and storm-damage calls",
  },
  "general contractor": {
    slug: "general-contractors", plural: "general contractors", one: "general contractor", business: "contracting business",
    searches: ["general contractor near me", "kitchen remodel {town}", "home addition {town}", "bathroom remodel {town}"],
    jobs: "remodels, additions and estimate requests",
  },
};

const STATE_NAMES = { MA: "Massachusetts", RI: "Rhode Island", CT: "Connecticut", NH: "New Hampshire" };

export function slugifyTown(city) {
  return String(city).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export function pageSlug({ trade, city, st }) {
  const t = TRADES[trade];
  if (!t) throw new Error(`unknown trade: ${trade}`);
  return `website-for-${t.slug}-${slugifyTown(city)}-${String(st).toLowerCase()}`;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const NUM = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const word = n => (n < 10 ? NUM[n] : String(n));
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

/** The local findings, as sentences. Only states what the numbers support. */
export function localFindings(p, asOfLabel) {
  const t = TRADES[p.trade];
  const lines = [];
  lines.push(`In ${asOfLabel} we looked at ${p.n} ${t.plural} in ${p.city} on Google Maps.`);
  if (p.noSite > 0) {
    lines.push(`${cap(word(p.noSite))} of them had no website at all, so a homeowner who finds them on Google has nowhere to go but a phone number.`);
  }
  if (p.weakSite > 0) {
    lines.push(`At least ${word(p.weakSite)} more had a website missing two or more basics: a layout that works on a phone, a tap-to-call button, a quote form, or a secure (HTTPS) address.`);
  }
  if (p.noSite === 0 && p.weakSite === 0) {
    lines.push(`Most of them already have a website, so the ${t.one} who gets the call is usually the one whose page makes it easiest to ask for a quote.`);
  }
  if (p.avgRating >= 4.3) {
    lines.push(`Their average Google rating was ${p.avgRating.toFixed(1)} stars. Reputation isn't what's holding ${p.city} ${t.plural} back; being easy to find and contact is.`);
  }
  return lines;
}

/** Up to 5 other towns with a page for the same trade, nearest-first by list order. */
export function siblings(p, pairs) {
  return pairs.filter(o => o.trade === p.trade && !(o.city === p.city && o.st === p.st)).slice(0, 5);
}

export function renderTownPage(p, { pairs, asOf, asOfLabel }) {
  const t = TRADES[p.trade];
  const slug = pageSlug(p);
  const url = `https://enoma.io/for/${slug}`;
  const town = `${p.city}, ${p.st}`;
  const title = `Website for ${cap(t.plural)} in ${town} | Enoma`;
  const desc = `Get your ${p.city} ${t.business} found on Google. We found ${p.n} ${t.plural} in ${p.city}; ${p.noSite + p.weakSite > 0 ? `${p.noSite + p.weakSite} had no website or a weak one. ` : ""}$1 for your first month, then $19.99/month or $199/year. Cancel anytime.`;
  const findings = localFindings(p, asOfLabel);
  const searches = t.searches.map(s => s.replace("{town}", p.city));
  const sibs = siblings(p, pairs);
  const schema = {
    "@context": "https://schema.org", "@type": "Service",
    name: `Websites for ${t.plural} in ${town}`,
    provider: { "@type": "Organization", name: "Enoma", url: "https://enoma.io" },
    areaServed: { "@type": "City", name: p.city, containedInPlace: { "@type": "State", name: STATE_NAMES[p.st] || p.st } },
    offers: { "@type": "Offer", price: "19.99", priceCurrency: "USD", description: "$1 for your first month, then $19.99/month or $199/year. Cancel anytime. Includes personalized support." },
    url,
  };
  const faq = {
    "@context": "https://schema.org", "@type": "FAQPage",
    mainEntity: [
      { "@type": "Question", name: `What does a website for a ${p.city} ${t.one} cost with Enoma?`,
        acceptedAnswer: { "@type": "Answer", text: "Seeing your page is free, with no card. To go live: $1 for your first month, then $19.99/month or $199/year. Cancel anytime. That includes personalized support, and there's no contract." } },
      { "@type": "Question", name: `Will it show up when someone in ${p.city} searches?`,
        acceptedAnswer: { "@type": "Answer", text: `Nobody can honestly promise a ranking. Your page is built the way Google reads local businesses: your trade, ${p.city} and the towns you serve, your services and your number, and it's added to the sitemap Google crawls the day it goes live.` } },
      { "@type": "Question", name: "Do I have to build it myself?",
        acceptedAnswer: { "@type": "Answer", text: "Type in your business name and see your page in about 30 seconds. Not on Google yet, or your info is out of date? I'll build it with you. Either way, changes are made for you when you ask." } },
    ],
  };
  const sibLinks = sibs.map(o => `<a class="tp-chip" href="/for/${pageSlug(o)}">${esc(o.city)}, ${esc(o.st)}</a>`).join("\n        ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}" />
  <link rel="canonical" href="${url}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Enoma" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(desc)}" />
  <meta property="og:url" content="${url}" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700;9..144,800&family=Instrument+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
  <link rel="stylesheet" href="/styles/enoma.css">
  <link rel="icon" href="/brand/favicon.ico" sizes="any">
  <link rel="icon" href="/brand/favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/brand/apple-touch-icon.png">
  <link rel="manifest" href="/site.webmanifest">
  <meta name="theme-color" content="#0A1628">
  <meta property="og:image" content="https://enoma.io/brand/og-image.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="https://enoma.io/brand/og-image.png">
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-S8XTG72Y2Y"></script>
  <script src="/scripts/clarity.js" defer></script>
  <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());function enomaGaConfig(c){try{var m=location.search.match(/[?&]internal=([01])(?:&|$)/);if(m)localStorage.setItem('enoma_internal',m[1]);if(localStorage.getItem('enoma_internal')==='1')c.traffic_type='internal'}catch(e){}try{if(/(?:^|; )enoma_internal=1(?:;|$)/.test(document.cookie))c.traffic_type='internal'}catch(e){}if(navigator.webdriver)window['ga-disable-G-S8XTG72Y2Y']=true;return c};gtag('config','G-S8XTG72Y2Y',enomaGaConfig({}));</script>
  <script type="application/ld+json">${JSON.stringify(schema)}</script>
  <script type="application/ld+json">${JSON.stringify(faq)}</script>
</head>
<body class="page-guide page-town">
<script src="/scripts/ref-capture.js"></script>
<script type="module" src="/partials/nav.js"></script>

<section class="tp-hero">
  <div class="tp-wrap">
    <p class="tp-eyebrow">For ${esc(t.plural)} in ${esc(town)}</p>
    <h1>A website that gets ${esc(p.city)} homeowners <em>calling you</em></h1>
    <p>A one-page site for your ${esc(t.business)}, built for one job: turning a local Google search into a call or a quote request. Type in your business name and see your page in about 30 seconds. Not on Google yet, or your info is out of date? I'll build it with you.</p>
    <div class="tp-actions">
      <a href="/get-your-website" class="btn btn--primary">See your page in 30 seconds →</a>
      <a href="/get-your-website" class="btn btn--on-dark">Have us set it up</a>
    </div>
    <p class="tp-proof">Free preview, no card &nbsp;·&nbsp; $1 for your first month, then $19.99/month or $199/year. Cancel anytime.</p>
  </div>
</section>

<section class="tp-sec tp-sec--white">
  <div class="tp-wrap">
    <p class="tp-label">${esc(p.city)} by the numbers</p>
    <h2>How ${esc(p.city)} ${esc(t.plural)} show up online</h2>
    <div class="tp-stats">
      <div class="tp-stat"><b>${p.n}</b><span>${esc(t.plural)} we found on Google Maps</span></div>${p.noSite > 0 ? `
      <div class="tp-stat"><b>${p.noSite}</b><span>with no website at all</span></div>` : ""}${p.weakSite > 0 ? `
      <div class="tp-stat"><b>${p.weakSite}+</b><span>with a website missing basics</span></div>` : ""}${p.avgRating ? `
      <div class="tp-stat"><b>${p.avgRating.toFixed(1)}★</b><span>average Google rating</span></div>` : ""}
    </div>
${findings.map(l => `    <p>${esc(l)}</p>`).join("\n")}
    <p class="tp-source">Source: Enoma's review of Google Maps listings and the websites they link to, ${esc(asOfLabel)}. "Missing basics" means a site failed at least two checks: phone-friendly layout, tap-to-call, a contact form, HTTPS.</p>
  </div>
</section>

<section class="tp-sec">
  <div class="tp-wrap">
    <p class="tp-label">What your page does</p>
    <h2>Built for the searches ${esc(p.city)} homeowners make</h2>
    <p>People looking for a ${esc(t.one)} type things like:</p>
    <ul class="tp-list">
${searches.map(s => `      <li>"${esc(s)}"</li>`).join("\n")}
    </ul>
    <p>Your Enoma page names your trade, ${esc(p.city)} and the towns you serve, your services and your number, the way Google reads a local business. Visitors get a tap-to-call button and a quote form, so ${esc(t.jobs)} come straight to you, with no directory showing your competitors next to you.</p>
  </div>
</section>

<section class="tp-sec tp-sec--white">
  <div class="tp-wrap tp-faq">
    <p class="tp-label">Questions</p>
    <h2>What ${esc(p.city)} ${esc(t.plural)} ask us</h2>
${faq.mainEntity.map(q => `    <h3>${esc(q.name)}</h3>\n    <p>${esc(q.acceptedAnswer.text)}</p>`).join("\n")}
  </div>
</section>
${sibs.length ? `
<section class="tp-sec">
  <div class="tp-wrap">
    <p class="tp-label">Nearby</p>
    <h2>${esc(cap(t.plural))} in other towns</h2>
    <div>
        ${sibLinks}
    </div>
  </div>
</section>
` : ""}
<section class="tp-cta">
  <div class="tp-wrap">
    <h2>Get your ${esc(p.city)} ${esc(t.business)} found</h2>
    <p>Your page can be live today. If it isn't bringing in calls after your $1 first month, walk away. No contract.</p>
    <div class="tp-actions">
      <a href="/get-your-website" class="btn btn--primary">See your page in 30 seconds →</a>
      <a href="/examples" class="btn btn--on-dark">See live examples</a>
    </div>
  </div>
</section>

<div id="footer"></div>
<script>fetch('/partials/footer.html').then(r=>r.text()).then(html=>{document.getElementById('footer').innerHTML=html});</script>
<script src="/scripts/global-cta.js" defer></script>
<script src="/scripts/cta-track.js" defer></script>
</body>
</html>
`;
}
