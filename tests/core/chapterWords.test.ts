import { beforeAll, describe, expect, it } from 'vitest';
import type { Dictionary } from '../../src/types';
import { chapterWords, sentenceAround, wordShare } from '../../src/core/chapterWords';
import { buildLexicon } from '../../src/core/lexicon';
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
