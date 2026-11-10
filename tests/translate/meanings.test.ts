// A word card's meanings in the reader's language (src/translate/meanings.ts): which language they go into (none when the reader's
// is the dictionary's), the pair each translator is asked for (from the dictionary's language, not the book's), meanings kept
// apart in one request, the translator chosen by the setting, and the cache. Every translator is faked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  batches, cachedAny, dictionaryLanguage, keepMeanings, meaningOrder, meaningProvider, meaningsTarget, numbered, pickMeaningProvider,
  resetMeaningsCache, translateMeanings, unnumbered, MEANINGS_KEY, type MeaningProvider, type MeaningProviderId,
} from '../../src/translate/meanings';
import { createClaudeTranslator, resetClaudeStatus } from '../../src/translate/claude';
import { resetChromeTranslator } from '../../src/translate/chrome';
import { DEFAULT_SETTINGS } from '../../src/store/settings';
import { setLangForTests } from '../../src/lang/active';
import type { Settings } from '../../src/types';

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, clear: () => m.clear(), key: () => null, get length() { return m.size; } };
}

const settings = (over: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, translateTo: 'fr', ...over });
const g = globalThis as { Translator?: unknown };

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  resetMeaningsCache();
  resetClaudeStatus();
});
afterEach(() => {
  resetChromeTranslator();
  delete g.Translator;
  vi.unstubAllGlobals();
  setLangForTests(null);
});

describe('the language the meanings go into', () => {
  it('is the reader’s, unless it is the dictionary’s own', () => {
    expect(dictionaryLanguage('es')).toBe('en');
    expect(dictionaryLanguage('zh')).toBe('en');
    expect(dictionaryLanguage('ja')).toBe('en');
    expect(dictionaryLanguage('en')).toBe('zh');
    expect(meaningsTarget(settings({ translateTo: 'fr' }), 'es')).toBe('fr');
    expect(meaningsTarget(settings({ translateTo: 'ko' }), 'ja')).toBe('ko');
    expect(meaningsTarget(settings({ translateTo: 'fr' }), 'zh')).toBe('fr');
    // An English speaker reads the English the dictionaries have.
    expect(meaningsTarget(settings({ translateTo: 'en' }), 'es')).toBeNull();
    // A Spanish speaker's Spanish books translate into English, and so the meanings stay in English too.
    expect(meaningsTarget(settings({ translateTo: 'es' }), 'es')).toBeNull();
  });
  it('in the English library, whose dictionary is Chinese: none for a Chinese reader, Korean for a Korean one', () => {
    expect(meaningsTarget(settings({ translateTo: 'en' }), 'en')).toBeNull();
    expect(meaningsTarget(settings({ translateTo: 'zh' }), 'en')).toBeNull();
    expect(meaningsTarget(settings({ translateTo: 'zh-Hant' }), 'en')).toBeNull();
    expect(meaningsTarget(settings({ translateTo: 'ko' }), 'en')).toBe('ko');
  });
  it('is none when the setting says Never', () => {
    expect(meaningsTarget(settings({ translateMeanings: 'never' }), 'es')).toBeNull();
  });
});

describe('meanings kept apart', () => {
  it('numbers them in one request and splits the answer back, each sense whole', () => {
    const texts = ['to go; to leave', 'to be (located)', 'to suit; to fit'];
    expect(numbered(texts)).toBe('1. to go; to leave\n2. to be (located)\n3. to suit; to fit');
    expect(unnumbered('1. aller ; partir\n2. se trouver\n3. convenir ; aller bien', 3)).toEqual(['aller ; partir', 'se trouver', 'convenir ; aller bien']);
    // In whatever order and numbering the answer uses.
    expect(unnumbered('２．se trouver\n１．aller ; partir\n3) convenir', 3)).toEqual(['aller ; partir', 'se trouver', 'convenir']);
    expect(unnumbered('١. ذهب\n٢. كان', 2)).toEqual(['ذهب', 'كان']);
    // Numbers inside a meaning stay as written.
    expect(unnumbered('1. 100 ans', 1)).toEqual(['100 ans']);
  });
  it('refuses an answer that merged, dropped or repeated a sense', () => {
    expect(unnumbered('1. aller ; partir ; se trouver', 2)).toBeNull();
    expect(unnumbered('1. aller\n1. partir', 2)).toBeNull();
    expect(unnumbered('1. aller\n3. partir', 2)).toBeNull();
    expect(unnumbered('', 1)).toBeNull();
  });
  it('takes one line per meaning when the numbers were dropped, and a single meaning as the whole answer', () => {
    expect(unnumbered('aller\npartir', 2)).toEqual(['aller', 'partir']);
    expect(unnumbered('maison ; foyer', 1)).toEqual(['maison ; foyer']);
  });
  it('splits a long card into requests under the limit, never inside a meaning', () => {
    const texts = Array.from({ length: 30 }, (_, i) => `meaning number ${i} with some words`);
    const runs = batches(texts, 200);
    expect(runs.flat()).toEqual(texts);
    for (const run of runs) expect(numbered(run).length).toBeLessThanOrEqual(200);
    expect(batches(['x'.repeat(500)], 100)).toEqual([['x'.repeat(500)]]);
  });
});

describe('the translators', () => {
  function chrome(avail = 'available') {
    const inst = { translate: vi.fn(async (t: string) => `FR:${t}`) };
    const create = vi.fn(async (_opts: { sourceLanguage: string; targetLanguage: string }) => inst);
    g.Translator = { availability: vi.fn(async () => avail), create };
    return { inst, create };
  }

  it('Chrome is asked for the dictionary’s pair, English to French, whatever the book, one meaning per call', async () => {
    setLangForTests('zh');
    const { inst, create } = chrome();
    const p = meaningProvider('chrome', settings(), 'en', 'fr');
    expect(p.onDevice).toBe(true);
    expect(await p.translate(['bank; shore', 'to go'])).toEqual(['FR:bank; shore', 'FR:to go']);
    expect(create.mock.calls[0][0]).toMatchObject({ sourceLanguage: 'en', targetLanguage: 'fr' });
    expect(inst.translate.mock.calls.map((c) => c[0])).toEqual(['bank; shore', 'to go']);
  });

  it('Chrome in the English library goes from Chinese, the dictionary’s language', async () => {
    setLangForTests('en');
    const { create } = chrome();
    await meaningProvider('chrome', settings({ translateTo: 'ko' }), 'zh', 'ko').translate(['房子；家']);
    expect(create.mock.calls[0][0]).toMatchObject({ sourceLanguage: 'zh', targetLanguage: 'ko' });
  });

  it('MyMemory asks for the dictionary’s pair, each meaning on its own, and not with Local only', async () => {
    setLangForTests('es');
    const urls: string[] = [];
    const fetch = vi.fn(async (url: string) => {
      urls.push(url);
      const q = new URL(url).searchParams.get('q');
      return new Response(JSON.stringify({ responseData: { translatedText: `fr ${q}` }, responseStatus: 200 }));
    });
    vi.stubGlobal('fetch', fetch);
    const p = meaningProvider('mymemory', settings(), 'en', 'fr');
    expect(await p.translate(['house; home', 'dog'])).toEqual(['fr house; home', 'fr dog']);
    expect(urls).toHaveLength(2);
    expect(new URL(urls[0]).searchParams.get('langpair')).toBe('en|fr');
    await meaningProvider('mymemory', settings({ translateTo: 'zh' }), 'zh', 'ko').translate(['房子']);
    expect(new URL(urls[2]).searchParams.get('langpair')).toBe('zh-CN|ko');
    expect(await meaningProvider('mymemory', settings({ localOnly: true }), 'en', 'fr').availability()).toBe('no');
  });

  it('Claude names the dictionary’s language, not the book’s: English meanings of a Chinese word, into French', async () => {
    setLangForTests('zh');
    const fetch = vi.fn(async (_path: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ type: 'text', text: '1. banque\n2. rive' }) + '\n' + JSON.stringify({ type: 'done', stop: 'end_turn', to: 'fr' }) + '\n'));
    const t = createClaudeTranslator({ claudeModel: '', localOnly: false }, { fetch, hasBridge: () => true, source: 'en' });
    await t.translate({ text: numbered(['bank', 'shore']), mode: 'translate', to: 'fr' });
    const body = JSON.parse(String(fetch.mock.calls[0][1]?.body));
    expect(body).toMatchObject({ text: '1. bank\n2. shore', mode: 'translate', lang: 'en', to: 'fr' });
  });

  it('Claude and the account get one numbered request per card, and an answer that lost a sense is an error', async () => {
    const sent: { text: string; to?: string }[] = [];
    let reply = '1. maison ; foyer\n2. chien';
    vi.doMock('../../src/translate/claude', async (orig) => ({
      ...(await orig<typeof import('../../src/translate/claude')>()),
      createClaudeTranslator: () => ({ id: 'claude', label: 'Claude', availability: async () => 'yes',
        translate: async (req: { text: string; to?: string }) => { sent.push(req); return reply; } }),
    }));
    vi.resetModules();
    const m = await import('../../src/translate/meanings');
    const p = m.meaningProvider('claude', settings(), 'en', 'fr');
    expect(await p.translate(['house; home', 'dog'])).toEqual(['maison ; foyer', 'chien']);
    expect(sent).toEqual([{ text: '1. house; home\n2. dog', mode: 'translate', to: 'fr' }]);
    reply = '1. maison ; foyer ; chien';
    await expect(p.translate(['house; home', 'dog'])).rejects.toThrow(/apart/);
    vi.doUnmock('../../src/translate/claude');
    vi.resetModules();
  });
});

describe('which translator, by the setting', () => {
  type Avail = 'yes' | 'download' | 'no';
  const fake = (avail: Partial<Record<MeaningProviderId, Avail>>) => {
    const made: MeaningProviderId[] = [];
    const make = (id: MeaningProviderId): MeaningProvider => {
      made.push(id);
      return { id, label: id, onDevice: id === 'chrome', availability: async () => avail[id] ?? 'no', translate: async (t) => t };
    };
    return { make: make as unknown as typeof meaningProvider, made };
  };
  const pick = async (over: Partial<Settings>, avail: Partial<Record<MeaningProviderId, Avail>>) => {
    const f = fake(avail);
    const p = await pickMeaningProvider(settings(over), 'en', 'fr', f.make);
    return { id: p?.provider.id ?? null, auto: p?.auto ?? null, availability: p?.availability ?? null, made: f.made };
  };

  it('Automatic: Chrome on the device at once', async () => {
    expect(await pick({}, { chrome: 'yes', claude: 'yes' })).toMatchObject({ id: 'chrome', auto: true });
  });
  it('Automatic: an online translator only from the button, never by itself', async () => {
    expect(await pick({}, { account: 'yes', claude: 'yes' })).toMatchObject({ id: 'account', auto: false });
    expect(await pick({}, { claude: 'yes' })).toMatchObject({ id: 'claude', auto: false });
  });
  it('Automatic: Chrome’s model to download is offered on the button (a download needs a click)', async () => {
    expect(await pick({}, { chrome: 'download', claude: 'yes' })).toMatchObject({ id: 'chrome', auto: false, availability: 'download' });
  });
  it('Always: the first one ready runs at once, online too', async () => {
    expect(await pick({ translateMeanings: 'always' }, { claude: 'yes' })).toMatchObject({ id: 'claude', auto: true });
    expect(await pick({ translateMeanings: 'always' }, { chrome: 'download', account: 'yes' })).toMatchObject({ id: 'account', auto: true });
    expect(await pick({ translateMeanings: 'always' }, { chrome: 'download' })).toMatchObject({ id: 'chrome', auto: false });
  });
  it('When I ask: the button even for Chrome', async () => {
    expect(await pick({ translateMeanings: 'ask' }, { chrome: 'yes' })).toMatchObject({ id: 'chrome', auto: false });
  });
  it('Never: nothing, and no translator is even asked', async () => {
    expect(await pick({ translateMeanings: 'never' }, { chrome: 'yes' })).toEqual({ id: null, auto: null, availability: null, made: [] });
  });
  it('none at all when nothing can run here', async () => {
    expect((await pick({}, {})).id).toBeNull();
  });
  it('MyMemory only when the reader chose it for sentences; their chosen online one comes before the others', () => {
    expect(meaningOrder({ translator: 'auto' })).toEqual(['chrome', 'account', 'claude']);
    expect(meaningOrder({ translator: 'mymemory' })).toEqual(['chrome', 'mymemory', 'account', 'claude']);
    expect(meaningOrder({ translator: 'claude' })).toEqual(['chrome', 'claude', 'account']);
  });
});

describe('the cache', () => {
  const provider = (id: MeaningProviderId = 'chrome') => {
    const translate = vi.fn(async (texts: string[]) => texts.map((t) => `fr:${t}`));
    return { p: { id, label: id, onDevice: true, availability: async () => 'yes' as const, translate } satisfies MeaningProvider, translate };
  };

  it('a meaning translated before costs nothing, and the same text twice is sent once', async () => {
    const { p, translate } = provider();
    expect(await translateMeanings(p, ['house', 'dog', 'house'], 'en', 'fr')).toEqual(['fr:house', 'fr:dog', 'fr:house']);
    expect(translate).toHaveBeenCalledTimes(1);
    expect(translate.mock.calls[0][0]).toEqual(['house', 'dog']);
    expect(await translateMeanings(p, ['dog', 'cat'], 'en', 'fr')).toEqual(['fr:dog', 'fr:cat']);
    expect(translate.mock.calls[1][0]).toEqual(['cat']);
    expect(await translateMeanings(p, ['house', 'cat'], 'en', 'fr')).toEqual(['fr:house', 'fr:cat']);
    expect(translate).toHaveBeenCalledTimes(2);
  });

  it('is kept by translator and by language: German is asked again, and so is another translator', async () => {
    const { p, translate } = provider();
    await translateMeanings(p, ['house'], 'en', 'fr');
    await translateMeanings(p, ['house'], 'en', 'de');
    expect(translate).toHaveBeenCalledTimes(2);
    const other = provider('claude');
    await translateMeanings(other.p, ['house'], 'en', 'fr');
    expect(other.translate).toHaveBeenCalledTimes(1);
  });

  it('survives a reload, and any translator’s answer can be shown again for free', async () => {
    const { p } = provider('claude');
    await translateMeanings(p, ['house'], 'en', 'fr');
    expect(localStorage.getItem(MEANINGS_KEY)).toContain('fr:house');
    resetMeaningsCache();
    const hits = cachedAny(['house', 'dog'], 'en', 'fr', ['chrome']);
    expect(hits.get('house')).toEqual({ text: 'fr:house', id: 'claude' });
    expect(hits.has('dog')).toBe(false);
  });

  it('stays small: the oldest meanings go first', () => {
    for (let i = 0; i < 2100; i++) keepMeanings('chrome', 'en', 'fr', [[`word ${i}`, `mot ${i}`]]);
    const kept = JSON.parse(localStorage.getItem(MEANINGS_KEY)!) as [string, string][];
    expect(kept.length).toBeLessThanOrEqual(2000);
    expect(kept.some(([k]) => k.endsWith('|word 0'))).toBe(false);
    expect(kept.some(([k]) => k.endsWith('|word 2099'))).toBe(true);
    expect(JSON.stringify(kept).length).toBeLessThan(400_000);
  });

  it('works with storage blocked, for this visit', async () => {
    vi.stubGlobal('localStorage', { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } });
    resetMeaningsCache();
    const { p, translate } = provider();
    await translateMeanings(p, ['house'], 'en', 'fr');
    await translateMeanings(p, ['house'], 'en', 'fr');
    expect(translate).toHaveBeenCalledTimes(1);
  });
});
