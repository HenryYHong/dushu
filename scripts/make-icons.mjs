// Renders the app icons (PNG) from the same design as public/icon.svg (a globe drawn in lines of text), using headless Chrome.
// Usage: node scripts/make-icons.mjs        Writes public/icons/*.png
//   apple-touch-icon.png  180, full bleed (iOS rounds the corners itself)
//   icon-192.png, icon-512.png   rounded, "any" purpose
//   icon-maskable-512.png        full bleed, globe inside the central 80 percent safe zone
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(out, { recursive: true });

/** The globe drawn in lines of text, in a 64 box; `scale` shrinks it about the center (maskable icons keep a safe zone). */
function globe(scale) {
  const lines = [[21, 19.5, 20], [15, 25.5, 30], [13.5, 31.5, 26], [15, 37.5, 33], [21, 43.5, 16]]
    .map(([x, y, w]) => `<rect x="${x}" y="${y}" width="${w}" height="3" rx="1.5"/>`).join('');
  return `<g transform="translate(32 32) scale(${scale}) translate(-32 -32)"><circle cx="32" cy="32" r="20" fill="#fbf7f0"/><g fill="#b8402e">${lines}</g></g>`;
}
/** kind: 'round' (corners drawn, transparent outside), 'bleed' (full square), 'maskable' (full square, smaller globe). */
function svg(kind) {
  const bleed = kind !== 'round';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="100%" height="100%"><rect width="64" height="64" rx="${bleed ? 0 : 14}" fill="#b8402e"/>${globe(kind === 'maskable' ? 0.8 : 1)}</svg>`;
}

const jobs = [
  ['apple-touch-icon.png', 180, 'bleed'],
  ['icon-192.png', 192, 'round'],
  ['icon-512.png', 512, 'round'],
  ['icon-maskable-512.png', 512, 'maskable'],
];

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  const page = await browser.newPage();
  for (const [name, px, kind] of jobs) {
    await page.setViewport({ width: px, height: px, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block}</style>${svg(kind)}`);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(out, name), omitBackground: kind === 'round' });
    console.log(`wrote public/icons/${name} (${px}px)`);
  }
} finally {
  await browser.close();
}
