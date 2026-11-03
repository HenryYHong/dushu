// Book names and terms: discovery, the lexicon object, and loading/saving it. Contract: ARCHITECTURE.md §4.9.
//
// Real novels are full of words no dictionary has: character names, places, martial-arts and period terms.
// detectTerms() finds them by counting the book's own n-grams (a word is a string that holds together and has
// free neighbors on both sides), then sorts what it finds into name / place / term. Precision beats recall: a
// wrong entry breaks the segmentation of ordinary text, a missed name only costs a split.
import type { AppContext, Dictionary, Lexicon, LexiconEntry } from '../types';
import { markedToNumbered, splitPinyinRun } from './pinyin';
import { SURNAME_READINGS, COMPOUND_SURNAME_READINGS, NAME_CHAR_READINGS, TRANSLITERATION_READINGS, KIN_CHARS, HEAD_BEFORE_ZHANG } from './names';
import { COMPOUND_SURNAMES, SURNAMES } from './names';
import { isChinese } from '../lang/active';
export { capitalizePinyin, pinyinGroups } from './names';

/** Detection hands the main thread back after this much work (ms), so a slice stays within a frame. */
const SLICE_WORK_MS = 8;
const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Bump when detection changes enough that stored results should be recomputed. */
export const DETECTOR_VERSION = 8;

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
/** Of EDGE_STOP, the ones that can end a given name (周雍和, 邹永才) when the rest of the name holds them. */
const NAME_TAIL = new Set([...'和才']);
/** Never start a name or term: they open a clause or a verb phrase (谓之, 此机会, 转过山), and none is a surname. */
const PHRASE_START = new Set([...'谓此转']);
/** Characters that rarely start a name or term but can (有庆, 向问天): accepted only when strongly bound. */
const SOFT_START = new Set([...'有没要会能可以对给从向跟说道笑问叫看听想去来到为让见只便然至往自于在此其本该該回']);
/** Characters that rarely end a name or term: verbs of speech, direction and locatives. */
const SOFT_END = new Set([...'道说笑问叫看听想去来到上下里中外内前后边面起出完得地等家其回过過报報处處']);
/** Right after one of these, a string is acting as a person (the object of an address or an order). */
const PERSON_PREP = new Set([...'对對向问問叫和与與让讓给給跟见見命令派请請使谢謝扶抱拉救杀殺打骂罵恨爱愛喊唤喚召找随隨同被']);
/** Followed by one of these, a string is acting as a person (subject of speech). */
const SPEECH_NEXT = new Set([...'说道笑叫问答喊哭骂叹怒喝嚷应曰']);
const DAO = '道'.charCodeAt(0);
/** After 道 these make a noun (道士, 道人, 道童, 道观), not a verb of speech. */
const DAO_NOUN = new Set([...'士人童观觀长長姑院']);
/** In SURNAMES, but before a name they are a function word: 那虞候, 连宝玉, 闻玄德, 这时宝玉. */
const NOT_SURNAME_HERE = new Set([...'那连闻时方乃并']);
/** A dictionary sense that is a town or a village (段家 "Duanjia (a town in Fufeng …)"). */
const TOWN_DEF = /\((a |an )?(town|township|village|subdistrict|county|district)\b/i;
/** Characters of transliterated names (史密斯, 伊万诺夫): such a name has no short form. */
const TRANSLITERATION = new Set([...'斯尔特姆奇兹娜莎丝诺维耶']);
/** A dictionary sense for a person or an office: such a word is not a given name used alone (张司令 → 司令 is a title). */
const PERSON_DEF = /\b(person|people|official|officer|title|address|commander|secretary|king|master|teacher|scholar|chief|head|general|minister|clerk|captain|leader|director|governor|marshal|prefect|uncle|aunt|brother|sister|mother|father|parents?|wife|husband|son|daughter|madam|sir|lord|lady|servant|maid|monk|priest|nun|girl|boy|man|woman|elder|grandmother|grandfather|nanny|pedant|preceptor|tutor|soldier|troops?|army|infantry|cavalry|militia|guard|demon|devil|secretariat)s?\b/i;
/** The last character of a word for a kind of person (木匠, 道士, 舅妈, 首长): 老木匠 and 小舅妈 describe someone, they are not names. */
const PERSON_HEAD = new Set([...'夫士弥长女汉匠工兵卒贼啰婢仆丁员官吏翁叟姑婆妇娘嫂姐妹哥弟爷奶叔伯舅婶姨爹妈父母']);
const NUMERALS = new Set([...'零〇一二三四五六七八九十百千万两半几']);
const PLACE_SUFFIX = new Set([...'岛山庄寺城府村镇峰谷关江河湖海岭洞殿堡宫楼阁庙塔桥坡寨营州县国亭郡观觀湾沟屯坪']);
/** A string that ends with one of these is an office or a rank (郡侯, 功曹, 真君), not a person's name; a surname before it makes it a name (张道士). */
const ROLE_END = new Set([...'侯曹君办辦丞官吏役卒兵將将妖魔怪王帝']);
const GROUP_SUFFIX = new Set([...'派帮教门会宗']);
const BRACKETS = new Set([...'《》“”‘’「」『』〈〉【】（）()"']);
/** Marks that open what someone says, and what follows a name called out (“苇官，, 「四毛！). */
const OPEN_QUOTES = new Set([...'“「『‘'].map((ch) => ch.charCodeAt(0)));
const CALL_AFTER = new Set([...'，,！!？?…—'].map((ch) => ch.charCodeAt(0)));

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
  /** Share of occurrences right after a verb or preposition that takes a person (对 向 问 叫 命 …): people are addressed and ordered. */
  prep: number;
  /** Share of occurrences that open a quotation and are followed by a comma or an exclamation (“苇官，回家！”): someone called by name. */
  voc?: number;
  /** The last character is held by the one before it (in 周雍和, 雍 is nearly always 雍和), so a final 和 is not the conjunction. */
  tailBound?: boolean;
  /** Three characters whose first two are hardly ever seen without the third (邹永 nearly always 邹永才), so a final 才 is a given name's. */
  headBound?: boolean;
  /** Share of occurrences right after a mark, a line break or other non-Han text: the string opens a clause. */
  open?: number;
  /** Occurrences per thousand Han characters of the book. */
  rate?: number;
  /** How many times more often the book uses it than the corpus would predict for a text this long (dictionary words only). */
  key?: number;
  /** For three characters or more: occurrences of its first two characters anywhere in the book (白玉 around 白玉珪). */
  head?: number;
  /** Dictionary status: CEDICT/HSK headword, jieba-only, or unknown. */
  known: 'entry' | 'jieba' | 'none';
  kind: LexiconEntry['kind'];
  surnameLed: boolean;
}

interface Stat { left: Map<number, number>; right: Map<number, number>; daoNoun?: number; voc?: number; }

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
  // Yield every few milliseconds of work, not only between phases: an idle-sliced caller then never holds the main
  // thread for more than a frame, even on a million-character book.
  let lastYield = now();
  const due = (): boolean => { const t = now(); if (t - lastYield < SLICE_WORK_MS) return false; lastYield = t; return true; };
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
    if ((i & 0xffff) === 0xffff && due()) yield;
  }
  const runEnd = new Int32Array(n + 1);
  for (let i = n - 1; i >= 0; i--) runEnd[i] = han[i] ? (i + 1 < n && han[i + 1] ? runEnd[i + 1] : i + 1) : i;
  if (hanCount < 300) return [];
  // A short text (an essay, a story of a few thousand characters) mentions its places and people a handful of times: it
  // is read with a lower count and a much stricter test (judgeShort).
  const short = hanCount < SHORT_TEXT;
  const minCount = short ? 3 : Math.max(6, Math.round(hanCount / 150000));
  yield;

  // ---- bigrams (numeric keys), then longer grams level by level, only where both halves are frequent
  const bi = new Map<number, number>();
  for (let i = 0; i + 1 < n; i++) {
    if ((i & 0x7fff) === 0x7fff && due()) yield;
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
      if ((i & 0x7fff) === 0x7fff && due()) yield;
      if (runEnd[i] < i + len) continue;
      if (!biOk(i) || !biOk(i + len - 2)) continue;
      if (len > 3 && (!prev.has(text.substr(i, len - 1)) || !prev.has(text.substr(i + 1, len - 1)))) continue;
      const g = text.substr(i, len);
      counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    for (const [g, v] of counts) if (v >= minCount) level.set(g, v);
    freq[len - 1] = level;
    yield;
  }
  const countOf = (g: string): number => (g.length === 1 ? uni[g.charCodeAt(0)] : freq[g.length - 1]?.get(g) ?? 0);

  // ---- first filter: edges, inside particles, binding
  const NN = hanCount;
  const wordTotal = dict.meta?.counts?.wordTotal || 1;
  const cands: TermCandidate[] = [];
  const statsByWord = new Map<string, Stat>();
  for (let len = 2; len <= maxLen; len++) {
    let seen = 0;
    for (const [g, c] of freq[len - 1] ?? []) {
      if ((++seen & 0x1ff) === 0 && due()) yield;
      const first = g[0];
      const last = g[len - 1];
      // 周雍和: a final 和 is part of the name when the character before it is almost never seen without it.
      const tailBound = len >= 3 && countOf(g.slice(len - 2)) >= 0.8 * countOf(g[len - 2]);
      // 邹永才: a surname and two characters whose first two are hardly ever seen without the third; a final 才 is the name's.
      const headBound = len === 3 && NAME_TAIL.has(last) && countOf(g.slice(0, 2)) <= 1.1 * c && SURNAMES.has(dict.toSimplified(first));
      if (EDGE_STOP.has(first) || (EDGE_STOP.has(last) && !(tailBound && last === '和') && !headBound)) continue;
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
      const f = known === 'none' ? 0 : dict.freq(g);
      cands.push({ word: g, count: c, bind, pmi, left: 0, right: 0, speech: 0, prep: 0, known, kind: 'term', surnameLed: false, tailBound, headBound,
        rate: (1000 * c) / hanCount, head: len >= 3 ? countOf(g.slice(0, 2)) : undefined, key: f > 0 ? (c * wordTotal) / (f * (hanCount / 1.5)) : undefined });
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
    if ((i & 0x7fff) === 0x7fff && due()) yield;
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
      // 黄花观道士: a 道 that starts 道士 or 道人 is not a verb of speech.
      if (rc === DAO && DAO_NOUN.has(text[i + L + 1])) st.daoNoun = (st.daoNoun ?? 0) + 1;
      // “苇官，… / “四毛！: called by name at the start of what someone says.
      if (OPEN_QUOTES.has(lc) && CALL_AFTER.has(rc)) st.voc = (st.voc ?? 0) + 1;
    }
  }
  yield;
  for (const c of cands) {
    const st = statsByWord.get(c.word)!;
    c.left = sideScore(st.left, c.count);
    c.right = sideScore(st.right, c.count);
    let sp = -(st.daoNoun ?? 0);
    for (const [k, v] of st.right) if (SPEECH_NEXT.has(String.fromCharCode(k))) sp += v;
    c.speech = sp / c.count;
    let pp = 0;
    let op = 0;
    for (const [k, v] of st.left) {
      if (PERSON_PREP.has(String.fromCharCode(k))) pp += v;
      if (!isHanUnit(k)) op += v;
    }
    c.prep = pp / c.count;
    c.open = op / c.count;
    c.voc = (st.voc ?? 0) / c.count;
  }
  opts.debug?.(cands);

  // ---- accept, classify
  const accepted: TermCandidate[] = [];
  let judged = 0;
  for (const c of cands) {
    if ((++judged & 0x3f) === 0 && due()) yield;
    // (A short text still gets what a long one would find at six sightings: 差不多先生.)
    const verdict = short ? judgeShort(c, dict) ?? (c.count >= 6 ? judge(c, dict, 6) : null) : judge(c, dict, minCount);
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
  const bigram = (a: string, b: string): number => bi.get(a.charCodeAt(0) * 65536 + b.charCodeAt(0)) ?? 0;
  // The passes below count whole-book patterns: a short text keeps the usual minimum for them.
  const passCount = short ? 6 : minCount;
  out.push(...nicknames(out, text, dict, passCount));
  yield;
  out.push(...(yield* speakers(out, text, dict, passCount, due)));
  out.push(...(yield* siblings(out, text, dict, passCount, due)));
  const kept = yield* boundaries(out, text, dict, statsByWord, bigram, due);
  // The family of each name kept, checked against its neighbors the same way.
  const fam = yield* family(kept, text, dict, passCount, hanCount, new Map(cands.map((c) => [c.word, c])), due);
  const all = fam.length ? yield* boundaries([...kept, ...fam], text, dict, statsByWord, bigram, due, new Set(fam.map((e) => e.word))) : kept;
  return princesses(all, text, dict);
}

/**
 * 华蓁公主: a name the book often follows with 公主 (princess) is a title or a given name, not a surname and a given name (a
 * princess is named by her fief or her own name), so a character with a surname reading of its own reads as usual (华 huá).
 */
function princesses(entries: LexiconEntry[], text: string, dict: Dictionary): LexiconEntry[] {
  for (const e of entries) {
    if (e.kind !== 'name' || !surnameSplit(e.word, dict)) continue;
    let n = 0;
    for (let i = text.indexOf(e.word + '公主'); i >= 0; i = text.indexOf(e.word + '公主', i + 1)) n++;
    if (n >= 3 && n >= 0.03 * (e.count ?? 0)) e.pinyin = pinyinOf(e.word, 'name', dict, false);
  }
  return entries;
}

// ---------------------------------------------------------- boundaries ---

/**
 * A dictionary word for one person that the segmenter knows (曹操, 孙权, 宋江). CC-CEDICT writes a person as surname and
 * given name, both capitalized (Cao2 Cao1, Zhu1 ge3 Liang4); a place or a title is one capitalized word (Liang2 shan1,
 * Long2 wang2). A mountain is the exception (Hua4 Shan1).
 */
function personName(w: string, dict: Dictionary): boolean {
  const sur = dict.freq(w) > 0 ? surnameSplit(w, dict) : null;
  if (!sur || dict.toSimplified(w.slice(-1)) === '山') return false;
  const k = [...sur.surname].length;
  const senses = dict.lookup(w);
  return senses.length > 0 && senses.every((e) => { const syl = e.pinyin.split(' '); return /^[A-Z]/.test(syl[0]) && /^[A-Z]/.test(syl[k] ?? ''); });
}

/** A dictionary word whose every sense is an ordinary word (lowercase pinyin): 二老 "parents", not 宋江. */
function commonWord(w: string, dict: Dictionary): boolean {
  const senses = dict.lookup(w);
  return senses.length > 0 && senses.every((e) => /^[a-zü]/.test(e.pinyin));
}

/** A dictionary entry made only of proper nouns (关云长, 猪悟能). */
function properNoun(w: string, dict: Dictionary): boolean {
  const senses = dict.lookup(w);
  return senses.length > 0 && senses.every((e) => /^[A-Z]/.test(e.pinyin));
}

/**
 * Last checks of every entry against its neighbors in the text. A lexicon word wins segmentation over the dictionary,
 * so an entry that keeps cutting real words is worse than a missed one. Dropped:
 * - one character after it most of the time that makes a word with its last character (替天行|道, 大儿|子), for a person;
 *   or one character before it most of the time that makes a word with its first (拍|马舞刀), for any kind; or one character
 *   before it often enough that makes a dictionary word with all of it (大|闹天宫, 南|赡部洲);
 * - a dictionary person name across its edge (曹|操大, 吴主孙|权) often, or beside two or more other characters (先锋使宋江).
 * Added: a dictionary name that holds a found name (关云长 holds 云长, 孙悟空 holds 悟空), so the name never cuts it.
 */
function* boundaries(found: LexiconEntry[], text: string, dict: Dictionary, stats: Map<string, Stat>, bigram: (a: string, b: string) => number, due: () => boolean,
  fresh?: Set<string>): Generator<void, LexiconEntry[], void> {
  const have = new Set(found.map((e) => e.word));
  // A new entry is judged where it stands alone: 光明 inside 赵光明 is not a sign that it cuts 赵光.
  const around = (w: string, alone = false): Stat => {
    const st: Stat = { left: new Map(), right: new Map() };
    for (let i = text.indexOf(w); i >= 0; i = text.indexOf(w, i + 1)) {
      if (alone && ((i > 0 && have.has(text.slice(i - 1, i + w.length))) || (i > 1 && have.has(text.slice(i - 2, i + w.length))))) continue;
      const lc = i > 0 ? text.charCodeAt(i - 1) : 10;
      const rc = i + w.length < text.length ? text.charCodeAt(i + w.length) : 10;
      st.left.set(lc, (st.left.get(lc) ?? 0) + 1);
      st.right.set(rc, (st.right.get(rc) ?? 0) + 1);
    }
    return st;
  };
  const out: LexiconEntry[] = [];
  for (const e of found) {
    if (fresh && !fresh.has(e.word)) { out.push(e); continue; }
    if (due()) yield;
    const w = e.word;
    const st = fresh ? around(w, true) : stats.get(w) ?? around(w);
    let n = 0;
    for (const v of st.right.values()) n += v;
    if (!n) { out.push(e); continue; }
    const first = w[0];
    const last = w[w.length - 1];
    const top = (m: Map<number, number>): [string, number] => {
      let best = 0, key = 10;
      for (const [k, v] of m) if (v > best) { best = v; key = k; }
      return [String.fromCharCode(key), best];
    };
    // "More frequent than the entry": the neighbor word also lives outside it, so it is the real word there.
    const [r, rn] = top(st.right);
    if (e.kind === 'name' && rn >= 0.6 * n && isHanUnit(r.charCodeAt(0)) && dict.hasWord(last + r) && bigram(last, r) > n) continue;
    const [l, ln] = top(st.left);
    if (ln >= 0.6 * n && isHanUnit(l.charCodeAt(0)) && dict.hasWord(l + first) && bigram(l, first) > n) continue;
    // 大|闹天宫, 南|赡部洲: the entry is most often the tail of a longer dictionary word.
    if (ln >= 0.3 * n && isHanUnit(l.charCodeAt(0)) && dict.hasWord(l + w)) continue;
    let cut = 0;
    for (const [k, v] of st.right) { const ch = String.fromCharCode(k); if (isHanUnit(k) && !have.has(w + ch) && personName(last + ch, dict)) cut += v; }
    for (const [k, v] of st.left) { const ch = String.fromCharCode(k); if (isHanUnit(k) && !have.has(ch + w) && personName(ch + first, dict)) cut += v; }
    if (cut >= 0.25 * n) continue;
    // 先锋使宋江: a title or a phrase of two or more characters around a known person. (小李广 is a nickname, 王善保家的
    // his wife.)
    let hides = false;
    for (let k = 2; k <= w.length - 2 && !hides && !w.endsWith('家的'); k++) hides = personName(w.slice(0, k), dict) || personName(w.slice(w.length - k), dict);
    if (hides) continue;
    out.push(e);
  }

  // 关云长 around 云长: count the dictionary proper nouns that end in a found name.
  const kept = new Set(out.map((e) => e.word));
  const added: LexiconEntry[] = [];
  for (const e of out) {
    if (e.kind !== 'name' || (fresh && !fresh.has(e.word))) continue;
    if (due()) yield;
    const w = e.word;
    const longer = new Map<string, number>();
    for (let i = text.indexOf(w); i >= 0; i = text.indexOf(w, i + 1)) {
      for (let a = 1; a <= 2 && i - a >= 0 && isHanUnit(text.charCodeAt(i - a)); a++) {
        const x = text.slice(i - a, i + w.length);
        longer.set(x, (longer.get(x) ?? 0) + 1);
      }
    }
    for (const [x, count] of longer) {
      if (count < 3 || kept.has(x) || !dict.hasWord(x) || !properNoun(x, dict)) continue;
      const syl = dict.pinyinFor(x);
      kept.add(x);
      added.push({ word: x, pinyin: syl.every(Boolean) ? syl.join(' ') : pinyinOf(x, 'name', dict), gloss: glossFor(x, 'name', 'entry', dict), kind: 'name', count, enabled: true, origin: 'auto' });
    }
  }
  return [...out, ...added];
}

// ------------------------------------------------------------ speakers ---

/** A string that starts a clause and is followed by a verb of speech: 平兒笑道, 麝月便道, 周瑞家的說. */
const SPEAKER_RE = /(?:^|[\s，。！？；：、「」『』“”‘’（）—…])([\u3400-\u4dbf\u4e00-\u9fff]{2,5}?)([笑便又忙因只也都却卻则則還还仍再]?(?:說道|说道|笑道|問道|问道|答道|道|說|说|問|问|答|喊|叫|哭|嘆|叹|罵|骂|應|应|笑|曰))/gmu;
/** A string that starts with one of these is a phrase (這丫頭, 既如此, 向寶玉, 話未), not a name. */
const SPEAKER_BAD_START = new Set([...'這这那哪某各每眾众諸诸一二三四五六七八九十两兩几幾半只又还還便就也都却卻则則的了是在有无無不既且莫待方自如雖虽話话快忙對对向因以此然縱纵倘若旣又更再仍已正才并將将把被從从往跟與与及連连為为沒没謂谓轉转人']);
/** Characters that end a phrase or a verb rather than a name. */
const SPEAKER_BAD_END = new Set([...'道说說笑問问答叫喊哭嘆叹罵骂應应聽听見见了着著的得地去来來等官丞怪妖魔僧声聲曰常总總先再竟偏刚剛']);

/**
 * Given names built on one character that is used almost only in that name: 悟空 (the monk's name 悟 is hardly used
 * elsewhere) leads to 悟能 and 悟净. A two-character string that starts with the same rare character and is frequent,
 * free on both sides and unknown to the dictionary is a sibling. So is one that ends with a main character's last
 * character when that character, outside the names found, mostly stands in it (马岱 → 刘岱).
 */
function* siblings(found: LexiconEntry[], text: string, dict: Dictionary, minCount: number, due: () => boolean): Generator<void, LexiconEntry[], void> {
  const have = new Set(found.map((e) => e.word));
  const out: LexiconEntry[] = [];
  const seenFirst = new Set<string>();
  for (const e of found) {
    const cps = [...e.word];
    if (e.kind !== 'name' || cps.length !== 2 || (e.count ?? 0) < 100) continue;
    const first = cps[0];
    if (seenFirst.has(first) || SURNAMES.has(dict.toSimplified(first)) || EDGE_STOP.has(first)) continue;
    seenFirst.add(first);
    let firstTotal = 0;
    const next = new Map<string, { n: number; left: Set<string>; right: Set<string> }>();
    for (let i = text.indexOf(first), k = 0; i >= 0; i = text.indexOf(first, i + 1)) {
      if ((++k & 0x3ff) === 0 && due()) yield;
      firstTotal++;
      const b = text[i + 1];
      if (!b || !isHanUnit(b.charCodeAt(0))) continue;
      let r = next.get(b);
      if (!r) next.set(b, (r = { n: 0, left: new Set(), right: new Set() }));
      r.n++;
      r.left.add(text[i - 1] ?? '\n');
      r.right.add(text[i + 2] ?? '\n');
    }
    // The character must belong to the names: most of its uses are the name already found.
    if (firstTotal > 1.6 * (e.count ?? 0)) continue;
    for (const [b, r] of next) {
      const word = first + b;
      if (have.has(word) || r.n < Math.max(minCount * 2, Math.round((e.count ?? 0) / 10)) || r.left.size < 4 || r.right.size < 4) continue;
      if (dict.freq(word) > 0 || EDGE_STOP.has(b) || SOFT_END.has(dict.toSimplified(b))) continue;
      have.add(word);
      out.push({ word, pinyin: pinyinOf(word, 'name', dict), gloss: glossFor(word, 'name', dict.hasWord(word) ? 'entry' : 'none', dict), kind: 'name', count: r.n, enabled: true, origin: 'auto' });
    }
  }
  // The other way round: the last character of a main character's name, where no name found holds it, mostly stands in one
  // other pair that is free on both sides and unknown to the dictionary. That pair is a name too: it only looked loosely
  // bound because the main name holds most of the character (a second man whose name ends like the hero's).
  const seenLast = new Set<string>();
  for (const e of found) {
    const cps = [...e.word];
    if (e.kind !== 'name' || cps.length !== 2 || (e.count ?? 0) < 100) continue;
    const last = cps[1];
    if (seenLast.has(last) || EDGE_STOP.has(dict.toSimplified(last))) continue;
    seenLast.add(last);
    const holders: [string, number][] = [];
    for (const w of have) for (let j = w.indexOf(last); j >= 0; j = w.indexOf(last, j + 1)) holders.push([w, j]);
    let rest = 0;
    const prev = new Map<string, { n: number; left: Set<string>; right: Set<string> }>();
    for (let i = text.indexOf(last), k = 0; i >= 0; i = text.indexOf(last, i + 1)) {
      if ((++k & 0x3ff) === 0 && due()) yield;
      if (holders.some(([w, j]) => i >= j && text.startsWith(w, i - j))) continue;
      rest++;
      const a = text[i - 1];
      if (!a || !isHanUnit(a.charCodeAt(0))) continue;
      let r = prev.get(a);
      if (!r) prev.set(a, (r = { n: 0, left: new Set(), right: new Set() }));
      r.n++;
      r.left.add(text[i - 2] ?? '\n');
      r.right.add(text[i + 1] ?? '\n');
    }
    for (const [a, r] of prev) {
      const word = a + last;
      const fa = dict.toSimplified(a);
      if (have.has(word) || a === last || r.n < 2 * minCount || r.n < 0.4 * rest || r.left.size < 4 || r.right.size < 4) continue;
      if (dict.freq(word) > 0 || dict.hasWord(word) || dict.hasWord(dict.toSimplified(word))) continue;
      if (EDGE_STOP.has(fa) || NUMERALS.has(fa) || MEASURE_START.has(fa) || SOFT_START.has(fa) || PERSON_PREP.has(a) || NOT_IN_NAME.has(fa) || PHRASE_START.has(fa)) continue;
      have.add(word);
      out.push({ word, pinyin: pinyinOf(word, 'name', dict), gloss: GLOSS.name, kind: 'name', count: r.n, enabled: true, origin: 'auto' });
    }
  }
  return out;
}

/**
 * The family of a found name. A modern novel calls its people by full name and by given name (王建国 and 建国, 林如海 and
 * 如海), and brothers share a generation character (张志刚, 张志强, 张志勇). Added:
 * - the full name of a found name, when one surname stands before it often enough (黛玉 → 林黛玉), or at least three
 *   times when no other surname ever does and the characters before it vary (金桂 → 夏金桂, but not 九纹龙 + 史进). A found
 *   "name" that follows two or more surnames is a title (陆虞候, 李虞候; 鲁提辖, 孙提辖): it becomes a term, and the officers
 *   are names;
 * - the brothers and sisters of a found full name: its surname and middle character and one more (张志刚 → 张志强);
 * - the given name of a found full name used alone (王建国 → 建国), unless it keeps cutting a word at its edges (李子明, but
 *   明白), follows other surnames too (张书记, 王书记) or is half of a foreign name (史密斯). A given name that is a dictionary
 *   word (周向东 → 向东) must have a dictionary sense that is not a person or an office, the full name must speak or be spoken
 *   to, the word must come after the surname often, and the book must use it far more often than other text does; its
 *   card keeps the word's meaning.
 * Entries are changed in place (a title's kind) and the new ones returned.
 */
function* family(found: LexiconEntry[], text: string, dict: Dictionary, minCount: number, hanCount: number, cands: Map<string, TermCandidate>,
  due: () => boolean): Generator<void, LexiconEntry[], void> {
  const have = new Set(found.map((e) => e.word));
  const out: LexiconEntry[] = [];
  const fold = (s: string): string => dict.toSimplified(s);
  // A surname at text[i], and not a function word or the end of a word before the name (这时 + 宝玉, 向 + 宝玉, 那 + 虞候).
  const surnameAt = (i: number): boolean => {
    const p = text[i];
    const f = p ? fold(p) : '';
    if (!f || !SURNAMES.has(f) || PERSON_PREP.has(p) || SOFT_START.has(f) || EDGE_STOP.has(f) || NOT_SURNAME_HERE.has(f)) return false;
    return !(i > 0 && (dict.hasWord(text[i - 1] + p) || have.has(text[i - 1] + p))); // 朱武 + 杨春
  };
  /** Surnames seen right before `w` at least three times each (or `all` of them), with their counts (the full name's own surname excluded). */
  const surnamesBefore = (w: string, own = '', all = false): Map<string, number> => {
    const m = new Map<string, number>();
    for (let i = text.indexOf(w); i >= 0; i = text.indexOf(w, i + w.length)) {
      if (i > 0 && text[i - 1] !== own && surnameAt(i - 1)) m.set(text[i - 1], (m.get(text[i - 1]) ?? 0) + 1);
    }
    if (!all) for (const [k, v] of m) if (v < 3) m.delete(k);
    return m;
  };
  // 九纹龙 + 史进, 第六章 + a name: a "surname" that mostly follows the same character, or a numeral, ends a nickname or a heading.
  // (The words that take a person, 和 叫 对 …, may stand before a full name any number of times.)
  const freeBefore = (full: string, k: number): boolean => {
    const m = new Map<string, number>();
    for (let i = text.indexOf(full); i >= 0; i = text.indexOf(full, i + full.length)) {
      const a = text[i - 1] ?? '\n';
      if (!isHanUnit(a.charCodeAt(0)) || PERSON_PREP.has(a)) continue;
      if (NUMERALS.has(fold(a))) return false;
      m.set(a, (m.get(a) ?? 0) + 1);
    }
    for (const v of m.values()) if (v >= 0.5 * k) return false;
    return true;
  };
  /** A plain two-character given name: not a title, a kinship word, a pet name in 儿 or a nickname in 老/小. */
  const plainGiven = (w: string): boolean => {
    const s = [...fold(w)];
    return s.length === 2 && !'老小'.includes(s[0]) && s[1] !== '儿' && !KIN_CHARS.has(s[1]) && !ROLE_END.has(s[1]) && !BARE_TITLE_END.has(s[1]) && !PERSON_HEAD.has(s[1]);
  };
  const foreign = (w: string): boolean => [...fold(w)].some((ch) => TRANSLITERATION.has(ch));
  const names = found.filter((e) => e.kind === 'name' && !endsWithAny(e.word, TITLE_SUFFIXES));

  // 黛玉 → 林黛玉, a nickname → 张 + the nickname; 虞候 after 陆 and 李 is a title.
  for (const e of names) {
    if (e.word.length < 2 || e.word.length > 3 || (e.word.length === 3 && surnameSplit(e.word, dict)) || (e.count ?? 0) < 2 * minCount) continue;
    if (due()) yield;
    const before = surnamesBefore(e.word);
    // (Only a name the dictionary does not explain: 宋江 after 戴宗 in a list is still 宋江.)
    if (e.word.length === 2 && e.gloss.startsWith(GLOSS.name) && before.size >= 2) { e.kind = 'term'; e.gloss = GLOSS.term; }
    let seen = 0;
    if (before.size === 1) for (const v of surnamesBefore(e.word, '', true).values()) seen += v;
    for (const [p, k] of before) {
      const full = p + e.word;
      if (have.has(full) || dict.hasWord(full)) continue;
      // A main character called by the full name now and then (a few times in hundreds): enough when no other surname ever
      // stands before the given name and the characters before the full name vary.
      const sole = k === seen && plainGiven(e.word) && freeBefore(full, k);
      if ((k < minCount || k < 0.05 * (e.count ?? 0)) && !sole) continue;
      have.add(full);
      out.push({ word: full, pinyin: `${pinyinOf(full, 'name', dict).split(' ')[0]} ${e.pinyin}`, gloss: GLOSS.name, kind: 'name', count: k, enabled: true, origin: 'auto' });
    }
  }

  // 单家, 曾家: the household of a family whose surname has its own reading (Shàn, Zēng), when the book has one of them.
  const surnamed = new Set<string>();
  for (const e of [...names, ...out]) {
    const sur = surnameSplit(e.word, dict);
    if (sur && sur.surname.length === 1) surnamed.add(sur.surname);
  }
  for (const sname of surnamed) {
    const reading = SURNAME_READINGS[fold(sname)];
    const word = sname + '家';
    if (have.has(word)) continue;
    // Also a household the dictionary knows only as a town or a village (段家, 郭家), for a surname of the book's people.
    // (墨家 the Mohists and 苗家 the Miao are not towns: they keep the dictionary's card.)
    const listed = dict.hasWord(word) ? word : dict.hasWord(fold(word)) ? fold(word) : '';
    const own = !!reading && reading !== dict.pinyinFor(sname, {})[0] && !listed;
    if (!own && !(listed && properNoun(listed, dict) && dict.lookup(listed).every((x) => x.defs.every((d) => TOWN_DEF.test(d))))) continue;
    let k = 0;
    for (let i = text.indexOf(word); i >= 0; i = text.indexOf(word, i + 2)) k++;
    if (k < minCount) continue;
    have.add(word);
    out.push({ word, pinyin: `${reading ?? dict.pinyinFor(sname, {})[0]} jia1`, gloss: `the ${fold(sname)} family (a household in this book)`, kind: 'place', count: k, enabled: true, origin: 'auto' });
  }

  // 张志刚 → 张志强, 张志勇.
  const prefixes = new Set<string>();
  for (const e of [...names, ...out]) {
    if (e.kind !== 'name' || foreign(e.word)) continue;
    const sur = e.word.length === 3 ? surnameSplit(e.word, dict) : null;
    const mid = fold(e.word[1]);
    if (!sur || sur.surname.length !== 1 || NUMERALS.has(mid) || '大小老阿'.includes(mid) || EDGE_STOP.has(mid) || NOT_IN_NAME.has(mid)) continue;
    prefixes.add(e.word.slice(0, 2));
  }
  for (const pre of prefixes) {
    if (due()) yield;
    const next = new Map<string, { n: number; right: Set<string> }>();
    for (let i = text.indexOf(pre); i >= 0; i = text.indexOf(pre, i + 2)) {
      const t = text[i + 2];
      if (!t || !isHanUnit(t.charCodeAt(0))) continue;
      let r = next.get(t);
      if (!r) next.set(t, (r = { n: 0, right: new Set() }));
      r.n++;
      r.right.add(text[i + 3] ?? '\n');
    }
    for (const [t, r] of next) {
      const word = pre + t;
      const ft = fold(t);
      if (have.has(word) || r.n < minCount || r.right.size < 3 || dict.hasWord(word)) continue;
      if (EDGE_STOP.has(ft) || NOT_IN_NAME.has(ft) || SOFT_END.has(ft) || NUMERALS.has(ft) || KIN_CHARS.has(ft) || PERSON_HEAD.has(ft)) continue;
      have.add(word);
      out.push({ word, pinyin: pinyinOf(word, 'name', dict), gloss: GLOSS.name, kind: 'name', count: r.n, enabled: true, origin: 'auto' });
    }
  }

  // 王建国 → 建国, 周向东 → 向东.
  const words = hanCount / 1.5;
  const total = dict.meta?.counts?.wordTotal || 1;
  for (const e of [...names, ...out]) {
    const sur = e.kind === 'name' ? surnameSplit(e.word, dict) : null;
    if (!sur || [...sur.given].length !== 2 || foreign(e.word)) continue;
    const g = sur.given;
    const gs = [...fold(g)];
    // Not a title or a pet name (蔡太师 → 太师, 张干办 → 干办, 金钏儿 → 钏儿).
    const end = gs[1];
    if (have.has(g) || NUMERALS.has(gs[0]) || KIN_CHARS.has(end) || end === '儿'
      || ROLE_END.has(end) || BARE_TITLE_END.has(end) || PERSON_HEAD.has(end) || '手寨监監'.includes(end)) continue;
    if (due()) yield;
    if (surnamesBefore(g, sur.surname).size) continue; // 张书记, 王书记: a title
    let all = 0;
    let bare = 0;
    let cut = 0;
    for (let i = text.indexOf(g); i >= 0; i = text.indexOf(g, i + g.length)) {
      all++;
      if (text.slice(i - sur.surname.length, i) === sur.surname) continue;
      bare++;
      const p = text[i - 1] ?? '';
      const q = text[i + g.length] ?? '';
      if ((p && isHanUnit(p.charCodeAt(0)) && dict.freq(p + g[0]) >= 100) || (q && isHanUnit(q.charCodeAt(0)) && dict.freq(g[g.length - 1] + q) >= 100)) cut++;
    }
    if (bare < minCount || cut > 0.15 * bare) continue;
    const gf = fold(g);
    const f = Math.max(dict.freq(g), dict.freq(gf));
    const listed = dict.hasWord(g) || dict.hasWord(gf);
    const def = listed ? [...dict.lookup(g), ...dict.lookup(gf)].flatMap((x) => x.defs).join('; ') : '';
    const c = cands.get(e.word);
    const person = c ? c.speech + c.prep : 0;
    if (listed && (PERSON_DEF.test(def) || person < 0.1 || all - bare < 0.25 * all)) continue;
    if ((listed || f > 0) && (bare < 3 * minCount || bare < (6 * f * words) / total)) continue;
    have.add(g);
    out.push({
      word: g, pinyin: e.pinyin.split(' ').slice([...sur.surname].length).join(' '), kind: 'name', count: bare, enabled: true, origin: 'auto',
      gloss: `name (person), short for ${e.word}${def ? `; as a word: ${def.split(';')[0]}` : ''}`,
    });
  }
  return out;
}

/**
 * Characters of a novel are the ones who speak, and speech is the clearest sign of a name: 麝月便道, 龙二说,
 * 小红笑道. A string that opens a clause and is followed by a verb of speech at least a few times, and that is not
 * a dictionary word (or is only a CC-CEDICT entry the segmenter never sees, like 悟空), is added as a person.
 * Pet names in 儿 (平兒, 金釧兒) are included even though jieba knows them: it cuts them whole, but reads 儿 as r.
 */
function* speakers(found: LexiconEntry[], text: string, dict: Dictionary, minCount: number, due: () => boolean): Generator<void, LexiconEntry[], void> {
  const counts = new Map<string, number>();
  const raw = new Map<string, number>();
  const re = new RegExp(SPEAKER_RE.source, SPEAKER_RE.flags);
  for (let m = re.exec(text), k = 0; m; m = re.exec(text)) {
    if ((++k & 0x3ff) === 0 && due()) yield;
    const [, word, verb] = m;
    raw.set(word, (raw.get(word) ?? 0) + 1);
    // 操大 + 笑, 替天行 + 道: the string ends inside a word that runs into the verb (大笑, 替天行道), so it does not speak.
    // 道 is left out of the first test: 人道 公道 二道 顺道 are words, but 王夫人道 and 阮小二道 are a person speaking.
    if ((verb[0] !== '道' && dict.hasWord(word[word.length - 1] + verb[0])) || dict.hasWord(word + verb[0])) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  const have = new Set(found.map((e) => e.word));
  const need = Math.max(5, Math.round(minCount * 0.8));
  const known = (w: string) => dict.freq(w) > 0 || dict.hasWord(w) || dict.hasWord(dict.toSimplified(w));
  const total = (w: string): number => { let n = 0; for (let i = text.indexOf(w); i >= 0; i = text.indexOf(w, i + w.length)) n++; return n; };
  const out: LexiconEntry[] = [];
  for (const [word, count] of counts) {
    const cps = [...word];
    const len = cps.length;
    if (count < need || have.has(word)) continue;
    if (due()) yield;
    const simp = [...dict.toSimplified(word)];
    const maid = word.endsWith('家的') && len >= 4;
    const erhua = simp[len - 1] === '儿';
    if (SPEAKER_BAD_START.has(simp[0]) || EDGE_STOP.has(simp[0]) || (len >= 3 && cps[0] === cps[1])) continue;
    if (!maid && (SPEAKER_BAD_END.has(simp[len - 1]) || EDGE_STOP.has(simp[len - 1]))) continue;
    if (!maid && simp.some((c, i) => i > 0 && i < len - 1 && '的了着著過过得地'.includes(c))) continue;
    const f = dict.freq(word);
    const listed = dict.hasWord(word) || dict.hasWord(simp.join(''));
    // A word the corpus knows is an ordinary word; a pet name in 儿 (平兒) is the one exception: jieba cuts it
    // whole, but would read the 儿 as r.
    // (A jieba-only compound such as 晴雯 is joined by the segmenter already, but the book still wants its card:
    // a main character who speaks a lot gets an entry.)
    if (f > 0 && !(erhua && !listed) && !(!listed && count >= 20 && len <= 3)) continue;
    if (len > 4 && !maid) continue;
    if (len === 4 && !maid && known(cps.slice(0, 2).join(''))) continue; // 只見黛玉
    // 郭靖摇头 + 道, 黄蓉心 + 想: a name followed by a verb, not a name. (A name's first two characters are not a word.)
    if (len >= 3 && !maid && !erhua && (known(cps.slice(0, len - 1).join('')) || have.has(cps.slice(0, len - 1).join('')))) continue;
    if (len >= 3 && !maid && have.has(cps.slice(1).join(''))) continue; // 问郭靖
    if (len >= 3 && !maid && known(cps.slice(len - 2).join('')) && !surnameSplit(word, dict)) continue;
    if (SOFT_END.has(simp[len - 1]) && !erhua) continue;
    if (!surnameSplit(word, dict) && !maid && ROLE_END.has(simp[len - 1]) && len <= 3) continue;
    if (simp.every((c) => NUMERALS.has(c))) continue;
    if (MEASURE_START.has(simp[0]) && !(surnameSplit(word, dict) && len >= 3)) continue;
    // Names are mentioned everywhere, not only before a verb of speech.
    const all = total(word);
    if (all < 2 * (raw.get(word) ?? count)) continue;
    // A dictionary word the segmenter never sees is a name only when it is a main character.
    if (listed && f === 0 && (count < 20 || all < 40)) continue;
    const kind: LexiconEntry['kind'] = 'name';
    have.add(word);
    out.push({ word, pinyin: pinyinOf(word, kind, dict), gloss: GLOSS[kind], kind, count: all, enabled: true, origin: 'auto' });
  }
  // Drop a speaker that is only the front of a longer accepted one (周瑞家 inside 周瑞家的).
  return out.filter((e) => !out.some((o) => o !== e && o.word.length > e.word.length && o.word.startsWith(e.word) && (o.count ?? 0) >= 0.7 * (e.count ?? 0)));
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

/** Endings of martial-arts and book titles: 太玄真经, 伏虎十八拳, 飞燕剑法, 铁砂掌, 金钟罩功, 护心甲. */
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
const NOT_IN_NAME = new Set([...'给带向让从跟对把被为以于得地其此本该該回过過报報']);
/** A two-character string ending in one of these is a bare title (寨主, 帮主), not a name. */
const BARE_TITLE_END = new Set([...'主长师爷婆']);
/** Tails of a nickname after a surname, a numeral or a trait (灰脖子, 牛麻子, 七乱子, 王瘸子). */
const NICKNAME_TAILS = new Set(['麻子', '脖子', '瘸子', '秃子', '胖子', '疤子', '拐子', '乱子', '猴子', '豁子', '聋子', '瞎子', '驼子', '癞子', '胡子', '大牙', '小脚', '大脚']);
/** Characters of an interjection, never of a name called out (嗳哟, 哈呀, 怎啦). */
const INTERJECTIONS = new Set([...'嗳哎唉哈嘿喂呀咳噢哦啊哟呦啦嘛呢吧吗哇嗨呸咦嗯怎']);

function endsWithAny(word: string, list: readonly string[]): boolean {
  for (const t of list) if (word.endsWith(t) && word.length > t.length) return true;
  return false;
}

/**
 * Decide whether a candidate is worth adding, and what kind it is. Strict on purpose: an entry that is not really a
 * word breaks the segmentation of ordinary text around it, while a missed name only costs a split.
 */
export function judgeCandidate(c: TermCandidate, dict: Dictionary, minCount = 6): { kind: LexiconEntry['kind']; surnameLed: boolean } | null {
  // 梁子安: a person the corpus knows (the segmenter joins him already) whose dictionary reading is wrong (梁子 "grudge"
  // + 翁): the entry carries the name's reading.
  if (c.known === 'jieba' && [...c.word].length === 3 && surnameSplit(c.word, dict) && (c.speech >= 0.03 || c.prep >= 0.06) && c.bind >= 0.5
    && c.count >= 3 * minCount && c.left >= 2 && c.right >= 2.5 && pinyinOf(c.word, 'name', dict) !== dict.pinyinFor(c.word, {}).join(' ')) {
    return { kind: 'name', surnameLed: true };
  }
  // A common dictionary word that this book uses five hundred times more often than other text does, that speaks and is
  // bound, is a person here (two brothers called "the elder" and "the second"); the card keeps the word's meaning.
  if (c.known !== 'none' && (c.key ?? 0) >= 500 && c.count >= 10 * minCount && c.speech >= 0.06 && c.bind >= 0.6 && c.left >= 2.5 && c.right >= 2.5
    && [...c.word].length === 2 && !PERSON_HEAD.has(dict.toSimplified(c.word.slice(-1))) && commonWord(c.word, dict)) {
    return { kind: 'name', surnameLed: false };
  }
  const verdict = judgeInner(c, dict, minCount);
  // A word the dictionary lists is only ever replaced by a person (悟空); a term or place would hide a real definition.
  if (verdict && c.known === 'entry' && verdict.kind !== 'name') return null;
  // A word the dictionary lists but the corpus never saw, used hundreds of times and free on both sides, is the book's own
  // term (a science-fiction novel's world named after a medical word); 一片, 恁地 and 钉钯 are commoner than that, but
  // never once in a thousand characters. The dictionary senses still follow the card.
  if (!verdict && c.known === 'entry' && dict.freq(c.word) === 0 && c.count >= Math.max(100, 15 * minCount) && (c.rate ?? 0) >= 1 && c.bind >= 0.4
    && c.left >= 2.5 && c.right >= 2.5 && c.speech < 0.05 && !PERSON_HEAD.has(dict.toSimplified(c.word.slice(-1)))) {
    return { kind: 'term', surnameLed: false };
  }
  return verdict;
}

function judgeInner(c: TermCandidate, dict: Dictionary, minCount: number): { kind: LexiconEntry['kind']; surnameLed: boolean } | null {
  const w = c.word;
  const cps = [...w];
  const len = cps.length;
  if (len < 2 || len > 6) return null;
  // The dictionary already has it, unless it only lists it and the corpus never saw it (悟空, 麝月, 苦根): the segmenter
  // cuts such a word into characters, so the book needs its own entry. Only a person can come of that.
  const unseenEntry = c.known === 'entry' && dict.freq(c.word) === 0 && len <= 4;
  if (c.known !== 'none' && !unseenEntry) return null;
  const simp = [...dict.toSimplified(w)];
  const first = simp[0];
  const last = simp[len - 1];
  // 沙达拉威 (a foreign people): a character that is also a surname before three or more more, never apart, with no
  // title and not opening a dictionary word (柴油机厂), is a foreign word, not a surname and a given name.
  const sur0 = surnameSplit(w, dict);
  const foreign = !!sur0 && len - [...sur0.surname].length >= 3 && !endsWithAny(w, TITLE_SUFFIXES) && !KIN_CHARS.has(last)
    && c.known === 'none' && c.bind >= 0.9 && c.count >= 3 * minCount && !dict.hasWord(simp.slice(0, 2).join('')) && !dict.hasWord(simp.slice(0, 3).join(''));
  const sur = foreign ? null : sur0;
  // 灰脖子, 牛麻子, 七乱子: a surname, a numeral or a trait before a nickname's tail (a neck, pockmarks, trouble), its first two
  // characters never seen apart, spoken to or speaking: a person, however loosely the common tail binds.
  if (len === 3 && c.known === 'none' && NICKNAME_TAILS.has(simp[1] + simp[2]) && (c.head ?? Infinity) <= 1.05 * c.count
    && c.count >= 3 * minCount && c.left >= 2 && c.right >= 1.8 && c.speech + c.prep >= 0.1 && !EDGE_STOP.has(first) && !SOFT_START.has(first)) {
    return { kind: 'name', surnameLed: !!sur };
  }
  // 苇官, 四毛: a pair as bound as a name that is called out at the start of what someone says (“苇官，…”, “四毛！”) a third of
  // the time is a person, though it ends like an office or starts with a numeral. Interjections (嗳哟, 哈呀) are not.
  if (len === 2 && c.known === 'none' && (c.voc ?? 0) >= 0.3 && c.bind >= 0.6 && c.pmi >= 5 && c.count >= 5 * minCount && c.right >= 1.5
    && !simp.some((ch) => INTERJECTIONS.has(ch) || EDGE_STOP.has(ch) || NOT_IN_NAME.has(ch))) {
    return { kind: 'name', surnameLed: !!sur };
  }
  // A surname-led pair that is ordered, addressed and sent very often and is free on both sides (黃祖, 關興) is a person even
  // when its second character is common elsewhere and the binding is low.
  const ordered = !!sur && len <= 3 && c.known === 'none' && c.prep >= 0.10 && c.count >= 8 * minCount && c.bind >= 0.25 && c.pmi >= 4.3 && c.left >= 2.5 && c.right >= 2.9;
  // A surname and one more character, never seen apart, both rare in the book and free on the right, is a person even when
  // it never speaks (someone an introduction names a dozen times). Its left side may be all marks: it opens a clause each time.
  const rare = !!sur && len === 2 && c.known === 'none' && c.bind >= 0.95 && c.pmi >= 8 && c.count >= 10 && c.right >= 2 && (c.left >= 1 || (c.open ?? 0) >= 0.8);
  if ((c.left < 1.0 && !rare) || c.right < 1.0 || (c.bind < 0.35 && !ordered)) return null;
  // 谓之, 此机会, 单单只: a function word or a doubled character opens a phrase, not a name or a term.
  if (PHRASE_START.has(first) || (len >= 3 && cps[0] === cps[1])) return null;
  const strongSpeech = c.speech >= 0.06;
  const bracketed = c.left >= 9 && c.right >= 9;
  /** Characters that almost never appear outside this string, seen often: 福贵, 有庆, 凤霞. */
  const bound = c.bind >= 0.9 && c.count >= 3 * minCount;

  /** Spoken to and speaking often enough for a person: 张三, 赵喜, 钱斌. (A place is attacked and taken, a dog is called: 打荆南.) */
  const called = c.known === 'none' && c.speech + c.prep >= 0.15 && c.speech >= 0.015 && c.bind >= 0.3 && c.count >= 3 * minCount
    && c.left >= 2 && c.right >= 2.5;
  /** 李四: a surname and a numeral that is ordered and sent often is a person even if he never speaks. */
  const numbered = c.known === 'none' && c.prep >= 0.2 && c.bind >= 0.3 && c.count >= 3 * minCount && c.left >= 2 && c.right >= 2.5;

  // Titles and fragments never start a name, whatever the counts say.
  const bareNumeral = !!sur && len === 2 && NUMERALS.has(last) && (bound || called || numbered); // 龙二, 张三
  if (FRAGMENT_END.has(last) && !bracketed && !bareNumeral) return null;
  if (last === '人' && NUMERALS.has(simp[len - 2])) return null;
  const titled = endsWithAny(w, TITLE_SUFFIXES);
  const measured = MEASURE_START.has(first) && !titled;
  const softStart = SOFT_START.has(first);
  // 莫地: a pair whose first character is hardly seen without the second, and that is spoken to, is a name even though
  // 地 usually ends an adverb; so is a surname and a given name that is ordered and addressed often (周向东).
  const softEnd = SOFT_END.has(last) && !(len === 2 && c.bind >= 0.9 && c.prep >= 0.1 && c.count >= 3 * minCount) && !ordered;
  // 关内侯, 武乡侯, 汉寿亭侯: a noble title in 侯, not a person (夏侯 is a surname).
  if (last === '侯' && len >= 3 && first !== '夏') return null;
  // 刺配远恶军州: a phrase that opens with a verb (刺配 "to be exiled") is not a place, however it ends.
  if (len >= 5 && dict.lookup(simp.slice(0, 2).join('')).some((e) => /^(\([^)]*\) )?to /.test(e.defs[0] ?? ''))) return null;
  // 杨柳枝 (willow branch): a common word for a plant (杨柳) and its 枝 叶 根 条, never speaking, is not a surname and a name.
  if (sur && len === 3 && c.speech === 0 && '枝叶葉根条條'.includes(last) && dict.hasWord(simp.slice(0, 2).join('')) && dict.freq(simp.slice(0, 2).join('')) >= 100) return null;
  // 老木匠, 小舅妈, 外祖母: a modifier before a word for a kind of person describes someone; the dictionary has both parts.
  if (!sur && len >= 3 && '老小外'.includes(first) && PERSON_HEAD.has(last) && dict.freq(simp.slice(1).join('')) > 0) return null;

  // A rare four-character string made of two dictionary words is a phrase (光耀祖宗), not a term.
  if (len >= 4 && c.count < 12 && dict.hasWord(simp.slice(0, 2).join('')) && dict.hasWord(simp.slice(2).join(''))) return null;

  // A word the dictionary lists and the corpus never saw, followed by a verb of speech nearly every time, is a manner
  // adverb (朗声道, 詫异道), not a person.
  if (c.known === 'entry' && (c.speech > 0.5 || c.right < 2)) return null; // 詫异 + 道: few different followers
  if (c.speech > 0.6) return null; // 詫异道, 朗声道: nearly always followed by a verb of speech
  // 功曹, 真君, 郡侯, 妖王: an office or a rank is not a name unless a surname leads it.
  if (!sur && ROLE_END.has(last) && !titled && c.known !== 'none') return null;
  // (芳官, 藕官, the young actresses of 紅樓夢, end in 官 too: they speak, are spoken to and are free on both sides.)
  const personal = strongSpeech && c.bind >= 0.5 && c.count >= 20 && c.left >= 2.5 && c.right >= 2.5;
  if (!sur && ROLE_END.has(last) && c.known === 'none' && len <= 3 && !PLACE_SUFFIX.has(last) && !ART_SUFFIX.has(last) && !personal) return null;

  // Sworn groups: 江南七怪, 全真七子, 河朔三雄 (a place, a numeral, a kind of person).
  if (len === 4 && NUMERALS.has(simp[2]) && !NUMERALS.has(simp[0]) && !NUMERALS.has(simp[3]) && c.known === 'none'
    && c.bind >= 0.5 && c.count >= 3 * minCount && c.left >= 2 && c.right >= 2 && '怪子侠俠杰傑雄友鬼仙贤賢英'.includes(last)) {
    return { kind: 'term', surnameLed: false };
  }

  // Martial arts, books, techniques.
  // (铁龙鞭 starts with a surname but is never spoken to: a weapon.)
  if (len >= 3 && ART_SUFFIX.has(last) && !softEnd && !softStart && !measured && c.speech < 0.05 && c.bind >= 0.4 && !(sur && len <= 3 && (c.speech >= 0.02 || c.prep >= 0.05))) {
    return { kind: 'term', surnameLed: false };
  }
  if (bracketed && len >= 3 && !softEnd) return { kind: 'term', surnameLed: false };

  // Places and groups: 桃花岛, 牛家村, 归云庄, 铁掌帮, 大金国, 祝家庄, 张家湾, 白水河.
  // (林如海 ends in 海 but speaks: a person.)
  if (PLACE_SUFFIX.has(last) && !softEnd && !softStart && !measured && c.speech < 0.05 && c.bind >= 0.4 && len >= 3 && !(sur && len === 3 && (c.speech >= 0.03 || ('海河江湖'.includes(last) && simp[1] !== '家' && simp[1] !== '水')))) {
    return { kind: 'place', surnameLed: false };
  }
  // 砚城: a town named in two characters, never spoken to.
  if (len === 2 && !sur && '城村镇岛寨'.includes(last) && c.bind >= 0.7 && c.pmi >= 6 && c.count >= 5 * minCount && c.left >= 2.5 && c.right >= 2.5 && c.speech < 0.02 && !measured) {
    return { kind: 'place', surnameLed: false };
  }
  // 守塔人, 摆渡者: a role the book names again and again, as tightly bound as a name.
  if (len === 3 && !sur && '者人'.includes(last) && c.known === 'none' && c.bind >= 0.6 && c.count >= 5 * minCount && c.left >= 2.5 && c.right >= 2.5 && !measured && !softStart) {
    return { kind: 'term', surnameLed: false };
  }
  if (GROUP_SUFFIX.has(last) && len >= 3 && !measured && c.speech < 0.05 && c.bind >= 0.4) return { kind: 'place', surnameLed: false };
  if (len === 2 && last === '国' && c.bind >= 0.3 && c.speech < 0.05 && !measured) return { kind: 'place', surnameLed: false };

  // Names.
  if (softEnd) return null;
  if (measured && !(strongSpeech && c.bind >= 0.5)) return null;
  if (softStart && !(bound || (c.bind >= 0.7 && strongSpeech))) return null;
  if (len === 2 && BARE_TITLE_END.has(last)) return null;
  if (sur) {
    // 白玉珪: a word the book uses on its own far more often, plus one character, is not a surname and a given name.
    if (len === 3 && (c.head ?? 0) >= 3 * c.count && sur.surname.length === 1 && dict.freq(simp.slice(0, 2).join('')) > 0 && c.speech < 0.03) return null;
    const given = [...dict.toSimplified(sur.given)];
    // (周向东: a given name may open with 向 when the person is ordered and addressed often.)
    // (周雍和, 邹永才: a final 和 or 才 that the rest of the name holds.)
    const heldTail = (g: string, i: number): boolean => i === given.length - 1 && ((!!c.tailBound && g === '和') || (!!c.headBound && NAME_TAIL.has(g)));
    if (given.some((g, i) => (EDGE_STOP.has(g) && !heldTail(g, i)) || (NOT_IN_NAME.has(g) && !(ordered && g === '向' && i === 0)))) return null;
    // 王二, 龙二, 张三: a numeral as the whole given name is a person only when the string is tightly bound and frequent,
    // or spoken to and speaking.
    if (given.length === 1 && NUMERALS.has(given[0]) && !(bound && c.pmi >= 5 && c.speech >= 0.02) && !called && !numbered) return null;
    // 戴一顶 (wear a ...), 王父子 (Wang and son): a verb or a family word after a surname-like character.
    if (given.some((g, i) => NUMERALS.has(g) && MEASURE_AFTER.has(given[i + 1] ?? ''))) return null;
    if (given.length === 2 && !titled && KIN_PAIRS.has(given.join(''))) return null;
    // A surname plus three or more more characters is a name only with a title (程大小姐, 赵大奶奶) or a compound surname.
    const kinTitled = given.length === 3 && '大二三四五六七八九老小'.includes(given[0]) && KIN_CHARS.has(given[1]) && KIN_CHARS.has(given[2]);
    if (given.length > 2 && !titled && !kinTitled) return null;
    if (len === 2 || (len === 3 && COMPOUND_SURNAMES.has(first + simp[1]))) {
      // Two characters (杨康, 马钰) are short enough to be an ordinary word: they must be seen speaking.
      // A very tight, very frequent string that is free on both sides is a person even when she rarely speaks (司棋).
      const tight = c.bind >= 0.6 && c.pmi >= 7 && c.count >= 5 * minCount && c.left >= 2.4 && c.right >= 2.8;
      // A general of the Three Kingdoms rarely speaks in the text but is ordered, addressed and sent (令徐晃, 對夏侯惇):
      // often enough, and free on both sides, that is a person.
      const addressed = c.prep >= 0.06 && c.count >= 8 * minCount && c.bind >= 0.45 && c.pmi >= 4.3 && c.left >= 2.5 && c.right >= 3;
      if (!(strongSpeech && c.bind >= 0.4) && !bound && !tight && !addressed && !ordered && !called && !rare && !(numbered && NUMERALS.has(last))) return null;
    } else if (c.bind < 0.45 && !strongSpeech && !ordered) {
      return null;
    }
    if (len >= 5 && !titled && !COMPOUND_SURNAMES.has(first + simp[1])) return null;
    return { kind: 'name', surnameLed: true };
  }
  if (titled && len <= 5 && c.bind >= 0.4) return { kind: 'name', surnameLed: false };
  // A tightly bound, frequent two- or three-character string free on both sides, with no surname: 秋桐, 司棋-like
  // maids and young masters in a novel. Stricter than a surname-led name, looser than an unknown term.
  if ((len === 2 || len === 3) && c.known !== 'entry' && c.bind >= 0.6 && c.pmi >= 7 && c.count >= 5 * minCount && c.left >= 2.5 && c.right >= 3
    && c.speech >= 0.02 && !measured && !softStart) {
    return { kind: 'name', surnameLed: false };
  }
  // 春桃, 琼英: a frequent pair that is spoken to (对春桃, 叫琼英), speaks now and then and is free on both sides is
  // a person. (A dog, a town or a hill is spoken to or taken, but never speaks.)
  if (len === 2 && c.known === 'none' && !measured && !softStart && c.prep >= 0.1 && c.speech >= 0.015 && c.count >= 8 * minCount && c.bind >= 0.45
    && c.pmi >= 5 && c.left >= 2.5 && c.right >= 2) {
    return { kind: 'name', surnameLed: false };
  }
  // Nicknames: 老毒物, 小红马.
  if ((first === '老' || first === '小') && len === 3 && c.bind >= 0.6 && c.right >= 2) return { kind: 'name', surnameLed: false };
  // Names without a Chinese surname (哲别, 瑛姑, 札木合, 窝阔台): they speak and are spoken to.
  if (len <= 4 && strongSpeech && c.bind >= 0.5 && c.count >= minCountForNames(c)) return { kind: 'name', surnameLed: false };
  // A tightly bound string with no sign of what it is: a name from a first-person book, or a missing word.
  if (len <= 4 && bound && c.pmi >= 4.5 && c.speech < 0.05 && !measured) {
    // In a novel, a two-character string this tightly bound and this frequent is almost always a person (福贵, 有庆).
    // Transliterated names (赤老温, 合撒儿) have no surname: they are told apart from techniques and books by being
    // addressed and ordered about, which 华山论剑 and 黑风双煞 never are.
    return { kind: (len === 2 && c.count >= 50) || (len >= 3 && c.prep + c.speech >= 0.12) ? 'name' : 'term', surnameLed: false };
  }
  // 青崖: a pair as tightly bound as a name, used very often, that never speaks: the name of a place or a thing.
  if (len === 2 && c.known === 'none' && c.bind >= 0.6 && c.pmi >= 7 && c.count >= 10 * minCount && c.left >= 2.5 && c.right >= 2.5 && c.speech < 0.02 && !measured && !softStart) {
    return { kind: 'term', surnameLed: false };
  }
  return null;
}

/** Below this many Han characters a text is short: places and people are seen a few times each. */
const SHORT_TEXT = 20000;
/** Endings of a place a short text names: a garden, a road, a lane, a study, a continent (百草园, 邓脱路, 东胜神洲). */
const SHORT_PLACE_SUFFIX = new Set([...'园園路街巷屋洲']);

/**
 * The test for a short text, where three sightings must do: only a string whose characters are never seen apart (bind ≥
 * 0.9) and that has the shape of a place (白马湖, 百草园, 邓脱路, 东胜神洲) or of a surname and a given name that is spoken to or
 * speaks.
 */
function judgeShort(c: TermCandidate, dict: Dictionary): { kind: LexiconEntry['kind']; surnameLed: boolean } | null {
  if (c.known !== 'none' || c.bind < 0.9 || c.count < 3) return null;
  const simp = [...dict.toSimplified(c.word)];
  const len = simp.length;
  const first = simp[0];
  const last = simp[len - 1];
  if (len < 2 || len > 5 || EDGE_STOP.has(first) || SOFT_START.has(first) || MEASURE_START.has(first) || PHRASE_START.has(first) || SOFT_END.has(last)) return null;
  if (simp.some((ch) => NOT_IN_NAME.has(ch) || EDGE_STOP.has(ch))) return null;
  if (len >= 3 && (PLACE_SUFFIX.has(last) || SHORT_PLACE_SUFFIX.has(last)) && c.speech === 0) return { kind: 'place', surnameLed: false };
  const sur = surnameSplit(c.word, dict);
  // 仲密: seen five times and never apart, once after 对 or 叫.
  const spoken = c.speech + c.prep;
  if (sur && len <= 3 && (spoken >= 0.3 || (len === 2 && spoken >= 0.1 && c.count >= 5)) && c.left >= 0.5 && c.right >= 0.5) return { kind: 'name', surnameLed: true };
  return null;
}

function minCountForNames(c: TermCandidate): number {
  // 史密斯, 杰克: a transliterated name is tightly bound; it needs fewer turns of speech.
  if (c.bind >= 0.7 && c.pmi >= 7) return 20;
  return c.right >= 3 ? 20 : 40;
}

function judge(c: TermCandidate, dict: Dictionary, minCount: number): { kind: LexiconEntry['kind']; surnameLed: boolean } | null {
  return judgeCandidate(c, dict, minCount);
}

/** Numbered pinyin of a detected word, one syllable per code point. */
export function pinyinOf(word: string, kind: LexiconEntry['kind'], dict: Dictionary, surnameLed = true): string {
  const cps = [...word];
  const simp = [...dict.toSimplified(word)];
  const out: string[] = [];
  let skip = 0;
  const sur = kind === 'name' && surnameLed ? surnameSplit(word, dict) : null;
  if (sur) {
    // The surname reads by itself, so it never makes a word with the given name (梁子安 is not 梁子 "grudge" + 安).
    const sc = [...sur.surname];
    const key = simp.slice(0, sc.length).join('');
    const known = sc.length === 2 ? COMPOUND_SURNAME_READINGS[key] : SURNAME_READINGS[key];
    out.push(...(known ? known.split(' ') : dict.pinyinFor(sur.surname, {})));
    skip = sc.length;
  }
  // The rest reads as a whole, so dictionary words inside it keep their readings (简长老 → zhǎnglǎo, 刘县长 → xiànzhǎng).
  const rest = skip < cps.length ? dict.pinyinFor(cps.slice(skip).join(''), {}) : [];
  const named = kind === 'name' || kind === 'place';
  for (let i = skip; i < cps.length; i++) {
    const s = simp[i];
    const forced = (named ? NAME_CHAR_READINGS[cps[i]] ?? NAME_CHAR_READINGS[s] : undefined) ?? (kind === 'name' && !sur ? TRANSLITERATION_READINGS[s] : undefined);
    out.push(forced ?? rest[i - skip] ?? '');
  }
  const n = cps.length;
  // 哥哥, 姑姑: the second of a doubled kinship character at the end of a name is neutral.
  if (n >= 3 && cps[n - 1] === cps[n - 2] && KIN_CHARS.has(simp[n - 1]) && out[n - 1]) out[n - 1] = out[n - 1].replace(/[1-4]$/, '5');
  // 连长, 支队长: an office in 长 is zhǎng. 黄花观, 五庄观: a temple is guàn.
  if (n >= 3 && simp[n - 1] === '长' && HEAD_BEFORE_ZHANG.has(simp[n - 2])) out[n - 1] = 'zhang3';
  if (kind === 'place' && n >= 3 && simp[n - 1] === '观') out[n - 1] = 'guan4';
  return out.join(' ');
}

const GLOSS: Record<LexiconEntry['kind'], string> = {
  name: 'name (person)', place: 'place or group name', term: 'name or term in this book', user: '',
};

function toEntry(c: TermCandidate, dict: Dictionary): LexiconEntry {
  let gloss = glossFor(c.word, c.kind, c.known, dict);
  // 二老: a common word used as a name keeps its meaning on the card.
  if (c.kind === 'name' && c.known !== 'none' && gloss === GLOSS.name && commonWord(c.word, dict)) gloss = `${GLOSS.name}; as a word: ${dict.lookup(c.word)[0].defs[0]}`;
  return { word: c.word, pinyin: pinyinOf(c.word, c.kind, dict), gloss, kind: c.kind, count: c.count, enabled: true, origin: 'auto' };
}

/** A dictionary proper noun the segmenter never saw (悟空: "Sun Wukong, the Monkey King …") keeps its own first sense. */
function glossFor(word: string, kind: LexiconEntry['kind'], known: TermCandidate['known'], dict: Dictionary): string {
  if (known === 'entry') {
    const e = dict.lookup(word).find((x) => /^[A-Z]/.test(x.pinyin));
    const def = e?.defs.find((d) => !/^(see |variant|CL:|surname|abbr)/i.test(d));
    if (def) return def.replace(/\s*\(.*?\)\s*$/, '').replace(/[\p{Script=Han}|]+\[[^\]]*\]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 100) || GLOSS[kind];
  }
  return GLOSS[kind];
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

/** Resolves when the browser is idle, or after `timeout` ms at the latest. */
function whenIdle(timeout: number): Promise<void> {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  return new Promise((resolve) => {
    if (typeof ric === 'function') ric(() => resolve(), { timeout });
    else setTimeout(resolve, 0);
  });
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
  // Name detection reads Chinese text; a book in another language has its names from its engine (Token.name).
  if (!isChinese()) return lex;
  if (await store.lexicon.detected(bookId, DETECTOR_VERSION)) return lex;
  if (!running.has(bookId)) {
    const job = (async () => {
      const [dict, texts] = await Promise.all([ctx.dict(), bookTexts(ctx, bookId)]);
      // The first page is the reader's job: start when the browser is idle (or after a moment), then work in
      // slices of about 10 ms with the event loop getting a turn between them.
      await whenIdle(1500);
      const found = await detectTermsAsync(texts, dict, undefined, 10);
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
