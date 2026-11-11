// IP ranges used by api/_lib/traffic-classifier.js. Keep every range here so
// they're easy to update; each list says where it came from. IPv4 CIDR only
// (IPv6 visitors only ever match INTERNAL_IPS exact entries).
//
// To refresh a list:
//   Googlebot  https://developers.google.com/static/search/apis/ipranges/googlebot.json
//   Meta       whois -h whois.radb.net -- '-i origin AS32934'
//   Microsoft  https://www.microsoft.com/en-us/download/details.aspx?id=56519 (Azure IP ranges & service tags)
//   AWS        https://ip-ranges.amazonaws.com/ip-ranges.json
//   GCP        https://www.gstatic.com/ipranges/cloud.json

// Jack's own connections. INTERNAL_IPS (comma-separated, exact IPs or CIDRs)
// replaces this list when it's set in Vercel.
//   173.48.250.211  home (Windows, iPhone, Mac), Nov 2026 audit: 74 events
//   71.248.173.98   Marlborough (was BLOCKED_IPS in api/track.js)
//   75.69.76.70     older home IP (was BLOCKED_IPS in api/track.js)
export const DEFAULT_INTERNAL_IPS = ["173.48.250.211", "71.248.173.98", "75.69.76.70"];

// Googlebot / GoogleOther crawl range (googlebot.json, all prefixes sit in this /19).
export const GOOGLEBOT_RANGES = ["66.249.64.0/19"];

// Meta (Facebook/Instagram/WhatsApp) AS32934. Link previews arrive as ~10
// hits in one second, often with an iPhone user agent, whenever a link is
// posted or shared. Widened to the /16s seen in the Nov 2026 audit.
export const META_RANGES = [
  "31.13.0.0/16",
  "66.220.0.0/16",
  "69.63.0.0/16",
  "69.171.0.0/16",
  "129.134.0.0/16",
  "157.240.0.0/16",
  "173.252.0.0/16"
];

// Microsoft / Azure. Outlook Safe Links and Defender open every link in an
// email within seconds of delivery (72.152-155, 74.176-179 and 135.224-239
// in the Nov 2026 audit). The /8s are broad on purpose: they are almost all
// datacenter space (Azure, plus some AWS in 13/8 and 52/8) and no prospect
// in the audit came from them.
export const MICROSOFT_RANGES = [
  "72.152.0.0/14",
  "74.176.0.0/14",
  "135.224.0.0/12",
  "4.0.0.0/8",
  "13.0.0.0/8",
  "20.0.0.0/8",
  "40.0.0.0/8",
  "52.0.0.0/8"
];

// AWS and Google Cloud. Other mail filters (Mimecast, Proofpoint, Barracuda,
// EdgePilot) and headless crawlers (Lightpanda, etc.) run here.
export const CLOUD_RANGES = [
  "3.0.0.0/8",        // AWS
  "18.0.0.0/8",       // AWS
  "44.192.0.0/10",    // AWS (us-east-1)
  "54.0.0.0/8",       // AWS
  "34.0.0.0/8",       // GCP, plus AWS 34.192.0.0/10
  "35.0.0.0/8"        // GCP
];

// Tencent Cloud and mainland-China networks: scrapers, never a prospect for
// a US local service business (Nov 2026 audit).
export const ASIA_CLOUD_RANGES = [
  "43.128.0.0/10",    // Tencent Cloud
  "150.109.0.0/16",   // Tencent Cloud
  "183.0.0.0/8"       // China Telecom / China Mobile
];
