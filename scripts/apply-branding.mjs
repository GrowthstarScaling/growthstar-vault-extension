#!/usr/bin/env node
/**
 * Turns a clean checkout of bitwarden/clients into GROWTHSTAR Vault.
 *
 *   node scripts/apply-branding.mjs <path/to/bitwarden-clients> [--build N]
 *
 * Deterministic and fail-loud: every change is anchored on the exact upstream text it
 * replaces, with the number of hits it expects. If Bitwarden moves or rewords something,
 * the anchor misses, this script exits 1 and lists every miss. It never ships a
 * half-branded build. CI turns that exit into a `needs-coder` issue (docs/UPKEEP.md).
 *
 * Nothing here touches the /bitwarden_license folder, and the build uses the plain
 * (GPL) build scripts, never the build:bit:* ones.
 */
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UP = process.argv[2];
const buildArg = process.argv.indexOf('--build');
const BUILD = buildArg > 0 ? Number(process.argv[buildArg + 1]) : 0;
if (!UP || !existsSync(join(UP, 'apps', 'browser', 'package.json'))) {
  console.error('usage: apply-branding.mjs <path/to/bitwarden-clients> [--build N]');
  process.exit(2);
}
if (!Number.isInteger(BUILD) || BUILD < 0) {
  console.error('--build must be a whole number');
  process.exit(2);
}

const brand = JSON.parse(readFileSync(join(ROOT, 'brand', 'brand.json'), 'utf8'));
const strings = JSON.parse(readFileSync(join(ROOT, 'brand', 'strings.json'), 'utf8'));
const palette = JSON.parse(readFileSync(join(ROOT, 'brand', 'palette.json'), 'utf8'));
const shieldPath = readFileSync(join(ROOT, 'brand', 'shield-path.txt'), 'utf8').trim();
const B = join(UP, 'apps', 'browser', 'src');
const misses = [];
const done = [];

const read = (p) => readFileSync(p, 'utf8');
const rel = (p) => relative(UP, p);

/**
 * Apply [pattern, replacement, expected] edits to one file. `expected` is an exact count
 * (number) or '+' for one or more. Every edit is checked before anything is written.
 */
function patch(file, edits, label) {
  if (!existsSync(file)) {
    misses.push(`${rel(file)}: file is gone (${label})`);
    return;
  }
  let src = read(file);
  let ok = true;
  for (const [pattern, replacement, expected = 1] of edits) {
    const re = typeof pattern === 'string' ? new RegExp(escape(pattern), 'g') : pattern;
    const hits = (src.match(re) || []).length;
    const good = expected === '+' ? hits >= 1 : hits === expected;
    if (!good) {
      misses.push(`${rel(file)}: expected ${expected} of ${re} (${label}), found ${hits}`);
      ok = false;
      continue;
    }
    src = src.replace(re, typeof replacement === 'function' ? replacement : () => replacement);
  }
  if (ok) {
    writeFileSync(file, src);
    done.push(`${rel(file)}  ${label}`);
  }
}
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------------------------------------------------------------- manifests
const version = (() => {
  const v = JSON.parse(read(join(B, 'manifest.v3.json'))).version;
  if (!/^\d+\.\d+\.\d+$/.test(v)) misses.push(`manifest.v3.json: version "${v}" is not a.b.c`);
  return `${v}.${BUILD}`;
})();

for (const name of ['manifest.json', 'manifest.v3.json']) {
  const file = join(B, name);
  const m = JSON.parse(read(file));
  const expect = (cond, what) => cond || misses.push(`${name}: ${what}`);
  expect(m.name === '__MSG_extName__', 'name is no longer __MSG_extName__');
  expect(m.description === '__MSG_extDesc__', 'description is no longer __MSG_extDesc__');
  expect(m.short_name === 'Bitwarden', `short_name changed to "${m.short_name}"`);
  m.short_name = brand.name;
  m.author = brand.author;
  m.homepage_url = brand.homepage;
  m.version = version;
  const action = m.action ?? m.browser_action;
  expect(action?.default_title === 'Bitwarden', 'toolbar button title moved');
  if (action) action.default_title = brand.name;
  for (const k of ['__firefox__sidebar_action', '__opera__sidebar_action']) {
    if (m[k]?.default_title) m[k].default_title = brand.name;
  }
  const gecko = m.__firefox__browser_specific_settings?.gecko;
  expect(gecko?.id, 'Firefox add-on id moved');
  if (gecko) gecko.id = brand.geckoId;
  writeFileSync(file, JSON.stringify(m, null, 2) + '\n');
  done.push(`apps/browser/src/${name}  name, author, homepage, toolbar title, Firefox id, version ${version}`);
}

// ---------------------------------------------------------------- messages, every language
{
  const dir = join(B, '_locales');
  const keep = new Set(strings.keep);
  const custom = strings.custom;
  const en = JSON.parse(read(join(dir, 'en', 'messages.json')));
  for (const k of [...keep, ...Object.keys(custom)]) {
    if (!en[k]) misses.push(`_locales/en: key "${k}" in brand/strings.json no longer exists upstream`);
  }
  let rewritten = 0;
  let removed = 0;
  const locales = readdirSync(dir).filter((d) => existsSync(join(dir, d, 'messages.json')));
  for (const loc of locales) {
    const file = join(dir, loc, 'messages.json');
    const msgs = JSON.parse(read(file));
    for (const [key, entry] of Object.entries(msgs)) {
      if (key in custom) {
        if (loc === 'en') entry.message = custom[key];
        else {
          delete msgs[key];
          removed++;
        }
        continue;
      }
      if (keep.has(key) || typeof entry.message !== 'string') continue;
      // Inflected forms (Bitwardenu, Bitwardena, Bitwardenille) all become the plain name.
      const next = entry.message.replace(/Bitwarden\p{L}*/gu, brand.name);
      if (next !== entry.message) {
        entry.message = next;
        rewritten++;
      }
    }
    writeFileSync(file, JSON.stringify(msgs, null, 2) + '\n');
  }
  const left = Object.entries(JSON.parse(read(join(dir, 'en', 'messages.json'))))
    .filter(([k, e]) => !keep.has(k) && !(k in custom) && /Bitwarden/.test(e.message ?? ''))
    .map(([k]) => k);
  if (left.length) misses.push(`_locales/en still says Bitwarden in: ${left.join(', ')}`);
  done.push(`_locales  ${locales.length} languages, ${rewritten} messages rebranded, ${removed} custom keys left to English`);
}

// ---------------------------------------------------------------- hard-coded names
for (const f of [
  'popup/index.ejs',
  'sidepanel-disabled.html',
  'autofill/notification/bar.html',
  'autofill/overlay/inline-menu/pages/menu-container/menu-container.html',
  'autofill/overlay/inline-menu/pages/button/button.html',
  'autofill/overlay/inline-menu/pages/list/list.html',
  'platform/offscreen-document/index.html',
]) {
  patch(join(B, f), [['<title>Bitwarden', `<title>${brand.name}`, '+']], 'page title');
}
patch(join(B, 'tools/popup/settings/about-dialog/about-dialog.component.html'), [
  ['<div bitDialogTitle>Bitwarden</div>', `<div bitDialogTitle>${brand.name}</div>`],
  [
    /(<p>&copy; Bitwarden Inc\. 2015-\{\{ year \}\}<\/p>)/g,
    (m) =>
      `${m}\n    <p>${brand.attribution} <a href="${brand.sourceUrl}" target="_blank" rel="noreferrer">Source code</a></p>`,
  ],
], 'About box: name, keep the copyright, add attribution and source link');
patch(join(B, 'platform/badge/badge-browser-api.ts'), [['`Bitwarden${', `\`${brand.name}\${`]], 'toolbar tooltip');
patch(join(B, 'autofill/browser/main-context-menu-handler.ts'), [['title: "Bitwarden",', `title: "${brand.name}",`]], 'right-click menu');
patch(join(B, 'dirt/phishing-detection/popup/protected-by-component.html'), [
  ['"Bitwarden phishing blocker"', `"${brand.name} phishing blocker"`],
], 'phishing blocker label');

// ---------------------------------------------------------------- links that left GROWTHSTAR
patch(join(B, 'platform/services/browser-initial-install.service.ts'), [
  ['"https://bitwarden.com/browser-start/"', `"${brand.welcomeUrl}"`],
], 'welcome page after install');
patch(join(UP, 'libs/common/src/vault/utils/get-web-store-url.ts'), [
  [/return "https:\/\/[^"]+";/g, `return "${brand.storeUrl}";`, '+'],
], '"rate us" links');
patch(join(B, 'tools/popup/settings/settings-v2.component.html'), [
  [/\s*<bit-item>\s*<a bit-item-content routerLink="\/more-from-bitwarden"[\s\S]*?<\/bit-item>/g, ''],
], 'remove the "More from Bitwarden" menu item');

// ---------------------------------------------------------------- one server: GROWTHSTAR Vault
patch(join(UP, 'libs/common/src/platform/services/default-environment.service.ts'), [
  [
    'protected buildEnvironment(region: Region, urls: Urls) {',
    `protected buildEnvironment(region: Region, urls: Urls) {
    // GROWTHSTAR Vault: this build only ever talks to one server, whatever is stored.
    region = Region.SelfHosted;
    urls = { base: "${brand.server}" } as Urls;`,
  ],
], 'every environment resolves to the GROWTHSTAR server');

// ---------------------------------------------------------------- logo and in-page shield
{
  const b64 = (f) => readFileSync(join(ROOT, 'brand', 'logo', f)).toString('base64');
  const logo = `
  <svg viewBox="0 0 290 36" xmlns="http://www.w3.org/2000/svg">
    <title>${brand.name}</title>
    <style>.gs-on-dark{display:none}.theme_dark .gs-on-light{display:none}.theme_dark .gs-on-dark{display:inline}</style>
    <image class="gs-on-light" width="290" height="36" href="data:image/png;base64,${b64('logo-on-light.png')}" />
    <image class="gs-on-dark" width="290" height="36" href="data:image/png;base64,${b64('logo-on-dark.png')}" />
  </svg>
`;
  if (/\$\{|`/.test(logo)) misses.push('logo markup contains ` or ${, which svg`` forbids');
  for (const [f, name] of [
    ['bitwarden-logo.icon.ts', 'BitwardenLogo'],
    ['bitwarden-logo-beta.icon.ts', 'BitwardenLogoBeta'],
  ]) {
    patch(join(UP, 'libs/assets/src/svg/svgs', f), [
      [new RegExp(`(export const ${name} = svg\`)[\\s\\S]*?(\`;)`, 'g'), (_m, a, z) => `${a}${logo}${z}`],
    ], 'logo');
  }
  const icon = (w, h, extra = '') =>
    `'<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 14 16" fill="none"><path fill="${brand.colors.vault}" fill-rule="evenodd" d="${shieldPath}"/>${extra}</svg>'`;
  const lockBadge = `<circle cx="11" cy="12.5" r="3.4" fill="${brand.colors.cream}"/><path d="M9.9 12.3v-.9a1.1 1.1 0 0 1 2.2 0v.9" stroke="${brand.colors.cocoa}" stroke-width=".8" fill="none"/><rect x="9.4" y="12.2" width="3.2" height="2.3" rx=".4" fill="${brand.colors.cocoa}"/>`;
  patch(join(B, 'autofill/utils/svg-icons.ts'), [
    [/export const logoIcon =\s*'[^']*';/g, `export const logoIcon =\n  ${icon(14, 14)};`],
    [/export const logoLockedIcon =\s*'[^']*';/g, `export const logoLockedIcon =\n  ${icon(16, 16, lockBadge)};`],
  ], 'autofill button icons');
  patch(join(B, 'autofill/content/components/icons/shield.ts'), [
    [/d="M13\.469\.2A[^"]*"/g, `fill-rule="evenodd" d="${shieldPath}"`],
  ], 'notification bar shield');
}

// ---------------------------------------------------------------- colour
{
  const hex = (v) => '#' + v.map((n) => n.toString(16).padStart(2, '0')).join('');
  const tri = (v) => v.join(' ');
  const theme = read(join(UP, 'libs/components/src/tw-theme.css'));
  const has = (name) => theme.includes(`${name}:`);
  const lines = ['', '/* ---- GROWTHSTAR Vault colours (brand/palette.json, luminance-matched to the vendor scale) ---- */', ':root {'];
  for (const [k, v] of Object.entries(palette.brand)) lines.push(`  --color-brand-${k}: ${hex(v)};`);
  for (const [k, v] of Object.entries(palette.gray)) lines.push(`  --color-gray-${k}: ${hex(v)};`);
  for (const scale of ['brand', 'gray']) {
    for (const [k, v] of Object.entries(palette[scale])) {
      if (has(`--color-${scale}-${k}-rgb`)) lines.push(`  --color-${scale}-${k}-rgb: ${v.join(', ')};`);
    }
  }
  lines.push('}', ':root:not(.theme_dark) {');
  for (const [k, v] of Object.entries(palette.root)) if (has(`--color-${k}`)) lines.push(`  --color-${k}: ${tri(v)};`);
  lines.push('}', ':root.theme_dark {');
  for (const [k, v] of Object.entries(palette.dark)) if (has(`--color-${k}`)) lines.push(`  --color-${k}: ${tri(v)};`);
  lines.push('}', '/* One server only, so no server picker. */', 'environment-selector { display: none !important; }', '');
  const css = join(B, 'popup/scss/tailwind.css');
  if (!existsSync(css)) misses.push('popup/scss/tailwind.css is gone');
  else {
    writeFileSync(css, read(css) + lines.join('\n'));
    done.push('apps/browser/src/popup/scss/tailwind.css  palette + hide server picker');
  }

  // The in-page pop-ups (autofill menu, save bar) keep their own copy of the legacy colours.
  // Map each vendor value to ours by the token that carries it in tw-theme.css.
  const block = (sel) => {
    const i = theme.indexOf(`${sel} {`);
    return i < 0 ? '' : theme.slice(i, theme.indexOf('\n}', i));
  };
  const vendorTokens = (text) =>
    Object.fromEntries([...text.matchAll(/--color-([a-z0-9-]+):\s*(\d+) (\d+) (\d+);/g)].map((m) => [m[1], `${m[2]}, ${m[3]}, ${m[4]}`]));
  const mapFor = (vendor, ours) => {
    const map = {};
    for (const [token, v] of Object.entries(vendor)) if (ours[token] && !(v in map)) map[v] = ours[token].join(', ');
    return map;
  };
  const lightMap = mapFor(vendorTokens(block(':root')), palette.root);
  const darkMap = mapFor(vendorTokens(block('.theme_dark')), palette.dark);
  const stylesFile = join(B, 'autofill/content/components/constants/styles.ts');
  if (!existsSync(stylesFile)) misses.push('autofill styles.ts is gone');
  else {
    const src = read(stylesFile);
    const cut = src.indexOf('const darkTheme');
    if (cut < 0 || !src.includes('const lightTheme')) misses.push('autofill styles.ts: lightTheme/darkTheme moved');
    else {
      let swaps = 0;
      const recolour = (part, map) =>
        part.replace(/rgba\((\d+), (\d+), (\d+)\)/g, (m, r, g, b) => {
          const to = map[`${r}, ${g}, ${b}`];
          if (!to) return m;
          swaps++;
          return `rgba(${to})`;
        });
      const out = recolour(src.slice(0, cut), lightMap) + recolour(src.slice(cut), darkMap);
      if (swaps < 20) misses.push(`autofill styles.ts: only ${swaps} colours matched the palette, expected 20+`);
      else {
        writeFileSync(stylesFile, out);
        done.push(`apps/browser/src/autofill/content/components/constants/styles.ts  ${swaps} colours`);
      }
    }
  }
}

// ---------------------------------------------------------------- toolbar and store icons
{
  const src = join(ROOT, 'brand', 'icons');
  const dst = join(B, 'images');
  const ours = readdirSync(src).filter((f) => /^(icon|berry)\d/.test(f));
  const theirs = readdirSync(dst).filter((f) => /^(icon|berry)\d.*\.png$/.test(f) && !f.includes('safari'));
  const missing = theirs.filter((f) => !ours.includes(f));
  if (missing.length) misses.push(`brand/icons has no replacement for upstream ${missing.join(', ')}`);
  for (const f of ours) {
    if (!existsSync(join(dst, f))) misses.push(`upstream no longer has images/${f}`);
    else copyFileSync(join(src, f), join(dst, f));
  }
  done.push(`apps/browser/src/images  ${ours.length} icons`);
}

// ---------------------------------------------------------------- report
for (const d of done) console.log(`  ok    ${d}`);
if (misses.length) {
  console.error(`\nGROWTHSTAR branding FAILED on ${misses.length} anchor(s). Upstream moved something;`);
  console.error('see docs/UPKEEP.md. Nothing below was guessed at:\n');
  for (const m of misses) console.error(`  MISS  ${m}`);
  process.exit(1);
}
writeFileSync(join(UP, '.growthstar-version'), `${version}\n`);
console.log(`\nGROWTHSTAR Vault ${version} branding applied.`);
