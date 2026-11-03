import { describe, expect, it } from 'vitest';
import { buildLexicon, detectTerms, detectTermsAsync, EMPTY_LEXICON, judgeCandidate, mergeLexicon, pinyinOf } from '../../src/core/lexicon';
import type { TermCandidate } from '../../src/core/lexicon';
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
    const lex = buildLexicon([entry('郭靖'), entry('伏虎十八拳', { kind: 'term' }), entry('黄蓉', { enabled: false })]);
    expect(lex.has('郭靖')).toBe(true);
    expect(lex.has('黄蓉')).toBe(false);
    expect(lex.get('郭靖')?.word).toBe('郭靖');
    expect(lex.entries().map((e) => e.word).sort()).toEqual(['伏虎十八拳', '郭靖']);
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
    // A doubled kinship word is neutral; a doubled given name keeps its tone.
    expect(pinyinOf('靖哥哥', 'name', dict)).toBe('jing4 ge1 ge5');
    expect(pinyinOf('小姑姑', 'name', dict)).toBe('xiao3 gu1 gu5');
    expect(pinyinOf('李师师', 'name', dict)).toBe('li3 shi1 shi1');
  });

  it('reads a name the way names are read: the surname alone, and 发 兴 冠 都 乾 术 長 觀 as in names', async () => {
    const dict = await dictP;
    // 梁子 is "a grudge" (liángzi): the surname never makes a word with the given name.
    expect(pinyinOf('梁子安', 'name', dict)).toBe('liang2 zi3 an1');
    expect(pinyinOf('王金发', 'name', dict)).toBe('wang2 jin1 fa1');
    expect(pinyinOf('张振兴', 'name', dict).split(' ')[2]).toBe('xing1');
    expect(pinyinOf('乔冠华', 'name', dict).split(' ')[1]).toBe('guan4');
    expect(pinyinOf('张都监', 'name', dict).split(' ')[1]).toBe('du1');
    expect(pinyinOf('孫乾', 'name', dict)).toBe('sun1 qian2');
    // 术 is zhú in a transliterated name, shù after a Chinese surname.
    expect(pinyinOf('哈术', 'name', dict)).toBe('ha1 zhu2');
    expect(pinyinOf('袁术', 'name', dict)).toBe('yuan2 shu4');
    // An office in 长 is zhǎng; 关云长 keeps cháng. A temple in 观 is guàn.
    expect(pinyinOf('事务长', 'term', dict).split(' ')[2]).toBe('zhang3');
    expect(pinyinOf('关云长', 'name', dict)).toBe('guan1 yun2 chang2');
    expect(pinyinOf('黄花观', 'place', dict)).toBe('huang2 hua1 guan4');
    expect(pinyinOf('宁采臣', 'name', dict).split(' ')[0]).toBe('ning4');
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

  // The synthetic novel plus a few dozen lines that put one string in front of a verb of speech.
  const withLines = (make: (i: number) => string) => {
    const filler = ['今天天气很好', '我们都知道这件事', '他慢慢地走了过来', '大家一起去吃饭', '没有人看见那个孩子', '外面下着大雨'];
    const fill = (i: number) => filler[(i * 7) % filler.length];
    return `${novel(5, 400)}\n${Array.from({ length: 60 }, (_, i) => make(i).replace(/F(\d)/g, (_, k) => fill(i + Number(k)))).join('\n')}`;
  };

  it('does not take a string that runs into the verb after it (操大 + 笑曰) for a speaker, but keeps 阮小二 + 道', async () => {
    const dict = await dictP;
    const text = withLines((i) => [`F0。操大笑曰：“F1。”`, `F0，操大怒，F2。`, `F0，操大喜，F3。`][i % 3]);
    expect(detectTerms([text], dict).map((e) => e.word)).not.toContain('操大');
    // 二道 is a word, but a person who speaks is followed by 道 all the time.
    const spoken = withLines((i) => [`F0。阮小二道：“F1。”`, `F0，阮小二F2。`, `F0，阮小二和他F3。`][i % 3]);
    expect(detectTerms([spoken], dict).find((e) => e.word === '阮小二')?.kind).toBe('name');
  });

  it('adds the dictionary name that holds a found name (关云长 around 云长), with its dictionary reading', async () => {
    const dict = await dictP;
    const text = withLines((i) => [`F0。云长道：“F1。”`, `F0，关云长F2。`, `F0，云长F3。`, `F0，云长F2。`][i % 4]);
    const by = new Map(detectTerms([text], dict).map((e) => [e.word, e]));
    expect(by.get('云长')?.kind).toBe('name');
    expect(by.get('关云长')).toMatchObject({ kind: 'name', pinyin: 'guan1 yun2 chang2', count: 15 });
    const lex = buildLexicon([...by.values()]);
    expect(segment('关云长道', dict, lex)[0].text).toBe('关云长');
  });

  // A novel's people among varied neighbors: each name opens a line after one of many openers and before one of many endings.
  const people = (names: Record<string, number>, extra: (pick: <T>(a: readonly T[]) => T) => string[] = () => []): string => {
    let x = 11;
    const pick = <T,>(a: readonly T[]): T => { // mulberry32
      x = (x + 0x6d2b79f5) >>> 0;
      let t = x;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return a[((t ^ (t >>> 14)) >>> 0) % a.length];
    };
    const openers = ['', '这时', '后来', '那天', '于是', '晚上', '我知道', '他看见', '大家都说', '只有', '原来', '可是', '正好', '今年', '其实'];
    const endings = ['说：“今天天气很好。”', '笑了笑。', '走了过来。', '看了看窗外。', '点了点头。', '的母亲在门口等着。', '跟他一起去吃饭。', '没有说话。', '也来了。', '一个人坐着。'];
    const lines: string[] = [];
    for (const [name, k] of Object.entries(names)) for (let i = 0; i < k; i++) lines.push(`${pick(openers)}${name}${pick(endings)}`);
    lines.push(...extra(pick));
    for (let i = lines.length - 1; i > 0; i--) { const j = pick([...Array(i + 1).keys()]); [lines[i], lines[j]] = [lines[j], lines[i]]; }
    return `${novel(9, 1200)}\n${lines.join('\n')}`;
  };

  it('adds the family of a found name: its given name alone, and a brother who shares the generation character', async () => {
    const dict = await dictP;
    const text = people({ 王建国: 30, 建国: 40, 赵立平: 60, 立平: 12, 张志刚: 40, 张志强: 12, 志强: 30, 张书记: 10, 王书记: 10 },
      (pick) => Array.from({ length: 8 }, () => `${pick(['', '那天', '后来'])}单家的院子里很安静。`));
    const by = new Map(detectTerms([text], dict).map((e) => [e.word, e]));
    for (const w of ['王建国', '赵立平', '张志刚', '张志强']) expect(by.get(w)?.kind, w).toBe('name');
    // 立平 stands mostly after 赵: found only as the given name of 赵立平.
    expect(by.get('立平')).toMatchObject({ kind: 'name', pinyin: 'li4 ping2', gloss: 'name (person), short for 赵立平' });
    // 建国 is a dictionary word: the book uses it far more often than other text, so it is the name here, and its card
    // keeps the word's meaning.
    expect(by.get('建国')?.kind).toBe('name');
    expect(by.get('建国')?.gloss).toMatch(/^name \(person\), short for 王建国; as a word: /);
    // 书记 follows two surnames: a title, never a given name.
    expect(by.has('书记')).toBe(false);
    // The book has 单雨晴, so 单家 is the Shàn family's household, not dān.
    expect(by.get('单家')).toMatchObject({ kind: 'place', pinyin: 'shan4 jia1' });
  });

  it('finds a nickname in a numeral, a surname with a kinship title, and a pair that is spoken to; not a description', async () => {
    const dict = await dictP;
    const text = people({ 老木匠: 40, 赵大奶奶: 40, 赵五: 30, 春桃: 50 }, (pick) => [
      ...Array.from({ length: 12 }, () => `${pick(['', '那天', '后来'])}叫赵五过来。`),
      ...Array.from({ length: 10 }, () => `${pick(['', '那天', '后来'])}对春桃说了一句。`),
    ]);
    const by = new Map(detectTerms([text], dict).map((e) => [e.word, e]));
    expect(by.get('赵五')?.kind).toBe('name');
    expect(by.get('赵大奶奶')).toMatchObject({ kind: 'name', pinyin: 'zhao4 da4 nai3 nai5' });
    expect(by.get('春桃')?.kind).toBe('name');
    // 老木匠 is "the old carpenter": the dictionary has 木匠, and the card would hide it.
    expect(by.has('老木匠')).toBe(false);
  });

  it('finds a name called out at the start of what is said, a nickname in 麻子 or 脖子, and a foreign word that opens with a surname', async () => {
    const dict = await dictP;
    const text = people({ 苇官: 30, 牛麻子: 25, 灰脖子: 25 }, (pick) => [
      ...Array.from({ length: 25 }, () => `“苇官，${pick(['快回家', '别跑了', '吃饭了', '过来', '你听着'])}！”`),
      ...Array.from({ length: 10 }, () => `${pick(['', '那天', '后来'])}叫牛麻子过来。`),
      ...Array.from({ length: 30 }, () => `${pick(['', '那天', '后来', '原来', '我看见', '只有'])}沙达拉威${pick(['人住在山里', '的骆驼', '部落来了', '女人不说话', '孩子跑了', '，大家都知道', '族很穷'])}。`),
    ]);
    const by = new Map(detectTerms([text], dict).map((e) => [e.word, e]));
    expect(by.get('苇官')).toMatchObject({ kind: 'name', pinyin: 'wei3 guan1' });
    expect(by.get('牛麻子')).toMatchObject({ kind: 'name', pinyin: 'niu2 ma2 zi5' });
    expect(by.get('灰脖子')?.kind).toBe('name');
    // (Seen after 看见 and 只有 here, so the judge takes it for a people's or a person's name; either way it is found.)
    expect(by.get('沙达拉威')?.pinyin).toBe('sha1 da2 la1 wei1');
  });

  it('finds a name that ends in 才 when the rest of it never stands alone, and the household of a surname the dictionary calls a town', async () => {
    const dict = await dictP;
    const text = people({ 邹永才: 30, 段秋生: 40, 墨青禾: 40 }, (pick) => [
      ...Array.from({ length: 10 }, () => `${pick(['', '那天', '后来'])}段家门口摆着三只陶缸。`),
      ...Array.from({ length: 10 }, () => `${pick(['', '那天', '后来'])}墨家的道理很深。`),
    ]);
    const by = new Map(detectTerms([text], dict).map((e) => [e.word, e]));
    expect(by.get('邹永才')).toMatchObject({ kind: 'name', pinyin: 'zou1 yong3 cai2' });
    // The dictionary has 段家 only as a town: here it is the household of 段秋生. 墨家 is the Mohist school, not a town.
    expect(by.get('段家')).toMatchObject({ kind: 'place', pinyin: 'duan4 jia1', gloss: 'the 段 family (a household in this book)' });
    expect(by.has('墨家')).toBe(false);
  });

  it('finds a person named a dozen times, never apart and always opening a clause, but not a pair always after one character', async () => {
    const dict = await dictP;
    const tails = ['独自出门', '写下三行小字', '走到河边', '想起旧事', '又来到这里', '坐在树下', '看见一扇门', '听到敲门声', '叹了口气', '描完一张草图', '记住了那个人', '回到城里'];
    const intro = (before: string) => tails.map((t, i) => `${['那年', '后来', '据说', '有一天'][i % 4]}${before}祁翊${t}。`).join('\n');
    const found = (before: string) => new Map(detectTerms([`${novel(9, 2500)}\n${intro(before)}`], dict).map((e) => [e.word, e]));
    expect(found('，').get('祁翊')?.kind).toBe('name');
    expect(found('的').has('祁翊')).toBe(false);
  });

  it('finds a second name that ends like a main character’s, where the main name holds most of that character', async () => {
    const dict = await dictP;
    expect(dict.freq('长穗')).toBe(0);
    expect(dict.hasWord('长穗')).toBe(false);
    const text = (grain: number) => people({ 秋穗: 200, 长穗: 30 }, (pick) => [
      ...Array.from({ length: 180 }, () => `${pick(['这条路很长', '他长高了', '河水很长很长', '尾巴长得出奇', '长大以后再说'])}。`),
      ...Array.from({ length: grain }, () => `${pick(['', '那天', '后来'])}地里的麦穗黄了。`),
    ]);
    expect(new Map(detectTerms([text(5)], dict).map((e) => [e.word, e])).get('长穗')?.kind).toBe('name');
    // When the character is common outside the main name (麦穗 everywhere), the pair is not singled out.
    expect(new Map(detectTerms([text(100)], dict).map((e) => [e.word, e])).has('长穗')).toBe(false);
  });

  it('adds a full name seen a few times when no other surname ever stands before the given name, but not a nickname’s last character', async () => {
    const dict = await dictP;
    const lines = (pre: string) => ['那天', '后来', '其实', '我知道'].map((o) => `${o}${pre}春妮走了过来。`);
    const with4 = new Map(detectTerms([people({ 春妮: 150 }, () => lines('纪'))], dict).map((e) => [e.word, e]));
    expect(with4.get('春妮')?.kind).toBe('name');
    expect(with4.get('纪春妮')).toMatchObject({ kind: 'name', count: 4 });
    // 雷 here is the end of a nickname (赛天雷), not a surname: it always follows the same character.
    const nick = new Map(detectTerms([people({ 春妮: 150 }, () => lines('赛天雷'))], dict).map((e) => [e.word, e]));
    expect(nick.has('雷春妮')).toBe(false);
  });

  it('reads a princess by her own name: 华 is huá when the book calls her …公主', async () => {
    const dict = await dictP;
    const plain = new Map(detectTerms([people({ 华蓁: 60 })], dict).map((e) => [e.word, e]));
    expect(plain.get('华蓁')?.pinyin).toBe('hua4 zhen1');
    const princess = people({ 华蓁: 60 }, (pick) => Array.from({ length: 8 }, () => `${pick(['', '那天', '后来'])}华蓁公主来了。`));
    expect(new Map(detectTerms([princess], dict).map((e) => [e.word, e])).get('华蓁')?.pinyin).toBe('hua2 zhen1');
  });

  it('judges terms, towns and people by the counts that tell them apart', async () => {
    const dict = await dictP;
    const cand = (word: string, over: Partial<TermCandidate>): TermCandidate => ({
      word, count: 100, bind: 0.7, pmi: 7.5, left: 3, right: 3, speech: 0, prep: 0, known: 'none', kind: 'term', surnameLed: false, rate: 0.5, ...over,
    });
    // A role the book names again and again (摆渡者, 守塔人), and a pair as bound as a name that never speaks (青崖).
    expect(judgeCandidate(cand('守塔人', {}), dict)?.kind).toBe('term');
    expect(judgeCandidate(cand('青崖', {}), dict)?.kind).toBe('term');
    // A town in two characters (砚城) is a place.
    expect(judgeCandidate(cand('砚城', {}), dict)?.kind).toBe('place');
    // A pair that is spoken to and speaks is a person; spoken to but silent (a dog, a hill) it is not.
    expect(judgeCandidate(cand('春桃', { bind: 0.5, pmi: 6, prep: 0.15, speech: 0.03 }), dict)?.kind).toBe('name');
    expect(judgeCandidate(cand('春桃', { bind: 0.5, pmi: 6, prep: 0.15, speech: 0 }), dict)).toBeNull();
    // A word the dictionary lists but the corpus never saw becomes the book's term only when the book uses it once in a
    // thousand characters or more (钉钯 is commoner than that in 西遊記, and stays the dictionary's word).
    const unseen = cand('钉钯', { known: 'entry', count: 300, bind: 0.45, pmi: 5, prep: 0.02 });
    expect(dict.freq('钉钯')).toBe(0);
    expect(judgeCandidate({ ...unseen, rate: 1.5 }, dict)?.kind).toBe('term');
    expect(judgeCandidate({ ...unseen, rate: 0.3 }, dict)).toBeNull();
    // A common word ("mother and father") that a book uses hundreds of times more often than other text, speaking, is a
    // person there; a proper noun the dictionary already explains (宋江) is left to the dictionary.
    const common = cand('二老', { known: 'entry', count: 150, bind: 0.8, pmi: 4.4, speech: 0.09, prep: 0.1, key: 1500 });
    expect(judgeCandidate(common, dict)?.kind).toBe('name');
    expect(judgeCandidate({ ...common, key: 40 }, dict)).toBeNull();
    expect(judgeCandidate({ ...common, word: '宋江' }, dict)).toBeNull();
    // A pair called out at the start of what someone says a third of the time (“四毛，…”) is a person, though it opens with
    // a numeral; an interjection said the same way (哎哟-like) and a looser pair are not.
    const called = cand('四毛', { count: 62, bind: 0.67, pmi: 5.7, left: 1.9, right: 2.3, speech: 0.02, voc: 0.39 });
    expect(judgeCandidate(called, dict)?.kind).toBe('name');
    expect(judgeCandidate({ ...called, voc: 0.1 }, dict)).toBeNull();
    expect(judgeCandidate({ ...called, word: '嗳呦' }, dict)).toBeNull();
    expect(judgeCandidate({ ...called, bind: 0.42 }, dict)).toBeNull();
    // A nickname's tail after a trait, its first two characters never apart, spoken to: a person; a description is not.
    const nick = cand('灰脖子', { count: 74, bind: 0.44, pmi: 4.3, left: 2.6, right: 3.4, speech: 0.16, prep: 0.05, head: 74 });
    expect(judgeCandidate(nick, dict)?.kind).toBe('name');
    expect(judgeCandidate({ ...nick, head: 300 }, dict)).toBeNull();
    expect(judgeCandidate({ ...nick, word: '跛女子' }, dict)).toBeNull();
    // A foreign word that opens with a surname character is not a surname and a given name, unless it opens a dictionary word.
    expect(judgeCandidate(cand('沙达拉威', { count: 68, bind: 1, pmi: 5.3, left: 2.7, right: 1.7, prep: 0.07, head: 69 }), dict)?.kind).toBe('term');
    expect(judgeCandidate(cand('柴油机厂', { count: 19, bind: 0.95, pmi: 5, left: 2.7, right: 2, head: 19 }), dict)).toBeNull();
  });

  it('reads a short text with a lower count but keeps only places and spoken-to names whose characters are never apart', async () => {
    const dict = await dictP;
    const text = `${['我们到了白鹭湖。', '白鹭湖边有一座小屋，我们都知道这件事。', '他说那里的人都很友好。', '后来又去白鹭湖看了看。', '外面下着大雨，大家一起去吃饭。'].join('\n')}\n${novel(3, 150)}`;
    const by = new Map(detectTerms([text], dict).map((e) => [e.word, e]));
    expect(by.get('白鹭湖')?.kind).toBe('place');
    // Nothing else seen three times becomes an entry: no fragment of the sentences.
    for (const e of by.values()) expect(['白鹭湖', '莫远峰', '单雨晴', '欧阳无忌', '紫霞岛', '落星庄', '玄冥神掌', '青云剑法'], e.word).toContain(e.word);
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
