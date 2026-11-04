// Names v9 (plan item 3): names that repeat a lot in a short text, names one cue makes sure of, both halves of a ·-name, names in
// Latin letters, anthologies read one story at a time, a dictionary word that is a story's person, and readings inside names.
// Every sentence here is invented.
import { describe, expect, it } from 'vitest';
import { buildLexicon, detectTerms, judgeRepeat, pinyinOf } from '../../src/core/lexicon';
import { segment } from '../../src/core/segment';
import type { LexiconEntry } from '../../src/types';
import { loadTestDictionary } from '../helpers/data';
import { novel } from '../helpers/novel';

const dictP = loadTestDictionary();
const by = (found: LexiconEntry[]) => new Map(found.map((e) => [e.word, e]));
const detect = async (texts: string[]) => by(detectTerms(texts, await dictP));

/** Seeded pick, so every text is the same on every run. */
function picker(seed: number) {
  let x = seed >>> 0;
  return <T,>(a: readonly T[]): T => { // mulberry32
    x = (x + 0x6d2b79f5) >>> 0;
    let t = x;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return a[((t ^ (t >>> 14)) >>> 0) % a.length];
  };
}

const OPENERS = ['', '这时', '后来', '那天', '于是', '晚上', '我知道', '可是', '原来', '其实'];
const ENDINGS = ['笑了笑。', '走了过来。', '看了看窗外。', '点了点头。', '没有说话。', '一个人坐着。', '回到屋里。', '想起了旧事。'];

/** A short story: each name opens `k` lines, with other lines from `extra`, shuffled into a little ordinary prose. */
function story(names: Record<string, number>, extra: (pick: <T>(a: readonly T[]) => T) => string[] = () => [], filler = 150, seed = 5): string {
  const pick = picker(seed);
  const lines: string[] = [];
  for (const [name, k] of Object.entries(names)) for (let i = 0; i < k; i++) lines.push(`${pick(OPENERS)}${name}${pick(ENDINGS)}`);
  lines.push(...extra(pick));
  for (let i = lines.length - 1; i > 0; i--) { const j = pick([...Array(i + 1).keys()]); [lines[i], lines[j]] = [lines[j], lines[i]]; }
  return `${novel(seed, filler)}\n${lines.join('\n')}`;
}

describe('names that repeat a lot', () => {
  it('finds a pair never apart that fills a short story, though its second character is common and no surname leads it', async () => {
    // (In 9,000 characters a name used 80 times cannot reach the pmi a long book gives it: its parts are never apart, which is enough.)
    const text = story({ 素明: 80 }, (pick) => Array.from({ length: 10 }, () => `${pick(['明天', '明白了', '天亮了'])}，${pick(['大家都去了', '雨停了'])}。`));
    const m = await detect([text]);
    expect(m.get('素明')).toMatchObject({ kind: 'name', pinyin: 'su4 ming2' });
  });

  it('finds a pair spoken to again and again though it ends like an office (君), and not an office that speaks in a long book', async () => {
    const m = await detect([story({ 秋君: 30 }, (pick) => Array.from({ length: 12 }, () => `${pick(['我', '他', '母亲'])}${pick(['对', '叫', '和'])}秋君说了一句话。`))]);
    expect(m.get('秋君')?.kind).toBe('name');
  });

  it('finds 阿 and a name, a pet name in 儿 that is called out (ér), and a nickname in 子 (neutral)', async () => {
    const text = story({ 阿柳: 12 }, (pick) => [
      // (A nickname that fills a short story and never speaks: 子 is common, so its pmi stays low; its own rule takes it, with 子 neutral.)
      ...Array.from({ length: 60 }, () => `${pick(['那天', '后来', '晚上', ''])}钧子${pick(['走了过来', '看了看窗外', '回到屋里', '一个人坐着', '没去'])}。`),
      ...Array.from({ length: 8 }, () => `“芸儿${pick(['！快回来！', '，吃饭了！', '，别跑。', '？你在哪里？'])}”母亲喊。`),
      ...Array.from({ length: 4 }, () => `${pick(['', '后来'])}芸儿${pick(['也来了', '笑了'])}。`),
      ...Array.from({ length: 8 }, () => `${pick(['我', '他'])}叫钧子${pick(['过来', '回家', '别走'])}。`),
    ]);
    const m = await detect([text]);
    expect(m.get('阿柳')).toMatchObject({ kind: 'name', pinyin: 'a1 liu3' });
    expect(m.get('芸儿')).toMatchObject({ kind: 'name', pinyin: 'yun2 er2' });
    expect(m.get('钧子')).toMatchObject({ kind: 'name', pinyin: 'jun1 zi5' });
  });

  it('finds a surname and one character that is a person in a long book, though the character is a common word', async () => {
    const pick = picker(9);
    const lines = [
      ...Array.from({ length: 50 }, () => `${pick(OPENERS)}周静${pick(ENDINGS)}`),
      ...Array.from({ length: 15 }, () => `${pick(['我', '他', '母亲'])}${pick(['对', '叫', '和'])}周静说：“${pick(['走吧', '吃饭了'])}。”`),
      ...Array.from({ length: 80 }, () => `${pick(['屋里很静', '夜里静悄悄的', '他静静地坐着', '四周安静下来'])}。`),
    ];
    const m = await detect([`${novel(9, 1800)}\n${lines.join('\n')}`]);
    expect(m.get('周静')).toMatchObject({ kind: 'name', pinyin: 'zhou1 jing4' });
  });

  it('finds a foreign name made only of transliteration characters, and a name in a news story of a few hundred characters', async () => {
    const m = await detect([story({ 拉蒂娅: 4 }, () => [], 120)]);
    expect(m.get('拉蒂娅')?.kind).toBe('name');
    const news = ['商人赵岳峰昨天去世，年仅五十岁。', '赵岳峰生前在北京工作，大家都知道这件事。', '据说，赵岳峰的家人今天回到了上海，朋友们也来了。',
      '外面下着大雨，没有人看见那个孩子。', '这里的人都很友好，桌子上放着一本书。', '母亲在门口等着他，今天天气很好。', '大家一起去吃饭，师父点了点头。'].join('\n');
    expect((await detect([news])).get('赵岳峰')?.kind).toBe('name');
  });

  it('gives a story’s person card first to a dictionary word used as a name (沙龙 the sorcerer, a salon elsewhere)', async () => {
    const text = story({}, (pick) => Array.from({ length: 10 }, () => `${pick(['他', '母亲', '那人'])}${pick(['让', '对', '和', '叫'])}沙龙${pick(['进来', '说了几句', '一起走了', '坐下', '别出声', '回去', '看病', '吃饭'])}。`));
    const e = (await detect([text])).get('沙龙');
    expect(e?.kind).toBe('name');
    expect(e?.gloss).toMatch(/as a word: salon/);
  });
});

describe('names one cue makes sure of', () => {
  const text = [
    '记者问了几个问题，部长盛文祖表示，计划明年完成。',
    '卫生委员会副主任王立强等前往机场。',
    '这时，夏清远认为这部小说写得很好。',
    '那个人名叫莫禾，住在河边。',
    '这一招叫做“落雁腿”，他练了三年。',
    '城里的工程由睿通（RAILONE）承建。',
    '剧中刘大有（周一川饰）是个警察。',
    '那一年，飓风卡琳达袭击了海岸。',
    '主要传人有：孟小秋、赵少庭、陈少林等。',
    '义熙八年（公元412年），城墙修好了。',
    '我们过了安福桥，又走了很远。他说安福桥上风大。',
    '沪甬客运专线和沈丹高铁都通车了。',
    '院子里有：石碗、石盆、石床、石凳。',
    '我们走了许多路才到。',
    '后来我们去了槐荫胡同。',
  ].join('\n');

  it('finds the person after a title, before a verb of speech, after 名叫 with a person before it, and in an actor’s credit', async () => {
    const m = await detect([text]);
    expect(m.get('盛文祖')?.kind).toBe('name');
    expect(m.get('王立强')?.kind).toBe('name');
    expect(m.get('夏清远')?.kind).toBe('name');
    expect(m.get('莫禾')?.kind).toBe('name');
    expect(m.get('周一川')?.kind).toBe('name');
  });

  it('finds a list of people, a storm, a gloss in Latin letters, an era name, a street, a bridge seen twice and a railway', async () => {
    const m = await detect([text]);
    for (const w of ['孟小秋', '赵少庭', '陈少林']) expect(m.get(w)?.kind, w).toBe('name');
    expect(m.get('赵少庭')?.pinyin).toBe('zhao4 shao4 ting2');
    expect(m.get('卡琳达')).toMatchObject({ kind: 'name', gloss: 'name of a storm' });
    expect(m.get('睿通')?.kind).toBe('term');
    expect(m.get('义熙')).toMatchObject({ kind: 'term', gloss: 'era name (reign title)' });
    expect(m.get('安福桥')?.kind).toBe('place');
    expect(m.get('槐荫胡同')?.kind).toBe('place');
    expect(m.get('沪甬')?.kind).toBe('place');
    // 沈 for 沈阳 is shěn.
    expect(m.get('沈丹')).toMatchObject({ kind: 'place', pinyin: 'shen3 dan1' });
  });

  it('keeps out a technique a 叫做 names in quotes, things of stone in a list, a quantity before 路, and a name’s neighbors', async () => {
    const m = await detect([text]);
    expect(m.get('落雁腿')?.kind).toBe('term');
    for (const w of ['石碗', '石盆', '石床', '石凳', '许多路', '盛文祖表', '王立强等', '夏清远认']) expect(m.has(w), w).toBe(false);
  });

  it('adds both halves of a ·-name, keeps the given name that opens a clause, and never swallows the next word', async () => {
    const dict = await dictP;
    const lines = [
      '一个女孩：旺达莉·西蒙的故事。',
      '那天，记者采访了球员卡洛斯•门德斯。',
      '门德斯说，球队今年很好。后来门德斯又笑了。',
      '主教练鲁迪·汤姆维奇因病辞职。',
    ];
    const found = detectTerms([`${novel(4, 120)}\n${lines.join('\n')}`], dict);
    const m = by(found);
    expect(m.get('旺达莉')?.kind).toBe('name');
    expect(m.get('门德斯')?.kind).toBe('name');
    expect(m.get('汤姆维奇')?.kind).toBe('name');
    expect(m.has('汤姆维奇因')).toBe(false);
    // A bare later mention is one word.
    expect(segment('后来门德斯又笑了。', dict, buildLexicon(found)).map((t) => t.text)).toContain('门德斯');
  });

  it('adds a name in Latin letters after 阿 or 小 that the book uses three times', async () => {
    const m = await detect([story({}, (pick) => Array.from({ length: 6 }, () => `${pick(['那天', '后来', ''])}阿K${pick(['走了', '笑了', '睡了'])}。`))]);
    expect(m.get('阿K')).toMatchObject({ kind: 'name', count: 6 });
  });
});

describe('an anthology, read one story at a time', () => {
  const tale = (i: number, name: string) => {
    const pick = picker(100 + i);
    const lines = Array.from({ length: 30 }, () => `${pick(['今天天气很好', '我们都知道这件事', '外面下着大雨', '桌子上放着一本书', '母亲在门口等着他', '大家一起去吃饭'])}。`);
    for (let k = 0; k < 4; k++) lines.splice(5 + k * 6, 0, `${pick(['那天', '后来', ''])}${name}${pick(['走进了树林', '笑了起来', '回到家里', '看见一只鸟'])}。`);
    return lines.join('\n');
  };
  const NAMES = ['欧克兰', '帕洛玛', '洛伦扎', '达米安', '卡兰娜', '萨丽莎', '莫兰迪', '伊莎拉'];

  it('finds a name seen four times in one of 30 short stories, below what the whole book asks for', async () => {
    // Eight stories have a person of their own; the others have none the whole book would notice.
    const book = Array.from({ length: 30 }, (_, i) => [i < NAMES.length ? tale(i, NAMES[i]) : tale(i, '那个人'), tale(i + 50, '我们'), tale(i + 90, '他们')].join('\n'));
    expect(book.join('').replace(/[^\u4e00-\u9fff]/g, '').length).toBeGreaterThan(20000);
    const m = await detect(book);
    expect(m.get('帕洛玛')?.kind).toBe('name');
    expect(m.get('达米安')?.kind).toBe('name');
    // (Four sightings are below what the whole book asks for: the book alone does not find them.)
    expect(by(detectTerms([book.join('\n')], await dictP)).has('帕洛玛')).toBe(false);
  });

  it('does not read a novel’s chapters alone: its people are in every chapter', async () => {
    const dict = await dictP;
    const chapters = Array.from({ length: 30 }, (_, i) => `${novel(40 + i, 70)}\n${i === 3 ? tale(3, '帕洛玛') : ''}`);
    expect(by(detectTerms(chapters, dict)).has('帕洛玛')).toBe(false);
  });
});

describe('readings inside names', () => {
  it('reads 少 shào in a given name and in a place, 沈 Shěn as a surname, and 儿 ér at the end of a foreign name', async () => {
    const dict = await dictP;
    expect(pinyinOf('赵少华', 'name', dict)).toBe('zhao4 shao4 hua2');
    expect(pinyinOf('少华山', 'place', dict).split(' ')[0]).toBe('shao4');
    expect(pinyinOf('沈清', 'name', dict).split(' ')[0]).toBe('shen3');
    expect(pinyinOf('珀莉儿', 'name', dict, false).split(' ')[2]).toBe('er2');
  });
});

describe('names that must not be (the review of stage 2)', () => {
  const lines = (pick: <T>(a: readonly T[]) => T) => [
    // An era name once before a year, and the same two characters as words everywhere else (明天会下雨).
    '天会二年冬，北方大雪。',
    ...Array.from({ length: 4 }, () => `${pick(['我猜他今天会到', '他说明天会下雨', '她觉得后天会晴', '先生说春天会暖'])}。`),
    // A nickname that is still to come, and one that is a phrase whose first character is no surname here.
    '他的绰号尚悬空，大家还在想。',
    '镇上有个铁匠，外号叫“盖九州”，谁都认得他。',
  ];

  it('adds an era name only where the book uses it more before a year than elsewhere, and no nickname that opens with an adverb', async () => {
    const m = await detect([story({}, lines)]);
    expect(m.has('天会')).toBe(false);
    expect(m.has('尚悬空')).toBe(false);
    expect(m.get('盖九州')).toMatchObject({ kind: 'name', pinyin: 'gai4 jiu3 zhou1' });
  });

  it('drops a place that always runs on into a word made with its last character (江海城|际, 江海城|铁)', async () => {
    const m = await detect([story({}, (pick) => [
      ...Array.from({ length: 5 }, () => `${pick(['那年', '后来', ''])}江海城际铁路${pick(['通车了', '很快', '修好了'])}。`),
      ...Array.from({ length: 4 }, () => `${pick(['我们', '大家'])}坐江海城铁${pick(['去上班', '回家'])}。`),
    ])]);
    expect(m.has('江海城')).toBe(false);
  });

  it('takes a foreign name that ends in 儿 by how bound its first two characters are (洛莉儿)', async () => {
    const dict = await dictP;
    // What a book of short stories gives a name seen four times in one of them, 儿 being common in the book.
    const c = { word: '洛莉儿', count: 4, bind: 1, pmi: 5.0, npmi: 0.6, left: 1.04, right: 1.39, speech: 0, prep: 0, open: 0.25, voc: 0, head: 4,
      known: 'none' as const, kind: 'term' as const, surnameLed: false };
    expect(judgeRepeat(c, dict, 3, true)).toMatchObject({ kind: 'name' });
    // (Its first two seen apart from the 儿: the low binding stands.)
    expect(judgeRepeat({ ...c, head: 6 }, dict, 3, true)).toBeNull();
  });
});

describe('names in Latin letters on a page shown in the other script', () => {
  it('keeps 阿Kuei and 老K in the lexicon the page uses, whose pinyin has a syllable for the Han character only', async () => {
    const dict = await dictP;
    const { lexiconInScript } = await import('../../src/ui/reader/shown');
    const lex = buildLexicon([
      { word: '阿Kuei', pinyin: 'a1', gloss: 'name (person)', kind: 'name', enabled: true, origin: 'auto' },
      { word: '老K', pinyin: 'lao3', gloss: 'name (person)', kind: 'name', enabled: true, origin: 'auto' },
      { word: '陳大爺', pinyin: 'chen2 da4 ye2', gloss: 'name (person)', kind: 'name', enabled: true, origin: 'auto' },
    ]);
    const shown = lexiconInScript(lex, 'simplified', dict)!;
    expect(shown.has('阿Kuei')).toBe(true);
    expect(shown.has('老K')).toBe(true);
    expect(shown.has('陈大爷')).toBe(true);
    expect(segment('大家叫他阿Kuei，也叫老K。', dict, shown).map((t) => t.text)).toEqual(expect.arrayContaining(['阿Kuei', '老K']));
  });
});
