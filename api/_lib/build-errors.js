// What a failed page build leaves on the prospect, so the next person to
// look (or the next run) can see why. Stored in prospects.raw, which needs
// no migration:
//   raw.enoma_build = { attempts, last_error, last_code, last_at }
//   raw.enoma_ready = { reasons, at }   (page built but below the floor)
// After BUILD_MAX_ATTEMPTS failed builds the prospect is parked at no_preview
// so a page that can't be built stops being retried every run.

export const BUILD_MAX_ATTEMPTS = 3;

const obj = v => (v && typeof v === "object" && !Array.isArray(v) ? v : {});

export function errorMessage(err) {
  return String(err?.message || err || "unknown error").replace(/\s+/g, " ").trim().slice(0, 300);
}

export function noteBuildFailure(raw, err, now = new Date()) {
  const base = obj(raw);
  const attempts = (Number(obj(base.enoma_build).attempts) || 0) + 1;
  const entry = { attempts, last_error: errorMessage(err), last_code: err?.code ? String(err.code) : null, last_at: now.toISOString() };
  return { raw: { ...base, enoma_build: entry }, attempts, giveUp: attempts >= BUILD_MAX_ATTEMPTS, message: entry.last_error };
}

export function noteNotReady(raw, reasons, now = new Date()) {
  return { ...obj(raw), enoma_ready: { reasons: Array.isArray(reasons) ? reasons.slice(0, 20) : [], at: now.toISOString() } };
}
