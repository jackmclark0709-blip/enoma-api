// Turns the plain-text outreach copy (draft_body + CAN-SPAM footer, both
// written/appended as plain text — see generateDraftCopy/outreach-footer.js)
// into a real HTML email so links render as clickable anchors instead of
// bare URL text. Escaping happens BEFORE linkifying so the URLs Enoma
// constructs itself (which contain real "&" in their query strings) go
// through as "&amp;" inside the href — that's correct, valid HTML; mail
// clients decode it back to "&" when the link is clicked.
const URL_REGEX = /https?:\/\/[^\s<]+/g;
const TRAILING_PUNCTUATION = /[.,;:!?)]+$/;

// Descriptive anchor text for the two links whose surrounding sentence is a
// fixed template we author ourselves (the CTA in generateDraftCopy's
// CTA_LINE, the unsubscribe line in outreach-footer.js) — safe to rewrite
// their wording to read naturally with a label instead of a bare URL.
// Deliberately does NOT cover the case-study/preview-page links: those sit
// inside AI-composed prose (see gapsLine/previewLine in generateDraftCopy),
// so we don't control the lead-in phrasing precisely enough to guarantee a
// substituted label reads naturally — those stay as visible URLs.
const LINK_LABEL_RULES = [
  { pattern: /^https:\/\/enoma\.io\/signup\?/, label: "click here" },
  { pattern: /^https:\/\/enoma\.io\/api\/ga-metrics\?action=unsubscribe/, label: "Unsubscribe" }
];

export function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// Only call this on already-escaped text — matches assume no raw "&"/"<"
// remain (those became "&amp;"/"&lt;"), so a run of non-whitespace,
// non-"<" characters is always a single well-formed URL.
export function linkify(escapedText) {
  return escapedText.replace(URL_REGEX, (match) => {
    const trailing = match.match(TRAILING_PUNCTUATION)?.[0] || "";
    const url = trailing ? match.slice(0, -trailing.length) : match;
    const rule = LINK_LABEL_RULES.find(r => r.pattern.test(url));
    const label = rule ? rule.label : url;
    return `<a href="${url}" style="color:#1a73e8;">${label}</a>${trailing}`;
  });
}

export function plainTextToHtml(text) {
  const linked = linkify(escapeHtml(text || ""));
  return linked
    .split(/\n{2,}/)
    .map(paragraph => `<p style="margin:0 0 16px;">${paragraph.replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

export function wrapEmailHtml(bodyHtml) {
  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#ffffff;">
<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#222222;max-width:560px;margin:0 auto;padding:24px 16px;">
${bodyHtml}
</div>
</body>
</html>`;
}
