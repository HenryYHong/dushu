// Groupings from a native read of a modern novel and the review of every book (ARCHITECTURE.md §4.2). Every sentence here is
// invented; each test pins one rule, and the "stays" cases are the contexts the rule must leave alone.
import { describe, expect, it } from 'vitest';
import { segment } from '../../src/core/segment';
import { loadTestDictionary } from '../helpers/data';

const dictP = loadTestDictionary();
/** The tokens of `text` joined with | and framed by |, so a test can look for |a|b| anywhere. */
async function cut(text: string): Promise<string> {
  const d = await dictP;
  return `|${segment(text, d).map((t) => t.text).join('|')}|`;
}

describe('segment: the emphatic 可 and the reply 可不 / 可不是', () => {
  it('cuts 可不 and 可不是 inside a statement, keeps them as a reply', async () => {
    expect(await cut('老猫可不爱吃萝卜。')).toContain('|可|不|');
    expect(await cut('这只花猫可不是我养的。')).toContain('|可|不是|');
    expect(await cut('“可不，萝卜都烂了。”')).toContain('|可不|');
    expect(await cut('可不是吗，萝卜早烂了。')).toContain('|可不是|');
    expect(await cut('“可不是这样，你看他多瘦。”')).toContain('|可不是|');
    expect(await cut('小李可不可以来？')).toContain('|可|不|可以|');
  });
  it('cuts 可好 after 这回 and before 了, keeps "well or not?"', async () => {
    expect(await cut('这回可好了，萝卜全烂了。')).toContain('|可|好|');
    expect(await cut('你家姑娘可好？')).toContain('|可好|');
  });
});

describe('segment: 来 closing a directional verb, and X来X去', () => {
  it('cuts 来说 来看 来时 来往 after 过来, 过身来, 出来, 上来', async () => {
    expect(await cut('胖师傅踱过来说：“收工了。”')).not.toContain('|来说|');
    expect(await cut('阿明侧过身来看黑板。')).not.toContain('|来看|');
    expect(await cut('她从厨房走出来时，灯灭了。')).not.toContain('|来时|');
    expect(await cut('阿明掉过头来往河边跑。')).not.toContain('|来往|');
    expect(await cut('你们快上来看！')).toContain('|上来|看|');
  });
  it('keeps 来说 "as for" and 来往 "to and fro"', async () => {
    expect(await cut('对鹦鹉来说，这不难。')).toContain('|来说|');
    expect(await cut('从整体上来说，这是好事。')).toContain('|来说|');
    expect(await cut('桥上两头来往的人很多。')).toContain('|来往|');
  });
  it('X来X去 is one word when a dictionary has it, else its four characters', async () => {
    expect(await cut('她想来想去，还是留下了。')).toContain('|想来想去|');
    expect(await cut('松鼠在枝头蹦来蹦去。')).toContain('|蹦|来|蹦|去|');
  });
});

describe('segment: a word that the time, the verb or the clause takes apart', () => {
  it('走时 and 过时 after a verb are "when"', async () => {
    expect(await cut('他扛着锄头走时，月亮刚出来。')).toContain('|走|时|');
    expect(await cut('这只旧表走时很准。')).toContain('|走时|');
    expect(await cut('燕子从屋顶飞过时，他抬起了头。')).not.toContain('|过时|');
    expect(await cut('这种发型是过时的。')).toContain('|过时|');
    expect(await cut('老汉往出走时咳了两声。')).toContain('|出|走|时|');
  });
  it('还不快 urges; 不快 stays "unhappy" at the end of a clause', async () => {
    expect(await cut('你还不快把萝卜搬走！')).toContain('|不|快|');
    expect(await cut('他心里还不快。')).toContain('|不快|');
  });
  it('就算了 and 就算是 "that counts as"; 就算是 "even if" stays', async () => {
    expect(await cut('这件事就算了。')).toContain('|就|算了|');
    expect(await cut('这块木板就算是个凳子吧。')).toContain('|就|算是|');
    expect(await cut('就算是下大雨，我也要去。')).toContain('|就算|是|');
  });
  it('往后 is "backwards" before a movement or a place, "from now on" otherwise', async () => {
    expect(await cut('胖师傅往后一仰。')).toContain('|往|后|');
    expect(await cut('她往后院跑去。')).toContain('|往|后院|');
    expect(await cut('往后的事谁也说不准。')).toContain('|往后|');
    expect(await cut('这样一闹，往后倒省事了。')).toContain('|往后|');
  });
  it('the 多 of 七个多月 goes with the number', async () => {
    expect(await cut('他在山里住了七个多月。')).not.toContain('|多月|');
    expect(await cut('那个多年不见的表哥来了。')).toContain('|多年|');
  });
  it('早上几年 is "a few years earlier"', async () => {
    expect(await cut('他早上两年出生就好了。')).toContain('|早|上|');
    expect(await cut('他早上一点就起床了。')).toContain('|早上|');
  });
});

describe('segment: measure words and numerals', () => {
  it('两头 before an animal is the numeral and its measure word', async () => {
    expect(await cut('舅舅家养了两头肥猪。')).toContain('|两|头|');
    expect(await cut('扁担两头都挂着竹篮。')).toContain('|两头|');
  });
  it('头羊 after a verb or 多, 张嘴 after a numeral or 那, 支部队, 只脚架', async () => {
    expect(await cut('我明天去集上买头羊。')).toContain('|头|羊|');
    expect(await cut('三十多头羊挤在坡上。')).toContain('|头|羊|');
    expect(await cut('那张嘴比刀还快。')).toContain('|张|嘴|');
    expect(await cut('他一张嘴就笑。')).toContain('|张嘴|');
    expect(await cut('他在三支部队里都待过。')).toContain('|支|部队|');
    expect(await cut('阿明一只脚架在凳子上。')).toContain('|脚|架|');
  });
});

describe('segment: verb + 着 and the words around a verb', () => {
  it('点着头, 执着一盏灯, 吸着烟, 还睡着 are a verb and its 着', async () => {
    expect(await cut('老张点着头笑了。')).toContain('|点|着|头|');
    expect(await cut('她执着一根蜡烛。')).toContain('|执|着|');
    expect(await cut('他蹲在门口吸着旱烟。')).toContain('|吸|着|');
    expect(await cut('弟弟还睡着呢。')).toContain('|睡|着|');
    expect(await cut('小侄子早睡着了。')).toContain('|睡着|');
  });
  it('手提着, 把火烧, 月光照, 一心想, 等于是, 睁眼看, 往上吊, 上吊死, 越过越', async () => {
    expect(await cut('阿姨左手提着菜篮。')).not.toContain('|手提|');
    expect(await cut('阿姨左手提着菜篮。')).toContain('|提|着|');
    expect(await cut('奶奶把火烧得通红。')).toContain('|把|火|烧|');
    expect(await cut('月光照着小河。')).toContain('|月光|照|');
    expect(await cut('他一心想考大学。')).toContain('|一心|想|');
    expect(await cut('小一心想：明天要下雨。')).toContain('|心想|');
    expect(await cut('这样做等于是白费力气。')).toContain('|等于|是|');
    expect(await cut('他睁眼看着屋顶。')).toContain('|睁眼|看|');
    expect(await cut('绳子往上吊。')).toContain('|往|上|吊|');
    expect(await cut('那个贪官上吊死了。')).toContain('|上吊|死|');
    expect(await cut('我们村越过越热闹了。')).toContain('|越|过|越|');
  });
  it('人种 人命 after 一个人, the comparative 大, 能干 before the work', async () => {
    expect(await cut('舅舅一个人种辣椒。')).toContain('|人|种|');
    expect(await cut('那个人命苦。')).toContain('|人|命苦|');
    expect(await cut('哥哥比我大多了。')).toContain('|大|多|了|');
    expect(await cut('他比我大四五岁。')).toContain('|大|四|');
    expect(await cut('舅舅能干重活。')).toContain('|能|干|重活|');
    expect(await cut('她很能干。')).toContain('|能干|');
  });
  it('a doubled syllable of 哈腰 偷懒, and 练练就', async () => {
    expect(await cut('他朝老板哈哈腰。')).toContain('|哈|哈腰|');
    expect(await cut('他想偷偷懒。')).toContain('|偷|偷懒|');
    expect(await cut('他偷偷看了一眼。')).toContain('|偷偷|看|');
    expect(await cut('多练练就会了。')).not.toContain('|练就|');
  });
  it('one-off pairs where the neighbor wins', async () => {
    expect(await cut('他俯下身捡起硬币。')).not.toContain('|下身|');
    expect(await cut('那片云倒像是一匹马。')).toContain('|倒|像是|');
    expect(await cut('小马驹一生下来便会站。')).toContain('|一|生|');
    expect(await cut('他腾出手来接电话。')).toContain('|腾出|手|');
    expect(await cut('我家养了三只鸭子。')).toContain('|我家|养|');
    expect(await cut('鞋底沾满了烂泥巴。')).toContain('|烂|泥巴|');
    expect(await cut('老猎人藏了一把手枪。')).not.toContain('|一把手|');
    expect(await cut('他明天回乡下去。')).toContain('|乡下|去|');
    expect(await cut('谁对你好，你心里清楚。')).toContain('|你|好|');
    expect(await cut('吃药也不管用。')).toContain('|不|管用|');
    expect(await cut('不管用哪种法子，都行。')).toContain('|不管|');
  });
});

describe('segment: a noun whose last character a 里/上 fragment would take', () => {
  it('产房里, 手心里, 手背上: the noun and the locative', async () => {
    expect(await cut('她在产房里睡着了。')).toContain('|产房|里|');
    expect(await cut('他把糖攥在手心里。')).toContain('|手心|里|');
    expect(await cut('蚊子叮在小妹手背上。')).toContain('|手背|上|');
  });
  it('leaves a noun that already ends a word (苹果树上, 菜园地里) and a verb before it', async () => {
    expect(await cut('苹果树上挂满了果子。')).toContain('|树上|');
    expect(await cut('东边菜园地里长满葱。')).toContain('|菜园|地里|');
    expect(await cut('他在家里看书。')).toContain('|家里|');
  });
});

describe('segment: words the corpus never counted (book-words.tsv) and 分上', () => {
  it('joins 村口, 晒场, 窝棚, 麦田, 做声, 这一来', async () => {
    expect(await cut('他每天在村口等公交车。')).toContain('|村口|');
    expect(await cut('孩子们在晒场边捉迷藏。')).toContain('|晒场|');
    expect(await cut('他们搭了一个窝棚。')).toContain('|窝棚|');
    expect(await cut('一片麦田黄了。')).toContain('|麦田|');
    expect(await cut('他半天没做声。')).toContain('|做声|');
    expect(await cut('雨停了，这一来大家都高兴了。')).toContain('|这一来|');
    expect(await cut('你这一来了，我就放心了。')).toContain('|这|一来|');
  });
  it('分上 "for the sake of" after 看在…的, not one\'s share', async () => {
    expect(await cut('看在老朋友的分上，饶了他吧。')).toContain('|分上|');
    expect(await cut('桌上的饼一人分上一块。')).not.toContain('|分上|');
  });
  it('好在 opens a clause as "luckily", but 好 + 在 + a place after a purpose', async () => {
    expect(await cut('好在路上没有车。')).toContain('|好在|');
    expect(await cut('她把信藏起来，好在人前装糊涂。')).toContain('|好|在|');
  });
});

describe('segment: foreign names written with a middle dot', () => {
  it('joins the transliteration characters on each side of the dot', async () => {
    expect(await cut('我认识一个叫杰西卡·莫兰的女孩。')).toContain('|莫兰|');
    expect(await cut('他叫阿尔多·佩里尼。')).toContain('|佩里尼|');
  });
  it('leaves a title and its section (汉书·艺文志) and a common word before the name', async () => {
    expect(await cut('他读过汉书·艺文志。')).not.toContain('|艺文志|·');
    expect(await cut('我是达·芬奇。')).toContain('|是|达|·|芬奇|');
  });
});
