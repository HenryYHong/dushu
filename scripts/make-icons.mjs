// Renders the app icons (PNG) from the same design as public/icon.svg, using headless Chrome.
// Usage: node scripts/make-icons.mjs        Writes public/icons/*.png
//   apple-touch-icon.png  180, full bleed (iOS rounds the corners itself)
//   icon-192.png, icon-512.png   rounded, "any" purpose
//   icon-maskable-512.png        full bleed, glyph inside the central 80 percent safe zone
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(out, { recursive: true });

const FONT = "'Songti SC', 'STSong', 'Noto Serif SC', serif";
/** kind: 'round' (corners drawn, transparent outside), 'bleed' (full square), 'maskable' (full square, smaller glyph). */
function svg(kind) {
  const bleed = kind !== 'round';
  const size = kind === 'maskable' ? 30 : 38;
  const y = kind === 'maskable' ? 42.2 : 45.5;
  const frame = kind === 'maskable' ? '' : `<rect x="5" y="5" width="54" height="54" rx="${bleed ? 4 : 10}" fill="none" stroke="#fbf7f0" stroke-opacity=".35" stroke-width="1.2"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="100%" height="100%"><rect width="64" height="64" rx="${bleed ? 0 : 14}" fill="#b8402e"/>${frame}<text x="32" y="${y}" font-size="${size}" text-anchor="middle" fill="#fbf7f0" font-family="${FONT}" font-weight="700">读</text></svg>`;
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
