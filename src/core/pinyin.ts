// Pinyin helpers: tone marks, numbered form, zhuyin, 一/不 tone sandhi. Contract: ARCHITECTURE.md §4.3.
import type { PinyinStyle, Token } from '../types';

/** Every toneless Mandarin syllable seen in Unihan and CC-CEDICT (plus the standalone m, n, ng, hm, hng, r). */
const SYLLABLE_LIST =
  'a ai an ang ao ba bai ban bang bao bei ben beng bi bia bian biang biao bie bin bing biu bo bong bu ' +
  'ca cai can cang cao ce cei cen ceng cha chai chan chang chao che chen cheng chi chong chou chu chua ' +
  'chuai chuan chuang chui chun chuo ci cong cou cu cuan cui cun cuo da dai dan dang dao de dei den ' +
  'deng di dia dian diao die din ding diu dong dou du duan dui dun duo e ei en eng er fa fan fang fei ' +
  'fen feng fiao fo fou fu ga gai gan gang gao ge gei gen geng ging gong gou gu gua guai guan guang ' +
  'gui gun guo ha hai han hang hao he hei hen heng hm hng hong hou hu hua huai huan huang hui hun huo ' +
  'ji jia jian jiang jiao jie jin jing jiong jiu ju juan jue jun ka kai kan kang kao ke kei ken keng ' +
  'kong kou ku kua kuai kuan kuang kui kun kuo la lai lan lang lao le lei len leng li lia lian liang ' +
  'liao lie lin ling liu lo long lou lu luan lun luo lü lüe m ma mai man mang mao me mei men meng mi ' +
  'mian miao mie min ming miu mo mou mu n na nai nan nang nao ne nei nen neng ng ni nia nian niang ' +
  'niao nie nin ning niu nong nou nu nuan nun nuo nü nüe o ou pa pai pan pang pao pei pen peng pi pian ' +
  'piao pie pin ping po pou pu qi qia qian qiang qiao qie qin qing qiong qiu qu quan que qun r ran ' +
  'rang rao re ren reng ri rong rou ru rua ruan rui run ruo sa sai san sang sao se sei sen seng sha ' +
  'shai shan shang shao she shei shen sheng shi shou shu shua shuai shuan shuang shui shun shuo si ' +
  'song sou su suan sui sun suo ta tai tan tang tao te tei teng ti tian tiao tie ting tong tou tu tuan ' +
  'tui tun tuo wa wai wan wang wei wen weng wo wong wu xi xia xian xiang xiao xie xin xing xiong xiu ' +
  'xu xuan xue xun ya yan yang yao ye yi yin ying yo yong you yu yuan yue yun za zai zan zang zao ze ' +
  'zei zen zeng zha zhai zhan zhang zhao zhe zhei zhen zheng zhi zhong zhou zhu zhua zhuai zhuan ' +
  'zhuang zhui zhun zhuo zi zong zou zu zuan zui zun zuo';

/** All known toneless syllables (for tests and tooling). */
export const PINYIN_SYLLABLES: readonly string[] = SYLLABLE_LIST.split(' ');
const SYLLABLES: ReadonlySet<string> = new Set(PINYIN_SYLLABLES);
const MAX_SYLLABLE_LEN = 6;

/** True for a toneless lowercase pinyin syllable ("hao", "lü", "r"). */
export function isSyllableBase(base: string): boolean {
  return SYLLABLES.has(base);
}

// ------------------------------------------------------------------ tones ---

const MARK_FOR_TONE = ['', '\u0304', '\u0301', '\u030C', '\u0300'] as const; // index = tone
const TONE_FOR_MARK: Record<string, 1 | 2 | 3 | 4> = { '\u0304': 1, '\u0301': 2, '\u030C': 3, '\u0300': 4 };
const TONE_MARKS_RE = /[\u0304\u0301\u030C\u0300]/;
const NUMBERED_RE = /^([A-Za-züÜ:]+)([0-5])$/;

/** "u:" and "v" spellings of ü; "v" only after l/n so Latin text is left alone. */
function fixUmlaut(letters: string): string {
  return letters
    .replace(/u:/g, 'ü')
    .replace(/U:/g, 'Ü')
    .replace(/(?<=[lnLN])v/g, 'ü')
    .replace(/(?<=[lnLN])V/g, 'Ü');
}

/** "hao3" -> 3; "r5"/"de5"/"de" -> 5. Tone-marked input ("hǎo") works too. */
export function toneOf(syllable: string): 1 | 2 | 3 | 4 | 5 {
  const m = NUMBERED_RE.exec(syllable);
  if (m) {
    const n = Number(m[2]);
    return n >= 1 && n <= 4 ? (n as 1 | 2 | 3 | 4) : 5;
  }
  const mark = TONE_MARKS_RE.exec(syllable.normalize('NFD'));
  return mark ? TONE_FOR_MARK[mark[0]] : 5;
}

/** Index of the vowel that carries the tone mark: a/e first, then the o of "ou", else the last vowel. */
function markIndex(letters: string): number {
  const lower = letters.toLowerCase();
  const a = lower.indexOf('a');
  if (a >= 0) return a;
  const e = lower.indexOf('e');
  if (e >= 0) return e;
  const ou = lower.indexOf('ou');
  if (ou >= 0) return ou;
  let last = -1;
  for (let i = 0; i < lower.length; i++) if ('aeiouü'.includes(lower[i])) last = i;
  if (last >= 0) return last;
  // No vowel: the syllabic nasals m, n, ng, hm, hng carry the mark on their first m/n.
  return lower.search(/[mn]/);
}

/** "lü4" -> "lǜ", "Bei3" -> "Běi", "r5" -> "r". Non-syllables pass through. */
export function numberedToMarked(syllable: string): string {
  const m = NUMBERED_RE.exec(syllable);
  if (!m) return syllable;
  const letters = fixUmlaut(m[1]);
  const tone = Number(m[2]);
  if (tone === 0 || tone === 5) return /^[A-Za-züÜ]+$/.test(letters) ? letters : syllable;
  const i = markIndex(letters);
  if (i < 0) return syllable; // "xx1": nothing to mark
  return (letters.slice(0, i + 1) + MARK_FOR_TONE[tone] + letters.slice(i + 1)).normalize('NFC');
}

/** "hǎo" -> "hao3", "lǜ" -> "lü4". Toneless valid syllables get 5; anything else passes through. */
export function markedToNumbered(syllable: string): string {
  if (NUMBERED_RE.test(syllable)) return fixUmlaut(syllable);
  const d = syllable.normalize('NFD');
  let tone = 0;
  let letters = '';
  for (const ch of d) {
    const t = TONE_FOR_MARK[ch];
    if (t) tone = t;
    else letters += ch;
  }
  letters = letters.normalize('NFC');
  if (!/^[A-Za-züÜêÊ]+$/.test(letters)) return syllable;
  if (tone) return letters + tone;
  return isSyllableBase(letters.toLowerCase()) ? letters + '5' : syllable;
}

// ----------------------------------------------------------- splitting ---

interface Piece { ch: string; tone: number }

/**
 * Split a run like "yǒujìnr5" or "shíhòu" into numbered syllables ("you3 jin4 r5").
 * Returns null when the run cannot be read as pinyin. Used to repair the hand-added HSK rows of cedict.
 */
export function splitPinyinRun(run: string): string[] | null {
  const letters: Piece[] = [];
  let finalTone = 0;
  for (const ch of run.normalize('NFD')) {
    const t = TONE_FOR_MARK[ch];
    if (t) {
      if (!letters.length) return null;
      letters[letters.length - 1].tone = t;
    } else if (ch === '\u0308') {
      const last = letters[letters.length - 1];
      if (!last || last.ch.toLowerCase() !== 'u') return null;
      last.ch = last.ch === 'U' ? 'Ü' : 'ü';
    } else if (/[1-5]/.test(ch)) {
      finalTone = Number(ch);
    } else if (/[A-Za-z]/.test(ch) || ch === "'" || ch === '\u2019') {
      letters.push({ ch: ch === '\u2019' ? "'" : ch, tone: 0 });
    } else return null;
  }
  const n = letters.length;
  const lower = letters.map((p) => p.ch.toLowerCase());
  // best[i] = fewest syllables covering letters[i..], pick[i] = letters consumed by the first one
  // (longer syllables win ties, so "fangan" reads fang+an).
  const best = new Array<number>(n + 1).fill(Infinity);
  const pick = new Array<number>(n + 1).fill(0);
  best[n] = 0;
  for (let i = n - 1; i >= 0; i--) {
    if (lower[i] === "'") continue;
    for (let len = Math.min(MAX_SYLLABLE_LEN, n - i); len >= 1; len--) {
      const slice = lower.slice(i, i + len);
      if (slice.includes("'")) continue;
      if (letters.slice(i, i + len).filter((p) => p.tone).length > 1) continue;
      if (!SYLLABLES.has(slice.join(''))) continue;
      const next = lower[i + len] === "'" ? i + len + 1 : i + len;
      if (1 + best[next] < best[i]) { best[i] = 1 + best[next]; pick[i] = next - i; }
    }
  }
  if (!Number.isFinite(best[0])) return null;
  const syllables: { text: string; tone: number }[] = [];
  for (let i = 0; i < n; ) {
    let text = '';
    let tone = 0;
    for (let k = i; k < i + pick[i]; k++) {
      if (lower[k] === "'") continue;
      text += letters[k].ch;
      tone ||= letters[k].tone;
    }
    syllables.push({ text, tone });
    i += pick[i];
  }
  // A trailing digit ("yǒujìnr5") is the tone of the last syllable; unmarked syllables are neutral.
  return syllables.map((s, idx) => s.text + (s.tone || (idx === syllables.length - 1 && finalTone ? finalTone : 5)));
}

/**
 * Normalize one CC-CEDICT pinyin field to "ni3 hao3": tone-marked or run-together tokens are split
 * into numbered syllables; tokens that are already numbered (or are not pinyin at all) are kept.
 */
export function normalizePinyinField(field: string): string {
  const tokens = field.split(' ');
  let changed = false;
  const out: string[] = [];
  for (const tok of tokens) {
    const needs = TONE_MARKS_RE.test(tok.normalize('NFD')) || /^[a-zü]+$/.test(tok);
    if (!needs) { out.push(tok); continue; }
    if (/^[a-zü]+$/.test(tok) && !SYLLABLES.has(tok) && !splitPinyinRun(tok)) { out.push(tok); continue; }
    const parts = splitPinyinRun(tok);
    if (!parts) { out.push(tok); continue; }
    out.push(...parts);
    changed = true;
  }
  return changed ? out.join(' ') : field;
}

/** Toneless lowercase letters of a numbered or marked syllable ("Bei3" -> "bei", "lǜ" -> "lü"). */
export function baseOf(syllable: string): string {
  const m = NUMBERED_RE.exec(syllable);
  const letters = m ? fixUmlaut(m[1]) : syllable.normalize('NFD').replace(/[\u0304\u0301\u030C\u0300]/g, '').normalize('NFC');
  return letters.toLowerCase();
}

// ---------------------------------------------------------------- zhuyin ---

const ZY_INITIALS: Record<string, string> = {
  b: 'ㄅ', p: 'ㄆ', m: 'ㄇ', f: 'ㄈ', d: 'ㄉ', t: 'ㄊ', n: 'ㄋ', l: 'ㄌ', g: 'ㄍ', k: 'ㄎ', h: 'ㄏ',
  j: 'ㄐ', q: 'ㄑ', x: 'ㄒ', zh: 'ㄓ', ch: 'ㄔ', sh: 'ㄕ', r: 'ㄖ', z: 'ㄗ', c: 'ㄘ', s: 'ㄙ',
};

const ZY_FINALS: Record<string, string> = {
  a: 'ㄚ', o: 'ㄛ', e: 'ㄜ', ê: 'ㄝ', ai: 'ㄞ', ei: 'ㄟ', ao: 'ㄠ', ou: 'ㄡ', an: 'ㄢ', en: 'ㄣ', ang: 'ㄤ', eng: 'ㄥ',
  er: 'ㄦ', i: 'ㄧ', ia: 'ㄧㄚ', io: 'ㄧㄛ', ie: 'ㄧㄝ', iao: 'ㄧㄠ', iou: 'ㄧㄡ', ian: 'ㄧㄢ', in: 'ㄧㄣ',
  iang: 'ㄧㄤ', ing: 'ㄧㄥ', iong: 'ㄩㄥ', u: 'ㄨ', ua: 'ㄨㄚ', uo: 'ㄨㄛ', uai: 'ㄨㄞ', uei: 'ㄨㄟ', uan: 'ㄨㄢ',
  uen: 'ㄨㄣ', uang: 'ㄨㄤ', ueng: 'ㄨㄥ', uong: 'ㄨㄛㄥ', ong: 'ㄨㄥ', ü: 'ㄩ', üe: 'ㄩㄝ', üan: 'ㄩㄢ', ün: 'ㄩㄣ',
};

const ZY_WHOLE: Record<string, string> = {
  r: 'ㄦ', er: 'ㄦ', m: 'ㄇ', n: 'ㄋ', ng: 'ㄫ', hm: 'ㄏㄇ', hng: 'ㄏㄫ', ê: 'ㄝ',
};

const ZY_TONE_MARK = ['', '', 'ˊ', 'ˇ', 'ˋ'] as const;

/** Zhuyin for a toneless base syllable, or null if it cannot be spelled. */
function baseToZhuyin(base: string): string | null {
  if (ZY_WHOLE[base]) return ZY_WHOLE[base];
  let initial = '';
  let fin = base;
  if (base[0] === 'y') {
    const rest = base.slice(1);
    if (rest[0] === 'u') fin = 'ü' + rest.slice(1);
    else if (rest[0] === 'i') fin = rest;
    else fin = 'i' + rest;
  } else if (base[0] === 'w') {
    const rest = base.slice(1);
    fin = rest === 'u' ? 'u' : 'u' + rest;
  } else {
    const two = base.slice(0, 2);
    if (ZY_INITIALS[two]) initial = two;
    else if (ZY_INITIALS[base[0]]) initial = base[0];
    fin = base.slice(initial.length);
    if ('jqx'.includes(initial) && initial && fin[0] === 'u') fin = 'ü' + fin.slice(1);
    if ('zh ch sh r z c s'.split(' ').includes(initial) && fin === 'i') fin = '';
    else if (fin === 'iu') fin = 'iou';
    else if (fin === 'ui') fin = 'uei';
    else if (fin === 'un') fin = 'uen';
  }
  if (fin === 'ong' && !initial) return null; // "ong" never stands alone
  if (fin === '' && !initial) return null;
  const zf = fin === '' ? '' : ZY_FINALS[fin];
  if (zf === undefined) return null;
  return (initial ? ZY_INITIALS[initial] : '') + zf;
}

/** "hao3" -> "ㄏㄠˇ"; neutral tone puts ˙ in front ("ma5" -> "˙ㄇㄚ"). Non-syllables pass through. */
export function numberedToZhuyin(syllable: string): string {
  const m = NUMBERED_RE.exec(syllable);
  if (!m) return syllable;
  const base = fixUmlaut(m[1]).toLowerCase();
  const zy = baseToZhuyin(base);
  if (zy === null) return syllable;
  const tone = Number(m[2]);
  if (tone === 5 || tone === 0) {
    // Erhua r and the syllabic er carry no neutral dot in practice.
    return base === 'r' || base === 'er' ? zy : '˙' + zy;
  }
  return zy + ZY_TONE_MARK[tone];
}

// ------------------------------------------------------------- formatting ---

/** One numbered syllable in the chosen style. */
export function formatSyllable(syllable: string, style: PinyinStyle): string {
  if (style === 'marks') return numberedToMarked(syllable);
  if (style === 'zhuyin') return numberedToZhuyin(syllable);
  return syllable;
}

/** A whole CEDICT pinyin string ("ni3 hao3") in the chosen style, syllables separated by spaces. */
export function formatPinyin(numbered: string, style: PinyinStyle): string {
  return numbered
    .split(/\s+/)
    .filter(Boolean)
    .map((s) => formatSyllable(s, style))
    .join(' ');
}

// ----------------------------------------------------------------- sandhi ---

const NUMERAL_CHARS = new Set([...'零〇一二三四五六七八九十百千万萬亿億两兩']);
/** Digits that keep 一 as yī when they follow it (一二三, 一十一). The place values 百千万亿 do not: yìbǎi, yìqiān, yíwàn. */
const DIGIT_CHARS = new Set([...'零〇一二三四五六七八九十两兩']);
/** Measure words (traditional and simplified) that are often repeated after 一: 一个一个, 一次一次, 一步一步. */
const MEASURE_WORDS = new Set([...'个個次遍回趟下件张張条條只隻位名些点點天年月日本册冊口句步场場样樣种種双雙对對家间間座层層块塊片份群队隊批支根颗顆粒封首道把章篇段頁页卷行棵杯碗盞盏']);

interface SandhiSlot {
  tok: Token;
  i: number;
  ch: string;
  /** Last code point of a multi-character token: the word's own reading wins there. */
  wordFinal: boolean;
}

/**
 * Rewrite 一/不 tones in place across token boundaries (yí gè, bú shì).
 * Rules: 不 -> bu2 before tone 4; 一 -> yi2 before tone 4, yi4 before tones 1-3. 一/不 stay put as a number or
 * ordinal (第一, 十一, 一二三, 一月), at the end of a phrase or word (唯一, 统一), or before a neutral syllable.
 * 一/不 between two copies of one character are neutral (看一看, 好不好).
 */
export function applySandhi(tokens: Token[]): void {
  // Runs of directly touching han tokens; punctuation, spaces and gaps end a run.
  const runs: SandhiSlot[][] = [];
  let run: SandhiSlot[] = [];
  let prevEnd = -1;
  for (const tok of tokens) {
    if (tok.kind !== 'han' || !tok.pinyin) {
      if (run.length) runs.push(run);
      run = [];
      prevEnd = -1;
      continue;
    }
    if (prevEnd !== tok.start && run.length) { runs.push(run); run = []; }
    const chars = [...tok.text];
    chars.forEach((ch, i) => run.push({ tok, i, ch, wordFinal: chars.length > 1 && i === chars.length - 1 }));
    prevEnd = tok.end;
  }
  if (run.length) runs.push(run);

  for (const r of runs) {
    for (let k = 0; k < r.length - 1; k++) {
      const slot = r[k];
      if ((slot.ch !== '一' && slot.ch !== '不') || slot.wordFinal) continue;
      const syl = slot.tok.pinyin![slot.i];
      const base = baseOf(syl);
      const tone = toneOf(syl);
      const isYi = slot.ch === '一' && base === 'yi' && tone !== 3 && tone !== 5;
      const isBu = slot.ch === '不' && base === 'bu' && (tone === 4 || tone === 2);
      if (!isYi && !isBu) continue;
      const next = r[k + 1];
      const nextSyl = next.tok.pinyin![next.i];
      if (!nextSyl) continue; // unreadable next character
      const prev = k > 0 ? r[k - 1] : null;
      const set = (n: number) => { slot.tok.pinyin![slot.i] = base + n; };
      // 看一看, 好不好: one character repeated around 一/不 is neutral. A measure word repeated (一个一个, 一次一次,
      // 一遍一遍) is not: that is yí ge, yí cì, yí biàn.
      if (prev && prev.ch === next.ch && !NUMERAL_CHARS.has(prev.ch) && !(slot.ch === '一' && MEASURE_WORDS.has(prev.ch))) { set(5); continue; }
      // 个 is written neutral in running text but changes 一 as the 4th tone it is underneath: yí ge.
      const nextTone = (next.ch === '个' || next.ch === '個') && toneOf(nextSyl) === 5 ? 4 : toneOf(nextSyl);
      if (isBu) { set(nextTone === 4 ? 2 : 4); continue; }
      if (prev && (NUMERAL_CHARS.has(prev.ch) || prev.ch === '第')) continue;
      // 一两个, 一两天: "a couple of" is yì liǎng (a number only when 两 is the unit: 一两银子).
      const after = r[k + 2];
      const couple = (next.ch === '两' || next.ch === '兩') && !!after && MEASURE_WORDS.has(after.ch);
      if (!couple && (DIGIT_CHARS.has(next.ch) || next.ch === '月' || next.ch === '号')) continue;
      if (nextTone === 4) set(2);
      else if (nextTone !== 5) set(4);
    }
  }
}
