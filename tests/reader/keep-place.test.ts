// @vitest-environment jsdom
// Keeping the reader's place through changes that re-style the text: a switch of layout, of script, of text size, and a
// book reopened at the top of a chapter. The fake layout (layoutFake.ts) follows the text size, so a place measured after
// the text was re-styled lands somewhere else, as it does in a browser.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AppContext, BookMeta, Chapter, Progress } from '../../src/types';
import { mount } from '../../src/ui/reader/reader';
import { closePopup } from '../../src/ui/popup/popup';
import { makeCtx, tick } from './helpers';
import { installLayout, lineY, pageHolding, perLine, scrollToLine, topLine } from './layoutFake';

beforeAll(() => installLayout());

const SENTENCE = '我们在银行门口见面，他慢慢地走了过来。';
const para = (i: number, n = 6) => ({ t: 'p' as const, text: `第${i}段，${SENTENCE.repeat(n)}` });
/** View block of the long paragraph (stored block 20, after the title). */
const LONG = 21;
const chapters: Chapter[] = [
  { title: '第一章', blocks: Array.from({ length: 30 }, (_, i) => para(i, i === 20 ? 32 : 6)) },
  { title: '第二章', blocks: [para(0)] },
];

async function setup(settings = {}) {
  const made = await makeCtx({ pinyin: 'all', layout: 'scroll', scrollFontSize: 28, fontSize: 22, spread: 'single', pageTurn: 'none', ...settings });
  const meta: BookMeta = await made.ctx.store.books.add({
    title: '测试书', author: 'T', format: 'paste', script: 'simplified', chapters, assets: new Map(),
  });
  return { ...made, meta };
}

let cleanup: (() => void) | void;
afterEach(() => {
  try { cleanup?.(); } catch { /* ignore */ }
  cleanup = undefined;
  closePopup();
  document.body.innerHTML = '';
  document.documentElement.className = '';
  window.scrollTo(0, 0);
});

const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const key = (k: string) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
const place = (p: Progress | undefined) => p && { chapter: p.chapter, block: p.block, offset: p.offset ?? 0 };
const allDrawn = () => {
  const blocks = [...document.querySelectorAll('.rd-article:not(.rd-paged) > [data-b]')];
  return blocks.length > 0 && blocks.every((b) => b.childNodes.length > 0);
};

async function open(ctx: AppContext, id: string) {
  location.hash = `#/read/${id}`;
  const root = document.createElement('div');
  document.body.appendChild(root);
  cleanup = await mount(root, { bookId: id }, ctx);
  if (!q('.rd-stage')) await vi.waitFor(() => expect(allDrawn()).toBe(true));
}

/** Put a line under the bar and wait for the debounced save. */
async function readAt(ctx: AppContext, id: string, b: number, o: number): Promise<Progress> {
  scrollToLine(b, o);
  await tick(700);
  expect(topLine()).toEqual({ b, o });
  const p = await ctx.store.progress.get(id);
  expect(place(p)).toEqual({ chapter: 0, block: b - 1, offset: o });
  return p!;
}

describe('keeping the place in Scroll', () => {
  it('Scroll -> Pages opens the page that holds the line at the top of Scroll', async () => {
    const { ctx, meta } = await setup();
    await open(ctx, meta.id);
    const o = 2 * perLine();
    await readAt(ctx, meta.id, 13, o);
    ctx.settings.set({ layout: 'pages' });
    await vi.waitFor(() => expect(q('.rd-article.rd-paged.rd-live [data-b="13"] ruby')).not.toBeNull());
    await vi.waitFor(() => expect(q('.rd-stage')!.dataset.page).toBe(String(pageHolding(13, o))));
  });

  it('Pages -> Scroll opens Scroll at the line the page starts with, not at the start of its paragraph', async () => {
    const { ctx, meta } = await setup({ layout: 'pages' });
    await open(ctx, meta.id);
    await vi.waitFor(() => expect(q('.rd-stage')?.dataset.page).toBe('1'));
    for (let i = 0; i < 4; i++) { key('ArrowRight'); await tick(5); }
    await vi.waitFor(() => expect(q('.rd-stage')!.dataset.page).toBe('5'));
    await vi.waitFor(async () => expect((await ctx.store.progress.get(meta.id))?.block).toBeGreaterThan(5));
    const p = (await ctx.store.progress.get(meta.id))!;
    expect(p.offset ?? 0).toBeGreaterThan(0); // the page starts inside a paragraph
    ctx.settings.set({ layout: 'scroll' });
    await vi.waitFor(() => expect(q('.rd-stage')).toBeNull());
    await vi.waitFor(() => expect(allDrawn()).toBe(true));
    const per = perLine();
    expect(topLine()).toEqual({ b: p.block + 1, o: Math.floor(p.offset! / per) * per });
  });

  it('converting the script keeps the line under the bar and leaves the saved place alone', async () => {
    const { ctx, meta } = await setup();
    await open(ctx, meta.id);
    const before = await readAt(ctx, meta.id, 13, 2 * perLine());
    ctx.settings.set({ script: 'traditional' });
    expect(q('.rd-article [data-b="13"]')!.textContent).toContain('們');
    expect(topLine()).toEqual({ b: 13, o: 2 * perLine() });
    await vi.waitFor(() => expect(allDrawn()).toBe(true));
    await tick(700);
    expect(topLine()).toEqual({ b: 13, o: 2 * perLine() });
    expect(await ctx.store.progress.get(meta.id)).toEqual(before);
  });

  it('a text size step keeps the top line where it was, deep inside a long paragraph', async () => {
    const { ctx, meta } = await setup();
    await open(ctx, meta.id);
    await readAt(ctx, meta.id, LONG, 16 * perLine());
    for (const k of [']', ']', '[']) {
      // The first character of the line under the bar stays at the same height (the line re-wraps around it).
      const top = topLine()!;
      const y = lineY(top.b, top.o);
      key(k);
      expect(Math.abs(lineY(top.b, top.o) - y)).toBeLessThanOrEqual(1);
    }
    expect(ctx.settings.get().scrollFontSize).toBe(30);
    await tick(700);
    const top = topLine()!;
    expect(top.b).toBe(LONG);
    expect(place(await ctx.store.progress.get(meta.id))).toEqual({ chapter: 0, block: LONG - 1, offset: top.o });
  });

  it('a book left at the very top of a chapter reopens with the chapter title in view', async () => {
    const { ctx, meta } = await setup();
    await ctx.store.progress.set({ bookId: meta.id, chapter: 0, block: 0, percent: 0, updatedAt: 1 });
    await open(ctx, meta.id);
    expect(window.scrollY).toBe(0);
    expect(q('.rd-article .rd-h1')!.getBoundingClientRect().top).toBeGreaterThan(52);
    cleanup?.(); cleanup = undefined;
    document.body.innerHTML = '';
    // A line further into the first paragraph is still restored.
    await ctx.store.progress.set({ bookId: meta.id, chapter: 0, block: 0, offset: perLine(), percent: 0, updatedAt: 2 });
    await open(ctx, meta.id);
    expect(topLine()).toEqual({ b: 1, o: perLine() });
  });

  it('the first-visit hint points to the 拼 button and the HSK level', async () => {
    localStorage.removeItem('dushu.reader-hint.v1');
    const { ctx, meta } = await setup();
    await open(ctx, meta.id);
    const lines = [...document.querySelectorAll('.rd-coach p')].map((p) => p.textContent ?? '');
    expect(lines.some((l) => l.includes('拼') && l.includes('HSK'))).toBe(true);
  });
});
