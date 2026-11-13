/* Brand colour from a logo, in the browser. The browser copy of the pure
   functions in api/_lib/page-style.js (dominantColorFromPixels,
   ensureUsableBrandColor, ctaFor). tests/brand-color.test.js runs this file
   and the server version against one fixture so the two can't drift.

   Only used when a page has a logo but no stored brand_color yet (the server
   reads the colour on upload and p.js sets it before the page paints). */
(function (root) {
  var AMBER = { cta: '#F2A93B', ctaText: '#1a1714' };
  var TEAL = { cta: '#2BB3A3', ctaText: '#1a1714' };

  function hexToRgb(hex) {
    var m = String(hex || '').trim().match(/^#?([0-9a-f]{6})$/i);
    if (!m) return null;
    var n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHex(rgb) {
    return '#' + rgb.map(function (v) { return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'); }).join('');
  }
  function rgbToHsl(rgb) {
    var r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l: l };
    var d = max - min, s = d / (1 - Math.abs(2 * l - 1));
    var h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
    return { h: h, s: s, l: l };
  }
  function luminance(rgb) {
    var a = rgb.map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
  }
  function ensureUsableBrandColor(rgb) {
    var r = rgb[0], g = rgb[1], b = rgb[2], lum = luminance([r, g, b]);
    while (lum > 0.55) { r *= 0.88; g *= 0.88; b *= 0.88; lum = luminance([r, g, b]); }
    return rgbToHex([r, g, b]);
  }
  function dominantColorFromPixels(data) {
    var counts = {}, best = null, bestN = 0;
    for (var i = 0; i + 3 < data.length; i += 4) {
      var r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (a < 200 || (r > 235 && g > 235 && b > 235) || (r < 30 && g < 30 && b < 30)) continue;
      var key = Math.round(r / 16) * 16 + ',' + Math.round(g / 16) * 16 + ',' + Math.round(b / 16) * 16;
      counts[key] = (counts[key] || 0) + 1;
    }
    // Ties go to the bucket seen first (same as the server's Map order).
    Object.keys(counts).forEach(function (k) { if (counts[k] > bestN) { bestN = counts[k]; best = k; } });
    if (!best) return null;
    return ensureUsableBrandColor(best.split(',').map(function (v) { return Math.min(255, Number(v)); }));
  }
  function ctaFor(identityHex) {
    var rgb = hexToRgb(identityHex);
    if (!rgb) return AMBER;
    var c = rgbToHsl(rgb);
    return c.h >= 24 && c.h <= 60 && c.s >= 0.6 && c.l >= 0.35 ? TEAL : AMBER;
  }

  root.EnomaBrandColor = {
    AMBER: AMBER, TEAL: TEAL, hexToRgb: hexToRgb,
    ensureUsableBrandColor: ensureUsableBrandColor,
    dominantColorFromPixels: dominantColorFromPixels,
    ctaFor: ctaFor,
  };
})(typeof window !== 'undefined' ? window : globalThis);
