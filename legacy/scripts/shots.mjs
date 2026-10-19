import { chromium } from 'playwright';
import fs from 'node:fs';

const base = process.env.BASE || 'http://localhost:4173';
const out = new URL('../.context/', import.meta.url).pathname;
fs.mkdirSync(out, { recursive: true });

const pages = [
  ['today', '/'],
  ['transformation', '/transformation'],
  ['treadmill', '/treadmill'],
  ['training', '/training'],
  ['nutrition', '/nutrition'],
  ['photos', '/progress'],
  ['evidence', '/evidence'],
  ['settings', '/settings'],
];

const browser = await chromium.launch();
const errors = [];

async function login(page) {
  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  const hasLogin = await page.locator('input[type="email"]').isVisible().catch(() => false);
  if (hasLogin) {
    await page.fill('input[type="email"]', 'demo@fitness.local');
    await page.fill('input[type="password"]', 'demo12345');
    await page.locator('button[type="submit"]').click();
    await page.waitForTimeout(1600);
  }
}

const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
const page = await context.newPage();
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
});
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
await login(page);

for (const [name, path] of pages) {
  await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}${name}.png`, fullPage: true });
}

// Mobile checks
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const mp = await mobile.newPage();
mp.on('pageerror', (err) => errors.push(`mobile pageerror: ${err.message}`));
await login(mp);
for (const [name, path] of [['today', '/'], ['treadmill', '/treadmill'], ['transformation', '/transformation'], ['nutrition', '/nutrition']]) {
  await mp.goto(`${base}${path}`, { waitUntil: 'networkidle' });
  await mp.waitForTimeout(700);
  await mp.screenshot({ path: `${out}mobile-${name}.png`, fullPage: true });
}

await browser.close();
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'No console/page errors');
