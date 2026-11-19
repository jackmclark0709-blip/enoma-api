// api/_lib/faq-bank.js
// "Common questions" for v3 pages, without an AI call.
//
// Two kinds of question, in "we" voice:
//   1. Fact questions built from the fact sheet (towns, estimates, hours,
//      license, emergencies). Each only appears when the fact is known.
//   2. Trade questions homeowners actually ask, per persona, picked by the
//      business's own service names. Answers are general trade knowledge
//      ("most tank water heaters last 8 to 12 years") and never claim
//      anything about this business: no prices, guarantees, years, licenses,
//      response times or policies.
//
// Pure: tested in tests/faq-bank.test.js.

const str = v => (v == null ? "" : String(v).trim());

// match: tested against the business's service names + trade. A question
// with no match is a general one for the persona, used to fill.
const BANK = {
  plumbing: [
    { match: /water heater|hot water|tank|tankless/i, q: "How do I know if my water heater needs replacing?", a: "Common signs are rusty or discolored hot water, rumbling or popping from the tank, water around the base, or hot water that runs out faster than it used to. Most tank water heaters last around 8 to 12 years. If yours is in that range and acting up, call us and we'll tell you whether a repair makes sense or it's time to replace it." },
    { match: /drain|clog|backup|backed/i, q: "Should I use a chemical drain cleaner on a clog?", a: "We'd hold off. Store-bought drain chemicals can damage older pipes and often clear only part of the clog. If a plunger doesn't fix it, or several drains are slow at once, the blockage is probably further down the line, and that's worth having us look at." },
    { match: /root|sewer|main line/i, q: "What are the signs of tree roots in a sewer line?", a: "Slow drains all over the house, gurgling toilets, sewer smells, or backups in the lowest drain (often a basement floor drain). Roots get into small cracks in older lines and keep growing. We can clear the line and tell you what we find." },
    { match: /leak|pipe|burst/i, q: "What should I do if a pipe starts leaking?", a: "Shut off the water at the main valve, usually where the water line comes into the house, often in the basement. Then call us. Turning the water off right away limits the damage while you wait." },
    { match: /heat|boiler|radiator|freez|winter/i, q: "How can I keep my pipes from freezing?", a: "Keep the heat on, even when you're away, open cabinet doors under sinks on outside walls during cold snaps, and disconnect garden hoses before winter. If a pipe does freeze, shut off the water and call us before it thaws and starts to leak." },
    { match: /toilet/i, q: "Why does my toilet keep running?", a: "Usually a worn flapper or a fill valve that isn't shutting off. It's a small part, but a running toilet can waste a lot of water, so it's worth fixing soon." },
    { q: "What should I do in a plumbing emergency?", a: "Find your main water shut-off before you need it and turn it off at the first sign of a burst pipe or major leak. Then call us and tell us what you're seeing." },
  ],
  hvac: [
    { match: /furnace|boiler|heat|tune|maint/i, q: "How often should my heating system be serviced?", a: "Once a year, ideally before the heating season starts. A tune-up catches small problems before they turn into a no-heat call on the coldest night of the year." },
    { match: /heat pump|mini ?split|ductless/i, q: "Do heat pumps work in cold weather?", a: "Today's cold-climate heat pumps keep heating well below freezing, and many homes in cold states now use them as their main heat. Whether one fits your house depends on your insulation, layout and current system." },
    { match: /\bac\b|a\/c|air condition|cool/i, q: "My AC is running but not cooling. What should I check?", a: "Check that the thermostat is set to cool, the filter isn't clogged, and the breaker for the outdoor unit hasn't tripped. If it still isn't cooling, call us. It could be low refrigerant or a failed part." },
    { q: "How often should I change my air filter?", a: "Most 1-inch filters should be changed every 1 to 3 months, more often with pets or allergies. A clogged filter makes the system work harder and can cause it to shut off." },
  ],
  electrical: [
    { match: /panel|breaker|service upgrade|upgrade/i, q: "How do I know if I need a panel upgrade?", a: "Breakers that trip often, an old fuse box, lights that dim when big appliances run, or plans to add an EV charger, heat pump or hot tub are all reasons to have your panel checked. We can tell you whether your panel can handle what you're adding." },
    { match: /outlet|switch|receptacle|gfci/i, q: "Why is my outlet warm or not working?", a: "A warm, buzzing or dead outlet can mean a loose connection or a worn-out device, and it shouldn't be ignored. Stop using it and give us a call." },
    { match: /hot tub|spa/i, q: "What does a hot tub need electrically?", a: "Most hot tubs need their own circuit with GFCI protection and a disconnect within sight of the tub. The exact setup depends on the model, so have the spec sheet handy when you call." },
    { match: /generator|inlet/i, q: "What is a generator inlet box?", a: "It's an outdoor plug that lets a portable generator power the circuits you choose, safely, through an interlock or transfer switch, instead of running extension cords through the house." },
    { match: /mini ?split|hvac|heat pump/i, q: "Does a mini split need its own circuit?", a: "Yes. Most mini splits need a dedicated circuit and an outdoor disconnect sized to the unit. It's worth getting that planned before the HVAC installer arrives." },
    { match: /light|fixture|recessed|lighting/i, q: "Can you add recessed lights to an existing ceiling?", a: "In most homes, yes. Remodel-style fixtures go in through small holes from below, so the ceiling doesn't need to come down. Attic access and joist direction affect how it's done." },
    { q: "Do I need a permit for electrical work?", a: "Many electrical jobs need a permit and an inspection, depending on the work and your town. It's a good question to ask when you get your estimate." },
  ],
  landscaping: [
    { match: /lawn|mow|grass|turf/i, q: "How often should my lawn be mowed?", a: "During the growing season, usually once a week. A good rule is to never cut more than about a third of the grass blade at once, so fast-growing spring weeks may need more." },
    { match: /mulch|bed|garden/i, q: "How often should mulch be refreshed?", a: "Most beds look best with a fresh layer every year or two. Two to three inches is plenty. Piling it against tree trunks or plant stems can cause rot." },
    { match: /restor|seed|aerat|renov|sod/i, q: "When is the best time to seed or restore a lawn?", a: "For most northern lawns, late summer to early fall: the soil is still warm, the air is cooler and there are fewer weeds competing. Spring works too, with more watering." },
    { match: /weed/i, q: "When should weed control be applied?", a: "Pre-emergent treatments work best in early spring, before weeds sprout. Spot treatments take care of broadleaf weeds once they're up. Exact timing depends on the weather each year." },
    { match: /tick|mosquito|pest|flea/i, q: "How long does a tick treatment last?", a: "Treatments are usually repeated through tick season, from spring into fall, because one application wears off. Keeping grass short and clearing leaf litter helps too." },
    { match: /clean ?up|leaf|leaves|fall|spring/i, q: "When should spring and fall cleanups be done?", a: "Spring cleanups usually happen once the snow is gone and the ground firms up. Fall cleanups work best after most of the leaves have dropped, before the first snow." },
    { match: /hedge|shrub|prun|trim/i, q: "When should hedges and shrubs be trimmed?", a: "Most hedges do well with a trim in late spring and again in mid to late summer. Flowering shrubs are best pruned right after they bloom so you don't cut off next year's flowers." },
    { match: /snow|plow/i, q: "Should I sign up for snow plowing before winter?", a: "It's a good idea. Plow routes tend to fill up before the first storm, so getting on a schedule in the fall is the easiest way to make sure your driveway is covered." },
    { q: "What's the best time of year to plan landscaping work?", a: "Late winter and early spring are a good time to plan, so the work can start as soon as the ground allows. Fall is good for planting trees, shrubs and grass seed." },
  ],
  painting: [
    { match: /interior|room|wall|bedroom/i, q: "How long does it take to paint a room?", a: "A typical bedroom often takes about a day, including prep, two coats and cleanup. Repairs, high ceilings, trim and big color changes add time. You'll get a timeline with your estimate." },
    { match: /exterior|house|siding/i, q: "What's the best time of year to paint a house exterior?", a: "Late spring through early fall, on dry days when temperatures stay above about 50°F (the paint label has the exact limit). Fresh paint needs a few dry hours before rain or heavy dew." },
    { match: /ceiling|drywall|crack|stain|repair|patch/i, q: "Can ceiling cracks and water stains be fixed before painting?", a: "Usually, yes. Cracks get patched and sanded, and water stains get a stain-blocking primer so they don't bleed through the new paint. Make sure whatever caused the stain is fixed first." },
    { match: /cabinet|kitchen/i, q: "Is painting kitchen cabinets a good alternative to replacing them?", a: "Often, yes, if the cabinet boxes are solid. Good cabinet painting is mostly prep: cleaning off grease, sanding and priming so the finish holds up to daily use." },
    { match: /deck|stain|fence/i, q: "How often should a deck be stained?", a: "Every 2 to 3 years is typical, depending on sun, foot traffic and the type of stain. When water stops beading on the wood, it's time." },
    { match: /pressure|power wash/i, q: "Is pressure washing safe for my siding?", a: "It is when it's done right. Vinyl, wood and older surfaces need lower pressure and the right cleaner, not raw force, which can strip paint or push water behind the siding." },
    { q: "How often should a house be repainted?", a: "Interior walls often go 5 to 10 years. Exteriors usually need it every 7 to 10 years, depending on the siding, sun and how well the last job was done. Peeling, fading or chalky paint means it's time." },
  ],
  cleaning: [
    { match: /deep/i, q: "What's the difference between a regular cleaning and a deep cleaning?", a: "A regular cleaning keeps up with the basics: dusting, vacuuming, mopping, kitchens and bathrooms. A deep cleaning goes further, into baseboards, inside appliances, grout and built-up grime. A first visit is often a deep clean." },
    { match: /house|home|residential|maid|recurring/i, q: "How often should I schedule house cleaning?", a: "Every week or every other week is most common for busy households. Once a month works if you mainly want a reset." },
    { match: /carpet|rug|upholster/i, q: "How long does carpet take to dry after cleaning?", a: "Usually a few hours, up to about a day, depending on the method, airflow and humidity. Running fans or the AC speeds it up." },
    { match: /move|turnover|vacant/i, q: "What does a move-out cleaning include?", a: "Usually everything a deep cleaning covers, plus inside cabinets, closets and appliances, since the place is empty. It's what landlords look for before returning a deposit." },
    { match: /pressure|power wash/i, q: "Is pressure washing safe for my siding?", a: "It is when it's done right. Vinyl, wood and older surfaces need lower pressure and the right cleaner, not raw force, which can strip paint or push water behind the siding." },
    { match: /office|commercial|janitor/i, q: "Can cleaning happen after business hours?", a: "Many offices schedule cleaning in the evening or early morning so it doesn't interrupt work. Ask about times that fit your schedule." },
    { q: "Do I need to supply cleaning products?", a: "Ask when you book. If anyone in the house has allergies or you prefer certain products, mention it up front." },
  ],
  contractor: [
    { match: /roof|shingle/i, q: "What are the signs I need a new roof?", a: "Curling or missing shingles, granules collecting in the gutters, daylight in the attic, or leaks that keep coming back. Asphalt shingle roofs usually last about 20 to 25 years. If yours is getting close, have it looked at before the next big storm." },
    { match: /roof|leak/i, q: "Can a roof leak be repaired, or does the whole roof need replacing?", a: "Many leaks come from one spot, like the flashing around a chimney or vent, or a few damaged shingles, and can be repaired. If the roof is near the end of its life or leaks in several places, replacing it may cost less in the long run." },
    { match: /pav|asphalt|driveway/i, q: "How long should I wait to drive on a new asphalt driveway?", a: "Usually about three days, longer in hot weather. For the first few weeks, avoid turning the wheel while parked and don't park in exactly the same spot every day while the asphalt hardens." },
    { match: /seal|pav|asphalt|driveway/i, q: "How often should a driveway be sealcoated?", a: "Every 2 to 3 years is typical. Sealcoating protects asphalt from water, sun and oil, and filling cracks early keeps them from spreading." },
    { match: /pav|asphalt/i, q: "What's the best time of year for paving?", a: "Late spring through early fall. Asphalt needs warm temperatures to be laid and compacted properly." },
    { match: /deck|porch/i, q: "Should I build my deck with wood or composite?", a: "Pressure-treated wood costs less up front but needs staining or sealing every few years. Composite costs more but needs little upkeep beyond cleaning." },
    { match: /mason|brick|chimney|stone|concrete/i, q: "When should brick or chimney mortar be repointed?", a: "When the mortar is crumbling, recessed or missing between bricks. Water gets into those gaps, freezes and pushes bricks loose, so it's best fixed early." },
    { q: "Do I need a permit for my project?", a: "Many projects need a building permit, depending on the work and your town's rules. It's a good question to ask when you get your estimate." },
  ],
};
BANK.snow = BANK.landscaping.filter(x => x.match && /snow/.test(String(x.match))).concat([
  { q: "Should I salt or sand my walkway?", a: "Salt melts ice; sand adds grip but doesn't melt anything. Many people use both. Salt can damage new concrete and plants, so use it sparingly near beds and fresh concrete." },
]);
export const TRADE_FAQS = Object.freeze(BANK);

/** Questions ordered for this business: matched by service first, then general. */
export function tradeFaqs(persona, serviceText) {
  const bank = TRADE_FAQS[persona] || [];
  const text = str(serviceText);
  const matched = bank.filter(x => x.match && x.match.test(text));
  const general = bank.filter(x => !x.match);
  return [...matched, ...general];
}

const joinList = a => (a.length <= 1 ? a.join("") : a.length === 2 ? `${a[0]} and ${a[1]}` : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`);

/**
 * Questions built only from known facts. f: { phone, towns{home,confirmed[]},
 * hours{text}, offers_free_estimates, offers_emergency, license{state,number},
 * is_insured, form }.
 */
export function factFaqs(f = {}) {
  const out = {};
  const phone = str(f.phone);
  const contact = phone ? `Call or text us at ${phone}` : "Send us a message";
  const towns = (f.towns?.confirmed || []).map(str).filter(Boolean);
  const home = str(f.towns?.home);
  if (home || towns.length) {
    const others = towns.filter(t => t.toLowerCase() !== home.toLowerCase());
    const where = home && others.length
      ? `We're based in ${home} and work in ${joinList(others.slice(0, 8))}.`
      : home ? `We're based in ${home}.` : `We work in ${joinList(towns.slice(0, 8))}.`;
    out.towns = { q: "What towns do you serve?", a: `${where} Not sure we cover your town? ${phone ? `Text us at ${phone}` : "Send us a message"} and we'll let you know.` };
  }
  out.estimate = {
    q: f.offers_free_estimates ? "Are estimates free?" : "How do I get an estimate?",
    a: f.offers_free_estimates
      ? `Yes. ${contact}, or fill out the form on this page with a few details about the job, and we'll set up a time.`
      : `${contact}, or fill out the form on this page with a few details about the job, and we'll get back to you.`,
  };
  if (f.offers_emergency === true && phone) out.emergency = { q: "Do you handle emergencies?", a: `Yes. Call us at ${phone} and tell us what's going on.` };
  const lic = str(f.license?.number).replace(/^#/, "");
  if (lic) out.license = { q: f.is_insured === true ? "Are you licensed and insured?" : "Are you licensed?", a: `Yes. Our ${str(f.license.state) ? `${str(f.license.state)} ` : ""}license number is #${lic}${f.is_insured === true ? ", and we're insured" : ""}.` };
  else if (f.is_insured === true) out.license = { q: "Are you insured?", a: "Yes, we're insured." };
  if (str(f.hours?.text)) out.hours = { q: "When are you open?", a: `${str(f.hours.text).replace(/\.$/, "")}. Outside those hours, leave a message or use the form and we'll follow up.` };
  return out;
}

// AI-written questions are kept only when they read like the business
// talking ("Do you…", not "How quickly can they…").
const THIRD_PERSON = /\b(they|their|them|the company|the business)\b/i;
export function usableAiFaq(f) {
  const q = str(f?.q), a = str(f?.a);
  return !!(q && a && !THIRD_PERSON.test(q) && !THIRD_PERSON.test(a) && q.length <= 90);
}

/**
 * The page's FAQ list: a trade question that matches their services, up to
 * two evidence-backed AI questions (PR A's copy, "we" voice only), estimate
 * and towns, more trade questions, emergencies, license and hours. Deduped
 * by question, at most max.
 */
export function buildFaqs({ persona, serviceText = "", facts = {}, aiFaqs = [], max = 6 } = {}) {
  const fact = factFaqs(facts);
  const trade = tradeFaqs(persona, serviceText);
  // Fact questions already cover hours, towns, estimates, licenses and emergencies.
  const COVERED = /\b(hours|open|towns?|areas?|serve|travel|outside|estimates?|quotes?|licen[sc]ed?|insured|insurance|emergenc)/i;
  const ai = (aiFaqs || []).filter(usableAiFaq).filter(f => !COVERED.test(f.q)).slice(0, 2);
  const order = [trade[0], ai[0], fact.estimate, fact.towns, trade[1], ai[1], fact.emergency, trade[2], fact.license, fact.hours, trade[3], trade[4]];
  const seen = new Set();
  const out = [];
  for (const x of order) {
    if (!x || !str(x.q) || !str(x.a)) continue;
    const k = str(x.q).toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ q: str(x.q), a: str(x.a) });
    if (out.length >= max) break;
  }
  return out;
}
