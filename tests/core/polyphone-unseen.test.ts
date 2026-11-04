// Reading rules for text Dushu was never tuned on (plan item 4): 为 in modern writing, 得 "to get" and "may", 地 before a comma and in
// "place of", 卷 next to its number, 场 for games and meetings, 长 "to grow" and "older by", 东西 "east and west", 中 "to pass",
// 还 "to give back", 甚 "what", 和 "to knead", 儿 ending a foreign name, 蒙 the Mongols. Invented sentences, each run through
// segment() and the sandhi pass, exactly what the reader shows.
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

const run = (cases: [string, string, string][]) => {
  for (const [text, part, want] of cases) it(`${text} ${part} = ${want}`, async () => expect(await py(text, part)).toBe(want));
};

describe('为 in modern writing', () => {
  run([
    // "to be, as" (wéi): what something is, a noun phrase with no verb that ends the clause
    ['这座桥的原型为一座石拱桥。', '为', 'wéi'], ['大楼的正面为玻璃幕墙的设计，很好看。', '为', 'wéi'],
    ['获奖者为一名十六岁的学生，来自乡下。', '为', 'wéi'], ['本次考试的参考书目为《现代汉语词典》。', '为', 'wéi'],
    ['评委会的评语为：“作品朴实动人。”', '为', 'wéi'], ['会员的年费为每年200元。', '为', 'wéi'],
    ['新车的时速为350公里。', '为', 'wéi'], ['这种鸟的体长为20-25厘米。', '为', 'wéi'],
    // changed, judged or named as (V为), and 以…为 across a quotation, a number or a list
    ['这家工厂后来改制为股份有限公司。', '为', 'wéi'], ['他被同事们形容为“工作狂”。', '为', 'wéi'], ['他被录用为正式职员。', '为', 'wéi'],
    ['学校以“绿色出行”为题办了一次讲座。', '为', 'wéi'], ['他们以3310型手机为原型。', '为', 'wéi'],
    ['展会以展览、会议、活动为三大板块。', '为', 'wéi'], ['较去年的1200吨为多。', '为', 'wéi'],
    // "for" (wèi): what is done for someone, a verb after them
    ['她常为报社撰稿。', '为', 'wèi'], ['志愿者为老人们提供免费午餐。', '为', 'wèi'], ['父母为孩子付出了很多。', '为', 'wèi'],
    ['他为朋友的成功高兴。', '为', 'wèi'], ['他为表哥的工作四处奔走。', '为', 'wèi'], ['大家为客人准备的点心很好吃。', '为', 'wèi'],
    ['减速不是因为安全，而是为350公里/小时的列车提供服务。', '为', 'wèi'], ['他不为钱，只为心安。', '为', 'wèi'],
    ['她为高考的事，一夜没睡。', '为', 'wèi'], ['热带气旋为干旱的地区带来雨水。', '为', 'wèi'],
  ]);
});

describe('得 "to get" and "may"', () => {
  run([
    ['那天千足虫一共得了五分。', '得', 'dé'], ['他们为学校筹得30万元。', '得', 'dé'], ['气象台录得超过200毫米的雨量。', '得', 'dé'],
    ['犯了什么法，就该得什么罪。', '得', 'dé'], ['从初一到初八，他何曾得一个闲？', '得', 'dé'], ['他大概是想得一点好兆头。', '得', 'dé'],
    ['市长并得依法任命副市长。', '得', 'dé'], ['这些颜色暂得保存。', '得', 'dé'], ['现在得蒙大师指点，我才明白。', '得', 'dé'],
    // must (děi), and the particle where it stays
    ['你到底得说。', '得', 'děi'], ['他们的摊子摆好了，得有人去看着。', '得', 'děi'],
    ['他跑得很快。', '得', 'de'], ['这一闹，把他搞得头昏脑涨。', '得', 'de'], ['后来催并得紧，他只好走了。', '得', 'de'],
  ]);
});

describe('地', () => {
  run([
    // the particle before a comma after a word of manner, and after 出奇
    ['她默想了一会，分明地，坚决地，沉静地说了出来。', '分明地', 'fēn míng de'], ['她冷静地，一步一步走过去。', '冷静地', 'lěng jìng de'],
    ['大家的意见出了奇地一致。', '奇地', 'qí de'],
    // a place: "the place where it is done", a field, a poem's earth
    ['他们的祖先从移居地迁来。', '移居地', 'yí jū dì'], ['台风也给登陆地造成破坏。', '登陆地', 'dēng lù dì'],
    ['选一块清静地，看天，听鸟。', '静地', 'jìng dì'], ['他们走进玉米地，', '地', 'dì'],
  ]);
});

describe('卷, 场, 长, 东西, 中, 还, 甚, 和, 儿, 蒙', () => {
  run([
    // 卷 juàn next to its number, juǎn for a roll
    ['《水经注》卷四记载了这条河。', '卷', 'juàn'], ['这部小说的第三卷写的是战争。', '卷', 'juàn'], ['这部诗集共10卷，收诗千首。', '卷', 'juàn'],
    ['他带回了三卷经书。', '卷', 'juàn'], ['她从包里拿出一卷钞票。', '卷', 'juǎn'], ['他卷起袖子。', '卷', 'juǎn'],
    // 场 chǎng for a game, a show or a meeting; cháng for weather and trouble
    ['他们决定进行一场足球比赛。', '场', 'chǎng'], ['明天有一场以环保为题的讲座。', '场', 'chǎng'], ['昨晚下了一场大雨。', '场', 'cháng'],
    ['这只是一场误会。', '场', 'cháng'],
    // 长 zhǎng for growing and for "older by"
    ['小狗越长越大。', '长', 'zhǎng'], ['他比我长一辈。', '长', 'zhǎng'], ['剪短的头发又长回来了。', '长', 'zhǎng'], ['日子越长越难熬。', '长', 'cháng'],
    // 东西 dōngxī as directions
    ['城内的道路东西与南北正交。', '东西', 'dōng xī'], ['东西城墙在山顶交会。', '东西', 'dōng xī'], ['他买了很多东西。', '东西', 'dōng xi'],
    // 中 zhòng for passing the exams and for a hit
    ['他就是新中举人的父亲。', '中', 'zhòng'], ['他一心要去中进士。', '中', 'zhòng'], ['他考了多年，还不曾中过学。', '中', 'zhòng'],
    ['那场比赛他十投九中。', '中', 'zhòng'], ['房间中很安静。', '中', 'zhōng'],
    // 还 huán, giving back
    ['事情来了，我还你一个公道。', '还', 'huán'], ['客人们一一还过了礼。', '还', 'huán'], ['他还在等。', '还', 'hái'],
    // 甚 shén "what" in the older vernacular
    ['你一个人坐在这里做甚？', '甚', 'shén'], ['不知他因甚不来。', '甚', 'shén'], ['这样甚好。', '甚', 'shèn'],
    // 和 huó for dough
    ['把和好的面团搓成长条。', '和', 'huó'], ['我和好朋友去公园。', '和', 'hé'],
    // 儿 ér ending a foreign name; the erhua suffix after Chinese words
    ['这是我的女儿珀拉儿。', '珀拉儿', 'pò lā ér'], ['诺孜贝儿回到了家。', '儿', 'ér'], ['花儿开了。', '花儿', 'huā r'],
    // 蒙 Měng, the Mongols
    ['蒙汉两族在此杂居。', '蒙', 'měng'], ['蒙元占领杭州以后', '蒙', 'měng'], ['蒙藏关系', '蒙藏', 'měng zàng'], ['中蒙边境', '蒙', 'měng'],
  ]);
});

describe('为 in the review of stage 2', () => {
  it('reads 为 + 非 + a noun (for non-…) as wèi, and 为非作歹 still wéi', async () => {
    expect(await py('学校为非英语专业的学生开设日语课。', '为')).toBe('wèi');
    expect(await py('这伙人专门为非作歹。', '为非作歹')).toBe('wéi fēi zuò dǎi');
  });
  it('reads 为功名 (for fame and rank) as wèi', async () => {
    expect(await py('他一生为功名。', '为')).toBe('wèi');
    expect(await py('今日之举，非为功名富贵。', '为')).toBe('wèi');
  });
});
