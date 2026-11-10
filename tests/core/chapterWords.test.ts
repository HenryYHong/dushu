import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Dictionary } from '../../src/types';
import { chapterWords, sentenceAround, wordShare } from '../../src/core/chapterWords';
import { sentenceAround as cardSentence } from '../../src/core/text';
import { buildLexicon } from '../../src/core/lexicon';
import { setLangForTests } from '../../src/lang/active';
import { noChineseDictionary } from '../../src/lang/noChinese';
import { loadLang } from '../lang/spaced/load';
import { loadTestDictionary } from '../helpers/data';
import { measure, PERF_SLACK } from '../helpers/perf';

let dict: Dictionary;
beforeAll(async () => { dict = await loadTestDictionary(); });

describe('chapterWords', () => {
  it('counts each word once per occurrence, keeps its first sentence, and leaves the book\'s names out', async () => {
    const lex = buildLexicon([{ word: '莫远峰', pinyin: 'mo4 yuan3 feng1', gloss: 'Mo Yuanfeng', kind: 'name', enabled: true, origin: 'auto' }]);
    const got = await chapterWords([
      '莫远峰在银行门口等朋友。朋友来了。',
      '他们一起去银行。莫远峰笑了。',
    ], dict, lex);
    const bank = got.words.find((w) => w.key === '银行')!;
    expect(bank.count).toBe(2);
    expect(bank.sentence).toBe('莫远峰在银行门口等朋友。');
    expect(bank.pinyin).toEqual(['yin2', 'hang2']);
    expect(got.words.some((w) => w.word === '莫远峰')).toBe(false);
    expect(got.names).toBe(2);
    expect(got.total).toBe(got.words.reduce((n, w) => n + w.count, 0));
    // First occurrence order: 在 comes before 银行.
    expect(got.words.find((w) => w.key === '在')!.first).toBeLessThan(bank.first);
  });

  it('counts both scripts as one word, under the simplified form, shown as the chapter spells it', async () => {
    const got = await chapterWords(['我們去銀行。', '銀行很大。'], dict);
    const bank = got.words.find((w) => w.key === '银行')!;
    expect(bank.count).toBe(2);
    expect(bank.word).toBe('銀行');
  });

  it('keeps the most common reading of a polyphone in the chapter', async () => {
    const got = await chapterWords(['我吃了饭。他走了。她来了。'], dict);
    expect(got.words.find((w) => w.key === '了')!.pinyin).toEqual(['le5']);
  });

  it('stops early when cancelled, between slices', async () => {
    const para = '他每天早上起来先去河边走一走，然后回家吃早饭。'.repeat(100);
    let calls = 0;
    const got = await chapterWords([para, para, para, para], dict, undefined, { pause: async () => { calls++; }, cancelled: () => true });
    expect(calls).toBe(1);
    expect(got.total).toBeGreaterThan(0);
    const all = await chapterWords([para, para, para, para], dict, undefined, { pause: async () => {} });
    expect(all.total).toBeGreaterThan(got.total);
  });

  it('counts a 30,000-character chapter quickly', async () => {
    const para = '村子里的人都认识他，见了面总要说几句话。他慢慢地走了过来，问我要不要一起去吃饭。';
    const texts = Array.from({ length: 30000 / para.length / 4 }, () => para.repeat(4));
    const t = measure(() => chapterWords(texts, dict, undefined, { pause: async () => {} }));
    await t.result;
    expect(t.cpu).toBeLessThan(1500 * PERF_SLACK);
  });
});

describe('sentenceAround', () => {
  it('takes the sentence with its closing quote, and cuts a long one down to the clause', () => {
    const t = '他说：“你好。”我们走吧！';
    expect(sentenceAround(t, 4, 6)).toBe('他说：“你好。”');
    expect(sentenceAround(t, 9, 11)).toBe('我们走吧！');
    const long = '一'.repeat(60) + '，我们在银行门口见面，' + '二'.repeat(60) + '。';
    const s = sentenceAround(long, long.indexOf('银行'), long.indexOf('银行') + 2);
    expect(s).toBe('我们在银行门口见面，');
  });
});

describe('wordShare', () => {
  it('is the share of occurrences known, and the words still new', async () => {
    const got = await chapterWords(['我们在银行门口见面。我们走吧。我们走吧。我们走吧。'], dict);
    const known = new Set(['我们', '在']);
    const s = wordShare(got, (w) => known.has(w.key));
    expect(s.total).toBe(got.total);
    expect(s.known).toBe(5);
    expect(s.fresh).toBe(got.words.length - 2);
    expect(s.freshOften).toBe(2); // 走 and 吧, three times each
  });
});

describe('sentences in languages with spaces between words', () => {
  afterEach(() => setLangForTests('zh'));
  // Made-up paragraphs: several sentences each, one of them longer than the 90 characters Chinese is cut at.
  const PARAS = {
    es: 'Había una vez un hombre que vivía en una ciudad grande. Trabajaba mucho todos los días en una oficina con muchas ventanas. Pero un día se enfermó, y los médicos le dijeron que solamente yéndose al campo podría curarse. Entonces se fue al monte.',
    fr: 'Il était une fois un roi et une reine qui vivaient dans un grand château. Ils étaient tristes, car ils n’avaient pas d’enfants, et ils allaient voir toutes les fées du pays pour en avoir un. Enfin la reine eut une fille.',
    ru: 'Молодая собака бежала по улице. Она искала своего хозяина, который ушёл утром на рынок и не вернулся домой к обеду, хотя всегда возвращался вовремя. Вечером пошёл дождь.',
  } as const;
  const letter = /[\p{L}\p{M}\p{N}]/u;

  for (const id of ['es', 'fr', 'ru'] as const) {
    it(`keeps the sentence the word card keeps, whole, in ${id}`, async () => {
      const engine = await loadLang(id);
      setLangForTests(id, engine);
      const para = PARAS[id];
      const got = await chapterWords([para], noChineseDictionary(engine), undefined, { pause: async () => {} });
      expect(got.words.length).toBeGreaterThan(20);
      const toks = engine.segment(para).filter((t) => t.kind === 'word');
      for (const w of got.words) {
        const tok = toks.find((t) => (t.key || t.text) === w.key)!;
        // The same sentence as the card's splitter, so both ways of saving keep the same one.
        expect(w.sentence, w.key).toBe(cardSentence(para, tok.start).text);
        // Never starts or ends inside a word.
        const at = para.indexOf(w.sentence);
        expect(at, w.key).toBeGreaterThanOrEqual(0);
        expect(letter.test(para[at - 1] ?? ' ') && letter.test(w.sentence[0]), w.key).toBe(false);
        expect(letter.test(para[at + w.sentence.length] ?? ' ') && letter.test(w.sentence.at(-1)!), w.key).toBe(false);
      }
      // Longer than 90 characters, and still whole.
      const sick = got.words.find((w) => w.sentence.includes('médicos') || w.sentence.includes('fées') || w.sentence.includes('хозяина'))!;
      expect(sick.sentence.length).toBeGreaterThan(90);
      expect(sick.sentence).toMatch(/^[\p{Lu}]/u);
      expect(sick.sentence).toMatch(/[.]$/);
    }, 60000);
  }

  it('cuts a very long sentence between words, with … where it was cut', () => {
    const words = Array.from({ length: 120 }, (_, i) => `palabra${i}`);
    const text = `${words.join(' ')}.`;
    const at = text.indexOf('palabra60');
    const s = sentenceAround(text, at, at + 'palabra60'.length, true);
    expect(s.length).toBeLessThanOrEqual(404);
    expect(s).toMatch(/^… palabra\d+ /);
    expect(s).toMatch(/ palabra\d+ …$/);
    expect(s).toContain('palabra60');
    for (const piece of s.replace(/…/g, '').trim().split(' ')) expect(words).toContain(piece);
  });
});
