// @vitest-environment jsdom
// The reader's read-aloud controls against a fake speech engine that keeps the real one's rule: every run starts by stopping
// whatever plays, and a run that was stopped says nothing.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../../src/types';
import { closePopup } from '../../src/ui/popup/popup';

const engine = vi.hoisted(() => {
  const e = {
    gen: 0,
    cancel: null as null | (() => void),
    said: [] as string[],
    options: null as null | { onStart?: () => void; onWaiting?: () => void },
    parts: [] as string[],
    stop: () => { e.gen++; e.cancel?.(); e.cancel = null; },
  };
  return e;
});
vi.mock('../../src/speech/tts', () => ({
  canSpeak: () => true,
  stopSpeaking: vi.fn(() => engine.stop()),
  pauseSpeaking: vi.fn(),
  resumeSpeaking: vi.fn(),
  setSpeakingRate: vi.fn(),
  speakSequence: vi.fn((parts: string[], options: { onStart?: () => void }, onPart?: (i: number) => void) => {
    engine.stop();
    engine.parts = parts;
    engine.options = options;
    options.onStart?.();
    onPart?.(0);
    return new Promise<boolean>((resolve) => { engine.cancel = () => resolve(false); });
  }),
  speak: vi.fn(async (text: string) => {
    engine.stop();
    const mine = engine.gen;
    await new Promise((r) => setTimeout(r, 10)); // finding a voice
    if (mine !== engine.gen) return false;
    engine.said.push(text);
    return true;
  }),
}));

import * as tts from '../../src/speech/tts';
import { mount } from '../../src/ui/reader/reader';
import { makeCtx, stubBrowser, tick } from './helpers';

const BAR_H = 52;
let plainRect: () => DOMRect;
beforeAll(() => { stubBrowser(); plainRect = Element.prototype.getBoundingClientRect; });
let cleanup: (() => void) | void;
beforeEach(() => { engine.gen = 0; engine.cancel = null; engine.said = []; engine.options = null; vi.clearAllMocks(); });
afterEach(() => {
  try { cleanup?.(); } catch { /* ignore */ }
  cleanup = undefined;
  engine.cancel?.();
  closePopup();
  Element.prototype.getBoundingClientRect = plainRect;
  document.body.innerHTML = '';
  document.documentElement.className = '';
});

async function open(): Promise<AppContext> {
  const { ctx } = await makeCtx({ layout: 'scroll', pageTurn: 'none', spread: 'single' });
  const book = await ctx.store.books.add({ title: '测试', author: '', format: 'paste', script: 'simplified',
    chapters: [{ title: '第一章', blocks: [{ t: 'p', text: '我们在银行门口见面。' }, { t: 'hr' }, { t: 'p', text: '他慢慢地走了过来。' }] }], assets: new Map() });
  location.hash = `#/read/${book.id}`;
  const root = document.createElement('div'); document.body.appendChild(root);
  cleanup = await mount(root, { bookId: book.id }, ctx);
  await tick(10);
  return ctx;
}
const readBtn = () => document.querySelector<HTMLButtonElement>('.rd-speech-btn')!;
const status = () => document.querySelector('.rd-audio-status')!.textContent;

describe('read-aloud controls', () => {
  it('Scroll: the Read button starts at the first word of the top line, not the start of the paragraph', async () => {
    await open();
    // The title has scrolled away; the first paragraph's line with 我们在银 is under the bar, the line from 行 on is the top one.
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const block = this.closest?.('[data-b]') as HTMLElement | null;
      if (block?.dataset.b === '0') return new DOMRect(0, -300, 600, 100);
      if (block?.dataset.b === '1') {
        if (this === block) return new DOMRect(0, -100, 600, 400);
        if (this.matches('ruby.rd-c')) return Number((this as HTMLElement).dataset.o) < 4 ? new DOMRect(0, 0, 24, 30) : new DOMRect(0, 40, 24, 30);
      }
      return new DOMRect(100, 100, 24, 30);
    };
    readBtn().click();
    await vi.waitFor(() => expect(tts.speakSequence).toHaveBeenCalledOnce());
    // 行 is the second half of 银行: the voice starts at the next word.
    expect(engine.parts).toEqual(['门口见面。', '他慢慢地走了过来。']);
    // The top line comes out from under the bar, by a line, not to a third of the way down.
    expect(window.scrollBy).toHaveBeenLastCalledWith(0, 40 - (BAR_H + 32));
  });

  it('a word card\'s Pronounce during read-aloud is heard: the chapter stops without stopping the word', async () => {
    await open();
    readBtn().click();
    await vi.waitFor(() => expect(tts.speakSequence).toHaveBeenCalledOnce());
    expect(readBtn().getAttribute('aria-pressed')).toBe('true');
    const word = [...document.querySelectorAll<HTMLElement>('.rd-w')]
      .find((w) => [...w.querySelectorAll('ruby')].map((r) => r.firstChild!.textContent).join('') === '银行')!;
    word.querySelector('ruby')!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    await vi.waitFor(() => expect(document.querySelector('.pp-speak')).not.toBeNull());
    document.querySelector<HTMLButtonElement>('.pp-speak')!.click();
    await vi.waitFor(() => expect(engine.said).toEqual(['银行']));
    expect(readBtn().getAttribute('aria-pressed')).toBe('false');
    expect(tts.stopSpeaking).not.toHaveBeenCalled();
  });

  it('shows Preparing audio while the next sentence is awaited, then Reading aloud again', async () => {
    await open();
    readBtn().click();
    await vi.waitFor(() => expect(tts.speakSequence).toHaveBeenCalledOnce());
    expect(status()).toBe('Reading aloud');
    engine.options!.onWaiting?.();
    expect(status()).toBe('Preparing audio…');
    engine.options!.onStart?.();
    expect(status()).toBe('Reading aloud');
  });

  it('a new speed reaches the sentence that is playing', async () => {
    const ctx = await open();
    ctx.settings.set({ ttsRate: 1.25 });
    expect(tts.setSpeakingRate).not.toHaveBeenCalled();
    readBtn().click();
    await vi.waitFor(() => expect(tts.speakSequence).toHaveBeenCalledOnce());
    ctx.settings.set({ ttsRate: 1.5 });
    expect(tts.setSpeakingRate).toHaveBeenCalledWith(1.5);
  });
});
