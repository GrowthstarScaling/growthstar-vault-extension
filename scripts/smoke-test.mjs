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
 * Everything it sees is printed, because CI artifacts are not always reachable: the log
 * alone has to say what was on screen when a check failed.
 *
 *   node scripts/smoke-test.mjs <unpacked-build-dir> [screenshot-dir]
 */
import { mkdirSync, readFileSync } from 'node:fs';
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll instead of waiting on one event: a new tab is about:blank before it is its URL. */
async function pollForPage(ctx, host, ms) {
  for (let waited = 0; waited < ms; waited += 500) {
    const p = ctx.pages().find((page) => {
      try {
        return new URL(page.url()).host === host;
      } catch {
        return false;
      }
    });
    if (p) return p;
    await wait(500);
  }
  return null;
}

async function describe(page, label) {
  const info = await page.evaluate(() => ({
    url: location.href,
    text: (document.body?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 400),
    buttons: [...document.querySelectorAll('button, a[role="button"], a')]
      .map((b) => (b.innerText || b.getAttribute('aria-label') || '').trim())
      .filter(Boolean)
      .slice(0, 12),
    inputs: [...document.querySelectorAll('input')].map(
      (i) => `${i.type}${i.getAttribute('formcontrolname') ? `/${i.getAttribute('formcontrolname')}` : ''}`,
    ),
    svgTitles: [...document.querySelectorAll('svg title')].map((t) => t.textContent.trim()),
  }));
  console.log(`  [${label}] ${info.url}`);
  console.log(`  [${label}] text: ${info.text}`);
  console.log(`  [${label}] buttons: ${info.buttons.join(' | ')}`);
  console.log(`  [${label}] inputs: ${info.inputs.join(', ') || 'none'} | svg titles: ${info.svgTitles.join(', ') || 'none'}`);
  return info;
}

const ctx = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  // Headless cannot run this extension's UI: the popup stays on its spinner, and Bitwarden's
  // own unmodified build does exactly the same. CI runs this under xvfb-run.
  headless: false,
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
  const welcome = await pollForPage(ctx, new URL(brand.welcomeUrl).host, 25000);
  check(!!welcome, `install opened ${brand.welcomeUrl}`,
    `install did not open ${brand.welcomeUrl}; tabs were: ${ctx.pages().map((p) => p.url()).join(', ')}`);

  // 2. Popup.
  const popup = await ctx.newPage();
  const errors = [];
  popup.on('pageerror', (e) => errors.push(String(e)));
  await popup.goto(`chrome-extension://${id}/popup/index.html`);
  await popup.waitForLoadState('networkidle').catch(() => {});
  await wait(3000);
  const title = await popup.title();
  check(title.includes(brand.name), `popup title "${title}"`, `popup title is "${title}"`);
  let info = await describe(popup, 'popup');
  check(!/\bBitwarden\b/.test(info.text.replace(/Bitwarden (apps|Help center|support|desktop app|Authenticator)/g, '')),
    'popup text never says Bitwarden', `popup text says Bitwarden: ${info.text}`);
  const logo = await popup.evaluate(
    (name) =>
      [...document.querySelectorAll('svg title')].some((t) => t.textContent.includes(name)) &&
      [...document.querySelectorAll('svg image')].some((i) => (i.getAttribute('href') ?? '').startsWith('data:image/png')),
    brand.name,
  );
  check(logo, 'GROWTHSTAR Vault logo drawn', 'the GROWTHSTAR Vault lockup is not in the popup');
  await popup.screenshot({ path: join(SHOTS, '1-popup.png') });

  // A first-run carousel sits in front of the sign-in form: page through it, then Log in.
  const email = () => popup.locator('input[type="email"], input[formcontrolname="email"]').first();
  for (let attempt = 0; attempt < 8 && (await email().count()) === 0; attempt++) {
    const logIn = popup.getByRole('button', { name: /^log in$/i }).first();
    const next = popup.getByRole('button', { name: /^(next|get started|skip)$/i }).first();
    const button = (await logIn.isVisible().catch(() => false)) ? logIn : next;
    if (!(await button.isVisible().catch(() => false))) break;
    console.log(`  [popup] clicking "${(await button.innerText().catch(() => '')).trim()}"`);
    await button.click().catch(() => {});
    await wait(1500);
  }
  if ((await email().count()) === 0) {
    info = await describe(popup, 'no-email-field');
    await popup.screenshot({ path: join(SHOTS, '2-no-email.png') });
    check(false, '', 'the sign-in form never appeared (see the [no-email-field] lines above)');
  } else {
    await describe(popup, 'sign-in');
    await popup.screenshot({ path: join(SHOTS, '2-sign-in.png') });
    const pickerShown = await popup
      .locator('environment-selector')
      .evaluateAll((els) => els.filter((e) => e.offsetParent !== null).length)
      .catch(() => 0);
    check(pickerShown === 0, 'no server picker shown', 'the server picker is visible');

    await email().fill('smoke-test@growthstar.invalid');
    const toServer = popup
      .waitForRequest((r) => new URL(r.url()).host === server, { timeout: 25000 })
      .then(() => true, () => false);
    await popup.getByRole('button', { name: /continue|log in/i }).first().click().catch(() => {});
    check(await toServer, `sign-in went to ${server}`, `sign-in never reached ${server}`);
    await wait(2000);
    await popup.screenshot({ path: join(SHOTS, '3-after-continue.png') });
  }

  // The pop-up the extension paints INSIDE web pages is the surface people see most.
  // Best effort: it only appears with autofill on, so a miss is reported, not failed.
  try {
    const site = await ctx.newPage();
    await site.setContent('<html><body><h1>form</h1><form><input name="username" type="text"><input name="password" type="password"></form></body></html>');
    await site.locator('input[name="username"]').click();
    await wait(2500);
    const menu = site.frames().filter((f) => f.url().startsWith('chrome-extension://'));
    if (menu.length === 0) {
      console.log('  [in-page menu] did not appear (autofill may be off in a fresh profile)');
    } else {
      const text = (await Promise.all(menu.map((f) => f.locator('body').innerText().catch(() => '')))).join(' ');
      console.log(`  [in-page menu] ${menu.length} frame(s): ${text.replace(/\s+/g, ' ').slice(0, 160)}`);
      check(!/\bBitwarden\b/.test(text), 'in-page menu never says Bitwarden', `the in-page menu says Bitwarden: ${text.slice(0, 160)}`);
    }
    await site.screenshot({ path: join(SHOTS, '4-in-page-menu.png') });
    await site.close();
  } catch (e) {
    console.log(`  [in-page menu] could not be checked: ${e.message}`);
  }

  const bitwarden = [...hosts].filter((h) => /bitwarden\.(com|eu|net)$/.test(h) && h !== 'assets.bitwarden.com');
  check(!bitwarden.length, 'no request to a Bitwarden server', `requests went to Bitwarden: ${bitwarden.join(', ')}`);
  check(!errors.length, 'no page errors', `page errors: ${errors.slice(0, 3).join(' | ')}`);
  console.log(`  hosts contacted: ${[...hosts].filter((h) => h && h !== id).sort().join(', ')}`);
} catch (e) {
  fails.push(`smoke test crashed: ${e.message}`);
} finally {
  await ctx.close();
}

for (const o of oks.filter(Boolean)) console.log(`  ok    ${o}`);
if (fails.filter(Boolean).length) {
  console.error(`\nSmoke test FAILED (${fails.filter(Boolean).length}):`);
  for (const f of fails.filter(Boolean)) console.error(`  FAIL  ${f}`);
  process.exit(1);
}
console.log('\nThe built extension installs, looks like GROWTHSTAR Vault and signs in only to GROWTHSTAR.');
