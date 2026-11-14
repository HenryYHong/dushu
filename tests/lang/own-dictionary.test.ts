// Meanings in the book's own language (src/lang/ownDictionary.ts): who gets them, how an entry's meanings are swapped while the
// main dictionary still reads the word, the simpler-word hints, English levels by how common a word is, the credit, and rare
// English words.
import { afterEach, describe, expect, it } from 'vitest';
import type { LangEngine, WordEntry, WordLookup } from '../../src/lang/types';
import {
  OWN_SOURCE, glossCode, japaneseOwn, loadOwnDictionary, ownDictionary, ownMeanings, ownRareLookup, parseOwnTable, readsOwnLanguage, resetOwnDictionary,
  setReaderLanguage, withOwnDictionary,
} from '../../src/lang/ownDictionary';
import { LANGS } from '../../src/lang/registry';

afterEach(() => resetOwnDictionary());

const SPANISH = [
  '# LinguPengu Spanish dictionary in Spanish.',
  '# key\tpos\thint\tsenses...',
  'casa\tnoun\t\t{Vivienda}Edificación destinada a vivienda.\tDomicilio.',
  'melancólico\tadjective\ttriste\tQue está afectado de melancolía.',
  'sin embargo\tphrase\t\tPero, no obstante.',
].join('\n');

function fakeEngine(id: LangEngine['id'], entries: Record<string, WordEntry[]>, opts: { phrase?: string } = {}): LangEngine {
  return {
    id,
    segment: () => [],
    lookup: (surface): WordLookup => ({ surface, key: surface, entries: entries[surface] ?? [], ...(opts.phrase ? { phrase: opts.phrase } : {}) }),
    normalize: (w) => w.toLowerCase(),
    level: () => 1,
    levelWords: () => ['exam'],
    rankLevel: (k) => (k === 'ominous' ? 5 : 2),
    rankLevelWords: () => ['common'],
    hint: () => 'english hint',
    meta: { built: '', counts: {}, sources: [{ name: 'Main', license: 'x', url: 'y' }], ownSources: [{ name: 'Own', license: 'x', url: 'y' }] },
  };
}
const entry = (head: string, pos: string, gloss: string): WordEntry => ({ head, senses: [{ pos, glosses: [gloss] }], source: 'main' });

describe('who gets meanings in the book’s own language', () => {
  it('a reader of their own language, and English books for anyone but a Chinese reader', () => {
    setReaderLanguage('es');
    expect([ownDictionary('es'), readsOwnLanguage('es'), glossCode('es')]).toEqual([true, true, 'es']);
    expect([ownDictionary('fr'), glossCode('fr')]).toEqual([false, 'en']);
    expect([ownDictionary('en'), readsOwnLanguage('en'), glossCode('en')]).toEqual([true, false, 'en']);
    setReaderLanguage('zh-Hant');
    expect([ownDictionary('en'), glossCode('en')]).toEqual([false, 'zh']);
    setReaderLanguage('en');
    expect([readsOwnLanguage('en'), glossCode('es')]).toEqual([true, 'en']);
    // Japanese and Chinese readers too.
    setReaderLanguage('ja');
    expect([ownDictionary('ja'), readsOwnLanguage('ja')]).toEqual([true, true]);
    setReaderLanguage('zh-Hant');
    expect([ownDictionary('zh'), glossCode('zh')]).toEqual([true, 'zh']);
  });

  it('English levels: the Chinese exam lists for a Chinese reader, how common a word is for anyone else', () => {
    setReaderLanguage('zh');
    expect(LANGS.en.levels.labels[0]).toBe('中考');
    setReaderLanguage('fr');
    expect(LANGS.en.levels.labels).toEqual(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
  });
});

describe('the table', () => {
  it('reads labels, several parts of speech, and phrases', () => {
    const t = parseOwnTable(SPANISH);
    expect(t.get('casa')).toEqual([{ pos: 'noun', hint: '', senses: [
      { pos: 'noun', glosses: ['Edificación destinada a vivienda.'], notes: ['Vivienda'] },
      { pos: 'noun', glosses: ['Domicilio.'] }] }]);
    expect(t.get('sin embargo')![0].senses[0]).toEqual({ pos: '', glosses: ['Pero, no obstante.'] });
  });
});

describe('the wrapped engine', () => {
  const load = (id: LangEngine['id'], text: string) => loadOwnDictionary(id, 'https://x/data/es/', async () => text);

  it('gives a Spanish reader Spanish meanings, the word read as before, and the English reader the English', async () => {
    const engine = withOwnDictionary(fakeEngine('es', { casas: [entry('casa', 'noun', 'house')] }));
    setReaderLanguage('es');
    await load('es', SPANISH);
    const lu = engine.lookup('casas');
    expect(lu.key).toBe('casas');
    expect(lu.entries[0].senses.map((s) => s.glosses[0])).toEqual(['Edificación destinada a vivienda.', 'Domicilio.']);
    expect(lu.entries[0].source).toBe(OWN_SOURCE);
    setReaderLanguage('en');
    expect(engine.lookup('casas').entries[0].senses[0].glosses).toEqual(['house']);
  });

  it('keeps an entry the own dictionary has no part of speech for (Spanish), and a fixed phrase under its key', async () => {
    const engine = withOwnDictionary(fakeEngine('es', { casa: [entry('casa', 'verb', 'he marries')] }));
    setReaderLanguage('es');
    await load('es', SPANISH);
    expect(engine.lookup('casa').entries[0].senses[0].glosses).toEqual(['he marries']);
    const phrase = withOwnDictionary(fakeEngine('es', { sin: [entry('sin embargo', '', 'however'), entry('sin', 'preposition', 'without')] }, { phrase: 'sin embargo' }));
    expect(phrase.lookup('sin').entries[0].senses[0].glosses).toEqual(['Pero, no obstante.']);
  });

  it('hints with a simpler word in the own language, or none (never the other language’s)', async () => {
    const engine = withOwnDictionary(fakeEngine('es', {}));
    setReaderLanguage('es');
    await load('es', SPANISH);
    expect(engine.hint({ text: 'melancólicos', key: 'melancólico', kind: 'word', start: 0, end: 12 } as never)).toBe('triste');
    expect(engine.hint({ text: 'casa', key: 'casa', kind: 'word', start: 0, end: 4 } as never)).toBeUndefined();
    setReaderLanguage('en');
    expect(engine.hint({ text: 'casa', key: 'casa', kind: 'word', start: 0, end: 4 } as never)).toBe('english hint');
  });

  it('English: anyone but a Chinese reader gets simple English, levels by how common a word is, and the credit', async () => {
    const text = 'ominous\tadjective\tthreatening\tIf something is ominous, it gives an indication that something bad is about to happen.';
    const engine = withOwnDictionary(fakeEngine('en', { ominous: [entry('ominous', 'adjective', '不祥的')], omen: [entry('omen', 'verb', '预示')] }));
    setReaderLanguage('ko');
    await loadOwnDictionary('en', 'https://x/data/en/', async () => text);
    const lu = engine.lookup('ominous');
    expect(lu.entries[0].senses[0].glosses[0]).toMatch(/^If something is ominous/);
    expect(lu.entries[0].level).toBe(5);
    expect(engine.level('ominous')).toBe(5);
    expect(engine.levelWords(2)).toEqual(['common']);
    expect(engine.meta.sources.map((s) => s.name)).toEqual(['Main', 'Own']);
    setReaderLanguage('zh');
    expect(engine.lookup('ominous').entries[0].senses[0].glosses).toEqual(['不祥的']);
    expect(engine.level('ominous')).toBe(1);
    expect(engine.meta.sources.map((s) => s.name)).toEqual(['Main']);
  });
});

describe('Japanese and Chinese', () => {
  it('Japanese: found by any spelling (Wiktionary files 食べる under たべる), with no part of speech to match', async () => {
    const engine = withOwnDictionary(fakeEngine('ja', { 食べた: [{ head: '食べる', reading: 'たべる', senses: [{ pos: 'verb (ichidan)', glosses: ['to eat'] }], source: 'JMdict' }] }));
    setReaderLanguage('ja');
    await loadOwnDictionary('ja', 'https://x/data/ja/', async () => 'たべる\t\t\t何かを、口から嚙んで飲み込む。\t生計を立てる。');
    expect(engine.lookup('食べた').entries[0].senses.map((x) => x.glosses[0])).toEqual(['何かを、口から嚙んで飲み込む。', '生計を立てる。']);
  });

  it('Chinese: the meanings by the first spelling the table has, labels in brackets, and none for another reader', async () => {
    setReaderLanguage('zh');
    await loadOwnDictionary('zh', 'https://x/data/', async () => '了\t\t\t結束，了結\t助詞，用在動詞後，表示完成。\t{用於否定句}完全');
    expect(ownMeanings('zh', ['了', '了'])).toEqual(['結束，了結', '助詞，用在動詞後，表示完成。', '（用於否定句）完全']);
    expect(ownMeanings('zh', ['學習', '学习'])).toBeNull();
    setReaderLanguage('en');
    expect(ownMeanings('zh', ['了'])).toBeNull();
  });
});

describe('English rare words', () => {
  it('are found by their form, in the shard of their first letters', async () => {
    const asked: string[] = [];
    const hit = await ownRareLookup('https://x/data/en/', ['cavillers', 'caviller'], (k) => k.slice(0, 2), async (url) => {
      asked.push(url);
      return 'caviller\tnoun\t\tSomeone who raises trivial objections.';
    });
    expect(hit?.key).toBe('caviller');
    expect(hit?.entries[0].senses[0].glosses).toEqual(['Someone who raises trivial objections.']);
    expect(asked).toEqual(['https://x/data/en/native-rare/ca.tsv.gz']);
  });
});

describe('a Japanese word by its reading', () => {
  // いき: 息 and 粋 name their kanji; ころ names none. 行き (いき, "going") is neither 息 nor 粋.
  const table = parseOwnTable([
    'いき\t=息\t\t口や鼻で空気を吸ったり吐いたりすること。',
    'いき\t=粋\t\t身なりや振る舞いがあか抜けているさま。',
    'ころ\t\t\t鯨の皮を煎った食材。',
    '受け取る\t=受け取る,受取る\t\t手に取って収める。',
    'でる\t\t\t中から外へ移動する。',
  ].join('\n'));
  const first = (l: ReturnType<typeof japaneseOwn>) => l?.[0]?.senses[0]?.glosses[0];

  it('reads the kanji a kana line names, and no part of speech', () => {
    const [e] = table.get('受け取る')!;
    expect(e.kanji).toEqual(['受け取る', '受取る']);
    expect(e.pos).toBe('');
  });
  it('a word in kanji takes, by its reading, only the entries naming its kanji', () => {
    expect(first(japaneseOwn(table, ['息'], 'いき'))).toMatch(/空気/);
    expect(first(japaneseOwn(table, ['粋'], 'いき'))).toMatch(/あか抜け/);
  });
  it('and none when every entry there names other kanji', () => {
    expect(japaneseOwn(table, ['行き'], 'いき')).toBeNull();
  });
  it('an entry naming no kanji may be the word', () => {
    expect(first(japaneseOwn(table, ['出る'], 'でる'))).toMatch(/外へ/);
  });
  it('under a kanji spelling, only the lines read as the word is', () => {
    const t = parseOwnTable(['息\t@そく\t\t息子。', '息\t@いき\t\t呼吸。', '上\t@うえ,かみ\t\t高い方。'].join('\n'));
    expect(first(japaneseOwn(t, ['息', 'いき'], 'いき'))).toBe('呼吸。');
    expect(first(japaneseOwn(t, ['息', 'ソク'], 'ソク'))).toBe('息子。');
    expect(first(japaneseOwn(t, ['上'], 'かみ'))).toBe('高い方。');
    expect(japaneseOwn(t, ['息', 'いきみ'], 'いきみ')).toBeNull();
  });
  it('a line whose reading is not said comes after an entry naming the kanji, and before one naming none', () => {
    const t = parseOwnTable([
      '生\t@?\t\tわたし。小生。', '生\t@せい\t\tいのち。', 'なま\t=生\t\t火を通していないこと。',
      '雨\t@?\t\t空から降る水。', 'あめ\t\t\t甘いお菓子。',
    ].join('\n'));
    expect(first(japaneseOwn(t, ['生', 'なま'], 'なま'))).toBe('火を通していないこと。');
    expect(first(japaneseOwn(t, ['生', 'せい'], 'せい'))).toBe('いのち。');
    expect(first(japaneseOwn(t, ['雨', 'あめ'], 'あめ'))).toBe('空から降る水。');
  });
  it('its own spelling first, and a kana word by any entry', () => {
    expect(first(japaneseOwn(table, ['受取る'], 'うけとる'))).toBeUndefined();
    expect(first(japaneseOwn(table, ['受け取る'], 'うけとる'))).toMatch(/収める/);
    expect(japaneseOwn(table, ['いき'], 'いき')).toHaveLength(2);
  });
});
