// The fourth native review of every Chinese book (2026-11): the rules the second repair pass made too wide, narrowed again (为 both
// ways, 著 zháo, 那里 nǎ, 是以, 种的, 长, 精神, 铺, 斗 …), and the patterns the reviewers found still wrong (降 xiáng, 难 nàn, 哄 hǒng,
// modern words in classical lines). Each case is an invented sentence or a line of a public-domain classic run through segment(), so
// the paragraph's other tokens are seen as the reader sees them. A case marked `true` is written in traditional characters.
import { describe, expect, it } from 'vitest';
import { segment } from '../../src/core/segment';
import { loadTestDictionary } from '../helpers/data';
import type { Dictionary, Token } from '../../src/types';

const dictP = loadTestDictionary();

function run(d: Dictionary, text: string, trad: boolean): Token[] {
  if (!trad) return segment(text, d);
  const shown = d.toSimplified(text);
  return segment(shown, d, undefined, undefined, shown.length === text.length ? text : undefined);
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

async function cut(text: string, trad = false): Promise<string> {
  const d = await dictP;
  return run(d, text, trad).filter((t) => t.kind === 'han').map((t) => t.text).join('|');
}

/** [sentence, a grouping the cut must contain, written in traditional?] */
async function checkCuts(cases: [string, string, boolean?][]): Promise<void> {
  for (const [text, want, trad] of cases) {
    const got = await cut(text, !!trad);
    expect(`${text} ${got}`).toContain(want);
  }
}

describe('为 in the old books: wèi "for" and wéi "to be, to serve as"', () => {
  it('reads wèi when what is done for the person follows them, after a 是 inside the clause and in 却为谁', () =>
    checkReadings([
      ['吾為君赦之；但彼不容。', '为', 'wei4', true], ['今為君計，莫若遣使。', '为', 'wei4', true], ['是老漢力為大聖冒罪奏聞。', '为', 'wei4', true],
      ['必然為大聖有事。', '为', 'wei4', true], ['他曾為友報讎殺人。', '为', 'wei4', true], ['作踐他們，為君父生色。', '为', 'wei4', true],
      ['便知又是為寶玉了。', '为', 'wei4', true], ['正是為寶玉來，反忘了。', '为', 'wei4', true], ['一則是為性命，二則為名。', '为', 'wei4', true],
      ['暗灑閒拋卻為誰？', '为', 'wei4', true], ['蓋為取經僧，靈山參佛。', '为', 'wei4', true],
    ]));

  it('reads wéi for an office or a role, 是为 opening a clause, 为人, 为先 and 为头领', () =>
    checkReadings([
      ['是為靈帝。', '为', 'wei2', true], ['今欽點出為巡鹽御史。', '为', 'wei2', true], ['聞煥章來，為軍前參謀。', '为', 'wei2', true],
      ['時人，為荊南刺史。', '为', 'wei2', true], ['歇下，權為行軍帥府。', '为', 'wei2', true], ['馬一匹，送為遠行腳力。', '为', 'wei2', true],
      ['走為上著。', '为', 'wei2', true], ['為先的那和尚醜便醜。', '为', 'wei2', true], ['你一生為人心痴意軟。', '为', 'wei2', true],
      ['殿下，為人生在天地之間。', '为', 'wei2', true], ['望著為頭領的一個馬軍。', '为', 'wei2', true], ['與之為友。', '为', 'wei2', true],
      ['為君難，為臣不易。', '为', 'wei2', true], ['此人為誰？', '为', 'wei2', true],
    ]));

  it('reads the passive wéi before people doing it, and wèi for whom something is done', () =>
    checkReadings([
      ['那口箱子，为四个人扛着进了院子。', '为', 'wei2'], ['为三个孩子买衣裳。', '为', 'wei4'], ['为三个人准备着饭菜。', '为', 'wei4'],
    ]));
});

describe('著 and 着: zháo "to reach, to catch fire" and zhe', () => {
  it('reads zháo for 撞著 遇著 in the old novels and for a fire caught at the end of a clause', () =>
    checkReadings([
      ['猛然撞著黑旋風。', '著', 'zhao2', true], ['若有人來撞著，便是禍事。', '著', 'zhao2', true], ['正遇著一夥強人。', '著', 'zhao2', true],
      ['一齊燒著。', '著', 'zhao2', true], ['車仗盡著，光火沖天。', '著', 'zhao2', true], ['她不小心把衣角烧着，吓了一跳。', '着', 'zhao2'],
      ['那棵被烧着的老树倒了。', '着', 'zhao2'], ['这瓶药水别让孩子碰着。', '着', 'zhao2'],
    ]));

  it('keeps zhe for what is going on', () =>
    checkReadings([
      ['炉火烧着，屋里很暖。', '着', 'zhe5'], ['灶上烧着一壶茶。', '着', 'zhe5'], ['他赶著車往前走。', '著', 'zhe5', true],
    ]));

  it('reads 尽著 jìn "all" when the clause ends or troops follow, jǐn "keep on" before what is done', () =>
    checkReadings([
      ['車仗盡著，光火沖天。', '尽', 'jin4', true], ['四面盡著軍馬圍住。', '尽', 'jin4', true], ['又盡著他喫。', '尽', 'jin3', true],
    ]));
});

describe('那里: nǎli "how could, where" in the older writing', () => {
  it('reads nǎli across a clause boundary, after a place word, in 那里话 and before a potential complement', () =>
    checkReadings([
      ['跪在地下，那裏肯起來。', '那里', 'na3 li5', true], ['他在寺裏住持，那裏敢管他？', '那里', 'na3 li5', true],
      ['你們在家裏那裏知道外頭的事。', '那里', 'na3 li5', true], ['寶玉乍到郊外，那裏肯回去。', '那里', 'na3 li5', true],
      ['說那裏話！', '那里', 'na3 li5', true], ['李逵那裏睡得著。', '那里', 'na3 li5', true], ['你是那裏來的？', '那里', 'na3 li5', true],
      ['大哥也不知那里去了。', '那里', 'na3 li5'], ['那有这事？', '那', 'na3'], ['長老那裏來的？', '那里', 'na3 li5', true],
      ['孫行者，你往那裏走了？', '那里', 'na3 li5', true], ['眾人那裏看得出來？', '那里', 'na3 li5', true],
    ]));

  it('keeps nàli for "there"', () =>
    checkReadings([
      ['他在那裏住持。', '那里', 'na4 li5', true], ['那裏有多少人馬？', '那里', 'na4 li5', true], ['你在那裏做甚麼？', '那里', 'na4 li5', true],
      ['我那裏還有一篇咒？', '那里', 'na4 li5', true], ['她在前任厂长那里拿到批条。', '那里', 'na4 li5'], ['不知那里如今怎样。', '那里', 'na4 li5'], ['我不知那里的风俗。', '那里', 'na4 li5'], ['从朋友那里得到消息。', '那里', 'na4 li5'],
    ]));
});

describe('readings the repair pass reached too far with', () => {
  it('种 planted, 长 a length, 精神 vigor, 铺 a bed, 钉鞋 mending, 干喝, 比…差, 放大率, 二斗', () =>
    checkReadings([
      ['这是我们组种的菜园。', '种', 'zhong4'], ['园子里种的都是瓜果。', '种', 'zhong4'], ['那年种的时候天很旱。', '种', 'zhong4'],
      ['瓜是小人种的。', '种', 'zhong4'], ['他担心种的退化。', '种', 'zhong3'], ['还有Ｕ种的吗？', '种', 'zhong3'],
      ['一道八华里长的堤。', '长', 'chang2'], ['一段四百公里长的铁路。', '长', 'chang2'], ['数里长的山谷。', '长', 'chang2'],
      ['那条路长得看不见头。', '长', 'chang2'], ['你长的真好看。', '长', 'zhang3'],
      ['老人显得挺有精神。', '精神', 'jing1 shen5'], ['小伙子看上去真精神。', '精神', 'jing1 shen5'], ['他已没精神再讲下去了。', '精神', 'jing1 shen5'],
      ['他打起精神来。', '精神', 'jing1 shen5'], ['他们鼓起精神往上爬。', '精神', 'jing1 shen5'], ['这船员连点精神上的享受都没有。', '精神', 'jing1 shen2'],
      ['躺在下铺看书。', '铺', 'pu4'], ['宿舍里的上下铺。', '铺', 'pu4'], ['打个地铺，方便睡觉。', '铺', 'pu4'], ['在上面铺一层草。', '铺', 'pu1'],
      ['修鞋匠把钉鞋工具收好。', '钉', 'ding4'], ['光干喝酒也不是办法。', '干', 'gan1'], ['要是那样干下去，早晚出事。', '干', 'gan4'],
      ['你的学问比当官的人差！', '差', 'cha4'], ['他交不了差。', '差', 'chai1'], ['明公差矣。', '差', 'cha4'],
      ['镜头的放大率五十倍。', '率', 'lü4'], ['率三万人马。', '率', 'shuai4'],
      ['换了三斗高粱，二斗小米。', '二斗小米', 'er4 dou3 xiao3 mi3'], ['与了他三斗米。', '斗', 'dou3'], ['和他一斗。', '斗', 'dou4'],
      ['他晃了晃地畔边的篱笆。', '地', 'di4'],
    ]));

  it('one-offs in the classics: 一将守关, 羞恶, 东西两角门, 无相, 宝相送, 教祖, 背人, 赚漏, 挨到五更, 必得, 得了手', () =>
    checkReadings([
      ['果然一將守關，萬夫莫開。', '将', 'jiang4', true], ['一時羞惡之心感發。', '恶', 'wu4', true], ['愛之欲其生，惡之欲其死。', '恶', 'wu4', true],
      ['只有東西兩角門有人出入。', '东西', 'dong1 xi1', true], ['無相門中真法主。', '相', 'xiang4', true], ['珍奇之寶相送。', '相', 'xiang1', true],
      ['他是白莲教教祖的弟子。', '教祖', 'jiao4 zu3'], ['叫馬兒過來背人。', '背', 'bei1', true], ['兄長吃他賺漏了這個銀子。', '赚', 'zuan4', true],
      ['且挨到五更裏下手。', '挨', 'ai2', true], ['必得是鳳姐兒。', '得', 'dei3', true], ['太太此時必得快辦。', '得', 'dei3', true],
      ['必得重賞。', '得', 'de2', true], ['那賊得了手，不往西去。', '得', 'de2', true], ['他哪里下得了手？', '得', 'de5'],
      ['最恶的是假话。', '恶', 'wu4'],
    ]));
});

describe('readings the reviewers found still wrong', () => {
  it('降 xiáng for surrendering and subduing, jiàng for coming down', () =>
    checkReadings([
      ['被我降了。', '降', 'xiang2'], ['岂可降之？', '降', 'xiang2'], ['璋自然降矣。', '降', 'xiang2'], ['降即免死。', '降', 'xiang2'],
      ['菩萨收降了他。', '降', 'xiang2'], ['气温降了两度。', '降', 'jiang4'], ['他降了职。', '降', 'jiang4'],
      ['等我作法降他。', '降', 'xiang2'], ['大些的才降得他。', '降', 'xiang2'], ['袁譚之降，真耶？', '降', 'xiang2', true],
      ['決不降汝！', '降', 'xiang2', true], ['天降一人。', '降', 'jiang4'], ['后主降诏致祭。', '降', 'jiang4'],
      ['水温能降到零度。', '降', 'jiang4'], ['像初降的春雨。', '降', 'jiang4'],
    ]));

  it('难 nàn "in danger", 哄 hǒng "to fool", 术赤 zhú, 蔑儿乞 ér, 系 jì "to tie", 人家 a household, 一行 a line, 道 dǎo', () =>
    checkReadings([
      ['你知師父有難麼？', '难', 'nan4', true], ['这题有难度。', '难度', 'nan2 du4'],
      ['使了一個計哄了。', '哄', 'hong3', true], ['把他哄將來。', '哄', 'hong3', true], ['哄那怪物出來。', '哄', 'hong3', true], ['全场哄笑。', '哄', 'hong1'],
      ['术赤带兵西征。', '术', 'zhu2'], ['蔑儿乞人来了。', '儿', 'er2'],
      ['她没有系围裙。', '系', 'ji4'], ['棒上系一条长绳。', '系', 'ji4'], ['把船系在树上。', '系', 'ji4'],
      ['河对岸住着一户姓李的人家。', '人家', 'ren2 jia1'], ['街两边的人家都关了门。', '人家', 'ren2 jia1'],
      ['屏幕上闪出一行编号。', '一行', 'yi1 hang2'], ['道千乘之國，敬事而信。', '道', 'dao3', true],
    ]));
});

describe('the rules above kept narrow (what a first try at them got wrong)', () => {
  it('keeps jiàng for coming down and bestowing, wéi for the passive and for an office held, hōng for a crowd, pū for spreading', () =>
    checkReadings([
      ['駕瑤象以降乎泉壤耶？', '降', 'jiang4', true], ['若冀州不弟，當降心相從。', '降', 'jiang4', true], ['即降聖旨。', '降', 'jiang4', true],
      ['便乃降階而接。', '降', 'jiang4', true], ['此神人降矣。', '降', 'jiang4', true], ['兄此言豈不為天下笑乎？', '为', 'wei2', true],
      ['現為丞相府主簿。', '为', 'wei2', true], ['敢問公為朝廷何官？', '为', 'wei2', true], ['一齊都哄出堂後空地上。', '哄', 'hong1', true],
      ['黑煙鋪地，二三百里。', '铺', 'pu1', true], ['卻似銀鋪世界。', '铺', 'pu1', true], ['開銀鋪的姚二郎。', '铺', 'pu4', true],
      ['招的人家咒骂。', '人家', 'ren2 jia5'], ['人总有精神的饥渴。', '精神', 'jing1 shen2'], ['咱们去斗他一斗。', '斗他一斗', 'dou4 ta1 yi1 dou4'],
      ['皆系上回偶然一拟。', '系', 'xi4', true], ['大家哄他顽了一会。', '哄', 'hong3'], ['他们苦苦相求。', '相', 'xiang1'], ['满脸的痛苦相。', '相', 'xiang4'],
      ['極天際地，伊、周莫及。', '地', 'di4', true], ['他从小系在上海长大的。', '系', 'xi4'], ['尚不大难。', '难', 'nan2'],
    ]));

  it('one-offs of the older prose: 阙 识 著 间 咽 相 觉 种 吓 折 着 地 传 当', () =>
    checkReadings([
      ['消息渐阙。', '阙', 'que1'], ['七年四月二日识。', '识', 'zhi4'], ['不著月日。', '著', 'zhu4', true], ['间亦有略具联络者。', '间', 'jian4'],
      ['呜呜咽咽的哭。', '呜呜咽咽', 'wu1 wu1 ye4 ye4'], ['那副傻相。', '相', 'xiang4'], ['他把觉睡足了才起来。', '觉', 'jiao4'],
      ['豆子种毕。', '种', 'zhong4'], ['吓，什么都瞒不过我。', '吓', 'he4'], ['折了本。', '折', 'she2'], ['他着了慌。', '着', 'zhao2'],
      ['他很高兴地，跳了起来。', '地', 'de5'], ['差不多先生传。', '传', 'zhuan4'], ['当亲生儿子看待。', '当', 'dang4'],
      ['彷佛在梦中。', '彷佛', 'fang3 fu2'], ['老人教她如何种菜。', '教', 'jiao1'], ['这首诗是姐姐教我背的。', '教', 'jiao1'],
      ['教我如何不想她？', '教', 'jiao4'], ['這個悶葫蘆，教我如何猜得破？', '教', 'jiao4', true], ['教他如何是好？', '教', 'jiao4'],
    ]));

  it('groups 要说…的话 as "if", 两头来往 as "to and fro", 岸柳|枝条', () =>
    checkCuts([
      ['要说还有啥心愿的话，就是再见她一面。', '的话'], ['我要说的话，你都知道。', '的|话'], ['要說一句緊要的話，求見一面。', '的|话', true], ['兩頭來往踅。', '来往', true],
      ['岸柳枝條，斜垂在宮南。', '枝条', true],
    ]));
});

describe('groupings', () => {
  it('fixes the groupings the repair pass broke', () =>
    checkCuts([
      ['无人告知，是以他毫不知情。', '是以|他'], ['他是以你为榜样的。', '是|以'], ['脊杖二十，刺配遠惡軍州。', '刺配', true],
      ['刺配遠惡軍州。', '军州', true], ['菩薩將楊柳枝蘸出甘露。', '杨柳枝', true], ['那菩薩將柳枝連拂幾點。', '柳枝', true],
      ['呀，那有難的人大沒緣法。', '人|大', true], ['棒架長槍聲響。', '长枪|声', true], ['是再沒有的話。', '的|话', true],
      ['如果明天下雨的话，就不去了。', '的话'], ['对于机器本身来说，这不算什么。', '来说'], ['小王转过脸来说：', '来|说'],
      ['快走吧，要不来晚了没座位。', '要不'], ['要不去，就别去。', '要|不'], ['口诀是三六十八。', '三六十八'],
      ['只有吃饱了，才能不想家。', '才|能'], ['他的才能不如哥哥。', '才能'], ['只为使将来的子孙不受苦。', '将来'], ['好使将军放心。', '好|使'],
    ]));

  it('cuts modern words out of classical and older lines', () =>
    checkCuts([
      ['縱馬來迎。', '马|来', true], ['回頭見他走了。', '见|他', true], ['關上門。', '门', true], ['往灶里加了几根柴。', '里|加'],
      ['波纹由内向外扩散。', '内|向'], ['东湾和田家庄。', '和|田'], ['咬你几口才出气。', '口|才'], ['他能耐饥，也能耐寒。', '能|耐'],
      ['问及时局。', '问及'], ['这点心头肉。', '点|心'], ['大海里的鱼。', '大海|里'], ['他不大会说话。', '不大|会'],
      ['他自称心满意足。', '自|称'], ['天上飘着些微云。', '些|微'], ['人生活在世上。', '人|生活'], ['他扭转头来往外瞧。', '来|往'],
      ['他退了四大步。', '四|大步'], ['当红门被推开时，', '当|红'], ['八点三十分开车。', '三十分'], ['物外长年。', '外|长年'],
      ['下首相陪。', '首|相'], ['節用而愛人，使民以時。', '爱|人', true], ['不好犯上，而好作亂者，未之有也。', '不|好|犯上', true],
      ['以禮節之，亦不可行也。', '礼|节', true],
    ]));

  it('keeps names, titles and old words whole', () =>
    checkCuts([
      // (張任 is a curated name of 三國 with scope "book": it joins in a book that uses it, tests/core/data-plumbing.test.ts.)
      ['宋江做押司時。', '押司', true], ['張翼德大喝一聲。', '张翼德', true], ['明公差矣。', '明公|差', true],
      ['逃走在柴大官人家。', '官人|家', true], ['幾十個科斗子。', '科斗', true], ['楊二嫂發見了這件事。', '发见', true], ['在魯鎮的酒店裏。', '鲁镇', true],
    ]));
});
