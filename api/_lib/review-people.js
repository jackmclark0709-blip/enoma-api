// api/_lib/review-people.js
// People that Google reviews name ("Barry and his crew", "Peter answered on
// the first call"). Handcrafted trade sites put a named person up front;
// Enoma pages can say who customers mention, and how many reviews do, without
// inventing anything.
//
// Pure and deterministic (no AI call): a first name counts only where a review
// uses it like a person (followed by a verb or "and his crew", or after
// "thanks" / "with" / "ask for"), never a word of the business name used as
// the brand ("Arno Plumbing is amazing", "Maynard Roofing did"), never the
// reviewer's own name, never a town, day or month.

const str = v => (v == null ? "" : String(v).trim());

// Short forms count as the same person ("Pete" is "Peter").
const NICK = {
  pete: "peter", mike: "michael", bob: "robert", rob: "robert", bobby: "robert", jim: "james", jimmy: "james",
  tom: "thomas", tommy: "thomas", dan: "daniel", danny: "daniel", dave: "david", joe: "joseph", joey: "joseph",
  steve: "steven", tony: "anthony", nick: "nicholas", matt: "matthew", chris: "christopher", rick: "richard",
  ricky: "richard", rich: "richard", bill: "william", billy: "william", will: "william", ed: "edward", eddie: "edward",
  ken: "kenneth", kenny: "kenneth", jon: "jonathan", sam: "samuel", andy: "andrew", drew: "andrew", greg: "gregory",
  jeff: "jeffrey", ron: "ronald", don: "donald", ray: "raymond", ben: "benjamin", alex: "alexander", fred: "frederick",
};

const STOP = new Set(`i i'm i've i'd we they he she it you my our your his her their this that these those the a an
and or but so if when then than there here what who how why where which great good highly very thank thanks
absolutely excellent outstanding amazing awesome fantastic wonderful incredible overall besides not had have has
called call next last first some all every one two three just also even only after before during since from
god google yelp facebook superbowl christmas thanksgiving easter holiday holidays monday tuesday wednesday thursday
friday saturday sunday january february march april may june july august september october november december
mr mrs ms dr sir madam team crew company owner staff guys guy ladies men women plumber electrician roofer painter
landscaper cleaner contractor technician tech installer service services job work home house roof lawn yard
pipe drain kitchen bathroom basement attic`.split(/\s+/).filter(Boolean));

const TRADE_WORD = /^(plumbing|plumbers?|heating|cooling|hvac|air|electric(al)?|roofing|roofs?|painting|painters?|paint|landscap\w*|lawn|grass|cleaning|cleaners?|maid|maids|paving|asphalt|construction|contracting|contractors?|services?|company|co|inc|llc|pressure|power|wash(ing)?|property|maintenance|home|homes|tree|snow|exteriors?|interiors?|solutions|group|brothers?)$/i;

// What follows a person's name in a review.
const AFTER = /^(?:,?\s*(?:and|&)\s+(?:his|her|their|the)\s+(?:crew|team|guys|men|ladies|staff|apprentice|assistant|son|sons|daughter|wife|husband|helper|helpers)\b|\s*&\s*(?:crew|team)\b|'s\s+(?:crew|team|guys)|\s+(?:was|is|were|are|came|comes|come|did|does|showed|shows|answered|answers|arrived|explained|explains|helped|helps|fixed|fixes|found|gave|gives|got|made|worked|works|went|knows|knew|responded|responds|offered|provided|completed|takes|took|always|returns|sets|leaves|left|told|said|has|had|will|would|could|can|and\s+[A-Z][a-z]+\s+(?:came|were|did|showed|arrived|fixed|found|worked))\b|,\s*the\s+(?:company\s+|business\s+)?owner\b)/;
// What comes before it.
const BEFORE = /\b(?:thanks|thank you|thank|ask for|asked for|call|called|recommend|with|by|from|named|owner)\s*,?\s*$/i;

/**
 * reviews: [{ id, author, text }] (fact_sheet.reviews)
 * skip:    words that are not people here (business name, towns)
 * → [{ name, reviews: [ids], with_crew: "crew"|"team"|"guys"|null, owner: bool, pronoun: "his"|"her"|null }]
 *   sorted by how many reviews name them, most first.
 */
export function peopleInReviews(reviews = [], { skip = [] } = {}) {
  const skipSet = new Set(skip.flatMap(w => str(w).toLowerCase().split(/[^a-z']+/)).filter(Boolean));
  const found = new Map();
  for (const r of Array.isArray(reviews) ? reviews : []) {
    const text = str(r?.text);
    if (!text) continue;
    const author = str(r.author).split(/\s+/)[0].toLowerCase();
    const re = /\b([A-Z][a-z]{2,14})\b/g;
    let m;
    const seenHere = new Set();
    while ((m = re.exec(text))) {
      const word = m[1];
      const low = word.toLowerCase();
      if (STOP.has(low) || skipSet.has(low) || low === author || TRADE_WORD.test(word)) continue;
      const before = text.slice(Math.max(0, m.index - 20), m.index);
      // A surname ("Patrie" in "John Patrie is"): the first name already counted.
      if (/\b[A-Z][a-z]+\s$/.test(before) && !/\b(?:and|&|thanks|thank|with|by|from|for|ask|called|named)\s$/i.test(before)) continue;
      let after = text.slice(m.index + word.length, m.index + word.length + 60);
      // "John Patrie is…": one surname may sit between the name and the verb,
      // but never a trade word ("Maynard Roofing did", "Arno Plumbing is").
      const next = after.match(/^\s+([A-Za-z]+)\b/);
      // "Arno plumbing", "Rangel Cleaning", "Mainely Grass": the brand, not a person.
      if (next && TRADE_WORD.test(next[1])) continue;
      if (next && /^[A-Z][a-z]+$/.test(next[1]) && !/^(and|&)$/i.test(next[1])) {
        if (skipSet.has(next[1].toLowerCase())) continue;
        after = after.slice(next[0].length);
      }
      const afterHit = AFTER.exec(after);
      if (!afterHit && !BEFORE.test(before)) continue;
      const key = NICK[low] || low;
      if (!found.has(key)) found.set(key, { forms: new Map(), reviews: new Set(), crew: null, owner: false, pronoun: null });
      const f = found.get(key);
      f.forms.set(word, (f.forms.get(word) || 0) + 1);
      if (!seenHere.has(key)) { f.reviews.add(str(r.id) || `r${f.reviews.size + 1}`); seenHere.add(key); }
      const crew = after.match(/^,?\s*(?:and|&)\s+(?:(his|her|their|the)\s+)?(crew|team|guys)\b/i) || after.match(/^'s\s+(crew|team|guys)/i);
      if (crew) {
        f.crew = f.crew || ((crew[2] || crew[1]).toLowerCase() === "guys" ? "crew" : (crew[2] || crew[1]).toLowerCase());
        if (crew[1] && /^(his|her)$/i.test(crew[1])) f.pronoun = f.pronoun || crew[1].toLowerCase();
      }
      if (/^,\s*the\s+(?:company\s+|business\s+)?owner\b/i.test(after) || /\bowner\s*,?\s*$/i.test(before)) f.owner = true;
    }
  }
  return [...found.values()].map(f => {
    // The form reviews use most ("Peter" over "Pete"; the longer on a tie).
    const forms = [...f.forms.entries()];
    const full = forms.find(([w]) => NICK[w.toLowerCase()] === undefined && forms.some(([x]) => NICK[x.toLowerCase()] === w.toLowerCase()));
    const name = full ? full[0] : forms.sort((a, b) => (b[1] - a[1]) || (b[0].length - a[0].length))[0][0];
    return { name, reviews: [...f.reviews], with_crew: f.crew, owner: f.owner, pronoun: f.pronoun };
  }).sort((a, b) => b.reviews.length - a.reviews.length);
}

/** The one person a page names: cited by at least 2 reviews, and clearly the most named. */
export function leadPerson(people = []) {
  const top = people[0];
  if (!top || top.reviews.length < 2) return null;
  const next = people[1];
  if (next && next.reviews.length === top.reviews.length) return null; // two equals: a crew, not one person
  return top;
}

/** "Customers mention Barry and his crew by name in 4 Google reviews." */
export function personLine(person) {
  if (!person) return "";
  const who = person.owner
    ? `${person.name}, the owner,`
    : person.with_crew
      ? `${person.name} and ${person.pronoun || "the"} ${person.with_crew}`
      : person.name;
  return `Customers mention ${who} by name in ${person.reviews.length} Google reviews.`;
}
