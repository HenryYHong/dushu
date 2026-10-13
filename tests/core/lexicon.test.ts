import { describe, expect, it } from 'vitest';
import { buildLexicon, detectTerms, detectTermsAsync, EMPTY_LEXICON, mergeLexicon, pinyinOf } from '../../src/core/lexicon';
import { segment } from '../../src/core/segment';
import type { LexiconEntry } from '../../src/types';
import { loadTestDictionary } from '../helpers/data';
import { novel } from '../helpers/novel';
import { PERF_SLACK } from '../helpers/perf';

const dictP = loadTestDictionary();

const entry = (word: string, over: Partial<LexiconEntry> = {}): LexiconEntry => ({
  word, pinyin: '', gloss: 'name (person)', kind: 'name', enabled: true, origin: 'auto', ...over,
});

describe('buildLexicon', () => {
  it('holds enabled entries only and reports the longest', () => {
    const lex = buildLexicon([entry('郭靖'), entry('降龙十八掌', { kind: 'term' }), entry('黄蓉', { enabled: false })]);
    expect(lex.has('郭靖')).toBe(true);
    expect(lex.has('黄蓉')).toBe(false);
    expect(lex.get('郭靖')?.word).toBe('郭靖');
    expect(lex.entries().map((e) => e.word).sort()).toEqual(['郭靖', '降龙十八掌']);
    expect(lex.maxLen).toBe(5);
    expect(EMPTY_LEXICON.maxLen).toBe(0);
  });

  it("mergeLexicon lets a book's row win over the user's '*' row", () => {
    const lex = mergeLexicon([entry('单于', { gloss: 'mine', origin: 'user' })], [entry('单于', { gloss: 'book' }), entry('郭靖')]);
    expect(lex.get('单于')?.gloss).toBe('book');
    expect(lex.has('郭靖')).toBe(true);
    const off = mergeLexicon([entry('单于', { origin: 'user' })], [entry('单于', { enabled: false })]);
    expect(off.has('单于')).toBe(false);
  });
});

describe('detectTerms', () => {
  it('finds invented names, places and techniques, and nothing the dictionary already has', async () => {
    const dict = await dictP;
    const found = detectTerms([novel()], dict);
    const by = new Map(found.map((e) => [e.word, e]));
    for (const n of ['莫远峰', '单雨晴', '欧阳无忌']) {
      expect(by.get(n)?.kind, n).toBe('name');
      expect(by.get(n)?.gloss).toBe('name (person)');
      expect(by.get(n)?.origin).toBe('auto');
      expect(by.get(n)?.enabled).toBe(true);
    }
    expect(by.get('紫霞岛')?.kind).toBe('place');
    expect(by.get('落星庄')?.kind).toBe('place');
    expect(by.get('玄冥神掌')?.kind).toBe('term');
    expect(by.get('青云剑法')?.kind).toBe('term');
    for (const e of found) {
      expect(dict.hasWord(e.word), e.word).toBe(false);
      expect([...e.pinyin.split(' ')].length, e.word).toBe([...e.word].length);
    }
    // No fragment of a longer name and no name-plus-verb string.
    for (const bad of ['莫远', '远峰', '莫远峰说', '莫远峰笑', '雨晴', '无忌', '紫霞', '玄冥神']) expect(by.has(bad), bad).toBe(false);
  });

  it('reads surnames as surnames (单 is Shàn, 欧阳 is Ōuyáng) and keeps other characters at their usual reading', async () => {
    const dict = await dictP;
    expect(pinyinOf('单雨晴', 'name', dict)).toBe('shan4 yu3 qing2');
    expect(pinyinOf('欧阳无忌', 'name', dict)).toBe('ou1 yang2 wu2 ji4');
    expect(pinyinOf('丘处机', 'name', dict)).toBe('qiu1 chu3 ji1');
    expect(pinyinOf('尉迟恭', 'name', dict)).toBe('yu4 chi2 gong1');
    // Not a name: 单 stays dān.
    expect(pinyinOf('单据箱', 'term', dict).split(' ')[0]).toBe('dan1');
    // A doubled last character is neutral.
    expect(pinyinOf('靖哥哥', 'name', dict)).toBe('jing4 ge1 ge5');
  });

  it('is deterministic, finds the same with the async driver, and returns nothing for short or non-Chinese text', async () => {
    const dict = await dictP;
    const text = novel(11, 500);
    const a = detectTerms([text], dict).map((e) => e.word);
    const b = (await detectTermsAsync([text], dict)).map((e) => e.word);
    expect(b).toEqual(a);
    expect(detectTerms(['你好'], dict)).toEqual([]);
    expect(detectTerms(['hello world '.repeat(500)], dict)).toEqual([]);
    expect(detectTerms([], dict)).toEqual([]);
  });

  it('works on traditional text', async () => {
    const dict = await dictP;
    const text = dict.toTraditional(novel(3, 700));
    const words = detectTerms([text], dict).map((e) => e.word);
    expect(words).toContain(dict.toTraditional('莫远峰'));
    expect(words).toContain(dict.toTraditional('紫霞岛'));
  });

  it('handles a million characters in a few seconds', async () => {
    const dict = await dictP;
    const chunk = novel(5, 3000);
    const chapters = Array.from({ length: 8 }, () => chunk.repeat(8));
    const total = chapters.reduce((n, c) => n + c.length, 0);
    expect(total).toBeGreaterThan(900_000);
    const t0 = Date.now();
    const found = detectTerms(chapters, dict);
    expect(Date.now() - t0).toBeLessThan(8000 * PERF_SLACK);
    expect(found.some((e) => e.word === '莫远峰')).toBe(true);
  }, 30000);
});

describe('segment with a lexicon', () => {
  it('makes a name one token with the entry pinyin, where the dictionary alone splits it', async () => {
    const dict = await dictP;
    const text = '莫远峰对单雨晴说，欧阳无忌来了。';
    const plain = segment(text, dict);
    expect(plain.some((t) => t.text === '莫远峰')).toBe(false);
    const lex = buildLexicon([
      entry('莫远峰', { pinyin: 'mo4 yuan3 feng1' }),
      entry('单雨晴', { pinyin: 'shan4 yu3 qing2' }),
      entry('欧阳无忌', { pinyin: 'ou1 yang2 wu2 ji4' }),
    ]);
    const tokens = segment(text, dict, lex);
    expect(tokens.map((t) => t.text).join('')).toBe(text);
    expect(tokens.filter((t) => t.kind === 'han').map((t) => t.text)).toEqual(['莫远峰', '对', '单雨晴', '说', '欧阳无忌', '来', '了']);
    expect(tokens[0].pinyin).toEqual(['mo4', 'yuan3', 'feng1']);
    expect(tokens[2].pinyin).toEqual(['shan4', 'yu3', 'qing2']);
    expect(tokens[0].inDict).toBe(false);
  });

  it('beats a split into frequent words, covers the paragraph exactly, and leaves unrelated text alone', async () => {
    const dict = await dictP;
    const lex = buildLexicon([entry('我们家', { kind: 'term' })]);
    const text = '我们家的人都不在，我们知道了。';
    const base = segment(text, dict);
    const withLex = segment(text, dict, lex);
    expect(withLex.map((t) => t.text).join('')).toBe(text);
    expect(withLex[0].text).toBe('我们家');
    // The second 我们 is untouched.
    expect(withLex.filter((t) => t.text === '我们').length).toBe(base.filter((t) => t.text === '我们').length - 1);
    // An empty lexicon changes nothing.
    expect(segment(text, dict, EMPTY_LEXICON).map((t) => t.text)).toEqual(base.map((t) => t.text));
  });

  it('ignores a disabled entry and an entry whose pinyin has the wrong number of syllables', async () => {
    const dict = await dictP;
    const off = buildLexicon([entry('莫远峰', { enabled: false })]);
    expect(segment('莫远峰来了', dict, off).some((t) => t.text === '莫远峰')).toBe(false);
    const bad = buildLexicon([entry('莫远峰', { pinyin: 'mo4 yuan3' })]);
    const t = segment('莫远峰来了', dict, bad).find((x) => x.text === '莫远峰');
    expect(t?.pinyin?.length).toBe(3);
  });

  it('works with rare astral characters in an entry', async () => {
    const dict = await dictP;
    const lex = buildLexicon([entry('𠀀甲', { kind: 'user' })]);
    const text = '他叫𠀀甲。';
    const tokens = segment(text, dict, lex);
    expect(tokens.map((t) => t.text).join('')).toBe(text);
    expect(tokens.some((t) => t.text === '𠀀甲')).toBe(true);
  });

  it('stays fast with a few hundred entries', async () => {
    const dict = await dictP;
    const rows = Array.from({ length: 300 }, (_, i) => entry(`某${String.fromCodePoint(0x4e00 + i * 7)}${String.fromCodePoint(0x4e01 + i * 11)}`));
    const lex = buildLexicon(rows);
    const text = '我们都知道这件事，大家一起去吃饭。'.repeat(600);
    const t0 = Date.now();
    segment(text, dict, lex);
    expect(Date.now() - t0).toBeLessThan(800 * PERF_SLACK);
  });
});
