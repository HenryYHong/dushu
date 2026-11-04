// Cutting rules for unseen text (plan item 6): dates and numbers, 们 and the locatives, the floor's misses, names that run into
// Latin letters. Every sentence is invented; each test pins one rule, and the "stays" cases are what the rule must leave alone.
import { describe, expect, it } from 'vitest';
import { segment } from '../../src/core/segment';
import { buildLexicon } from '../../src/core/lexicon';
import { applySandhi } from '../../src/core/pinyin';
import type { Lexicon, Token } from '../../src/types';
import { loadTestDictionary } from '../helpers/data';

const dictP = loadTestDictionary();
/** The tokens of `text` joined with | and framed by |, so a test can look for |a|b| anywhere. */
async function cut(text: string, lexicon?: Lexicon): Promise<string> {
  const d = await dictP;
  const tokens = segment(text, d, lexicon);
  expect(tokens.map((t) => t.text).join('')).toBe(text);
  return `|${tokens.map((t) => t.text).join('|')}|`;
}
const lex = (...words: string[]) =>
  buildLexicon(words.map((word) => ({ word, pinyin: '', gloss: '', kind: 'name' as const, enabled: true, origin: 'auto' as const })));

describe('segment: 年 and 日 after a number', () => {
  it('cuts 前 间 关 头 off a year or a day written in digits', async () => {
    expect(await cut('早在1978年前，这里还是一片农田。')).toContain('|1978|年|前|');
    expect(await cut('从5月1日至5月10日间，大雨不断。')).toContain('|10|日|间|');
    expect(await cut('这所学校已于2001年关校。')).toContain('|2001|年|关');
    expect(await cut('2010年头10个月的客流量很大。')).toContain('|2010|年|头|10|');
    expect(await cut('公司在1990年间搬过两次家。')).toContain('|1990|年|间|');
    expect(await cut('请在12月10日前交表。')).toContain('|10|日|前|');
    expect(await cut('来了3个人。')).toContain('|3|个|人|');
  });
  it('keeps 年关 年头 年间 where no number counts the year', async () => {
    expect(await cut('快到年关了，家家都在忙。')).toContain('|年关|');
    expect(await cut('这年头谁还写信？')).toContain('年头|');
    expect(await cut('康熙年间有个读书人。')).toContain('|年间|');
    expect(await cut('康熙二十年间有个读书人。')).toContain('|年间|');
  });
});

describe('segment: rough numbers and fractions', () => {
  it('keeps two neighboring digits before a measure word together', async () => {
    expect(await cut('过了两三月，他才回来。')).toContain('|两三|月|');
    expect(await cut('他走了八九天才到。')).toContain('|八九|天|');
    expect(await cut('屋里坐着三四个人。')).toContain('|三四|个|');
    expect(await cut('他只住了三两天。')).toContain('|三两|天|');
    expect(await cut('他七八岁就会写字了。')).toContain('|七八|岁|');
  });
  it('leaves digits that count nothing, and a longer string of digits', async () => {
    expect(await cut('十有八九会下雨。')).toContain('|十有八九|');
    expect(await cut('屋里乱七八糟。')).toContain('|乱七八糟|');
    expect(await cut('他参加过五二三项目。')).not.toContain('|二三|');
  });
  it('reads 一两个 as yì liǎng gè (sandhi across the rough number)', async () => {
    const d = await dictP;
    const t: Token[] = segment('他吃了一两个。', d);
    expect(t.map((x) => x.text)).toContain('一两');
    applySandhi(t);
    expect(t.find((x) => x.text === '一两')!.pinyin).toEqual(['yi4', 'liang3']);
  });
  it('makes a fraction one number', async () => {
    expect(await cut('这里的收入占全国的二十四分之一。')).toContain('|二十四分之一|');
    expect(await cut('五分之二赞成，九分之七反对。')).toMatch(/\|五分之二\|.*\|九分之七\|/);
    expect(await cut('增长了百分之三点五。')).toContain('|百分之三点五|');
    expect(await cut('只剩下十分之八九。')).toContain('|十分之八九|');
  });
  it('leaves 十分 "very" and a 一 that opens a word', async () => {
    expect(await cut('这件事十分之好。')).toContain('|十分|');
    expect(await cut('两种茶有千分之七十一样。')).toContain('|千分之七十|一样|');
  });
});

describe('segment: 东至 and the 人大 after a place', () => {
  it('cuts 东至 "east to" from a range, keeps the county', async () => {
    expect(await cut('城墙西起山口，东至海边。')).toContain('|东|至|');
    expect(await cut('今晚吹东至东南风。')).toContain('|东|至|东南风|');
    expect(await cut('他是安徽东至县人。')).toContain('|东至县|');
  });
  it('keeps 人大 after a place name, cuts it before 大X', async () => {
    expect(await cut('草案在中國人大網公布。')).toContain('|中國|人大|');
    expect(await cut('二人大惊。')).not.toContain('|人大|');
    expect(await cut('中国人大多喜欢喝茶。')).not.toContain('|人大|');
  });
});

describe('segment: 们 and the locatives go with the word before them', () => {
  it('makes the plural of a word in 人', async () => {
    expect(await cut('镇上女人们都出来了。')).toContain('|女人|们|');
    expect(await cut('几个老妇人们坐在门口。')).toContain('|老妇人|们|');
    expect(await cut('村里的能人们都来了。')).toContain('|能人|们|');
  });
  it('leaves 人们 after a word that ends there, a verb, a place or a time', async () => {
    expect(await cut('这时人们纷纷离开。')).toContain('|这时|人们|');
    expect(await cut('许多人们不知道。')).toContain('|人们|');
    expect(await cut('要让人们明白道理。')).toContain('|人们|');
    expect(await cut('下雨时人们都躲进屋里。')).toContain('|人们|');
    expect(await cut('在那种局面下人们只好搬家。')).toContain('|人们|');
  });
  it('gives 里 and 外 to the place before them', async () => {
    expect(await cut('这是在山村里没见过的。')).toContain('|山村|里|');
    expect(await cut('狗守在大门外。')).toContain('|大门|外|');
    expect(await cut('猫睡在东边小屋里的床上。')).toContain('|小屋|里|的|');
  });
  it('leaves words in 里 and 外 that are no place and its side', async () => {
    expect(await cut('我知道你小心里的事。')).toContain('|心里|');
    expect(await cut('这里有四百家中外企业。')).toContain('|中外|');
    expect(await cut('他对表格外的事不感兴趣。')).toContain('|格外|');
    expect(await cut('城内城外都是人。')).toContain('|城外|');
  });
  it('takes 上头 and 外面 after a place, but not before a word in 头', async () => {
    expect(await cut('太阳照在西墙上头了。')).toContain('|上头|');
    expect(await cut('晚上头一回见到他。')).toContain('|晚上|');
    expect(await cut('他顶上头发不多。')).toContain('|头发|');
  });
  it('gives a word written with 著 the rules of its 着 spelling (跟随著)', async () => {
    expect(await cut('他跟随著老人走了。')).toContain('|跟随|著|');
  });
});

describe('segment: where a word the corpus never saw belongs to its neighbors', () => {
  it('a verb and its object in 子', async () => {
    expect(await cut('我们明天一起割稻子。')).toContain('|割|稻子|');
    expect(await cut('他一吃鸡子就好了。')).not.toContain('|吃鸡|');
  });
  it('the aspect 过 before a thing, not "too"', async () => {
    expect(await cut('他小时候尿过床。')).toContain('|过|床|');
    expect(await cut('您休得过谦。')).toContain('|过谦|');
  });
  it('a measure of a deed after a digit', async () => {
    expect(await cut('他一手扶起了老人。')).not.toContain('|手扶|');
    expect(await cut('要是一步走错就完了。')).not.toContain('|步走|');
    expect(await cut('城外伏着一千步军。')).toContain('|步军|');
  });
  it('上 after a direction or a noun that takes it', async () => {
    expect(await cut('众人朝上礼拜。')).toContain('|上|礼拜|');
    expect(await cut('木桩子上绑着一头牛。')).not.toContain('|上绑|');
    expect(await cut('他上礼拜去了北京。')).toContain('|上礼拜|');
  });
  it('the 所 phrase, the adverb 倒, 亦 + 即 before a deed', async () => {
    expect(await cut('如公所言，此事可成。')).toContain('|公|所');
    expect(await cut('他心里一急，倒弄得没了主意。')).toContain('|倒|弄');
    expect(await cut('那只鸡被倒吊了一夜。')).toContain('|倒吊|');
    expect(await cut('他亦即披挂上马。')).toContain('|亦|即|');
    expect(await cut('所谓大道，亦即人心。')).toContain('|亦即|');
  });
  it('a verb of motion and a place before 中 里', async () => {
    expect(await cut('孩子们跑到庭中玩耍。')).toContain('|到|庭');
    expect(await cut('小球滚进去，掉入坑里了。')).toContain('|入|坑');
    expect(await cut('敌军入寇中原。')).toContain('|入寇|');
  });
  it('a preposition of place before a word the corpus knows', async () => {
    expect(await cut('孩子们夏天总是呆在户外。')).toContain('|在|户外|');
    expect(await cut('对不对，我也说不准。')).toContain('|对不对|');
  });
  it('a town that fills an item of a list of places', async () => {
    expect(await cut('他到过新竹、台南、草屯和嘉义。')).toContain('|草屯|');
    expect(await cut('庙前有一棵老树。')).toContain('|庙|前|');
  });
});

describe('segment: names that run on into Latin letters (阿Q)', () => {
  it('joins 阿 or 小 and one capital letter, with no lexicon', async () => {
    expect(await cut('我这阿Q正传写了很久。')).toContain('|阿Q|正传|');
    expect(await cut('小D和阿Q打了起来。')).toMatch(/\|小D\|.*\|阿Q\|/);
    expect(await cut('阿QQ来了。')).not.toContain('阿Q|');
    expect(await cut('阿Quei来了。')).toContain('|阿|Quei|');
  });
  it('joins a lexicon word that covers the whole run of letters', async () => {
    const l = lex('阿Quei');
    expect(await cut('阿Quei来了。', l)).toContain('|阿Quei|');
    expect(await cut('他叫阿Q。', l)).toContain('|阿Q|');
  });
  it('stops a ·-name at a lexicon word on its side', async () => {
    expect(await cut('约翰·克罗斯比因病退出。', lex('克罗斯比'))).toContain('|克罗斯比|因|');
  });
});

describe('segment: the review of stage 2 (what a rule must not take)', () => {
  it('leaves 怪 a verb after 何 莫 不 (何怪人们: no wonder people), and still makes 闲人们 the plural', async () => {
    expect(await cut('何怪人们都笑他！')).toContain('|怪|人们|');
    expect(await cut('莫怪人们说他。')).toContain('|怪|人们|');
    expect(await cut('这些闲人们都来了。')).toContain('|闲人|们|');
  });

  it('keeps 楼上 before 边 that is the side of a street or a room (楼上边街阁儿), and still takes 上边 after 堂', async () => {
    expect(await cut('他在楼上边街阁儿里吃酒。')).toContain('|楼上|边|');
    expect(await cut('他在堂上边坐着。')).toContain('|堂|上边|');
  });

  it('gives 子 to a noun after a verb even when the verb and the noun\'s first character are slang (吃|鸡子)', async () => {
    expect(await cut('他每天早上吃鸡子。')).toContain('|吃|鸡子|');
  });

  it('does not cut 今天 before a name of the book that opens with 子 (今天|子明)', async () => {
    expect(await cut('今天子明来了。', lex('子明'))).toContain('|今天|子明|');
  });

  it('reads a 上 after one of the book\'s places as its side (镇上), not the start of 上学', async () => {
    const town = buildLexicon([{ word: '白杨镇', pinyin: 'bai2 yang2 zhen4', gloss: '', kind: 'place', enabled: true, origin: 'auto' }]);
    expect(await cut('他在白杨镇上学会了打铁。', town)).toContain('|白杨镇|上|');
    expect(await cut('他在白杨镇上学会了打铁。', lex('白杨镇'))).not.toContain('|白杨镇|上|学|');
  });
});
