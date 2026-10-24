// @vitest-environment jsdom
// Read-aloud in Pages turns to the page of the spoken word: within a paragraph too, since a paragraph runs on from one page
// to the next. The turn to the next spread is animated like a key press; a jump further than that is not.
// Fake geometry: 20 characters to a page; the title fills page 0 and each 40-character paragraph fills the next two pages.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContext, BookMeta, Chapter, Settings } from '../../src/types';
import { closePopup } from '../../src/ui/popup/popup';

const speech = vi.hoisted(() => ({
  sequence: vi.fn(), stop: vi.fn(),
  parts: [] as string[],
  onPart: null as null | ((i: number) => void),
  onBoundary: null as null | ((i: number, at: number, len: number) => void),
}));
vi.mock('../../src/speech/tts', () => ({ canSpeak: () => true, speakSequence: speech.sequence,
  stopSpeaking: speech.stop, pauseSpeaking: vi.fn(), resumeSpeaking: vi.fn(), speak: vi.fn(async () => true) }));

import { mount } from '../../src/ui/reader/reader';
import { makeCtx, stubBrowser, tick } from './helpers';

const WIDTH = 800;
let charsPerPage = 20;
let paper = WIDTH;

const pageOfBlockStart = (b: number) => (b === 0 ? 0 : 1 + 2 * (b - 1));
beforeAll(() => {
  stubBrowser();
  Object.defineProperty(window, 'innerWidth', { value: WIDTH, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 1000, configurable: true });
  Element.prototype.getBoundingClientRect = function () {
    const el = this as Element;
    if (el.classList?.contains('rd-paged')) return new DOMRect(0, 0, WIDTH, 900);
    const blockEl = el.closest?.('[data-b]') as HTMLElement | null;
    if (blockEl && el.closest('.rd-article.rd-paged')) {
      const b = Number(blockEl.dataset.b);
      const o = el.matches('ruby.rd-c') ? Number((el as HTMLElement).dataset.o) || 0 : 0;
      const page = pageOfBlockStart(b) + (b === 0 ? 0 : Math.floor(o / charsPerPage));
      return new DOMRect(page * paper + 10, 100, 24, 30);
    }
    return new DOMRect(100, 100, 24, 30);
  };
  Element.prototype.getClientRects = function () {
    const el = this as Element;
    if (el.matches?.('[data-b]') && el.closest('.rd-article.rd-paged')) {
      const b = Number((el as HTMLElement).dataset.b);
      const first = pageOfBlockStart(b);
      const pages = b === 0 ? [first] : [first, first + 1];
      return pages.map((p) => new DOMRect(p * paper + 10, 100, paper - 20, 40)) as unknown as DOMRectList;
    }
    return [] as unknown as DOMRectList;
  };
});

// 40 characters, no punctuation: offsets 0-19 on the paragraph's first page, 20-39 on its second (银行 at 3, 20 and 37).
const PARA = '我们在银行门口见面他慢慢地走了过来我们在银行门口见面他慢慢地走了过来我们在银行门';
const chapters: Chapter[] = [
  { title: '第一章', blocks: [{ t: 'p', text: PARA }, { t: 'p', text: PARA }, { t: 'p', text: PARA }] },
  { title: '第二章', blocks: [{ t: 'p', text: PARA }] },
];

let cleanup: (() => void) | void;
let finish: ((ok: boolean) => void)[] = [];
beforeEach(() => {
  speech.sequence.mockReset(); finish = [];
  speech.sequence.mockImplementation((parts: string[], options: { onStart?: () => void }, onPart: (i: number) => void,
    onBoundary: (i: number, at: number, len: number) => void) => {
    speech.parts = parts; speech.onPart = onPart; speech.onBoundary = onBoundary;
    options.onStart?.();
    return new Promise<boolean>((resolve) => finish.push(resolve));
  });
});
afterEach(() => { charsPerPage = 20; try { cleanup?.(); } catch { /* ignore */ } cleanup = undefined; finish.forEach((r) => r(false)); closePopup(); document.body.innerHTML = ''; document.documentElement.className = ''; });

async function open(spread: 'single' | 'double', pageTurn: Settings['pageTurn'] = 'none'): Promise<AppContext> {
  paper = spread === 'double' ? WIDTH / 2 : WIDTH;
  const { ctx } = await makeCtx({ pinyin: 'all', layout: 'pages', pageTurn, spread });
  const meta: BookMeta = await ctx.store.books.add({ title: '测试书', author: 'T', format: 'paste', script: 'simplified', chapters, assets: new Map() });
  location.hash = `#/read/${meta.id}`;
  const root = document.createElement('div');
  document.body.appendChild(root);
  cleanup = await mount(root, { bookId: meta.id }, ctx);
  await tick(5);
  return ctx;
}
const stage = () => (document.querySelector('.rd-stage') as HTMLElement).dataset;
// The live pages only: a flip's pictures are copies of them.
const spoken = () => [...document.querySelectorAll('.rd-article.rd-live .rd-speaking-word')].map((c) => c.firstChild!.textContent).join('');
const turnEnded = () => vi.waitFor(() => expect(stage().turn).toBeUndefined(), { timeout: 3000, interval: 5 });
/** Counts the page turns that start (the stage's data-turn appearing). */
function countTurns() {
  const s = document.querySelector('.rd-stage') as HTMLElement;
  let n = 0;
  const add = (recs: MutationRecord[]) => { n += recs.filter((r) => r.oldValue === null).length; };
  const mo = new MutationObserver(add);
  mo.observe(s, { attributes: true, attributeFilter: ['data-turn'], attributeOldValue: true });
  return { started: () => { add(mo.takeRecords()); return n; }, stop: () => mo.disconnect() };
}

/** Starts reading aloud; returns the index of the part that is the first paragraph (the parts after it are the next ones). */
async function startReading(): Promise<number> {
  document.querySelector<HTMLButtonElement>('.rd-speech-btn')!.click();
  await vi.waitFor(() => expect(speech.sequence).toHaveBeenCalledOnce());
  const i = speech.parts.indexOf(PARA);
  expect(i).toBeGreaterThanOrEqual(0);
  expect(speech.parts.slice(i, i + 3)).toEqual([PARA, PARA, PARA]);
  return i;
}

const key = (k: string) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

describe('read-aloud in Pages turns with the spoken word', () => {
  it('the Read button starts at the first word on the spread, not back at the start of the paragraph', async () => {
    charsPerPage = 21; // page 3 starts at 21, inside 银行 (20-21)
    await open('single');
    key('ArrowRight'); await tick(5);
    key('ArrowRight'); await tick(5);
    expect(stage().page).toBe('3');
    document.querySelector<HTMLButtonElement>('.rd-speech-btn')!.click();
    await vi.waitFor(() => expect(speech.sequence).toHaveBeenCalledOnce());
    // From the word after the split one: nothing from the page already read, and not half a word.
    expect(speech.parts).toEqual([PARA.slice(22), PARA, PARA]);
    speech.onPart!(0);
    await tick(5);
    expect(stage().page).toBe('3');
    speech.onBoundary!(0, 0, 2); // 门口 at 22
    await tick(5);
    expect(spoken()).toBe('门口');
    expect(stage().page).toBe('3');
  });

  it('one page: stays while the word is on the page, turns mid-paragraph when it is on the next', async () => {
    await open('single');
    expect(stage().per).toBe('1');
    expect(stage().page).toBe('1');
    const i = await startReading();
    speech.onPart!(i); // paragraph 1 starts on page 2
    await tick(5);
    expect(stage().page).toBe('2');
    speech.onBoundary!(i, 3, 2); // 银行 at 3: page 2
    await tick(5);
    expect(spoken()).toBe('银行');
    expect(stage().page).toBe('2');
    speech.onBoundary!(i, 20, 2); // 银行 at 20: page 3, same paragraph
    await tick(5);
    expect(spoken()).toBe('银行');
    expect(stage().page).toBe('3');
    speech.onBoundary!(i, 37, 2); // 银行 at 37: still page 3
    await tick(5);
    expect(stage().page).toBe('3');
  });

  it('two-page spread: stays for a word on the right-hand page, turns for the page after the spread', async () => {
    await open('double');
    expect(stage().per).toBe('2');
    expect(stage().page).toBe('1'); // pages 1-2: title, then the first half of paragraph 1
    const i = await startReading();
    speech.onPart!(i);
    await tick(5);
    expect(stage().page).toBe('1');
    speech.onBoundary!(i, 3, 2); // right-hand page of the spread
    await tick(5);
    expect(stage().page).toBe('1');
    speech.onBoundary!(i, 20, 2); // page 3: the next spread
    await tick(5);
    expect(stage().page).toBe('3');
    expect(spoken()).toBe('银行');
  });

  for (const pageTurn of ['slide', 'flip'] as const) {
    it(`${pageTurn}: the turn to the next page is animated like a key press; a jump further is not`, async () => {
      await open('single', pageTurn);
      const i = await startReading();
      speech.onPart!(i); // paragraph 1 starts on page 2, the next page
      expect(stage().turn).toBe(pageTurn);
      await turnEnded();
      expect(stage().page).toBe('2');
      speech.onBoundary!(i, 3, 2);
      await tick(5);
      expect(stage().turn).toBeUndefined();
      speech.onBoundary!(i, 20, 2); // mid-paragraph, on the next page
      expect(stage().turn).toBe(pageTurn);
      await turnEnded();
      expect(stage().page).toBe('3');
      expect(spoken()).toBe('银行');
      speech.onPart!(i + 2); // paragraph 3 starts on page 6: three pages on, shown at once
      expect(stage().turn).toBeUndefined();
      expect(stage().page).toBe('6');
    });

    it(`${pageTurn}: a turn the voice asks for while a page is turning waits for it`, async () => {
      await open('double', pageTurn);
      const i = await startReading();
      speech.onPart!(i);
      await tick(5);
      expect(stage().page).toBe('1');
      const turns = countTurns();
      speech.onBoundary!(i, 20, 2); // page 3: the next spread
      expect(stage().turn).toBe(pageTurn);
      speech.onPart!(i + 1); // paragraph 2 starts on page 4, on the spread the page is turning to: nothing more to do
      speech.onPart!(i + 2); // paragraph 3 starts on page 6, the spread after that: it waits for the running turn
      expect(turns.started()).toBe(1);
      expect(stage().turn).toBe(pageTurn);
      await vi.waitFor(() => expect(turns.started()).toBe(2), { timeout: 3000, interval: 5 });
      await turnEnded();
      expect(stage().page).toBe('5');
      await tick(700);
      expect(turns.started()).toBe(2);
      turns.stop();
    });
  }
});
