// The made-up businesses behind the per-trade example pages
// (api/_lib/example-pages.js; built by scripts/build-example-pages.mjs).
// Names, phone numbers (555-01xx, reserved for fiction) and reviews are
// invented, and every page says so in its banner. Copy follows the v3 rules:
// each line traces to a sample review (r1-r6) or the sample listing (g).
// Six reviews each, so the review grid still has cards after the pull quote
// and the hero card's review are taken out.

const HOURS_WEEK = ["Monday: 7:00 AM – 5:00 PM", "Tuesday: 7:00 AM – 5:00 PM", "Wednesday: 7:00 AM – 5:00 PM", "Thursday: 7:00 AM – 5:00 PM", "Friday: 7:00 AM – 5:00 PM", "Saturday: 8:00 AM – 12:00 PM", "Sunday: Closed"];

const SPECS = [
  {
    key: "landscaping", name: "Birchline Landscaping", category: "landscaping", trade: "landscaping", primaryType: "Landscaper",
    town: "Mansfield", phone: "(508) 555-0141", rating: 4.9, reviewCount: 41, owner: ["Dave"], years: 14,
    towns: ["Mansfield", "Foxborough", "Norton", "Easton", "Sharon"],
    reviews: [
      ["Karen M.", "Dave and his crew redid our front beds and walkway this spring. They showed up when they said they would, cleaned up every day and the yard looks better than it has in twenty years."],
      ["Steve P.", "We use Birchline for weekly mowing and the fall cleanup. Dave texts the day before, the crew is quick and careful around the gardens, and the price has been fair from day one."],
      ["Lisa R.", "Called about a patio and Dave came out the same week to measure. The stone patio was finished in four days and he walked us through everything before he left."],
      ["Tom H.", "Birchline has done our mowing for three seasons. Always on time, the edges are sharp and they never leave clippings on the walk."],
      ["Priya S.", "Dave's crew put in new garden beds along the driveway. They talked us through the plants that would do well in the shade and the beds look great a year later."],
      ["Carl W.", "Fall cleanup done in one morning. The crew showed up on time, hauled everything away and even cleared the gutters over the porch."],
    ],
    copy: {
      eyebrow: "Landscaper in Mansfield, MA",
      hero_headline: "Lawns, garden beds and stone patios in Mansfield, done by a crew that shows up.",
      hero_headline_evidence: ["r1", "r2", "r3"],
      hero_sub: "Weekly mowing, spring and fall cleanups, and patio work. Customers say the crew cleans up every day.",
      hero_sub_evidence: ["r1", "r2"],
      proof: [
        { value: "4.9 ★", label: "41 Google reviews", evidence: ["g"] },
        { value: "14 years", label: "in business", evidence: ["g"] },
        { value: "On time", label: "customers say", evidence: ["r4", "r6"] },
      ],
      services: [
        { name: "Lawn mowing and care", description: "Weekly mowing with a text the day before, careful around your gardens.", evidence: ["r2"], stock_subject: "freshly mowed lawn stripes" },
        { name: "Garden beds and walkways", description: "New beds, edging and walkways that make the front of the house look finished.", evidence: ["r1"], stock_subject: "mulched garden bed with flowers" },
        { name: "Stone patios", description: "Patios measured, built and walked through with you before we leave.", evidence: ["r3"], stock_subject: "stone patio hardscape" },
        { name: "Spring and fall cleanups", description: "Leaves, beds and edges cleaned up so the yard is ready for the season.", evidence: ["r2"], stock_subject: "fall leaf cleanup" },
      ],
      faqs: [
        { q: "How soon can you come out for an estimate?", a: "Usually within the week. Call or send a few details and we'll set a time.", evidence: ["r3"] },
        { q: "Do you do weekly mowing?", a: "Yes. We text the day before so you know we're coming.", evidence: ["r2"] },
        { q: "What towns do you work in?", a: "Mansfield and the towns around it, including Foxborough, Norton and Easton.", evidence: ["g"] },
      ],
      closing: { heading: "Let's get your yard on the schedule.", line: "Tell us what you're thinking and we'll come out and take a look." },
    },
  },
  {
    key: "plumbing", name: "Copperfield Plumbing & Heating", category: "plumber", trade: "plumber", primaryType: "Plumber",
    town: "Attleboro", phone: "(508) 555-0152", rating: 4.8, reviewCount: 67, owner: ["Mike"], years: 22,
    towns: ["Attleboro", "North Attleborough", "Seekonk", "Rehoboth", "Norton"],
    reviews: [
      ["Janet D.", "Our water heater started leaking on a Sunday morning. Mike called back within the hour, had a new one in by the afternoon and explained every charge before he started."],
      ["Tom W.", "Copperfield fixed a slow kitchen drain that two other companies couldn't. Mike found roots in the line, cleared it and showed us the camera footage."],
      ["Angela F.", "Had them replace our old boiler. Fair quote, clean work, and they came back a week later to check the pressure without us asking. Mike is the real deal."],
      ["Rick M.", "No hot water on a Monday and Copperfield had a new water heater in the same day. Mike gave us two options and the price didn't change."],
      ["Donna C.", "Mike found a slow leak behind our bathroom wall that was rotting the subfloor. He fixed it, showed us the damage and recommended someone for the drywall."],
      ["Steve L.", "Our basement drain backed up during a storm. They came out that evening, cleared it and explained how to keep it from happening again."],
    ],
    copy: {
      eyebrow: "Plumber in Attleboro, MA",
      hero_headline: "Leaks, clogged drains and water heaters, fixed by a plumber who explains the price first.",
      hero_headline_evidence: ["r1", "r2"],
      hero_sub: "Call and talk to Mike. Customers say he calls back fast, even on a Sunday.",
      hero_sub_evidence: ["r1"],
      proof: [
        { value: "4.8 ★", label: "67 Google reviews", evidence: ["g"] },
        { value: "22 years", label: "in business", evidence: ["g"] },
        { value: "Same day", label: "water heater swaps, customers say", evidence: ["r1", "r4"] },
      ],
      services: [
        { name: "Water heaters", description: "Leaking or out of hot water? Repairs and same-day replacements, priced before we start.", evidence: ["r1"], stock_subject: "water heater installation" },
        { name: "Drains and sewer lines", description: "Slow and backed-up drains cleared, with a camera to show you what was in the line.", evidence: ["r2"], stock_subject: "drain cleaning" },
        { name: "Boilers and heating", description: "Boiler replacements and repairs, with a follow-up visit to check the system.", evidence: ["r3"], stock_subject: "boiler gauge close-up" },
        { name: "Leaks and repairs", description: "Dripping pipes, fixtures and fittings found and fixed before they do more damage.", evidence: ["r1"], stock_subject: "copper pipe repair" },
      ],
      faqs: [
        { q: "Do you come out on weekends?", a: "For things that can't wait, like a leaking water heater, call. Customers have reached us on a Sunday.", evidence: ["r1"] },
        { q: "Will I know the price before you start?", a: "Yes. We explain the charges before the work begins.", evidence: ["r1", "r3"] },
        { q: "Can you find out what's clogging my drain?", a: "Yes. We can run a camera down the line and show you what we find.", evidence: ["r2"] },
      ],
      closing: { heading: "Water where it shouldn't be? Call.", line: "For everything else, send a few details and we'll call you back." },
    },
  },
  {
    key: "electrical", name: "Brightwire Electric", category: "electrician", trade: "electrician", primaryType: "Electrician",
    town: "Taunton", phone: "(508) 555-0163", rating: 5.0, reviewCount: 33, owner: ["Jess"], years: 9,
    towns: ["Taunton", "Raynham", "Berkley", "Dighton", "Lakeville"],
    reviews: [
      ["Paul K.", "Jess upgraded our old fuse box to a 200 amp panel. Licensed, on time, pulled the permit and passed inspection the first time. Highly recommend Brightwire."],
      ["Maria G.", "We had recessed lights and two ceiling fans put in. Jess was tidy, patched everything and even labeled the breakers for us."],
      ["Ron S.", "Outlet in the kitchen stopped working and started to smell. Brightwire came out that afternoon, found a burnt wire and fixed it safely. Great communication from Jess."],
      ["Linda P.", "Jess added outlets and lighting to our finished basement. She explained the permit, worked around our schedule and left the place spotless."],
      ["Mike D.", "Half the house lost power on a Friday. Brightwire came out the same day, found a failed breaker and replaced it. Fair price, no drama."],
      ["Karen T.", "We needed an EV charger installed. Jess walked us through the panel capacity and had it done in one visit."],
    ],
    copy: {
      eyebrow: "Electrician in Taunton, MA",
      hero_headline: "Panel upgrades, lighting and repairs from a licensed electrician who pulls the permit.",
      hero_headline_evidence: ["r1", "r2", "r3"],
      hero_sub: "Customers say Jess is on time, tidy and passes inspection the first time.",
      hero_sub_evidence: ["r1", "r2"],
      proof: [
        { value: "5.0 ★", label: "33 Google reviews", evidence: ["g"] },
        { value: "Licensed", label: "permits pulled for you", evidence: ["r1"] },
        { value: "Same day", label: "for urgent repairs, customers say", evidence: ["r3", "r5"] },
      ],
      services: [
        { name: "Panel upgrades", description: "Old fuse boxes replaced with a modern panel, permit and inspection handled.", evidence: ["r1"], stock_subject: "electrical panel" },
        { name: "Lighting and ceiling fans", description: "Recessed lights and fans installed, with the drywall patched when we're done.", evidence: ["r2"], stock_subject: "recessed lighting ceiling fan" },
        { name: "Outlets and repairs", description: "Dead or burning-smell outlets traced and fixed safely, often the same day.", evidence: ["r3"], stock_subject: "outlet repair" },
      ],
      faqs: [
        { q: "Do you pull permits?", a: "Yes. We pull the permit and schedule the inspection.", evidence: ["r1"] },
        { q: "An outlet smells like something's burning. What should I do?", a: "Stop using it, turn off that breaker and call. We'll come out as soon as we can.", evidence: ["r3"] },
        { q: "Can you install recessed lights in an existing ceiling?", a: "Yes, and we patch up after ourselves.", evidence: ["r2"] },
      ],
      closing: { heading: "Tell us what you need wired.", line: "Send a few details or call, and we'll get you a time." },
    },
  },
  {
    key: "hvac", name: "Hearthside Heating & Air", category: "hvac contractor", trade: "hvac contractor", primaryType: "HVAC contractor",
    town: "Franklin", phone: "(508) 555-0174", rating: 4.9, reviewCount: 58, owner: ["Chris"], years: 17,
    towns: ["Franklin", "Bellingham", "Medway", "Norfolk", "Wrentham"],
    reviews: [
      ["Diane L.", "Our furnace quit on the coldest night of the year. Chris got back to us that evening and had the heat running by morning. Honest and reasonably priced."],
      ["Greg H.", "Hearthside installed ductless mini splits upstairs. The bedrooms are finally comfortable in July, and Chris showed us how to use the remotes and clean the filters."],
      ["Beth A.", "We have them do the yearly tune-up on our system. Always on time, they explain what they checked, and no pushy upselling. Chris is great."],
      ["Paul R.", "AC died in a July heat wave. Hearthside had a tech here the next morning and we were cool again by lunch."],
      ["Maureen K.", "Chris replaced our 25-year-old furnace. He gave us three options with honest pros and cons and the install crew was neat and quick."],
      ["Dan F.", "Called on a Saturday about a strange noise from the boiler. Chris talked me through it on the phone and came by Monday to fix it."],
    ],
    copy: {
      eyebrow: "Heating and cooling in Franklin, MA",
      hero_headline: "No heat, no AC, or a room that's never comfortable? Fixed by a local HVAC company.",
      hero_headline_evidence: ["r1", "r2"],
      hero_sub: "Furnace repairs, mini splits and yearly tune-ups. Customers say there's no pushy upselling.",
      hero_sub_evidence: ["r1", "r2", "r3"],
      proof: [
        { value: "4.9 ★", label: "58 Google reviews", evidence: ["g"] },
        { value: "17 years", label: "in business", evidence: ["g"] },
        { value: "Next morning", label: "heat back on, customers say", evidence: ["r1", "r4"] },
      ],
      services: [
        { name: "Furnace and heating repair", description: "No heat? We call back fast and get the system running again.", evidence: ["r1"], stock_subject: "thermostat" },
        { name: "Ductless mini splits", description: "Cooling and heat for the rooms your system doesn't reach, with a walkthrough on the remotes.", evidence: ["r2"], stock_subject: "mini split" },
        { name: "Yearly tune-ups", description: "On-time maintenance visits that explain what we checked, without the hard sell.", evidence: ["r3"], stock_subject: "cozy home" },
      ],
      faqs: [
        { q: "My heat went out tonight. Can you help?", a: "Call. We get back to people the same evening when the heat is out.", evidence: ["r1"] },
        { q: "Do mini splits work for upstairs bedrooms?", a: "Yes. They're a good fit for rooms that stay too hot or too cold.", evidence: ["r2"] },
        { q: "Do you offer yearly maintenance?", a: "Yes. We tune up the system and tell you what we checked.", evidence: ["r3"] },
      ],
      closing: { heading: "Get your system looked at.", line: "No heat right now? Call. Otherwise send a few details and we'll set a time." },
    },
  },
  {
    key: "roofing", name: "Ridgecap Roofing", category: "roofing contractor", trade: "roofing contractor", primaryType: "Roofing contractor",
    town: "Plymouth", phone: "(508) 555-0185", rating: 4.8, reviewCount: 46, owner: ["Nate"], years: 19,
    towns: ["Plymouth", "Kingston", "Carver", "Duxbury", "Wareham"],
    reviews: [
      ["Joe B.", "Ridgecap replaced our whole roof in two days. Nate gave us a clear written quote, the crew used tarps to protect the gardens and the magnet sweep picked up every nail."],
      ["Sandra T.", "We had a leak around the chimney after a storm. Nate came out the next day, found the bad flashing and fixed it for much less than we expected."],
      ["Kevin O.", "Second roof we've had Ridgecap do. Nate helped us with the insurance paperwork after the hail and the new roof looks fantastic."],
      ["Gina F.", "New roof in 2 days, and the crew ran a magnet over the whole yard for nails. Nate checked in with us at the end of each day."],
      ["Ed M.", "Nate replaced the flashing around our skylight that two other roofers missed. No more drip in the kitchen."],
      ["Rose H.", "Honest quote, no pressure. Nate told us the roof had a few more years in it and just fixed the problem spots."],
    ],
    copy: {
      eyebrow: "Roofer in Plymouth, MA",
      hero_headline: "Roof replacements and leak repairs, with a written quote and a clean yard after.",
      hero_headline_evidence: ["r1", "r2"],
      hero_sub: "Customers say the crew protects the gardens and sweeps up every nail.",
      hero_sub_evidence: ["r1"],
      proof: [
        { value: "4.8 ★", label: "46 Google reviews", evidence: ["g"] },
        { value: "19 years", label: "in business", evidence: ["g"] },
        { value: "2 days", label: "for a full roof, customers say", evidence: ["r1", "r4"] },
      ],
      services: [
        { name: "Roof replacement", description: "Full tear-offs and new roofs, quoted in writing and finished fast.", evidence: ["r1"], stock_subject: "roof shingles" },
        { name: "Leak and flashing repair", description: "Leaks around chimneys and vents found and fixed, often the next day.", evidence: ["r2"], stock_subject: "contractor/roof" },
        { name: "Storm damage and insurance", description: "Help with the insurance paperwork after hail or wind damage.", evidence: ["r3"], stock_subject: "contractor/siding" },
      ],
      faqs: [
        { q: "How long does a new roof take?", a: "Most homes are done in a couple of days. We'll tell you up front.", evidence: ["r1"] },
        { q: "Will you help with my insurance claim?", a: "Yes. We help with the paperwork after storm damage.", evidence: ["r3"] },
        { q: "My roof leaks around the chimney. Do I need a new roof?", a: "Often not. Many chimney leaks are the flashing, which we can repair.", evidence: ["r2"] },
      ],
      closing: { heading: "Get a written quote.", line: "Tell us about the roof and we'll come take a look." },
    },
  },
  {
    key: "painting", name: "Trueline Painting", category: "painting contractor", trade: "painting contractor", primaryType: "Painter",
    town: "Walpole", phone: "(508) 555-0196", rating: 4.9, reviewCount: 39, owner: ["Ana"], years: 11,
    towns: ["Walpole", "Norwood", "Westwood", "Medfield", "Sharon"],
    reviews: [
      ["Rachel B.", "Trueline painted the inside of our whole house while we were living in it. Ana's crew covered everything, kept the cat in mind and the lines are perfect."],
      ["Mark V.", "We had the exterior done, including scraping and priming the old trim. Ana gave us a detailed quote and they finished a day early."],
      ["Holly C.", "Ana painted our kitchen cabinets white and they look brand new. Smooth finish, no brush marks, and the crew was so respectful of our home."],
      ["Jeff S.", "Trueline repainted our living room and hallway. They started on time every morning and the lines along the ceiling are perfect."],
      ["Meg O.", "Ana helped us pick colors for the whole outside of the house. The crew was careful with our plants and finished on time."],
      ["Liz D.", "Our deck and railings were peeling badly. Trueline scraped, primed and stained everything and it still looks new after a winter."],
    ],
    copy: {
      eyebrow: "Painter in Walpole, MA",
      hero_headline: "Interior, exterior and cabinet painting with clean lines and a covered-up house.",
      hero_headline_evidence: ["r1", "r2", "r3"],
      hero_sub: "Customers say the crew protects everything and finishes on time, sometimes early.",
      hero_sub_evidence: ["r1", "r2"],
      proof: [
        { value: "4.9 ★", label: "39 Google reviews", evidence: ["g"] },
        { value: "11 years", label: "in business", evidence: ["g"] },
        { value: "On time", label: "customers say", evidence: ["r4", "r5"] },
      ],
      services: [
        { name: "Interior painting", description: "Whole rooms or whole houses, with furniture and floors covered while you live there.", evidence: ["r1"], stock_subject: "interior painting" },
        { name: "Exterior painting", description: "Scraping, priming and painting siding and trim, with a detailed quote.", evidence: ["r2"], stock_subject: "exterior house painting" },
        { name: "Cabinet painting", description: "Kitchen cabinets refinished smooth, with no brush marks.", evidence: ["r3"], stock_subject: "painted kitchen cabinets" },
      ],
      faqs: [
        { q: "Can you paint while we're living in the house?", a: "Yes. We cover and protect everything and work around your day.", evidence: ["r1"] },
        { q: "Do you prep the old trim before painting?", a: "Yes. We scrape and prime first, so the paint lasts.", evidence: ["r2"] },
        { q: "Do you paint kitchen cabinets?", a: "Yes, with a smooth finish and no brush marks.", evidence: ["r3"] },
      ],
      closing: { heading: "Get a detailed quote.", line: "Tell us which rooms or what part of the house, and we'll come look." },
    },
  },
  {
    key: "cleaning", name: "Sparrow Lane Home Cleaning", category: "house cleaning service", trade: "house cleaning service", primaryType: "House cleaning service",
    town: "Bridgewater", phone: "(508) 555-0118", rating: 5.0, reviewCount: 52, owner: ["Rosa"], years: 8,
    towns: ["Bridgewater", "East Bridgewater", "West Bridgewater", "Raynham", "Middleborough"],
    reviews: [
      ["Emily W.", "Rosa and her team clean our house every other week and it's the best part of the month. They're thorough, trustworthy and always leave the kitchen sparkling."],
      ["Jim T.", "Booked a move-out clean on short notice. Sparrow Lane fit us in two days later and we got our full deposit back. Thank you Rosa!"],
      ["Nicole P.", "Same two cleaners every visit, they remember what we like and they're great with our dogs. Rosa is easy to reach by text."],
      ["Sam B.", "Needed a deep clean before family came for the holidays. Rosa fit us in 2 days later and the kitchen has never looked better."],
      ["Alicia M.", "Sparrow Lane cleans our place every two weeks. They use the products we asked for and never miss a spot in the bathrooms."],
      ["Hank J.", "Used them for my mom's apartment before she moved. Thorough, friendly and very reasonable."],
    ],
    copy: {
      eyebrow: "House cleaning in Bridgewater, MA",
      hero_headline: "Home cleaning in Bridgewater from the same trusted team, every visit.",
      hero_headline_evidence: ["r1", "r3"],
      hero_sub: "Recurring cleans and move-outs. Customers say the kitchen sparkles every time.",
      hero_sub_evidence: ["r1", "r2"],
      proof: [
        { value: "5.0 ★", label: "52 Google reviews", evidence: ["g"] },
        { value: "Same team", label: "every visit, customers say", evidence: ["r3"] },
        { value: "2 days", label: "notice for a move-out clean", evidence: ["r2", "r4"] },
      ],
      services: [
        { name: "Recurring cleaning", description: "Weekly or every-other-week cleans from the same people, who remember what you like.", evidence: ["r1", "r3"], stock_subject: "clean living room" },
        { name: "Move-out cleaning", description: "Deep cleans to get your deposit back, booked on short notice when we can.", evidence: ["r2"], stock_subject: "move out cleaning" },
        { name: "Kitchens and bathrooms", description: "The rooms that matter most, scrubbed top to bottom.", evidence: ["r1"], stock_subject: "clean kitchen" },
      ],
      faqs: [
        { q: "Will I have the same cleaners each time?", a: "Yes. The same team comes each visit.", evidence: ["r3"] },
        { q: "Can you do a move-out clean this week?", a: "Often, yes. Text or call and we'll find a time.", evidence: ["r2"] },
        { q: "We have pets. Is that OK?", a: "Of course. Our team is great with dogs.", evidence: ["r3"] },
      ],
      closing: { heading: "Get a cleaning on the calendar.", line: "Tell us about your home and how often, and we'll send a price." },
    },
  },
  {
    key: "contractor", name: "Oakbeam Builders", category: "general contractor", trade: "general contractor", primaryType: "General contractor",
    town: "Easton", phone: "(508) 555-0127", rating: 4.9, reviewCount: 28, owner: ["Matt"], years: 16,
    towns: ["Easton", "Stoughton", "Brockton", "Sharon", "Canton"],
    reviews: [
      ["Laura N.", "Oakbeam remodeled our kitchen top to bottom. Matt kept us updated every day, stayed on budget and the cabinets and counters came out beautiful."],
      ["Brian E.", "Built us a new deck with stairs down to the yard. Solid work, permit handled, and Matt's crew cleaned up every night."],
      ["Susan G.", "We hired Matt for a bathroom and ended up having him do the mudroom too. Honest, careful, and the schedule he gave us was the schedule we got."],
      ["Tony R.", "Matt finished our bathroom remodel on time, even with a back-ordered vanity. The tile work is beautiful."],
      ["Kelly W.", "Oakbeam built our mudroom bench and cubbies from a sketch on a napkin. Matt's crew cleaned up every day."],
      ["Frank P.", "Second project with Oakbeam. Clear written estimate, on time, and Matt answers his phone."],
    ],
    copy: {
      eyebrow: "General contractor in Easton, MA",
      hero_headline: "Kitchens, bathrooms and decks, built on budget by a contractor who keeps you posted.",
      hero_headline_evidence: ["r1", "r2", "r3"],
      hero_sub: "Customers say the schedule Matt gives is the schedule they get.",
      hero_sub_evidence: ["r3"],
      proof: [
        { value: "4.9 ★", label: "28 Google reviews", evidence: ["g"] },
        { value: "16 years", label: "in business", evidence: ["g"] },
        { value: "On time", label: "customers say", evidence: ["r4", "r6"] },
      ],
      services: [
        { name: "Kitchen remodels", description: "Cabinets, counters and layout, with daily updates and a budget we stick to.", evidence: ["r1"], stock_subject: "kitchen remodel" },
        { name: "Bathrooms and mudrooms", description: "Bathroom and mudroom remodels finished on the schedule we give you.", evidence: ["r3"], stock_subject: "bathroom remodel" },
        { name: "Decks", description: "New decks and stairs, permit handled and the site cleaned up every night.", evidence: ["r2"], stock_subject: "wood deck" },
      ],
      faqs: [
        { q: "Will you keep me updated during the job?", a: "Yes. You'll hear from us every day while we're working.", evidence: ["r1"] },
        { q: "Do you handle permits?", a: "Yes, for the work that needs one.", evidence: ["r2"] },
        { q: "How do you price a remodel?", a: "We come out, look at the space and give you a written budget we stick to.", evidence: ["r1"] },
      ],
      closing: { heading: "Tell us about your project.", line: "Send a few details and we'll set up a time to walk through it." },
    },
  },
];

const idFor = i => `00000000-0000-4000-8000-0000000ex${String(i).padStart(3, "0")}`.replace("ex", "e0");

/** Fixture-shaped profiles (tests/fixtures/page-v3 format) for every spec. */
export function exampleProfiles() {
  return SPECS.map((s, i) => {
    const address = `${s.town}, MA`;
    const reviews = s.reviews.map(([author, text], j) => ({ id: `r${j + 1}`, author, rating: 5, relative_time: ["2 months ago", "5 months ago", "a year ago", "3 weeks ago", "8 months ago", "2 years ago"][j] || "a year ago", text }));
    return {
      key: s.key,
      profile: {
        business_id: idFor(i + 1),
        username: `example-${s.key}`,
        business_name: s.name,
        primary_category: s.category,
        page_version: 3,
        is_claimed: false,
        phone: s.phone,
        address,
        city: s.town,
        state: "MA",
        google_place_id: null,
        average_rating: s.rating,
        review_count: s.reviewCount,
        services: s.copy.services.map(x => ({ service_name: x.name, service_description: x.description })),
        service_area: s.towns,
        brand_kit: null,
        fact_sheet: {
          version: 1,
          built_at: "2026-11-20T12:00:00.000Z",
          business: { name: s.name, trade: s.trade, primary_type: s.primaryType, google_types: [], phone: s.phone, address, town: s.town, state: "MA", hours: HOURS_WEEK, rating: s.rating, review_count: s.reviewCount, place_id: null },
          reviews,
          site_text: "",
          owner: { names: s.owner, years_in_business: s.years, license_number: null, is_insured: null, offers_free_estimates: null, offers_emergency: false, blurb: null, service_for_page: null, services: [], notes: null },
          towns: { home: s.town, confirmed: s.towns, suggested: [] },
          photos: { owner: [], work: [], google_work_count: 0 },
        },
        page_copy_v3: { ...s.copy, owner_section: null, service_page: null, removed: [] },
      },
    };
  });
}
