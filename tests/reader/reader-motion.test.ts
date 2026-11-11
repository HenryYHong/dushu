// @vitest-environment jsdom
// The reader's own controls move a little as they come and go: the Aa and pinyin menus fade back into their button, the chapter
// drawer slides back to its side, the read-aloud bar drops away, and a bookmark just set fills with a small pop. None of it may
// hold the reader up: whatever is leaving is already closed for the keys, the next menu and the next tap, and where the browser
// cannot animate (jsdom, and so every other test) or the reader asks for less motion, it is simply gone.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bookmark } from '../../src/types';

vi.mock('../../src/speech/tts', () => ({
  canSpeak: () => true,
  stopSpeaking: vi.fn(),
  pauseSpeaking: vi.fn(),
  resumeSpeaking: vi.fn(),
  setSpeakingRate: vi.fn(),
  speakSequence: vi.fn((_parts: string[], options: { onStart?: () => void }) => {
    options.onStart?.();
    return new Promise<boolean>(() => {});
  }),
  speak: vi.fn(async () => true),
}));

import { closePopup } from '../../src/ui/popup/popup';
import { buildDisplayMenu, closePopover, openPopover, popoverOpenFor } from '../../src/ui/reader/menus';
import { createToc } from '../../src/ui/reader/toc';
import { mount } from '../../src/ui/reader/reader';
import { makeCtx, stubBrowser, tick } from './helpers';

/** One animation as the fake Element.animate gave it out: finish() ends it, as the browser would. */
interface Played { el: Element; frames: Keyframe[]; opts: KeyframeAnimationOptions; finished: Promise<void>; finish(): void; cancel: () => void; reverse: () => void }
let played: Played[] = [];
const proto = Element.prototype as unknown as { animate?: unknown };
/** Element.animate as a browser has it (jsdom has none); each animation ends only when the test says so. */
function canAnimate(): void {
  proto.animate = function (this: Element, frames: Keyframe[], opts: KeyframeAnimationOptions) {
    let done!: () => void;
    let fail!: (e: unknown) => void;
    const finished = new Promise<void>((res, rej) => { done = res; fail = rej; });
    finished.catch(() => {});
    const a: Played = { el: this, frames, opts, finished, finish: () => done(), cancel: vi.fn(() => fail(new Error('canceled'))), reverse: vi.fn() };
    played.push(a);
    return a;
  };
}
/** A reader who has asked for less motion. */
function reduceMotion(): void {
  (globalThis as { matchMedia?: unknown }).matchMedia = (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} });
}
const finishAll = async () => { for (const a of played) a.finish(); await tick(); };

beforeAll(() => stubBrowser());
let cleanup: (() => void) | void;
afterEach(() => {
  try { cleanup?.(); } catch { /* ignore */ }
  cleanup = undefined;
  closePopover(true);
  closePopup();
  delete proto.animate;
  delete (globalThis as { matchMedia?: unknown }).matchMedia;
  played = [];
  document.body.innerHTML = '';
});

describe('the Aa and pinyin menus', () => {
  async function menu() {
    const { ctx } = await makeCtx();
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    btn.focus();
    openPopover(btn, buildDisplayMenu(ctx).el, undefined, { label: 'Display settings' });
    return { ctx, btn };
  }

  it('grow from their own button', async () => {
    await menu();
    // The button is 24 px wide at x 100; the bubble is pushed to the window's left margin, 8 px.
    expect((document.querySelector('.rd-pop') as HTMLElement).style.transformOrigin).toBe('104px top');
  });

  it('fade back on close, already closed for focus and the next tap, then are gone', async () => {
    const { btn } = await menu();
    canAnimate();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    const pop = document.querySelector<HTMLElement>('.rd-pop')!;
    expect(pop).not.toBeNull();
    expect(pop.inert).toBe(true);
    expect(pop.classList.contains('rd-leaving')).toBe(true);
    expect(popoverOpenFor(btn)).toBe(false);
    expect(document.activeElement).toBe(btn);
    expect(played.at(-1)!.frames.at(-1)).toMatchObject({ opacity: 0 });
    expect(Number(played.at(-1)!.opts.duration)).toBeLessThanOrEqual(200);
    await finishAll();
    expect(document.querySelector('.rd-pop')).toBeNull();
  });

  it('give way at once to the next menu: never two on screen', async () => {
    const { ctx, btn } = await menu();
    canAnimate();
    closePopover();
    expect(document.querySelectorAll('.rd-pop')).toHaveLength(1);
    openPopover(btn, buildDisplayMenu(ctx).el, undefined, { label: 'Display settings' });
    expect(document.querySelectorAll('.rd-pop')).toHaveLength(1);
    expect(document.querySelector('.rd-pop')!.classList.contains('rd-leaving')).toBe(false);
  });

  it('are simply gone when the reader asks for less motion, or the reader itself is going', async () => {
    await menu();
    canAnimate();
    closePopover(true);
    expect(document.querySelector('.rd-pop')).toBeNull();
    await menu();
    reduceMotion();
    closePopover();
    expect(document.querySelector('.rd-pop')).toBeNull();
    expect(played).toHaveLength(0);
  });
});

describe('the chapter drawer', () => {
  async function drawer() {
    const { ctx } = await makeCtx();
    const titles = Array.from({ length: 20 }, (_, i) => `第${i + 1}章`);
    const book = { id: 'x', title: '书', author: '', format: 'paste' as const, script: 'simplified' as const, addedAt: 0, chapterCount: 20, charCount: 1, chapterOffsets: [], chapterTitles: titles };
    const toc = createToc(ctx, book, () => {}, undefined, { bookmarks: { list: async () => [], pick: () => {}, remove: () => {} } });
    return toc;
  }
  const root = () => document.querySelector<HTMLElement>('.rd-toc-root')!;

  it('slides back to its side on close, closed at once for the keys, and is hidden when it is out', async () => {
    const toc = await drawer();
    toc.open(0);
    canAnimate();
    toc.close();
    expect(toc.isOpen()).toBe(false);
    expect(root().hidden).toBe(false);
    expect(root().inert).toBe(true);
    expect(root().classList.contains('rd-leaving')).toBe(true);
    const slide = played.find((a) => a.el.classList.contains('rd-toc'))!;
    expect(String(slide.frames.at(-1)!.transform)).toContain('translateX(calc(-100%');
    expect(played.find((a) => a.el.classList.contains('rd-backdrop'))!.frames.at(-1)).toMatchObject({ opacity: 0 });
    await finishAll();
    expect(root().hidden).toBe(true);
    expect(root().inert).toBe(false);
    toc.dispose();
  });

  it('opened again while it slides out, comes back from where it got to and stays', async () => {
    const toc = await drawer();
    toc.open(0);
    canAnimate();
    toc.close();
    const out = played.slice();
    toc.open(0);
    for (const a of out) expect(a.reverse).toHaveBeenCalled();
    expect(toc.isOpen()).toBe(true);
    expect(root().inert).toBe(false);
    await finishAll();
    expect(root().hidden).toBe(false);
    toc.dispose();
  });

  it('fades in the list of a tab picked inside it, not the one it opens on', async () => {
    const toc = await drawer();
    canAnimate();
    toc.open(0, 'bookmarks');
    expect(played).toHaveLength(0);
    [...document.querySelectorAll<HTMLElement>('.rd-toc-tab')].find((t) => t.textContent === 'Chapters')!.click();
    const fade = played.find((a) => a.el.matches('.rd-toc-list:not(.rd-marks)'))!;
    expect(fade.frames[0]).toMatchObject({ opacity: 0 });
    expect(Number(fade.opts.duration)).toBeLessThanOrEqual(200);
    toc.dispose();
  });

  it('is simply hidden where nothing can move', async () => {
    const toc = await drawer();
    toc.open(0);
    toc.close();
    expect(root().hidden).toBe(true);
    toc.open(0);
    canAnimate();
    reduceMotion();
    toc.close();
    expect(root().hidden).toBe(true);
    expect(played).toHaveLength(0);
    toc.dispose();
  });
});

describe('the read-aloud bar and the bookmark button', () => {
  async function open() {
    const { ctx } = await makeCtx({ layout: 'scroll', pageTurn: 'none', spread: 'single' });
    const book = await ctx.store.books.add({ title: '测试', author: '', format: 'paste', script: 'simplified',
      chapters: [{ title: '第一章', blocks: [{ t: 'p', text: '我们在银行门口见面。' }, { t: 'p', text: '他慢慢地走了过来。' }] }], assets: new Map() });
    location.hash = `#/read/${book.id}`;
    const el = document.createElement('div');
    document.body.appendChild(el);
    cleanup = await mount(el, { bookId: book.id }, ctx);
    await tick(10);
    closePopup();
    return { ctx, book };
  }
  const audio = () => document.querySelector<HTMLElement>('.rd-audio')!;
  const readBtn = () => document.querySelector<HTMLButtonElement>('.rd-speech-btn')!;
  const markBtn = () => document.querySelector<HTMLButtonElement>('.rd-mark-btn')!;

  it('the bar drops away when reading stops, and stays put when reading starts again before it is gone', async () => {
    await open();
    readBtn().click();
    await vi.waitFor(() => expect(audio().hidden).toBe(false));
    canAnimate();
    readBtn().click();
    expect(readBtn().getAttribute('aria-pressed')).toBe('false');
    expect(audio().hidden).toBe(false);
    expect(audio().inert).toBe(true);
    const drop = played.find((a) => a.el === audio())!;
    expect(drop.frames.at(-1)).toMatchObject({ opacity: 0, transform: 'translate(-50%, 12px)' });
    // Read again at once: the same bar, back in use, never hidden in between.
    readBtn().click();
    await vi.waitFor(() => expect(readBtn().getAttribute('aria-pressed')).toBe('true'));
    expect(drop.cancel).toHaveBeenCalled();
    expect(audio().inert).toBe(false);
    expect(audio().hidden).toBe(false);
    // Stopped for good: hidden once it is down.
    readBtn().click();
    await finishAll();
    expect(audio().hidden).toBe(true);
  });

  it('a bookmark the reader sets pops as it fills; taking it away, or coming to one, does not', async () => {
    const { ctx, book } = await open();
    canAnimate();
    const pops = () => played.filter((a) => a.el.closest('.rd-mark-btn'));
    markBtn().click();
    await vi.waitFor(() => expect(markBtn().getAttribute('aria-pressed')).toBe('true'));
    expect(pops()).toHaveLength(1);
    // The same pop as Save and Known in a word card (vocab/motion.ts popIcon): one meaning, one motion.
    expect(pops()[0].frames.map((f) => f.transform)).toEqual(['none', 'scale(1.15)', 'none']);
    const [mark] = await ctx.store.bookmarks.list(book.id) as Bookmark[];
    markBtn().click();
    await vi.waitFor(() => expect(markBtn().getAttribute('aria-pressed')).toBe('false'));
    // Back by Undo (or another device): the button fills without a pop.
    await ctx.store.bookmarks.put(mark);
    await vi.waitFor(() => expect(markBtn().getAttribute('aria-pressed')).toBe('true'));
    expect(pops()).toHaveLength(1);
  });
});

// The reading walkthrough (ui/guide.ts) covers the reader the first time a book opens; these tests read past it.
beforeEach(() => { try { localStorage.setItem('dushu.reader-hint.v1', '1'); } catch { /* no storage here */ } });
