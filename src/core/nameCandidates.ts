// The name check (ARCHITECTURE.md §4.13): strings a book repeats a lot that are neither words nor names the detector took, and
// that look like names: a numbered name or honorific (七斤, 七大人, 八爺), 老 小 阿 and one character (老栓, 小栓, 阿長), given names
// that share a character (觉新, 觉民, 觉慧), a form of a name found (础翁 beside 尔础), a dictionary word the book uses as a person
// (水生), or any string that stands like a person (spoken to, speaking, opening clauses). The reader is asked once, "Names in this
// book?", and each answer is a fix of the book (core/fixes.ts). Precision beats recall: a prompt of ordinary words teaches the
// reader to dismiss it, so a book with nothing good gets no prompt.
import type { Dictionary, LexiconEntry } from '../types';
import {
  EDGE_STOP, NUMERALS, PERSON_DEF, PERSON_HEAD, PLACE_SUFFIX, SPEECH_NEXT,
  commonInside, covered, detectGen, isHanUnit, plausibleName as plausible, surnameSplit, type TermCandidate,
} from './lexicon';
import { KIN_CHARS, NOT_NICK_TAIL, SURNAMES } from './names';

/** Bump when the candidates change enough that a book should be looked at again. */
export const NAME_CHECK_VERSION = 1;
/** The most candidates one prompt shows. */
export const MAX_NAME_CANDIDATES = 8;

export type NameShape = 'numbered' | 'nickname' | 'siblings' | 'derived' | 'word' | 'repeat';

export interface NameCandidate {
  /** As the book spells it. */
  word: string;
  /** Places in the book (outside the names already found). */
  count: number;
  /** The kind the prompt suggests. */
  kind: LexiconEntry['kind'];
  /** Why it looks like a name. */
  why: NameShape;
  score: number;
}

/** After a numeral (七大人, 八爺, 四嬸, 九公, 六郎), or a surname and a numeral (鄒七嫂, 何九叔, 袁四爺): a person so numbered. */
const HONOR_TAILS = new Set(['大人', '太爷', '老爷', '奶奶', '太太', '少爷', '小姐', '相公', '官人', '先生', '大爷', '老太', '婆婆', '公公',
  ...'爷嫂婶叔伯姑姐妹哥弟公婆郎娘妈姨舅爹姊兄']);
/** After a character of a name found (础翁 beside 尔础, 瑶翁 beside 瑶圃): another way of calling that person. */
const DERIVED_TAILS = [...'翁公兄君哥姐妹弟叔伯嫂娘爷姑婆妈老'];
/** 老, 小 and 阿 before one character make a nickname (老栓, 小栓, 阿长) … */
const NICK_HEADS = [...'老小阿'];
/** A string that ends in one of these is a kind of person, an animal or a thing (村女, 蛊师, 主母, 指蜜鸟), not someone's name. */
const NOT_NAME_TAIL = new Set([...'师客女母父人者鸟兽虫鱼犬猫狗马牛羊猪鸡鸭花草树木板术法学教语文书话事物品类型式性化业界']);
/** What a person does right after their name: speak, or think, look, listen, go. */
const SAYS = new Set([...SPEECH_NEXT, ...'想看听走跑站坐']);
/** Before a place: 在窗口, 到村口, 从城里. A string after one of these half the time is somewhere, not someone. */
const AT_PLACE = new Set([...'在到从往于於进出']);
/** Brackets around a title or a note (《雨巷》, 〔馮評〕): what they hold is not a person. */
const TITLE_OPEN = new Set([...'《〈〔【']);

/** Shape weights: how likely a string of each shape that passes its tests is a name (measured on the corpus and the samples). */
const PRIOR: Record<NameShape, number> = { numbered: 1, nickname: 0.95, siblings: 0.9, derived: 0.9, word: 0.6, repeat: 0.75 };

interface Seen {
  c: TermCandidate;
  simp: string[];
  why: NameShape;
  /** Occurrences after a mark or a line break, and before one. */
  openL: number;
  openR: number;
  /** Occurrences followed by a verb a person does (说, 道, 笑, 想 …), or by a kinship word (七斤嫂). */
  says: number;
  kin: number;
  /** Occurrences where the character before or after makes a common word with its edge (大|水生, 水生|物). */
  cut: number;
  /** Occurrences inside a name already found, and inside 《》 or 〔〕. */
  inside: number;
  titled: number;
  /** The characters before and after it, counted. */
  lefts: Map<string, number>;
  rights: Map<string, number>;
  score: number;
}

const cp = (s: string): string[] => [...s];
const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());
/** Work between two yields (ms). */
const SLICE_MS = 8;

/**
 * The name candidates of a book: at most MAX_NAME_CANDIDATES, best first, none when nothing is good enough. `taken` holds the words
 * the book has already (its names and terms, and the reader's fixes either way), which are never offered. `found` are the names and
 * terms detection found: their parts are not offered, and their given names lead to other forms of them. `debug` gets every
 * candidate considered, scored (tools).
 */
export function* nameCandidatesGen(chapterTexts: string[], dict: Dictionary, taken: Iterable<string> = [], found: readonly LexiconEntry[] = [],
  debug?: (all: (NameCandidate & { signs: string })[]) => void): Generator<void, NameCandidate[], void> {
  let stats: TermCandidate[] = [];
  yield* detectGen(chapterTexts, dict, { maxLen: 5, statsOnly: true, debug: (c) => { stats = c; } });
  // Hand the main thread back every few milliseconds of work, as detection does, so a caller in idle slices never holds a frame.
  let last = now();
  const due = (): boolean => { const t = now(); if (t - last < SLICE_MS) return false; last = t; return true; };
  if (!stats.length) return [];
  const text = chapterTexts.join('\n');
  let han = 0;
  for (let i = 0; i < text.length; i++) {
    if ((i & 0xffff) === 0xffff && due()) yield;
    if (isHanUnit(text.charCodeAt(i))) han++;
  }
  // A name worth a tap repeats: five times in a story, more in a long book.
  const minOffer = han < 20000 ? 5 : Math.max(8, Math.round(han / 100000));
  const fold = (s: string) => dict.toSimplified(s);
  const takenSet = new Set<string>();
  for (const w of taken) { takenSet.add(w); takenSet.add(fold(w)); }
  /** The candidates seen often enough, by their simplified form (forms of a name found are looked up here). */
  const byFold = new Map<string, TermCandidate>();

  // ---- shapes, from the detector's statistics alone
  const picked = new Map<TermCandidate, Seen>();
  const consider = (c: TermCandidate, why: NameShape) => {
    const simp = cp(fold(c.word));
    if (simp.length !== cp(c.word).length || takenSet.has(c.word) || takenSet.has(simp.join(''))) return;
    const s = picked.get(c);
    if (s) { s.why = why; return; }
    picked.set(c, { c, simp, why, openL: 0, openR: 0, says: 0, kin: 0, cut: 0, inside: 0, titled: 0, lefts: new Map(), rights: new Map(), score: 0 });
  };
  const siblings = new Map<string, TermCandidate[]>();
  for (const c of stats) {
    if (due()) yield;
    if (c.count < minOffer) continue;
    const simp = cp(fold(c.word));
    const len = simp.length;
    byFold.set(simp.join(''), c);
    if (len < 2 || len > 4 || !plausible(simp, dict)) continue;
    const first = simp[0];
    const last = simp[len - 1];
    const known = c.known !== 'none';
    const person = c.speech + c.prep + (c.voc ?? 0);
    // 七大人, 八爷, 四婶, 九公, 鄒七嫂, 何九叔: a numeral, or a surname and a numeral, before an honorific.
    const numAt = NUMERALS.has(first) && !'一半几'.includes(first) ? 0 : len >= 3 && SURNAMES.has(first) && NUMERALS.has(simp[1]) && !'一半几'.includes(simp[1]) ? 1 : -1;
    if (numAt >= 0 && !known && HONOR_TAILS.has(simp.slice(numAt + 1).join(''))) { consider(c, 'numbered'); continue; }
    // 七斤, 九斤: a numeral and 斤 (children named by their weight at birth); 黄三, 孙八: a surname and a numeral.
    if (len === 2 && !known && ((numAt === 0 && last === '斤') || (SURNAMES.has(first) && NUMERALS.has(last) && !'一半几'.includes(last)))) { consider(c, 'numbered'); continue; }
    // 老五, 陈老五, 小六: 老 or 小 and a numeral, after a surname or not.
    const oldAt = len >= 3 && SURNAMES.has(first) ? 1 : 0;
    if (!known && len === oldAt + 2 && '老小'.includes(simp[oldAt]) && NUMERALS.has(last) && !'一半几'.includes(last)) { consider(c, 'numbered'); continue; }
    // 老栓, 小栓, 阿长, 小乙: 老 小 阿 and one character. (老张: jieba has it, but it is Old Zhang.)
    if (len === 2 && NICK_HEADS.includes(first) && (first === '阿' || !PERSON_HEAD.has(last)) && !KIN_CHARS.has(last) && !NOT_NICK_TAIL.has(last)
      && (!known || (c.known === 'jieba' && SURNAMES.has(last)))) { consider(c, 'nickname'); continue; }
    if (known) {
      // 水生, 迎春: a dictionary word the book uses hundreds of times more than other text, that speaks or is called out. Its
      // dictionary senses are all ordinary words (a proper noun is a name already), none a verb or a kind of person.
      if (len === 2 && (c.key ?? 0) >= 100 && c.speech + (c.voc ?? 0) >= 0.1 && (c.open ?? 0) >= 0.2 && ordinaryNoun(simp.join(''), dict)) consider(c, 'word');
      continue;
    }
    // (蹺蹊 for 蹊蹺: a word written back to front is that word. 老船夫, 小木匠: a word for a kind of person, described.)
    if (NOT_NAME_TAIL.has(last) || (len === 2 && dict.hasWord(last + first)) || (len >= 3 && PERSON_HEAD.has(last) && dict.hasWord(simp.slice(-2).join('')))) continue;
    // Given names that share a character (觉新, 觉民, 觉慧), gathered and judged together below.
    if (len === 2 && !NUMERALS.has(first)) {
      for (const key of [`0${first}`, `1${last}`]) {
        const list = siblings.get(key) ?? [];
        list.push(c);
        siblings.set(key, list);
      }
    }
    // Anything else: never apart, free on both sides, not made of dictionary words, and acting as a person.
    if ((c.npmi ?? 0) >= 0.75 && c.bind >= 0.7 && (person >= 0.1 || (c.open ?? 0) >= 0.5) && !covered(simp, dict) && !commonInside(simp, dict)) consider(c, 'repeat');
  }
  // Siblings: two to six pairs never apart that share a first or a last character the book seldom uses otherwise.
  let chars: Map<string, number> | null = null;
  for (const [key, list] of siblings) {
    if (due()) yield;
    const pairs = list.filter((c) => (c.npmi ?? 0) >= 0.7 && c.right >= 0.6 && c.left >= 0.6);
    if (pairs.length < 2 || pairs.length > 6) continue;
    chars ??= yield* charCounts(text, fold, due);
    const inPairs = pairs.reduce((n, c) => n + c.count, 0);
    if (inPairs < 0.6 * (chars.get(key.slice(1)) ?? 0)) continue;
    for (const c of pairs) consider(c, 'siblings');
  }
  // Forms of a name found: a character of its given name and an honorific (础翁), or 阿 小 老 and that character.
  for (const e of found) {
    if (e.enabled === false || e.kind !== 'name') continue;
    const sur = surnameSplit(e.word, dict);
    const given = cp(fold(sur ? sur.given : e.word));
    if (given.length < 1 || given.length > 2) continue;
    for (const ch of given) {
      for (const t of DERIVED_TAILS) {
        const c = byFold.get(ch + t);
        if (c && !picked.has(c) && c.known === 'none' && c.count >= minOffer && plausible(cp(ch + t), dict)) consider(c, 'derived');
      }
      for (const hd of NICK_HEADS) {
        const c = byFold.get(hd + ch);
        if (c && !picked.has(c) && c.known === 'none' && c.count >= minOffer && !NOT_NICK_TAIL.has(ch) && !KIN_CHARS.has(ch)) consider(c, 'derived');
      }
    }
  }
  yield;

  // ---- how each one stands, read in the text once: open on either side, followed by speech or a kinship word, cutting a word,
  // inside a name found or a title
  const seen = new Map<string, Seen>();
  for (const s of picked.values()) seen.set(s.c.word, s);
  const lens = [...new Set([...seen.keys()].map((w) => w.length))];
  // The names found that hold each one (洪七 inside 洪七公).
  const holders = new Map<string, string[]>();
  for (const e of found) {
    if (e.enabled === false) continue;
    const f = e.word;
    for (let a = 0; a < f.length; a++) {
      for (let b = a + 2; b <= Math.min(f.length, a + 4); b++) {
        if (b - a === f.length || !seen.has(f.slice(a, b))) continue;
        const list = holders.get(f.slice(a, b)) ?? [];
        list.push(f);
        holders.set(f.slice(a, b), list);
      }
    }
  }
  const n = text.length;
  for (let i = 0; i < n; i++) {
    if ((i & 0xfff) === 0xfff && due()) yield;
    if (!isHanUnit(text.charCodeAt(i))) continue;
    for (const L of lens) {
      const s = seen.get(text.substr(i, L));
      if (!s) continue;
      const p = i > 0 ? text[i - 1] : '\n';
      const q = i + L < n ? text[i + L] : '\n';
      const pHan = isHanUnit(p.charCodeAt(0));
      const qHan = isHanUnit(q.charCodeAt(0));
      if (holders.get(s.c.word)?.some((f) => { const k = f.indexOf(s.c.word); return i >= k && text.startsWith(f, i - k); })) { s.inside++; continue; }
      if (!pHan) s.openL++;
      if (!qHan) s.openR++;
      if (TITLE_OPEN.has(p)) s.titled++;
      const ps = pHan ? fold(p) : '';
      const qs = qHan ? fold(q) : '';
      if (ps) s.lefts.set(ps, (s.lefts.get(ps) ?? 0) + 1);
      if (qs) s.rights.set(qs, (s.rights.get(qs) ?? 0) + 1);
      if (SAYS.has(qs)) s.says++;
      if (KIN_CHARS.has(qs)) s.kin++;
      if ((ps && dict.freq(ps + s.simp[0]) >= 300) || (qs && dict.freq(s.simp[s.simp.length - 1] + qs) >= 300)) s.cut++;
    }
  }

  // ---- what is left: enough places of its own, rarely cutting a word, not a piece of something longer, and some sign of a person
  // The most places of a longer one holding each string.
  const held = new Map<string, Seen>();
  for (const o of seen.values()) {
    const w = o.c.word;
    for (let a = 0; a < w.length; a++) {
      for (let b = a + 2; b <= w.length; b++) {
        if (b - a === w.length || o.why === 'word') continue;
        const k = w.slice(a, b);
        if ((held.get(k)?.c.count ?? -1) < o.c.count) held.set(k, o);
      }
    }
  }
  // The characters of the given names found (宝 of 宝玉, 琏 of 贾琏).
  const givenChars = new Set<string>();
  for (const e of found) {
    if (e.enabled === false || e.kind !== 'name') continue;
    const sur = surnameSplit(e.word, dict);
    for (const ch of cp(fold(sur ? sur.given : e.word))) givenChars.add(ch);
  }
  const out: Seen[] = [];
  for (const s of seen.values()) {
    if (due()) yield;
    const c = s.c;
    const free = c.count - s.inside;
    if (free < minOffer || s.inside > 0.4 * c.count || s.titled > 0.3 * free || s.cut > 0.3 * free) continue;
    // (宝二爷, 琏二爷, 芸二爷; 琏二奶奶, 宝二奶奶: a numbered title after the given names of several people is a way of calling each
    // of them, not one person's name.)
    if (s.why === 'numbered' && NUMERALS.has(s.simp[0])) {
      let shared = 0;
      let who = 0;
      for (const [k, v] of s.lefts) if (givenChars.has(k)) { shared += v; if (v >= 2) who++; }
      if (who >= 2 && shared >= 0.1 * free) continue;
    }
    // (段小楼's 小楼, 阿妮塔's 阿妮, 小耗子's 小耗: the same character before it, or after it, most of the time.)
    if (fragment(s.lefts, free) || fragment(s.rights, free)) continue;
    let atPlace = 0;
    for (const [k, v] of s.lefts) if (AT_PLACE.has(k)) atPlace += v;
    if (atPlace >= 0.5 * free && !(s.simp.length >= 3 && PLACE_SUFFIX.has(s.simp[s.simp.length - 1]))) continue;
    // (七斤嫂 beside 七斤, 孫八爺 beside 八爺: the longer one holds the shorter, which is offered, and a kinship word or a surname.)
    if (s.simp.length >= 3 && (seen.has(c.word.slice(0, -1)) && KIN_CHARS.has(s.simp[s.simp.length - 1]))) continue;
    if ((held.get(c.word)?.c.count ?? 0) >= 0.7 * c.count) continue;
    s.score = score(s, free);
    if (s.score > 0) out.push(s);
  }
  out.sort((a, b) => b.score - a.score || b.c.count - a.c.count);
  const result = (s: Seen): NameCandidate => ({
    word: s.c.word, count: s.c.count - s.inside, why: s.why, score: Math.round(s.score * 100) / 100,
    kind: s.why === 'repeat' && s.simp.length >= 3 && PLACE_SUFFIX.has(s.simp[s.simp.length - 1]) ? 'place' : 'name',
  });
  if (debug) {
    const all = [...seen.values()].map((s) => ({ ...result(s), score: Math.round(s.score * 100) / 100,
      signs: `n${(s.c.npmi ?? 0).toFixed(2)} p${(s.c.speech + s.c.prep + (s.c.voc ?? 0)).toFixed(2)} o${(s.c.open ?? 0).toFixed(2)} says${s.says} kin${s.kin} L${s.openL} R${s.openR} cut${s.cut} in${s.inside} t${s.titled}` }));
    debug(all.sort((a, b) => b.score - a.score || b.count - a.count));
  }
  return out.slice(0, MAX_NAME_CANDIDATES).map(result);
}

/** Drive nameCandidatesGen with the event loop getting a turn every `sliceMs` ms of work. */
export async function findNameCandidates(chapterTexts: string[], dict: Dictionary, taken: Iterable<string> = [], found: readonly LexiconEntry[] = [], sliceMs = 10): Promise<NameCandidate[]> {
  const gen = nameCandidatesGen(chapterTexts, dict, taken, found);
  let t = now();
  for (;;) {
    const r = gen.next();
    if (r.done) return r.value;
    if (now() - t >= sliceMs) {
      await new Promise((ok) => setTimeout(ok, 0));
      t = now();
    }
  }
}

/** The same, all at once (tests and tools). */
export function nameCandidates(chapterTexts: string[], dict: Dictionary, taken: Iterable<string> = [], found: readonly LexiconEntry[] = [],
  debug?: (all: (NameCandidate & { signs: string })[]) => void): NameCandidate[] {
  const gen = nameCandidatesGen(chapterTexts, dict, taken, found, debug);
  for (;;) { const r = gen.next(); if (r.done) return r.value; }
}

/**
 * A dictionary word whose senses are all ordinary nouns: no proper noun (it is a name already), no verb ("to …"), no kind of person
 * or role (母亲, 掌柜, 酒保: the book's use of it as a person says nothing).
 */
function ordinaryNoun(w: string, dict: Dictionary): boolean {
  const senses = dict.lookup(w);
  if (PERSON_HEAD.has(w.slice(-1)) || KIN_CHARS.has(w.slice(-1))) return false;
  if (!senses.length) return true;
  if (senses.some((e) => /^[A-Z]/.test(e.pinyin))) return false;
  const defs = senses.flatMap((e) => e.defs);
  // (A verb, an adjective or an adverb: 勃然 "agitatedly".)
  if (defs.some((d) => /^(\([^)]*\) )?(to |-|\(of\b|(very|extremely|greatly|quite) )|^\w+ly\b/i.test(d))) return false;
  // (水生 "aquatic (plant, animal)": what the brackets add is not what the word is; 天尊 "(honorific appellation of a deity)" is.)
  const all = defs.map((d) => d.replace(/\s*\([^)]*\)/g, '').trim() || d).join('; ');
  return !PERSON_DEF.test(all) && !/\b(saying|proverb|phrase|deity|venerable|buddha|bodhisattva|daoist|taoist|title|sir|madam|animal|beast|creature|bird|eagle|hawk|kite|crow|dog|cat|mouse|rat|fish|horse|ox|cow|cattle|sheep|goat|pig|chicken|hen|duck|goose|tiger|wolf|fox|snake|monkey|bear|rabbit|deer|insect|candidate|keeper|owner|boss|proprietor|waiter|child|kid|baby|doctor|student|friend|guest|customer|host|neighbou?r|enemy|thief|robber|beggar|merchant|peddler|farmer|worker|cook|driver|servant|lad|youngster|fellow|guy|gentleman|maiden|widow|bride|groom|immortal|ghost|spirit|fairy|god|emperor|empress|prince|princess|queen|rebel|bandit|hero|villain|disciple|apprentice|attendant|retainer|minion|underling|official|scholar|[a-z]+(er|or|ist|ian))s?\b/i.test(all);
}

/** The same character on that side most of the time (a Han one): the string is a piece of something longer. */
function fragment(side: Map<string, number>, total: number): boolean {
  let top = 0;
  let ch = '';
  for (const [k, v] of side) if (v > top) { top = v; ch = k; }
  return top >= 0.6 * total && !SAYS.has(ch) && !EDGE_STOP.has(ch) && !'说道曰也又便就却'.includes(ch);
}

/** Occurrences of each Han character in the text, simplified. */
function* charCounts(text: string, fold: (s: string) => string, due: () => boolean): Generator<void, Map<string, number>, void> {
  const raw = new Map<number, number>();
  for (let i = 0; i < text.length; i++) {
    if ((i & 0xffff) === 0xffff && due()) yield;
    const c = text.charCodeAt(i);
    if (isHanUnit(c)) raw.set(c, (raw.get(c) ?? 0) + 1);
  }
  const out = new Map<string, number>();
  for (const [c, k] of raw) { const f = fold(String.fromCharCode(c)); out.set(f, (out.get(f) ?? 0) + k); }
  return out;
}

/**
 * How good a candidate is: more places is better, times how it stands (opening or closing a clause, speaking, followed by a kinship
 * word, spoken to or ordered about) and how sure its shape is, less the places where it cuts a word. Zero when nothing says person.
 */
function score(s: Seen, free: number): number {
  const c = s.c;
  const person = c.speech + c.prep + (c.voc ?? 0);
  const says = s.says / free;
  const kin = s.kin / free;
  const bounded = (s.openL + s.openR) / (2 * free);
  const signs = Math.min(1, 2 * person) + Math.min(1, 2 * says) + Math.min(0.5, kin) + bounded;
  const bound = c.npmi ?? 0;
  const need: Record<NameShape, number> = { numbered: 0.25, nickname: 0.35, derived: 0.25, siblings: 0.3, word: 0.6, repeat: 0.6 };
  if (signs < need[s.why] && !(bound >= 0.85 && (s.why === 'numbered' || s.why === 'derived'))) return 0;
  // A name speaks, is called out or opens clause after clause (朽腐, 抗疟, 丫嬛, 钺斧 and 跷蹊 do none of these); a form of a name is
  // never apart (仙翁 is a title).
  if ((s.why === 'repeat' || s.why === 'siblings') && (c.open ?? 0) < 0.6 && says < 0.1 && (c.voc ?? 0) < 0.05) return 0;
  if (s.why === 'derived' && bound < 0.6) return 0;
  return PRIOR[s.why] * Math.log2(1 + free) * (0.5 + signs) * (1 - s.cut / free);
}
