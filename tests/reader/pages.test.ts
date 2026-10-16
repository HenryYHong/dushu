// @vitest-environment jsdom
// The Pages layout end to end in jsdom. jsdom has no layout, so the column geometry is faked: three blocks to a page,
// one page per `paperW` of x. What is under test is the wiring: turning, chapter edges, progress, the lexicon, the names tab.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContext, BookMeta, Chapter, Lexicon, LexiconEntry } from '../../src/types';
import { closePopup } from '../../src/ui/popup/popup';

const segmentSpy = vi.fn();
vi.mock('../../src/core/segment', async (orig) => {
  const real = await orig<typeof import('../../src/core/segment')>();
  return { ...real, segment: (...args: Parameters<typeof real.segment>) => { segmentSpy(...args); return real.segment(...args); } };
});

const loadSpy = vi.fn();
let pushUpdate: ((lex: Lexicon) => void) | null = null;
vi.mock('../../src/core/lexicon', async (orig) => {
  const real = await orig<typeof import('../../src/core/lexicon')>();
  return {
    ...real,
    loadLexicon: async (ctx: AppContext, bookId: string, onUpdate?: (lex: Lexicon) => void) => {
      loadSpy(bookId);
      pushUpdate = onUpdate ?? null;
      return real.buildLexicon(await ctx.store.lexicon.get(bookId));
    },
  };
});

import { buildLexicon } from '../../src/core/lexicon';
import { mount } from '../../src/ui/reader/reader';
import { makeCtx, stubBrowser, tick } from './helpers';

const PAGE_W = 800;
const BLOCKS_PER_PAGE = 3;

beforeAll(() => {
  stubBrowser();
  Object.defineProperty(window, 'innerWidth', { value: PAGE_W, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 1000, configurable: true });
  // Fake column layout: block i is on page floor(i / 3); a ruby is on the page of its block.
  const pageOf = (el: Element): number => {
    const blockEl = el.closest('[data-b]');
    return blockEl ? Math.floor(Number((blockEl as HTMLElement).dataset.b) / BLOCKS_PER_PAGE) : 0;
  };
  Element.prototype.getBoundingClientRect = function () {
    const el = this as Element;
    if (el.classList?.contains('rd-paged')) return new DOMRect(0, 0, PAGE_W, 900);
    if (el.matches?.('ruby.rd-c, [data-b]') && el.closest('.rd-article.rd-paged')) return new DOMRect(pageOf(el) * PAGE_W + 10, 100, 24, 30);
    return new DOMRect(100, 100, 24, 30);
  };
  Element.prototype.getClientRects = function () {
    const el = this as Element;
    if (el.matches?.('[data-b]') && el.closest('.rd-article.rd-paged')) {
      return [new DOMRect(pageOf(el) * PAGE_W + 10, 100, 600, 40)] as unknown as DOMRectList;
    }
    return [] as unknown as DOMRectList;
  };
});

const para = (i: number) => ({ t: 'p' as const, text: `第${i}段，我们在银行门口见面，他慢慢地走了过来。` });
const chapters: Chapter[] = [
  { title: '第一章', blocks: Array.from({ length: 9 }, (_, i) => para(i)) }, // title block + 9 = 10 blocks, 4 pages
  { title: '第二章', blocks: Array.from({ length: 4 }, (_, i) => para(i)) }, // 5 blocks, 2 pages
  { title: '第三章', blocks: [para(0)] },
];

async function setup(settings = {}) {
  const made = await makeCtx({ pinyin: 'all', layout: 'pages', pageTurn: 'none', spread: 'single', ...settings });
  const meta: BookMeta = await made.ctx.store.books.add({
    title: '测试书', author: 'T', format: 'paste', script: 'simplified', chapters, assets: new Map(),
  });
  return { ...made, meta };
}

let cleanup: (() => void) | void;
beforeEach(() => { segmentSpy.mockClear(); loadSpy.mockClear(); pushUpdate = null; });
afterEach(() => { try { cleanup?.(); } catch { /* ignore */ } cleanup = undefined; closePopup(); document.body.innerHTML = ''; document.documentElement.className = ''; });

async function open(ctx: AppContext, id: string, params: Record<string, string> = {}) {
  location.hash = `#/read/${id}`;
  const root = document.createElement('div');
  document.body.appendChild(root);
  cleanup = await mount(root, { bookId: id, ...params }, ctx);
  await tick(5);
  return root;
}

const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const stage = () => q('.rd-stage')!.dataset;
const key = (k: string, init: KeyboardEventInit = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));

describe('pages layout', () => {
  it('opens in Pages when selected and lays the chapter out in pages', async () => {
    const { ctx, meta } = await setup();
    await open(ctx, meta.id);
    expect(q('.rd-root')!.classList.contains('rd-paged')).toBe(true);
    expect(document.documentElement.classList.contains('rd-lock')).toBe(true);
    expect(q('.rd-article.rd-paged.rd-live')).not.toBeNull();
    expect(stage().page).toBe('1');
    expect(Number(stage().pages)).toBe(4);
    expect(stage().per).toBe('1');
    expect(q('.rd-chapter-title')!.textContent).toBe('第一章');
    expect(q('.rd-ftr-n')!.textContent).toBe('1');
    expect(q('.rd-ftr-left')!.textContent).toBe('3 pages left in chapter');
  });

  it('turns with the arrow keys, Space and Page keys, and stops at the first page of the book', async () => {
    const { ctx, meta } = await setup();
    await open(ctx, meta.id);
    key('ArrowRight');
    await tick(5);
    expect(stage().page).toBe('2');
    key(' ');
    await tick(5);
    expect(stage().page).toBe('3');
    key('PageDown');
    await tick(5);
    expect(stage().page).toBe('4');
    key('ArrowLeft');
    await tick(5);
    expect(stage().page).toBe('3');
    key(' ', { shiftKey: true });
    await tick(5);
    expect(stage().page).toBe('2');
    key('PageUp');
    key('PageUp');
    await tick(5);
    expect(stage().page).toBe('1');
    expect(stage().chapter).toBe('0');
  });

  it('flows into the next chapter and back, landing on its last page', async () => {
    const { ctx, meta } = await setup();
    await open(ctx, meta.id);
    for (let i = 0; i < 3; i++) { key('ArrowRight'); await tick(5); }
    expect(stage().page).toBe('4');
    key('ArrowRight');
    await vi.waitFor(() => expect(q('.rd-chapter-title')!.textContent).toBe('第二章'));
    expect(stage().page).toBe('1');
    expect(stage().chapter).toBe('1');
    key('ArrowLeft');
    await vi.waitFor(() => expect(q('.rd-chapter-title')!.textContent).toBe('第一章'));
    expect(stage().page).toBe('4');
  });

  it('keeps the next chapter laid out ahead of time', async () => {
    const { ctx, meta } = await setup();
    await open(ctx, meta.id);
    await vi.waitFor(() => expect(document.querySelectorAll('.rd-article.rd-paged').length).toBe(2), { timeout: 3000 });
    expect(document.querySelectorAll('.rd-article.rd-live')).toHaveLength(1);
  });

  it('saves the first block of the page and restores it on the next open', async () => {
    const { ctx, meta } = await setup();
    await open(ctx, meta.id);
    key('ArrowRight');
    key('ArrowRight');
    await tick(5);
    cleanup?.(); cleanup = undefined;
    // Page 3 starts with view block 6 (title block + 5 paragraphs), which is stored block 5.
    await vi.waitFor(async () => expect((await ctx.store.progress.get(meta.id))?.block).toBe(5));
    await open(ctx, meta.id);
    expect(stage().page).toBe('3');
  });

  it('re-paginates when the font size changes and stays on the same block', async () => {
    const { ctx, meta } = await setup();
    await open(ctx, meta.id);
    key('ArrowRight');
    key('ArrowRight');
    await tick(5);
    expect(stage().page).toBe('3');
    ctx.settings.set({ fontSize: 30 });
    await tick(200);
    expect(stage().page).toBe('3'); // same blocks per page in the fake layout, so the same page
    expect(q('.rd-root')!.style.getPropertyValue('--rd-size')).toBe('30px');
  });

  it('sizes the pinyin grid from the pinyin setting and drops it when pinyin is off', async () => {
    const { ctx, meta } = await setup();
    await open(ctx, meta.id);
    const root = q('.rd-root')!;
    expect(root.classList.contains('rd-grid')).toBe(true);
    expect(Number(root.style.getPropertyValue('--rd-cell'))).toBeGreaterThan(1.2);
    ctx.settings.set({ pinyin: 'off' });
    expect(root.classList.contains('rd-grid')).toBe(false);
  });

  it('a click on a Han word looks it up and does not turn the page; a click on the outer third does', async () => {
    const { ctx, meta } = await setup();
    await open(ctx, meta.id);
    const word = q('.rd-article.rd-live .rd-p .rd-w ruby')!;
    word.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, clientX: 780 }));
    expect(q('.pp-pop')).not.toBeNull();
    expect(stage().page).toBe('1');
    closePopup();
    // The outer right strip of the stage is 'next' (the fake stage starts at x = 100; strips are 160 px wide on an 800 px page).
    q('.rd-stage')!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, clientX: 790 }));
    await tick(5);
    expect(stage().page).toBe('2');
    q('.rd-stage')!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, clientX: 150 }));
    await tick(5);
    expect(stage().page).toBe('1');
  });

  it('turns a page for every quick click on the outer strip, double and triple clicks included', async () => {
    const { ctx, meta } = await setup();
    await open(ctx, meta.id);
    for (const detail of [1, 2]) {
      const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true, detail, clientX: 790 });
      q('.rd-stage')!.dispatchEvent(down);
      // A double or triple click must not select the word nearest the margin (Chrome does, and the click was then spent on it).
      if (detail > 1) expect(down.defaultPrevented).toBe(true);
      q('.rd-stage')!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail, clientX: 790 }));
    }
    await tick(5);
    expect(stage().page).toBe('3');
    // Even with a word selected, a click on the page edge turns the page.
    const word = q('.rd-article.rd-live .rd-p .rd-w ruby')!.firstChild!;
    const range = document.createRange(); range.setStart(word, 0); range.setEnd(word, 1);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    q('.rd-stage')!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 3, clientX: 790 }));
    await tick(5);
    expect(stage().page).toBe('4');
  });

  it('plays every turn in full: one asked for mid-turn waits for it, and only the latest waits', async () => {
    const { ctx, meta } = await setup({ pageTurn: 'slide' });
    await open(ctx, meta.id);
    key('ArrowRight');
    expect(stage().turn).toBe('slide'); // the first turn animates
    key('ArrowRight');
    key('ArrowRight');
    // The quick ones do not cut it short: the page is still turning to 2.
    expect(stage().turn).toBe('slide');
    expect(stage().page).toBe('1');
    // Then the waiting one plays, animated, and the third press (which only replaced it) adds no turn of its own.
    await vi.waitFor(() => expect(stage().page).toBe('2'), { timeout: 3000, interval: 5 });
    expect(stage().turn).toBe('slide');
    await vi.waitFor(() => expect(stage().turn).toBeUndefined(), { timeout: 3000, interval: 5 });
    expect(stage().page).toBe('3');
    await tick(700);
    expect(stage().page).toBe('3');
  });

  it('turns once per trackpad swipe, and again for a quick second swipe while the first is still coasting', async () => {
    const { ctx, meta } = await setup();
    await open(ctx, meta.id);
    // The pager reads the events' own time stamps (wheelTurns.ts), so each event carries the time a trackpad would give it.
    let t = 1000;
    const wheel = (dx: number, gap = 8) => {
      const e = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: dx, deltaY: 0 });
      Object.defineProperty(e, 'timeStamp', { value: (t += gap) });
      q('.rd-stage')!.dispatchEvent(e);
    };
    const swipe = (dir: 1 | -1) => {
      for (const d of [3, 6, 8, 11, 14, 24, 29, 41, 49]) wheel(dir * d); // fingers moving
      wheel(dir * 120, 25); // they lift: the coasting starts
      for (let d = 112; d > 30; d *= 0.94) wheel(dir * Math.round(d), 16);
    };
    swipe(1);
    await tick(5);
    expect(stage().page).toBe('2');
    swipe(1); // a new swipe before the coasting stopped
    await tick(5);
    expect(stage().page).toBe('3');
    swipe(-1); // and straight back the other way
    await tick(5);
    expect(stage().page).toBe('2');
  });

  it('animates the turn into the next chapter when that chapter was still loading', async () => {
    const { ctx, meta } = await setup({ pageTurn: 'slide' });
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const chapter = ctx.store.books.chapter.bind(ctx.store.books);
    ctx.store.books.chapter = async (id, i) => { if (i === 1) await gate; return chapter(id, i); };
    await open(ctx, meta.id);
    for (let i = 0; i < 3; i++) {
      key('ArrowRight');
      await vi.waitFor(() => expect(stage().turn).toBeUndefined(), { timeout: 3000, interval: 5 });
    }
    expect(stage().page).toBe('4');
    key('ArrowRight');
    await tick(20);
    expect(stage().chapter).toBe('0');
    // It was one turn, waiting for its chapter, not a quick second one: it animates like any other.
    release();
    await vi.waitFor(() => expect(stage().turn).toBe('slide'), { timeout: 2000, interval: 2 });
    await vi.waitFor(() => expect(stage().chapter).toBe('1'));
  });

  it('a click in the middle toggles the bar, and turning a page tucks it away', async () => {
    const { ctx, meta } = await setup();
    await open(ctx, meta.id);
    const root = q('.rd-root')!;
    expect(root.classList.contains('rd-chrome-off')).toBe(false);
    key('ArrowRight');
    await tick(5);
    expect(root.classList.contains('rd-chrome-off')).toBe(true);
    q('.rd-stage')!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, clientX: 400 }));
    expect(root.classList.contains('rd-chrome-off')).toBe(false);
    q('.rd-stage')!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, clientX: 400 }));
    expect(root.classList.contains('rd-chrome-off')).toBe(true);
  });

  it('a click that only closes a popup does not turn the page', async () => {
    const { ctx, meta } = await setup();
    await open(ctx, meta.id);
    q('.rd-article.rd-live .rd-p .rd-w ruby')!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    expect(q('.pp-pop')).not.toBeNull();
    document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    q('.rd-stage')!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, clientX: 790 }));
    expect(stage().page).toBe('1');
  });

  it('switching to Scroll in settings rebuilds the reader at the same place', async () => {
    const { ctx, meta } = await setup();
    await open(ctx, meta.id);
    key('ArrowRight');
    key('ArrowRight');
    await tick(5);
    ctx.settings.set({ layout: 'scroll' });
    await vi.waitFor(() => expect(q('.rd-stage')).toBeNull());
    expect(q('.rd-root')!.classList.contains('rd-paged')).toBe(false);
    expect(document.documentElement.classList.contains('rd-lock')).toBe(false);
    await vi.waitFor(() => expect(q('.rd-article .rd-w')).not.toBeNull());
    ctx.settings.set({ layout: 'pages' });
    await vi.waitFor(() => expect(q('.rd-stage')).not.toBeNull());
    await vi.waitFor(() => expect(q('.rd-article.rd-live')).not.toBeNull());
  });

  it('cleans up the page lock and the stage on unmount', async () => {
    const { ctx, meta } = await setup();
    await open(ctx, meta.id);
    cleanup?.(); cleanup = undefined;
    expect(document.documentElement.classList.contains('rd-lock')).toBe(false);
    key('ArrowRight');
    await tick(5);
    expect(q('.rd-stage')).toBeNull();
  });
});

describe('book lexicon in the reader', () => {
  const entry = (word: string, extra: Partial<LexiconEntry> = {}): LexiconEntry =>
    ({ word, pinyin: 'guo1 jing4', gloss: 'name (person)', kind: 'name', count: 40, enabled: true, origin: 'auto', ...extra });

  it('loads the lexicon on open and gives it to segmentation', async () => {
    const { ctx, meta } = await setup();
    await ctx.store.lexicon.putDetected(meta.id, [entry('郭靖')]);
    await open(ctx, meta.id);
    expect(loadSpy).toHaveBeenCalledWith(meta.id);
    const lex = segmentSpy.mock.calls[0][2] as Lexicon;
    expect(lex.has('郭靖')).toBe(true);
    expect(lex.get('郭靖')?.pinyin).toBe('guo1 jing4');
  });

  it('re-segments the chapter and keeps the page when detection finishes in the background', async () => {
    const { ctx, meta } = await setup();
    await open(ctx, meta.id);
    key('ArrowRight');
    key('ArrowRight');
    await tick(5);
    expect(stage().page).toBe('3');
    segmentSpy.mockClear();
    pushUpdate!(buildLexicon([entry('银行门口')]));
    await tick(20);
    expect(segmentSpy).toHaveBeenCalled();
    expect((segmentSpy.mock.calls[0][2] as Lexicon).has('银行门口')).toBe(true);
    expect(stage().page).toBe('3');
  });

  it('keeps the open popup when names are found in the background, and applies them once it is closed', async () => {
    const { ctx, meta } = await setup();
    await open(ctx, meta.id);
    q('.rd-article.rd-live .rd-p .rd-w ruby')!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    expect(q('.pp-pop')).not.toBeNull();
    segmentSpy.mockClear();
    // The rest of the chapter may still be laying out in the background (slow machines), so count only
    // re-segmentation that uses the new names: that is what must wait for the popup to close.
    const appliedNames = () => segmentSpy.mock.calls.some((c) => (c[2] as Lexicon | undefined)?.has?.('郭靖') === true);
    pushUpdate!(buildLexicon([entry('郭靖')]));
    await tick(400);
    expect(q('.pp-pop')).not.toBeNull();
    expect(appliedNames()).toBe(false);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(q('.pp-pop')).toBeNull();
    await vi.waitFor(() => expect(appliedNames()).toBe(true), { timeout: 2000 });
  });

  it('lists names and terms in the chapter drawer and lets the reader switch one off', async () => {
    const { ctx, meta } = await setup();
    await ctx.store.lexicon.putDetected(meta.id, [entry('郭靖', { count: 90 }), entry('桃花岛', { kind: 'place', pinyin: 'tao2 hua1 dao3', gloss: 'place name', count: 30 })]);
    await open(ctx, meta.id);
    key('n');
    await vi.waitFor(() => expect(document.querySelectorAll('.rd-name')).toHaveLength(2));
    const rows = [...document.querySelectorAll('.rd-name')].map((r) => r.textContent);
    expect(rows[0]).toContain('郭靖'); // most frequent first
    expect(rows[0]).toContain('Guō Jìng'); // a person's name starts each syllable with a capital
    expect(rows[0]).toContain('Person');
    expect(rows[0]).toContain('90');
    expect(rows[1]).toContain('Place');
    const toggle = document.querySelector<HTMLInputElement>('.rd-name .rd-sw-input')!;
    expect(toggle.checked).toBe(true);
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(async () => {
      const rows2 = await ctx.store.lexicon.get(meta.id);
      expect(rows2.find((r) => r.word === '郭靖')).toMatchObject({ enabled: false, origin: 'user' });
    });
    // The reader reloaded its lexicon without the rejected word.
    await vi.waitFor(() => expect(loadSpy.mock.calls.length).toBeGreaterThan(1));
  });

  it('opens the word popup from a row of the names tab', async () => {
    const { ctx, meta } = await setup();
    await ctx.store.lexicon.putDetected(meta.id, [entry('郭靖')]);
    await open(ctx, meta.id);
    key('n');
    await vi.waitFor(() => expect(document.querySelector('.rd-name-main')).not.toBeNull());
    document.querySelector<HTMLElement>('.rd-name-main')!.click();
    await vi.waitFor(() => expect(q('.pp-pop')).not.toBeNull());
  });
});


describe('long chapters are paginated a few spreads ahead, not all at once', () => {
  const longChapters: Chapter[] = [{ title: '长章', blocks: Array.from({ length: 450 }, (_, i) => ({ t: 'p' as const, text: `第${i}段，我们在银行门口见面，他慢慢地走了过来，对我说了很多很多的话。` + '我们一起去银行门口见面，然后又回到了学校里面学习汉语。'.repeat(1) })) }];

  async function openLong(settings = {}, params: Record<string, string> = {}) {
    const made = await makeCtx({ pinyin: 'all', layout: 'pages', pageTurn: 'none', spread: 'single', ...settings });
    const meta: BookMeta = await made.ctx.store.books.add({ title: '长书', author: 'T', format: 'paste', script: 'simplified', chapters: longChapters, assets: new Map() });
    await open(made.ctx, meta.id, params);
    return { ...made, meta };
  }
  const drawn = () => [...document.querySelectorAll('.rd-article.rd-live [data-b]')].filter((b) => b.querySelector('.rd-w')).length;

  it('shows the first spread with a handful of blocks drawn and an estimated page count', async () => {
    await openLong();
    expect(stage().page).toBe('1');
    expect(stage().exact).toBe('false');
    expect(drawn()).toBeLessThan(120);
    expect(Number(stage().pages)).toBeGreaterThan(20);
    expect(q('.rd-ftr-left')!.textContent).toMatch(/^About \d+ pages left in chapter$/);
    // The blocks that are not measured yet take no part in the layout.
    expect(document.querySelectorAll('.rd-article.rd-live .rd-wait').length).toBeGreaterThan(300);
  });

  it('keeps measuring ahead of the reader as pages turn', async () => {
    await openLong();
    const before = drawn();
    // Far enough to need what was not measured at the start.
    for (let i = 0; i < 60; i++) { key('ArrowRight'); await tick(2); }
    expect(stage().page).toBe('61');
    await tick(150);
    expect(drawn()).toBeGreaterThan(before);
    expect(drawn()).toBeLessThan(300);
    expect(stage().exact).toBe('false');
  });

  it('measures to the end when the reader asks for it, and then the count is exact', async () => {
    await openLong();
    key('End');
    await vi.waitFor(() => expect(stage().exact).toBe('true'), { timeout: 5000 });
    expect(Number(stage().pages)).toBe(151); // 450 blocks and the title, three to a page
    expect(stage().page).toBe('151');
    expect(q('.rd-ftr-left')!.textContent).toBe('End of the book'); // the only chapter of the book
  });

  it('opens at a saved place far into the chapter, measuring only up to it', async () => {
    const { ctx, meta } = await openLong();
    cleanup?.(); cleanup = undefined; document.body.innerHTML = ''; // (leaving saves the place it was at)
    await tick(30);
    await ctx.store.progress.set({ bookId: meta.id, chapter: 0, block: 300, offset: 0, percent: 0.5, updatedAt: Date.now() });
    await open(ctx, meta.id);
    await vi.waitFor(() => expect(stage().page).toBe('101'), { timeout: 5000 }); // block 300 (+ the title) / 3 per page = page 100
    expect(stage().exact).toBe('false');
  });

  it('keeps the place through a change of font size, taking the chapter out of the layout first', async () => {
    const { ctx } = await openLong();
    for (let i = 0; i < 20; i++) { key('ArrowRight'); await tick(2); }
    expect(stage().page).toBe('21');
    ctx.settings.set({ fontSize: 30 });
    // At once the text is out of the layout, so the browser has nothing big to lay out at the new size.
    expect(q('.rd-stage')!.classList.contains('rd-measuring')).toBe(true);
    expect(document.querySelectorAll('.rd-article.rd-live .rd-wait').length).toBeGreaterThan(400);
    await vi.waitFor(() => expect(q('.rd-stage')!.classList.contains('rd-measuring')).toBe(false), { timeout: 5000 });
    expect(stage().page).toBe('21');
  });

  it('draws the pinyin only for the pages near the reader', async () => {
    await openLong();
    const withRt = [...document.querySelectorAll('.rd-article.rd-live [data-b]')].filter((b) => b.querySelector('rt')).length;
    expect(withRt).toBeGreaterThan(0);
    expect(withRt).toBeLessThan(40);
  });
});
