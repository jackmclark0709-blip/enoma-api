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
//
// Separately, verifyMailbox returns { decision: "service_error", reason } when
// the problem is our ZeroBounce account, not the address: a bad key, no
// credits left, a suspended account. Those used to come back as "retry",
// which parked every prospect at verify_retry and stopped all new cold email
// (Nov 7-9 2026) without anyone noticing. The caller stops and alerts Jack.
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

// An account-level failure (as opposed to a per-address hiccup): auth
// rejected, or an error message about credits, the API key or the account.
// ZeroBounce reports "out of credits" and "invalid key" as HTTP 200 with an
// `error` field, so the message text matters as much as the status.
export function accountErrorReason({ httpStatus, error } = {}) {
  if (httpStatus === 401 || httpStatus === 403) return `http_${httpStatus}${error ? `: ${error}` : ""}`;
  const msg = String(error || "");
  if (/credit|api[\s_-]?key|account/i.test(msg)) return msg;
  return null;
}

// ZeroBounce's getcredits endpoint is free. It answers { Credits: "123" },
// and "-1" for an invalid key. Run once at the start of a prepare run so an
// empty account stops the run before any prospect is touched.
export async function checkZeroBounceAccount({ apiKey = process.env.ZEROBOUNCE_API_KEY, fetchImpl = fetch } = {}) {
  if (!apiKey) return { ok: true, credits: null, skipped: "no_api_key" };
  try {
    const res = await fetchImpl(`https://api.zerobounce.net/v2/getcredits?api_key=${encodeURIComponent(apiKey)}`, { signal: AbortSignal.timeout(8000) });
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    const reason = accountErrorReason({ httpStatus: res.status, error: data?.error });
    if (reason) return { ok: false, decision: "service_error", reason };
    if (!res.ok) return { ok: true, credits: null, skipped: `http_${res.status}` };
    const credits = Number(data?.Credits ?? data?.credits);
    if (Number.isFinite(credits) && credits <= 0) {
      return { ok: false, decision: "service_error", reason: credits < 0 ? "invalid API key (getcredits returned -1)" : "out of credits (0 left)", credits };
    }
    return { ok: true, credits: Number.isFinite(credits) ? credits : null };
  } catch (err) {
    // The credits check failing on its own (timeout, network) isn't proof the
    // account is broken; verifyMailbox will catch a real account error.
    return { ok: true, credits: null, skipped: err.name === "TimeoutError" ? "timeout" : "request_failed" };
  }
}

export async function verifyMailbox(email, { apiKey = process.env.ZEROBOUNCE_API_KEY, fetchImpl = fetch } = {}) {
  if (!apiKey) return { decision: "unverified", status: null, sub_status: null };
  const url = `https://api.zerobounce.net/v2/validate?api_key=${encodeURIComponent(apiKey)}&email=${encodeURIComponent(email)}&ip_address=&timeout=10`;
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(15000) });
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    const reason = accountErrorReason({ httpStatus: res.status, error: data?.error });
    if (reason) return { decision: "service_error", reason, status: null, sub_status: null };
    if (!res.ok || data?.error || !data) return { decision: "retry", status: null, sub_status: data?.error || `http_${res.status}` };
    return { decision: decisionForStatus(data.status), status: data.status, sub_status: data.sub_status || null };
  } catch (err) {
    return { decision: "retry", status: null, sub_status: err.name === "TimeoutError" ? "timeout" : "request_failed" };
  }
}

// Runs fn over items with at most `concurrency` in flight. `shouldStart` is
// checked before each new item starts, so a run can stop launching work
// (deadline passed, account error seen) while letting in-flight calls finish.
// Items never started come back as undefined.
export async function mapWithConcurrency(items, concurrency, fn, { shouldStart = () => true } = {}) {
  const out = Array.from({ length: items.length }, () => undefined);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      if (!shouldStart()) return;
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, worker));
  return out;
}
