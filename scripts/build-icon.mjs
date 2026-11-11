// Builds the logos: the Munson Labs M, upright and sharp-cornered with an outline, on a flat tile. One a colourway
// in src/assets/logos (picked in Settings), and icon.svg, the app's icon, from the first. Run `npm run icon`.
import { writeFileSync } from 'node:fs'

const C = { cream: '#f8f1e1', gold: '#e2a32e', g600: '#22784d', g700: '#1d603f', g800: '#1a4d34', ink: '#1c1b19' }

/** Keep in step with LOGOS in src/composables/logo.ts. */
const SCHEMES = {
  green: { tile: C.g700, letter: C.cream, edge: C.gold },
  ink: { tile: C.ink, letter: C.cream, edge: C.gold },
}

// The M as an outline, so the gold around it is one stroke of even width.
const LETTER = 'M4.4 24.5V3.4H8.08L16 11.32L23.92 3.4H27.6V18.6H22.4V12.28L16 18.68L9.6 12.28V24.5Z'
const SCALE = 0.87
// Kept the same width on the tile whatever the letter's size.
const EDGE = 1.2 / SCALE

const glyph = (col, grow) =>
  `<path d="${LETTER}" fill="${col}" stroke="${col}" stroke-width="${grow * 2}"/><circle cx="25" cy="22.6" r="${2.6 + grow}" fill="${col}"/>`

const mark = ({ tile, letter, edge }) => `
  <rect width="32" height="32" rx="7" fill="${tile}"/>
  <g transform="translate(16 16) scale(${SCALE}) translate(-16 -14.3)">${glyph(edge, EDGE)}${glyph(letter, 0)}</g>`

// The logo before this one: the M rounded and tilted, on striped green, with a git branch cut into a gold seal.
const OLD_LETTER = 'M7 24V14.5a4.5 4.5 0 0 1 9 0V24M16 14.5a4.5 4.5 0 0 1 9 0V18.4'

/** The seal glyph: a git branch, two commits on a line and one branching off, sized like the other seals. */
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

const oldGlyph = (col, w = 5.2, r = 2.7) =>
  `<path d="${OLD_LETTER}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/><circle cx="25" cy="24.1" r="${r}" fill="${col}"/>`
const haloGlyph = () => oldGlyph(halo, 8, 4.1)
const off = (x, y, body) => `<g transform="translate(${x} ${y})">${body}</g>`

const classic = `
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
      ${off(1.8, 1.8, haloGlyph())}${haloGlyph()}${off(1.8, 1.8, oldGlyph(shadow))}${oldGlyph(ink)}
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
  <g transform="translate(100 100) scale(25.75)">${mark(SCHEMES.green)}
  </g>
</svg>
`

writeFileSync(new URL('../icon.svg', import.meta.url), svg)
// The bare tiles, for inside the app and (drawn by the app itself) the Dock.
const tiles = { ...Object.fromEntries(Object.entries(SCHEMES).map(([id, scheme]) => [id, mark(scheme)])), classic }
for (const [id, tile] of Object.entries(tiles))
  writeFileSync(
    new URL(`../src/assets/logos/${id}.svg`, import.meta.url),
    `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 32 32">${tile}\n</svg>\n`,
  )
console.log('wrote icon.svg and src/assets/logos')
