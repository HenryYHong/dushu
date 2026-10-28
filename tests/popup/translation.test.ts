// @vitest-environment jsdom
// The translation block: a live region the screen reader waits on while a result streams, one quiet line when no
// real translator is reachable, a provider menu that scrolls into view, and error text in the danger color.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../../src/types';
import { DEFAULT_SETTINGS } from '../../src/store/settings';
import { createTranslationPanel, type TranslationPanel } from '../../src/ui/popup/translation';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const calls = vi.hoisted(() => ({ translate: vi.fn(), availability: vi.fn() }));
vi.mock('../../src/translate', () => {
  const chrome = { id: 'chrome', label: 'Chrome on-device', availability: calls.availability, translate: calls.translate };
  const gloss = { id: 'gloss', label: 'Word-by-word (offline)', availability: async () => 'yes', translate: async () => 'x (y): z' };
  const local = { id: 'local', label: 'On this Mac (Ollama)', availability: async () => 'no', translate: async () => '' };
  let picked: typeof chrome | typeof gloss = chrome;
  return {
    getTranslator: (id: string) => (id === 'gloss' ? gloss : id === 'local' ? local : chrome),
    pickTranslator: async () => picked,
    listTranslators: async () => [{ translator: chrome, availability: 'yes' }, { translator: gloss, availability: 'yes' }, { translator: local, availability: 'no' }],
    __pick: (t: 'chrome' | 'gloss') => { picked = t === 'gloss' ? gloss : chrome; },
  };
});
import * as translateMock from '../../src/translate';

let panel: TranslationPanel;
const mount = (opts: { hasWordList?: boolean } = {}) => {
  const ctx = { settings: { get: () => DEFAULT_SETTINGS }, dictSync: () => null, toast: vi.fn() } as unknown as AppContext;
  panel = createTranslationPanel({ ctx, text: '我们回家。', ...opts });
  document.body.append(panel.el);
};
const body = () => panel.el.querySelector('.pp-tr-body') as HTMLElement;

beforeEach(() => {
  calls.availability.mockReset().mockResolvedValue('yes');
  calls.translate.mockReset().mockResolvedValue('We are going home.');
  (translateMock as unknown as { __pick: (t: string) => void }).__pick('chrome');
});
afterEach(() => { panel?.destroy(); document.body.innerHTML = ''; });

describe('live region', () => {
  it('is polite, and busy while the answer streams so a screen reader reads it once', async () => {
    let finish!: (s: string) => void;
    calls.translate.mockImplementation(() => new Promise<string>((r) => { finish = r; }));
    mount();
    expect(body().getAttribute('aria-live')).toBe('polite');
    await vi.waitFor(() => expect(calls.translate).toHaveBeenCalled());
    expect(body().getAttribute('aria-busy')).toBe('true');
    finish('We are going home.');
    await vi.waitFor(() => expect(body().getAttribute('aria-busy')).toBe('false'));
    expect(body().textContent).toContain('We are going home.');
  });
  it('an error clears busy too', async () => {
    calls.translate.mockRejectedValue(new Error('The service said no.'));
    mount();
    await vi.waitFor(() => expect(panel.el.querySelector('.pp-tr-error')).not.toBeNull());
    expect(body().getAttribute('aria-busy')).toBe('false');
  });
});

describe('no translator offline', () => {
  beforeEach(() => (translateMock as unknown as { __pick: (t: string) => void }).__pick('gloss'));
  afterEach(() => localStorage.clear());
  it('asks a reader who is signed out to sign in for whole sentences, in one line instead of repeating the glosses', async () => {
    mount({ hasWordList: true });
    await vi.waitFor(() => expect(panel.el.classList.contains('pp-tr-quiet')).toBe(true));
    expect(body().textContent).toContain('Sign in to translate whole sentences. It’s free.');
    expect(body().querySelector('button')?.textContent).toBe('Sign in');
    expect(panel.el.querySelector('.pp-tr-text')).toBeNull();
    // and it still offers another provider
    expect([...panel.el.querySelectorAll('button')].some((b) => /another provider/.test(b.textContent ?? ''))).toBe(true);
  });
  it('signed in with nothing to translate, names the platform gap when the browser has no Translator API (Safari, iPad)', async () => {
    localStorage.setItem('dushu.cloud.v1', JSON.stringify({ token: 't', email: 'reader@example.com' }));
    delete (globalThis as { Translator?: unknown }).Translator;
    mount({ hasWordList: true });
    await vi.waitFor(() => expect(body().textContent).toContain('Safari and iPadOS have no on-device translator'));
    expect(body().textContent).toContain('No sentence translator is available right now.');
    expect(body().querySelector('a')!.getAttribute('href')).toBe('#/settings');
  });
  it('without a word list the gloss is the result, as before', async () => {
    mount();
    await vi.waitFor(() => expect(panel.el.querySelector('.pp-tr-text')?.textContent).toContain('x (y): z'));
    expect(panel.el.classList.contains('pp-tr-quiet')).toBe(false);
  });
});

describe('provider menu', () => {
  it('scrolls into view inside the popup when it opens', async () => {
    mount();
    await vi.waitFor(() => expect(panel.el.querySelector('.pp-tr-actions button')).not.toBeNull());
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const more = [...panel.el.querySelectorAll<HTMLElement>('.pp-tr-actions button')].find((b) => /another provider/.test(b.textContent ?? ''))!;
    more.click();
    await vi.waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' }));
  });
});

describe('stylesheet', () => {
  const css = readFileSync(join(__dirname, '..', '..', 'src', 'styles', 'popup.css'), 'utf8');
  it('draws errors with the danger color and keeps the menu from outgrowing the popup', () => {
    expect(css).toMatch(/\.pp-tr-error\s*\{[^}]*var\(--danger/);
    expect(css).toMatch(/\.pp-field-error\s*\{[^}]*var\(--danger/);
    expect(css).toMatch(/\.pp-menu\s*\{[^}]*max-height/);
  });
  it('makes every footer, provider and phrase control at least 44 px on touch', () => {
    const touch = css.slice(css.indexOf('@media (pointer: coarse) {\n  .pp-seg-btn'));
    for (const sel of ['.pp-seg-btn', '.pp-tr-actions .btn', '.pp-menu-item', '.pp-wbw', '.pp-more-btn', '.pp-xref']) {
      expect(touch, sel).toMatch(new RegExp(`${sel.replace('.', '\\.')}[^}]*(min-)?height:\\s*44px`));
    }
  });
  it('keeps cross-reference text on the baseline and gives the dictionary links a 44 px width', () => {
    const touch = css.slice(css.indexOf('@media (pointer: coarse) {\n  .pp-seg-btn'));
    expect(touch).toMatch(/\.pp-xref\s*\{[^}]*vertical-align:\s*baseline/);
    expect(touch).not.toMatch(/\.pp-xref\s*\{[^}]*vertical-align:\s*middle/);
    expect(touch).toMatch(/\.pp-links a\s*\{[^}]*min-width:\s*44px/);
    expect(css).toMatch(/\.pp-short \.pp-foot\s*\{[^}]*position:\s*static/);
  });
  it('has a sticky footer, a caret and a scroll box', () => {
    expect(css).toMatch(/\.pp-foot\s*\{[^}]*position:\s*sticky/);
    expect(css).toMatch(/\.pp-float::before/);
    expect(css).toMatch(/\.pp-scroll\s*\{[^}]*overflow-y:\s*auto/);
  });
});
