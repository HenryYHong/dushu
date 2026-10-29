// The engine shared by the languages written with spaces between words: Spanish, French, German, Italian, Portuguese and
// Russian. Each language's module (es.ts …) gives its rules (elision, clitics, compounds, the words that tell a noun from
// a verb); the data is built by scripts/lang/wikt/build.py from English Wiktionary, whose header describes the files.
//
// Forms are not a table of every inflected word: the data stores suffix rules ("drop -ar, add -ábamos") and each entry
// names the set of rules its forms follow. A word on the page is folded, cut at every point, and each rule that adds what
// follows the cut names a key to try (what precedes the cut plus what the rule removed). Spanish has 600,000 forms; this
// keeps them in 0.15 MB and a few thousand short arrays.
import type { Token } from '../../types';
import type { LangEngine, LangId, Sense, WordEntry, WordLookup } from '../types';

// ------------------------------------------------------------------------------------------------- the rules ---

/** What differs between the languages. */
export interface SpacedLang {
  id: LangId;
  /** The script the language's words are written in; words in another script are 'latin' or 'other' tokens. */
  script: 'latin' | 'cyrillic';
  /** Keys keep their case: German writes nouns with a capital (Essen the meal, essen to eat). */
  keepCase?: boolean;
  /** Russian: find and report the stressed vowel. */
  stress?: boolean;
  /** Words written with an apostrophe in front of the next word, lower case: French l' qu', Italian dell' un'. */
  elisions?: string[];
  /** Pieces after an apostrophe that are words of their own: German geht's ('s = es). */
  apostropheSuffixes?: Record<string, string>;
  /** Words written with a final apostrophe instead of a vowel (Italian po', di'): looked up with it. */
  finalApostrophe?: boolean;
  /** Object pronouns joined to the end of a verb without a hyphen (Spanish dámelo, Italian dimmi). */
  enclitics?: string[];
  /** Undo the spelling a verb takes in front of enclitics: candidate stems for `stem` before clitic `first`. */
  encliticStems?: (stem: string, first: string) => string[];
  /** Words that can follow a verb after a hyphen (French dit-il, a-t-il; Portuguese dá-me, dar-te-ei). */
  hyphenClitics?: string[];
  /** German: words not in the dictionary are tried as compounds of words that are. */
  compounds?: boolean;
  /** Words after which a noun or adjective comes, not a verb (articles, determiners, possessives, prepositions). */
  beforeNoun?: string[];
  /** Words after which a verb comes (subject and object pronouns, negation). */
  beforeVerb?: string[];
  /** Words that are an article or determiner before a noun and a pronoun before a verb (la, les, l'). */
  articleOrPronoun?: string[];
  /**
   * Determiners an article never comes before, so a word of articleOrPronoun that is also a preposition is the
   * preposition in front of one (Portuguese disse a um amigo "to a friend", a cada dia; but a minha casa "my house").
   */
  noArticleBefore?: string[];
  /** Prepositions: after one comes a noun or an infinitive, not a conjugated verb (de lanza "of lance", not "throws"). */
  prepositions?: string[];
  /**
   * Reflexive pronouns, before the verb or joined to it: `always` makes the verb reflexive (se acuerda), `ifPronominal`
   * only for verbs mostly used that way (me acuerdo "I remember", but me dio "gave me").
   */
  reflexive?: { always: string[]; ifPronominal: string[]; imperative?: Record<string, string> };
  /** Articles and determiners that say a noun's gender (el cura "the priest", la cura "the cure"). */
  genderBefore?: Record<string, 'm' | 'f'>;
  /** Auxiliary verbs (keys): after one, a word that can be a past participle is one (había partido "had split"). */
  auxiliaries?: string[];
  /**
   * Two-part negation: after a particle (French ne, n') a few words on, these words are the negation, not their
   * look-alikes (n'avoir point "not to have", not poindre "to dawn"; ne vois personne "see nobody", not "person").
   */
  negation?: { particles: string[]; words: string[] };
}

export interface LoadOpts {
  fetchBytes?: (name: string) => Promise<Uint8Array>;
  onProgress?: (done: number, total: number) => void;
}

/** A WordEntry with how the word on the page relates to it ("third-person singular preterite indicative"). */
export interface SpacedEntry extends WordEntry {
  form?: string;
}

/** Frequency-rank cutoffs of A1..C2 (registry.ts FREQ_LEVELS). */
export const LEVEL_CUTOFFS = [500, 1200, 2500, 5000, 10000, 20000];
export const levelOfRank = (rank: number | undefined): number | undefined => {
  if (!rank) return undefined;
  for (let i = 0; i < LEVEL_CUTOFFS.length; i++) if (rank <= LEVEL_CUTOFFS[i]) return i + 1;
  return undefined;
};
/** Words this common are marked `common` in the popup (B2 and below). */
const COMMON_RANK = 5000;

// ----------------------------------------------------------------------------------------------------- folding ---

const APOSTROPHES = /[’ʼ‘`´]/g;
const NON_ASCII = /[^\x00-\x7f]/;

/** The matching key of a word. Must agree with fold() in scripts/lang/wikt/build.py. */
export function foldKey(lang: Pick<SpacedLang, 'id' | 'keepCase'>, s: string): string {
  if (NON_ASCII.test(s)) s = s.normalize('NFC').replace(APOSTROPHES, "'");
  s = s.trim();
  if (lang.id === 'ru') {
    s = s.toLowerCase();
    if (/[̀́]/.test(s)) s = s.normalize('NFD').replace(/[̀́]/g, '').normalize('NFC');
    return s.replace(/ё/g, 'е');
  }
  return lang.keepCase ? s : s.toLowerCase();
}

/** Accents off, for the last-chance match of old spellings (fué, á) and words typed without them. */
export const stripAccents = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC');

const lowerFirst = (s: string): string => (s ? s[0].toLowerCase() + s.slice(1) : s);

/**
 * Nats lost by a headword written with capitals the word on the page lacks: NO the abbreviation is not no, Como the city
 * is not como. A lower-case headword fits any spelling (a capital may only start the sentence).
 */
function caseMisfit(head: string, word: string, keepCase: boolean): number {
  if (!word || head === head.toLowerCase()) return 0;
  const allCaps = head.length > 1 && head === head.toUpperCase();
  if (allCaps) return word.length > 1 && word === word.toUpperCase() ? 0 : 3;
  if (keepCase) return 0;
  return word === word.toLowerCase() ? 3 : 0;
}
const upperFirst = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);
const isUpper = (ch: string): boolean => ch !== ch.toLowerCase() && ch === ch.toUpperCase();

// ----------------------------------------------------------------------------------------------------- loading ---

async function gunzip(bytes: Uint8Array): Promise<string> {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return new TextDecoder().decode(bytes);
  if (typeof DecompressionStream !== 'undefined') {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
  }
  const { gunzipSync, strFromU8 } = await import('fflate');
  return strFromU8(gunzipSync(bytes));
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  // A dev server answers a missing file with index.html.
  if (bytes[0] === 0x3c && /^\s*<(!doctype|html)/i.test(new TextDecoder().decode(bytes.slice(0, 64)))) throw new Error(`${url}: not a data file`);
  return bytes;
}

let channel: MessageChannel | null = null;
/** A turn of the event loop between parse chunks, so the page keeps painting (same as core/dict.ts). */
function yieldToEventLoop(): Promise<void> {
  if (typeof window !== 'undefined' && typeof MessageChannel !== 'undefined') {
    return new Promise((resolve) => {
      channel ??= new MessageChannel();
      const ch = channel;
      ch.port1.onmessage = () => { ch.port1.onmessage = null; resolve(); };
      ch.port2.postMessage(0);
    });
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const CHUNK = 6000;
const NO_STRESS = -128;

/** The parsed data files. Senses stay as text until a word is looked up. */
class Data {
  key: string[] = [];
  head: string[] = [];
  reading: string[] = [];
  pos: string[] = [];
  gender: string[] = [];
  rank: number[] = [];
  paradigm: number[] = [];
  weak: boolean[] = [];
  /** Mostly used with a reflexive pronoun (acordarse). */
  pronominal: boolean[] = [];
  hint: string[] = [];
  /** The hint of the entry's first reflexive sense ('' when none). */
  rhint: string[] = [];
  /** Hints of single forms where the lemma's would mislead (hay "there is"). */
  formHints = new Map<string, string>();
  /** form -> "entry:percent ..." and the treebank count, for words the dictionary reads several ways. */
  prior = new Map<string, string>();
  senses: string[] = [];
  byKey = new Map<string, number[]>();
  rankOfKey = new Map<string, number>();
  /** Keys by rank, for levelWords. */
  ranked: string[] = [];

  descs: string[] = [];
  /** Per description: how unlikely a reader means that form (archaic, misspelling …), in nats. */
  descPenalty: number[] = [];
  /** Per description: the form takes enclitic pronouns (infinitive, gerund, imperative). */
  descClitic: boolean[] = [];
  removed: string[] = [];
  added: string[] = [];
  byAdded = new Map<string, number[]>();
  maxAdded = 0;
  pStart: number[] = [];
  pEnd: number[] = [];
  tokRule!: Int32Array;
  tokDesc!: Int32Array;
  tokStress!: Int8Array;

  parseForms(text: string): void {
    const rules: number[] = [];
    const descs: number[] = [];
    const stress: number[] = [];
    let pos = 0;
    const n = text.length;
    while (pos < n) {
      let nl = text.indexOf('\n', pos);
      if (nl < 0) nl = n;
      const kind = text.charCodeAt(pos);
      if (kind === 68 /* D */) {
        const d = text.slice(pos + 2, nl);
        this.descs.push(d);
        this.descPenalty.push(/\b(?:archaic|obsolete|misspelling|nonstandard|proscribed|dialectal|rare|pronunciation spelling|eye dialect)\b/.test(d) ? 2.5
          : /^(?:alternative|dated|abbreviation|clipping)|\b(?:poetic|literary)\b|\((?:Brazil|Portugal|colloquial|uncommon|regional|dated)\b/.test(d) ? 1 : 0);
        this.descClitic.push(/\b(?:infinitive|gerund|imperative)\b/.test(d) || /^first-person plural present subjunctive/.test(d));
      } else if (kind === 82 /* R */) {
        const t = text.indexOf('\t', pos + 2);
        const rem = text.slice(pos + 2, t);
        const add = text.slice(t + 1, nl);
        const r = this.removed.length;
        this.removed.push(rem);
        this.added.push(add);
        const list = this.byAdded.get(add);
        if (list) list.push(r); else this.byAdded.set(add, [r]);
        if (add.length > this.maxAdded) this.maxAdded = add.length;
      } else if (kind === 72 /* H */) {
        const t = text.indexOf('\t', pos + 2);
        this.formHints.set(text.slice(pos + 2, t), text.slice(t + 1, nl));
      } else if (kind === 80 /* P */) {
        this.pStart.push(rules.length);
        let i = pos + 2;
        while (i < nl) {
          let sp = text.indexOf(' ', i);
          if (sp < 0 || sp > nl) sp = nl;
          const tok = text.slice(i, sp);
          const a = tok.indexOf('.');
          const b = tok.indexOf('.', a + 1);
          rules.push(+tok.slice(0, a));
          descs.push(+tok.slice(a + 1, b < 0 ? undefined : b));
          stress.push(b < 0 ? NO_STRESS : +tok.slice(b + 1));
          i = sp + 1;
        }
        this.pEnd.push(rules.length);
      }
      pos = nl + 1;
    }
    this.tokRule = Int32Array.from(rules);
    this.tokDesc = Int32Array.from(descs);
    this.tokStress = Int8Array.from(stress);
  }

  async parseEntries(text: string, progress: (f: number) => void): Promise<void> {
    let pos = 0;
    let count = 0;
    const n = text.length;
    while (pos < n) {
      let nl = text.indexOf('\n', pos);
      if (nl < 0) nl = n;
      if (text.charCodeAt(pos) !== 35 /* # */ && nl > pos) this.addEntry(text, pos, nl);
      pos = nl + 1;
      if (++count % CHUNK === 0) {
        progress(pos / n);
        await yieldToEventLoop();
      }
    }
    this.ranked = [...this.rankOfKey.entries()].sort((a, b) => a[1] - b[1]).map(([k]) => k);
  }

  private addEntry(text: string, a: number, b: number): void {
    const cols: string[] = [];
    let i = a;
    // The first nine columns; the senses after them stay one string.
    for (let c = 0; c < 9; c++) {
      let t = text.indexOf('\t', i);
      if (t < 0 || t > b) t = b;
      cols.push(text.slice(i, t));
      i = Math.min(t + 1, b);
    }
    const id = this.key.length;
    const key = cols[0];
    this.key.push(key);
    this.head.push(cols[1] || key);
    this.reading.push(cols[2]);
    this.pos.push(cols[3]);
    this.gender.push(cols[4]);
    const rank = cols[5] ? +cols[5] : 0;
    this.rank.push(rank);
    if (rank && !this.rankOfKey.has(key)) this.rankOfKey.set(key, rank);
    this.paradigm.push(cols[6] ? +cols[6] : -1);
    this.weak.push(cols[7].includes('w'));
    this.pronominal.push(cols[7].includes('p'));
    const bar = cols[8].indexOf('|');
    this.hint.push(bar < 0 ? cols[8] : cols[8].slice(0, bar));
    this.rhint.push(bar < 0 ? '' : cols[8].slice(bar + 1));
    this.senses.push(i < b ? text.slice(i, b) : '');
    const list = this.byKey.get(key);
    if (list) list.push(id); else this.byKey.set(key, [id]);
  }

  parsePrior(text: string): void {
    let pos = 0;
    const n = text.length;
    while (pos < n) {
      let nl = text.indexOf('\n', pos);
      if (nl < 0) nl = n;
      if (text.charCodeAt(pos) !== 35 /* # */ && nl > pos) {
        const t = text.indexOf('\t', pos);
        if (t > pos && t < nl) this.prior.set(text.slice(pos, t), text.slice(t + 1, nl));
      }
      pos = nl + 1;
    }
  }

  /**
   * How likely each entry is for a folded form, by the treebanks: entry -> log probability (smoothed), and how far to
   * trust it (a word seen 20 times says less than one seen 2,000 times).
   */
  priorOf(f: string): Prior | null {
    const line = this.prior.get(f);
    if (!line) return null;
    const tab = line.lastIndexOf('\t');
    const count = +line.slice(tab + 1) || 1;
    const p = new Map<number, number>();
    for (const cell of line.slice(0, tab).split(' ')) {
      const colon = cell.indexOf(':');
      p.set(+cell.slice(0, colon), Math.log((+cell.slice(colon + 1) / 100) * count + 1) - Math.log(count + 2));
    }
    p.set(-1, -Math.log(count + 2)); // any entry the treebanks never meant
    return { p, weight: (1.5 * count) / (count + 50) };
  }

  /** Entries whose forms include `s` (a folded word), or whose key it is. */
  match(s: string, out: Cand[], penalty: number): void {
    const exact = this.byKey.get(s);
    if (exact) for (const e of exact) out.push({ e, desc: -1, stress: -1, penalty });
    const n = s.length;
    for (let c = Math.max(0, n - this.maxAdded); c <= n; c++) {
      const rules = this.byAdded.get(c === 0 ? s : s.slice(c));
      if (!rules) continue;
      const stem = s.slice(0, c);
      for (const r of rules) {
        const ids = this.byKey.get(stem + this.removed[r]);
        if (!ids) continue;
        for (const e of ids) {
          const p = this.paradigm[e];
          if (p < 0) continue;
          // Tokens of a paradigm are sorted by rule: binary search for the first with rule r.
          let lo = this.pStart[p];
          let hi = this.pEnd[p];
          while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (this.tokRule[mid] < r) lo = mid + 1; else hi = mid;
          }
          for (let t = lo; t < this.pEnd[p] && this.tokRule[t] === r; t++) {
            const st = this.tokStress[t];
            out.push({ e, desc: this.tokDesc[t], stress: st === NO_STRESS ? -1 : c + st, penalty: penalty + this.descPenalty[this.tokDesc[t]] });
          }
        }
      }
    }
  }

  parseSenses(e: number): Sense[] {
    const text = this.senses[e];
    if (!text) return [];
    const out: Sense[] = [];
    for (const col of text.split('\t')) {
      let notes: string[] | undefined;
      let rest = col;
      if (rest.startsWith('{')) {
        const close = rest.indexOf('}');
        notes = rest.slice(1, close).split(', ').filter(Boolean);
        rest = rest.slice(close + 1);
      }
      const glosses = rest.split('|').filter(Boolean);
      if (!glosses.length) continue;
      const sense: Sense = { pos: this.pos[e] || undefined, glosses };
      if (notes?.length) sense.notes = notes;
      out.push(sense);
    }
    return out;
  }
}

interface Prior { p: Map<number, number>; weight: number }

/** One way a word on the page can be read: an entry, and the form it is of that entry (desc -1: the headword itself). */
interface Cand { e: number; desc: number; stress: number; penalty: number; score?: number }

interface Part { text: string; key?: string; gloss?: string }

/** Everything known about a word on the page, before its neighbors are considered. */
interface Analysis {
  cands: Cand[];
  /** The key the word is saved under when it resolves to no entry of its own (compounds) or to none at all. */
  key: string;
  lemma: string;
  parts?: Part[];
  name?: boolean;
  /** German compounds: what precedes the head word (Haustür for Haustürschlüsseln). */
  prefix?: string;
}

// ---------------------------------------------------------------------------------------------------- scoring ---

const CLOSED = new Set(['article', 'determiner', 'pronoun', 'preposition', 'conjunction', 'contraction', 'particle']);
const NOUNISH = new Set(['noun', 'adjective', 'numeral', 'proper noun']);
const UNRANKED = 80000;
/** Nats a word gains for being spelled exactly like the headword it is read as. */
const EXACT_BONUS = 1;
const CLOSED_EXACT_BONUS = 3;
/** How far (nats) the neighbors may move a word from its likeliest reading: est in "Quel est" stays être. */
const CONTEXT_MARGIN = 5;

// ------------------------------------------------------------------------------------------------------- engine ---

export class SpacedEngine implements LangEngine {
  readonly id: LangId;
  meta: LangEngine['meta'] = { built: '', counts: {}, sources: [] };
  private cache = new Map<string, Analysis>();
  /** The reading segment() chose for a token in its sentence, for hint() and lookup() of that same token. */
  private chosen = new WeakMap<Token, { a: Analysis; c: Cand | undefined; reflexive: boolean }>();
  private elisions: Set<string>;
  private hyphenClitics: Set<string>;
  private beforeNoun: Set<string>;
  private beforeVerb: Set<string>;
  private articleOrPronoun: Set<string>;
  private noArticleBefore: Set<string>;
  private prepositions: Set<string>;
  private enclitics: string[];
  private chars: CharClasses;

  constructor(readonly lang: SpacedLang, private data: Data) {
    this.id = lang.id;
    this.chars = new CharClasses(lang.script);
    this.elisions = new Set(lang.elisions ?? []);
    this.hyphenClitics = new Set(lang.hyphenClitics ?? []);
    this.beforeNoun = new Set(lang.beforeNoun ?? []);
    this.beforeVerb = new Set(lang.beforeVerb ?? []);
    this.articleOrPronoun = new Set(lang.articleOrPronoun ?? []);
    this.noArticleBefore = new Set(lang.noArticleBefore ?? []);
    this.prepositions = new Set(lang.prepositions ?? []);
    this.enclitics = [...(lang.enclitics ?? [])].sort((a, b) => b.length - a.length);
  }

  fold(s: string): string {
    return foldKey(this.lang, s);
  }

  // ---- matching

  private rankOf(e: number): number {
    return this.data.rank[e] || UNRANKED;
  }

  private score(c: Cand, capMid: boolean, word: string, prior: Prior | null): number {
    const d = this.data;
    let s = -Math.log(this.rankOf(c.e)) - c.penalty - caseMisfit(d.head[c.e], word, !!this.lang.keepCase);
    // What hand-annotated text usually means by this spelling (fue: ser four times in five), trusted as far as the
    // treebanks saw the word often (they are news and web text; a novel's vino is as often "came" as "wine").
    if (prior) s += prior.weight * (prior.p.get(c.e) ?? prior.p.get(-1)!);
    // A function word spelled exactly like its own entry is that word (moi, not je; muy, not mucho; au, not à).
    // An adverb counts as one only where it is the headword's leading section (muy, bien): beau's adverb is the idiom
    // avoir beau "in vain", and must not outbid beau the adjective.
    if (c.desc < 0) s += CLOSED.has(d.pos[c.e]) || (d.pos[c.e] === 'adverb' && d.byKey.get(d.key[c.e])?.[0] === c.e) ? CLOSED_EXACT_BONUS : EXACT_BONUS;
    const pos = d.pos[c.e];
    // A capital in mid-sentence says name, except in German, which writes every noun so (das Essen is the meal, not the
    // city; sein Buch is a book).
    if (pos === 'proper noun') s += this.lang.keepCase ? -1 : capMid ? 3 : -4;
    else if (capMid && this.lang.id !== 'de' && c.desc < 0 && d.key[c.e] !== d.head[c.e] && isUpper(d.head[c.e][0])) s += 2;
    if (d.weak[c.e]) s -= 2.5;
    // Among the sections of one common key, the closed-class word leads (este "this" before este "east").
    if (CLOSED.has(pos) && this.rankOf(c.e) <= 3000) s += 0.6;
    if (pos === 'interjection') s -= 0.5;
    return s;
  }

  /** Candidates for a word as written, best first, one per entry. */
  private candidates(word: string, capMid: boolean): Cand[] {
    const d = this.data;
    const out: Cand[] = [];
    const f = this.fold(word);
    d.match(f, out, 0);
    if (this.lang.keepCase) {
      // German: a capital may only start the sentence (Essen, Das); a noun is never written in lower case.
      if (isUpper(f[0] ?? '')) {
        const low = lowerFirst(f);
        if (low !== f) d.match(low, out, capMid ? 2 : 0.3);
        if (f.length > 1 && f === f.toUpperCase()) d.match(upperFirst(f.toLowerCase()), out, 0.5);
      }
    }
    if (!out.length && NON_ASCII.test(f)) {
      // Old spellings (fué, á, dió) and words typed without their accents.
      const plain = stripAccents(f);
      if (plain !== f) d.match(plain, out, 2);
    }
    if (!out.length && this.lang.keepCase) {
      // German before 1996: muß, wußte for muss, wusste; heute abend for heute Abend.
      if (f.includes('ß')) d.match(f.replace(/ß/g, 'ss'), out, 0.5);
      if (!out.length && !isUpper(f[0] ?? '')) d.match(upperFirst(f), out, 1);
    }
    if (!out.length && /oe|ae/i.test(f)) {
      // oeuvre and boeuf as typed for œuvre and bœuf.
      d.match(f.replace(/oe/g, 'œ').replace(/ae/g, 'æ'), out, 0.5);
    }
    return this.rank(out, capMid, word);
  }

  private rank(out: Cand[], capMid: boolean, word = ''): Cand[] {
    const best = new Map<number, Cand>();
    const f = word ? this.fold(word) : '';
    const prior = f ? (this.data.priorOf(f) ?? (this.lang.keepCase ? this.data.priorOf(lowerFirst(f)) : null)) : null;
    for (const c of out) {
      c.score = this.score(c, capMid, word, prior);
      const prev = best.get(c.e);
      if (!prev || c.score! > prev.score!) best.set(c.e, c);
    }
    return [...best.values()].sort((a, b) => b.score! - a.score! || a.e - b.e);
  }

  /** Spanish dámelo, Italian dimmi: the verb and the pronouns joined to it. */
  private splitEnclitics(word: string): { verb: Cand[]; stem: string; clitics: string[] } | null {
    if (!this.enclitics.length) return null;
    const f = this.fold(word);
    let best: { verb: Cand[]; stem: string; clitics: string[] } | null = null;
    const peel = (rest: string, clitics: string[]): void => {
      if (clitics.length >= 3 || best) return;
      for (const cl of this.enclitics) {
        if (rest.length <= cl.length + 1 || !rest.endsWith(cl)) continue;
        const stem = rest.slice(0, -cl.length);
        const chain = [cl, ...clitics];
        const tries = this.lang.encliticStems ? this.lang.encliticStems(stem, cl) : [stem];
        for (const t of tries) {
          const out: Cand[] = [];
          this.data.match(t, out, 0);
          const verbs = out.filter((c) => this.data.pos[c.e] === 'verb' && (c.desc < 0 || this.data.descClitic[c.desc]))
            .concat(out.filter((c) => t === 'ecco' || t === 'eis'));
          if (verbs.length) {
            let ranked = this.rank(verbs, false);
            // An imperative takes its own person's pronoun: siéntate is sentar's sienta (sit) + te, not sentir's formal
            // sienta (feel) + te, however much commoner sentir is.
            const person = this.lang.reflexive?.imperative?.[chain[0]];
            if (person) {
              const re = new RegExp(person);
              const agree = ranked.filter((c) => c.desc >= 0 && re.test(this.data.descs[c.desc]));
              if (agree.length) ranked = [...agree, ...ranked.filter((c) => !agree.includes(c))];
            }
            best = { verb: ranked, stem: word.slice(0, word.length - (f.length - stem.length)), clitics: chain };
            return;
          }
        }
        peel(stem, chain);
        if (best) return;
      }
    };
    peel(f, []);
    return best;
  }

  /** German Haustürschlüssel: the dictionary words it is built from, the last one inflected. */
  private splitCompound(word: string): { head: Cand[]; pieces: string[]; prefix: string } | null {
    const d = this.data;
    const w = word;
    if (w.length < 6) return null;
    const known = (s: string): boolean => d.byKey.has(s) || d.byKey.has(upperFirst(s)) || d.byKey.has(s.toLowerCase());
    // Best split of w[0, end) into known words (with linking -s-, -es-, -n-, -en-, -e-, -er- between them): fewest pieces.
    const memo = new Map<number, string[] | null>();
    const front = (end: number): string[] | null => {
      if (memo.has(end)) return memo.get(end)!;
      let res: string[] | null = null;
      for (let a = 0; a <= end - 3 && !res; a++) {
        const piece = w.slice(a, end);
        const base = piece.toLowerCase();
        let ok = known(base) || known(upperFirst(base));
        let link = '';
        if (!ok) {
          for (const l of ['s', 'es', 'n', 'en', 'e', 'er', 'ens']) {
            if (base.length - l.length >= 3 && base.endsWith(l) && known(base.slice(0, -l.length))) { ok = true; link = l; break; }
          }
          // A verb stem in front: Schreibtisch (schreib-en), Wartezimmer (wart-e-n).
          if (!ok && base.length >= 3 && (d.byKey.has(base + 'en') || d.byKey.has(base + 'n'))) ok = true;
        }
        if (!ok) continue;
        if (a === 0) res = [w.slice(0, end)];
        else {
          const rest = front(a);
          if (rest) res = [...rest, w.slice(a, end)];
        }
        void link;
      }
      memo.set(end, res);
      return res;
    };
    for (let cut = 3; cut <= w.length - 3; cut++) {
      const tail = upperFirst(w.slice(cut).toLowerCase());
      const out: Cand[] = [];
      d.match(tail, out, 0);
      const nouns = out.filter((c) => d.pos[c.e] === 'noun' || d.pos[c.e] === 'adjective' || d.pos[c.e] === 'verb');
      if (!nouns.length || tail.length < 3) continue;
      const pieces = front(cut);
      if (!pieces) continue;
      return { head: this.rank(nouns, false), pieces: [...pieces, w.slice(cut)], prefix: w.slice(0, cut) };
    }
    return null;
  }

  /** The analysis of one word, by itself (no neighbors). `capMid`: capitalized in the middle of a sentence. */
  analyze(word: string, capMid = false): Analysis {
    const ck = (capMid ? '1' : '0') + word;
    const hit = this.cache.get(ck);
    if (hit) return hit;
    const a = this.analyzeUncached(word, capMid);
    if (this.cache.size > 60000) this.cache.clear();
    this.cache.set(ck, a);
    return a;
  }

  private analyzeUncached(word: string, capMid: boolean): Analysis {
    const d = this.data;
    // German geht's: the 's cut off by segment() is es.
    const full = /^['’]/.test(word) ? this.lang.apostropheSuffixes?.[word.slice(1).toLowerCase()] : undefined;
    if (full) return this.analyze(full, false);
    const f = this.fold(word);
    const cands = this.candidates(word, capMid);
    const cap = isUpper(word[0] ?? '');
    if (cands.length) {
      const top = cands[0];
      // a-t-il, Est-ce: Wiktionary has some verb + pronoun runs as entries of their own ("interrogative form of avoir").
      // They read as the verb, with the pronouns as parts, like every other run (dit-il).
      const clit = this.hyphenClitics.size && d.pos[top.e] === 'verb' && /[-‐]/.test(d.key[top.e]) ? word.split(/(?<=\p{L})[-‐](?=\p{L})/u) : [];
      if (clit.length > 1 && clit.slice(1).every((p) => this.hyphenClitics.has(this.fold(p).toLowerCase()))) {
        const verb = this.candidates(clit[0], false).filter((c) => d.pos[c.e] === 'verb');
        if (verb.length) return { cands: verb, key: d.key[verb[0].e], lemma: d.head[verb[0].e], parts: clit.map((p) => this.part(p)) };
      }
      const a: Analysis = { cands, key: d.key[top.e], lemma: d.head[top.e] };
      if (d.pos[top.e] === 'proper noun' && cap) a.name = true;
      return a;
    }
    // Hyphenated (dit-il, dá-me, Haus-tür) and apostrophe words (that the tokenizer kept whole).
    const pieces = word.split(/(?<=\p{L})[-‐](?=\p{L})/u);
    if (pieces.length > 1) {
      if (this.lang.compounds) {
        const joined = pieces[0] + pieces.slice(1).map((p) => p.toLowerCase()).join('');
        const whole = this.candidates(joined, capMid);
        if (whole.length) return { cands: whole, key: d.key[whole[0].e], lemma: d.head[whole[0].e], parts: pieces.map((p) => this.part(p)) };
        const last = this.candidates(upperFirst(pieces[pieces.length - 1]), false);
        if (last.length) {
          const prefix = pieces.slice(0, -1).join('-') + '-';
          return { cands: last, key: this.fold(prefix + d.head[last[0].e]), lemma: prefix + d.head[last[0].e], prefix, parts: pieces.map((p) => this.part(p)) };
        }
      }
      let first = this.candidates(pieces[0], false);
      if (!first.length && this.lang.encliticStems) {
        // fazê-lo is fazer + o: the verb lost its last letter to the pronoun.
        for (const stem of this.lang.encliticStems(this.fold(pieces[0]), this.fold(pieces[1]))) {
          const out: Cand[] = [];
          this.data.match(stem, out, 0);
          first = this.rank(out.filter((c) => this.data.pos[c.e] === 'verb'), false);
          if (first.length) break;
        }
      }
      if (first.length) {
        return { cands: first, key: d.key[first[0].e], lemma: d.head[first[0].e], parts: pieces.map((p) => this.part(p)) };
      }
    }
    const enc = this.splitEnclitics(word);
    if (enc) {
      const v = enc.verb[0];
      const parts = [{ text: enc.stem, key: d.key[v.e], gloss: d.hint[v.e] || undefined }, ...this.cliticParts(word, enc.stem, enc.clitics)];
      return { cands: enc.verb, key: d.key[v.e], lemma: d.head[v.e], parts };
    }
    if (this.lang.compounds && cap) {
      const comp = this.splitCompound(word);
      if (comp) {
        const h = comp.head[0];
        const lemma = comp.prefix + d.head[h.e].toLowerCase();
        // Later pieces are looked up as nouns first: Fensterblech is Fenster + Blech (sheet metal), not blechen (to pay up).
        return { cands: comp.head, key: this.fold(lemma), lemma, prefix: comp.prefix, parts: comp.pieces.map((p, i) => this.part(p, i > 0)) };
      }
    }
    return { cands: [], key: f, lemma: word, name: cap || undefined };
  }

  private cliticParts(word: string, stem: string, clitics: string[]): Part[] {
    const out: Part[] = [];
    let at = stem.length;
    for (const cl of clitics) {
      const text = word.slice(at, at + cl.length);
      at += cl.length;
      out.push(this.part(text));
    }
    return out;
  }

  /** A piece of a word as its own word: its key and short gloss. */
  private part(text: string, nounFirst = false): Part {
    const capped = nounFirst ? this.candidates(upperFirst(text), false) : [];
    const cands = capped.length ? capped : this.candidates(text, false).length ? this.candidates(text, false) : this.candidates(upperFirst(text), false);
    if (!cands.length) return { text };
    const e = cands[0].e;
    // A lone letter read as a noun is the euphonic t of a-t-il, not t for "tonne".
    if (text.length === 1 && (this.data.pos[e] === 'noun' || this.data.pos[e] === 'proper noun')) return { text };
    return { text, key: this.data.key[e], gloss: this.data.hint[e] || undefined };
  }

  // ---- segmenting

  segment(text: string): Token[] {
    const d = this.data;
    const tokens: Token[] = [];
    const words: { t: Token; a: Analysis; at: number }[] = [];
    let sentenceStart = true;
    const n = text.length;
    let i = 0;
    while (i < n) {
      const code = text.charCodeAt(i);
      const cls = this.chars.of(code, text, i);
      if (cls === LETTER) {
        let j = i + 1;
        // A word: letters and marks, joined across inner apostrophes and hyphens.
        for (;;) {
          while (j < n && this.chars.of(text.charCodeAt(j), text, j) === LETTER) j++;
          const c = text[j];
          if ((c === "'" || c === '’' || c === 'ʼ' || c === '-' || c === '‐') && j + 1 < n && this.chars.of(text.charCodeAt(j + 1), text, j + 1) === LETTER) { j++; continue; }
          break;
        }
        // An abbreviation keeps its period when the dictionary has it so (M. for Monsieur, Sr., etc.), unless the word
        // without it is a common one (no. is número, but "Dijo que no." ends a sentence).
        if (text[j] === '.' && j - i <= 4 && this.isAbbreviation(text.slice(i, j))) j++;
        // Italian po', di': a final apostrophe that belongs to the word.
        if (this.lang.finalApostrophe && (text[j] === "'" || text[j] === '’') && (j + 1 >= n || this.chars.of(text.charCodeAt(j + 1), text, j + 1) !== LETTER)) {
          const withApo = text.slice(i, j) + "'";
          // po' is a form of poco, not an entry of its own.
          const found: Cand[] = [];
          this.data.match(this.fold(withApo), found, 0);
          if (found.length) j++;
        }
        for (const piece of this.splitWord(text, i, j)) {
          if (piece.kind !== 'word') { tokens.push(piece); continue; }
          const capMid = !sentenceStart && isUpper(piece.text[0]);
          const a = this.analyze(piece.text, capMid);
          piece.key = a.key;
          piece.lemma = a.lemma;
          piece.inDict = a.cands.length > 0;
          // A capital in mid-sentence makes a name (Sancho Panza, la Mancha) even where a common word shares the
          // spelling; German writes every noun so and is told by the dictionary alone.
          if (a.name || (capMid && (!a.cands.length || (!this.lang.keepCase && piece.text !== piece.text.toUpperCase())))) {
            piece.name = true;
            if (a.cands.length && d.pos[a.cands[0].e] !== 'proper noun') piece.lemma = piece.text;
          }
          words.push({ t: piece, a, at: tokens.length });
          tokens.push(piece);
          sentenceStart = false;
        }
        i = j;
        continue;
      }
      if (cls === DIGIT) {
        let j = i + 1;
        while (j < n && (this.chars.of(text.charCodeAt(j), text, j) === DIGIT || ((text[j] === '.' || text[j] === ',') && j + 1 < n && this.chars.of(text.charCodeAt(j + 1), text, j + 1) === DIGIT))) j++;
        tokens.push({ text: text.slice(i, j), start: i, end: j, kind: 'num', inDict: false });
        sentenceStart = false;
        i = j;
        continue;
      }
      if (cls === SPACE) {
        let j = i + 1;
        while (j < n && this.chars.of(text.charCodeAt(j), text, j) === SPACE) j++;
        tokens.push({ text: text.slice(i, j), start: i, end: j, kind: 'space', inDict: false });
        i = j;
        continue;
      }
      if (cls === FOREIGN) {
        let j = i + 1;
        while (j < n && this.chars.of(text.charCodeAt(j), text, j) === FOREIGN) j++;
        const foreign = text.slice(i, j);
        tokens.push({ text: foreign, start: i, end: j, kind: /\p{Script=Latin}/u.test(foreign) ? 'latin' : 'other', inDict: false });
        sentenceStart = false;
        i = j;
        continue;
      }
      // Punctuation and everything else: one token per mark (a surrogate pair is one mark).
      const len = code >= 0xd800 && code <= 0xdbff && i + 1 < n ? 2 : 1;
      const mark = text.slice(i, i + len);
      tokens.push({ text: mark, start: i, end: i + len, kind: cls === PUNCT ? 'punct' : 'other', inDict: false });
      if (/[.!?…;:]/.test(mark) && mark !== ';' && mark !== ':') sentenceStart = true;
      i += len;
    }
    this.useContext(words, tokens);
    return tokens;
  }

  /** Cut a run of word characters (with inner apostrophes and hyphens) into tokens. */
  private splitWord(text: string, a: number, b: number): Token[] {
    const word = text.slice(a, b);
    const tok = (s: number, e: number): Token => ({ text: text.slice(s, e), start: s, end: e, kind: 'word', inDict: false });
    const hasApo = /['’ʼ]/.test(word);
    const hasHyphen = /[-‐]/.test(word);
    // Script changes inside a run (a Latin name in Russian text) cut it.
    if (!hasApo && !hasHyphen) return [tok(a, b)];
    if (this.wholeKnown(word, hasApo)) return [tok(a, b)];
    const out: Token[] = [];
    let s = a;
    // Elision: l'homme, qu'il, dell'anno, c'è, jusqu'à.
    if (hasApo) {
      for (;;) {
        const rest = text.slice(s, b);
        const m = /^[^'’ʼ]+['’ʼ]/.exec(rest);
        if (!m) break;
        const head = m[0];
        const folded = this.fold(head);
        if (this.elisions.has(folded) || this.elisions.has(folded.toLowerCase()) || (this.data.byKey.has(folded) && !/[-‐]/.test(head))) {
          out.push(tok(s, s + head.length));
          s += head.length;
          if (this.wholeKnown(text.slice(s, b), true)) break;
          continue;
        }
        // German geht's, wie's: the 's is es.
        const after = rest.slice(head.length);
        if (this.lang.apostropheSuffixes && this.lang.apostropheSuffixes[after.toLowerCase()] !== undefined) {
          out.push(tok(s, s + head.length - 1));
          out.push(tok(s + head.length - 1, b));
          return out;
        }
        break;
      }
    }
    if (s >= b) return out;
    const rest = text.slice(s, b);
    if (!/[-‐]/.test(rest) || this.wholeKnown(rest)) {
      out.push(tok(s, b));
      return out;
    }
    // Hyphens: a verb and its pronouns (dit-il, a-t-il, dá-me, dar-te-ei) or a German compound stay one word;
    // anything else is its words with the hyphens between them.
    const pieces = rest.split(/([-‐])/);
    const words = pieces.filter((_, k) => k % 2 === 0);
    const cliticTail = words.length > 1 && words.slice(1).every((w) => this.hyphenClitics.has(this.fold(w).toLowerCase().replace(/['’]$/, "'")));
    if (cliticTail || this.lang.compounds) {
      out.push(tok(s, b));
      return out;
    }
    let at = s;
    for (const p of pieces) {
      if (!p) continue;
      if (p === '-' || p === '‐') out.push({ text: p, start: at, end: at + 1, kind: 'punct', inDict: false });
      else out.push(tok(at, at + p.length));
      at += p.length;
    }
    return out;
  }

  private isAbbreviation(word: string): boolean {
    if (!this.wholeKnown(word + '.')) return false;
    const bare = this.candidates(word, false);
    return !bare.length || word.length === 1 || this.rankOf(bare[0].e) > 5000;
  }

  /**
   * Whether a run with apostrophes or hyphens is one dictionary word (aujourd'hui, peut-être). With `lexical`, a word
   * Wiktionary lists only as a contraction (qu'on "que + on", n'est) does not count: it is cut into its words.
   */
  private wholeKnown(word: string, lexical = false): boolean {
    const out: Cand[] = [];
    this.data.match(this.fold(word), out, 0);
    if (!out.length && this.lang.keepCase) this.data.match(lowerFirst(this.fold(word)), out, 0);
    // qu'il is listed as a form of que ("contraction of que + il"), not as a word: it counts as a contraction too.
    // Nor is a surname that happens to be spelled so (Dell'Anno) a reason to keep dell'anno whole.
    if (lexical) {
      return out.some((c) => this.data.pos[c.e] !== 'contraction' && !(c.desc >= 0 && /^contraction\b/i.test(this.data.descs[c.desc]))
        && !(this.data.pos[c.e] === 'proper noun' && this.data.head[c.e] !== word));
    }
    return out.length > 0;
  }

  /**
   * The second pass over a paragraph's words: what is cheap to tell from the neighbors. A word after an article is a
   * noun (el vino "the wine", not vino "came"); after a preposition a noun or an infinitive (de lanza); after a pronoun a
   * verb (se casa "marries"); la, les, l' are the article before a noun and the pronoun before a verb; a reflexive
   * pronoun before a verb or on it picks the verb's reflexive sense (se acuerda "remembers").
   */
  private useContext(words: { t: Token; a: Analysis; at: number }[], tokens: Token[]): void {
    const d = this.data;
    const firstPos = (w: { a: Analysis }): string => (w.a.cands.length ? d.pos[w.a.cands[0].e] : '');
    const adjacent = (x: { at: number }, y: { at: number }): boolean => {
      // Only space between them: a comma or a full stop ends the reach of a word over the next.
      for (let k = x.at + 1; k < y.at; k++) if (tokens[k].kind !== 'space') return false;
      return true;
    };
    const nonFinite = (c: Cand): boolean => c.desc < 0 || /\b(?:infinitive|gerund)\b/.test(d.descs[c.desc]);
    const participle = (c: Cand): boolean => d.pos[c.e] === 'verb' && c.desc >= 0 && /\bparticiple\b/.test(d.descs[c.desc]);
    const genders = this.lang.genderBefore ?? {};
    const auxiliaries = new Set(this.lang.auxiliaries ?? []);
    // Object and reflexive pronouns come only before a verb (me acuerdo, se casa): after one, the verb reading wins however
    // much likelier the noun is alone.
    const clitics = new Set([...(this.lang.reflexive?.always ?? []), ...(this.lang.reflexive?.ifPronominal ?? [])]);
    const negParticles = new Set(this.lang.negation?.particles ?? []);
    const negWords = new Set(this.lang.negation?.words ?? []);
    /** A negation particle within the three words before word k, in the same clause (ne … point, n'avoir point). */
    const negated = (k: number): boolean => {
      for (let j = k - 1; j >= Math.max(0, k - 4) && adjacent(words[j], words[j + 1]); j--) {
        if (negParticles.has(this.fold(words[j].t.text).toLowerCase())) return true;
      }
      return false;
    };
    /** The word before is an article or determiner as read (un, la, cette), not merely spelled like one. */
    const determinerBefore = (prev: { t: Token } | undefined, prevKey: string): boolean => {
      if (!prev) return false;
      const c = this.chosen.get(prev.t)?.c;
      return (!!c && ['article', 'determiner'].includes(d.pos[c.e])) || !!(this.lang.genderBefore ?? {})[prevKey];
    };
    for (let k = 0; k < words.length; k++) {
      const w = words[k];
      const cands = w.a.cands;
      let choice: Cand | undefined = cands[0];
      const prev = k > 0 && adjacent(words[k - 1], w) ? words[k - 1] : undefined;
      const next = k + 1 < words.length && adjacent(w, words[k + 1]) ? words[k + 1] : undefined;
      const prevKey = prev ? this.fold(prev.t.text).toLowerCase() : '';
      if (cands.length > 1) {
        const posSet = new Set(cands.map((c) => d.pos[c.e]));
        const nounish = [...posSet].some((p) => NOUNISH.has(p));
        let want: ((c: Cand) => boolean) | null = null;
        // How far below the likeliest reading the neighbors may reach: a weak cue (Quel before est) moves a word only
        // between near readings; a decisive one (l' before a verb, me before acuerdo) moves it however far.
        let margin = CONTEXT_MARGIN;
        if (negWords.has(this.fold(w.t.text).toLowerCase()) && negated(k)) {
          // si fâchés de n'avoir point d'enfants: point is "not", however common the noun and poindre's forms are.
          want = (c) => d.pos[c.e] !== 'verb' && d.pos[c.e] !== 'noun';
          margin = Infinity;
        } else if (prev && auxiliaries.has(prev.t.key ?? '') && cands.some(participle)) {
          // había partido "had split", however common partido "party" is.
          want = participle;
          margin = Infinity;
        } else if (this.articleOrPronoun.has(this.fold(w.t.text).toLowerCase()) && next) {
          const nextVerb = firstPos(next) === 'verb';
          if (this.noArticleBefore.has(this.fold(next.t.text).toLowerCase()) && cands.some((c) => d.pos[c.e] === 'preposition')) {
            want = (c) => d.pos[c.e] === 'preposition';
          } else {
            want = nextVerb ? (c) => d.pos[c.e] === 'pronoun' : (c) => ['article', 'determiner', 'contraction'].includes(d.pos[c.e]);
          }
          margin = Infinity;
        } else if (prev && (this.beforeNoun.has(prevKey) || this.articleOrPronoun.has(prevKey)) && nounish && posSet.has('verb')) {
          // After an article (or la, which is one before a noun): anything but a verb.
          want = (c) => d.pos[c.e] !== 'verb';
        } else if (determinerBefore(prev, prevKey) && nounish && d.pos[cands[0].e] === 'adverb') {
          // un beau baptême: after a determiner, beau the adjective, not the adverb of avoir beau "in vain" (le plus, un
          // peu keep their adverb: the noun plus or peu is too unlikely to come within the margin).
          want = (c) => NOUNISH.has(d.pos[c.e]);
        } else if (prev && this.prepositions.has(prevKey) && posSet.has('verb') && posSet.size > 1) {
          // After a preposition: anything but a conjugated verb (de una cuchillada, para comer).
          want = (c) => d.pos[c.e] !== 'verb' || nonFinite(c);
        } else if (prev && this.beforeVerb.has(prevKey) && posSet.has('verb')) {
          want = (c) => d.pos[c.e] === 'verb';
          if (clitics.has(prevKey)) margin = Infinity;
        } else if (this.lang.keepCase && posSet.has('determiner') && posSet.has('verb')) {
          // German sein: "his" before a noun or adjective, "to be" otherwise (er muss da sein.).
          const nextNoun = !!next && (isUpper(next.t.text[0]) || NOUNISH.has(firstPos(next)));
          want = nextNoun ? (c) => d.pos[c.e] === 'determiner' || d.pos[c.e] === 'pronoun' : (c) => d.pos[c.e] === 'verb';
        }
        if (!want && prev && genders[prevKey] && cands.filter((c) => d.pos[c.e] === 'noun' && d.gender[c.e]).length > 1) {
          want = (c) => NOUNISH.has(d.pos[c.e]);
        }
        if (want) {
          let fits = cands.filter(want);
          // The article's gender picks among nouns spelled alike: el cura (priest), la cura (cure).
          const g = prev ? genders[prevKey] : undefined;
          if (g && fits.some((c) => d.gender[c.e])) {
            const agree = fits.filter((c) => d.gender[c.e] && d.gender[c.e].includes(g));
            if (agree.length) fits = [...agree, ...fits.filter((c) => !agree.includes(c))];
          }
          // A noun over an adjective spelled the same after an article (un hidalgo), when it is nearly as likely.
          fits = fits.filter((c) => c.score! > cands[0].score! - margin);
          const noun = fits.find((c) => d.pos[c.e] === 'noun');
          // Not before a noun: un beau baptême is a fine baptism, not a boyfriend's.
          const afterArticle = (this.beforeNoun.has(prevKey) || this.articleOrPronoun.has(prevKey)) && !(next && firstPos(next) === 'noun');
          choice = noun && fits[0] && d.pos[fits[0].e] === 'adjective' && afterArticle && noun.score! > fits[0].score! - 3
            ? noun : fits[0] ?? cands[0];
        }
      }
      if (choice && choice !== cands[0]) {
        w.t.key = d.key[choice.e];
        w.t.lemma = w.a.prefix ? w.a.prefix + d.head[choice.e].toLowerCase() : d.head[choice.e];
        if (w.a.prefix) w.t.key = this.fold(w.t.lemma);
      }
      if (this.lang.stress && choice) {
        const st = this.stressOf(w.t.text, choice, w.a);
        if (st !== undefined) w.t.stress = st;
      }
      const reflexive = !!choice && this.isReflexive(choice, w.a, prevKey);
      this.chosen.set(w.t, { a: w.a, c: choice, reflexive });
    }
  }

  /** Whether a verb is read with its reflexive sense: a reflexive pronoun before it or joined to it, or the form says so. */
  private isReflexive(c: Cand, a: Analysis, prevKey: string): boolean {
    const d = this.data;
    if (d.pos[c.e] !== 'verb' || !d.rhint[c.e]) return false;
    if (c.desc >= 0 && /\breflexive\b/.test(d.descs[c.desc])) return true;
    const r = this.lang.reflexive;
    if (!r) return false;
    const joined = !!a.parts && a.parts.length > 1;
    const pronoun = joined ? this.fold(a.parts![1].text).toLowerCase() : prevKey;
    // An imperative is reflexive only with its own person's pronoun: siéntate (sit down), but dame (give me).
    const desc = c.desc >= 0 ? d.descs[c.desc] : '';
    if (joined && /\bimperative\b/.test(desc)) {
      const person = r.imperative?.[pronoun];
      return !!person && new RegExp(person).test(desc);
    }
    if (r.always.includes(pronoun)) return true;
    return d.pronominal[c.e] && r.ifPronominal.includes(pronoun);
  }

  /** Russian: the UTF-16 offset of the stressed vowel in `text`, when known and needed. */
  private stressOf(text: string, c: Cand, a: Analysis): number | undefined {
    if (/[ёЁ́]/.test(text) || a.parts) return undefined;
    if (vowels(text) < 2) return undefined;
    if (text.length !== text.normalize('NFC').length) return undefined;
    let at = c.stress;
    if (c.desc < 0) at = stressIndex(this.data.reading[c.e]);
    if (at < 0 || at >= text.length) return undefined;
    // Other readings of the same spelling with another stress (до́ма "at home", дома́ "houses") leave it unknown,
    // unless the reading chosen is clearly the likelier one.
    for (const o of a.cands) {
      if (o === c) continue;
      const os = o.desc < 0 ? stressIndex(this.data.reading[o.e]) : o.stress;
      if (os >= 0 && os !== at && (o.score ?? -99) > (c.score ?? 0) - 1.5 && this.data.key[o.e] === this.data.key[c.e]) return undefined;
    }
    return /[аеиоуыэюяАЕИОУЫЭЮЯ]/.test(text[at]) ? at : undefined;
  }

  // ---- looking up

  lookup(surface: string, ctx?: { token?: Token; sentence?: string }): WordLookup {
    const d = this.data;
    let a: Analysis;
    let chosen: Cand | undefined;
    let reflexive = false;
    const known = ctx?.token ? this.chosen.get(ctx.token) : undefined;
    if (known && ctx?.token?.text === surface) {
      ({ a, c: chosen, reflexive } = known);
    } else if (ctx?.sentence && ctx.sentence.includes(surface)) {
      const tok = this.segment(ctx.sentence).find((t) => t.text === surface && t.kind === 'word');
      const k = tok ? this.chosen.get(tok) : undefined;
      a = k?.a ?? this.analyze(surface);
      chosen = k ? k.c : a.cands[0];
      reflexive = k?.reflexive ?? false;
    } else {
      const lead = this.splitLeadingElision(surface);
      if (lead) return lead;
      a = this.analyze(surface, false);
      chosen = a.cands[0];
      reflexive = !!chosen && this.isReflexive(chosen, a, '');
    }
    const order = chosen ? [chosen, ...a.cands.filter((c) => c !== chosen)] : a.cands;
    const entries = this.entriesFor(order, reflexive);
    const out: WordLookup = { surface, key: a.key, entries };
    if (chosen) out.key = a.prefix ? this.fold(a.prefix + d.head[chosen.e].toLowerCase()) : d.key[chosen.e];
    const first = order[0];
    if (first && first.desc >= 0 && d.descs[first.desc]) out.form = d.descs[first.desc];
    else if (first && d.pos[first.e] === 'contraction') {
      const con = /^contraction of (.+)$/.exec(this.notesOf(first.e)[0] ?? '');
      if (con) out.parts = con[1].split(/\s*\+\s*|\s+/).map((p) => this.part(p));
    }
    if (a.parts) out.parts = a.parts;
    if (a.name || (!entries.length && isUpper(surface[0] ?? ''))) out.name = true;
    return out;
  }

  /** "l'homme" looked up as one surface: the word after the elision, with both as parts. */
  private splitLeadingElision(surface: string): WordLookup | null {
    const m = /^([^'’ʼ]+['’ʼ])(.+)$/.exec(surface);
    if (!m || !this.elisions.has(this.fold(m[1]).toLowerCase()) || this.wholeKnown(surface)) return null;
    const inner = this.lookup(m[2]);
    return { ...inner, surface, parts: [this.part(m[1]), ...(inner.parts ?? [this.part(m[2])])] };
  }

  private notesOf(e: number): string[] {
    const s = this.data.senses[e];
    return s.startsWith('{') ? s.slice(1, s.indexOf('}')).split(', ') : [];
  }

  /**
   * Entries for the candidates in order, the sections of one key merged into one entry (the leading section's senses
   * first). `reflexive`: the first entry's reflexive senses lead (acordarse "to remember" before acordar "to agree").
   */
  private entriesFor(order: Cand[], reflexive = false): SpacedEntry[] {
    const d = this.data;
    const byKey = new Map<string, SpacedEntry>();
    const out: SpacedEntry[] = [];
    for (const c of order) {
      const key = d.key[c.e];
      let senses = d.parseSenses(c.e);
      if (!senses.length) continue;
      if (reflexive && !out.length) {
        const own = (s: Sense): boolean => !!s.notes?.some((n) => /^(?:reflexive|pronominal)/.test(n));
        senses = [...senses.filter(own), ...senses.filter((s) => !own(s))];
      }
      let entry = byKey.get(key);
      if (!entry) {
        entry = { head: d.head[c.e], senses: [], source: 'Wiktionary' };
        if (d.reading[c.e]) entry.reading = d.reading[c.e];
        const level = levelOfRank(d.rank[c.e]);
        if (level) entry.level = level;
        if (d.rank[c.e] && d.rank[c.e] <= COMMON_RANK) entry.common = true;
        if (c.desc >= 0 && d.descs[c.desc]) entry.form = d.descs[c.desc];
        // Gender belongs to the noun: la the article is not masculine because la the note is.
        if (d.gender[c.e] && (d.pos[c.e] === 'noun' || d.pos[c.e] === 'proper noun')) entry.gender = d.gender[c.e];
        byKey.set(key, entry);
        out.push(entry);
      }
      // The leading section keeps its senses; each other section adds up to four, to twelve in all.
      const room = Math.min(entry.senses.length ? 4 : 8, 12 - entry.senses.length);
      entry.senses.push(...senses.slice(0, Math.max(0, room)));
    }
    return out.filter((e) => e.senses.length);
  }

  normalize(word: string): string {
    const w = word.trim();
    if (!w) return '';
    const a = this.analyze(w, false);
    if (a.cands.length) return a.prefix ? a.key : this.data.key[a.cands[0].e];
    return a.key;
  }

  level(key: string): number | undefined {
    return levelOfRank(this.data.rankOfKey.get(key));
  }

  levelWords(max: number): string[] {
    const cut = LEVEL_CUTOFFS[Math.min(Math.max(max, 1), LEVEL_CUTOFFS.length) - 1];
    const out: string[] = [];
    for (const k of this.data.ranked) {
      if (this.data.rankOfKey.get(k)! > cut) break;
      out.push(k);
    }
    return out;
  }

  hint(token: Token): string | undefined {
    if (token.kind !== 'word') return undefined;
    const d = this.data;
    const known = this.chosen.get(token);
    const a = known?.a ?? this.analyze(token.text, false);
    const c = known ? known.c : a.cands[0];
    if (!c || token.name || (a.name && d.pos[c.e] === 'proper noun')) return undefined;
    const own = d.formHints.get(this.fold(token.text).toLowerCase());
    if (own && c.desc >= 0) return own;
    if (a.prefix && a.parts && a.parts.length > 1) {
      const glosses = a.parts.map((p) => p.gloss).filter(Boolean) as string[];
      const joined = glosses.join(' ');
      if (glosses.length === a.parts.length && joined.split(' ').length <= 4) return joined;
    }
    const reflexive = known ? known.reflexive : this.isReflexive(c, a, '');
    if (reflexive && d.rhint[c.e]) return d.rhint[c.e];
    if (d.hint[c.e]) return d.hint[c.e];
    const other = a.cands.find((o) => d.hint[o.e]);
    return other ? d.hint[other.e] : undefined;
  }
}

// ------------------------------------------------------------------------------------------- characters ---

const LETTER = 1;
const DIGIT = 2;
const SPACE = 3;
const PUNCT = 4;
const FOREIGN = 5;
const OTHER = 6;

/** Character classes for one script: letters of the language, letters of another script, digits, space, marks. */
class CharClasses {
  private cache = new Map<number, number>();
  private ownScript: RegExp;
  private latin: boolean;

  constructor(script: SpacedLang['script']) {
    this.latin = script === 'latin';
    this.ownScript = script === 'cyrillic' ? /\p{Script=Cyrillic}/u : /\p{Script=Latin}/u;
  }

  of(code: number, text: string, i: number): number {
    if (code < 128) {
      if ((code >= 97 && code <= 122) || (code >= 65 && code <= 90)) return this.latin ? LETTER : FOREIGN;
      if (code >= 48 && code <= 57) return DIGIT;
      if (code === 32 || (code >= 9 && code <= 13)) return SPACE;
      if (code < 32 || code === 127) return OTHER;
      return PUNCT;
    }
    const hit = this.cache.get(code);
    if (hit) return hit;
    const ch = code >= 0xd800 && code <= 0xdbff ? text.slice(i, i + 2) : text[i];
    let c: number;
    if (/^\s$/u.test(ch)) c = SPACE;
    else if (/^\p{Nd}$/u.test(ch)) c = DIGIT;
    else if (/^\p{L}$/u.test(ch)) c = this.ownScript.test(ch) ? LETTER : FOREIGN;
    else if (/^\p{M}$/u.test(ch)) c = LETTER;
    else if (/^[\p{P}\p{S}]$/u.test(ch)) c = PUNCT;
    else c = OTHER;
    if (this.cache.size < 4000) this.cache.set(code, c);
    return c;
  }
}

const RU_VOWEL = /[аеёиоуыэюя]/i;
function vowels(s: string): number {
  let n = 0;
  for (const ch of s) if (RU_VOWEL.test(ch)) n++;
  return n;
}

/** The index of the stressed vowel in the folded word of a stress-marked spelling (сказа́ть -> 4), -1 when unmarked. */
export function stressIndex(written: string): number {
  if (!written) return -1;
  let n = 0;
  let acute = -1;
  let yo = -1;
  for (const ch of written.toLowerCase().normalize('NFD')) {
    if (ch === '́') { if (n && acute < 0) acute = n - 1; }
    else if (ch === '̈') { if (n && yo < 0) yo = n - 1; }
    else if (ch !== '̀') n++;
  }
  return acute >= 0 ? acute : yo;
}

// --------------------------------------------------------------------------------------------------- loading ---

/** Loads the data of a spaced language and returns its engine. Each language module calls this with its rules. */
export async function loadSpacedEngine(lang: SpacedLang, baseUrl: string, opts?: LoadOpts): Promise<LangEngine> {
  const base = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
  const get = opts?.fetchBytes ?? ((name: string) => fetchBytes(base + name));
  let done = 0;
  const report = (to: number): void => {
    const v = Math.min(100, Math.round(to));
    if (v > done) { done = v; opts?.onProgress?.(done, 100); }
  };
  opts?.onProgress?.(0, 100);
  const entriesP = get('entries.tsv.gz').then(gunzip);
  const formsP = get('forms.tsv.gz').then(gunzip);
  const metaP = get('meta.json').then((b) => new TextDecoder().decode(b)).catch(() => '{}');
  const priorP = get('prior.tsv.gz').then(gunzip).catch(() => '');
  for (const p of [entriesP, formsP]) p.catch(() => {});
  const data = new Data();
  data.parseForms(await formsP);
  report(25);
  await yieldToEventLoop();
  await data.parseEntries(await entriesP, (f) => report(25 + f * 70));
  data.parsePrior(await priorP);
  const engine = new SpacedEngine(lang, data);
  try {
    const m = JSON.parse(await metaP) as Partial<LangEngine['meta']>;
    engine.meta = { built: m.built ?? '', counts: m.counts ?? {}, sources: m.sources ?? [] };
  } catch { /* the engine works without its credits */ }
  report(100);
  return engine;
}
