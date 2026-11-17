// api/_lib/trade-scenes.js
// Page v2's hero picture when a business has no photos yet: one flat,
// clearly-drawn scene per trade. Simple shapes on a 400x300 grid, recolored
// through the kit's CSS variables on the page (--kit-identity, --kit-accent,
// --kit-cta), or through literal hex colors for the share image (@vercel/og
// can't read CSS variables). Original drawings made for Enoma.

const VARS = { I: "var(--kit-identity)", A: "var(--kit-accent)", C: "var(--kit-cta)", D: "var(--kit-identity-deep)" };

// Neutrals shared by every scene.
const N = { wall: "#f4f1ec", wall2: "#e9e4dc", line: "#cfc7bb", ink: "#3a3530", white: "#ffffff", sky: "#eef3f7", ground: "#dcd6cc" };

const SCENES = {
  // Cathedral ceiling half repainted, roller on an extension pole, ladder.
  painting: `
    <rect width="400" height="300" fill="${N.wall}"/>
    <path d="M0 120 L200 20 L400 120 L400 300 L0 300 Z" fill="${N.wall2}"/>
    <path d="M0 120 L200 20 L200 300 L0 300 Z" fill="{A}" opacity=".55"/>
    <path d="M0 120 L200 20 L400 120" fill="none" stroke="${N.line}" stroke-width="4"/>
    <line x1="200" y1="20" x2="200" y2="300" stroke="${N.line}" stroke-width="2" stroke-dasharray="6 8"/>
    <rect x="0" y="262" width="400" height="38" fill="${N.ground}"/>
    <g stroke="${N.ink}" stroke-width="5" stroke-linecap="round">
      <line x1="300" y1="262" x2="262" y2="120"/><line x1="340" y1="262" x2="302" y2="120"/>
      <line x1="292" y1="230" x2="331" y2="230"/><line x1="284" y1="200" x2="323" y2="200"/>
      <line x1="276" y1="170" x2="315" y2="170"/><line x1="268" y1="142" x2="307" y2="142"/>
    </g>
    <line x1="120" y1="262" x2="196" y2="72" stroke="${N.ink}" stroke-width="5" stroke-linecap="round"/>
    <rect x="168" y="52" width="58" height="22" rx="10" transform="rotate(-22 197 63)" fill="{C}"/>
    <rect x="70" y="244" width="44" height="18" rx="3" fill="{I}"/>
    <rect x="70" y="240" width="44" height="6" rx="2" fill="{D}"/>`,

  // Striped lawn, mower, shrubs.
  landscaping: `
    <rect width="400" height="300" fill="${N.sky}"/>
    <rect x="0" y="140" width="400" height="160" fill="{I}"/>
    ${[0, 1, 2, 3, 4, 5, 6, 7].map(i => `<path d="M${i * 60 - 40} 300 L${i * 60 + 20} 140 L${i * 60 + 50} 140 L${i * 60 - 10} 300 Z" fill="{A}" opacity=".28"/>`).join("")}
    <circle cx="40" cy="138" r="34" fill="{D}"/><circle cx="92" cy="146" r="26" fill="{D}"/>
    <circle cx="352" cy="136" r="38" fill="{D}"/>
    <g transform="translate(200 196)">
      <rect x="-46" y="0" width="92" height="40" rx="10" fill="{C}"/>
      <rect x="-30" y="-8" width="40" height="14" rx="5" fill="${N.ink}"/>
      <line x1="30" y1="4" x2="78" y2="-58" stroke="${N.ink}" stroke-width="6" stroke-linecap="round"/>
      <line x1="66" y1="-62" x2="90" y2="-50" stroke="${N.ink}" stroke-width="6" stroke-linecap="round"/>
      <circle cx="-30" cy="42" r="13" fill="${N.ink}"/><circle cx="32" cy="42" r="13" fill="${N.ink}"/>
      <circle cx="-30" cy="42" r="5" fill="${N.white}"/><circle cx="32" cy="42" r="5" fill="${N.white}"/>
    </g>`,

  // Plowed driveway, plow blade.
  snow: `
    <rect width="400" height="300" fill="{D}"/>
    <path d="M0 150 L120 90 L240 150 Z" fill="{I}"/><rect x="30" y="150" width="180" height="90" fill="{I}"/>
    <rect x="96" y="180" width="48" height="60" fill="{A}" opacity=".7"/>
    <path d="M0 240 Q200 220 400 240 L400 300 L0 300 Z" fill="${N.white}"/>
    <path d="M150 300 L210 240 L290 240 L330 300 Z" fill="${N.ground}"/>
    <g transform="translate(300 214)">
      <path d="M-70 26 L-62 -8 L-40 -8 L-40 26 Z" fill="{C}"/>
      <rect x="-38" y="-30" width="76" height="46" rx="8" fill="{C}"/>
      <rect x="-20" y="-24" width="30" height="20" rx="4" fill="${N.sky}"/>
      <circle cx="-20" cy="22" r="12" fill="${N.ink}"/><circle cx="22" cy="22" r="12" fill="${N.ink}"/>
    </g>
    ${[[40, 40], [90, 70], [180, 30], [260, 60], [340, 36], [370, 110], [60, 120]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4" fill="${N.white}" opacity=".85"/>`).join("")}`,

  // Under-sink pipes, wrench.
  plumbing: `
    <rect width="400" height="300" fill="${N.wall}"/>
    <rect x="60" y="40" width="280" height="40" rx="6" fill="{I}"/>
    <rect x="70" y="80" width="260" height="190" rx="8" fill="${N.wall2}" stroke="${N.line}" stroke-width="3"/>
    <rect x="150" y="80" width="100" height="18" rx="4" fill="${N.line}"/>
    <path d="M200 98 L200 150 Q200 180 230 180 L262 180 Q280 180 280 162 L280 150" fill="none" stroke="{A}" stroke-width="16" stroke-linecap="round"/>
    <path d="M170 98 L170 270" stroke="{D}" stroke-width="14"/>
    <rect x="160" y="190" width="20" height="16" rx="3" fill="{C}"/>
    <g transform="rotate(-30 270 236)">
      <rect x="196" y="228" width="110" height="16" rx="8" fill="${N.ink}"/>
      <path d="M300 220 a20 20 0 1 1 0 32 l-12 -8 l0 -16 z" fill="${N.ink}"/>
    </g>`,

  // Condenser unit, thermostat.
  hvac: `
    <rect width="400" height="300" fill="${N.sky}"/>
    <rect x="0" y="0" width="210" height="300" fill="${N.wall}"/>
    <rect x="60" y="80" width="88" height="120" rx="14" fill="${N.white}" stroke="${N.line}" stroke-width="3"/>
    <circle cx="104" cy="128" r="30" fill="none" stroke="{I}" stroke-width="8"/>
    <rect x="80" y="172" width="48" height="10" rx="5" fill="{C}"/>
    <rect x="0" y="262" width="400" height="38" fill="${N.ground}"/>
    <rect x="236" y="150" width="140" height="112" rx="8" fill="{I}"/>
    ${[0, 1, 2, 3, 4, 5, 6].map(i => `<line x1="${250 + i * 18}" y1="164" x2="${250 + i * 18}" y2="248" stroke="{D}" stroke-width="4"/>`).join("")}
    <circle cx="306" cy="206" r="34" fill="{D}"/>
    <path d="M306 206 L306 178 M306 206 L330 220 M306 206 L282 220" stroke="{A}" stroke-width="6" stroke-linecap="round"/>`,

  // Sparkling window, spray bottle.
  cleaning: `
    <rect width="400" height="300" fill="${N.wall}"/>
    <rect x="70" y="40" width="200" height="200" rx="8" fill="${N.white}" stroke="{I}" stroke-width="10"/>
    <rect x="80" y="50" width="180" height="180" fill="${N.sky}"/>
    <line x1="170" y1="40" x2="170" y2="240" stroke="{I}" stroke-width="8"/>
    <line x1="70" y1="140" x2="270" y2="140" stroke="{I}" stroke-width="8"/>
    <path d="M100 70 L140 70 L100 110 Z" fill="${N.white}" opacity=".9"/>
    <path d="M220 168 l6 16 16 6 -16 6 -6 16 -6 -16 -16 -6 16 -6 z" fill="{A}"/>
    <path d="M120 170 l4 10 10 4 -10 4 -4 10 -4 -10 -10 -4 10 -4 z" fill="{A}"/>
    <g transform="translate(320 170)">
      <rect x="-26" y="10" width="52" height="96" rx="12" fill="{C}"/>
      <rect x="-14" y="-12" width="28" height="24" rx="4" fill="{D}"/>
      <path d="M-14 -12 L-44 -12 L-44 0 L-14 0" fill="{D}"/>
      <rect x="-14" y="40" width="28" height="30" rx="4" fill="${N.white}" opacity=".6"/>
    </g>`,

  // Panel, outlet.
  electrical: `
    <rect width="400" height="300" fill="${N.wall}"/>
    <rect x="60" y="40" width="160" height="220" rx="10" fill="{I}"/>
    <rect x="76" y="56" width="128" height="188" rx="6" fill="{D}"/>
    ${[0, 1, 2, 3, 4, 5].map(i => `<rect x="90" y="${70 + i * 28}" width="44" height="16" rx="3" fill="${N.white}"/><rect x="146" y="${70 + i * 28}" width="44" height="16" rx="3" fill="${i === 2 ? "{C}" : N.white}"/>`).join("")}
    <rect x="270" y="120" width="76" height="110" rx="12" fill="${N.white}" stroke="${N.line}" stroke-width="3"/>
    <rect x="290" y="140" width="10" height="22" rx="3" fill="${N.ink}"/><rect x="316" y="140" width="10" height="22" rx="3" fill="${N.ink}"/>
    <rect x="290" y="186" width="10" height="22" rx="3" fill="${N.ink}"/><rect x="316" y="186" width="10" height="22" rx="3" fill="${N.ink}"/>
    <path d="M318 40 L296 92 L314 92 L304 120 L336 72 L318 72 L328 40 Z" fill="{A}"/>`,

  // House frame.
  contractor: `
    <rect width="400" height="300" fill="${N.sky}"/>
    <rect x="0" y="250" width="400" height="50" fill="${N.ground}"/>
    <g stroke="{I}" stroke-width="8" stroke-linecap="round" fill="none">
      <path d="M70 250 L70 140 L200 50 L330 140 L330 250"/>
      <line x1="70" y1="140" x2="330" y2="140"/>
      ${[110, 150, 250, 290].map(x => `<line x1="${x}" y1="140" x2="${x}" y2="250"/>`).join("")}
      <line x1="200" y1="50" x2="200" y2="140"/>
      <line x1="135" y1="95" x2="135" y2="140"/><line x1="265" y1="95" x2="265" y2="140"/>
    </g>
    <rect x="176" y="176" width="48" height="74" fill="{A}" opacity=".6"/>
    <rect x="40" y="238" width="80" height="12" rx="3" fill="{C}"/>
    <rect x="290" y="226" width="24" height="24" rx="3" fill="{D}"/>`,
};

export const SCENE_KEYS = Object.keys(SCENES);

/**
 * The scene's SVG. colors: null → the page's CSS variables; or
 * { identity, accent, cta, deep } as hex for places that can't read CSS.
 */
export function sceneSvg(key, colors = null, { title = "" } = {}) {
  const body = SCENES[key] || SCENES.contractor;
  const fill = colors
    ? { I: colors.identity, A: colors.accent, C: colors.cta, D: colors.deep || colors.identity }
    : VARS;
  const svg = body.replace(/\{([IACD])\}/g, (_, k) => fill[k]);
  const label = title ? ` role="img" aria-label="${String(title).replace(/[<>&"]/g, "")}"` : ` aria-hidden="true"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" class="v2-scene"${label}>${svg}</svg>`;
}

/** As a data: URL (share image). */
export function sceneDataUrl(key, colors) {
  return `data:image/svg+xml;base64,${Buffer.from(sceneSvg(key, colors)).toString("base64")}`;
}
