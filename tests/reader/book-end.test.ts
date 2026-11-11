// @vitest-environment jsdom
// The end of a book (ui/reader/bookEnd.ts): Pengu says so once per book, the first time the reader gets there from elsewhere,
// and never by itself (a book that opens at its end, a chapter still being laid out, a browser that cannot animate).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContext, BookMeta, Chapter } from '../../src/types';
import { finishedBefore, markFinished, watchFinish } from '../../src/ui/reader/bookEnd';
import { mount } from '../../src/ui/reader/reader';
import { closePopup } from '../../src/ui/popup/popup';
import { makeCtx, stubBrowser, tick } from './helpers';

// The reader's walkthrough, seen: it would take the taps on the chapter buttons.
beforeEach(() => { localStorage.clear(); localStorage.setItem('dushu.reader-hint.v1', '1'); });

describe('watchFinish', () => {
  it('says so once, when the reader gets to the end from elsewhere in the book', () => {
    const w = watchFinish('b1', false);
    expect(w.see(false)).toBe(false);
    expect(w.see(true)).toBe(true);
    expect(w.see(false)).toBe(false);
    expect(w.see(true)).toBe(false);
    expect(finishedBefore('b1')).toBe(true);
    // Another visit, the book read through again: once was enough.
    const again = watchFinish('b1', false);
    expect(again.see(false)).toBe(false);
    expect(again.see(true)).toBe(false);
  });

  it('keeps each book apart', () => {
    markFinished('b1');
    const w = watchFinish('b2', false);
    w.see(false);
    expect(w.see(true)).toBe(true);
  });

  it('says nothing for a book that opens at its end (one short chapter, or a place restored there)', () => {
    const w = watchFinish('b1', false);
    expect(w.see(true)).toBe(false);
    expect(w.see(true)).toBe(false);
    expect(finishedBefore('b1')).toBe(false);
  });

  it('remembers a book finished before as finished, and says nothing', () => {
    const w = watchFinish('b1', true);
    expect(finishedBefore('b1')).toBe(true);
    expect(w.see(false)).toBe(false);
    expect(w.see(true)).toBe(false);
  });

  it('waits while the last chapter is being laid out', () => {
    const w = watchFinish('b1', false);
    // Opened at the end, then a moment of not knowing: that is not getting there from elsewhere.
    expect(w.see(null)).toBe(false);
    expect(w.see(true)).toBe(false);
    expect(w.see(null)).toBe(false);
    expect(w.see(true)).toBe(false);
    const v = watchFinish('b2', false);
    expect(v.see(false)).toBe(false);
    expect(v.see(null)).toBe(false);
    expect(v.see(true)).toBe(true);
  });

  it('still works when storage is refused (private mode), for this visit', () => {
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    try {
      const w = watchFinish('b1', false);
      w.see(false);
      expect(w.see(true)).toBe(true);
      expect(w.see(true)).toBe(false);
    } finally { set.mockRestore(); }
  });
});

// ---------------------------------------------------------------- in the reader

const chapters: Chapter[] = [
  { title: '第一章', blocks: [{ t: 'p', text: '我们在银行门口见面。' }] },
  { title: '第二章', blocks: [{ t: 'p', text: '她爱这座小城。' }] },
  { title: '第三章', blocks: [{ t: 'p', text: '月亮升起来了。' }] },
];

const proto = HTMLElement.prototype as unknown as { animate?: unknown };
/** Element.animate as a browser has it (jsdom has none), finishing at once. */
const canAnimate = () => { proto.animate = vi.fn(() => ({ finished: Promise.resolve(), cancel() {} })); };

let cleanup: (() => void) | void;
beforeAll(() => stubBrowser());
afterEach(() => {
  try { cleanup?.(); } catch { /* ignore */ }
  cleanup = undefined;
  closePopup();
  delete proto.animate;
  document.body.innerHTML = '';
});

async function setup(): Promise<{ ctx: AppContext; meta: BookMeta }> {
  const made = await makeCtx({ pinyin: 'all', layout: 'scroll' });
  const meta = await made.ctx.store.books.add({
    title: '测试书', author: 'T', format: 'paste', script: 'simplified', chapters, assets: new Map(),
  });
  return { ctx: made.ctx, meta };
}

async function open(ctx: AppContext, id: string, params: Record<string, string> = {}): Promise<void> {
  location.hash = `#/read/${id}`;
  const root = document.createElement('div');
  document.body.appendChild(root);
  cleanup = await mount(root, { bookId: id, ...params }, ctx);
}

/** Reads on: the place is looked at once it has been still for a moment (900 ms), so each stop waits that long. */
async function readOn(): Promise<void> {
  (document.querySelector('.rd-end-next') as HTMLElement).click();
  await tick(1100);
}

const says = () => document.querySelector('.pengu-says')?.textContent ?? '';

describe('the end of the book in the reader', () => {
  it('Pengu says so when the reader gets to the end of the last chapter, once', async () => {
    canAnimate();
    const { ctx, meta } = await setup();
    await open(ctx, meta.id);
    await tick(1100);
    expect(says()).toBe('');
    await readOn();
    expect(says()).toBe('');
    await readOn();
    expect(says()).toBe('You finished “测试书”!');
    cleanup?.();
    document.body.innerHTML = '';
    // Read through again from the start: not a second time.
    await open(ctx, meta.id, { ch: '0' });
    await tick(1100);
    await readOn();
    await readOn();
    expect(says()).toBe('');
  });

  it('says nothing when a book opens at its last chapter', async () => {
    canAnimate();
    const { ctx, meta } = await setup();
    await open(ctx, meta.id, { ch: '2' });
    await tick(1200);
    expect(says()).toBe('');
  });

  it('says nothing where the browser cannot animate (tests)', async () => {
    const { ctx, meta } = await setup();
    await open(ctx, meta.id);
    await tick(1100);
    await readOn();
    await readOn();
    expect(says()).toBe('');
    expect(finishedBefore(meta.id)).toBe(false);
  });
});
