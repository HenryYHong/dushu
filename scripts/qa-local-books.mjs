// Verify the owner-requested EPUBs can be imported through the running local preview.
// Run after `npm run build` and `npm run preview -- --strictPort`.
import puppeteer from 'puppeteer-core';

/**
 * For a server this script did not start (its sync folder may be the owner's): sync is switched off in the page before the
 * app starts, and again after any localStorage.clear(), so nothing this run saves reaches the Mac's copy.
 */
const SYNC_OFF = () => {
  try {
    const key = 'dushu.sync.off.v1';
    localStorage.setItem(key, '1');
    const clear = Storage.prototype.clear;
    Storage.prototype.clear = function () { clear.call(this); try { if (this === localStorage) this.setItem(key, '1'); } catch { /* blocked */ } };
  } catch { /* storage blocked: the app cannot sync either */ }
};

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-first-run', '--no-default-browser-check'],
});
try {
  const page = await browser.newPage();
  // 4317 is the owner's server with his sync folder.
  await page.evaluateOnNewDocument(SYNC_OFF);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://localhost:4317/?importLocalBooks=1#/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const body = document.body.innerText;
    return body.includes('活着') && body.includes('射雕英雄传') && !body.includes('Importing');
  }, { timeout: 120000 });
  const text = await page.evaluate(() => document.body.innerText);
  if (!text.includes('活着') || !text.includes('射雕英雄传') || errors.length) {
    throw new Error(`Local book import failed: ${errors.join('; ')}`);
  }
  await page.goto('http://localhost:4317/?importLocalBooks=1#/', { waitUntil: 'networkidle0' });
  const titles = await page.$$eval('.lib-card-title', nodes => nodes.map(node => node.textContent?.trim()));
  if (titles.filter(title => title === '活着').length !== 1 || titles.filter(title => title === '射雕英雄传').length !== 1) {
    throw new Error(`Repeat import created duplicate book cards: ${titles.join(', ')}`);
  }
  console.log('Both local EPUBs appeared once in a fresh browser library; repeat import made no duplicates.');
} finally {
  await browser.close();
}
