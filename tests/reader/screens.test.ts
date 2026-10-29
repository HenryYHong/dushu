// @vitest-environment jsdom
// The reader's behavior that a reader would notice: a chapter that fails, choosing words with the keyboard, taps near the
// edge of a spread, the book's script in the chrome, the way on at the end of a chapter. Pages geometry is faked as in
// pages.test.ts (three blocks to a page); jsdom has no layout.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContext, BookMeta, Chapter } from '../../src/types';
import { closePopup } from '../../src/ui/popup/popup';
import { mount as mountSettings } from '../../src/ui/settings/settings';
import { mount } from '../../src/ui/reader/reader';
import { makeCtx, stubBrowser, tick } from './helpers';

const PAGE_W = 800;

beforeAll(() => {
  stubBrowser();
  Object.defineProperty(window, 'innerWidth', { value: PAGE_W, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 1000, configurable: true });
  const pageOf = (el: Element): number => {
    const blockEl = el.closest('[data-b]');
    return blockEl ? Math.floor(Number((blockEl as HTMLElement).dataset.b) / 3) : 0;
  };
  Element.prototype.getBoundingClientRect = function () {
    const el = this as Element;
    if (el.classList?.contains('rd-paged')) return new DOMRect(0, 0, PAGE_W, 900);
    if (el.matches?.('ruby.rd-c, [data-b]') && el.closest('.rd-article.rd-paged')) return new DOMRect(pageOf(el) * PAGE_W + 10, 100, 24, 30);
    return new DOMRect(100, 100, 24, 30);
  };
  Element.prototype.getClientRects = function () {
    const el = this as Element;
    if (el.matches?.('[data-b]') && el.closest('.rd-article.rd-paged')) return [new DOMRect(pageOf(el) * PAGE_W + 10, 100, 600, 40)] as unknown as DOMRectList;
    return [] as unknown as DOMRectList;
  };
});

const para = (i: number) => ({ t: 'p' as const, text: `第${i}段，我們在銀行門口見面，他慢慢地走了過來。` });
const chapters: Chapter[] = [
  { title: '第一章 開始', blocks: Array.from({ length: 9 }, (_, i) => para(i)) },
  { title: '第二章 繼續', blocks: Array.from({ length: 4 }, (_, i) => para(i)) },
  { title: '第三章 結束', blocks: [para(0)] },
];

async function setup(settings = {}, opts: { failing?: number[] } = {}) {
  const made = await makeCtx({ pinyin: 'all', layout: 'pages', pageTurn: 'none', spread: 'single', ...settings });
  const meta: BookMeta = await made.ctx.store.books.add({
    title: '測試書', author: 'T', format: 'paste', script: 'traditional', chapters, assets: new Map(),
  });
  if (opts.failing?.length) {
    const real = made.ctx.store.books.chapter.bind(made.ctx.store.books);
    made.ctx.store.books.chapter = async (id: string, index: number) => {
      if (opts.failing!.includes(index)) throw new Error(`chapter ${index} is broken`);
      return real(id, index);
    };
  }
  return { ...made, meta };
}

let cleanup: (() => void) | void;
beforeEach(() => { try { localStorage.clear(); } catch { /* ignore */ } vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => {
  try { cleanup?.(); } catch { /* ignore */ }
  cleanup = undefined;
  closePopup();
  document.body.innerHTML = '';
  document.documentElement.className = '';
  vi.restoreAllMocks();
});

function teardown(): void {
  try { (cleanup as (() => void) | undefined)?.(); } catch { /* ignore */ }
  cleanup = undefined;
  document.body.innerHTML = '';
}

async function open(ctx: AppContext, id: string, params: Record<string, string> = {}) {
  location.hash = `#/read/${id}${params.ch ? `?ch=${params.ch}` : ''}`;
  const root = document.createElement('div');
  document.body.appendChild(root);
  cleanup = await mount(root, { bookId: id, ...params }, ctx);
  await tick(5);
  return root;
}

const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const qa = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const stage = () => q('.rd-stage')!.dataset;
const key = (k: string, init: KeyboardEventInit = {}) => (document.activeElement ?? document).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
const button = (label: string) => qa('.rd-fail button, .rd-fail a').find((b) => b.textContent?.includes(label));

describe('a chapter that cannot be shown', () => {
  it('in Scroll shows a plain message with the way out, never a blank page, and arrow keys still turn chapters', async () => {
    const { ctx, meta } = await setup({ layout: 'scroll' }, { failing: [1] });
    await open(ctx, meta.id, { ch: '1' });
    expect(q('.rd-fail h2')!.textContent).toBe('Could not display this chapter');
    expect(button('Previous chapter')).toBeTruthy();
    expect(button('Next chapter')).toBeTruthy();
    expect(button('Open chapter list')).toBeTruthy();
    expect(button('Try again')).toBeTruthy();
    expect(q('.rd-chapter-title')!.textContent).toContain('第二章');
    key('ArrowLeft');
    await vi.waitFor(() => expect(q('.rd-chapter-title')!.textContent).toContain('第一章'));
    expect(q('.rd-fail')).toBeNull();
  });

  it('in Pages shows the same state over the stage, and Previous chapter recovers', async () => {
    const { ctx, meta } = await setup({}, { failing: [1] });
    await open(ctx, meta.id, { ch: '1' });
    expect(q('.rd-fail')).not.toBeNull();
    expect(q('.rd-root')!.contains(q('.rd-fail'))).toBe(true);
    button('Previous chapter')!.click();
    await vi.waitFor(() => expect(q('.rd-stage')!.dataset.chapter).toBe('0'));
    expect(q('.rd-fail')).toBeNull();
  });

  it('turning into a chapter that fails shows the state too instead of doing nothing', async () => {
    const { ctx, meta } = await setup({}, { failing: [1] });
    await open(ctx, meta.id);
    for (let i = 0; i < 4; i++) { key('ArrowRight'); await tick(5); }
    await vi.waitFor(() => expect(q('.rd-fail')).not.toBeNull(), { timeout: 3000 });
    expect(q('.rd-chapter-title')!.textContent).toContain('第二章');
  });

  it('keeps the saved place when a chapter fails, and after two failures opens the chapter list instead of the chapter', async () => {
    const { ctx, meta } = await setup({ layout: 'scroll' });
    await ctx.store.progress.set({ bookId: meta.id, chapter: 1, block: 2, percent: 0.3, updatedAt: Date.now() });
    const real = ctx.store.books.chapter.bind(ctx.store.books);
    ctx.store.books.chapter = async (id: string, index: number) => { if (index === 1) throw new Error('broken'); return real(id, index); };
    await open(ctx, meta.id); // first failure
    expect(q('.rd-fail')).not.toBeNull();
    expect(button('Try again')).toBeTruthy();
    expect((await ctx.store.progress.get(meta.id))?.block).toBe(2); // the failed chapter did not overwrite the place
    teardown();
    await open(ctx, meta.id); // second failure: no more tries offered
    expect(q('.rd-fail')).not.toBeNull();
    expect(button('Try again')).toBeUndefined();
    teardown();
    await open(ctx, meta.id); // a third time is not tried: the list opens
    expect(q('.rd-fail')).not.toBeNull();
    expect(q('.rd-toc-root')!.hidden).toBe(false);
    // Picking another chapter recovers, and the failure count for the good chapter stays clear.
    q('.rd-toc-item')!.click();
    await vi.waitFor(() => expect(q('.rd-fail')).toBeNull());
  });
});

describe('choosing words with the keyboard', () => {
  it('Enter puts a cursor on the first word of the page; arrows move it; Enter opens the card; Escape returns to the word, then ends it', async () => {
    const { ctx, meta } = await setup();
    await open(ctx, meta.id);
    key('Enter', { });
    const first = document.activeElement as HTMLElement;
    expect(first.classList.contains('rd-w')).toBe(true);
    expect(first.classList.contains('rd-cursor')).toBe(true);
    expect(first.getAttribute('role')).toBe('button');
    expect(first.getAttribute('aria-label')).toMatch(/, [a-zü]/);
    key('ArrowRight');
    const second = document.activeElement as HTMLElement;
    expect(second).not.toBe(first);
    expect(first.classList.contains('rd-cursor')).toBe(false);
    expect(second.classList.contains('rd-cursor')).toBe(true);
    key('ArrowLeft');
    expect(document.activeElement).toBe(first);
    key('Enter');
    expect(q('.pp-pop')).not.toBeNull();
    closePopup();
    await tick(5);
    expect(document.activeElement).toBe(first);
    key('Escape');
    expect(q('.rd-cursor')).toBeNull();
  });

  it('while the cursor is on, the arrows choose words rather than turn pages; Page Down still turns the page and puts the cursor away', async () => {
    const { ctx, meta } = await setup();
    await open(ctx, meta.id);
    key('Enter');
    key('ArrowRight');
    expect(stage().page).toBe('1');
    key('PageDown');
    await tick(5);
    expect(stage().page).toBe('2');
    expect(q('.rd-cursor')).toBeNull();
  });

  it('works in Scroll too, and the text area can take Tab focus', async () => {
    const { ctx, meta } = await setup({ layout: 'scroll' });
    await open(ctx, meta.id);
    expect(q('.rd-article')!.tabIndex).toBe(0);
    key('Enter');
    expect(document.activeElement?.classList.contains('rd-cursor')).toBe(true);
  });

  it('gives the page itself a name and a place in the Tab order in Pages', async () => {
    const { ctx, meta } = await setup();
    await open(ctx, meta.id);
    expect(q('.rd-stage')!.tabIndex).toBe(0);
    expect(q('.rd-stage')!.getAttribute('aria-label')).toMatch(/Enter/);
  });
});

describe('taps near the edge of a spread', () => {
  function tap(el: Element, x: number, pointerType: 'touch' | 'mouse') {
    // jsdom has no PointerEvent: a mouse event with the pointer type the reader reads.
    const down = new MouseEvent('pointerdown', { bubbles: true, clientX: x });
    Object.defineProperty(down, 'pointerType', { value: pointerType });
    document.dispatchEvent(down);
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, clientX: x }));
  }

  it('with a finger, a tap never turns the page: a word (or a tap just off one) opens its card, any other tap shows or hides the bar', async () => {
    const { ctx, meta } = await setup();
    await open(ctx, meta.id);
    const root = q('.rd-root')!;
    tap(q('.rd-article.rd-live .rd-p .rd-w ruby')!, 790, 'touch');
    expect(q('.pp-pop')).not.toBeNull();
    expect(stage().page).toBe('1');
    tap(q('.rd-stage')!, 150, 'touch'); // only closes the card
    expect(q('.pp-pop')).toBeNull();
    await new Promise((r) => setTimeout(r, 420)); // past the double-tap window, so the next tap is a tap of its own
    // The blank margin at either edge, the end of a text line: no turn, the bar shows and hides.
    const bar = root.classList.contains('rd-chrome-off');
    tap(q('.rd-stage')!, 790, 'touch');
    expect(root.classList.contains('rd-chrome-off')).toBe(!bar);
    tap(q('.rd-stage')!, 150, 'touch');
    tap(q('.rd-article.rd-live .rd-p')!, 790, 'touch');
    await tick(5);
    expect(stage().page).toBe('1');
    expect(q('.pp-pop')).toBeNull();
    // Just off a word (punctuation, the gap between lines): the browser finds the word within a finger's width, and it opens.
    const word = q('.rd-article.rd-live .rd-p .rd-w')!;
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: (x: number, y: number) => (x === 790 && y === 12 ? word : q('.rd-stage')) });
    try {
      await new Promise((r) => setTimeout(r, 420));
      const down = new MouseEvent('pointerdown', { bubbles: true, clientX: 790, clientY: 0 });
      Object.defineProperty(down, 'pointerType', { value: 'touch' });
      document.dispatchEvent(down);
      q('.rd-article.rd-live .rd-p')!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, clientX: 790, clientY: 0 }));
      expect(q('.pp-pop')).not.toBeNull();
      expect(stage().page).toBe('1');
    } finally {
      delete (document as { elementFromPoint?: unknown }).elementFromPoint;
    }
  });

  it('with a mouse, a click on a word looks it up wherever it is', async () => {
    const { ctx, meta } = await setup();
    await open(ctx, meta.id);
    tap(q('.rd-article.rd-live .rd-p .rd-w ruby')!, 790, 'mouse');
    expect(q('.pp-pop')).not.toBeNull();
    expect(stage().page).toBe('1');
  });

  it('a tap that only closes a card does not turn the page', async () => {
    const { ctx, meta } = await setup();
    await open(ctx, meta.id);
    tap(q('.rd-article.rd-live .rd-p .rd-w ruby')!, 450, 'touch');
    expect(q('.pp-pop')).not.toBeNull();
    tap(q('.rd-stage')!, 790, 'touch');
    expect(q('.pp-pop')).toBeNull();
    expect(stage().page).toBe('1');
  });

  it('a second tap on the same paragraph soon after the first opens the whole sentence', async () => {
    const { ctx, meta } = await setup();
    await open(ctx, meta.id);
    const w = () => q('.rd-article.rd-live .rd-p .rd-w ruby')!;
    tap(w(), 450, 'touch');
    expect(q('.pp-k-word')).not.toBeNull();
    tap(w(), 452, 'touch');
    await vi.waitFor(() => expect(q('.pp-k-phrase')).not.toBeNull());
    expect(q('.pp-kind')!.textContent!.toLowerCase()).toBe('phrase');
    expect([...document.querySelectorAll('.pp-wbw-word')].map((e) => e.textContent)).toContain('銀行');
  });
});

describe('the book in the script the reader chose', () => {
  it('converts the bar, the running heads, the chapter list and the way on at the end of a chapter', async () => {
    const { ctx, meta } = await setup({ script: 'simplified' });
    await open(ctx, meta.id);
    expect(q('.rd-book-title')!.textContent).toBe('测试书');
    expect(q('.rd-chapter-title')!.textContent).toBe('第一章 开始');
    key('ArrowRight'); key('ArrowRight'); key('ArrowRight');
    await tick(5);
    expect(stage().page).toBe('4');
    expect(q('.rd-hf .rd-ftr-next')!.textContent).toContain('第二章 继续');
    q('.rd-toc-btn')!.click();
    expect(qa('.rd-toc-item').map((b) => b.textContent)).toEqual(['第一章 开始', '第二章 继续', '第三章 结束']);
  });

  it('follows a change of script at once, in the bar and in the list', async () => {
    const { ctx, meta } = await setup();
    await open(ctx, meta.id);
    expect(q('.rd-chapter-title')!.textContent).toBe('第一章 開始');
    ctx.settings.set({ script: 'simplified' });
    await tick(20);
    expect(q('.rd-chapter-title')!.textContent).toBe('第一章 开始');
    expect(q('.rd-book-title')!.textContent).toBe('测试书');
    q('.rd-toc-btn')!.click();
    expect(qa('.rd-toc-item')[1].textContent).toBe('第二章 继续');
  });
});

describe('the end of a chapter in Pages', () => {
  it('offers the next chapter by name on the last page, and the end of the book on the last chapter', async () => {
    const { ctx, meta } = await setup();
    await open(ctx, meta.id);
    for (let i = 0; i < 3; i++) { key('ArrowRight'); await tick(5); }
    expect(q('.rd-hf .rd-ftr-left, .rd-hf .rd-ftr-next')).not.toBeNull();
    const next = q('.rd-hf .rd-ftr-next')!;
    expect(next.textContent).toContain('Next: 第二章 繼續');
    next.click();
    await vi.waitFor(() => expect(stage().chapter).toBe('1'));
    expect(stage().page).toBe('1');
  });

  it('offers the chapter\'s words on its last page', async () => {
    const { ctx, meta } = await setup();
    await open(ctx, meta.id);
    for (let i = 0; i < 3; i++) { key('ArrowRight'); await tick(5); }
    const words = q('.rd-hf .rd-ftr-words')!;
    expect(words.textContent).toBe('Words');
    words.click();
    await vi.waitFor(() => expect(qa('.rd-words .rd-word').length).toBeGreaterThan(2));
    expect(q('.rd-toc')!.getAttribute('aria-label')).toBe('Words in this chapter');
    expect(q('.rd-words-chapter')!.textContent).toContain('第一章');
  });

  it('never says "1 page left" on the last page or on the first page of a two-page chapter', async () => {
    const { ctx, meta } = await setup();
    await open(ctx, meta.id, { ch: '1' });
    await tick(20);
    expect(stage().pages).toBe('2');
    expect(q('.rd-hf .rd-ftr-left')!.textContent).toBe('1 page left in chapter'); // one page remains after this one: true
    key('ArrowRight');
    await tick(5);
    expect(q('.rd-hf .rd-ftr-left, .rd-hf .rd-ftr-next')!.textContent).not.toMatch(/^1 page left/);
  });
});

describe('the pinyin grid variables', () => {
  it('sets the paragraph indent to exactly two cells', async () => {
    const { ctx, meta } = await setup();
    await open(ctx, meta.id);
    const root = q('.rd-root')!;
    const cell = Number(root.style.getPropertyValue('--rd-cell'));
    const indent = parseFloat(root.style.getPropertyValue('--rd-indent'));
    expect(cell).toBeGreaterThanOrEqual(1.25);
    expect(indent / cell).toBeCloseTo(2, 3);
    expect(Number(root.style.getPropertyValue('--rd-rt')) * 22).toBeGreaterThanOrEqual(10.4);
  });
});

describe('settings rows that only apply to one layout', () => {
  async function screen(settings = {}) {
    const { ctx } = await makeCtx(settings);
    const root = document.createElement('div');
    document.body.appendChild(root);
    cleanup = mountSettings(root, {}, ctx) as () => void;
    const row = (label: string) => [...root.querySelectorAll<HTMLElement>('.set-row')].find((r) => r.querySelector('.set-label')?.textContent === label)!;
    return { ctx, root, row };
  }

  it('hides Pages shown and Page turn in Scroll, and the HSK level unless that mode is on', async () => {
    const { ctx, row } = await screen({ layout: 'scroll', pinyin: 'all' });
    expect(row('Pages shown').hidden).toBe(true);
    expect(row('Page turn').hidden).toBe(true);
    expect(row('Known up to').hidden).toBe(true);
    ctx.settings.set({ layout: 'pages', pinyin: 'hsk' });
    expect(row('Pages shown').hidden).toBe(false);
    expect(row('Page turn').hidden).toBe(false);
    expect(row('Known up to').hidden).toBe(false);
  });

  it('lists its sections in a navigation and gives each a place to jump to', async () => {
    const { root } = await screen();
    const links = [...root.querySelectorAll<HTMLElement>('.set-nav-link')];
    expect(links.map((l) => l.textContent)).toEqual(['Language', 'Reading', 'Pinyin', 'Lookup', 'Translation', 'Speech', 'iPad', 'Data']);
    for (const l of links) expect(root.querySelector(`#${l.dataset.target}`)).not.toBeNull();
  });

  it('tells the stylesheet how tall the sticky preview is, so a section the list scrolls to stops below it', async () => {
    const style = document.createElement('style');
    style.textContent = '.set-preview { position: sticky; }';
    document.head.appendChild(style);
    try {
      const { root } = await screen();
      // jsdom boxes every element at 24 x 30 (stubBrowser): the preview plus the 8 px gap under the bar.
      expect(root.querySelector<HTMLElement>('.set-page')!.style.getPropertyValue('--set-stick')).toBe('38px');
    } finally { style.remove(); }
  });

  it('adds nothing when the preview is not sticky (a phone, a short window)', async () => {
    const { root } = await screen();
    expect(root.querySelector<HTMLElement>('.set-page')!.style.getPropertyValue('--set-stick')).toBe('0px');
  });
});

describe('words looked up and bookmarks', () => {
  it('keeps Full screen in the bar where the browser cannot do it, and a tap says why', async () => {
    const { ctx, meta, toasts } = await setup();
    await open(ctx, meta.id);
    closePopup();
    const btn = q('.rd-bar .rd-full-btn') as HTMLButtonElement;
    expect(btn.hidden).toBe(false);
    btn.click();
    expect(toasts.at(-1)).toMatch(/cannot go full screen.*Add to Home Screen/);
  });

  it('has Full screen in the top bar, and the button follows the screen', async () => {
    const d = document as Document & { fullscreenEnabled: boolean; fullscreenElement: Element | null };
    let full: Element | null = null;
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, get: () => true });
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => full });
    document.documentElement.requestFullscreen = async () => { full = document.documentElement; document.dispatchEvent(new Event('fullscreenchange')); };
    document.exitFullscreen = async () => { full = null; document.dispatchEvent(new Event('fullscreenchange')); };
    try {
      const { ctx, meta } = await setup();
      await open(ctx, meta.id);
      closePopup();
      const btn = q('.rd-bar .rd-full-btn') as HTMLButtonElement;
      expect(btn.hidden).toBe(false);
      expect(btn.getAttribute('aria-label')).toBe('Full screen');
      btn.click();
      await vi.waitFor(() => expect(d.fullscreenElement).not.toBeNull());
      expect(btn.getAttribute('aria-pressed')).toBe('true');
      expect(btn.getAttribute('aria-label')).toBe('Leave full screen');
      btn.click();
      await vi.waitFor(() => expect(btn.getAttribute('aria-pressed')).toBe('false'));
    } finally {
      delete (document as unknown as Record<string, unknown>).fullscreenEnabled;
      delete (document as unknown as Record<string, unknown>).fullscreenElement;
    }
  });

  it('opened from the Home Screen, offers no full screen: the app has no browser bars, and Safari’s would only add its X', async () => {
    let asked = 0;
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, get: () => true });
    Object.defineProperty(navigator, 'standalone', { configurable: true, get: () => true });
    document.documentElement.requestFullscreen = async () => { asked++; };
    try {
      const { ctx, meta } = await setup();
      await open(ctx, meta.id);
      closePopup();
      expect((q('.rd-bar .rd-full-btn') as HTMLButtonElement).hidden).toBe(true);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
      expect(asked).toBe(0);
    } finally {
      delete (document as unknown as Record<string, unknown>).fullscreenEnabled;
      delete (navigator as unknown as Record<string, unknown>).standalone;
    }
  });

  it('opened from the Home Screen while full screen is somehow on, the button shows and leaves it', async () => {
    let full: Element | null = document.documentElement;
    let left = 0;
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, get: () => true });
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => full });
    Object.defineProperty(navigator, 'standalone', { configurable: true, get: () => true });
    document.exitFullscreen = async () => { left++; full = null; document.dispatchEvent(new Event('fullscreenchange')); };
    try {
      const { ctx, meta } = await setup();
      await open(ctx, meta.id);
      closePopup();
      const btn = q('.rd-bar .rd-full-btn') as HTMLButtonElement;
      expect(btn.hidden).toBe(false);
      btn.click();
      await vi.waitFor(() => expect(left).toBe(1));
      expect(btn.hidden).toBe(true);
    } finally {
      delete (document as unknown as Record<string, unknown>).fullscreenEnabled;
      delete (document as unknown as Record<string, unknown>).fullscreenElement;
      delete (navigator as unknown as Record<string, unknown>).standalone;
    }
  });

  it('keeps a tapped word for practice, but not the words stepped through with Next', async () => {
    const { ctx, meta } = await setup();
    await open(ctx, meta.id);
    const log = vi.spyOn(ctx.store.lookups, 'log');
    (q('.rd-article.rd-live .rd-p .rd-w') as HTMLElement).click();
    await vi.waitFor(() => expect(log).toHaveBeenCalledTimes(1));
    expect(log.mock.calls[0][0]).toMatchObject({ context: { bookId: meta.id, chapter: 0 } });
    key('ArrowRight'); // with a card open, the arrows step through words
    await tick(5);
    await new Promise((r) => setTimeout(r, 10));
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('B bookmarks the page, the button shows it, the drawer lists it and jumps back, and B again takes it away', async () => {
    const { ctx, meta } = await setup();
    await open(ctx, meta.id);
    closePopup();
    const btn = q('.rd-mark-btn')!;
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    key('b');
    await vi.waitFor(async () => expect(await ctx.store.bookmarks.list(meta.id)).toHaveLength(1));
    const [mark] = await ctx.store.bookmarks.list(meta.id);
    expect(mark).toMatchObject({ chapter: 0, bookId: meta.id });
    expect(mark.label).toContain('第0段');
    await vi.waitFor(() => expect(btn.getAttribute('aria-pressed')).toBe('true'));
    key('ArrowRight'); // the next page has no bookmark
    await tick(5);
    await vi.waitFor(() => expect(btn.getAttribute('aria-pressed')).toBe('false'));
    // The drawer's Bookmarks tab lists it; picking it goes back to the page.
    key('c');
    const tab = [...document.querySelectorAll<HTMLElement>('.rd-toc-tab')].find((t) => t.textContent === 'Bookmarks')!;
    tab.click();
    await vi.waitFor(() => expect(q('.rd-mark-go')).not.toBeNull());
    (q('.rd-mark-go') as HTMLElement).click();
    await tick(10);
    await vi.waitFor(() => expect(btn.getAttribute('aria-pressed')).toBe('true'));
    key('b');
    await vi.waitFor(async () => expect(await ctx.store.bookmarks.list(meta.id)).toHaveLength(0));
  });
});
