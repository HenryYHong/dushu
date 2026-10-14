// @vitest-environment jsdom
// The reader screen end to end in jsdom: no layout, but the wiring (chapters, popups, settings, progress) is real.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AppContext, BookMeta, Chapter } from '../../src/types';
import { mount } from '../../src/ui/reader/reader';
import { closePopup } from '../../src/ui/popup/popup';
import { REMOTE_PROGRESS_EVENT } from '../../src/core/sync';
import { makeCtx, stubBrowser, tick } from './helpers';

beforeAll(() => stubBrowser());

const chapters: Chapter[] = [
  { title: '第一章', blocks: [{ t: 'p', text: '我们在银行门口见面。' }, { t: 'p', text: '他慢慢地走了过来。' }] },
  { title: '第二章', blocks: [{ t: 'p', text: '她爱这座小城。' }] },
  { title: '第三章', blocks: [{ t: 'p', text: '月亮升起来了。' }] },
];

async function setup(settings = {}) {
  // These tests cover the Scroll layout; tests/reader/pages.test.ts covers Pages.
  const made = await makeCtx({ pinyin: 'all', layout: 'scroll', ...settings });
  const meta: BookMeta = await made.ctx.store.books.add({
    title: '测试书', author: 'T', format: 'paste', script: 'simplified', chapters, assets: new Map(),
  });
  return { ...made, meta };
}

let cleanup: (() => void) | void;
afterEach(() => { try { cleanup?.(); } catch { /* ignore */ } cleanup = undefined; closePopup(); document.body.innerHTML = ''; });

async function open(ctx: AppContext, id: string, params: Record<string, string> = {}) {
  location.hash = `#/read/${id}`;
  const root = document.createElement('div');
  document.body.appendChild(root);
  cleanup = await mount(root, { bookId: id, ...params }, ctx);
  return root;
}

const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const text = (sel: string) => q(sel)?.textContent ?? '';

describe('reader screen', () => {
  it('shows a plain message for an unknown book', async () => {
    const { ctx } = await setup();
    const root = await open(ctx, 'nope');
    expect(root.textContent).toContain('Book not found');
    expect(q('a[href="#/"]')).not.toBeNull();
  });

  it('renders the first chapter with the title, pinyin and a progress bar', async () => {
    const { ctx, meta } = await setup();
    await open(ctx, meta.id);
    expect(text('.rd-book-title')).toBe('测试书');
    expect(text('.rd-chapter-title')).toBe('第一章');
    expect(document.querySelectorAll('.rd-article .rd-w').length).toBeGreaterThan(4);
    expect(document.querySelector('.rd-article rt')).not.toBeNull();
    expect(text('.rd-pinyin-btn')).toBe('All');
    expect(q('.rd-article')!.getAttribute('lang')).toBe('zh-Hans');
  });

  it('click opens the word popup with the context sentence; Esc closes and clears the highlight', async () => {
    const { ctx, meta } = await setup();
    await open(ctx, meta.id);
    const word = [...document.querySelectorAll<HTMLElement>('.rd-w')].find((w) => [...w.querySelectorAll('ruby')].map((r) => (r.firstChild as Text).data).join('') === '银行')!;
    word.querySelector('ruby')!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    expect(text('.pp-word')).toBe('银行');
    expect([...document.querySelectorAll('.rd-c.rd-active')].map((r) => (r.firstChild as Text).data).join('')).toBe('银行');
    q('.pp-save')!.click();
    await vi.waitFor(async () => expect((await ctx.store.vocab.get('银行'))?.context?.sentence).toBe('我们在银行门口见面。'));
    const item = (await ctx.store.vocab.get('银行'))!;
    expect(item.context).toMatchObject({ bookId: expect.any(String), bookTitle: '测试书', chapter: 0 });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(q('.pp-pop')).toBeNull();
    expect(document.querySelectorAll('.rd-c.rd-active')).toHaveLength(0);
  });

  it('steps to the next word with the arrow key and grows the selection with Shift+Right', async () => {
    const { ctx, meta } = await setup();
    await open(ctx, meta.id);
    const first = document.querySelector<HTMLElement>('.rd-p .rd-w')!;
    first.querySelector('ruby')!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    const w1 = text('.pp-word');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    expect(text('.pp-word')).not.toBe(w1);
    const before = text('.pp-word');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true, cancelable: true }));
    expect(text('.pp-word').length).toBeGreaterThan(before.length);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true, cancelable: true }));
    expect(text('.pp-word')).toBe(before);
  });

  it('the pinyin quick toggle and the p key change the mode live and hide rt when off', async () => {
    const { ctx, meta } = await setup();
    await open(ctx, meta.id);
    q('.rd-pinyin-btn')!.click();
    expect(document.querySelectorAll('.rd-pop .rd-opt')).toHaveLength(4);
    document.querySelectorAll<HTMLElement>('.rd-pop .rd-opt')[0].click(); // Off
    expect(ctx.settings.get().pinyin).toBe('off');
    expect(q('.rd-root')!.classList.contains('rd-py-off')).toBe(true);
    expect(text('.rd-pinyin-btn')).toBe('Off');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true }));
    expect(ctx.settings.get().pinyin).toBe('all');
    expect(q('.rd-root')!.classList.contains('rd-py-off')).toBe(false);
  });

  it('typography settings become CSS variables', async () => {
    const { ctx, meta } = await setup();
    await open(ctx, meta.id);
    expect(q('.rd-root')!.style.getPropertyValue('--rd-size')).toBe('28px');
    ctx.settings.set({ scrollFontSize: 30, lineHeight: 2.4, pageWidth: 640, fontFamily: 'kai' });
    const style = q('.rd-root')!.style;
    expect(style.getPropertyValue('--rd-size')).toBe('30px');
    expect(style.getPropertyValue('--rd-lh')).toBe('2.4');
    expect(style.getPropertyValue('--rd-width')).toBe('640px');
    expect(style.getPropertyValue('--rd-font')).toContain('kai');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ']', bubbles: true }));
    expect(ctx.settings.get().scrollFontSize).toBe(32);
    expect(ctx.settings.get().fontSize).toBe(22);
  });

  it('opens the chapter given by ?ch= and moves between chapters with the buttons', async () => {
    const { ctx, meta } = await setup();
    await open(ctx, meta.id, { ch: '1' });
    expect(text('.rd-chapter-title')).toBe('第二章');
    q('.rd-end-next')!.click();
    await vi.waitFor(() => expect(text('.rd-chapter-title')).toBe('第三章'));
    expect(q('.rd-end-next')).toBeNull(); // last chapter
    expect(text('.rd-end')).toContain('end');
    q('.rd-end-prev')!.click();
    await vi.waitFor(() => expect(text('.rd-chapter-title')).toBe('第二章'));
  });

  it('shift+arrow jumps chapters and the chapter drawer lists them', async () => {
    const { ctx, meta } = await setup();
    await open(ctx, meta.id);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(text('.rd-chapter-title')).toBe('第二章'));
    q('.rd-toc-btn')!.click();
    await vi.waitFor(() => expect([...document.querySelectorAll('.rd-toc-item')].map((e) => e.textContent)).toEqual(['第一章', '第二章', '第三章']));
    expect(q('.rd-toc-item[aria-current="true"]')!.textContent).toContain('第二章');
    document.querySelectorAll<HTMLElement>('.rd-toc-item')[2].click();
    await vi.waitFor(() => expect(text('.rd-chapter-title')).toBe('第三章'));
    expect(document.querySelector('.rd-toc-root')!.hasAttribute('hidden')).toBe(true);
  });

  it('records progress and the last-opened time, and restores the saved chapter', async () => {
    const { ctx, meta } = await setup();
    await open(ctx, meta.id, { ch: '2' });
    cleanup?.(); cleanup = undefined;
    await vi.waitFor(async () => expect((await ctx.store.progress.get(meta.id))?.chapter).toBe(2));
    expect((await ctx.store.books.get(meta.id))?.lastOpenedAt).toBeGreaterThan(0);
    await open(ctx, meta.id);
    expect(text('.rd-chapter-title')).toBe('第三章');
  });

  it('does not save an unchanged place again, so a newer place read on another device is kept', async () => {
    const { ctx, meta } = await setup();
    await ctx.store.progress.set({ bookId: meta.id, chapter: 1, block: 0, percent: 0.4, updatedAt: 1234 });
    await open(ctx, meta.id);
    expect(text('.rd-chapter-title')).toBe('第二章');
    await tick(1000);
    cleanup?.(); cleanup = undefined;
    expect((await ctx.store.progress.get(meta.id))?.updatedAt).toBe(1234);
  });

  it('offers to go to the place read on another device, and only for this book', async () => {
    const { ctx, meta } = await setup();
    const offers: { message: string; run?: () => void }[] = [];
    ctx.toast = (message, o) => { offers.push({ message, run: o?.action?.run }); };
    await open(ctx, meta.id);
    const event = (bookId: string) => new CustomEvent(REMOTE_PROGRESS_EVENT, { detail: { bookId, progress: { bookId, chapter: 2, block: 0, percent: 0.9, updatedAt: Date.now() } } });
    window.dispatchEvent(event('another-book'));
    expect(offers).toHaveLength(0);
    window.dispatchEvent(event(meta.id));
    expect(offers.map((o) => o.message)).toEqual(['On another device you are 90% through this book.']);
    offers[0].run!();
    await vi.waitFor(() => expect(text('.rd-chapter-title')).toBe('第三章'));
  });

  it('script conversion re-renders the chapter text', async () => {
    const { ctx, meta } = await setup();
    await open(ctx, meta.id);
    ctx.settings.set({ script: 'traditional' });
    await tick(30);
    const base = [...document.querySelectorAll('.rd-article ruby')].map((r) => (r.firstChild as Text).data).join('');
    expect(base).toContain('銀行');
    expect(q('.rd-article')!.getAttribute('lang')).toBe('zh-Hant');
  });

  describe('double tap with a finger', () => {
    const touch = () => document.dispatchEvent(Object.assign(new Event('pointerdown', { bubbles: true }), { pointerType: 'touch' }));
    const tap = (el: Element, x: number, y: number) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, clientX: x, clientY: y }));
    const kind = () => q('.pp-pop')?.className.match(/pp-k-\w+/)?.[0];
    const wordsOf = () => [...document.querySelectorAll<HTMLElement>('.rd-p .rd-w')];

    it('a second tap close to the first gives the sentence of the FIRST word, whatever is under the finger', async () => {
      const { ctx, meta } = await setup();
      await open(ctx, meta.id);
      const a = wordsOf()[0];
      const b = wordsOf().at(-1)!; // in the second paragraph
      touch();
      tap(a.querySelector('ruby')!, 200, 300);
      expect(kind()).toBe('pp-k-word');
      // By the second tap the page may have moved: it lands on another word, on the card itself or on nothing.
      touch();
      tap(b.querySelector('ruby')!, 212, 310);
      expect(kind()).toBe('pp-k-phrase');
      expect(text('.pp-pop')).toContain('银行');
      expect(text('.pp-pop')).not.toContain('慢慢');
      closePopup();
      touch();
      tap(a.querySelector('ruby')!, 200, 300);
      touch();
      tap(q('.pp-pop')!, 205, 305);
      expect(kind()).toBe('pp-k-phrase');
    });

    it('two taps far apart are two lookups, and a mouse never double-taps', async () => {
      const { ctx, meta } = await setup();
      await open(ctx, meta.id);
      const [a, b] = wordsOf();
      touch();
      tap(a.querySelector('ruby')!, 200, 300);
      touch();
      tap(b.querySelector('ruby')!, 200, 420);
      expect(kind()).toBe('pp-k-word');
      expect(text('.pp-word')).toBe([...b.querySelectorAll('ruby')].map((r) => (r.firstChild as Text).data).join(''));
      closePopup();
      document.dispatchEvent(Object.assign(new Event('pointerdown', { bubbles: true }), { pointerType: 'mouse' }));
      tap(a.querySelector('ruby')!, 200, 300);
      document.dispatchEvent(Object.assign(new Event('pointerdown', { bubbles: true }), { pointerType: 'mouse' }));
      tap(b.querySelector('ruby')!, 204, 304);
      expect(kind()).toBe('pp-k-word');
    });
  });

  it('cleans up: popups, menus and key handlers are gone after unmount', async () => {
    const { ctx, meta } = await setup();
    await open(ctx, meta.id);
    document.querySelector<HTMLElement>('.rd-w ruby')!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    expect(q('.pp-pop')).not.toBeNull();
    cleanup?.(); cleanup = undefined;
    expect(q('.pp-pop')).toBeNull();
    const before = ctx.settings.get().pinyin;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true }));
    expect(ctx.settings.get().pinyin).toBe(before);
  });
});
