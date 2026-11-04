// Name detection on whole books: the recurring characters a reader meets must be one token with a reading, and what
// is not a name must not be labeled one. 西遊記, 紅樓夢, 三國演義 and 水滸傳 are the public-domain samples; 活着 and 射雕英雄传 are read from
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
    // (Without the lexicon the dictionary's floor for words the corpus never saw joins it as well, as the proper noun it is.)
    const plain = segment('悟空道：「師父。」', d).map((t) => t.text);
    expect(plain[0]).toBe('悟空');
    expect(segment('悟空道：「師父。」', d, lex).map((t) => t.text).slice(0, 1)).toEqual(['悟空']);
  });
  it('adds the dictionary names that hold a found name, so 悟能 never cuts 豬悟能', async () => {
    const m = by(await found);
    expect(kinds(m, ['孫悟空', '豬悟能', '沙悟淨'])).toEqual(['孫悟空:name', '豬悟能:name', '沙悟淨:name']);
    expect(m.get('孫悟空')!.pinyin).toBe('sun1 wu4 kong1');
    const d = await dictP;
    const lex = buildLexicon(await found);
    for (const w of ['孫悟空', '豬悟能', '沙悟淨', '豬八戒', '唐僧']) expect(segment(`${w}道`, d, lex)[0].text, w).toBe(w);
  });
  it('keeps the persons who speak with a 道 that makes a word with their last character (唐王道, 孤直公道)', async () => {
    const m = by(await found);
    expect(kinds(m, ['悟空', '唐王', '孤直公'])).toEqual(['悟空:name', '唐王:name', '孤直公:name']);
  });
  it('calls 黃花觀 a temple (its 道士 do not make it speak), read guàn, and drops 鬧天宮, the tail of 大鬧天宮', async () => {
    const m = by(await found);
    expect(m.get('黃花觀')).toMatchObject({ kind: 'place', pinyin: 'huang2 hua1 guan4' });
    expect(m.has('鬧天宮')).toBe(false);
  });
  it('adds 劉伯欽 around 伯欽, but not 蒙唐王 (蒙 "to receive" before a title)', async () => {
    const m = by(await found);
    expect(m.get('劉伯欽')).toMatchObject({ kind: 'name', pinyin: 'liu2 bo2 qin1' });
    expect(m.has('蒙唐王')).toBe(false);
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
  it('drops a string that runs into the next word or cuts a known name, so 曹操 and 孫權 stay whole', async () => {
    const m = by(await found);
    // 操大 + 怒/喜/笑, 吳主孫 + 權/皓, 拍 + 馬舞刀, 此機會, 轉過山.
    for (const w of ['操大', '吳主孫', '馬舞刀', '此機會', '轉過山']) expect(m.has(w), w).toBe(false);
    expect(kinds(m, ['玄德', '雲長', '曹仁', '魏延'])).toEqual(['玄德:name', '雲長:name', '曹仁:name', '魏延:name']);
    const d = await dictP;
    const lex = buildLexicon(await found);
    expect(segment('曹操大怒', d, lex)[0].text).toBe('曹操');
    expect(segment('吳主孫權', d, lex).map((t) => t.text)).toContain('孫權');
  });
  it('adds 關雲長 around 雲長, so the found name never cuts the full one', async () => {
    const m = by(await found);
    expect(m.get('關雲長')?.kind).toBe('name');
    expect(m.get('關雲長')?.pinyin).toBe('guan1 yun2 chang2');
    const d = await dictP;
    const lex = buildLexicon(await found);
    expect(segment('關雲長曰', d, lex)[0].text).toBe('關雲長');
    for (const w of ['劉備', '關羽', '張飛', '諸葛亮']) expect(segment(`${w}曰`, d, lex)[0].text, w).toBe(w);
  });
  it('finds 劉岱 beside 馬岱, who holds most of the 岱, and does not take 魏延解孟獲 (escorts) for a surname', async () => {
    const m = by(await found);
    expect(m.get('劉岱')).toMatchObject({ kind: 'name', pinyin: 'liu2 dai4' });
    expect(m.has('解孟獲')).toBe(false);
  });
});

describe('水滸傳', () => {
  const text = readFileSync(join(__dirname, '..', '..', 'public', 'samples', 'shuihu.txt'), 'utf8');
  const found = dictP.then((d) => detectTerms([text], d));
  it('keeps phrases out of the names: 替天行(道), a function word or a doubled start, a title before 宋江', async () => {
    const m = by(await found);
    for (const w of ['替天行', '謂之', '沒做', '單單只', '先鋒使宋江']) expect(m.has(w), w).toBe(false);
    const d = await dictP;
    const lex = buildLexicon(await found);
    expect(segment('替天行道', d, lex).map((t) => t.text)).toEqual(['替天行道']);
    for (const w of ['宋江', '李逵', '武松']) expect(segment(`${w}道`, d, lex)[0].text, w).toBe(w);
  });
  it('keeps the heroes whose last character makes a word with 道 (燕順道, 阮小二道, 宋太公道), and the 沒 nicknames', async () => {
    const m = by(await found);
    const names = ['燕順', '阮小二', '李小二', '宋太公', '蕭讓', '周通', '葉清', '張橫', '盧俊義', '梁山泊'];
    expect(kinds(m, names)).toEqual(names.map((w) => `${w}:name`));
    expect(kinds(m, ['沒羽箭', '沒遮攔'])).toEqual(['沒羽箭:term', '沒遮攔:term']);
  });
  it('makes a title that follows several surnames a term, and the officers names (魯提轄, 孫提轄, 陸虞候)', async () => {
    const m = by(await found);
    expect(kinds(m, ['提轄', '虞候', '節級', '樞密'])).toEqual(['提轄:term', '虞候:term', '節級:term', '樞密:term']);
    expect(kinds(m, ['魯提轄', '孫提轄', '陸虞候', '李虞候'])).toEqual(['魯提轄:name', '孫提轄:name', '陸虞候:name', '李虞候:name']);
    // A full name the given name stood for (婆惜 → 閻婆惜), and 小嘍囉, "the underlings", is not a person.
    expect(m.get('閻婆惜')?.kind).toBe('name');
    expect(m.has('小嘍囉')).toBe(false);
    // 都 inside a title is dū.
    expect(m.get('張都監')?.pinyin).toBe('zhang1 du1 jian1');
  });
  it('finds 費珍 beside 解珍, and never takes the end of a nickname for a surname (九紋龍史進, 轟天雷凌振)', async () => {
    const m = by(await found);
    expect(m.get('費珍')?.kind).toBe('name');
    for (const w of ['龍史進', '雷凌振']) expect(m.has(w), w).toBe(false);
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
  it('keeps the speakers whose last character makes a word with 道 (王夫人道), and drops 大兒, which is half of 大兒子', async () => {
    const m = by(await found);
    const names = ['王夫人', '邢夫人', '侍書', '王善保家的', '林黛玉'];
    expect(kinds(m, names)).toEqual(names.map((w) => `${w}:name`));
    expect(m.has('大兒')).toBe(false);
    const d = await dictP;
    const lex = buildLexicon(await found);
    for (const w of ['林黛玉', '賈寶玉', '王熙鳳']) expect(segment(`${w}道`, d, lex)[0].text, w).toBe(w);
  });
  it('adds the full name of a found given name (子興 → 冷子興) and the given name of a full one (林如海 → 如海)', async () => {
    const m = by(await found);
    expect(m.get('冷子興')?.kind).toBe('name');
    expect(m.get('如海')).toMatchObject({ kind: 'name', gloss: 'name (person), short for 林如海' });
    // 嬤嬤 follows 李, 趙, 賴 and 宋: a word for a nurse, not a person; 李嬤嬤 is one.
    expect(m.get('嬤嬤')?.kind).not.toBe('name');
    expect(m.get('李嬤嬤')).toMatchObject({ kind: 'name', pinyin: 'li3 mo2 mo5' });
  });
  it('adds a full name the book uses only a few times when no other surname stands before the given name (夏金桂, 賈代儒)', async () => {
    const m = by(await found);
    expect(m.get('夏金桂')).toMatchObject({ kind: 'name', pinyin: 'xia4 jin1 gui4' });
    expect(m.get('賈代儒')).toMatchObject({ kind: 'name', pinyin: 'jia3 dai4 ru2' });
  });
});

describe('short public-domain texts', () => {
  const read = (id: string) => readFileSync(join(__dirname, '..', '..', 'public', 'samples', `${id}.txt`), 'utf8');
  it('finds the places and the pen name a few-thousand-character essay names a handful of times, and nothing else', async () => {
    const d = await dictP;
    const words = (id: string) => detectTerms([read(id)], d).map((e) => `${e.word}:${e.kind}`);
    expect(words('zhu-ziqing-sanwen')).toContain('白马湖:place');
    expect(words('chunfeng-chenzui')).toContain('邓脱路:place');
    expect(words('zhaohua-xishi')).toContain('百草园:place');
    expect(words('dongwu-gushi')).toContain('仲密:name');
    expect(words('kong-yiji')).toEqual([]);
    // 子曰 "the Master said", a curated phrase of the Analects (book-words scope "book"), joins the lexicon of the book that uses it.
    expect(words('lunyu-xue-er')).toEqual(['子曰:term']);
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
