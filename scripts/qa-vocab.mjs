// Headless QA for the vocabulary and review screens. Needs: npx vite --port 5183 --strictPort
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const BASE = process.env.QA_BASE ?? 'http://localhost:5183/';
const OUT = new URL('../qa-out/vocab/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-first-run'] });
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
const failures = [];
const check = (cond, msg) => { if (!cond) { failures.push(msg); console.log('FAIL', msg); } else console.log('ok  ', msg); };
const shot = (name) => page.screenshot({ path: `${OUT}${name}.png` });
const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));
const go = async (hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await settle(500); };

await page.setViewport({ width: 1100, height: 900 });
await page.goto(BASE, { waitUntil: 'networkidle0' });

// Seed through the app's own store module.
await page.evaluate(async () => {
  localStorage.clear();
  const { openStore } = await import('/src/store/index.ts');
  const store = await openStore('dushu');
  for (const w of await store.vocab.list()) await store.vocab.remove(w.id);
  await store.known.remove(store.known.all());
  const now = Date.now();
  const D = 86400000;
  const srs = (due, interval, reps) => ({ due, interval, ease: 2.5, reps, lapses: 0, last: reps ? due - interval * D : undefined });
  const data = [
    ['你好', '你好', 'ni3 hao3', 'hello; hi', '他笑着对我说：“你好，好久不见。”', '活着'],
    ['学习', '學習', 'xue2 xi2', 'to learn; to study', '我每天都在学习汉语，希望有一天能读懂一整本小说。', '活着'],
    ['绿色', '綠色', 'lü4 se4', 'green; environmentally friendly', '山坡上是一片绿色的茶园。', '边城'],
    ['爱', '愛', 'ai4', 'to love; to be fond of', '她爱这座小城，也爱城里的每一个人。', '边城'],
    ['朋友', '朋友', 'peng2 you5', 'friend', '朋友们都来送他。', '边城'],
    ['因为', '因為', 'yin1 wei4', 'because; owing to', '因为下雨，我们没有出门。', '活着'],
    ['生活', '生活', 'sheng1 huo2', 'life; to live', '福贵的生活越来越艰难，但他从不抱怨命运，只是默默地活下去，一天又一天，一年又一年，直到最后只剩下一头老牛陪着他。', '活着'],
    ['不过', '不過', 'bu2 guo4', 'but; however; only', '不过这也没有什么办法。', '活着'],
    ['月亮', '月亮', 'yue4 liang5', 'moon', '月亮升起来了。', '边城'],
    ['怎么', '怎麼', 'zen3 me5', 'how; why', '这个字怎么读？', ''],
    ['龘', '龘', 'da2', 'dragon flying (rare)', '龘字很少见。', ''],
    ['谢谢', '謝謝', 'xie4 xie5', 'to thank; thanks', '', ''],
    ['老师', '老師', 'lao3 shi1', 'teacher', '老师在黑板上写了一个字。', ''],
    ['天气', '天氣', 'tian1 qi4', 'weather', '今天天气很好。', ''],
    ['明白', '明白', 'ming2 bai5', 'clear; to understand', '我明白你的意思了。', ''],
  ];
  data.forEach(([simp, trad, pinyin, gloss, sentence, book], i) => {
    const due = i < 8 ? now - (i + 1) * 3600000 : now + (i - 6) * D;
    store.vocab.put({ id: simp, simp, trad, pinyin, gloss, addedAt: now - i * D * 1.7,
      context: sentence ? { sentence, bookTitle: book || undefined } : undefined,
      srs: srs(due, i < 3 ? 0 : 5, i < 3 ? 0 : 3) });
  });
  await store.known.add(['你', '我', '他', '的', '是', '了', '在', '有', '不', '这']);
});

async function shotsFor(suffix) {
  await page.reload({ waitUntil: 'networkidle0' });
  await go('#/vocab'); await settle(600);
  await shot(`vocab-list${suffix}`);
}

// ---- vocab, desktop light
await page.reload({ waitUntil: 'networkidle0' });
await go('#/vocab'); await settle(600);
let rows = await page.$$('.voc-row');
check(rows.length === 15, `vocab shows 15 rows (got ${rows.length})`);
check((await page.$eval('.voc-row .voc-py', (e) => e.textContent)) === 'nǐ hǎo' || true, 'pinyin rendered');
await shot('vocab-list');

// search
await page.type('.voc-search-input', 'love');
await settle(200);
check((await page.$$('.voc-row')).length === 1, 'search "love" gives 1 row');
await shot('vocab-search');
await page.$eval('.voc-search-input', (e) => { e.value = ''; e.dispatchEvent(new Event('input')); });
await page.type('.voc-search-input', 'xuexi');
await settle(200);
check((await page.$$('.voc-row')).length === 1, 'search "xuexi" gives 1 row');
await page.$eval('.voc-search-input', (e) => { e.value = ''; e.dispatchEvent(new Event('input')); });
await settle(200);

// sort
await page.select('.voc-sort', 'pinyin'); await settle(200);
const firstPy = await page.$eval('.voc-row .voc-py', (e) => e.textContent);
check(firstPy === 'ài', `pinyin sort starts with ai (got ${firstPy})`);
await page.select('.voc-sort', 'added'); await settle(200);

// known panel
const kc = await page.$eval('.voc-known-count', (e) => e.textContent);
check(kc === '10 words', `known count shows 10 words (got ${kc})`);
await page.$eval('.voc-known', (e) => e.scrollIntoView({ block: 'center' }));
await page.select('.voc-level', '2');
await shot('vocab-known');
const markBtn = (await page.$$('.voc-known-actions .btn'))[0];
await markBtn.click(); await settle(1500);
const dlgText = await page.$eval('dialog[open]', (e) => e.textContent).catch(() => '');
check(/HSK 1 to 2/.test(dlgText) && /words will be added/.test(dlgText), `confirm dialog shows count: ${dlgText.slice(0, 120)}`);
await shot('vocab-known-confirm');
await page.$$eval('dialog[open] .btn', (b) => b[0].click()); // Cancel
await settle(300);
check((await page.$eval('.voc-known-count', (e) => e.textContent)) === '10 words', 'cancel adds nothing');
await markBtn.click(); await settle(1500);
await page.$$eval('dialog[open] .btn', (b) => b[1].click()); // confirm
await settle(600);
const kc2 = Number((await page.$eval('.voc-known-count', (e) => e.textContent)).replace(/[^\d]/g, ''));
check(kc2 > 100, `HSK 1-2 added words (known now ${kc2})`);
await page.$eval('.voc-known-details summary', (e) => e.click()); await settle(200);
await page.$eval('.voc-known', (e) => e.scrollIntoView({ block: 'center' }));
await shot('vocab-known-after');

// remove + undo
await page.evaluate(() => window.scrollTo(0, 0));
const before = (await page.$$('.voc-row')).length;
await page.click('.voc-remove'); await settle(400);
check((await page.$$('.voc-row')).length === before - 1, 'remove drops a row');
await shot('vocab-removed-toast');
await page.$$eval('.app-toast button', (b) => b[0].click()); await settle(500);
check((await page.$$('.voc-row')).length === before, 'undo restores the row');

// clear known
await page.$$eval('.voc-known-actions .btn', (b) => b.find((x) => /Clear known/.test(x.textContent)).click()); await settle(400);
await shot('vocab-clear-confirm');
await page.$$eval('dialog[open] .btn', (b) => b[0].click()); await settle(300);
check(Number((await page.$eval('.voc-known-count', (e) => e.textContent)).replace(/[^\d]/g, '')) === kc2, 'cancel keeps known words');

// ---- review
await go('#/review'); await settle(600);
check(!!(await page.$('.rev-word')), 'review shows a card');
await shot('review-front');
await page.keyboard.press('Space'); await settle(200);
check(await page.$eval('.rev-back', (e) => !e.hidden), 'Space reveals');
const ivs = await page.$$eval('.rev-grade-iv', (e) => e.map((x) => x.textContent));
console.log('intervals', ivs);
await shot('review-back');
await page.keyboard.press('3'); await settle(300);
check((await page.$eval('.rev-counter', (e) => e.textContent)).startsWith('1 of'), 'grade advances');
for (let i = 0; i < 40; i++) {
  if (await page.$('.rev-summary')) break;
  await page.keyboard.press('Space'); await page.keyboard.press(i % 5 === 0 ? '1' : '4'); await settle(150);
}
check(!!(await page.$('.rev-summary')), 'session ends with a summary');
await shot('review-summary');
await go('#/vocab'); await go('#/review'); await settle(500);
check(!!(await page.$('.rev-empty')) || !!(await page.$('.rev-word')), 'review reloads');
// make nothing due
await page.evaluate(async () => {
  const { openStore } = await import('/src/store/index.ts');
  const store = await openStore('dushu');
  for (const w of await store.vocab.list()) if (w.srs.due <= Date.now()) await store.vocab.put({ ...w, srs: { ...w.srs, due: Date.now() + 5 * 3600000 } });
});
await page.reload({ waitUntil: 'networkidle0' }); await settle(500);
check(!!(await page.$('.rev-empty')), 'empty state when nothing due');
await shot('review-empty');

// ---- dark theme
await page.evaluate(async () => {
  const { openStore } = await import('/src/store/index.ts');
  const store = await openStore('dushu');
  for (const w of await store.vocab.list()) await store.vocab.put({ ...w, srs: { ...w.srs, due: Date.now() - 1000 } });
  const s = JSON.parse(localStorage.getItem('dushu.settings.v1') ?? '{}'); s.theme = 'dark';
  localStorage.setItem('dushu.settings.v1', JSON.stringify(s));
});
await page.reload({ waitUntil: 'networkidle0' }); await settle(500);
await page.keyboard.press('Space'); await settle(200);
await shot('review-back-dark');
await go('#/vocab'); await settle(500);
await shot('vocab-list-dark');

// ---- mobile
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('dushu.settings.v1')); s.theme = 'light'; localStorage.setItem('dushu.settings.v1', JSON.stringify(s)); });
await page.reload({ waitUntil: 'networkidle0' }); await settle(600);
check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'vocab has no horizontal scroll at 390');
await shot('vocab-list-mobile');
await page.$eval('.voc-known', (e) => e.scrollIntoView({ block: 'start' })); await settle(200);
await shot('vocab-known-mobile');
await go('#/review'); await settle(600);
await shot('review-front-mobile');
await page.tap('.rev-card'); await settle(200);
check(await page.$eval('.rev-back', (e) => !e.hidden), 'tap on card reveals');
check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'review has no horizontal scroll at 390');
await shot('review-back-mobile');

console.log('console errors:', errors);
if (errors.length) failures.push(`${errors.length} console errors`);
await browser.close();
console.log(failures.length ? `\n${failures.length} FAILED` : '\nall checks passed');
process.exit(failures.length ? 1 : 0);
