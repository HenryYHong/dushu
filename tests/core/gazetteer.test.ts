// The name list (core/gazetteer.ts, public/data/names.tsv.gz) and how detection uses it (core/lexicon.ts listed()), and the junk
// names a blind audit found (common words made names). Every sentence here is invented; the lists in the tests are invented too,
// except the last block, which reads the real file.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { GAZETTEER_FORMAT, parseGazetteer, type Gazetteer } from '../../src/core/gazetteer';
import { buildLexicon, detectTerms, pinyinOf } from '../../src/core/lexicon';
import { segment } from '../../src/core/segment';
import type { LexiconEntry } from '../../src/types';
import { DATA_DIR, loadTestDictionary } from '../helpers/data';
import { novel } from '../helpers/novel';

const dictP = loadTestDictionary();
const by = (found: LexiconEntry[]) => new Map(found.map((e) => [e.word, e]));

/** A list from "name kind" pairs (kind p, l, o or t). */
const list = (rows: string): Gazetteer => parseGazetteer(`# test list\n# format ${GAZETTEER_FORMAT}\n${rows.trim().split(/\s+/).map((r) => r.replace(':', '\t')).join('\n')}\n`)!;

describe('parseGazetteer', () => {
  it('reads names and kinds, and finds them in folded text, longest and shortest alike', () => {
    const g = list('戴嵩:p 阳羡:l 李明:p 李明华:p 北洋学堂:o 淝水之战:t');
    expect(g.size).toBe(6);
    expect(g.kindOf('戴嵩')).toBe('person');
    expect(g.kindOf('阳羡')).toBe('place');
    expect(g.kindOf('北洋学堂')).toBe('org');
    expect(g.kindOf('淝水之战')).toBe('other');
    expect(g.kindOf('戴')).toBeUndefined();
    expect(g.kindOf('嵩戴')).toBeUndefined();
    const text = '那天李明华和戴嵩去了阳羡。';
    const codes = Uint16Array.from([...text].map((c) => c.charCodeAt(0)));
    const han = Uint8Array.from([...text].map((c) => (/\p{Script=Han}/u.test(c) ? 1 : 0)));
    const hits: string[] = [];
    g.scan(codes, han, (i, len, kind) => hits.push(`${text.slice(i, i + len)}/${kind}`));
    expect(hits).toEqual(['李明/person', '李明华/person', '戴嵩/person', '阳羡/place']);
  });

  it('refuses a file of another format or with no format line, so an old or foreign file means no list', () => {
    expect(parseGazetteer('# format 99\n戴嵩\tp\n')).toBeNull();
    expect(parseGazetteer('戴嵩\tp\n')).toBeNull();
    expect(parseGazetteer('<!doctype html><html></html>')).toBeNull();
  });

  it('skips rows it cannot read: one character, more than eight, an unknown kind', () => {
    const g = list('戴:p 一二三四五六七八九:l 阳羡:x 毗陵:l');
    expect(g.size).toBe(1);
    expect(g.kindOf('毗陵')).toBe('place');
  });
});

describe('listed names in detection', () => {
  const gaz = list('戴嵩:p 周昉:p 阳羡:l 宫泽理惠:p 王平:p 翠云:p 车里:l 陈少:p 湾子里:l 近卫队:o 秦沈客运专线:l 昌西:l 史进道:p 李明华:p 李明:p 毗陵:l 于绍:p 社群:o');
  const filler = novel(11, 400);
  const detect = async (lines: string[], g: Gazetteer | null = gaz) => by(detectTerms([`${filler}\n${lines.join('\n')}`], await dictP, { gazetteer: g }));

  it('takes a name seen once that stands free, with the reading of a name', async () => {
    const m = await detect([
      '他最喜欢的是画家戴嵩画的牛。',
      '那年冬天，他去了阳羡，住了三年。',
      '宫泽理惠演过一部电影。',
      '这幅画是周昉的。',
    ]);
    expect(m.get('戴嵩')).toMatchObject({ kind: 'name', pinyin: 'dai4 song1', count: 1 });
    expect(m.get('阳羡')).toMatchObject({ kind: 'place' });
    expect(m.get('宫泽理惠')?.kind).toBe('name');
    expect(m.get('周昉')?.kind).toBe('name');
  });

  it('never names a string the text uses as ordinary words', async () => {
    const m = await detect([
      '国王平定了叛乱。', // 国王 and 平定 cross both edges of 王平
      '山间翠云缭绕。', // two common characters, no cue
      '母亲留在车里。', // a locative at the end
      '湾子里扑通一声跳出一条鱼。',
      '他们组成了一个近卫队。', // a word and one more character, no cue that says a group
      '这一次他致书于绍，请他回来。', // 于 is "to" here
      '网络社群越来越大。', // a dictionary word is never in the real list; here not free either
    ]);
    for (const w of ['王平', '翠云', '车里', '湾子里', '近卫队', '于绍', '社群']) expect(m.has(w), w).toBe(false);
  });

  it('never takes part of a longer name, nor a found name and the verb after it', async () => {
    const m = await detect([
      '戏班里的陈少霖唱得最好。', // 陈少 + 霖
      ...Array.from({ length: 12 }, (_, i) => `史进道：“${['你来了', '走吧', '好'][i % 3]}。”史进笑了笑。`), // 史进 is found; 道 is "said"
      '这时李明华走了进来。',
    ]);
    expect(m.has('陈少')).toBe(false);
    expect(m.has('史进')).toBe(true);
    expect(m.has('史进道')).toBe(false);
    expect(m.get('李明华')?.kind).toBe('name');
    expect(m.has('李明')).toBe(false);
  });

  it('reads a listed railway by its words (沈 of 沈阳 is shěn) and a listed place beside a name dot as a person', async () => {
    const m = await detect(['那年，秦沈客运专线开工了。', '教练昌西·比卢普斯说，球队会更好。']);
    expect(m.get('秦沈客运专线')?.pinyin).toBe('qin2 shen3 ke4 yun4 zhuan1 xian4');
    expect(m.get('昌西')?.kind).toBe('name');
  });

  it('leaves out what the list holds as a name but the text uses as a phrase (a review of its joins)', async () => {
    const g = list('任我行:p 张翼轸:p 楚岫云:p 贺敬之:p 金克木:p 大爷二爷:p 威震天南:l 骚达子:p 赤发鬼:p 天武天皇:p 马塞洛:l 忠孝西路:l');
    const m = await detect([
      '万里江山任我行，千秋岁月由吾意。', // a pronoun
      '井鬼柳星张翼轸，此是南方七宿名。', // lunar mansions in a row
      '春风吹过玉阶前，翠鬓笼松楚岫云。', // a couplet: 松 does not free the edge
      '这是我的一点贺敬之礼。', // 之 before a noun
      '书上说，这正是金克木之理。', // the five phases
      '那天大爷二爷都来了。', // two people
      '他们都是威震天南的大侠。', // a verb at the start of a place
      '那个小骚达子跑了。', // 小 starts a nickname
      '路上忽然跑来一个赤发鬼。', // a kind of ghost, once
      '后来天武天皇派人去了。', // a doubled character is fine
      '比赛快结束时，马塞洛又进了一球。',
      '他一直住在忠孝西路。', // a road may start with a verb
    ], g);
    for (const w of ['任我行', '张翼轸', '楚岫云', '贺敬之', '金克木', '大爷二爷', '威震天南', '骚达子', '赤发鬼']) expect(m.has(w), w).toBe(false);
    expect(m.get('天武天皇')?.kind).toBe('name');
    expect(m.get('忠孝西路')).toMatchObject({ kind: 'place', gloss: 'place name' });
    // (The list has 马塞洛 as a place; nothing in the text says so, so the card says only that it is a name.)
    expect(m.get('马塞洛')).toMatchObject({ kind: 'place', gloss: 'name (Wikipedia)' });
  });

  it('reads listed names by their shape: a mansion, a khan, 不 in a name, special given names, a nickname in 子', async () => {
    const g = list('速不台:p 斗木獬:t 参水猿:t 塔阳汗:p 郦食其:p 小安子:p 乌斯藏:l');
    const m = await detect(['速不台带兵来了。', '天上的斗木獬下凡了。', '天上的参水猿也来了。', '使者去见塔阳汗。', '说客郦食其来了。', '我的小安子，快回家。', '他们到了乌斯藏国界。'], g);
    expect(m.get('速不台')?.pinyin).toBe('su4 bu4 tai2');
    expect(m.get('斗木獬')?.pinyin).toBe('dou3 mu4 xie4');
    expect(m.get('参水猿')?.pinyin).toBe('shen1 shui3 yuan2');
    expect(m.get('塔阳汗')?.pinyin).toBe('ta3 yang2 han2');
    expect(m.get('郦食其')?.pinyin).toBe('li4 yi4 ji1');
    expect(m.get('小安子')?.pinyin).toBe('xiao3 an1 zi5');
    expect(m.get('乌斯藏')?.pinyin).toBe('wu1 si1 zang4');
  });

  it('reads the names of any source by their shape (pinyinOf)', async () => {
    const dict = await dictP;
    expect(pinyinOf('赤髮鬼', 'name', dict)).toBe('chi4 fa4 gui3'); // 髮 is only hair
    expect(pinyinOf('赤发鬼', 'name', dict)).toBe('chi4 fa4 gui3'); // after a color
    expect(pinyinOf('王金发', 'name', dict)).toBe('wang2 jin1 fa1'); // "prosper"
    expect(pinyinOf('陈蕃', 'name', dict)).toBe('chen2 fan2');
    expect(pinyinOf('金日磾', 'name', dict)).toBe('jin1 mi4 di1');
    expect(pinyinOf('金兀术', 'name', dict)).toBe('jin1 wu4 zhu2');
    expect(pinyinOf('司马相如', 'name', dict)).toBe('si1 ma3 xiang4 ru2');
    expect(pinyinOf('孛要合', 'name', dict)).toBe('bo2 yao4 he2');
    expect(pinyinOf('薄一波', 'name', dict)).toBe('bo2 yi1 bo1');
    expect(pinyinOf('差不多先生', 'name', dict).split(' ')[1]).toBe('bu5'); // the word's own neutral 不
    expect(pinyinOf('厦深铁路', 'place', dict).split(' ')[0]).toBe('xia4');
    expect(pinyinOf('西苕溪', 'place', dict)).toBe('xi1 tiao2 xi1');
  });

  it('cuts a surname and a title, not a two-character name and a leftover (刘|先主)', async () => {
    const dict = await dictP;
    const lex = buildLexicon([{ word: '刘先', pinyin: 'liu2 xian1', gloss: '', kind: 'name', count: 3, enabled: true, origin: 'auto' }]);
    expect(segment('第八回 刘先主遗诏托孤', dict, lex).map((t) => t.text)).toContain('先主');
    expect(segment('别驾刘先守荆州。', dict, lex).map((t) => t.text)).toContain('刘先');
  });

  it('without the list, detection is what it was', async () => {
    const lines = ['他最喜欢的是画家戴嵩画的牛。', '那年冬天，他去了阳羡，住了三年。'];
    const dict = await dictP;
    const text = `${filler}\n${lines.join('\n')}`;
    const plain = detectTerms([text], dict).map((e) => e.word);
    expect(detectTerms([text], dict, { gazetteer: null }).map((e) => e.word)).toEqual(plain);
    expect(plain).not.toContain('戴嵩');
  });
});

describe('common words are not names (the blind audit\'s junk names)', () => {
  const filler = ['今天的天气很好，我们一起去公园散步。', '路上遇到了很多熟人，大家都很高兴。', '后来下了一场雨，我们就回家了。', '晚上吃了饭以后，我看了一会儿书。', '那一年冬天特别冷，河面都结了冰。', '村子里的人都说，明年会是个好年。'];
  /** A short text: each line of `lines` in turn after a line of filler, `n` times. */
  const text = (lines: string[], n = 24) => Array.from({ length: n }, (_, i) => `${filler[(i * 7) % filler.length]}\n${lines[i % lines.length]}`).join('\n');
  const detect = async (lines: string[], n?: number) => by(detectTerms([text(lines, n)], await dictP));

  it('社群 "community", after 对 与 给 和 让, is no person', async () => {
    const m = await detect(['网络社群的发展很快。', '我们对社群的影响做了研究。', '他与社群的成员见了面。', '政府给社群提供了帮助。', '这个社群有很多人。', '大家和社群一起讨论。', '社群成员越来越多。', '让社群自己管理。']);
    expect(m.has('社群')).toBe(false);
  });

  it('焚毁 "to burn down", after 被, is no person', async () => {
    const m = await detect(['那座寺庙被焚毁了。', '书院后来被焚毁，只剩下一块碑。', '城里的房屋被焚毁殆尽。', '藏书楼被焚毁以后，书都没了。', '大殿被焚毁的消息传来。', '县衙被焚毁后，官员逃走了。', '粮仓被焚毁，百姓没有饭吃。', '祠堂被焚毁三次，又修了三次。']);
    expect(m.has('焚毁')).toBe(false);
  });

  it('堂倌 "waiter", called for and answering, is a role and no name', async () => {
    const m = await detect(['他叫堂倌拿酒来。', '堂倌答应了一声。', '我对堂倌说，再来一壶。', '堂倌笑道：客官请坐。', '他叫堂倌结账，堂倌却不在。', '那堂倌端上一碗面。', '掌柜和堂倌都看着他。', '堂倌走过来问他要什么。']);
    expect(m.has('堂倌')).toBe(false);
  });

  it('清华 in the sense "pure and fine" is no person (the dictionary knows it only as the university)', async () => {
    const m = await detect(['其文与清华相近。', '见清华之气，令人忘忧。', '山水同清华一样秀丽。', '此地向清华而开，宜于读书。', '月色与清华相映。', '他对清华二字很喜欢。', '人们见清华满目，都说好。', '画中随清华之意而作。']);
    expect(m.has('清华')).toBe(false);
  });

  it('张专辑 is a count of albums, not Mr. Zhang; 整条街 is the whole street', async () => {
    const m = await detect(['她发行了第一张专辑。', '第二张专辑叫做《春天》。', '这张专辑卖得很好。', '她的第三张专辑在台湾发行。', '这张专辑获得了金曲奖。', '乐队的第四张专辑名为《海》。', '大火烧了整条街。']);
    expect(m.has('张专辑')).toBe(false);
    expect(m.has('整条街')).toBe(false);
  });

  it('still takes a dictionary word that a story uses as a person: it speaks (in either script) and is a proper name or a noun', async () => {
    const m = await detect(['那天沙龍說：「我回來了。」', '母親和沙龍吵了一架。', '只聽沙龍說：「好吧。」', '他讓沙龍進來。', '沙龍也停了下來。', '父親和沙龍很沒趣。', '不久沙龍垂着頭走了。', ]);
    expect(m.get('沙龍')?.kind).toBe('name');
    const m2 = await detect(['玛丽进来了。', '汤姆想要玛丽马上离开。', '玛丽说：“我不去。”', '他叫玛丽过来。', '玛丽也笑了。', '我们请玛丽吃饭。', '玛丽和汤姆都在家。', '玛丽的书丢了。']);
    expect(m2.get('玛丽')?.kind).toBe('name');
  });
});

describe('the name list file (public/data/names.tsv.gz)', () => {
  const file = join(DATA_DIR, 'names.tsv.gz');
  const present = existsSync(file);

  it.runIf(present)('is small, readable, credits Wikidata, and holds the names a reader needs but not the dictionary\'s words', async () => {
    expect(statSync(file).size).toBeLessThan(3_000_000);
    const text = gunzipSync(readFileSync(file)).toString('utf8');
    expect(text).toMatch(/Wikidata.*CC0/);
    const g = parseGazetteer(text)!;
    expect(g.size).toBeGreaterThan(400_000);
    // People, places and other names the segmenter splits into characters.
    expect(g.kindOf('戴嵩')).toBe('person');
    expect(g.kindOf('周昉')).toBe('person');
    expect(g.kindOf('宫泽理惠')).toBe('person');
    expect(g.kindOf('阳羡')).toBe('place');
    expect(g.kindOf('胡庆余堂')).toBeDefined();
    // Words the dictionary has (the segmenter joins them already) and common words are left out.
    const dict = await dictP;
    for (const w of ['北京', '清华', '社群', '孙中山', '长城']) {
      expect(dict.hasWord(w) || dict.freq(w) > 0, w).toBe(true);
      expect(g.kindOf(w), w).toBeUndefined();
    }
    // A count (一粒米), a sound (哒哒哒) and a courtesy name of someone hardly known are not names.
    for (const w of ['一粒米', '三杯酒', '哒哒哒', '字子桓']) expect(g.kindOf(w), w).toBeUndefined();
  });
});
