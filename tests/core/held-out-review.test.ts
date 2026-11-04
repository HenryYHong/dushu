// Fixes after two native reviewers read every change of the held-out round (the floor for unseen dictionary words, 著 on the
// simplified page, variant folds, the lexicon's guards) on the held-out corpus and the tuned books. Each test names the mechanism
// that went wrong. Every sentence is invented, or a line of a public-domain classic.
import { describe, expect, it } from 'vitest';
import { UNSEEN_FLOOR } from '../../src/core/dict';
import { buildLexicon, detectTerms } from '../../src/core/lexicon';
import { segment } from '../../src/core/segment';
import { inScript, segmentShown } from '../../src/ui/reader/shown';
import type { Token } from '../../src/types';
import { loadTestDictionary } from '../helpers/data';
import { novel } from '../helpers/novel';

const dictP = loadTestDictionary();

/** The tokens of `text`, framed by |. */
async function cut(text: string): Promise<string> {
  const d = await dictP;
  return `|${segment(text, d).map((t) => t.text).join('|')}|`;
}

/** The tokens of `source` as the simplified page shows them (the script detected as in the reader). */
async function shown(source: string, script: 'simplified' | 'traditional' = 'simplified'): Promise<Token[]> {
  const d = await dictP;
  return segmentShown(inScript(source, 'simplified', d, script), source, d);
}

/** The reading of the first token `word` in `source`. */
async function reading(source: string, word: string, script: 'simplified' | 'traditional' = 'simplified'): Promise<string> {
  const t = (await shown(source, script)).find((x) => x.text === word);
  return (t?.pinyin ?? []).join(' ');
}

describe('no floor for a row whose senses a book never means', () => {
  it('slang, a sexual sense, a village or a province, a dialect word after 儿, a name written twice', async () => {
    const d = await dictP;
    for (const w of ['头铁', '不要太', '邦邦', '吃香蕉', '联成', '多乐', '儿狗', '滴滴']) expect(d.segmentFreq!(w), w).toBe(0);
    // A historical province, a literary word tagged dialect too, and a colloquial word that is also slang keep it.
    for (const w of ['交州', '厨下', '争竞', '二饼']) expect(d.segmentFreq!(w), w).toBe(UNSEEN_FLOOR);
  });

  it('so the characters stay apart', async () => {
    expect(await cut('一个吃香蕉的猴子。')).toContain('|吃|香蕉|');
    expect(await cut('好像终久可以联成一线。')).not.toContain('|联成|');
    expect(await cut('真是苦多乐少。')).not.toContain('|多乐|');
    expect(await cut('花白的叭儿狗。')).not.toContain('|儿狗|');
    expect(await cut('大巴车滴滴叫了两声。')).not.toContain('|滴滴|');
  });
});

describe('the floor gives way where the neighbors mean its parts', () => {
  it('a numeral at the end before a number or a measure, two different digits', async () => {
    expect(await cut('张飞引数十骑出城。')).toContain('|引|数十|');
    expect(await cut('陈登引数骑先行。')).not.toContain('|引数|');
    expect(await cut('他们三九年去了上海。')).not.toContain('|三九|');
    expect(await cut('钱庄初七方得开张。')).not.toContain('|七方|');
  });

  it('a measure word after a numeral (两路, 一寸)', async () => {
    expect(await cut('敌军两路杀来。')).not.toContain('|路杀|');
  });

  it('a plural in 们, 口 counting a breath, a verb said twice', async () => {
    expect(await cut('他在厅上伺候老爷们吃饭。')).toContain('|老爷|们|');
    expect(await cut('他吹口仙气，叫声变。')).not.toContain('|吹口|');
    expect(await cut('他把手上的土拍了拍。')).not.toContain('|土拍|');
  });

  it('便 "then", 公 after a surname, 知 after 那, 起 … 来, 被 and 把 before a complement', async () => {
    expect(await cut('他便闭了口，不再说话。')).not.toContain('|便闭|');
    expect(await cut('曹公知我也。')).not.toContain('|公知|');
    expect(await cut('那只黑毛公狗跑了。')).toContain('|公狗|');
    expect(await cut('那知遇了大雨。')).not.toContain('|知遇|');
    expect(await cut('天下起雨来了。')).not.toContain('|起雨|');
    expect(await cut('他拿起笔来写字。')).not.toContain('|起笔|');
    expect(await cut('他被罩在网里。')).not.toContain('|被罩|');
  });

  it('a word with no verb sense before 着', async () => {
    expect(await cut('他又正犯着老毛病。')).not.toContain('|正犯|');
  });

  it('a whole utterance only where the clause ends with it', async () => {
    expect(await cut('那倒是好事。')).not.toContain('|那倒是|');
    expect(await cut('“那倒是。”')).toContain('|那倒是|');
    expect(await cut('你有你的路，我有我的路。')).not.toContain('|有你的|');
  });

  it('a three-character word whose last character opens 来 or 去', async () => {
    expect(await cut('据我看来，事情不难。')).not.toContain('|据我看|');
  });
});

describe('隄防 and 隄備', () => {
  it('are 提防 and 提备 ("to be on guard"), not 堤防 "a dike"', async () => {
    const d = await dictP;
    expect(inScript('不隄防外面有人。', 'simplified', d, 'traditional')).toBe('不提防外面有人。');
    expect(inScript('早作隄備。', 'simplified', d, 'traditional')).toBe('早作提备。');
    expect(d.lookup('隄防')[0]?.defs.join('/')).toMatch(/guard/);
  });
});

describe('著 as the author\'s credit', () => {
  it('stays 著 (zhù) on the simplified page', async () => {
    const d = await dictP;
    for (const src of ['他著有《山居记》一书。', '这本书的著者是谁？', '作者：李某著', '人各著剧数十种。', '王先生著《山居记》。']) {
      expect(inScript(src, 'simplified', d, 'simplified'), src).toBe(src);
    }
    expect(await reading('他著有《山居记》一书。', '著')).toBe('zhu4');
  });

  it('is still 着 where it is the particle or the verb', async () => {
    const d = await dictP;
    expect(inScript('二人拈阄，拈著者便去。', 'simplified', d, 'simplified')).toBe('二人拈阄，拈着者便去。');
    expect(inScript('我希望逢著', 'simplified', d, 'simplified')).toBe('我希望逢着');
    expect(inScript('只等著「填五魁」了。', 'simplified', d, 'simplified')).toBe('只等着「填五魁」了。');
  });
});

describe('the lexicon and variant spellings', () => {
  it('keeps a title as a term of the book when no dictionary has it (一任典史)', async () => {
    const d = await dictP;
    const filler = ['衙门口贴了告示', '县里新修了石桥', '码头上卸着盐包', '他把文书收进匣里', '轿夫换了一班', '城西的当铺关门了'];
    const lines = [novel(11, 2200)];
    for (let i = 0; i < 60; i++) {
      const f = filler[i % filler.length];
      lines.push([`钱典史笑道：“${f}。”`, `${f}，大家都看着钱典史。`, `他对钱典史说，${f}。`, `钱典史听了，${f}。`][i % 4]);
    }
    for (let i = 0; i < 15; i++) lines.push(['他做过一任典史，后来回家了。', '这典史的官，比知县小些。', '我们做典史的，全靠着做生日。'][i % 3]);
    const found = detectTerms([lines.join('\n')], d);
    expect(found.find((e) => e.word === '典史')?.kind).toBe('term');
    expect(segment('他做过一任典史。', d, buildLexicon(found)).map((t) => t.text)).toContain('典史');
  });

  it('joins a word CC-CEDICT spells with a variant the page folds (靑铜时代 is 青铜时代, the Bronze Age)', async () => {
    const d = await dictP;
    expect(d.segmentFreq!('青铜时代')).toBe(UNSEEN_FLOOR);
    expect(await cut('人类进入青铜时代以后。')).toContain('|青铜时代|');
  });
});

describe('readings that follow a neighbor the new words changed', () => {
  it('将 jiàng after the gods or the troops cut whole, jiāng where it is 把', async () => {
    expect(await reading('众神将都说道：好。', '将')).toBe('jiang4');
    expect(await reading('那名哨兵将两块石头搬开。', '将')).toBe('jiang1');
  });

  it('为 wéi after a verb of naming in two characters, in 为是, after 清一色 and 翻; wèi before what is done for someone', async () => {
    expect(await reading('她面称他为“老师”。', '为')).toBe('wei2');
    expect(await reading('还是早些回去为是。', '为')).toBe('wei2');
    expect(await reading('球拍几乎清一色为夹板。', '为')).toBe('wei2');
    expect(await reading('城里翻为虎窟狼窝。', '为')).toBe('wei2');
    expect(await reading('为天下除害，有何不可？', '为')).toBe('wei4');
    expect(await reading('今日为国家大事而来。', '为')).toBe('wei4');
    expect(await reading('我有一人，可为众官醒酒。', '为')).toBe('wei4');
    expect(await reading('雨带会继续为广东沿岸带来大雨。', '为')).toBe('wei4');
  });

  it('得 dé after 多幸 and 且休, and in 得再见天日; děi in 我得再去', async () => {
    expect(await reading('多幸得先生相助。', '得')).toBe('de2');
    expect(await reading('你且休得胡说。', '得')).toBe('de2');
    expect(await reading('百姓，得再见天日。', '得')).toBe('de2');
    expect(await reading('我得再去一趟。', '得')).toBe('dei3');
  });

  it('地 dì in a name after 唤做, de after a phrase cut 急|如火|焚; 干 gàn after a kind of work; 一通 tòng; 那 nǎ', async () => {
    expect(await reading('又改了名，唤做地涌夫人。', '地')).toBe('di4');
    expect(await reading('老汉急如火焚地跑出门。', '地')).toBe('de5');
    expect(await reading('找点零活干当然好。', '干')).toBe('gan4');
    expect(await reading('他跑过去乱骂一通。', '通')).toBe('tong4');
    expect(await reading('你看我还是那容不下人的？', '那')).toBe('na3');
    expect(await reading('那知遇了大雨。', '那')).toBe('na3');
  });
});
