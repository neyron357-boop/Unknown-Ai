// Renders the app icons (PNG) from an inline SVG using a headless Chromium.
// Usage: npx playwright install chromium && npm run icons   (icons are committed; rerun only to redesign)
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import('playwright').catch(() => {
  console.error('Install Playwright first:  npm i -D playwright && npx playwright install chromium');
  process.exit(1);
});

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(out, { recursive: true });

const svg = (pad) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <radialGradient id="bg" cx="50%" cy="38%" r="75%">
      <stop offset="0%" stop-color="#2a0710"/>
      <stop offset="55%" stop-color="#0b0b10"/>
      <stop offset="100%" stop-color="#050507"/>
    </radialGradient>
    <radialGradient id="core" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="22%" stop-color="#ff6a7a"/>
      <stop offset="60%" stop-color="rgba(255,42,68,0.25)"/>
      <stop offset="100%" stop-color="rgba(255,42,68,0)"/>
    </radialGradient>
    <filter id="neon" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="7" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <g transform="translate(256 256) scale(${1 - pad})">
    <circle r="120" fill="url(#core)" opacity="0.85"/>
    <g filter="url(#neon)" stroke="#ff2a44" stroke-width="13" fill="none" stroke-linecap="round">
      ${Array.from({ length: 9 }, (_, i) => {
        const a0 = (i / 9) * Math.PI * 2 - Math.PI / 2;
        const a1 = a0 + (Math.PI * 2) / 9 - 0.2;
        const r = 182;
        return `<path d="M ${Math.cos(a0) * r} ${Math.sin(a0) * r} A ${r} ${r} 0 0 1 ${Math.cos(a1) * r} ${Math.sin(a1) * r}"/>`;
      }).join('')}
    </g>
    <circle r="140" stroke="rgba(57,213,255,0.55)" stroke-width="3" fill="none" stroke-dasharray="4 14"/>
    <rect x="-6" y="-96" width="12" height="192" rx="6" fill="#ffd0d6" filter="url(#neon)"/>
  </g>
</svg>`;

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
const targets = [
  ['icon-512.png', 512, 0.04],
  ['icon-192.png', 192, 0.04],
  ['icon-maskable-512.png', 512, 0.22],
  ['apple-touch-icon.png', 180, 0.08],
];
for (const [name, size, pad] of targets) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:#050507">${svg(pad).replace('width="512" height="512"', `width="${size}" height="${size}"`)}</body></html>`);
  await page.screenshot({ path: path.join(out, name), clip: { x: 0, y: 0, width: size, height: size } });
  console.log('✓', name);
}
await browser.close();
