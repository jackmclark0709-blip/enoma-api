// tests/_css-rules.js
// A tiny CSS rule reader for tests: good enough for our own stylesheets
// (no nested braces inside declarations). Returns flat rules with their
// selectors split, @media / @supports blocks unwrapped.

export function cssRules(css) {
  const src = String(css).replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [];
  const walk = text => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf("{", i);
      if (open < 0) break;
      const head = text.slice(i, open).trim();
      // find the matching close brace
      let depth = 1, j = open + 1;
      while (j < text.length && depth) { if (text[j] === "{") depth++; else if (text[j] === "}") depth--; j++; }
      const body = text.slice(open + 1, j - 1);
      if (head.startsWith("@")) {
        if (/^@(media|supports)/.test(head)) walk(body);
      } else if (head) {
        rules.push({ selectors: head.split(",").map(s => s.trim().replace(/\s+/g, " ")).filter(Boolean), body: body.trim() });
      }
      i = j;
    }
  };
  walk(src);
  return rules;
}

/** All CSS in <style> blocks of an HTML document. */
export function inlineCss(html) {
  return [...String(html).matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join("\n");
}
