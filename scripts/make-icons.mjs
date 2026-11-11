// Renders the app icons (PNG), public/icon.svg and the link picture from Pengu (src/ui/pengu.ts: the head in its scarf on the
// app's red), using headless Chrome.
// Usage: node scripts/make-icons.mjs        Writes public/icon.svg and public/icons/*.png
//   apple-touch-icon.png  180, full bleed (iOS rounds the corners itself)
//   icon-192.png, icon-512.png   rounded, "any" purpose
//   icon-maskable-512.png        full bleed, Pengu inside the central 80 percent safe zone
//   og.png                       1200x630, Pengu waving beside the name (index.html og:image)
import puppeteer from 'puppeteer-core';
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'icons');
mkdirSync(out, { recursive: true });

// pengu.ts is TypeScript with no imports: bundled here and loaded as a module.
const bundled = await build({ entryPoints: [join(root, 'src', 'ui', 'pengu.ts')], bundle: true, format: 'esm', write: false, platform: 'neutral' });
const { penguMark, penguSvg } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

/** kind: 'round' (corners drawn, transparent outside), 'bleed' (full square), 'maskable' (full square, Pengu smaller). */
const svg = (kind) => penguMark({ rounded: kind === 'round' ? 26 : 0, scale: kind === 'maskable' ? 0.8 : 1 })
  .replace(' class="pengu-mark"', '').replace(' aria-hidden="true" focusable="false"', '');

writeFileSync(join(root, 'public', 'icon.svg'), svg('round') + '\n');
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
    await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block;width:${px}px;height:${px}px}</style>${svg(kind)}`);
    await page.screenshot({ path: join(out, name), omitBackground: kind === 'round' });
    console.log(`wrote public/icons/${name} (${px}px)`);
  }
  // The picture a shared link shows (og:image in index.html): Pengu waving, the name in Newsreader italic and what the app does.
  const font = (f) => `data:font/woff2;base64,${readFileSync(join(root, 'public', 'fonts', f)).toString('base64')}`;
  await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><style>
    @font-face { font-family: N; src: url(${font('newsreader-italic.woff2')}); font-style: italic; }
    @font-face { font-family: N; src: url(${font('newsreader-roman.woff2')}); font-style: normal; }
    html, body { margin: 0; width: 1200px; height: 630px; background: #f6f2ea; color: #1c1a17; }
    body { display: flex; align-items: center; gap: 40px; padding: 0 80px 0 56px; box-sizing: border-box; border-bottom: 14px solid #c13616; }
    svg { width: 380px; height: 380px; flex: none; }
    h1 { margin: 0; font: italic 500 112px/1 N, serif; letter-spacing: -0.01em; }
    p { margin: 22px 0 0; font: 400 38px/1.3 N, serif; color: #4c4741; }
  </style>${penguSvg('wave')}<div><h1>LinguPengu</h1><p>Read real books in the language you’re learning. Tap any word to see what it means.</p></div>`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(out, 'og.png') });
  console.log('wrote public/icons/og.png (1200x630)');
} finally {
  await browser.close();
}
