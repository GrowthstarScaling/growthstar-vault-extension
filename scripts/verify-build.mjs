#!/usr/bin/env node
/**
 * Checks a finished extension build before it can be released. Fail-loud, like the
 * branding script: any check that fails exits 1 and CI opens a `needs-coder` issue.
 *
 *   node scripts/verify-build.mjs <apps/browser/build> [--firefox]
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2];
const firefox = process.argv.includes('--firefox');
if (!OUT || !existsSync(join(OUT, 'manifest.json'))) {
  console.error('usage: verify-build.mjs <apps/browser/build> [--firefox]');
  process.exit(2);
}
const brand = JSON.parse(readFileSync(join(ROOT, 'brand', 'brand.json'), 'utf8'));
const strings = JSON.parse(readFileSync(join(ROOT, 'brand', 'strings.json'), 'utf8'));
const fails = [];
const oks = [];
const check = (cond, ok, fail) => (cond ? oks.push(ok) : fails.push(fail));

function* files(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) yield* files(p);
    else yield p;
  }
}
const all = [...files(OUT)];
const text = all.filter((p) => /\.(js|html|json|css)$/.test(p));

// Manifest
const m = JSON.parse(readFileSync(join(OUT, 'manifest.json'), 'utf8'));
check(m.name === '__MSG_extName__', 'manifest name comes from the messages', `manifest name is "${m.name}"`);
check(m.short_name === brand.name, `short name "${brand.name}"`, `short_name is "${m.short_name}"`);
check(m.author === brand.author && m.homepage_url === brand.homepage, 'author and homepage', 'author or homepage is not GROWTHSTAR');
check(/^\d+\.\d+\.\d+\.\d+$/.test(m.version), `version ${m.version}`, `version "${m.version}" is not a.b.c.d`);
const title = (m.action ?? m.browser_action)?.default_title;
check(title === brand.name, 'toolbar title', `toolbar title is "${title}"`);
if (firefox) {
  const id = m.browser_specific_settings?.gecko?.id;
  check(id === brand.geckoId, `Firefox id ${id}`, `Firefox id is "${id}", Bitwarden's own id would clash`);
}

// Messages
const en = JSON.parse(readFileSync(join(OUT, '_locales', 'en', 'messages.json'), 'utf8'));
check(en.extName?.message === brand.name, 'store name GROWTHSTAR Vault', `extName is "${en.extName?.message}"`);
const allowed = new Set([...strings.keep, ...Object.keys(strings.custom)]);
const stray = Object.entries(en).filter(([k, e]) => !allowed.has(k) && /Bitwarden/.test(e.message ?? '')).map(([k]) => k);
check(!stray.length, 'no stray Bitwarden in English messages', `English messages still say Bitwarden: ${stray.join(', ')}`);

// Pages, links, server, licence
const hit = (needle) => text.filter((p) => readFileSync(p, 'utf8').includes(needle));
check(!hit('<title>Bitwarden').length, 'no page titled Bitwarden', `pages titled Bitwarden: ${hit('<title>Bitwarden').join(', ')}`);
check(!hit('bitwarden.com/browser-start').length, 'install opens the GROWTHSTAR page', 'install still opens bitwarden.com/browser-start');
check(hit(brand.server).length > 0, `server ${brand.server} is built in`, `${brand.server} is not in the build`);
const commercial = hit('commercial-sdk-internal').concat(hit('bitwarden_license/'));
check(!commercial.length, 'no Bitwarden-licensed (commercial) code in the build', `commercial code found in: ${commercial.join(', ')}`);

// Icons are ours, byte for byte
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const icons = readdirSync(join(ROOT, 'brand', 'icons')).filter((f) => /^(icon|berry)\d/.test(f));
const wrong = icons.filter((f) => existsSync(join(OUT, 'images', f)) && sha(join(OUT, 'images', f)) !== sha(join(ROOT, 'brand', 'icons', f)));
check(!wrong.length, `${icons.length} icons are GROWTHSTAR`, `icons not ours: ${wrong.join(', ')}`);
for (const size of Object.values(m.icons ?? {})) {
  check(existsSync(join(OUT, size)), '', `manifest icon ${size} is missing`);
}

for (const o of oks.filter(Boolean)) console.log(`  ok    ${o}`);
if (fails.length) {
  console.error(`\nBuild check FAILED (${fails.length}):`);
  for (const f of fails) console.error(`  FAIL  ${f}`);
  process.exit(1);
}
console.log(`\n${firefox ? 'Firefox' : 'Chromium'} build passes every GROWTHSTAR check.`);
