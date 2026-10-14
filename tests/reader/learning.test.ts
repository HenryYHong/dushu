// @vitest-environment jsdom
// Words learned from reading, wired into the reader (Scroll layout in jsdom: every block has the same small box, so all are in view).
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { localDay } from '../../src/core/autoKnown';
import type { AppContext, BookMeta, Chapter } from '../../src/types';
import { closePopup } from '../../src/ui/popup/popup';
import { mount } from '../../src/ui/reader/reader';
import { makeCtx, stubBrowser } from './helpers';

beforeAll(() => stubBrowser());

const chapters: Chapter[] = [
  { title: '第一章', blocks: [{ t: 'p', text: '我们在银行门口见面。' }, { t: 'p', text: '他慢慢地走了过来。' }] },
  { title: '第二章', blocks: [{ t: 'p', text: '她爱这座小城。' }] },
];

let cleanup: (() => void) | void;
afterEach(() => {
  try { cleanup?.(); } catch { /* ignore */ }
  cleanup = undefined;
  closePopup();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

async function setup(settings = {}) {
  const made = await makeCtx({ pinyin: 'unknown', layout: 'scroll', autoKnown: true, ...settings });
  const meta: BookMeta = await made.ctx.store.books.add({
    title: '测试书', author: 'T', format: 'paste', script: 'simplified', chapters, assets: new Map(),
  });
  return { ...made, meta };
}

async function open(ctx: AppContext, id: string) {
  location.hash = `#/read/${id}`;
  const root = document.createElement('div');
  document.body.appendChild(root);
  cleanup = await mount(root, { bookId: id }, ctx);
  return root;
}

const wordEl = (w: string) => [...document.querySelectorAll<HTMLElement>('.rd-article .rd-w')]
  .find((el) => [...el.querySelectorAll('ruby')].map((r) => (r.firstChild as Text).data).join('') === w)!;
const rowOf = async (ctx: AppContext, w: string) => (await ctx.store.seen.get([w]))[0];

describe('learning known words while reading', () => {
  it('counts the words of paragraphs that stayed in view', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const { ctx, meta } = await setup();
    await open(ctx, meta.id);
    vi.advanceTimersByTime(5000);
    await vi.waitFor(async () => expect((await rowOf(ctx, '银行'))?.n).toBe(1));
    expect((await rowOf(ctx, '慢慢'))?.n).toBe(1);
  });

  it('does nothing with the setting off', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const { ctx, meta } = await setup({ autoKnown: false });
    await open(ctx, meta.id);
    vi.advanceTimersByTime(8000);
    await new Promise((r) => setTimeout(r, 30));
    expect(await rowOf(ctx, '银行')).toBeUndefined();
  });

  it('a word that reaches the bar loses its pinyin on the open page, without drawing the chapter again', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const { ctx, meta } = await setup();
    await ctx.store.seen.put([{ word: '银行', n: 9, days: 1, lastDay: localDay(Date.now()) - 1 }]);
    await open(ctx, meta.id);
    const el = wordEl('银行');
    expect(el.classList.contains('rd-known')).toBe(false);
    vi.advanceTimersByTime(5000);
    await vi.waitFor(() => expect(ctx.store.known.isAuto('银行')).toBe(true));
    await vi.waitFor(() => expect(el.classList.contains('rd-known')).toBe(true));
    expect(wordEl('银行')).toBe(el); // the same node: marks were updated in place
  });

  it('clicking a learned word takes it off the known list and clears its count', async () => {
    const { ctx, meta } = await setup();
    await ctx.store.known.add(['银行'], { auto: true });
    await ctx.store.seen.put([{ word: '门口', n: 4, days: 1, lastDay: 1 }]);
    await open(ctx, meta.id);
    wordEl('银行').querySelector('ruby')!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    await vi.waitFor(() => expect(ctx.store.known.has('银行')).toBe(false));
    closePopup();
    wordEl('门口').querySelector('ruby')!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    await vi.waitFor(async () => expect(await rowOf(ctx, '门口')).toBeUndefined());
  });

  it('the word card says a word was learned from reading', async () => {
    const { ctx, meta } = await setup();
    await ctx.store.known.add(['慢慢'], { auto: true });
    await ctx.store.known.add(['银行']);
    // With the setting off a lookup leaves learned words alone, so the card can be read as it is.
    ctx.settings.set({ autoKnown: false });
    await open(ctx, meta.id);
    wordEl('慢慢').querySelector('ruby')!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    const btn = document.querySelector<HTMLElement>('.pp-known')!;
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.title).toMatch(/Learned from reading/);
    closePopup();
    wordEl('银行').querySelector('ruby')!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    expect(document.querySelector<HTMLElement>('.pp-known')!.title).toMatch(/^Known\./);
  });

  it('the pinyin menu offers the switch in Unknown mode', async () => {
    const { ctx, meta } = await setup({ autoKnown: false });
    await open(ctx, meta.id);
    document.querySelector<HTMLElement>('.rd-pinyin-btn')!.click();
    const sw = [...document.querySelectorAll<HTMLElement>('.rd-pinyin-menu .rd-switch')].find((b) => b.getAttribute('aria-label') === 'Learn as I read')!;
    expect(sw.closest<HTMLElement>('.rd-row')!.hidden).toBe(false);
    sw.click();
    expect(ctx.settings.get().autoKnown).toBe(true);
    ctx.settings.set({ pinyin: 'all' });
    expect(sw.closest<HTMLElement>('.rd-row')!.hidden).toBe(true);
  });
});

describe('what the Pages layout counts', () => {
  const tok = (text: string, start: number, kind: 'han' | 'punct' = 'han') => ({ text, start, end: start + text.length, kind, inDict: true });
  const block = (index: number, text: string, tokens: ReturnType<typeof tok>[]) =>
    ({ index, kind: 'text', text, rendered: { tokens } }) as unknown as import('../../src/ui/reader/chapter').BlockState;
  const v = {
    blocks: [
      block(0, '第一章', [tok('第一', 0), tok('章', 2)]),
      block(1, '我们在银行门口。', [tok('我们', 0), tok('在', 2), tok('银行', 3), tok('门口', 5), tok('。', 7, 'punct')]),
      block(2, '他走了。', [tok('他', 0), tok('走', 1), tok('了', 2), tok('。', 3, 'punct')]),
    ],
  } as unknown as import('../../src/ui/reader/chapter').ChapterView;

  it('takes the text from the top of the spread to the top of the next one', async () => {
    const { pagesView } = await import('../../src/ui/reader/learning');
    const view = pagesView(v, 2, { start: { block: 1, offset: 3 }, end: { block: 2, offset: 1 } });
    expect(view.units.flatMap((u) => u.words().map((w) => w.word))).toEqual(['银行', '门口', '他']);
    expect(view.units.map((u) => u.key)).toEqual(['2:1:3', '2:2:0']);
    // One spread, one reading time: five characters need the minimum.
    expect(new Set(view.units.map((u) => u.needMs))).toEqual(new Set([3000]));
    expect(view.top).toBe(2 * 1e9 + 1 * 1e5 + 3);
  });

  it('runs to the end of the chapter when the spread is the last one', async () => {
    const { pagesView } = await import('../../src/ui/reader/learning');
    const view = pagesView(v, 0, { start: { block: 2, offset: 0 }, end: null });
    expect(view.units.flatMap((u) => u.words().map((w) => `${w.id}=${w.word}`))).toEqual(['0:2:0=他', '0:2:1=走', '0:2:2=了']);
  });
});
