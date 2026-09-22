#!/usr/bin/env node
/**
 * Loads a built Chromium extension into a clean browser and proves, on the real running
 * extension, the three things that matter most:
 *   1. it installs and opens the GROWTHSTAR welcome page,
 *   2. its popup renders as GROWTHSTAR Vault,
 *   3. signing in talks to the GROWTHSTAR server and never to Bitwarden's.
 * No password is used: step 3 types a throwaway address and watches where the first
 * sign-in request goes.
 *
 *   node scripts/smoke-test.mjs <unpacked-build-dir> [screenshot-dir]
 */
import { mkdirSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXT = resolve(process.argv[2] ?? '');
const SHOTS = resolve(process.argv[3] ?? 'smoke-shots');
const brand = JSON.parse(readFileSync(join(ROOT, 'brand', 'brand.json'), 'utf8'));
const server = new URL(brand.server).host;
mkdirSync(SHOTS, { recursive: true });

const fails = [];
const oks = [];
const check = (cond, ok, fail) => (cond ? oks.push(ok) : fails.push(fail));

const ctx = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  viewport: { width: 400, height: 640 },
});
const hosts = new Set();
ctx.on('request', (r) => {
  try {
    hosts.add(new URL(r.url()).host);
  } catch {}
});

try {
  let [worker] = ctx.serviceWorkers();
  worker ??= await ctx.waitForEvent('serviceworker', { timeout: 30000 });
  const id = new URL(worker.url()).host;
  check(!!id, `extension loaded (${id})`, 'extension service worker never started');

  // 1. Welcome page opened on install.
  const welcome = new URL(brand.welcomeUrl).host;
  let opened = ctx.pages().some((p) => p.url().includes(welcome));
  if (!opened) {
    opened = await ctx
      .waitForEvent('page', { timeout: 15000, predicate: (p) => p.url().includes(welcome) })
      .then(() => true, () => false);
  }
  check(opened, `install opened ${brand.welcomeUrl}`, `install did not open ${brand.welcomeUrl}`);

  // 2. Popup.
  const popup = await ctx.newPage();
  const errors = [];
  popup.on('pageerror', (e) => errors.push(String(e)));
  await popup.goto(`chrome-extension://${id}/popup/index.html`);
  await popup.waitForLoadState('networkidle').catch(() => {});
  await popup.waitForTimeout(2500);
  check((await popup.title()).includes(brand.name), `popup title "${await popup.title()}"`, `popup title is "${await popup.title()}"`);
  const body = await popup.locator('body').innerText();
  check(!/\bBitwarden\b/.test(body.replace(/Bitwarden (apps|Help center|support|desktop app|Authenticator)/g, '')),
    'popup text never says Bitwarden', `popup text says Bitwarden: ${body.slice(0, 300)}`);
  const logo = await popup.locator('svg title', { hasText: brand.name }).count();
  check(logo > 0, 'GROWTHSTAR Vault logo drawn', 'GROWTHSTAR Vault logo not found in the popup');
  await popup.screenshot({ path: join(SHOTS, '1-popup.png') });

  // A first-run carousel may sit in front of the sign-in form.
  for (const label of [/^log in$/i, /^continue$/i]) {
    const b = popup.getByRole('button', { name: label });
    if (await b.count()) {
      await b.first().click().catch(() => {});
      await popup.waitForTimeout(1500);
      break;
    }
  }

  // 3. Where does sign-in go?
  const email = popup.locator('input[type="email"], input[formcontrolname="email"]').first();
  await email.waitFor({ timeout: 20000 });
  await popup.screenshot({ path: join(SHOTS, '2-sign-in.png') });
  check((await popup.locator('environment-selector').evaluateAll((els) => els.filter((e) => e.offsetParent !== null).length)) === 0,
    'no server picker shown', 'the server picker is visible');
  await email.fill('smoke-test@growthstar.invalid');
  const toServer = popup.waitForRequest((r) => new URL(r.url()).host === server, { timeout: 20000 }).then(() => true, () => false);
  await popup.getByRole('button', { name: /continue/i }).first().click();
  check(await toServer, `sign-in went to ${server}`, `sign-in never reached ${server}`);
  await popup.waitForTimeout(2000);
  await popup.screenshot({ path: join(SHOTS, '3-after-continue.png') });

  const bitwarden = [...hosts].filter((h) => /bitwarden\.(com|eu|net)$/.test(h) && h !== 'assets.bitwarden.com');
  check(!bitwarden.length, 'no request to a Bitwarden server', `requests went to Bitwarden: ${bitwarden.join(', ')}`);
  check(!errors.length, 'no page errors', `page errors: ${errors.slice(0, 3).join(' | ')}`);
  console.log(`  hosts contacted: ${[...hosts].filter((h) => h && !h.includes(id)).sort().join(', ')}`);
} catch (e) {
  fails.push(`smoke test crashed: ${e.message}`);
} finally {
  await ctx.close();
}

for (const o of oks) console.log(`  ok    ${o}`);
if (fails.length) {
  console.error(`\nSmoke test FAILED (${fails.length}):`);
  for (const f of fails) console.error(`  FAIL  ${f}`);
  process.exit(1);
}
console.log('\nThe built extension installs, looks like GROWTHSTAR Vault and signs in only to GROWTHSTAR.');
