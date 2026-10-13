// Pinyin rules found wrong on real books (西遊記, 紅樓夢, 活着, 射雕英雄传): the 倒 adverb, final particles, 一個 in
// traditional text, measure-word reduplication and a list of smaller polyphone errors. Each case is a sentence run
// through segment() and the sandhi pass, exactly what the reader shows.
import { describe, expect, it } from 'vitest';
import { applySandhi, numberedToMarked } from '../../src/core/pinyin';
import { segment } from '../../src/core/segment';
import { loadTestDictionary } from '../helpers/data';

const dictP = loadTestDictionary();

/** The marked pinyin of the first occurrence of `part` in `text`, one string per code point, joined by spaces. */
async function py(text: string, part: string): Promise<string> {
  const d = await dictP;
  const at = text.indexOf(part);
  if (at < 0) throw new Error(`"${part}" is not in "${text}"`);
  const toks = segment(text, d);
  applySandhi(toks);
  const out: string[] = [];
  for (const t of toks) {
    if (t.kind !== 'han') continue;
    let off = t.start;
    [...t.text].forEach((ch, i) => {
      if (off >= at && off < at + part.length) out.push(numberedToMarked(t.pinyin![i]));
      off += ch.length;
    });
  }
  return out.join(' ');
}

describe('倒', () => {
  const cases: [string, string, string][] = [
    // the adverb "on the contrary": dào
    ['倒也有趣。', '倒', 'dào'], ['他倒不怕。', '倒', 'dào'], ['這倒是真的。', '倒', 'dào'], ['你倒會拉長線兒。', '倒', 'dào'],
    ['他倒还没来。', '倒', 'dào'], ['倒象我的兒子。', '倒', 'dào'], ['倒唬了一跳。', '倒', 'dào'], ['我倒想了一對。', '倒', 'dào'],
    ['反倒不好了。', '倒', 'dào'], ['倒好。', '倒', 'dào'],
    // pouring and reversing
    ['倒了茶來。', '倒', 'dào'], ['他倒茶去了。', '倒', 'dào'], ['倒退三步。', '倒退', 'dào tuì'], ['倒立著。', '倒', 'dào'],
    // falling over
    ['怕我倒。', '倒', 'dǎo'], ['墙倒了。', '倒', 'dǎo'], ['摔倒在地。', '摔倒', 'shuāi dǎo'], ['他倒在床上。', '倒', 'dǎo'],
    ['倒霉透了。', '倒霉', 'dǎo méi'], ['倒下去了。', '倒', 'dǎo'], ['樹倒猢猻散。', '倒', 'dǎo'], ['被打倒了。', '倒', 'dǎo'],
    ['倒換關文。', '倒換', 'dǎo huàn'],
  ];
  for (const [text, part, want] of cases) it(`${text} ${part} = ${want}`, async () => expect(await py(text, part)).toBe(want));
});

describe('sentence-final particles are neutral', () => {
  const cases: [string, string, string][] = [
    ['你好啊！', '啊', 'a'], ['好啊，好啊。', '啊', 'a'], ['走啦。', '啦', 'la'], ['我們走啦！', '啦', 'la'], ['去罷。', '罷', 'ba'], ['去罢。', '罢', 'ba'],
    ['你姓『孫』罷。', '罷', 'ba'], ['在哩。', '哩', 'li'], ['快走吧。', '吧', 'ba'],
    // kept: free-standing 啊, 罷了, 作罷, 罷休, 聽罷
    ['啊，你來了。', '啊', 'ā'], ['罷了。', '罷了', 'bà le'], ['作罷。', '罷', 'bà'], ['罷休。', '罷', 'bà'], ['聽罷，他走了。', '罷', 'bà'],
    ['他說：「也罷，也罷。」', '罷', 'bà'],
  ];
  for (const [text, part, want] of cases) it(`${text} ${part} = ${want}`, async () => expect(await py(text, part)).toBe(want));
});

describe('一 before 個 and repeated measure words', () => {
  const cases: [string, string, string][] = [
    ['一個人', '一個', 'yí ge'], ['一个人', '一个', 'yí ge'], ['了一個嘴巴', '一個', 'yí ge'],
    ['一個一個', '一個一個', 'yí ge yí ge'], ['一个一个地走', '一个一个', 'yí ge yí ge'], ['一次一次', '一次一次', 'yí cì yí cì'],
    ['一遍一遍', '一遍一遍', 'yí biàn yí biàn'], ['一步一步', '一步一步', 'yí bù yí bù'], ['一天一天', '一天一天', 'yì tiān yì tiān'],
    // verbs and adjectives repeated around 一/不 stay neutral
    ['看一看', '看一看', 'kàn yi kàn'], ['想一想', '想一想', 'xiǎng yi xiǎng'], ['好不好', '好不好', 'hǎo bu hǎo'],
    ['一两个', '一两个', 'yì liǎng gè'], ['一兩個', '一兩個', 'yì liǎng gè'], ['一两银子', '一两', 'yī liǎng'],
  ];
  for (const [text, part, want] of cases) it(`${text} = ${want}`, async () => expect(await py(text, part)).toBe(want));
});

describe('smaller polyphone rules', () => {
  const cases: [string, string, string][] = [
    ['了数十招', '数十', 'shù shí'], ['米行', '行', 'háng'], ['數行', '行', 'háng'], ['睡一覺', '覺', 'jiào'], ['好好睡一觉', '觉', 'jiào'],
    ['猛地站起來', '猛地', 'měng dì'], ['忽地一聲', '忽地', 'hū dì'], ['驀地', '驀地', 'mò dì'], ['倏地躍起', '倏地', 'shū dì'],
    ['當當作響', '當當', 'dāng dāng'], ['噹噹作響', '噹噹', 'dāng dāng'], ['劈為兩半', '為', 'wéi'], ['理解為', '為', 'wéi'], ['娶為妻', '為', 'wéi'],
    ['這事得叫他去', '得', 'děi'], ['動彈不得了', '了', 'le'], ['重又站起', '重', 'chóng'], ['留個空', '空', 'kòng'], ['少小離家', '少', 'shào'],
    ['他還回來了', '還', 'hái'], ['小說中', '中', 'zhōng'], ['一隻猫', '隻', 'zhī'], ['釘鈀', '釘鈀', 'dīng pá'], ['邊塞', '塞', 'sài'], ['挑擔', '擔', 'dàn'],
  ];
  for (const [text, part, want] of cases) it(`${text} ${part} = ${want}`, async () => expect(await py(text, part)).toBe(want));
});
