import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '..', 'server', 'demo-assets');
fs.mkdirSync(outDir, { recursive: true });

const svg = (angle, week) => {
  const definition = week === 1 ? 1 : 0.965;
  const waist = week === 1 ? 1 : 0.955;
  const shoulder = week === 1 ? 1 : 1.005;
  const w = week === 1 ? 1 : 0.96;
  const torso = `M300 196
    c-34 0-56 18-62 46l-10 116c-2 26 2 48 8 70l12 94c2 16 5 32 8 48l26 0c2-34 4-70 6-104l4-38 4 38c2 34 4 70 6 104l26 0c3-16 6-32 8-48l12-94c6-22 10-44 8-70l-10-116c-6-28-28-46-62-46Z`;
  const arms = `M244 238c-14 4-22 16-24 32l-12 96c-4 30-2 56 2 78l14 0c4-22 6-46 9-72l15-96c2-18-1-32-4-38Z
    M356 238c14 4 22 16 24 32l12 96c4 30 2 56-2 78l-14 0c-4-22-6-46-9-72l-15-96c-2-18 1-32 4-38Z`;
  const sideTorso = `M300 196c-30 0-50 18-52 46l-4 116c-1 26 3 48 8 70l8 94c2 16 4 32 6 48l22 0c1-34 2-70 3-104l2-38 3 38c2 34 4 70 6 104l22 0c3-16 6-32 8-48l8-94c5-22 9-44 8-70l-4-116c-2-28-22-46-52-46Z`;
  const body = angle === 'side'
    ? `<g transform="translate(300 0) scale(${w} 1) translate(-300 0)">
        <ellipse cx="300" cy="154" rx="44" ry="54" fill="url(#skin)"/>
        <path d="${sideTorso}" fill="url(#skin)"/>
        <path d="M254 238c-12 6-16 20-15 38l4 84c1 16 4 28 8 38l12 0c2-16 2-34 1-52l-3-70c-1-20-3-32-7-38Z" fill="url(#skin)"/>
      </g>`
    : `<g transform="translate(300 0) scale(${w} 1) translate(-300 0)">
        <ellipse cx="300" cy="152" rx="47" ry="58" fill="url(#skin)"/>
        <path d="M274 196h52v20h-52z" fill="url(#skin)"/>
        <path d="${torso}" fill="url(#skin)"/>
        <path d="${arms}" fill="url(#skin)"/>
      </g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800">
  <defs>
    <radialGradient id="bg" cx="50%" cy="30%" r="85%">
      <stop offset="0%" stop-color="#2a2e36"/><stop offset="60%" stop-color="#15181e"/><stop offset="100%" stop-color="#0a0c10"/>
    </radialGradient>
    <linearGradient id="skin" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#c7ccd3" stop-opacity="0.88"/>
      <stop offset="55%" stop-color="#8f96a1" stop-opacity="0.72"/>
      <stop offset="100%" stop-color="#5d6470" stop-opacity="0.6"/>
    </linearGradient>
    <filter id="glow"><feGaussianBlur stdDeviation="26"/></filter>
  </defs>
  <rect width="600" height="800" fill="url(#bg)"/>
  <ellipse cx="300" cy="770" rx="190" ry="42" fill="#000" opacity="0.55" filter="url(#glow)"/>
  <ellipse cx="300" cy="300" rx="210" ry="230" fill="#C6FF4A" opacity="0.035"/>
  ${body}
  <text x="300" y="758" text-anchor="middle" font-family="Helvetica, Arial" font-size="15" letter-spacing="4" fill="#ffffff" opacity="0.28">SAMPLE DATA</text>
  <text x="52" y="62" font-family="Helvetica, Arial" font-size="13" letter-spacing="2" fill="#ffffff" opacity="0.32">WEEK ${week} · ${angle.toUpperCase()}</text>
</svg>`;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 600, height: 800 }, deviceScaleFactor: 1 });
for (const week of [1, 2]) {
  for (const angle of ['front', 'side', 'back']) {
    await page.setContent(`<html><body style="margin:0;background:#0a0c10">${svg(angle, week)}</body></html>`);
    await page.screenshot({ path: path.join(outDir, `demo-${week}-${angle}.png`) });
  }
}
await browser.close();
console.log('Demo photos written to', outDir);
