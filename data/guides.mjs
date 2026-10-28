// Owner-intent guides published under /for/<slug>.
// Rendered to static HTML by scripts/build-guides.mjs, which keeps the layout,
// CTA wording, tracking attributes and FAQ schema identical across every guide.
// To add a guide: append an entry here, run `node scripts/build-guides.mjs`,
// and commit the generated public/for/<slug>.html.
//
// Writing rules (keep these so the guides stay useful, not scaled filler):
//  - Answer the searcher's actual question first; Enoma comes in once, where it fits.
//  - Position Enoma as a way to get calls and quote requests, not "a free website".
//  - No invented statistics. The only numbers we cite are Conway's real results
//    and Enoma's own pricing.
//  - Every FAQ answer must stand alone (it's what AI answer engines quote).

export const GUIDES = [
  {
    slug: "why-isnt-my-business-showing-up-on-google",
    published: "2026-10-28",
    title: "Why Isn't My Business Showing Up on Google? 7 Fixes | Enoma",
    description: "Search your trade and town and you're nowhere? Here are the 7 most common reasons a local service business doesn't show up on Google, and how to fix each one.",
    eyebrow: "Guide for local service business owners",
    h1: "Why isn't my business<br><em>showing up on Google?</em>",
    heroSub: "You searched your trade and your town and found everyone but you. It's almost always one of seven fixable things. Here's how to find which one, and fix it this week.",
    article: `
<h2>First, check how you're searching</h2>
<p>Before you fix anything, make sure you're seeing what customers see. Google personalizes results, and searching your own business name proves very little: of course it shows up for its own name. Customers don't search your name. They search the job.</p>
<ul>
  <li>Open a private/incognito window, or use your phone with location on.</li>
  <li>Search the way a customer would: <strong>"[your service] near me"</strong> and <strong>"[your service] [your town]"</strong>. For example, "gutter cleaning near me" or "electrician Taunton MA".</li>
  <li>Check both the map results (the box with three businesses) and the regular results below it. They're ranked differently.</li>
</ul>
<p>If you show up for your name but not for the job, the problem is relevance and trust. If you don't show up for your own name, the problem is usually your Google Business Profile itself.</p>

<h2>1. You don't have a verified Google Business Profile</h2>
<p>Your Business Profile is the listing that appears in the map results, and for many local service businesses it's the biggest single source of calls. If you never created one, or created one but never finished verification, you won't appear in the map results at all. Search for "Google Business Profile", sign in, and either claim your existing listing (Google often creates one automatically) or create a new one. Then finish verification. Nothing else on this list matters much until that's done.</p>

<h2>2. Your profile is suspended or duplicated</h2>
<p>Profiles get suspended for things like keyword-stuffed business names ("Joe's Plumbing Best Plumber Boston"), a virtual-office address, or edits that look suspicious. Duplicates happen when a listing was created twice, which splits your reviews and confuses Google. If you're signed in and see a suspension notice, follow Google's reinstatement steps and keep your business name exactly as it appears on your truck and invoices.</p>

<h2>3. Your categories don't match what people search</h2>
<p>Your primary category is one of the strongest signals for which searches you show up in. A landscaper whose primary category is "Contractor" will struggle to show up for "landscaper near me". Pick the most specific primary category that describes your main work, then add secondary categories for other services you really do.</p>

<h2>4. Google doesn't know which towns you cover</h2>
<p>Service-area businesses can hide their address and list the towns they serve instead. If your service area is blank or only lists your home town, you're unlikely to appear for searches a few towns over. List the towns you actually want work in. Then make sure your website names them too, in plain words, so Google and customers see the same thing.</p>

<h2>5. There's no website behind the listing</h2>
<p>A profile with no website, or a link to a Facebook page, gives Google very little to work with. Google reads your website to understand what you do and where. A simple page that lists each service, each town and your phone number helps you show up for more searches, and it gives customers a reason to call you instead of the next listing.</p>
<div class="lp-callout">That's what an Enoma page is built for: your services, your towns, a tap-to-call button and a quote form that sends requests straight to you. <a href="/get-your-website" data-cta="inline">See yours in 30 seconds</a>, built from your Google listing.</div>

<h2>6. You have few or no recent reviews</h2>
<p>Review count, rating and how recent your reviews are all affect where you rank in the map results, and they affect who gets the call even when you do show up. The fix is unglamorous: ask every happy customer, every time, with a direct link. Our guide on <a href="/for/how-to-get-more-google-reviews-for-contractors">getting more Google reviews</a> has the exact steps and a message you can copy.</p>

<h2>7. You're too new, or too far away</h2>
<p>New listings take time to build trust, and the map results favor businesses close to the person searching. You can't change where you're based, but you can widen your reach with service pages for the towns you cover and reviews from customers in those towns. Give a brand-new profile a few weeks of steady activity (photos, reviews, posts) before deciding it isn't working.</p>

<h2>A 20-minute checklist</h2>
<ol>
  <li>Search the job, not your name, in a private window.</li>
  <li>Confirm your Business Profile is claimed, verified and not suspended.</li>
  <li>Set the most specific primary category, plus real secondary ones.</li>
  <li>Fill in your service area with the towns you want work in.</li>
  <li>Link a real website that names your services and towns.</li>
  <li>Text your last five happy customers your review link.</li>
  <li>Add five real photos: truck, team, finished jobs.</li>
</ol>
<p>Then check again in two to four weeks. Google updates rankings gradually, so don't judge the fix by the next morning's results.</p>
`,
    faqs: [
      { q: "Why does my business show up when I search my name but not my service?", a: "Showing up for your own name only proves your listing exists. To show up for searches like \"plumber near me\", Google needs to see that you're relevant and trusted for that job in that area: the right primary category, a filled-in service area, a website that names your services and towns, and recent reviews." },
      { q: "How long does it take for a business to show up on Google?", a: "A newly verified Google Business Profile can appear for its own name within days. Ranking for competitive searches like \"[service] near me\" usually takes weeks to a few months of steady reviews, photos and an accurate website." },
      { q: "Do I need a website to show up on Google Maps?", a: "No, a verified Google Business Profile can appear on Maps without a website. But a listing with a real website behind it gives Google more information about your services and towns, and customers are more likely to call a business they can check out first." },
      { q: "Can I pay Google to show up higher in the map results?", a: "You can't pay to rank higher in the free map results. You can pay for ads, including Local Services Ads, which appear above them. The free results are earned through relevance, distance and reviews." },
      { q: "What does Enoma cost?", a: "Your first month is free, with no credit card. After that it's $19.99 a month to keep your page live, and that includes personal support. No contract; cancel anytime." },
    ],
    ctaH2: "Get found for the jobs you want",
    ctaSub: "Pick your business on Google and see your page in about 30 seconds: your services, your towns, tap-to-call and a quote form that sends leads straight to you.",
    social: {
      hook: "Searched your trade + your town and found everyone but you?",
      bullets: ["Search the job, not your name", "Check your primary category", "List every town you serve", "Put a real website behind your listing"],
    },
  },

  {
    slug: "angi-alternatives-for-contractors",
    published: "2026-10-28",
    title: "Angi Alternatives for Contractors: Get Leads You Don't Share | Enoma",
    description: "Tired of paying for shared leads? An honest look at Angi, Thumbtack and the alternatives contractors use to get their own calls, including what each one costs you.",
    eyebrow: "Guide for contractors and home service pros",
    h1: "Angi alternatives for contractors<br><em>who are done sharing leads</em>",
    heroSub: "Lead marketplaces can fill a slow week. But you pay for each lead, you often compete with other pros for the same homeowner, and the customer relationship isn't really yours. Here's what else works.",
    article: `
<h2>Why contractors look for Angi alternatives</h2>
<p>The complaints are consistent across trades. You pay for access to a homeowner whether or not you win the job. The same request can go to several pros, so speed matters more than quality. And when you stop paying, the leads stop, because you've been renting someone else's customers instead of building your own.</p>
<p>None of that makes marketplaces useless. They can be a reasonable way to fill gaps while you build something you own. The question is what that "something" should be.</p>

<h2>How the big marketplaces charge</h2>
<table>
  <tr><th>Platform</th><th>How you pay</th><th>Watch out for</th></tr>
  <tr><td>Angi</td><td>Per lead, plus program fees depending on your plan</td><td>Leads may also go to other pros; read your contract terms</td></tr>
  <tr><td>Thumbtack</td><td>Per lead when you contact a customer or get auto-matched, no subscription</td><td>You pay even if the lead doesn't hire you; set a weekly budget</td></tr>
  <tr><td>Google Local Services Ads</td><td>Per lead (call or message), only in eligible trades and areas</td><td>Requires screening; dispute invalid leads promptly</td></tr>
  <tr><td>Yelp Ads</td><td>Per click, with a budget you set</td><td>Strong in some cities and trades, weak in others</td></tr>
</table>
<p>Prices change often and vary by trade and zip code, so check the current numbers in your own area before comparing.</p>

<h2>The alternative: leads that come to you</h2>
<p>Every lead a marketplace sells you started as a homeowner searching Google. The long-term alternative is to show up in that search yourself, so the call comes straight to you and nobody else gets the same lead. That takes three pieces, and none of them is expensive.</p>

<h3>1. A complete Google Business Profile</h3>
<p>This is the listing in the map results. It's free, and once it has steady reviews it often brings in more calls than paid channels do. Pick the right primary category, list your service towns, and add real photos of your work.</p>

<h3>2. Reviews you ask for every single time</h3>
<p>Marketplaces show reviews on their platform, which you lose when you leave. Google reviews stay with you. Text a review link to every happy customer the day the job finishes. Here's <a href="/for/how-to-get-more-google-reviews-for-contractors">how to get more Google reviews</a>, with a message you can copy.</p>

<h3>3. A page that turns searches into calls</h3>
<p>When someone finds you, they want to know three things fast: do you do this job, do you cover my town, and how do I reach you. A simple page with your services, towns, a tap-to-call button and a quote form answers all three. Quote requests come straight to you. You don't pay per lead, and you don't compete with four other pros for the same homeowner.</p>
<div class="lp-callout">That's what an Enoma page does. It's built from your Google listing, sends calls and quote requests straight to you, and costs $19.99/mo after a free first month: less than many single marketplace leads. <a href="/get-your-website" data-cta="inline">See your page in 30 seconds</a>.</div>

<h2>A sensible way to switch</h2>
<p>Don't cancel everything on day one. Most contractors who move away from shared leads do it in stages:</p>
<ol>
  <li>Set up your Business Profile, review requests and your own page now.</li>
  <li>Track where every job comes from for a month or two. Ask "how did you find us?" on every call.</li>
  <li>Lower your marketplace budget as your own calls grow, and drop the platforms that cost the most per booked job.</li>
</ol>
<p>The goal isn't zero paid leads. It's not depending on them.</p>
`,
    faqs: [
      { q: "Is Angi worth it for contractors?", a: "It can be for filling gaps, especially for new businesses. But you pay per lead whether or not you win the job, and leads can go to multiple pros. Many contractors use it short-term while building their own Google presence, then cut back as their own calls grow." },
      { q: "What is the best alternative to Angi and Thumbtack?", a: "For most local contractors, the best long-term alternative is getting your own calls from Google: a complete Google Business Profile, steady reviews, and a simple website with your services, towns and a quote form. Those leads come only to you and don't cost per lead." },
      { q: "Do Thumbtack leads cost money even if I don't get the job?", a: "Yes. Thumbtack charges when you contact a customer or are auto-matched to a lead, whether or not they hire you. You can set a weekly budget to cap spending." },
      { q: "How do I get leads without paying per lead?", a: "Show up where homeowners search. Finish your Google Business Profile, ask every happy customer for a Google review, and have a page that names your services and towns with tap-to-call and a quote form. Referral asks and truck signage pointing to that page help too." },
      { q: "What does Enoma cost?", a: "Your first month is free, with no credit card. After that it's $19.99 a month to keep your page live, and that includes personal support. No contract; cancel anytime." },
    ],
    ctaH2: "Get leads that are only yours",
    ctaSub: "Pick your business on Google and see your page in about 30 seconds. Calls and quote requests go straight to you. No per-lead fees, no sharing.",
    social: {
      hook: "Paying for leads that also went to 3 other contractors?",
      bullets: ["Marketplaces charge whether you win or not", "Google reviews stay with you, platform reviews don't", "Your own page = leads only you get", "Switch in stages, don't cancel cold"],
    },
  },

  {
    slug: "how-to-get-snow-removal-customers",
    published: "2026-10-28",
    title: "How to Get Snow Removal Customers Before the First Storm | Enoma",
    description: "How snow plowing and removal businesses land seasonal contracts and per-push customers: timing, pricing models, where customers look, and what to put online.",
    eyebrow: "Guide for snow removal and plowing businesses",
    h1: "How to get snow removal customers<br><em>before the first storm</em>",
    heroSub: "The snow business is won in the fall. Homeowners and property managers lock in plowing before the first storm, and the ones who wait search in a panic the morning it hits. Here's how to catch both.",
    article: `
<h2>Snow removal customers come in two waves</h2>
<p>Understanding the timing is most of the strategy.</p>
<ul>
  <li><strong>The planners (September to November).</strong> Homeowners who were stuck last year, and property managers with lots to clear, sign seasonal contracts early. These are your best customers: predictable revenue whether it snows a lot or a little.</li>
  <li><strong>The panic searchers (the night before and morning of a storm).</strong> People who didn't plan search "snow plowing near me" on their phone. They'll pay per push, and they call whoever answers first.</li>
</ul>
<p>Most plowing businesses only catch the second wave, by word of mouth. You want to be easy to find for both.</p>

<h2>Decide your pricing model before you market</h2>
<p>Customers ask about price first, so know your answer. Common options:</p>
<table>
  <tr><th>Model</th><th>Good for</th><th>Trade-off</th></tr>
  <tr><td>Seasonal contract</td><td>Steady revenue, easier route planning</td><td>You carry the risk of a heavy winter</td></tr>
  <tr><td>Per push / per visit</td><td>One-off and storm-day customers</td><td>Income swings with the weather</td></tr>
  <tr><td>Per inch tiers</td><td>Commercial lots, bigger driveways</td><td>Needs clear terms on how snowfall is measured</td></tr>
</table>
<p>Many operators offer a seasonal contract as the default and per-push as the fallback for storm-day calls.</p>

<h2>Where to find snow removal customers</h2>
<h3>Your current customers</h3>
<p>If you do landscaping or lawn care, your fall cleanup customers are your easiest snow contracts. Ask every one of them before the leaves are done. A short text works: "We're booking snow plowing for the winter. Want me to hold a spot for your driveway?"</p>

<h3>Your neighbors' streets</h3>
<p>Plowing is about route density. Five driveways on one street beats five driveways across town. Door hangers on streets where you already have customers, and asking customers to tell a neighbor, both fill routes efficiently.</p>

<h3>Google, especially on storm day</h3>
<p>The panic searchers go straight to Google Maps. Add "Snow removal service" as a category on your Google Business Profile (primary or secondary, depending on your main business), list the towns you plow, and post a quick update when you're booking for the season. Make sure your phone number is right and that someone answers or texts back fast on storm days.</p>

<h3>Property managers and small commercial lots</h3>
<p>Condo associations, churches, small offices and medical practices all need lots cleared before opening. They often decide in the fall. A short email or visit with your coverage area, equipment and response time goes a long way.</p>

<h2>What to put online</h2>
<p>A snow customer needs four answers quickly: do you plow my town, do you do driveways or lots, how do I book, and how fast do you show up. Put those on one page with a tap-to-call button and a short form for seasonal contract requests, so you can collect sign-ups in October and build your routes before the first storm.</p>
<div class="lp-callout">An Enoma page lists your services and towns, puts your number one tap away, and sends seasonal contract requests straight to your inbox. <a href="/get-your-website" data-cta="inline">See your page in 30 seconds</a> and have it ready before the first storm.</div>

<h2>Storm-day habits that win repeat customers</h2>
<ul>
  <li>Text customers when you're on the way and when you're done.</li>
  <li>Keep the same order on your route so customers know roughly when to expect you.</li>
  <li>After the first big storm, ask happy customers for a Google review. That's when you're most appreciated.</li>
</ul>
`,
    faqs: [
      { q: "When should I start marketing snow removal services?", a: "September through November. Homeowners and property managers sign seasonal snow contracts before the first storm, and those contracts are your most reliable revenue. Storm-day customers search Google at the last minute, so your Google listing needs to be ready by late fall too." },
      { q: "How do I get snow plowing contracts?", a: "Start with your existing lawn care or landscaping customers, then target neighbors on the same streets to build dense routes. Reach out to small commercial properties like condo associations, churches and medical offices in the fall, and make it easy to request a seasonal contract online." },
      { q: "Should I charge per push or a seasonal rate?", a: "Many operators offer a seasonal contract as the default for predictable revenue and route planning, and per-push pricing for one-off and storm-day customers. Per-inch tiers are common for commercial lots." },
      { q: "How do people find snow removal companies?", a: "Mostly through referrals and Google, especially \"snow removal near me\" searches on a phone the night before or morning of a storm. Having \"Snow removal service\" as a Google Business Profile category and a page with your towns and phone number helps you show up." },
      { q: "What does Enoma cost?", a: "Your first month is free, with no credit card. After that it's $19.99 a month to keep your page live, and that includes personal support. No contract; cancel anytime." },
    ],
    ctaH2: "Be the one they find on storm day",
    ctaSub: "Pick your business on Google and see your page in about 30 seconds: your towns, tap-to-call, and a form that collects seasonal contract requests.",
    social: {
      hook: "The snow business is won in October, not January.",
      bullets: ["Sign seasonal contracts before the first storm", "Ask your fall cleanup customers first", "Build dense routes street by street", "Be on Google Maps for storm-day panic searches"],
    },
  },

  {
    slug: "how-to-get-more-google-reviews-for-contractors",
    published: "2026-10-28",
    title: "How to Get More Google Reviews as a Contractor (+ Text) | Enoma",
    description: "The simple system contractors use to get steady Google reviews: when to ask, the exact text message to send, how to make a review link, and what not to do.",
    eyebrow: "Guide for contractors and home service pros",
    h1: "How to get more Google reviews<br><em>as a contractor</em>",
    heroSub: "Reviews decide who gets the call, even when three businesses show up side by side. The contractors with the most reviews aren't better at asking. They just ask every single time.",
    article: `
<h2>Why Google reviews matter so much for local trades</h2>
<p>When a homeowner searches "roofer near me", they see a few businesses with star ratings and review counts. Most will call one of those three without scrolling. Reviews affect where you show up in those map results, and they decide who gets picked once you're there. A business with recent, detailed reviews looks active and trustworthy. One with three reviews from 2021 looks like it might have closed.</p>

<h2>The system: ask every time, the same way</h2>
<p>You don't need software to start. You need a habit.</p>
<ol>
  <li><strong>Get your review link.</strong> Search your business name on Google while signed in to the account that manages your Business Profile. Use the "Ask for reviews" option to copy a direct link, or get a QR code. Save the link in your phone's text replacements so you can paste it in two taps.</li>
  <li><strong>Ask the same day the job finishes.</strong> That's when the customer is happiest and the job is fresh. Waiting a week cuts your response rate.</li>
  <li><strong>Ask in person, then send the link.</strong> "Would you mind leaving us a quick Google review? I'll text you the link." People who've said yes out loud follow through more often.</li>
  <li><strong>Reply to every review.</strong> Thank people by name and mention the job. For a bad review, reply once, calmly, and offer to make it right offline.</li>
</ol>

<h2>A text you can copy</h2>
<div class="lp-callout">Hi [Name], thanks again for having us out for the [job] today. If you were happy with the work, would you mind leaving a quick Google review? It really helps a small business like ours. Here's the link: [your link]. Thanks! – [Your name], [Business]</div>
<p>Keep it short, personal and specific to the job. Mentioning the job also nudges customers to describe it in their review, which helps other homeowners searching for that service.</p>

<h2>Where else to put your review link</h2>
<ul>
  <li>Your invoices and receipts.</li>
  <li>A QR code on a card you leave behind or on the truck.</li>
  <li>Your email signature.</li>
  <li>Your website, next to your existing reviews.</li>
</ul>

<h2>What not to do</h2>
<p>Google's rules are strict, and breaking them can get reviews removed or your profile restricted.</p>
<ul>
  <li><strong>Don't offer anything in exchange</strong>: no discounts, gift cards or entries into a drawing for leaving a review. Google prohibits incentivized reviews.</li>
  <li><strong>Don't write reviews for yourself</strong> or ask friends and family who weren't customers.</li>
  <li><strong>Don't only ask the happy ones through a filter</strong> that routes unhappy customers elsewhere. Ask everyone, and handle complaints directly.</li>
</ul>

<h2>Make your reviews do more work</h2>
<p>Reviews on Google help you get found. Showing them on your own page helps you get chosen, because the customer sees them right next to your phone number. Your page should also link back to your Google profile so happy customers can add theirs.</p>
<div class="lp-callout">An Enoma page pulls in your Google rating, lists your services and towns, and puts your number one tap away. <a href="/get-your-website" data-cta="inline">See your page in 30 seconds</a>, built from your Google listing.</div>
`,
    faqs: [
      { q: "How do I get a link for customers to leave a Google review?", a: "Search your business name on Google while signed in to the account that manages your Business Profile and use the \"Ask for reviews\" option to copy a direct review link or get a QR code. Text or email that link to customers so they land right on the review form." },
      { q: "When is the best time to ask a customer for a review?", a: "The same day the job is finished, ideally after asking in person. Customers are happiest and the details are fresh, so they're far more likely to follow through than if you ask a week later." },
      { q: "Can I offer a discount for a Google review?", a: "No. Google prohibits offering incentives such as discounts, free services or gift cards in exchange for reviews. Incentivized reviews can be removed and can put your profile at risk." },
      { q: "How do I respond to a bad Google review?", a: "Reply once, calmly and briefly. Thank them, acknowledge the issue without arguing, and offer to make it right by phone or email. Future customers read your reply as much as the review." },
      { q: "What does Enoma cost?", a: "Your first month is free, with no credit card. After that it's $19.99 a month to keep your page live, and that includes personal support. No contract; cancel anytime." },
    ],
    ctaH2: "Turn your reviews into calls",
    ctaSub: "Pick your business on Google and see your page in about 30 seconds: your rating, your services, your towns, and a button that calls you.",
    social: {
      hook: "The contractors with the most Google reviews aren't better at asking. They ask every time.",
      bullets: ["Ask the same day the job finishes", "Ask out loud, then text the link", "Never offer a discount for a review", "Reply to every review, good or bad"],
    },
  },

  {
    slug: "how-to-get-more-cleaning-clients",
    published: "2026-10-28",
    title: "How to Get More Cleaning Clients (Recurring, Not One-Offs) | Enoma",
    description: "How house cleaning businesses get more clients, and keep them: Google, referrals, neighborhood clusters, and turning one-time cleans into regulars.",
    eyebrow: "Guide for cleaning business owners",
    h1: "How to get more cleaning clients<br><em>who stay every month</em>",
    heroSub: "A one-time deep clean pays once. A biweekly client pays all year and refers her neighbors. Here's how small cleaning businesses find clients and keep them on the schedule.",
    article: `
<h2>Aim for recurring clients, not just more clients</h2>
<p>Cleaning is one of the few home services people buy on a schedule. One weekly or biweekly client is worth many one-time jobs, and a schedule full of regulars is easier to staff and route. So every channel below is about two things: getting the first clean, and turning it into a standing appointment.</p>

<h2>1. Show up when people search "house cleaning near me"</h2>
<p>Most new cleaning clients start on Google, usually on their phone. Make sure your Google Business Profile is verified, uses "House cleaning service" (or your most specific category) as the primary category, and lists the towns you serve. Add real photos of finished rooms. Then put a page behind it that answers the questions people have before booking a cleaner:</p>
<ul>
  <li>Which towns do you cover?</li>
  <li>What's included in a standard clean versus a deep clean?</li>
  <li>Do you bring your own supplies? Are you insured?</li>
  <li>How do I get a quote?</li>
</ul>
<div class="lp-callout">An Enoma page answers those in one screen, with a quote form that sends requests straight to you and a tap-to-call button. <a href="/get-your-website" data-cta="inline">See your page in 30 seconds</a>, built from your Google listing.</div>

<h2>2. Build clusters, not a scattered map</h2>
<p>Drive time eats cleaning margins. A client next door to an existing client is worth more than one across town. When you finish at a home, leave a card or door hanger with two or three neighbors. Ask regulars if anyone on their street has asked about a cleaner. Clusters let you fit more homes into a day.</p>

<h2>3. Ask for referrals at the moment clients are happiest</h2>
<p>Right after a great clean, especially the first one, ask: "If you know anyone who'd like this every couple of weeks, we have openings on your street on Thursdays." Specific openings feel real. A small thank-you for referrals, such as a discount on their next clean, is a common and fair way to encourage them.</p>

<h2>4. Turn first cleans into standing appointments</h2>
<p>Many first-time clients book a deep clean and never think about what's next. Make the next step easy:</p>
<ul>
  <li>Offer a recurring rate that's clearly lower than the one-time price.</li>
  <li>Book the next visit before you leave: "Want me to put you down for two weeks from today?"</li>
  <li>Follow up by text a few days later if they didn't book.</li>
</ul>

<h2>5. Collect reviews from every regular</h2>
<p>People are letting a stranger into their home, so trust decides the booking. Reviews that mention reliability and the same cleaner each time are gold. Text your review link after the second or third visit, when the client already knows you're consistent. Here's <a href="/for/how-to-get-more-google-reviews-for-contractors">how to ask for Google reviews</a>, including what not to do.</p>

<h2>6. Pick a few local channels and do them well</h2>
<p>Neighborhood Facebook groups, Nextdoor, local parents' groups and realtors (move-out and move-in cleans) can all work. Don't try all of them. Pick two, show up consistently, and always point people to the same page with your towns and quote form.</p>
`,
    faqs: [
      { q: "How do I get my first cleaning clients?", a: "Start with your Google Business Profile and a simple page listing your towns, services and a quote form, then tell everyone you know and post in neighborhood groups. Leave cards with neighbors of every home you clean, and ask happy clients for referrals and Google reviews from the start." },
      { q: "How do I get recurring cleaning clients instead of one-time jobs?", a: "Offer a lower recurring rate than your one-time price, book the next visit before you leave the first clean, and follow up by text if they didn't book. Reliability, the same cleaner each visit, and reviews that mention both make clients stay." },
      { q: "Where do people look for house cleaners?", a: "Mostly Google (\"house cleaning near me\" on a phone), referrals from friends and neighbors, and local Facebook or Nextdoor groups. All of them work better when they point to one page that shows your towns, what's included and how to get a quote." },
      { q: "Do cleaning businesses need a website?", a: "It helps. People want to check your services, coverage area and reviews before letting you into their home. One clear page with a quote form and your Google rating does the job for most small cleaning businesses." },
      { q: "What does Enoma cost?", a: "Your first month is free, with no credit card. After that it's $19.99 a month to keep your page live, and that includes personal support. No contract; cancel anytime." },
    ],
    ctaH2: "Fill your schedule with regulars",
    ctaSub: "Pick your business on Google and see your page in about 30 seconds: your towns, what's included, and a quote form that sends requests straight to you.",
    social: {
      hook: "One biweekly cleaning client is worth a pile of one-time jobs.",
      bullets: ["Build street clusters to cut drive time", "Book the next clean before you leave", "Ask for referrals with a specific opening", "Ask for reviews after visit 2 or 3"],
    },
  },

  {
    slug: "how-to-get-more-hvac-customers",
    published: "2026-10-28",
    title: "How to Get More HVAC Customers Without Buying Leads | Enoma",
    description: "How small HVAC companies get more service calls and installs: Google Business Profile, service pages, maintenance plans and after-hours lead capture.",
    eyebrow: "Guide for HVAC business owners",
    h1: "How to get more HVAC customers<br><em>without buying leads</em>",
    heroSub: "HVAC demand comes in waves: the first cold snap, the first heat wave. The companies that grow are the ones homeowners find in that moment, and the ones that turn a repair call into a maintenance plan.",
    article: `
<h2>Where HVAC calls come from</h2>
<p>A furnace that won't start on the first cold night creates an urgent search: "furnace repair near me", usually on a phone, often after hours. Whoever shows up and answers first usually gets the job. Planned work (replacements, new installs, tune-ups) is researched over days, and trust matters more than speed. You want to win both.</p>

<h2>1. Own the map results for the jobs you want</h2>
<p>Your Google Business Profile is where urgent calls start. Set "HVAC contractor" (or your most specific category) as primary, add secondary categories for services you really do, like "Furnace repair service" or "Air conditioning repair service", and list your service towns. If you offer emergency service, say so and keep your hours accurate. Nothing loses a call faster than a listing that says "Closed".</p>

<h2>2. Name every job, in plain words</h2>
<p>Homeowners search the problem, not "HVAC". "Furnace not turning on", "heat pump installation", "AC not cooling", "boiler repair". If your website only says "heating and cooling services", you're invisible to those searches. List each service you do, with a sentence on each, and name the brands you work on if that's a selling point.</p>

<h2>3. Catch the calls you can't answer</h2>
<p>Many HVAC searches happen at night and on weekends. If no one answers, the homeowner calls the next company. Give them a second way to reach you: a short quote or service request form, and a text-back from your phone system, so you can call them first thing in the morning.</p>
<div class="lp-callout">An Enoma page lists your services and towns, puts your number one tap away, and has a request form that sends after-hours leads straight to you. <a href="/get-your-website" data-cta="inline">See your page in 30 seconds</a>, built from your Google listing.</div>

<h2>4. Turn repair calls into maintenance plans</h2>
<p>A maintenance plan (an annual or twice-yearly tune-up with a member perk like priority scheduling) turns a one-time repair customer into a recurring one. It also fills your schedule in the shoulder seasons and gives you a natural reason to be the company they call when it's time to replace the system. Offer it on every service call.</p>

<h2>5. Market before the season, not during it</h2>
<p>When the first cold snap hits, you'll be too busy to market. Do it in the weeks before: text past customers about furnace tune-ups in early fall and AC checks in spring, update your Google profile with a seasonal post, and make sure your page reflects what you're booking now.</p>

<h2>6. Collect reviews that mention the problem you solved</h2>
<p>"Came out at 9pm when our heat went out" is the kind of review that wins the next emergency call. Ask every satisfied customer, the same day, with a direct link. Here's <a href="/for/how-to-get-more-google-reviews-for-contractors">how to get more Google reviews</a>, with a text you can copy.</p>

<h2>What about paid leads?</h2>
<p>Lead marketplaces and Local Services Ads can fill a slow week, but you pay for every lead and often compete for the same homeowner. Get the free channels working first, then add paid ads once you know what a booked call is worth. More on that in our guide to <a href="/for/angi-alternatives-for-contractors">Angi alternatives for contractors</a>.</p>
`,
    faqs: [
      { q: "How do HVAC companies get more customers?", a: "Mostly from Google: a complete Google Business Profile with the right categories and service towns, a website that names each service (furnace repair, AC repair, heat pumps), steady reviews, and a way to capture after-hours requests. Maintenance plans turn one-time repairs into repeat customers." },
      { q: "What's the best way to get HVAC leads without paying for them?", a: "Show up in the map results for urgent searches like \"furnace repair near me\", list every service you offer in plain words, ask every satisfied customer for a Google review, and give after-hours visitors a request form so you can call them back first thing." },
      { q: "When should HVAC companies do their marketing?", a: "Before each season, not during it. Text past customers about furnace tune-ups in early fall and AC checks in spring, and update your Google profile and website before the first cold snap or heat wave, when you'll be too busy to do it." },
      { q: "Are HVAC maintenance plans worth offering?", a: "For most small HVAC companies, yes. They create recurring revenue, fill the schedule in slower months, and keep you top of mind when the customer needs a replacement system." },
      { q: "What does Enoma cost?", a: "Your first month is free, with no credit card. After that it's $19.99 a month to keep your page live, and that includes personal support. No contract; cancel anytime." },
    ],
    ctaH2: "Be the HVAC company they find first",
    ctaSub: "Pick your business on Google and see your page in about 30 seconds: your services, your towns, tap-to-call and a request form for after-hours leads.",
    social: {
      hook: "HVAC demand hits on the first cold night. Will they find you?",
      bullets: ["Name every job in plain words", "Catch after-hours calls with a form", "Offer a maintenance plan on every call", "Market before the season, not during it"],
    },
  },
];

// One label everywhere a CTA leads to the instant-preview signup.
export const CTA_LABEL = "See your page in 30 seconds →";
export const CTA_PROOF = "First month free &nbsp;·&nbsp; No credit card &nbsp;·&nbsp; $19.99/mo after &nbsp;·&nbsp; Cancel anytime";
