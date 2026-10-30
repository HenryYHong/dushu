// Context rules for characters with several readings. Contract: ARCHITECTURE.md §4.1.
//
// These run only for characters that are read on their own (a one-character token) or inside a word that CC-CEDICT
// does not list. A word that CEDICT lists (了解, 着急, 银行, 首都 …) always gets its dictionary reading instead.
// Each rule sees the text on both sides and returns a numbered syllable, or undefined to keep the default
// reading. The rules are deliberately simple and explicit; tests/core/polyphone.test.ts pins every one.
import { isHanCodePoint } from './text';

export interface CharContext {
  ch: string;
  /** The character as written (traditional 隻, 噹, 鈀); `ch` is its simplified form. Optional for callers that only have `ch`. */
  orig?: string;
  /** Text before the character: the rest of its word, or else the previous token. */
  prevTok: string;
  /** Text after the character: the rest of its word, or else the next token. */
  nextTok: string;
  /** Last code point of prevTok, "" if none. */
  prevChar: string;
  /** First code point of nextTok, "" if none. */
  nextChar: string;
  /** First code point of the token after nextTok (when nextTok is a whole token), "" if none or unknown. */
  afterChar?: string;
  /** False when nothing was said about what follows (the caller had no neighbors), so an empty nextTok means "unknown". */
  nextKnown?: boolean;
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

/** A character or a closing quote that ends a word: a particle after it is a sentence-final particle (「孙」罢). */
const afterWord = (c: string): boolean => isHan(c) || has('』」”’）》', c);

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
  累卵之急: 'lei3 luan3 zhi1 ji2', // piled eggs (lěi), not léi
  花儿: 'hua1 r5', // the flower with the diminutive suffix; hua1 er2 is the folk song of Gansu
  好学: 'hao4 xue2', // studious (好學者); "easy to learn" is the rarer sense
  大夫: 'dai4 fu5', // doctor
  大都: 'da4 dou1', // for the most part
  所长: 'suo3 zhang3', // head of an institute
  便宜: 'pian2 yi5', // cheap
  骰子: 'shai3 zi5', // dice: how it is said (the dictionaries' reading is tóuzi; also written 色子), book-words.tsv
  掷骰子: 'zhi4 shai3 zi5',
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
  背着: 'bei1 zhe5', // carrying on the back (背着包袱, 背着娘); bèi "behind someone's back" is cut off in segment.ts
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

/**
 * Characters whose bare reading is not the first one Unihan lists (佛 is fó, not fú; 擔 is dān, the verb). The dictionary
 * uses these when it has to pick a reading for the character alone; the context rules below still override them.
 */
export const CHAR_DEFAULTS: Readonly<Record<string, string>> = {
  佛: 'fo2', 担: 'dan1', 擔: 'dan1', 谯: 'qiao2', 譙: 'qiao2',
  勒: 'le4', // 勒马 勒令 勒索; lēi "to tie tight" is the rarer one
  諕: 'xia4', // 諕得 is 嚇得 (xià dé), not the háo "to intimidate" Unihan lists first
  悄: 'qiao1', // 悄言, 悄语 (quietly); qiǎo "sad" is the rare one
  箇: 'ge5', // the written form of 个 in 这箇 那箇
};

type Rule = (c: CharContext) => string | undefined;

const RULES: Record<string, Rule> = {
  // Particles. 了 is liǎo after 不 / after 得 at the end of a clause (吃不了, 受得了); le everywhere else.
  了: (c) => {
    if (c.prevChar === '不') return 'liao3';
    if (c.prevChar === '得' && !isHan(c.nextChar)) {
      // 动弹不得了 is 动弹不得 + 了 (the 得 belongs to 不得); 吃得了, 受不得了 end the clause with liǎo.
      // 晓得了, 觉得了 (a verb that ends in 得) is the verb + le: 我晓得了.
      return /不得$|(晓|觉|记|懂|认|显|值|免|省|使|落|怪|舍|晓|巴|由|只|且|须|取|获|赢|博|心|懂|懂)得$/.test(c.prevTok) ? 'le5' : 'liao3';
    }
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
    // 得叫他去, 得让他知道: děi ("must") before a causative, when nothing precedes it in the clause.
    if (!isHan(c.prevChar)) return has('叫让给去', c.nextChar) ? 'dei3' : 'de2';
    if (c.prevChar === '事' && has('叫让给', c.nextChar)) return 'dei3'; // 这事得叫他去
    // 他得了性命, 你得之甚易: the verb "to get" (dé) after a pronoun, not "must".
    if (has(PRONOUNS, c.prevChar) && has('了过之到著着', c.nextChar)) return 'de2';
    if (!has(PRONOUNS, c.prevChar) && has('令胜罪知意', c.nextChar) && isHan(c.prevChar)) return 'de2'; // 得令 得胜 得罪 得知: dé
    // 我得去 你得小心 他得叫人 (must) before a verb of going, speaking, doing or an adverb of care; 我得何罪 我们得见青天 他得永住
    // 昨儿我得的 (get, obtain) before anything else: dé.
    if (has(PRONOUNS, c.prevChar) && isHan(c.nextChar) && !has('很不太多更最', c.nextChar)) return has('去来回走说看问做作请叫让给等吃喝想罢留找买卖赔拿带送接打喊赶快先好小细仔亲自慢紧再就重另', c.nextChar) ? 'dei3' : 'de2';
    return 'de5';
  },
  // 地: de after an adverb (慢慢地, 高兴地: two or more characters), dì otherwise (土地 is a word; 在地上).
  地: (c) => {
    if (c.prevChar === '的' || !isHan(c.prevChar)) return 'di4';
    if (has('怎恁这那何诛', c.prevChar)) return 'di4'; // 怎地 恁地 (zěn dì), 天诛地灭
    // The particle goes in front of a verb or an adjective, so a 地 that closes its clause is the noun (名利无双地, 福地).
    if (c.nextKnown !== false && !isHan(c.nextChar)) return 'di4';
    // 猛地 忽地 蓦地 倏地 霍地 陡地 突地 are adverbs read dì (CEDICT: 猛地 měngdì), not the particle de.
    if (has('猛忽蓦倏霍陡突', c.prevChar)) return 'di4';
    const notNoun = !has('上下里中外内面边方区图理球震形板点址', c.nextChar);
    if (cpLen(c.prevTok) >= 2 && notNoun) return 'de5';
    // A one-character adverb before a verb: 更多地了解, 快快, 狠狠 are covered above; these are the common single ones.
    if (has('多少快慢早晚紧轻深静狠猛真远近', c.prevChar) && isHan(c.nextChar) && notNoun) return 'de5';
    return 'di4';
  },
  还: (c) => {
    if (c.prevChar === '而' && !isHan(c.nextChar)) return 'huan2'; // 不克而还: came back
    if (!isHan(c.prevChar) && has('我你他', c.nextChar)) return 'huan2'; // 还我人来! 还你个功到: "give back", starting the clause
    if (has('阳', c.nextChar) || (has('往回复返', c.prevChar) && !has('还', c.nextChar))) return 'huan2'; // 还阳 往还 回还
    // 他还回来: "still came back" after a pronoun; 还回去 after a verb or by itself is "give back".
    if (c.nextChar === '回' && has(PRONOUNS, c.prevChar)) return 'hai2';
    // 还了酒钱, 我已经还了。: the adverb never stands right before 了, so this is "give back"; 还了得 (how dreadful) is hái.
    if (c.nextTok === '了') return c.afterChar === '得' ? 'hai2' : 'huan2';
    // 借了不还。 引军北还。 天道好还: a 还 that ends its clause after another word is the verb. Without neighbors, keep hái.
    if (c.nextKnown !== false && !isHan(c.nextChar) && isHan(c.prevChar)) return 'huan2';
    return has('书钱给回债款账原本愿手价礼俗乡魂', c.nextChar) ? 'huan2' : 'hai2';
  },
  都: (c) => (has('首京古故旧陪帝', c.prevChar) ? 'du1' : 'dou1'),
  行: (c) => (has('银同排各商内外米数两几', c.prevChar) || has('业列当家话情字', c.nextChar) ? 'hang2' : 'xing2'),
  长: (c) => {
    if (has('道夫', c.prevChar) && !has('老', c.nextChar)) return 'zhang3'; // 道长 (a Daoist master) 万夫长 (a commander of ten thousand)
    if (has('生成增涨助滋', c.prevChar)) return 'zhang3';
    if (has('大高出成胖瘦得着', c.nextChar) && !has('太很最更真好多这那非', c.prevChar)) return 'zhang3';
    return 'chang2';
  },
  重: (c) => (has('新复建来逢叠返演组现播写读又', c.nextChar) ? 'chong2' : 'zhong4'),
  为: (c) => {
    if (has('因只但特专单', c.prevChar)) return 'wei4'; // 因为 只为 但为 特为 专为: "because of, just for"
    // 为人谋而不忠乎 (for others) is wèi; 为人正直 (to be a person) is wéi.
    if (c.nextTok === '人') return c.afterChar && '谋'.includes(c.afterChar) ? 'wei4' : 'wei2';
    // 有诗为证, 为首, 为止, 为主, 为难, 为准: "to be, as" (wéi); 方为座上客, 皆为, 乃为, 即为: the verb after an adverb.
    if (has('证首止主准例难限', c.nextChar) || has('方乃即则皆俱均亦是转互实', c.prevChar)) return 'wei2';
    if (has('以认作成视称当行被定分改变设列选译化叫归算命劈解拜封立任奉誉误看想', c.prevChar)) return 'wei2';
    if (has('妻妾', c.nextChar) && !isHan(c.nextTok.slice(1, 2))) return 'wei2'; // 为妻 为妾: to take as a wife
    // "for": before a pronoun, a question word, 了 or a beneficiary (为什么 为何 为我 为了 为国 为民 为大家).
    if (has('什甚何谁我你他她它咱们此之这那了着汝吾尔国民君朋友众百姓大家求救报寻保杀取好', c.nextChar)) return 'wei4'; // 为求经 为好而来: "in order to"
    // Nothing says which: in the old novels and classics 為 is the verb "to be, to become, as" (举火为号, 号为玉音, 深为不便,
    // 尊母何氏为太后) far more often than "for", in modern writing the other way round. The spelling tells the two apart.
    return c.orig === '为' ? 'wei4' : 'wei2';
  },
  觉: (c) => (has('睡午懒补回一', c.prevChar) ? 'jiao4' : 'jue2'),
  好: (c) => (['学', '客', '动', '胜', '奇', '色', '斗', '战', '赌', '洁'].includes(c.nextTok) || has('机谋犯勇乱争淫施贪', c.nextChar) || ['作乱'].includes(c.nextTok) ? 'hao4' : 'hao3'), // 好机变 好谋无断 好作乱: to like
  少: (c) => {
    if (has('多至很太最较减缺稀不', c.prevChar)) return 'shao3';
    return has('年女爷将校尉壮妇主儿先帅小', c.nextChar) ? 'shao4' : 'shao3';
  },
  // 骑 is jì "a horseman" after a number or a kind of rider (一骑自北而来, 单骑, 铁骑, 轻骑); qí "to ride" before what is ridden.
  骑: (c) => (has('一二两三四五六七八九十数单铁轻骁越', c.prevChar) && !has('马乘着了过', c.nextChar) ? 'ji4' : undefined),
  // 系 as 繫 is jì "to tie" (腰繫金带, 系着, 系鞋带), xì "to connect, to relate" otherwise.
  系: (c) => (c.orig === '繫' && (has('腰足颈臂手身马鞋', c.prevChar) || has('着住上好紧带铃', c.nextChar)) ? 'ji4' : undefined),
  // 盛 is chéng "to fill, to hold" before 了 着 饭 汤 殓 (盛了 盛饭), shèng "flourishing" otherwise.
  盛: (c) => (has('了着饭汤殓贮装放', c.nextChar) ? 'cheng2' : undefined),
  种: (c) => (has('树地花菜田草瓜豆粮麦稻玉米果苗出得上下', c.nextChar) && !has(NUMERALS + '多', c.prevChar) ? 'zhong4' : 'zhong3'),
  中: (c) => {
    // 小说中, 传说中, 据说中: "in", not "to hit".
    if (c.prevChar === '说' && /(小|传|听|据|所|常|众|话|评|解|言|书)说$/.test(c.prevTok)) return 'zhong1';
    if (has('击射看猜选命考投打说刺砸又必便竟被', c.prevChar)) return 'zhong4'; // 又中一枪 必中诸葛亮之计
    if (['奖', '毒', '弹', '标', '风', '计', '枪', '暑', '邪', '蛊', '魔', '招'].includes(c.nextTok)) return 'zhong4';
    // 中了计, 中了一箭, 中了举人, 中了他的计: what hits (or the exam passed) comes after the 了. 家中了。 and 家中了么 stay "in".
    if (c.nextTok === '了') {
      const after = c.afterChar ?? '';
      if (isHan(after) ? !has('么吗吧罢呢啊呀哩啦哪', after) : has(PRONOUNS, c.prevChar)) return 'zhong4';
    }
    return 'zhong1';
  },
  看: (c) => (['守', '护', '管', '门', '家', '押', '犬'].includes(c.nextTok) ? 'kan1' : 'kan4'),
  相: (c) => (has('照首外宰真恩', c.prevChar) || ['貌', '片', '机', '声', '册', '位', '框', '纸'].includes(c.nextTok) ? 'xiang4' : 'xiang1'),
  应: (c) => (has('付用对酬变验急聘邀声战允召运', c.nextChar) || has('以后叫', c.prevChar) ? 'ying4' : 'ying1'), // 以应之 叫应: respond (yìng)
  空: (c) => {
    // 个空 is a gap (砍了一个空, 留个空) at the end of a clause, a plain 空 when more follows (个空瓶, 个空衔).
    if (c.prevChar === '个') return !isHan(c.nextChar) ? 'kong4' : 'kong1';
    return has('有没抽挤留填偷趁补得', c.prevChar) || ['闲', '白', '缺', '隙', '当', '儿'].includes(c.nextTok) ? 'kong4' : 'kong1';
  },
  分: (c) => (has('成养过充本名缘安辈', c.prevChar) || ['内', '外'].includes(c.nextTok) ? 'fen4' : 'fen1'),
  便: (c) => (c.nextChar === '宜' ? 'pian2' : 'bian4'),
  传: (c) => (['记', '略'].includes(c.nextTok) || has('自小列评别立正', c.prevChar) ? 'zhuan4' : 'chuan2'),
  数: (c) => {
    // 数十 数百 数招: "several" (shù), also right after 了 (了数十招). 数个山头 数次 数日: "several" before a measure word.
    if (has('十百千万招余个次日天年月回遍里步丈尺寸条只场家处种般样位名件项头匹口门张套载辈代杯盏碗壶', c.nextChar)) return 'shu4';
    if (has('历', c.prevChar) && !isHan(c.nextChar)) return 'shu4'; // 历数 (the years), 气数
    if (has('一数不得遍着起清了去来钱', c.nextChar) || has('一数胜了', c.prevChar)) return 'shu3'; // 数去更无君傲世, 数来数去, 数钱
    return 'shu4';
  },
  乐: (c) => (has('器队曲团谱章坛府师手理', c.nextChar) || has('音配器声国管弦民奏鼓细', c.prevChar) ? 'yue4' : 'le4'),
  干: (c) => {
    // 幹 is only ever gàn (幹事 樹幹 幹什麼); 乾 is gān "dry" except in the hexagram 乾元 乾卦 (qián). 干 is both: 干活 gàn, 不干我事 gān.
    if (c.orig === '幹') return 'gan4';
    if (c.orig === '乾') return has('坤元卦象道位造', c.nextChar) ? 'qian2' : 'gan1';
    // 干甚么 干什么 干活 (to do): gàn. After 去 来 没 都 可 么 (去干, 没干) the verb is gàn too (不干我事 "is none of my business" stays gān); after a verb of drying (晒干 擦干) it is gān.
    if (has('晒烧擦喝吃洗哭抽榨舔拭风烤', c.prevChar)) return 'gan1';
    return has('活部事劲嘛吗什甚啥坏', c.nextChar) || has('能苦实巧才去来没都可么也就要得该', c.prevChar) ? 'gan4' : 'gan1';
  },
  假: (c) => (has('放请休暑寒病年度产例事婚探补销长短告天日歇', c.prevChar) || ['期', '日', '条'].includes(c.nextTok) ? 'jia4' : 'jia3'),
  倒: (c) => {
    // Falling over or toppling (dǎo): after a verb of falling, before 下 在 地 霉 了, or at the end of a clause
    // (怕我倒。 墙倒了。). Everything else in running text is dào: the adverb "on the contrary / rather" (倒也 倒不 倒还
    // 倒像 倒让他 …, very common in dialogue), pouring (倒茶) and reversing (倒退 倒立 倒数).
    if (has('摔跌跪推打病昏滑绊压栽撞仆晕扑拉冻累醉吓气笑捆翻放躺拜', c.prevChar)) return 'dao3';
    if (has('下在地霉塌台闭伏毙', c.nextChar)) return 'dao3';
    // 墙倒了。 (fell) but 倒了茶来 (poured): what follows 了 tells them apart.
    if (c.nextTok === '了') return isHan(c.afterChar ?? '') ? 'dao4' : 'dao3';
    if (has('是水茶酒汤饭油药粥退立影数转置挂垃', c.nextChar) || c.prevChar === '反') return 'dao4';
    if (isHan(c.prevChar) && !isHan(c.nextChar)) return 'dao3';
    return 'dao4';
  },
  调: (c) => {
    if (has('整节解皮味料剂和养理教停侃价情息治戏弄琴', c.nextChar) || has('协空失风均', c.prevChar)) return 'tiao2';
    return 'diao4';
  },
  薄: (c) => {
    if (c.nextChar === '荷') return 'bo4';
    if (has('弱利暮情命酒礼雾膜', c.nextChar) || has('淡单稀刻微菲浅厚轻', c.prevChar)) return 'bo2';
    return 'bao2';
  },
  角: (c) => (['色', '逐', '斗'].includes(c.nextTok) || has('主配丑旦名反', c.prevChar) ? 'jue2' : 'jiao3'),
  处: (c) => (has('理罚分置决境事世方身于在', c.nextChar) || has('相共独身位地', c.prevChar) ? 'chu3' : 'chu4'),
  只: (c) => (c.orig === '隻' || has(NUMERALS, c.prevChar) || /[0-9]/.test(c.prevChar) ? 'zhi1' : 'zhi3'),
  发: (c) => (c.orig === '髮' || has('头理毛白黑假金银长短卷剪染', c.prevChar) || has('型廊夹胶簪际', c.nextChar) ? 'fa4' : 'fa1'), // 髮 is only hair (fà)
  率: (c) => (has('领先兵军众团队', c.nextChar) || has('草轻表统坦真直', c.prevChar) ? 'shuai4' : 'lü4'),
  // 量宋江有何德能 量此山僻之处: a clause that opens with 量 is the verb "to reckon" (liáng); 量词 量子 (liàng) are the exceptions.
  量: (c) => (has('体力身尺长入一', c.nextChar) || has('测估思度', c.prevChar) || (!isHan(c.prevChar) && isHan(c.nextChar) && !has('词子', c.nextChar)) ? 'liang2' : 'liang4'),
  曲: (c) => (has('歌作乐名小序插戏', c.prevChar) ? 'qu3' : 'qu1'),
  模: (c) => (has('样子具', c.nextChar) ? 'mu2' : 'mo2'),
  会: (c) => (c.nextChar === '计' ? 'kuai4' : 'hui4'),
  难: (c) => (has('民友胞', c.nextChar) || has('灾苦患遇受罹空海责非刁急避赴遭落蒙殉国救犯逃此大', c.prevChar) ? 'nan4' : 'nan2'),
  将: (c) => {
    if (c.nextChar === '军') return 'jiang1';
    // 众将 诸将 两将相交 (the generals): jiàng after a word that counts or gathers them.
    if (has('众诸各偏裨二两三四五六七八九十数', c.prevChar) && !has('军', c.nextChar)) return 'jiang4';
    if (has('士领校帅官才', c.nextChar) || has('大名上少中良武虎老勇猛主敌副天牙神骁女败降战', c.prevChar)) return 'jiang4';
    return 'jiang1';
  },
  // 省 is xǐng "to examine, to visit" in 三省吾身 省悟 省亲 省视 内省, shěng "province, to save" otherwise.
  省: (c) => (has('反内自三再', c.prevChar) || has('亲视墓悟察', c.nextChar) ? 'xing3' : undefined),
  间: (c) => (has('谍隔断接歇', c.nextChar) || has('离反挑', c.prevChar) ? 'jian4' : 'jian1'),
  当: (c) => (c.prevChar === '当' || c.nextChar === '当' ? 'dang1' // 当当作响: the sound, not 当作
    : has('作真铺做成晚日', c.nextChar) || has('上适恰妥得稳', c.prevChar) ? 'dang4' : 'dang1'),
  几: (c) => (c.nextChar === '乎' ? 'ji1' : 'ji3'),
  恶: (c) => (has('可厌憎', c.prevChar) ? 'wu4' : 'e4'),
  供: (c) => (has('品奉养桌', c.nextChar) ? 'gong4' : 'gong1'),
  弹: (c) => (has('子炮炸导枪核珠', c.prevChar) || has('药壳头道丸', c.nextChar) ? 'dan4' : 'tan2'),
  // 降 is xiáng "to surrender / to subdue" in 降妖 降龙 降服 and after a verb of yielding (受降 归降 投降 来降 原降文武), jiàng otherwise.
  降: (c) => {
    if (has('临生旨罪福雨雪霜露落下价级低温压世', c.nextChar)) return 'jiang4';
    if (has('服伏妖魔龙虎怪贼顺书表兵将', c.nextChar) || has('受投招纳乞请归迫劝诱诈来原新已皆尽出', c.prevChar)) return 'xiang2';
    return 'jiang4';
  },
  // 切须 切莫 切勿 切忌 切不可 (be sure to / never): qiè; 切菜 切开 qiē.
  切: (c) => (has('一亲恳急迫确密贴深真关甚', c.prevChar) || has('实身须莫勿忌思念恨盼', c.nextChar) || ['不可', '不要', '不得', '不宜', '不能'].includes(c.nextTok) ? 'qie4' : 'qie1'),
  // 一朝 (one morning, one day) is yī zhāo unless it is a dynasty (一朝天子一朝臣).
  朝: (c) => (has('气夕霞露晖', c.nextChar) || (c.prevChar === '一' && c.nextTok !== '天子' && !has('臣', c.nextChar)) ? 'zhao1' : 'chao2'),
  载: (c) => (has('记登转刊连千', c.prevChar) ? 'zai3' : 'zai4'),
  冠: (c) => (has('军亚季', c.nextChar) ? 'guan4' : 'guan1'),
  兴: (c) => (has('高扫败尽助', c.prevChar) || has('致趣味', c.nextChar) ? 'xing4' : 'xing1'),
  // 教 is jiào ("to let, to make": 我教你不要慌 太师教唤进来 教他先吃我一棒) far more often than jiāo "to teach" in the old novels;
  // jiāo when a lesson or a trick follows (教书 教你个法子 教你一招), and after 师.
  教: (c) => (has('书课给給', c.nextChar) || c.prevChar === '师' && isHan(c.nextChar)
    || (has(PRONOUNS, c.prevChar) && has('你我他她们', c.nextChar) && c.afterChar !== undefined && has('个一些几两三招法手字', c.afterChar)) ? 'jiao1' : 'jiao4'),
  晕: (c) => (has('车船机', c.nextChar) ? 'yun4' : 'yun1'),
  卷: (c) => {
    if (has('试画胶案考问书', c.prevChar) || has('子宗', c.nextChar)) return 'juan4';
    // 上卷 下卷 (the first and second volumes of a work)
    if (has('上下中', c.prevChar) && (has('经书', c.nextChar) || !isHan(c.nextChar))) return 'juan4';
    // 一卷经, 度亡经一卷: a volume (juàn); 一卷铺盖 rolls up (juǎn).
    if (has('一二三四五六七八九十数两', c.prevChar) && (has('经书咒文诗词曲帖', c.nextChar) || !isHan(c.nextChar))) return 'juan4';
    return 'juan3';
  },
  创: (c) => (has('伤口面痕', c.nextChar) ? 'chuang1' : 'chuang4'),
  横: (c) => (has('蛮强专', c.prevChar) || has('财祸死', c.nextChar) ? 'heng4' : 'heng2'),
  磨: (c) => (has('坊盘', c.nextChar) || has('石推', c.prevChar) ? 'mo4' : 'mo2'),
  宿: (c) => (has('一二两半整', c.prevChar) ? 'xiu3' : has('列星二十八', c.prevChar) ? 'xiu4' : 'su4'), // 列宿 二十八宿 星宿: the constellations (xiù)
  // 鲜 is xiǎn "few" in the classics (巧言令色, 鲜矣仁; 鲜有 鲜能), xiān everywhere else.
  鲜: (c) => (has('矣不有能克少知', c.nextChar) ? 'xian3' : 'xian1'),
  // 么 closes a question after a word (他不咬人么？) as ma; inside 什么 怎么 这么 the dictionary word wins.
  么: (c) => (afterWord(c.prevChar) && !isHan(c.nextChar) ? 'ma5' : 'me5'),
  // 铺: pū "to spread" (铺着 铺设) unless it is the noun (店铺 床铺 当铺, a post station 十里铺, 铺子).
  // 缝 is féng "to sew" (密密缝, 缝衣, 缝补) after an adverb or a thing sewn, fèng "a seam, a crack" after the thing it splits.
  缝: (c) => (has('密细补针裁勤', c.prevChar) || has('衣补合纫', c.nextChar) ? 'feng2' : has('裂门窗墙地石骨牙一', c.prevChar) ? 'feng4' : undefined),
  铺: (c) => {
    if (has('着了设开平垫盖陈排好满', c.nextChar) && !has('店床当驿', c.prevChar)) return 'pu1';
    if (has('店床当驿', c.prevChar) || has('子', c.nextChar) || (c.orig === '舖' && c.nextChar !== '')) return 'pu4';
    if (has('里', c.prevChar) && !isHan(c.nextChar)) return 'pu4'; // 十里铺
    return 'pu1';
  },
  更: (c) => {
    // 三更 一更 打更 更鼓 更夫: a watch of the night (gēng); otherwise the adverb "even more" (gèng).
    if (has('一二三四五六七八九十两半每初', c.prevChar) && !has('比胜', c.nextChar)) return 'geng1';
    if (has('鼓夫次漏点声', c.nextChar) || has('打守更', c.prevChar)) return 'geng1';
    return 'geng4';
  },
  // 差 is chāi "to send" in the old novels (差人, 差我去, 差张飞为先锋, 当差, 公差), chà "lacking, poor" in 差得远 差不多 差一点 and
  // chā "difference" in 差别 差距 差错. Nothing tells the first from the others by itself, so the others are listed.
  差: (c) => {
    if (has('不点得远多些太极较', c.nextChar) || has('不太尚更还较最很真好', c.prevChar) || /^一[点步些口分毫寸]/.test(c.nextTok)) return 'cha4';
    if (has('别距异错价额池误值', c.nextChar)) return 'cha1';
    return 'chai1';
  },
  场: (c) => (c.prevChar === '一' && !has('电影戏球赛考试会议演出展面景', c.nextChar) ? 'chang2' : undefined),
  沈: (c) => {
    // 沈 is the old spelling of 沉 (沈吟 沈思 沈重 沈默); only as a surname (沈氏) is it Shěn.
    if (c.nextChar === '氏') return 'shen3';
    if (has('吟思重默醉痛迷浮没潜淀睡着溺落降', c.nextChar) || has('深昏消阴浮', c.prevChar)) return 'chen2';
    return isHan(c.prevChar) ? 'chen2' : 'shen3';
  },
  哄: (c) => {
    if (has('堂笑动然', c.nextChar)) return 'hong1';
    if (has('起闹', c.prevChar) && !has('哄', c.nextChar)) return 'hong4';
    if (has('骗弄我你他她人孩哄劝', c.nextChar) || has('欺赚诓', c.prevChar) || (c.prevChar === '么' && /怎么$/.test(c.prevTok))) return 'hong3';
    return 'hong1';
  },
  征: (c) => (c.orig === '徵' ? (has('宫商角', c.prevChar) || c.nextChar === '羽' ? 'zhi3' : 'zheng1') : undefined), // 徵 is a note of the scale only there; 魏徵 is Zhēng
  累: (c) => (has('卵次月积世计及赘', c.nextChar) || has('连', c.prevChar) ? 'lei3' : undefined), // 累卵 累次 (lěi); 累了 stays lèi
  藏: (c) => (has('地三西宝道', c.prevChar) ? 'zang4' : undefined), // 地藏王, 三藏, 西藏, 宝藏, 道藏
  斗: (c) => (has('星北南斗觔筋泰', c.prevChar) ? 'dou3' : undefined),
  帖: (c) => {
    // 帖 is tiě, an invitation or a notice (请帖, 简帖, 揭帖); tiē "docile" only in 服帖 妥帖; tiè a copybook (字帖 碑帖).
    if (has('服妥贴俯', c.prevChar)) return 'tie1';
    if (has('字碑法临', c.prevChar)) return 'tie4';
    return 'tie3';
  },
  解: (c) => (has('送差官犯粮解', c.nextChar) || has('押起发', c.prevChar) ? 'jie4' : undefined), // 押解 解送: to escort a prisoner (jiè)
  没: (c) => (has('辱淹埋吞覆沉父母', c.prevChar) ? 'mo4' : undefined), // 辱没 淹没, 父没观其行 (the father has died): mò
  恁: () => 'nen4', // 恁般 恁地 恁的: "such, so" in the novels
  咽: (c) => (has('呜哽', c.prevChar) || c.nextChar === '咽' ? 'ye4' : undefined), // 呜呜咽咽: sobbing
  什: (c) => (has('物锦襲袭', c.nextChar) ? 'shi2' : undefined),
  曾: (c) => (has('子参', c.nextChar) && !isHan(c.prevChar) ? 'zeng1' : undefined), // 曾子 (Zēng, the disciple), not céng "once"
  谯: () => 'qiao2', // 谯楼 (a gate tower), the surname Qiáo
  扎: (c) => (c.orig === '紮' && (has('寨营住下根针', c.nextChar) || has('住屯驻虚', c.prevChar)) ? 'zha1' : undefined), // 紮營 住紮; 紮辮子 stays zā
  克: (c) => (c.orig === '剋' ? (has('我你他咱', c.nextChar) && c.prevChar !== '相' ? 'kei1' : 'ke4') : undefined), // 剋: ke4 "to subdue" unless it scolds someone
  拼: (c) => (c.orig === '拚' ? 'pin1' : undefined), // 拚 is the old spelling of 拼 (拚命 拚死): pīn
  // Sentence-final particles are neutral after a word: 好啊 (a), 走啦 (la), 去罢 (ba), 在哩 (li).
  // A free-standing interjection (啊！ at the start of a clause) keeps its full tone.
  嗄: (c) => (afterWord(c.prevChar) && !isHan(c.nextChar) ? 'a5' : undefined), // 这是佛前海灯嗄: the particle a, not shà "hoarse"
  啊: (c) => (afterWord(c.prevChar) ? 'a5' : undefined),
  啦: () => 'la5',
  呀: (c) => (afterWord(c.prevChar) && !isHan(c.nextChar) ? 'ya5' : undefined),
  哇: (c) => (afterWord(c.prevChar) && !isHan(c.nextChar) ? 'wa5' : undefined),
  吧: (c) => (afterWord(c.prevChar) ? 'ba5' : undefined),
  // 罢 is "to stop" (作罢, 罢休, 罢工: dictionary words) or, at the end of a clause after a verb, the particle ba (去罢).
  罢: (c) => (afterWord(c.prevChar) && !isHan(c.nextChar) && !has('作休善甘已未', c.prevChar) ? 'ba5' : undefined),
  哩: (c) => (afterWord(c.prevChar) && !has('英海公', c.prevChar) ? 'li5' : undefined),
  // 喝 is hè "to shout" in 喝道 喝声 喝住 喝令 喝采 and after 大 (大喝一声); hē "to drink" otherwise.
  喝: (c) => (has('声道住令采彩止退骂', c.nextChar) || c.prevChar === '大' ? 'he4' : undefined),
  钯: (c) => (has('钉九', c.prevChar) || c.orig === '鈀' ? 'pa2' : undefined), // 钉钯 (the rake); 鈀 written in full is the rake of the novels, 钯 is the metal
  // 婀娜 袅娜 (nuó, graceful) is not the name Nà.
  娜: (c) => (has('婀袅嬝娉', c.prevChar) ? 'nuo2' : undefined),
  // 罢咧 我还抱你咧: the sentence-final particle lie; 咧嘴 (liě, to grin) keeps its tone before a word.
  咧: (c) => (afterWord(c.prevChar) && !isHan(c.nextChar) ? 'lie5' : undefined),
  // 挑 is tiǎo "to lift, to pick" after a weapon (枪挑) and before 开 起 拨 逗 战 衅 动 剔 灯 戏, tiāo "to carry on a pole, to choose" otherwise.
  挑: (c) => (has('枪刀剑', c.prevChar) || has('开起拨逗战衅动剔灯戏', c.nextChar) ? 'tiao3' : undefined),
  // 出则弟 孝弟 (the fraternal respect of the Analects) is tì, written 悌 now.
  弟: (c) => (has('孝则', c.prevChar) && !has('子兄', c.nextChar) ? 'ti4' : undefined),
  莎: (c) => (c.nextChar === '草' || has('枯香青', c.prevChar) ? 'suo1' : undefined), // 枯莎 莎草: sedge (suō); 莎士比亚 stays shā
  塞: (c) => (has('边要关出', c.prevChar) ? 'sai4' : undefined), // 边塞, 要塞: a frontier fort
  担: (c) => (has('挑货', c.prevChar) ? 'dan4' : undefined), // 挑担: a carrying pole's load
  // Erhua: 儿 after a Han character is the suffix r (花儿, 玩意儿) unless a dictionary word claims it.
  儿: (c) => {
    // In a transliteration (斡儿朵 Ordo, 篾儿乞 Merkit, 合撒儿 Qasar, 蒲儿帖) 儿 is a full syllable, ér.
    if (has('斡篾撒帖蒲脱忽', c.prevChar) || (isHan(c.nextChar) && has('斡篾撒帖蒲脱忽', c.prevTok.slice(-2, -1)))) return 'er2';
    return isHan(c.prevChar) ? 'r5' : 'er2';
  },
  // 子 as a noun suffix (桌子) is neutral; handled for words CEDICT lacks.
};

/** Rule-based reading for `ctx.ch`, or undefined when no rule applies (use the dictionary default). */
export function polyphoneReading(ctx: CharContext): string | undefined {
  const rule = RULES[ctx.ch];
  return rule ? rule(ctx) : undefined;
}

/** Characters that have an explicit rule (for tests and tooling). */
export const POLYPHONE_CHARS: readonly string[] = Object.keys(RULES);
