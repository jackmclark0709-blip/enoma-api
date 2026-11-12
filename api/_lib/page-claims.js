// api/_lib/page-claims.js
// Keeps the claims a page makes about a business true. Badges and template
// lines that used to be stored flags or fixed text ("Open now", "Emergency
// service", "residential and commercial", "Fast response") are now derived
// from what the business actually told us, so they can't drift or lie.

const DAY_ALIASES = [
  ["sunday", 0], ["sun", 0], ["su", 0],
  ["monday", 1], ["mon", 1], ["mo", 1], ["m", 1],
  ["tuesday", 2], ["tues", 2], ["tue", 2], ["tu", 2],
  ["wednesday", 3], ["wed", 3], ["we", 3], ["w", 3],
  ["thursday", 4], ["thurs", 4], ["thur", 4], ["thu", 4], ["th", 4],
  ["friday", 5], ["fri", 5], ["fr", 5], ["f", 5],
  ["saturday", 6], ["sat", 6], ["sa", 6],
];
const DAY_RE = DAY_ALIASES.map(([a]) => a).join("|");

function dayIndex(word) {
  const w = String(word || "").toLowerCase();
  const hit = DAY_ALIASES.find(([a]) => a === w);
  return hit ? hit[1] : null;
}

function toMinutes(h, m, ampm) {
  let hour = Number(h);
  const min = Number(m || 0);
  if (!Number.isFinite(hour) || hour > 24 || min > 59) return null;
  const ap = (ampm || "").toLowerCase().replace(/\./g, "");
  if (ap.startsWith("p") && hour < 12) hour += 12;
  if (ap.startsWith("a") && hour === 12) hour = 0;
  return hour * 60 + min;
}

// Parses free-text availability like "M-F. 8am-6pm.", "Mon–Sat · 7am–6pm",
// "Monday - Friday, 7:30 AM - 5 PM" or "24/7". Returns
// { days: [0..6], open: minutes, close: minutes } or null when unsure.
// Unsure means no badge: a missing "Open now" costs nothing, a wrong one costs trust.
export function parseAvailability(text) {
  const s = String(text || "").toLowerCase().replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (/\b24\s*\/\s*7\b|24 hours|open 24/.test(s)) {
    return { days: [0, 1, 2, 3, 4, 5, 6], open: 0, close: 24 * 60 };
  }

  const timeRe = /(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\s*(?:-|to)\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)/;
  const t = s.match(timeRe);
  if (!t) return null;
  // "8-6pm": the first time borrows am/pm only if that keeps open < close.
  let open = toMinutes(t[1], t[2], t[3] || t[6]);
  const close = toMinutes(t[4], t[5], t[6]);
  if (open != null && close != null && open >= close && !t[3]) open = toMinutes(t[1], t[2], "am");
  if (open == null || close == null || open >= close) return null;

  const dayPart = s.slice(0, t.index);
  const range = dayPart.match(new RegExp(`\\b(${DAY_RE})\\.?\\s*(?:-|to|through|thru)\\s*(${DAY_RE})\\b`));
  let days = null;
  if (range) {
    const a = dayIndex(range[1]), b = dayIndex(range[2]);
    if (a == null || b == null) return null;
    days = [];
    for (let d = a; ; d = (d + 1) % 7) { days.push(d); if (d === b) break; if (days.length > 7) return null; }
  } else if (/\b(daily|every day|7 days)\b/.test(s)) {
    days = [0, 1, 2, 3, 4, 5, 6];
  } else if (/\bweekdays\b/.test(s)) {
    days = [1, 2, 3, 4, 5];
  } else {
    return null; // hours with no days given: can't say when it's open
  }
  return { days: days.sort(), open, close };
}

// Every Enoma customer so far is in the US; the page's state picks the zone.
const STATE_TZ = {
  CT: "America/New_York", DE: "America/New_York", FL: "America/New_York", GA: "America/New_York",
  ME: "America/New_York", MD: "America/New_York", MA: "America/New_York", MI: "America/Detroit",
  NH: "America/New_York", NJ: "America/New_York", NY: "America/New_York", NC: "America/New_York",
  OH: "America/New_York", PA: "America/New_York", RI: "America/New_York", SC: "America/New_York",
  VT: "America/New_York", VA: "America/New_York", WV: "America/New_York", DC: "America/New_York",
  IN: "America/Indiana/Indianapolis", KY: "America/New_York",
  AL: "America/Chicago", AR: "America/Chicago", IL: "America/Chicago", IA: "America/Chicago",
  KS: "America/Chicago", LA: "America/Chicago", MN: "America/Chicago", MS: "America/Chicago",
  MO: "America/Chicago", NE: "America/Chicago", ND: "America/Chicago", OK: "America/Chicago",
  SD: "America/Chicago", TN: "America/Chicago", TX: "America/Chicago", WI: "America/Chicago",
  AZ: "America/Phoenix", CO: "America/Denver", ID: "America/Boise", MT: "America/Denver",
  NM: "America/Denver", UT: "America/Denver", WY: "America/Denver",
  CA: "America/Los_Angeles", NV: "America/Los_Angeles", OR: "America/Los_Angeles", WA: "America/Los_Angeles",
  AK: "America/Anchorage", HI: "Pacific/Honolulu",
};

export function timezoneForState(state) {
  return STATE_TZ[String(state || "").trim().toUpperCase()] || null;
}

// The schedule the browser uses to decide "Open now" at view time.
export function openSchedule(profile) {
  const tz = timezoneForState(profile?.state);
  const parsed = parseAvailability(profile?.hero_availability);
  return tz && parsed ? { ...parsed, tz } : null;
}

// Same check the browser runs (kept in sync with isOpenNow in public/scripts/profile.js).
export function isOpenAt(schedule, date = new Date()) {
  if (!schedule) return false;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: schedule.tz, weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23",
  }).formatToParts(date).map(p => [p.type, p.value]));
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  const mins = Number(parts.hour) * 60 + Number(parts.minute);
  return schedule.days.includes(day) && mins >= schedule.open && mins < schedule.close;
}

function faqText(faqs) {
  if (!Array.isArray(faqs)) return "";
  return faqs.map(f => `${f?.q || f?.question || ""} ${f?.a || f?.answer || ""}`).join(" ").toLowerCase();
}

// True when the page's own FAQ says there's no emergency / after-hours work.
export function faqDeniesEmergency(faqs) {
  const t = faqText(faqs);
  return /\b(do not|don't|does not|doesn't|not|no)\s+(currently\s+)?(offer|provide)?\s*(any\s+)?(emergency|after-hours)/.test(t)
    || /\bno (emergency|after-hours) (service|call)/.test(t);
}

export function showEmergencyBadge(profile) {
  return !!profile?.offers_emergency && !faqDeniesEmergency(profile?.faqs);
}

function allCopy(p) {
  const parts = [p?.about, p?.hero_tagline, p?.services_intro, p?.why_choose_us, faqText(p?.faqs)];
  if (Array.isArray(p?.trust_badges)) parts.push(p.trust_badges.join(" "));
  if (Array.isArray(p?.services)) parts.push(p.services.map(s => `${s?.service_name || ""} ${s?.service_description || ""}`).join(" "));
  return parts.filter(v => typeof v === "string").join(" ").toLowerCase();
}

// "Areas We Serve" sub-line, from what the page itself says about customers.
export function townsLine(profile) {
  const t = allCopy(profile);
  const commercial = /\bcommercial\b|\bbusinesses\b|\bproperty managers?\b/.test(t);
  const residential = /\bresidential\b|\bhomeowners?\b|\bhomes\b/.test(t);
  const residentialOnly = /residential (specialist|only)|residential homes/.test(t);
  if (commercial && residential && !residentialOnly) return "Serving residential and commercial customers across:";
  if (residential && (!commercial || residentialOnly)) return "Serving homeowners across:";
  if (commercial) return "Serving businesses across:";
  return "Serving customers across:";
}

// Note under "Ready to get started?": only promises the business has made.
// "Free estimates" comes from the business's own answer (offersFreeEstimates),
// never from AI copy that happens to say it. "Local to" only for local trades.
export function ctaNote(profile) {
  const items = [];
  if (offersFreeEstimates(profile)) items.push("Free estimates");
  if (profile?.hero_response_time) items.push(String(profile.hero_response_time).trim().replace(/\.$/, ""));
  if (profile?.city && isLocalRadius(profile)) items.push(`Local to ${profile.city}`);
  return items.slice(0, 3).join(" · ");
}

// Does the business offer free estimates? Only the owner's own answer
// (small_business_profiles.offers_free_estimates, asked in the create form
// and dashboard) can say yes. Unanswered (null) counts as no: nothing on a
// page may promise "free" quotes or estimates from AI copy. CTA labels,
// headings, the proof line and the note under "Ready to get started?" all
// ask this, and only this.
export function offersFreeEstimates(profile) {
  return profile?.offers_free_estimates === true;
}

// The owner's reply-time answer ("within 2 hours"), tidied for
// "Usually replies within 2 hours". "" when not given.
export function responseTime(profile) {
  return String(profile?.response_time || "").trim()
    .replace(/\.$/, "")
    .replace(/^(usually |typically )?(replies|responds|respond|reply)\s+/i, "")
    .slice(0, 60);
}

/** "Call for a free estimate" only when the business says so, else "Call for a quote". */
export function callCtaLabel(profile) {
  return offersFreeEstimates(profile) ? "Call for a free estimate" : "Call for a quote";
}

function serviceAreaList(profile) {
  const v = profile?.service_area;
  let list = v;
  if (typeof v === "string") { try { list = JSON.parse(v); } catch { list = v.split(","); } }
  return (Array.isArray(list) ? list : []).map(t => String(t || "").trim()).filter(Boolean);
}

/**
 * A business that works within driving distance of a home base: 1–15 named
 * areas, none of them "nationwide", "statewide", "remote" or "online". Only
 * these get the map and the "Local to <town>" line; everyone keeps the area chips.
 */
export function isLocalRadius(profile) {
  const areas = serviceAreaList(profile);
  return areas.length >= 1 && areas.length <= 15 && !areas.some(a => /nationwide|statewide|remote|online/i.test(a));
}
