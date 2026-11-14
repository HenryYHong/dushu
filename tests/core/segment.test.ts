import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { segment } from '../../src/core/segment';
import { buildLexicon } from '../../src/core/lexicon';
import { countHan } from '../../src/core/text';
import type { Dictionary, Token } from '../../src/types';
import { loadTestDictionary, readRows } from '../helpers/data';
import { measure, PERF_SLACK } from '../helpers/perf';

/**
 * The best of several timed runs, each by the smaller of its clocks: sharing the processors with the other tests stretches the
 * wall clock, the garbage collector's threads stretch CPU time, and a real slowdown stretches both.
 */
const fastest = (runs: { wall: number; cpu: number }[]) => Math.min(...runs.map((r) => Math.min(r.wall, r.cpu)));
import { GOLD, HELDOUT } from './gold';

const dictP = loadTestDictionary();
const words = (tokens: Token[]) => tokens.map((t) => t.text);

/** Every token must cover the paragraph exactly. */
function expectExactCoverage(text: string, tokens: Token[]): void {
  expect(tokens.map((t) => t.text).join('')).toBe(text);
  let pos = 0;
  for (const t of tokens) {
    expect(t.start).toBe(pos);
    expect(t.end).toBe(pos + t.text.length);
    expect(text.slice(t.start, t.end)).toBe(t.text);
    expect(t.text.length).toBeGreaterThan(0);
    pos = t.end;
  }
  expect(pos).toBe(text.length);
}

describe('segment: the sentences from the spec', () => {
  it('我们在银行门口见面。', async () => {
    const d = await dictP;
    expect(words(segment('我们在银行门口见面。', d))).toEqual(['我们', '在', '银行', '门口', '见面', '。']);
  });
  it('他慢慢地走了过来。 (地 -> de, 了 -> le)', async () => {
    const d = await dictP;
    const t = segment('他慢慢地走了过来。', d);
    expect(words(t)).toEqual(['他', '慢慢', '地', '走', '了', '过来', '。']);
    expect(t[2].pinyin).toEqual(['de5']);
    expect(t[4].pinyin).toEqual(['le5']);
    expect(t[1].pinyin).toEqual(['man4', 'man4']);
  });
  it('長江是中國最長的河流。 (traditional)', async () => {
    const d = await dictP;
    const t = segment('長江是中國最長的河流。', d);
    // 最長 is a common jieba compound (words.tsv); it must still read zuì cháng, not zhǎng.
    expect(words(t)).toEqual(['長江', '是', '中國', '最長', '的', '河流', '。']);
    expect(t[0].pinyin).toEqual(['chang2', 'jiang1']);
    expect(t[3].pinyin).toEqual(['zui4', 'chang2']);
    expect(t[4].pinyin).toEqual(['de5']);
  });
  it('single astral characters are one token each, with readings where Unihan has them', async () => {
    const d = await dictP;
    for (const [ch, py] of [['𠀀', 'he1'], ['𪚥', 'zhe2'], ['𰻞', 'biang2']] as const) {
      const t = segment(ch, d);
      expect(t).toHaveLength(1);
      expect(t[0]).toMatchObject({ text: ch, start: 0, end: 2, kind: 'han', pinyin: [py] });
    }
    const all = segment('𠀀𪚥𰻞', d);
    expect(words(all)).toEqual(['𠀀', '𪚥', '𰻞']);
    expect(all.map((t) => [t.start, t.end])).toEqual([[0, 2], [2, 4], [4, 6]]);
  });
});

describe('segment: gold set', () => {
  /** Boundary positions as "start:end" spans. */
  const spans = (parts: string[]) => {
    const s = new Set<string>();
    let o = 0;
    for (const p of parts) { s.add(`${o}:${o + p.length}`); o += p.length; }
    return s;
  };
  function score(d: Dictionary, items: typeof GOLD) {
    let tp = 0, gp = 0, pp = 0, exact = 0;
    const misses: string[] = [];
    for (const g of items) {
      const gold = g.gold.split('|');
      const pred = words(segment(gold.join(''), d));
      const gs = spans(gold);
      const ps = spans(pred);
      for (const x of ps) if (gs.has(x)) tp++;
      gp += gs.size;
      pp += ps.size;
      if (pred.join('|') === g.gold) exact++;
      else misses.push(`${g.id}\n    gold ${g.gold}\n    pred ${pred.join('|')}`);
    }
    const p = tp / pp, r = tp / gp;
    return { sentences: items.length, exact, precision: p, recall: r, f1: (2 * p * r) / (p + r), misses };
  }

  it('has at least 30 sentences covering every kind of text', () => {
    expect(GOLD.length).toBeGreaterThanOrEqual(30);
    const kinds = new Set(GOLD.map((g) => g.kind));
    expect([...kinds].sort()).toEqual(['classical', 'dialogue', 'mixed', 'simplified', 'traditional']);
  });

  it('every gold sentence is well formed', () => {
    for (const g of GOLD) {
      expect(g.gold.split('|').every((p) => p.length > 0), g.id).toBe(true);
      expect(new Set(GOLD.map((x) => x.id)).size).toBe(GOLD.length);
    }
  });

  it('reaches F1 >= 0.95 overall and on each kind of text', async () => {
    const d = await dictP;
    const all = score(d, GOLD);
    console.log(
      `segmentation gold set: ${all.sentences} sentences, ${all.exact} exact, ` +
        `precision ${all.precision.toFixed(3)}, recall ${all.recall.toFixed(3)}, F1 ${all.f1.toFixed(3)}` +
        (all.misses.length ? '\n  misses:\n  ' + all.misses.join('\n  ') : ''),
    );
    expect(all.f1).toBeGreaterThanOrEqual(0.95);
    expect(all.exact / all.sentences).toBeGreaterThanOrEqual(0.9);
    for (const kind of ['simplified', 'traditional', 'mixed', 'dialogue', 'classical'] as const) {
      const s = score(d, GOLD.filter((g) => g.kind === kind));
      expect(s.f1, kind).toBeGreaterThanOrEqual(0.9);
    }
  });

  it('holds up on sentences it was never tuned on', async () => {
    const d = await dictP;
    expect(HELDOUT.length).toBeGreaterThanOrEqual(30);
    const s = score(d, HELDOUT);
    console.log(
      `held-out set: ${s.sentences} sentences, ${s.exact} exact, precision ${s.precision.toFixed(3)}, ` +
        `recall ${s.recall.toFixed(3)}, F1 ${s.f1.toFixed(3)}` + (s.misses.length ? '\n  misses:\n  ' + s.misses.join('\n  ') : ''),
    );
    expect(s.f1).toBeGreaterThanOrEqual(0.93);
  });

  it('segments the traditional conversion of the simplified sentences about as well', async () => {
    const d = await dictP;
    const simp = GOLD.filter((g) => g.kind === 'simplified');
    const trad = simp.map((g) => ({ ...g, kind: 'traditional' as const, gold: g.gold.split('|').map((p) => d.toTraditional(p)).join('|') }));
    const s = score(d, trad);
    expect(s.f1).toBeGreaterThanOrEqual(0.95);
  });
});

describe('segment: exact coverage and token kinds', () => {
  const samples = [
    '', ' ', '\n', '你好', '你好，世界！', 'Hello, world', '12345', '３．１４', '𠀀𪚥𰻞',
    'a𠀀b', '😀人😀', '\ud800人', '人\udc00', '“你好，”他说。', '「あいう」', '한국어 中文',
    'é人', '人️', 'x\t\ty\r\nz', '3D打印机', 'AA制', '《红楼梦》（上）', '你……好', '—— 破折号',
    '１２３ＡＢＣ', '第3章', '5,000元', "don't 走", 'x-ray 光', '人'.repeat(1000), '\u{323B0}\u{30000}\u{2F800}\u{F900}\u{2F08}',
  ];
  for (const text of samples) {
    it(`covers ${JSON.stringify(text.length > 30 ? text.slice(0, 30) + '…' : text)} exactly`, async () => {
      const d = await dictP;
      const tokens = segment(text, d);
      expectExactCoverage(text, tokens);
      for (const t of tokens) {
        if (t.kind === 'han') expect(t.pinyin, t.text).toHaveLength([...t.text].length);
        else expect(t.pinyin).toBeUndefined();
      }
    });
  }

  it('returns no tokens for an empty paragraph', async () => {
    expect(segment('', await dictP)).toEqual([]);
  });

  it('classifies characters', async () => {
    const d = await dictP;
    const kinds = (s: string) => segment(s, d).map((t) => `${t.kind}:${t.text}`);
    expect(kinds('我有3个苹果, ok?')).toEqual(['han:我', 'han:有', 'num:3', 'han:个', 'han:苹果', 'punct:,', 'space: ', 'latin:ok', 'punct:?']);
    expect(kinds('一二三').every((k) => k.startsWith('han:'))).toBe(true); // Chinese numerals stay Han
    expect(kinds('１２３')).toEqual(['num:１２３']);
    expect(kinds('3.14')).toEqual(['num:3.14']);
    expect(kinds('1,000')).toEqual(['num:1,000']);
    expect(kinds('3. 4')).toEqual(['num:3', 'punct:.', 'space: ', 'num:4']);
    expect(kinds('ＡＢＣ')).toEqual(['latin:ＡＢＣ']);
    expect(kinds("don't")).toEqual(['latin:don\'t']);
    expect(kinds('x-ray')).toEqual(['latin:x-ray']);
    expect(kinds('café')).toEqual(['latin:café']);
    expect(kinds('，。！？、；：')).toEqual(['punct:，', 'punct:。', 'punct:！', 'punct:？', 'punct:、', 'punct:；', 'punct:：']);
    expect(kinds('“”「」『』（）《》〈〉【】')).toHaveLength(14);
    expect(kinds('“”「」『』（）《》〈〉【】').every((k) => k.startsWith('punct:'))).toBe(true);
    expect(kinds('……')).toEqual(['punct:…', 'punct:…']);
    expect(kinds('$+=')).toEqual(['punct:$', 'punct:+', 'punct:=']);
    expect(kinds('  　\n')).toEqual(['space:  　\n']);
    expect(kinds('😀')).toEqual(['other:😀']);
    expect(kinds('あいう')).toEqual(['other:あいう']);
    expect(kinds('привет')).toEqual(['other:привет']);
    expect(kinds('〇')).toEqual(['han:〇']);
    expect(kinds('𠀀a')).toEqual(['han:𠀀', 'latin:a']);
  });

  it('keeps each punctuation mark as its own token', async () => {
    const d = await dictP;
    const t = segment('“你好！”', d);
    expect(words(t)).toEqual(['“', '你好', '！', '”']);
    expect(t.filter((x) => x.kind === 'punct')).toHaveLength(3);
  });

  it('does not segment across non-Han characters', async () => {
    const d = await dictP;
    expect(words(segment('银行3行', d))).toEqual(['银行', '3', '行']);
    expect(words(segment('银行 行走', d))).toEqual(['银行', ' ', '行走']);
  });

  it('marks tokens that are dictionary headwords', async () => {
    const d = await dictP;
    const t = segment('银行好𠀀', d);
    expect(t.map((x) => [x.text, x.inDict])).toEqual([['银行', true], ['好', true], ['𠀀', false]]);
    expect(segment('，', d)[0].inDict).toBe(false);
    expect(segment('abc', d)[0].inDict).toBe(false);
  });

  it('gives the neighbouring tokens to pinyinFor', async () => {
    const d = await dictP;
    // 地 is dì in 在地上-style text and de after an adverb; only the neighbours differ
    expect(segment('慢慢地说', d).find((t) => t.text === '地')!.pinyin).toEqual(['de5']);
    expect(segment('的地', d).find((t) => t.text === '地')!.pinyin).toEqual(['di4']);
    expect(segment('“地', d).find((t) => t.text === '地')!.pinyin).toEqual(['di4']);
    expect(segment('一只猫', d).find((t) => t.text === '只')!.pinyin).toEqual(['zhi1']);
    expect(segment('3只猫', d).find((t) => t.text === '只')!.pinyin).toEqual(['zhi1']);
  });
});

describe('segment: algorithm properties', () => {
  it('prefers the more probable path (longer common words beat unseen splits)', async () => {
    const d = await dictP;
    expect(words(segment('研究生命的起源', d))).toEqual(['研究', '生命', '的', '起源']);
    expect(words(segment('结婚的和尚未结婚的', d))).toContain('尚未');
    expect(words(segment('南京市长江大桥', d))[0]).toBe('南京市');
  });
  it('splits text made only of unknown characters into single characters', async () => {
    const d = await dictP;
    const t = segment('龘龘龘', d);
    expect(words(t).join('')).toBe('龘龘龘');
    expect(t.every((x) => x.kind === 'han')).toBe(true);
  });
  it('handles Kangxi radicals and compatibility ideographs in the middle of a word', async () => {
    const d = await dictP;
    const t = segment('我⼈们', d); // 我⼈们: the radical is not 人 for the matcher, but must not break coverage
    expectExactCoverage('我⼈们', t);
    expect(segment('⼈', d)[0].pinyin).toEqual(d.pinyinFor('人'));
  });
  it('is deterministic and does not mutate the dictionary', async () => {
    const d = await dictP;
    const a = segment('我们在银行门口见面。', d);
    const b = segment('我们在银行门口见面。', d);
    expect(a).toEqual(b);
    a[0].pinyin![0] = 'xxx';
    expect(segment('我们在银行门口见面。', d)[0].pinyin).toEqual(['wo3', 'men5']);
  });
});

describe('segment: context rules from reading the books', () => {
  const cut = async (s: string) => words(segment(s, await dictP));

  it('gives a measure word to the numeral or demonstrative before it (两个人, 三年前, 几口水, 那头羊)', async () => {
    expect(await cut('我们两个人一起去。')).toEqual(expect.arrayContaining(['两', '个', '人']));
    expect(await cut('有个人在门口等你。')).not.toContain('个人');
    expect(await cut('那是她个人的选择。')).toContain('个人');
    expect(await cut('三年前他来过这里。')).not.toContain('年前');
    expect(await cut('二十多年前的事。')).not.toContain('年前');
    expect(await cut('他们年前就回家了。')).toContain('年前');
    expect(await cut('她喝了两口水。')).not.toContain('口水');
    expect(await cut('那头羊很瘦。')).toEqual(['那', '头', '羊', '很', '瘦', '。']);
    expect(await cut('磕了四个头。')).not.toContain('个头');
    expect(await cut('过了三日后再来。')).not.toContain('日后');
  });

  it('reads 的话 as 的 + 话 "words" unless it closes a conditional clause', async () => {
    expect(await cut('他的话很对。')).toEqual(['他', '的', '话', '很', '对', '。']);
    expect(await cut('听我的话。')).toEqual(['听', '我', '的', '话', '。']);
    expect(await cut('有几句要紧的话，你听着。')).not.toContain('的话');
    expect(await cut('如果你不去的话，我也不去。')).toContain('的话');
    expect(await cut('你不去的话，我也不去。')).toContain('的话');
    expect(await cut('否则的话，就晚了。')).toContain('的话');
  });

  it('cuts 才能 before a verb (only then can), keeps the noun "talent"', async () => {
    expect(await cut('多练习才能进步。')).toEqual(['多', '练习', '才', '能', '进步', '。']);
    expect(await cut('他的才能很出众。')).toContain('才能');
    expect(await cut('发挥他的才能。')).toContain('才能');
  });

  it('reads 马上 as "on horseback" after 在, 于, 骑 and a verb of riding, and "at once" elsewhere', async () => {
    expect(await cut('他骑在马上。')).not.toContain('马上');
    expect(await cut('将军立于马上。')).not.toContain('马上');
    expect(await cut('他催马上前。')).toContain('上前');
    expect(await cut('她马上就到。')).toContain('马上');
    expect(await cut('现在马上走。')).toContain('马上');
  });

  it('cuts 将来 after a verb of motion in the old novels (赶将来), keeps "future"', async () => {
    expect(await cut('众人一齐赶将来。')).not.toContain('将来');
    expect(await cut('箭如雨点射将来，')).not.toContain('将来');
    expect(await cut('在遥远的将来，')).toContain('将来');
    expect(await cut('他考虑将来的事。')).toContain('将来');
  });

  it('reads 着 after a verb as the particle (挥着手, 闭着眼, 想着想着), keeps 着手 and 着想 where they are words', async () => {
    expect(await cut('他挥着手跑过来。')).toEqual(expect.arrayContaining(['挥', '着', '手']));
    expect(await cut('她闭着眼睡觉。')).not.toContain('着眼');
    expect(await cut('他靠着火取暖。')).not.toContain('着火');
    expect(await cut('想着想着就睡着了。')).not.toContain('着想');
    expect(await cut('你要为他着想。')).toContain('着想');
    expect(await cut('他立即着手准备。')).toContain('着手');
    expect(await cut('房子着火了。')).toContain('着火');
  });

  it('cuts 过头 after a verb of turning (回过头), keeps "overdo"', async () => {
    expect(await cut('他回过头去望。')).not.toContain('过头');
    expect(await cut('她扭过头来。')).not.toContain('过头');
    expect(await cut('玩笑开过头了。')).toContain('过头');
  });

  it('reads the speech verb 道 after its speaker before a colon (众僧道：, 低声道：), not 僧道 or 声道', async () => {
    expect(await cut('众僧道：“请进。”')).toEqual(expect.arrayContaining(['僧', '道', '：']));
    expect(await cut('她低声道：“我怕。”')).toEqual(expect.arrayContaining(['低声', '道']));
    expect(await cut('他说道：“好。”')).toContain('说道');
    expect(await cut('我知道：他不会来。')).toContain('知道');
    expect(await cut('张道长来了。')).toEqual(['张', '道长', '来', '了', '。']);
    expect(await cut('车道长度不够。')).toEqual(expect.arrayContaining(['车道', '长度']));
  });

  it('makes a number written in characters one token (三十六, 一百零八, 二十多), but not the tael or 千米', async () => {
    expect(await cut('他走了三十六里路。')).toContain('三十六');
    expect(await cut('一共四十五块钱。')).toContain('四十五');
    expect(await cut('一百零八将')).toContain('一百零八');
    expect(await cut('买了二十多本书。')).toContain('二十多');
    expect(await cut('再等十分钟吧。')).toEqual(expect.arrayContaining(['十', '分钟']));
    expect(await cut('六十分以上')).toEqual(['六十', '分', '以上']);
    expect(await cut('五十两银子')).toEqual(['五十', '两', '银子']);
    expect(await cut('十五两三钱')).toEqual(expect.arrayContaining(['十五', '两']));
    expect(await cut('飞了三十八千米。')).toEqual(expect.arrayContaining(['三十八', '千米']));
    expect(await cut('她十分满意。')).toContain('十分');
    expect(await cut('万一他不来呢？')).toContain('万一');
    expect(await cut('三十六计，走为上计。')).toContain('三十六计');
  });

  it('cuts 把 + noun when 把 marks the object (把手放在, 把门关上), keeps 门把手 and the gatekeeper 把门的', async () => {
    expect(await cut('她把手搭在椅背上。')).toEqual(expect.arrayContaining(['把', '手']));
    expect(await cut('他把头低下了。')).not.toContain('把头');
    expect(await cut('请把门关上。')).toEqual(['请', '把', '门', '关上', '。']);
    expect(await cut('门口站着把门的。')).toContain('把门');
    expect(await cut('他拉住门把手。')).toContain('门把手');
  });

  it('cuts 地上 地点 地面 after an adverb with 地 (慢慢地上楼, 满意地点着头, 勇敢地面对)', async () => {
    expect(await cut('他慢慢地上楼。')).not.toContain('地上');
    expect(await cut('他满意地点着头。')).not.toContain('地点');
    expect(await cut('她勇敢地面对困难。')).toContain('面对');
    expect(await cut('书掉在地上了。')).toContain('地上');
    expect(await cut('他不时地被人推。')).not.toContain('地被');
  });

  it('gives an unseen noun in 子 its 子 (簪子, 穗子), but not across a word (我孙子, 不肖子孙)', async () => {
    expect(await cut('她插着一根簪子。')).toContain('簪子');
    expect(await cut('帽子上挂着穗子。')).toContain('穗子');
    expect(await cut('拿给我孙子吃。')).toEqual(expect.arrayContaining(['我', '孙子']));
    expect(await cut('他是不肖子孙。')).not.toContain('不肖子');
  });

  it('reads old connectives at the start of a clause (在下, 是以, 好在) and dialect words meant wherever they appear (二爸, 除过)', async () => {
    expect(await cut('在下姓王。')).toEqual(['在下', '姓', '王', '。']);
    expect(await cut('是以不敢。')).toContain('是以');
    expect(await cut('好在孩子还小。')).toContain('好在');
    expect(await cut('雨还在下，')).not.toContain('在下');
    expect(await cut('他是以客人的身份来的。')).not.toContain('是以');
    expect(await cut('在下一个路口转弯。')).not.toContain('在下');
    expect(await cut('他二爸来了。')).toContain('二爸');
    expect(await cut('除过他，谁也不去。')).toContain('除过');
    expect(await cut('清除过病毒。')).toContain('清除');
  });

  it('cuts words the books never mean in context (是从, 我会, 般地, 去取, 他杀了, 你好没, 二人大惊, 回见)', async () => {
    expect(await cut('他是从北京来的。')).toEqual(expect.arrayContaining(['是', '从']));
    expect(await cut('我会去的。')).toEqual(expect.arrayContaining(['我', '会']));
    expect(await cut('他发疯般地跑。')).toEqual(expect.arrayContaining(['般', '地']));
    expect(await cut('他回家去取钱。')).not.toContain('去取');
    expect(await cut('给他杀了。')).not.toContain('他杀');
    expect(await cut('你好没良心。')).not.toContain('你好');
    expect(await cut('你好吗？')).toContain('你好');
    expect(await cut('二人大惊。')).not.toContain('人大');
    expect(await cut('回见孙权。')).not.toContain('回见');
    expect(await cut('今天下大雨。')).toContain('今天');
    expect(await cut('来回三十里。')).toContain('来回');
    expect(await cut('大人们都走了。')).toEqual(expect.arrayContaining(['大人', '们']));
  });

  it('keeps a locative with the place before it (地上铺满, 水中游着), but not a rank (海军中将)', async () => {
    expect(await cut('地上铺满了落叶。')).toContain('地上');
    expect(await cut('小鱼在水中游来游去。')).not.toContain('中游');
    expect(await cut('他是海军中将。')).toContain('中将');
  });
});

describe('segment: lexicon words against dictionary words', () => {
  const lex = (...words: string[]) =>
    buildLexicon(words.map((word) => ({ word, pinyin: '', gloss: '', kind: 'name' as const, enabled: true, origin: 'auto' as const })));

  it('scores a lexicon word that is also a common word (中学) as that word, and boosts names (云长, 关云长)', async () => {
    const d = await dictP;
    const l = lex('中学', '莫远峰', '云长', '关云长');
    expect(words(segment('城中学校很多。', d, l))).toEqual(['城中', '学校', '很多', '。']);
    expect(words(segment('他在心中学会了忍耐。', d, l))).toEqual(expect.arrayContaining(['心中', '学会']));
    expect(words(segment('中学说：“走吧。”', d, l))).toContain('中学');
    expect(words(segment('莫远峰来了。', d, l))).toContain('莫远峰');
    expect(words(segment('关云长来了。', d, l))).toContain('关云长');
  });

  it('keeps a dictionary phrase that holds a lexicon word whole (大闹天宫 around 闹天宫)', async () => {
    const d = await dictP;
    const l = lex('闹天宫');
    expect(words(segment('他大闹天宫。', d, l))).toContain('大闹天宫');
    expect(words(segment('他要闹天宫。', d, l))).toContain('闹天宫');
  });
});

describe('segment: performance', () => {
  /** Reproducible text of `n` Han characters made from real dictionary words (seeded LCG). */
  async function syntheticHan(n: number): Promise<string> {
    const rows = await readRows('words');
    const pool = rows.filter((r) => Number(r[1]) > 50 && [...r[0]].length >= 1 && [...r[0]].length <= 4 && countHan(r[0]) === [...r[0]].length).map((r) => r[0]);
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    let out = '';
    let count = 0;
    while (count < n) {
      const w = pool[Math.floor(rnd() * pool.length)];
      out += w;
      count += [...w].length;
    }
    return out;
  }

  it('segments 10,000 Han characters in under 60 ms', async () => {
    const d = await dictP;
    const text = (await syntheticHan(10000)).slice(0, 10000);
    expect(countHan(text)).toBeGreaterThanOrEqual(9990);
    segment(text, d); // warm up the JIT and the reading cache on the whole text
    const runs: { wall: number; cpu: number }[] = [];
    for (let i = 0; i < 9; i++) {
      // vary the text a little so the per-word reading cache cannot do all the work
      const shifted = text.slice(i * 7) + text.slice(0, i * 7);
      const m = measure(() => segment(shifted, d));
      runs.push(m);
      expect(m.result.length).toBeGreaterThan(3000);
    }
    console.log(`segment 10k Han chars: cpu ${runs.map((r) => r.cpu.toFixed(1)).join(', ')} ms, wall ${runs.map((r) => r.wall.toFixed(1)).join(', ')} ms`);
    expect(fastest(runs)).toBeLessThan(60 * PERF_SLACK);
  });

  it('segments 10,000 traditional characters in under 60 ms too', async () => {
    const d = await dictP;
    const text = d.toTraditional((await syntheticHan(10000)).slice(0, 10000));
    segment(text, d);
    const runs: { wall: number; cpu: number }[] = [];
    for (let i = 0; i < 9; i++) {
      const shifted = text.slice(i * 11) + text.slice(0, i * 11);
      runs.push(measure(() => segment(shifted, d)));
    }
    console.log(`segment 10k traditional chars: cpu ${runs.map((r) => r.cpu.toFixed(1)).join(', ')} ms`);
    expect(fastest(runs)).toBeLessThan(60 * PERF_SLACK);
  });

  it('scales linearly: 200,000 characters in one paragraph take under 1.5 s', async () => {
    const d = await dictP;
    const text = (await syntheticHan(200000)).slice(0, 200000);
    // Warm up, then the better of two: a single cold pass pays for the JIT too, and with the whole suite running alongside it
    // that alone came to 1.6 s. Going quadratic would cost many times the budget, not a few percent.
    segment(text.slice(0, 2000), d);
    const runs = [measure(() => segment(text, d)), measure(() => segment(text, d))];
    const m = runs[1].cpu < runs[0].cpu ? runs[1] : runs[0];
    console.log(`segment 200k chars: cpu ${m.cpu.toFixed(0)} ms, wall ${m.wall.toFixed(0)} ms`);
    expectExactCoverage(text, m.result);
    expect(m.cpu).toBeLessThan(1500 * PERF_SLACK);
  });

  const huozhe = `${homedir()}/Downloads/活着.epub`;
  it.skipIf(!existsSync(huozhe))('segments a real book (活着.epub, read in place) fast and plausibly', async () => {
    const d = await dictP;
    const xml = execFileSync('unzip', ['-p', huozhe, 'OEBPS/Text/Section0001_split_001.xhtml'], { maxBuffer: 1 << 26 }).toString('utf8');
    const paras = [...xml.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').trim()).filter(Boolean);
    const han = paras.reduce((a, p) => a + countHan(p), 0);
    expect(han).toBeGreaterThan(10000);
    // Best of five, like the timings above: the first pass also pays for JIT warm-up and filling the reading caches (about 3x
    // slower), and CPU time counts the garbage collector's threads too, which can add half again to any one pass.
    const runs = Array.from({ length: 5 }, () => measure(() => paras.map((p) => segment(p, d))));
    const timing = runs.reduce((a, b) => (b.cpu < a.cpu ? b : a));
    const all = timing.result;
    const ms = timing.cpu;
    let tokens = 0;
    let inWords = 0;
    all.forEach((t, i) => {
      expect(t.map((x) => x.text).join('')).toBe(paras[i]);
      tokens += t.length;
      for (const x of t) if (x.kind === 'han' && [...x.text].length > 1) inWords += [...x.text].length;
    });
    console.log(`活着 section: ${han} Han chars, ${tokens} tokens, ${ms.toFixed(0)} ms cpu (${timing.wall.toFixed(0)} ms wall), ${((100 * inWords) / han).toFixed(0)}% of characters in multi-character words`);
    expect(ms / han).toBeLessThan(0.006 * PERF_SLACK); // < 60 ms per 10k characters
    expect(inWords / han).toBeGreaterThan(0.4); // modern Chinese prose is roughly 55-65% in multi-character words
    expect(inWords / han).toBeLessThan(0.8);
  });
});
