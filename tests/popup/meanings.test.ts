// @vitest-environment jsdom
// The word card in the reader's language: a French reader of Spanish books taps a word and the card opens at once with the
// dictionary's English, then fills in French under the part of speech, the English kept under each meaning. Kept translations
// come back at once and cost nothing; senses behind "more" are translated only when shown; the setting picks what runs by
// itself and what waits for the button; nothing is sent when the setting is Never or the reader reads English. Chrome's
// on-device translator and Claude are faked.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closePopup, openWordPopup } from '../../src/ui/popup/popup';
import { anchorRect, makeCtx, stubBrowser } from '../reader/helpers';
import { setLangForTests } from '../../src/lang/active';
import { resetChromeTranslator } from '../../src/translate/chrome';
import { resetMeaningsCache } from '../../src/translate/meanings';
import { fakeEngine } from '../lang/app/fakeEngine';
import type { LangEngine } from '../../src/lang/types';
import type { Settings } from '../../src/types';

const claude = vi.hoisted(() => ({ available: false, translate: null as unknown as ReturnType<typeof import('vitest')['vi']['fn']> }));
vi.mock('../../src/translate/claude', async (orig) => {
  const real = await orig<typeof import('../../src/translate/claude')>();
  return {
    ...real,
    createClaudeTranslator: () => ({
      id: 'claude', label: 'Claude (through your Mac)',
      availability: async () => (claude.available ? 'yes' : 'no'),
      translate: (req: { text: string }) => claude.translate(req),
    }),
  };
});

const g = globalThis as { Translator?: unknown };
const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const all = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];

let chrome: { create: ReturnType<typeof vi.fn>; translate: ReturnType<typeof vi.fn>; availability: ReturnType<typeof vi.fn> };
function installChrome(avail = 'available') {
  const translate = vi.fn(async (t: string) => `FR ${t}`);
  const create = vi.fn(async () => ({ translate }));
  const availability = vi.fn(async () => avail);
  g.Translator = { availability, create };
  chrome = { create, translate, availability };
}

/** A Spanish engine whose ir has six senses, so two wait behind "2 more". */
function spanish(): LangEngine {
  const base = fakeEngine('es');
  return {
    ...base,
    lookup(surface, ctx) {
      const lu = base.lookup(surface, ctx);
      if (surface !== 'ir') return lu;
      return { ...lu, entries: [{ head: 'ir', source: 'test', level: 1, senses: [
        { pos: 'verb', glosses: ['to go'] }, { glosses: ['to leave'] }, { glosses: ['to be going to'] }, { glosses: ['to suit'] },
        { glosses: ['to be at stake'] }, { glosses: ['to bet'] },
      ] }] };
    },
  };
}

async function open(word: string, settings: Partial<Settings> = {}) {
  const { ctx } = await makeCtx({ translateTo: 'fr', ...settings });
  openWordPopup({ ctx, word, anchor: anchorRect() });
  return ctx;
}
const filled = () => all('.pp-def-tl').map((e) => e.textContent);

beforeAll(() => stubBrowser());
beforeEach(() => {
  localStorage.clear();
  resetMeaningsCache();
  resetChromeTranslator();
  claude.available = false;
  claude.translate = vi.fn(async (req: { text: string }) => req.text.split('\n').map((l) => l.replace(/^(\d+)\. /, '$1. FR-C ')).join('\n'));
  setLangForTests('es', spanish());
});
afterEach(() => {
  closePopup();
  document.body.innerHTML = '';
  delete g.Translator;
  setLangForTests('zh');
});

describe('a French reader in the Spanish library', () => {
  it('opens at once with the English, then fills in French above it, the English still there', async () => {
    installChrome();
    await open('casa');
    // Before anything is awaited: the dictionary as it is.
    expect(q('.pp-defs li')!.textContent).toContain('house; home');
    expect(q('.pp-def-tl')).toBeNull();
    await vi.waitFor(() => expect(filled()).toEqual(['FR house; home']));
    const li = q('.pp-defs li')!;
    expect(li.classList.contains('pp-def-tl-on')).toBe(true);
    expect(li.querySelector('.pp-def-tl')!.getAttribute('lang')).toBe('fr');
    expect(li.querySelector('.pp-def-src')!.textContent).toBe('house; home');
    // The part of speech leads, as the app's word; the translation follows it, the dictionary's words last.
    expect([...li.children].map((c) => c.className)).toEqual(['pp-pos', 'pp-def-tl', 'pp-def-src']);
    expect(q('.pp-mt-note')!.textContent).toContain('Machine translation into French by Chrome on-device');
    expect(q('.pp-mt-note')!.textContent).toContain('English is under each meaning');
    expect(chrome.create.mock.calls[0][0]).toMatchObject({ sourceLanguage: 'en', targetLanguage: 'fr' });
    // Only the meaning goes out: not the part of speech, the level, the gender or the headword.
    expect(chrome.translate.mock.calls.map((c) => c[0])).toEqual(['house; home']);
  });

  it('a word looked up again costs nothing: the French is there when the card opens', async () => {
    installChrome();
    await open('casa');
    await vi.waitFor(() => expect(filled()).toHaveLength(1));
    closePopup();
    await open('casa');
    expect(filled()).toEqual(['FR house; home']);
    expect(chrome.translate).toHaveBeenCalledTimes(1);
  });

  it('translates the senses the card shows, and the rest only once "more" shows them', async () => {
    installChrome();
    await open('ir');
    await vi.waitFor(() => expect(filled()).toHaveLength(4));
    expect(chrome.translate.mock.calls.map((c) => c[0])).toEqual(['to go', 'to leave', 'to be going to', 'to suit']);
    q('.pp-more-btn')!.click();
    await vi.waitFor(() => expect(filled()).toHaveLength(6));
    expect(chrome.translate.mock.calls.map((c) => c[0]).slice(4)).toEqual(['to be at stake', 'to bet']);
    // Each sense its own, in its own line.
    expect(all('.pp-defs li').map((li) => li.querySelector('.pp-def-src')!.textContent)).toEqual(
      ['to go', 'to leave', 'to be going to', 'to suit', 'to be at stake', 'to bet']);
  });

  it('When I ask: a button, and nothing is sent until it is pressed', async () => {
    installChrome();
    await open('casa', { translateMeanings: 'ask' });
    await vi.waitFor(() => expect(q('.pp-mt-btn')).not.toBeNull());
    expect(q('.pp-mt-btn')!.textContent).toBe('Meanings in French');
    expect(chrome.translate).not.toHaveBeenCalled();
    q('.pp-mt-btn')!.click();
    await vi.waitFor(() => expect(filled()).toEqual(['FR house; home']));
  });

  it('Automatic with only Claude here: the button, never by itself; one request for the card when pressed', async () => {
    claude.available = true;
    await open('ir');
    await vi.waitFor(() => expect(q('.pp-mt-btn')).not.toBeNull());
    expect(q('.pp-mt-btn')!.title).toContain('Claude');
    expect(claude.translate).not.toHaveBeenCalled();
    q('.pp-mt-btn')!.click();
    await vi.waitFor(() => expect(filled()).toHaveLength(4));
    expect(claude.translate).toHaveBeenCalledTimes(1);
    expect(claude.translate.mock.calls[0][0]).toMatchObject({ text: '1. to go\n2. to leave\n3. to be going to\n4. to suit', to: 'fr' });
    expect(filled()).toEqual(['FR-C to go', 'FR-C to leave', 'FR-C to be going to', 'FR-C to suit']);
    // Pressed once, the senses shown next come without asking again.
    q('.pp-more-btn')!.click();
    await vi.waitFor(() => expect(filled()).toHaveLength(6));
    expect(claude.translate.mock.calls[1][0]).toMatchObject({ text: '1. to be at stake\n2. to bet' });
  });

  it('Always: Claude runs by itself', async () => {
    claude.available = true;
    await open('casa', { translateMeanings: 'always' });
    await vi.waitFor(() => expect(filled()).toEqual(['FR-C house; home']));
    expect(q('.pp-mt-note')!.textContent).toContain('Claude');
  });

  it('an answer that lost a sense leaves the English and says so, with Try again', async () => {
    claude.available = true;
    claude.translate = vi.fn(async () => '1. aller, partir, convenir');
    await open('ir', { translateMeanings: 'always' });
    await vi.waitFor(() => expect(q('.pp-mt-error')).not.toBeNull());
    expect(filled()).toEqual([]);
    expect(q('.pp-mt-action')!.textContent).toContain('Try again');
    expect(q('.pp-defs li')!.textContent).toContain('to go');
  });

  it('sends nothing when the setting is Never', async () => {
    installChrome();
    claude.available = true;
    await open('casa', { translateMeanings: 'never' });
    await new Promise((r) => setTimeout(r, 20));
    expect(chrome.availability).not.toHaveBeenCalled();
    expect(chrome.translate).not.toHaveBeenCalled();
    expect(claude.translate).not.toHaveBeenCalled();
    expect(q('.pp-mt')).toBeNull();
  });

  it('sends nothing when the reader’s language is the dictionary’s', async () => {
    installChrome();
    claude.available = true;
    await open('casa', { translateTo: 'en', translateMeanings: 'always' });
    await new Promise((r) => setTimeout(r, 20));
    expect(chrome.availability).not.toHaveBeenCalled();
    expect(claude.translate).not.toHaveBeenCalled();
    expect(q('.pp-mt')).toBeNull();
    expect(q('.pp-def-tl')).toBeNull();
  });

  it('with no translator here, the card is the dictionary as before', async () => {
    await open('casa');
    await new Promise((r) => setTimeout(r, 20));
    expect(q('.pp-mt')!.hidden).toBe(true);
    expect(q('.pp-def-tl')).toBeNull();
  });
});

describe('the other libraries', () => {
  it('Chinese: CC-CEDICT’s English into French, the cross-references still a tap away under it', async () => {
    setLangForTests('zh');
    installChrome();
    await open('银行');
    await vi.waitFor(() => expect(filled().length).toBeGreaterThan(0));
    expect(chrome.create.mock.calls[0][0]).toMatchObject({ sourceLanguage: 'en', targetLanguage: 'fr' });
    expect(filled()[0]).toMatch(/^FR bank/);
    expect(q('.pp-def-tl-on .pp-def-src')!.textContent).toMatch(/^bank/);
  });

  it('English: a Korean reader gets the dictionary’s Chinese in Korean', async () => {
    setLangForTests('en', fakeEngine('en'));
    installChrome();
    await open('casa', { translateTo: 'ko' });
    await vi.waitFor(() => expect(filled()).toHaveLength(1));
    expect(chrome.create.mock.calls[0][0]).toMatchObject({ sourceLanguage: 'zh', targetLanguage: 'ko' });
    expect(q('.pp-def-tl')!.getAttribute('lang')).toBe('ko');
  });

  it('English: a Chinese reader reads the dictionary as it is', async () => {
    setLangForTests('en', fakeEngine('en'));
    installChrome();
    await open('casa', { translateTo: 'zh' });
    await new Promise((r) => setTimeout(r, 20));
    expect(chrome.translate).not.toHaveBeenCalled();
    expect(q('.pp-mt')).toBeNull();
  });
});
