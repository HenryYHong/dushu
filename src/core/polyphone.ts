// Context rules for characters with several readings. Contract: ARCHITECTURE.md §4.1.
//
// These run only for characters that are read on their own (a one-character token) or inside a word that CC-CEDICT
// does not list. A word that CEDICT lists (了解, 着急, 银行, 首都 …) always gets its dictionary reading instead.
// Each rule sees the text on both sides and returns a numbered syllable, or undefined to keep the default
// reading. The rules are deliberately simple and explicit; tests/core/polyphone.test.ts pins every one.
import { isHanCodePoint } from './text';

export interface CharContext {
  ch: string;
  /** Text before the character: the rest of its word, or else the previous token. */
  prevTok: string;
  /** Text after the character: the rest of its word, or else the next token. */
  nextTok: string;
  /** Last code point of prevTok, "" if none. */
  prevChar: string;
  /** First code point of nextTok, "" if none. */
  nextChar: string;
}

export function lastCodePoint(s: string): string {
  if (!s) return '';
  const a = s.charCodeAt(s.length - 1);
  return a >= 0xdc00 && a <= 0xdfff && s.length > 1 ? s.slice(-2) : s.slice(-1);
}

export function firstCodePointOf(s: string): string {
  if (!s) return '';
  const a = s.charCodeAt(0);
  return a >= 0xd800 && a <= 0xdbff && s.length > 1 ? s.slice(0, 2) : s[0];
}

const has = (set: string, c: string): boolean => c !== '' && set.includes(c);
const isHan = (c: string): boolean => c !== '' && isHanCodePoint(c.codePointAt(0)!);
const cpLen = (s: string): number => [...s].length;

const NUMERALS = '零〇一二三四五六七八九十百千万亿两半几每这那哪各整';
const PRONOUNS = '我你他她它咱们';

/**
 * Words with several CC-CEDICT readings where the file order (alphabetical by pinyin) puts the rarer sense first.
 * Keyed by the simplified headword; the value must be one of the readings CEDICT lists for it (tests check this).
 * Reviewed by hand against the 150 most frequent multi-reading words.
 */
export const WORD_READINGS: Readonly<Record<string, string>> = {
  地方: 'di4 fang5', // a place (not 地方 "regional")
  东西: 'dong1 xi5', // a thing
  人家: 'ren2 jia5', // other people
  不了: 'bu4 liao3', // 吃不了, 去不了
  妻子: 'qi1 zi5',
  明朝: 'ming2 chao2', // the Ming dynasty
  好处: 'hao3 chu5',
  大夫: 'dai4 fu5', // doctor
  大都: 'da4 dou1', // for the most part
  所长: 'suo3 zhang3', // head of an institute
  便宜: 'pian2 yi5', // cheap
  媳妇: 'xi2 fu5',
  生意: 'sheng1 yi5',
  本事: 'ben3 shi5',
  狮子: 'shi1 zi5',
  大爷: 'da4 ye5',
  工夫: 'gong1 fu5',
  琢磨: 'zuo2 mo5', // to ponder
  恶心: 'e3 xin1', // nausea
  分量: 'fen4 liang4',
  大方: 'da4 fang5', // generous
  结实: 'jie1 shi5', // sturdy
  空地: 'kong4 di4', // vacant land
  // Added from a frequency pass over the words CEDICT lists with several readings (the file puts the rarer one first).
  结果: 'jie2 guo3', // outcome (not "bear fruit")
  重点: 'zhong4 dian3',
  告诉: 'gao4 su5',
  多少: 'duo1 shao5',
  教授: 'jiao4 shou4', // professor
  教学: 'jiao4 xue2',
  故事: 'gu4 shi5',
  说法: 'shuo1 fa5',
  小子: 'xiao3 zi5',
  买卖: 'mai3 mai5',
  得罪: 'de2 zui5',
  跟前: 'gen1 qian5',
  口音: 'kou3 yin5',
  金子: 'jin1 zi5',
  照应: 'zhao4 ying5',
  端详: 'duan1 xiang5',
  出息: 'chu1 xi5',
  营生: 'ying2 sheng5',
  裁缝: 'cai2 feng5',
  上头: 'shang4 tou5',
  盘缠: 'pan2 chan5',
  铺盖: 'pu1 gai5',
};

type Rule = (c: CharContext) => string | undefined;

const RULES: Record<string, Rule> = {
  // Particles. 了 is liǎo after 不 / after 得 at the end of a clause (吃不了, 受得了); le everywhere else.
  了: (c) => {
    if (c.prevChar === '不') return 'liao3';
    if (c.prevChar === '得' && !isHan(c.nextChar)) return 'liao3';
    return 'le5';
  },
  的: () => 'de5',
  着: (c) => {
    if (c.prevChar === '不' && !isHan(c.nextChar)) return 'zhao2'; // 睡不着
    if (has('睡找猜碰摸够撞冻烧买赶', c.prevChar) && (!isHan(c.nextChar) || has('了没不就', c.nextChar))) return 'zhao2';
    return 'zhe5';
  },
  // 得: děi after a pronoun ("must": 我得去), de after a verb (跑得快). dé stays in words (得到, 取得).
  得: (c) => {
    if (!isHan(c.prevChar)) return 'de2';
    if (has(PRONOUNS, c.prevChar) && isHan(c.nextChar) && !has('很不太多更最', c.nextChar)) return 'dei3';
    return 'de5';
  },
  // 地: de after an adverb (慢慢地, 高兴地: two or more characters), dì otherwise (土地 is a word; 在地上).
  地: (c) => {
    if (c.prevChar === '的' || !isHan(c.prevChar)) return 'di4';
    const notNoun = !has('上下里中外内面边方区图理球震形板点址', c.nextChar);
    if (cpLen(c.prevTok) >= 2 && notNoun) return 'de5';
    // A one-character adverb before a verb: 更多地了解, 快快, 狠狠 are covered above; these are the common single ones.
    if (has('多少快慢早晚紧轻深静狠猛真远近', c.prevChar) && isHan(c.nextChar) && notNoun) return 'de5';
    return 'di4';
  },
  还: (c) => (has('书钱给回债款账原本愿手价礼俗乡魂', c.nextChar) ? 'huan2' : 'hai2'),
  都: (c) => (has('首京古故旧陪帝', c.prevChar) ? 'du1' : 'dou1'),
  行: (c) => (has('银同排各商内外', c.prevChar) || has('业列当家话情', c.nextChar) ? 'hang2' : 'xing2'),
  长: (c) => {
    if (has('生成增涨助滋', c.prevChar)) return 'zhang3';
    if (has('大高出成胖瘦得着', c.nextChar) && !has('太很最更真好多这那非', c.prevChar)) return 'zhang3';
    return 'chang2';
  },
  重: (c) => (has('新复建来逢叠返演组现播写读', c.nextChar) ? 'chong2' : 'zhong4'),
  为: (c) => {
    if (c.prevChar === '因') return 'wei4';
    if (c.nextTok === '人') return 'wei2'; // 为人正直
    if (has('以认作成视称当行被定分改变设列选译化叫归算命', c.prevChar)) return 'wei2';
    return 'wei4';
  },
  觉: (c) => (has('睡午懒补回', c.prevChar) ? 'jiao4' : 'jue2'),
  好: (c) => (['学', '客', '动', '胜', '奇', '色', '斗', '战', '赌', '洁'].includes(c.nextTok) ? 'hao4' : 'hao3'),
  少: (c) => {
    if (has('多至很太最较减缺稀不', c.prevChar)) return 'shao3';
    return has('年女爷将校尉壮妇主儿先帅', c.nextChar) ? 'shao4' : 'shao3';
  },
  种: (c) => (has('树地花菜田草瓜豆粮麦稻玉米果苗', c.nextChar) && !has(NUMERALS + '多', c.prevChar) ? 'zhong4' : 'zhong3'),
  中: (c) => {
    if (has('击射看猜选命考投打说刺砸', c.prevChar)) return 'zhong4';
    if (['奖', '毒', '弹', '标', '风', '计', '枪', '暑', '邪', '蛊', '魔', '招'].includes(c.nextTok)) return 'zhong4';
    return 'zhong1';
  },
  看: (c) => (['守', '护', '管', '门', '家', '押', '犬'].includes(c.nextTok) ? 'kan1' : 'kan4'),
  相: (c) => (has('照首外宰真', c.prevChar) || ['貌', '片', '机', '声', '册', '位', '框', '纸'].includes(c.nextTok) ? 'xiang4' : 'xiang1'),
  应: (c) => (has('付用对酬变验急聘邀声战允召运', c.nextChar) ? 'ying4' : 'ying1'),
  空: (c) => (has('有没抽挤留填偷趁补', c.prevChar) || ['闲', '白', '缺', '隙', '当', '儿'].includes(c.nextTok) ? 'kong4' : 'kong1'),
  分: (c) => (has('成养过充本名缘安辈', c.prevChar) || ['内', '外'].includes(c.nextTok) ? 'fen4' : 'fen1'),
  便: (c) => (c.nextChar === '宜' ? 'pian2' : 'bian4'),
  传: (c) => (['记', '略'].includes(c.nextTok) || has('自小列评别立正', c.prevChar) ? 'zhuan4' : 'chuan2'),
  数: (c) => {
    if (has('一数不得遍着起清了', c.nextChar) || has('一数胜了', c.prevChar)) return 'shu3';
    return 'shu4';
  },
  乐: (c) => (has('器队曲团谱章坛府师手理', c.nextChar) || has('音配器声国管弦民奏', c.prevChar) ? 'yue4' : 'le4'),
  干: (c) => (has('活部事劲嘛吗什啥坏', c.nextChar) || has('能苦实巧才', c.prevChar) ? 'gan4' : 'gan1'),
  假: (c) => (has('放请休暑寒病年度产例事婚探补销长短', c.prevChar) || ['期', '日', '条'].includes(c.nextTok) ? 'jia4' : 'jia3'),
  倒: (c) => (has('是水茶酒退立影数转置挂垃', c.nextChar) || c.prevChar === '反' ? 'dao4' : 'dao3'),
  调: (c) => {
    if (has('整节解皮味料剂和养理教停侃价情', c.nextChar) || has('协空失风', c.prevChar)) return 'tiao2';
    return 'diao4';
  },
  薄: (c) => {
    if (c.nextChar === '荷') return 'bo4';
    if (has('弱利暮情命酒礼雾膜', c.nextChar) || has('淡单稀刻微菲浅厚轻', c.prevChar)) return 'bo2';
    return 'bao2';
  },
  角: (c) => (['色', '逐', '斗'].includes(c.nextTok) || has('主配丑旦名反', c.prevChar) ? 'jue2' : 'jiao3'),
  处: (c) => (has('理罚分置决境事世方身于在', c.nextChar) || has('相共独身位地', c.prevChar) ? 'chu3' : 'chu4'),
  只: (c) => (has(NUMERALS, c.prevChar) || /[0-9]/.test(c.prevChar) ? 'zhi1' : 'zhi3'),
  发: (c) => (has('头理毛白黑假金银长短卷剪染', c.prevChar) || has('型廊夹胶簪际', c.nextChar) ? 'fa4' : 'fa1'),
  率: (c) => (has('领先兵军众团队', c.nextChar) || has('草轻表统坦真直', c.prevChar) ? 'shuai4' : 'lü4'),
  量: (c) => (has('体力身尺长入一', c.nextChar) || has('测估思度', c.prevChar) ? 'liang2' : 'liang4'),
  曲: (c) => (has('歌作乐名小序插戏', c.prevChar) ? 'qu3' : 'qu1'),
  模: (c) => (has('样子具', c.nextChar) ? 'mu2' : 'mo2'),
  会: (c) => (c.nextChar === '计' ? 'kuai4' : 'hui4'),
  难: (c) => (has('民友胞', c.nextChar) || has('灾苦患遇受罹空海责非刁', c.prevChar) ? 'nan4' : 'nan2'),
  将: (c) => {
    if (c.nextChar === '军') return 'jiang1';
    if (has('士领校帅官才', c.nextChar) || has('大名上少中良武虎老勇猛主敌副', c.prevChar)) return 'jiang4';
    return 'jiang1';
  },
  间: (c) => (has('谍隔断接歇', c.nextChar) || has('离反挑', c.prevChar) ? 'jian4' : 'jian1'),
  当: (c) => (has('作真铺做成晚日', c.nextChar) || has('上适恰妥得稳', c.prevChar) ? 'dang4' : 'dang1'),
  几: (c) => (c.nextChar === '乎' ? 'ji1' : 'ji3'),
  恶: (c) => (has('可厌憎', c.prevChar) ? 'wu4' : 'e4'),
  供: (c) => (has('品奉养桌', c.nextChar) ? 'gong4' : 'gong1'),
  弹: (c) => (has('子炮炸导枪核', c.prevChar) || has('药壳头道', c.nextChar) ? 'dan4' : 'tan2'),
  降: (c) => (c.nextChar === '服' ? 'xiang2' : 'jiang4'),
  切: (c) => (has('一亲恳急迫确密贴深真关', c.prevChar) || has('实身', c.nextChar) ? 'qie4' : 'qie1'),
  朝: (c) => (has('气夕霞露晖', c.nextChar) ? 'zhao1' : 'chao2'),
  载: (c) => (has('记登转刊连千', c.prevChar) ? 'zai3' : 'zai4'),
  冠: (c) => (has('军亚季', c.nextChar) ? 'guan4' : 'guan1'),
  兴: (c) => (has('高扫败尽助', c.prevChar) || has('致趣味', c.nextChar) ? 'xing4' : 'xing1'),
  教: (c) => (has(PRONOUNS + '师', c.prevChar) && isHan(c.nextChar) || has('书课', c.nextChar) ? 'jiao1' : 'jiao4'),
  晕: (c) => (has('车船机', c.nextChar) ? 'yun4' : 'yun1'),
  卷: (c) => (has('试画胶案考问书', c.prevChar) || has('子宗', c.nextChar) ? 'juan4' : 'juan3'),
  创: (c) => (has('伤口面痕', c.nextChar) ? 'chuang1' : 'chuang4'),
  横: (c) => (has('蛮强专', c.prevChar) || has('财祸死', c.nextChar) ? 'heng4' : 'heng2'),
  磨: (c) => (has('坊盘', c.nextChar) || has('石推', c.prevChar) ? 'mo4' : 'mo2'),
  宿: (c) => (has('一二两半整', c.prevChar) ? 'xiu3' : 'su4'),
  // Erhua: 儿 after a Han character is the suffix r (花儿, 玩意儿) unless a dictionary word claims it.
  儿: (c) => (isHan(c.prevChar) ? 'r5' : 'er2'),
  // 子 as a noun suffix (桌子) is neutral; handled for words CEDICT lacks.
};

/** Rule-based reading for `ctx.ch`, or undefined when no rule applies (use the dictionary default). */
export function polyphoneReading(ctx: CharContext): string | undefined {
  const rule = RULES[ctx.ch];
  return rule ? rule(ctx) : undefined;
}

/** Characters that have an explicit rule (for tests and tooling). */
export const POLYPHONE_CHARS: readonly string[] = Object.keys(RULES);
