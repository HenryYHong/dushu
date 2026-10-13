// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '../../src/ui/reader/reader';
import { closePopup } from '../../src/ui/popup/popup';
import { makeCtx, stubBrowser, tick } from './helpers';

const speech = vi.hoisted(() => ({ sequence: vi.fn(), stop: vi.fn() }));
vi.mock('../../src/speech/tts', () => ({ canSpeak: () => true, speakSequence: speech.sequence,
  stopSpeaking: speech.stop, pauseSpeaking: vi.fn(), resumeSpeaking: vi.fn(), speak: vi.fn(async () => true) }));

beforeAll(() => stubBrowser());
let cleanup: (() => void) | void;
let finish: ((ok: boolean) => void)[];
beforeEach(() => {
  speech.sequence.mockReset(); speech.stop.mockClear(); finish = [];
  speech.sequence.mockImplementation((_parts, options, onPart, onBoundary) => {
    options.onStart?.(); onPart?.(0); onBoundary?.(0, 0, 1);
    return new Promise<boolean>(resolve => finish.push(resolve));
  });
});
afterEach(() => { cleanup?.(); cleanup = undefined; finish.forEach(resolve => resolve(false)); closePopup(); window.getSelection()?.removeAllRanges(); document.body.innerHTML = ''; document.documentElement.className = ''; });

async function open(layout: 'scroll' | 'pages', first = '我们在银行门口见面。') {
  const { ctx } = await makeCtx({ layout, pageTurn: 'none', spread: 'single' });
  const book = await ctx.store.books.add({ title: '测试', author: '', format: 'paste', script: 'simplified',
    chapters: [{ title: '第一章', blocks: [{ t: 'p', text: first }, { t: 'hr' }, { t: 'p', text: '他慢慢地走了过来。' }] }], assets: new Map() });
  location.hash = `#/read/${book.id}`;
  const root = document.createElement('div'); document.body.appendChild(root);
  cleanup = await mount(root, { bookId: book.id }, ctx);
  await tick(10);
}
const word = (text: string) => [...document.querySelectorAll<HTMLElement>('.rd-live .rd-w, .rd-article:not(.rd-paged) .rd-w')]
  .find(w => [...w.querySelectorAll('ruby')].map(r => r.firstChild!.textContent).join('') === text)!;
const choose = (text: string) => word(text).querySelector('ruby')!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
const readHere = () => document.querySelector<HTMLButtonElement>('.pp-read-from button')!.click();

describe('read from a chosen position', () => {
  it.each(['scroll', 'pages'] as const)('starts at a word and continues the chapter in %s', async layout => {
    await open(layout);
    choose('银行');
    expect(document.querySelector('.pp-read-from')?.textContent).toBe('Read from here');
    readHere();
    await vi.waitFor(() => expect(speech.sequence).toHaveBeenCalledOnce());
    expect(speech.sequence.mock.calls[0][0]).toEqual(['银行门口见面。', '他慢慢地走了过来。']);
    expect(document.querySelector('.pp-pop')).toBeNull();
    expect([...document.querySelectorAll('.rd-speaking-word')].map(c => c.firstChild!.textContent).join('')).toBe('银行');
  });

  it('keeps source highlighting correct after an earlier supplementary character', async () => {
    await open('scroll', '𠀀，我们在银行门口见面。');
    choose('银行'); readHere();
    await vi.waitFor(() => expect(speech.sequence).toHaveBeenCalledOnce());
    expect(speech.sequence.mock.calls[0][0][0]).toBe('银行门口见面。');
    expect([...document.querySelectorAll('.rd-speaking-word')].map(c => c.firstChild!.textContent).join('')).toBe('银行');
  });

  it('starts at a multi-paragraph selection and continues beyond its selected end', async () => {
    await open('scroll');
    const paragraphs = document.querySelectorAll('.rd-p');
    const bases = (p: Element) => [...p.querySelectorAll('ruby')].map(r => r.firstChild!);
    const start = bases(paragraphs[0]).find(n => n.textContent === '门')!;
    const end = bases(paragraphs[1]).find(n => n.textContent === '慢')!;
    start.parentElement!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    const range = document.createRange(); range.setStart(start, 0); range.setEnd(end, 1);
    window.getSelection()!.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    await vi.waitFor(() => expect(document.querySelector('.pp-k-phrase .pp-read-from')).not.toBeNull());
    readHere();
    await vi.waitFor(() => expect(speech.sequence).toHaveBeenCalledOnce());
    expect(speech.sequence.mock.calls[0][0]).toEqual(['门口见面。', '他慢慢地走了过来。']);
  });

  it('replaces an existing reading without a late completion stopping the new one', async () => {
    await open('scroll');
    choose('银行'); readHere();
    await vi.waitFor(() => expect(speech.sequence).toHaveBeenCalledOnce());
    choose('慢慢'); readHere();
    await vi.waitFor(() => expect(speech.sequence).toHaveBeenCalledTimes(2));
    expect(speech.sequence.mock.calls[1][0]).toEqual(['慢慢地走了过来。']);
    finish[0](false); await tick();
    expect(document.querySelector('.rd-speech-btn')?.getAttribute('aria-pressed')).toBe('true');
    finish[1](true); await tick();
    expect(document.querySelector('.rd-speech-btn')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('does not offer a misleading chapter start on a drilled-in character', async () => {
    await open('scroll');
    choose('银行');
    document.querySelector<HTMLButtonElement>('.pp-card')!.click();
    expect(document.querySelector('.pp-read-from')).toBeNull();
  });
});
