// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Dictionary } from '../../src/types';
import { cachedSample, keepSample, knownShare, sampleBook, sampleChapters, sampleKey, SAMPLE_CHARS } from '../../src/core/bookWords';
import { buildLexicon } from '../../src/core/lexicon';
import { openStore } from '../../src/store';
import { loadTestDictionary } from '../helpers/data';

let dict: Dictionary;
beforeAll(async () => { dict = await loadTestDictionary(); });

describe('book samples', () => {
  it('spread six chapters over a long book, missing the first and last, and take every chapter of a short one', () => {
    expect(sampleChapters(40)).toEqual([3, 10, 16, 23, 30, 36]);
    expect(sampleChapters(4)).toEqual([0, 1, 2, 3]);
    expect(sampleChapters(100).every((i) => i > 0 && i < 99)).toBe(true);
  });

  it('count up to 4,000 characters of each sampled chapter, leave names out, and give the share known', async () => {
    const store = await openStore(`bookwords-${Math.random()}`);
    const long = '我们在银行门口见面。'.repeat(1000);
    const meta = await store.books.add({
      title: '书', author: '', format: 'paste', script: 'simplified', assets: new Map(),
      chapters: [
        { title: '一', blocks: [{ t: 'p', text: long }] },
        { title: '二', blocks: [{ t: 'h', level: 1, text: '第二章' }, { t: 'p', text: '莫远峰去了银行。' }] },
      ],
    });
    const lex = buildLexicon([{ word: '莫远峰', pinyin: 'mo4 yuan3 feng1', gloss: '', kind: 'name', enabled: true, origin: 'auto' }]);
    const s = await sampleBook(store, dict, meta, lex, { pause: async () => {} });
    expect(s.key).toBe(sampleKey(meta, lex));
    const bank = s.words.find(([w]) => w === '银行')![1];
    // 4,000 characters of chapter one are 400 sentences, plus one 银行 in chapter two.
    expect(bank).toBe(SAMPLE_CHARS / 10 + 1);
    expect(s.words.some(([w]) => w === '莫远峰')).toBe(false);
    expect(knownShare(s, () => false)).toBe(0);
    expect(knownShare(s, () => true)).toBe(1);
    const share = knownShare(s, (w) => w === '银行')!;
    expect(share).toBeGreaterThan(0.1);
    expect(share).toBeLessThan(0.3);
  });

  it('are kept per device and dropped when the book is gone or changed', () => {
    localStorage.clear();
    const sample = { key: '2|10|0', total: 3, words: [['好', 3]] as [string, number][] };
    keepSample('a', sample, ['a', 'b']);
    keepSample('b', { ...sample }, ['a', 'b']);
    expect(cachedSample('a', '2|10|0')).toEqual(sample);
    expect(cachedSample('a', '3|10|0')).toBeNull();
    keepSample('b', { ...sample }, ['b']);
    expect(cachedSample('a', '2|10|0')).toBeNull();
    expect(knownShare({ key: '', total: 0, words: [] }, () => true)).toBeNull();
  });
});
