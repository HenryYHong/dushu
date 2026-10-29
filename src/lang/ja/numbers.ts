// Readings of numbers written in kanji and of counters after them. IPADIC reads each numeral and counter on its own
// (三 + 百 + 本 = さん ひゃく ほん); a reader says さんびゃっぽん, so the sound changes are applied here.

const DIGITS: Record<string, number> = { 〇: 0, 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 壱: 1, 弐: 2, 参: 3 };
const UNITS: Record<string, number> = { 十: 10, 拾: 10, 百: 100, 千: 1000 };
const BIG: Record<string, number> = { 万: 1e4, 億: 1e8, 兆: 1e12 };

export const NUMERAL_CHARS = '〇零一二三四五六七八九十百千万億兆壱弐参拾';

export function isNumeralText(s: string): boolean {
  if (!s) return false;
  for (const ch of s) if (!NUMERAL_CHARS.includes(ch)) return false;
  return true;
}

/** The value of a kanji numeral: 三百五十 = 350, 二〇二三 = 2023 (digit by digit when there is no unit). Null if not a number. */
export function numeralValue(s: string): number | null {
  if (!isNumeralText(s)) return null;
  if (![...s].some((ch) => ch in UNITS || ch in BIG)) {
    let v = 0;
    for (const ch of s) v = v * 10 + DIGITS[ch];
    return v;
  }
  let total = 0;
  let section = 0;
  let digit = -1;
  for (const ch of s) {
    if (ch in DIGITS) { digit = digit >= 0 ? digit * 10 + DIGITS[ch] : DIGITS[ch]; continue; }
    if (ch in UNITS) { section += (digit >= 0 ? digit : 1) * UNITS[ch]; digit = -1; continue; }
    if (ch in BIG) { total += (section + (digit >= 0 ? digit : 0) || 1) * BIG[ch]; section = 0; digit = -1; }
  }
  return total + section + (digit >= 0 ? digit : 0);
}

const ONES = ['', 'いち', 'に', 'さん', 'よん', 'ご', 'ろく', 'なな', 'はち', 'きゅう'];

/**
 * 二三日 is "two or three days", 四五人 "four or five people": two neighboring digits with no unit between them are a rough
 * count, read digit by digit (に + さん). Null when `s` is not one.
 */
export function approximateParts(s: string): string[] | null {
  const ds = [...s];
  if (ds.length !== 2 || !(ds[0] in DIGITS) || !(ds[1] in DIGITS)) return null;
  const a = DIGITS[ds[0]];
  const b = DIGITS[ds[1]];
  if (a < 1 || b !== a + 1) return null;
  return [ONES[a] === 'よん' ? 'し' : ONES[a], ONES[b]];
}

/** The reading of a number as parts ("350" → ["さん", "びゃく", "ご", "じゅう"]), so a counter can change the last one. */
export function numberParts(n: number): string[] {
  if (n === 0) return ['ぜろ'];
  const out: string[] = [];
  const groups: [number, string][] = [[1e12, 'ちょう'], [1e8, 'おく'], [1e4, 'まん'], [1, '']];
  let rest = n;
  for (const [size, name] of groups) {
    const g = Math.floor(rest / size);
    rest %= size;
    if (!g) continue;
    out.push(...groupParts(g, size === 1));
    if (name) {
      // 一万 いちまん, 一億 いちおく, 一兆 いっちょう.
      if (g === 1) out.push('いち');
      if (name === 'ちょう' && out[out.length - 1] === 'いち') out[out.length - 1] = 'いっ';
      if (name === 'ちょう' && out[out.length - 1] === 'はち') out[out.length - 1] = 'はっ';
      if (name === 'ちょう' && out[out.length - 1] === 'じゅう') out[out.length - 1] = 'じゅっ';
      out.push(name);
    }
  }
  return out;
}

/** 1..9999 as parts; `last` is false when 万/億 follows (then a bare 一 before them is added by the caller). */
function groupParts(g: number, last: boolean): string[] {
  const out: string[] = [];
  const th = Math.floor(g / 1000);
  const hu = Math.floor(g / 100) % 10;
  const te = Math.floor(g / 10) % 10;
  const on = g % 10;
  if (th) {
    if (th === 3) out.push('さん', 'ぜん');
    else if (th === 8) out.push('はっ', 'せん');
    else if (th === 1) out.push('せん');
    else out.push(ONES[th], 'せん');
  }
  if (hu) {
    if (hu === 3) out.push('さん', 'びゃく');
    else if (hu === 6) out.push('ろっ', 'ぴゃく');
    else if (hu === 8) out.push('はっ', 'ぴゃく');
    else if (hu === 1) out.push('ひゃく');
    else out.push(ONES[hu], 'ひゃく');
  }
  if (te) {
    if (te !== 1) out.push(ONES[te]);
    out.push('じゅう');
  }
  if (on && !(on === 1 && !last && g === 1)) out.push(ONES[on]);
  return out;
}

/** The reading of a kanji numeral on its own (三百 → さんびゃく). */
export function numeralReading(s: string): string | null {
  const v = numeralValue(s);
  return v === null ? null : numberParts(v).join('');
}

/** How a counter changes after a number. k/s/t/h is the counter's first consonant; the tables hold the exceptions. */
const COUNTER_READING: Record<string, string> = {
  本: 'ほん', 匹: 'ひき', 疋: 'ひき', 杯: 'はい', 分: 'ふん', 階: 'かい', 回: 'かい', 個: 'こ', 箇: 'こ', 軒: 'けん', 冊: 'さつ', 歳: 'さい',
  才: 'さい', 足: 'そく', 頭: 'とう', 通: 'つう', 着: 'ちゃく', 泊: 'はく', 発: 'はつ', 歩: 'ほ', 遍: 'へん', 編: 'へん', 篇: 'へん',
  尺: 'しゃく', 寸: 'すん', 貫: 'かん', 銭: 'せん', 件: 'けん', 曲: 'きょく', 席: 'せき', 隻: 'せき', 艘: 'そう', 双: 'そう',
  切: 'きれ', 戸: 'こ', 斤: 'きん', 間: 'けん', 機: 'き', 期: 'き', 校: 'こう', 社: 'しゃ', 週: 'しゅう', 周: 'しゅう', 章: 'しょう',
  首: 'しゅ', 種: 'しゅ', 点: 'てん', 丁: 'ちょう', 町: 'ちょう', 坪: 'つぼ', 枚: 'まい', 台: 'だい', 度: 'ど', 番: 'ばん', 名: 'めい',
  人: 'にん', 年: 'ねん', 円: 'えん', 時: 'じ', 時間: 'じかん', 秒: 'びょう', 里: 'り', 羽: 'わ', 部: 'ぶ', 倍: 'ばい', 位: 'い',
  月: 'がつ', 日: 'にち', 列: 'れつ', 匁: 'もんめ', 本目: 'ほんめ', 文: 'もん', 両: 'りょう', 畳: 'じょう', 合: 'ごう', 升: 'しょう',
  石: 'こく', 晩: 'ばん', 夜: 'や', 代: 'だい', 世: 'せい', 等: 'とう', 千: 'せん', 百: 'ひゃく',
};
/** Counters whose h becomes p, not b, after 三 and 何: 三分 さんぷん, 三泊 さんぱく. */
const P_AFTER_N = new Set(['分', '泊', '発', '歩', '品']);
/** Counters that voice after 三: 三階 さんがい, 三軒 さんげん, 三足 さんぞく. */
const VOICED_AFTER_SAN = new Set(['階', '軒', '足', '本', '匹', '杯', '遍', '編', '篇', '百', '千']);
const VOICE: Record<string, string> = { か: 'が', き: 'ぎ', く: 'ぐ', け: 'げ', こ: 'ご', さ: 'ざ', し: 'じ', す: 'ず', せ: 'ぜ', そ: 'ぞ', は: 'ば', ひ: 'び', ふ: 'ぶ', へ: 'べ', ほ: 'ぼ' };
const PAND: Record<string, string> = { は: 'ぱ', ひ: 'ぴ', ふ: 'ぷ', へ: 'ぺ', ほ: 'ぽ' };
const DAYS: Record<number, string> = { 1: 'ついたち', 2: 'ふつか', 3: 'みっか', 4: 'よっか', 5: 'いつか', 6: 'むいか', 7: 'なのか', 8: 'ようか', 9: 'ここのか', 10: 'とおか', 14: 'じゅうよっか', 20: 'はつか', 24: 'にじゅうよっか' };

export function counterBase(counter: string): string | undefined {
  return COUNTER_READING[counter];
}

/**
 * The reading of a number (as parts, numberParts) followed by `counter` (whose plain reading is `plain`): 三本 さんぼん, 六百匹
 * ろっぴゃっぴき, 一人 ひとり, 二十日 はつか. `value` is the number's value when known.
 */
export function counterReading(parts: string[], value: number | null, counter: string, plain: string): string {
  if (counter === '人' && value === 1) return 'ひとり';
  if (counter === '人' && value === 2) return 'ふたり';
  if (counter === '歳' && value === 20) return 'はたち';
  if (counter === '日' && value !== null && DAYS[value] && value !== 1) return DAYS[value];
  if (counter === '日' && value === 1) return 'いちにち';
  const head = parts.slice(0, -1);
  let last = parts[parts.length - 1] ?? '';
  let c = plain;
  const first = c[0];
  if (counter === '月' && value !== null && value <= 12) {
    if (last === 'よん') last = 'し';
    if (last === 'なな') last = 'しち';
    if (last === 'きゅう') last = 'く';
  }
  if ((counter === '時' || counter === '時間')) {
    if (last === 'よん') last = 'よ';
    if (last === 'なな') last = 'しち';
    if (last === 'きゅう') last = 'く';
  }
  if (last === 'よん' && ['人', '年', '円', '時', '時間'].includes(counter)) last = 'よ';
  const geminate = (k: string, s: string, t: string, h: string): void => {
    if ('かきくけこ'.includes(first) && k) last = k;
    else if ('さしすせそ'.includes(first) && s) last = s;
    else if ('たちつてと'.includes(first) && t) last = t;
    else if ('はひふへほ'.includes(first) && h) { last = h; c = (PAND[first] ?? first) + c.slice(1); }
  };
  if (last === 'いち') geminate('いっ', 'いっ', 'いっ', 'いっ');
  else if (last === 'ろく') geminate('ろっ', '', '', 'ろっ');
  else if (last === 'はち') geminate('はっ', 'はっ', 'はっ', 'はっ');
  else if (last === 'じゅう') geminate('じゅっ', 'じゅっ', 'じゅっ', 'じゅっ');
  else if (last === 'ひゃく' || last === 'びゃく' || last === 'ぴゃく') geminate(last.slice(0, 2) + 'っ', '', '', last.slice(0, 2) + 'っ');
  else if (last === 'さん' || last === 'なん' || last === 'せん' || last === 'まん') {
    if ('はひふへほ'.includes(first)) c = (P_AFTER_N.has(counter) ? PAND[first] : VOICE[first]) + c.slice(1);
    else if (last === 'さん' && VOICED_AFTER_SAN.has(counter) && VOICE[first]) c = VOICE[first] + c.slice(1);
  } else if (last === 'よん' && P_AFTER_N.has(counter) && PAND[first]) {
    c = PAND[first] + c.slice(1);
  }
  return head.join('') + last + c;
}
