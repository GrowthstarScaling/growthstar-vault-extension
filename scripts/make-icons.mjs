/**
 * Draws every GROWTHSTAR Vault icon the extension ships, from the suite's own mark recipe
 * (growthstar-suite-web scripts/make-marks.mjs): cocoa tile, Vault's sage starburst, the
 * shield-and-keyhole glyph in cream and sage.
 *
 * Run once when the art changes; the PNGs are committed, so CI never needs this script.
 *
 *   node scripts/make-icons.mjs [path/to/growthstar-suite-web]
 *
 * Writes brand/icons/ with the exact file names apps/browser/src/images uses, for every
 * state the toolbar shows: normal, _gray (signed out), _locked (padlock), berry (alert dot),
 * and the _beta copies so no Bitwarden art is left in a package.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SUITE = process.argv[2] ?? join(ROOT, '..', 'growthstar-suite-web');
const sharp = createRequire(join(SUITE, 'package.json'))('sharp');
const OUT = join(ROOT, 'brand', 'icons');

const C = {
  cocoa: '#221710',
  cocoaSoft: '#3f2c21',
  cream: '#f3e8d6',
  vault: '#57928a', // suite.ts, slug 'vault'
  berry: '#c21e63', // suite.ts, slug 'design' (dragon fruit): the alert dot
  grayFacet: '#8f8a84',
  grayRays: '#8f8a84',
};

// glyphs.ts, slug 'vault', on a 120 grid.
const GLYPH = [
  ['facet', 'polygon', { points: '60,35 38,43 40,66 60,85' }],
  ['body', 'polygon', { points: '60,35 82,43 80,66 60,85 40,66 38,43' }],
  ['line', 'path', { d: 'M60 35 V47 M60 70 V85' }],
  ['solid', 'circle', { cx: '60', cy: '54', r: '5' }],
  ['solid', 'polygon', { points: '57.5,57 62.5,57 64.5,68 55.5,68' }],
];

function rays(color) {
  const src = readFileSync(join(SUITE, 'public', 'brand', 'growthstar-rays.svg'), 'utf8');
  const inner = src.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  const viewBox = src.match(/viewBox="([^"]+)"/)[1];
  if (!inner.includes('fill="#000000"')) throw new Error('growthstar-rays.svg changed shape');
  return { inner: inner.replaceAll('fill="#000000"', `fill="${color}"`), viewBox };
}

const attrs = (o) =>
  Object.entries(o)
    .map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}="${v}"`)
    .join(' ');

function paint(role, facet, stroke) {
  if (role === 'facet') return { fill: facet };
  if (role === 'solid') return { fill: C.cream };
  return { fill: 'none', stroke: C.cream, strokeWidth: stroke, strokeLinejoin: 'round', strokeLinecap: 'round' };
}

/**
 * One icon. Small toolbar sizes drop the starburst and draw the glyph bigger with a heavier
 * stroke, because 45%-opacity needles turn to mud at 16-38 px.
 */
function iconSvg(size, { gray = false, badge = null, logical = size } = {}) {
  const small = logical <= 38;
  const facet = gray ? C.grayFacet : C.vault;
  const scale = small ? 1.5 : 0.65;
  const stroke = small ? 4.4 : 3.2;
  const shift = 60 - 60 * scale;
  const r = size * 0.217;
  const ordered = [
    ...GLYPH.filter((e) => e[0] === 'facet'),
    ...GLYPH.filter((e) => e[0] === 'body'),
    ...GLYPH.filter((e) => e[0] !== 'facet' && e[0] !== 'body'),
  ];
  const body = ordered.map(([role, tag, a]) => `<${tag} ${attrs(a)} ${attrs(paint(role, facet, stroke))} />`).join('');
  const ray = rays(gray ? C.grayRays : C.vault);
  const inset = size * 0.05;
  const burst = small
    ? ''
    : `<svg x="${inset}" y="${inset}" width="${size - 2 * inset}" height="${size - 2 * inset}" viewBox="${ray.viewBox}" opacity="0.45">${ray.inner}</svg>`;
  const tileTop = gray ? '#5a5550' : C.cocoaSoft;
  const tileBottom = gray ? '#3d3935' : C.cocoa;

  let badgeSvg = '';
  if (badge === 'lock') {
    // Padlock on a cream disc, bottom right, like the vendor's locked state.
    const d = size * 0.5, cx = size - d / 2, cy = size - d / 2;
    badgeSvg = `<circle cx="${cx}" cy="${cy}" r="${d / 2}" fill="${C.cream}" />
      <g transform="translate(${cx - d * 0.25} ${cy - d * 0.3}) scale(${d / 24})">
        <path d="M3 9 V6.5 A3 3 0 0 1 9 6.5 V9" fill="none" stroke="${C.cocoa}" stroke-width="2.2" stroke-linecap="round" />
        <rect x="0.5" y="8.5" width="11" height="8.5" rx="1.6" fill="${C.cocoa}" />
      </g>`;
  } else if (badge === 'berry') {
    const d = size * 0.42;
    badgeSvg = `<circle cx="${size - d / 2 - size * 0.02}" cy="${size - d / 2 - size * 0.02}" r="${d / 2}" fill="${C.berry}" stroke="${C.cream}" stroke-width="${size * 0.05}" />`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${tileTop}" /><stop offset="1" stop-color="${tileBottom}" /></linearGradient>
    <clipPath id="c"><rect width="${size}" height="${size}" rx="${r}" ry="${r}" /></clipPath>
  </defs>
  <g clip-path="url(#c)">
    <rect width="${size}" height="${size}" fill="url(#t)" />
    ${burst}
    <svg x="0" y="0" width="${size}" height="${size}" viewBox="0 0 120 120"><g transform="translate(${shift} ${shift}) scale(${scale})">${body}</g></svg>
  </g>
  ${badgeSvg}
</svg>`;
}

async function png(name, size, opts) {
  // Render at 4x and scale down, so thin strokes anti-alias instead of vanishing.
  const svg = iconSvg(size * 4, { ...opts, logical: size });
  const buf = await sharp(Buffer.from(svg)).resize(size, size).png({ compressionLevel: 9 }).toBuffer();
  writeFileSync(join(OUT, name), buf);
}

mkdirSync(OUT, { recursive: true });
const jobs = [];
for (const beta of ['', '_beta']) {
  for (const s of [16, 19, 32, 38, 48, 96, 128]) {
    jobs.push(png(`icon${s}${beta}.png`, s));
    jobs.push(png(`icon${s}_gray${beta}.png`, s, { gray: true }));
  }
  for (const s of [19, 38]) jobs.push(png(`icon${s}_locked${beta}.png`, s, { badge: 'lock' }));
}
for (const s of [19, 38]) jobs.push(png(`berry${s}.png`, s, { badge: 'berry' }));
// Store listing icon and a big preview for eyeballing.
jobs.push(png('store-icon-128.png', 128));
jobs.push(png('preview-512.png', 512));
await Promise.all(jobs);
console.log(`wrote ${jobs.length} icons to brand/icons/`);

// The small in-page shield (autofill button, notification bar), as path data for a 14x16 box.
// Outline and keyhole in one evenodd path, so a single fill colour paints it.
const sx = 14 / 46, sy = 16 / 52, ox = 37, oy = 34;
const P = (x, y) => `${((x - ox) * sx).toFixed(2)} ${((y - oy) * sy).toFixed(2)}`;
const outline = `M${P(60, 35)} L${P(82, 43)} L${P(80, 66)} L${P(60, 85)} L${P(40, 66)} L${P(38, 43)} Z`;
const hole = `M${P(60, 49)} A${(5 * sx).toFixed(2)} ${(5 * sy).toFixed(2)} 0 1 0 ${P(60.01, 49)} Z M${P(57.5, 57)} L${P(62.5, 57)} L${P(64.5, 68)} L${P(55.5, 68)} Z`;
writeFileSync(join(ROOT, 'brand', 'shield-path.txt'), `${outline} ${hole}\n`);
console.log('wrote brand/shield-path.txt');
