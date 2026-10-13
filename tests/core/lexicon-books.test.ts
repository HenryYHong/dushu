// Name detection on whole books: the recurring characters a reader meets must be one token with a reading, and what
// is not a name must not be labeled one. 西遊記 and 紅樓夢 are the public-domain samples; 活着 and 射雕英雄传 are read from
// ~/Downloads when they exist (counts and words of a few characters only, never passages).
import { describe, expect, it } from 'vitest';
import { buildLexicon, detectTerms } from '../../src/core/lexicon';
import { segment } from '../../src/core/segment';
import type { LexiconEntry } from '../../src/types';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { downloadsEpubText, sampleText } from '../helpers/bookText';
import { loadTestDictionary } from '../helpers/data';

const dictP = loadTestDictionary();
const by = (found: LexiconEntry[]) => new Map(found.map((e) => [e.word, e]));
const kinds = (m: Map<string, LexiconEntry>, words: string[]) => words.map((w) => `${w}:${m.get(w)?.kind ?? '-'}`);

describe('西遊記', () => {
  const found = dictP.then((d) => detectTerms([sampleText('xiyouji')], d));
  it('finds the pilgrims by their Buddhist names, which the dictionary lists but the corpus never joins', async () => {
    const m = by(await found);
    expect(kinds(m, ['悟空', '悟能', '悟淨'])).toEqual(['悟空:name', '悟能:name', '悟淨:name']);
    expect(m.get('悟空')!.pinyin).toBe('wu4 kong1');
    // A dictionary proper noun keeps its own first sense, not "name (person)".
    expect(m.get('悟空')!.gloss).toMatch(/^Sun Wukong/);
  });
  it('labels places as places and keeps offices out of the person list', async () => {
    const m = by(await found);
    expect(m.get('暴紗亭')?.kind).toBe('place');
    expect(m.get('鳳仙郡')?.kind).toBe('place');
    for (const w of ['郡侯', '功曹', '真君', '妖王']) expect(m.get(w)?.kind, w).not.toBe('name');
  });
  it('makes 悟空 one token once the lexicon has it', async () => {
    const d = await dictP;
    const lex = buildLexicon(await found);
    const plain = segment('悟空道：「師父。」', d).map((t) => t.text);
    expect(plain.slice(0, 2)).toEqual(['悟', '空']);
    expect(segment('悟空道：「師父。」', d, lex).map((t) => t.text).slice(0, 1)).toEqual(['悟空']);
  });
});

describe('三國演義', () => {
  // Its speakers are introduced with 曰, and its generals are ordered and addressed more often than they speak.
  const text = readFileSync(join(__dirname, '..', '..', 'public', 'samples', 'sanguo.txt'), 'utf8');
  const found = dictP.then((d) => detectTerms([text], d));
  it('finds the generals who were split into single characters, as persons', async () => {
    const m = by(await found);
    for (const w of ['曹仁', '劉璋', '張遼', '夏侯惇', '徐晃', '陸遜', '張苞', '關興', '黃祖', '魏延', '龐統']) expect(m.get(w)?.kind, w).toBe('name');
  });
  it('reads a compound surname and its given name right, and keeps junk from the list', async () => {
    const m = by(await found);
    expect(m.get('夏侯惇')?.pinyin).toBe('xia4 hou2 dun1');
    for (const w of ['班師回', '回本寨', '聞其名', '哨馬報']) expect(m.has(w), w).toBe(false);
  });
});

describe('紅樓夢', () => {
  const found = dictP.then((d) => detectTerms([sampleText('hongloumeng')], d));
  it('finds the maids and young ladies who were split into single characters', async () => {
    const m = by(await found);
    for (const w of ['麝月', '司棋', '秋桐', '侍書', '雪雁', '襲人', '晴雯', '鶯兒', '湘雲', '平兒', '周瑞家的', '林之孝家的']) {
      expect(m.get(w)?.kind, w).toBe('name');
    }
  });
  it('reads a pet name in 兒 as ér, not as the erhua suffix', async () => {
    const m = by(await found);
    expect(m.get('平兒')!.pinyin).toBe('ping2 er2');
    expect(m.get('鶯兒')!.pinyin).toBe('ying1 er2');
    const d = await dictP;
    const lex = buildLexicon(await found);
    const tok = segment('平兒笑道', d, lex)[0];
    expect(tok.text).toBe('平兒');
    expect(tok.pinyin).toEqual(['ping2', 'er2']);
  });
  it('does not call a place, a poem line or a manner phrase a person', async () => {
    const m = by(await found);
    expect(m.get('林如海')?.kind).toBe('name');
    for (const w of ['成日家', '怀古其', '詫异', '文官等']) expect(m.has(w), w).toBe(false);
  });
  it('finds the young actresses whose names end in 官, which is a rank elsewhere', async () => {
    const m = by(await found);
    expect(m.get('芳官')?.kind).toBe('name');
  });
});

describe('活着 (the owner\'s copy, if present)', () => {
  const text = downloadsEpubText('活着.epub');
  (text ? it : it.skip)('finds 龙二 and 苦根 beside the family', async () => {
    const m = by(detectTerms([text!], await dictP));
    expect(kinds(m, ['福贵', '家珍', '有庆', '凤霞', '二喜', '春生', '龙二', '苦根'])).toEqual(
      ['福贵', '家珍', '有庆', '凤霞', '二喜', '春生', '龙二', '苦根'].map((w) => `${w}:name`));
  });
});

describe('射雕英雄传 (the owner\'s copy, if present)', () => {
  const text = downloadsEpubText('射雕英雄传.epub');
  (text ? it : it.skip)('finds the sworn groups, the nickname and the Mongol names with the right kind', async () => {
    const m = by(detectTerms([text!], await dictP));
    expect(m.get('江南七怪')?.kind).toBe('term');
    expect(m.get('全真七子')?.kind).toBe('term');
    expect(m.get('老顽童')?.kind).toBe('name');
    expect(m.get('赤老温')?.kind).toBe('name');
    expect(m.get('合撒儿')?.kind).toBe('name');
    expect(m.get('合撒儿')?.pinyin).toBe('he2 sa1 er2');
    expect(m.get('华山论剑')?.kind).toBe('term');
  });
});
