// The second native review of every Chinese book (2026-10): rules that reached too far into modern prose or into the
// classics, narrowed, and patterns the first pass left. Each case is an invented sentence (or a line of a public-domain
// classic) run through segment(), so the paragraph's other tokens are seen as the reader sees them. A case marked `t` is
// written in traditional characters and shown simplified, with the readings taken from the book's own characters.
import { describe, expect, it } from 'vitest';
import { segment } from '../../src/core/segment';
import { buildLexicon } from '../../src/core/lexicon';
import { loadTestDictionary } from '../helpers/data';
import type { Dictionary, Lexicon, Token } from '../../src/types';

const dictP = loadTestDictionary();

function run(d: Dictionary, text: string, trad: boolean, lexicon?: Lexicon): Token[] {
  if (!trad) return segment(text, d, lexicon);
  const shown = d.toSimplified(text);
  return segment(shown, d, lexicon, undefined, shown.length === text.length ? text : undefined);
}

/** Numbered pinyin of the characters of `part` (its first occurrence in the text shown), joined by spaces. */
function readingOf(toks: Token[], shown: string, part: string): string {
  const at = shown.indexOf(part);
  if (at < 0) throw new Error(`"${part}" is not in "${shown}"`);
  const out: string[] = [];
  for (const t of toks) {
    if (t.kind !== 'han') continue;
    let off = t.start;
    [...t.text].forEach((ch, i) => {
      if (off >= at && off < at + part.length) out.push(t.pinyin![i]);
      off += ch.length;
    });
  }
  return out.join(' ');
}

/** [sentence, part (as shown, simplified), expected numbered pinyin, written in traditional?] */
type R = [string, string, string, boolean?];

async function checkReadings(cases: R[]): Promise<void> {
  const d = await dictP;
  for (const [text, part, want, trad] of cases) {
    const toks = run(d, text, !!trad);
    const shown = toks.map((t) => t.text).join('');
    expect(`${text} ${part}: ${readingOf(toks, shown, part)}`).toBe(`${text} ${part}: ${want}`);
  }
}

describe('为: wéi and wèi', () => {
  it('reads "for" before a number that starts what is done, and "to be" before a number the clause ends on', () =>
    checkReadings([
      ['那次为多住一晚，她去镇上为两位客人买酒。', '为两', 'wei4 liang3'], ['不要为一分钱斤斤计较。', '为一', 'wei4 yi1'],
      ['她如今为一家小店记账，为防万一，也有人为两千年后的气候发愁。', '为防', 'wei4 fang2'],
      ['她如今为一家小店记账。', '为一', 'wei4 yi1'], ['也有人为两千年后的气候发愁。', '为两', 'wei4 liang3'],
      ['每六个学生为一组。', '为一', 'wei2 yi1'], ['全程约为三十公里。', '为三', 'wei2 san1'],
      ['平均速度为每小时六十公里。', '为每', 'wei2 mei3'], ['湖水深度为三米至六米之间。', '为三', 'wei2 san1'], ['价格为每斤三块钱。', '为每', 'wei2 mei3'],
    ]));

  it('leaves the 所 of a 为 inside the clause to that 为, and reads 为…所做 (what was done for) as "for"', () =>
    checkReadings([
      ['她为一家不为外人所知的机构做事。', '她为', 'ta1 wei4'], ['她为一家不为外人所知的机构做事。', '不为', 'bu4 wei2'],
      ['感谢她为这次聚会所做的安排。', '为这', 'wei4 zhe4'], ['小河为月光所照。', '为', 'wei2'],
    ]));

  it('reads the classical "to be" before an office, after 是 in the classics, and before X之Y at the end of a clause', () =>
    checkReadings([
      ['是為靈帝。', '为', 'wei2', true], ['拜卿為大都督。', '为', 'wei2', true], ['此人為誰？', '为', 'wei2', true],
      ['孫休為君。', '为', 'wei2', true], ['與朝廷為敵。', '为', 'wei2', true], ['永為荊州之主。', '为', 'wei2', true],
      ['後必為大禍。', '为', 'wei2', true], ['以濟世救人為本。', '为', 'wei2', true], ['此茶为江南之冠。', '为', 'wei2'],
      ['老王不愧为老王。', '为', 'wei2'], ['他们诚为有德行的人。', '为', 'wei2'],
    ]));

  it('reads 为 in the vernacular of the old novels as "for, because" before a longer clause', () =>
    checkReadings([
      ['我們不過為柳二哥的事忙了這幾日，你的話也有理。', '为', 'wei4', true], ['為因收捕失利，他這幾天不曾回來。', '为', 'wei4', true],
      ['為是他性急，不曾等得。', '为', 'wei4', true], ['他們別為著這點事吵了。', '为', 'wei4', true],
      ['就是为你好。', '为', 'wei4'], ['他不为别的，只为钱。', '不为', 'bu4 wei4'],
    ]));
});

describe('子: a suffix or a word of its own', () => {
  it('keeps zǐ for a son after a verb, the hour, a title, Daoist and Japanese names, and seeds', () =>
    checkReadings([
      ['劉表遣子入侍。', '子', 'zi3', true], ['故曰，天開於子。', '子', 'zi3', true], ['乃子、丑、寅、卯。', '子', 'zi3', true],
      ['娶了妻生了子，一家都高兴。', '子', 'zi3'], ['长真子来了。', '子', 'zi3'], ['秋原玲子来了。', '子', 'zi3'],
      ['离乡携子的母亲。', '子', 'zi3'], ['山上有樟子松。', '子', 'zi3'], ['三秋桂子，十里荷花。', '子', 'zi3'],
      ['她送了一盒惠子做的点心。', '惠子', 'hui4 zi3'],
    ]));
  it('still reads the suffix neutral', () => checkReadings([['他的簪子掉了。', '簪子', 'zan1 zi5'], ['她的媳妇子正等着。', '子', 'zi5']]));
});

describe('得: dé, de and děi', () => {
  it('reads dé for what is got after a modal word, a causative or 必, and de for a potential complement', () =>
    checkReadings([
      ['她第二年就得病走了。', '得', 'de2'], ['安排还得法，没出差错。', '得', 'de2'], ['他应当得匹好马。', '得', 'de2'],
      ['你要让我得读这部书。', '得', 'de2'], ['此战必得重赏。', '得', 'de2'], ['他也得个死罪。', '得', 'de2'],
      ['这人只有你制他得住。', '得', 'de5'], ['我想你得要命。', '得', 'de5'], ['心里安得下。', '得', 'de5'], ['你下得了手吗？', '得', 'de5'],
      ['我得绝症那年才四十岁。', '得', 'de2'], ['他就想得到一点安慰。', '得到', 'de2 dao4'], ['谁想得到呢？', '得到', 'de5 dao4'], ['哪想得到他躲在那里。', '得到', 'de5 dao4'],
    ]));
  it('reads děi for "must", also after 必 before a longer clause and before a time at the start', () =>
    checkReadings([
      ['你必得跟她讲清楚。', '得', 'dei3'], ['这件事很急，得今天办！', '得', 'dei3'], ['你还得上班。', '得', 'dei3'],
    ]));
});

describe('干: gān and gàn', () => {
  it('reads gān for dried, drained, sworn kin and "to concern"', () =>
    checkReadings([
      ['他喝口茶润润说干了的嘴。', '干', 'gan1'], ['衣袖沾着干了的血迹。', '干', 'gan1'], ['风吹不干他的汗。', '干', 'gan1'],
      ['她是我干妹子。', '干', 'gan1'], ['老李举杯先干了一杯。', '干', 'gan1'], ['那不干他的事。', '干', 'gan1'], ['事不干己。', '干', 'gan1'],
      ['海干了，鱼就死了。', '干', 'gan1'], ['不干你秀才事。', '干', 'gan1'],
    ]));
  it('reads gàn for doing work', () =>
    checkReadings([
      ['他们干他们那行的。', '干', 'gan4'], ['你这么干可不对。', '干', 'gan4'], ['她总是干不成。', '干', 'gan4'], ['他们不干这种事。', '干', 'gan4'],
      ['干干脆脆地走了。', '干干脆脆', 'gan1 gan1 cui4 cui4'],
    ]));
});

describe('将, 那里, 给, 片子, 卷子, 差, 挨, 东西, 精神, 赚', () => {
  it('reads each by what is around it', () =>
    checkReadings([
      ['他一将信交出去，大家都松了口气。', '将', 'jiang1'], ['一将当先，杀出重围。', '将', 'jiang4'], ['千军易得，一将难求。', '将', 'jiang4'],
      ['王家将有一场喜事。', '将', 'jiang1'], ['乃喚手下降將臧霸。', '将', 'jiang4', true], ['顏良將兵五萬。', '将', 'jiang4', true],
      ['用此孺子為將。', '将', 'jiang4', true],
      ['他调到那里当个小组长。', '那里', 'na4 li5'], ['她从邻居那里借到一把伞。', '那里', 'na4 li5'], ['那里肯听他的？', '那里', 'na3 li5'],
      ['天下那里有这样的事。', '那里', 'na3 li5'], ['每月再给发一袋米。', '给', 'gei3'], ['地上有一块瓦片子。', '片子', 'pian4 zi5'],
      ['她抱着一卷子旧报纸。', '卷子', 'juan3 zi5'], ['他交了卷子。', '卷子', 'juan4 zi5'],
      ['这样他回去交不了差。', '差', 'chai1'], ['他开了小差。', '差', 'chai1'], ['高低之差。', '差', 'cha1'], ['县城条件差。', '差', 'cha4'],
      ['她一挨到枕头就睡了。', '挨', 'ai1'], ['好不容易挨到了下课。', '挨', 'ai2'], ['一步步挨上岭来。', '挨', 'ai1'], ['你挨点骂算什么？', '挨', 'ai2'],
      ['各样东西两大箱。', '东西', 'dong1 xi5'], ['屋里的东西向四处飞去。', '东西', 'dong1 xi5'], ['东西两边都是山。', '东西', 'dong1 xi1'],
      ['谁也没有精神准备。', '精神', 'jing1 shen2'], ['他很有精神。', '精神', 'jing1 shen5'],
      ['他来赚他的工资。', '赚', 'zhuan4'], ['使他賺幾個辛苦錢。', '赚', 'zhuan4', true], ['他想赚我入城。', '赚', 'zuan4'],
    ]));
});

describe('the verbs and nouns of the old novels', () => {
  it('reads them by their neighbors', () =>
    checkReadings([
      ['戰不數合，瓚敗走。', '数', 'shu4', true], ['天边划过数道闪电。', '数', 'shu4'], ['妙演三乘教。', '教', 'jiao4'], ['備不敢聞教。', '教', 'jiao4', true],
      ['他不肯教人看。', '教', 'jiao4'], ['教我如何不想她？', '教', 'jiao4'], ['她在中学里教数学。', '教', 'jiao1'], ['他偏不教她。', '教', 'jiao1'],
      ['你們坐著吃罷，我可去了。', '罢', 'ba5', true], ['實和你說罷，快說罷。', '罢', 'ba5', true], ['說罷，便走了。', '罢', 'ba4', true],
      ['原來是懸崖削壁。', '削', 'xue1', true], ['只是削汝兄弟兵權。', '削', 'xue1', true], ['她削了两个梨。', '削', 'xiao1'],
      ['別盡著想長想短。', '尽', 'jin3', true], ['背了白馬，三藏騎上。', '背', 'bei4', true], ['他必不背我。', '背', 'bei4'],
      ['她只背了三页。', '背', 'bei4'], ['他背起书包走了。', '背', 'bei1'],
      ['孔明將羽扇一搖。', '扇', 'shan4', true], ['他家两扇大门。', '扇', 'shan4'], ['国王急降金牌。', '降', 'jiang4'], ['你如何不降？', '降', 'xiang2'], ['一辆车从天而降。', '降', 'jiang4'],
      ['你犯了十惡之罪。', '恶', 'e4', true], ['語氣甚惡。', '恶', 'e4', true], ['甚惡你等。', '恶', 'wu4', true], ['眾皆惡之。', '恶', 'wu4', true],
      ['山花遍地鋪。', '铺', 'pu1', true], ['他在上面铺。', '铺', 'pu1'], ['这是一家铁匠铺。', '铺', 'pu4'],
      ['只見祥光晃晃。', '晃', 'huang3', true], ['她晃身挡在路中间。', '晃', 'huang3'], ['还要难他一难。', '难', 'nan2'], ['又过了八十一难。', '难', 'nan4'],
      ['我自率大兵攻城。', '率', 'shuai4'], ['宝钗见他怔了。', '怔', 'zheng4'], ['披掛綽鎗，開了柵寨。', '绰', 'chao1', true],
      ['荷明公寬大之恩。', '荷', 'he4', true], ['量你是個配軍。', '量', 'liang4', true], ['急不能勾打得城破。', '勾', 'gou4', true],
      ['眾官唯唯而散。', '唯唯', 'wei3 wei3', true], ['再來經過，重睹一番。', '重', 'chong2', true], ['賈芹此時紅漲了臉。', '涨', 'zhang4', true],
      ['天有幾更了？', '更', 'geng1', true], ['置辦些買賣行頭。', '行头', 'xing2 tou5', true], ['恭近於禮，遠恥辱也。', '远', 'yuan4', true],
      ['返景入深林。', '景', 'ying3'], ['花落知多少。', '多少', 'duo1 shao3'], ['他也不知多少。', '多少', 'duo1 shao5'], ['伐木丁丁。', '丁丁', 'zheng1 zheng1'],
      ['如万箭攒心。', '攒', 'cuan2'], ['万物否矣。', '否', 'pi3'], ['芝麻一行，茄子一行。', '一行', 'yi1 hang2'],
      ['那个生性好事的掌柜。', '好事', 'hao4 shi4'], ['做事千万别大意。', '大意', 'da4 yi5'], ['这是文章的大意。', '大意', 'da4 yi4'],
      ['你别老讨好人家。', '人家', 'ren2 jia5'], ['我们寻个人家住下。', '人家', 'ren2 jia1'], ['河水冲着那块木板。', '冲', 'chong1'], ['他冲着我笑。', '冲', 'chong4'],
      ['月光撒向湖面。', '撒', 'sa3'], ['一双刚上过油的钉鞋。', '钉', 'ding1'], ['她跟着师傅钉鞋。', '钉', 'ding4'],
      ['他先去弄口锅来。', '弄', 'nong4'], ['她在抽屉里摸着。', '着', 'zhe5'], ['他睡着了。', '着', 'zhao2'], ['我种的地。', '种', 'zhong4'], ['这种的退化。', '种', 'zhong3'],
      ['那条长到地的裙子。', '长', 'chang2'], ['这根竹竿比那根长了一尺。', '长', 'chang2'], ['她年轻时长得真俊。', '长', 'zhang3'],
      ['他拿铁锨和泥。', '和', 'huo2'], ['他闷着头吃饭。', '闷', 'men1'], ['我有点想吐。', '吐', 'tu4'], ['又把他喝醒了。', '喝', 'he4'],
      ['屋顶中间空一块。', '空', 'kong4'], ['烟味呛人。', '呛', 'qiang4'], ['这么霸横。', '横', 'heng4'], ['全家都是她供着。', '供', 'gong1'], ['供着菩萨。', '供', 'gong4'],
      ['蚯蚓钻进地下去过冬。', '地', 'di4'], ['又跳又叫地跑进来。', '地', 'de5'], ['一瞬不瞬地盯着她。', '地', 'de5'], ['子弹嗖地飞出去。', '地', 'de5'],
      ['他在家里哭天哭地的。', '哭地', 'ku1 di4'], ['一遍遍地问。', '地', 'de5'], ['梦里忽觉回到了老家。', '觉', 'jue2'], ['和他一斗。', '斗', 'dou4'],
      ['他还了酒钱。', '还', 'huan2'], ['快拿出来还我！', '还', 'huan2'], ['总得还人家钱。', '还', 'huan2'], ['他还我们。', '还', 'hai2'],
    ]));
});

describe('word groupings', () => {
  const lex = (...words: string[]) =>
    buildLexicon(words.map((word) => ({ word, pinyin: '', gloss: '', kind: 'name' as const, enabled: true, origin: 'auto' as const })));
  /** Han tokens of the sentence, '|'-joined. */
  async function cut(text: string, lexicon?: Lexicon, trad = false): Promise<string> {
    const d = await dictP;
    return run(d, text, trad, lexicon).filter((t) => t.kind === 'han').map((t) => t.text).join('|');
  }

  it('keeps 人大 the congress and splits 人 + 大X', async () => {
    expect(await cut('他当选为人大代表。')).toContain('人大');
    expect(await cut('等到人大会议开幕。')).toContain('人大');
    expect(await cut('这批人大都来自外地。')).toContain('大都');
    expect(await cut('二人大惊。')).not.toContain('人大');
    expect(await cut('那个人大吼着。')).not.toContain('人大');
  });

  it('cuts a number only where it is one (estimates, the multiplication rhyme, not 零 at the start)', async () => {
    expect(await cut('房钱一千五一个人。')).toContain('一千五|一个|人');
    expect(await cut('她过了两年零八个月才回来。')).not.toContain('零八');
    expect(await cut('有三四十人，三二十人，五七百个。')).toMatch(/三四十.*三二十.*五七百/);
    expect(await cut('停灵七七四十九日。')).toContain('七七四十九');
    expect(await cut('或三五千一行。')).toContain('三五千|一行');
    expect(await cut('他三十岁了。')).toContain('三十');
  });

  it('cuts words whose halves belong to their neighbors', async () => {
    const cases: [string, string][] = [
      ['一路跑到门口才停下。', '口|才'], ['猜不透那点心事。', '心事'], ['他心头发闷。', '心头|发'], ['即使用力推也推不开。', '即使|用'],
      ['小狗跟随着主人。', '跟随|着'], ['孩子转过脸来说。', '来|说'], ['他们又点火烧水。', '点火|烧'], ['小狗把头伏在爪子上。', '伏'],
      ['她用手把门推开。', '手|把'], ['花瓣转着落下去。', '着|落下'], ['晾在天台上的衣服。', '天台|上'], ['口水滴到了书上。', '口水|滴'],
      ['好使他不再犯错。', '好|使'], ['为他作保山的人。', '作|保山'], ['大官人在庄上收租。', '大|官人'], ['方今天下大乱。', '今|天下'],
      ['他磕了个头。', '个|头'], ['一遍遍地问。', '遍|地'], ['老人连名字都记不得了。', '不得|了'], ['这下可不得了。', '不得了'],
      ['小校報道：「敵兵到了。」', '报|道'], ['唱將來，請將來。', '唱|将|来'], ['将军从马上弯下腰。', '马|上'], ['买票时说是去北京。', '时|说'],
      ['你可别怪我心软。', '我|心'], ['三个人行了半日。', '人|行'], ['他在北师大儿子在复旦。', '北师大|儿子'],
    ];
    for (const [text, want] of cases) expect(`${text} ${await cut(text, undefined, /[報將]/.test(text))}`).toContain(want);
  });

  it('keeps 个人 "personal" after 是 and 有, and cuts 个 + 人 after 多 来 算 俩', async () => {
    expect(await cut('这仅仅是个人的看法。')).toContain('个人');
    expect(await cut('她有个人原因。')).toContain('个人');
    expect(await cut('十来个人，三十多个人，这也算个人？')).not.toContain('个人');
  });

  it('opens a clause with 是以 要不 夜来 好在 only where they mean so', async () => {
    expect(await cut('是以不敢。')).toContain('是以');
    expect(await cut('这是以手工方式制作的。')).not.toContain('是以');
    expect(await cut('要不你先走。')).toContain('要不');
    expect(await cut('要不去，她也没办法。')).not.toContain('要不');
    expect(await cut('夜来了，风也停了。')).not.toContain('夜来');
    expect(await cut('好在哪里？')).not.toContain('好在');
  });

  it('reads 的话 as "if" in 那样的话 and 是…的话, and as words after a verb of hearing', async () => {
    expect(await cut('那样的话我们就输了。')).toContain('的话');
    expect(await cut('真是那样子的话，就算了。')).toContain('的话');
    expect(await cut('皇帝听信了小人的话。')).toContain('的|话');
    expect(await cut('老师讲了这样的话：做人要诚实。')).toContain('的|话');
    expect(await cut('她想起父亲说的话，哭了。')).toContain('的|话');
    expect(await cut('是我哄他的话，你别信。')).toContain('的|话');
  });

  it('does not take 地上 地面 as the particle after a doubled verb or 在在', async () => {
    expect(await cut('他敲敲地面。')).toContain('地面');
    expect(await cut('小猫现在在地上睡觉。')).toContain('地上');
    expect(await cut('她笨手笨脚地上来。')).toContain('地|上来');
  });

  it('does not boost a name that both of its neighbors claim (青海民歌 around 海民)', async () => {
    expect(await cut('她会唱几首青海民歌。', lex('海民'))).toContain('青海|民歌');
    expect(await cut('海民来了。', lex('海民'))).toContain('海民');
  });
});
