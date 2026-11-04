// Segmentation of a paragraph into tokens. Contract: ARCHITECTURE.md §4.2.
//
// Han runs are cut with the jieba method: build the DAG of dictionary words over the run and take the path with
// the highest total log-probability. Everything else is split by character class.
import type { Dictionary, Token, TokenKind, Lexicon, RubySpan } from '../types';
import { isHanCodePoint } from './text';
import { activeEngine } from '../lang/active';
import { SURNAMES } from './names';

/** Used when the dictionary does not report the corpus size (jieba dict.txt.big). */
const DEFAULT_TOTAL = 83_170_339;
/**
 * Score cost (in nats, below the weakest possible corpus word) of a multi-character word that CC-CEDICT or the
 * Wiktionary supplement lists but the jieba corpus never saw. Such words still beat a run of unseen characters
 * (idioms, rare compounds) but lose to a split into common words ("我|不|知道" over "我不知道").
 * Chosen on the gold sets in tests/core/gold.ts.
 */
const UNSEEN_WORD_PENALTY = 4;
/** Score (nats) of a lexicon word the corpus never saw: about a million occurrences, like 我们 or 因为. */
const LEXICON_WEIGHT = 14;
/** Corpus count from which a lexicon word that the dictionary lists as an ordinary word (中学, 大海) is scored as that word. */
const COMMON_LEXICON_COUNT = 100;
/** Marks a candidate that came from the lexicon, so a word in both places is not scored twice. */
const LEX_PREFIX = '\u0000';

type Cls = 'han' | 'latin' | 'num' | 'punct' | 'space' | 'other' | 'mark';

const LATIN_RE = /^\p{Script=Latin}$/u;
const MARK_RE = /^\p{M}$/u;
const DIGIT_RE = /^\p{Nd}$/u;
const SPACE_RE = /^\s$/u;
const PUNCT_RE = /^[\p{P}\p{Sm}\p{Sc}\p{Sk}]$/u;

const clsCache = new Map<number, Cls>();

function classify(cp: number): Cls {
  if (cp < 128) {
    if ((cp >= 48 && cp <= 57)) return 'num';
    if ((cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122)) return 'latin';
    if (cp === 32 || (cp >= 9 && cp <= 13)) return 'space';
    if (cp < 32 || cp === 127) return 'other';
    return 'punct';
  }
  if (isHanCodePoint(cp)) return 'han';
  let c = clsCache.get(cp);
  if (c) return c;
  const ch = String.fromCodePoint(cp);
  if (SPACE_RE.test(ch)) c = 'space';
  else if (DIGIT_RE.test(ch)) c = 'num';
  else if (LATIN_RE.test(ch)) c = 'latin';
  else if (MARK_RE.test(ch)) c = 'mark';
  else if (PUNCT_RE.test(ch) || (cp >= 0xff01 && cp <= 0xff0f) || (cp >= 0xff1a && cp <= 0xff20) || (cp >= 0xff3b && cp <= 0xff40) || (cp >= 0xff5b && cp <= 0xff65)) c = 'punct';
  else c = 'other';
  if (clsCache.size < 5000) clsCache.set(cp, c);
  return c;
}

const KIND: Record<Exclude<Cls, 'mark'>, TokenKind> = {
  han: 'han', latin: 'latin', num: 'num', punct: 'punct', space: 'space', other: 'other',
};

function cpAt(text: string, i: number): { cp: number; len: number } {
  const cp = text.codePointAt(i)!;
  return { cp, len: cp > 0xffff ? 2 : 1 };
}

function isSingleCodePoint(w: string): boolean {
  return w.length === 1 || (w.length === 2 && w.charCodeAt(0) >= 0xd800 && w.charCodeAt(0) <= 0xdbff);
}

/** Bonus (nats) that keeps 一一 together. */
const ONE_ONE_BONUS = 6;
const NUMERAL_BEFORE_ZHI = '一二三四五六七八九十两兩几幾';
/** Characters that spell a year digit by digit (一九一八年): such a run is one token, not the dictionary's 九一八. */
const YEAR_DIGITS = '〇零一二三四五六七八九';
const ORDINAL_DIGITS = '〇零一二三四五六七八九十百千兩两';
/** After a number, 多 belongs to the number (三十多年 is 三十多 + 年, not 三十 + 多年 "many years"). */
const NUMERAL_BEFORE_DUO = '十百千萬万二三四五六七八九〇零';
const AFTER_DUO = '年歲岁天日月次人回遍斤里位个個';
/**
 * Words the dictionary has that a reader of the old novels and the classics almost never means; where they appear the text is
 * two words (他用船 is 他 + 用 + 船, 但聞人語響 is 聞 + 人語, 驚的士奇 is 驚 + 的 + 士奇). Each loses 8 nats.
 */
const UNLIKELY_WORDS: ReadonlySet<string> = new Set([
  '他用', '聞人', '闻人', '的士', '先見', '先见', '報上', '报上', '與非', '与非',
  // 派去取药, 先令许褚: "accept or reject" and "shilling" are never what the books mean.
  '去取', '先令',
  // Fragments jieba counts but no dictionary lists: 这渴慕是从, 我会去, 好时会来, 筛糠般地 (般 + the particle 地), 不时地被.
  '是从', '是從', '我会', '我會', '时会', '時會', '般地', '地被',
  // 买票时说是, 别怪我心软: jieba fragments, not words.
  '时说', '時說', '我心',
]);
/** Words after which 了得 is liǎode "remarkable" (十分了得, 武藝了得, 還了得), not 了 le + 得. */
const BEFORE_LIAODE = ['十分', '好生', '端的', '還', '还', '英雄', '武藝', '武艺', '真個', '真个', '恁地', '恁般', '如此'];

/** Score (nats) a word loses where its neighbors show the text means its parts (the rules below). */
const CUT = 12;
/**
 * Words cut where the character before or after them shows the text means their parts. `after`/`notAfter` test the
 * character before the word, `before`/`notBefore` the one after it; '$' stands for the edge of the Han run (a mark, the
 * paragraph's end). Every test given must hold; a word with a list of rules is cut where any of them holds.
 */
interface CutRule { after?: string; notAfter?: string; before?: string; notBefore?: string }
const NUMERAL_CHARS = '一二三四五六七八九十两兩几幾';
/** Verbs that take 将来 as a direction in the old novels: 赶将来 杀将来 (come chasing, come killing), not 将来 "future". */
const VERBS_BEFORE_JIANGLAI = '杀殺赶趕射打奔搠冲衝撞走拿寻尋摄攝裹卷捲飞飛扑撲哄抢搶跑追攻滚滾送捉抬扛拖拥擁涌湧围圍掩报報砍刺戳提摆擺唱舞请請盘盤叫使';
const CUT_IN_CONTEXT: ReadonlyMap<string, CutRule | CutRule[]> = new Map(Object.entries({
  // 给他杀了, 你好没见世面, 一把抓住: the pronoun, 好 and 一把 begin the clause; the words are for a greeting and the like.
  // 对你好 (to be good to you) is 对你 + 好.
  他杀: { notBefore: '$' }, 他殺: { notBefore: '$' },
  你好: [{ notBefore: '$吗嗎啊呀哇么麼嘛呢' }, { after: '对對待' }],
  一把抓: { notBefore: '$' },
  // 二人为先锋, 劝人为善 (人 + 为); 人为的, 人为因素 stay "man-made".
  人为: { notBefore: '$的地因制製造干幹破操控' }, 人為: { notBefore: '$的地因制製造干幹破操控' },
  // 那人才走 (人 + 才); 人才辈出, 有几分人才 stay, and talent or looks: 识人才, 生得人才齐整, 这般人才, 人才虽好, 人才荟萃
  // (人才出众 is in contextScore).
  人才: { notBefore: '$的辈輩济濟市培交流资資库庫荟薈虽雖齐齊', notAfter: '级級型秀等识識得般' },
  // 曹仁自立马于门旗下: 自 + 立马 "reined in", not 自立 "independent".
  自立: { before: '马馬' },
  // 去向她请教 (去 + 向); 不知去向, 他的去向 stay.
  去向: { notBefore: '$不何', notAfter: '的知其' },
  // 回见孙权 (went back to see), 立马于桥上 (reined in his horse), 发书报刘表 (sent a letter to tell), 待见他不死 (when he saw).
  回见: { notBefore: '$' }, 回見: { notBefore: '$' },
  立马: { before: '$于於在阵陣当當桥橋横橫门門' }, 立馬: { before: '$于於在阵陣当當桥橋横橫门門' },
  书报: { after: '发發驰馳持捷哀以修遣差飞飛' }, 書報: { after: '发發驰馳持捷哀以修遣差飞飛' },
  待见: { notAfter: '不懒懶' }, 待見: { notAfter: '不懒懶' },
  // 从小儿 (from childhood + 儿), 今天子 (今 + 天子), 来回话 (来 + 回话 "report"; 来回三十里 stays "round trip").
  小儿: { after: '从從' }, 小兒: { after: '从從' },
  今天: { before: '子' },
  来回: { before: '话話道说說禀稟明奶爷爺' }, 來回: { before: '话話道说說禀稟明奶爷爺' },
  // 把手放在, 把头低下, 把门关上, 把酒碗: 把 marks the object; 门把手, 把门的 (the gatekeeper), 把酒言欢 stay.
  把手: { notAfter: '门門车車的个個扶铁鐵角' },
  把头: { notBefore: '们們' }, 把頭: { notBefore: '们們' },
  把门: { notBefore: '$的军軍人将將卒兵士' }, 把門: { notBefore: '$的军軍人将將卒兵士' },
  把酒: { notBefore: '$言问問临臨当當对對' },
  // 回过头, 扭过头去: the head turns; 过头 "overdo" follows other words.
  过头: { after: '回转轉扭掉别別偏歪调調抬低' }, 過頭: { after: '回转轉扭掉别別偏歪调調抬低' },
  将来: { after: VERBS_BEFORE_JIANGLAI, before: '$了的' }, 將來: { after: VERBS_BEFORE_JIANGLAI, before: '$了的' },
  // 骑马, 于马上: on horseback, not "at once" (more cases in cutRun).
  马上: { after: '于於骑騎' }, 馬上: { after: '于於骑騎' },
  // Words whose first character closes the word before (村口|才, 心头|发闷, 那点|心事, 即使|用, 车铃声|响, 布带|上, 妖精|巧语, 阶前|奏道, 装假|说),
  // or whose second character opens the next (来|生了气, 飘着|落下, 用手|把土, 两个人|手拉手, 把头|伏在, 好|使我, 点火|烧砖, 作|保山).
  口才: { after: '村门門路洞港河渡山巷井关關胡街几幾一二三四五六七八九十两兩' },
  头发: { after: '心额額眉', before: '闷悶慌颤顫抖烫燙热熱胀脹紧緊酸麻' }, 頭髮: { after: '心额額眉', before: '闷悶慌颤顫抖烫燙热熱胀脹紧緊酸麻' },
  点心: { before: '事思意肠腸眼头頭' }, 點心: { before: '事思意肠腸眼头頭' },
  使用: { after: '即假纵縱' },
  声响: { after: '铃鈴枪槍雷歌笑哭喊叫掌步风風雨鼓钟鐘炮砲蹄' }, 聲響: { after: '铃鈴枪槍雷歌笑哭喊叫掌步风風雨鼓钟鐘炮砲蹄' },
  带上: { after: '布皮腰绸綢丝絲' }, 帶上: { after: '布皮腰绸綢丝絲' },
  精巧: { after: '妖' },
  前奏: { before: '道曰' },
  来生: { before: '了' }, 來生: { before: '了' },
  假说: { after: '装裝' }, 假說: { after: '装裝' },
  着落: { before: '下' }, 著落: { before: '下' },
  手把: { after: '用双雙两兩只隻' },
  人手: { before: '拉牵牽挽握' },
  头伏: { before: '在着著下' }, 頭伏: { before: '在着著下' },
  好使: [{ before: '我你他她它将將' }, { after: '也' }],
  随着: { after: '跟伴追尾' }, 隨著: { after: '跟伴追尾' },
  // 放一把火烧了它, 奶奶把火烧大: 把 + 火 + 烧 (the fire is the object or the one counted), as after 点.
  火烧: { after: '点點把' }, 火燒: { after: '点點把' },
  作保: { before: '山' },
  下脚: { after: '了' }, 下腳: { after: '了' },
  // 明公差矣 (my lord is mistaken): 明公 + 差.
  公差: { after: '明', before: '矣了' },
  // 大官人 (shuihu's "sir"): 大 + 官人.
  大官: { before: '人' },
  日本: { after: '本', before: '本时時' },
  物资: { after: '万萬' }, 物資: { after: '万萬' },
  // 三个人行了半日 (walked): 个 + 人 + 行; 人行道 stays. 只是为人行短 (his conduct): 为人 + 行.
  人行: { after: '个個们們为為', notBefore: '道' },
  // 棒架长枪声响 (a spear's clang): 长枪 + 声, not 长 + 枪声 "gunshot".
  枪声: { after: '长長' }, 槍聲: { after: '长長' },
  // 张任教张翼 (Zhang Ren had …): the general's name, not 张 + 任教 "to teach".
  任教: { after: '张張' },
  // Modern words the old novels and the older prose never mean, where the characters belong to their neighbors: 纵马来迎 (not
  // 马来 "Malaya"), 回头见他 (not "see you"), 关上门 (not 上门 "to visit"), 往火里加 (not 里加 "Riga"), 由内向外, 东湾和田家庄,
  // 几口才出气, 能耐寒, 问及时局, 这点心头肉, 大海里, 不大会, 不大难, 自称心, 些微云, 人生活, 头来往, 四大步, 当红门, 八点三十分开,
  // 物外长年, 继子荫孙, 下首相陪.
  马来: { notBefore: '西亚亞人语語半' }, 馬來: { notBefore: '西亚亞人语語半' },
  回头见: { notBefore: '$' }, 回頭見: { notBefore: '$' },
  上门: { after: '关關闭閉锁鎖扣掩拴插带帶合拉' }, 上門: { after: '关關闭閉锁鎖扣掩拴插带帶合拉' },
  里加: {}, 裡加: {},
  内向: { before: '外' }, 內向: { before: '外' },
  和田: { before: '家' },
  能耐: { before: '饥飢冷寒热熱苦劳勞久渴' },
  及时: { after: '问問提论論言顾顧涉波触觸念虑慮' }, 及時: { after: '问問提论論言顾顧涉波触觸念虑慮' },
  海里: { after: '大' }, 海裡: { after: '大' }, 海裏: { after: '大' },
  大会: { after: '不' }, 大會: { after: '不' }, 大难: { after: '不' }, 大難: { after: '不' },
  自称: { before: '心' }, 自稱: { before: '心' },
  些微: { before: '云雲风風' },
  人生: { before: '活' },
  四大: { before: '步' },
  当红: { before: '门門' }, 當紅: { before: '门門' },
  分开: { after: '十' }, 分開: { after: '十' },
  外长: { after: '物之门門世方天海塞城屋窗' }, 外長: { after: '物之门門世方天海塞城屋窗' },
  继子: { before: '荫蔭' }, 繼子: { before: '荫蔭' },
  柳枝: { after: '岸', before: '条條' },
  首相: { before: '陪' },
  // 论语: 节用而爱人 (to love people), 不好犯上 (not inclined to), 以礼节之 (to regulate it by the rites).
  爱人: { after: '而', before: '$' }, 愛人: { after: '而', before: '$' },
  不好: { before: '犯作' },
  礼节: { before: '之' }, 禮節: { before: '之' },
  // 这回可好了, 那可好极 (可 + 好; 你娘可好？ stays "well or not?"). 可不 and 可不是 are in contextScore.
  可好: [{ before: '了得极極啦啊呀' }, { after: '下回在' }],
  // 扛着锄头走时 (when he walked), 燕子掠过时: 时 "when" after the verb, not 走时 (a clock keeping time) or 过时 "outdated".
  走时: { notAfter: '钟鐘表錶' }, 走時: { notAfter: '钟鐘表錶' },
  // (After 而 only a motion is cut: 擦肩而过时, 呼啸而过时; 陈旧而过时的 stays "outdated". That is in contextScore.)
  过时: { after: '经經路滑吹扑撲飞飛掠穿驶駛走跑闪閃擦流飘飄爬驰馳', before: '$的' },
  過時: { after: '经經路滑吹扑撲飞飛掠穿驶駛走跑闪閃擦流飘飄爬驰馳', before: '$的' },
  // 还不快去 (hurry up and go): 还 + 不 + 快; 心里还不快。 stays "unhappy".
  不快: { after: '还還', notBefore: '$' },
  // 三支部队, 一只脚架在凳上: the measure word goes with the numeral (not 支部 "party branch", 脚架 "tripod").
  支部: { after: NUMERAL_CHARS, before: '队隊' },
  脚架: { after: '只隻双雙两兩' }, 腳架: { after: '只隻双雙两兩' },
  // 也就算了 (let it go): 就 + 算了, never 就算 "even if" before 了. 就算了事, 就算了大事 (counts as having settled it): 就 + 算 +
  // 了 liǎo + 事.
  就算: { before: '了' },
  算了: { before: '事大' },
  // 他摔倒好几回: 摔倒 + 好几回, not 倒好 "bravo".
  倒好: { before: '几幾' },
  // 就让他去 (then let him): 就 + 让; jieba's fragment is not a word.
  就让: {}, 就讓: {},
  // (眼泪汪汪, brimming with tears, is 眼泪 + 汪汪 in contextScore; 两眼 + 泪汪汪 keeps 两眼.)
  // 天清月白, 月白穿窗透 (the moon is white): 月 + 白; the colour 月白 (pale blue) before a cloth, a garment or 色 stays, and
  // 月白色 is 月白 + 色.
  月白: { notBefore: '色缎緞绸綢绫綾纱紗布袄襖衫褂裙裤褲衣袍绢絹罗羅锦錦绣繡素的', notAfter: '件穿着著上的' },
  白色: { after: '月' },
  // 红日当天, 明月当天, 火伞当天 (high in the sky), 位当天枢 (stands at the star 天枢), 合当天败: 当 + 天, not 当天 "that same day".
  当天: { after: '日月伞傘雁位合' }, 當天: { after: '日月伞傘雁位合' },
  // 方桌上, 饭桌上 (on the table): 方桌 + 上, not 方 + 桌上.
  桌上: { after: '方圆圓供饭飯书書' },
  // 怕人笑话, 怕人看见 (afraid that people will…): 怕 + 人 + the verb, not 怕人 "frightening".
  怕人: { notBefore: '$的了些啊呀哩极極得之子' },
  // 也好叫大家放心 (so that): 也 + 好, not 也好 "may as well"; 也好使些 is 也 + 好 + 使 too.
  也好: { before: '叫让讓使教' },
  // 封一口剑 (sealed a sword): 封 + 一口, not 封一 "front cover".
  封一: { before: '口' },
  // 一手指着门口 (one hand pointing): 一 + 手 + 指着, not 手指 "finger" + 着.
  手指: { after: '一', before: '着著向' },
  // 回来时下着雨 (when he came back it was raining): 来 + 时, not 时下 "nowadays".
  时下: { after: '来來' }, 時下: { after: '来來' },
  // 点着头 (nodding), 执着一把扇子 (holding), 吸着烟, 还睡着呢 (still asleep): the verb and its 着, not 点着 "to light", 执着
  // "persistent", 吸着 "sorption" or 睡着 "to fall asleep".
  点着: { before: '头頭' }, 點著: { before: '头頭' }, 点著: { before: '头頭' },
  执着: { before: NUMERAL_CHARS }, 執著: { before: NUMERAL_CHARS }, 执著: { before: NUMERAL_CHARS },
  吸着: {}, 吸著: {},
  睡着: { after: '还還正仍却卻', notBefore: '了' }, 睡著: { after: '还還正仍却卻', notBefore: '了' },
  // 左手提着篮: 手 + 提着 (the adjective 手提 "portable" takes no aspect particle).
  手提: { before: '着著了' },
  // 月光照着, 灯光照着桌面: the light + 照, not 光照 "illumination".
  光照: { after: '月阳陽日灯燈烛燭火星' },
  // 一心想走 (set on), 等于是白干, 睁眼看天, 往上吊, 上吊死的, 越过越好: the first word wins.
  心想: { after: '一', notBefore: '$' },
  于是: { after: '等' }, 於是: { after: '等' },
  眼看: { after: '睁睜闭閉抬瞪眯瞇' },
  上吊: { after: '往' },
  // (吊死 after 上 is in contextScore: 在房梁上吊死 keeps it.)
  越过: { before: '越' }, 越過: { before: '越' },
  // 一个人种辣椒: 人 + 种 (sows), not 人种 "race".
  人种: [{ after: '个個' }, { before: '地田' }], 人種: [{ after: '个個' }, { before: '地田' }],
  // 比我大多了, 大四五岁, 大不了几岁: the comparative 大, not 大多 "mostly", 大四 "senior year", 大不了 "at worst".
  大多: { before: '了' },
  大四: { before: '五' },
  大不了: { before: '多几幾' },
  // 舅舅能干重活, 能干什么: 能 + 干 (to do the work); 很能干 stays "capable".
  能干: { before: '活重些什啥这這那点點多' }, 能幹: { before: '活重些什啥這那點多' },
  干重: { before: '活' }, 幹重: { before: '活' },
  // 练练就会 (a doubled verb), 俯下身 (not 下身 "lower body"), 倒像是, 一端的, 一天下来, 一生下来, 腾出手, 我家养的, 车上装着,
  // 烂泥巴, 一把手枪, 不多时间, 乡下去: the word before or after wins.
  练就: { after: '练練' },
  下身: { after: '俯弯彎蹲躬伏低' },
  倒像: { before: '是' },
  端的: { after: '一' },
  天下: { after: '一', before: '来來' },
  一生: { before: '下' },
  出手: { after: '腾騰抽空' },
  家养: { after: '我你他她咱' }, 家養: { after: '我你他她咱' },
  上装: { after: '车車船' }, 上裝: { after: '车車船' },
  烂泥: { before: '巴' }, 爛泥: { before: '巴' },
  一把手: { before: '枪槍' },
  不多时: { before: '间' }, 不多時: { before: '間' },
  下去: { after: '乡鄉' }, 回乡: { before: '下' }, 回鄉: { before: '下' }, 返乡: { before: '下' }, 返鄉: { before: '下' },
  // 可不可以 (may one?): 可 + 不 + 可以, not 不可 + 以来.
  不可: { after: '可', before: '以' },
  // 老汉往出走 (walked out): 往 + 出 + 走, not 出走 "to run away".
  出走: { after: '往' },
  // 你这一来了 (now that you have come): 这 + 一来, not 这一来 "as a result".
  这一来: [{ before: '了' }, { after: '你我他她您' }], 這一來: [{ before: '了' }, { after: '你我他她您' }],
}));
/** Words cut where the character before makes a dictionary word with their first one (天台|上, 口水|滴湿, 血水|流了). */
const SECOND_HALF_CUT: ReadonlyMap<string, string> = new Map([['台上', ''], ['臺上', ''], ['水滴', '口'], ['水流', '血汗清顺順泪淚雨污']]);
/** Numerals and words like them that a measure word follows (两个人, 三年前, 几口水). */
const NUMERAL_BEFORE_MEASURE = '一二三四五六七八九十百千万萬亿億两兩几幾数數';
/**
 * Words that begin with a measure word or a unit and mean something else (个人 "individual", 年前 "before New Year",
 * 口水 "saliva", 粒子 "particle"): after a numeral the measure goes with the number (两个 人, 三年 前, 几口 水, 那粒 子弹).
 */
const AFTER_NUMERAL_CUT: ReadonlySet<string> = new Set([
  '个人', '個人', '个头', '個頭', '个数', '個數', '年前', '年内', '年內', '日前', '日后', '日後', '天才', '天方', '日方', '次要',
  '口气', '口氣', '口水', '粒子', '眼看', '眼泪', '眼淚', '脚蹬', '腳蹬', '遍地', '条陈', '條陳', '道白', '家小', '日用',
  '张贴', '張貼', '头羊', '頭羊', '床铺', '床鋪', '包换', '包換', '片时', '片時', '拳击', '拳擊', '股掌', '双儿', '雙兒', '日记',
  '日記', '声响', '聲響', '枪刺', '槍刺', '拳打', '脚踏', '腳踏', '天星', '张大', '張大', '回话', '回話', '张嘴', '張嘴',
]);
/** The ones that a demonstrative cuts too (那头羊, 这粒子弹, 这次要是, 那张嘴). */
const AFTER_DEMONSTRATIVE_CUT: ReadonlySet<string> = new Set(['头羊', '頭羊', '粒子', '次要', '床铺', '床鋪', '包换', '包換', '张嘴', '張嘴']);
/** Time words that 十多年前, 二十来天后 cut after 多 and 来 as well (and 三十多头羊). */
const AFTER_ABOUT_CUT: ReadonlySet<string> = new Set(['年前', '年内', '年內', '日前', '日后', '日後', '个人', '個人', '头羊', '頭羊']);
/** Verbs a measure word follows without a numeral (买头羊, 牵头羊 = buy a sheep, not the bellwether 头羊). */
const VERBS_BEFORE_MEASURE = '买買卖賣牵牽宰杀殺养養赶趕偷抱拉送';
/** 有个人, 是个人, 叫个人来, 这么个人, 还算个人, 这俩个人, 连个人影, 多个人: 个 is a measure word after these as well. */
const VERBS_BEFORE_GE = '有没沒是叫做找发發象像成某么麼得下死算俩倆连連多';
/** What 个人 "personal" qualifies after 是 and 有 (仅仅是个人的看法, 有个人原因): there it stays one word. */
const PERSONAL_AFTER = /^(的|目的|利益|问题|主义|意见|隐私|恩怨|名义|身份|经历|行为|原因|成就|能力|感情|生活|财产|安全|卫生|资料|信息|爱好|观点|看法|选择|决定|风格|魅力|崇拜|英雄|喜好|偏见|野心)/;
/** Conditional openers: a clause with one of them ends in 的话 "if" (如果你不去的话). */
const CONDITIONAL_OPENERS = ['如果', '要是', '假如', '万一', '萬一', '倘若', '假若', '假使', '倘使', '如若', '只要', '不然', '否则', '否則', '要不', '设若', '設若', '果真', '真要', '若'];
/** Characters that end a possessor of words (我的话, 说过的话, 老太太的话, 小孩子的话, 方才的话) before 的话. */
const BEFORE_POSSESSIVE_HUA = '我你他她它们們您咱说說讲講问問骂罵过過爷爺太奶娘爹妈媽哥姐母父亲親叔婶嬸子家长長尊己人才见見';
/** Characters that open speech after a speech verb (低声道：“…”). */
const SPEECH_OPENERS = '：:“「‘"『';
/** First characters of the X道 words that are themselves speech verbs or common words kept before a colon (说道, 知道, 报道). */
const SPEECH_DAO_KEEP = '说說问問答喝叫笑骂罵心暗写寫念喊嚷哭叹嘆怒回应應劝勸言告禀稟称稱吼唱吟诵誦知报報味霸';
/** Verbs after which 着 is the aspect particle, so 着手 着眼 着地 着火 are 着 + noun (挥着手, 闭着眼, 靠着火). */
const VERBS_BEFORE_ZHE = '拉挥揮搓握抄筒背抱拍摇搖摆擺闭閉睁睜眯瞇瞪眨合垂捂叉揣抹擦攥扶牵牽举舉伸按啃看盯望瞅瞧靠拿点點打烤贴貼趴'
  + '戳洗蒙僵徒坐捣搗扒烧燒留抖扬揚抠摳围圍生摸随隨斜缝縫';
/** Words that begin with a locative (地上 + 铺满, 雨中 + 游着, 城上 + 火起) cut after a character that makes a place word with it. */
const LOCATIVE_LED: ReadonlySet<string> = new Set([
  '上铺', '上鋪', '上映', '上调', '上調', '上将', '上將', '中将', '中將', '中游', '中立', '里加', '裡加', '里拉', '裡拉',
  '上爬', '上火',
]);
/** First characters of 子 nouns whose 子 is "son" or begins a name after them (吾子, 我孙子, 望子敬, 得子敬书): no floor for these. */
const NOT_ZI_NOUN = '吾汝尔爾其之有无無望二三四五六七八九十诸諸下此彼我你他她它从從听聽告得托拉';
/** Score (nats) of a barely seen dictionary noun in 子 (簪子, 穗子, 会子): a rare word, enough to beat 簪 + 子. */
const ZI_NOUN_SCORE = 6;
/** Corpus count under which a noun in 子 gets ZI_NOUN_SCORE (匣子 266 keeps its own count, so 匣子枪 stays whole). */
const ZI_NOUN_RARE = 20;
/**
 * Dictionary words the corpus never counted that open a clause in the old novels and in speech (是以 "therefore", 在下 "I", 好在
 * "luckily", 要不 "otherwise", 怪道 "no wonder"): at the start of a clause they beat the split into their two characters by a nat.
 * Inside a clause the characters usually are two words (他是以客人身份来的, 雨还在下).
 */
const CLAUSE_OPENERS: ReadonlySet<string> = new Set([
  '是以', '在下', '现下', '現下', '好在', '要不', '怪道', '才刚', '才剛', '适间', '適間', '夜来', '夜來', '偏生',
]);
/**
 * Dictionary words the corpus never counted that are meant wherever they appear and read wrongly as their characters
 * (二爸 "uncle", not "two dads"; 巷道 hàngdào "mine tunnel"; 八路 the Eighth Route Army): they beat that split by a nat.
 */
const UNSEEN_BUT_MEANT: ReadonlySet<string> = new Set([
  '怎的', '二爸', '二妈', '二媽', '除过', '除過', '打问', '打問', '空灵', '空靈', '巷道', '民夫', '八路', '天师', '天師', '钢印', '鋼印',
  '明公', '方桌', '供桌',
]);

/** What comes before 分上 "for the sake of": 看在…的, 看着…, 瞧在…, 于我 (not 眼看, which is "soon"). */
const FOR_THE_SAKE = /((?<!眼)[看瞧觑覷]|[于於])[着著在]?[^，。！？；,.!?;：:“”「」]{0,10}$/;

/** Score (nats) of a number spelled in characters (三十六, 一百二十): a common word, so it is one token, not 三|十六. */
const NUMBER_SCORE = 8;
/** Marks a number candidate (scored NUMBER_SCORE or its own count). */
const NUM_PREFIX = '\u0001';
const NUMBER_DIGITS = '一二三四五六七八九两兩〇零几幾';
/** Units in 千 (千米 km, 千克 kg …): 六十五千米 is 六十五 + 千米, not 六十五千 + 米. */
const AFTER_QIAN_UNIT = '米克瓦卡伏赫';
const NUMBER_PLACES = '十百千万萬亿億';
/** Digits that a following 十 joins (二十分, 六十分): a word in 十 after them (十分 "very") is cut. */
const DIGITS_BEFORE_SHI = '二三四五六七八九两兩几幾';

/** The value of a digit character (two digits in a row are an estimate only when they are neighbors: 三四, 七八). */
const DIGIT_VALUE: Readonly<Record<string, number>> = { 一: 1, 二: 2, 两: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function approximate(x: string, y: string): boolean {
  // 三四十, 七八百; 三五千, 五七百 and 三二十 (twenty or thirty) of the old novels.
  return DIGIT_VALUE[y] === DIGIT_VALUE[x] + 1 || (x === '三' && (y === '五' || y === '二')) || (x === '五' && y === '七');
}

/** Whether `ch` is one of the characters of `set` (an empty or missing `ch` is not: ''.includes('') would say yes). */
function has(set: string, ch: string | undefined): boolean {
  return !!ch && set.includes(ch);
}

/** The compound number written in characters that starts at `pos` (三十六, 一百零八, 两千), or '' if none. */
function numberAt(text: string, pos: number, a: number, b: number): string {
  const isNum = (c: string | undefined) => !!c && (NUMBER_DIGITS.includes(c) || NUMBER_PLACES.includes(c));
  // A number starts with a digit or 十 (万一 "if" is not ten thousand and one).
  // Nor with 零 (两年零八个月 is 两年 + 零 + 八个月).
  // It may start right after a digit that is no estimate with it (王五|三十来岁).
  const afterDigit = pos > a && isNum(text[pos - 1]) && !'零〇'.includes(text[pos - 1])
    && !(DIGIT_VALUE[text[pos - 1]] !== undefined && DIGIT_VALUE[text[pos]] !== undefined && text[pos - 1] !== text[pos] && !approximate(text[pos - 1], text[pos]));
  if (!isNum(text[pos]) || '百千万萬亿億零〇'.includes(text[pos]) || afterDigit) return '';
  // 三六十八, 四六二十四 (the multiplication rhyme: two digits and their product) are one number.
  const x = DIGIT_VALUE[text[pos]], y = DIGIT_VALUE[text[pos + 1]];
  if (x !== undefined && y !== undefined && x * y >= 10 && !approximate(text[pos], text[pos + 1])) {
    const p = x * y, d = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
    const product = (p >= 20 ? d[Math.floor(p / 10)] : '') + '十' + d[p % 10];
    if (text.startsWith(product, pos + 2) && pos + 2 + product.length <= b) return text.slice(pos, pos + 2 + product.length);
  }
  let e = pos;
  // 两 is a digit before a place (两千, 一万两千) or opening a number (两三百); otherwise it is the tael (五十两银子, 十五两三钱).
  const isTwo = (i: number) => text[i] === '两' || text[i] === '兩';
  while (e < b && isNum(text[e]) && !(isTwo(e) && !has(NUMBER_PLACES, text[e + 1]) && !(e === pos && isNum(text[e + 1])))
    // Two digits in a row only as an estimate (三四十, 十七八, 两三百, 三五千); 一千五一个人, 王五三十来岁, 十四一早 end before the second.
    // 七七四十九 and 八八六十四 (the multiplication rhyme) are one number too.
    && !(e > pos && DIGIT_VALUE[text[e]] !== undefined && DIGIT_VALUE[text[e - 1]] !== undefined && !approximate(text[e - 1], text[e])
      && !(e === pos + 1 && text[e] === text[pos]) && !(e === pos + 2 && text[pos] === text[pos + 1]))) e++;
  if ((text[e - 1] === '千') && has(AFTER_QIAN_UNIT, text[e])) e--;
  // 三五千一行 (three to five thousand to a column): the 一 after a round number goes with the measure word after it.
  if (e - pos >= 3 && text[e - 1] === '一' && has('百千万萬亿億', text[e - 2]) && has('个個行队隊群条條只隻匹位件张張次回家口头頭', text[e])) e--;
  if (e - pos < 2) return '';
  let digit = false, place = false;
  for (let i = pos; i < e; i++) { if (NUMBER_PLACES.includes(text[i])) place = true; else digit = true; }
  if (!digit || !place) return '';
  // 二十多, 三百余, 二十余万: "and more" after a round number belongs to it (not 来: 引兵十万来伐 is 来 "come").
  if (e < b && NUMBER_PLACES.includes(text[e - 1]) && has('多余餘', text[e])) e += has('万萬亿億', text[e + 1]) ? 2 : 1;
  return text.slice(pos, e);
}

/** Whether a conditional opener comes earlier in the same Han run (如果…的话). */
function conditionalBefore(text: string, a: number, pos: number): boolean {
  const clause = text.slice(a, pos);
  return CONDITIONAL_OPENERS.some((o) => clause.includes(o));
}

/** Whether `s` (four characters) is an idiom: CC-CEDICT marks them. */
function isIdiom(s: string, dict: Dictionary): boolean {
  return dict.lookup(s).some((e) => e.defs.some((d) => d.includes('(idiom)')));
}

/** What is done on horseback in the old novels and nowhere "at once": 马上欠身, 马上施礼, 马上撚弓, 马上心惊, 马上惯使, 马上坐著. */
const HORSEBACK_NEXT = /^(欠身|施礼|施禮|拈弓|撚弓|捻弓|心惊|心驚|叫苦|欣然|难存|難存|惯使|慣使|会使|會使|如法|尽系|盡繫|手擎|拥出|擁出|相迎|当先|當先|擎|撚|挝|撾|[背坐擎横橫挺绑綁缚縛驮馱骑騎披]著)/;
/** Who rides: 马上两员上将, 马上一员骁将, 马上那人, 马上骑着两个人. */
const RIDERS_NEXT = /^([一两兩二三四五六七八九十][人员員将將]|[一两兩二三]个(人|少年|中年|女|老者|大汉|汉子|将|军官|武士|骑士|官人|和尚|道)|[一两兩二三][個](人|少年|中年|女|老者|大漢|漢子|將|軍官|武士|騎士|官人|和尚|道)|那(人|个人|個人|个大王|個大王|将|將|汉|漢)|骑士|騎士|[骑騎][着著了][一两兩二三四五六七八九十几幾])/;
/** Where the rider is in a column: 当先马上, 为首马上, 上首马上 (the old novels only). */
const HORSEBACK_PLACE = /(当先|當先|为首|為首|为头|為頭|上首|下首|高头|高頭|逍遥|逍遙|当头|當頭)$/;
/** Places that also start modern clauses (背后马上有人): only with what is plainly done on horseback after them. */
const HORSEBACK_PLACE_SOFT = /(中间|中間|前面|后面|後面|背后|背後|左手|右手|面前)$/;
/** 马上 "on horseback" from its neighbors: a horse before it (一匹马上), a rider or a horseback action after it, a column place, or
 * the end of a clause after a word (两匹马上，, 绑在了马上。). "At once" (她马上就到, 马上！, 我马上。) is left alone. */
function onHorseback(text: string, pos: number, end: number, a: number, b: number): boolean {
  const prev = pos > a ? text[pos - 1] : '';
  const before = text.slice(Math.max(a, pos - 2), pos);
  const after = text.slice(end, b);
  if (has('匹騣鬃', prev) || (prev === '那' && pos - 2 >= a && text[pos - 2] === '在')) return true;
  if (HORSEBACK_NEXT.test(after) || RIDERS_NEXT.test(after)) return true;
  const modernNext = /^[就要便会會又也还還都把将將给給对對得去来來到可能想觉覺意说說让讓叫跑走]/.test(after);
  if (HORSEBACK_PLACE.test(before) && !modernNext) return true;
  if (HORSEBACK_PLACE_SOFT.test(before) && (after === '' || /^[一两兩二三四五六坐却卻有那挺打捎高拥擁绑綁缚縛擎横橫尽盡]/.test(after)) && !modernNext) return true;
  // The end of a clause after a word that is not the one who will act at once (两匹马上，, 袍上马上，, 绑在了马上。; 我马上！ stays).
  return after === '' && prev !== '' && !has('我你他她它们們咱您就得要在须須马馬', prev) && has('，,。；;、！!？?', text[b] ?? '');
}

/** Whether a cut rule holds between the character before a word and the one after it ('$' for the edge of the run). */
function ruleHolds(r: CutRule, prev: string, next: string): boolean {
  return (!r.after || r.after.includes(prev)) && (!r.notAfter || !r.notAfter.includes(prev))
    && (!r.before || r.before.includes(next)) && (!r.notBefore || !r.notBefore.includes(next));
}

/** Words in 来 that a directional verb before them takes apart (走过来 + 说, 走出来 + 时). */
const LAI_WORDS: ReadonlySet<string> = new Set(['来说', '來說', '来看', '來看', '来时', '來時', '来往', '來往']);
/** What turns the head or body before 头 身 脸 + 来 (扭过头来, 转身来, 探出头来, 抬起头来, 按下云头来). */
const TURNING = '过過出起回转轉扭抬伸探低掉按捞撈翻侧側下';
/** Verbs and adverbs before 上来 (便上来说, 迎上来说). */
const BEFORE_SHANGLAI = '便快走迎跟赶趕凑湊爬跳追冲衝扑撲奔跑拥擁涌湧围圍飞飛送递遞端拿捧献獻呈拉找寻尋抬搬拖扛提挑';
/** Whether the 来 of 来说 来看 来时 来往 at `pos` closes a directional verb: 走过来, 拿出来, 回过头来, 转身来, 便上来, 坐下来, 走来. */
function directionalBefore(text: string, pos: number, a: number, w: string): boolean {
  if (pos <= a) return false;
  const prev = text[pos - 1];
  const p2 = pos - 2 >= a ? text[pos - 2] : '';
  const p3 = pos - 3 >= a ? text[pos - 3] : '';
  if (has('过過出起进進开開回', prev)) return true;
  if (has('头頭身脸臉', prev)) return has(TURNING, p2) || (has(TURNING, p3) && !has('本自亲親两兩', p2));
  const looking = w !== '来往' && w !== '來往';
  if (prev === '上') return looking && has(BEFORE_SHANGLAI, p2);
  if (prev === '下') return looking && has('坐停蹲躺跪放静靜安定接', p2);
  // 平儿走来说, 跑来说, 拿来看 (走来 跑来 拿来 are words of their own).
  return looking && has('走跑奔赶趕追拿借取', prev);
}

/** Whether text[pos, end) crosses the inside of an X来X去 (想来想去, 看来看去) without being the whole of it. */
function crossesBackAndForth(text: string, pos: number, end: number, a: number, b: number): boolean {
  for (let p = Math.max(a, pos - 3); p < end && p + 4 <= b; p++) {
    if (text[p] !== text[p + 2] || (text[p + 1] !== '来' && text[p + 1] !== '來') || text[p + 3] !== '去') continue;
    if (pos === p && end === p + 4) continue;
    for (let k = p + 1; k <= p + 3; k++) if (pos < k && end > k) return true;
  }
  return false;
}

/** After 就算是: the clause says what something counts as (个凳子, 见过面了, 一顿饭吧), not what "even if" (下大雨，也…). */
function countsAs(text: string, from: number): boolean {
  if (text[from] === '个' || text[from] === '個') return true;
  let e = from;
  while (e < text.length && !'，,。.！!？?；;…—'.includes(text[e])) e++;
  const clause = text.slice(from, e).replace(/[“”「」‘’"『』]/g, '');
  if (/[了吧罢罷啦]$/.test(clause)) return true;
  return /[了]/.test(clause) && !/^[“”「」‘’"]?(也|都|还|還|只|又|怎|便|我也|你也|他也|她也)/.test(text.slice(e + 1, e + 4));
}

/** Whether the clause from `from` ends as a rhetorical question (可不是又不认了么。, 可不是他吗？; after a comma also an
 * exclamation: …，可不是咱们没良心！). */
function rhetoricalClause(text: string, from: number, afterComma: boolean): boolean {
  let e = from;
  while (e < text.length && !'，,。.！!？?；;…'.includes(text[e])) e++;
  return '？?'.includes(text[e] ?? '') || (afterComma && '！!'.includes(text[e] ?? ''))
    || /([吗嗎么麼呢罢罷了]|不成)$/.test(text.slice(from, e).replace(/[“”「」‘’"『』]/g, ''));
}

/** Whether the sentence from `from` (through its commas) ends with a question mark. */
function sentenceAsks(text: string, from: number): boolean {
  let e = from;
  while (e < text.length && !'。.！!？?'.includes(text[e])) e++;
  return '？?'.includes(text[e] ?? '');
}

/** Animals that 两头 counts (两头猪, 两头小白马). */
const ANIMALS = '羊牛猪豬驴驢骡騾马馬象狼虎豹熊鹿狮獅驼駝雕鹰鷹狗犬猫貓兽獸牲蠢';
const ANIMAL_NEAR = new RegExp(`^.{0,6}?[${ANIMALS}]`);
/** An animal a few characters after 两头, with only what describes it between (两头大水牛, 两头小花鹿, 两头肥猪; not 两头都有马). */
const ANIMAL_SOON = new RegExp(`^[^都各是有没沒也在和与與就]{0,3}?([${ANIMALS}兔鸡雞鸭鴨鹅鵝禽畜鹤鶴骆駱犊犢]|畜生)`);
/** What 一口 counts as a measure word (一口锅, 一口大缸, 一口棺材, 一口宝剑, 一口猪), not 一口 "a mouthful, flatly". */
const KOU_THINGS = /^[大小新旧舊破铁鐵铜銅短长長宝寶戒好深白黑]?(锅|鍋|井|池塘|塘|棺|缸|钟|鐘|刀|剑|劍|猪|豬|箱|牙|窑|窯|灶|竈|坛|罈|罐|瓮|甕|七星)/;
/** A hand doing something after 一手 (一手捏着针, 一手扶着门): one hand, not 一手 "a skill, single-handedly". */
const ONE_HAND_DOES = /^(拉|扶|托|抓|提(?!拔)|揪|执|執|拿|挽|撑|撐|支|举|舉|揽|攬|携|攜|搀|攙|接|捧|抱|扯|伸|搂|摟|端|擦|攥|按|掩|指|拍|挥|揮|摸|撚|捻|抚|撫|揭|捂|叉|握|捏|牵|牽|掀|撩|抠|摳|遮(?!天)|摁|拄|拈|捋|夹|夾|拎|插|揉|捶|护|護|捉|扳|搭|撮|攀|撕|揣)/;
/** A shop or a firm after 一家 (一家小店, 一家客店, 一家米店): the measure word, not 一家 "the whole family". */
const JIA_FIRMS = /^[^都也就在是有又还還去来來和与與住，。]{0,3}?(店|铺|舖|鋪|馆|館|厂|廠|公司|商行|银行|銀行|报社|報社|医院|醫院|酒楼|酒樓|饭庄|飯莊|当铺|當鋪|客栈|客棧|旅社|商场|商場)/;
/** What 一面 counts (一面镜子, 一面大旗, 一面铜锣), not 一面 "at the same time, one side". */
const MIAN_THINGS = /^[大小红紅白黄黃黑青铜銅破新]?(镜|鏡|旗|锣|鑼|鼓|墙|牆|盾|牌)/;
/** What 一轮 counts (一轮红日, 一轮明月), not 一轮 "a round". */
const LUN_THINGS = /^(红日|紅日|明月|太阳|太陽|月亮|圆月|圓月|满月|滿月|残月|殘月|弯月|彎月|新月|皓月|金黄|金黃|落日|夕阳|夕陽|朝阳|朝陽)/;
/** What 几点 counts (几点泪, 几点灯光, 零星几点): a few drops or dots, not 几点 "what time?". */
const DIAN_THINGS = /^(泪|淚|灯|燈|露|星|雀斑|雨|血|火|汗|墨|斑|残|殘|疏)/;
/** What follows 往后 "backwards" (往后一仰, 往后退, 往后便倒, 往后院): a movement, a look back or a place behind. */
const BACKWARD_NEXT = /^(一?(仰|看|瞧|望|瞅|倒(?=[去下了在地]|$)|退|缩|縮|靠|躲|闪|閃|挪|拉|拽|扯|推|甩|梳|理|撤|逃|塌|摔|飞|飛|爬|挤|擠|歪|藏|跌|躺|跳|蹦|转|轉|扭|翻|移|让|讓|捋|拢|攏|滑|撩|走)|便(倒|跌|退|走)|[头頭园園门門台臺院角河炕梢墙牆厅廳堂楼樓屋宅殿边邊面山街巷])/;
/** Characters before a noun + 里/上 that do not join the noun (在家里, 进屋里, 洗脸上, 人手上): prepositions, pronouns, verbs. */
const BEFORE_PLACE_KEEP = '在到从從往向朝对對于於进進出入回去来來上下把被将將给給跟和与與同及的了着著过過是有说說看象像人我你他她它们們这這那哪'
  + '一二三四五六七八九十两兩几幾个個只隻条條张張本每各又也都就便才再还還不没沒别別已正拿放挂掛贴貼摸打拍洗擦抹遮捂伸举舉抬搭靠躺坐站跪'
  + '爬跳走跑飞飛落掉倒拉推提扶握搓擦揉捏摇搖点點拿摊攤翻开開关關敲';

/**
 * Nats a candidate word w = text[pos, end) loses (or gains) from its neighbors in the run text[a, b): the measure word after a
 * numeral, the particle after a verb, the possessive 的话, the speaker before 道： and the other context rules.
 */
function contextScore(text: string, pos: number, end: number, a: number, b: number, w: string, dict: Dictionary, lexicon?: Lexicon): number {
  if (w.length < 2) return 0;
  const prev = pos > a ? text[pos - 1] : '$';
  const next = end < b ? text[end] : '$';
  // 只为使将来的子孙不受苦 (so that the coming): 使 + 将来 "future" before 的.
  if ((w === '将来' || w === '將來') && prev === '使' && next === '的') return 0;
  // 对于机器本身来说 (as for): 来说 stays after 对于 earlier in the clause.
  if ((w === '来说' || w === '來說') && /对于|對於|对|對/.test(text.slice(a, pos))) return 0;
  // 踱过来说, 侧过身来看, 跑出来时, 掉过头来往河边跑, 便上来说: the 来 closes the directional verb before it, so 来说 "as for",
  // 来看 "considering", 来时 and 来往 "dealings" are cut. 从整体上来说, 两头来往, 本身来说, 亲身来看 stay.
  if (LAI_WORDS.has(w) && directionalBefore(text, pos, a, w)) return -CUT;
  // 掏出钱来时, 抬进屋里来时 (as it was brought out, in): the 来 closes a directional verb a few characters back.
  if ((w === '来时' || w === '來時') && /[出进進回过過起][^，,。！？；：“”「」]{1,4}$/.test(text.slice(a, pos))) return -CUT;
  // 丫头来说 (came and said): 来 + 说 after a person in 头 身 脸 too; 本身来说, 自身来说 stay "as for".
  if ((w === '来说' || w === '來說') && has('头頭身脸臉', prev) && !(pos - 2 >= a && has('本自', text[pos - 2]))) return -CUT;
  // 这花猫可不是我养的, …，可不是她画的 (is not): 可 + 不是 in a statement. A reply or an exclamation opening the sentence
  // (“可不是这样, 可不是吗) and a rhetorical question (这可不是又不认了么。, …，可不是咱们没良心！) keep 可不是 "isn't it so".
  // 我可不信, 老猫可不爱吃, 可不误了大事？ (可 + 不 + the verb); 可不，, 可不嘛 and a reply opening the sentence (“可不就是他。) keep
  // 可不 "sure"; 可不可以 is cut there too.
  const opensSentence = (w === '可不' || w === '可不是') && prev === '$' && (pos === 0 || has('“「‘『"。！？!?', text[pos - 1]));
  if (w === '可不' && next !== '$' && !has('嘛吗嗎呢么麼是哩', next) && (!opensSentence || next === '可')) return -CUT;
  // 仔细一看，可不是他 (sure enough, it was him) keeps it after a look too.
  if (w === '可不是' && next !== '$' && !has('吗嗎么麼呢嘛啊吧哩', next) && !opensSentence && !rhetoricalClause(text, end, prev === '$')
    && !(prev === '$' && /(看|瞧|见|見|跟前|面前)[，,]$/.test(text.slice(Math.max(0, pos - 4), pos)))) return -CUT;
  // 可不枉生于世？ (would one not have lived in vain?): the rhetorical 可 + 不 + 枉, not 不枉 "not in vain", in a sentence that asks.
  if (w === '不枉' && prev === '可' && sentenceAsks(text, end)) return -CUT;
  // 擦肩而过时, 呼啸而过时 (as it passed): 而过 + 时 after a motion or a doubled word; 陈旧而过时的 stays "outdated".
  if ((w === '过时' || w === '過時') && prev === '而' && (has('擦掠飞飛闪閃穿驶駛走跑飘飄驰馳流爬扑撲滑吹溜冲衝奔窜竄晃', text[pos - 2] ?? '')
    || has('擦掠飞飛闪閃穿驶駛驰馳', text[pos - 3] ?? '') || (pos - 3 >= a && text[pos - 2] === text[pos - 3]))) return -CUT;
  // 他想不开，上吊死了: 上吊 + 死; 在房梁上吊死 (on the beam) keeps 吊死 after the place.
  if (w === '吊死' && prev === '上' && !/[在于於从從到]/.test(text.slice(a, pos - 1))) return -CUT;
  // 眼泪汪汪 (brimming with tears): 眼泪 + 汪汪, not 眼 + 泪汪汪, unless 眼 ends a word (两眼 泪眼 + 泪汪汪).
  if ((w === '泪汪汪' || w === '淚汪汪') && prev === '眼' && !(pos - 2 >= a && (dict.hasWord(text.slice(pos - 2, pos)) || has('两兩双雙俩倆', text[pos - 2])))) return -CUT;
  // 就算了事 (counts as settled): 算 + 了事 (liǎoshì), which the corpus counts too rarely to beat 了 + 事.
  if (w === '了事' && prev === '算') return 4;
  // 人才出众 (talent that stands out) stays the noun.
  if ((w === '人才' || w === '人材') && /^出[众眾]/.test(text.slice(end, end + 2))) return 0;
  // 这件衣裳是他娘的。 (his mother's): the possessive, not the curse, after 是 at the end of a clause.
  if (w === '他娘的' && prev === '是' && next === '$') return -CUT;
  const rule = CUT_IN_CONTEXT.get(w);
  if (rule && (Array.isArray(rule) ? rule.some((r) => ruleHolds(r, prev, next)) : ruleHolds(rule, prev, next))) return -CUT;
  // 想来想去, 看来看去 (back and forth): no word crosses the pattern unless it is the whole of it (走来走去).
  if ((w.includes('来') || w.includes('來') || w.includes('去')) && crossesBackAndForth(text, pos, end, a, b)) return -CUT;
  // 这块木板就算是个凳子, 点点头就算是见过了 (that counts as): 就 + 算是; 就算是下大雨，也… (even if) stays.
  if (w === '就算' && next === '是' && countsAs(text, end + 1)) return -CUT;
  // 连名字都记不得了, 顾不得了: the verb's 不得 + 了, not 不得了 "terrible".
  if ((w === '不得了' || w === '不得了') && pos > a && dict.hasWord(text[pos - 1] + '不得')) return -CUT;
  if (w.length !== 2) return 0;
  // The next few characters of the run (enough for the patterns below; a long run is not copied for every candidate).
  const after = text.slice(end, Math.min(b, end + 12));
  // 哈哈腰, 偷偷懒, 弯弯腰 (the doubled first syllable of 哈腰 偷懒 弯腰): 哈 + 哈腰, not 哈哈 "haha" + 腰.
  if (w[0] === w[1] && has('腰懒懶脚腳', next) && dict.hasWord(w[1] + next)) return -CUT;
  // 两头猪, 那两头小白马, 牵来两头黄牛: the numeral and the measure word for animals, not 两头 "both ends".
  if ((w === '两头' || w === '兩頭') && (has(ANIMALS, next) || ANIMAL_SOON.test(after) || (has('$这這那了着著养養宰买買牵牽杀殺有个個', prev) && ANIMAL_NEAR.test(after)))) return -CUT;
  // A numeral and its measure word that the dictionary lists only as another word: 一口锅 (not "a mouthful"), 一手拿着 (not "a
  // skill"), 一家小店 (not "the whole family"), 一面镜子, 一轮红日, 几点泪 (not "what time?").
  if (w === '一口' && KOU_THINGS.test(after)) return -CUT;
  if (w === '一手' && ONE_HAND_DOES.test(after)) return -CUT;
  if (w === '一家' && JIA_FIRMS.test(after)) return -CUT;
  if (w === '一面' && MIAN_THINGS.test(after)) return -CUT;
  if ((w === '一轮' || w === '一輪') && LUN_THINGS.test(after)) return -CUT;
  if ((w === '几点' || w === '幾點') && (DIAN_THINGS.test(after) || text.slice(Math.max(a, pos - 2), pos) === '零星')) return -CUT;
  // 往后一仰, 往后退, 往后院去: 往 + 后 "backwards, to the back"; 往后的事, 往后别来了 stay "from now on".
  if ((w === '往后' || w === '往後') && BACKWARD_NEXT.test(after)) return -CUT;
  // 那个人命苦, 这渔户的人命硬: 人 + 命 "fate" after 个, or after 的 before what is said of one's fate (命苦, 命大).
  if ((w === '人命') && (has('个個', prev) || (prev === '的' && /^[都也就]?([苦硬薄贱賤好]|大(?![于於过過如]))/.test(after)))) return -CUT;
  // 早上两年 (two years earlier): 早 + 上 + 两年; 早上一点 stays the morning.
  if (w === '早上' && /^([几幾一两兩三四五六七八九十]+[年月]|[几幾]天)/.test(after)) return -CUT;
  // 小王听完话头一低, 话头便垂下: 话 + 头 "head" before what the head does, not 话头 "thread of talk".
  if ((w === '话头' || w === '話頭') && /^[便也就]?(低|不回|扭|抬|垂|点|點|摇|搖|转|轉|一扭|一低|一抬|一歪|歪)/.test(after)) return -CUT;
  // 吃药也不管用 (no use): 不 + 管用 at the end of a clause; 不管用哪种法子 stays "no matter".
  if (w === '不管' && next === '用' && (end + 1 === b || has('了的啊呀啦', text[end + 1]))) return -CUT;
  // 产房里, 窝棚里, 手背上, 手心里: where the character before makes a common word with the first one (产房, 手背, 手心), a jieba
  // fragment in 里/上 (房里, 背上) or 心里 does not take it.
  // Not where the character before already ends a word (老家门上, 柿子树上, 花园地里, 公证书上, 石碣村镇上).
  if (pos > a && '里裡裏上'.includes(w[1]) && (!dict.hasWord(w) || (/^心[里裡裏]$/.test(w) && has('手掌', prev)))
    && !has(BEFORE_PLACE_KEEP, prev) && dict.freq(prev + w[0]) >= 20 && dict.hasWord(prev + w[0])
    && ![2, 3].some((k) => pos - k >= a && (dict.hasWord(text.slice(pos - k, pos)) || !!lexicon?.has(text.slice(pos - k, pos))))) return -CUT;
  // 二人大惊, 众人大都, 一家人大笑: 人 + 大X. 人大 (the People's Congress, Renmin University) stays before 代 常 毕 会 主 副 政 委 and
  // after a place (省人大, 全国人大).
  if (w === '人大' && (NUMERAL_BEFORE_MEASURE.includes(prev) || (prev === '的' && !has('代常毕畢会會主副政委', next)) || (!has('代常毕畢会會主副政委', next) && !has('省市县縣区區乡鄉镇鎮', prev) && text.slice(pos - 2, pos) !== '全国'
    && (next === '$' || dict.hasWord('大' + next) || has('吼骇駭叫怒惊驚惧懼笑哭喊喜悦悅嚷骂罵呼闹鬧吃饱飽为為都多半脱脫恩', next)
      || (prev !== '$' && dict.hasWord(prev + '人')))))) return -CUT;
  // 柴大官人家, 大官人力举: 大 + 官人 + 家/力, not 人家 人力.
  if ((w === '人家' || w === '人力' || w === '人情') && prev === '官' && pos - 2 >= a && text[pos - 2] === '大') return -CUT;
  // 磕了个头 叩了个头: 个 + 头 (one kowtow), not 个头 "height".
  if ((w === '个头' || w === '個頭') && has('了磕叩', prev)) return -CUT;
  // 一遍遍地问, 一步步地: the doubled measure takes the particle 地, not 遍地 "everywhere".
  if (pos - 2 >= a && w[0] === prev && w[1] === '地' && text[pos - 2] === '一') return -CUT;
  // 小校报道：「 门人报道： (reported, saying) in the old novels; 新华社报道： stays.
  if ((w === '报道' || w === '報道') && end === b && has(SPEECH_OPENERS, text[b]) && has('校人军軍卒马馬探门門吏兵士子童使将將右', prev)) return -CUT;
  // 天台|上, 口水|滴湿, 血水|流了: the character before makes a word with the first one.
  const halfAfter = SECOND_HALF_CUT.get(w);
  if (halfAfter !== undefined && pos > a && (halfAfter === '' || halfAfter.includes(prev)) && dict.freq(prev + w[0]) >= 50 && dict.hasWord(prev + w[0])) return -CUT;
  // 两个人, 三年前, 几口水, 那头羊: the measure word belongs to the numeral or demonstrative before it.
  if (AFTER_NUMERAL_CUT.has(w)) {
    // 一张嘴就笑 (as soon as he opens his mouth) is 一 + 张嘴; 多了一张嘴, 五六张嘴 are the measure word.
    if ((w === '张嘴' || w === '張嘴') && prev === '一' && !(pos - 2 >= a && has('了着著有长長多这這那每', text[pos - 2]))) return 0;
    // 去集上买头羊: a verb and a measure word without a numeral.
    if ((w === '头羊' || w === '頭羊') && has(VERBS_BEFORE_MEASURE, prev)) return -CUT;
    if (NUMERAL_BEFORE_MEASURE.includes(prev) || (AFTER_DEMONSTRATIVE_CUT.has(w) && '这這那哪'.includes(prev))
      || (AFTER_ABOUT_CUT.has(w) && '多来來'.includes(prev) && pos - 2 >= a && NUMERAL_BEFORE_MEASURE.includes(text[pos - 2]))) return -CUT;
    if ((w === '个人' || w === '個人') && VERBS_BEFORE_GE.includes(prev) && !('是有'.includes(prev) && PERSONAL_AFTER.test(text.slice(end, b)))) return -CUT;
    return 0;
  }
  const c0 = w[0], c1 = w[1];
  // 二十分, 六十分以上: 十 goes with the digit before it, not into 十分 "very"; 十分钟 is 十 + 分钟.
  if (c0 === '十' && (DIGITS_BEFORE_SHI.includes(prev) || (c1 === '分' && '钟鐘'.includes(next)))) return -CUT;
  // 六月初九: 初九 is the day.
  if (w === '月初' && NUMBER_DIGITS.includes(next)) return -CUT;
  // 他的话, 说过的话, 方才的话也, 宝钗的话，, 几句紧要的话，: 的 + 话 "words". 的话 "if" closes a conditional clause (如果…的话，,
  // 不去的话，).
  // 那样的话, 真是那样子的话， 有事的话， (if so, if it is so) are conditional too, unless the clause says whose words they are
  // (讲了这样的话, 听信了小人的话, 他的话).
  if (w === '的话' || w === '的話') {
    const clause = text.slice(a, pos);
    const saying = /^(要说|要說|若说|若說|如果说|如果說|真要说|真要說)/.exec(clause);
    const possessive = (BEFORE_POSSESSIVE_HUA.includes(prev) && !/样子$|樣子$/.test(clause)) || /[句些番类類听聽信说說讲講叨记記]/.test(clause)
      || (!!lexicon && [2, 3, 4].some((k) => pos - k >= a && lexicon.has(text.slice(pos - k, pos))));
    const conditional = conditionalBefore(text, a, pos)
      || (!possessive && (/(那样|这样|那樣|這樣|那么|这么|那麼|這麼)$/.test(clause) || (end === b && has('，,；;', text[b]) && /^(有|没有|沒有|要|是|真)/.test(clause))))
      // 要说还有啥心愿的话，就是… (if one is to say): a clause that opens with 要说.
      || (end === b && has('，,；;', text[b]) && saying !== null && !BEFORE_POSSESSIVE_HUA.includes(prev)
        && !/[句些番类類听聽信说說讲講叨记記]/.test(clause.slice(saying[0].length)));
    if (!conditional && (end < b || !has('，,；;', text[b]) || possessive)) return -CUT;
  }
  // 多练才能进步, 怎样才能做到: 才 + 能 before a verb; the noun "talent" follows 的/有 (他的才能) or ends the clause.
  // 品德和才能, 才能不如哥哥 (at the start of a clause) are the noun.
  // 只有吃饱了，才能不想家 (only then can one): 才 + 能 before 不 + a verb; 才能不及 才能不凡 stay the noun.
  if (w === '才能' && end < b && !'的和与與及'.includes(next) && !'的有其之和与與及'.includes(prev)
    && !(pos === a && next === '不' && /^不(及|足|够|夠|如|凡|俗|高|错|錯|大|小|差|济|濟|行|佳|过人|過人|亚|亞|在|堪|俗)/.test(text.slice(end, b)))) return -CUT;
  // 在马上 (on horseback; 现在马上 stays "at once"), 纵马上山, 回马上关: 马 goes with the verb before it.
  if ((w === '马上' || w === '馬上') && pos > a
    && ((prev === '在' && !(pos - 2 >= a && '现現正实實存自好所'.includes(text[pos - 2])))
      || '纵縱骤驟弃棄回勒策催跃躍跨从從驰馳青白赤黄黃紫骢驄骝騮驹駒'.includes(prev) || (prev === '花' && pos - 2 >= a && text[pos - 2] !== '开'))) return -CUT;
  // 马上的人, 马上乘客 (on the horse) before 的 or a person.
  if ((w === '马上' || w === '馬上') && (next === '的' || text.startsWith('乘客', end))) return -CUT;
  if ((w === '马上' || w === '馬上') && onHorseback(text, pos, end, a, b)) return -CUT;
  // 袍上马上，(on robes and horses): not 上马 "to mount" when the clause ends on the 上 after it.
  if ((w === '上马' || w === '上馬') && next === '上' && end + 1 === b && onHorseback(text, end - 1, end + 1, a, b)) return -CUT;
  // 挥着手, 闭着眼, 靠着火: 着 after a verb is the aspect particle. 着想 without 为/替 (想着想着, 坐着想) too.
  if (c0 === '着' || c0 === '著') {
    if ('手眼地火'.includes(c1) && VERBS_BEFORE_ZHE.includes(prev)) return -CUT;
    if (c1 === '想' && c0 === '着' && !/[为為替]/.test(text.slice(a, pos))) return -CUT;
    return 0;
  }
  // 众僧道：, 低声道：, 武大道：: 道 is "said" after the speaker, not the end of 僧道 or 声道.
  // (是云游僧道： (monks and priests, a list after the colon) keeps 僧道.)
  if (c1 === '道' && pos > a && end === b && has(SPEECH_OPENERS, text[b]) && !SPEECH_DAO_KEEP.includes(c0)
    && !(w === '僧道' && /(云游|雲遊)$/.test(text.slice(a, pos)))) return -CUT;
  // 张道长, 李道长: a surname and the title 道长 (but 车道长度 stays).
  if (c1 === '道' && '长長'.includes(next) && SURNAMES.has(dict.toSimplified(c0)) && !(dict.freq('长' + (text[end + 1] ?? '')) > 0)) return -CUT;
  // 慢慢地上来, 勇敢地面对, 满意地点着头: the adverbial 地 + a verb, not 地上 地面 地点.
  if (c0 === '地' && pos > a && '上下点點面道'.includes(c1)) {
    // A doubled word (慢慢, 一闪一闪, 呆头呆脑 AXAY, 千遍万遍 XAYA) but not a doubled verb with its object (敲敲地面, 指指地上) or 在在.
    const redup = ((pos - 2 >= a && prev === text[pos - 2] && !'敲指看摸拍踩跺擦扫掃踢捶点點抹舔瞧瞅望摇搖跳在是了的有和也都就'.includes(prev))
      || (pos - 4 >= a && prev === text[pos - 3] && text[pos - 2] === text[pos - 4])
      || (pos - 4 >= a && text[pos - 4] === text[pos - 2] && text[pos - 3] !== prev && text[pos - 4] !== text[pos - 3])
      || (pos - 4 >= a && text[pos - 3] === prev && text[pos - 4] !== text[pos - 2] && text[pos - 4] !== text[pos - 3] && text[pos - 2] !== '一'));
    if (redup || (pos - 4 >= a && isIdiom(text.slice(pos - 4, pos), dict))
      || ((c1 === '点' || c1 === '點') && '了起着著'.includes(next)) || (c1 === '面' && next === '对')
      || (c1 === '下' && '着著'.includes(next))) return -CUT;
    return 0;
  }
  // 地上铺满, 水中游着: the place word (地上, 水中) takes the locative (海军中将 stays the rank).
  if (LOCATIVE_LED.has(w) && pos > a && dict.freq(prev + c0) >= 200 && !('将將'.includes(c1) && '军軍'.includes(prev))) return -CUT;
  // 大人们: 大人 + 们 (adults), unless 大 ends a word (伟大, 强大).
  if ((w === '人们' || w === '人們') && prev === '大' && !(pos - 2 >= a && dict.freq(text.slice(pos - 2, pos)) > 0)) return -CUT;
  // 今天下大乱, 今天下英雄: 今 + 天下 (今天下大雨 stays "today").
  if (w === '今天' && next === '下' && (has('分之英皆已', text[end + 1]) || text.startsWith('大乱', end + 1) || text.startsWith('大亂', end + 1))) return -CUT;
  // 方今天下, 即今天气, 当今天子: 今 goes with the word before it.
  if (w === '今天' && has('方即当當至自', prev) && has('下子气氣', next)) return -CUT;
  return 0;
}

/** AABB or ABAB at `pos` built from a two-character dictionary word AB, with the score it gets as one token. */
function reduplication(text: string, pos: number, b: number, dict: Dictionary): { word: string; score: number } | null {
  if (pos + 4 > b) return null;
  const c0 = text.charCodeAt(pos);
  if (c0 < 0x3400 || c0 > 0x9fff) return null; // BMP ideographs only: the pairs this is for are common characters
  const c1 = text.charCodeAt(pos + 1);
  const c2 = text.charCodeAt(pos + 2);
  const c3 = text.charCodeAt(pos + 3);
  let ab = '';
  if (c0 === c1 && c2 === c3 && c0 !== c2) ab = text[pos] + text[pos + 2];
  else if (c0 === c2 && c1 === c3 && c0 !== c1) ab = text.slice(pos, pos + 2);
  else return null;
  if (!dict.hasWord(ab)) return null;
  // As likely as the base word, but never less than an ordinary seen word, so it beats the cut into 吆|吆喝|喝.
  return { word: text.slice(pos, pos + 4), score: Math.max(Math.log(dict.freq(ab) + 1), 1) };
}

/** Whether the dictionary lists `w` as an ordinary word (a lowercase reading), not only as a proper noun. */
function isCommonWord(w: string, dict: Dictionary): boolean {
  return dict.lookup(w).some((e) => !/^[A-Z]/.test(e.pinyin));
}

/** Whether a lexicon word sits inside `w`, shorter than it. */
function holdsLexiconWord(w: string, lexicon: Lexicon): boolean {
  for (let i = 0; i < w.length - 1; i++) {
    for (let j = i + 2; j <= w.length && j - i <= lexicon.maxLen * 2; j++) {
      if (j - i < w.length && lexicon.has(w.slice(i, j))) return true;
    }
  }
  return false;
}

/** Measure words and units a numeral or a demonstrative takes: after 一 or 这 a word that opens with one is cut (一|本书 is 一本 + 书). */
const FLOOR_MEASURES = '个個本出封张張条條件只隻头頭匹位口座片块塊根枝支双雙对對句声聲眼次回遍下番场場阵陣把顶頂首篇部台臺辆輛架艘棵株朵粒颗顆'
  + '间間家所门門道层層级級段节節套份种種类類群批堆串排幅面项項则則笔筆尊盏盞扇幢栋棟丛叢束捆滴页頁章卷册冊届屆期年月日天岁歲'
  + '毛角元圆圓钱錢两兩斤路点點寸尺丈';
const BEFORE_FLOOR_MEASURE = NUMERAL_BEFORE_MEASURE + '半这這那哪每某';
/** Locatives and particles: after an unseen word they make no word with its last character that would take it (十字街上). */
const AFTER_FLOOR_FREE = '上下里裡裏中内內外前后後边邊头頭的了着著过過地得';
/** What follows a number that an unseen word ending in a numeral would take from it (引|数十骑, 引|数骑, 天保|八年, 早|八点). */
const AFTER_FLOOR_NUMERAL = NUMERAL_BEFORE_MEASURE + '年月日天岁歲点點时時个個人骑騎';
/**
 * Digits: two different ones side by side are a year or a rough number (三九年 is 1939, 三四个), not a word (三九 "the coldest
 * days"), unless two more follow (三九四九, the winter's nine-day spells).
 */
const FLOOR_DIGITS = '〇零一二三四五六七八九';
/** A sense that is a verb ("to hold with one's hand", "(of a car) to stall"). */
const VERB_DEF = /^(\([^)]*\) )*to /;
/** A sense that is a whole exclamation or question ("Oh that's true!", "what is this?") or an interjection. */
const UTTERANCE_DEF = /[!?]\s*$|\binterjection\b/;

/**
 * Score of a dictionary word the corpus never saw (文旅, 青蒿, 胶皮): the floor count of dict.segmentFreq, so it beats a split into
 * rare characters but not one into common ones, or -UNSEEN_WORD_PENALTY as before where the neighbors show the text means its
 * parts: a measure word after a numeral or a demonstrative (一|本书, 写一|封四|六信, 两|路杀至), a numeral before a numeral or a
 * measure (引|数十骑, 三|九年), a particle after the word before it (吼|得人心), a final 只 (猫只), a pronoun opening it (给|我孙子),
 * and the other cases below. `b` is the end of the run of Han characters.
 */
function unseenScore(text: string, pos: number, a: number, b: number, w: string, dict: Dictionary): number {
  const floor = dict.segmentFreq?.(w) ?? 0;
  if (floor <= 0) return -UNSEEN_WORD_PENALTY;
  const prev = pos > a ? text[pos - 1] : '';
  const n = w.length;
  const next = pos + n < b ? text[pos + n] : '';
  if (has(FLOOR_MEASURES, w[0]) && has(BEFORE_FLOOR_MEASURE, prev)) return -UNSEEN_WORD_PENALTY;
  // (Before another numeral only a number word that takes one: 引|数十, not 忘八|一条.)
  if (has(NUMERAL_BEFORE_MEASURE, w[n - 1]) && !has(NUMERAL_BEFORE_MEASURE, w[0]) && has(AFTER_FLOOR_NUMERAL, next)
    && (!has(NUMERAL_BEFORE_MEASURE, next) || has('数數几幾十百千万萬', w[n - 1]))) return -UNSEEN_WORD_PENALTY;
  if (n === 2 && w[0] !== w[1] && has(FLOOR_DIGITS, w[0]) && has(FLOOR_DIGITS, w[1]) && !has(FLOOR_DIGITS, next)) return -UNSEEN_WORD_PENALTY;
  // 初七|方得: a numeral after 初 is the day of the month, not the start of 七方.
  if (prev === '初' && has(FLOOR_DIGITS + '十', w[0])) return -UNSEEN_WORD_PENALTY;
  // (Not 过: 过谦 过虑 过劳 过犯 are words, and 铺过床 is left for later. Nor after a negation: 不着边儿.)
  if (prev && has('了着著得', w[0]) && !has('不没沒', prev)) return -UNSEEN_WORD_PENALTY;
  if (has('只隻', w[n - 1])) return -UNSEEN_WORD_PENALTY;
  // 给我孙子 (my grandson), not the Japanese town 我孙子: a pronoun opens the clause's own words (我|不|知道, 他们|俩).
  if (has('我你他她它您咱', w[0])) return -UNSEEN_WORD_PENALTY;
  // 下起雨来, 拿起笔来: 起 … 来 is the verb's complement around its object, not 起雨 or 起笔.
  if (n === 2 && w[0] === '起' && pos + 2 < b && has('来來', text[pos + 2])) return -UNSEEN_WORD_PENALTY;
  // 被|罩在铜缸里, 把|捉回来的人: 被 and 把 before a verb and its complement mark the passive and the object, not 被罩 or 把捉.
  if (n === 2 && ((w[0] === '被' && has('在着著了住上下起回来來去到得出进進过過', next)) || (w[0] === '把' && has('回到', next)))) return -UNSEEN_WORD_PENALTY;
  // 那知 哪知 谁知 岂知 (who would have thought): 知 is theirs, not the start of 知遇.
  if (w[0] === '知' && has('那哪谁誰岂豈怎焉', prev)) return -UNSEEN_WORD_PENALTY;
  // 便 opening a word the corpus never saw is the adverb "then" before a verb (便|闭了口, 便|乘间, 便|换了), not 便闭 "constipation".
  if (w[0] === '便') return -UNSEEN_WORD_PENALTY;
  // 曹公|知我, 董公|所赠: 公 after a surname is the honorific of the man named, not the start of 公知 or 公所. (Not a courtesy name,
  // 徐公明, nor 公 "male", 一只公狗.)
  if (n === 2 && w[0] === '公' && prev && SURNAMES.has(dict.toSimplified(prev)) && !(pos - 2 >= a && dict.hasWord(text.slice(pos - 2, pos)))
    && !dict.lookup(w).some((e) => /^[A-Z]/.test(e.pinyin) || e.defs.some((d) => /\bsurname\b|^male\b/.test(d)))) return -UNSEEN_WORD_PENALTY;
  // 老爷们 is 老爷 + 们: the plural of a word is that word and 们, whatever a dictionary lists (老爷们 "menfolk").
  if (n >= 3 && has('们們', w[n - 1]) && dict.hasWord(w.slice(0, n - 1))) return -UNSEEN_WORD_PENALTY;
  // 吹口仙气, 喘口气: 口 counts a breath or a mouthful after a verb, not the end of a word (吹口 "mouthpiece").
  if (n === 2 && w[1] === '口' && (has('气氣', next) || (pos + 3 < b && has('气氣', text[pos + 3])))) return -UNSEEN_WORD_PENALTY;
  // 土拍了拍, 看一看: the last character is the verb said twice (not 辱没了没脸, where the second 没 opens 没脸).
  if (next && has('了一', next) && text[pos + n + 1] === w[n - 1] && !(pos + n + 2 < b && dict.hasWord(w[n - 1] + text[pos + n + 2]))) return -UNSEEN_WORD_PENALTY;
  // The aspect particle 着 follows a verb: a word with no verb sense before it is two words cut wrong (正|犯着, 兵|端着, 风|吹着).
  // (Not 过, also the verb "to pass": 此山径过有六百里; nor a 着 that opens a word, 这厮着实无礼, or is 着了 "caught", 火绒着了.)
  if (has('着著', next) && !(pos + n + 1 < b && (text[pos + n + 1] === '了' || dict.hasWord(next + text[pos + n + 1])))
    && !dict.lookup(w).some((e) => e.defs.some((d) => VERB_DEF.test(d)))) return -UNSEEN_WORD_PENALTY;
  // An exclamation or a question that is a whole clause with its 是 (那倒是 "Oh that's true!", 这是甚么 "what is this?") is one word
  // only where the clause ends with it: in 那倒是好事 and 这是甚么字 it is words of a longer one. 你有你的路，我有我的 is the
  // plain possessive after the same pronoun (有你的 "You're really something!").
  if (((next && w.includes('是')) || (w[0] === '有' && prev !== '' && prev === w[1])) && dict.lookup(w).every((e) => e.defs.length > 0 && e.defs.every((d) => UTTERANCE_DEF.test(d)))) return -UNSEEN_WORD_PENALTY;
  // Three characters or more that are a word plus a last character that makes a common word with the one after it: 铁皮|屋顶,
  // not 铁皮屋|顶; and before 来 or 去, which take a verb at the end of any word (据|我|看来, not 据我看|来; but 喘不过|来 keeps its
  // complement). (A locative or a particle after it is no such word: 十字街|上.)
  if (n >= 3 && next && !has(AFTER_FLOOR_FREE, next) && dict.freq(w[n - 1] + next) >= 100 && ((has('来來去', next) && w[1] !== '不') || dict.hasWord(w.slice(0, n - 1)))) return -UNSEEN_WORD_PENALTY;
  return Math.log(floor + 1);
}

/** Whether text[pos-1] + text[pos] and text[end-1] + text[end] are both common dictionary words (青海 and 民歌 around 海民). */
function bothSidesWords(text: string, pos: number, end: number, dict: Dictionary): boolean {
  const left = text.slice(pos - 1, pos + 1);
  const right = text.slice(end - 1, end + 1);
  return dict.freq(left) >= COMMON_LEXICON_COUNT && dict.hasWord(left) && dict.freq(right) >= COMMON_LEXICON_COUNT && dict.hasWord(right);
}

/** Segment one Han run text[a, b) with the max-probability DAG path; returns the cut points (end offsets). */
function cutRun(text: string, a: number, b: number, dict: Dictionary, logTotal: number, lexicon?: Lexicon): number[] {
  const lexMax = lexicon && lexicon.maxLen >= 2 ? lexicon.maxLen : 0;
  const size = b - a;
  const score = new Float64Array(size + 1);
  const count = new Int32Array(size + 1);
  const next = new Int32Array(size + 1);
  for (let pos = b - 1; pos >= a; pos--) {
    const c = text.charCodeAt(pos);
    if (c >= 0xdc00 && c <= 0xdfff) continue; // second half of a surrogate pair
    let bestScore = -Infinity;
    let bestCount = 0;
    let bestEnd = pos + 1;
    let words = dict.wordsAt(text, pos);
    if (lexMax) {
      words = words.slice();
      // Names and terms of the book are candidates too, scored like a very frequent word so they win against a
      // split into the dictionary words their characters happen to form.
      let end = pos;
      for (let k = 1; k <= lexMax && end < b; k++) {
        end += text.codePointAt(end)! > 0xffff ? 2 : 1;
        if (k >= 2 && end <= b) {
          const sub = text.slice(pos, end);
          if (lexicon!.has(sub)) words.push(LEX_PREFIX + sub);
        }
      }
    }
    // An ordinal (第七十八回, 第一百零八回): 第 and the whole run of numerals after it are one token, not 第七 + 十八.
    if (text[pos] === '第') {
      let e = pos + 1;
      while (e < b && ORDINAL_DIGITS.includes(text[e])) e++;
      if (e - pos >= 3 && e <= b) words = [...words, LEX_PREFIX + text.slice(pos, e)];
    }
    // A year written in digits (一九一八年): the whole run is one word, whatever the dictionary has inside it.
    if (YEAR_DIGITS.includes(text[pos]) && (pos === a || !YEAR_DIGITS.includes(text[pos - 1]))) {
      let e = pos;
      while (e < b && YEAR_DIGITS.includes(text[e])) e++;
      if (e - pos >= 3 && text[e] === '年' && e <= b) words = [...words, LEX_PREFIX + text.slice(pos, e)];
    }
    // Reduplicated words: 吆吆喝喝 (AABB from 吆喝) and 研究研究 (ABAB from 研究) are one word each, though no list has them.
    const redup = reduplication(text, pos, b, dict);
    if (redup && !words.includes(redup.word)) { words = words.slice(); words.push(redup.word); }
    // A number written in characters (三十六, 一百二十, 四五十) is one token, not 三 + 十六.
    // A dictionary word that holds the whole number (二十一世纪, 三十六计) is left to compete as it is.
    const number = numberAt(text, pos, a, b);
    if (number && !(words[0] && words[0].length > number.length && words[0].startsWith(number))) words = [...words, NUM_PREFIX + number];
    for (const cand of words) {
      const fromLexicon = cand.startsWith(LEX_PREFIX);
      const fromNumber = cand.startsWith(NUM_PREFIX);
      const w = fromLexicon || fromNumber ? cand.slice(1) : cand;
      const end = pos + w.length;
      if (end > b) continue;
      const f = dict.freq(w);
      // A lexicon word that is also a common word (中学, 大海: a name in one book, a word everywhere) keeps its corpus score: the
      // dictionary joins it where it is a word already, and the entry brings its card and reading. Names the corpus knows (宋江,
      // 关云长, jieba's 丘处机) and words it never saw keep the boost.
      let own = fromLexicon ? (f >= COMMON_LEXICON_COUNT && isCommonWord(w, dict) ? Math.log(f + 1) : Math.max(LEXICON_WEIGHT, Math.log(f + 1)))
        : f === 0 && !isSingleCodePoint(w) ? unseenScore(text, pos, a, b, w, dict) : Math.log(f + 1);
      // A lexicon word whose first character makes a common word with the character before and whose last makes one with the
      // character after (青|海民|歌 inside 青海民歌) is not boosted: there the text is those two words.
      if (fromLexicon && pos > a && end < b && bothSidesWords(text, pos, end, dict)) own = Math.log(f + 1);
      // A dictionary phrase of four or more characters that holds a lexicon word whole (大闹天宫 around 闹天宫) is not cut by the
      // entry inside it. Shorter words (中学生 around the name 中学) and jieba's phrases (a name + 笑) are left alone.
      if (lexMax && !fromLexicon && !fromNumber && w.length >= 4 && holdsLexiconWord(w, lexicon!) && dict.hasWord(w)) own = Math.max(own, LEXICON_WEIGHT);
      if (fromNumber) own = Math.max(NUMBER_SCORE, Math.log(f + 1));
      // 簪子 穗子 会子: a noun in 子 that the corpus barely saw still beats 簪 + 子 (子 zǐ "son"), unless the character before
      // makes a word with its first one (手帕子 stays 手帕 + 子), a longer word ends with it (东洋鬼子) or 子 starts the next
      // word (不肖子孙 is 不肖 + 子孙).
      else if (!fromLexicon && f < ZI_NOUN_RARE && w.length <= 3 && w.length >= 2 && w[w.length - 1] === '子' && !NOT_ZI_NOUN.includes(w[0])
        && !(end < b && dict.freq('子' + text[end]) >= 100)
        && !(pos > a && (dict.hasWord(text[pos - 1] + w[0]) || [1, 2].some((k) => pos - k >= a && dict.hasWord(text.slice(pos - k, end)))))
        // 北工大|儿子: a longer word ends inside it.
        && !(pos - 2 >= a && dict.hasWord(text.slice(pos - 2, pos + 1)))) own = Math.max(own, ZI_NOUN_SCORE);
      if (redup && w === redup.word && !dict.hasWord(w)) own = redup.score;
      if (!fromLexicon && !fromNumber) {
        // 在下姓王 (not 在下一个路口), 是以不敢, 除过他: as likely as the split into the two characters, plus a nat.
        // Not 在下一个, 在下首 (below), 夜来了 (night came), 要不去 (if not going), 是以手工方式 (is by), 好在哪里, 七八路 (eight ways).
        const opener = pos === a && CLAUSE_OPENERS.has(w) && !(w === '在下' && has('一首面边邊方', text[end])) && !((w === '夜来' || w === '夜來') && text[end] === '了')
          // 要不来晚了 (otherwise, coming late) keeps 要不; 是以他毫不知情 (therefore he) keeps 是以 unless the clause says "by" (是以你为…, 是以电磁波的形式).
          && !(w === '要不' && has('去来來著着了到得', text[end]) && !has('晚早迟遲', text[end + 1]))
          && !(w === '是以' && (has('你您我电電', text[end]) || (has('他她它这這那', text[end]) && /[为為]|方式|形式|方法|身份|名义|名義|姿态|姿態/.test(text.slice(end, b)))))
          // 好在哪里; …，好在外头布散 (好 "so that" + 在 + where it is done).
          && !(w === '好在' && (has('哪什', text[end]) || /^(外头|外頭|外面|外边|外邊|人前|人面前|众人|眾人|三军|三軍|阵前|陣前|当面|當面)/.test(text.slice(end, b))))
          // 怪道：「… (blamed him, saying): 怪 + 道 before what is said, not 怪道 "no wonder".
          && !(w === '怪道' && end === b && has(SPEECH_OPENERS, text[end] ?? ''));
        // 看在老朋友的分上, 于我分上 (for the sake of): 分上 after 看/瞧/于 and whose sake; 一人分上一块, 分上下两层 stay apart.
        const sake = w === '分上' && FOR_THE_SAKE.test(text.slice(Math.max(0, pos - 14), pos));
        // 他老是抬头 (always), 这年月 那些年月 (these times): words the corpus never counted, meant unless 老 ends a title (高老是,
        // 大老是) or a date follows (某年月日).
        const meant = (w === '老是' && !(pos > a && (SURNAMES.has(dict.toSimplified(text[pos - 1])) || has('大二三黑', text[pos - 1]))))
          || (w === '年月' && !has('日', text[end]));
        if (w.length === 2 && (opener || sake || meant || (UNSEEN_BUT_MEANT.has(w) && !(w === '八路' && pos > a && NUMBER_DIGITS.includes(text[pos - 1]))))) {
          own = Math.max(own, Math.log(dict.freq(w[0]) + 1) + Math.log(dict.freq(w[1]) + 1) - logTotal + 1);
        }
        own += contextScore(text, pos, end, a, b, w, dict, lexicon);
      }
      // 一一 (one by one) is a word of its own: 一一应 is 一一 + 应, not 一 + 一应.
      if (w === '一一') own += ONE_ONE_BONUS;
      // 一只用: the 只 after a numeral is a measure word, so a word that starts with it (只用) is cut after it.
      if (w.length >= 2 && w[0] === '只' && pos > a && NUMERAL_BEFORE_ZHI.includes(text[pos - 1])) own -= 12;
      // 垂著手 睜著眼 擎著法環: 著 after a verb is the aspect particle; 著手 著眼 著想 著力 著重 are words only where nothing
      // verb-like comes before them (要著手, 先著眼). 站著作什麼 is 站著 + 作什麼, not 著作.
      if (w.length >= 2 && w[0] === '著' && pos > a && !'要先才須须應应宜當当將将能可便正又再從从由已即'.includes(text[pos - 1]) && '手眼想力重'.includes(w[1])) own -= 12;
      if (w === '著作' && has('什甚啥', text[pos + 2])) own -= 12;
      if (w.length === 2 && UNLIKELY_WORDS.has(w)) own -= 8;
      // 屋里面 家里头 心里边: the noun and 里面 (里头, 里边); the noun + 里 is not a word followed by a stray 面.
      if (w.length === 2 && '里裡裏'.includes(w[1]) && has('面边邊头頭', text[end])) own -= 4;
      // 三十多年才能輪到: 才能 after a time word is 才 + 能 (not the noun "talent").
      if (w === '才能' && pos > a && '年月日天時时次回歲岁'.includes(text[pos - 1])) own -= 12;
      // 有一行字: a line of writing (一 + 行 háng + 字), not the travelling party 一行 (yìxíng) of 一行人.
      if (w === '一行' && text[end] === '字') own -= 12;
      // 背著 is bēi (carrying) by default (WORD_READINGS); turned away from (背著臉), behind someone's back (偷背著我們, 背著人) and
      // 倒背著兩手 are bèi: cut there, and 背 alone keeps its bèi.
      if ((w === '背著' || w === '背着') && (has('臉脸人眾众', text[end]) || (pos > a && '偷倒'.includes(text[pos - 1])))) own -= 12;
      // 那還了得！ 好生了得: 了得 (liǎode) ends its clause or follows a word of praise; 了 and 得 are so common they would split it.
      // A longer dictionary word that ends in it (這還了得) is left to win on its own.
      if (w === '了得' && (end === b || BEFORE_LIAODE.some((p) => pos - p.length >= a && text.startsWith(p, pos - p.length)))
        && ![1, 2, 3].some((k) => pos - k >= a && dict.hasWord(text.slice(pos - k, end)))) own += 8;
      // 三十多年, 五个多月, 半个多月: the 多 goes with the number (or the number and its 个).
      if (w.length >= 2 && w[0] === '多' && pos > a && AFTER_DUO.includes(w[1]) && (NUMERAL_BEFORE_DUO.includes(text[pos - 1])
        || (has('个個', text[pos - 1]) && pos - 2 >= a && has(NUMERAL_BEFORE_DUO + '一两兩几幾半', text[pos - 2])))) own -= 12;
      const s = own - logTotal + score[end - a];
      const k = count[end - a] + 1;
      if (s > bestScore + 1e-9 || (Math.abs(s - bestScore) <= 1e-9 && k < bestCount)) {
        bestScore = s;
        bestCount = k;
        bestEnd = end;
      }
    }
    score[pos - a] = bestScore;
    count[pos - a] = bestCount;
    next[pos - a] = bestEnd;
  }
  const cuts: number[] = [];
  for (let pos = a; pos < b; pos = next[pos - a]) cuts.push(next[pos - a]);
  return cuts;
}

/** Characters of transliterated foreign names, in both scripts (杰西卡, 莫兰, 阿尔多, 佩里尼, 娜塔莎, 伊万诺娃). */
const TRANSLITERATED = new Set([...'阿埃艾爱愛安昂奥奧巴拜班邦保贝貝本比彼毕畢波伯博布查察达達戴丹德登迪蒂丁东東杜多厄恩尔爾法菲费費芬丰豐'
  + '弗夫福盖蓋冈岡高戈格葛贡貢古哈海汉漢豪赫亨胡华華霍基吉加贾賈杰傑金卡凯凱坎考柯科可克肯库庫拉莱萊兰蘭朗劳勞勒雷蕾里利莉丽麗历歷列'
  + '林琳隆卢盧鲁魯路伦倫罗羅洛马馬玛瑪迈邁麦麥曼梅门門蒙米密明莫墨默姆穆纳納娜奈南内內尼妮涅宁寧诺諾欧歐帕潘佩彭皮珀普齐齊奇契乔喬琼瓊'
  + '丘萨薩塞赛賽桑瑟森沙莎尚舍什史斯丝絲索塔泰坦汤湯唐特提汀图圖托瓦万萬威韦韋维維温溫文沃乌烏西希辛休雅亚亞扬揚耶也伊因尤约約泽澤扎詹'
  + '兹茲佐若撒勉采娃宾賓季苏蘇诃訶瑞台夏勃热熱娅婭']);
const NAME_DOTS = '·・•‧';

/**
 * A foreign name written with a middle dot (杰西卡·莫兰, 阿尔多·佩里尼·罗萨蒂) appears once and no list has it: the tokens of
 * transliteration characters right beside the dot are joined into one name, so 莫|兰 does not show 莫 "do not" and 兰 "orchid".
 */
function joinDottedNames(tokens: Token[], text: string): void {
  const translit = (t: Token) => t.kind === 'han' && [...t.text].every((ch) => TRANSLITERATED.has(ch));
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].kind !== 'punct' || !NAME_DOTS.includes(tokens[i].text)) continue;
    // The part after the dot, then the part before it (the merge shifts the indices of what follows, not of the dot).
    let e = i + 1;
    while (e < tokens.length && translit(tokens[e])) e++;
    if (e - (i + 1) >= 2) {
      const start = tokens[i + 1].start, end = tokens[e - 1].end;
      tokens.splice(i + 1, e - (i + 1), { text: text.slice(start, end), start, end, kind: 'han', inDict: false });
    }
    let s = i;
    while (s > 0 && translit(tokens[s - 1])) s--;
    if (i - s >= 2) {
      const start = tokens[s].start, end = tokens[i - 1].end;
      tokens.splice(s, i - s, { text: text.slice(start, end), start, end, kind: 'han', inDict: false });
      i = s + 1;
    }
  }
}

/**
 * Split `text` into tokens that cover it exactly (concatenating every token's text gives `text`).
 * Han tokens carry numbered pinyin per code point from dict.pinyinFor, with the neighbouring tokens as context.
 * `orig` is the paragraph as the book spells it when `text` is its conversion to the other script, character for character at the
 * same UTF-16 offsets (ui/reader/shown.ts checks that): the words are cut in `text`, the readings see the book's own characters
 * (為 乾 盡 where the page shows 为 干 尽).
 */
export function segment(text: string, dict: Dictionary, lexicon?: Lexicon, ruby?: readonly RubySpan[], orig?: string): Token[] {
  // A book in another language is cut by that language's engine (src/lang); everything below is Chinese.
  const engine = activeEngine();
  if (engine) return engine.segment(text, ruby?.length ? { ruby } : undefined);
  const tokens: Token[] = [];
  const n = text.length;
  const total = dict.meta?.counts?.wordTotal || DEFAULT_TOTAL;
  const logTotal = Math.log(total);
  let i = 0;
  const push = (start: number, end: number, kind: TokenKind) => {
    tokens.push({ text: text.slice(start, end), start, end, kind, inDict: false });
  };
  while (i < n) {
    const { cp, len } = cpAt(text, i);
    const cls = classify(cp);
    if (cls === 'han') {
      let j = i + len;
      while (j < n) {
        const nx = cpAt(text, j);
        if (classify(nx.cp) !== 'han') break;
        j += nx.len;
      }
      let from = i;
      for (const end of cutRun(text, i, j, dict, logTotal, lexicon)) {
        push(from, end, 'han');
        from = end;
      }
      i = j;
      continue;
    }
    if (cls === 'punct') { push(i, i + len, 'punct'); i += len; continue; }
    // Runs of the same class; marks stay with the character they follow.
    let j = i + len;
    while (j < n) {
      const nx = cpAt(text, j);
      const c2 = classify(nx.cp);
      if (c2 === 'mark' && cls !== 'space') { j += nx.len; continue; }
      if (c2 === cls) { j += nx.len; continue; }
      // Joiners inside words and numbers: don't, well-known, 3.14, 1,000
      if (cls === 'latin' && (nx.cp === 39 || nx.cp === 0x2019 || nx.cp === 45) && j + 1 < n && classify(text.codePointAt(j + 1)!) === 'latin') { j += 1; continue; }
      if (cls === 'num' && (nx.cp === 46 || nx.cp === 44) && j + 1 < n && classify(text.codePointAt(j + 1)!) === 'num') { j += 1; continue; }
      break;
    }
    push(i, j, cls === 'mark' ? 'other' : KIND[cls]);
    i = j;
  }
  joinDottedNames(tokens, text);
  const texts = tokens.map((x) => x.text);
  const own = orig !== undefined && orig.length === n && orig !== text ? orig : undefined;
  for (let t = 0; t < tokens.length; t++) {
    const tok = tokens[t];
    if (tok.kind !== 'han') continue;
    tok.inDict = dict.hasWord(tok.text);
    const entry = lexicon && [...tok.text].length >= 2 ? lexicon.get(tok.text) : undefined;
    const given = entry?.pinyin ? entry.pinyin.split(' ') : undefined;
    if (given && given.length === [...tok.text].length && given.every(Boolean)) {
      tok.pinyin = given;
      continue;
    }
    // `next` is '' (known to be nothing) at the end of a paragraph, not undefined: a 地 that ends a line is a noun.
    // `line` and `at` let a rule look further along the paragraph (为 X 所 V); `orig` is the token as the book spells it.
    tok.pinyin = dict.pinyinFor(tok.text, {
      prev: tokens[t - 1]?.text, next: tokens[t + 1]?.text ?? '', after: tokens[t + 2]?.text, line: texts, at: t,
      ...(own ? { orig: own.slice(tok.start, tok.end) } : {}),
    });
  }
  return tokens;
}
