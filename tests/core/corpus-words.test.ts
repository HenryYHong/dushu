// The corpus counts and words (public/data/corpus-words.tsv.gz, scripts/build_corpus_words.py): a count read off free text in
// place of the floor for a dictionary word the jieba corpus never counted, and old spellings no dictionary has that point to the
// word they stand for. Without the file every word keeps today's floor. Every sentence here is invented, or a line of a
// public-domain classic.
import { describe, expect, it } from 'vitest';
import { UNSEEN_FLOOR } from '../../src/core/dict';
import { segment } from '../../src/core/segment';
import { loadTestDictionary, readDataFile } from '../helpers/data';
import { miniDict } from '../helpers/mini';
import { loadDictionary } from '../../src/core/dict';
import type { Dictionary } from '../../src/types';

const dictP = loadTestDictionary();
/** The real dictionary without the corpus file, as an old deployment or a failed fetch leaves it. */
let without: Promise<Dictionary> | null = null;
const withoutP = () => (without ??= loadDictionary('/', {
  fetchText: async (name) => {
    if (name === 'corpus-words.tsv.gz') throw new Error('missing');
    return readDataFile(name);
  },
}));

const cut = (text: string, d: Dictionary) => `|${segment(text, d).map((t) => t.text).join('|')}|`;

const MINI = {
  cedict: [
    ['甲乙', '甲乙', 'jia3 yi3', '(archaic) a made-up word'],
    ['丙丁', '丙丁', 'bing3 ding1', 'another made-up word'],
    ['預備', '预备', 'yu4 bei4', 'to prepare'],
  ],
  words: [['甲', 1000], ['乙', 1000], ['丙', 1000], ['丁', 1000], ['预', 500], ['备', 500]] as [string, number][],
};

describe('the corpus file', () => {
  it('gives a word the jieba corpus never counted its count in place of the floor, and 0 takes the floor away', async () => {
    const d = await miniDict({ ...MINI, corpusWords: '# format 1\n甲乙\t40\n丙丁\t0\n' });
    expect(d.freq('甲乙')).toBe(0);
    expect(d.segmentFreq!('甲乙')).toBe(40);
    expect(d.segmentFreq!('丙丁')).toBe(0);
    expect(d.meta.counts.corpusCounts).toBe(2);
  });

  it('adds a word no dictionary has, and an old spelling shows the meaning of the word it points to', async () => {
    const d = await miniDict({ ...MINI, corpusWords: '# format 1\n豫備\t豫备\tyu4 bei4\tvariant of 預備|预备[yu4 bei4]\t6\n' });
    const [e] = d.lookup('豫备');
    expect(e.pinyin).toBe('yu4 bei4');
    expect(e.defs).toContain('to prepare');
    expect(d.lookup('豫備')).toHaveLength(1);
    expect(d.segmentFreq!('豫备')).toBe(6);
    expect(d.meta.counts.corpusWordsLoaded).toBe(1);
  });

  it('leaves the floors alone when the file is missing or of another format', async () => {
    for (const corpusWords of [undefined, '# format 2\n甲乙\t40\n豫備\t豫备\tyu4 bei4\tvariant of 預備|预备[yu4 bei4]\t6\n']) {
      const d = await miniDict({ ...MINI, ...(corpusWords ? { corpusWords } : {}) });
      expect(d.segmentFreq!('丙丁')).toBe(UNSEEN_FLOOR);
      expect(d.segmentFreq!('甲乙')).toBe(0); // archaic: no floor
      expect(d.hasWord('豫备')).toBe(false);
    }
  });
});

describe('with the real data', () => {
  it('joins old words the floor left in pieces, and the same text without the file is cut as before', async () => {
    const d = await dictP;
    const old = await withoutP();
    // (archaic) titles and set phrases of the old novels, which the floor does not join.
    expect(cut('制台大人坐轿去了。', d)).toContain('|制台|');
    expect(cut('制台大人坐轿去了。', old)).not.toContain('|制台|');
    expect(cut('众人叙礼毕，分宾主坐下。', d)).toContain('|叙礼|');
    expect(cut('那妇人往外便走。', d)).toContain('|往外|');
    expect(old.segmentFreq!('制台')).toBe(0);
    expect(d.segmentFreq!('制台')).toBeGreaterThan(UNSEEN_FLOOR);
  });

  it('keeps a longer dictionary word whole around a counted one (车骑将军, 中常侍)', async () => {
    const d = await dictP;
    expect(cut('拜为车骑将军。', d)).toContain('|车骑将军|');
    expect(cut('中常侍赵忠入宫。', d)).toContain('|中常侍|');
  });

  it('gives a counted word only enough to win where it stands free, not across a place name before it', async () => {
    const d = await dictP;
    // 州牧 is not in the file: in 豫州牧 the province keeps its name.
    expect(cut('表荐刘备领豫州牧。', d)).not.toContain('|州牧|');
    // 婚丧 is not either: 已婚丧偶 keeps 已婚.
    expect(cut('她已婚丧偶。', d)).toContain('|已婚|');
  });

  it('reads an old spelling as the word it stands for', async () => {
    const d = await dictP;
    const tok = (text: string, w: string) => segment(text, d).find((t) => t.text === w);
    expect(tok('柜里面豫备着热水。', '豫备')?.pinyin).toEqual(['yu4', 'bei4']);
    expect(d.lookup('豫备')[0].defs.some((x) => /prepare/.test(x))).toBe(true);
    expect(tok('这出戏很精采。', '精采')?.pinyin).toEqual(['jing1', 'cai3']);
    expect(tok('他去帐房支了银子。', '帐房')).toBeDefined();
    // 胡梯 (stairs) keeps its own hú, not the fú of 扶梯 it points to.
    expect(tok('走上胡梯来。', '胡梯')?.pinyin).toEqual(['hu2', 'ti1']);
  });

  it('keeps the words it was told to leave out', async () => {
    const d = await dictP;
    for (const w of ['郭嘉', '圆眼', '州牧', '乐评', '打击乐', '棋类游戏']) expect(d.segmentFreq!(w), w).toBe((await withoutP()).segmentFreq!(w));
  });
});
