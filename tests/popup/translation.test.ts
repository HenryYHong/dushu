// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://henryyhong.com/dushu/#/read" }
// The translation block: a live region the screen reader waits on while a result streams, one quiet line when no
// real translator is reachable, a provider menu that scrolls into view and lists only what can work here, and error text in
// the danger color. The public copy of the app: no Mac.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../../src/types';
import { DEFAULT_SETTINGS } from '../../src/store/settings';
import { createTranslationPanel, type TranslationPanel } from '../../src/ui/popup/translation';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const calls = vi.hoisted(() => ({ translate: vi.fn(), availability: vi.fn(), list: null as null | { id: string; availability: string }[] }));
vi.mock('../../src/translate', () => {
  const chrome = { id: 'chrome', label: 'Chrome on-device', availability: calls.availability, translate: calls.translate };
  const gloss = { id: 'gloss', label: 'Word-by-word (offline)', availability: async () => 'yes', translate: async () => 'x (y): z' };
  const local = { id: 'local', label: 'On this Mac (Ollama)', availability: async () => 'no', translate: async () => '' };
  const other = (id: string, label: string) => ({ id, label, availability: async () => 'no', translate: async () => '' });
  const all: Record<string, { id: string; label: string }> = { chrome, gloss, local,
    claude: other('claude', 'Claude'), account: other('account', 'Qwen (through your account)'), mymemory: other('mymemory', 'MyMemory') };
  let picked: typeof chrome | typeof gloss | typeof local = chrome;
  return {
    getTranslator: (id: string) => (id === 'gloss' ? gloss : id === 'local' ? local : chrome),
    chromeSupported: () => false,
    pickTranslator: async () => picked,
    listTranslators: async () => calls.list?.map((r) => ({ translator: all[r.id], availability: r.availability }))
      ?? [{ translator: chrome, availability: 'yes' }, { translator: gloss, availability: 'yes' }, { translator: local, availability: 'no' }],
    __pick: (t: 'chrome' | 'gloss' | 'local') => { picked = t === 'gloss' ? gloss : t === 'local' ? local : chrome; },
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
  calls.list = null;
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
  it('offers a reader who is signed out to sign in if they have an account, in one line instead of repeating the glosses', async () => {
    mount({ hasWordList: true });
    await vi.waitFor(() => expect(panel.el.classList.contains('pp-tr-quiet')).toBe(true));
    // Accounts are by invite: no "It's free" pitch to every visitor.
    expect(body().textContent).toBe('This browser has no sentence translator. Word by word is below. Have an account? Sign in to translate whole sentences.');
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
    expect(body().querySelector('a')!.getAttribute('href')).toBe('#/settings?open=translation');
  });
  it('without a word list the gloss is the result, as before', async () => {
    mount();
    await vi.waitFor(() => expect(panel.el.querySelector('.pp-tr-text')?.textContent).toContain('x (y): z'));
    expect(panel.el.classList.contains('pp-tr-quiet')).toBe(false);
  });
});

describe('provider menu', () => {
  const open = async () => {
    await vi.waitFor(() => expect(panel.el.querySelector('.pp-tr-actions button')).not.toBeNull());
    Element.prototype.scrollIntoView = vi.fn();
    [...panel.el.querySelectorAll<HTMLElement>('.pp-tr-actions button')].find((b) => /another provider/.test(b.textContent ?? ''))!.click();
    await vi.waitFor(() => expect(panel.el.querySelector('.pp-menu')).not.toBeNull());
    return [...panel.el.querySelectorAll<HTMLButtonElement>('.pp-menu-item')].map((b) =>
      [b.querySelector('.pp-menu-name')?.textContent, b.querySelector('.pp-menu-note')?.textContent, b.disabled]);
  };
  const everything = [
    { id: 'local', availability: 'no' }, { id: 'chrome', availability: 'no' }, { id: 'claude', availability: 'no' },
    { id: 'account', availability: 'no' }, { id: 'mymemory', availability: 'yes' }, { id: 'gloss', availability: 'yes' },
  ];
  afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

  it('leaves out the Mac’s providers with no Mac, and puts the ready ones first', async () => {
    calls.list = everything;
    mount();
    expect(await open()).toEqual([
      ['MyMemory', 'Sends the text to MyMemory', false],
      ['Word-by-word (offline)', 'Offline, word by word', false],
      ['Chrome on-device', 'Not available in this browser', true],
      ['Qwen (through your account)', 'Sign in to use it', true],
    ]);
  });

  it('says a service is out of reach offline, rather than asking for a sign-in', async () => {
    localStorage.setItem('dushu.cloud.v1', JSON.stringify({ token: 't', email: 'reader@example.com' }));
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    calls.list = everything.map((r) => (r.id === 'mymemory' ? { ...r, availability: 'no' } : r));
    mount();
    const rows = await open();
    vi.unstubAllGlobals();
    // Signed in, Claude goes through the account, so its row stays; offline, every online service says so.
    expect(rows.map((r) => r[0])).toEqual(['Word-by-word (offline)', 'Chrome on-device', 'Claude', 'Qwen (through your account)', 'MyMemory']);
    expect(rows.filter((r) => ['Claude', 'Qwen (through your account)', 'MyMemory'].includes(r[0] as string)).map((r) => r[1])).toEqual(['You are offline', 'You are offline', 'You are offline']);
  });

  it('keeps the provider in use even when it cannot run here', async () => {
    calls.list = everything;
    (translateMock as unknown as { __pick: (t: string) => void }).__pick('local');
    mount();
    await vi.waitFor(() => expect(panel.el.querySelector('.pp-tr-error')?.textContent).toMatch(/^On this Mac \(Ollama\) is not available\./));
    expect((await open()).map((r) => r[0])).toEqual(['MyMemory', 'Word-by-word (offline)', 'On this Mac (Ollama)', 'Chrome on-device', 'Qwen (through your account)']);
  });

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
