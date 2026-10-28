// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../../src/types';
import { DEFAULT_SETTINGS } from '../../src/store/settings';
import { createTranslationPanel, personName, translationTerms, type TranslationPanel } from '../../src/ui/popup/translation';
import { buildLexicon } from '../../src/core/lexicon';
import type { Dictionary } from '../../src/types';
import { loadTestDictionary } from '../helpers/data';

const calls = vi.hoisted(() => ({ chrome: vi.fn(), local: vi.fn(), localAvailability: vi.fn() }));
vi.mock('../../src/translate', () => {
  const chrome = { id: 'chrome', label: 'Chrome on-device', availability: async () => 'yes', translate: calls.chrome };
  const local = { id: 'local', label: 'On this Mac (Ollama)', availability: calls.localAvailability, translate: calls.local };
  return {
    getTranslator: (id: string) => id === 'local' ? local : chrome,
    pickTranslator: async () => chrome,
    listTranslators: async () => [{ translator: chrome, availability: 'yes' }, { translator: local, availability: 'yes' }],
  };
});

let panel: TranslationPanel;
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('.pp-tr-actions button')].find(node => node.textContent?.includes(text));
const mount = () => {
  const ctx = { settings: { get: () => DEFAULT_SETTINGS }, dictSync: () => null, toast: vi.fn() } as unknown as AppContext;
  panel = createTranslationPanel({ ctx, text: '我们回家。' });
  document.body.append(panel.el);
};

beforeEach(() => {
  calls.chrome.mockReset().mockResolvedValue('We are going home.');
  calls.local.mockReset().mockResolvedValue('We are going home.\n- 回家 means to go home.');
  calls.localAvailability.mockReset().mockResolvedValue('yes');
});
afterEach(() => { panel?.destroy(); document.body.innerHTML = ''; vi.unstubAllGlobals(); });

describe('translation controls', () => {
  it('passes book names in the displayed script rather than dropping converted names', () => {
    const lexicon = buildLexicon([{ word: '黃蓉', pinyin: 'huang2 rong2', gloss: 'name (person)', enabled: true, kind: 'name', origin: 'auto' }]);
    const dict = { toSimplified: (word: string) => word.replace('黃', '黄'), toTraditional: (word: string) => word.replace('黄', '黃'), wordsAt: () => [], freq: () => 0, hasWord: () => false, pinyinFor: () => [] } as unknown as Dictionary;
    expect(translationTerms('黄蓉笑了。', lexicon, dict)).toEqual([{ word: '黄蓉', pinyin: 'huang2 rong2', gloss: 'name (person)', kind: 'name' }]);
  });
  it('provides a rare drum reading and an idiom’s figurative sense rather than its literal first gloss', () => {
    const entries = {
      羯鼓: { pinyin: 'jie2 gu3', defs: ['double-ended skin drum with a narrow waist'] },
      打草惊蛇: { pinyin: 'da3 cao3 jing1 she2', defs: ['lit. beat the grass to scare the snake (idiom)', 'fig. to inadvertently alert an enemy'] },
    };
    const dict = { wordsAt: (text: string, at: number) => [...Object.keys(entries).filter(w => text.startsWith(w, at)), text[at]],
      lookup: (word: keyof typeof entries) => entries[word] ? [entries[word]] : [], freq: () => 1, hsk: () => null,
      hasWord: (word: keyof typeof entries) => !!entries[word], pinyinFor: () => [] } as unknown as Dictionary;
    const terms = translationTerms('羯鼓响起，别打草惊蛇。', undefined, dict);
    expect(terms.find(t => t.word === '羯鼓')?.pinyin).toBe('jie2 gu3');
    expect(terms.find(t => t.word === '羯鼓')?.kind).toBe('term');
    expect(terms.find(t => t.word === '打草惊蛇')?.gloss).toBe('fig. to inadvertently alert an enemy');
    expect(terms.find(t => t.word === '打草惊蛇')?.kind).toBe('idiom');
  });
  it('names the people and characters the dictionary knows, spelled its way, and leaves other proper nouns out', async () => {
    const dict = await loadTestDictionary();
    // 孔乙己 is a dictionary word, so the book's scan never lists it, and a small model made "Krug" of it.
    expect(translationTerms('孔乙己是站着喝酒而穿长衫的唯一的人。', undefined, dict).find((t) => t.word === '孔乙己'))
      .toEqual({ word: '孔乙己', pinyin: 'Kong3 Yi3 ji3', gloss: 'Kong Yiji', kind: 'name' });
    expect(translationTerms('张飞大怒。', undefined, dict).find((t) => t.word === '张飞')).toMatchObject({ gloss: 'Zhang Fei', kind: 'name' });
    // A foreign name is not pinyin: it goes by its English name.
    expect(translationTerms('赫拉克利特说过。', undefined, dict).find((t) => t.word === '赫拉克利特')).toMatchObject({ gloss: 'Heraclitus', kind: 'term' });
    // An era or a place is not a person; a place may be a plain phrase.
    expect(personName('Jin Dynasty (1115-1234), founded by the Jurchen')).toBeNull();
    expect(personName('Qianshan district of Anshan city')).toBeNull();
    expect(personName("Beijing municipality, capital of the People's Republic of China")).toBeNull();
    expect(personName('Lin Daiyu, female character in The Dream of Red Mansions')).toBe('Lin Daiyu');
    expect(personName('Li Bai (701-762), famous Tang Dynasty poet')).toBe('Li Bai');
  });
  it('uses real word boundaries, not accidental dictionary substrings across words', async () => {
    const dict = await loadTestDictionary();
    const terms = translationTerms('两株大松树下围着一堆村民，男男女女，聚精会神。说话的人五十来岁，敲着小羯鼓。', undefined, dict);
    expect(terms.some(term => term.word === '羯鼓')).toBe(true);
    expect(terms.some(term => ['树下', '下围', '男男', '来岁'].includes(term.word))).toBe(false);
  });
  it('can stop a pending request and ignores its late answer', async () => {
    let signal: AbortSignal | undefined;
    let finish!: (answer: string) => void;
    calls.chrome.mockImplementation((_request, options) => {
      signal = options.signal;
      return new Promise<string>(resolve => { finish = resolve; });
    });
    mount();
    await vi.waitFor(() => expect(calls.chrome).toHaveBeenCalledOnce());
    expect(button('Try another provider')).toBeTruthy();
    document.querySelector<HTMLButtonElement>('[aria-label="Stop translation"]')!.click();
    expect(signal?.aborted).toBe(true);
    expect(button('Try again')).toBeTruthy();
    finish('Late answer');
    await Promise.resolve();
    expect(panel.el.textContent).not.toContain('Late answer');
    expect(panel.el.textContent).toContain('Stopped.');
  });

  it('offers a local explanation for a browser translation, restores the original, and copies it', async () => {
    const copy = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText: copy } });
    mount();
    await vi.waitFor(() => expect(button('Explain')).toBeTruthy());
    expect(panel.el.textContent).toContain('Machine translation');
    button('Explain')!.click();
    await vi.waitFor(() => expect(panel.el.textContent).toContain('回家 means'));
    expect(calls.local.mock.calls[0][0].mode).toBe('explain');
    button('Plain translation')!.click();
    expect(panel.el.querySelector('.pp-tr-text')?.textContent).toBe('We are going home.');
    expect(panel.el.querySelector('.pp-tr-provider')?.textContent).toBe('Chrome on-device');
    expect(panel.el.textContent).toContain('Machine translation');
    expect(calls.chrome).toHaveBeenCalledOnce();
    button('Copy translation')!.click();
    await vi.waitFor(() => expect(copy).toHaveBeenCalledWith('We are going home.'));
  });

  it('can return to the original translation while an explanation is still generating', async () => {
    let signal: AbortSignal | undefined;
    let finish!: (answer: string) => void;
    calls.local.mockImplementation((_request, options) => {
      signal = options.signal;
      return new Promise<string>(resolve => { finish = resolve; });
    });
    mount();
    await vi.waitFor(() => expect(button('Explain')).toBeTruthy());
    button('Explain')!.click();
    await vi.waitFor(() => expect(calls.local).toHaveBeenCalledOnce());
    button('Plain translation')!.click();
    expect(signal?.aborted).toBe(true);
    finish('Late explanation');
    await Promise.resolve();
    expect(panel.el.querySelector('.pp-tr-text')?.textContent).toBe('We are going home.');
  });
});
