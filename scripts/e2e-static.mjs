/**
 * Static/PWA end-to-end check.
 *
 * Usage:
 *   npm run build && npm run preview
 *   BASE=http://localhost:4173/fitnessos/ node scripts/e2e-static.mjs
 *
 * Optional cloud checks:
 *   WORKER_URL=http://localhost:8787 SYNC_PASSPHRASE=... node scripts/e2e-static.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.BASE || 'http://localhost:4173/fitnessos/';
const WORKER_URL = process.env.WORKER_URL || '';
const PASSPHRASE = process.env.SYNC_PASSPHRASE || '';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) process.exitCode = 1;
};

const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fos-e2e-'));
const browser = await chromium.launchPersistentContext(profileDir, {
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
});
const page = browser.pages()[0] || (await browser.newPage());
const errors = [];
page.on('pageerror', (err) => errors.push(err.message));
page.on('console', (msg) => {
  if (msg.type() === 'error' && !msg.text().includes('401')) errors.push(msg.text());
});

async function loginOrCreate() {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const hasForm = await page.locator('input[autocomplete=name]').isVisible().catch(() => false);
  if (hasForm) {
    await page.locator('input[autocomplete=name]').fill('E2E Owner');
    await page.getByRole('button', { name: /Create private profile/ }).click();
    await page.waitForTimeout(1600);
  }
}

await loginOrCreate();
check('first-run profile created', await page.locator('.today-weight-empty').isVisible().catch(() => false));
check('dashboard targets loaded', (await page.locator('.counter-value').first().textContent().catch(() => '')).includes('—'));

// Log a weigh-in and meal through the UI.
await page.getByRole('button', { name: 'Weigh in' }).click();
const nums = page.locator('.modal input[type=number]');
await nums.nth(0).fill('90.4');
await page.locator('.modal').getByRole('button', { name: 'Save measurement' }).click();
await page.waitForTimeout(700);
await page.getByRole('button', { name: 'Log meal' }).click();
await page.waitForTimeout(400);
const mealInputs = page.locator('.modal input.input');
await mealInputs.nth(0).fill('E2E dal rice');
await mealInputs.nth(1).fill('620');
await mealInputs.nth(2).fill('32');
await page.locator('.modal').getByRole('button', { name: 'Log meal', exact: true }).click();
await page.waitForTimeout(800);
check('weigh-in persisted in UI', (await page.locator('.today-weight .num').textContent())?.trim() === '90.4');
check('meal logged', await page.getByText('E2E dal rice').isVisible().catch(() => false));

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
check('refresh keeps records', await page.getByText('E2E dal rice').isVisible().catch(() => false));
check('refresh keeps weight', (await page.locator('.today-weight .num').textContent())?.trim() === '90.4');

// Encrypted backup.
await page.goto(`${BASE}#/settings`, { waitUntil: 'networkidle' });
await page.getByRole('tab', { name: /Data & Backup/ }).click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: /Create backup/ }).click();
const modal = page.locator('.modal');
await modal.locator('input[type=password]').nth(0).fill('e2e-backup-passphrase');
await modal.locator('input[type=password]').nth(1).fill('e2e-backup-passphrase');
const [download] = await Promise.all([
  page.waitForEvent('download'),
  modal.getByRole('button', { name: /Download backup/ }).click(),
]);
const backupPath = path.join(profileDir, 'backup.json');
await download.saveAs(backupPath);
const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
check('backup is encrypted', backup.encrypted === true && !!backup.ciphertext);
check('backup contains no plaintext records', !backup.payload);

// PWA offline shell.
await page.goto(`${BASE}#/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
const sw = await page.evaluate(async () => ({
  controller: !!navigator.serviceWorker.controller,
  registrations: (await navigator.serviceWorker.getRegistrations()).length,
}));
check('service worker registered', sw.registrations > 0 && sw.controller, JSON.stringify(sw));
await page.context().setOffline(true);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
check('offline reload shows app', await page.locator('.offline-banner').isVisible().catch(() => false));
check('offline data still visible', await page.getByText('E2E dal rice').isVisible().catch(() => false));
await page.context().setOffline(false);
await page.waitForTimeout(500);

// Cross-device sync (optional).
if (WORKER_URL && PASSPHRASE) {
  await page.goto(`${BASE}#/settings`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: /Cloud & Apple Health/ }).click();
  await page.waitForTimeout(400);
  const connect = page.getByRole('button', { name: /Connect cloud account/ });
  if (await connect.isVisible().catch(() => false)) {
    await connect.click();
    const cloudModal = page.locator('.modal');
    await cloudModal.locator('input').nth(0).fill(WORKER_URL);
    await cloudModal.locator('input[type=password]').fill(PASSPHRASE);
    await cloudModal.getByRole('button', { name: /Connect & sync/ }).click();
    await page.waitForTimeout(4500);
  }
  check('cloud sync reaches synced state', (await page.locator('.sync-pill').first().textContent())?.includes('Synced'));

  const secondDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fos-e2e-device2-'));
  const second = await chromium.launchPersistentContext(secondDir, { viewport: { width: 1200, height: 900 } });
  const p2 = second.pages()[0] || (await second.newPage());
  await p2.goto(BASE, { waitUntil: 'networkidle' });
  await p2.getByRole('button', { name: 'Connect account' }).click();
  await p2.locator('input').nth(0).fill(WORKER_URL);
  await p2.locator('input[type=password]').fill(PASSPHRASE);
  await p2.getByRole('button', { name: /Sign in & pull records/ }).click();
  await p2.waitForTimeout(6000);
  check('second device pulls profile', (await p2.locator('.today-weight .num').textContent().catch(() => ''))?.trim() === '90.4');
  await p2.goto(`${BASE}#/nutrition`, { waitUntil: 'networkidle' });
  await p2.waitForTimeout(1200);
  check('second device pulls meal', await p2.getByText('E2E dal rice').first().isVisible().catch(() => false));
  await second.close();
}

// Mobile sanity: no horizontal overflow.
const mobile = await browser.newPage();
await mobile.setViewportSize({ width: 390, height: 844 });
await mobile.goto(`${BASE}#/`, { waitUntil: 'networkidle' });
await mobile.waitForTimeout(600);
const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check('no mobile horizontal overflow', overflow <= 1, String(overflow));
await mobile.close();

check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
