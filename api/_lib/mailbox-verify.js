// Mailbox-level verification for outreach addresses (ZeroBounce), run once
// per prospect before a preview page is built and an email is drafted.
// hasValidMx (email-verify.js) only proves the domain takes mail at all;
// this checks the actual mailbox, which is what keeps bounces off a young
// sending domain. Done through ZeroBounce's API (their servers do the SMTP
// conversation), never a probe from our own serverless IPs.
//
// Needs ZEROBOUNCE_API_KEY. Without it, verifyMailbox reports
// { decision: "unverified" } and the caller decides what to do (the
// outreach pipeline holds the prospect rather than sending unverified).

// ZeroBounce status -> what the pipeline does with the address.
//   send  : verified deliverable
//   send_catch_all : domain accepts everything; can't confirm the mailbox,
//                    but most small-business domains are set up this way
//   drop  : will bounce or is dangerous to mail (spamtrap/abuse/do_not_mail)
//   retry : temporary (greylisting, timeouts) — check again in a few days
export function decisionForStatus(status) {
  switch (String(status || "").toLowerCase()) {
    case "valid": return "send";
    case "catch-all": return "send_catch_all";
    case "invalid":
    case "spamtrap":
    case "abuse":
    case "do_not_mail": return "drop";
    default: return "retry";
  }
}

export async function verifyMailbox(email, { apiKey = process.env.ZEROBOUNCE_API_KEY, fetchImpl = fetch } = {}) {
  if (!apiKey) return { decision: "unverified", status: null, sub_status: null };
  const url = `https://api.zerobounce.net/v2/validate?api_key=${encodeURIComponent(apiKey)}&email=${encodeURIComponent(email)}&ip_address=&timeout=10`;
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(15000) });
    const data = await res.json();
    if (!res.ok || data?.error) return { decision: "retry", status: null, sub_status: data?.error || `http_${res.status}` };
    return { decision: decisionForStatus(data.status), status: data.status, sub_status: data.sub_status || null };
  } catch (err) {
    return { decision: "retry", status: null, sub_status: err.name === "TimeoutError" ? "timeout" : "request_failed" };
  }
}
