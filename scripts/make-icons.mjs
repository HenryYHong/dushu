// Renders the app icons (PNG) and public/icon.svg from src/ui/globe.svg (a desk globe with the continents, from Natural Earth's
// public-domain map: scripts/make-globe.py), on the app's red, using headless Chrome.
// Usage: node scripts/make-icons.mjs        Writes public/icon.svg and public/icons/*.png
//   apple-touch-icon.png  180, full bleed (iOS rounds the corners itself)
//   icon-192.png, icon-512.png   rounded, "any" purpose
//   icon-maskable-512.png        full bleed, globe inside the central 80 percent safe zone
import puppeteer from 'puppeteer-core';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'icons');
mkdirSync(out, { recursive: true });

/** The globe's drawing (what is inside its <svg>), in a 64 box. */
const inner = readFileSync(join(root, 'src', 'ui', 'globe.svg'), 'utf8').replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');

/** kind: 'round' (corners drawn, transparent outside), 'bleed' (full square), 'maskable' (full square, smaller globe). */
function svg(kind, size = '100%') {
  const bleed = kind !== 'round';
  const scale = kind === 'maskable' ? 0.8 : 1;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}"><rect width="64" height="64" rx="${bleed ? 0 : 14}" fill="#b8402e"/><g transform="translate(32 32) scale(${scale}) translate(-32 -32)">${inner}</g></svg>`;
}

writeFileSync(join(root, 'public', 'icon.svg'), svg('round').replace(' width="100%" height="100%"', '') + '\n');
console.log('wrote public/icon.svg');

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
