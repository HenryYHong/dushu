// @vitest-environment jsdom
// Motion in the shell (main.ts): a change of screen goes through the View Transitions API where there is one, but never into or
// out of the reader, for the same screen again, or under reduced motion; the one underline sits under the current tab; a toast
// put away fades before it goes, and one fading out is not counted against the three on show.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { BookMeta } from '../../src/types';
import { installLayout } from '../reader/layoutFake';
import { bootApp, go, readerDrawn } from './bootApp';

vi.mock('../../src/core/dict', async (orig) => {
  const real = await orig<typeof import('../../src/core/dict')>();
  const { dataText } = await import('./bootApp');
  return { ...real, loadDictionary: () => real.loadDictionary('/', { fetchText: dataText }) };
});
vi.mock('../../src/core/sync', async (orig) => ({ ...(await orig<typeof import('../../src/core/sync')>()), startSync: () => undefined }));
vi.mock('../../src/fonts', () => ({}));
const page = (cls: string, title: string) => (root: HTMLElement) => {
  const el = Object.assign(document.createElement('div'), { className: cls });
  el.appendChild(Object.assign(document.createElement('h1'), { textContent: title }));
  root.appendChild(el);
  return () => {};
};
vi.mock('../../src/ui/library/library', () => ({ mount: page('lib-page', 'Library') }));
vi.mock('../../src/ui/vocab/vocab', () => ({ mount: page('voc-page', 'Vocabulary') }));
vi.mock('../../src/ui/about/about', () => ({ mount: page('ab-page', 'About') }));

/** Each fade of #screen (its own opacity animation, which never stands between a tap and the page). */
const transitions: string[] = [];
let reduce = false;
let meta: BookMeta;
beforeAll(async () => {
  installLayout();
  ({ meta } = await bootApp());
  (document.getElementById('screen') as unknown as { animate: unknown }).animate = () => {
    transitions.push(location.hash);
    return { finished: Promise.resolve(), cancel() {}, play() {}, addEventListener() {} };
  };
  window.matchMedia = ((media: string) => ({
    matches: reduce && media.includes('prefers-reduced-motion: reduce'), media, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

const drawn = (cls: string) => vi.waitFor(() => { if (!document.querySelector(`#screen .${cls}`)) throw new Error(`no ${cls} yet`); });

describe('changing screens', () => {
  it('fades from one screen to another, and the new heading still takes the focus', async () => {
    await drawn('lib-page');
    transitions.length = 0;
    await go('#/vocab');
    await drawn('voc-page');
    expect(transitions).toEqual(['#/vocab']);
    expect(document.activeElement?.textContent).toBe('Vocabulary');
    // The same screen again is drawn at once.
    await go('#/vocab?again=1');
    await drawn('voc-page');
    expect(transitions).toEqual(['#/vocab']);
  });

  it('never into or out of the reader, which has its own screen', async () => {
    transitions.length = 0;
    await go(`#/read/${meta.id}`);
    await readerDrawn();
    await go('#/about');
    await drawn('ab-page');
    expect(transitions).toEqual([]);
    await go('#/');
    await drawn('lib-page');
    expect(transitions).toEqual(['#/']);
  });

  it('never under reduced motion', async () => {
    transitions.length = 0;
    reduce = true;
    try {
      await go('#/about');
      await drawn('ab-page');
      expect(transitions).toEqual([]);
    } finally { reduce = false; }
  });
});

describe('the tab underline', () => {
  it('sits under the current tab, sized to it, and goes on a screen with no tab', async () => {
    const real = Element.prototype.getBoundingClientRect;
    const lefts: Record<string, number> = { '': 200, vocab: 300, review: 400, settings: 500 };
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (this.matches('.app-nav')) return new DOMRect(20, 0, 1000, 57);
      if (this.matches('.app-navlink')) return new DOMRect(lefts[(this as HTMLElement).dataset.route ?? ''], 0, 80, 56);
      return real.call(this);
    };
    try {
      const line = document.querySelector<HTMLElement>('.app-nav .app-nav-line')!;
      expect(line.getAttribute('aria-hidden')).toBe('true');
      await go('#/vocab');
      await drawn('voc-page');
      expect(line.style.transform).toBe('translateX(280px) scaleX(80)');
      expect(line.className).toBe('app-nav-line app-nav-line-on');
      await go('#/about');
      await drawn('ab-page');
      expect(line.classList.contains('app-nav-line-on')).toBe(false);
      await go('#/');
      await drawn('lib-page');
      expect(line.style.transform).toBe('translateX(180px) scaleX(80)');
      expect(line.classList.contains('app-nav-line-on')).toBe(true);
    } finally { Element.prototype.getBoundingClientRect = real; }
  });
});

describe('toasts', () => {
  it('a toast put away fades first, a replaced one goes at once, and a fading one does not count against the three', () => {
    const running: { el: Element; onfinish: null | (() => void) }[] = [];
    const proto = HTMLElement.prototype as unknown as { animate?: unknown };
    proto.animate = function (this: Element) { const a = { el: this, onfinish: null, oncancel: null }; running.push(a); return a; };
    const toasts = document.querySelector('.app-toasts')!;
    toasts.replaceChildren();
    // A sync error stays nine seconds, so it has a close button.
    const error = (e: string) => window.dispatchEvent(new CustomEvent('dushu:account-books', { detail: { uploaded: [], added: [], error: e } }));
    const live = () => [...toasts.querySelectorAll<HTMLElement>('.app-toast:not([data-gone])')].map((t) => t.textContent!.replace(/^.*account: /, ''));
    try {
      for (const e of ['one', 'two', 'three', 'four']) error(e);
      // The oldest made way for the fourth at once, with no fade.
      expect(live()).toEqual(['one', 'two', 'three', 'four'].slice(1));
      expect(toasts.children).toHaveLength(3);
      const four = toasts.lastElementChild as HTMLElement;
      four.querySelector<HTMLButtonElement>('.app-toast-close')!.click();
      expect(four.dataset.gone).toBe('1');
      expect(four.getAttribute('aria-hidden')).toBe('true');
      expect(four.isConnected).toBe(true);
      error('five');
      // "four" is fading: "two" stays.
      expect(live()).toEqual(['two', 'three', 'five']);
      running.find((a) => a.el === four)!.onfinish!();
      expect(four.isConnected).toBe(false);
    } finally { delete proto.animate; toasts.replaceChildren(); }
  });
});
