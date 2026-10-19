// Builds icon.svg: the Munson Labs mark in its "Tile" scheme, with a git branch cut into the seal, the way each
// package gets its own seal glyph (▲ Labs, >_ Shipkit, ▶ Video Player…). The drawing follows `mark()` in
// munsonlabs/packages docs/public/brand/brand-sheet.html. Run `npm run icon`.
import { writeFileSync } from 'node:fs'

const C = { cream: '#f8f1e1', gold: '#e2a32e', g600: '#22784d', g700: '#1d603f', g800: '#1a4d34' }

const LETTER = 'M7 24V14.5a4.5 4.5 0 0 1 9 0V24M16 14.5a4.5 4.5 0 0 1 9 0V18.4'

/** The new seal glyph: a git branch, two commits on a line and one branching off, sized like the other seals. */
const GIT_GLYPH = [
  ['line', 'M25.6 3.6V6.6'],
  ['line', 'M28.2 4.1C28.2 5.3 25.6 5 25.6 6.2'],
  ['solid', 'M25.6 2.6A.85 .85 0 1 0 25.6 4.3A.85 .85 0 1 0 25.6 2.6Z'],
  ['solid', 'M25.6 6.1A.85 .85 0 1 0 25.6 7.8A.85 .85 0 1 0 25.6 6.1Z'],
  ['solid', 'M28.2 2.9A.85 .85 0 1 0 28.2 4.6A.85 .85 0 1 0 28.2 2.9Z'],
]

const cut = GIT_GLYPH.map(([kind, d]) =>
  kind === 'line'
    ? `<path d="${d}" fill="none" stroke="#000" stroke-width=".9" stroke-linecap="round" stroke-linejoin="round"/>`
    : `<path d="${d}" fill="#000"/>`,
).join('')

// The Tile scheme from the brand sheet.
const ink = C.cream
const halo = C.g800
const shadow = C.gold
const stripes = [C.g700, C.g600, C.g700]

const glyph = (col, w = 5.2, r = 2.7) =>
  `<path d="${LETTER}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/><circle cx="25" cy="24.1" r="${r}" fill="${col}"/>`
const haloGlyph = () => glyph(halo, 8, 4.1)
const off = (x, y, body) => `<g transform="translate(${x} ${y})">${body}</g>`

const mark = `
  <defs>
    <clipPath id="tile"><rect width="32" height="32" rx="7"/></clipPath>
    <mask id="punch" maskUnits="userSpaceOnUse" x="0" y="0" width="32" height="32">
      <rect x="23.4" y="1.6" width="7" height="7" rx="1.3" fill="#fff"/>${cut}
    </mask>
  </defs>
  <g clip-path="url(#tile)">
    <rect width="32" height="32" fill="${C.g800}"/>
    ${stripes.map((c, i) => `<rect y="${9 + i * 5.3}" width="32" height="3.4" fill="${c}"/>`).join('')}
    <g transform="rotate(-8 16 16) translate(-0.9 -1.9)">
      ${off(1.8, 1.8, haloGlyph())}${haloGlyph()}${off(1.8, 1.8, glyph(shadow))}${glyph(ink)}
    </g>
  </g>
  <g transform="translate(-1.6 1.6)">
    <!-- The seal sits over the letter here, so a backing in the scheme's seal ink keeps the cut glyph one colour. -->
    <rect x="23.4" y="1.6" width="7" height="7" rx="1.3" fill="${C.g800}"/>
    <rect x="23.4" y="1.6" width="7" height="7" rx="1.3" fill="${C.gold}" mask="url(#punch)"/>
  </g>`

// A macOS app icon: the 32-unit tile scaled into the standard 824px rounded square, with a soft drop shadow.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="20"/></filter>
  </defs>
  <rect x="112" y="126" width="800" height="800" rx="180" fill="#000" opacity="0.4" filter="url(#shadow)"/>
  <g transform="translate(100 100) scale(25.75)">${mark}
  </g>
</svg>
`

writeFileSync(new URL('../icon.svg', import.meta.url), svg)
// The bare tile for use inside the app, e.g. on the empty state.
writeFileSync(new URL('../src/assets/logo.svg', import.meta.url), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${mark}\n</svg>\n`)
console.log('wrote icon.svg and src/assets/logo.svg')
