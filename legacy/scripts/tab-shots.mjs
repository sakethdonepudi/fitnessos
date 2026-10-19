import { chromium } from 'playwright';

const base = 'http://localhost:4173';
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
const page = await context.newPage();
await page.goto(base);
await page.fill('input[type="email"]', 'demo@fitness.local');
await page.fill('input[type="password"]', 'demo12345');
await page.locator('button[type="submit"]').click();
await page.waitForTimeout(1400);

async function shot(path, name, tab) {
  await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
  if (tab) {
    await page.getByRole('tab', { name: new RegExp(tab) }).click();
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(300);
  await page.screenshot({ path: `.context/${name}.png`, fullPage: true });
}

await shot('/treadmill', 'tab-weekly', 'Weekly plan');
await shot('/treadmill', 'tab-history', 'History');
await shot('/treadmill', 'tab-progression', 'Progression');
await shot('/nutrition', 'tab-week', 'Week');
await shot('/nutrition', 'tab-recipes', 'Recipes');
await shot('/settings', 'tab-goals', 'Goals');
await shot('/settings', 'tab-health', 'Apple Health');
await shot('/settings', 'tab-jobs', 'Scheduled jobs');
await shot('/evidence', 'tab-checkpoints', 'Daily checkpoints');
await shot('/evidence', 'tab-sources', 'Data sources');

await page.goto(`${base}/progress`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await page.getByRole('button', { name: 'Overlay' }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: '.context/photos-overlay.png', fullPage: true });

await browser.close();
console.log('done');
