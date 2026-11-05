// Context rules for characters with several readings. Contract: ARCHITECTURE.md §4.1.
//
// These run only for characters that are read on their own (a one-character token) or inside a word that CC-CEDICT
// does not list. A word that CEDICT lists (了解, 着急, 银行, 首都 …) always gets its dictionary reading instead.
// Each rule sees the text on both sides and returns a numbered syllable, or undefined to keep the default
// reading. The rules are deliberately simple and explicit; tests/core/polyphone.test.ts pins every one.
import { DEPENDS, asksWithNa } from './bookStyle';
import { isHanCodePoint } from './text';
import type { LexiconEntry, OldSpellings } from '../types';

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
  /** The whole token after nextTok (when nextTok is a whole token), "" if none or unknown. */
  afterTok?: string;
  /** False when nothing was said about what follows (the caller had no neighbors), so an empty nextTok means "unknown". */
  nextKnown?: boolean;
  /** False when the character is inside a longer word (prevTok and nextTok are then the rest of that word: 背 in 背上). */
  alone?: boolean;
  /**
   * The token k places from this character's own (k < 0 before it, k > 0 after it), folded to simplified, "" past either end
   * of the paragraph. Only when the caller passed the paragraph's tokens and the character is a token by itself.
   */
  tok?: (k: number) => string;
  /**
   * How much of a verb a word is, from its dictionary senses: 2 when every sense says "to …" (提供, 撰稿, 带来), 1 when some do
   * (建设, 捐款, 集中), 0 otherwise or when the dictionary does not list it. Absent when the caller has no dictionary.
   */
  verb?: (w: string) => number;
  /** Whether the dictionary lists the word. Absent when the caller has no dictionary. */
  word?: (w: string) => boolean;
  /** Whether the dictionary makes the word a noun (a classifier note, a proper name). Absent when the caller has no dictionary. */
  noun?: (w: string) => boolean;
  /** The book's old spellings the reader follows (底 for 的, 那 for 哪: core/bookStyle.ts); absent when none. */
  spellings?: OldSpellings;
  /** The kind of a token that the book's names and terms hold (its lexicon), for a name the dictionary lacks; absent when none. */
  named?: (w: string) => LexiconEntry['kind'] | undefined;
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
/** Characters that spell foreign names (米|什|拉, 阿|什): a 什 between them is shí. */
const TRANSLIT_CHARS = '阿埃艾安奥巴贝比波布达德迪多尔法菲弗盖格哈汉赫基吉加杰卡凯柯科克库拉莱兰朗勒雷里利列林卢鲁伦罗洛马玛迈麦曼梅米密莫穆纳娜内尼诺欧帕佩皮普奇乔萨塞桑沙莎斯索塔特图托瓦威维温沃乌西希亚耶伊约泽扎兹苏';
/** Characters that spell foreign names beside TRANSLIT_CHARS, used for the 儿 that ends one (诺孜贝儿, 珀拉儿). */
const TRANSLIT_MORE = '诺孜珀琳丽妮娅莉蒂黛薇茜露朵兀贝';
/** Of those, the ones Chinese words hardly use: one of them must be in the name (布里儿, 哈巴儿, 巴巴儿 are erhua). */
const TRANSLIT_RARE = '诺孜珀琳妮娅莉蒂黛薇茜兀斯';

/** Common surnames that a segmenter leaves alone before a given name it does not know (金|强, 王|刚). */
const GIVEN_NAME_SURNAMES = '王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾萧田董袁潘蒋蔡杜叶程苏魏吕丁沈姚卢姜崔钟谭陆汪范金廖贾夏韦邹孟熊秦邱尹薛闫段雷侯龙陶黎贺顾毛郝龚邵钱严覃武戴莫孔汤';
/** prevTok is exactly one of these single characters (not a longer word that ends in one: 马上 is not 上). */
const prevIs = (c: CharContext, set: string): boolean => cpLen(c.prevTok) === 1 && has(set, c.prevTok);
/** nextTok is exactly one of these single characters. */
const nextIs = (c: CharContext, set: string): boolean => cpLen(c.nextTok) === 1 && has(set, c.nextTok);

/** The tokens after this one up to the end of its clause, at most `max` (the paragraph when the caller gave it, else next and after). */
function ahead(c: CharContext, max: number): string[] {
  const out: string[] = [];
  if (c.tok) {
    for (let k = 1; k <= max; k++) {
      const t = c.tok(k);
      if (!isHan(firstCodePointOf(t))) break;
      out.push(t);
    }
    return out;
  }
  if (!isHan(c.nextChar)) return out;
  out.push(c.nextTok);
  if (max > 1 && c.afterTok && isHan(firstCodePointOf(c.afterTok))) out.push(c.afterTok);
  return out;
}

/** The tokens before this one back to the start of its clause, nearest first, at most `max`. */
function behind(c: CharContext, max: number): string[] {
  const out: string[] = [];
  if (c.tok) {
    for (let k = 1; k <= max; k++) {
      const t = c.tok(-k);
      if (!isHan(lastCodePoint(t))) break;
      out.push(t);
    }
    return out;
  }
  if (isHan(c.prevChar)) out.push(c.prevTok);
  return out;
}

/**
 * Whether the characters right before this one spell a foreign name: two or more of them, each a transliteration character, at
 * least one of the commonest (拉 贝 尔 …), as the rest of a word (诺孜贝儿 read as one) or as one-character tokens (珀|拉|儿).
 */
function foreignBefore(c: CharContext): boolean {
  let run: string[];
  if (c.alone === false || cpLen(c.prevTok) >= 2) run = [...c.prevTok];
  else {
    run = [];
    for (let k = -1; k >= -6 && c.tok; k--) {
      const t = k === -1 ? c.prevTok : c.tok(k);
      if (cpLen(t) !== 1 || !isHan(t)) break;
      run.unshift(t);
    }
  }
  const ok = (ch: string) => has(TRANSLIT_CHARS + TRANSLIT_MORE, ch);
  // (毛毛儿, 巴巴儿: a doubled character is a pet name or an adverb.)
  return run.length >= 2 && run.every(ok) && run.some((ch) => has(TRANSLIT_RARE, ch)) && !run.some((ch, i) => i > 0 && ch === run[i - 1]);
}

/**
 * Whether the 那 at token offset `off` (0 for this character's own token, -1 for the one before it) asks which or where
 * (core/bookStyle.ts asksWithNa over the paragraph's tokens around it).
 */
function naAsks(c: CharContext, off = 0): boolean {
  if (!c.tok) return false;
  const back: string[] = [];
  for (let k = off - 1; k >= off - 14; k--) { const t = c.tok(k); if (t === '') break; back.unshift(t); }
  const fwd: string[] = [];
  for (let k = off + 1; k <= off + 18; k++) { const t = c.tok(k); if (t === '') break; fwd.push(t); }
  return asksWithNa([...back, '那', ...fwd], back.length, (w) => (c.verb?.(w) ?? 0) >= 1);
}

/** The word before this character is doubled: 慢慢, 湿淋淋, 呼|呼, 一闪|一闪 (the last two only when the caller gave the paragraph). */
function doubledBefore(c: CharContext): boolean {
  const p = [...c.prevTok];
  if (p.length >= 2 && p[p.length - 1] === p[p.length - 2] && isHan(p[p.length - 1])) return true;
  if (!c.tok || !isHan(c.prevChar)) return false;
  // 一遍|遍 (一遍遍地问): a doubled measure after 一.
  return c.tok(-2) === c.prevTok || c.tok(-2) === '一' + c.prevTok || (c.tok(-3) === c.prevTok && c.tok(-4) === c.tok(-2) && c.tok(-2) !== '');
}

/** Marks that open a quotation, a title or an aside, with the mark that closes it: read as one unit of a clause. */
const PAIRS: Readonly<Record<string, string>> = { '“': '”', '「': '」', '『': '』', '《': '》', '〈': '〉', '‘': '’', '（': '）', '(': ')' };
/** Punctuation that ends a clause (、 does not: a list goes on). */
const CLAUSE_STOP = /^[，,。．.；;：:！!？?…—）)\]】]/;

/**
 * The clause after this token as units, up to `max`: Han tokens, numbers and Latin words as they are, a quotation, a title or an
 * aside in brackets as one unit (its text with the marks). `end` is the punctuation that closed the clause, '' at the end of the
 * paragraph, undefined when it runs on past `max` units. Needs the paragraph's tokens.
 */
function clauseAfter(c: CharContext, max: number): { units: string[]; end: string | undefined } {
  const units: string[] = [];
  if (!c.tok) return { units, end: undefined };
  for (let k = 1; units.length < max; k++) {
    const t = c.tok(k);
    if (t === '') return { units, end: '' };
    if (CLAUSE_STOP.test(t)) return { units, end: t };
    if (/^\s+$/.test(t)) continue;
    const close = PAIRS[t];
    if (close) {
      let q = t;
      let j = k + 1;
      for (; j < k + 40; j++) {
        const u = c.tok(j);
        if (u === '') break;
        q += u;
        if (u === close) break;
      }
      units.push(q);
      k = j;
      continue;
    }
    units.push(t);
  }
  return { units, end: undefined };
}

/**
 * Whether units[k] is the verb of the clause: a word the dictionary gives only verb senses, or one with some verb sense that is
 * followed by 了 着 过 or ends the clause (为贫困儿童捐款。). Never right after 的 or 之 (平面的设计: the noun) nor before 的 式 性 …
 * (集中式, 设计的).
 */
function verbAt(c: CharContext, u: readonly string[], k: number, relative = false): boolean {
  let t = u[k] ?? '';
  // “据理力争”, “跑” (a verb in quotes is still the verb).
  const quoted = !!PAIRS[t[0]] && /^[“「『‘]/.test(t);
  if (quoted) t = t.slice(1, -1);
  if (!c.verb || !isHan(firstCodePointOf(t)) || /^(的|之|地|得|了|着|过|和|与|及|或|而|并|是|有|在|为|被|把|将|从|向|对|以|于)$/.test(t)) return false;
  if (/^(的|之)$/.test(u[k - 1] ?? '')) return false;
  const next = u[k + 1] ?? '';
  // (为新郎送行的亲友, 为客人准备的点心: with `relative`, a verb before 的 counts.)
  if ((!relative || next !== '的') && /^(的|之|式|型|性|者|类|化|率|法|界|上|中|下|里|内|外|时|后|前|间)$/.test(next)) return false;
  // A verb + its complement that the dictionary does not list (划出, 搬进, 写完) is a verb.
  const v = cpLen(t) === 2 && !(c.word?.(t) ?? true) && /[出入进来去上下起开走回过到住掉完好成]$/.test(t) && c.verb(firstCodePointOf(t)) >= 1 ? 2 : c.verb(t);
  // (留下两座纪念碑: a word with some verb sense before a number takes it as its object.)
  return v === 2 || (v === 1 && (quoted || k === u.length - 1 || /^(了|着|过)$/.test(next) || /^[一二两三四五六七八九十几百千万0-9０-９]/.test(next)
    || (relative && next === '的' && k >= 1)));
}

/** Words before X that 为 Y completes across a quotation, a number or a list: 以…为, 改…为, 称…为, 较…为. */
const TAKE_ACROSS = /^(以|改|升|称|视|列|评|辟|较|比较|相较)$/;

/**
 * The word that opens "take X as Y" (以 改 称 …) or the comparison 较, looked for back to the start of the clause past what
 * stopped the plain look-back: a quotation or title, a number, a Latin name or a 、 list. Undefined when nothing came between.
 */
function takenAcross(c: CharContext): string | undefined {
  if (!c.tok) return undefined;
  let crossed = false;
  let depth = 0;
  for (let k = 1; k <= 14; k++) {
    const t = c.tok(-k);
    if (t === '' || /^[，,。．；;：:！!？?]$/.test(t)) return undefined;
    // A quotation passed over whole; never out of one that holds the 为 (称“她为人类…”).
    if (/^[”」』》）)]$/.test(t)) depth++;
    if (/^[“「『《（(]$/.test(t) && --depth < 0) return undefined;
    if (!isHan(firstCodePointOf(t))) { crossed = true; continue; }
    if (k >= 2 && TAKE_ACROSS.test(t)) return crossed || k > 7 ? t : undefined;
  }
  return undefined;
}

/** Last characters of a word that names a thing, a place, a body or a kind (大学 假期 列车 杭州 工序 单位): a noun ends the clause. */
const NOUN_END = '人者家员物品区市省县府部局院校会型式性类种期节年月日门口线路车机器业界室楼馆所站场厂山河江湖海岛国州城镇村街级号位名题形状体量率度案书版报刊网台群队军团组社党族民系科段层座堂寺庙宫殿墓桥港湾林园田树花鸟兽鱼虫菌病药酒茶菜汤货币价税费权规制证卡码字词语诗曲歌戏剧片影画图像章标旗徽衣服鞋帽布纸笔石金银铁铜木油电期周岁';
/** Words before 为 that are about whom or why, not what something is (不为钱, 只为你, 专为…, 一起为客人做饭). */
const NOT_A_SUBJECT = /^(不|没|没有|并不|并非|只|仅|仅仅|就|也|还|又|正|专|专门|特|特地|特意|全|都|再|更|最|多|少|愿|愿意|肯|想|要|可以|能|能够|应|应该|应当|该|会|将|要么|才|而|一块|一起|一齐|一同|共同|如何|怎样|怎么|这样|那样|已经|曾|曾经|开始|继续|正在|在|来|去|去了|来了|地|据说|听说|同时)$/;

/**
 * Whether units[k] names a thing: a quotation, a title, a number, a Latin name, the head of a 的 phrase (平面的设计), a unit after a
 * number (200元), or a noun (a classifier in the dictionary, a proper name, a noun ending).
 */
function nounLike(c: CharContext, units: readonly string[], k: number): boolean {
  const u = units[k] ?? '';
  if (!u) return false;
  if (isHan(firstCodePointOf(u)) && (units[k - 1] === '的' || (k >= 1 && /^[0-9０-９]/.test(units[k - 1])))) return true;
  if (PAIRS[u[0]] || /^[0-9０-９A-Za-z%％]/.test(u)) return true;
  if (!isHan(firstCodePointOf(u))) return false;
  // (队长为王磊）: one of the book's names ends the clause.)
  if (c.noun?.(u) || /^(name|place|term)$/.test(c.named?.(u) ?? '')) return true;
  return cpLen(u) >= 2 && (c.word?.(u) ?? false) && (c.verb?.(u) ?? 0) === 0 && has(NOUN_END, lastCodePoint(u));
}

/**
 * 为 in modern writing (the book writes 为): + what it is done for + a verb is "for" (为大熊猫提供, 为维基新闻撰稿, 为社会造成了不便,
 * 为朋友的离去而落泪: wèi); "to be, as" (wéi) when a noun phrase with no verb in it ends the clause and either a verb of naming or
 * judging comes right before (宣布为, 诊断为“感冒”, 聘为顾问) or a thing is what it says (原型为一座石桥, 学院为一流大学, 参考为《…》,
 * 评语为：). Undefined when neither shows: a person or a name before it, an adjective ending the clause (为朋友高兴), a verb right after it.
 */
function modernWei(c: CharContext): 'wei2' | 'wei4' | undefined {
  if (!c.tok || !c.verb) return undefined;
  const { units, end } = clauseAfter(c, 14);
  const p = c.tok(-1);
  const pv = isHan(c.prevChar) ? c.verb(p) : 0;
  // What comes right before: a verb of naming or judging (宣布为, 诊断为), or a noun that is the subject (原型为, 中秋节（秋夕）为,
  // CR200J为); not a pronoun, an adverb of "for", or a name the dictionary does not know (王小林为…). A place or a term of the book
  // counts as a word (钱唐郡为杭州); a person does not.
  const verbBefore = pv >= 1 && cpLen(p) >= 2 && !NOT_A_SUBJECT.test(p);
  const known = (w: string): boolean => (c.word?.(w) ?? false) || /^(place|term)$/.test(c.named?.(w) ?? '');
  const subject = p !== '' && (verbBefore
    || (isHan(c.prevChar) && pv === 0 && !NOT_A_SUBJECT.test(p) && !/^(我|你|他|她|它|您|咱|自己|大家|别人|人家|人们)/.test(p) && !/们$/.test(p)
      && (known(p) || cpLen(p) === 1) && !(c.word && cpLen(p) >= 2 && !known(p)))
    || /[A-Za-z0-9０-９）)”」』》]$/.test(p));
  // 颁奖词为： what follows the colon is what it is.
  if (!units.length) return end !== undefined && /^[：:]/.test(end) && subject && !verbBefore ? 'wei2' : undefined;
  if (/^(的|了|着|之|所|此|其|这|那|谁|何|什么|甚么|人|我|你|他|她|它|您|咱|自己|大家|别人|人家)/.test(units[0])) return undefined;
  // 为…而 (for the sake of), 为…的事 (because of the matter of): wèi.
  if (units.includes('而') || (units.length >= 3 && units[units.length - 2] === '的' && /^(事|事情|缘故|原故|原因)$/.test(units[units.length - 1]))) return 'wei4';
  // A verb after the noun phrase it is done for (为新郎送行的亲友 too).
  // (为纪念…的寿诞: a verb right after it, even one with other senses, is what is done.)
  if (verbAt(c, units, 0) || (c.verb(units[0]) >= 1 && units.length >= 2 && units[1] !== '的')) return undefined;
  const first = units.findIndex((_, k) => k >= 1 && (verbAt(c, units, k, true) || (cpLen(units[k]) === 1 && (c.verb?.(units[k]) ?? 0) >= 1
    && isHan(firstCodePointOf(units[k + 1] ?? '')) && !/^(的|之|和|与|及|或|是|有|在|为|上|中|下|里|内|外)$/.test(units[k]) && !/^(的|之)$/.test(units[k - 1]))));
  if (first >= 1) return 'wei4';
  if (end === undefined || !nounLike(c, units, units.length - 1)) return undefined;
  if (subject) return 'wei2';
  // Opening a clause after a comma, only a whole statement (遗址，为通州区文物保护单位。).
  return /^[，,]$/.test(p) && /^[。；;]?$/.test(end) ? 'wei2' : undefined;
}

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
  尽数: 'jin4 shu4', // all of them (盡數); 儘數 jǐnshù is a Taiwan spelling
  片子: 'pian1 zi5', // a film, an X-ray (piànzi "a flake" is rarer)
  卷子: 'juan4 zi5', // an exam paper
  憎恶: 'zeng1 wu4', // to loathe (zēng'è "to hate evil" is rare)
  差使: 'chai1 shi5', 差事: 'chai1 shi5', 公差: 'gong1 chai1', // an errand, a post
  铺盖: 'pu1 gai5',
  行头: 'xing2 tou5', // an outfit, a costume (hángtóu, the head of a guild, is archaic)
  麦场: 'mai4 chang2', // a threshing floor (cháng, as 晒场 场院); CEDICT also lists mai4 chang3
  长脸: 'chang2 lian3', // a long face (book-words.tsv); CEDICT's zhǎngliǎn "to bring credit to" is rarer in the books
  当天: 'dang4 tian1', // that same day (当天下午, 当天回来); the sun "in the sky" of the old books (红日当天) is cut in segment.ts
  蒙元: 'meng3 yuan2', // the Mongol Yuan (Wiktionary lists Méng too); 蒙 beside 汉 藏 元 is Měng (the 蒙 rule)
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
  盡: 'jin4', // 盡 is only jìn; 尽 (盡 and 儘 merged) is decided by the 尽 rule and WORD_READINGS
  怔: 'zheng4', // 发怔, 怔了 (dazed); zhēng only in the word 怔忡
};

/** A rule's own default, given when none of its cases matched: the reading model may speak there (core/readingModel.ts). */
class Usual {
  constructor(readonly reading: string) {}
}
const usual = (reading: string): Usual => new Usual(reading);

type Rule = (c: CharContext) => string | Usual | undefined;

/** Words before 得 "must" (děi): 还得, 也得, 就得, 须得. */
const MODAL_BEFORE_DEI: readonly string[] = ['还', '也', '就', '都', '须', '总', '必', '非', '一定', '准', '也就', '还是', '到底'];
/** Words before 得了 + something got (dé): 又得了银子, 忽然得了急病. */
const DE2_AFTER: readonly string[] = ['又', '竟', '却', '便', '刚', '已', '已经', '曾', '曾经', '忽然', '突然', '终于', '后来', '因此', '从此', '偶然', '偶而', '新', '先后'];
/** Last characters of a verb of naming, making or turning that 为 (wéi) follows: 称为 化为 选为 封为 号为 约为 折为. */
const BECOME_PREV = '认作成视称当行被定分改变设列选译化叫归算命劈解拜封立任奉誉误看号名尊呼谥册约折砍剁融编划升降荐愧谋翻评辟赞';
/** Whole words before 为 (wéi): 分别为 表现为 提拔为. */
const BECOME_WORDS: readonly string[] = ['分别', '表现', '体现', '归结', '总结', '调整', '提拔', '提升', '命名', '保举', '推举', '推选', '选举', '任命', '合并', '集结', '凝结', '缩减', '精简', '折合', '换算',
  '分裂', '确认', '确定', '认定', '划分', '分成', '演变', '发展', '转变', '变成', '不愧', '无愧', '显示', '描述', '定义', '记作',
  // Changed, judged or described as (变更为, 归纳为, 定性为, 改制为, 形容为, 成长为).
  '定性', '归纳', '变更', '更改', '更名', '公布', '改制', '改组', '改编', '改建', '扩建', '升格', '定调', '定位', '恢复', '形容', '成长', '化身',
  '检举', '评定', '认证', '指定', '规定', '判定', '鉴定', '界定', '简化', '还原', '翻译', '音译', '意译', '缩写', '简写', '读作', '统一'];
/** What is measured before 为 + a number (价格为每斤三块钱, 速度为每小时六十公里, 最早为三天以后, 仅为两千个座位): wéi. */
const QUANTITY_BEFORE = /(时间|频率|密度|速度|光速|距离|周期|深度|大小|强度|长度|高度|宽度|面积|体积|重量|温度|压力|气压|数量|人数|总数|比例|概率|效率|半径|直径|年龄|价格|产量|总量|规模|时长|间隔|期限|容量|功率|速率|质量|口径|最早|最晚|最多|最少|仅|约|共|总共|均|平均|只|达|大约|至少|最高|最低|分别|时速|车速|风速|航速|转速|射程|里程|海拔|全长|总长|体长|肩高|身高|胸围|体重|周长|人口|票价|售价|收入|产值|得分|票数|比分|可能性|比率|增长率|税率|利率|汇率|分数|总分|满分|名次|寿命|费|额|价|值|率)$/;
/** Words that open "take X as Y" before the X: 以乳为目, 拜我为王, 封你为侯, 娶她为妻. */
const TAKE_AS: readonly string[] = ['以', '拜', '封', '立', '收', '选', '贬', '迎', '称', '尊', '号', '命', '任', '认', '视', '推', '奉', '册', '授', '聘', '娶', '纳', '招', '养', '引', '提拔', '保举', '敕封', '册封', '加封', '尊称', '推举', '选举', '任命', '提升', '收养', '称呼', '过继',
  // Verbs of naming or taking as, in two characters (面称他为, 误认X为Y, 追尊X为, 推让我为尊).
  '面称', '自称', '改称', '通称', '统称', '俗称', '误认', '错认', '公认', '追尊', '追封', '推让'];
/** What 为 (wéi) serves as: an office, a rank, a role, or the frame nouns of 以…为 (以…为基础, 为荣, 为念). */
const WEI2_BEFORE: readonly string[] = [
  '先锋', '前部', '后部', '前驱', '后应', '内应', '外应', '向导', '参谋', '参军', '军师', '谋士', '盟主', '从事', '尚书', '司徒', '司空', '太尉',
  '丞相', '都督', '太子', '世子', '天子', '皇后', '太后', '中军', '左翼', '右翼', '合后', '主帅', '元帅', '先行', '副将', '大将', '将军', '大将军',
  '上将', '偏将', '牙将', '部将', '太守', '刺史', '县令', '将', '帅', '相', '王', '帝', '后', '侯', '臣', '妃', '婿', '媒', '质', '号', '僧', '徒',
  '师', '上', '上策', '下策', '奴', '友', '伴', '基础', '中心', '背景', '标志', '一体', '单位', '前提', '核心', '重点', '宗旨', '目标', '依据',
  '代价', '己任', '荣', '耻', '乐', '生', '念', '辅', '佳', '妙', '宜', '然', '患', '后患', '祸', '害', '凭', '信', '界', '最', '多', '少', '大',
  '高', '低', '主体', '参照', '参照系', '轴心', '原料', '圆心', '敌', '仇', '伍', '邻', '难', '戒', '上宾', '上着', '上计',
];
/** The one served after 為 in the old books (为君, 为大圣): "for" when what is done for them follows (吾为君赦之). */
const FOR_PERSON: readonly string[] = ['君', '君父', '君主', '大圣', '大夫', '主公', '明公', '陛下', '大王', '兄长', '贤弟', '师父', '友', '朋友', '汝', '公', '将军',
  '丞相', '大哥', '哥哥', '兄弟', '贤侄', '老兄', '宝玉', '天下', '百姓', '朝廷', '国家', '社稷', '苍生'];
/** Offices that close a 为 clause (为军前参谋, 为荆南刺史, 为巡盐御史): wéi. */
const OFFICE_LAST = /^(参谋|刺史|御史|太守|都督|县令|知府|知县|通判|提辖|教头|都头|统制|总管|先锋|元帅|将军|丞相|太尉|尚书|侍郎|主簿|司马|长史|校尉|军师|帅府|上宾|头领)$/;
/** A role or a rank that ends a 为 clause (原为沙国王, 为梁山泊主, 今为汉中王): what someone is, so wéi. */
const ROLE_LAST = /(王|主|官|帅|吏|使|令|丞|侯|公|卿|相|长|将|臣|君|帝|后|妃|婿|妻|妾|师|徒|僧|奴|仆|客|宾|友|伴)$/;
/**
 * What is done for someone after 為 + the one it is done for (为母报雠, 为刘备画策, 为曹氏作说客, 为宝玉耽忧, 为姨母辩, 实非为夫人计):
 * wèi. Matched as a whole token one to three tokens after 为, never after a 之 or before one (为后日衣食之计, 为自谋之计 make a plan:
 * wéi); 计 only after the one it is for (为夫人计, not 此为上计), 作 做 only before what is written or acted (为本初作檄, not 金作马).
 */
const FOR_DEED = /^(报雠|报仇|复仇|报怨|雪恨|雪耻|谋|画策|设谋|献策|献书|献密书|出力|效力|效死|尽忠|尽力|尽心|分忧|解忧|出气|求情|说情|求婚|作主|做主|担忧|担心|耽忧|伤心|伤感|感伤|流涕|落泪|下泪|垂泪|哭|哀泣|泪涟|叹息|游说|作说客|作保|作檄|招魂|设祭|辩|择配|充役|医|请|请来|死|计|作|做|操心|祝寿|拜寿|引见|通报|转奏|传奏|引奏|明示|助力|除害|带来|提供|创造|服务)$/;
/** What one writes or acts as for someone after 为 X 作 (为本初作檄, 为曹氏作说客, 为曹植作答教, 为赌贼作榜样). */
const DONE_AS = /^(说客|檄|檄文|保|主|媒|伐|答|序|传|记|书|诗|文|榜样|证|见证|东|东道|主张)/;
/** What starts a cause after 為 in the old novels (为见他是个好汉, 为有服色, 为事逃在…, 为惜他一个人, 为与贼人结连): "because of", wèi. */
const CAUSE_NEXT = /^(见|有|无|事|惜|知|与|缺少|缺|不曾|未曾|不能|不得|不肯|没有|替|给)$/;
/** One-character words of WEI2_BEFORE that are as often the start of what is done "for" (为多留一天, 为大家): wéi only when the clause ends. */
const WEI2_ONLY_AT_END = '多少大高低最上生乐信凭佳妙宜然';
/** First characters after 为 that make it "for" (wèi): a pronoun, 了 着, 之 (为之一振). */
const FOR_NEXT_CHARS = '我你您他她它咱此之这那了着著汝吾尔';
/** Whole words after 为 that make it "for" (为国 为民 为大家 为别人); 为大将 is not one (a whole token is compared). */
const FOR_NEXT_WORDS: readonly string[] = ['国', '国家', '民', '人民', '朋友', '众', '众人', '百姓', '大家', '求', '救', '报', '寻', '保', '杀', '取', '好', '别人', '别的', '因', '自己', '利', '名利', '功名', '众官', '众位'];
/** Paragraph tokens of the vernacular (的 著 呢 …): a paragraph with two kinds of them is not the classical register. */
const VERNACULAR = new Set(['的', '着', '著', '呢', '么', '们', '这', '那', '咱', '俺', '哩', '吗', '罢']);
/** A number written in characters or digits. */
const isNumberTok = (t: string): boolean => /^[零〇一二三四五六七八九十百千万亿两半]+$/.test(t) || /^\d/.test(t);
/** A measure or a unit after a number (为二十秒, 约为八十平方米). */
const UNIT = /^(个|位|公里|千米|米|年|秒|分|分钟|小时|天|日|月|岁|度|次|倍|层|段|截|块|元|斤|尺|寸|里|丈|平方|公斤|吨|级|等|份|部分|万|亿|千|百|十|光年|摄氏度|%)/;
/** A time or a length before 长 (cháng): 时间长得很, 日子长了, 路长. */
const LENGTHS = /(时间|日子|夜|路|道路|沙漠|队伍|岁月|距离|寿命|时光|白昼|黑夜|过程|彗尾|尾巴|绳子|线|句子|话|一生|夏天|冬天|等待|战线|时刻|时辰|工夫)$/;
/** What grows after 长 (zhǎng): 长庄稼, 长肉, 长记性, 长起来, 长这么大. */
const GROWN = /^(庄稼|麦子|粮食|艾|肉|眼睛|记性|脑子|身体|个子|牙|疮|苔|藓|芽|翅膀|起来|这么|那么)/;
/** Characters before a 子 that is a real word (zǐ): 之子 其子 君子 孔子 弟子 天子 生子 字子敬, 长春子 丹阳子 (Daoist names), 西子. */
const ZI_FULL_AFTER = '之其此彼与无有多少吾汝尔君臣天太世公王孔孟庄老曾荀韩墨列孙管晏朱程父母妻女男孝逆贼浪游才弟童庶嫡长次幼独爱养义继嗣诸众学夫士仙佛龙凤人圣贤赤稚遗孤皇质妃生得产育教娶嫁杀弑传害字号名表原电粒分离光因量春阳宁西屈妖荡元'
  // a son after a verb (遣子入侍, 携子, 丧子之仇, 觅子寻爷, 荫子封妻, 训子, 救子), a rank (伯子男, 一等子), the humble 贱子 and 帝子 举子,
  // Daoist and pen names (长真子, 凌虚子, 潇湘子, 南柯子, 参廖子, 草木子), seeds (柏子, 桂子, 芥子) and Japanese names (玲子, 惠子, 贞子)
  + '遣送令唤救抱夺赦怜责训助觅荫携丧辱举贱帝余伯真虚湘柯廖玄木柏桂芥玲惠贞纪于乃近';
/** Second characters of courtesy names in 子 (子龙 子丹 子敬 子瑜): the 子 before them is zǐ. */
const COURTESY = '龙丹春敬瑜翼布明建远义衡仲孝廉文源桓经良胥贡路夏游渊旷婴兰牙伯扬璜猷昂宁亮期房羽';
/** Verbs after which 罢， is "having finished" (bà): 说罢 拜罢 斋罢 吃罢 吟罢 听罢. */
const FINISHED = '说拜斋茶饭吃喝言看听读吟唱哭笑礼毕写歌舞宴洗叙问道战斗打杀骂祝祭奏讲念诵想叹议酒梳咐浴鼓见';
/** Words before a verb + 罢 that make it a request (快说罢 再说罢 你们吃罢 听我说罢): the particle ba, not "having finished". */
const IMPERATIVE: readonly string[] = ['快', '再', '且', '别', '请', '你', '你们', '您', '咱们', '咱', '我', '随便', '只管', '还是', '好歹', '索性', '不如', '先', '实', '给我', '和你', '跟你', '休'];
/** What 教 teaches (jiāo): 教物理 教武功 教学生 教唱. */
const TAUGHT = /^(物理|语文|数学|化学|英语|外语|历史|地理|音乐|美术|体育|武功|功夫|拳|拳脚|剑法|本事|学生|小学|中学|大学|初中|高中|唱|写字|识字|读书|念书|小说)/;
/** Words before 教 "to teach": 我来教你 不肯教我 手把手教孩子 开始教. */
const TEACHER_BEFORE: readonly string[] = ['来', '肯', '不肯', '开始', '专门', '亲自', '负责', '手把手', '继续', '愿意'];
/**
 * A skill or a subject taught after 教 + the one taught (教他武功, 教你两手剑法, 教她轻功, 教我一个办法): jiāo. A book's own
 * term for a technique (飞燕剑法, 寒江掌法) ends in one of `SKILL_END`.
 */
const SKILL = /^(武功|功夫|武艺|本事|本领|拳法|掌法|剑法|枪法|棒法|刀法|鞭法|箭法|轻功|内功|外功|点穴|招数|招式|绝技|绝招|高招|法门|要诀|诀窍|口诀|心法|诀|手艺|技艺|学问|英文|英语|外语|中文|汉语|日语|法语|德语|俄语|数学|物理|化学|语文|算术|书法|医术|功课|计策|主意|法子|办法|乖|诗|曲|歌)$/;
const SKILL_END = /..(法|掌|拳|剑|功|诀|经)$/;
/** What one is taught to do right after 教 + the one taught (教他识字, 教孩子们唱, 教人下棋): jiāo. */
const SKILL_VERB = /^(学|练|念|读|唱|画|游|骑|弹|绣|织|算|识字|认字|写字|背诵|射箭|打坐|换气|驯马|做诗|作诗|开车|排戏|下棋|做人|做论|使用|游泳|跳舞|唱歌|吹箫|针灸)/;
/** Words between 教 + the one taught and what is taught: 这 一手, 一套, 三 天, 这个, 诸般, 一些. */
const SKILL_FILLER = /^([这那几一二两三四五六七八九十百些]|这个|那个|这些|那些|这门|这手|一手|一套|一招|一路|一些|几手|几招|诸般|许多|很多|不少|好多|全部|所有|别的|上乘|高深|上|个|套|门|路|手|招|点|天|日|年|遍|种|样|首|的|之)$/;
/**
 * 应 yìng "to answer, to respond, to be fulfilled" where "should" cannot fit: at the end of a clause (叫他不应, 首尾皆应, 为外应),
 * before 之 (以兵应之), 弦 (应弦落马), what is fulfilled (正应其谶, 果应其言, 应在今夜), an exam (应过武举), a word given (应口, 应准)
 * and the one answered at the end of a clause (不应他。, 你敢应我么).
 */
function answered(c: CharContext): boolean {
  if (!isHan(c.prevChar) && !c.tok) return false;
  // At the end of a clause: nothing "should" follows (帝不敢应。, 叫了几声不应, 击首则尾应).
  // (结为外应矣, 你敢应么？: a final particle still ends the clause.)
  const end = (t: string): boolean => /^[，。！？；：、…」』”]/.test(t || '。');
  if (c.nextKnown !== false && isHan(c.prevChar) && !/^(理|本|该|自|亦|也)$/.test(c.prevTok)
    && (end(c.nextTok) || (c.tok && /^(矣|么|吗|也)$/.test(c.nextTok) && end(c.tok(2))))) return true;
  if (nextIs(c, '之弦诏口准劫梦号差候佛') || ['一句', '一声', '几个', '个景', '个', '起来', '过', '时', '需', '物', '武举', '科举', '谣言'].includes(c.nextTok)) return true;
  // 正应其谶, 果应其言, 果然应在他身上 (bears out what was foretold).
  if (prevIs(c, '正果') || ['果然', '正是'].includes(c.prevTok)) return true;
  // 应在孙坚, 应在今夜, 应在本人身上 (it falls on): a short clause after 在.
  // Only after a word that marks the fulfilment or at the start of a clause: 俱应在庙伴宿 and 这花儿应在三月里开的 are "should".
  if (c.tok && nextIs(c, '在') && (!isHan(c.prevChar) || /^(当|盖|竟|便|正|果|也|亦|必|是)$/.test(c.prevTok))) {
    const rest = ahead(c, 5).slice(1);
    return rest.length >= 1 && rest.length <= 2 && !/[开来去走做]$/.test(rest[rest.length - 1]);
  }
  // 上应天星, 上应列宿 (answers to the stars above).
  if (prevIs(c, '上') && /^(天星|天书|星|罡|列|图|三十六|星曜|天|星魁)/.test(c.nextTok)) return true;
  // 不应他。 你敢应我么？ 我就应他； (to answer someone).
  if (!c.tok || !/^(我|你|他|她|您)$/.test(c.nextTok)) return false;
  const then = c.tok(2);
  return then === '' || !isHan(firstCodePointOf(then)) || /^(么|吗|呢|的|一声)$/.test(then);
}
/** Verbs and prepositions between 把 X and 当 that leave 当 to mean "serve as, at, in front of" (把他送到县里当兵, 把绵衣服叫人当了,
 * 把武松押至当厅, 把饭与外面当直的): not "to treat as". */
const BA_DANG_VERBS = /^(到|去|来|送|派|叫|让|请|选|留|安排|调|提拔|推|拉|带|找|送到|派到|调到|分配|打发|使|教|拿去|在|至|于|搁|放|摆|挂|插|押|搬|抬|扛|关|锁|藏|扔|丢|与|给|搁在|放在|插在|押至)$/;
/** What one does with something taken as something else (当扇子扇, 当锤子用, 当客人对待, 当神仙来崇拜). */
const TREATED_VERB = /^(用|使用|看待|对待|崇拜|扇|爬|吃|养|来养|供奉|送给|使唤|敬畏|戏谑)$/;
/**
 * 当 dàng "to treat as, to take for, to pawn": 把她当亲人, 把这事当回事, 从没当回事, 可当锤子用, 当了三百银子, 拿来当果子, 去当吧.
 * "When" (当他推开门时), "should" (亦当恩养), "in front of" (当著我) and "to serve as" (到县报当记者, 把组长当得好) stay dāng.
 */
function treatedAs(c: CharContext): boolean {
  // 这破袍子去当吧 (go and pawn it).
  if (nextIs(c, '吧罢') && c.prevTok === '去') return true;
  // 上了他的当 (was taken in): the 当 a trick is, at the end of its clause.
  if (c.tok && c.prevTok === '的' && !isHan(c.nextChar) && behind(c, 6).some((t) => t === '上' || t === '上了')) return true;
  // 把这些话当“命令” (taken for, in quotes).
  if (c.tok && /^[“「『]/.test(c.nextTok) && behind(c, 6).includes('把')) return true;
  if (!c.tok || !isHan(c.nextChar) || nextIs(c, '住得过着著在时中面场即初前叫让给派请厅门口')) return false;
  const after = ahead(c, 12);
  // 当了几吊钱, 当了三百银子: pawned.
  if (c.nextTok === '了') return after.slice(1, 4).some((t) => /(钱|银子|银|两|吊)$/.test(t));
  // "When" ends its clause with 时 or 的时候 (当她走进教室的时候).
  if (after.some((t) => /^(时|时候|之时|以后|之后|后|那天|那年|的时候)$/.test(t))) return false;
  if (c.nextTok === '一回事' || (c.nextTok === '一' && c.afterTok === '回事') || c.nextTok === '回事') return true;
  // 把X当Y: 把 (not 一把, a handful) within the clause, with no verb that makes 当 "serve as" between.
  const before = behind(c, 6);
  const ba = before.indexOf('把');
  if (ba >= 0 && !/^[一两几这那]$/.test(c.tok(-ba - 2)) && before[0] !== '个' && !before.slice(0, ba).some((t) => BA_DANG_VERBS.test(t))) return true;
  // 当扇子扇, 当山坡爬, 当锤子用, 当神仙来崇拜: a thing taken as something and used so. Not "when" or "should" at the start of a
  // clause or after an adverb (当他用…, 亦当恩养, 又当就此用计, ，当依命拜奉).
  const used = (cpLen(c.nextTok) >= 2 && TREATED_VERB.test(after[1] ?? '')) || (after[1] === '来' && TREATED_VERB.test(after[2] ?? ''));
  if (used && isHan(c.prevChar) && (cpLen(c.prevTok) >= 2 || /^(可|能|来)$/.test(c.prevTok)) && !/^(应该|应当|理应|也许|或许|必须|正好|恰好)$/.test(c.prevTok)
    && !PRONOUNS.includes(c.nextChar) && !/们$/.test(c.nextTok)) return true;
  // 当亲生儿子看待 (treated as, opening a clause): 看待 对待 崇拜 never follow "when".
  if (after.slice(1, 3).some((t) => /^(看待|对待|崇拜|使唤|敬畏)$/.test(t)) && !PRONOUNS.includes(c.nextChar) && !/们$/.test(c.nextTok)) return true;
  // 拿来当果子, 拿出来当扁担, 吃个儿当点心罢: taken and used as.
  return (/^(拿来|拿着|取出来|拿出来|取来|拿|取出|个儿)$/.test(c.prevTok) || (c.prevTok === '来' && /^(取出|拿出|拿|取|搬出|掏出)$/.test(c.tok(-2))))
    && after.length <= 2;
}
/** Whether the clause from token k on ends in a question or an exclamation mark (the paragraph's tokens must be known). */
function clauseAsks(c: CharContext, k: number): boolean {
  if (!c.tok) return false;
  for (let i = k; i < k + 30; i++) {
    const t = c.tok(i);
    if (t === '') return false;
    if (!isHan(firstCodePointOf(t))) return /^[？！?!]/.test(t);
  }
  return false;
}
/** 教 + the one taught (one or two tokens: 他, 你们, 郭靖, 娃娃们, 人) followed by a skill, a subject or a number of lessons. */
function taughtSkill(c: CharContext): boolean {
  if (!c.tok) return false;
  const toks = ahead(c, 8);
  // Not a learner: an adverb or a word that starts what is let happen (命教再唱, 教将红旗一招).
  if (!toks.length || /^(再|又|也|就|便|都|还|先|不|没|只|才|却|且|来|去|将|把|他们来)$/.test(toks[0])) return false;
  const pronoun = /^(我|你|他|她|它|您|我们|你们|他们|她们|咱们|咱|自己)$/.test(toks[0]);
  // The one taught: a pronoun, or one or two short words (a name, 娃娃 们, 穷人家 娃娃).
  for (let n = 1; n <= 2 && n < toks.length; n++) {
    if (n === 2 && !/^(们|家|的)$|^[\u4e00-\u9fff]{2,3}$/.test(toks[1])) break;
    let k = n;
    while (k < toks.length && SKILL_FILLER.test(toks[k])) k++;
    const t = toks[k] ?? '';
    // What is taught after the filler; not when it is then lost (教我功夫尽废: let me lose).
    if ((SKILL.test(t) || (k > n && SKILL_END.test(t) && cpLen(t) >= 3)) && !/^[全尽都]?[失废毁丧]/.test((toks[k + 1] ?? '') + (toks[k + 2] ?? ''))) return true;
    // What one is taught to do, right after the one taught: one character only after a pronoun or a plural (教孩子们唱), and
    // never a deed done (教石勇骑了马: let him ride). 做 诗 is read as 做诗.
    const verb = cpLen(t) === 1 ? t + (toks[k + 1] ?? '') : t;
    // (也教孩儿们学些好: let them pick up good ways, jiào.)
    if (k === n && SKILL_VERB.test(verb) && (cpLen(t) >= 2 || pronoun || /们$/.test(toks[n - 1]) || /^(做诗|作诗)/.test(verb))
      && !/^(了|着|著|过)$/.test(toks[k + 1] ?? '') && !(t === '学' && /^(些|好|乖|坏)/.test(toks[k + 1] ?? ''))) return true;
    // A number of lessons that ends the clause (教你三天, 明天再教你几招罢).
    if (pronoun && k > n && /^[一二两三四五六七八九十几]$/.test(toks[n]) && /^(招|手|套|遍|天|年)$/.test(toks[k - 1])
      && (k === toks.length || /^(罢|吧|不可|如何)$/.test(toks[k]))) return true;
  }
  return false;
}
/** Money named a few tokens on, past quotation marks but not past the end of the clause (赚他的“工资”). */
function moneyPastQuotes(c: CharContext): boolean {
  if (!c.tok) return false;
  for (let k = 1; k <= 6; k++) {
    const t = c.tok(k);
    if (/钱|工资|银|薪/.test(t)) return true;
    if (t === '' || (!isHan(firstCodePointOf(t)) && !/^[“”「」『』‘’]+$/.test(t))) return false;
  }
  return false;
}
/** What comes in rolls after a number + 卷 (一卷铺盖, 两卷纸, 一卷钞票): juǎn, the roll. */
const ROLLED = /^(纸|布|铺盖|被褥|被子|席|草席|凉席|毯子|地毯|行李|绳|绳子|线|毛线|钢丝|铁丝|电线|绷带|胶带|胶布|胶片|胶卷|磁带|录像带|卫生纸|手纸|钞票|票子|烟叶|帘子|竹帘|地图|报纸|稿纸|布料|棉布|丝绸|绸缎|绸子|皮尺|稻草|麦秸|干草|头发|葱|饼|铺|毡|皮|草)/;

/** What 场 counts as chǎng: a game, a show, a meeting, an exam, a ceremony, a campaign. */
const EVENT = /(比赛|赛事|球赛|决赛|半决赛|复赛|预赛|联赛|对决|点球大战|球|电影|戏|演出|表演|演唱会|音乐会|晚会|舞会|派对|会议|大会|研讨会|座谈会|发布会|讨论会|联欢会|见面会|报告会|运动会|讲座|展览|展|考试|辩论|辩论赛|仪式|典礼|婚礼|葬礼|宴会|酒会|游戏|拳赛|运动|活动|选举|竞赛|竞选|工作坊|论坛|峰会|发布会)$/;
/** Weather, an illness, a dream or a misfortune: what 一场 counts as cháng (一场大雨, 一场病). */
const SPELL = /(雨|雪|病|梦|灾|难|火|风波|官司|仗|战|架|哭|笑|空|误会|虚惊|噩梦|大病|灾难|浩劫|悲剧|闹剧|骗局|恶斗|厮杀|搏斗|较量|纠纷|风暴|洪水|地震|瘟疫|疫情|危机)$/;

/**
 * Whether what 一场 counts, the head of the noun phrase after it within its clause, is an event (一场足球比赛, 一场以“…”为题
 * 举办的创意工作坊): read up to the first word that is one, unless weather or a misfortune comes first.
 */
function eventAhead(c: CharContext): boolean {
  const { units } = clauseAfter(c, 14);
  for (const u of units) {
    if (SPELL.test(u)) return false;
    if (EVENT.test(u)) return true;
  }
  return false;
}

/** What is carried on the back after 背 (bēi): 背书包 背石头 背柴. */
const CARRIED = /^(书包|包袱|包裹|行李|背包|旅行包|柴|粮食|石头|米|面|枪|马枪|孩子|麦捆|床板|铺盖|篓|背篓|筐|口袋|麻袋|煤|炭|伤员|子弹|炸药|弟弟|妹妹|娘|爹|父亲|母亲|老人|病人)/;
/** What one gets (dé) after 得了: an illness, a prize, money, the upper hand. */
const GOT = /(病|症|伤|疮|奖|钱|银子|胜利|好处|便宜|甜头|消息|机会|头功|宝物|手|势|一场)$/;
/** An illness or a prize right after 得 (得绝症, 得肺病, 得头奖): what is got. */
const GOT_NOUN = /^.?.?(病|症|疮|奖)$/;
/** Verbs of getting before 得 + how much (筹得30万美元, 录得超过200毫米, 募得三千元): dé, "obtained". */
const OBTAIN = '筹录募获赚挣攒积购夺赢';
/** Adverbs before 得了 + a count (一共得了五分, 只得了三票): dé, "got". */
const TALLY = /^(一共|共|总共|总计|合计|共计|累计|只|仅|仅仅|刚|刚刚|各|分别|均|最终|最后|总算)$/;
/** Words of ought, wanting or never before 得 + what is got (该得什么罪, 想得一点好兆头, 何曾得一个闲): dé. */
const OUGHT_TO_GET = /^(该|应|应该|应当|理应|当|会|要|想|想要|可|可以|能|能够|何曾|不曾|未曾|曾|曾经)$/;
/** What is got: a punishment, an illness, a prize, points, money, a share (该得什么罪, 得极重的热病). */
const GOT_LAST = /^.{0,2}(罪|病|症|疮|奖|分|钱|赏|报应|好处|便宜|甜头)$/;
/** Verbs that 地 after them makes "the place where" (移居地, 栖息地, 出生地): dì. */
const PLACE_OF = /^(移居|迁居|聚居|定居|居住|栖息|发源|出生|诞生|埋葬|安葬|登陆|降落|停泊|集散|避难|避暑|度假|疗养|驻扎|隐居|流放|发祥|繁殖|越冬|产卵|原产|出产|殖民|始发|落脚|藏身|安身|容身|立足|葬身|迁入|迁出|移入|来源)$/;

/**
 * Words of manner that 地 follows as the particle even before a comma (分明地，坚决地，沉静地说; 她冷静地，; 偶然地，): the place
 * nouns, crops and poetry that end a clause in 地 (玉米地， 此地， 清静地， 灵秀地，) are not among them.
 */
const MANNER = /^(偶然|突然|忽然|猛然|骤然|陡然|默然|冷静|平静|沉静|安静|镇静|镇定|沉默|坚决|坚定|分明|诧异|惊讶|惊奇|惊异|疑惑|犹豫|小心|仔细|认真|虔诚|小声|大声|低声|高声|不时|时时|渐渐|悄悄|偷偷|狠狠|紧紧|深深|远远|痛快|愉快|欢快|兴奋|激动|温和|温柔|柔和|亲切|热情|冷淡|淡淡|冷冷|慢慢|快快|轻轻|默默|静静|缓缓|匆匆|急急|微微|暗暗|隐隐|稍稍|老老实实|恭恭敬敬|无声|无言|迅速|飞快|缓慢|艰难|费力|吃力|拼命|努力|用力|使劲|尽力|自然|本能|下意识|机械|茫然|木然|漠然|淡然|坦然|欣然|毅然|断然|果断|决然|悍然|愤然|怅然|黯然|凄然|惘然|恍然|颓然|骄傲|得意|满意|满足|幸福|甜蜜|痛苦|悲哀|悲伤|伤心|绝望|无奈|无力|疲倦|懒懒|呆呆|傻傻|怯怯|羞涩|害羞|腼腆)$/;

/** What is attained after 也得 还得 就得 in the old books (也得耳根清净, 还得相逢, 就得成佛): "to get to", dé. */
const ATTAINED = /^(成佛|成仙|成道|作祖|正果|长生|相逢|重逢|团圆|见佛|回生|超生|托生|好处|好死|善终|全尸|清净|耳根|伏侍|侍奉|充饥|留名|永住|安生|安身|安稳|自在|快活|一梦|升天|生天)/;
/** Title marks: what follows 著 there is the name of a work (not 「 or “, which open what is said: 只等著「填五魁」). */
const TITLE_OPEN = '《〈';

/**
 * Whether a book's 著 is zhù "to write" (the author's credit), which the simplified page keeps as 著, not the particle: 的著者 (the
 * author), 著有《…》 (wrote), 王先生著《…》, 所著《…》, 人各著剧, 自己著的, 著之竹帛, and a byline that ends its line after a credit
 * (作者：李某著, 张三　著) or a clause that names the publisher (某研究院著，某出版社).
 */
function authorZhu(c: CharContext): boolean {
  // (著者 after a verb is the one who got it: 拈著者便去, 装著者行孙.)
  if (nextIs(c, '者') && (!isHan(c.prevChar) || /^(的|及|和|与|其|原|本书|该书)$/.test(c.prevTok))) return true;
  if (nextIs(c, '有') && has(TITLE_OPEN, c.afterChar ?? '')) return true;
  if (has(TITLE_OPEN, c.nextChar) && (/^(先生|所|合|编|原|新|自|氏|教授|博士)$/.test(c.prevTok) || (c.prevChar !== '' && !isHan(c.prevChar)))) return true;
  if (prevIs(c, '所') && (has(TITLE_OPEN, c.nextChar) || (c.nextKnown !== false && !isHan(c.nextChar)) || /^(书|之书|诗|文)$/.test(c.nextTok))) return true;
  if (prevIs(c, '各') && /^(剧|书|诗|文|论|述)/.test(c.nextTok)) return true;
  if (c.prevTok === '自己' && nextIs(c, '的')) return true;
  if (nextIs(c, '之') && /^(竹帛|竹|简|书|篇)/.test(c.afterTok ?? '')) return true;
  if (!c.tok || isHan(c.nextChar)) return false;
  // A credit line: 著 ends the paragraph after a space or in a line that says 作者; or the clause after it names the publisher.
  if (c.tok(1) === '') {
    if (c.prevChar !== '' && !isHan(c.prevChar)) return true;
    for (let k = -1; k >= -8 && c.tok(k) !== ''; k--) if (c.tok(k) === '作者') return true;
  }
  for (let k = 2; k <= 8 && c.tok(k) !== ''; k++) if (/出版/.test(c.tok(k))) return true;
  return false;
}

/** A paragraph of the old vernacular (的 著 呢 … two kinds of them around this token), not the classical register. */
function inVernacular(c: CharContext): boolean {
  if (!c.tok) return false;
  const kinds = new Set<string>();
  for (let k = -40; k <= 40 && kinds.size < 2; k++) { const t = c.tok(k); if (VERNACULAR.has(t)) kinds.add(t); }
  return kinds.size >= 2;
}

const RULES: Record<string, Rule> = {
  // Particles. 了 is liǎo after 不 / after 得 at the end of a clause (吃不了, 受得了); le everywhere else.
  了: (c) => {
    if (c.prevChar === '不') return 'liao3';
    // 求了断。 管教他了帐 个了局 (to settle, cut apart from the words 了断 了帐 了局); 只剩了断墙 认了帐 stay le.
    if (c.alone !== false && ((nextIs(c, '断') && !isHan(c.afterChar ?? '')) || (nextIs(c, '帐账') && has(PRONOUNS, c.prevChar)) || (nextIs(c, '局') && has('个这那', c.prevChar)))) return 'liao3';
    // 就算了大事, 就算了事 (counts as having settled it, the 算了 that segment.ts cuts there): liǎo.
    if (prevIs(c, '算') && (nextIs(c, '事') || /^(大事|此事|心事|心愿|一桩|一件)$/.test(c.nextTok))) return 'liao3';
    if (c.prevChar === '得' && !isHan(c.nextChar)) {
      // 动弹不得了 is 动弹不得 + 了 (the 得 belongs to 不得); 吃得了, 受不得了 end the clause with liǎo.
      // 晓得了, 觉得了 (a verb that ends in 得) is the verb + le: 我晓得了.
      return /不得$|(晓|觉|记|懂|认|显|值|免|省|使|落|怪|舍|晓|巴|由|只|且|须|取|获|赢|博|心|懂|懂)得$/.test(c.prevTok) ? 'le5' : 'liao3';
    }
    return 'le5';
  },
  的: () => 'de5',
  着: (c) => {
    // 睡不着, 睡不着觉, 见不着 (a verb + 不 + 着, whatever follows it).
    if (c.prevChar === '不' && (!isHan(c.nextChar) || nextIs(c, '觉了') || (prevIs(c, '不') && c.tok !== undefined && /^[见找睡摸够碰买寻挨沾靠用管吃喝]$/.test(c.tok(-2))))) return 'zhao2';
    // 没伤着, 别吓着, 别累着, 怕碰着, 别踩着 (a harm feared or avoided after 没 别 怕 不能 …), 找着 + what + 了 (found): zháo.
    if (prevIs(c, '伤吓累碰踩烫冻找摸撞淋') && c.tok !== undefined && (behind(c, 5).slice(1).some((t) => /^(别|没|没有|不|不能|不要|怕|不小心|当心|千万别|可别|免得|以免|生怕|别再)$/.test(t))
      || (prevIs(c, '找') && isHan(c.nextChar) && c.tok(2) === '了'))) return 'zhao2';
    // 睡着了 找着了 (the whole word before it: 燃烧着 追赶着 are -ing).
    // 摸着 碰着 撞着 at the end of a clause are as often -ing (在抽屉里摸着): zháo only before 了 没 不 就 there.
    // 还睡着, 正睡着 (still asleep, the 睡着 that segment.ts cuts there) is -ing: zhe.
    if (prevIs(c, '睡') && c.tok !== undefined && /^(还|還|正|仍|却|卻|仍然|还在|正在)$/.test(c.tok(-2))) return 'zhe5';
    if ((prevIs(c, '睡找猜够冻买见寻') && !isHan(c.nextChar)) || (prevIs(c, '睡找猜碰摸够撞冻烧买赶见寻') && has('了没不就', c.nextChar))) return 'zhao2';
    if (prevIs(c, '一') && !isHan(c.nextChar)) return 'zhao1'; // 这一着 (a move)
    // 着了慌, 着慌 (to get flustered): zháo; 不著月日 (not dated: to write) is zhù.
    if (nextIs(c, '慌') || (nextIs(c, '了') && /^(慌|急|凉|迷)/.test(c.afterTok ?? ''))) return 'zhao2';
    if (c.orig === '著' && prevIs(c, '不') && /^(月日|月|年月|姓名|名|撰人)/.test(c.nextTok)) return 'zhu4';
    if (c.orig === '著' && authorZhu(c)) return 'zhu4';
    const end = c.nextKnown !== false && !isHan(c.nextChar);
    // The old novels' 撞著 遇著 碰著 (ran into, came upon: 正撞著张飞, 若有人来撞著): the result, zháo.
    if (c.orig === '著' && prevIs(c, '撞遇碰')) return 'zhao2';
    // 一齐烧著。 亦不能烧著。 (caught fire, at the end of a clause in the old novels); 把衣角烧着， 被烧着的老树, 别让孩子碰着。
    // (set on fire, touched: the result after 把 被 让 叫 能): zháo. 炉火烧着， (burning) stays zhe.
    if (prevIs(c, '烧碰摸撞') && (end || c.nextTok === '的')
      && (c.orig === '著' || behind(c, 6).slice(1).some((t) => /^(把|被|让|叫|能|不能|别|没|未)$/.test(t)))) return 'zhao2';
    // 车仗尽著， (all caught fire).
    if (prevIs(c, '尽') && end && c.orig === '著') return 'zhao2';
    return 'zhe5';
  },
  // 得: děi after a pronoun or an adverb ("must": 我得去, 还得上班), de after a verb (跑得快). dé stays in words (得到, 取得).
  得: (c) => {
    // 那得让他, 那得看情况, 那得多少钱 opening a clause (that takes, it depends on): děi. Where the book writes 那 for 哪, 那得 that asks
    // how there could be (那得功夫来看？, 那得回与你。) is dé.
    if (c.prevTok === '那' && c.tok !== undefined && !isHan(lastCodePoint(c.tok(-2))) && isHan(c.nextChar) && !nextIs(c, '了')) {
      if (c.spellings?.na && !c.spellings.naAsWritten && naAsks(c, -1)) return 'de2';
      if (DEPENDS.test(c.nextTok) || /^(多少|多久|多长|几|一|两|三|四|五|六|七|八|九|十|百|千|万)/.test(c.nextTok)) return 'dei3';
    }
    // 必得重赏, 必得此城 (will surely win: what is won ends the clause): dé; 必得跟她讲清楚, 必得是她 (must): děi.
    // 必得是凤姐儿, 必得快办, 必得早些去, 必得送命 (must): děi before 是 or what must be done soon.
    if (c.prevTok === '必' && isHan(c.nextChar)) return /^(是|快|早|先|亲|另|再|要|去|来|送命|死|速|立刻|马上|赶紧|赶快|即刻|跟|和|与|同|叫|让|请|使|等|依|照|按|用|拿|把|将)/.test(c.nextTok)
      || (c.tok !== undefined && ahead(c, 4).length > 2) ? 'dei3' : 'de2';
    // 心里安得下, 你怎么安得住: a potential complement after 安 (de), not the classical 安得 "how could one get".
    if (c.prevTok === '安' && nextIs(c, '下住稳上')) return 'de5';
    // 还得上班 也得讲理 就得马上走 须得 (must) before what must be done; 也得了工钱 还得不到 就得病走了 还得法 也得个死罪
    // 得自一位大师 (got) before 了 到 不 个, an illness, 法 or 自.
    // In the old books 也得 还得 就得 + what is attained is "to get, to get to" (dé): 也得耳根清净, 还得相逢, 就得成佛, 也得好处去,
    // 也得早晚伏侍.
    if (MODAL_BEFORE_DEI.includes(c.prevTok) && isHan(c.nextChar)) {
      return has('了到着之个病', c.nextChar) || nextIs(c, '过不法自') || /^(些|一些|十分|正果|瓜)/.test(c.nextTok) || GOT_NOUN.test(c.nextTok)
        || ATTAINED.test(c.nextTok) ? 'de2' : 'dei3';
    }
    // 又得 is "must again" before a deed (又得割草, 又得从头, 又得去收拾) and "got again" before what is got (又得一员良将,
    // 又得名师传授, 又得相见): děi, dé.
    if (c.prevTok === '又' && isHan(c.nextChar) && c.nextTok !== '了') {
      // (又得十二三年: it takes another twelve years.)
      return /^(去|来|回|上|下|出|进|打|割|叫|等|靠|象|像|换|从头|重新|再|赶|跑|走|做|干|忙|收拾|洗|补|买|卖|找|请|求|跟|陪|熬|挨|忍|花|拿|搬|扛|挑|背|不停|费|操心|担心|准备|应付|伺候|照顾|动手|开始|重|从)/.test(c.nextTok)
        || (/^[一二两三四五六七八九十几半]+/.test(c.nextTok) && ahead(c, 3).some((t) => /^(个月|年|月|天|日|夜|载)/.test(t) || /[年月天日]$/.test(t)))
        // 又得两个丫头伺候 (needs people to wait on it): děi.
        || (/^[一二两三四五六七八九十几半]/.test(c.nextTok) && ahead(c, 5).some((t) => /^(侍候|伺候|服侍|照顾|照看|帮忙|帮手|看守|守着|抬|扛)$/.test(t))) ? 'dei3' : 'de2';
    }
    // 做人得 + a deed, 她俩得 + a deed, 一说得说 (must; the same verb again after 得): děi.
    if (isHan(c.nextChar) && (/^(做人|俩|我俩|你俩|他俩|她俩|咱俩)$/.test(c.prevTok) || (cpLen(c.prevTok) === 1 && c.nextTok === c.prevTok && c.tok !== undefined && c.tok(-2) === '一'))) return 'dei3';
    // 得了 + an illness a few words on (得了 … 的病, 得了那场 病): dé.
    // (治得了这病, 受得了: the potential de after a verb.)
    if (c.nextTok === '了' && c.tok !== undefined && !/(治|医|看|救|受|吃|忍|管|顾|晓|觉|记|懂|认|显|值|免|省|使|舍|获|赢|博|不)$/.test(c.prevTok)
      && ahead(c, 8).some((t) => /^.{0,3}(病|症)$/.test(t))) return 'de2';
    // 让我得读这部书, 使他得见故人, 不许我得一遭儿: "to get to" (dé) after a causative or a permission and the one who gets to.
    if (has(PRONOUNS, c.prevChar) && c.tok && /^(让|教|叫|使|令|许|不许|准|不准|容|不容)$/.test(c.tok(-2)) && isHan(c.nextChar)) return 'de2';
    // 制他得住, 拖它得动 (can hold him, can move it): the old potential complement; 想你得要命 (a degree): de.
    if (has(PRONOUNS, c.prevChar) && ((nextIs(c, '住动上下过起完出进开透') && !isHan(c.afterChar ?? '') && c.afterTok !== undefined)
      || /^(要命|要死|厉害|不得了|发慌|发抖|难受|紧)$/.test(c.nextTok))) return 'de5';
    // 得叫他去, 得让她明白, 得今天去: děi ("must") before a causative or a time, when nothing precedes it in the clause.
    // 百姓，得再见天日 (got to see the light of day again): dé.
    if (nextIs(c, '再') && /^(见天日|重见天日|见天)/.test(c.afterTok ?? '')) return 'de2';
    // (得有天然热情的, 得有人去: "must have" opening a clause of the vernacular.)
    if (!isHan(c.prevChar)) return has('叫让给去', c.nextChar) || /^(今天|明天|马上|赶快|赶紧|立刻|自己|先|再|快)$/.test(c.nextTok) || (/^有/.test(c.nextTok) && inVernacular(c)) ? 'dei3' : 'de2';
    if (c.prevChar === '事' && has('叫让给', c.nextChar)) return 'dei3'; // 这事得叫他去
    // 若得绵竹 幸得 安得不败 岂得 未得 让以得之: the verb "to get, to manage to" of the classics (dé).
    // (多幸得, 且休得: the same after a word that ends in 幸 or 休.)
    // 暂得保存, 始得, 遂得, 何遽得考, 并得依法任命 (and may): "to get to, may" after an adverb (dé).
    if ((prevIs(c, '若幸安岂焉未既欲方休以') || (cpLen(c.prevTok) === 2 && has('幸休', lastCodePoint(c.prevTok)))) && isHan(c.nextChar)) return 'de2';
    // (催并得紧, 搞得头昏脑涨: how hard; 皆得在, 皆得归: must.)
    if (prevIs(c, '暂始遂乃犹竟均皆俱亦仅遽何') && isHan(c.nextChar) && !nextIs(c, '很太好真多不紧慌急快慢狠凶早晚远近大小高低')
      && !(prevIs(c, '均皆俱') && /^(在|归)/.test(c.nextTok))) return 'de2';
    if (prevIs(c, '并') && /^(依法|依照|按照|另行|酌情|视情)/.test(c.nextTok)) return 'de2';
    // 筹得30万美元, 录得超过200毫米 (obtained so much): dé.
    if (prevIs(c, OBTAIN) && (isNumberTok(c.nextTok) || /^[０-９]/.test(c.nextTok) || /^(约|超过|逾|近|达|共|总共|将近|多达|高达)$/.test(c.nextTok))) return 'de2';
    // 一共得了五分, 只得了三票: dé.
    if (c.nextTok === '了' && TALLY.test(c.prevTok) && (isNumberTok(c.afterTok ?? '') || /^[０-９]/.test(c.afterTok ?? ''))) return 'de2';
    // 该得什么罪, 何曾得一个闲, 想得一点好兆头: what is got after a word of ought, wanting or never. (想得一点不差 is how well.)
    if (c.tok && OUGHT_TO_GET.test(c.prevTok) && isHan(c.nextChar)) {
      const got = ahead(c, 4);
      if ((got.length >= 2 && GOT_LAST.test(got[got.length - 1]) && !got.slice(0, -1).some((t) => (c.verb?.(t) ?? 0) === 2))
        || (/^(一点|一个|一些|一份|一笔|一回|个|些|几个)$/.test(got[0]) && got.length >= 2 && !/^(也|都|不|没|儿|点)/.test(got[1]))) return 'de2';
    }
    // 露沙得极重的热病， (got an illness that ends the clause, after someone): dé.
    if (c.tok && c.verb && c.verb(c.prevTok) === 0 && cpLen(c.prevTok) >= 2 && isHan(c.nextChar) && !nextIs(c, '很太好真多不')) {
      const got = ahead(c, 5);
      if (got.length >= 2 && got.length < 5 && /^.{0,2}(病|症|疮|奖)$/.test(got[got.length - 1]) && !got.slice(0, -1).some((t) => (c.verb?.(t) ?? 0) === 2)) return 'de2';
    }
    // 他得了病, 忽然得了急病, 又得了银子: "to get" before 了 and what was got, or after an adverb of time. 下得了手 歇得了手 (can bring
    // oneself to) is the potential de after a verb.
    // (那贼得了手, 众贼得了手: got the upper hand, dé.)
    if (c.nextTok === '了' && ((GOT.test(c.afterTok ?? '') && !(c.afterTok === '手' && /^[下歇住停罢收动]$/.test(c.prevTok))) || DE2_AFTER.includes(c.prevTok))) return 'de2';
    // 他得了性命, 你得之甚易: the verb "to get" (dé) after a pronoun, not "must".
    if (has(PRONOUNS, c.prevChar) && has('了过之到著着', c.nextChar)) return 'de2';
    if (!has(PRONOUNS, c.prevChar) && (has('令胜罪知意', c.nextChar) || c.nextTok === '蒙' || /^蒙(恩|允|赐|救|收)/.test(c.nextTok)) && isHan(c.prevChar)) return 'de2'; // 得令 得胜 得罪 得知 得蒙: dé
    // 他应当得匹好马, 也想得个好名: "to get" a counted thing after a word of wanting or ought.
    if (/^(应当|应该|理应|可以|能|能够|想|想要|要|便|才|方)$/.test(c.prevTok) && has('个座块匹间头只张些', c.nextChar)) return 'de2';
    // 我得去 你得马上走 我们得承认 (must) after a pronoun; 我得何罪 他得病 你得手 我得重病那年 他得个好名 (got) before what is got.
    if (has(PRONOUNS, c.prevChar) && isHan(c.nextChar) && !has('很不太多更最', c.nextChar)) {
      return has('何罪病道手空闲奖胜意知的势宠逞益利钱见遇个便新脱命异', c.nextChar) || GOT_NOUN.test(c.nextTok) ? 'de2' : 'dei3';
    }
    return 'de5';
  },
  // 地: de after an adverb (慢慢地, 高兴地: two or more characters), dì otherwise (土地 is a word; 在地上).
  地: (c) => {
    if (c.prevChar === '的') return 'di4';
    // “嘿嘿”地笑: the particle after a quoted sound.
    if (has('”’', c.prevChar)) return isHan(c.nextChar) && c.nextChar !== '藏' ? 'de5' : 'di4';
    if (!isHan(c.prevChar)) return 'di4';
    // 怎地 恁地 (zěn dì), 何地 如何地 (where), 天诛地灭; 无可奈何地 is the particle.
    if (has('怎恁这那诛', c.prevChar) || (c.prevChar === '何' && cpLen(c.prevTok) <= 2)) return 'di4';
    // 唤做地涌夫人, 叫做地藏 (a name that opens with 地 after a verb of naming): dì.
    if (/^(唤做|唤作|叫做|叫作|称作|称做|号为|名为|名叫)$/.test(c.prevTok)) return 'di4';
    // After a doubled word (慢慢, 黑洞洞, 呼|呼, 一闪|一闪) it is the particle, even at the end of a clause (急急地，).
    if (doubledBefore(c) && !has('天人家年', c.prevChar)) return 'de5';
    // The particle goes in front of a verb or an adjective, so a 地 that closes its clause is the noun (名利无双地, 福地),
    // except after 一样 一般 or a four-character idiom (丁香一样地， 不由自主地，).
    // (很高兴地，: an adjective after 很 非常 … takes the particle at the end of a clause too.)
    // (分明地，坚决地，沉静地说; 诧异地，: an adjective of manner before a comma, in a series of them, is the particle too; not a
    // verb or a crop: 移居地， 芦苇地，.)
    if (c.nextKnown !== false && !isHan(c.nextChar)) return /[样般]$/.test(c.prevTok) || cpLen(c.prevTok) === 4
      || (c.tok !== undefined && cpLen(c.prevTok) === 2 && /^(很|非常|十分|太|挺|真|那么|这么|多么|异常|格外)$/.test(c.tok(-2)))
      || (/^[，,）)]/.test(c.nextTok) && MANNER.test(c.prevTok)) ? 'de5' : 'di4';
    // 猛地 忽地 蓦地 倏地 霍地 陡地 突地 are adverbs read dì (CEDICT: 猛地 měngdì), not the particle de.
    if (has('猛忽蓦倏霍陡突', c.prevChar)) return 'di4';
    // A lone 上 下 里 界 … after 地 is the place (在地上 cut as 地|上, 地|界); a longer word (地|点点头, 地|上马) is not.
    // 微笑地|点|了点头, 哗哗地|下|着: 点 下 上 before 了 着 起 are the verb, so 地 is the particle (not after 在 到 从: 在地|上|了).
    const verbAfter = ((nextIs(c, '点下上') && /^(了|着|起|来|去|头)/.test(c.afterTok ?? '')) || /^(点|下|上)(了|着|起)$/.test(c.nextTok)) && !has('在到从往于满遍落', c.prevChar);
    const notNoun = verbAfter || (!nextIs(c, '上下里中外内面边方区图理球震形板点址界亩土煞仙狱府位势陷畔埂垄') && !/^[上下里中外内面边方底][上下里面边间头前后]$/.test(c.nextTok));
    // 高粱地 玉米地 (a field) is the noun even before a verb.
    if (/(高粱|玉米|棉花|庄稼|麦|稻|谷|菜|瓜|豆|荒|田)$/.test(c.prevTok) && !doubledBefore(c)) return 'di4';
    // 移居地, 栖息地, 出生地 (the place where it is done) when the dictionary lacks the word.
    if (PLACE_OF.test(c.prevTok)) return 'di4';
    // 钻进地下去, 埋进地里: going into the ground (深入地了解 is the particle).
    if (/[入进]$/.test(c.prevTok) && c.prevTok !== '深入' && /^[下里底面上]/.test(c.nextTok)) return 'di4';
    // 挨着地, 贴着地 (touching the ground): dì.
    if (/^(挨着|贴着|靠着|碰着|沾着|擦着|挨|贴|沾)$/.test(c.prevTok)) return 'di4';
    if (cpLen(c.prevTok) >= 2 && notNoun) return 'de5';
    // A one-character adverb before a verb: 更多地了解, 快快, 狠狠 are covered above; these are the common single ones (and 般地),
    // and the sounds 轰地 嗖地 哗地 哄地 (轰地烧起来, 哄地 一笑), 满头是汗 地 (sweating all over).
    if (has('多少快慢早晚紧轻深静狠猛真远近般样轰嗖哗砰咚噗嘭嗡刷唰吱哧嘶叮哄汗', c.prevChar) && isHan(c.nextChar) && notNoun) return 'de5';
    // 出奇地一致, 出了奇地 (strikingly); 天奇地灵 stays the earth.
    if (prevIs(c, '奇') && c.tok !== undefined && /(出|了)$/.test(c.tok(-2)) && isHan(c.nextChar)) return 'de5';
    // An idiom the cut left in pieces (出乎|意|表 地 访我): the particle.
    if (c.tok !== undefined && c.word && notNoun && isHan(c.nextChar) && cpLen(c.prevTok) <= 2) {
      const s4 = [...(c.tok(-3) + c.tok(-2) + c.prevTok)].slice(-4).join('');
      if (cpLen(s4) === 4 && cpLen(c.prevTok) < 4 && c.word(s4) && !/[天地山海]/.test(s4.slice(-1))) return 'de5';
    }
    // A phrase cut into single characters before a verb of speaking or moving: 轻声细语 地 说, 头也不回 地 走: de.
    // (往艾地走, 趁黑地跑了, 号天哭地: a place after 往 朝 向 趁 …, or the earth of an idiom.)
    // (心如火焚 地 走: the phrase may be cut 心|如火|焚.)
    if (c.tok !== undefined && cpLen(c.prevTok) === 1 && cpLen(c.tok(-2)) <= 2 && isHan(c.tok(-2)) && !has('满遍各一落在到下上种耕扫拖铺平荒田草坟陆大土天实整平艾', c.prevChar)
      && !has('往朝向到去进在从回趁于至天山海身', c.tok(-2))
      && /^(对|说|说道|走|走过来|走过去|跑|跑过来|笑|笑道|喊|叫|望|望着|看着|问|问道|答|答道|点头|摇头|朝|向|盯着|瞪着)$/.test(c.nextTok)) return 'de5';
    // After a four-character phrase cut into pieces: 又跳又叫地, 一东一西地, 笨手笨脚地 (AXAY), 千次万次地, 一瞬不瞬地 (XAYA).
    if (notNoun && isHan(c.nextChar)) {
      const s = [...behind(c, 4).reverse().join('')].slice(-4);
      // 哭天哭地, 一身一地, 灰天灰地: 地 ends the idiom, the earth.
      if (s.length >= 3 && s[s.length - 1] === s[s.length - 3] && '天身山海'.includes(s[s.length - 2])) return 'di4';
      if (s.length === 4 && ((s[0] === s[2] && s[1] !== s[3] && s[0] !== s[1]) || (s[1] === s[3] && s[0] !== s[2] && s[0] !== s[1] && s[2] !== '一') || (s[0] === '有' && s[2] === '无'))) return 'de5';
    }
    return 'di4';
  },
  还: (c) => {
    if (c.prevChar === '而' && !isHan(c.nextChar)) return 'huan2'; // 不克而还: came back
    if (!isHan(c.prevChar) && has('我你他', c.nextChar)) return 'huan2'; // 还我人来! 还你个功到: "give back", starting the clause
    // 还阳 往还 回还 (the whole word before it: 往往还 is "still").
    if (has('阳', c.nextChar) || (prevIs(c, '往回复返') && !has('还', c.nextChar))) return 'huan2';
    // 他还回来: "still came back" after a pronoun; 还回去 after a verb or by itself is "give back".
    // 还|回过头来 (still turned round): hái.
    if (c.nextChar === '回' && (has(PRONOUNS, c.prevChar) || /^回(过|头)/.test(c.nextTok) || (nextIs(c, '回') && /^(过|头)/.test(c.afterTok ?? '')))) return 'hai2';
    // 还了酒钱, 我已经还了。: the adverb never stands right before 了, so this is "give back"; 还了得 (how dreadful) is hái.
    if (c.nextTok === '了') return c.afterChar === '得' ? 'hai2' : 'huan2';
    // 借了不还。 引军北还。 天道好还 再还吧: a 还 that ends its clause after another word is the verb. Without neighbors, keep hái.
    if (c.nextKnown !== false && (!isHan(c.nextChar) || nextIs(c, '吧罢')) && isHan(c.prevChar)) return 'huan2';
    // 快还我袈裟, 不还我, 送钱还你, 送来还我, 寻还你袈裟: giving back to someone after 不 快 来 去 再 要, a verb of fetching or
    // what is owed; 快拿出来还我。: giving back when the clause ends on the one who gets it.
    if (has('我你他她您', c.nextChar) && (prevIs(c, '不快来去再要寻算磕找拿送讨交退偿') || has('钱银账债', c.prevChar) || /^[送拿牵带取借抬搬寄][来去]$/.test(c.prevTok)
      || (cpLen(c.nextTok) === 1 && !isHan(c.afterChar ?? '') && c.afterTok !== undefined))) return 'huan2';
    // 还你个人财无恙, 还他一个铁面无私 (give someone back a …): huán.
    if (has('我你他她您', c.nextChar) && cpLen(c.nextTok) === 1 && /^(个|一个)$/.test(c.afterTok ?? '')) return 'huan2';
    // 还过了礼, 还下礼去, 还了个礼 (return a bow): huán.
    if (c.tok !== undefined) {
      for (let k = 1; k <= 3; k++) {
        const t = c.tok(k);
        if (/^礼/.test(t)) return 'huan2';
        if (!/^(过|了|下|个|了个|一|一个)$/.test(t)) break;
      }
    }
    // 总得还人家钱, 还他钱: a debt or money a few words on.
    if ((PRONOUNS.includes(c.nextChar) || c.nextTok === '人家') && c.alone !== false && ahead(c, 3).some((t) => /[债账钱]$/.test(t))) return 'huan2';
    // 钱要是还不上, 还不起, 还得清: whether one can repay.
    if (/^(不上|不起|不清|得上|得起|得清|清)$/.test(c.nextTok) && !isHan(c.afterChar ?? '') && c.afterTok !== undefined) return 'huan2';
    // 还京 还乡 还寨 还营 还朝: going back to a place.
    if (nextIs(c, '京乡家寨营朝国郡城府宫山庄蜀吴魏')) return 'huan2';
    return has('书钱给回债款账原本愿手价礼俗乡魂', c.nextChar) ? 'huan2' : 'hai2';
  },
  // 都 is dū "capital" in 首都 京都 古都 许都 东都 (the whole word before it: 尸首都推 is "all") and in the titles 都头 都监 都统 都尉.
  都: (c) => (prevIs(c, '首京古故旧陪帝许') || ['东', '西', '中'].includes(c.prevTok) && !isHan(c.nextChar) || nextIs(c, '头监统尉') || c.nextChar === '亭' ? 'du1' : 'dou1'),
  行: (c) => (has('银同排各商内外米数两几', c.prevChar) || has('业列当家话情字', c.nextChar) ? 'hang2' : 'xing2'),
  长: (c) => {
    // 越长越大, 越长越像他 (grows): zhǎng; 日子越长越难熬 (the longer) stays cháng.
    if (prevIs(c, '越') && c.nextTok === '越' && /^(大|高|壮|胖|粗|多|快|漂亮|好看|像|象|美|俊|结实|茂盛|旺|肥|长|俊俏|水灵|标致)/.test(c.afterTok ?? '')
      && !(c.tok !== undefined && LENGTHS.test(c.tok(-2)))) return 'zhang3';
    // 长一辈, 比我长三岁, 长孝儿二岁 (older by): zhǎng.
    if (c.tok !== undefined && isHan(c.nextChar) && ahead(c, 4).some((t, k, a) => /^(岁|辈|届)$/.test(t) && k >= 1 && (isNumberTok(a[k - 1]) || /^[一二两三四五六七八九十几半]$/.test(a[k - 1]))
      || /^[一二两三四五六七八九十几半]+(岁|辈|届)$/.test(t))) return 'zhang3';
    // 长时间 长期 长达: long, whatever comes before (造成|长时间 is not 成长).
    if (['时间', '期', '久', '达', '远', '度', '途', '篇', '短', '长'].includes(c.nextTok)) return 'chang2';
    if (has('道夫', c.prevChar) && !has('老', c.nextChar)) return 'zhang3'; // 道长 (a Daoist master) 万夫长 (a commander of ten thousand)
    if (prevIs(c, '生成增涨助滋')) return 'zhang3';
    // 里长 矿长 什长 舰长 仙长: the head of something; 长史 长嫂 长兄 长女: the eldest, the senior.
    if (prevIs(c, '矿什舰船队连排营团师军省市县乡村镇局处科校院厂社站组班族酋仙侍') || /[舰矿]$/.test(c.prevTok) || nextIs(c, '史嫂兄女孙房吏男')) return 'zhang3';
    // 时间长得很, 路长得很: a time or a length is long (cháng), whatever follows.
    if (LENGTHS.test(c.prevTok)) return 'chang2';
    if (c.tok !== undefined) {
      // 日子 还 长着呢, 日子 不长了, 话也长了, 夜越发长了, 活不长了 (a time still or no longer long): cháng, with adverbs between.
      const back = behind(c, 4);
      const k = back.findIndex((t) => !/^(还|也|都|不|很|太|真|可|就|并|又|倒|却|总|越|更|最|已|实在|已经|并不|也不|还不|都不|越发|越来越|渐渐|日渐|一天天)$/.test(t));
      if (k >= 1 && (LENGTHS.test(back[k]) || (back[k] === '活' && back[0] === '不'))) return 'chang2';
      // 天长了 (the days grew long), 住长了 (stayed long), 把扇子弄长了, 拉长了 (made longer): cháng.
      if (nextIs(c, '了些点') && (c.prevTok === '天' || prevIs(c, '住弄拉抻扯伸放'))) return 'chang2';
      // 六尺五六长身体 (so many feet tall): cháng.
      if (/^[一二两三四五六七八九十百千万几数多余半]+$/.test(c.prevTok) && /[尺丈寸]$/.test(c.tok(-2))) return 'chang2';
    }
    // 八华里长的堤, 四百公里长的铁路, 数里长的山谷 (so many li long): cháng.
    if (/^(华里|公里|英里|千米|海里|光年)$/.test(c.prevTok) || (/^(里|米|丈|尺|寸|步)$/.test(c.prevTok) && c.tok !== undefined && /^[零〇一二两三四五六七八九十百千万亿几数多余半]+$/.test(c.tok(-2)))) return 'chang2';
    // 那条路长得看不见头 (so long that): cháng.
    if (nextIs(c, '得') && /^(看不|望不|见不|没有尽头|无边|吓人|惊人|出奇|不见)/.test(c.afterTok ?? '')) return 'chang2';
    // 长出一口闷气 (a long breath out), but 长出新芽 (grows).
    if (c.nextChar === '出' && ahead(c, 4).some((t) => t.endsWith('气'))) return 'chang2';
    // 长到地的衣服 (reaching the ground), 比那根长了一尺 (longer than): cháng; 比他长一岁 (older) is zhǎng.
    if ((nextIs(c, '到') && c.afterTok === '地') || (behind(c, 4).some((t, k) => k >= 1 && t === '比') && ((nextIs(c, '了') && /^[一二两三四五六七八九十半几数]/.test(c.afterTok ?? '')) || /^[一二两三四五六七八九十半几数]/.test(c.nextTok))
      && !ahead(c, 3).some((t) => /[岁辈]/.test(t)))) return 'chang2';
    // 你长的真好看, 花心里长的 (looks, grows): zhǎng.
    if (nextIs(c, '的') && (/^(实在|好看|真|很|俊|丑|标致|体面|齐整|不错|像|象|倒|得)/.test(c.afterTok ?? '') || has('里上中', c.prevChar))) return 'zhang3';
    // (长回来, 長著些草: grows back, grows.)
    if (has('大高出成胖瘦得着著回', c.nextChar) && !has('太很最更真好多这那非', c.prevChar)) return 'zhang3';
    // 长不好 (a crop), 长多少肉, 往大里长 (growing): zhǎng.
    if (/^(不好|不大|不高|不出|不起来|不壮|不胖)$/.test(c.nextTok) || (/^(多少|不少|这么多|那么多|一些|些)$/.test(c.nextTok) && GROWN.test(c.afterTok ?? ''))
      || (c.prevTok === '里' && c.tok !== undefined && /^[大高]$/.test(c.tok(-2)))) return 'zhang3';
    // 长在地上 长到一人高 长庄稼 长了 长这么大: growing (zhǎng), unless something is too long (太长了).
    if (has('太很最更真好多这那非够挺特么', c.prevChar)) return 'chang2';
    if (nextIs(c, '在到满了') || GROWN.test(c.nextTok)) return 'zhang3';
    return 'chang2';
  },
  重: (c) => (has('新复建来逢叠返演组现播写读又睹扶整修游归温聚见回', c.nextChar) ? 'chong2' : 'zhong4'),
  为: (c) => {
    // The old books' spelling (為, and the variant 爲 some editions use) tells their 为 from the modern one.
    const old = c.orig === '為' || c.orig === '爲';
    // 他年纪小，但为人稳重 (but in how he behaves): wéi.
    if (prevIs(c, '但') && c.nextTok === '人' && isHan(c.afterChar ?? '')) return 'wei2';
    // 因为 只为 但为 特为 专为: "because of, just for" (较往年的1114只为多: the 只 of a count is not "just").
    if (has('因只但特专单', c.prevChar) && !(c.prevTok === '只' && c.tok !== undefined && isNumberTok(c.tok(-2)))) return 'wei4';
    const ahead6 = ahead(c, 6);
    // The clause of this 为 ends at the next 为 or 被 (她为一家不为外人所知的机构做事: the 所 is the second 为's).
    const own = ahead6.findIndex((t, k) => k >= 1 && (t === '为' || t === '被'));
    const next = own < 0 ? ahead6 : ahead6.slice(0, own);
    // A paragraph of the old vernacular (的 著 呢 … two kinds of them), where 为 + what follows is mostly "for, because of".
    const vernacular = (): boolean => inVernacular(c);
    // 为月光所照, 为人所知, 为他所杀: the passive 为 … 所 (wéi), whoever comes between. 为这个会所做的 (what was done for it) is "for".
    const done = (k: number) => /^所?(做|作|付出|干|办|准备|提供|创造)/.test(next[k] === '所' ? next[k + 1] ?? '' : next[k]);
    if (next.some((t, k) => k >= 1 && !done(k) && (t === '所' || (t === '所有' && k === next.length - 1) || (t[0] === '所' && cpLen(t) === 2 && !/^所(以|谓|在|长|得|属|向|幸|有)$/.test(t))))) return 'wei2';
    // 为人谋而不忠乎 (for others) is wèi; 为人正直 (to be a person) is wéi. 为人为彻, 为人须为彻 (help someone all the way) is wèi.
    if (c.nextTok === '人') return (c.afterChar && '谋'.includes(c.afterChar)) || (old && /^(为|须)$/.test(c.afterTok ?? '')) ? 'wei4' : 'wei2';
    // 你一生为人心痴意软, 为人生在天地之间 (being a person): the old books' 為人 cut as 为|人心, 为|人生.
    if (old && /^(人心|人生)$/.test(c.nextTok) && isHan(c.afterChar ?? '')) return 'wei2';
    // 有诗为证, 为首, 为止, 为主, 为难, 为准: "to be, as" (wéi); 方为座上客, 皆为, 乃为, 即为, 自为: the verb after an adverb.
    // 宁为玉碎, 宁为傅佥死，不作蒋舒生 (rather be): wéi. 为恶 为善 为非 (to do evil, good, wrong) too; 为非语言类专业 (for non-…) is not 为非.
    if (has('证首止主准例难限', c.nextChar) || nextIs(c, '头先') || /^(头领|头目)$/.test(c.nextTok) || has('方乃即则皆俱均亦转互实自诚', c.prevChar) || prevIs(c, '难宁')
      || nextIs(c, '恶善') || (nextIs(c, '非') && (!isHan(c.afterChar ?? '') || /^(作|做|为|為|歹)/.test(c.afterTok ?? '')))) return 'wei2';
    // 权为行军帅府, 出为巡盐御史, 送为远行脚力 (serving as, sent out as, given as) in the old books.
    if (old && prevIs(c, '权出送')) return 'wei2';
    // 为之奈何 (what is to be done), 此人为谁？ (who is he): wéi; 为什么 为何 为谁去 (why, for whom): wèi.
    // 却为谁 又为谁 (for whom, after an adverb) is wèi.
    if ((c.nextTok === '之' && c.afterTok === '奈何') || (c.nextTok === '谁' && c.nextKnown !== false && !isHan(c.afterChar ?? '') && c.afterTok !== undefined && !has('却又更竟空苦都总欲肯', c.prevChar))) return 'wei2';
    if (has('什甚何谁', c.nextChar)) return 'wei4';
    // Old-book cues for "for, because of" (wèi), written 為: 烦为转奏, 乞为明示 (asking it done for oneself; 乞为门下 is wéi), 各为其主,
    // 为底迟 (why), 为人为彻, 一为送妹待选，二为望亲 (the reasons counted), 为今之计 (for now), 为荆州之故 (for the sake of).
    if (old && isHan(c.nextChar)) {
      if (prevIs(c, '烦') || (prevIs(c, '预') && c.tok !== undefined && /^(已|早|先|亦|也|都|便|已经|须|宜|当|可)$/.test(c.tok(-2))) || (prevIs(c, '乞望') && !WEI2_BEFORE.includes(c.nextTok) && !/^(门下|弟子|徒弟|徒|奴|仆|婢)/.test(c.nextTok))) return 'wei4';
      // 果为传奏, 为通报 (the deed done for someone, the someone left out), 我为的园里人少 (为的: because): wèi.
      if (/^(转奏|传奏|通报|引见|引奏|指教|指示|明示|助力|商议)$/.test(c.nextTok) || nextIs(c, '的')) return 'wei4';
      if ((prevIs(c, '各') && /^其/.test(c.nextTok)) || (nextIs(c, '底') && isHan(c.afterChar ?? '')) || nextIs(c, '彻')) return 'wei4';
      if (c.tok && prevIs(c, '一二三') && !isHan(lastCodePoint(c.tok(-2))) && next.length >= 2) return 'wei4';
      // 二为撮合 after 一为避祸 (the second reason, after a first that is one): wèi.
      if (c.tok && prevIs(c, '二三四') && !isHan(lastCodePoint(c.tok(-2)))
        && [4, 5, 6, 7, 8, 9, 10].some((k) => c.tok!(-k) === '为' && c.tok!(-k - 1) === '一' && isHan(firstCodePointOf(c.tok!(-k + 1))) && isHan(firstCodePointOf(c.tok!(-k + 2))))) return 'wei4';
      // (为薛蟠之事, 为黛玉之事, 为茶撵茜雪的事: because of someone's affair, in the vernacular; 必为篡逆之事, 不为不仁不义之事 (to do
      // such deeds) in the classical register stay wéi.)
      const tail2 = next.length >= 3 ? next[next.length - 2] + next[next.length - 1] : '';
      // (为今之计 "as things stand, the plan" is wéi.) 岂为一时之忿, 为天下之利, 为杀父之仇 (for the sake of a feeling or a gain): wèi.
      if (next[0] === '今' && next[1] === '之' && next[2] === '计') return 'wei2';
      if (/^之(故|缘故|忿|愤|怒|恨|气|私|利|仇|辱|怨)$/.test(tail2) || (/^[之的](事|缘故|原故)$/.test(tail2) && vernacular())) return 'wei4';
      // 吾尝为将军言, 为汝言之, 卿可速为孤图之 (said to someone, a plan made for someone): wèi.
      if ((FOR_PERSON.includes(next[0] ?? '') || /^(孤|朕|卿|寡人)$/.test(next[0] ?? '')) && next.length >= 2
        && (/^(言|说|道|陈|讲|告)$/.test(next[1]) || (cpLen(next[1]) === 1 && next[2] === '之'))) return 'wei4';
      // 为宝玉又是晚一辈 (because he is): wèi before a clause that says what someone is.
      // (The one named may be cut in two, 甄|宝玉, and 又是 in two, 又|是.)
      if (next.length >= 3 && [1, 2].some((k) => /^(又是|也是|乃是|既是|原是|本是|已是)$/.test(next[k] ?? '')
        || (/^(又|也|乃|既|原|本|已)$/.test(next[k] ?? '') && next[k + 1] === '是'))) return 'wei4';
      // 正为今日之事也, 正为此也 (precisely for): wèi.
      if (prevIs(c, '正盖') && next[next.length - 1] === '也' && /^(事|故|计|缘故|此|是)$/.test(next[next.length - 2] ?? '')) return 'wei4';
      // 一心真心为姑娘, 今日为朝廷，便粉骨碎身, 如今为宝玉 (a clause that ends on the one it is for): wèi.
      if (next.length === 1 && /^(宝玉|朝廷|国家|百姓|社稷|苍生|姑娘|太太|老太太)$/.test(next[0]) && c.nextKnown !== false && !isHan(c.afterChar ?? '')) return 'wei4';
    }
    // A verb of naming, making or turning just before it: 称为 化为 约为 分别为 提拔为 (wéi). 可以为大家做 is "for".
    // (疑为不肯用心, 有人疑为伪作: suspected to be; 无疑为 is "surely for".)
    if ((cpLen(c.prevTok) === 1 && has(BECOME_PREV + '疑', c.prevChar)) || c.prevTok === '以' || BECOME_WORDS.includes(c.prevTok)) return 'wei2';
    if (has('妻妾', c.nextChar) && !isHan(c.nextTok.slice(1, 2))) return 'wei2'; // 为妻 为妾: to take as a wife
    // 为因 为是 + a clause (because, in the old novels): wèi; 以…为是。 拜山为是。 (to take as right, it is best to) is wéi.
    if (nextIs(c, '因') || (nextIs(c, '是') && isHan(c.afterChar ?? ''))) return 'wei4';
    if (nextIs(c, '是') && c.nextKnown !== false && c.afterTok !== undefined && !isHan(c.afterChar ?? '')) return 'wei2';
    // 几乎清一色为夹板, 一律为 (all of them are): wéi.
    if (/^(清一色|一律|大多|大多数|多数|大部分|大都)$/.test(c.prevTok) && !has(FOR_NEXT_CHARS, c.nextChar)) return 'wei2';
    // "for": before a pronoun, 了 or a beneficiary (为我 为了 为国 为民 为大家 为别人).
    // (为国家大事: a longer word that opens with one of them, cut whole.)
    const forWhom = has(FOR_NEXT_CHARS, c.nextChar) || FOR_NEXT_WORDS.includes(c.nextTok) || /^(求|救|报|寻|保|取经)/.test(c.nextTok)
      || FOR_NEXT_WORDS.some((x) => cpLen(x) >= 2 && c.nextTok.startsWith(x) && cpLen(c.nextTok) >= cpLen(x) + 2)
      || (c.nextTok === '别' && /^(事|样|故|意)/.test(c.afterTok ?? ''));
    // 是为你好, 不是为钱, 就是为这件事: "for". 是为灵帝。 是为五心 (this was, these are) is the classical wéi: a short clause,
    // written 為 or a number.
    if (c.prevChar === '是') {
      // Only a 是 that opens its clause by itself (，是为灵帝。); 一则是为性命, 也只是为名, 又是为宝玉了 are "for".
      const opens = c.tok ? c.prevTok === '是' && !isHan(lastCodePoint(c.tok(-2))) : c.prevTok === '是';
      const short = c.tok ? next.length <= 2 && !/^(了|来|去|的|呢|么|吗|罢|啊)$/.test(next[next.length - 1] ?? '') : !isHan(c.afterChar ?? '');
      // (而是为250公里/小时的列车提供服务: digits are not Han, so the clause is read on past them.)
      const counted = isNumberTok(c.nextTok) && (isHan(c.nextChar) ? next.length : clauseAfter(c, 10).units.length) <= 3;
      return !forWhom && ((short && opens && old && !vernacular()) || counted) ? 'wei2' : 'wei4';
    }
    if (forWhom) return 'wei4'; // 为求经 为好而来: "in order to"
    if (has(BECOME_PREV, c.prevChar)) return 'wei2'; // a longer word ending in one: 转化为 设定为 理解为
    // 以乳为目, 以此为荣, 拜我为王, 封你为侯, 以济世救人为本: the second half of "take X as Y" (wéi), within the clause.
    // (“蓝鲸”号 … 为: the 号 of a ship's name in quotes is not "styled as".)
    if (behind(c, 6).some((t, k) => k >= 1 && TAKE_AS.includes(t) && !(t === '号' && c.tok !== undefined && /^[”」』》"]$/.test(c.tok(-(k + 2)))))) return 'wei2';
    // The same with a quotation, a number, a Latin name or a list between (以“廉价旅行大师班”为题, 以诺基亚2110手机为外壳, 以展览、会议、
    // 活动为三大板块, 改该县所在的钱唐郡为杭州), and 较…为多 (较1985年的1114只为多: more than).
    if (c.tok !== undefined) {
      const opener = takenAcross(c);
      if (opener && (opener !== '较' || (next.length <= 1 && cpLen(next[0] ?? '') <= 2 && !isHan(firstCodePointOf(c.tok(next.length + 1)))))) return 'wei2';
    }
    // 为母报雠, 为刘备画策, 为曹氏作说客, 为二姐担心 (what is done for someone, right after them): wèi.
    // (为僧可能不死: a modal or a negation before the deed says it is what someone is, not what is done for them.)
    // A deed the cut left in two characters (报|雠, 择|配) counts as one.
    const deedAt = (k: number): number => {
      const t = next[k];
      if (FOR_DEED.test(t)) return 1;
      return cpLen(t) === 1 && cpLen(next[k + 1] ?? '') === 1 && FOR_DEED.test(t + next[k + 1]) ? 2 : 0;
    };
    if (next.some((t, k) => {
      const w = k >= 1 && k <= 3 ? deedAt(k) : 0;
      return w > 0 && !next.slice(0, k).some((x) => /^(之|以|而|于|於)$/.test(x)) && next[k + w] !== '之'
        && !/^(不|未|没|可|能|可能|便|就|也|都|皆|亦)$/.test(next[k - 1])
        && (t !== '计' || cpLen(next[k - 1]) >= 2 || has('母父兄弟君公卿汝吾我你他国家民', next[k - 1]))
        && (!/^[作做]$/.test(t) || DONE_AS.test(next[k + 1] ?? ''));
    })) return 'wei4';
    // 为国家而战, 为钱而写: "for the sake of" before 而.
    if (next.some((t, k) => k >= 1 && t === '而')) return 'wei4';
    // 此茶为江南之冠, 永为荆州之主, 为良善之人 (to be the X of Y, at the end of the clause), 为弟子者: wéi.
    if (next.some((t, k) => k >= 1 && (t === '之最' || (t === '之' && (next[k + 1] === '最' || (c.tok !== undefined && k === next.length - 2 && next.length < 6)))))) return 'wei2';
    if (c.tok !== undefined && (next[1] === '者' || next[2] === '者')) return 'wei2';
    // 我为弟子的也当替打, 为儿的教训儿子 (as the disciple, as the son): wéi.
    if (next[1] === '的' && /^(儿|弟子|人子|臣|子|臣子|父母|娘|爹|人父|人母|人臣|媳妇|徒弟|师父|晚辈|长辈|学生|老师)$/.test(next[0] ?? '')) return 'wei2';
    // 原为 is "was" before a role (原为袁绍从事, 原为沙国王) and "for, because of" before a deed (原为给大老爷拜寿, 我原为气得慌): wèi
    // before a longer clause, or a shorter one in the vernacular that does not end on a role.
    const lastWord = next[next.length - 1] ?? '';
    const roleLast = ROLE_LAST.test(lastWord) || OFFICE_LAST.test(lastWord);
    if (old && prevIs(c, '原') && next.length >= 2 && (next.length >= 3 || (!roleLast && vernacular()))) return 'wei4';
    // Because of something, in the old novels: 为见他是个好汉, 为有服色, 为事逃在庄上, 为折了两个兄弟, 为吟了反诗; 盖为朝廷不明,
    // 正为预备差事, 今为缺少粮食, 非为贪财好利, 不为国庆 (a clause, not a role, nor the passive 不为人用 不为天下笑): wèi.
    // (有为有作, 无为: the words; 以备为无义人: what someone is taken for.)
    if (old && next.length >= 2) {
      if ((CAUSE_NEXT.test(next[0]) && !has('有无深', c.prevChar) && !next.some((t) => /^(之?人|者)$/.test(t))) || (next[1] === '了' && next.length >= 3) || (next[2] === '了' && next.length >= 4)) return 'wei4';
      // 不过为尽个礼 (merely for): wèi; 不过为一县令 (only a magistrate) stays wéi.
      if (c.prevTok === '不过' && next.length >= 2 && !roleLast) return 'wei4';
      if ((prevIs(c, '盖') || (prevIs(c, '正今非') && !roleLast)) && !/^(也|者|矣|乎|耳|焉|哉|用|役|虏|擒|害|杀|败|笑|辱|患|累|有|欺|惑|困|制|获|伤|乘)$/.test(lastWord)) return 'wei4';
    }
    // 现为丞相府主簿, 旧为丞相府掾 (serves, served as), 公为朝廷何官 (what office): wéi.
    if (old && (prevIs(c, '现旧原') || next.some((t, k) => /^何(官|职|人|物)/.test(t) || (t === '何' && /^(官|职|人|物)/.test(next[k + 1] ?? ''))))) return 'wei2';
    // 吾为君赦之, 为大夫远涉路途, 力为大圣冒罪奏闻, 忠为君主恨贼臣, 他曾为友报雠: for someone (wèi) when what is done for them
    // follows the person; 为君难, 为君之道, 为友。 (to be a ruler, a friend) end on the person or take 之 难 者.
    // (岂不为天下笑乎, 不复为大王有矣: the passive 为 X 笑/有.)
    if (old && FOR_PERSON.includes(c.nextTok) && next.length >= 2 && !/^(之|的|者|也|矣|所|难|易|不易|乎|耳|焉|而|与|于|於|时|後|后|笑|有|耻|患|害|擒|虏|败|轻|重)$/.test(next[1])
      && (next.length >= 3 || /^(计|有事|生色|出力|效力|尽忠|报仇|报雠|雪恨|分忧|解忧|出气|求情|说情|作主|做主|担忧|担心|著想|着想|来|去|了)$/.test(next[1]))) return 'wei4';
    // 为军前参谋, 为荆南刺史, 为巡盐御史: an office as the clause's last word (wéi).
    if (c.tok !== undefined && next.length >= 2 && next.length <= 3 && OFFICE_LAST.test(next[next.length - 1]) && !next.slice(0, -1).some((t) => has(FOR_NEXT_CHARS, firstCodePointOf(t)))) return 'wei2';
    // 为先锋 为副将 为王, 以…为基础, 与朝廷为敌: to be, to serve as (wéi) before an office, a role or a frame noun of 以…为.
    // A one-character one that also starts an action (为多留一天, 为大家) only when the clause ends after it (以此为多。).
    if (WEI2_BEFORE.includes(c.nextTok) && (!has(WEI2_ONLY_AT_END, c.nextTok) || !isHan(c.afterChar ?? '') || has('的也矣了者焉耳', c.afterChar ?? '')
      || (c.nextTok === '上' && has('着著策计', c.afterChar ?? '')))) return 'wei2'; // 走为上着 (the best move)
    // 价格为每斤三块钱, 最早为三天以后: a measured quantity before it.
    if ((isNumberTok(c.nextTok) || /^[０-９每]/.test(c.nextTok)) && QUANTITY_BEFORE.test(c.prevTok)) return 'wei2';
    // 为零, 为三十公里, 每六个学生为一组: a number the clause ends on, perhaps with its unit (为两位客人买酒 is "for").
    if (isNumberTok(c.nextTok)) {
      // 那口箱子，为四个人扛着 (carried by four men): the passive before people doing it.
      if (c.tok && !isHan(c.prevChar) && next.some((t, k) => (t === '人' || t === '个人') && cpLen(next[k + 1] ?? '') === 1 && next[k + 2] === '着')) return 'wei2';
      if (c.tok && !isHan(c.nextChar)) {
        // Digits are not Han, so the look-ahead stops at them: the number is what something is (肩高为65-75厘米, 可能性为95%,
        // 为2024年ATP巡回赛的一部分) unless what is done for it follows (而是为250公里/小时的列车提供服务).
        const { units } = clauseAfter(c, 12);
        const measured = QUANTITY_BEFORE.test(c.tok(-1)) || QUANTITY_BEFORE.test(c.tok(-2));
        if (measured || !units.some((u, k) => k >= 1 && (FOR_DEED.test(u) || (verbAt(c, units, k) && units[k + 1] === '了')))) return 'wei2';
      } else if (c.tok) {
        const rest = next.slice(1);
        const tail = rest.length && (UNIT.test(rest[0]) || cpLen(rest[0]) === 1) && !isNumberTok(rest[0]) ? rest.slice(1) : rest;
        if (tail.length === 0 || /^(的|左右|以上|以下|之间|之多|多|余|上下|了|也|矣)$/.test(tail[0])) return 'wei2';
      } else if (!isHan(c.afterChar ?? '') || (UNIT.test(c.afterTok ?? '') && c.nextKnown !== false)) return 'wei2';
    }
    // Nothing says which: in the classics and the old novels 為 is the verb "to be, to become, as" (举火为号, 号为玉音, 深为不便,
    // 尊母何氏为太后) far more often than "for", in modern writing the other way round, so the spelling tells the two apart. In the
    // vernacular of the old novels (a paragraph with 的 著 呢 …) a longer clause after it is what is done for someone or because
    // of something (为茶撵茜雪, 为柳二哥的事忙了这几日): wèi, unless the clause is a string of single characters (a title cut up).
    if (!old) {
      const modern = modernWei(c);
      if (modern) return modern;
    }
    if (c.orig === '为') return 'wei4';
    return next.length >= 3 && next.some((t) => cpLen(t) >= 2) && vernacular() ? 'wei4' : 'wei2';
  },
  // 觉 is jiào "a sleep" after 睡 午 懒 一, and after 睡 a few words back (睡不着觉, 睡了一觉); jué "to feel" otherwise.
  // 把觉睡足 (the sleep): jiào.
  觉: (c) => (has('忽顿自只便即方始渐已又才甚颇深', c.prevChar) ? 'jue2' : (prevIs(c, '把') && nextIs(c, '睡')) || has('睡午懒补回一', c.prevChar) || (c.alone !== false && behind(c, 3).some((t) => t.includes('睡'))) ? 'jiao4' : 'jue2'),
  // 好 is hào "to be fond of" before what one likes (好学 好色 好读书 好结交, 好谋无断 好作乱) and after 专 素 一心 不甚 (专好结交);
  // 好机会 is a good chance (hǎo).
  好: (c) => (['学', '客', '动', '胜', '奇', '色', '斗', '战', '赌', '洁', '礼', '武', '善', '读书', '结交', '犯上', '作乱'].includes(c.nextTok)
    || has('谋犯勇乱争淫施贪', c.nextChar) || (c.nextChar === '机' && !/^机(会|遇)/.test(c.nextTok)) || (has('吃喝', c.nextChar) && c.afterChar === '懒')
    || (isHan(c.nextChar) && (prevIs(c, '专素性') || ['不甚', '一心', '生平', '平生', '素来', '天性', '最'].includes(c.prevTok))) ? 'hao4' : 'hao3'),
  少: (c) => {
    if (has('多至很太最较减缺稀不', c.prevChar)) return 'shao3';
    return has('年女爷将校尉壮妇主儿先帅小', c.nextChar) || nextIs(c, '帝子') ? 'shao4' : 'shao3';
  },
  // 骑 is jì "a horseman" after a number or a kind of rider (一骑自北而来, 单骑, 铁骑, 轻骑); qí "to ride" before what is ridden.
  骑: (c) => (has('一二两三四五六七八九十数单铁轻骁越', c.prevChar) && !has('马乘着了过', c.nextChar) ? 'ji4' : undefined),
  // 系 as 繫 is jì "to tie" (腰繫金带, 系着, 系鞋带), xì "to connect, to relate" otherwise.
  // 系住菜根, 系一条长绳, 系在树上, 没有系裙 (to tie, whatever the spelling): jì.
  系: (c) => ((c.orig === '繫' && (has('腰足颈臂手身马鞋', c.prevChar) || has('着住上好紧带铃', c.nextChar)))
    // (皆系上回…, 从小系在城里, 各系在礼堂开会: "is, are" or departments.)
    || (c.alone !== false && c.orig !== '係' && !has('皆各实确乃均俱本原即亦都系', c.prevChar) && !/从小$/.test(c.prevTok) && (nextIs(c, '住上着在好紧裙绳带') || /^(一条|一根|一个|围裙|绳子|鞋带|领带|腰带|红绳|丝带)/.test(c.nextTok)
      || (nextIs(c, '一') && /^[条根]/.test(c.afterTok ?? '')))) ? 'ji4' : undefined),
  // 盛 is chéng "to fill, to hold" before 了 着 饭 汤 殓 (盛了 盛饭), shèng "flourishing" otherwise.
  盛: (c) => (has('了着饭汤殓贮装放满得下食粥面酒水', c.nextChar) && !/^(下来|大|开)/.test(c.nextTok) ? 'cheng2' : undefined),
  // 种树 种庄稼 种了 种完 种在: to plant (zhòng), not after a numeral or 这 那 (这种花 is "this kind of flower").
  // 老汉种三亩麦子, 种两垧谷子 (planting so many mu): zhòng.
  种: (c) => (has('树地花菜田草瓜豆粮麦稻玉米果苗出得上下庄白荷金', c.nextChar) && !has(NUMERALS + '多', c.prevChar)
    || (/^[一二两三四五六七八九十几半百千]+$/.test(c.nextTok) && /^(亩|垧|分地|畦|棵|株|行)/.test(c.afterTok ?? '') && !has(NUMERALS + '多', c.prevChar))
    || (nextIs(c, '了完着过在毕') && !has(NUMERALS + '多籽良品物火谷', c.prevChar))
    // 我种的 组里种的 园子里种的 那年种的时候 (planted); Ｕ种的, 买种的, 种的退化, 千种的风情 (a kind, seed) stay zhǒng.
    || (nextIs(c, '的') && !has(NUMERALS + '多籽良品物买卖选留纯杂绝', c.prevChar) && !/^[A-Za-zＡ-Ｚａ-ｚ]$/.test(c.prevChar)
      && !/^(退化|延续|繁衍|差异|区别|不同|起源|来源)/.test(c.afterTok ?? '')) ? 'zhong4' : 'zhong3'),
  中: (c) => {
    // 小说中, 传说中, 据说中: "in", not "to hit".
    if (c.prevChar === '说' && /(小|传|听|据|所|常|众|话|评|解|言|书)说$/.test(c.prevTok)) return 'zhong1';
    // 又中一枪 必中诸葛亮之计: the whole word before it (攻击中 革命中 发射中 are "in, during").
    if (prevIs(c, '击射看猜选命考投打说刺砸又必便竟被正')) return 'zhong4';
    if (['奖', '毒', '弹', '标', '风', '计', '枪', '暑', '邪', '蛊', '魔', '招', '箭', '伏', '弩', '镖', '暗器', '伤', '流矢', '冷箭', '毒箭', '奸计', '诡计'].includes(c.nextTok)) return 'zhong4';
    // 中举人 中进士 中状元, 中过学, 得中一名秀才 (passing the exams), 9投9中 (a hit): zhòng. (军中|举哀, 手中|举着: "in".)
    if (c.alone !== false && /^(举人|进士|状元|秀才|解元|会元|探花|榜眼|举|头名|头彩|彩票|大奖|一等奖|特等奖)/.test(c.nextTok) && !/^(举行|举办|举起|举动|举止)/.test(c.nextTok)) return 'zhong4';
    if (c.alone !== false && nextIs(c, '过') && /^(学|举|举人|进士|秀才|状元|头彩)/.test(c.afterTok ?? '')) return 'zhong4';
    if (c.alone !== false && prevIs(c, '得') && /^(一名|头名|第一|举|了)/.test(c.nextTok)) return 'zhong4';
    if (c.tok !== undefined && (isNumberTok(c.prevTok) || /^[0-9０-９]+$/.test(c.prevTok)) && /^(投|射|发|枪|箭|击|罚)$/.test(c.tok(-2))) return 'zhong4';
    // ，中了，也不枉了 (if he passes): opening a clause, 中了 can only be a hit.
    if (c.nextTok === '了' && c.tok !== undefined && !isHan(c.prevChar) && !isHan(c.afterChar ?? '') && c.afterTok !== undefined && c.tok(-1) !== '') return 'zhong4';
    // 中了计, 中了一箭, 中了举人, 中了他的计: what hits (or the exam passed) comes after the 了. 家中了。 and 家中了么 stay "in".
    if (c.nextTok === '了') {
      const after = c.afterChar ?? '';
      if (isHan(after) ? !has('么吗吧罢呢啊呀哩啦哪', after) : has(PRONOUNS, c.prevChar)) return 'zhong4';
    }
    return 'zhong1';
  },
  看: (c) => (['守', '护', '管', '门', '家', '押', '犬'].includes(c.nextTok) ? 'kan1' : 'kan4'),
  // 相 is xiàng "minister, appearance" in 宰相 相府 相国 可怜相 狼狈相 无相, xiāng "each other" otherwise.
  // 珍奇之宝相送 (presented to each other) is xiāng; 无相门中 无相之相 (formless) xiàng.
  // (苦苦相求, 苦相寻: each other; 满脸的痛苦相。 is a look.)
  // 罗拜相送 (bowed and saw him off), 内相掩袭 (attacked together from within): xiāng.
  相: (c) => (((has('照首外宰真恩拜怜狈妙色宝傻丑凶馋', c.prevChar) || (/.苦$/.test(c.prevTok) && !isHan(c.nextChar) && c.nextKnown !== false)) && !(has('宝拜', c.prevChar) && has('送赠待报见助赐迎别辞谢', c.nextChar))) || (prevIs(c, '内师法') && !/^(掩|袭|应|接|策|攻|夹|呼)/.test(c.nextTok)) || (prevIs(c, '无') && (!isHan(c.nextChar) || nextIs(c, '门之'))) || ['貌', '片', '机', '声', '册', '位', '框', '纸', '府', '国', '者'].includes(c.nextTok) ? 'xiang4' : usual('xiang1')),
  // 应 is yìng "to answer, to respond" in 应道 应了一声 应曰 内应 救应 齐声应 (以应之 叫应), yīng "should" otherwise.
  应: (c) => (has('付用对酬变验急聘邀声战允召运', c.nextChar) || nextIs(c, '了道曰着著诺喏和募约命敌试') || has('以后叫', c.prevChar)
    || prevIs(c, '内救接响答呼照策齐') || /(齐声|连声|一声|答|喏)$/.test(c.prevTok) || answered(c) ? 'ying4' : 'ying1'),
  空: (c) => {
    // 个空 is a gap (砍了一个空, 留个空) at the end of a clause, a plain 空 when more follows (个空瓶, 个空衔).
    if (c.prevChar === '个') return !isHan(c.nextChar) ? 'kong4' : 'kong1';
    // 空出一块, 空一块 (to leave empty): kòng.
    return has('有没抽挤留填偷趁补得', c.prevChar) || ['闲', '白', '缺', '隙', '当', '儿'].includes(c.nextTok) || nextIs(c, '出') || /^一(块|格|行|段|处)/.test(c.nextTok) ? 'kong4' : 'kong1';
  },
  // 分 is fèn (= 份, one's share) in 成分 本分 名分 分内, 的分上 (for the sake of), 分例 and 有分教; fēn otherwise.
  分: (c) => (has('成养过充本名缘安辈', c.prevChar) || ['内', '外', '例'].includes(c.nextTok) || (c.nextTok === '上' && c.prevChar === '的') || (prevIs(c, '有') && c.nextChar === '教') ? 'fen4' : 'fen1'),
  便: (c) => (c.nextChar === '宜' ? 'pian2' : 'bian4'),
  // 差不多先生传 (a biography after the one it is about, closing a title): zhuàn.
  传: (c) => (['记', '略'].includes(c.nextTok) || has('自小列评别立正', c.prevChar) || (/先生$/.test(c.prevTok) && c.nextKnown !== false && !isHan(c.nextChar)) ? 'zhuan4' : usual('chuan2')),
  数: (c) => {
    // 数十 数百 数招: "several" (shù), also right after 了 (了数十招). 数个山头 数次 数日: "several" before a measure word.
    if (has('十百千万招余个次日天年月回遍里步丈尺寸条只场家处种般样位名件项头匹口门张套载辈代杯盏碗壶秒周合句', c.nextChar)) return 'shu4';
    if (c.nextChar === '道' && isHan(c.afterChar ?? '')) return 'shu4'; // 数道横肉 (several streaks)
    if (has('历', c.prevChar) && !isHan(c.nextChar)) return 'shu4'; // 历数 (the years), 气数
    if (has('一数不得遍着起清了去来钱道', c.nextChar) || has('一数胜了', c.prevChar) || prevIs(c, '要就该算不会')) return 'shu3'; // 数去更无君傲世, 数来数去, 数钱, 要数除夕
    return 'shu4';
  },
  乐: (c) => (has('器队曲团谱章坛府师手理', c.nextChar) || nextIs(c, '声') || has('音配器声国管弦民奏鼓细止圣', c.prevChar) ? 'yue4' : 'le4'),
  干: (c) => {
    // 幹 is only ever gàn (幹事 樹幹 幹什麼); 乾 is gān "dry" except in the hexagram 乾元 乾卦 (qián). 干 is both: 干活 gàn, 不干我事 gān.
    // (Some editions of the old novels write 幹 for 乾 and 干: 一幹人 "the whole lot", 幹紅 "bright red" are gān.)
    if (c.orig === '幹') return (prevIs(c, '一') && /^人/.test(c.nextTok)) || nextIs(c, '红') ? 'gan1' : 'gan4';
    // 乾曰: 孫乾 speaking, or the hexagram; 王道乾 (the Song envoy of history), 乾上兑下 (the trigram above), 补到乾宫: qián.
    if (c.orig === '乾') return has('坤元卦象道位造曰宫', c.nextChar) || /(王道|孙|孫)$/.test(c.prevTok)
      || (nextIs(c, '上下') && has('坤兑离震巽坎艮', c.afterChar ?? '')) ? 'qian2' : 'gan1';
    // 干甚么 干什么 干活 (to do): gàn. After 去 来 没 都 可 么 (去干, 没干) the verb is gàn too (不干我事 "is none of my business" stays gān); after a verb of drying (晒干 擦干) it is gān.
    if (has('晒烧擦喝吃洗哭抽榨舔拭风烤流晾吹烘吸抹揩熬蒸吮半枯弄', c.prevChar) || (c.prevChar === '笑' && c.nextTok === '了')) return 'gan1';
    // 海干了, 泪干了, 井干了 (dried up); 晒不干 吹不干 (cannot dry).
    if (prevIs(c, '海河井湖泉塘池泪汗血墨漆') || (c.prevChar === '不' && c.tok !== undefined && /[晒擦吹烘晾烤风抹]$/.test(c.tok(-2)))) return 'gan1';
    if (prevIs(c, '一若相无') || has('净燥杯粮柴草饭果涸枯瘪冷硬巴裂渴咳瘦爽粉罢休', c.nextChar)) return 'gan1'; // 一干人 干净 干粮 干罢
    // 干了一杯, 干了这杯 (drained), 沾着干了的血迹 (dried): gān.
    if (c.nextTok === '了' && /^(一杯|这杯|那杯|此杯|一碗|这碗|一盅|杯|碗)/.test((c.afterTok ?? '') + (c.tok ? c.tok(3) : ''))) return 'gan1';
    if (c.nextTok === '了' && c.afterTok === '的' && !has(PRONOUNS + '谁', c.prevChar) && !/(自己|大家|人家)$/.test(c.prevTok)) return 'gan1';
    // 干妹子 干妈 干闺女 干大 (a sworn kin): gān.
    if (has('妹妈娘爹爸女闺哥姐亲爷', c.nextChar) || (c.nextTok === '大' && !/^[事业]/.test(c.afterTok ?? ''))) return 'gan1';
    // 不干我事, 干卿何事, 事不干己, 那不干他的事, 不干你秀才事 (to concern): gān.
    if ((has('我你他卿汝甚', c.nextChar) && c.afterChar === '事') || nextIs(c, '己') || (has('我你他她', c.nextChar) && c.afterTok === '己')
      || (c.prevChar === '不' && (has('我你他她咱', c.nextChar) || /^(人家|别人|外人|旁人)/.test(c.nextTok)) && ahead(c, 4).some((t) => t.endsWith('事')))) return 'gan1';
    // 并不干臣等事, 不干四郎之事, 实不干陶谦之故, 不干自己的事 (is no concern of someone): gān; 不干这种事, 不干坏事,
    // 不干伤天害理的事, 不干家务事 (do) stay gàn.
    if (c.prevChar === '不' && c.alone !== false && !/^(这|那|此|坏|好|什|甚|啥|一|些|正|大|小|缺德|亏心|伤天|违法|犯法|家务|农|活|粗|杂|重|苦|傻|蠢|糊涂|荒唐|丑|偷)/.test(c.nextTok)) {
      const t = ahead(c, 6);
      const k = t.findIndex((x, i) => i >= 1 && i <= 4 && (x === '事' || (x === '故' && t[i - 1] === '之')));
      if (k > 0 && (!t.slice(0, k).includes('的') || /^(我|你|他|她|我们|你们|他们|她们|自己|别人|人家|旁人|外人)$/.test(t[0]))) return 'gan1';
    }
    // 干连 (to implicate), 干与国政 (to meddle in): gān.
    if (nextIs(c, '连') || (nextIs(c, '与') && /^(国政|朝政|政事|政|国事|其事|外事|军事|公事|此事)/.test(c.afterTok ?? ''))) return 'gan1';
    // 尿布还没干。 (not dry yet: a wet thing before 没 at the end of a clause): gān.
    if (c.prevTok === '没' && c.nextKnown !== false && !isHan(c.nextChar)
      && behind(c, 4).slice(1).some((t) => /(布|衣|衣服|衣裳|裤|裤子|袜|袜子|鞋|头发|墨|漆|泪|血|被|被子|褥子|毛巾|手帕|颜料|水泥|油漆|油彩)$/.test(t))) return 'gan1';
    // 谁干的 你干了什么 不干了 好好干 干这些事: the verb (gàn) after someone or before what is done.
    if (has('活部事劲嘛吗什甚啥坏重', c.nextChar) || has('能苦实巧才去来没都可么也就要得该爱谋', c.prevChar)) return 'gan4';
    // 干喝, 干等, 干笑 (with nothing else): gān.
    if (/^(喝|吃|等|笑|瞪|坐|站|哭|嚎|咳|耗|熬|着急)$|^(坐|站|等|瞪)(在|着|了)$/.test(c.nextTok)) return 'gan1'; // 干坐着, 干坐在…
    if (c.alone !== false && (/^(大事|好事|这行|那行|这一行|好|不成|不完|不好|不动)$/.test(c.nextTok) || /(这样|那样|怎样|这么|那么|怎么)$/.test(c.prevTok))) return 'gan4';
    // 干不动, 干狠了, 干惯, 直干到…, 干得猛, 干这么 重的 活, 干搬运 (to work): gàn.
    if (c.alone !== false && ((nextIs(c, '不') && /^(动|了|完|成|好|下去|过)/.test(c.afterTok ?? '')) || nextIs(c, '狠惯到')
      || (nextIs(c, '得') && /^(猛|好|漂亮|不错|出色|起劲|欢|热火|卖力|带劲)/.test(c.afterTok ?? ''))
      || /^(这么|那么|这种|那种|这些|那些|这样|那样|搬运|农活|家务|体力|苦力|零活|重活|粗活|杂活|买卖|革命)/.test(c.nextTok))) return 'gan4';
    // 多干, 少干, 直干, 有活干, 找活干, 有人干, 在家干, 快干 (not 快干了: nearly dry): gàn. (人干 + 被 以 仓 …: a dried body.)
    // (找点零活干, 有重活干: a kind of work cut whole.)
    if (c.alone !== false && (prevIs(c, '多少直活') || /^(轻|重|零|粗|杂|农|细|累|脏)活$/.test(c.prevTok) || /^(有人|没人|在家|人)$/.test(c.prevTok) || (prevIs(c, '快') && !nextIs(c, '了')))
      && !nextIs(c, '被以仓的和与及、')) return 'gan4';
    if (has(PRONOUNS + '谁不肯专硬真敢想愿', c.prevChar) || /(好好|大家|人家|自己)$/.test(c.prevTok)) return 'gan4';
    // 干他们那行, 干他的老本行: doing someone's kind of work (the gān of 干卿 is one character and 事 follows).
    if (has('我你他她', c.nextChar) && (cpLen(c.nextTok) >= 2 || has('的这那', c.afterChar ?? ''))) return 'gan4';
    if (nextIs(c, '着过啦啊这那点完起成掉') || /^(一|些|下去|起来|出来|不了)/.test(c.nextTok)) return 'gan4';
    // 看你干的好事: what was done.
    if (c.nextTok === '的' && /^(好事|坏事|事)/.test(c.afterTok ?? '')) return 'gan4';
    // 干了好些年 干了坏事 (did) but 头发干了。 一口干了， (dried, drained).
    if (c.nextTok === '了' && isHan(c.afterChar ?? '') && !/^(后|以后|之后)/.test(c.afterTok ?? '')) return 'gan4';
    return 'gan1';
  },
  // 假 is jià "leave, holiday" (请假 放假 请了假), jiǎ "false" otherwise.
  假: (c) => (has('放请休暑寒病年度产例事婚探补销长短告天日歇', c.prevChar) || ['期', '日', '条'].includes(c.nextTok) || (prevIs(c, '了') && behind(c, 3).some((t) => /^[请放休告]/.test(t))) ? 'jia4' : 'jia3'),
  倒: (c) => {
    // Falling over or toppling (dǎo): after a verb of falling, before 下 在 地 霉 了, or at the end of a clause
    // (怕我倒。 墙倒了。). Everything else in running text is dào: the adverb "on the contrary / rather" (倒也 倒不 倒还
    // 倒像 倒让他 …, very common in dialogue), pouring (倒茶) and reversing (倒退 倒立 倒数).
    // (按倒, 踢倒, 掼倒: knocked over.)
    if (has('摔跌跪推打病昏滑绊压栽撞仆晕扑拉冻累醉吓气笑捆翻放躺拜按扳踢拿惊掼咒踩撂砍挤掀拽扯拖揪扭撩', c.prevChar) && c.prevTok !== '横拖' && !(c.prevTok === '拖' && c.tok?.(-2) === '横')) return 'dao3'; // 横拖倒拽 (dragged every which way) stays dào
    // 倒大霉, 倒了霉 (had bad luck): dǎo.
    if (/^(大|了)$/.test(c.nextTok) && /^霉/.test(c.afterTok ?? '')) return 'dao3';
    // 把 + what + 倒在 (poured), 去给她倒， (poured for her): dào.
    // (把她扶起又倒在地: 又 says she fell again.)
    const baGei = (w: string): boolean => {
      const back = behind(c, 4);
      const k = back.indexOf(w);
      // (从 one hand 倒在 the other: shifted.)
      return k >= 1 && !back.slice(0, k).some((t) => /^(又|也|就|便|都|却|才|再|还|竟|终于|一下|从)$/.test(t));
    };
    if (c.tok !== undefined && ((has('在地', c.nextChar) && baGei('把')) || (!isHan(c.nextChar) && c.nextKnown !== false && baGei('给')))) return 'dao4';
    if (has('下在地霉塌台闭伏毙', c.nextChar)) return 'dao3';
    // 墙倒了。 (fell) but 倒了茶来 (poured): what follows 了 tells them apart.
    if (c.nextTok === '了') return isHan(c.afterChar ?? '') ? 'dao4' : 'dao3';
    if (has('是水茶酒汤饭油药粥退立影数转置挂垃', c.nextChar) || c.prevChar === '反') return 'dao4';
    if (isHan(c.prevChar) && !isHan(c.nextChar)) return 'dao3';
    return 'dao4';
  },
  调: (c) => {
    if (has('整节解皮味料剂和养理教停侃价情息治戏弄琴', c.nextChar) || has('协空失风均', c.prevChar)) return 'tiao2';
    // 调暗 调高 调成透明 (to adjust): tiáo.
    if (nextIs(c, '暗亮低高小大成匀准好慢快')) return 'tiao2';
    return 'diao4';
  },
  薄: (c) => {
    if (c.nextChar === '荷') return 'bo4';
    if (has('弱利暮情命酒礼雾膜', c.nextChar) || has('淡单稀刻微菲浅厚轻', c.prevChar)) return 'bo2';
    return 'bao2';
  },
  角: (c) => (['色', '逐', '斗'].includes(c.nextTok) || has('主配丑旦名反', c.prevChar) ? 'jue2' : 'jiao3'),
  // 处 is chǔ "to deal with, to be in" (处理 处在 所处 相处), chù "a place" (之处 此处 到处 好处).
  处: (c) => (has('之此彼某各何到住去好长短益难妙用', c.prevChar) ? 'chu4'
    : has('理罚分置决境事世方身于在', c.nextChar) || has('相共独身位地所', c.prevChar) ? 'chu3' : 'chu4'),
  // 只 is zhī the measure word after a number (and 像只猫 "like a cat"), zhǐ "only" otherwise.
  只: (c) => (c.orig === '隻' || has(NUMERALS, c.prevChar) || /[0-9]/.test(c.prevChar) || (prevIs(c, '像象') && c.alone !== false && cpLen(c.nextTok) >= 1 && !has('是有要能会好得管见顾怕', c.nextChar)) ? 'zhi1' : 'zhi3'),
  // 心头发闷, 念头发 …: the 头 of a word that is not the head (发 is the verb fā there).
  发: (c) => (c.orig === '髮' || (has('头理毛白黑假金银长短卷剪染披散蓬落削束鬓', c.prevChar) && !/(心|念|眉|山|街|码|源|关|苗|风|势|锋|劲|骨|枕|床|桥|墙|田|地|里|上)头$/.test(c.prevTok)) || (c.prevChar === '乱' && !isHan(c.nextChar)) || has('型廊夹胶簪际', c.nextChar) ? 'fa4' : 'fa1'), // 髮 is only hair (fà)
  // 自率大兵, 率本部, 率三万人马 (to lead): shuài.
  // 放大率 增长率 命中率 (a rate) stay lǜ before a number.
  // 出煤率最高, 出油率很低: what is high or low, or rises and falls, is a rate (lǜ).
  率: (c) => (/(放大|增长|出生|死亡|命中|成功|折射|反射|发病|失业|利用|覆盖|转化|分辨|淘汰|通过|合格|及格|准确|错误|圆周|变化|压缩|识别|回报|收益|周转|使用|出勤|就业|升学|入学|普及|效|频|速|概|比|利|汇|税|功|费)$/.test(c.prevTok) ? 'lü4'
    : has('领先兵军众团队大本部精数诸各' + NUMERALS, c.nextChar) || has('草轻表统坦真直督自亲', c.prevChar) ? 'shuai4'
      : /^(最|很|较|极|更|偏|太|也|还|都|比较|相当|非常)?(高|低)|^(提高|降低|下降|上升|达到|超过|不足)/.test(c.nextTok + (c.afterTok ?? '')) ? 'lü4' : usual('lü4')),
  // 量宋江有何德能 量此山僻之处: a clause that opens with 量 is the verb "to reckon" (liáng); 量词 量子 (liàng) are the exceptions.
  // 量你是个配军 (I reckon you are): liàng.
  量: (c) => (!isHan(c.prevChar) && has(PRONOUNS + '汝尔', c.nextChar) ? 'liang4' : has('体力身尺长入一', c.nextChar) || nextIs(c, '了到过着几') || /^(血压|体温)/.test(c.nextTok) || has('测估思度', c.prevChar) || (!isHan(c.prevChar) && isHan(c.nextChar) && !has('词子', c.nextChar)) ? 'liang2' : 'liang4'),
  // 唱酸曲, 唱曲儿 (a song): qǔ.
  曲: (c) => (has('歌作乐名小序插戏哀悲词琴舞洲酸唱', c.prevChar) || (prevIs(c, '一此') && !has('一折', c.nextChar)) ? 'qu3' : 'qu1'),
  模: (c) => (has('样子具', c.nextChar) ? 'mu2' : 'mo2'),
  会: (c) => (c.nextChar === '计' ? 'kuai4' : 'hui4'),
  // 难 is nàn "disaster" (灾难 遇难 八十一难 二十七难), nán "hard" otherwise.
  // 难他一难 (to make it hard for him) stays nán.
  // 师父有难, 那有难的人 (in danger): nàn; 有难处 有难度 are words.
  难: (c) => (has('民友胞', c.nextChar) || (has('灾苦患遇受罹空海责非刁急避赴遭落蒙殉国救犯逃此大', c.prevChar) && !/^(不大|很大|太大|多大|好大|最大|更大|并不大)$/.test(c.prevTok))
    || (prevIs(c, '有') && (!isHan(c.nextChar) || nextIs(c, '么吗了哩呢啊也矣时之')))
    || (/^[一二三四五六七八九十百几]+$/.test(c.prevTok) && !isHan(c.nextChar) && !(c.tok && c.tok(-3) === '难' && has(PRONOUNS, c.tok(-2)))) ? 'nan4' : 'nan2'),
  将: (c) => {
    if (c.nextChar === '军') return 'jiang1';
    // A 将 that ends its clause is a general (斩关杀将，, 无名下将。, 双枪将」, 智勇之将也); 共相将 (together) and the chess
    // 再将！ (check) are jiāng, and 将 before an opening quote is 把 (将《论语》).
    if (c.nextKnown !== false && isHan(c.prevChar) && !/^(相|不|再)$/.test(c.prevTok)
      && (/^[，。；：！？、」』”’）…]/.test(c.nextTok || '。') || (c.prevTok === '之' && nextIs(c, '也')))) return 'jiang4';
    // 将星 (a general's star), 将佐 将吏 将卒 (officers): jiàng.
    if (c.nextTok === '星' || nextIs(c, '佐吏卒')) return 'jiang4';
    // 勇将 这么 一冲, 天曹神将尽皆惊, 智勇猛将极多, 第二路上将桥蕤 (a general, though 这 or 尽 follows): jiàng.
    if ((prevIs(c, '勇猛骁神良虎') && (/^(这么|那么|这样|那样|这般|那般)$/.test(c.nextTok) || has('尽极', c.nextChar))) || /^(勇猛|英勇|骁勇|威猛)$/.test(c.prevTok)
      || (c.prevTok === '路上' && c.tok !== undefined && /^(第|[一二三四五六七八九十])/.test(c.tok(-2)))) return 'jiang4';
    // 将他送走 将书放下 (= 把), 天将明 夏天将尽 (about to): jiāng.
    if (has('我你他她它这那此其', c.nextChar)) return 'jiang1';
    // 一将当先, 一将出马, 一将挺枪 (one general) against 他一将信交出去 (as soon as he had …: = 把): the general does something.
    // (一将守关, 一将当先: the general's own verb comes first.)
    if (prevIs(c, '一')) return isHan(c.nextChar) && !nextIs(c, '守当出挺拦杀引领率提挡镇战') && ahead(c, 4).slice(1).some((t) => /^(说明|放|交|送|拿|摆|推|收|扔|递|塞|搬|写|告诉|讲|说|关|锁|藏|带|抱|捧)/.test(t)) ? 'jiang1' : 'jiang4';
    // 王家将有一场喜事 (will have): jiāng; 家将 (a retainer) otherwise.
    if (prevIs(c, '家') && has('有会要是在能可', c.nextChar)) return 'jiang1';
    // 众将 诸将 两将相交 十数将 (the generals): jiàng after a word that counts or gathers them (the whole word: 马上将 is not).
    if ((prevIs(c, '众诸各偏裨二两三四五六七八九十数') || /^[二两三四五六七八九十百千]+[数余]?$|[众诸]$|^(二老|四大)$/.test(c.prevTok)) && !has('军', c.nextChar)) return 'jiang4';
    // 为将 首将 (to be a general, the leading general), 天神将 无敌将 军中将: jiàng; 颜良将兵五万 (led troops).
    if ((prevIs(c, '为首') || /^(天神|无敌|下降|军中)$/.test(c.prevTok)) && !has('来要会在', c.nextChar)) return 'jiang4';
    if (c.nextTok === '兵' && /^[一二三四五六七八九十百千万数]/.test(c.afterTok ?? '')) return 'jiang4';
    if (has('明尽近至黑晚亮暮', c.nextChar)) return 'jiang1';
    // 守将 贼将 魏将 兵将 大将 天将 (a general); 马上将 春天将 are not.
    if (has('士领校帅官才', c.nextChar) || prevIs(c, '大名上少中良武虎老勇猛主敌副天牙神骁女败降战守贼兵魏蜀吴汉员旧斩宿骑家部爱番川蛮羌辽')) return 'jiang4';
    // 心腹将李傕, 为主将 (a trusted general, the chief general): jiàng.
    if (/^(心腹|为主)$/.test(c.prevTok)) return 'jiang4';
    // 众神将叹口气, 五军兵将大进, 分调兵将已了, 兵勇将猛, 被天兵将绑缚: the gods' generals, soldiers and generals, where the word
    // before is cut whole (众神, 军兵, 调兵, 兵勇). (民兵将两颗地雷埋好, 亲兵将那封信送来: one soldier, and 将 is 把.)
    if (/^(众神|诸神|天神|军兵|调兵|点兵|兵勇|天兵)$/.test(c.prevTok) && !has('到至来近要会在一两这那此其', c.nextChar)) return 'jiang4';
    return 'jiang1';
  },
  // 省 is xǐng "to examine, to visit" in 三省吾身 省悟 省亲 省视 内省, shěng "province, to save" otherwise.
  省: (c) => (has('反内自三再', c.prevChar) || has('亲视墓悟察', c.nextChar) || (prevIs(c, '不须') && (nextIs(c, '的得') || !isHan(c.nextChar))) ? 'xing3' : undefined),
  // 间亦有 间或 (now and then, opening a clause): jiàn.
  间: (c) => (has('谍隔断接歇', c.nextChar) || has('离反挑', c.prevChar) || (!isHan(c.prevChar) && c.nextKnown !== false && nextIs(c, '亦或有')) ? 'jian4' : 'jian1'),
  当: (c) => (c.prevChar === '当' || c.nextChar === '当' ? 'dang1' // 当当作响: the sound, not 当作
    : has('作真铺做成晚日', c.nextChar) || has('上适恰妥得稳', c.prevChar) || treatedAs(c) ? 'dang4' : 'dang1'),
  几: (c) => (c.nextChar === '乎' ? 'ji1' : 'ji3'),
  // 众皆恶之, 恶了高太尉, 甚恶你等, 深恶痛疾: to loathe, to offend (wù); 风甚恶, 十恶, 狠恶之人, 猛恶之至, 行恶: fierce, evil (è).
  恶: (c) => {
    if (has('风浪势毒凶狠猛险丑十行作', c.prevChar)) return 'e4';
    // 羞恶之心, 恶之欲其死 (opening a clause), 最恶的是 (what one hates most): wù.
    if (has('可厌憎羞', c.prevChar) || prevIs(c, '所皆') || (c.prevChar === '深' && c.nextChar === '痛') || (!isHan(c.prevChar) && nextIs(c, '之'))
      || (prevIs(c, '最') && nextIs(c, '的') && c.afterTok === '是')) return 'wu4';
    if (c.alone !== false && ((nextIs(c, '之') && !isHan(c.afterChar ?? '')) || nextIs(c, '了其'))) return 'wu4';
    return prevIs(c, '甚') && has(PRONOUNS + '之其汝尔', c.nextChar) ? 'wu4' : 'e4';
  },
  // 供 is gòng "to offer, to enshrine" (供奉 供品 供茶 供在 斋供), gōng "to supply" otherwise (供给 供应 are words).
  // 全家都是她供着。 (she provides for them) is gōng; 供着神像 (enshrines) gòng.
  供: (c) => (has('品奉养桌茶香饭斋佛神祖像菩萨烛果献祭', c.nextChar) || nextIs(c, '在上') || (nextIs(c, '着') && isHan(c.afterChar ?? '')) || prevIs(c, '斋上进摆献设清') ? 'gong4' : 'gong1'),
  弹: (c) => (has('子炮炸导枪核珠', c.prevChar) || prevIs(c, '两') || /(金属|钢|铅)$/.test(c.prevTok) || has('药壳头道丸洞链片坑孔痕雨幕', c.nextChar) ? 'dan4' : 'tan2'),
  // 降 is xiáng "to surrender / to subdue" in 降妖 降龙 降服 and after a verb of yielding (受降 归降 投降 来降 原降文武), jiàng otherwise.
  降: (c) => {
    // 降阶而接 降心相从 即降圣旨 降御酒 降一道旨意 降立宝殿, 此神人降矣 (came down, bestowed): jiàng.
    if (has('临生旨罪福雨雪霜露落下价级低温压世凡敕诏恩甘阶心圣御立到至', c.nextChar) || /^(金牌|一道|一纸)/.test(c.nextTok) || /(神|仙|神人|仙人|天神)$/.test(c.prevTok)) return 'jiang4';
    // 如何不降？ 不得已而降。 部卒多降。: to surrender at the end of a clause.
    // (从天而降, 自空而降: coming down.)
    if (prevIs(c, '不而多') && !isHan(c.nextChar) && c.nextKnown !== false && !behind(c, 4).some((t) => /[天空从自]/.test(t))) return 'xiang2';
    if (has('服伏妖魔龙虎怪贼顺书表兵将者卒曹吴蜀魏汉宋金敌邪精操众', c.nextChar) || has('受投招纳乞请归迫劝诱诈来原新已皆尽出收俱', c.prevChar)) return 'xiang2';
    // 降得他, 降得妖魔 (can subdue), 老猪会降, 鸡最能降蜈蚣, 初降, 同降, 袁谭之降 (the surrender of): xiáng.
    // (能降到零, 初降的大雪: coming down.)
    if (nextIs(c, '得') || (prevIs(c, '会能初同') && !nextIs(c, '的')) || (prevIs(c, '之') && (!isHan(c.nextChar) || nextIs(c, '后')))) return 'xiang2';
    // 决不降汝, 请菩萨降我 (to subdue someone, to yield to someone); 天降我 (heaven sends) stays jiàng.
    if (has('汝我你他尔', c.nextChar) && !/(天|神|仙|上苍|老天|上帝)$/.test(c.prevTok)) return 'xiang2';
    // 何不早降 不肯降 欲降曹操 拜降, 便降 遂降 自然降矣: to surrender, after a word of will or time.
    if (prevIs(c, '早肯愿欲若未必乞拜都诈便遂即乃亦可当宜岂') || /(情愿|不肯|不战而|只得|只好|自然|不如|何不|岂可|不可)$/.test(c.prevTok)) return 'xiang2';
    // 岂可降之, 降即免死, 璋自然降矣, 既降人, 降了妖怪, 被我降了 (made to surrender, subdued): xiáng in the old books; 气温降了 stays jiàng.
    const fell = /(温|温度|气温|价|价格|水位|血压|成绩|工资|声音|速度|高度|体温|热度|雨|雪|霜|露|飞机|热|价钱|物价|指数|地位|级|职)$/.test(c.prevTok);
    if (!fell && !/^[一二两三四五六七八九十百几半0-9级职价温]/.test(c.afterTok ?? '') && (nextIs(c, '之矣也即则否人') || (nextIs(c, '了') && (behind(c, 4).some((t) => /^(被|我|你|他|俺|老孙|吾)$/.test(t)) || /^(妖|怪|魔|贼|那)/.test(c.afterTok ?? ''))))) return 'xiang2';
    return 'jiang4';
  },
  // 切须 切莫 切勿 切忌 切不可 (be sure to / never): qiè; 切菜 切开 qiē.
  切: (c) => (has('一亲恳急迫确密贴深真关甚', c.prevChar) || has('实身须莫勿忌思念恨盼', c.nextChar) || ['不可', '不要', '不得', '不宜', '不能'].includes(c.nextTok) ? 'qie4' : 'qie1'),
  // 一朝 (one morning, one day) is yī zhāo unless it is a dynasty (一朝天子一朝臣).
  // 朝游花果山，暮宿水帘洞: morning (zhāo) when 暮 or 夕 answers it a few words on.
  朝: (c) => (has('气夕霞露晖', c.nextChar) || (c.prevChar === '一' && c.nextTok !== '天子' && !has('臣', c.nextChar))
    || (c.tok !== undefined && [2, 3, 4, 5, 6, 7].some((k) => /^[暮夕]/.test(c.tok!(k)))) ? 'zhao1' : 'chao2'),
  载: (c) => (has('记登转刊连千', c.prevChar) || /^[一二三四五六七八九十百半数几]+$/.test(c.prevTok) ? 'zai3' : 'zai4'), // 十载 (ten years)
  冠: (c) => (has('军亚季', c.nextChar) ? 'guan4' : 'guan1'),
  兴: (c) => (has('高扫败尽助狂起雅诗酒乘', c.prevChar) || has('致趣味', c.nextChar) ? 'xing4' : 'xing1'), // 狂兴不禁 鼓起兴来: mood (xìng)
  // 教 is jiào ("to let, to make": 我教你不要慌 太师教唤进来 教他先吃我一棒) far more often than jiāo "to teach" in the old novels;
  // jiāo when a lesson or a trick follows (教书 教物理 教你个法子 教你一招 教他学写字), after 师, before 了 过 着 的 得 (only "to teach"
  // takes them), at the end of a clause (谁要你教。) and after 来 肯 开始 手把手 (我来教你).
  教: (c) => {
    if (has('书课给給', c.nextChar) || (c.prevChar === '师' && isHan(c.nextChar)) || TAUGHT.test(c.nextTok)) return 'jiao1';
    // The noun: 全真教 明教 (a sect), 昔日之教 师教 奉教 归教 (teachings), and 有分教 (the storyteller's "so it came about").
    // 自传其教。, 幸皈吾教， (its, our teaching) at the end of a clause: the noun.
    if ((prevIs(c, '其吾') && c.nextKnown !== false && !isHan(c.nextChar))
      || /(全真|道|佛|儒|回|天主|基督|宗|邪|魔|明|白莲|拜火|善|之|师|分|奉|归|赐|受|求|三体|三乘|沙门)$/.test(c.prevTok)
      // 掌教 (the head of a sect), 本教 护教 法教 兴教, and the courtesies 闻教 谢教 听教 聆教 候教 领大教.
      || /^(掌|宏|本|护|清|法|兴|僧|闻|谢|听|钧|翰|聆|候|进|吝|政|礼|圣|治|大|乘)$/.test(c.prevTok)) return 'jiao4';
    // 教他武功, 教你两手剑法, 教孩子们唱, 教人下棋, 教你三天 (a skill, a subject or lessons after the one taught): jiāo.
    if (!nextIs(c, '把') && c.prevTok !== '好' && taughtSkill(c)) return 'jiao1';
    // 教好书, 教她的书 (a class in a school), 教这书: jiāo.
    if (c.tok && ahead(c, 3).some((t, k, a) => t === '书' && k > 0 && a.slice(0, k).every((x) => /^(冬|好|这|那|这个|你|我|他|她|的|几年)$/.test(x)))) return 'jiao1';
    // 这么一教, 一教便会 (once taught); 教呢, 教吗, 让我教吧 (teaching, at the end of a question or a request): jiāo.
    if (c.tok && ((prevIs(c, '一') && (/^(这么|那么|这样)$/.test(c.tok(-2)) || nextIs(c, '便就')))
      || (/^(呢|吗|吧|呀|哩)$/.test(c.nextTok) && !isHan(firstCodePointOf(c.tok(2))) && /^(去|能|不能|要|也要|会|肯|来|我|你|他|她|不|还|再|得)$/.test(c.prevTok)))) return 'jiao1';
    // 教来教去, 怎么教都教不会, 教上好几遍, 教两遍, 教全了, 你还没教她呢, 不会教学生。 (teaching over and over, or not at all): jiāo.
    if (c.tok) {
      const t1 = c.nextTok, t2 = c.tok(2), t3 = c.tok(3);
      if ((t1 === '来' && t2 === '教' && t3 === '去') || (t1 === '也' && t2 === '教') || (t1 === '全' && t2 === '了') || (t1 === '到' && t2 === '了' && !isHan(firstCodePointOf(t3)))
        || ((t1 === '上' ? t3 : t2) === '遍' && /^[一二两三四五六七八九十几第]+$/.test(t1 === '上' ? t2 : t1))
        || (/^(我|你|他|她)$/.test(t1) && /^(呢|吗)$/.test(t2) && !isHan(firstCodePointOf(t3)))
        || (/^(徒弟|弟子|徒儿|学生)$/.test(t1) && !isHan(firstCodePointOf(t2)))) return 'jiao1';
    }
    // 教她如何种菜 (how to), 是姐姐教我背的 (what one was taught to do): jiāo; 教我如何不想她 (let me) stays jiào.
    // (教我如何猜得破？ 教我怎生割舍？: a question of how one is to manage stays jiào.)
    if (c.tok && /^(我|你|他|她|我们|你们|他们|她们)$/.test(c.nextTok)
      && ((/^(他|她|他们|她们)$/.test(c.nextTok) && /^(如何|怎样|怎生)$/.test(c.tok(2)) && !/^[不别莫]/.test(c.tok(3)) && !clauseAsks(c, 3))
        || (/^(学|练|念|读|唱|画|背|写|闯)$/.test(c.tok(2)) && c.tok(3) === '的' && !isHan(firstCodePointOf(c.tok(4)))))) return 'jiao1';
    // 是我爷爷教我的, 你教她的功夫, 师傅教她的那些招式 (what someone taught): jiāo.
    if (c.tok && /^(我|你|他|她|我们|你们|他们|她们|咱们)$/.test(c.nextTok) && c.tok(2) === '的' && !nextIs(c, '把')) return 'jiao1';
    // 给徒弟们教好功课, 给小徒弟教了 (taught to them): jiāo.
    if (c.tok && behind(c, 4).slice(1).includes('给') && isHan(c.prevChar)) return 'jiao1';
    // 教把我放了, 不肯教人看 (to let): jiào.
    if (nextIs(c, '把') || (c.nextTok === '人' && isHan(c.afterChar ?? ''))) return 'jiao4';
    // 白莲教教祖, 教众, 教徒 (of the sect): jiào.
    if (nextIs(c, '祖主众徒规派义')) return 'jiao4';
    // 教教你, 教不会, 教数学 社会学, 他偏不教她。 无法教你。, 教你怎么做饭: to teach (jiāo).
    if (c.prevChar === '教' || c.nextChar === '教' || (c.nextChar === '不' && c.afterChar === '会') || (/学$/.test(c.nextTok) && cpLen(c.nextTok) >= 2)) return 'jiao1';
    // Before a colon or a quote it is telling someone what to do (菩萨教：「…」, 喝教：「放箭」): jiào.
    if (nextIs(c, '了过着的得完') || (c.nextKnown !== false && (c.nextChar === '' || has('。！？，、；…', c.nextChar)) && isHan(c.prevChar))) return 'jiao1';
    const learner = has('你我他她们您', c.nextChar);
    const after = c.afterTok ?? '';
    // 好教他们学 (so that they): jiào.
    if (learner && c.prevTok === '好' && isHan(c.afterChar ?? '')) return 'jiao4';
    // 教你怎么做饭, 他偏不教她。 (to teach); 教他：「…」 (told him) and 教我如何不想她 (let me) stay jiào.
    if (learner && (/^[学练念读唱画游骑弹绣织算]|^(怎么|说话)/.test(after) || (cpLen(c.nextTok) <= 2 && /^[。！？，；…]/.test(c.afterTok ?? '')))) return 'jiao1';
    if (learner && /^[个一些几两三招法手字本]/.test(after) && (has(PRONOUNS, c.prevChar) || TEACHER_BEFORE.includes(c.prevTok))) return 'jiao1';
    // 我来教你。 开始教隔壁的孩子 (to teach); 押解我来教你赴府 (to tell you to go) stays jiào.
    if (TEACHER_BEFORE.includes(c.prevTok) && !(learner && isHan(c.afterChar ?? ''))) return 'jiao1';
    return 'jiao4';
  },
  晕: (c) => (has('车船机', c.nextChar) ? 'yun4' : 'yun1'),
  卷: (c) => {
    if (has('试画胶案考问书', c.prevChar) || has('子宗', c.nextChar)) return 'juan4';
    // 上卷 下卷 (the first and second volumes of a work)
    if (has('上下中', c.prevChar) && (has('经书', c.nextChar) || !isHan(c.nextChar))) return 'juan4';
    // 一卷经, 度亡经一卷: a volume (juàn); 一卷铺盖 rolls up (juǎn).
    if (has('一二三四五六七八九十数两百千万每', c.prevChar) && (has('经书咒文诗词曲帖', c.nextChar) || !isHan(c.nextChar))) return 'juan4';
    // 每卷都有, 这一卷没字: a volume.
    if (prevIs(c, '每') || (prevIs(c, '一') && nextIs(c, '没都中里'))) return 'juan4';
    // A volume and its number: 卷四 (a heading), 《水经注》卷三十, 《因话录》卷4说, 文集卷五 (not 卷几片云 rolled up, 卷一卷 那衣袖,
    // 行李卷一扛).
    const counted = /^(第?[零〇一二三四五六七八九十百千两]+|第?[0-9０-９]+)$/;
    if (counted.test(c.nextTok) && (!isHan(c.prevChar) || /(集|记|志|书|录|经|史|传|典)$/.test(c.prevTok))
      && (!isHan(c.afterChar ?? '') || /^(中|引|说|云|载|记|之|所|有|的|里|上|下|末|第)/.test(c.afterTok ?? ''))) return 'juan4';
    // After 第N or digits: 第四卷, 全书10卷 (juàn), unless a roll of something follows.
    if ((/^第[零〇一二三四五六七八九十百千两0-9０-９]+$/.test(c.prevTok) || /^[0-9０-９]+$/.test(c.prevTok)) && !ROLLED.test(c.nextTok)) return 'juan4';
    // After a numeral in characters: a volume of a text (三卷天书, 几卷消灾解厄的经, 一卷画); a roll otherwise (一卷银子, 一卷胶带).
    if (/^[一二三四五六七八九十百千两几数]+$/.test(c.prevTok) && c.tok !== undefined) {
      for (const u of clauseAfter(c, 6).units) {
        if (ROLLED.test(u)) break;
        if (/(经|书|册|册子|咒|文|诗|词|曲|帖|画|卷轴|钞本|史|志|集|稿|篇|章|箓|符|录|论|传|记|疏|典|籍)$/.test(u)) return 'juan4';
      }
    }
    // 别卷 各卷 本卷 首卷 末卷 (a volume of a work).
    if (prevIs(c, '别各本首末') && !/^(起|成|着|了|住|走|入|进|上|下)/.test(c.nextTok)) return 'juan4';
    return 'juan3';
  },
  创: (c) => (has('伤口面痕', c.nextChar) ? 'chuang1' : 'chuang4'),
  横: (c) => (has('蛮强专霸', c.prevChar) || has('财祸死', c.nextChar) ? 'heng4' : 'heng2'),
  磨: (c) => (has('坊盘', c.nextChar) || has('石推', c.prevChar) ? 'mo4' : 'mo2'),
  宿: (c) => (has('一二两半整', c.prevChar) ? 'xiu3' : has('列星二十八', c.prevChar) ? 'xiu4' : usual('su4')), // 列宿 二十八宿 星宿: the constellations (xiù)
  // 鲜 is xiǎn "few" in the classics (巧言令色, 鲜矣仁; 鲜有 鲜能), xiān everywhere else.
  鲜: (c) => (has('矣不有能克少知', c.nextChar) ? 'xian3' : 'xian1'),
  // 么 closes a question after a word (他不咬人么？) as ma; inside 什么 怎么 这么 the dictionary word wins.
  么: (c) => (afterWord(c.prevChar) && !isHan(c.nextChar) ? 'ma5' : 'me5'),
  // 铺: pū "to spread" (铺着 铺设) unless it is the noun (店铺 床铺 当铺, a post station 十里铺, 铺子).
  // 缝 is féng "to sew" (密密缝, 缝衣, 缝补) after an adverb or a thing sewn, fèng "a seam, a crack" after the thing it splits.
  // 拆拆缝缝 (sewing over and over): féng.
  缝: (c) => (has('密细补针裁勤', c.prevChar) || has('衣补合纫', c.nextChar) || (!prevIs(c, '一') && nextIs(c, '了好上成着一件个'))
    || (c.tok !== undefined && (nextIs(c, '缝') || prevIs(c, '缝')) && [-3, -2, -1, 1, 2, 3].some((k) => /^(拆|补|拆拆|补补)$/.test(c.tok!(k)))) ? 'feng2' : has('裂门窗墙地石骨牙一', c.prevChar) ? 'feng4' : undefined),
  铺: (c) => {
    // 打个地铺, 安排个草铺, 躺在下铺, 上下铺 (a bed, a bunk): pù.
    if ((c.prevTok === '上下' || (/^(地|草|下|上|通|统|床)$/.test(c.prevTok) && c.tok !== undefined && /^(个|张|一个|打|扑|搭|在|睡)$/.test(c.tok(-2))))
      && !has('着了设开满在上到成', c.nextChar)) return 'pu4';
    if (has('着了设开平垫盖陈排好满在上到成', c.nextChar) && !has('店床当驿', c.prevChar)) return 'pu1';
    // 铁匠铺 旧书铺 估衣铺: a shop, after the trade and before nothing or a place word.
    // Not after where or how it is spread (在上面铺, 平铺, 轻铺, 青石铺的, 旧日铺的) or a doubled word (急急铺铺).
    const spread = /[面上下里地轻平横满重新铺急乱斜石砖磚板草布毯沙土日天年时刚才]$/.test(c.prevTok) || doubledBefore(c);
    if (!spread && ((cpLen(c.prevTok) >= 2 && nextIs(c, '子里中前门的')) || (c.nextKnown !== false && !isHan(c.nextChar) && isHan(c.prevChar)))) return 'pu4';
    if (has('店床当驿', c.prevChar) || has('子', c.nextChar)) return 'pu4';
    // 估衣铺 绸缎铺 金银铺 茶食铺 钱铺 (a shop of a trade): pù.
    // (黑烟铺地, 银铺世界: a one-character trade only before what a shop has or nothing.)
    if (/^(估衣|绸缎|金银|茶食|木货|杂货|铁匠|首饰|皮货|洋货|南货|香烛|豆腐|茶叶|裁缝|棺材|成衣|银器|水果|糕饼)$/.test(c.prevTok)
      || (/^(钱|肉|米|药|酒|饭|烟|油|盐|粮|鞋|银|当|铜|锡|香|面|纸)$/.test(c.prevTok) && (!isHan(c.nextChar) || has('里中门前去的子掌老伙兑窗内外', c.nextChar)))) return 'pu4';
    if (has('里', c.prevChar) && !isHan(c.nextChar)) return 'pu4'; // 十里铺
    return 'pu1';
  },
  更: (c) => {
    // 三更 一更 打更 更鼓 更夫: a watch of the night (gēng); otherwise the adverb "even more" (gèng).
    if (has('一二三四五六七八九十两半每初几', c.prevChar) && !has('比胜', c.nextChar)) return 'geng1';
    if (nextIs(c, '了')) return 'geng1'; // 更了颜色 (changed): the adverb never stands before 了
    if (has('鼓夫次漏点声', c.nextChar) || has('打守更', c.prevChar)) return 'geng1';
    return 'geng4';
  },
  // 差 is chāi "to send" in the old novels (差人, 差我去, 差张飞为先锋, 当差, 公差), chà "lacking, poor" in 差得远 差不多 差一点 and
  // chā "difference" in 差别 差距 差错. Nothing tells the first from the others by itself, so the others are listed.
  差: (c) => {
    // 明公差矣 (mistaken): chà.
    if (has('不点得远多些太极较矣', c.nextChar) || has('不太尚更还较最很真好', c.prevChar) || /^一[点步些口分毫寸]/.test(c.nextTok)) return 'cha4';
    if (has('别距异错价额池误值', c.nextChar)) return 'cha1';
    // 条件差。 县城差，: poor (chà) at the end of a clause, unless it is an errand (当差, 公差, 听差).
    if (c.nextKnown !== false && !isHan(c.nextChar) && prevIs(c, '有无')) return c.prevTok === '有' ? 'ci1' : 'cha1'; // 赏赐有差 (in due degrees); 赏罚无差 (without fail)
    // 先差『黑旋风』李逵, 再差「神行太保」戴宗, 可差『鼓上蚤』时迁, 即时差「令」字旗 (sends someone named in quotes): chāi.
    if ((/^[「『“]/.test(c.nextTok) && (prevIs(c, '先再可便又就遂乃却') || /^(即时|随即|当即|立即|即便|于是)$/.test(c.prevTok)))
      || (/^，/.test(c.nextTok) && prevIs(c, '先遂乃') && c.tok !== undefined && isHan(firstCodePointOf(c.tok(2))))) return 'chai1';
    // 官差吏差, 奉玉帝点差, 蒙差, 委差, 科差 (a post, an errand): chāi.
    if (c.nextKnown !== false && !isHan(c.nextChar) && has('吏点蒙委科', c.prevChar)) return 'chai1';
    if (c.nextKnown !== false && !isHan(c.nextChar)) {
      // 高低之差, 引力差 (a difference): chā; 交不了差, 开了小差, 出了差, 神差 学差 应差 (an errand, a post): chāi.
      if (c.prevChar === '之' || /(引力|温|电位|压|高度|落)$/.test(c.prevTok)) return 'cha1';
      // (比当官的人差！ is "worse": 当 there is not the errand's verb.)
      const back = behind(c, 4);
      const k = back.findIndex((t, i) => i >= 1 && /^(交|开|出|当)$/.test(t));
      if (has('小神学远应', c.prevChar) || (k >= 1 && back.slice(0, k).every((t) => /^(不了|了|过|不|得|个|一|次|趟|好)$/.test(t)))) return 'chai1';
    }
    if (c.nextKnown !== false && !isHan(c.nextChar) && isHan(c.prevChar) && !has('当公出听钦信官解', c.prevChar)) return 'cha4';
    return 'chai1';
  },
  // 一场 is cháng unless a show or a game follows; 几场雨, 那场病, 这场大雪 (rain, an illness, a dream after any number or 这 那): cháng too.
  // A game, a show, a meeting or a campaign after 一场 (一场足球比赛, 一场点球大战, 一场以…为题举办的会议, 一场政治运动): chǎng.
  场: (c) => ((c.prevChar === '一' && !has('电影戏球赛考试会议演出展面景', c.nextChar) && !(cpLen(c.prevTok) === 1 && eventAhead(c)))
    || (has('二两三四五六七八九十几这那哪每', c.prevChar) && /^(雨|雪|病|大病|重病|大雨|暴雨|小雨|大雪|风雪|冰雹|梦|大梦|噩梦|恶梦|灾|大灾|灾难|浩劫|风波|官司|大火|仗|恶仗|硬仗|血战|大战)$/.test(c.nextTok)) ? 'chang2' : undefined),
  沈: (c) => {
    // 沈 is the old spelling of 沉 (沈吟 沈思 沈重 沈默); only as a surname (沈氏) is it Shěn.
    if (c.nextChar === '氏') return 'shen3';
    if (has('吟思重默醉痛迷浮没潜淀睡着溺落降', c.nextChar) || has('深昏消阴浮', c.prevChar)) return 'chen2';
    return isHan(c.prevChar) ? 'chen2' : 'shen3';
  },
  哄: (c) => {
    // 一齐都哄出堂后, 众人哄将来 (a crowd surging): hōng.
    if (has('堂笑动然', c.nextChar) || (/^(都|一齐|齐|一起|众人|众|一阵)$/.test(c.prevTok) && !has('我你他她它人', c.nextChar))) return 'hong1';
    if (has('起闹', c.prevChar) && !has('哄', c.nextChar)) return 'hong4';
    if (has('骗弄我你他她人孩哄劝', c.nextChar) || has('欺赚诓', c.prevChar) || (c.prevChar === '么' && /怎么$/.test(c.prevTok))) return 'hong3';
    if (nextIs(c, '了着得') && has('我你他她', c.afterChar ?? '')) return 'hong3'; // 如来哄了我
    // 哄那怪物, 把他哄将来, 哄出我来, 计哄了。 (to fool, to lure): hǒng.
    if (nextIs(c, '那这将出住过他') || (nextIs(c, '了') && !isHan(c.afterChar ?? '') && c.afterTok !== undefined && isHan(c.prevChar)) || (c.tok !== undefined && behind(c, 3).slice(1).includes('把'))) return 'hong3';
    return 'hong1';
  },
  征: (c) => (c.orig === '徵' ? (has('宫商角', c.prevChar) || c.nextChar === '羽' ? 'zhi3' : 'zheng1') : undefined), // 徵 is a note of the scale only there; 魏徵 is Zhēng
  累: (c) => (has('卵次月积世计及赘', c.nextChar) || has('连', c.prevChar) ? 'lei3' : undefined), // 累卵 累次 (lěi); 累了 stays lèi
  藏: (c) => (has('地三西宝道', c.prevChar) || prevIs(c, '蒙汉满回') ? 'zang4' : undefined), // 地藏王, 三藏, 西藏, 宝藏, 道藏, 蒙藏关系
  // 斗 is dǒu "a peck, the Dipper" (北斗 一斗米 木斗 斗府 斗然 = 陡然), dòu "to fight" otherwise.
  // 斗一斗, 和他一斗 (to fight once) stay dòu.
  // 与他三斗米, 三斗高粱，二斗小米 (a measure after any number but a lone 一) stay dǒu.
  斗: (c) => (has('星北南斗觔筋泰木米漏烟熨升', c.prevChar) || (/^[一二三四五六七八九十百半两几]+$/.test(c.prevTok)
    && !(c.prevTok === '一' && (!isHan(c.nextChar) || nextIs(c, '了')) && c.tok && ([2, 3].some((k) => c.tok!(-k) === '斗') || [3, 4].some((k) => /^(和|跟|与|同)$/.test(c.tok!(-k))))))
    || (c.alone !== false && nextIs(c, '府木然柄室篷笠胆')) ? 'dou3' : undefined),
  帖: (c) => {
    // 帖 is tiě, an invitation or a notice (请帖, 简帖, 揭帖); tiē "docile" only in 服帖 妥帖; tiè a copybook (字帖 碑帖).
    if (has('服妥贴俯', c.prevChar)) return 'tie1';
    if (has('字碑法临', c.prevChar)) return 'tie4';
    return 'tie3';
  },
  解: (c) => (has('送差官犯粮解赴京', c.nextChar) || nextIs(c, '来到上') && c.afterChar !== '衣' || has('押起发', c.prevChar) ? 'jie4' : undefined), // 押解 解送 解赴 解到: to escort a prisoner (jiè)
  没: (c) => (has('辱淹埋吞覆沉父母', c.prevChar) || (nextIs(c, '入') && !/^(党|学|伍|门|籍|会)/.test(c.afterTok ?? '')) ? 'mo4' : undefined), // 辱没 淹没, 父没观其行 (the father has died), 没入水中: mò
  恁: () => 'nen4', // 恁般 恁地 恁的: "such, so" in the novels
  咽: (c) => (has('呜哽咽', c.prevChar) || c.nextChar === '咽' ? 'ye4' : undefined), // 呜呜咽咽: sobbing
  // 什 is shí in 什物 什锦 and in a transliteration between other characters of one (米什内尔, 阿什): shí.
  // 比什头都要贵重: 什头 for 什么 (shén).
  什: (c) => (c.nextChar === '头' ? 'shen2' : has('物锦襲袭', c.nextChar) || (isHan(c.prevChar) && !has('么麼末', c.nextChar) && has(TRANSLIT_CHARS, c.prevChar) && (has(TRANSLIT_CHARS, c.nextChar) || !isHan(c.nextChar))
    && (c.alone !== false || [...c.prevTok, ...c.nextTok].every((ch) => has(TRANSLIT_CHARS, ch)))) ? 'shi2' : undefined),
  // 曾子 (Zēng, the disciple), not céng "once"; 曾祖 曾孙 曾外祖母 (great-): zēng.
  曾: (c) => ((has('子参', c.nextChar) && !isHan(c.prevChar)) || nextIs(c, '祖孙') || /^(外祖|祖父|祖母|孙子|孙女)/.test(c.nextTok) ? 'zeng1' : undefined),
  谯: () => 'qiao2', // 谯楼 (a gate tower), the surname Qiáo
  扎: (c) => {
    // 紮營 住紮, 紮駐 紮立營寨 紮兩個營寨 紮了寨柵 (to station troops), 收紮不住 紮腳不住 (to hold one's ground): zhā; 紮辮子 stays zā.
    if (c.orig === '紮') return has('寨营住驻屯立下根针脚', c.nextChar) || has('住屯驻虚收', c.prevChar)
      || (nextIs(c, '了两二三四五六七八九十一') && ahead(c, 4).slice(1).some((t) => /^(寨|营|营寨|寨栅|大寨|小寨|营盘)/.test(t))) ? 'zha1' : undefined;
    // 扎小辫 扎着两根辫子 腰扎皮带 扎成把 (to tie): zā.
    const tied = /^(小辫|辫|腰带|皮带|带子|头发|头绳|绳|把|紧|成|好|起)/;
    return tied.test(c.nextTok) || (nextIs(c, '着') && tied.test(c.afterTok ?? '')) || has('腰捆', c.prevChar) ? 'za1' : undefined;
  },
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
  // 说罢， 拜罢， 斋罢，: "having finished" (bà) when the clause goes on after a verb of the storyteller's formula; 才罢 方罢 便罢 too.
  罢: (c) => {
    if (!afterWord(c.prevChar) || has('作休善甘已未', c.prevChar)) return undefined;
    if (prevIs(c, '才方便')) return 'ba4';
    if (has('，、；：', c.nextChar) && has(FINISHED, c.prevChar)) {
      // 你快说罢， 回头再说罢， 想想罢， 听我说罢， (telling someone to) end with the particle; 说罢， (having said) goes on with the story.
      const back = behind(c, 5);
      return doubledBefore(c) || back.some((t, k) => k >= 1 && IMPERATIVE.includes(t)) ? 'ba5' : 'ba4';
    }
    return isHan(c.nextChar) ? undefined : 'ba5';
  },
  哩: (c) => (afterWord(c.prevChar) && !has('英海公', c.prevChar) ? 'li5' : undefined),
  // 喝 is hè "to shout" in 喝道 喝声 喝住 喝令 喝采 and after 大 (大喝一声); hē "to drink" otherwise.
  喝: (c) => (has('声道住令采彩止退骂醒', c.nextChar) || c.prevChar === '大' || ['一声', '叫', '问', '问道', '曰', '斩', '散', '拜', '教', '斥', '喊'].includes(c.nextTok) ? 'he4' : undefined),
  钯: (c) => (has('钉九', c.prevChar) || c.orig === '鈀' ? 'pa2' : undefined), // 钉钯 (the rake); 鈀 written in full is the rake of the novels, 钯 is the metal
  // 婀娜 袅娜 (nuó, graceful) is not the name Nà.
  娜: (c) => (has('婀袅嬝娉', c.prevChar) ? 'nuo2' : undefined),
  // 罢咧 我还抱你咧: the sentence-final particle lie; 咧嘴 (liě, to grin) keeps its tone before a word.
  咧: (c) => (afterWord(c.prevChar) && !isHan(c.nextChar) ? 'lie5' : undefined),
  // 挑 is tiǎo "to lift, to pick" after a weapon (枪挑) and before 开 起 拨 逗 战 衅 动 剔 灯 戏, tiāo "to carry on a pole, to choose" otherwise.
  // 担子 挑起来 (shouldered, tiāo); 竹竿 挑着 (lifted on a pole): tiǎo.
  挑: (c) => (/(担子|担|扁担|水|粪|柴|行李|担儿)$/.test(c.prevTok) ? 'tiao1'
    : has('枪刀剑', c.prevChar) || has('开起拨逗战衅动剔灯戏', c.nextChar) || behind(c, 3).some((t) => /([竿杆棍棒叉]|竿子|杆子|棍子|棒子)$/.test(t)) ? 'tiao3' : undefined),
  // 出则弟 孝弟 (the fraternal respect of the Analects) is tì, written 悌 now.
  弟: (c) => (has('孝则', c.prevChar) && !has('子兄', c.nextChar) ? 'ti4' : undefined),
  莎: (c) => (c.nextChar === '草' || has('枯香青', c.prevChar) ? 'suo1' : undefined), // 枯莎 莎草: sedge (suō); 莎士比亚 stays shā
  塞: (c) => (has('边要关出', c.prevChar) ? 'sai4' : undefined), // 边塞, 要塞: a frontier fort
  // 担 is dàn, a carrying pole's load, after 挑 货 满 or a number and before 儿 (挑担 一担 担儿), dān "to carry, to bear" otherwise.
  担: (c) => (has('挑货满菜柴粮', c.prevChar) || /^[一二三四五六七八九十百千两几半]+$/.test(c.prevTok) || nextIs(c, '儿') ? 'dan4' : undefined),
  // 撒在 撒了一地 撒下 撒满 撒花 (to scatter): sǎ; 撒手 撒谎 撒娇 (to let go) are words, sā.
  // 撒些盐, 撒一把种子 (scattered): sǎ.
  撒: (c) => (nextIs(c, '在下上满到花种盐遍落入进向') || (/^(些|点|一把|一些|一点|把)$/.test(c.nextTok) && /^(盐|种|土|米|沙|灰|石灰|胡椒|面|糖|药|花|粉)/.test(c.afterTok ?? '')) ? 'sa3' : undefined),
  // 扇 is shān "to fan, to slap" (扇了她一巴掌, 扇着风, 连扇), shàn "a fan" otherwise.
  // 两扇门, 羽扇一摇 (the fan, the measure word) stay shàn.
  扇: (c) => (has(NUMERALS + '羽折纸团蒲宫', c.prevChar) ? undefined
    : nextIs(c, '了着得起动灭去到') || has('我你他她', c.nextChar) || /^(耳光|风|一|火|炉火)/.test(c.nextTok) || prevIs(c, '用连') ? 'shan1' : undefined), // 扇火: shān
  // 挨 is ái "to suffer, to endure" (挨了一枪 挨打 挨批评 挨日子), āi "next to, one by one" (挨着 挨家挨户).
  // 挨到床上 挨到一起 挨到他身旁 一步步挨上岭 (edging up to, touching): āi; 挨到天亮 好不容易挨到了 (enduring until): ái.
  挨: (c) => {
    const on = ahead(c, 4).slice(1);
    if (nextIs(c, '到上下进近') && !on.some((t) => /^(晚上|早上|天亮|天明|半夜|明天|第二天|中午|下午|黄昏|傍晚|天黑|今天|现在|年|月|日|夜|更|五更|三更|四更|二更|明日|来日)/.test(t))
      && (nextIs(c, '上下') || on.some((t) => /[上下前边旁里头面身]$|^(一起|一块|地|床|门口|跟前)/.test(t)))) return 'ai1';
    return nextIs(c, '了过到') || /^(打|骂|批|揍|饿|冻|训|整|斗|枪|刀|日子|鞭|耳光|罚)/.test(c.nextTok)
      || (/^(点|顿|些)$/.test(c.nextTok) && /^(打|骂|揍|批)/.test(c.afterTok ?? '')) ? 'ai2' : undefined;
  },
  // 晃 is huàng "to sway, to shake" (晃了晃 晃着 晃脑袋 东摇西晃), huǎng "to flash past" (一晃 晃眼).
  // 晃身拦住, 东闪西晃 (to flash past, to dodge), 祥光晃晃 (dazzling): huǎng.
  晃: (c) => (prevIs(c, '一') || nextIs(c, '眼过身') || behind(c, 3).some((t) => t.includes('闪'))
    || ((c.nextChar === '晃' || c.prevChar === '晃') && c.tok !== undefined && [-3, -2, -1, 1, 2, 3].some((k) => /[光霞金亮灯耀]/.test(c.tok!(k)))) ? 'huang3'
    : nextIs(c, '了着动荡悠来去晃') || /^(脑袋|头|手|腿|肩)/.test(c.nextTok) || has('摇摆西打', c.prevChar) ? 'huang4' : undefined), // 直打晃: swaying
  // 转 is zhuàn "to spin, to stroll" (转着 转圈 转了一圈 到处转 转了转), zhuǎn "to turn, to shift" otherwise.
  // 转一圈, 转了一圈 cut 转|了|一|圈 (a turn around): zhuàn.
  转: (c) => (nextIs(c, '着圈悠') || /^(圈|几圈)/.test(c.nextTok) || (nextIs(c, '了') && /^(一圈|几圈|圈|转)/.test(c.afterTok ?? '')) || ['到处', '乱', '团团', '四处'].includes(c.prevTok)
    || /^了?[一两几三四五六七八九十]+(个)?圈/.test(ahead(c, 4).join('')) ? 'zhuan4' : undefined),
  // 冲 is chòng "facing, at" (冲他笑, 冲着我, 门冲南), chōng "to rush" otherwise.
  // 水流冲着南瓜, 冲他大营 (rushing at, charging): chōng.
  冲: (c) => (has('水流浪风洪潮', c.prevChar) || behind(c, 4).some((t) => /^(水|水流|河水|海水|浪|风|洪水|潮水|激流|急流|浪头)$/.test(t)) || (has('他她', c.nextChar) && ahead(c, 3).slice(1).some((t) => /[营队阵军寨城]$/.test(t))) ? undefined : has('我你他她它您咱', c.nextChar) || (nextIs(c, '南北东西') && !has('东西南北', c.prevChar)) || (nextIs(c, '着') && /^(我|你|他|她|它|您|咱|这|那|人)/.test(c.afterTok ?? ''))
    // 冲着 + someone + 喊 (shouted at someone named): chòng, a call or a look a few words on.
    || (nextIs(c, '着') && c.tok !== undefined && [3, 4].some((k) => /^(喊|叫|嚷|吼|骂|笑|说|点头|招手|挥手|喊道|叫道|大喊|大叫|喊叫|嚷道|笑了笑|直笑)$/.test(c.tok!(k)))) ? 'chong4' : undefined),
  // 脏 is zāng "dirty"; zàng "an organ" lives in words (心脏 内脏 五脏) and in 臟.
  脏: (c) => (c.orig === '臟' || has('五内心肝肾脾肺腑', c.prevChar) ? 'zang4' : 'zang1'),
  // 幢 after a number is zhuàng, the measure word for buildings (一幢屋子); chuáng is a banner.
  幢: (c) => (has(NUMERALS, c.prevChar) ? 'zhuang4' : undefined),
  // 钉 is dìng "to nail, to sew on" before what is done with it (钉着 钉在 钉好 钉鞋), dīng "a nail" otherwise.
  // 一双钉鞋 (hobnailed shoes) is the noun dīng; 钉鞋掌 钉十字架 are dìng.
  // 钉鞋工具 钉鞋摊 (a cobbler's): dìng.
  钉: (c) => (nextIs(c, '着在了上住进好死') || /^(扣|十字架|鞋匠)/.test(c.nextTok) || (/^鞋/.test(c.nextTok) && (!has('的双雙穿新旧', c.prevChar) || /^(工具|摊|匠|手艺|生意|的手艺)/.test(c.afterTok ?? ''))) ? 'ding4' : undefined),
  // 划 is huá "to scratch, to row, to strike (a match)" (划开 划破 划火柴 划船), huà "to mark, to plan" otherwise.
  划: (c) => (!has('指比筹计规', c.prevChar) && nextIs(c, '开破过着动亮燃') || /^(火柴|船|桨|水)/.test(c.nextTok) ? 'hua2' : undefined), // 划燃 (a match): huá
  // 削 is xiāo "to peel, to cut" in running text; xuē in 削减 削弱 削平 削发 削职.
  // 削壁 悬崖削壁 削肩 改削 斫削, 削去兵权 削了官职 削他威风, 徐徐削之: the literary xuē.
  削: (c) => {
    if (has('减弱平职发籍夺', c.nextChar)) return undefined;
    if (has('壁肩背翠之绝', c.nextChar) || has('悬崖峭陡改批斫刻孤剥', c.prevChar) || ahead(c, 5).some((t) => /^(兵权|官职|职|职役|爵|籍|本身|威风|锐气|封地|权)/.test(t))) return 'xue1';
    // 削铁如泥, 断金削玉, 尖嘴削腮, 削耳 (the literary set phrases and shapes), 尖削, 剃削, 削去髭须, 削削尖峰, 削峰, 山石如削。, 魏削则…: xuē.
    if (has('铁玉腮耳颊峰', c.nextChar) || prevIs(c, '尖剃日') || has('削', c.prevChar) || c.nextChar === '削' || ahead(c, 3).some((t) => /^(髭须|胡须|须发|头发)/.test(t))
      || (prevIs(c, '如') && !isHan(c.nextChar) && c.nextKnown !== false) || nextIs(c, '则')) return 'xue1';
    return 'xiao1';
  },
  // 涨 is zhàng "to swell, to flush" (脖子涨得通红), zhǎng "to rise" otherwise.
  涨: (c) => ((nextIs(c, '得') && /^(通红|红|紫|发|鼓|满|难受|生疼)/.test(c.afterTok ?? '')) || /^(红|紫)/.test(c.nextTok) || has('脸头肚腹红', c.prevChar) || nextIs(c, '脸') ? 'zhang4' : undefined),
  // 屏住呼吸 屏息 屏着气: bǐng.
  屏: (c) => (nextIs(c, '住息气着') ? 'bing3' : undefined),
  // 咳 is ké "to cough" after a word or before 了 着 得 嗽; hāi, the sigh, starts a clause.
  咳: (c) => (isHan(c.prevChar) || nextIs(c, '了着得嗽出起') ? 'ke2' : undefined),
  // 撇了撇嘴 嘴一撇 (a stroke): piě; 撇开 撇下 撇了钉钯 (to cast aside): piē.
  撇: (c) => (nextIs(c, '嘴着') || prevIs(c, '一') || (nextIs(c, '了') && /^撇/.test(c.afterTok ?? '')) ? 'pie3' : undefined),
  // 垛 is duò "a stack" (草垛 麦垛 叶子垛); duǒ is a battlement (城垛 垛口 垛楼, 垛叠齐排) or a target (箭垛).
  垛: (c) => (has('城箭', c.prevChar) || has('口楼叠', c.nextChar) ? 'duo3' : 'duo4'),
  // 一溜 (a row): liù.
  溜: (c) => (prevIs(c, '一') && (!isHan(c.nextChar) || nextIs(c, '儿烟')) ? 'liu4' : undefined),
  // 一撮毛 一撮胡子: zuǒ, a tuft.
  撮: (c) => (/^(毛|黑毛|白毛|胡子|头发|山羊胡)/.test(c.nextTok) ? 'zuo3' : undefined),
  // 呢礼帽 呢大衣: ní, woolen cloth.
  呢: (c) => (/^(礼帽|帽|大衣|料|绒|制服|裤|军装)/.test(c.nextTok) ? 'ni2' : undefined),
  // 驴圈 马圈: juàn, a pen.
  圈: (c) => (has('驴马牛猪羊鸡', c.prevChar) && c.alone !== false ? 'juan4' : undefined),
  // 泊 is bó "to moor" (湾泊 泊入轨道); pō in 梁山泊 (a lake).
  泊: (c) => (nextIs(c, '入在着了于') || has('停湾', c.prevChar) ? 'bo2' : undefined),
  // 绷着脸 脸绷了: běng.
  绷: (c) => (has('脸嘴', c.prevChar) || /^(脸|着脸)/.test(c.nextTok) || (nextIs(c, '着') && /^脸/.test(c.afterTok ?? '')) ? 'beng3' : undefined),
  // 弄里 弄堂 弄口: lòng, a lane.
  // 先去弄口锅来 (get a pot) is nòng.
  弄: (c) => ((nextIs(c, '里堂') || (nextIs(c, '口') && (!isHan(c.afterChar ?? '') || /^(的|处|站|外|边|上|里|前|有|停|旁)/.test(c.afterTok ?? '')))) && c.alone !== false ? 'long4' : undefined),
  // 背纤 拉纤: qiàn, a tow rope.
  纤: (c) => (has('背拉', c.prevChar) ? 'qian4' : undefined),
  // 一杆抬秤: gǎn, the measure word.
  杆: (c) => (/^[一二三四五六七八九十两几]+$/.test(c.prevTok) ? 'gan3' : undefined),
  // 笼上 笼着 (to cover): lǒng.
  笼: (c) => (nextIs(c, '上着住') && !has('熏鸟蒸竹灯牢樊囚鸡香', c.prevChar) ? 'long3' : undefined), // 熏笼上 is the cage (lóng)
  // 鸟 is diǎo, the curse of the old novels, in 甚么鸟 撮鸟 鸟男女 鸟人; niǎo "a bird" otherwise.
  鸟: (c) => (/(甚么|撮|直娘)$/.test(c.prevTok) || ['男女', '人', '事', '气', '汉', '官', '货', '位'].includes(c.nextTok) ? 'diao3' : undefined),
  // 唱个喏 声喏 唱个大喏: rě, a bow with a greeting; nuò "yes" otherwise.
  喏: (c) => (prevIs(c, '个唱声大') ? 're3' : undefined),
  // 赚 is zuàn "to trick, to lure" (赚我 赚开城门 赚入), zhuàn "to earn" otherwise.
  // Written 賺 (the old novels) it is the trick unless money is earned (賺了, 賺得, 賺錢 is a word).
  // 赚他的工资, 赚出一笔钱, 钱也赚够了, 赚的钱 (to earn): zhuàn.
  // 吃他赚漏了 (tricked into a slip): zuàn, whatever money is named after it.
  // 来赚他的“工资” (the money in quotes), 大家赚不成 (cannot earn): zhuàn.
  赚: (c) => (nextIs(c, '漏') ? 'zuan4' : ahead(c, 8).some((t) => /钱|工资|银|票|利|薪|元|块/.test(t)) || nextIs(c, '的够') || /^不/.test(c.nextTok)
    || moneyPastQuotes(c) ? undefined
    : has('我你他她汝', c.nextChar) || nextIs(c, '开入出进漏') || /^(城门|开)/.test(c.nextTok)
    || (c.orig === '賺' && isHan(c.nextChar) && !/^(了|得|到|取|回|大|些|点|钱|銀|银)/.test(c.nextTok)) ? 'zuan4' : undefined),
  // 杀奔 径奔 直奔 望…奔 (heading for): bèn; bēn "to run" otherwise.
  // 东奔西突, 南奔北走: running about (bēn), not heading somewhere.
  奔: (c) => (prevIs(c, '东南西北') && /^[东南西北]/.test(c.nextTok) ? 'ben1' : prevIs(c, '杀径直投望竟') || /杀$/.test(c.prevTok) ? 'ben4' : undefined),
  // 给散 给赏 给还 资给 (to supply, to issue): jǐ; gěi otherwise.
  // 给发 (to issue) only as the old books write it (給發); 每月再给发一袋米 is the everyday gěi.
  给: (c) => (nextIs(c, '散赏还付') || (nextIs(c, '发') && c.orig === '給' && !has('再甭不还也都就要得会没别先又', c.prevChar)) || has('资', c.prevChar) ? 'ji3' : undefined),
  // 能勾 (= 能够, can): gòu.
  勾: (c) => (c.prevChar === '能' && !/^(结|引|搭|当|画|销|勒)/.test(c.nextTok) ? 'gou4' : undefined),
  // 参商 参宿 (a constellation), 参仙 (ginseng): shēn.
  参: (c) => (nextIs(c, '仙商宿') ? 'shen1' : undefined),
  // 刹裤子, 刹住, 刹车 (to tighten, to brake): shā; 古刹, 宝刹 (a temple) are chà.
  刹: (c) => (/^(住|紧|车|闸|不住|裤|腰带|裤带)/.test(c.nextTok) ? 'sha1' : undefined),
  // 谈吐隽雅, 隽永, 隽语 (meaningful): juàn; in names (朱隽) and 俊 senses jùn.
  隽: (c) => (has('永语雅味', c.nextChar) || /(谈吐|言语|言谈|文笔|文字|诗句|语言)$/.test(c.prevTok) ? 'juan4' : undefined),
  // 胡茄 for 胡笳, the reed pipe (jiā).
  茄: (c) => (prevIs(c, '胡') ? 'jia1' : undefined),
  // 木杈, 草杈, 粪杈 (a pitchfork): chā; 树杈, 枝杈 (a fork in a branch) are chà.
  杈: (c) => (prevIs(c, '木铁钢竹草粪') ? 'cha1' : undefined),
  // 双煞 凶煞 地煞 (a fiend): shà; shā "to stop" otherwise.
  煞: (c) => (has('双凶恶地天星神', c.prevChar) ? 'sha4' : undefined),
  // 宁作 宁为 宁死 (would rather): nìng; níng "peaceful" otherwise.
  宁: (c) => (nextIs(c, '作为死愿肯') ? 'ning4' : undefined),
  // 止血散 金疮散 (a powder) and 散手: sǎn.
  // 架子要散了 (falling apart, as in 散架): sǎn.
  散: (c) => (has('血疮毒药', c.prevChar) && !isHan(c.nextChar) || nextIs(c, '手') || (nextIs(c, '了') && behind(c, 4).slice(1).some((t) => /架/.test(t))) ? 'san3' : undefined),
  // 忒 is tuī "too" before an adjective or 也 in the old vernacular; tè "to err".
  忒: (c) => (isHan(c.nextChar) ? 'tui1' : undefined),
  // 观 is guàn, a Daoist temple, in 观里 观中 观主 道观 (五庄观 is a name).
  观: (c) => (nextIs(c, '里中内门主外前后') || prevIs(c, '道寺庙') ? 'guan4' : undefined),
  // 御马监 (an office of the court): jiàn.
  监: (c) => (has('马天子', c.prevChar) && !isHan(c.nextChar) ? 'jian4' : undefined),
  // 怒号 悲号 哀号 (to howl): háo.
  号: (c) => (has('怒悲哀呼', c.prevChar) ? 'hao2' : undefined),
  // 强笑 强留 强要 强欲 (forcing oneself or another): qiǎng; qiáng "strong" otherwise.
  // 仆 is pū "to fall" after 跌 颠 前 僵 (跌仆在地), pú "servant" otherwise.
  仆: (c) => (has('跌颠顛前僵偃', c.prevChar) || (nextIs(c, '倒地') && !isHan(c.prevChar)) ? 'pu1' : undefined),
  // (A given name after a surname read alone, 王|强打了…, stays qiáng.)
  强: (c) => ((nextIs(c, '笑留要欲求忍撑辩占逼') || /^(打|颜|笑)/.test(c.nextTok)) && !(prevIs(c, GIVEN_NAME_SURNAMES) && c.alone !== false) ? 'qiang3' : undefined),
  // 与 closing a question (其为仁之本与？): yú, the particle written 欤.
  与: (c) => (has('之本谓也者乎', c.prevChar) && has('？?！', c.nextChar) ? 'yu2' : undefined),
  // 说 is yuè (= 悦) in 不亦说乎, shuì "to persuade" in 往说之 (going to win someone over).
  说: (c) => (c.nextChar === '乎' && prevIs(c, '亦') ? 'yue4' : prevIs(c, '往来') && c.nextChar === '之' ? 'shui4' : undefined),
  // 哪 after a word at the end of a clause is the particle na (救人哪，天哪); 在哪 去哪 (where) keep nǎ.
  哪: (c) => (afterWord(c.prevChar) && !isHan(c.nextChar) && !has('在去到从往上于向是', c.prevChar) ? 'na5' : undefined),
  // Erhua: 儿 after a Han character is the suffix r (花儿, 玩意儿) unless a dictionary word claims it.
  儿: (c) => {
    // In a transliteration (斡儿朵 Ordo, 篾儿乞 Merkit, 合撒儿 Qasar, 蒲儿帖) 儿 is a full syllable, ér.
    if (has('斡篾蔑撒帖蒲脱忽', c.prevChar) || (isHan(c.nextChar) && has('斡篾蔑撒帖蒲脱忽', c.prevTok.slice(-2, -1)))) return 'er2';
    // The last syllable of a foreign name (珀拉儿, 诺孜贝儿, 铁木儿): ér after two or more characters that spell foreign names.
    if (foreignBefore(c)) return 'er2';
    // 吾儿 我儿 爱儿 干儿 (a son): ér.
    if (prevIs(c, '吾我汝爱干孤犬豚') || (c.prevChar === '的' && c.tok !== undefined && has('我你他她', c.tok(-2)))) return 'er2';
    return isHan(c.prevChar) ? 'r5' : 'er2';
  },
  // 子 as a noun suffix the dictionary lacks (簪|子, 穗|子, 这会|子, 高粱秸|子) is neutral; a real 子 "son, master, seed" keeps zǐ:
  // 之子 其子 二子 生子 孔子, 长春子 (a Daoist name), 子曰 at the start of a clause, 子孙 子女.
  子: (c) => {
    // Inside a name read on its own (a word of the book's list of names), nothing says it is a suffix.
    if (c.nextKnown === false) return undefined;
    if (!isHan(c.prevChar) || has(ZI_FULL_AFTER + NUMERALS, c.prevChar)) return undefined;
    // The classical son (兄子 我子 诤子 假子 厥子 立子为嗣, 以他为子, 待之如子, 父见子, 山鸡哺子, 麒麟子, 才俊子) and 子书 母以子贵: zǐ.
    if (has('兄如诤假厥哺麟俊', c.prevChar) || prevIs(c, '为我立') || /见$/.test(c.prevTok) || has('书贵', c.nextChar)) return undefined;
    // 生了子, 得了子 (a son).
    if (c.prevTok === '了' && c.tok !== undefined && /^[生得产育]$/.test(c.tok(-2))) return undefined;
    // 子孙 子女 子曰, the hour 子时 子夜 子初 子末 子会 (子、丑、寅), 子城 子衿 樟子松, 子父二人, 子之…: 子 begins a word.
    if (has('孙女侄姪弟母父嗣民规曰云爵夜时午丑弹初末亥会城衿松之', c.nextChar) || nextIs(c, COURTESY) || (c.nextChar === '、' && c.afterChar === '丑')) return undefined;
    // 吕子明 cut 吕|子|明白 (a surname, then a courtesy name in 子), 风流子 (a dashing young man): zǐ.
    if ((prevIs(c, '吕刘张关赵孙曹周陆鲁马黄魏姜王李庞徐吴甘凌蒋董袁韩夏许荀郭程贾邓杨') && has(COURTESY, c.nextChar)) || c.prevTok === '风流') return undefined;
    return 'zi5';
  },
  // 尽 merges 盡 jìn (to use up, all: 尽皆 散尽 尽责任) and 儘 jǐn (as far as possible: 尽可 尽着, and the words 尽管 尽量 尽快).
  尽: (c) => {
    if (c.orig === '儘') return 'jin3';
    // 尽著他吃, 别尽著想 (keep on): jǐn, however the book writes it (the old novels use 盡 for both).
    // 车仗尽著， (all caught fire), 四面尽著军马, 尽著北军旗号 (all wearing, all with): jìn.
    if (nextIs(c, '着著') && ((c.tok !== undefined && !isHan(firstCodePointOf(c.tok(2)))) || /^(军马|军|北|南|旗|衣|甲|盔|红|白|青|黑|黄)/.test(c.afterTok ?? ''))) return 'jin4';
    if (nextIs(c, '着著')) return 'jin3';
    // 尽可留著, 尽够了, 都有尽让的, 尽让他些 (as one likes, quite enough, to give way), 别尽著迷 (keep on), 先尽他姊妹 (let them go
    // first): jǐn, however the book writes it (the old novels use 盡 for both).
    if (nextIs(c, '可够让') || (/^[着著]/.test(c.nextTok) && /^(别|不要|只|总|老)$/.test(c.prevTok)) || (prevIs(c, '先') && has(PRONOUNS, c.nextChar))) return 'jin3';
    if (c.orig === '盡') return 'jin4';
    return has('可够', c.nextChar) || nextIs(c, '自') ? 'jin3' : 'jin4';
  },
  // 汗 is hán "khan" in 大汗 诸汗 汗位 汗国 (成吉思汗 and 可汗 are words), hàn "sweat" otherwise.
  汗: (c) => (prevIs(c, '大诸可众') && !/^(淋|直流|如雨|如注|涔|浃|珠|滴|湿|流)/.test(c.nextTok) || nextIs(c, '位国廷帐') || /^(位子|国)/.test(c.nextTok) ? 'han2' : undefined),
  // 背 is bēi "to carry on the back" before what is carried or where it goes (背起 背回家 背你 背书包 背石头), bèi otherwise
  // (背过脸 背书 背叛, and 背着 is in WORD_READINGS).
  背: (c) => {
    if (CARRIED.test(c.nextTok)) return 'bei1';
    // 学生们依次背了一段, 一字一句地背 (reciting in turn, word by word): bèi.
    if (/^(依次|挨个|挨个儿|逐字|逐句|一字一句|一句一句|一字不漏|流利|熟练|从头)地?$/.test(c.prevTok)) return undefined;
    if (nextIs(c, '过') || /手$/.test(c.prevTok) || /^(诵|叛|弃|影|景|面|部|脸|书|课文|台词|熟|心|后|离|驼)/.test(c.nextTok) || c.prevChar === '靠') return undefined;
    // Reciting a text (背了一遍, 背到第三页, 才背出一成) or saddling a horse (背了马): bèi.
    if (ahead(c, 4).slice(1).some((t) => /[遍页经诀诗篇章句]$|^(一成|许多|书$|马$|白马|马匹|口诀|经文|课文)/.test(t))) return undefined;
    // 何敢背我, 必不背我 (to betray): bèi.
    if (has('我你他她您', c.nextChar) && (has('敢岂', c.prevChar) || /必不$/.test(c.prevTok) || (c.prevTok === '不' && c.tok !== undefined && /^(必|决|绝|誓|岂)$/.test(c.tok(-2))))) return undefined;
    // 背人悄问, 背人之处 (out of sight): bèi; 背人过河 carries.
    // 叫骆驼下来背人。 (came down to carry them): bēi.
    if (c.nextTok === '人') return /^[过上下走到进出起]/.test(c.afterTok ?? '') || (/[来去]$/.test(c.prevTok) && !isHan(c.afterChar ?? '') && c.afterTok !== undefined) ? 'bei1' : undefined;
    // 背了兄长 (betrayed), 若从了老兄背了姑母 (went against), 莫背了沙僧 (behind his back), 背了是非 (talked behind backs): bèi.
    if (nextIs(c, '了') && (/^(兄长|姑母|朝廷|主公|盟约|誓言|恩|义|信义|是非|约)/.test(c.afterTok ?? '') || prevIs(c, '莫'))) return undefined;
    // 背在身后 的 手 (hands behind the back): bèi.
    if (nextIs(c, '在') && /^(身后|背后)$/.test(c.afterTok ?? '') && c.tok !== undefined && c.tok(3) === '的' && /手$/.test(c.tok(4))) return undefined;
    // 背|上 包袱 (put on the back); the word 背上 (on the back) is the noun. 背回家, 我来背， (carrying): bēi.
    if ((c.alone !== false && nextIs(c, '起回到在上走进出下了好')) || /^(起来|回来|回去|上来|下来|回家|回村|回城|回屋)$/.test(c.nextTok)
      || (prevIs(c, '来去') && c.nextKnown !== false && !isHan(c.nextChar) && c.tok !== undefined)) return 'bei1';
    return has('我你他她您', c.nextChar) ? 'bei1' : undefined;
  },
  // 待 is dāi "to stay" in 待在 待着 待下去 待不住 待一会儿 待了半年, dài "to treat, to wait" otherwise.
  // 待这么久, 待得太久, 再待一天 (stayed so long, one more day): dāi.
  待: (c) => (nextIs(c, '在着久') || /^(下去|下来|不住|会儿|一会|一阵|一天|多久|多长)/.test(c.nextTok)
    || (/^(这么|那么)$/.test(c.nextTok) && /^(久|长)/.test(c.afterTok ?? '')) || (nextIs(c, '得') && /^(太|很|好|久|这么|那么)/.test(c.afterTok ?? ''))
    || (prevIs(c, '再多又还') && /^[一二两三四五六七八九十几半]+$/.test(c.nextTok) && /^(天|日|年|月|会|个|宿|晚|夜)/.test(c.afterTok ?? ''))
    || (c.nextTok === '会' && has(PRONOUNS + '再就儿', c.afterChar ?? '')) // 待会我叫她们 (in a moment)
    || (c.nextTok === '了' && (/^[一二两三四五六七八九十半几好多些片]/.test(c.afterTok ?? '') || (!isHan(c.afterChar ?? '') && c.afterTok !== undefined && has('地里儿', c.prevChar))))
    || (c.nextTok === '过' && /^[一二两三四五六七八九十半几]/.test(c.afterTok ?? '')) ? 'dai1' : undefined),
  // 甚 is shén "what" in the older vernacular before what is asked about (甚事 甚人 甚东西), shèn "very" otherwise (甚是 甚好).
  // 做甚？ 干甚， 因甚 为甚 (doing what, why): shén too.
  甚: (c) => (nextIs(c, '事人处话物鸟') || /^(东西|意思|样|般|时候|道理|缘故|计策|勾当|模样|心事|主意|法子|办法|用处|好处)/.test(c.nextTok)
    || (prevIs(c, '因为') && isHan(c.nextChar) && !has('么麼至于为', c.nextChar))
    || (c.nextKnown !== false && !isHan(c.nextChar) && prevIs(c, '做作干说要怕看问叫闹笑哭等想慌急')) ? 'shen2' : undefined),
  // 和面 和泥 (to knead, to mix): huó.
  // 和好的面团, 和匀了面 (kneading the dough): huó.
  和: (c) => (c.alone !== false && (nextIs(c, '泥面') || (nextIs(c, '好匀成') && ahead(c, 4).slice(1).some((t) => /^(面|面团|面粉|的面|泥)$/.test(t)))) ? 'huo2' : undefined),
  // 闷着头, 闷头 (silently): mēn.
  // 闷得慌, 闷得发慌 (stuffy): mēn.
  闷: (c) => (nextIs(c, '头') || (nextIs(c, '着') && /^(头|声)/.test(c.afterTok ?? '')) || (nextIs(c, '得') && /^(慌|发慌)/.test(c.afterTok ?? '')) ? 'men1' : undefined),
  // 想吐, 吐血, 吐出胃液 (to vomit): tù; 吐痰 吐了口气 stay tǔ.
  吐: (c) => ((prevIs(c, '想要呕') && !isHan(c.nextChar) && c.nextKnown !== false) || /^(血|白沫|胃液|酸水|苦水)/.test(c.nextTok)
    || (nextIs(c, '出了') && /^(胃|血|酸水|苦水|白沫)/.test(c.afterTok ?? '')) ? 'tu4' : undefined),
  // 呛人, 呛鼻 (pungent): qiàng.
  呛: (c) => (nextIs(c, '人鼻') ? 'qiang4' : undefined),
  // 呱唧 呱呱 (a clap, a croak): guā.
  呱: (c) => (has('唧呱哒嗒', c.nextChar) ? 'gua1' : undefined),
  // 绰了禅杖, 绰枪 (to grab a weapon): chāo; 巡绰 绰约 stay chuò.
  绰: (c) => (nextIs(c, '了起着') || has('枪鎗刀剑棍杖斧戟槊锤鞭', c.nextChar) ? 'chao1' : undefined),
  // 荷蒙, 甚荷, 荷锄, 荷明公宽大 (indebted, to carry): hè.
  荷: (c) => (has('蒙锄戈担恩', c.nextChar) || prevIs(c, '甚感负承') || /^(明公|将军|丞相|主公|大王|陛下)/.test(c.nextTok + (c.afterTok ?? '')) ? 'he4' : undefined),
  // 万箭攒心, 攒眉, 攒盘 (to converge, a cluster): cuán.
  攒: (c) => (has('心盘聚簇眉攒', c.nextChar) ? 'cuan2' : undefined),
  // 万物否矣, 否极 (stagnant): pǐ.
  否: (c) => (nextIs(c, '矣极') || prevIs(c, '泰') ? 'pi3' : undefined),
  // 远耻辱也, 敬而远之 (to keep away from): yuàn.
  远: (c) => (/^(耻辱|小人|鬼神|佞人)/.test(c.nextTok) || (prevIs(c, '而') && nextIs(c, '之')) ? 'yuan4' : undefined),
  // 返景入深林 (= 返影): yǐng.
  景: (c) => (prevIs(c, '返') ? 'ying3' : undefined),
  // 术赤 (Jochi, Genghis Khan's eldest son): zhú, as in 博尔术.
  术: (c) => (c.nextChar === '赤' ? 'zhu2' : undefined),
  // 消息渐阙 (to be lacking): quē; 宫阙 (palace towers) is a word.
  阙: (c) => (has('渐残缺补拾', c.prevChar) ? 'que1' : undefined),
  // 七年四月二日识 (recorded, signed after a date): zhì.
  识: (c) => (c.prevChar === '日' && c.nextKnown !== false && !isHan(c.nextChar)
    && (/^[一二三四五六七八九十廿卅初]+日$/.test(c.prevTok) || (c.tok !== undefined && /^[一二三四五六七八九十廿卅初]+$/.test(c.tok(-2)))) ? 'zhi4' : undefined),
  // 吓，什么都瞒不过我 (the interjection, opening a clause): hè.
  吓: (c) => (!isHan(c.prevChar) && c.nextKnown !== false && /^[，！,!]/.test(c.nextTok) ? 'he4' : undefined),
  // 折了本 折本 (to lose money): shé.
  折: (c) => (nextIs(c, '本') || (nextIs(c, '了') && /^本/.test(c.afterTok ?? '')) ? 'she2' : undefined),
  // 那 for 哪 in the older vernacular: 那知 (how could one know), 那肯 那敢 那容.
  // 那有这事 (how could there be: opening a clause): nǎ.
  // 那知 那肯 那容不下人 (who knew, how could one = 哪).
  // In a book that writes 那 for 哪 (core/bookStyle.ts): 那一株…不…？, 那得功夫来看 (which, how could): nǎ.
  那: (c) => (c.spellings?.naAsWritten ? undefined : nextIs(c, '知肯敢容') || /^容[不得]/.test(c.nextTok) || (nextIs(c, '有') && !isHan(c.prevChar) && /^(这|此|这样|这等|这般|这种)/.test(c.afterTok ?? ''))
    || (c.spellings?.na && c.alone !== false && naAsks(c)) ? 'na3' : undefined),
  // 底 written for the particle 的 in a book that does so throughout (core/bookStyle.ts): 她底眼睛, 敏明底父亲, 躺着底，. The noun
  // stays: before 下 细 里 … (底|下, 箱底|里), in a word (鞋底, 到底), before 的, ending a run of transliteration characters (婆|多|瓦|底),
  // and a one-character noun's bottom before what it does (滩底呜咽).
  底: (c) => {
    if (!c.spellings?.di || c.alone === false) return undefined;
    if (!isHan(c.prevChar) && !has('」』”’）', c.prevChar)) return undefined;
    if (nextIs(c, '的下细子层部片线气牌座薪盘蕴色板价本稿数限端里上')) return undefined;
    // (所见|底|东西, 到|底|时候: a verb the cut took apart from 底 before a noun is not the word 见底 到底.)
    const beforeNoun = cpLen(c.nextTok) === 2 && (c.word?.(c.nextTok) ?? false) && (c.verb?.(c.nextTok) ?? 1) === 0 && (c.verb?.(c.prevTok) ?? 0) >= 1;
    if (cpLen(c.prevTok) === 1 && ((!beforeNoun && (c.word?.(c.prevTok + '底') ?? false)) || (c.tok && has(TRANSLIT_CHARS, c.prevChar) && cpLen(c.tok(-2)) === 1 && isHan(c.tok(-2))))) return undefined;
    if (isHan(c.nextChar)) return cpLen(c.prevTok) === 1 && !has(PRONOUNS, c.prevChar) && (c.verb?.(c.prevTok) ?? 0) === 0 && (c.verb?.(c.nextTok) ?? 0) === 2 ? undefined : 'de5';
    // Ending a clause: what someone has or does (躺着底，, 很容易记底。, 是敏明底。).
    return cpLen(c.prevTok) >= 2 || prevIs(c, '着了过我你他她它') || (c.verb?.(c.prevTok) ?? 0) >= 1 ? 'de5' : undefined;
  },
  // The Mongols in a list of peoples (蒙汉两族, 蒙藏关系, 蒙元, 汉蒙, 满蒙) and Mongolia beside China (中蒙边境): Měng.
  蒙: (c) => ((/^(汉|藏|元|回|满|维)/.test(c.nextTok) && !/^(汉药|元气)/.test(c.nextTok)) || (prevIs(c, '汉满藏回俄') && c.alone !== false)
    || (prevIs(c, '中') && /^(边|关系|两国|友好|合作|联|双)/.test(c.nextTok)) ? 'meng3' : undefined),
  // 道千乘之国 (to govern, = 导): dǎo.
  道: (c) => (/^千乘/.test(c.nextTok) ? 'dao3' : undefined),
  // 通 is tòng, the measure for a bout of talk or a roll of drums, after a number when a verb and 了 come before (讲了一通, 骂了一通)
  // or a drum follows (三通鼓); 一通电话 (a call) stays tōng.
  通: (c) => ((has('一几两三四五', c.prevChar) && cpLen(c.prevTok) === 1 && c.tok !== undefined && (c.tok(-2) === '了' || /^(乱|胡|大)?(骂|吵|闹|训|夸|哭|折腾|数落|训斥|教训|唠叨|胡扯|胡说)$/.test(c.tok(-2)))
    && !/^(电话|电报|信|书信|邮件|短信|公文|文书|关系)/.test(c.nextTok)) || (has('一二两三四五', c.prevChar) && nextIs(c, '鼓')) ? 'tong4' : undefined),
  // 猫着腰, 猫腰, 猫下腰 (to stoop): máo.
  猫: (c) => (/^(腰|下腰)/.test(c.nextTok) || (nextIs(c, '着下') && /^腰/.test(c.afterTok ?? '')) ? 'mao2' : undefined),
  // 裤子褪到 …, 褪下 (slipped off): tùn; 褪色 is a word.
  // (颜色 褪到 …: the color faded, tuì.)
  褪: (c) => (/^[到下去]/.test(c.nextTok) && behind(c, 4).some((t) => /(裤|袖|衣|衣服|衣裳|鞋|袜|手套)/.test(t)) ? 'tun4' : undefined),
  // 露着两条腿 (left showing, the everyday word): lòu.
  露: (c) => (nextIs(c, '着') && c.alone !== false ? 'lou4' : undefined),
  // 剥下来, 剥了皮 (to peel, to strip off: the everyday word): bāo.
  剥: (c) => (nextIs(c, '下开了掉皮着') || /^(下来|下去|开来)$/.test(c.nextTok) ? 'bao1' : undefined),
};

/** Rule-based reading for `ctx.ch`, or undefined when no rule applies (use the dictionary default). */
export function polyphoneReading(ctx: CharContext): string | undefined {
  return polyphoneRule(ctx).reading;
}

/**
 * The rules' reading and whether it is only the rule's own default (`usual`: none of its cases matched). With no rule or a rule
 * that says nothing, `reading` is undefined and `usual` true.
 */
export function polyphoneRule(ctx: CharContext): { reading: string | undefined; usual: boolean } {
  const rule = RULES[ctx.ch];
  const r = rule ? rule(ctx) : undefined;
  if (r === undefined) return NO_RULE;
  if (r instanceof Usual) return { reading: r.reading, usual: true };
  return { reading: r, usual: false };
}

const NO_RULE: { reading: undefined; usual: true } = { reading: undefined, usual: true };

/** Characters that have an explicit rule (for tests and tooling). */
export const POLYPHONE_CHARS: readonly string[] = Object.keys(RULES);
