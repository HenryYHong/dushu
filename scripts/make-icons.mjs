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
  // The picture a shared link shows (og:image in index.html): the icon, the name in Newsreader italic and what the app does.
  const font = (f) => `data:font/woff2;base64,${readFileSync(join(root, 'public', 'fonts', f)).toString('base64')}`;
  await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><style>
    @font-face { font-family: N; src: url(${font('newsreader-italic.woff2')}); font-style: italic; }
    @font-face { font-family: N; src: url(${font('newsreader-roman.woff2')}); font-style: normal; }
    html, body { margin: 0; width: 1200px; height: 630px; background: #f6f2ea; color: #1c1a17; }
    body { display: flex; align-items: center; gap: 64px; padding: 0 96px; box-sizing: border-box; border-bottom: 14px solid #c13616; }
    svg { width: 260px; height: 260px; flex: none; filter: drop-shadow(0 18px 30px rgba(60, 30, 10, 0.18)); }
    h1 { margin: 0; font: italic 500 104px/1 N, serif; letter-spacing: -0.01em; }
    p { margin: 22px 0 0; font: 400 38px/1.3 N, serif; color: #4c4741; }
  </style>${svg('round')}<div><h1>Globereader</h1><p>Read real books in the language you are learning, with every word a tap away.</p></div>`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(out, 'og.png') });
  console.log('wrote public/icons/og.png (1200x630)');
} finally {
  await browser.close();
}
