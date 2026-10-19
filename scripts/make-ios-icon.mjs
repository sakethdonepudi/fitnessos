import { chromium } from 'playwright';
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
<defs>
  <radialGradient id="bg" cx="50%" cy="35%" r="80%">
    <stop offset="0%" stop-color="#1b2115"/><stop offset="55%" stop-color="#0b0e0a"/><stop offset="100%" stop-color="#050607"/>
  </radialGradient>
  <linearGradient id="mark" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="#d6ff6e"/><stop offset="100%" stop-color="#5eead4"/>
  </linearGradient>
</defs>
<rect width="1024" height="1024" fill="url(#bg)"/>
<circle cx="512" cy="512" r="330" fill="#c6ff4a" opacity="0.045"/>
<path d="M250 706 L430 318 L610 706" fill="none" stroke="url(#mark)" stroke-width="82" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M610 706 L790 318" fill="none" stroke="#c6ff4a" stroke-width="82" stroke-linecap="round"/>
</svg>`;
const b=await chromium.launch();
const p=await b.newPage({viewport:{width:1024,height:1024},deviceScaleFactor:1});
await p.setContent(`<html><body style="margin:0">${svg}</body></html>`);
await p.screenshot({path:'ios-companion/FitnessOSCompanion/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png'});
await b.close();
