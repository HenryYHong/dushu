// Book names and terms: discovery, the lexicon object, and loading/saving it. Contract: ARCHITECTURE.md §4.9.
//
// Real novels are full of words no dictionary has: character names, places, martial-arts and period terms.
// detectTerms() finds them by counting the book's own n-grams (a word is a string that holds together and has
// free neighbors on both sides), then sorts what it finds into name / place / term. Precision beats recall: a
// wrong entry breaks the segmentation of ordinary text, a missed name only costs a split.
import type { AppContext, Dictionary, Lexicon, LexiconEntry } from '../types';
import { markedToNumbered, splitPinyinRun } from './pinyin';
import { SURNAME_READINGS, COMPOUND_SURNAME_READINGS, NAME_CHAR_READINGS } from './names';
import { COMPOUND_SURNAMES, SURNAMES } from './names';

/** Bump when detection changes enough that stored results should be recomputed. */
export const DETECTOR_VERSION = 4;

/** Lexicon over the given rows (disabled rows ignored). */
export function buildLexicon(rows: LexiconEntry[]): Lexicon {
  const map = new Map<string, LexiconEntry>();
  for (const r of rows) if (r.enabled && r.word) map.set(r.word, r);
  let maxLen = 0;
  for (const w of map.keys()) maxLen = Math.max(maxLen, [...w].length);
  return {
    has: (w) => map.has(w),
    get: (w) => map.get(w),
    entries: () => [...map.values()],
    maxLen,
  };
}

export const EMPTY_LEXICON: Lexicon = buildLexicon([]);

// ------------------------------------------------------------- vocabulary ---

/** Never start or end a word: particles, pronouns, the commonest adverbs and conjunctions. */
const EDGE_STOP = new Set([...'的了着过是在和与就也都把被我你他她它们这那个不很又还而但却才并将已正之其所'.replace('之', '').replace('其', '')]);
/** Characters that rarely start a name or term but can (有庆, 向问天): accepted only when strongly bound. */
const SOFT_START = new Set([...'有没要会能可以对给从向跟说道笑问叫看听想去来到为让见只便然至往自于在']);
/** Characters that rarely end a name or term: verbs of speech, direction and locatives. */
const SOFT_END = new Set([...'道说笑问叫看听想去来到上下里中外内前后边面起出完得地']);
/** Followed by one of these, a string is acting as a person (subject of speech). */
const SPEECH_NEXT = new Set([...'说道笑叫问答喊哭骂叹怒喝嚷应']);
const NUMERALS = new Set([...'零〇一二三四五六七八九十百千万两半几']);
const PLACE_SUFFIX = new Set([...'岛山庄寺城府村镇峰谷关江河湖海岭洞殿堡宫楼阁庙塔桥坡寨营州县国']);
const GROUP_SUFFIX = new Set([...'派帮教门会宗']);
const BRACKETS = new Set([...'《》“”‘’「」『』〈〉【】（）()"']);

const isHanUnit = (c: number): boolean =>
  (c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf) || (c >= 0xf900 && c <= 0xfaff);

/** Everything detection learned about one string. */
export interface TermCandidate {
  word: string;
  count: number;
  /** Strongest-split binding in 0–1: how much of the weaker part's occurrences sit inside this string. */
  bind: number;
  /** Weakest-split pointwise mutual information (nats). */
  pmi: number;
  /** Entropy of the characters before / after (nats); brackets count as free. */
  left: number;
  right: number;
  /** Share of occurrences followed by a verb of speech. */
  speech: number;
  /** Dictionary status: CEDICT/HSK headword, jieba-only, or unknown. */
  known: 'entry' | 'jieba' | 'none';
  kind: LexiconEntry['kind'];
  surnameLed: boolean;
}

interface Stat { left: Map<number, number>; right: Map<number, number>; }

function entropy(m: Map<number, number>, total: number): number {
  if (!total) return 0;
  let e = 0;
  for (const v of m.values()) e -= (v / total) * Math.log(v / total);
  return e;
}

/** Entropy of a neighbor distribution, but a dominant bracket (《九阴真经》) means "complete", not "stuck". */
function sideScore(m: Map<number, number>, total: number): number {
  if (!total) return 0;
  let best = 0;
  let bestKey = -1;
  for (const [k, v] of m) if (v > best) { best = v; bestKey = k; }
  if (bestKey >= 0 && best / total >= 0.5 && BRACKETS.has(String.fromCharCode(bestKey))) return 9;
  return entropy(m, total);
}

export interface DetectOptions {
  /** Longest string considered, in characters. */
  maxLen?: number;
  /** Return every candidate that survived the first filters (for tuning), not only the accepted entries. */
  debug?: (cands: TermCandidate[]) => void;
}

/** True for a name like 郭靖: a surname followed by one or two given-name characters. */
export function surnameSplit(word: string, dict?: Dictionary): { surname: string; given: string } | null {
  const simp = dict ? dict.toSimplified(word) : word;
  const cps = [...simp];
  const orig = [...word];
  if (cps.length !== orig.length) return null;
  if (cps.length >= 3 && COMPOUND_SURNAMES.has(cps[0] + cps[1])) {
    const given = orig.length - 2;
    if (given >= 1 && given <= 2) return { surname: orig[0] + orig[1], given: orig.slice(2).join('') };
  }
  if (cps.length >= 2 && cps.length <= 4 && SURNAMES.has(cps[0])) {
    return { surname: orig[0], given: orig.slice(1).join('') };
  }
  return null;
}

/**
 * Detection as a generator that yields now and then, so a caller can run it in idle slices.
 * `detectTerms` drives it to the end; `detectTermsAsync` gives the event loop a turn at each yield.
 */
export function* detectGen(chapterTexts: string[], dict: Dictionary, opts: DetectOptions = {}): Generator<void, LexiconEntry[], void> {
  const maxLen = Math.min(6, Math.max(2, opts.maxLen ?? 6));
  const text = chapterTexts.join('\n');
  const n = text.length;
  if (n < 50) return [];

  // ---- Han mask, unigram counts, run ends
  const han = new Uint8Array(n);
  const uni = new Uint32Array(65536);
  let hanCount = 0;
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);
    if (isHanUnit(c)) { han[i] = 1; uni[c]++; hanCount++; }
  }
  const runEnd = new Int32Array(n + 1);
  for (let i = n - 1; i >= 0; i--) runEnd[i] = han[i] ? (i + 1 < n && han[i + 1] ? runEnd[i + 1] : i + 1) : i;
  if (hanCount < 300) return [];
  const minCount = Math.max(6, Math.round(hanCount / 150000));
  yield;

  // ---- bigrams (numeric keys), then longer grams level by level, only where both halves are frequent
  const bi = new Map<number, number>();
  for (let i = 0; i + 1 < n; i++) {
    if (!(han[i] && han[i + 1])) continue;
    const k = text.charCodeAt(i) * 65536 + text.charCodeAt(i + 1);
    bi.set(k, (bi.get(k) ?? 0) + 1);
  }
  yield;
  const freq: Map<string, number>[] = [new Map(), new Map()];
  for (const [k, v] of bi) {
    if (v >= minCount) freq[1].set(String.fromCharCode(Math.floor(k / 65536), k % 65536), v);
  }
  const biOk = (i: number) => (bi.get(text.charCodeAt(i) * 65536 + text.charCodeAt(i + 1)) ?? 0) >= minCount;
  for (let len = 3; len <= maxLen; len++) {
    const level = new Map<string, number>();
    const prev = freq[len - 2];
    if (!prev.size) { freq[len - 1] = level; break; }
    const counts = new Map<string, number>();
    for (let i = 0; i + len <= n; i++) {
      if (runEnd[i] < i + len) continue;
      if (!biOk(i) || !biOk(i + len - 2)) continue;
      if (len > 3 && (!prev.has(text.substr(i, len - 1)) || !prev.has(text.substr(i + 1, len - 1)))) continue;
      const g = text.substr(i, len);
      counts.set(g, (counts.get(g) ?? 0) + 1);
      if ((i & 0x3ffff) === 0) { /* keep the loop tight; yields happen between levels */ }
    }
    for (const [g, v] of counts) if (v >= minCount) level.set(g, v);
    freq[len - 1] = level;
    yield;
  }
  const countOf = (g: string): number => (g.length === 1 ? uni[g.charCodeAt(0)] : freq[g.length - 1]?.get(g) ?? 0);

  // ---- first filter: edges, inside particles, binding
  const NN = hanCount;
  const cands: TermCandidate[] = [];
  const statsByWord = new Map<string, Stat>();
  for (let len = 2; len <= maxLen; len++) {
    for (const [g, c] of freq[len - 1] ?? []) {
      const first = g[0];
      const last = g[len - 1];
      if (EDGE_STOP.has(first) || EDGE_STOP.has(last)) continue;
      let bad = false;
      for (let k = 1; k < len - 1; k++) if ('的了着过'.includes(g[k])) { bad = true; break; }
      if (bad) continue;
      let bind = 1;
      let pmi = Infinity;
      for (let k = 1; k < len; k++) {
        const a = countOf(g.slice(0, k));
        const b = countOf(g.slice(k));
        if (!a || !b) { bind = 0; break; }
        bind = Math.min(bind, Math.max(c / a, c / b));
        pmi = Math.min(pmi, Math.log((c * NN) / (a * b)));
      }
      if (bind < 0.2 || pmi < 2.5) continue;
      const hasEntry = dict.hasWord(g) || dict.hasWord(dict.toSimplified(g));
      const known: TermCandidate['known'] = hasEntry ? 'entry' : dict.freq(g) > 0 ? 'jieba' : 'none';
      cands.push({ word: g, count: c, bind, pmi, left: 0, right: 0, speech: 0, known, kind: 'term', surnameLed: false });
      statsByWord.set(g, { left: new Map(), right: new Map() });
    }
  }
  yield;

  // ---- neighbors of the survivors
  const startBigrams = new Set<number>();
  const lens = new Set<number>();
  for (const c of cands) {
    startBigrams.add(c.word.charCodeAt(0) * 65536 + c.word.charCodeAt(1));
    lens.add(c.word.length);
  }
  const lenList = [...lens];
  for (let i = 0; i + 1 < n; i++) {
    if (!han[i] || !han[i + 1]) continue;
    if (!startBigrams.has(text.charCodeAt(i) * 65536 + text.charCodeAt(i + 1))) continue;
    for (const L of lenList) {
      if (runEnd[i] < i + L) continue;
      const st = statsByWord.get(text.substr(i, L));
      if (!st) continue;
      const lc = i > 0 ? text.charCodeAt(i - 1) : 10;
      const rc = i + L < n ? text.charCodeAt(i + L) : 10;
      st.left.set(lc, (st.left.get(lc) ?? 0) + 1);
      st.right.set(rc, (st.right.get(rc) ?? 0) + 1);
    }
    if ((i & 0xfffff) === 0) yield;
  }
  yield;
  for (const c of cands) {
    const st = statsByWord.get(c.word)!;
    c.left = sideScore(st.left, c.count);
    c.right = sideScore(st.right, c.count);
    let sp = 0;
    for (const [k, v] of st.right) if (SPEECH_NEXT.has(String.fromCharCode(k))) sp += v;
    c.speech = sp / c.count;
  }
  opts.debug?.(cands);

  // ---- accept, classify
  const accepted: TermCandidate[] = [];
  for (const c of cands) {
    const verdict = judge(c, dict, minCount);
    if (!verdict) continue;
    c.kind = verdict.kind;
    c.surnameLed = verdict.surnameLed;
    accepted.push(c);
  }
  accepted.sort((a, b) => b.count - a.count || b.word.length - a.word.length);

  // ---- fragments: drop a string that mostly lives inside a longer accepted one (洪七 inside 洪七公)
  const byWord = new Map(accepted.map((c) => [c.word, c] as const));
  const dropped = new Set<string>();
  for (const x of accepted) {
    for (let a = 0; a < x.word.length; a++) {
      for (let b = a + 2; b <= x.word.length; b++) {
        if (b - a === x.word.length) continue;
        const y = byWord.get(x.word.slice(a, b));
        if (y && x.count >= 0.7 * y.count) dropped.add(y.word);
      }
    }
  }
  // Strings that are only a longer rejected-or-accepted string plus a particle were removed by the edge rules.
  const out: LexiconEntry[] = [];
  for (const c of accepted) {
    if (dropped.has(c.word)) continue;
    out.push(toEntry(c, dict));
  }
  out.push(...nicknames(out, text, dict, minCount));
  return out;
}

/**
 * Pet names made from the last character of a detected name plus 儿 (靖儿 for 郭靖, 蓉儿 for 黄蓉, 康儿 for 杨康).
 * Without them the 儿 reads as the erhua suffix r; in a name it is the full syllable ér.
 */
function nicknames(found: LexiconEntry[], text: string, dict: Dictionary, minCount: number): LexiconEntry[] {
  const have = new Set(found.map((e) => e.word));
  const out: LexiconEntry[] = [];
  for (const e of found) {
    if (e.kind !== 'name' || !surnameSplit(e.word, dict) || endsWithAny(e.word, TITLE_SUFFIXES)) continue;
    const cps = [...e.word];
    const last = cps[cps.length - 1];
    if (NO_PET_NAME.has(dict.toSimplified(last))) continue;
    const syl = e.pinyin.split(' ').pop() ?? '';
    for (const er of ['儿', '兒']) {
      const nick = last + er;
      if (have.has(nick) || dict.hasWord(nick)) continue;
      let count = 0;
      for (let i = text.indexOf(nick); i >= 0; i = text.indexOf(nick, i + nick.length)) count++;
      if (count < Math.max(5, Math.round(minCount / 2))) continue;
      have.add(nick);
      out.push({ word: nick, pinyin: `${syl} er2`, gloss: `name (pet name for ${e.word})`, kind: 'name', count, enabled: true, origin: 'auto' });
    }
  }
  return out;
}

/** Pure, synchronous detection. */
export function detectTerms(chapterTexts: string[], dict: Dictionary, opts?: DetectOptions): LexiconEntry[] {
  const it = detectGen(chapterTexts, dict, opts);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}

/** Same result as detectTerms, but gives the event loop a turn between slices of work. */
export async function detectTermsAsync(chapterTexts: string[], dict: Dictionary, opts?: DetectOptions, sliceMs = 30): Promise<LexiconEntry[]> {
  const it = detectGen(chapterTexts, dict, opts);
  let last = Date.now();
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
    if (Date.now() - last > sliceMs) {
      await new Promise<void>((res) => setTimeout(res, 0));
      last = Date.now();
    }
  }
}

// ---------------------------------------------------------------- verdicts ---

/** Endings of martial-arts and book titles: 九阴真经, 降龙十八掌, 打狗棒法, 蛤蟆功, 一阳指, 软猬甲. */
const ART_SUFFIX = new Set([...'经掌法拳指功阵甲爪剑刀棍鞭诀谱录']);
/** Endings of a courtesy title that follows a name or stands for one: 一灯大师, 灵智上人, 简长老, 黄岛主. */
const TITLE_SUFFIXES = ['大师', '上人', '长老', '真人', '道长', '庄主', '岛主', '帮主', '掌门', '老祖', '皇爷', '贵妃', '小姐', '先生', '夫人', '公子', '教主', '谷主', '寨主', '宗师'];
/** A string that starts with one of these is a count or a measure phrase (一条, 几句话), not a name. */
const MEASURE_START = new Set([...'一二三四五六七八九十两几这那每各某句个条件顿场座颗艘层股块群番阵']);
/** A string that ends with one of these is a half-finished phrase (微微一, 郭杨二人). */
const FRAGMENT_END = new Set([...'一二三四五六七八九十两几']);
/** Measure words: a numeral followed by one of these is a count (一顶, 三件), not part of a name. */
const MEASURE_AFTER = new Set([...'个只件条张把顶本头匹位口座片块根枝支双对句声眼次回遍下番场阵']);
/** "Surname + these" is a family or a group (王父子, 郭杨二人), not one person's name. */
const KIN_PAIRS = new Set(['父子', '母子', '父女', '母女', '夫妇', '夫妻', '兄弟', '姐妹', '兄妹', '姐弟', '叔侄', '师徒', '主仆', '二人', '三人', '两人', '一家', '家人', '一行']);
/** A pet name is never made from these (娘儿, 官儿, 爷儿 are ordinary erhua words). */
const NO_PET_NAME = new Set([...'生化爷娘官光子头姑人氏母王侯主师公婆妃姐哥弟妹老家物马儿女夫友民兵客叔伯嫂翁']);
/** Never part of a given name: they make the string a phrase (许配给, 连人带). */
const NOT_IN_NAME = new Set([...'给带向让从跟对把被为以于得地']);
/** A two-character string ending in one of these is a bare title (寨主, 帮主), not a name. */
const BARE_TITLE_END = new Set([...'主长师爷婆']);

function endsWithAny(word: string, list: readonly string[]): boolean {
  for (const t of list) if (word.endsWith(t) && word.length > t.length) return true;
  return false;
}

/**
 * Decide whether a candidate is worth adding, and what kind it is. Strict on purpose: an entry that is not really a
 * word breaks the segmentation of ordinary text around it, while a missed name only costs a split.
 */
export function judgeCandidate(c: TermCandidate, dict: Dictionary, minCount = 6): { kind: LexiconEntry['kind']; surnameLed: boolean } | null {
  const w = c.word;
  const cps = [...w];
  const len = cps.length;
  if (len < 2 || len > 6) return null;
  if (c.known !== 'none') return null; // the dictionary already has it
  if (c.left < 1.0 || c.right < 1.0 || c.bind < 0.35) return null;
  const simp = [...dict.toSimplified(w)];
  const first = simp[0];
  const last = simp[len - 1];
  const sur = surnameSplit(w, dict);
  const strongSpeech = c.speech >= 0.06;
  const bracketed = c.left >= 9 && c.right >= 9;
  /** Characters that almost never appear outside this string, seen often: 福贵, 有庆, 凤霞. */
  const bound = c.bind >= 0.9 && c.count >= 3 * minCount;

  // Titles and fragments never start a name, whatever the counts say.
  if (FRAGMENT_END.has(last) && !bracketed) return null;
  if (last === '人' && NUMERALS.has(simp[len - 2])) return null;
  const titled = endsWithAny(w, TITLE_SUFFIXES);
  const measured = MEASURE_START.has(first) && !titled;
  const softStart = SOFT_START.has(first);
  const softEnd = SOFT_END.has(last);

  // A rare four-character string made of two dictionary words is a phrase (光耀祖宗), not a term.
  if (len >= 4 && c.count < 12 && dict.hasWord(simp.slice(0, 2).join('')) && dict.hasWord(simp.slice(2).join(''))) return null;

  // Martial arts, books, techniques.
  if (len >= 3 && ART_SUFFIX.has(last) && !softEnd && !softStart && !measured && c.speech < 0.05 && c.bind >= 0.4 && !(sur && len <= 3)) {
    return { kind: 'term', surnameLed: false };
  }
  if (bracketed && len >= 3 && !softEnd) return { kind: 'term', surnameLed: false };

  // Places and groups: 桃花岛, 牛家村, 归云庄, 铁掌帮, 大金国.
  if (PLACE_SUFFIX.has(last) && !softEnd && !softStart && !measured && c.speech < 0.05 && c.bind >= 0.4 && len >= 3) {
    return { kind: 'place', surnameLed: false };
  }
  if (GROUP_SUFFIX.has(last) && len >= 3 && !measured && c.speech < 0.05 && c.bind >= 0.4) return { kind: 'place', surnameLed: false };
  if (len === 2 && last === '国' && c.bind >= 0.3 && c.speech < 0.05 && !measured) return { kind: 'place', surnameLed: false };

  // Names.
  if (softEnd) return null;
  if (measured && !(strongSpeech && c.bind >= 0.5)) return null;
  if (softStart && !(bound || (c.bind >= 0.7 && strongSpeech))) return null;
  if (len === 2 && BARE_TITLE_END.has(last)) return null;
  if (sur) {
    const given = [...dict.toSimplified(sur.given)];
    if (given.some((g) => EDGE_STOP.has(g) || NOT_IN_NAME.has(g))) return null;
    if (given.length === 1 && NUMERALS.has(given[0])) return null;
    // 戴一顶 (wear a ...), 王父子 (Wang and son): a verb or a family word after a surname-like character.
    if (given.some((g, i) => NUMERALS.has(g) && MEASURE_AFTER.has(given[i + 1] ?? ''))) return null;
    if (given.length === 2 && !titled && KIN_PAIRS.has(given.join(''))) return null;
    // A surname plus three or more more characters is a name only with a title (程大小姐) or a compound surname.
    if (given.length > 2 && !titled) return null;
    if (len === 2 || (len === 3 && COMPOUND_SURNAMES.has(first + simp[1]))) {
      // Two characters (杨康, 马钰) are short enough to be an ordinary word: they must be seen speaking.
      if (!(strongSpeech && c.bind >= 0.4) && !bound) return null;
    } else if (c.bind < 0.45 && !strongSpeech) {
      return null;
    }
    if (len >= 5 && !titled && !COMPOUND_SURNAMES.has(first + simp[1])) return null;
    return { kind: 'name', surnameLed: true };
  }
  if (titled && len <= 5 && c.bind >= 0.4) return { kind: 'name', surnameLed: false };
  // Nicknames: 老毒物, 小红马.
  if ((first === '老' || first === '小') && len === 3 && c.bind >= 0.6 && c.right >= 2) return { kind: 'name', surnameLed: false };
  // Names without a Chinese surname (哲别, 瑛姑, 札木合, 窝阔台): they speak and are spoken to.
  if (len <= 4 && strongSpeech && c.bind >= 0.5 && c.count >= minCountForNames(c)) return { kind: 'name', surnameLed: false };
  // A tightly bound string with no sign of what it is: a name from a first-person book, or a missing word.
  if (len <= 4 && bound && c.pmi >= 4.5 && c.speech < 0.05 && !measured) {
    // In a novel, a two-character string this tightly bound and this frequent is almost always a person (福贵, 有庆).
    return { kind: len === 2 && c.count >= 50 ? 'name' : 'term', surnameLed: false };
  }
  return null;
}

function minCountForNames(c: TermCandidate): number {
  return c.right >= 3 ? 20 : 40;
}

function judge(c: TermCandidate, dict: Dictionary, minCount: number): { kind: LexiconEntry['kind']; surnameLed: boolean } | null {
  return judgeCandidate(c, dict, minCount);
}

/** Numbered pinyin of a detected word, one syllable per code point. */
export function pinyinOf(word: string, kind: LexiconEntry['kind'], dict: Dictionary): string {
  const cps = [...word];
  const simp = [...dict.toSimplified(word)];
  const out: string[] = [];
  let skip = 0;
  if (kind === 'name') {
    const sur = surnameSplit(word, dict);
    if (sur) {
      const sc = [...sur.surname];
      const key = simp.slice(0, sc.length).join('');
      const compound = sc.length === 2 ? COMPOUND_SURNAME_READINGS[key] : undefined;
      if (compound) { out.push(...compound.split(' ')); skip = 2; }
      else if (sc.length === 1 && SURNAME_READINGS[key]) { out.push(SURNAME_READINGS[key]); skip = 1; }
    }
  }
  // The rest reads as a whole, so dictionary words inside it keep their readings (简长老 → zhǎnglǎo, 刘县长 → xiànzhǎng).
  const rest = skip < cps.length ? dict.pinyinFor(cps.slice(skip).join(''), {}) : [];
  for (let i = skip; i < cps.length; i++) {
    const s = simp[i];
    const forced = kind === 'name' ? NAME_CHAR_READINGS[s] : undefined;
    out.push(forced ?? rest[i - skip] ?? '');
  }
  // 哥哥, 姑姑: the second of a doubled character at the end of a name is neutral.
  if (cps.length >= 3 && cps[cps.length - 1] === cps[cps.length - 2] && out[out.length - 1]) {
    out[out.length - 1] = out[out.length - 1].replace(/[1-4]$/, '5');
  }
  return out.join(' ');
}

const GLOSS: Record<LexiconEntry['kind'], string> = {
  name: 'name (person)', place: 'place or group name', term: 'name or term in this book', user: '',
};

function toEntry(c: TermCandidate, dict: Dictionary): LexiconEntry {
  return { word: c.word, pinyin: pinyinOf(c.word, c.kind, dict), gloss: GLOSS[c.kind], kind: c.kind, count: c.count, enabled: true, origin: 'auto' };
}

/**
 * Read what a user typed for the pinyin of `word` ("guo1 jing4", "guō jìng", "guōjìng", "Guo Jing") as numbered
 * syllables, one per code point. Returns null when it does not fit the word.
 */
export function parseEntryPinyin(input: string, word: string): string | null {
  const n = [...word].length;
  const text = input.trim().replace(/[，,;；]/g, ' ').replace(/\s+/g, ' ');
  if (!text) return null;
  let parts = text.split(' ').map((p) => markedToNumbered(p).toLowerCase());
  if (parts.length === 1 && n > 1) {
    const run = splitPinyinRun(text.replace(/ /g, ''));
    if (run) parts = run.map((p) => p.toLowerCase());
  }
  if (parts.length !== n) return null;
  if (!parts.every((p) => /^[a-zü]+[1-5]$/.test(p))) return null;
  return parts.join(' ');
}

/** Lexicon rows for the user's own words in the scope of every book. */
export const USER_SCOPE = '*';

/**
 * Merge the '*' rows and a book's rows into one lexicon. The book's row wins for the same word. Disabled rows are
 * dropped here (they only exist so detection does not bring a rejected word back).
 */
export function mergeLexicon(userRows: LexiconEntry[], bookRows: LexiconEntry[]): Lexicon {
  const m = new Map<string, LexiconEntry>();
  for (const r of userRows) m.set(r.word, r);
  for (const r of bookRows) m.set(r.word, r);
  return buildLexicon([...m.values()]);
}

/** Text of each chapter, paragraphs joined by newlines, for detection. */
async function bookTexts(ctx: AppContext, bookId: string): Promise<string[]> {
  const book = await ctx.store.books.get(bookId);
  if (!book) return [];
  const out: string[] = [];
  for (let i = 0; i < book.chapterCount; i++) {
    const ch = await ctx.store.books.chapter(bookId, i);
    if (!ch) continue;
    const parts: string[] = [];
    for (const b of ch.blocks) if ((b.t === 'p' || b.t === 'quote') && b.text) parts.push(b.text);
    out.push(parts.join('\n'));
  }
  return out;
}

const running = new Map<string, Promise<void>>();

/** True while a background scan of this book is running (the reader holds back other heavy work until it ends). */
export function isDetecting(bookId: string): boolean {
  return running.has(bookId);
}

/**
 * The lexicon for reading `bookId`: the user's '*' words + the book's rows. If the book has never been
 * scanned (or was scanned by an older detector), returns what exists now and runs detection in the background
 * (idle slices), saves it, then calls `onUpdate` with the new lexicon so the reader can re-render.
 */
export async function loadLexicon(ctx: AppContext, bookId: string, onUpdate?: (lex: Lexicon) => void): Promise<Lexicon> {
  const store = ctx.store;
  const read = async () => mergeLexicon(await store.lexicon.get(USER_SCOPE), await store.lexicon.get(bookId));
  const lex = await read();
  if (await store.lexicon.detected(bookId, DETECTOR_VERSION)) return lex;
  if (!running.has(bookId)) {
    const job = (async () => {
      const [dict, texts] = await Promise.all([ctx.dict(), bookTexts(ctx, bookId)]);
      // Slices of 120 ms: the reader is busy laying out pages, and a short slice waits behind every one of its tasks.
      const found = await detectTermsAsync(texts, dict, undefined, 120);
      await store.lexicon.putDetected(bookId, found, DETECTOR_VERSION);
    })().finally(() => { running.delete(bookId); });
    running.set(bookId, job);
  }
  const job = running.get(bookId)!;
  void job.then(
    async () => { onUpdate?.(await read()); },
    async (e) => { console.error('lexicon detection', e); onUpdate?.(await read()); }, // the caller stops waiting either way
  );
  return lex;
}
