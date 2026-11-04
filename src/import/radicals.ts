// Radicals in running text. A PDF printed on a Mac (Chrome, Safari, Preview) maps many common characters to the Kangxi or CJK
// radical of the same shape (⼀ for 一, ⼈ for 人): the font draws both with one glyph, and the PDF names the glyph by the lowest
// code point that uses it. Mapped back one character at a time, never by NFKC over whole strings.
//
// RADICALS: Unicode's Equivalent_Unified_Ideograph (EquivalentUnifiedIdeograph.txt, Unicode License v3): radical, ideograph.
// Some fonts give a radical to a different character as well (Songti SC draws ⼜ U+2F1C with the glyph of 口, Heiti SC ⼲ with
// 广), found by reading the cmaps of the Mac's Chinese fonts. For those the neighbours decide (WORDS: the common two-character
// words of each candidate, from jieba's counts, MIT), and the document as a whole (which characters the font left alone).
import { isHan } from './han';

// --- made by scripts/build_radicals.py; do not edit by hand ---
const RADICALS =
  '⺁厂⺂乛⺃乚⺄乙⺅亻⺆冂⺇𠘨⺈刀⺉刂⺊卜⺋㔾⺌小⺍小⺎兀⺏尣⺐尢⺑𡯂⺒巳⺓幺⺔彑⺕𫜹⺖忄⺗心⺘扌⺙攵⺛旡⺜日⺝月⺞歺⺟母⺠民⺡氵⺢氺⺣灬⺤爫⺥爫⺦丬⺧牛⺨犭⺩王⺪𤴔⺫目⺬示⺭礻⺮𥫗⺯糹⺰纟⺱罓⺲罒⺳㓁⺴冗⺵𦉫⺶羊⺷𦍌⺸𦍋⺹耂⺺肀⺻聿⺼肉⺽𦥑' +
  '⺾艹⺿艹⻀艹⻁虎⻂衤⻃覀⻄西⻅见⻆角⻇𧢲⻈讠⻉贝⻊𧾷⻋车⻌辶⻍辶⻎辶⻏邑⻐钅⻑長⻒镸⻓长⻔门⻕𨸏⻖阝⻗雨⻘青⻙韦⻚页⻛风⻜飞⻝食⻞𩙿⻟飠⻠饣⻡𩠐⻢马⻣骨⻤鬼⻥鱼⻦鸟⻧卤⻨麦⻩黄⻪黾⻫斉⻬齐⻭歯⻮齿⻯竜⻰龙⻱龜⻲亀⻳龟⼀一⼁丨⼂丶⼃丿⼄乙⼅亅' +
  '⼆二⼇亠⼈人⼉儿⼊入⼋八⼌冂⼍冖⼎冫⼏几⼐凵⼑刀⼒力⼓勹⼔匕⼕匚⼖匸⼗十⼘卜⼙卩⼚厂⼛厶⼜又⼝口⼞囗⼟土⼠士⼡夂⼢夊⼣夕⼤大⼥女⼦子⼧宀⼨寸⼩小⼪尢⼫尸⼬屮⼭山⼮巛⼯工⼰己⼱巾⼲干⼳幺⼴广⼵廴⼶廾⼷弋⼸弓⼹彐⼺彡⼻彳⼼心⼽戈⼾戶⼿手⽀支⽁攴' +
  '⽂文⽃斗⽄斤⽅方⽆无⽇日⽈曰⽉月⽊木⽋欠⽌止⽍歹⽎殳⽏毋⽐比⽑毛⽒氏⽓气⽔水⽕火⽖爪⽗父⽘爻⽙爿⽚片⽛牙⽜牛⽝犬⽞玄⽟玉⽠瓜⽡瓦⽢甘⽣生⽤用⽥田⽦疋⽧疒⽨癶⽩白⽪皮⽫皿⽬目⽭矛⽮矢⽯石⽰示⽱禸⽲禾⽳穴⽴立⽵竹⽶米⽷糸⽸缶⽹网⽺羊⽻羽⽼老⽽而' +
  '⽾耒⽿耳⾀聿⾁肉⾂臣⾃自⾄至⾅臼⾆舌⾇舛⾈舟⾉艮⾊色⾋艸⾌虍⾍虫⾎血⾏行⾐衣⾑襾⾒見⾓角⾔言⾕谷⾖豆⾗豕⾘豸⾙貝⾚赤⾛走⾜足⾝身⾞車⾟辛⾠辰⾡辵⾢邑⾣酉⾤釆⾥里⾦金⾧長⾨門⾩阜⾪隶⾫隹⾬雨⾭靑⾮非⾯面⾰革⾱韋⾲韭⾳音⾴頁⾵風⾶飛⾷食⾸首⾹香' +
  '⾺馬⾻骨⾼高⾽髟⾾鬥⾿鬯⿀鬲⿁鬼⿂魚⿃鳥⿄鹵⿅鹿⿆麥⿇麻⿈黃⿉黍⿊黑⿋黹⿌黽⿍鼎⿎鼓⿏鼠⿐鼻⿑齊⿒齒⿓龍⿔龜⿕龠';

/** Radical to the other character a common Mac font draws with its glyph. */
const OTHER: Record<string, string> = { '⼜': '口', '⼲': '广', '⾶': '飘', '⺴': '网', '⻯': '龍', '⺽': '臼', '⾇': '舜' };

/** Common two-character words of each candidate, for choosing between them by their neighbours. */
const WORDS: Record<string, string> = {
  '又': '又称 又稱 又名',
  '口': '人口 出口 一口 門口 门口 进口 進口 港口 胸口 口味 口径 口徑 汉口 漢口 口号 口號 口中 河口 伤口 傷口 开口 開口 借口 藉口 口气 口氣 子口 窗口 戶口 户口 口袋 口子 缺口 接口 洞口 入口 口腔 可口 山口 南口 口音 口裏 口里 口头 口頭 口岸 牲口 海口 随口 隨口 关口 關口 对口 對口 路口 垛口 口吻 张口 張口 井口 胃口 口服 口語 口语 渡口 爽口 封口 西口 牙口 馬口 马口 堰口 亲口 插口 親口 沙口 满口 滿口 枪口 槍口',
  '干': '干部 若干 干涉 干净 干扰 干擾 干脆 干燥 干线 干旱 骨干 干預 干预 干活 树干 干流 干吗 干事 干係 干系 干重 干贝 干面 干粮 主干 相干 躯干 干尸 饼干 干涸 干警 才干 精干 干练 干草 干支 干爹 干掉 干将 何干 实干',
  '广': '广泛 广场 广州 广大 广东 广告 推广 广播 广西 广阔 湖广 广义 广布 宽广 两广 京广 广度 广为 广岛 广博 广电',
  '飛': '飛機 飛行 起飛 岳飛 飛舞 飛揚 飛躍 飛奔 張飛 試飛 飛翔 飛來 飛船 飛架 飛快 飛身 飛速 飛刀 飛去 飛往 飛過 飛升 飛昇 飛馬 飛彈 飛馳 飛天 飛濺 飛鳥 紛飛 飛蝗',
  '飘': '飘荡 飘飘 飘逸 飘扬 飘然 飘动 飘忽 飘浮 飘落',
  '网': '网络 网站 网页 网上 网友 上网 网民 网球 河网 网吧 网点 渔网 网址 电网 网具 联网 网队 网易 网格 网游',
  '龍': '小龍 龍頭 神龍 龍門 龍大 龍袍 黃龍 蟠龍 龍亭 龍泉 龍王 龍宮 恐龍 龍船 石龍 九龍 火龍 龍井 龍舟 天龍 龍骨 龍山 賀龍 龍眼 臥龍 青龍 沙龍 盤龍 龍脈 龍鳳 安龍 龍口 巨龍 尼龍 玉龍 龍蝦',
};
// --- end of the made part ---

const RADICAL = /[⺀-⿟]/;

let table: Map<string, string> | null = null;
function radicalTable(): Map<string, string> {
  if (table) return table;
  table = new Map();
  const cps = Array.from(RADICALS);
  for (let i = 0; i + 1 < cps.length; i += 2) table.set(cps[i], cps[i + 1]);
  return table;
}

const wordSets = new Map<string, Set<string>>();
function wordsOf(c: string): Set<string> {
  let set = wordSets.get(c);
  if (!set) wordSets.set(c, (set = new Set((WORDS[c] ?? '').split(' ').filter(Boolean))));
  return set;
}

/** Whether a text holds any radical (U+2E80–U+2FDF). */
export function hasRadicals(s: string): boolean {
  return RADICAL.test(s);
}

/**
 * The radicals that stand for one character only, mapped at once (a PDF's text before its lines and headings are found:
 * "第⼆章" must read as 第二章). The ones a font may give to another character are left for mendRadicals, which sees the
 * neighbours and the whole book.
 */
export function mapPlainRadicals(s: string): string {
  if (!RADICAL.test(s)) return s;
  const t = radicalTable();
  let out = '';
  for (const ch of s) out += (!(ch in OTHER) && t.get(ch)) || ch;
  return out;
}

function count(text: string, ch: string): number {
  let n = 0;
  for (let i = text.indexOf(ch); i >= 0; i = text.indexOf(ch, i + ch.length)) n++;
  return n;
}

/**
 * What each two-way radical stands for in this book, when the book shows it: a font that left the radical's own character
 * alone (又 appears as itself) used the radical for the other one (口), and a book that shows the other character as itself, or
 * as its own radical (口 or ⼝), used it for the radical's own character.
 */
function bookChoices(text: string): Map<string, string> {
  const t = radicalTable();
  const out = new Map<string, string>();
  for (const [r, other] of Object.entries(OTHER)) {
    if (!text.includes(r)) continue;
    const own = t.get(r)!;
    let otherRadical = '';
    for (const [k, v] of t) if (v === other && k !== r) otherRadical = k;
    const ownSeen = count(text, own) >= 2;
    const otherSeen = count(text, other) >= 2 || (!!otherRadical && text.includes(otherRadical));
    if (ownSeen && !otherSeen) out.set(r, other);
    else if (otherSeen && !ownSeen) out.set(r, own);
  }
  return out;
}

/** Han or CJK punctuation (`radical`: or a radical): what a radical standing for a character sits beside. */
function inText(ch: string | undefined, radical: boolean): boolean {
  if (!ch) return false;
  const cp = ch.codePointAt(0)!;
  return isHan(cp) || (radical && cp >= 0x2e80 && cp <= 0x2fdf) || (cp >= 0x3000 && cp <= 0x303f) || (cp >= 0xff00 && cp <= 0xffef);
}

/**
 * Whether the radical at `i` is part of running text: beside a character, a mark or another radical, or a space away from a
 * character or mark on both sides (a PDF's line with stray spaces). A radical set apart among other radicals (a list of
 * radicals, a dictionary's heading) is meant as a radical.
 */
function inRunningText(cps: string[], i: number): boolean {
  if (inText(cps[i - 1], true) || inText(cps[i + 1], true)) return true;
  return cps[i - 1] === ' ' && inText(cps[i - 2], false) && cps[i + 1] === ' ' && inText(cps[i + 2], false);
}

function mendText(s: string, choices: Map<string, string>): string {
  if (!RADICAL.test(s)) return s;
  const t = radicalTable();
  const cps = Array.from(s);
  const out = cps.slice();
  for (let i = 0; i < cps.length; i++) {
    const own = t.get(cps[i]);
    if (!own || !inRunningText(cps, i)) continue;
    const other = OTHER[cps[i]];
    if (!other) {
      out[i] = own;
      continue;
    }
    let pick = choices.get(cps[i]);
    if (!pick) {
      const prev = (out[i - 1] === ' ' ? out[i - 2] : out[i - 1]) ?? '';
      const after = cps[i + 1] === ' ' ? cps[i + 2] : cps[i + 1];
      const next = after ? (t.get(after) ?? after) : '';
      const words = (c: string) => Number(wordsOf(c).has(prev + c)) + Number(wordsOf(c).has(c + next));
      pick = words(other) > words(own) ? other : own;
    }
    out[i] = pick;
  }
  return out.join('');
}

/**
 * Every radical that stands for a character in running text, mapped back to the character (⼀ to 一), one character at a time.
 * The two-way ones (⼜: 又 or 口) follow what the book shows of its fonts, else the words they make with their neighbours.
 * `texts` is the book's text, to read that from; returns the mapper for each string of it, or null when there is no radical.
 */
export function radicalMender(texts: string[]): ((s: string) => string) | null {
  if (!texts.some((s) => RADICAL.test(s))) return null;
  const choices = bookChoices(texts.join('\n'));
  return (s: string) => mendText(s, choices);
}
