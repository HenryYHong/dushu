// The link picture (index.html og:image): Pengu (art/pengu-cutout.png, from scripts/make-pengu.py) beside the name in
// Newsreader italic and what the app does, drawn in headless Chrome. The app icons and public/icon.svg come from make-pengu.py.
// Usage: node scripts/make-icons.mjs        Writes public/icons/og.png (1200x630)
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'icons');
const pengu = `data:image/png;base64,${readFileSync(join(root, 'art', 'pengu-cutout.png')).toString('base64')}`;
const font = (f) => `data:font/woff2;base64,${readFileSync(join(root, 'public', 'fonts', f)).toString('base64')}`;

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><style>
    @font-face { font-family: N; src: url(${font('newsreader-italic.woff2')}); font-style: italic; }
    @font-face { font-family: N; src: url(${font('newsreader-roman.woff2')}); font-style: normal; }
    html, body { margin: 0; width: 1200px; height: 630px; background: #f6f2ea; color: #1c1a17; }
    body { display: flex; align-items: center; gap: 48px; padding: 0 84px 0 64px; box-sizing: border-box; border-bottom: 14px solid #f0afaf; }
    img { width: 380px; height: 380px; flex: none; }
    h1 { margin: 0; font: italic 500 112px/1 N, serif; letter-spacing: -0.01em; }
    p { margin: 22px 0 0; font: 400 38px/1.3 N, serif; color: #4c4741; }
  </style><img src="${pengu}"><div><h1>LinguPengu</h1><p>Read real books in the language you’re learning. Tap any word to see what it means.</p></div>`);
  await page.evaluate(() => Promise.all([document.fonts.ready, ...[...document.images].map((i) => i.decode())]));
  await page.screenshot({ path: join(out, 'og.png') });
  console.log('wrote public/icons/og.png (1200x630)');
} finally {
  await browser.close();
}
