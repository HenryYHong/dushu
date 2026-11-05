// Book names and terms: discovery, the lexicon object, and loading/saving it. Contract: ARCHITECTURE.md §4.9.
//
// Real novels are full of words no dictionary has: character names, places, martial-arts and period terms.
// detectTerms() finds them by counting the book's own n-grams (a word is a string that holds together and has
// free neighbors on both sides), then sorts what it finds into name / place / term. Precision beats recall: a
// wrong entry breaks the segmentation of ordinary text, a missed name only costs a split.
import type { AppContext, Dictionary, Lexicon, LexiconEntry } from '../types';
import { isSyllableBase, markedToNumbered, splitPinyinRun } from './pinyin';
import { SURNAME_READINGS, COMPOUND_SURNAME_READINGS, NAME_CHAR_READINGS, TRANSLITERATION_READINGS, KIN_CHARS, HEAD_BEFORE_ZHANG, TRANSLIT_CHARS, ERA_NAMES } from './names';
import { HAIR_COLORS, LUMINARIES, MANSION_READINGS, NAME_PIECE_READINGS, PERSON_CHAR_READINGS } from './names';
import { COMPOUND_SURNAMES, SURNAMES } from './names';
import { loadGazetteer, type Gazetteer, type GazetteerKind } from './gazetteer';
import { isChinese } from '../lang/active';
export { capitalizePinyin, pinyinGroups } from './names';

/** Detection hands the main thread back after this much work (ms), so a slice stays within a frame. */
const SLICE_WORK_MS = 8;
const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Bump when detection changes enough that stored results should be recomputed. */
export const DETECTOR_VERSION = 11;
/** Stored for a book read without the name list (core/gazetteer.ts could not fetch it): it is read again once the list is there. */
export const WITHOUT_LIST = DETECTOR_VERSION - 0.5;

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
/** Before a title someone holds, not before a person's given name: 做典史, 一任典史, 这典史, 当知县, 一个典史 (but 名处机 names one). */
const ROLE_BEFORE = new Set([...'做當当任作个個位这這该該']);
/** Never start a name or term: they open a clause or a verb phrase (谓之, 此机会, 转过山), and none is a surname. */
const PHRASE_START = new Set([...'谓此转']);
/** Characters that rarely start a name or term but can (有庆, 向问天): accepted only when strongly bound. */
const SOFT_START = new Set([...'有没要会能可以对给从向跟说道笑问叫看听想去来到为让见只便然至往自于在此其本该該回']);
/** Characters that rarely end a name or term: verbs of speech, direction and locatives. */
const SOFT_END = new Set([...'道说笑问叫看听想去来到上下里中外内前后边面起出完得地等家其回过過报報处處']);
/** Right after one of these, a string is acting as a person (the object of an address or an order). */
const PERSON_PREP = new Set([...'对對向问問叫和与與让讓给給跟见見命令派请請使谢謝扶抱拉救杀殺打骂罵恨爱愛喊唤喚召找随隨同被']);
/** Of PERSON_PREP, the ones that also take a group or a thing (对社群, 与社群, 被焚毁, 让社群): no sign of a person alone. */
const GROUP_PREP = new Set([...'对對和与與让讓给給跟见見随隨同被向']);
/** Before a measure word, with the numerals: 这张专辑, 每张, 哪条. */
const COUNT_BEFORE = new Set([...'这這那哪每某第整满滿']);
/** A sense for a kind of person that PERSON_DEF leaves out (堂倌 "(old) waiter/attendant"): a role, not a name. */
const ROLE_DEF = /\b(waiter|waitress|attendant|porter|boatman|coachman|cook|chef|doctor|nurse|peddler|beggar|thief|robber|bandit|merchant|shopkeeper|innkeeper|butler|steward|eunuch|emperor|empress|prince|princess|queen|servant|slave|farmer|peasant|worker|employee|member|customer|guest|host|stranger|enemy|friend|child|children|baby|youth|old man|old woman)s?\b/i;
/** A proper noun's sense for a place or an institution (清华 "abbr. for Tsinghua University"): not a person. */
const PLACE_ORG_DEF = /\b(university|college|school|institute|academy|company|corporation|city|county|district|province|prefecture|town|village|river|mountain|lake|island|abbr)\b/i;
/** Followed by one of these, a string is acting as a person (subject of speech). */
const SPEECH_NEXT = new Set([...'说道笑叫问答喊哭骂叹怒喝嚷应曰']);
/** The traditional forms of SPEECH_NEXT. */
const SPEECH_TRAD = new Set([...'說問罵嘆應']);
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

/** Shared with core/nameCandidates.ts (the reader's name check). */
export { EDGE_STOP, NOT_IN_NAME, INTERJECTIONS, PERSON_DEF, PERSON_HEAD, NUMERALS, MEASURE_START, SOFT_END, SOFT_START, SPEECH_NEXT, PLACE_SUFFIX, isHanUnit, covered, commonInside, verbPhrase };

/** Everything detection learned about one string. */
export interface TermCandidate {
  word: string;
  count: number;
  /** Strongest-split binding in 0–1: how much of the weaker part's occurrences sit inside this string. */
  bind: number;
  /** Weakest-split pointwise mutual information (nats). */
  pmi: number;
  /** `pmi` over its ceiling for a string this frequent, ln(chars / count): near 1 when the parts are almost never apart, however short the text. */
  npmi?: number;
  /** Entropy of the characters before / after (nats); brackets count as free. */
  left: number;
  right: number;
  /** Share of occurrences followed by a verb of speech. */
  speech: number;
  /** Share of occurrences right after a verb or preposition that takes a person (对 向 问 叫 命 …): people are addressed and ordered. */
  prep: number;
  /** Like `speech`, in either script (說 問 罵 …: `speech` counts the simplified verbs only). */
  said?: number;
  /** Of `prep`, the share after a verb that takes only a person (叫 问 命 骂 …, not 对 和 给 让 被, which also take a group or a thing). */
  pprep?: number;
  /** Share of occurrences right after a numeral or a demonstrative (一张专辑, 这张专辑): its first character is counting something. */
  counted?: number;
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
  /** A name in the suffix 子 (祥子, 小福子): its 子 is neutral. */
  neutralZi?: boolean;
}

/** What the judges decide about a candidate. */
type Verdict = { kind: LexiconEntry['kind']; surnameLed: boolean; neutralZi?: boolean };

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
  /** Set when one chapter of an anthology is read alone (perChapter): the whole-book passes are not run again. */
  inner?: boolean;
  /** Stop after the statistics (`debug` gets them) and return nothing: core/nameCandidates.ts reads them. */
  statsOnly?: boolean;
  /** The name list (core/gazetteer.ts): a listed name seen once may join when nothing around it says otherwise (listed()). */
  gazetteer?: Gazetteer | null;
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
  // (A news story of 250 characters still names its subject three or four times.)
  if (hanCount < 100) return [];
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
      cands.push({ word: g, count: c, bind, pmi, npmi: NN > c ? pmi / Math.log(NN / c) : 0, left: 0, right: 0, speech: 0, prep: 0, known, kind: 'term', surnameLed: false, tailBound, headBound,
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
    let said = sp;
    for (const [k, v] of st.right) {
      const ch = String.fromCharCode(k);
      if (SPEECH_NEXT.has(ch)) sp += v;
      if (SPEECH_NEXT.has(ch) || SPEECH_TRAD.has(ch)) said += v;
    }
    c.speech = sp / c.count;
    c.said = said / c.count;
    let pp = 0;
    let po = 0;
    let op = 0;
    let nb = 0;
    for (const [k, v] of st.left) {
      const ch = String.fromCharCode(k);
      if (PERSON_PREP.has(ch)) { pp += v; if (!GROUP_PREP.has(ch)) po += v; }
      if (NUMERALS.has(ch) || COUNT_BEFORE.has(ch)) nb += v;
      if (!isHanUnit(k)) op += v;
    }
    c.prep = pp / c.count;
    c.pprep = po / c.count;
    c.counted = nb / c.count;
    c.open = op / c.count;
    c.voc = (st.voc ?? 0) / c.count;
  }
  opts.debug?.(cands);
  if (opts.statsOnly) return [];

  // ---- accept, classify
  const accepted: TermCandidate[] = [];
  let judged = 0;
  for (const c of cands) {
    if ((++judged & 0x3f) === 0 && due()) yield;
    // (A short text still gets what a long one would find at six sightings: 差不多先生.)
    const verdict: Verdict | null = (short ? judgeShort(c, dict) ?? (c.count >= 6 ? judge(c, dict, 6) : null) : judge(c, dict, minCount))
      ?? judgeRepeat(c, dict, minCount, short);
    if (!verdict) continue;
    // 一张专辑, 第二张专辑: a "surname" that is also a measure word and comes after a numeral or 这 half the time counts a thing.
    // (这小猴子 is still the boy: 小 counts nothing.)
    if (verdict.kind === 'name' && (c.counted ?? 0) >= 0.5 && MEASURE_AFTER.has(dict.toSimplified(c.word[0]))) continue;
    c.kind = verdict.kind;
    c.surnameLed = verdict.surnameLed;
    if (verdict.neutralZi) c.neutralZi = true;
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
  let all = fam.length ? yield* boundaries([...kept, ...fam], text, dict, statsByWord, bigram, due, new Set(fam.map((e) => e.word))) : kept;
  if (!opts.inner) {
    // Names seen once with a cue around them (部长盛光祖, 名叫瑞和, 飓风文斯, 奎登·德拉尔, 阿Q), then, in an anthology, each story
    // alone. They come last, so a name seen once never seeds a family.
    const more = [...(yield* cued(all, text, dict, hanCount, due)), ...(yield* perChapter(all, chapterTexts, hanCount, dict, opts))];
    if (more.length) all = yield* boundaries([...all, ...more], text, dict, statsByWord, bigram, due, new Set(more.map((e) => e.word)));
  }
  let named = princesses(all, text, dict);
  if (opts.inner) return named;
  // Then the names of the list (people, places and organizations with a Wikipedia article) that the book uses as names. listed()
  // checks each sighting against its neighbors and the entries found, so boundaries() and princesses() need not read them again.
  if (opts.gazetteer) {
    const { add, drop } = yield* listed(named, text, han, dict, opts.gazetteer, due);
    if (drop.size) named = named.filter((e) => !drop.has(e.word));
    named.push(...add);
  }
  return [...named, ...bookScoped(named, text, dict, (ch) => uni[ch.charCodeAt(0)] > 0)];
}

/**
 * An anthology (stories, tales or articles that share no one) is also read one chapter at a time, the way a short text is read:
 * a name that fills one story (拉希姆 twelve times in a few pages) is below what the whole book asks for. The chapters share no
 * one when fewer than half of them hold any of the people found in the whole book; most chapters must be short (under
 * SHORT_TEXT Han characters). What a chapter finds is checked against the whole book afterwards (boundaries()).
 */
function* perChapter(found: LexiconEntry[], chapters: string[], hanCount: number, dict: Dictionary, opts: DetectOptions): Generator<void, LexiconEntry[], void> {
  if (chapters.length < 3 || hanCount < SHORT_TEXT) return [];
  const sizes = chapters.map((t) => { let k = 0; for (let i = 0; i < t.length; i++) if (isHanUnit(t.charCodeAt(i))) k++; return k; });
  if ([...sizes].sort((a, b) => a - b)[sizes.length >> 1] >= SHORT_TEXT) return [];
  // (A novel's people are in nearly every chapter; a trilogy's change from book to book, but some are always there.)
  const people = found.filter((e) => e.kind === 'name' && (e.count ?? 0) >= 5);
  let peopled = 0;
  for (const t of chapters) if (people.some((e) => t.includes(e.word))) peopled++;
  if (peopled >= 0.5 * chapters.length) return [];
  const have = new Set(found.map((e) => e.word));
  const text = chapters.join('\n');
  const out = new Map<string, LexiconEntry>();
  for (let i = 0; i < chapters.length; i++) {
    if (sizes[i] < 150 || sizes[i] >= SHORT_TEXT) continue;
    const local = yield* detectGen([chapters[i]], dict, { maxLen: opts.maxLen, inner: true });
    for (const e of local) if (!have.has(e.word) && !out.has(e.word)) out.set(e.word, { ...e });
  }
  for (const e of out.values()) {
    let k = 0;
    for (let i = text.indexOf(e.word); i >= 0; i = text.indexOf(e.word, i + e.word.length)) k++;
    e.count = k;
  }
  return [...out.values()];
}

/** Uses in a book from which a curated word of one book (book-words scope "book") joins its lexicon. */
const SCOPED_MIN = 5;
const SCOPED_PLACE = /\b(town|village|prefecture|commandery|county|mansion|city|province|continent|temple|monastery|mountain|shop|place)\b/i;

/**
 * Curated words of one book (book-words rows of scope "book": 小红 the maid of 紅樓夢, 子曰 "the Master said") count in a book that
 * uses them at least SCOPED_MIN times, nearly always on their own: not where the character before makes a common word with the
 * first one (童子|曰, 公子|曰 "the young master said") or the one after with the last (小|红花). Elsewhere they are only the
 * dictionary's (老张's 小红 is 小 + 红).
 */
function bookScoped(found: LexiconEntry[], text: string, dict: Dictionary, inBook: (ch: string) => boolean): LexiconEntry[] {
  const scoped = dict.bookScoped?.();
  if (!scoped?.size) return [];
  const have = new Map(found.map((e) => [e.word, e] as const));
  const out: LexiconEntry[] = [];
  const common = (s: string) => dict.freq(s) >= 100;
  for (const word of scoped.keys()) {
    if (![...word].every(inBook)) continue;
    const senses = dict.lookup(word);
    const e = senses.find((x) => x.curated) ?? senses[0];
    if (!e || e.pinyin.split(' ').length !== [...word].length) continue;
    // Found by detection already: it keeps the curated reading the book-words row gave it everywhere before.
    const seen = have.get(word);
    if (seen) { if (seen.kind === 'name') seen.pinyin = e.pinyin.toLowerCase(); continue; }
    let n = 0;
    let free = 0;
    let top = 0;
    const after = new Map<string, number>();
    const longer = new Map<string, number>();
    for (let i = text.indexOf(word); i >= 0; i = text.indexOf(word, i + word.length)) {
      const p = text[i - 1];
      const q = text[i + word.length];
      // Inside a longer word the dictionary has (巧姐 in 巧姐兒, 翼德 in 張翼德), it is that word's: not counted.
      const held = (p && dict.hasWord(p + word) ? p + word : '') || (q && dict.hasWord(word + q) ? word + q : '');
      if (held) { longer.set(held, (longer.get(held) ?? 0) + 1); continue; }
      n++;
      const qHan = !!q && isHanUnit(q.charCodeAt(0));
      if (!(p && isHanUnit(p.charCodeAt(0)) && common(p + word[0])) && !(qHan && common(word[word.length - 1] + q))) free++;
      if (qHan) { const k = (after.get(q) ?? 0) + 1; after.set(q, k); if (k > top) top = k; }
    }
    // (射鵰's 小红马 and 三体's 小红卫兵: one character after it most of the time makes it part of something longer.)
    if (n < SCOPED_MIN || free < 0.75 * n || top >= 0.5 * n) continue;
    const def = e.defs[0] ?? '';
    // A proper noun (its reading or its gloss is capitalized: 焦大, 春燕 "Chunyan, a young maid") is a person or a place.
    const proper = /^[A-Z]/.test(e.pinyin) || /^[A-Z][a-z]/.test(def);
    const kind: LexiconEntry['kind'] = !proper ? 'term' : PERSON_DEF.test(def) || !SCOPED_PLACE.test(def) ? 'name' : 'place';
    const entry: LexiconEntry = { word, pinyin: e.pinyin.toLowerCase(), gloss: (def || GLOSS[kind]).slice(0, 100), kind, count: n, enabled: true, origin: 'auto' };
    have.set(word, entry);
    out.push(entry);
    // The longer dictionary words around it join too, or the entry would cut them (張|翼德).
    for (const [x, k] of longer) {
      if (have.has(x)) continue;
      const syl = dict.pinyinFor(x);
      if (!syl.every(Boolean)) continue;
      const more: LexiconEntry = { word: x, pinyin: syl.join(' '), gloss: glossFor(x, kind, 'entry', dict), kind, count: k, enabled: true, origin: 'auto' };
      have.set(x, more);
      out.push(more);
    }
  }
  return out;
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

/** Whether the last character of `s` mostly opens a common word with the character after it in the text (新安江水|电站: 水电). */
function opensWord(text: string, s: string, dict: Dictionary): boolean {
  const r = s[s.length - 1];
  let n = 0;
  let opens = 0;
  for (let i = text.indexOf(s); i >= 0; i = text.indexOf(s, i + s.length)) {
    n++;
    const q = text[i + s.length];
    if (q && isHanUnit(q.charCodeAt(0)) && dict.freq(r + q) >= 100) opens++;
  }
  return opens >= 0.5 * n;
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
    // 京津城|际, 亲缘关|系: a place or a term whose last character mostly makes a common word with the one after it was cut out
    // of a longer string (京津城际, 亲缘关系). A locative or a particle after it (桃花岛上) is no such word, nor one that opens a
    // word of its own there (新安江|水电站, not 江水).
    if (e.kind !== 'name' && rn >= 0.6 * n && isHanUnit(r.charCodeAt(0)) && !SOFT_END.has(r) && !EDGE_STOP.has(r)
      && dict.freq(last + r) >= 100 && dict.hasWord(last + r) && !opensWord(text, w + r, dict)) continue;
    // (So with words the corpus never counted when nearly every place runs on into one: 京津城 is always 京津|城际 or 京津|城铁.)
    if (e.kind !== 'name' && n >= 3) {
      const into = [...st.right].filter(([k]) => isHanUnit(k) && !SOFT_END.has(String.fromCharCode(k)) && !EDGE_STOP.has(String.fromCharCode(k))
        && dict.hasWord(last + String.fromCharCode(k)));
      let sum = into.reduce((t, [, v]) => t + v, 0);
      // (Each text scan only when the words could be nine places in ten.)
      for (const [k, v] of into) if (sum >= 0.9 * n && opensWord(text, w + String.fromCharCode(k), dict)) sum -= v;
      if (sum >= 0.9 * n) continue;
    }
    const [l, ln] = top(st.left);
    if (ln >= 0.6 * n && isHanUnit(l.charCodeAt(0)) && dict.hasWord(l + first) && bigram(l, first) > n) continue;
    // (疏|浚西湖: the same for a place or a term whose first character mostly closes a common word with the one before it.)
    if (e.kind !== 'name' && ln >= 0.6 * n && isHanUnit(l.charCodeAt(0)) && dict.freq(l + first) >= 100 && dict.hasWord(l + first)) continue;
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
    if (e.kind !== 'name' || foreign(e.word) || CUED.has(e)) continue;
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
    let role = 0;
    for (let i = text.indexOf(g); i >= 0; i = text.indexOf(g, i + g.length)) {
      all++;
      if (text.slice(i - sur.surname.length, i) === sur.surname) continue;
      bare++;
      const p = text[i - 1] ?? '';
      const q = text[i + g.length] ?? '';
      if ((p && isHanUnit(p.charCodeAt(0)) && dict.freq(p + g[0]) >= 100) || (q && isHanUnit(q.charCodeAt(0)) && dict.freq(g[g.length - 1] + q) >= 100)) cut++;
      if (p && ROLE_BEFORE.has(p)) role++;
    }
    if (bare < minCount || cut > 0.15 * bare) continue;
    // 钱典史 → 典史: a title, not a given name, when the bare word is often an office someone holds (做典史, 一任典史, 这典史). One no
    // dictionary has is still a word of the book, bound as tightly: a term, so 一任典史 keeps it whole.
    if (role >= 0.25 * bare) {
      const gf = fold(g);
      if (!dict.hasWord(g) && !dict.hasWord(gf) && dict.freq(g) === 0 && dict.freq(gf) === 0) {
        have.add(g);
        out.push({ word: g, pinyin: e.pinyin.split(' ').slice([...sur.surname].length).join(' '), kind: 'term', count: bare, enabled: true, origin: 'auto', gloss: GLOSS.term });
      }
      continue;
    }
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

// ------------------------------------------------------------------ cues ---

/** Offices and titles before a name (simplified; the book's own script is matched too): 部长盛光祖, 市长陈博彰, 主任王国强. */
const TITLES_BEFORE = ['部长', '市长', '省长', '县长', '区长', '镇长', '乡长', '村长', '州长', '主任', '主席', '总理', '总统', '首相', '书记', '局长', '厅长',
  '处长', '科长', '校长', '院长', '所长', '社长', '行长', '会长', '董事长', '总裁', '总经理', '主编', '教练', '队长', '委员', '议员', '大使', '发言人', '教授',
  '研究员', '记者', '外长', '司令', '军长', '师长', '团长', '法官', '律师', '导演', '编剧', '作家', '诗人', '画家', '歌手', '演员', '选手', '球员', '主持人',
  '创始人', '负责人', '秘书长', '理事长', '总督', '国王', '皇帝'];
/** Polite titles after a full name: 胡适之先生. (Not 君, which ends given names (卓文君), nor 夫人 and 公子 (邢王夫人, 吴太夫人).) */
const TITLES_AFTER = ['先生', '女士', '小姐'];
/** Never in a given name a cue finds (尹俊|等, 李明|们), nor at its end the head of an institution's name (总统|文物馆). */
const NOT_GIVEN = new Set([...'等们的了着过和与及跟在于对把被将到去来往从给向让叫说道看就也都还又才再既已曾者之乎也矣焉哉']);
const INSTITUTION_END = new Set([...'馆院所局部处厅店站场园厂校楼堂室会社团组队科司署府宫寺庙观城村镇县省市区路街桥集坳沟屯湾庄寨斋']);
/** Verbs of speech that follow a person named once (夏志清认为, 王德威表示). */
const SAYS = ['表示', '指出', '认为', '强调', '透露', '坦言', '回忆', '写道', '介绍', '宣布', '承认', '解释', '补充', '声称'];
/** What can follow a person's name: a verb of speech or a function word (王军说, 王国强等, 盛光祖表示). Two characters are tried first. */
const AFTER_NAME = new Set([...SAYS, '前往', '出席', '会见', '参加', '担任', '率领', '代表', '发表', '接受', '访问', '一行',
  ...'称说道讲问答笑等和与及跟同在于对向把被将为是的了们也又都就便则曾已率带之还亦因所从到去来这那一不没要会能可应请让给有',
  ...'写看听想做走跑拿叫喊哭坐站跪躺打骂送接找帮告知觉谈望盯瞧瞪']);
/** Words that introduce a person's name: 名叫瑞和, 绰号“小北”, 原名惟柏. Of them, NICKNAMED name only a person (外号叫“赛半山”). */
const NAMED = ['名叫', '名唤', '名字叫', '绰号', '花名', '外号', '诨名', '小名', '乳名', '笔名', '艺名', '化名', '原名', '本名'];
const NICKNAMED = new Set(['绰号', '花名', '外号', '诨名', '小名', '乳名', '笔名', '艺名', '化名', '原名', '本名']);
/** Of them, the ones that give a nickname, which is a phrase and not a surname and a given name (外号“盖九州”). */
const NICKNAME_ONLY = new Set(['绰号', '花名', '外号', '诨名']);
/** Words that introduce the name of anything (这叫做“整理国故”, 学名叫做“桡侧籽骨”, 取名油炸桧): a person only unquoted, after 一个 or 一位 or as a surname and a name. */
const CALLED = ['叫做', '叫作', '名为', '唤作', '唤做', '取名', '起名'];
/** Before a word that introduces a name, the place is named (这个地方叫作岔道口, 有个乡村，叫做薛家集). */
const PLACE_NAMED_BEFORE = /(地方|地名|村|镇|乡|街|店|庄|城|山|寺|庙|集|铺|园|楼|桥|湖|河)[，,]?$/;
/** A dictionary sense for a quantity, not a name: 许多路, 多少路. */
const QUANTITY_DEF = /^(\([^)]*\) )?(many|much|several|a few|some|how much|how many|number|amount|each|every|all|this|that|these|those)\b/i;
/** Storms are named after these: 飓风文斯, 气旋卡塔琳娜. */
const STORMS = ['飓风', '台风', '热带风暴', '强热带风暴', '热带气旋', '气旋', '超强台风', '强台风'];
/** Surname characters that are also a function word before a name position (市长于昨日, 部长向记者): never a surname for a cue. */
const CUE_NOT_SURNAME = new Set([...'于向时方连那闻乃并全曾将从以当只正才又都也即便对同在应有可后常盖余']);
/** Entries the cues found: seen once or twice, they are no seed for the family of a name (贾母听 → 贾母便, 贾母因 …). */
const CUED = new WeakSet<LexiconEntry>();
/** Characters of a verb of going or seeking before a road or a hill (寻归旧路, 遥望山): not part of its name. */
const ROAD_VERBS = new Set([...'归寻望走行奔投取抄入出回往去来过请转']);
/** Endings of a street, a bridge, a lake or a building named once beside a word of going or a locative (过了德胜桥, 白云楼上). */
const PLACE_ENDS = ['胡同', '大街', '街', '路', '巷', '桥', '湖', '山', '堂', '楼', '堡'];
/** Of PLACE_ENDS, the ones a common word may name (人民路, 中山街); a building or a lake after a common word is a description (宿舍楼). */
const STREET_ENDS = new Set(['胡同', '大街', '街', '路', '巷', '桥']);
const PLACE_BEFORE = new Set([...'在到过往去进出住经于从沿至近离抵赴回游登绕穿了']);
/** After a name that a word introduces and 的, a word for a person (名叫索菲的女孩) or for something else (名叫“油屋”的澡堂). */
const PERSON_AFTER_DE = new Set([...'人女男孩娃姑娘子儿生妇汉妹弟哥姐小老少']);
const PLACE_AFTER = ['一带', '附近', '东口', '西口', '南口', '北口', ...'上下里边旁前后口内外畔的'];
/** Verbs of going: 过了 到了 before a place. */
const GOING = new Set([...'过到进出经至去来回走绕穿登游上下离抵赴']);
/** One-character abbreviations of provinces and cities in the names of railways (武广客运专线, 郑西高铁, 京沪线). */
const CITY_ABBR = new Set([...'京津沪渝冀晋辽苏浙皖闽赣鲁豫鄂湘粤桂琼川蜀黔滇陕陇宁港澳武广郑西杭合福厦深成昆长哈沈石太济徐兰汉珠汕湛柳衡襄宜荆温甬绍嘉锡扬盐淮蚌芜秦青贵包银呼南洛丹']);
const RAIL_AFTER = ['客运专线', '高铁', '城际', '铁路', '动车', '线'];
/** Characters that end the Han text a gloss in brackets belongs to (…的贝林妥欧单抗（Blinatumomab）). */
const GLOSS_STOP = new Set([...'的了是在和与及或把被对向从为以于等将用由有叫称即也都就并而让给跟同名位个']);
/** Trailing words after a foreign name and before its gloss (博南诺家族（Bonanno）). */
const GLOSS_GENERIC = ['家族', '公司', '集团', '大学', '学院', '乐队', '品牌', '酒店', '公园', '王朝', '家'];
const NAME_DOTS = /[·・•‧]/;

const isHanAt = (text: string, i: number): boolean => i >= 0 && i < text.length && isHanUnit(text.charCodeAt(i));

/**
 * Names seen once or twice that a cue around them makes sure of (plan item 3, NAME-RULE): a title before (部长盛光祖), a verb of
 * speech after (夏志清认为), a word that introduces a name (名叫瑞和, 花名“小北”), a gloss in Latin letters or another
 * language (睿铁（RAIL.ONE）, 嘉俳日（韩语：가배）), an actor's credit (（周一围饰）), a storm (飓风文斯), a list of people after 有：
 * (孟小冬、李少春、陈少霖等), an era name before its year (泰常八年), a street, a bridge or a building beside a word of going
 * (过了德胜桥, 白云楼上), a railway named for two cities (武广客运专线), both halves of a foreign name around a dot (奎登·德拉尔,
 * so 德拉尔 alone joins too) and a name in Latin letters (阿Q, 小D). Each takes the narrowest reading of where the name ends and
 * must not be a dictionary word.
 */
function* cued(found: LexiconEntry[], text: string, dict: Dictionary, hanCount: number, due: () => boolean): Generator<void, LexiconEntry[], void> {
  const have = new Set(found.map((e) => e.word));
  // (Memoized: the cues fold the same few characters again and again.)
  const folded = new Map<string, string>();
  const fold = (s: string): string => { let v = folded.get(s); if (v === undefined) { v = dict.toSimplified(s); folded.set(s, v); } return v; };
  const known = (w: string): boolean => dict.hasWord(w) || dict.hasWord(fold(w)) || dict.freq(w) > 0 || dict.freq(fold(w)) > 0;
  const both = (words: readonly string[]): string[] => [...new Set(words.flatMap((w) => [w, dict.toTraditional(w)]))].sort((a, b) => b.length - a.length);
  const alt = (words: readonly string[]): string => both(words).join('|');
  const picked = new Map<string, { kind: LexiconEntry['kind']; gloss?: string; translit?: boolean; nick?: boolean }>();
  const add = (w: string, kind: LexiconEntry['kind'], gloss?: string, translit = false, nick = false) => {
    if (!have.has(w) && !picked.has(w) && !known(w)) picked.set(w, { kind, gloss, translit, ...(nick ? { nick } : {}) });
  };
  const counted = new Map<string, number>();
  const occurrences = (w: string): number => {
    let k = counted.get(w);
    if (k === undefined) { k = 0; for (let i = text.indexOf(w); i >= 0; i = text.indexOf(w, i + w.length)) k++; counted.set(w, k); }
    return k;
  };
  /** Whether a name may end before text[j]: the end of the Han text, or a word that follows a name. */
  const endsAt = (j: number): boolean => {
    if (!isHanAt(text, j)) return true;
    const two = fold(text.slice(j, j + 2));
    return AFTER_NAME.has(two) || AFTER_NAME.has(two[0]);
  };
  /** A surname, one or two given characters, a person (王国强, not 高兴 or 王某). */
  const personOk = (w: string): boolean => {
    const s = [...fold(w)];
    const sur = surnameSplit(w, dict);
    if (!sur || s.length < 2 || s.length > 4) return false;
    const k = [...sur.surname].length;
    if (k === 1 && CUE_NOT_SURNAME.has(s[0])) return false;
    const given = s.slice(k);
    if (!given.length || given.length > 2 || !given.every((g) => isHanUnit(g.charCodeAt(0)))) return false;
    // (周一川 has a numeral; 王二 and 一行 are no names a cue can vouch for, nor 王老 or 李小.)
    if (given.some((g) => EDGE_STOP.has(g) || NOT_IN_NAME.has(g) || NOT_GIVEN.has(g) || SPEECH_NEXT.has(g) || '某氏们'.includes(g))) return false;
    if (given.every((g) => NUMERALS.has(g)) || MEASURE_AFTER.has(given[1] ?? '') || (given.length === 1 && '老小'.includes(given[0]))) return false;
    if (INSTITUTION_END.has(given[given.length - 1]) || (given.length === 1 && '家府氏王山湖江河岭关'.includes(given[0]))) return false;
    // (凤姐忙, 贾母听, 刘禅亡: a person the book or the dictionary knows and the next character.)
    const head = s.slice(0, k + 1).join('');
    // (周一川: 周一 is Monday, no person.)
    const knownPerson = personName(head, dict) || (properNoun(head, dict) && PERSON_DEF.test(dict.lookup(head).flatMap((x) => x.defs).join('; ')));
    if (given.length === 2 && (knownPerson || found.some((e) => e.kind === 'name' && fold(e.word) === head))) return false;
    // (白玉珪: a word the book uses on its own far more often (白玉, jade), plus one character.)
    if (given.length === 2 && dict.hasWord(head) && occurrences(w.slice(0, k + 1)) >= 3 * Math.max(1, occurrences(w))) return false;
    if (known(w)) return false;
    const g = given.join('');
    return !(given.length === 2 && (dict.freq(g) >= 1000 || PERSON_DEF.test(dict.lookup(g).flatMap((x) => x.defs).join('; '))));
  };
  /** Only transliteration characters, not a word: 比卢普斯, 拜登. */
  const foreignOk = (w: string): boolean => {
    const s = [...fold(w)];
    return s.length >= 2 && s.length <= 6 && s.every((ch, i) => TRANSLIT_CHARS.has(ch) || (i === s.length - 1 && ch === '儿'))
      && !s.some((ch) => EDGE_STOP.has(ch)) && !known(w) && !commonInside(s, dict);
  };
  /** The surname-led name that starts at i: two characters when a word that follows a name comes right after, else three. */
  const personAt = (i: number): string => {
    if (!isHanAt(text, i) || !isHanAt(text, i + 1)) return '';
    const k = COMPOUND_SURNAMES.has(fold(text.slice(i, i + 2))) ? 2 : 1;
    const a = i + k;
    if (!isHanAt(text, a) || endsAt(a)) return '';
    if (endsAt(a + 1)) return text.slice(i, a + 1);
    if (isHanAt(text, a + 1) && endsAt(a + 2)) return text.slice(i, a + 2);
    return '';
  };
  /** Whether text[a, b) is an item of a 、 list whose item before or after it is a person (梅兰芳、杨月楼). */
  const listOfPeople = (a: number, b: number): boolean => {
    const item = (from: number, to: number): string => text.slice(from, to);
    if (text[a - 1] === '、') {
      let s0 = a - 1;
      while (s0 > 0 && isHanAt(text, s0 - 1) && a - 1 - s0 < 4) s0--;
      const w = item(s0, a - 1);
      if (personOk(w) || personName(fold(w), dict)) return true;
    }
    if (text[b] === '、') {
      let e = b + 1;
      while (isHanAt(text, e) && e - b - 1 < 4) e++;
      const w = item(b + 1, e);
      if (personOk(w) || personName(fold(w), dict)) return true;
    }
    return false;
  };
  /** The run of transliteration characters that starts at i (at most 6), if it ends where a name may end. */
  const foreignAt = (i: number): string => {
    let j = i;
    while (j < text.length && j - i < 6 && TRANSLIT_CHARS.has(fold(text[j]))) j++;
    return j - i >= 2 && endsAt(j) ? text.slice(i, j) : '';
  };
  const each = (re: RegExp, fn: (m: RegExpExecArray) => void) => { for (let m = re.exec(text); m; m = re.exec(text)) fn(m); };

  // 部长盛光祖表示, 主任王国强等, 主教练比卢普斯。
  each(new RegExp(`(?:${alt(TITLES_BEFORE)})(?=[\\u3400-\\u9fff])`, 'g'), (m) => {
    const i = m.index + m[0].length;
    const p = personAt(i);
    // (总理李克|强调研: not when the name and the next character are a name the dictionary has.)
    if (p && personOk(p) && !(isHanAt(text, i + p.length) && dict.hasWord(fold(text.slice(i, i + p.length + 1))))) add(p, 'name');
    else { const f = foreignAt(i); if (f && foreignOk(f)) add(f, 'name', undefined, true); }
  });
  if (due()) yield;
  // 胡适之先生: a full name right after a mark and right before a polite title.
  each(new RegExp(`(?:^|[^\\u3400-\\u9fff])([\\u3400-\\u9fff]{2,3})(?:${alt(TITLES_AFTER)})`, 'gm'), (m) => {
    if (personOk(m[1])) add(m[1], 'name');
  });
  // 夏志清认为, 王德威表示: a name opening a clause before a verb of speech.
  each(new RegExp(`(?:^|[^\\u3400-\\u9fff])([\\u3400-\\u9fff]{2,5}?)(?:${alt(SAYS)})`, 'gm'), (m) => {
    if (personOk(m[1])) add(m[1], 'name');
    else if (foreignOk(m[1])) add(m[1], 'name', undefined, true);
  });
  if (due()) yield;
  // 名叫瑞和，, 花名“小北”, 名叫索菲 at the end of a line; 这个地方叫作岔道口 (a place); 叫做“整理国故” (a term, unless its words are common).
  each(new RegExp(`(${alt([...NAMED, ...CALLED])})(?:是|为|為|叫|做|作|${alt(CALLED)})?([“「『"'‘]?)([\\u3400-\\u9fff]{2,4})(?=[”」』"'’，,。.！!？?；;、：:\\s）)]|$)`, 'gm'), (m) => {
    const w = m[3];
    const s = [...fold(w)];
    // (名字叫李四吧？, 乳名或官名: a particle, a conjunction, or a name the book has already with more around it.)
    if (s.some((ch) => EDGE_STOP.has(ch) || NOT_IN_NAME.has(ch) || INTERJECTIONS.has(ch)) || '什甚啥谁哪某或和与及而且并唤叫儿做作是为'.includes(s[0]) || s.every((ch) => NUMERALS.has(ch))) return;
    // (绰号尚悬空: an adverb opening what follows says the nickname is not there yet.)
    if (!m[2] && NICKNAME_ONLY.has(fold(m[1])) && '尚还已未仍又也都就才却便亦'.includes(s[0])) return;
    if ('者之乎也矣焉哉'.includes(s[s.length - 1])) return; // 一个名唤瑞珠者
    if ([...have].some((h) => h.length < w.length && w.includes(h) && h.length >= 2)) return;
    // (花名册|子: the cue and the next character are a word; 指名|叫骂: the cue is two words, one with the character before it and
    // one with the character after it.)
    const cue = fold(m[1]);
    if (!m[2] && (dict.hasWord(cue + s[0]) || (dict.hasWord(fold(text[m.index - 1] ?? '') + cue[0]) && dict.hasWord(cue.slice(1) + s[0])))) return;
    // (A nickname, 外号“盖九州”, is a phrase: its first character keeps its own reading, not a surname's.)
    if (NICKNAMED.has(fold(m[1]))) { if (!commonInside(s, dict) || m[2]) add(w, 'name', undefined, s.every((ch) => TRANSLIT_CHARS.has(ch)), NICKNAME_ONLY.has(fold(m[1]))); return; }
    const before = fold(text.slice(Math.max(0, m.index - 4), m.index));
    const foreign = s.every((ch) => TRANSLIT_CHARS.has(ch));
    const last = s[s.length - 1];
    // (名叫“油屋”的澡堂: the word after 的 says what is named.)
    let k = m.index + m[0].length;
    if (/[”」』"'’]/.test(text[k] ?? '')) k++;
    // (叫作“荆川纸”的，: 的 closing the clause names a thing too.)
    const thing = fold(text[k] ?? '') === '的' && !(isHanAt(text, k + 1) && PERSON_AFTER_DE.has(fold(text[k + 1])));
    if (thing) {
      if (!commonInside(s, dict) && !personOk(w)) add(w, PLACE_ENDS.some((e) => fold(text.slice(k + 1, k + 1 + e.length)) === e) ? 'place' : 'term');
      return;
    }
    // A person after 一个 有个人 女儿 (一个叫作孤云), or a surname and a name or a foreign name unquoted (名叫瑞和, 唤做黄达, 名叫索菲);
    // a place (唤做焦山); a term in quotes (这一招叫做“落雁腿”, 这个唤做『盆吊』: in the old novels 叫做 and 唤做 name anything, and a
    // surname character opens many a thing's name) or after 名叫 (名叫冷香丸).
    const fresh = !commonInside(s, dict) && !covered(s, dict);
    const called = CALLED.includes(fold(m[1]));
    // (第二个唤做曾密: 个 counts a person, unless 这个 那个 point at a thing.)
    // (一种人叫做蛊师: a kind of person, not a person.)
    const personCtx = !m[2] && !/[种種类類]人$/.test(before) && (/(位|人|儿子|女儿|女子|孩子|妻子|丫头|姑娘|兄弟|姐妹)$/.test(before) || (/[个個]$/.test(before) && !/[这那這]/.test(before.slice(-2, -1))));
    const placeEnd = PLACE_SUFFIX.has(last) || SHORT_PLACE_SUFFIX.has(last) || '店口坳集铺'.includes(last);
    // (唤做焦山, 毛颖山: a hill or a pass is a place before it is a person; 叫做陈观 is a man.)
    const hill = '山岭关峰洞岛'.includes(last);
    if (hill && fresh && !personCtx) {
      add(w, 'place');
    } else if ((personCtx && s.length <= 3 && fresh && !placeEnd && !(s.length === 3 && dict.hasWord(s[0] + s[1]) && occurrences(w.slice(0, 2)) >= 3 * occurrences(w)))
      || ((!called || !m[2]) && (personOk(w) || foreignOk(w)))) { // (一个叫做白玉珪: 白玉, jade, stands alone thrice as often: a thing)
      add(w, 'name', undefined, foreign);
    } else if ((PLACE_NAMED_BEFORE.test(before) || (placeEnd && s.length >= 3)) && fresh) {
      add(w, 'place');
    } else if ((m[2] || !called) && fresh && !SOFT_START.has(s[0])) {
      add(w, 'term');
    }
  });
  if (due()) yield;
  // 睿铁（RAIL.ONE）, 旭普林（Züblin）, 博南诺家族（Bonanno）, 嘉俳日（韩语：가배）: the Han text right before a bracket that opens a
  // gloss in Latin letters or names a language. (Found from each bracket: a pattern over every Han run would backtrack.)
  const GLOSS_AFTER = /^[（(]\s*(?:([A-Z][^）)]{0,60})|[\u3400-\u9fff]{1,5}[语語文][：:])/;
  const glossed = (p: number): void => {
    if (!isHanAt(text, p - 1) || !isHanAt(text, p - 2)) return;
    const g = GLOSS_AFTER.exec(text.slice(p, p + 64));
    if (!g) return;
    let s0 = p - 1;
    while (s0 > 0 && isHanAt(text, s0 - 1)) s0--;
    let run = text.slice(s0, p);
    for (let k = run.length - 1; k >= 0; k--) if (GLOSS_STOP.has(fold(run[k]))) { run = run.slice(k + 1); break; }
    // (对流复合体: 对 there opens a word, so the run does not start after it.)
    if (run.length < p - s0 && dict.hasWord(fold(text[p - run.length - 1] + run[0]))) return;
    const generic = GLOSS_GENERIC.find((x) => fold(run).endsWith(x) && run.length > x.length + 1);
    if (generic) run = run.slice(0, run.length - generic.length);
    const s = [...fold(run)];
    // The transliteration at the end of the run (像柏拉图, …组织博南诺家族), else a short run of its own (睿铁, 嘉俳日) that does
    // not open with a common character (作玛志尼).
    let a = s.length;
    while (a > 0 && TRANSLIT_CHARS.has(s[a - 1])) a--;
    let w = '';
    if (a === 0 && s.length <= 6) w = run;
    else if (!generic && s.length >= 2 && s.length <= 4 && !commonInside(s, dict) && dict.freq(s[0]) < 20000) w = run;
    else if (s.length - a >= 2 && s.length - a <= 6) w = run.slice(a);
    const ws = [...fold(w)];
    if (ws.length < 2 || ws.some((ch) => EDGE_STOP.has(ch) || NOT_IN_NAME.has(ch) || NUMERALS.has(ch)) || MEASURE_START.has(ws[0])) return;
    // A surname and a name (杨帝霖（Quentin Young）) or a foreign name glossed as a first and last name is a person; anything
    // else is a term (旭普林（Züblin）, 倍根（Bacon）). Not two words of the dictionary (波兰饺子（波兰语：…）).
    if (covered(ws, dict)) return;
    const foreign = ws.every((ch) => TRANSLIT_CHARS.has(ch));
    const fullName = !!g[1] && /^[A-Z][a-zà-ÿ]+(?:[ -][A-Z][a-zà-ÿ]+)+\s*$/.test(g[1]);
    if (fullName && personOk(w)) add(w, 'name');
    else add(w, foreign && fullName ? 'name' : 'term', undefined, foreign);
  };
  for (const open of ['（', '(']) for (let p = text.indexOf(open); p >= 0; p = text.indexOf(open, p + 1)) glossed(p);
  if (due()) yield;
  // （周一围饰）, 由王砚辉饰演: the actor of a part.
  each(/[（(]([\u3400-\u9fff]{2,4})[饰飾](?:演)?[）)]|由([\u3400-\u9fff]{2,4})[饰飾]演/g, (m) => {
    const w = m[1] ?? m[2];
    if (personOk(w)) add(w, 'name');
    else if (foreignOk(w)) add(w, 'name', undefined, true);
  });
  // 飓风文斯, 气旋卡塔琳娜.
  each(new RegExp(`(?:${alt(STORMS)})(?=[\\u3400-\\u9fff])`, 'g'), (m) => {
    const i = m.index + m[0].length;
    let j = i;
    while (j < text.length && j - i < 5 && TRANSLIT_CHARS.has(fold(text[j]))) j++;
    const w = text.slice(i, j);
    // (Five characters at most: a longer run is no storm's name.)
    if (j - i >= 2 && (!isHanAt(text, j) || !TRANSLIT_CHARS.has(fold(text[j]))) && !commonInside([...fold(w)], dict)) add(w, 'name', 'name of a storm', true);
  });
  if (due()) yield;
  // 主要传人有：孟小冬、李少春、陈少霖、杨宝森等。 Every item is a person: a surname and a name the dictionary lacks, or a person it has.
  each(/(?:有|包括|包含|例如|如|计有|：|:)[：:]?((?:[\u3400-\u9fff]{2,4}、){2,}[\u3400-\u9fff]{2,4})(?=等|[。，,；;）)\s]|$)/gm, (m) => {
    const items = m[1].split('、');
    const tail = items[items.length - 1];
    if (tail.length >= 3 && fold(tail).endsWith('等')) items[items.length - 1] = tail.slice(0, -1);
    if (items.length >= 3 && items.every((w) => w[0] === items[0][0])) return; // 石碗、石盆、石床: things of stone, not people
    const people = items.filter((w) => personOk(w));
    if (people.length < 2 || !items.every((w) => people.includes(w) || personName(w, dict) || personName(fold(w), dict))) return;
    for (const w of people) add(w, 'name');
  });
  // 泰常八年, 太平真君七年（公元446年）: an era name before a year. Not one the book writes more often elsewhere: 天会 is an era
  // once (天会二年) and 明天会下雨, 春天会暖 everywhere else.
  each(/[元正一二三四五六七八九十廿卅]{1,3}年/g, (m) => {
    for (const k of [4, 2]) {
      const a = m.index - k;
      if (a < 0 || !isHanAt(text, a)) continue;
      const w = text.slice(a, m.index);
      if (!ERA_NAMES.has(fold(w))) continue;
      const years = text.match(new RegExp(`${w}[元正一二三四五六七八九十廿卅]{1,3}年`, 'g'))?.length ?? 0;
      if (2 * years >= occurrences(w)) add(w, 'term', 'era name (reign title)');
      break;
    }
  });
  if (due()) yield;
  // 过了德胜桥, 白云楼上, 在清平堡发现: a place named once, two characters and an ending, with a word of going before it or a
  // locative after it. Not where the ending makes a word with the character before (大楼, 西湖), nor where the name would start
  // inside a word.
  // (Not in a long novel: a place seen once there is little loss, old novels say 路 for a route, and the scan costs time.)
  if (hanCount < 100000) each(new RegExp(`(?:${alt(PLACE_ENDS)})`, 'g'), (m) => {
    const j = m.index;
    const end = fold(m[0]);
    const a = j - 2;
    if (a < 0 || !isHanAt(text, a) || !isHanAt(text, a + 1)) return;
    const prev = text[a - 1] ?? '';
    // (过了德胜桥, but 吃了饭修桥: 了 counts after a verb of going only.)
    const before = !!prev && PLACE_BEFORE.has(fold(prev)) && (fold(prev) !== '了' || GOING.has(fold(text[a - 2] ?? '')));
    const tail = fold(text.slice(j + m[0].length, j + m[0].length + 2));
    const after = !isHanAt(text, j + m[0].length) || PLACE_AFTER.some((p) => tail.startsWith(p));
    if (!(before || (after && !isHanAt(text, a - 1)))) return;
    if (prev === '《' || text[j + m[0].length] === '》') return; // 《玻丽路》: a title
    const x = [...fold(text.slice(a, j))];
    if (x.some((ch) => EDGE_STOP.has(ch) || NOT_IN_NAME.has(ch) || NOT_GIVEN.has(ch) || NUMERALS.has(ch) || MEASURE_START.has(ch) || SOFT_START.has(ch) || PLACE_BEFORE.has(ch) || ch === '号')) return;
    if ('山湖路桥街'.includes(x[0]) || '山湖路桥街楼堂'.includes(x[1])) return; // 山僻路: a description of the way
    if (x.some((ch) => ROAD_VERBS.has(ch) || '里内外上下中前后方边间'.includes(ch))) return; // 寻归旧路, 西方路, 庄内堂, 钻下湖
    // (谭鑫培、杨月楼。: a list of people; 由金少山开创: a surname and two characters before 山 楼 堂 湖 is often a person.)
    if (SURNAMES.has(x[0]) && '山楼堂湖'.includes(end) && !PLACE_AFTER.some((p) => p !== '的' && tail.startsWith(p))) return;
    if (listOfPeople(a, j + m[0].length)) return;
    if (dict.lookup(x.join('')).some((e) => /^(\([^)]*\) )?to /.test(e.defs[0] ?? ''))) return; // 遥望山: a verb
    const w = text.slice(a, j + m[0].length);
    // (对面大街, 躲开街: a dictionary word before the ending, seen once, is not a name; 银锭桥 twice is.)
    if (dict.hasWord(x.join('')) && !properNoun(x.join(''), dict) && occurrences(w) === 1) return;
    if (dict.hasWord(x[1] + end[0]) || dict.hasWord(x.join('') + end) || (isHanAt(text, a - 1) && !before && dict.freq(fold(prev) + x[0]) >= 100)) return;
    if (!STREET_ENDS.has(end) && (dict.freq(x.join('')) >= 500 || properNoun(x.join(''), dict))) return;
    // (许多路: a quantity; 西湖湖畔, 岷山山系: the ending opens the next word; 亚历山大: the place is the front of a longer word.)
    if (dict.lookup(x.join('')).some((e) => QUANTITY_DEF.test(e.defs[0] ?? ''))) return;
    // (田塍路, 石板路: a common word and 路, seen once, is a description; 开明街, 鼓楼大街 are streets.)
    if (end === '路' && commonWord(x.join(''), dict) && occurrences(w) === 1) return;
    const next = text[j + m[0].length] ?? '';
    if (isHanAt(text, j + m[0].length) && !PLACE_AFTER.some((p) => tail.startsWith(p)) && (dict.hasWord(end.slice(-1) + fold(next)) || dict.hasWord(fold(w + next)))) return;
    add(w, 'place');
  });
  if (due()) yield;
  // 武广客运专线, 郑西高铁: two one-character city names before a railway.
  each(new RegExp(`(?:${alt(RAIL_AFTER)})`, 'g'), (m) => {
    const a = m.index - 2;
    if (a < 0 || !isHanAt(text, a) || !isHanAt(text, a + 1)) return;
    const x = fold(text.slice(a, m.index));
    if (!CITY_ABBR.has(x[0]) || !CITY_ABBR.has(x[1]) || x[0] === x[1] || (isHanAt(text, a - 1) && dict.hasWord(fold(text[a - 1]) + x[0]))) return;
    // (京港澳: where the book names three cities, the pair would cut the third off.)
    const pair = text.slice(a, m.index);
    for (let i = text.indexOf(pair); i >= 0; i = text.indexOf(pair, i + 2)) if (isHanAt(text, i + 2) && CITY_ABBR.has(fold(text[i + 2])) && dict.hasWord(x[1] + fold(text[i + 2]))) return;
    add(text.slice(a, m.index), 'place', `${x[0]}–${x[1]} (two cities a railway joins)`);
  });
  if (due()) yield;
  // 奎登·德拉尔, 旺加里·马塔伊, 汤姆贾诺维奇因身体原因: both halves of a foreign name around a dot.
  const dots = new RegExp(NAME_DOTS.source, 'g');
  for (let d = dots.exec(text); d; d = dots.exec(text)) {
    const i = d.index;
    for (const half of dottedHalves(text, i, fold, endsAt, dict)) {
      const s = [...fold(half)];
      // (All transliteration characters, or all but the first or last one the clause edge let in: 奎登, 旺加里.)
      const near = s.filter((ch) => TRANSLIT_CHARS.has(ch)).length >= s.length - 1 && !s.some((ch) => EDGE_STOP.has(ch) || NOT_IN_NAME.has(ch)) && !commonInside(s, dict);
      if (foreignOk(half) || (near && s.length >= 2 && !known(half))) add(half, 'name', undefined, true);
    }
  }
  // 阿Q, 小D, 阿Quei: a name in Latin letters after 阿 小 老, seen three times.
  const latin = new Map<string, number>();
  each(/(?<![A-Za-z])([阿小老])([A-Z][a-z]{0,5})(?![A-Za-z])/g, (m) => { latin.set(m[0], (latin.get(m[0]) ?? 0) + 1); });
  for (const [w, k] of latin) if (k >= 3 && !have.has(w)) picked.set(w, { kind: 'name' });

  const out: LexiconEntry[] = [];
  for (const [w, p] of picked) {
    const count = occurrences(w);
    if (!count) continue;
    const latinName = /[A-Za-z]/.test(w);
    let pinyin = latinName ? dict.pinyinFor(w.replace(/[A-Za-z]+/g, ''), {}).join(' ') : pinyinOf(w, p.kind, dict, !p.translit && !p.nick);
    // 弥儿 (Mill), 青儿: 儿 ends a transliteration or a name as ér; 秦沈: 沈 for 沈阳 is shěn.
    if (p.translit || [...w].length <= 3) pinyin = pinyin.replace(/\br5$/, 'er2');
    if (p.gloss?.includes('two cities')) pinyin = [...fold(w)].map((ch, k) => (ch === '沈' ? 'shen3' : pinyin.split(' ')[k])).join(' ');
    const e: LexiconEntry = { word: w, pinyin, gloss: p.gloss ?? GLOSS[p.kind], kind: p.kind, count, enabled: true, origin: 'auto' };
    CUED.add(e);
    out.push(e);
  }
  return out;
}

/**
 * The halves of a foreign name before and after the dot at `i`: transliteration characters, plus one more character where the
 * name opens or closes a clause (奎 after 的, 旺 after a colon). `endsAt(j)` says whether a name may end before text[j].
 */
function dottedHalves(text: string, i: number, fold: (s: string) => string, endsAt: (j: number) => boolean, dict: Dictionary): string[] {
  const tr = (j: number): boolean => isHanAt(text, j) && TRANSLIT_CHARS.has(fold(text[j]));
  const opens = (j: number): boolean => !isHanAt(text, j) || NAME_DOTS.test(text[j]) || '的了在和与及是为被将由把对向给叫名位'.includes(fold(text[j]));
  // A name may also start right after a word (探险家|瓦尔特, 主教练|鲁迪).
  const startsAt = (j: number): boolean => opens(j - 1) || (isHanAt(text, j - 2) && dict.hasWord(fold(text.slice(j - 2, j)))) || (isHanAt(text, j - 3) && dict.hasWord(fold(text.slice(j - 3, j))));
  const out: string[] = [];
  // Before the dot.
  let a = i;
  while (a > 0 && tr(a - 1) && i - a < 6) a--;
  // (Not a common character, nor one that ends a word with the one before it: 竞争对|手沙奎尔.)
  if (a > 0 && isHanAt(text, a - 1) && !opens(a - 1) && opens(a - 2) && i - a >= 1 && i - a < 5 && dict.freq(fold(text[a - 1])) < 20000
    && !(isHanAt(text, a - 2) && dict.hasWord(fold(text.slice(a - 2, a))))) a--;
  if (i - a >= 2 && startsAt(a)) out.push(text.slice(a, i));
  // After the dot, never into the next word: 贾诺维奇|因身体原因 (a final 因 or 也 before more text is that word).
  let b = i + 1;
  while (b < text.length && tr(b) && b - i - 1 < 8) b++;
  if (b - i - 1 >= 4 && '因也'.includes(fold(text[b - 1])) && isHanAt(text, b) && !endsAt(b)) b--;
  if (b - i - 1 >= 2 && (endsAt(b) || NAME_DOTS.test(text[b] ?? '') || '因也'.includes(fold(text[b] ?? '')))) out.push(text.slice(i + 1, b));
  return out;
}

// ------------------------------------------------------------ the name list ---

/** Titles and roles before a listed person (画家戴嵩, 太守王朗), beside TITLES_BEFORE. */
const LIST_TITLES = [...TITLES_BEFORE, '画家', '诗人', '词人', '学者', '书法家', '音乐家', '作曲家', '科学家', '哲学家', '政治家', '艺术家', '思想家',
  '将军', '大将', '名将', '太守', '刺史', '丞相', '宰相', '知县', '知府', '县令', '都督', '太尉', '尚书', '侍郎', '学士', '大臣', '太后', '皇后',
  '公主', '太子', '皇子', '法师', '禅师', '女王', '王子', '运动员', '主角', '前任', '继任', '主簿', '校尉', '中郎将', '侍中', '司徒', '司空',
  '太傅', '御史', '参军', '长史', '从事', '别驾', '治中', '偏将', '牙将', '都尉', '谋士', '大夫', '先锋', '国公', '知州', '巡抚', '总兵'];
/** After a listed person: a verb of speech, a courtesy name, a life (周昉曰, 王羲之字逸少, 戴嵩生于). */
const LIST_PERSON_AFTER = [...SAYS, ...TITLES_AFTER, '曰', '字', '生于', '出生', '去世', '逝世', '卒于', '死于', '等人'];
/** Before a listed place: a word of going or being somewhere (到毗陵, 位于阳羡). */
const LIST_PLACE_BEFORE = ['位于', '来自', '前往', '途经', '地处', '迁往', '迁至', '移居', '定居', '出生于', '生于'];
/** After a listed place: where (阳羡一带, 毗陵境内). */
const LIST_PLACE_AFTER = ['一带', '附近', '境内', '地区', '城外', '城内', '郊外', '人氏', '省', '市', '县', '州', '郡'];
/** Before a listed name: characters that end what comes before a name (在毗陵, 的阳羡, 和戴嵩, 、周昉). */
const LIST_OPENERS = new Set([...'的了在和与及跟同是被把对向从给为由于自至到往去来入出经过让叫请见将以或乃即、，']);
/** A locative at the end of a listed name: 湾子里, 车里 are "in the pond", "in the car" more often than places. */
const LOCATIVE_END = new Set([...'里上下中内外边旁前后']);
/** After a listed place: a locative or 人 (毗陵人, 阳羡城外 is LIST_PLACE_AFTER). */
const LIST_PLACE_CLOSERS = new Set([...'上下里外内中前后边旁畔人']);
/** Endings that say a listed name is a place or an institution (梅山乡, 青县, 东林寺, 北洋大学, 江南制造局). */
const LIST_PLACE_END = new Set([...'省市县区乡镇村州郡府道山江河湖海岛峰岭寺庙宫殿楼阁塔桥港湾城关堡庄']);
const LIST_ORG_END = ['公司', '集团', '大学', '学院', '学校', '中学', '小学', '银行', '医院', '报社', '出版社', '协会', '学会', '委员会', '政府', '党', '军', '局', '馆', '院', '所', '社', '会', '团', '队', '厂', '店'];
/**
 * A character as common as this (its count in the segmentation vocabulary) or rarer makes a two-character listed name unlikely to be
 * two ordinary characters side by side: 毗陵, 阳羡, 周昉, not 由拳 or 翠云.
 */
const LIST_RARE_CHAR = 500;
/** A character at least this common after a listed name of three characters or more is a word of its own (宫泽理惠|演过), not more name. */
const LIST_COMMON_NEXT = 2000;
/** What cueAt() says: a cue before the name, after it, or one that only agrees with the kind. */
const CUE_LEFT = 1;
const CUE_RIGHT = 2;
const CUE_WEAK = 4;
/** Before a listed name, these start a nickname that holds it (小骚达子), so they do not free its edge. */
const NICK_HEAD = new Set([...'小老阿']);
/** The five phases: 金克木, 水生木 are their rules, not names. */
const FIVE_PHASES = new Set([...'金木水火土']);
/** A listed person ending in one of these is a kind of being (赤发鬼, 白骨精), a name only with a cue. */
const BEING_END = new Set([...'鬼怪精魔妖']);
/** Pronouns: a listed person that holds one (任我行) is as often a phrase (万国九州任我行). */
const PRONOUN_IN = new Set([...'我你他她吾汝']);
/** The 28 lunar mansions, one character each (井鬼柳星张翼轸 lists seven of them). */
const MANSIONS = new Set([...'角亢氐房心尾箕斗牛女虚危室壁奎娄胃昴毕觜参井鬼柳星张翼轸']);
/**
 * Beside LIST_PLACE_END and LIST_ORG_END, endings that say a listed name is a place, a work or an institution (忠孝西路, 景福门, 沪杭高铁,
 * 国家科委, 杭州来福士中心), so its kind is confirmed for the card and a verb at its start is no sign of a phrase. They cue nothing.
 */
const KIND_END = new Set([...'路街巷线园门场苑堂窑碑台洞群委联监国洲溪峒谷墓陵亭渡站']);
const KIND_END_WORDS = ['高铁', '中心', '科技', '药业', '家族', '商圈'];
/** What may stand before or after a couplet of verse. */
const VERSE_EDGE = /[。！？；!?;\s「」“”『』：:]/;

/**
 * Names from the list (core/gazetteer.ts) that the book uses as names (ARCHITECTURE.md §4.9, detection v11). The list holds no word
 * the dictionary has (built so), so what is left to fear is a listed string that the book uses as ordinary words (国王平定 holds
 * 王平; 翠云缭绕 is green clouds) or as part of a longer name (陈少霖 holds 陈少). For each listed string in the text:
 * - a sighting is unclean when a dictionary word crosses one of its edges, another listed name overlaps it, a found entry holds it
 *   or crosses its edge or fills it but one character (史进|道), or it ends in a verb of speech before what is said; a string the
 *   book ever uses across a common word, or unclean in more than a fifth of its sightings, is never taken;
 * - a clean sighting counts when it stands free at both edges (freeLeft, freeRight), or a cue on a side frees that side;
 * - three characters or more: one such sighting does, unless the string looks like a phrase, which needs a cue that says the kind;
 * - two characters: a cue that says the kind at half the sightings (and a surname for a person), or a surname and a rare given
 *   name (戴嵩), or a place with a rare character and a word of going (到阳羡).
 * Returns the entries to add and the words of found entries that a listed name replaces (戴嵩画 for 戴嵩).
 */
function* listed(found: LexiconEntry[], text: string, han: Uint8Array, dict: Dictionary, gaz: Gazetteer, due: () => boolean): Generator<void, { add: LexiconEntry[]; drop: Set<string> }, void> {
  const n = text.length;
  // The text folded to simplified one unit at a time, the way the list was built.
  const foldTable = new Uint16Array(65536);
  const codes = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);
    if (!han[i]) { codes[i] = c; continue; }
    let f = foldTable[c];
    if (!f) { const s = dict.toSimplified(text[i]); f = s.length === 1 ? s.charCodeAt(0) : c; foldTable[c] = f; }
    codes[i] = f;
    if ((i & 0xffff) === 0xffff && due()) yield;
  }
  const fold = (a: number, b: number): string => String.fromCharCode(...codes.subarray(a, b));
  const starts: number[] = [];
  const lens: number[] = [];
  const kinds: GazetteerKind[] = [];
  gaz.scan(codes, han, (i, len, kind) => { starts.push(i); lens.push(len); kinds.push(kind); });
  const drop = new Set<string>();
  if (!starts.length) return { add: [], drop };
  yield;
  // Overlaps between listed names: a sighting inside a longer one is that one's; two that overlap cut each other.
  // (scan reports the sightings in order of where they start, the shorter first.)
  const inside = new Uint8Array(starts.length);
  const crossed = new Uint8Array(starts.length);
  for (let h = 0; h < starts.length; h++) {
    const a = starts[h];
    const b = a + lens[h];
    for (let g = h + 1; g < starts.length && starts[g] < b; g++) {
      const d = starts[g] + lens[g];
      if (starts[g] === a) inside[h] = 1;
      else if (d <= b) inside[g] = 1;
      else { crossed[h] = 1; crossed[g] = 1; }
    }
  }
  // A listed name that is a shorter listed name and one character more, where the shorter one is the name: the character is a verb
  // of speech or a word that follows a name (李荣|道, 史进|道), or the shorter one stands alone more often in the book (李恢|先运粮草).
  // (Counted where each stands alone: 博尔 inside 博尔术 says nothing about 博尔忽.)
  const seenAs = new Map<string, number>();
  for (let h = 0; h < starts.length; h++) if (!inside[h]) { const w = text.substr(starts[h], lens[h]); seenAs.set(w, (seenAs.get(w) ?? 0) + 1); }
  for (let h = 0; h + 1 < starts.length; h++) {
    const g = h + 1;
    if (starts[g] !== starts[h] || lens[g] !== lens[h] + 1) continue;
    const extra = fold(starts[g] + lens[h], starts[g] + lens[g]);
    const short = text.substr(starts[h], lens[h]);
    const long = text.substr(starts[g], lens[g]);
    if (SPEECH_NEXT.has(extra) || SPEECH_TRAD.has(text[starts[g] + lens[h]]) || AFTER_NAME.has(extra) || (seenAs.get(short) ?? 0) > 2 * (seenAs.get(long) ?? 0)) {
      inside[h] = 0;
      crossed[g] = 1;
    }
  }
  // A person a cue found once with a verb too many, where the list has the name without it (画家戴嵩画的牛: the title cue took
  // 戴嵩画), gives way to the listed name. (宋玉珍 stays: 珍 is no verb, and the list's 宋玉 is someone else.)
  for (const e of found) {
    if (e.kind !== 'name' || !CUED.has(e) || [...e.word].length !== 3) continue;
    const s = dict.toSimplified(e.word);
    if (!gaz.kindOf(s) && gaz.kindOf(s.slice(0, -1)) === 'person' && dict.lookup(s.slice(-1)).some((x) => /^to /.test(x.defs[0] ?? ''))
      && !dict.lookup(s.slice(-1)).some((x) => /^[A-Z]/.test(x.pinyin) || /^surname/.test(x.defs[0] ?? ''))) drop.add(e.word);
  }
  const have = new Set(found.filter((e) => !drop.has(e.word)).map((e) => e.word));
  const longest = Math.max(2, ...found.map((e) => e.word.length));
  const heads = new Set(found.map((e) => e.word.charCodeAt(0)));
  /**
   * Whether a found entry holds [i, j), runs across one of its edges there, or fills all of it but one character (史进|道 is a found
   * person and 道 "said", though the list has a 史进道). A found entry deeper inside is no harm.
   */
  const foundOver = (i: number, j: number): boolean => {
    for (let a = Math.max(0, i - longest + 1); a < j; a++) {
      if (!heads.has(text.charCodeAt(a))) continue;
      for (let L = 2; L <= longest && a + L <= n; L++) {
        if (a + L <= i) continue;
        if (a >= i && a + L <= j && L < j - i - 1) continue;
        if (have.has(text.substr(a, L))) return true;
      }
    }
    return false;
  };
  const wordMemo = new Map<string, number>();
  /** 0: no word; 1: a dictionary word; 2: a common one (count 100 or more). */
  const wordAt = (a: number, b: number): number => {
    const w = fold(a, b);
    let v = wordMemo.get(w);
    if (v === undefined) { v = dict.freq(w) >= 100 ? 2 : dict.hasWord(w) ? 1 : 0; wordMemo.set(w, v); }
    return v;
  };
  /** The strongest dictionary word across an edge of [i, j): one that starts before it and ends inside or at its end, or starts inside or at its start and ends after it. */
  const crossing = (i: number, j: number): number => {
    let worst = 0;
    for (let a = i - 1; a >= Math.max(0, i - 3) && han[a]; a--) {
      for (let b = i + 1; b <= j && b - a <= 4; b++) worst = Math.max(worst, wordAt(a, b));
    }
    for (let a = Math.max(i, j - 3); a < j; a++) {
      for (let b = j + 1; b <= n && han[b - 1] && b - a <= 4; b++) worst = Math.max(worst, wordAt(a, b));
    }
    return worst;
  };
  /** The Han run (a clause) that holds position k: [start, end). */
  const runAt = (k: number): [number, number] => {
    let a = k;
    let b = k;
    while (a > 0 && han[a - 1]) a--;
    while (b < n && han[b]) b++;
    return [a, b];
  };
  /** A line of verse starts or ends at position k: a stop, a space, a quote mark or the end of the text is there. */
  const lineEdge = (k: number): boolean => k < 0 || k >= n || VERSE_EDGE.test(text[k]);
  const comma = (k: number): boolean => text[k] === '，' || text[k] === ',';
  /**
   * Whether [i, j) sits in a couplet of verse: two lines of five or seven characters, a comma between them, a stop or a break
   * around them (香肌扑簌瑶台月，翠鬓笼松楚岫云。). Prose may run two such clauses together, rarely as a sentence of its own.
   */
  const inVerse = (i: number, j: number): boolean => {
    const [a, b] = runAt(i);
    const len = b - a;
    if (j > b || (len !== 5 && len !== 7)) return false;
    if (lineEdge(a - 1) && comma(b) && han[b + 1]) {
      const [c, d] = runAt(b + 1);
      if (d - c === len && lineEdge(d)) return true;
    }
    if (lineEdge(b) && a >= 2 && comma(a - 1) && han[a - 2]) {
      const [c, d] = runAt(a - 2);
      if (d - c === len && lineEdge(c - 1)) return true;
    }
    return false;
  };
  const tr = (k: number) => han[k] === 1 && TRANSLIT_CHARS.has(fold(k, k + 1));
  const allTranslit = (i: number, j: number) => [...fold(i, j)].every((ch) => TRANSLIT_CHARS.has(ch));
  /**
   * Whether the sighting [i, j) stands free at its left (freeLeft) and its right edge (freeRight): a mark, a dictionary word
   * (画家|戴嵩, 位于|阳羡; 戴嵩|画马), or a character that opens or closes a name (在 到 的 和 …; 说 等 也 …, and a locative or 人 after
   * a place). Not 陈少|霖, 何|芬奇, 阿姆斯特|丹, 龙|首山: the characters around belong to a longer name.
   */
  const freeLeft = (i: number, j: number): boolean => {
    const translit = allTranslit(i, j);
    // (三|四里路: a numeral before one that opens the name is the same count. 达摩|克利斯: a transliteration runs into it.)
    if (han[i - 1] && NUMERALS.has(fold(i - 1, i)) && NUMERALS.has(fold(i, i + 1))) return false;
    if (translit && tr(i - 1)) return false;
    // (斯堪的|纳维亚: a transliteration may hold a 的. 主簿|阎象: any dictionary word may end before a name.)
    let left = i === 0 || !han[i - 1] || (LIST_OPENERS.has(fold(i - 1, i)) && !(i > 1 && tr(i - 2) && translit));
    for (let a = i - 2; !left && a >= Math.max(0, i - 4) && han[a]; a--) left = wordAt(a, i) >= 1;
    // (Three characters or more may follow any common character: 遗民|朱舜水. Not 小, 老 or 阿, which start a nickname (小骚达子),
    // nor in a line of verse, where words run on without a break: 翠鬓笼松|楚岫云.)
    return left || (j - i >= 3 && dict.freq(fold(i - 1, i)) >= LIST_COMMON_NEXT && !NICK_HEAD.has(fold(i - 1, i)) && !inVerse(i, j));
  };
  const freeRight = (i: number, j: number, kind: GazetteerKind): boolean => {
    const translit = allTranslit(i, j);
    if (j >= n || !han[j]) return true;
    const two = fold(j, Math.min(n, j + 2));
    if (AFTER_NAME.has(two) || AFTER_NAME.has(two[0]) || (kind !== 'person' && (LIST_PLACE_CLOSERS.has(two[0]) || LIST_PLACE_AFTER.some((t) => two.startsWith(t))))) return true;
    for (let b = j + 2; b <= Math.min(n, j + 4) && han[b - 1]; b++) if (wordAt(j, b) === 2) return true;
    // Three characters or more may stand before any common character (宫泽理惠|演过), unless a transliteration runs on (阿姆斯特|丹)
    // or the name ends in 之, which may be the particle before a noun (权为贺敬之礼: "a gift of congratulation").
    return j - i >= 3 && dict.freq(two[0]) >= LIST_COMMON_NEXT && !(translit && tr(j)) && fold(j - 1, j) !== '之' && !inVerse(i, j);
  };
  const personStarts = new Set<number>();
  const personEnds = new Set<number>();
  for (let h = 0; h < starts.length; h++) if (kinds[h] === 'person') { personStarts.add(starts[h]); personEnds.add(starts[h] + lens[h]); }
  /**
   * A cue at the sighting [i, j) for a name of this kind: CUE_LEFT or CUE_RIGHT when a word on that side says the kind by itself
   * (and so where the name starts or ends), CUE_WEAK when it only agrees.
   */
  const cueAt = (i: number, j: number, kind: GazetteerKind, name: string): number => {
    if (kind === 'person') {
      const b4 = fold(Math.max(0, i - 4), i);
      const af = fold(j, Math.min(n, j + 3));
      let m = LIST_TITLES.some((t) => b4.endsWith(t)) ? CUE_LEFT : 0;
      if (LIST_PERSON_AFTER.some((t) => af.startsWith(t)) || /^[（(]前?\d/.test(text.slice(j, j + 3))) m |= CUE_RIGHT; // (周昉（约730年－800年）: a life)
      if (m) return m;
      // 戴嵩、韩干、周昉: an item of a 、 list beside another listed person.
      return (text[j] === '、' && personStarts.has(j + 1)) || (text[i - 1] === '、' && personEnds.has(i - 1)) ? CUE_WEAK : 0;
    }
    if (kind === 'place' || kind === 'org') {
      const b3 = fold(Math.max(0, i - 3), i);
      if (LIST_PLACE_BEFORE.some((t) => b3.endsWith(t))) return CUE_LEFT;
      const p = b3[b3.length - 1] ?? '';
      // (去了阳羡: 了 counts after a verb of going.)
      if (PLACE_BEFORE.has(p) && (p !== '了' || GOING.has(b3[b3.length - 2] ?? ''))) return CUE_WEAK;
      const af = fold(j, Math.min(n, j + 2));
      if (LIST_PLACE_AFTER.some((t) => af.startsWith(t))) return CUE_WEAK;
      // (An ending agrees with the kind but proves little: 近卫队 ends like a company of soldiers because it is one.)
      if (LIST_PLACE_END.has(name[name.length - 1]) || LIST_ORG_END.some((t) => name.endsWith(t) && name.length > t.length)) return CUE_WEAK;
    }
    return 0;
  };

  // Every sighting of each listed string, as the book spells it.
  const byWord = new Map<string, number[]>();
  for (let h = 0; h < starts.length; h++) {
    const w = text.substr(starts[h], lens[h]);
    if (have.has(w)) continue;
    let list = byWord.get(w);
    if (!list) byWord.set(w, (list = []));
    list.push(h);
  }
  const out: LexiconEntry[] = [];
  // (三体 writes 艾伯特.林格 with a full stop.)
  const dot = (k: number) => NAME_DOTS.test(text[k] ?? '') || (text[k] === '.' && han[k - 1] === 1 && han[k + 1] === 1);
  /** The book's entries, so a listed name reads the found names inside it as they read (秦沈 of 秦沈客运专线: shěn). */
  const lexicon = buildLexicon(found);
  let checked = 0;
  for (const [w, hits] of byWord) {
    if ((++checked & 0x3f) === 0 && due()) yield;
    const kind = kinds[hits[0]];
    const simp = fold(starts[hits[0]], starts[hits[0]] + lens[hits[0]]);
    const rareGiven = kind === 'person' && simp.length === 2 && SURNAMES.has(simp[0]) && !CUE_NOT_SURNAME.has(simp[0]) && dict.freq(simp[1]) <= LIST_RARE_CHAR;
    let clean = 0;
    let dirty = 0;
    let seen = 0;
    let cue = 0;
    let strong = 0;
    let common = false;
    for (const h of hits) {
      if (inside[h]) continue;
      seen++;
      const i = starts[h];
      const j = i + lens[h];
      const cut = crossing(i, j);
      if (cut === 2) { common = true; break; }
      // (众女官拥拜丹墀道：「…: a verb of speech before what is said ends no name, unless it makes a word with the character
      // before it: 呼南通道：.)
      const said = (SPEECH_NEXT.has(fold(j - 1, j)) || SPEECH_TRAD.has(text[j - 1])) && /[：:「“『]/.test(text[j] ?? '') && !wordAt(j - 2, j);
      if (cut || crossed[h] || said || foundOver(i, j)) { dirty++; continue; }
      // An edge is free where a cue stands that says the kind (遗民朱舜水先生: 先生), and beside a name dot (昌西·比卢普斯); the other
      // edge must be free too (not 阿基姆·奥拉|朱万, 太尉陈宗|善). After a title, a surname and a rare given name may stand before
      // any character (画家戴嵩画的牛).
      const dl = dot(i - 1);
      const dr = dot(j);
      const m = cueAt(i, j, kind, simp);
      const k = dl || dr || m & (CUE_LEFT | CUE_RIGHT) ? 2 : m ? 1 : 0;
      const lf = dl || !!(m & CUE_LEFT) || freeLeft(i, j);
      const rf = dr || !!(m & CUE_RIGHT) || freeRight(i, j, kind) || (!!(m & CUE_LEFT) && rareGiven);
      if (!(lf && rf)) continue;
      clean++;
      cue = Math.max(cue, k);
      if (k === 2) strong++;
    }
    if (common || !clean || dirty > 0.2 * (clean + dirty)) continue;
    const s = [...simp];
    // Shapes that are as often a phrase as a name need a cue that says the kind by itself: a locative at the end (湾子里 "in the
    // pond"), a verb or a preposition at the start that no surname explains (跟谁学), a character used twice in a place or a thing
    // (楼外楼, 命命鸟; 李师师 is a person).
    // A person may double a character (李师师, 天武天皇) but not end two words in the same one (大爷二爷 is two people). 金克木, 水生木:
    // a rule of the five phases. 威震天南: a verb at the start of a place or a thing. 赤发鬼, 黑脸鬼 (seen once): a kind of ghost or
    // demon. 任我行: a pronoun. 井鬼柳星张翼轸: lunar mansions one after another.
    const twiceApart = s.length >= 4 && s.indexOf(s[s.length - 1]) < s.length - 2;
    const ending = LIST_PLACE_END.has(s[s.length - 1]) || KIND_END.has(s[s.length - 1])
      || [...LIST_ORG_END, ...KIND_END_WORDS].some((t) => simp.endsWith(t) && simp.length > t.length);
    const phrase = LOCATIVE_END.has(s[s.length - 1]) || (SOFT_START.has(s[0]) && !(kind === 'person' && SURNAMES.has(s[0])))
      || (kind !== 'person' ? new Set(s).size < s.length : twiceApart)
      || (s.length === 3 && FIVE_PHASES.has(s[0]) && FIVE_PHASES.has(s[2]) && (s[1] === '克' || s[1] === '生'))
      || (kind !== 'person' && !ending && s.length >= 3 && dict.lookup(s[0] + s[1]).some((x) => /^to /.test(x.defs[0] ?? '')))
      || (kind === 'person' && seen === 1 && BEING_END.has(s[s.length - 1]))
      || (kind === 'person' && s.some((ch) => PRONOUN_IN.has(ch)))
      || (s.every((ch) => MANSIONS.has(ch)) && hits.some((h) => MANSIONS.has(fold(starts[h] - 1, starts[h])) || MANSIONS.has(fold(starts[h] + lens[h], starts[h] + lens[h] + 1))));
    if (phrase && cue < 2) continue;
    if (s.length >= 3) {
      // (近卫队, 伊朗馆, 李明天, 希望之火: a dictionary word and one character more is cut into words a reader can look up already,
      // and is as often a description as a name: only a cue that says the kind by itself makes it a name.)
      if (wordChars(s, dict) >= s.length - 1 && cue < 2) continue;
    } else if (cue < 2 || (kind === 'person' && !(SURNAMES.has(s[0]) && !CUE_NOT_SURNAME.has(s[0]))) || strong < 0.5 * clean) {
      // Two characters need a cue that says the kind at half their clean sightings, and a person a surname (丞相尚容一祢衡 once
      // and 尚容商议 nine times is "please allow"; 太尉慈悯 is "have mercy"). Else a surname and a rare given name (戴嵩, 周昉), or a
      // place with a rare character and a word of going or a place word beside it (到阳羡). Not two common characters (翠云, 车里,
      // 南墙: as likely two words; 在车里 says nothing), not a rare word of the old books (簪缨, 圣裔), not 于 + a name (致书于绍).
      const rare = s.some((ch) => dict.freq(ch) <= LIST_RARE_CHAR);
      const person = kind === 'person' && SURNAMES.has(s[0]) && !CUE_NOT_SURNAME.has(s[0]) && dict.freq(s[1]) <= LIST_RARE_CHAR;
      if (!(person || (kind === 'place' && rare && cue === 1))) continue;
    }
    // (昌西·比卢普斯, 亚历克西斯·勒布伦: beside a name dot, a listed place is half of someone's name.)
    const dotted = hits.some((h) => dot(starts[h] - 1) || dot(starts[h] + lens[h]));
    const entryKind: LexiconEntry['kind'] = kind === 'person' || dotted ? 'name' : kind === 'other' ? 'term' : 'place';
    const translit = s.every((ch) => TRANSLIT_CHARS.has(ch));
    let pinyin = entryKind === 'name' ? pinyinOf(w, entryKind, dict, kind === 'person' && !translit && !dotted) : wordsPinyin(w, entryKind, dict, lexicon);
    if (translit) pinyin = pinyin.replace(/\br5$/, 'er2');
    // (马塞洛 is a footballer that the list has as a place: a place or an organization nothing in the book confirms is glossed as a
    // name only.)
    const gloss = LIST_GLOSS[dotted ? 'person' : kind !== 'person' && !cue && !ending ? 'other' : kind];
    const e: LexiconEntry = { word: w, pinyin, gloss, kind: entryKind, count: seen, enabled: true, origin: 'auto' };
    CUED.add(e);
    out.push(e);
  }
  return { add: out, drop };
}

/**
 * The reading of a listed place, organization or thing, read as the words and the book's entries it is made of (秦沈|客运|专线: the
 * 沈 of 沈阳 is shěn, not the chén a character alone gets), with a temple in 观 read guàn; pinyinOf when they do not give one
 * syllable a character.
 */
function wordsPinyin(w: string, kind: LexiconEntry['kind'], dict: Dictionary, lexicon?: Lexicon): string {
  // The longest entry or dictionary word at each place, left to right. (Not segment(): core/segment.ts imports the dictionary
  // module, which the store reaches through this one, and a test that mocks the dictionary would wait on itself.)
  const syl: string[] = [];
  for (let i = 0; i < w.length;) {
    let piece = '';
    let read: string[] = [];
    for (let L = Math.min(lexicon?.maxLen ?? 0, w.length - i); L >= 2 && !piece; L--) {
      const e = lexicon?.get(w.substr(i, L));
      const p = e?.pinyin.split(' ') ?? [];
      if (e && p.length === [...e.word].length) { piece = e.word; read = p; }
    }
    if (!piece) {
      const word = dict.wordsAt(w, i).find((x) => x.length >= 2) ?? String.fromCodePoint(w.codePointAt(i)!);
      piece = word;
      read = dict.pinyinFor(word, {});
    }
    syl.push(...read);
    i += piece.length;
  }
  const n = [...w].length;
  if (syl.length !== n || !syl.every(Boolean)) return pinyinOf(w, kind, dict, false);
  if (kind === 'place' && n >= 3 && dict.toSimplified(w.slice(-1)) === '观') syl[n - 1] = 'guan4';
  shapeReadings([...dict.toSimplified(w)], syl, kind, dict);
  return syl.join(' ');
}

/** How many characters of a string (simplified, one code point each) dictionary words of two characters or more can cover. */
function wordChars(s: string[], dict: Dictionary): number {
  const best = new Array<number>(s.length + 1).fill(0);
  for (let b = 1; b <= s.length; b++) {
    // (之 between words joins them: 希望|之|火.)
    best[b] = best[b - 1] + (s[b - 1] === '之' ? 1 : 0);
    for (let a = Math.max(0, b - 6); a <= b - 2; a++) if (dict.hasWord(s.slice(a, b).join(''))) best[b] = Math.max(best[b], best[a] + b - a);
  }
  return best[s.length];
}

const LIST_GLOSS: Record<GazetteerKind, string> = {
  person: 'name (person)', place: 'place name', org: 'name of an organization', other: 'name (Wikipedia)',
};

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
  // 刺配远恶军州: a phrase that opens with a verb (刺配 "to be exiled") is not a place, however it ends. Four characters are a verb
  // and its object when the last two are a word too (前往中国, 疏浚西湖, 继续上路).
  if (verbPhrase(simp, dict)) return null;
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
  // (张雪峰 opens most of the clauses of a news story: a person whose name ends in 峰.)
  if (PLACE_SUFFIX.has(last) && !softEnd && !softStart && !measured && c.speech < 0.05 && c.bind >= 0.4 && len >= 3 && !(sur && len === 3 && (c.speech >= 0.03 || ('海河江湖'.includes(last) && simp[1] !== '家' && simp[1] !== '水') || (last === '峰' && simp[1] !== '家' && (c.open ?? 0) >= 0.5)))) {
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
  // (前往中国, 疏浚西湖: a verb and the place it goes to.)
  if (verbPhrase(simp, dict)) return null;
  // (整条街, 满屋: "the whole", "full" and a measure word count what follows.)
  if (COUNT_BEFORE.has(first) && MEASURE_AFTER.has(simp[1])) return null;
  const sur = surnameSplit(c.word, dict);
  // (张雪峰, 林如海: a surname and a given name that ends like a place; 眼光观之, 宿舍楼: a common word and a place ending is a phrase.)
  const personLike = !!sur && len === 3 && simp[1] !== '家' && last === '峰' && (c.open ?? 0) >= 0.5;
  if (len >= 3 && (PLACE_SUFFIX.has(last) || SHORT_PLACE_SUFFIX.has(last)) && c.speech === 0 && !personLike && dict.freq(simp.slice(0, len - 1).join('')) < 1000) {
    return { kind: 'place', surnameLed: false };
  }
  // 仲密: seen five times and never apart, once after 对 or 叫.
  const spoken = c.speech + c.prep;
  if (sur && len <= 3 && (spoken >= 0.3 || (len === 2 && spoken >= 0.1 && c.count >= 5)) && c.left >= 0.5 && c.right >= 0.5) return { kind: 'name', surnameLed: true };
  return null;
}

/**
 * Names that repeat a lot but that the tests above turn away (they ask for a surname and speech, or a high `pmi`, which a short
 * text cannot give a frequent string): a heroine called 敏明 115 times in a story of 9,000 characters, 子君 46 times (君 ends an
 * office elsewhere), 李静 64 times without saying much. Each shape asks for the parts to be almost never apart (`npmi`) or a
 * person's signs (spoken to, speaking, called out, opening a clause):
 * - 阿 and a name (阿随, 阿毛), a pet name in 儿 (孝儿), a nickname in 子 (祥子, 小福子; its 子 is neutral), a given name and a
 *   kinship word (附姐, 银姊);
 * - a pair never apart and seen at least 8 times in a short text or 12 in a long one (敏明, 子君, 宋志, 吴妈, 白妞);
 * - a surname and one character that is a person in a long text (李静);
 * - a foreign name made only of transliteration characters (拉希姆, 贝莱赫斯特, 索菲);
 * - in a short text, a surname and two characters seen three times and never apart (张雪峰 in a 250-character news story).
 */
export function judgeRepeat(c: TermCandidate, dict: Dictionary, minCount: number, short: boolean): Verdict | null {
  const simp0 = [...dict.toSimplified(c.word)];
  // 沙龙 (a story's sorcerer, a "salon" elsewhere): a dictionary word the book uses hundreds of times more often than other text
  // does, never apart and ordered about or addressed a quarter of the time, is a person here. Its card keeps the word's meaning.
  // (Not a common word that a story is about: 社群 "community" after 对 与 给, 焚毁 "to burn down" after 被, 堂倌 "waiter" called for,
  // 清华 the university. The word must be a noun, not one for a kind of person nor the name of a place or an institution, and be
  // treated as someone: it speaks, is called out, or comes after a verb that takes only a person.)
  if (c.known !== 'none' && (c.key ?? 0) >= 300 && (c.npmi ?? 0) >= 0.9 && c.prep >= 0.25 && c.count >= (short ? 8 : Math.max(12, 2 * minCount))
    && [...c.word].length === 2 && c.right >= 1.5 && !PERSON_HEAD.has(dict.toSimplified(c.word.slice(-1)))
    && ((c.said ?? c.speech) >= 0.05 || (c.voc ?? 0) >= 0.05 || (c.pprep ?? 0) >= 0.1)
    && !dict.lookup(c.word).some((e) => /^(\([^)]*\) )*to /.test(e.defs[0] ?? '') || ROLE_DEF.test(e.defs.join('; ')) || (/^[A-Z]/.test(e.pinyin) && PLACE_ORG_DEF.test(e.defs.join('; '))))
    && !PERSON_DEF.test(dict.lookup(c.word).flatMap((e) => e.defs).join('; '))) return { kind: 'name', surnameLed: false };
  // (A pet name in 儿 that jieba knows whole, 杏儿, still needs its entry: jieba reads the 儿 as r.)
  if (c.known !== 'none' && !(c.known === 'jieba' && simp0.length === 2 && simp0[1] === '儿' && !dict.hasWord(c.word))) return null;
  const simp = simp0;
  const len = simp.length;
  if (len < 2 || len > 6 || simp.length !== [...c.word].length) return null;
  const first = simp[0];
  const last = simp[len - 1];
  if (EDGE_STOP.has(first) || PHRASE_START.has(first) || (len >= 3 && simp[0] === simp[1])) return null;
  if (simp.some((ch, i) => NOT_IN_NAME.has(ch) || INTERJECTIONS.has(ch) || (i > 0 && EDGE_STOP.has(ch) && !(i === len - 1 && (c.tailBound || c.headBound) && NAME_TAIL.has(ch))))) return null;
  if (verbPhrase(simp, dict)) return null;
  const npmi = c.npmi ?? 0;
  const person = c.speech + c.prep + (c.voc ?? 0);
  const open = c.open ?? 0;
  const freeLeft = c.left >= 1.5 || open >= 0.5;
  const sur = surnameSplit(c.word, dict);
  const name = (neutralZi = false): Verdict => ({ kind: 'name', surnameLed: !!sur, ...(neutralZi ? { neutralZi } : {}) });
  // 阿随, 阿毛, 阿桂: 阿 before a name, never apart from it.
  // (阿母, 阿爹, 阿哥: 阿 before a kinship word is that kin.)
  if (first === '阿' && len <= 3 && c.count >= (short ? 3 : Math.max(4, minCount / 2)) && npmi >= 0.7 && c.right >= 1.2
    && (c.left >= 0.9 || open >= 0.3) && !SOFT_END.has(last) && !KIN_CHARS.has(simp[1]) && !PERSON_HEAD.has(simp[1]) && !'母父公翁'.includes(simp[1])) return name();
  // 孝儿, 静儿: a pet name in 儿 that is called out, speaks or is spoken to (not the erhua of a noun: 空儿, 味儿).
  // (打|盹儿, 金|钏儿: one character before it most of the time makes it the end of something else. jieba may know the pet
  // name whole, 杏儿, and read its 儿 as r.)
  if (len === 2 && last === '儿' && first !== '儿' && (c.known === 'none' || (c.known === 'jieba' && !dict.hasWord(c.word))) && !NO_PET_NAME.has(first) && !MEASURE_START.has(first) && !NUMERALS.has(first) && !SOFT_START.has(first)
    && c.count >= (short ? 4 : Math.max(5, minCount)) && c.bind >= 0.5 && person >= 0.1 && c.right >= 1 && (c.left >= 1.5 || open >= 0.5)) return name();
  // 祥子, 小福子: a nickname in 子, frequent and never apart, or its head never seen without it, and treated as a person.
  // (小牢子 is a little jailer: 牢子 is a word.)
  if (last === '子' && (len === 2 || (len === 3 && (first === '小' || first === '老' || !!sur) && !dict.hasWord(simp.slice(1).join('')))) && !NUMERALS.has(first) && !MEASURE_START.has(first)
    && c.right >= 1.5 && freeLeft && (len === 2
      ? npmi >= 0.85 && c.count >= Math.max(10, 2 * minCount) && (person >= 0.05 || c.count >= 30)
      : (c.head ?? Infinity) <= 1.1 * c.count && c.count >= Math.max(5, minCount) && person >= 0.1)) return name(true);
  // 附姐, 银姊: a given name and a kinship word, never apart and spoken to.
  if (len === 2 && KIN_CHARS.has(last) && !sur && !MEASURE_START.has(first) && !NUMERALS.has(first) && !SOFT_START.has(first) && !'老小大表堂'.includes(first)
    && npmi >= 0.85 && c.count >= Math.max(5, minCount) && person >= 0.1) return name();
  // 敏明, 子君, 宋志, 吴妈: a pair never apart, seen often, free on both sides.
  if (len === 2 && npmi >= 0.85 && c.count >= (short ? 8 : Math.max(12, 2 * minCount)) && c.right >= 1.5 && freeLeft
    && !SOFT_START.has(first) && !SOFT_END.has(last) && !MEASURE_START.has(first) && !NUMERALS.has(last) && !BARE_TITLE_END.has(last)
    && (!!sur || !PERSON_HEAD.has(last))) { // (骡夫: a word for a kind of person)
    // (石凳, 白马: a surname character before a noun; without a person's signs the pair is a word of the book.)
    // (铁锅, 觔斗: frequent things; 郡侯: an office in a long book, though it speaks.)
    return ((sur && (person >= 0.05 || open >= 0.5)) || person >= 0.08) && (short || !!sur || !ROLE_END.has(last)) ? name() : { kind: 'term', surnameLed: false };
  }
  // 李静: a surname and one character, a person in a long text (spoken to and speaking, free on both sides).
  if (sur && len === 2 && [...sur.surname].length === 1 && c.count >= Math.max(20, 3 * minCount) && c.bind >= 0.45 && person >= 0.1 && c.pmi >= 4
    && c.right >= 2.5 && (c.left >= 2 || open >= 0.5) && !SOFT_END.has(last) && !NUMERALS.has(last) && !KIN_CHARS.has(last) && !PERSON_HEAD.has(last)) return name();
  // 拉希姆, 贝莱赫斯特, 索菲: a foreign name, only transliteration characters, never apart.
  const translit = simp.every((ch, i) => TRANSLIT_CHARS.has(ch) || (i === len - 1 && i >= 2 && ch === '儿'));
  if (translit && !simp.some((ch) => EDGE_STOP.has(ch)) && c.count >= (short ? (len >= 3 ? 3 : 4) : minCount)
    // (珀拉儿: a final 儿 is common, so the pair before it, never seen without it, says how bound the name is.)
    && (len >= 3 ? c.bind >= 0.9 && (npmi >= 0.7 || (last === '儿' && (c.head ?? Infinity) <= c.count && npmi >= 0.5)) : npmi >= 0.9) && c.right >= 0.5 && (c.left >= 0.5 || open >= 0.5)
    && !commonInside(simp, dict)) return { kind: 'name', surnameLed: false };
  // 婆多瓦底: four characters never apart, half of them a transliteration's, opening clause after clause: a foreign name too.
  if (len === 4 && simp.filter((ch) => TRANSLIT_CHARS.has(ch)).length >= 2 && c.bind >= 0.95 && (c.head ?? Infinity) <= 1.1 * c.count
    && c.count >= (short ? 5 : minCount) && open >= 0.5 && c.right >= 1 && !commonInside(simp, dict) && !covered(simp, dict)) return { kind: 'name', surnameLed: false };
  // 张雪峰: in a short text, a surname and two characters seen three times and never apart, the first two not a word.
  // (It opens a clause or is spoken to: 白血轮 after "…的" is a word of the book, not a person.)
  if (short && sur && len === 3 && [...sur.surname].length === 1 && c.count >= 3 && c.bind >= 0.9 && npmi >= 0.8 && (open >= 0.5 || person >= 0.1) && c.right >= 0.5
    && !dict.hasWord(simp.slice(0, 2).join('')) && dict.freq(simp.slice(1).join('')) < 500 && !KIN_CHARS.has(last) && !PERSON_HEAD.has(last)
    && simp[1] !== '家' && !SHORT_PLACE_SUFFIX.has(last) && !'城村镇庄寨店府州县国岛寺庙宫殿关营'.includes(last)) return name();
  return null;
}

/** Whether a string is made entirely of dictionary words of two characters or more (波兰|饺子, 智能|手机). */
function covered(simp: string[], dict: Dictionary): boolean {
  const ok = new Array<boolean>(simp.length + 1).fill(false);
  ok[0] = true;
  for (let a = 0; a < simp.length; a++) {
    if (!ok[a]) continue;
    for (let b = a + 2; b <= simp.length; b++) if (dict.hasWord(simp.slice(a, b).join(''))) ok[b] = true;
  }
  return ok[simp.length];
}

/** A common word (corpus count 1,000 or more) of two characters or more inside a string: 南西 is not, 计算 is. */
function commonInside(simp: string[], dict: Dictionary): boolean {
  for (let a = 0; a < simp.length; a++) {
    for (let b = a + 2; b <= simp.length; b++) if (dict.freq(simp.slice(a, b).join('')) >= 1000) return true;
  }
  return false;
}

/**
 * Whether a string (simplified, one code point each) opens with a verb, a dictionary word whose first sense is "to …", and is a
 * phrase: five characters or more (刺配远恶军州), or four whose last two are a word too (前往中国, 疏浚西湖, 继续上路).
 */
function verbPhrase(simp: string[], dict: Dictionary): boolean {
  const len = simp.length;
  if (len < 4 || (len === 4 && !dict.hasWord(simp.slice(2).join('')))) return false;
  return dict.lookup(simp.slice(0, 2).join('')).some((e) => /^(\([^)]*\) )?to /.test(e.defs[0] ?? ''));
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
    let forced = named ? NAME_CHAR_READINGS[cps[i]] ?? NAME_CHAR_READINGS[s] : undefined;
    // (赤髮鬼: a traditional form with a reading of its own keeps it; 髮 is only fà, never the fā of 发.)
    if (forced && !NAME_CHAR_READINGS[cps[i]] && cps[i] !== s && !dict.lookup(cps[i]).some((e) => e.pinyin.toLowerCase() === forced)) forced = undefined;
    forced ??= kind === 'name' ? PERSON_CHAR_READINGS[s] ?? (!sur ? TRANSLITERATION_READINGS[s] : undefined) : undefined;
    out.push(forced ?? rest[i - skip] ?? '');
  }
  const n = cps.length;
  // 哥哥, 姑姑: the second of a doubled kinship character at the end of a name is neutral.
  if (n >= 3 && cps[n - 1] === cps[n - 2] && KIN_CHARS.has(simp[n - 1]) && out[n - 1]) out[n - 1] = out[n - 1].replace(/[1-4]$/, '5');
  // 连长, 支队长: an office in 长 is zhǎng. 黄花观, 五庄观: a temple is guàn.
  if (n >= 3 && simp[n - 1] === '长' && HEAD_BEFORE_ZHANG.has(simp[n - 2])) out[n - 1] = 'zhang3';
  if (kind === 'place' && n >= 3 && simp[n - 1] === '观') out[n - 1] = 'guan4';
  shapeReadings(simp, out, kind, dict);
  return out.join(' ');
}

/**
 * Readings the shape of a name decides, over what its characters read (pinyinOf, wordsPinyin): `out` holds one numbered syllable
 * per character of `simp` and is changed in place.
 */
function shapeReadings(simp: string[], out: string[], kind: LexiconEntry['kind'], dict: Dictionary): void {
  const n = simp.length;
  if (out.length !== n) return;
  // 斗木獬, 参水猿: a lunar mansion, a luminary and an animal (斗 dǒu, 参 shēn).
  if (n === 3 && LUMINARIES.has(simp[1]) && MANSION_READINGS[simp[0]]) out[0] = MANSION_READINGS[simp[0]];
  if (kind !== 'name' && kind !== 'place') return;
  // 速不台: 不 in a name is a syllable of its own (the neutral 不 of 走不动 belongs to a verb; 差不多先生 keeps the word's).
  if (n === 3 && simp[1] === '不' && out[1] === 'bu5' && !dict.hasWord(simp.join(''))) out[1] = 'bu4';
  if (kind === 'place') {
    // 乌斯藏, 西藏: Tibet (zàng) at the end; 厦深铁路: Xiamen (xià) at the start; 苕溪 (tiáo); 薄姬墓: the surname Bó.
    if (n >= 3 && simp[n - 1] === '藏') out[n - 1] = 'zang4';
    if (n >= 2 && simp[0] === '厦' && out[0] === 'sha4') out[0] = 'xia4';
    if (n >= 2 && simp[0] === '薄' && out[0] === 'bao2') out[0] = 'bo2';
    for (let i = 0; i + 1 < n; i++) if (simp[i] === '苕' && simp[i + 1] === '溪') out[i] = 'tiao2';
    return;
  }
  // 塔阳汗, 俺答汗, 林丹汗: a khan (hán) ends the name.
  if (n >= 3 && simp[n - 1] === '汗') out[n - 1] = 'han2';
  // 赤发鬼: hair (fà) after a color.
  for (let i = 1; i < n; i++) if (simp[i] === '发' && HAIR_COLORS.has(simp[i - 1])) out[i] = 'fa4';
  // 小安子, 老桂子: 小 or 老 and a nickname in 子, which is neutral (老夫子 holds a word: zǐ).
  if (n === 3 && (simp[0] === '小' || simp[0] === '老') && simp[2] === '子' && !dict.hasWord(simp[1] + '子')) out[2] = 'zi5';
  // 郦食其, 金日磾, 司马相如: a given name that reads as a whole.
  for (let i = 1; i + 1 < n; i++) {
    const read = NAME_PIECE_READINGS[simp[i] + simp[i + 1]];
    if (read) out.splice(i, 2, ...read.split(' '));
  }
}

const GLOSS: Record<LexiconEntry['kind'], string> = {
  name: 'name (person)', place: 'place or group name', term: 'name or term in this book', user: '',
};

function toEntry(c: TermCandidate, dict: Dictionary): LexiconEntry {
  let gloss = glossFor(c.word, c.kind, c.known, dict);
  // 二老: a common word used as a name keeps its meaning on the card.
  if (c.kind === 'name' && c.known !== 'none' && gloss === GLOSS.name && commonWord(c.word, dict)) gloss = `${GLOSS.name}; as a word: ${dict.lookup(c.word)[0].defs[0]}`;
  let pinyin = pinyinOf(c.word, c.kind, dict);
  if (c.neutralZi) pinyin = pinyin.replace(/zi3$/, 'zi5');
  return { word: c.word, pinyin, gloss, kind: c.kind, count: c.count, enabled: true, origin: 'auto' };
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
 * Read what a user typed for the pinyin of `word` ("guo1 jing4", "guō jìng", "guōjìng", "Guo Jing", and a name as the card writes
 * it, "Dīng Jǔrén", "Xīyóushì'èchuán") as numbered syllables, one per code point. Returns null when it does not fit the word, or
 * when no syllable has a tone ("lu zhen": the reader is asked for the tones rather than given neutral ones).
 */
export function parseEntryPinyin(input: string, word: string): string | null {
  const parts = entrySyllables(input, word);
  return parts && !(parts.length > 1 && toneless(input)) ? parts.join(' ') : null;
}

/** The numbered syllables of what was typed, one per code point of `word`, tones or not; null when they do not fit. */
function entrySyllables(input: string, word: string): string[] | null {
  const n = [...word].length;
  const text = input.trim().replace(/[，,;；]/g, ' ').replace(/\s+/g, ' ');
  if (!text) return null;
  const syllable = (p: string) => /^[a-zü]+[1-5]$/.test(p) && isSyllableBase(p.slice(0, -1));
  let parts = text.split(' ').map((p) => markedToNumbered(p).toLowerCase());
  if (parts.length !== n || !parts.every(syllable)) {
    // Each part may be a run of syllables: a surname and a given name written together (Dīng Jǔrén), or the whole name.
    const runs = text.split(' ').map((p) => {
      const one = markedToNumbered(p).toLowerCase();
      return syllable(one) && !/['’]/.test(p) ? [one] : splitPinyinRun(p)?.map((x) => x.toLowerCase()) ?? null;
    });
    if (runs.every((r) => r !== null)) {
      const flat = runs.flat() as string[];
      if (flat.length === n) parts = flat;
    }
  }
  return parts.length === n && parts.every(syllable) ? parts : null;
}

/** No tone mark and no tone number anywhere: "lu zhen". */
const toneless = (text: string): boolean => !/[\u0300\u0301\u0304\u030c1-5]/.test(text.normalize('NFD'));

/** What to tell the reader when parseEntryPinyin refuses `input` for `word`. */
export function entryPinyinProblem(input: string, word: string): string {
  const n = [...word].length;
  if (n > 1 && toneless(input) && entrySyllables(input, word)) return 'Add the tones, as marks or numbers, like Guō Jìng or guo1 jing4.';
  return `Type one syllable for each of the ${n} characters, like Guō Jìng or guo1 jing4.`;
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
      // The name list is fetched here, not with the dictionary: only detection needs it. Without it, the rules alone.
      const [dict, texts, gazetteer] = await Promise.all([ctx.dict(), bookTexts(ctx, bookId), loadGazetteer()]);
      // (Read without the list before, and still no list: nothing new to find.)
      if (!gazetteer && await store.lexicon.detected(bookId, WITHOUT_LIST)) return;
      // The first page is the reader's job: start when the browser is idle (or after a moment), then work in
      // slices of about 10 ms with the event loop getting a turn between them.
      await whenIdle(1500);
      const found = await detectTermsAsync(texts, dict, { gazetteer }, 10);
      await store.lexicon.putDetected(bookId, found, gazetteer ? DETECTOR_VERSION : WITHOUT_LIST);
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
