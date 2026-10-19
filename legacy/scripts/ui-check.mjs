import { chromium } from 'playwright';

const base = 'http://localhost:4173';
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('401')) errors.push(m.text()); });

await page.goto(base);
await page.fill('input[type="email"]', 'demo@fitness.local');
await page.fill('input[type="password"]', 'demo12345');
await page.locator('button[type="submit"]').click();
await page.waitForTimeout(1200);

// Treadmill history + edit
await page.goto(`${base}/treadmill`, { waitUntil: 'networkidle' });
await page.getByRole('tab', { name: /History/ }).click();
await page.waitForTimeout(400);
const editButton = page.locator('table tbody tr').first().getByRole('button', { name: 'Edit session' });
await editButton.click();
await page.waitForTimeout(300);
const duration = page.locator('.modal input[type="number"]').first();
const original = await duration.inputValue();
await duration.fill('29');
await page.getByRole('button', { name: 'Save session' }).click();
await page.waitForTimeout(900);
const toastText = await page.locator('.toast').first().textContent().catch(() => '');
console.log('EDIT:', original, '-> 29 ·', toastText?.trim());
await page.screenshot({ path: '.context/treadmill-history.png', fullPage: true });

// Session detail
await page.locator('table tbody tr').first().getByRole('button', { name: 'Session details' }).click();
await page.waitForTimeout(300);
console.log('DETAIL MODAL:', await page.locator('.modal').isVisible(), (await page.locator('.session-detail-list').textContent())?.slice(0, 80));
await page.keyboard.press('Escape');

// Evidence checkpoints
await page.goto(`${base}/evidence`, { waitUntil: 'networkidle' });
await page.getByRole('tab', { name: /Daily checkpoints/ }).click();
await page.waitForTimeout(300);
await page.locator('.checkpoint-row').first().click();
await page.waitForTimeout(400);
console.log('CHECKPOINT MODAL:', await page.locator('.checkpoint-detail').isVisible());
await page.screenshot({ path: '.context/checkpoint-modal.png', fullPage: false });
await page.keyboard.press('Escape');

// Settings health tab
await page.goto(`${base}/settings`, { waitUntil: 'networkidle' });
await page.getByRole('tab', { name: 'Apple Health' }).click();
await page.waitForTimeout(500);
const before = await page.locator('.token-row').count();
await page.getByRole('button', { name: /Create device token/ }).click();
await page.waitForTimeout(600);
const after = await page.locator('.token-row').count();
console.log('TOKENS:', before, '->', after, 'new token visible:', await page.locator('.new-token code').isVisible());
await page.screenshot({ path: '.context/settings-health.png', fullPage: true });

// Data & audit
await page.getByRole('tab', { name: 'Data & audit' }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: '.context/settings-audit.png', fullPage: true });

// Mobile menu
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const mp = await mobile.newPage();
await mp.goto(base);
await mp.fill('input[type="email"]', 'demo@fitness.local');
await mp.fill('input[type="password"]', 'demo12345');
await mp.locator('button[type="submit"]').click();
await mp.waitForTimeout(1200);
await mp.locator('.menu-btn').click();
await mp.waitForTimeout(200);
console.log('MOBILE MENU:', await mp.locator('.mobile-menu').isVisible(), 'links', await mp.locator('.mobile-menu a').count());
await mp.screenshot({ path: '.context/mobile-menu.png' });
await mp.locator('.mobile-menu a', { hasText: 'Training' }).click();
await mp.waitForTimeout(600);
console.log('MOBILE NAV:', mp.url());

// Settings profile demo label
await page.goto(`${base}/settings`, { waitUntil: 'networkidle' });
const accountType = await page.locator('.settings-kv', { hasText: 'Account type' }).textContent();
console.log('ACCOUNT TYPE:', accountType?.trim());

await browser.close();
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'No page errors');
