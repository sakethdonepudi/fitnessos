import { chromium } from 'playwright';
import fs from 'node:fs';

const svg = fs.readFileSync('public/favicon.svg', 'utf8').replace('<svg ', '<svg width="100%" height="100%" ');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });

async function shot(size, path, padding = 0) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:#060709;display:grid;place-items:center;width:${size}px;height:${size}px"><div style="width:${size - padding * 2}px;height:${size - padding * 2}px">${svg}</div></body></html>`);
  await page.screenshot({ path, omitBackground: false });
}

await shot(192, 'public/icons/icon-192.png');
await shot(512, 'public/icons/icon-512.png');
await shot(512, 'public/icons/icon-maskable-512.png', 64);
await shot(180, 'public/icons/apple-touch-icon.png');
await browser.close();
console.log('icons generated');
