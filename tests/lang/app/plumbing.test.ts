// @vitest-environment jsdom
// The app reading a language other than Chinese: which library and settings it uses, how text is cut, counted, drawn, saved,
// decoded, imported and translated. The engines themselves are tested in tests/lang/ja and tests/lang/spaced.
import { afterEach, describe, expect, it } from 'vitest';
import { isChinese, langKey, setLangForTests, storeName } from '../../../src/lang/active';
import { segment } from '../../../src/core/segment';
import { countHan, unitScale } from '../../../src/import/han';
import { createSettingsStore, defaultsFor } from '../../../src/store/settings';
import { POS_SEL, renderTokens } from '../../../src/ui/reader/render';
import { langVocabItem, shortGlossOf } from '../../../src/lang/words';
import { itemFromLookupRow } from '../../../src/ui/popup/saveWord';
import { noChineseDictionary } from '../../../src/lang/noChinese';
import { decodeText } from '../../../src/import/encoding';
import { importText } from '../../../src/import';
import { guessLanguage, wrongLanguage } from '../../../src/lang/detect';
import { checkTranslation, translationSystem } from '../../../src/translate/prompt';
import { parseTranslateBody } from '../../../src/translate/claudeServer';
import { systemPromptFor } from '../../../src/translate/claudePrompts';
import { detectHeadingLine } from '../../../src/import/chapters';
import { fakeEngine } from './fakeEngine';
import type { Dictionary } from '../../../src/types';

afterEach(() => setLangForTests('zh'));

const memoryStorage = (): Storage => {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; }, clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); },
  };
};

describe('which library a language opens', () => {
  it('keeps Chinese on its old names and gives every other language its own', () => {
    setLangForTests('zh');
    expect([isChinese(), storeName(), langKey('dushu.settings.v1')]).toEqual([true, 'dushu', 'dushu.settings.v1']);
    setLangForTests('ja', fakeEngine('ja'));
    expect([isChinese(), storeName(), langKey('dushu.settings.v1')]).toEqual([false, 'dushu-ja', 'dushu.ja.settings.v1']);
  });

  it('keeps a language’s settings apart from Chinese, with its own defaults', () => {
    const storage = memoryStorage();
    const zh = createSettingsStore(storage, 'zh');
    const es = createSettingsStore(storage, 'es');
    es.set({ pinyin: 'all', fontSize: 30 });
    expect(zh.get().pinyin).toBe('unknown');
    expect(storage.getItem('dushu.es.settings.v1')).toContain('"fontSize":30');
    expect(JSON.parse(storage.getItem('dushu.settings.v1') ?? 'null')).toBeNull();
    // Hints start off for a language with spaces; Japanese starts with furigana on words not known, like pinyin.
    expect(defaultsFor('es').pinyin).toBe('off');
    expect(defaultsFor('ja').pinyin).toBe('unknown');
    expect(createSettingsStore(memoryStorage(), 'de').get().script).toBe('original');
  });
});

describe('cutting and counting text', () => {
  it('cuts with the language’s engine once one is open, and with the Chinese segmenter otherwise', () => {
    setLangForTests('es', fakeEngine('es'));
    const dict = noChineseDictionary(fakeEngine('es'));
    const toks = segment('Fuimos a la casa.', dict);
    expect(toks.map((t) => t.text).join('')).toBe('Fuimos a la casa.');
    expect(toks.filter((t) => t.kind === 'word').map((t) => t.key)).toEqual(['ir', 'a', 'la', 'casa']);
  });

  it('counts letters of the language for a book’s length and places, scaled against Han characters', () => {
    setLangForTests('zh');
    expect(countHan('我们abc')).toBe(2);
    setLangForTests('es', fakeEngine('es'));
    expect(countHan('Canción, ¡sí!')).toBe(9);
    expect(unitScale()).toBeGreaterThan(3);
    setLangForTests('ru', fakeEngine('ru'));
    expect(countHan('дом и house')).toBe(4);
    setLangForTests('ja', fakeEngine('ja'));
    expect(countHan('吾輩は猫である。ABC')).toBe(7);
  });
});

describe('drawing words of another language', () => {
  it('hangs a hint over a word, marks the stressed vowel, and gives every word an offset for pages and marks', () => {
    setLangForTests('ru', fakeEngine('ru'));
    const eng = fakeEngine('ru');
    const tokens = eng.segment('Он дома.');
    const { nodes, views } = renderTokens(tokens, tokens, { style: 'marks', toneColors: false, sandhi: false, aid: 'hint', hint: () => 'at home', stress: true, words: true });
    const p = document.createElement('p');
    p.append(nodes);
    expect(p.textContent?.replace(/at home/g, '')).toBe('Он дома.');
    expect(p.querySelector('.rd-stress')?.textContent).toBe('а');
    expect([...p.querySelectorAll(POS_SEL)].map((e) => (e as HTMLElement).dataset.o)).toEqual(['0', '3']);
    expect(views[1].chars[0].syllable).toBe('at home');
    expect(p.querySelector('rt')?.textContent).toBe('at home');
  });

  it('puts furigana over the kanji of a Japanese word only, kana marked one by one', () => {
    setLangForTests('ja', fakeEngine('ja'));
    const tokens = fakeEngine('ja').segment('食べた');
    const { nodes } = renderTokens(tokens, tokens, { style: 'marks', toneColors: false, sandhi: false, aid: 'furigana' });
    const p = document.createElement('p');
    p.append(nodes);
    expect(p.querySelectorAll('ruby').length).toBe(1);
    expect(p.querySelector('ruby rt')?.textContent).toBe('た');
    expect([...p.querySelectorAll(POS_SEL)].map((e) => (e as HTMLElement).dataset.o)).toEqual(['0', '1', '2']);
  });
});

describe('saving a word of another language', () => {
  it('saves the dictionary form with a short meaning, under the key every form shares', () => {
    setLangForTests('es', fakeEngine('es'));
    const eng = fakeEngine('es');
    const lu = eng.lookup('fuimos');
    const item = langVocabItem(lu, { context: { sentence: 'Fuimos a la casa.', bookId: 'b', bookTitle: 'T' }, now: 1 });
    expect([item.id, item.simp, item.gloss, item.context?.sentence]).toEqual(['ir', 'ir', 'to go', 'Fuimos a la casa.']);
    expect(shortGlossOf([{ head: 'x', senses: [{ glosses: ['a very long meaning (with a long explanation in parentheses that goes on)', 'b'] }], source: 't' }], 40)).toBe('a very long meaning');
  });

  it('makes a card from a looked-up word with the key it was logged under', () => {
    setLangForTests('es', fakeEngine('es'));
    const item = itemFromLookupRow({} as Dictionary, { id: 'ir', word: 'fue', pinyin: '', gloss: 'to go', context: { sentence: 'Fue a casa.' } }, 5);
    expect([item.id, item.simp, item.addedAt]).toEqual(['ir', 'ir', 5]);
  });
});

describe('reading files in another language', () => {
  it('decodes the legacy encodings of the language being read', () => {
    setLangForTests('ja', fakeEngine('ja'));
    // こんにちは in Shift_JIS
    expect(decodeText(new Uint8Array([0x82, 0xb1, 0x82, 0xf1, 0x82, 0xc9, 0x82, 0xbf, 0x82, 0xcd])).text).toBe('こんにちは');
    setLangForTests('ru', fakeEngine('ru'));
    // привет in Windows-1251
    expect(decodeText(new Uint8Array([0xef, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2])).text).toBe('привет');
    setLangForTests('es', fakeEngine('es'));
    // canción in Windows-1252
    expect(decodeText(new Uint8Array([0x63, 0x61, 0x6e, 0x63, 0x69, 0xf3, 0x6e])).text).toBe('canción');
  });

  it('finds chapters by the language’s own headings and joins wrapped lines with a space', () => {
    setLangForTests('es', fakeEngine('es'));
    expect(detectHeadingLine('CAPÍTULO III')).toEqual({ level: 2 });
    expect(detectHeadingLine('Capítulo primero')).toEqual({ level: 2 });
    expect(detectHeadingLine('XIV.')).toEqual({ level: 2 });
    expect(detectHeadingLine('PARTE SEGUNDA')).toEqual({ level: 1 });
    const para = 'En un lugar de la Mancha, de cuyo nombre no quiero acordarme, no ha mucho tiempo que vivía un hidalgo de los de lanza en astillero, adarga antigua, rocín flaco y galgo corredor. Una olla de algo más vaca que carnero, salpicón las más noches, duelos y quebrantos los sábados, lantejas los viernes.';
    // Wrapped at a space before column 62, as plain-text editions are.
    const wrap = (t: string) => {
      const out: string[] = [];
      let line = '';
      for (const w of t.split(' ')) {
        if (line && (line + ' ' + w).length > 62) { out.push(line); line = w; } else line = line ? `${line} ${w}` : w;
      }
      return [...out, line];
    };
    const lines: string[] = [];
    for (let i = 0; i < 6; i++) lines.push(...wrap(para), '');
    const text = `CAPÍTULO I\n\n${lines.join('\n')}\nCAPÍTULO II\n\n${lines.join('\n')}`;
    const book = importText(text, 'Prueba', 'Anónimo');
    expect(book.chapters.map((c) => c.title)).toEqual(['CAPÍTULO I', 'CAPÍTULO II']);
    const first = book.chapters[0].blocks.find((b) => b.t === 'p') as { text: string };
    expect(first.text).toBe(para);
  });

  it('turns away a book in another language, saying where it belongs', () => {
    setLangForTests('es', fakeEngine('es'));
    const english = 'It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness, and he had to go with her to the house that was hers. '.repeat(6);
    expect(() => importText(english)).toThrow(/English/);
    expect(guessLanguage('Il était une fois une petite fille de village, la plus jolie qu’on eût su voir ; sa mère en était folle, et sa mère-grand plus folle encore. Cette bonne femme lui fit faire un petit chaperon rouge, qui lui seyait si bien que partout on l’appelait le Petit Chaperon rouge. Un jour sa mère, ayant cuit et fait des galettes, lui dit : Va voir comment se porte ta mère-grand, car on m’a dit qu’elle était malade.')).toBe('fr');
    // The Chinese library takes what it always took.
    setLangForTests('zh');
    expect(importText('吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。何でも薄暗いじめじめした所でニャーニャー泣いていた事だけは記憶している。').chapters.length).toBe(1);
    expect(wrongLanguage('吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。何でも薄暗いじめじめした所でニャーニャー泣いていた事だけは記憶している。', 'es')).toMatch(/Japanese/);
  });
});

describe('translating another language', () => {
  it('names the language in the instructions and runs only the checks that hold for any language', () => {
    const system = translationSystem('translate', 'claude', {}, 'es');
    expect(system).toMatch(/Spanish books/);
    expect(system).not.toMatch(/Chinese/);
    expect(systemPromptFor({ mode: 'explain', lang: 'ja' })).toMatch(/kana/);
    expect(checkTranslation({ text: '不思議な話だ。', lang: 'ja' }, 'A strange story.')).toEqual([]);
    expect(checkTranslation({ text: '不思議な話だ。', lang: 'ja' }, 'A 不思議 story.').map((i) => i.code)).toEqual(['chinese']);
    // Chinese keeps its own checks.
    expect(checkTranslation({ text: '他没有来。' }, 'He came.').map((i) => i.code)).toContain('negation');
  });

  it('takes the language from a request and ignores anything else', () => {
    const ok = parseTranslateBody({ text: 'Hola', mode: 'translate', lang: 'es' });
    expect(ok.ok && ok.request.lang).toBe('es');
    const zh = parseTranslateBody({ text: '你好', mode: 'translate', lang: 'zh' });
    expect(zh.ok && zh.request.lang).toBeUndefined();
    const odd = parseTranslateBody({ text: 'x', mode: 'translate', lang: 'klingon' });
    expect(odd.ok && odd.request.lang).toBeUndefined();
  });
});

describe('the classics, kept as Markdown', () => {
  it('cut a chapter at every ## and only there, the # title being the book’s', () => {
    setLangForTests('es');
    const story = (n: number) => `Había una vez un hombre que vivía en Buenos Aires con su perro número ${n}. `.repeat(20);
    const md = `# Cuentos de la selva\n\n## La tortuga gigante\n\n${story(1)}\n\n## Las medias de los flamencos\n\nI\n\n${story(2)}\n\nII\n\n${story(3)}\n`;
    const book = importText(md, undefined, undefined, true);
    expect(book.title).toBe('Cuentos de la selva');
    expect(book.chapters.map((c) => c.title)).toEqual(['La tortuga gigante', 'Las medias de los flamencos']);
    // The book's title is not a block of the first chapter: the reader would show it between two chapter titles.
    expect(book.chapters[0].blocks[0]).toMatchObject({ t: 'h', text: 'La tortuga gigante' });
    expect(book.chapters.flatMap((c) => c.blocks).some((b) => b.t === 'h' && b.text === 'Cuentos de la selva')).toBe(false);
  });

  it('keep a book without ## as one chapter named after it', () => {
    setLangForTests('fr');
    const book = importText(`# La Parure\n\n${'C’était une de ces jolies et charmantes filles. '.repeat(30)}\n`, undefined, undefined, true);
    expect(book.chapters).toHaveLength(1);
    expect(book.chapters[0].title).toBe('La Parure');
    expect(book.chapters[0].blocks.every((b) => b.t === 'p')).toBe(true);
  });

  it('split a very long paragraph at full stops, each piece starting at a word', () => {
    setLangForTests('ru');
    const long = 'В департаменте служил один чиновник, нельзя сказать, чтобы очень замечательный. '.repeat(80);
    const book = importText(`# Шинель\n\n${long}\n`, undefined, undefined, true);
    const ps = book.chapters[0].blocks.filter((b) => b.t === 'p') as { text: string }[];
    expect(ps.length).toBeGreaterThan(1);
    for (const p of ps) { expect(p.text).toBe(p.text.trim()); expect(p.text).toMatch(/\.$/); }
  });
});

describe('chapter headings in other languages', () => {
  it('know a chapter numbered in words as well as in figures', () => {
    const cases: [string, string[]][] = [
      ['es', ['Capítulo uno', 'Capítulo veintiuno', 'Capítulo séptimo', 'CAPÍTULO 3']],
      ['fr', ['Chapitre deux', 'Chapitre onzième', 'Chapitre un']],
      ['de', ['Kapitel drei', 'Kapitel dreizehn', 'Zweites Kapitel']],
      ['it', ['Capitolo due', 'Capitolo diciassette', 'Capitolo ventuno']],
      ['pt', ['Capítulo dois', 'Capítulo três']],
      ['ru', ['Глава один', 'Глава пятнадцать', 'Глава седьмая']],
    ];
    for (const [id, lines] of cases) {
      setLangForTests(id as Parameters<typeof setLangForTests>[0]);
      for (const line of lines) expect(detectHeadingLine(line), `${id}: ${line}`).toEqual({ level: 2 });
    }
    setLangForTests('es');
    expect(detectHeadingLine('Capítulo unos días después llegó')).toBeNull();
    expect(detectHeadingLine('Aquella mañana Lucía salió de casa.')).toBeNull();
  });
});

describe('another language leaves Chinese data alone', () => {
  // How its books and records go through the account is in tests/cloud/books-languages.test.ts and tests/core/sync-languages.test.ts.
  it('with its sync off, neither uploads its books to the account nor takes the account’s in, and deleting a book leaves the account alone', async () => {
    const { syncBooks, forgetBookInAccount } = await import('../../../src/core/cloudBooks');
    const fetched: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => { fetched.push(String(url)); return new Response('{"lang":"ja","books":[]}'); }) as typeof fetch;
    localStorage.setItem('dushu.cloud.url.v1', 'http://localhost:8787');
    localStorage.setItem('dushu.cloud.v1', JSON.stringify({ token: 't', email: 'reader@example.com' }));
    localStorage.setItem('dushu.ja.sync.off.v1', '1');
    try {
      setLangForTests('ja');
      const store = { books: { list: async () => [{ id: 'b1', title: '吾輩は猫である', author: '夏目漱石', charCount: 9 }] } } as never;
      expect(await syncBooks(store)).toEqual({ added: [], uploaded: 0 });
      forgetBookInAccount({ id: 'b1', title: '吾輩は猫である', author: '夏目漱石', charCount: 9 } as never);
      expect(fetched).toEqual([]);
      expect(localStorage.getItem('dushu.ja.cloud.books-removed.v1')).toBeNull();
      expect(localStorage.getItem('dushu.cloud.books-removed.v1')).toBeNull();
    } finally {
      globalThis.fetch = realFetch;
      localStorage.clear();
    }
  });

  it('deletes only its own library and settings with "Delete all data", and Chinese deletes leave the others', async () => {
    const { eraseAllData } = await import('../../../src/ui/settings/data');
    const keep = { 'dushu.settings.v1': '{}', 'dushu.cloud.v1': '{"token":"t"}', 'dushu.mac-bridge.v1': 'x', 'dushu.lang.v1': 'ja', 'dushu.es.settings.v1': '{}' };
    for (const [k, v] of Object.entries({ ...keep, 'dushu.ja.settings.v1': '{}', 'dushu.ja.lookups.v1': '[]' })) localStorage.setItem(k, v);
    let wiped = 0;
    const ctx = { store: { wipe: async () => { wiped++; } } } as never;
    setLangForTests('ja');
    await eraseAllData(ctx);
    expect(wiped).toBe(1);
    // Its own sync is turned off, so the account's copy does not come straight back; Chinese sync is not.
    expect(Object.fromEntries(Object.keys(localStorage).sort().map((k) => [k, localStorage.getItem(k)]))).toEqual(
      Object.fromEntries(Object.entries({ ...keep, 'dushu.ja.sync.off.v1': '1' }).sort()));
    // Chinese "Delete all data" takes every Chinese key and turns its sync off, as before, but not another language's keys.
    setLangForTests('zh');
    await eraseAllData(ctx);
    expect(Object.keys(localStorage).sort()).toEqual(['dushu.es.settings.v1', 'dushu.ja.sync.off.v1', 'dushu.sync.off.v1']);
    localStorage.clear();
  });

  it('keeps the Chinese wording of translation notes and settings', async () => {
    const { unverifiedDetail } = await import('../../../src/translate/prompt');
    expect(unverifiedDetail([{ code: 'chinese', message: '' }])).toBe('Chinese was left untranslated');
    expect(unverifiedDetail([{ code: 'chinese', message: '' }], 'es')).toBe('some of the original was left untranslated');
    expect(parseTranslateBody({ text: ' ', mode: 'translate' })).toMatchObject({ ok: false, message: 'Select some Chinese text to translate.' });
    expect('stress' in defaultsFor('zh')).toBe(false);
    expect(defaultsFor('ru').stress).toBe(true);
  });
});

describe('Aozora ruby', () => {
  it('takes the publisher’s readings out of the text and keeps them by offset', async () => {
    const { parseAozoraRuby, sliceRuby, takeAozoraRuby } = await import('../../../src/import/aozora');
    // 杜子春 (Akutagawa): a run of kanji before 《》; ｜ where the base is not a plain run of kanji; a reading after kana dropped.
    const r = parseAozoraRuby('或春の日暮です。唐の都洛陽《らくよう》の西の門の下に、杜子春《とししゅん》という若者が｜一人《ひとり》いました。');
    expect(r.text).toBe('或春の日暮です。唐の都洛陽の西の門の下に、杜子春という若者が一人いました。');
    const at = (w: string) => r.ruby.find((s) => r.text.slice(s.start, s.end) === w)?.rt;
    expect(at('都洛陽')).toBe('らくよう');
    expect(at('杜子春')).toBe('とししゅん');
    expect(at('一人')).toBe('ひとり');
    expect(r.ruby).toHaveLength(3);
    // Two readings in a row over kanji: each covers its own word (夏目漱石, こころ).
    const two = parseAozoraRuby('比較的《ひかくてき》呑気《のんき》な人');
    expect(two.ruby.map((s) => [two.text.slice(s.start, s.end), s.rt])).toEqual([['比較的', 'ひかくてき'], ['呑気', 'のんき']]);
    // A kanji outside the BMP stays whole.
    const big = parseAozoraRuby('𠮟《しか》る');
    expect(big).toEqual({ text: '𠮟る', ruby: [{ start: 0, end: 2, rt: 'しか' }] });
    // Titles in 《》 are not readings: nothing under it, or kanji in it.
    expect(parseAozoraRuby('《》と《書名》、新聞《朝日新聞》')).toEqual({ text: '《》と《書名》、新聞《朝日新聞》', ruby: [] });
    expect(sliceRuby(r.ruby, 10, 40)?.every((s) => s.start >= 0 && s.end <= 30)).toBe(true);
    const [c] = takeAozoraRuby([{ title: '一', blocks: [{ t: 'p', text: '清《きよ》が泣いた。' }, { t: 'hr' }] }]);
    expect(c.blocks[0]).toEqual({ t: 'p', text: '清が泣いた。', ruby: [{ start: 0, end: 1, rt: 'きよ' }] });
    // 杜子春 is read once, mid-story: the first page's 杜子春 gets the reading too. A single kanji (清) or a run the book reads
    // two ways (上手) is left to the engine.
    const book = takeAozoraRuby([{ title: '一', blocks: [
      { t: 'p', text: '杜子春という若者がいました。上手な清' },
      { t: 'p', text: '杜子春《とししゅん》は驚いて、上手《じょうず》に話した。清《きよ》' },
      { t: 'p', text: '上手《うわて》に出た。' },
    ] }]);
    expect(book[0].blocks[0]).toEqual({ t: 'p', text: '杜子春という若者がいました。上手な清', ruby: [{ start: 0, end: 3, rt: 'とししゅん', inferred: true }] });
  });

  it('comes out of a Japanese import and is passed to the engine with the paragraph', async () => {
    setLangForTests('ja');
    const book = importText('# 坊っちゃん\n\n## 一\n\n十年来召し使っている清《きよ》という下女が、泣きながらおやじに詫《あやま》った。\n', undefined, undefined, true);
    const p = book.chapters[0].blocks.find((b) => b.t === 'p') as { text: string; ruby?: { start: number; end: number; rt: string }[] };
    expect(p.text).toBe('十年来召し使っている清という下女が、泣きながらおやじに詫った。');
    expect(p.ruby?.map((s) => [p.text.slice(s.start, s.end), s.rt])).toEqual([['清', 'きよ'], ['詫', 'あやま']]);
    const seen: unknown[] = [];
    const engine = { ...fakeEngine('ja'), segment: (text: string, opts?: unknown) => { seen.push(opts); return [{ text, start: 0, end: text.length, kind: 'other' as const, inDict: false }]; } };
    setLangForTests('ja', engine);
    segment(p.text, noChineseDictionary(engine), undefined, p.ruby);
    expect(seen).toEqual([{ ruby: p.ruby }]);
  });
});

describe('the language translations go into', () => {
  const TARGET_KEY = 'dushu.translate-to.v1';

  it('follows the reader into every language’s library, the last choice made in any of them winning', () => {
    const storage = memoryStorage();
    const zh = createSettingsStore(storage, 'zh');
    expect(zh.get().translateTo).toBe('en');
    zh.set({ translateTo: 'fr' });
    // A library opened later starts from it, though each keeps its own settings.
    const es = createSettingsStore(storage, 'es');
    expect(es.get().translateTo).toBe('fr');
    es.set({ translateTo: 'de', fontSize: 30 });
    expect(createSettingsStore(storage, 'zh').get()).toMatchObject({ translateTo: 'de', fontSize: 22 });
    expect(createSettingsStore(storage, 'ja').get().translateTo).toBe('de');
    // A value that is not on the list leaves each library with its own last choice.
    storage.setItem(TARGET_KEY, 'klingon');
    expect(createSettingsStore(storage, 'zh').get().translateTo).toBe('fr');
    expect(createSettingsStore(storage, 'es').get().translateTo).toBe('de');
  });

  it('changes in a tab reading another language when this one changes it', () => {
    const es = createSettingsStore(localStorage, 'es');
    const seen: string[][] = [];
    es.subscribe((_s, changed) => seen.push(changed));
    localStorage.setItem(TARGET_KEY, 'it');
    window.dispatchEvent(new StorageEvent('storage', { key: TARGET_KEY, storageArea: localStorage }));
    expect(es.get().translateTo).toBe('it');
    expect(seen).toEqual([['translateTo']]);
    localStorage.clear();
  });

  it('offers every language but the book’s own, and says when a choice of it means English here', async () => {
    const { targetControl } = await import('../../../src/ui/settings/translation');
    setLangForTests('es', fakeEngine('es'));
    const settings = createSettingsStore(memoryStorage(), 'es');
    settings.set({ translateTo: 'es' });
    const control = targetControl(settings);
    control.update(settings.get());
    const select = control.el.querySelector('select') as HTMLSelectElement;
    const codes = [...select.options].map((o) => o.value);
    expect(codes).not.toContain('es');
    expect(codes[0]).toBe('en');
    expect(codes).toEqual(expect.arrayContaining(['fr', 'zh', 'zh-Hant', 'ar']));
    expect([...select.options].find((o) => o.value === 'fr')?.textContent).toBe('French · Français');
    // Spanish, chosen while reading Chinese: Spanish books go into English, and Settings says why.
    expect(select.value).toBe('en');
    const note = control.el.querySelector('.set-help') as HTMLElement;
    expect(note.hidden).toBe(false);
    expect(note.textContent).toBe('These books are in Spanish, so they are translated into English. Spanish is used for your other books.');
    select.value = 'fr';
    select.dispatchEvent(new Event('change'));
    control.update(settings.get());
    expect(settings.get().translateTo).toBe('fr');
    expect(note.hidden).toBe(true);
    // In the Chinese library both Chinese scripts are the book's own.
    setLangForTests('zh');
    const zh = targetControl(createSettingsStore(memoryStorage(), 'zh'));
    expect([...(zh.el.querySelector('select') as HTMLSelectElement).options].map((o) => o.value).filter((c) => c.startsWith('zh'))).toEqual([]);
  });
});

describe('Local only', () => {
  it('follows the reader into every library, the Chinese choice made before languages existed included', async () => {
    const { LOCAL_ONLY_KEY } = await import('../../../src/store/settings');
    const storage = memoryStorage();
    // A reader who turned Local only on in Chinese before this release: no shared key yet.
    storage.setItem('dushu.settings.v1', JSON.stringify({ localOnly: true }));
    expect(createSettingsStore(storage, 'es').get().localOnly).toBe(true);
    const zh = createSettingsStore(storage, 'zh');
    expect(zh.get().localOnly).toBe(true);
    expect(storage.getItem(LOCAL_ONLY_KEY)).toBe('1');
    // Turned off in Japanese: the last choice made in any library is the one every library starts from.
    createSettingsStore(storage, 'ja').set({ localOnly: false });
    expect(createSettingsStore(storage, 'zh').get().localOnly).toBe(false);
    expect(createSettingsStore(storage, 'fr').get().localOnly).toBe(false);
  });
});

describe('the classics of every language', () => {
  it('offer at least four books at each level, each with its cover', async () => {
    const { readFileSync, existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    for (const id of ['ja', 'es', 'fr', 'de', 'it', 'pt', 'ru']) {
      const dir = join(__dirname, '..', '..', '..', 'public', 'samples', id);
      const rows = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as { id: string; level: string; cover?: string; file: string }[];
      for (const level of ['Beginner', 'Intermediate', 'Advanced']) expect(rows.filter((r) => r.level === level).length, `${id} ${level}`).toBeGreaterThanOrEqual(4);
      for (const r of rows) {
        expect(existsSync(join(dir, r.file)), `${id}/${r.file}`).toBe(true);
        expect(r.cover && existsSync(join(dir, r.cover)), `${id}/${r.id} cover`).toBe(true);
      }
    }
  });
});
