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
import { CONTEXT_MARGIN, type ContextChoice, type ContextQuery, type ContextReading, type ContextRule, type ContextWord } from './context';

export type { ContextChoice, ContextQuery, ContextReading, ContextRule, ContextWord } from './context';

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
  /**
   * Which reading a clitic joined to a verb has on the card, when the language can tell (Italian ci and vi are "there" with
   * andare or venire: "Tu, Renzo, procura di venirci", I promessi sposi). Left out, a clitic is the pronoun.
   */
  cliticPart?: (verbKey: string, clitic: string) => 'pronoun' | 'adverb';
  /**
   * The book leaves accents off nouns that are spelled like a verb form without them (Machado's silencio, medico, musica,
   * pagina are silêncio, médico, música, página, not silenciar's, medicar's …): the accented noun or adjective is a reading
   * too, below the verb, for the context rules to choose after an article or a possessive.
   */
  looseAccents?: boolean;
  /**
   * Spellings to try, in order, for a word nothing else reads: the book's older orthography (Italian bujo for buio,
   * picchiar for picchiare; Portuguese cabellos for cabelos).
   */
  respell?: (folded: string) => string[];
  /** Undo the spelling a verb takes in front of enclitics: candidate stems for `stem` before clitic `first`. */
  encliticStems?: (stem: string, first: string) => string[];
  /** Words that can follow a verb after a hyphen (French dit-il, a-t-il; Portuguese dá-me, dar-te-ei). */
  hyphenClitics?: string[];
  /**
   * Of those, the subject pronouns of an inversion (French), and the person each says: "Que vois-je là !" (Le Horla) is
   * voir's first-person singular, not the imperative "see!". Those that also follow an imperative as its object (nous, vous,
   * the keys of `reflexive.imperative`) make an inversion only in a question or after a word of the clause, not after one
   * of `coordinators` or an interjection: "— Mais dépêchez-vous, mère Rolet!" (Madame Bovary) is an order, "Mais que
   * voulez-vous, c'est le maire" an inversion. Left out, a hyphened pronoun is the verb's object (Portuguese "diga-me",
   * Russian "Подойди-ка"), and an imperative stays one.
   */
  hyphenSubjects?: Record<string, string>;
  /** Coordinating conjunctions, after which a clause starts afresh and an order may come: mais, et, donc. */
  coordinators?: string[];
  /**
   * Of those, the ones that follow a noun as well (French là, ci): after them alone the word is not only a verb. Bovary's "ce
   * soir-là" is the evening, not seoir's soir "to suit"; "ce monde-là" the world.
   */
  hyphenParticles?: string[];
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
  reflexive?: {
    always: string[];
    ifPronominal: string[];
    /** Pronoun -> the form descriptions of the imperatives it is the reflexive of (siéntate, Levez-vous). */
    imperative?: Record<string, string>;
    /**
     * A verb's pronominal infinitive, as the dictionary spells phrases that start with it (dar -> darse, fare -> farsi), so a
     * reflexive pronoun and a finite verb find them: "se daba cuenta" is darse cuenta "to realize".
     */
    infinitive?: (key: string) => string;
    /**
     * The person each reflexive pronoun says, for a pronoun before a verb to be the verb's own only where the verb's form
     * has that person: "me doy cuenta" is darse cuenta, but "me dan a entender" (Marianela) is dar "they give me to
     * understand" and "Mi lascino andare" (I promessi sposi) lasciare "let me go". 'third-person' takes any number.
     */
    persons?: Record<string, string>;
    /**
     * Pronouns that make an infinitive or gerund they are joined to reflexive, whatever the verb's usual use: no pudo
     * levantarse "could not get up", yéndose al campo. Spanish se before a finite verb may be impersonal (se dice) or stand for
     * le (se lo dio); joined to an infinitive alone it is the verb's own.
     */
    joined?: string[];
  };
  /** Articles and determiners that say a noun's gender (el cura "the priest", la cura "the cure"). */
  genderBefore?: Record<string, 'm' | 'f'>;
  /** Auxiliary verbs (keys): after one, a word that can be a past participle is one (había partido "had split"). */
  auxiliaries?: string[];
  /**
   * Two-part negation: after a particle (French ne, n') a few words on, these words are the negation, not their
   * look-alikes (n'avoir point "not to have", not poindre "to dawn"; ne vois personne "see nobody", not "person").
   */
  negation?: { particles: string[]; words: string[] };
  /**
   * The language's own context rules, asked about each word the dictionary has before the generic rules (context.ts):
   * French en after s' is the pronoun; Russian да before a comma is "yes". An answer replaces the generic rules for that word.
   */
  context?: ContextRule;
  /**
   * German separable verbs: a finite verb and one of these particles at the end of its clause are one verb (fängt … an is
   * anfangen "to begin", stehe … auf is aufstehen), when the dictionary has particle + verb.
   */
  separable?: {
    particles: string[];
    /** Conjunctions that start a new clause right after a particle (er stand auf und ging). */
    coordinators?: string[];
  };
  /**
   * Capitals the printers of the time left without their accent, as printed at a sentence start -> the accented word:
   * Candide's "A peine ont-ils mis le pied dans la ville" is à, "O ciel !" ô; Quiroga's "El creía que..." is él. The accented
   * word's readings follow the capital's own, below them, for the language's rules to choose.
   */
  capitalAccent?: Record<string, string>;
  /**
   * Courtesy titles, folded lower-case: capitalized in mid-sentence for courtesy, not names ("et engagea Madame, en attendant,
   * à prendre connaissance", Madame Bovary), and the capitalized word right after one is a name unless the dictionary has it
   * as a common word: "»Ja, ja, ja!« rief Meister Böck" (Max und Moritz), "Witwe Bolte".
   */
  titles?: string[];
  /**
   * Marks after which a word starts a sentence as after a full stop: opening quotes, ¿ ¡, the dialogue dash (« Rassurez-vous,
   * —Platero). Default «“„¿¡—; German opens with » and „, and Russian writes — between subject and predicate.
   */
  sentenceOpeners?: string;
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
  /** The usage notes of an entry's first sense, parsed when a word needs them. */
  notes = new Map<number, string[]>();
  /** Russian verbs: entry -> aspect and the verbs of the other aspect (взять: perfective, брать). */
  aspect = new Map<number, { aspect: 'pf' | 'impf' | 'both'; partners: string[] }>();
  /** form -> "entry:percent ..." and the treebank count, for words the dictionary reads several ways. */
  prior = new Map<string, string>();
  senses: string[] = [];
  byKey = new Map<string, number[]>();
  rankOfKey = new Map<string, number>();
  /** Keys by rank, for levelWords. */
  ranked: string[] = [];
  /** Fixed phrases (sin embargo, потому что) by their folded words joined with spaces. */
  phrases = new Map<string, Phrase>();
  /** First word of a phrase -> the most words a phrase starting with it has. */
  phraseLen = new Map<string, number>();

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
      } else if (kind === 65 /* A */) {
        // A <entry> <pf|impf|both> <partners, comma-separated>: взять "pf" брать.
        const [e, aspect, partners] = text.slice(pos + 2, nl).split('\t');
        if (aspect === 'pf' || aspect === 'impf' || aspect === 'both') this.aspect.set(+e, { aspect, partners: partners ? partners.split(',') : [] });
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
   * phrases.tsv.gz (optional): `<words folded lower-case, space-separated>\t<hint>\t<sense>\t<sense>...`, one phrase a line,
   * the words cut as segment() cuts them (c' est à dire); senses as in entries.tsv.gz ({notes}gloss|gloss). Words that start
   * with = make a phrase found only as spelled (Phrase.spelled): `=passer la main`.
   */
  parsePhrases(text: string): void {
    for (const line of text.split('\n')) {
      if (!line || line.charCodeAt(0) === 35 /* # */) continue;
      const cols = line.split('\t');
      const spelled = cols[0].startsWith('=');
      const words = (spelled ? cols[0].slice(1) : cols[0]).trim().split(/ +/);
      if (words.length < 2 || words.length > MAX_PHRASE) continue;
      const key = words.join(' ');
      this.phrases.set(key, { key, hint: cols[1] ?? '', senses: cols.slice(2).join('\t'), ...(spelled ? { spelled } : {}) });
      if ((this.phraseLen.get(words[0]) ?? 0) < words.length) this.phraseLen.set(words[0], words.length);
    }
  }

  /** Senses of a phrase or entry from their stored text. */
  sensesOf(text: string, pos?: string): Sense[] {
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
      const sense: Sense = { pos: pos || undefined, glosses };
      if (notes?.length) sense.notes = notes;
      out.push(sense);
    }
    return out;
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
    return this.sensesOf(this.senses[e], this.pos[e]);
  }

  private plain?: Map<string, string[]>;
  /** Keys with accents by their spelling without them (seminário under seminario), built the first time a word needs it. */
  plainKeys(): Map<string, string[]> {
    if (this.plain) return this.plain;
    const m = new Map<string, string[]>();
    for (const key of this.byKey.keys()) {
      if (!NON_ASCII.test(key)) continue;
      const p = stripAccents(key);
      if (p === key) continue;
      const list = m.get(p);
      if (list) list.push(key); else m.set(p, [key]);
    }
    this.plain = m;
    return m;
  }

  /**
   * The entry's first sense belongs to some speakers or places: {colloquial, Ecuador, Peru, Bolivia} naranjas "nothing",
   * {Tuscany} punto "nothing", {archaic or dialectal} li. Grammar notes and the labels of old or spoken words do not count:
   * {before a noun} mi "my"; коли "if" {colloquial} is the old books' word.
   */
  marked(e: number): boolean {
    const s = this.senses[e];
    if (s.charCodeAt(0) !== 123 /* { */) return false;
    return s.slice(1, s.indexOf('}')).split(', ').some((n) => USAGE_LABEL.test(n) || /^\p{Lu}/u.test(n));
  }
}

interface Prior { p: Map<number, number>; weight: number }

/**
 * Labels that say a sense belongs to some speakers, places or trades only (a capitalized label names a place): the Andean
 * naranjas "nothing", puissance "to the power of" {mathematics}, san "his" {gender-neutral, neologism}.
 */
const USAGE_LABEL = /\b(?:slang|vulgar|regional|dialectal|dialect|nonstandard|proscribed|neologism|gender-neutral|text messaging|mathematics|arithmetic|law|officialese|computing|music)\b/;

/** Usage notes that move a sense away from a word's plain meaning, so it cannot stand for the word in a compound's hint. */
const SHIFTING_NOTE = /\b(?:card|heraldry|dated|obsolete|archaic|offensive|derogatory|slang|vulgar|figurative|in compounds|music|military|law|computing|Internet|sports?|chess|nautical|hunting|mining)\b/;

/** Phrases have at most this many words. */
const MAX_PHRASE = 4;

/**
 * A fixed phrase from phrases.tsv.gz. `spelled`: found only as the book spells its words (or with its verb's infinitive),
 * not through another form of the verb: the builder marks the phrases books have as often word for word ("passer la main"
 * is "to step down", but "Il se passa la main sur le visage", Madame Bovary).
 */
interface Phrase { key: string; hint: string; senses: string; spelled?: boolean }

/**
 * One way a word on the page can be read: an entry, and the form it is of that entry (desc -1: the headword itself).
 * `closed`: the part of the score that is a function word's bonus for being spelled as its own entry, which an article or
 * preposition before the word takes away again.
 */
interface Cand {
  e: number; desc: number; stress: number; penalty: number; score?: number; closed?: number;
  /** A reading of the word with an accent its capital lacks (capitalAccent): on the card only when chosen. */
  accent?: boolean;
  /** The reading as a context rule sees it, made the first time a rule asks (the candidate is cached with its word). */
  view?: ContextReading;
}

/** A piece of a word on the card; `pos`, the part of speech it was read as, stays inside the engine. */
interface Part { text: string; key?: string; gloss?: string; pos?: string }

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
/** Russian: how far below its entry's first stress a form with another stress spelled alike starts (сло́ва after слова́). */
const ALT_STRESS = 2;
/** German: how far a reading with its umlaut taken off starts below one spelled as on the page (Stühl is Stuhl). */
const STRIPPED = 2.25;
/** Nats a word gains for being spelled exactly like the headword it is read as. */
const EXACT_BONUS = 1;
const CLOSED_EXACT_BONUS = 3;
/** Readings an article or determiner never comes before, when the word can be a noun or adjective (la personne, un or). */
const NOT_AFTER_ARTICLE = new Set(['pronoun', 'conjunction', 'preposition']);
/** Readings a preposition never comes before, when the word can be a noun or adjective (un étui d'or "gold", not or "yet"). */
const NOT_AFTER_PREPOSITION = new Set(['conjunction', 'preposition']);
/**
 * Function words read as themselves that an auxiliary's participle beats only when nearly as likely (lo había dicho; but avait
 * plus de, a tout). An adverb or conjunction never gives way (a bien, est si, aveva subito).
 */
const NOT_PARTICIPLE = new Set(['adverb', 'determiner', 'pronoun', 'conjunction', 'article']);
/**
 * The accents each language writes on a vowel, for restoring one a book leaves off (oir for oír, hundiose for hundió + se,
 * Machado's ceu for céu). German and Russian books do not drop theirs.
 */
const ACCENTS: Partial<Record<LangId, Record<string, string>>> = {
  es: { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'úü' },
  pt: { a: 'áâãà', e: 'éê', i: 'í', o: 'óôõ', u: 'úü' },
  it: { a: 'à', e: 'èé', i: 'ìí', o: 'òó', u: 'ùú' },
  fr: { a: 'àâ', e: 'éèê', i: 'îï', o: 'ô', u: 'ùûü' },
};
/** A vowel with an accent: a word with one already is not given another. */
const ACCENTED = /[áàâãäéèêëíìîïóòôõöúùûü]/;
/** Grave and acute accents, each to the other, for a book that writes the one where the dictionary has the other (sè, sé). */
const OTHER_ACCENT: Record<string, string> = { à: 'á', á: 'à', è: 'é', é: 'è', ì: 'í', í: 'ì', ò: 'ó', ó: 'ò', ù: 'ú', ú: 'ù' };

/** The word with one grave accent made acute, or the other way (ripetè -> ripeté), the last one first. */
function swapAccents(f: string): string[] {
  const out: string[] = [];
  for (let i = f.length - 1; i >= 0; i--) {
    const o = OTHER_ACCENT[f[i]];
    if (o) out.push(f.slice(0, i) + o + f.slice(i + 1));
  }
  return out;
}

/**
 * How much likelier (nats) a verb reading of the word after la, lo, l' must be than its best noun reading for la to be the
 * pronoun: la porta (door, or "carries her") is the door, lo so (sapere, or so "under") the verb.
 */
const ARTICLE_MARGIN = 2;
/** How many names seen in mid-sentence an engine keeps, to read the same word at the start of a sentence as the name. */
const MAX_NAMES = 5000;

/** What a language's rule is asked about a word (ContextQuery); the paragraph's earlier sentences are built only if it looks. */
class Query implements ContextQuery {
  private before?: ContextWord[];
  constructor(readonly words: ContextWord[], readonly at: number, readonly word: ContextWord, readonly prev: ContextWord | undefined,
    readonly next: ContextWord | undefined, readonly sentenceStart: boolean, readonly question: boolean,
    private readonly earlierWords: () => ContextWord[]) {}

  get earlier(): ContextWord[] {
    return (this.before ??= this.earlierWords());
  }
}

/** What segment() decided for a word in its sentence. */
interface Chosen {
  a: Analysis;
  c: Cand | undefined;
  reflexive: boolean;
  /** German separable verb: the joined verb's entry, the form the finite verb is of it (-1 for the particle), both pieces. */
  sep?: { e: number; desc: number; parts: Part[]; particle?: boolean };
  /** The fixed phrase the word is part of (sin embargo). */
  phrase?: Phrase;
  /** The hint the language's rule gave the word where it stands (que "than" after más). */
  hint?: string;
  /** The sense the card leads with when the hint starts none (hace frío: hacer's weather). */
  sense?: RegExp;
  /** The language's rule keeps the word out of fixed phrases here (le petit bois "the little wood"). */
  noPhrase?: boolean;
  /** A verb with its subject hyphened after it (vois-je, faites-vous): the subject pronoun of the inversion. */
  inverted?: string;
}

/** A word of a paragraph as segment() hands it to the context passes. */
interface Word {
  t: Token;
  a: Analysis;
  /** Its index in the paragraph's tokens. */
  at: number;
  /** It starts a sentence (or quoted speech), and which sentence of the paragraph it is in. */
  start: boolean;
  sent: number;
}

// ------------------------------------------------------------------------------------------------------- engine ---

export class SpacedEngine implements LangEngine {
  readonly id: LangId;
  meta: LangEngine['meta'] = { built: '', counts: {}, sources: [] };
  private cache = new Map<string, Analysis>();
  /** The reading segment() chose for a token in its sentence, for hint() and lookup() of that same token. */
  private chosen = new WeakMap<Token, Chosen>();
  /**
   * Capitalized words this book uses as names in mid-sentence, so the same word starting a sentence is the name too:
   * "Platero es pequeño, peludo, suave" is the donkey, not a silversmith. beginBook() starts it afresh.
   */
  private names = new Set<string>();
  /** Per contraction note, whether its second half is an article (findPhrases). */
  private articleEnds = new Map<string, boolean>();
  /** Per word with an elision, whether it is an elided pronoun and a verb the dictionary has whole as a noun (j'aime). */
  private elided = new Map<string, boolean>();
  private separable: Set<string>;
  private openers: string;
  private elisions: Set<string>;
  private hyphenClitics: Set<string>;
  private beforeNoun: Set<string>;
  private beforeVerb: Set<string>;
  private articleOrPronoun: Set<string>;
  private noArticleBefore: Set<string>;
  private prepositions: Set<string>;
  private enclitics: string[];
  private titles: Set<string>;
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
    this.titles = new Set(lang.titles ?? []);
    this.separable = new Set(lang.separable?.particles ?? []);
    this.openers = lang.sentenceOpeners ?? '«“„¿¡—';
  }

  /**
   * A new book: forget the names of the last one. Given the book's text, learn the words it capitalizes in mid-sentence
   * up front, so its first page reads a name that starts a sentence as the name before the name has come up in the middle
   * of one (Platero y yo opens with "Platero es pequeño").
   */
  beginBook(text?: string): void {
    this.names.clear();
    if (!text) return;
    const seen = new Set<string>();
    // A capital after a lower-case word or a comma is in mid-sentence.
    // German: a capital after a title is a name wherever the book has it (Max und Moritz's "Wußte Schneider Böck zu machen"
    // makes "Einen, der sich Böck benannte" Böck the tailor, not Bock "buck" with its umlaut taken off).
    if (this.lang.keepCase && this.titles.size) {
      for (const m of text.matchAll(/(\p{L}+)\s+(?=(\p{Lu}[\p{L}\p{M}]+))/gu)) {
        if (this.titles.has(m[1].toLowerCase()) && NON_ASCII.test(m[2]) && !this.candidates(m[2], true).some((c) => c.penalty < STRIPPED)) this.names.add(m[2]);
      }
    }
    for (const m of text.matchAll(/(?<=[\p{Ll},;] +)\p{Lu}[\p{L}\p{M}]+/gu)) {
      const w = m[0];
      if (seen.has(w)) continue;
      seen.add(w);
      if (seen.size > 4 * MAX_NAMES) break;
      if (this.isNameMidSentence(w)) this.rememberName(w);
    }
  }

  /** Whether segment() reads a capitalized word in mid-sentence as a name, and a name worth keeping for the book. */
  private isNameMidSentence(word: string): boolean {
    if ((word.length > 1 && word === word.toUpperCase()) || this.titles.has(this.fold(word).toLowerCase())) return false;
    const a = this.analyze(word, true);
    if (!a.name && a.cands.length && (this.lang.keepCase || this.functionWord(a.cands[0]))) return false;
    return this.bookName(a);
  }

  /**
   * A name the book's sentence starts read as a name too: one the dictionary lacks, has as a name, or knows only as a rare
   * word (Platero "silversmith", Golfín "dolphin", Choto "suckling goat"). Not a common word some line of verse or street
   * name capitalizes in mid-sentence ("La piccola mia lampa / Non, come sol, risplende", "le terre delle Due Riviere"):
   * every sentence that starts with Non or Due would lose its word.
   */
  private bookName(a: Analysis): boolean {
    const top = a.cands[0];
    return !top || this.data.pos[top.e] === 'proper noun' || this.rankOf(top.e) > COMMON_RANK;
  }

  /**
   * A common function word spelled as its own entry (Вы, Usted, Lei): capitalized in mid-sentence for courtesy, not a name.
   * Not a rare one: "depuis San Francisco" is the city, not san "his" (a neologism).
   */
  private functionWord(c: Cand): boolean {
    return c.desc < 0 && CLOSED.has(this.data.pos[c.e]) && this.rankOf(c.e) <= 1000;
  }

  private rememberName(word: string): void {
    if (this.names.has(word)) return;
    // Not a word whose lower case is a common function word or a common verb's form: Machado's "etc. Este calix" made the river
    // Este a name, and every sentence that started with Este lost its "this"; nor Era, Esta.
    // Spelled so, not respelled: Il Principe's "Messer Annibale" stays a name, though messer reads as Manzoni's metter.
    const low = this.analyze(lowerFirst(word), false).cands.filter((c) => c.penalty < 1);
    if (low.some((c) => (CLOSED.has(this.data.pos[c.e]) || (this.data.pos[c.e] === 'verb' && this.rankOf(c.e) <= 200)) && this.rankOf(c.e) <= COMMON_RANK)) return;
    if (this.names.size >= MAX_NAMES) this.names.delete(this.names.values().next().value!);
    this.names.add(word);
  }

  fold(s: string): string {
    return foldKey(this.lang, s);
  }

  // ---- matching

  private rankOf(e: number): number {
    return this.data.rank[e] || UNRANKED;
  }

  /**
   * `spelled`: the rank of the word spelled exactly as on the page, when the dictionary has it as a word of its own. A
   * contraction of another word with the next is no commoner than that spelling: "Vedo che ha la pelle molto dura"
   * (Pinocchio) is skin, not per's dated contraction pelle "for the", however common per is. (An old spelling keeps its
   * word's rank: the old books are where it is common, and Machado's quiz is querer, not the quiz.)
   */
  private score(c: Cand, capMid: boolean, word: string, prior: Prior | null, spelled = 0): number {
    const d = this.data;
    let rank = this.rankOf(c.e);
    if (spelled && c.desc >= 0 && rank < spelled && /^contraction\b/.test(d.descs[c.desc])) rank = spelled;
    let s = -Math.log(rank) - c.penalty - caseMisfit(d.head[c.e], word, !!this.lang.keepCase);
    // What hand-annotated text usually means by this spelling (fue: ser four times in five), trusted as far as the
    // treebanks saw the word often (they are news and web text; a novel's vino is as often "came" as "wine").
    if (prior) s += prior.weight * (prior.p.get(c.e) ?? prior.p.get(-1)!);
    const pos = d.pos[c.e];
    c.closed = 0;
    // A function word spelled exactly like its own entry is that word (moi, not je; muy, not mucho; au, not à), however
    // rare or old: "ora melones, ora uvas" (Lazarillo) is ora "now … now", not orar's "prays"; молча "silently", not
    // молчать's gerund; коли "if". An adverb counts as one only where it is the headword's leading section (muy, bien):
    // beau's adverb is the idiom avoir beau "in vain", and must not outbid beau the adjective. Not one some place or set of
    // speakers uses: the Andean naranjas "nothing" {colloquial, Ecuador} must not outbid the oranges of "las naranjas
    // mandarinas" (Platero y yo). Where the function word cannot stand, useContext takes the bonus back (`closed`).
    if (c.desc < 0) {
      const fn = CLOSED.has(pos) || (pos === 'adverb' && d.byKey.get(d.key[c.e])?.[0] === c.e);
      if (fn && d.rank[c.e] && !d.marked(c.e)) {
        s += CLOSED_EXACT_BONUS;
        c.closed = CLOSED_EXACT_BONUS - EXACT_BONUS;
      } else s += EXACT_BONUS;
    }
    // A capital in mid-sentence says name, except in German, which writes every noun so (das Essen is the meal, not the
    // city; sein Buch is a book).
    if (pos === 'proper noun') s += this.lang.keepCase ? -1 : capMid ? 3 : -4;
    else if (capMid && this.lang.id !== 'de' && c.desc < 0 && d.key[c.e] !== d.head[c.e] && isUpper(d.head[c.e][0])) s += 2;
    if (d.weak[c.e]) s -= 2.5;
    // Among the sections of one common key, the closed-class word leads (este "this" before este "east").
    if (CLOSED.has(pos) && this.rankOf(c.e) <= 3000) {
      s += 0.6;
      c.closed += 0.6;
    }
    if (pos === 'interjection') s -= 0.5;
    return s;
  }

  /**
   * Candidates for a word as written, best first, one per entry. `loose`: also a spelling the book has its own way, an
   * accent left off (oir, ceu) or an older orthography (bujo, cabellos); analyze() asks for those last, after the enclitic
   * split, which reads verte as ver + te before an added accent could make it verter's verté.
   */
  private candidates(word: string, capMid: boolean, loose = false): Cand[] {
    const d = this.data;
    const out: Cand[] = [];
    const f = this.fold(word);
    d.match(f, out, 0);
    if (this.lang.keepCase) {
      // German: a capital may only start the sentence (Essen, Das); a noun is never written in lower case.
      if (isUpper(f[0] ?? '')) {
        const low = lowerFirst(f);
        // In mid-sentence, a capital the dictionary has as a noun is that noun: "Nägel, Hammer und die nötigen Bretter"
        // (Immensee) are hammers, not haben's colloquial hammer; "Gott sei Dank", not dank "thanks to".
        const noun = capMid && out.some((c) => d.pos[c.e] === 'noun');
        if (low !== f) d.match(low, out, noun ? 6 : capMid ? 2 : 0.3);
        if (f.length > 1 && f === f.toUpperCase()) d.match(upperFirst(f.toLowerCase()), out, 0.5);
      }
    }
    if (!out.length && NON_ASCII.test(f)) {
      // The other accent on the same vowel: Collodi's sè, ripetè, purchè are sé, ripeté, purché (stripped, sè would be se
      // "if").
      for (const v of swapAccents(f)) {
        d.match(v, out, 0.5);
        if (out.length) break;
      }
    }
    if (!out.length && NON_ASCII.test(f)) {
      // Old spellings (fué, á, dió) and words typed without their accents. German's old umlauts too: "Er schlug die Stühl und
      // Vögel tot" (Struwwelpeter) are Stuhl, "versiegelte einige Päcke" (Werther) Pack, "die Kamerädin". A name after a title
      // is read as spelled (readWords): Meister Böck (Max und Moritz) is no Bock "buck".
      const plain = stripAccents(f);
      if (plain !== f && !this.lang.keepCase) d.match(plain, out, 2);
      else if (plain !== f) {
        // A common word only, not a name's look-alike: Effi Briest's Wüllersdorf and Kögel stay names, not Wullersdorf or
        // Kogel "a kind of hood".
        const found: Cand[] = [];
        d.match(plain, found, STRIPPED);
        out.push(...found.filter((c) => d.rank[c.e] > 0 && d.rank[c.e] <= 25000 && d.pos[c.e] !== 'proper noun'));
      }
    }
    if (this.lang.looseAccents && !NON_ASCII.test(f) && out.length && out.every((c) => c.desc >= 0 && d.pos[c.e] === 'verb')) {
      // Machado's silencio, medico, musica: the accented noun below the verb form (looseAccents).
      for (const key of d.plainKeys().get(f) ?? []) {
        const found: Cand[] = [];
        d.match(key, found, 1.5);
        out.push(...found.filter((c) => c.desc < 0 && ['noun', 'adjective'].includes(d.pos[c.e]) && d.rank[c.e] > 0));
      }
    }
    if (loose && !out.length) this.matchAccented(f, out, 2, isUpper(word[0] ?? ''));
    if (loose && !out.length && this.lang.respell) {
      // The book's older spelling: Collodi's bujo and picchiar for buio and picchiare, Machado's cabellos and visinho.
      // Every respelling, ranked together: Manzoni's man is mano, not mane "morning".
      for (const v of this.lang.respell(f)) if (v !== f) d.match(v, out, 1.5);
      // A vowel cut off with an apostrophe may have carried an accent, ranked with the others: Dante's "perch' i' fu'
      // ribellante" is perché, not perche, the plural of perca "perch".
      if (f.endsWith("'")) for (const v of this.lang.respell(f)) for (const a of this.accentVariants(v)) if (/[^\x00-\x7f]$/.test(a)) d.match(a, out, 2);
      if (!out.length) {
        for (const v of this.lang.respell(f)) {
          if (v !== f) this.matchAccented(v, out, 2.5, isUpper(word[0] ?? ''));
          if (out.length) break;
        }
      }
    }
    if (this.lang.keepCase && f.includes('ß')) {
      // German before 1996: muß, wußte for muss, wusste. Also where the old spelling reads as another word, so the context
      // rules can choose: "Muß man mit Vergnügen hören" (Max und Moritz) is müssen, not das Muss; "Laß uns eine Weile
      // ausruhen" (Immensee) lassen, not lass "weary"; "Floß ein Wasser mit Gebrause" has fließen beside the raft.
      // When the ß spelling reads already, the ss one is only a reading below it: "mit Fasten und Buße" (Siddhartha) is
      // penance, not Bus's Busse; "das Umschlossensein alles Großen" groß, not Gros; "in gleichem Maße" Maß, not Masse.
      // (Of the same word the ss spelling leads as before: Fluß is Fluss, gewiß the adverb gewiss.)
      const ss = f.replace(/ß/g, 'ss');
      const own = new Set(out.map((c) => d.key[c.e].toLowerCase()));
      const found: Cand[] = [];
      d.match(ss, found, 0.5);
      for (const c of found) if (own.size && !own.has(d.key[c.e].toLowerCase())) c.penalty += 2.5;
      // A capital at a sentence start keeps its verb: "»Muß nur mal wieder nach dir sehen;" (Effi Briest) is müssen.
      if (isUpper(f[0] ?? '')) d.match(lowerFirst(ss), found, 0.8);
      out.push(...found);
    }
    if (!out.length && this.lang.keepCase && !isUpper(f[0] ?? '')) {
      // heute abend for heute Abend.
      d.match(upperFirst(f), out, 1);
      // A final e cut off in speech or verse: "Den hätt' ich fast vergessen" (Effi Briest), "als säh' er".
      if (!out.length && /[^aeiouäöü]$/.test(f)) d.match(f + 'e', out, 1);
    }
    if (!out.length && /oe|ae/i.test(f)) {
      // oeuvre and boeuf as typed for œuvre and bœuf.
      d.match(f.replace(/oe/g, 'œ').replace(/ae/g, 'æ'), out, 0.5);
    }
    return this.rank(out, capMid, word);
  }

  private rank(out: Cand[], capMid: boolean, word = ''): Cand[] {
    const d = this.data;
    const best = new Map<number, Cand>();
    const f = word ? this.fold(word) : '';
    // German: the lower-case word's prior speaks for a capital, but not in mid-sentence for one the dictionary has as a
    // noun: "Gott sei Dank" is not dank's ("thanks to"); "wie geht es Ihnen" is ihnen's.
    const capNoun = capMid && out.some((c) => d.pos[c.e] === 'noun' && isUpper(d.key[c.e][0] ?? ''));
    const prior = f ? (d.priorOf(f) ?? (this.lang.keepCase && !capNoun ? d.priorOf(lowerFirst(f)) : null)) : null;
    // The words spelled exactly as on the page (not a name, not one labeled uncommon or archaic throughout).
    const own = f ? (d.byKey.get(f) ?? []).filter((e) => !d.weak[e] && d.pos[e] !== 'proper noun') : [];
    const spelled = own.reduce((r, e) => (d.rank[e] && (!r || d.rank[e] < r) ? d.rank[e] : r), 0);
    const seenStress = new Map<number, number>();
    for (const c of out) {
      c.score = this.score(c, capMid, word, prior, spelled);
      // Russian: each stress an entry's forms spelled alike have is a reading of its own (сло́ва the genitive, слова́ the
      // plural), so the language's context rules can choose the case: "Теперь я не скажу ни слова" (Белые ночи) is сло́ва. The
      // builder lists the commoner first, and the others wait ALT_STRESS below it.
      let id = c.e;
      if (this.lang.stress && c.desc >= 0 && c.stress >= 0) {
        id = c.e * 1024 + c.stress + 1;
        const first = seenStress.get(c.e);
        if (first === undefined) seenStress.set(c.e, c.stress);
        else if (first !== c.stress) c.score! -= ALT_STRESS;
      }
      const prev = best.get(id);
      if (!prev || c.score! > prev.score!) best.set(id, c);
    }
    // A word's female (or male) form of another word of its kind is the word itself where the dictionary has it: una bella
    // signora is a lady, not signore's feminine "sir, Mr"; Zia Scolastica an aunt; colei "she" not colui. The headword
    // leads, whatever the other word's frequency or its own label (ella is "uncommon, literary" and still "she"). Only of
    // its kind: "una voz tan baja" is bajo's "low", not baja "loss".
    if (f && best.size > 1) {
      for (const c of best.values()) {
        if (c.desc < 0 || d.key[c.e] === f || !/\b(?:feminine|masculine)\b/.test(d.descs[c.desc]) || /\bplural\b/.test(d.descs[c.desc])) continue;
        const self = [...best.values()].find((o) => o.desc < 0 && d.key[o.e] === f && d.pos[o.e] === d.pos[c.e]);
        if (self && c.score! > self.score! - 0.5) c.score = self.score! - 0.5;
      }
    }
    return [...best.values()].sort((a, b) => b.score! - a.score! || a.e - b.e);
  }

  /**
   * The word with a written accent added on one vowel, the last vowel first, each accent the language writes (hundio ->
   * hundió, oir -> oír, Machado's ceu -> céu and seminario -> seminário).
   */
  private accentVariants(f: string): string[] {
    const accents = ACCENTS[this.lang.id];
    if (!accents || f.length < 2 || ACCENTED.test(f)) return [];
    const out: string[] = [];
    for (let i = f.length - 1; i >= 0; i--) {
      for (const a of accents[f[i]] ?? '') out.push(f.slice(0, i) + a + f.slice(i + 1));
    }
    return out;
  }

  /**
   * Matches for a word written without the accents its dictionary form has: one accent added (oir -> oír), else any
   * headword spelled so without its accents (two left off, or a cedilla: coracao -> coração). `cap`: the word has a capital,
   * so a name may be it ("¡El io." in Platero y yo is the donkey's bray, not the moon Ío).
   */
  private matchAccented(f: string, out: Cand[], penalty: number, cap = false): void {
    // Only a headword in the frequency list, a verb's form (oir is oír) or a name: the Lazarillo's laceria "misery" is not
    // lacería "strapwork", nor humero "flue" húmero "humerus"; but "«THEODORE ROUAULT.»" (Madame Bovary) is Théodore. Any in
    // a book that leaves its accents off (looseAccents): Machado's truismo, Alencar's moquem are truísmo, moquém.
    const d = this.data;
    const fits = (c: Cand): boolean => !!this.lang.looseAccents || d.rank[c.e] > 0 || d.pos[c.e] === 'verb' || (cap && d.pos[c.e] === 'proper noun');
    const take = (s: string): void => {
      const found: Cand[] = [];
      d.match(s, found, penalty);
      out.push(...found.filter(fits));
    };
    for (const v of this.accentVariants(f)) {
      take(v);
      if (out.length) return;
    }
    if (!ACCENTS[this.lang.id] || ACCENTED.test(f)) return;
    for (const key of d.plainKeys().get(f) ?? []) take(key);
  }

  /** Spanish dámelo, Italian dimmi: the verb and the pronouns joined to it. */
  private splitEnclitics(word: string): { verb: Cand[]; stem: string; clitics: string[] } | null {
    if (!this.enclitics.length) return null;
    const f = this.fold(word);
    let best: { verb: Cand[]; stem: string; clitics: string[] } | null = null;
    // First the forms that take enclitics today (infinitive, gerund, imperative); then, for a word nothing else reads,
    // any verb form: Galdós still joins them to a finite verb (Detúvose, hundiose, Creeríase, parecíale), and the
    // modern spelling drops the accent the form has alone (hundiose is hundió + se).
    let finite = false;
    const peel = (rest: string, clitics: string[]): void => {
      if (clitics.length >= 3 || best) return;
      for (const cl of this.enclitics) {
        if (rest.length <= cl.length + 1 || !rest.endsWith(cl)) continue;
        const stem = rest.slice(0, -cl.length);
        const chain = [cl, ...clitics];
        let tries = this.lang.encliticStems ? this.lang.encliticStems(stem, cl) : [stem];
        if (finite) tries = [...tries, ...this.accentVariants(stem)];
        for (const t of tries) {
          const out: Cand[] = [];
          this.data.match(t, out, 0);
          const verbs = out.filter((c) => this.data.pos[c.e] === 'verb' && (finite || c.desc < 0 || this.data.descClitic[c.desc]))
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
    if (!best) {
      finite = true;
      peel(f, []);
    }
    return best;
  }

  /**
   * German: a separable verb written as one word in a form the dictionary does not list, read through its verb's form.
   * Wiktionary writes a main clause's hinaustreten apart (trat hinaus), so "als er auf die Diele hinaustrat" (Immensee) is
   * hinaus + trat: hinaustreten's preterite. A particle verb the dictionary lacks altogether is its verb with the particle
   * in front, like a compound: "um in sein Zimmer zurückzuwandern" (Die Verwandlung) is zurück + wandern.
   */
  private particleVerb(word: string): Analysis | null {
    const d = this.data;
    const w = lowerFirst(word);
    for (const p of [...this.separable].sort((a, b) => b.length - a.length)) {
      if (!w.startsWith(p) || w.length - p.length < 3) continue;
      let rest = w.slice(p.length);
      // The zu of a zu-infinitive stands between: zurück-zu-wandern, not zurück + zuwandern "to immigrate".
      const inf = (c: Cand): boolean => d.pos[c.e] === 'verb' && (c.desc < 0 || /\binfinitive\b/.test(d.descs[c.desc]));
      if (rest.startsWith('zu') && this.candidates(rest.slice(2), false).some(inf)) rest = rest.slice(2);
      const verbs = this.candidates(rest, false).filter((c) => d.pos[c.e] === 'verb');
      if (!verbs.length) continue;
      const v = verbs[0];
      const whole = d.byKey.get(this.fold(p + d.head[v.e]))?.find((e) => d.pos[e] === 'verb');
      const parts = [this.part(p), { text: word.slice(word.length - rest.length), key: d.key[v.e], gloss: d.hint[v.e] || undefined, pos: 'verb' }];
      if (whole !== undefined) {
        const cands = this.rank(verbs.map((c) => ({ e: whole, desc: c.desc, stress: -1, penalty: c.penalty + 0.5 })), false);
        return { cands, key: d.key[whole], lemma: d.head[whole], parts };
      }
      const lemma = p + d.head[v.e];
      return { cands: verbs, key: this.fold(lemma), lemma, prefix: p, parts };
    }
    return null;
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
      // A present participle's ending is no Ende "end": "der Schreitende", "den Eintretenden" (Immensee), whose front is a
      // verb's stem. But "an die Tür am Kopfende seines Bettes" (Die Verwandlung) is the head end.
      if (/^ende[nrsm]?$/i.test(w.slice(cut)) && (d.byKey.has(w.slice(0, cut).toLowerCase() + 'en') || d.byKey.has(w.slice(0, cut).toLowerCase() + 'n'))) continue;
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
        if (verb.length) return { cands: verb, key: d.key[verb[0].e], lemma: d.head[verb[0].e], parts: clit.map((p, i) => this.part(p, i ? 'pronoun' : undefined)) };
      }
      // A verb and its pronouns the dictionary has whole as something else, or as a form of no pieces: "Savez-vous bien que
      // c'est ici la maison d'un Ogre ?" (Perrault) is savoir with vous, not the interjection sais-tu "you know"; "Que
      // faites-vous là ?" is faire's faites + vous on the card.
      const pieces = this.hyphenClitics.size ? word.split(/(?<=\p{L})[-‐](?=\p{L})/u) : [];
      if (pieces.length > 1 && pieces.slice(1).every((p) => this.hyphenClitics.has(this.fold(p).toLowerCase()))) {
        const verb = this.candidates(pieces[0], false).filter((c) => d.pos[c.e] === 'verb');
        const parts = (v: Cand): Part[] => pieces.map((p, i) => (i ? this.part(p, 'pronoun') : { text: p, key: d.key[v.e], gloss: d.hint[v.e] || undefined }));
        // Only a form of something else (savez-vous is filed as sais-tu's): rendez-vous, excusez-moi, voyez-vous are words.
        if (verb.length && top.desc >= 0 && ['interjection', 'noun'].includes(d.pos[top.e])) return { cands: verb, key: d.key[verb[0].e], lemma: d.head[verb[0].e], parts: parts(verb[0]) };
        if (d.pos[top.e] === 'verb') return { cands, key: d.key[top.e], lemma: d.head[top.e], parts: parts(top) };
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
        const parts = (): Part[] => pieces.map((p, i) => this.part(p, i ? 'noun' : 'content'));
        const whole = this.candidates(joined, capMid);
        if (whole.length) return { cands: whole, key: d.key[whole[0].e], lemma: d.head[whole[0].e], parts: parts() };
        const last = this.candidates(upperFirst(pieces[pieces.length - 1]), false);
        if (last.length) {
          const prefix = pieces.slice(0, -1).join('-') + '-';
          return { cands: last, key: this.fold(prefix + d.head[last[0].e]), lemma: prefix + d.head[last[0].e], prefix, parts: parts() };
        }
      }
      let first = this.candidates(pieces[0], false);
      // Pronouns after the hyphen leave only a verb before it: "um homem consola-se mais ou menos" (Dom Casmurro) is
      // consolar, not consola "console"; Machado's "fel-o rir" is fez + o, not fel "bitterness".
      const all = first;
      const tail = pieces.slice(1).map((p) => this.fold(p).toLowerCase());
      const particles = this.lang.hyphenParticles ?? [];
      if (this.hyphenClitics.size && tail.every((p) => this.hyphenClitics.has(p)) && !tail.every((p) => particles.includes(p))) {
        first = first.filter((c) => d.pos[c.e] === 'verb');
      }
      if (!first.length && this.lang.encliticStems) {
        // fazê-lo is fazer + o: the verb lost its last letter to the pronoun.
        for (const stem of this.lang.encliticStems(this.fold(pieces[0]), this.fold(pieces[1]))) {
          const out: Cand[] = [];
          this.data.match(stem, out, 0);
          first = this.rank(out.filter((c) => this.data.pos[c.e] === 'verb'), false);
          if (first.length) break;
        }
      }
      if (!first.length) first = all;
      if (first.length) {
        // dá-me, fazê-lo, donne-le: the pieces after the verb are its pronouns (lo "it", not the article), and the first is
        // the verb as read, though spelled as no word alone (tiral of tiral-os is tirar).
        const v = first[0];
        const parts = pieces.map((p, i) => (i ? this.part(p, particles.includes(this.fold(p).toLowerCase()) ? undefined : 'pronoun') : { text: p, key: d.key[v.e], gloss: d.hint[v.e] || undefined }));
        return { cands: first, key: d.key[v.e], lemma: d.head[v.e], parts };
      }
    }
    const enc = this.splitEnclitics(word);
    if (enc) {
      const v = enc.verb[0];
      const parts = [{ text: enc.stem, key: d.key[v.e], gloss: d.hint[v.e] || undefined }, ...this.cliticParts(word, enc.stem, enc.clitics, d.key[v.e])];
      return { cands: enc.verb, key: d.key[v.e], lemma: d.head[v.e], parts };
    }
    if (this.separable.size && (!cap || !capMid)) {
      const pv = this.particleVerb(word);
      if (pv) return pv;
    }
    if (this.lang.compounds && cap) {
      const comp = this.splitCompound(word);
      if (comp) {
        const h = comp.head[0];
        const lemma = comp.prefix + d.head[h.e].toLowerCase();
        // Later pieces are looked up as nouns first: Fensterblech is Fenster + Blech (sheet metal), not blechen (to pay up),
        // and Kinderstimmen is Kinder + Stimmen (voices), not stimmen (to be right). The first piece is a content word:
        // Samtkissen is Samt (velvet) + Kissen, not samt (together with).
        const parts = comp.pieces.map((p, i) => (i < comp.pieces.length - 1 ? this.modifier(p) : null) ?? this.part(p, i > 0 ? 'noun' : 'content'));
        return { cands: comp.head, key: this.fold(lemma), lemma, prefix: comp.prefix, parts };
      }
    }
    // A name in mid-sentence only finds itself so with its accents (Italia, Pádua), not another name (Virgilia, Virgílio).
    let loose = this.candidates(word, capMid, true);
    // German writes a participle used as a noun with a capital: "der Schreitende" reaches schreiten through respell.
    if (capMid) loose = loose.filter((c) => stripAccents(this.fold(d.head[c.e])).toLowerCase() === stripAccents(f).toLowerCase()
      || (!!this.lang.keepCase && c.desc >= 0 && /\bparticiple\b/.test(d.descs[c.desc])));
    if (loose.length) return { cands: loose, key: d.key[loose[0].e], lemma: d.head[loose[0].e] };
    // An unknown capitalized word is a name in mid-sentence; at the start of a sentence it is only unknown (Detúvose,
    // before the enclitic split read it, was a "name").
    return { cands: [], key: f, lemma: word, name: (cap && capMid) || undefined };
  }

  private cliticParts(word: string, stem: string, clitics: string[], verbKey = ''): Part[] {
    const out: Part[] = [];
    let at = stem.length;
    for (const cl of clitics) {
      const text = word.slice(at, at + cl.length);
      at += cl.length;
      // tenerla is tener + la "her, it", not la "the"; venirci is venire + ci "there", where the language says so.
      out.push(this.part(text, this.lang.cliticPart?.(verbKey, cl) === 'adverb' ? 'adverb' : 'pronoun'));
    }
    return out;
  }

  /**
   * A German compound's piece before its head, as the noun it is: spelled so as a headword (Eisentür is Eisen "iron" + Tür, not
   * Eis "ice"), or with its linking letters off (Liebesabenteuer is Liebe "love", not lieb's liebes "dear"; Eichenholz Eiche
   * "oak", not the diminutive Eichen "little egg"; Handelsstadt Handel). Undefined when neither is a noun.
   */
  private modifier(text: string): Part | undefined {
    const d = this.data;
    const noun = (s: string): number | undefined => d.byKey.get(upperFirst(s.toLowerCase()))?.find((e) => d.pos[e] === 'noun');
    const tries = /(?:chen|lein)$/.test(text) ? [] : [text];
    for (const l of ['s', 'es', 'n', 'en', 'e', 'er', 'ens']) if (text.length - l.length >= 3 && text.endsWith(l)) tries.push(text.slice(0, -l.length));
    // The piece as spelled first, else the commonest noun with its linking letters off: Gottesmauer is Gott, not Gotte
    // "godmother".
    let best = tries[0] === text ? noun(text) : undefined;
    for (const t of best === undefined ? tries : []) {
      const e = noun(t);
      if (e !== undefined && (best === undefined || this.rankOf(e) < this.rankOf(best))) best = e;
    }
    return best === undefined ? undefined : { text, key: d.key[best], gloss: d.hint[best] || undefined, pos: 'noun' };
  }

  /**
   * A compound's piece whose hint can stand in the compound's: one section of its key (not See "lake" and "sea"; another
   * section a trade's own does not count, as Tag's "tag" on the Internet), and its hint one meaning ("Mr, gentleman" is two).
   * Before the head, a first sense that is not a trade's or an old one's: Ober is "queen" only at cards, Haupt "head" only in
   * heraldry (Oberförster, Hauptsorge), Mohr dated and offensive.
   */
  private plainPiece(key: string | undefined, head = false): boolean {
    const d = this.data;
    const shifted = (e: number): boolean => {
      const s = d.senses[e];
      return s.startsWith('{') && SHIFTING_NOTE.test(s.slice(1, s.indexOf('}')));
    };
    const all = (key ? d.byKey.get(key) ?? [] : []).filter((e) => d.pos[e] !== 'proper noun');
    const es = all.filter((e, i) => i === 0 || !shifted(e));
    if (es.length !== 1 || !d.hint[es[0]] || /[;(]/.test(d.hint[es[0]])) return false;
    // A head whose hint is one meaning: Rat's "advice, counsel" is not the councillor of Landgerichtsrat. A piece before it in
    // its first sense.
    return head ? !d.hint[es[0]].includes(',') : !shifted(es[0]);
  }

  /**
   * A piece of a word as its own word: its key and short gloss. `prefer`: the readings to try first, the pronoun for a
   * clitic, the noun (capitalized) for a later piece of a German compound, a content word for its first piece.
   */
  private part(text: string, prefer?: 'pronoun' | 'noun' | 'content' | 'adverb'): Part {
    const d = this.data;
    let cands = prefer === 'noun' ? this.candidates(upperFirst(text), false) : [];
    if (!cands.length) cands = this.candidates(text, false, true);
    if (!cands.length) cands = this.candidates(upperFirst(text), false);
    if (!cands.length) return { text };
    const fits = prefer === 'pronoun' ? cands.filter((c) => d.pos[c.e] === 'pronoun')
      : prefer === 'adverb' ? cands.filter((c) => d.pos[c.e] === 'adverb')
      : prefer === 'noun' ? cands.filter((c) => d.pos[c.e] === 'noun' && isUpper(d.head[c.e][0] ?? ''))
        : prefer === 'content' ? cands.filter((c) => !CLOSED.has(d.pos[c.e])) : [];
    if (fits.length) cands = fits;
    else if (prefer === 'pronoun') {
      // A clitic the dictionary has no pronoun for is shown bare rather than as the article: mirarlos is mirar + los
      // "them", and los is only el's plural "the" there. Adverbs pass (Italian ci, vi "there").
      cands = cands.filter((c) => ['adverb', 'particle'].includes(d.pos[c.e]));
      if (!cands.length) return { text };
    }
    const e = cands[0].e;
    // A lone letter read as a noun is the euphonic t of a-t-il, not t for "tonne".
    if (text.length === 1 && (this.data.pos[e] === 'noun' || this.data.pos[e] === 'proper noun')) return { text };
    return { text, key: this.data.key[e], gloss: this.data.hint[e] || undefined, pos: this.data.pos[e] };
  }

  // ---- segmenting

  segment(text: string): Token[] {
    const tokens: Token[] = [];
    const pending: { t: Token; at: number; start: boolean; sent: number }[] = [];
    let sentenceStart = true;
    let sent = 0;
    const begin = (): void => {
      if (!sentenceStart) sent++;
      sentenceStart = true;
    };
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
        // A chapter's Roman numeral is a number, not the word it is spelled like: "I. Platero", "VI. ¡Angelus!" (Platero y
        // yo), "XI. El patriarca de Aldeacorba" (Marianela), Luis XIV. One letter only opening the paragraph: M. is Monsieur,
        // V. usted.
        const run = text.slice(i, j);
        if (this.chars.latin && 'IVXLCDM'.includes(text[i]) && ROMAN.test(run) && (text[j] === '.' || j === n)
          && (run.length > 1 ? !this.commonWord(run) : /^[IVX]$/.test(run) && !text.slice(0, i).trim())) {
          tokens.push({ text: run, start: i, end: j, kind: 'num', inDict: false });
          sentenceStart = false;
          i = j;
          continue;
        }
        // An abbreviation keeps its period when the dictionary has it so (M. for Monsieur, Sr., etc.), unless the word
        // without it is a common one (no. is número, but "Dijo que no." ends a sentence). A short title before a name keeps
        // it too: "— Mas, Sr. Nogueira, que fará você todo esse tempo?" (Missa do Galo).
        let abbreviation = false;
        if (text[j] === '.' && j - i <= 4 && this.isAbbreviation(text.slice(i, j), /^\.\s+\p{Lu}/u.test(text.slice(j, j + 3)))) {
          j++;
          abbreviation = true;
        }
        // Italian po', di': a final apostrophe that belongs to the word.
        if (this.lang.finalApostrophe && (text[j] === "'" || text[j] === '’') && (j + 1 >= n || this.chars.of(text.charCodeAt(j + 1), text, j + 1) !== LETTER)) {
          const withApo = text.slice(i, j) + "'";
          // po' is a form of poco, not an entry of its own.
          const found: Cand[] = [];
          this.data.match(this.fold(withApo), found, 0);
          // Or as the book's spelling reads it: Manzoni's que' is quei, Dante's "che già li er' al petto" era, "perch' i' fu'
          // ribellante" fui. Not a preposition, whose apostrophe stands for the article after it: "pur tra' monti" is tra i, not
          // trarre's trae; "inver' la terra" inverso "toward", not invero. Nor a quote's closing mark: "ch'elli acceffa'." is
          // acceffare's present, "‘mo’ e ‘issa’" the words quoted.
          const bare = this.analyze(text.slice(i, j)).cands[0];
          const closing = j + 1 >= n || !/\s/.test(text[j + 1]) || /[‘']/.test(text[i - 1] ?? '');
          if (!found.length && this.lang.respell && !closing && !(bare && this.data.pos[bare.e] === 'preposition')) {
            for (const r of this.lang.respell(this.fold(withApo))) this.data.match(r, found, 0);
          }
          if (found.length) j++;
        }
        for (const piece of this.splitWord(text, i, j)) {
          if (piece.kind !== 'word') { tokens.push(piece); continue; }
          pending.push({ t: piece, at: tokens.length, start: sentenceStart, sent });
          tokens.push(piece);
          sentenceStart = false;
        }
        // An abbreviation written in lower case ends its sentence before a capital: "… fez-se ré, etc. Este calix" (Dom
        // Casmurro), "и т. д. Одним словом" (Каштанка). A title (Sr., M., г.) does not: its name follows.
        if (abbreviation && run === run.toLowerCase() && !this.titles.has(this.fold(run).toLowerCase() + '.') && /^\s+\p{Lu}/u.test(text.slice(j, j + 3))) begin();
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
      // A sentence starts after a full stop, and so does quoted speech: after an opening quote, ¿ ¡ or the dialogue dash
      // (dit tout haut ces paroles : « Rassurez-vous, roi et reine »), and after a colon (dit : Je …). German capitalizes
      // after a colon what it capitalizes anywhere.
      if (/[.!?…]/.test(mark)) begin();
      else if (len === 1 && this.openers.includes(mark)) begin();
      else if (mark === ':' && !this.lang.keepCase) begin();
      else if (mark === '"' && (i === 0 || /\s/.test(text[i - 1])) && i + 1 < n && this.chars.of(text.charCodeAt(i + 1), text, i + 1) === LETTER) begin();
      i += len;
    }
    const words = this.readWords(pending, tokens);
    this.useContext(words, tokens);
    if (this.separable.size) this.joinSeparable(words, tokens);
    if (this.data.phrases.size) this.findPhrases(words, tokens);
    return tokens;
  }

  /**
   * Each word read by itself. Words in mid-sentence go first, so the capitalized ones read as names (Platero) are known
   * when the words starting a sentence are read: one of those that the book uses as a name in mid-sentence is the name,
   * any other the common word (Una, Tenía) or, when the dictionary lacks it, an unknown word, not a name.
   */
  private readWords(pending: { t: Token; at: number; start: boolean; sent: number }[], tokens: Token[]): Word[] {
    const d = this.data;
    const words: Word[] = new Array(pending.length);
    const title = (k: number): boolean => k > 0 && pending[k - 1].at + 2 === pending[k].at && tokens[pending[k].at - 1].kind === 'space'
      && this.titles.has(this.fold(pending[k - 1].t.text).toLowerCase());
    const read = (k: number, capMid: boolean): void => {
      const { t, at, start, sent } = pending[k];
      let a = this.analyze(t.text, capMid);
      // German cuts a final e with an apostrophe: "Mancher gibt sich viele Müh'" (Max und Moritz) is Mühe, not mühen.
      const apo = tokens[at + 1];
      // Not a quote's closing mark: "'Ich liebe diese Frau so sehr, daß ich ihr alles verzeihen kann', und" (Effi Briest).
      const quoted = (): boolean => tokens.slice(0, at).some((x, j) => (x.text === "'" || x.text === '‘') && tokens[j + 1]?.kind === 'word'
        && (j === 0 || tokens[j - 1].kind === 'space' || /[»„«“"(]/.test(tokens[j - 1].text)));
      if (this.lang.keepCase && apo && (apo.text === "'" || apo.text === '’') && a.cands.every((c) => c.desc >= 0 && d.pos[c.e] === 'verb') && !quoted()) {
        const full = this.analyze(t.text + 'e', capMid);
        if (full.cands.some((c) => d.pos[c.e] !== 'verb')) a = full;
      }
      // A courtesy title in mid-sentence is the common word (Madame, Monsieur), and the word after one a name unless the
      // dictionary has it as a noun: "mit der Frau Pastor Trippel" (Effi Briest) is a name, not trippeln "to scurry"; "der
      // Herr Prokurist" the Prokurist.
      if (this.lang.keepCase && this.names.has(t.text) && a.cands.length > 0 && a.cands.every((c) => c.penalty >= STRIPPED)) {
        a = { cands: [], key: this.fold(t.text), lemma: t.text, name: true };
      }
      const cap = this.titles.size > 0 && isUpper(t.text[0] ?? '');
      const courtesy = cap && this.titles.has(this.fold(t.text).toLowerCase());
      const afterTitle = cap && !courtesy && title(k) && !a.cands.some((c) => ['noun', 'proper noun'].includes(d.pos[c.e]) && c.penalty !== STRIPPED);
      t.key = a.key;
      t.lemma = a.lemma;
      t.inDict = a.cands.length > 0;
      // A capital in mid-sentence makes a name (Sancho Panza, la Mancha) even where a common word shares the spelling,
      // but not a function word capitalized for courtesy (Russian Вы in a letter, Italian Lei). German writes every noun
      // so and is told by the dictionary alone, and by the book: a name it has after a title reads only as its spelling
      // with the umlaut off (Böck).
      if (afterTitle || a.name || (capMid && !courtesy && (!a.cands.length || (!this.lang.keepCase && t.text !== t.text.toUpperCase() && !this.functionWord(a.cands[0]))))) {
        t.name = true;
        if (a.cands.length && d.pos[a.cands[0].e] !== 'proper noun') t.lemma = t.text;
        if (!start && capMid && this.bookName(a)) this.rememberName(t.text);
      }
      words[k] = { t, a, at, start, sent };
    };
    for (let k = 0; k < pending.length; k++) if (!pending[k].start) read(k, isUpper(pending[k].t.text[0]));
    for (let k = 0; k < pending.length; k++) {
      if (pending[k].start) read(k, isUpper(pending[k].t.text[0]) && this.names.has(pending[k].t.text));
    }
    // An initial after a name or a title, a capital letter and its period: "князя Б.", "Варвара Васильевне Ю." (Russian), not
    // большой "big" or юг "south".
    for (let k = 1; k < words.length; k++) {
      const w = words[k];
      const prev = words[k - 1];
      const initial = /^\p{Lu}\.$/u.test(w.t.text) || (w.t.text.length === 1 && isUpper(w.t.text) && tokens[w.at + 1]?.text === '.');
      if (!initial || prev.at + 2 !== w.at) continue;
      // After a name in mid-sentence, not an abbreviation read as one nor a sentence's first word: Marianela's "el Sr. D.
      // Teodoro" and "Señor D. Teodoro" keep D. for don.
      if ((prev.t.name && !prev.start && !prev.t.text.endsWith('.')) || this.titles.has(this.fold(prev.t.text).toLowerCase()) || this.titles.has(prev.a.key)) {
        w.t.name = true;
        w.t.lemma = w.t.text;
      }
    }
    // A capital printed without its accent at a sentence start may be the accented word: its readings after the word's own.
    const accented = this.lang.capitalAccent;
    if (accented) {
      for (const w of words) {
        const v = w.start && !w.t.name ? accented[w.t.text] : undefined;
        if (!v || !w.a.cands.length) continue;
        const best = w.a.cands[0].score!;
        const more = this.candidates(v, false).filter((c) => c.desc < 0 && !w.a.cands.some((o) => o.e === c.e));
        for (const c of more) {
          c.score = Math.min(c.score! - 0.5, best - 1);
          c.accent = true;
        }
        if (more.length) w.a = { ...w.a, cands: [...w.a.cands, ...more].sort((x, y) => y.score! - x.score!) };
      }
    }
    return words;
  }

  /** Cut a run of word characters (with inner apostrophes and hyphens) into tokens. */
  private splitWord(text: string, a: number, b: number): Token[] {
    const word = text.slice(a, b);
    const tok = (s: number, e: number): Token => ({ text: text.slice(s, e), start: s, end: e, kind: 'word', inDict: false });
    const hasApo = /['’ʼ]/.test(word);
    const hasHyphen = /[-‐]/.test(word);
    // Script changes inside a run (a Latin name in Russian text) cut it.
    if (!hasApo && !hasHyphen) return [tok(a, b)];
    if (this.wholeKnown(word, hasApo) && !this.elidedVerb(word)) return [tok(a, b)];
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
        // A word of the dictionary, or a form of one: Pirandello's "pe’l collo" is pe' (pei, "for the") + l.
        if (this.elisions.has(folded) || this.elisions.has(folded.toLowerCase()) || (this.wholeKnown(head) && !/[-‐]/.test(head))) {
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

  /**
   * An elided pronoun and a verb that the dictionary has whole only as a noun or an interjection: "J'aime ce pays, et j'aime y
   * vivre" (Le Horla) is j' + aimer, not the noun j'aime "a like".
   */
  private elidedVerb(word: string): boolean {
    let yes = this.elided.get(word);
    if (yes === undefined) {
      const m = /^([^'’ʼ]+['’ʼ])(.+)$/.exec(word);
      // A pronoun that comes before a verb (j', m', t'), not mezz' of "mezz'ora" nor qu' of "qu'importe".
      const top = m ? this.analyze(m[2]).cands[0] : undefined;
      yes = !!m && !!top && this.beforeVerb.has(this.fold(m[1]).toLowerCase()) && this.data.pos[top.e] === 'verb'
        && this.analyze(word).cands.every((c) => ['noun', 'interjection'].includes(this.data.pos[c.e]));
      if (this.elided.size > 20000) this.elided.clear();
      this.elided.set(word, yes);
    }
    return yes;
  }

  private isAbbreviation(word: string, capitalAfter = false): boolean {
    if (!this.wholeKnown(word + '.')) return false;
    const bare = this.candidates(word, false);
    if (!bare.length || word.length === 1 || this.rankOf(bare[0].e) > 5000) return true;
    // Sr, the bare spelling of senhor too, is the abbreviation before a name: "Sr. Nogueira". Not a word of its own: "—No.
    // Pero" ends its sentence.
    const top = bare[0];
    return capitalAfter && word.length <= 3 && isUpper(word[0]) && word.slice(1) === word.slice(1).toLowerCase()
      && top.desc >= 0 && this.data.key[top.e] !== this.fold(word).toLowerCase();
  }

  /** A word the dictionary has as a common one (rank 5000 or better, not a name): VI is no numeral when a book uses it so. */
  private commonWord(word: string): boolean {
    const top = this.candidates(word, false)[0];
    return !!top && this.data.pos[top.e] !== 'proper noun' && this.rankOf(top.e) <= COMMON_RANK && this.data.key[top.e] === this.fold(word);
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
   * pronoun before a verb or on it picks the verb's reflexive sense (se acuerda "remembers"). The language's own rules
   * (SpacedLang.context) are asked first.
   */
  private useContext(words: Word[], tokens: Token[]): void {
    const d = this.data;
    const firstPos = (w: { a: Analysis }): string => (w.a.cands.length ? d.pos[w.a.cands[0].e] : '');
    const adjacent = (x: { at: number }, y: { at: number }): boolean => {
      // Only space between them: a comma or a full stop ends the reach of a word over the next.
      for (let k = x.at + 1; k < y.at; k++) if (tokens[k].kind !== 'space') return false;
      return true;
    };
    const low = (w: Word): string => this.fold(w.t.text).toLowerCase();
    const chosenOf = (w: Word | undefined): Cand | undefined => (w ? this.chosen.get(w.t)?.c : undefined);
    // Not a form with a person, mood or tense: an infinitive, a gerund or present participle ("en ayant"), the clipped
    // infinitive of verse ("a star con lui", I promessi sposi, is stare).
    const nonFinite = (c: Cand): boolean => c.desc < 0 || /\b(?:infinitive|gerund)\b/.test(d.descs[c.desc])
      || /\bpresent participle\b/.test(d.descs[c.desc])
      || !/\b(?:first|second|third)-person\b|\b(?:imperative|indicative|subjunctive|conditional|preterite|participle)\b/.test(d.descs[c.desc]);
    // A past participle (partido, vu), not a present one: "elles étaient toujours devant le miroir" has no compound tense.
    const participle = (c: Cand): boolean => d.pos[c.e] === 'verb' && c.desc >= 0 && /\bparticiple\b/.test(d.descs[c.desc])
      && !/\bpresent participle\b/.test(d.descs[c.desc]);
    const genders = this.lang.genderBefore ?? {};
    const auxiliaries = new Set(this.lang.auxiliaries ?? []);
    // Object and reflexive pronouns come only before a verb (me acuerdo, se casa): after one, the verb reading wins however
    // much likelier the noun is alone.
    const clitics = new Set([...(this.lang.reflexive?.always ?? []), ...(this.lang.reflexive?.ifPronominal ?? [])]);
    const negParticles = new Set(this.lang.negation?.particles ?? []);
    const negWords = new Set(this.lang.negation?.words ?? []);
    /** A negation particle within the three words before word k, in the same clause (ne … point, n'avait point). */
    const negated = (k: number): boolean => {
      for (let j = k - 1; j >= Math.max(0, k - 4) && adjacent(words[j], words[j + 1]); j--) {
        if (negParticles.has(low(words[j]))) return true;
      }
      return false;
    };
    /** The word before is an article or determiner as read (un, la, cette), not merely spelled like one. */
    const determinerBefore = (prev: Word | undefined, prevKey: string): boolean => {
      const c = chosenOf(prev);
      if (!c) return false;
      const pos = d.pos[c.e];
      return pos === 'article' || pos === 'determiner' || (!!genders[prevKey] && pos !== 'pronoun');
    };
    /**
     * An auxiliary before word k, with up to two adverbs between: había partido; n'avait jamais vu "had never seen", a pas
     * vu, ho mai visto.
     */
    const auxBefore = (k: number): boolean => {
      for (let j = k - 1, between = 0; j >= 0 && adjacent(words[j], words[j + 1]); j--, between++) {
        const c = chosenOf(words[j]);
        if (c && auxiliaries.has(d.key[c.e])) return true;
        if (between >= 2 || !(negWords.has(low(words[j])) || (c && d.pos[c.e] === 'adverb'))) return false;
      }
      return false;
    };
    /** A mark (not only space) or the paragraph's end comes after word k. */
    const beforeMark = (k: number): boolean => {
      const end = k + 1 < words.length ? words[k + 1].at : tokens.length;
      for (let t = words[k].at + 1; t < end; t++) if (tokens[t].kind !== 'space') return true;
      return end === tokens.length || k + 1 >= words.length;
    };
    /** A comma, an exclamation or question mark, or a dash comes right after word k (¡Ay, …; Basta!). */
    const exclaimed = (k: number): boolean => {
      const end = k + 1 < words.length ? words[k + 1].at : tokens.length;
      for (let t = words[k].at + 1; t < end; t++) if (/^[,!?¡¿…—–-]$/.test(tokens[t].text)) return true;
      return false;
    };
    /** The sentence the token at `at` is in ends with a question mark: Que faites-vous là ? */
    const question = (at: number): boolean => {
      for (let k = at + 1; k < tokens.length; k++) {
        if (tokens[k].kind === 'punct' && /[.!?…]/.test(tokens[k].text)) return tokens[k].text === '?';
      }
      return false;
    };
    /** The gender a form's description gives it (solo's "feminine plural" sole), '' when it gives none or both. */
    const formGender = (c: Cand): string => {
      if (c.desc < 0) return '';
      const fem = /\bfeminine\b/.test(d.descs[c.desc]);
      return fem === /\bmasculine\b/.test(d.descs[c.desc]) ? '' : fem ? 'f' : 'm';
    };
    /** After a noun, an adjective beats this reading: a noun, a participle, a subjunctive or imperative no subject takes. */
    const adjectiveOver = (c: Cand): boolean => d.pos[c.e] === 'noun' || participle(c)
      || (d.pos[c.e] === 'verb' && c.desc >= 0 && /\b(?:subjunctive|imperative)\b/.test(d.descs[c.desc]) && !/\bindicative\b/.test(d.descs[c.desc]));

    // The words as the language's own rules see them, built when one is asked about.
    const hook = this.lang.context;
    const view = new Map<number, ContextWord>();
    const cw = (i: number): ContextWord => {
      let v = view.get(i);
      if (v) return v;
      const w = words[i];
      const readings = w.a.cands.map((c) => (c.view ??= this.reading(c)));
      let before = '';
      for (let t = i > 0 ? words[i - 1].at + 1 : 0; t < w.at; t++) before += tokens[t].text;
      let after = '';
      for (let t = w.at + 1; t < (i + 1 < words.length ? words[i + 1].at : tokens.length); t++) after += tokens[t].text;
      const squeeze = (s: string): string => s.replace(/\s+/g, ' ').trim();
      v = { text: w.t.text, low: low(w), readings, before: squeeze(before), after: squeeze(after), name: !!w.t.name };
      const c = chosenOf(w);
      if (c) v.chosen = readings[w.a.cands.indexOf(c)];
      view.set(i, v);
      return v;
    };
    const ask = (k: number): ContextChoice | null | undefined => {
      let s0 = k;
      let s1 = k + 1;
      while (s0 > 0 && words[s0 - 1].sent === words[k].sent) s0--;
      while (s1 < words.length && words[s1].sent === words[k].sent) s1++;
      const sentence: ContextWord[] = [];
      for (let i = s0; i < s1; i++) sentence.push(cw(i));
      return hook!(new Query(sentence, k - s0, cw(k),
        k > 0 && adjacent(words[k - 1], words[k]) ? cw(k - 1) : undefined,
        k + 1 < words.length && adjacent(words[k], words[k + 1]) ? cw(k + 1) : undefined,
        words[k].start, question(words[k].at), () => {
          const out: ContextWord[] = [];
          for (let i = 0; i < s0; i++) out.push(cw(i));
          return out;
        }));
    };

    for (let k = 0; k < words.length; k++) {
      const w = words[k];
      let cands = w.a.cands;
      let choice: Cand | undefined = cands[0];
      const prev = k > 0 && adjacent(words[k - 1], w) ? words[k - 1] : undefined;
      const next = k + 1 < words.length && adjacent(w, words[k + 1]) ? words[k + 1] : undefined;
      const prevKey = prev ? low(prev) : '';
      const prevC = chosenOf(prev);
      const wLow = low(w);
      // The language's own rules first, for every word it can read: they choose among its readings, and may say whether a
      // verb is reflexive.
      const said = hook && cands.length ? ask(k) : null;
      // An answer without `prefer` leaves the choice to the generic rules (it only gives a hint or keeps a phrase off).
      const answer = said?.prefer ? said : null;
      if (cands.length > 1) {
        const posSet = new Set(cands.map((c) => d.pos[c.e]));
        const nounish = [...posSet].some((p) => NOUNISH.has(p));
        // A function word's bonus for being spelled as its own entry does not hold where it cannot stand, when the word can
        // be a noun or adjective: after an article or a determiner that comes only before a noun (sa personne "her person",
        // not personne "no one"), and after a preposition for a conjunction or preposition (un étui d'or "gold", not or
        // "yet"; assez de puissance). Not after any word read as a determiner: "quanta ne avesse Perpetua" (I promessi
        // sposi) has the pronoun quanta, and ne "of it".
        const prevPos = prevC ? d.pos[prevC.e] : '';
        const afterArticle = prevPos === 'article' || prevPos === 'contraction'
          || (prevPos === 'determiner' && (this.beforeNoun.has(prevKey) || !!genders[prevKey]));
        // After an adjective too: "la plus belle personne du monde" (Perrault).
        const strip = !nounish ? null : afterArticle || prevPos === 'adjective' ? NOT_AFTER_ARTICLE
          : prevPos === 'preposition' ? NOT_AFTER_PREPOSITION : null;
        // A preposition after a preposition gives way to an adjective or adverb ("per lungo tempo", "guardando in su"), not
        // to a noun: "en outre" is "besides", not a wine skin.
        const keepPrep = prevPos === 'preposition' && !cands.some((c) => d.pos[c.e] === 'adjective' || d.pos[c.e] === 'adverb');
        const sc = (c: Cand): number => c.score! - (strip?.has(d.pos[c.e]) && !(keepPrep && d.pos[c.e] === 'preposition') ? c.closed ?? 0 : 0);
        if (strip && cands.some((c) => c.closed && strip.has(d.pos[c.e]))) cands = [...cands].sort((x, y) => sc(y) - sc(x) || x.e - y.e);
        choice = cands[0];

        let want: ((c: Cand) => boolean) | null = null;
        // How far below the likeliest reading the neighbors may reach: a weak cue (Quel before est) moves a word only
        // between near readings; a decisive one (l' before a verb, me before acuerdo) moves it however far.
        let margin = CONTEXT_MARGIN;
        if (answer) {
          const rs = cw(k).readings;
          const prefer = answer.prefer!;
          want = (c) => {
            const i = w.a.cands.indexOf(c);
            return prefer(rs[i], i);
          };
          margin = answer.margin;
        } else if (d.pos[cands[0].e] === 'preposition' && beforeMark(k) && cands.some((c) => d.pos[c.e] === 'adverb' || d.pos[c.e] === 'adjective')) {
          // A preposition has its noun after it, never a comma or a full stop: "Il suo naso, che era già lungo, gli diventò
          // più lungo" (Pinocchio) is long, not lungo "along"; "deux cigares dedans, dit-il" (Le Tour du monde) inside, the
          // adverb before the noun "interior". "en outre," keeps its preposition "besides" over outre "wine skin".
          want = cands.some((c) => d.pos[c.e] === 'adverb') ? (c) => d.pos[c.e] === 'adverb' : (c) => d.pos[c.e] === 'adjective';
        } else if (d.pos[cands[0].e] === 'interjection' && !w.start && !beforeMark(k) && cands.some((c) => d.pos[c.e] !== 'interjection')) {
          // An interjection stands apart (¡Ay, qué relumbres!), not inside a clause.
          want = (c) => d.pos[c.e] !== 'interjection';
        } else if (w.start && exclaimed(k) && d.pos[cands[0].e] !== 'interjection' && cands.some((c) => d.pos[c.e] === 'interjection' && c.desc < 0)) {
          // And a word standing apart that can be one is one: "¡Ay, qué relumbres y olores!" (Platero y yo) is ay, not
          // haber's obsolete spelling of hay.
          want = (c) => d.pos[c.e] === 'interjection' && c.desc < 0;
        } else if (negWords.has(wLow) && negated(k)) {
          // si fâchés de n'avoir point d'enfants: point is "not", however common the noun and poindre's forms are.
          want = (c) => d.pos[c.e] !== 'verb' && d.pos[c.e] !== 'noun';
          margin = Infinity;
        } else if (auxBefore(k) && cands.some(participle) && !(cands[0].desc < 0 && ['adverb', 'conjunction'].includes(d.pos[cands[0].e]))) {
          // había partido "had split", however common partido "party" is; n'avait jamais vu "had never seen", not vu
          // "given". But an adverb or conjunction read as itself stays one: "il y avait plus de cinquante ans" (Perrault) is
          // plus "more", not plaire's plural participle; "aveva subito impegnata la sua parola" (I promessi sposi) "at once",
          // not subire's "suffered". Another function word gives way only to a participle nearly as likely: "lo había
          // dicho" is decir's, not dicho "said" the determiner.
          want = participle;
          margin = cands[0].desc < 0 && NOT_PARTICIPLE.has(d.pos[cands[0].e]) ? CONTEXT_MARGIN : Infinity;
        } else if (this.articleOrPronoun.has(wLow) && next) {
          if (this.noArticleBefore.has(low(next)) && cands.some((c) => d.pos[c.e] === 'preposition')) {
            want = (c) => d.pos[c.e] === 'preposition';
          } else {
            // A subject before it says the pronoun as well: "Juan la llama", "Geppetto la porta a casa", "un gros pivert qui
            // le regarde" (Lettres de mon moulin).
            want = this.verbNext(next, !!prev && (this.beforeVerb.has(prevKey) || !!prev.t.name || prevPos === 'pronoun'), prevPos === 'conjunction')
              ? (c) => d.pos[c.e] === 'pronoun' : (c) => ['article', 'determiner', 'contraction'].includes(d.pos[c.e]);
          }
          margin = Infinity;
        } else if (afterArticle && prevPos !== 'contraction' && genders[prevKey] && d.pos[cands[0].e] === 'adverb' && posSet.has('noun')) {
          // An article makes a noun of a word as likely an adverb: "volvió esa tarde" (Quiroga) is the afternoon, not
          // "late". Only a near call (un peu, le plus keep the adverb, which is far likelier than their nouns), and not after
          // a contraction or a neuter lo, which make adverbs: "ao menos" (Os Maias) is "at least", "por lo menos" too.
          want = (c) => d.pos[c.e] === 'noun';
          margin = 2;
        } else if (prevPos === 'numeral' && nounish && !NOUNISH.has(d.pos[cands[0].e])) {
          // After a number, the noun: "cual dos cuernos de pita" (Platero y yo) are horns, not cuernos "the hell".
          want = (c) => NOUNISH.has(d.pos[c.e]);
        } else if (prev && this.articleOrPronoun.has(prevKey) && prevC && d.pos[prevC.e] === 'pronoun' && posSet.has('verb')) {
          // After la, lo read as the pronoun just above: the verb, as after any object pronoun ("Non lo so" is sapere, not so
          // "under").
          want = (c) => d.pos[c.e] === 'verb';
          margin = Infinity;
        } else if (prev && (this.beforeNoun.has(prevKey) || this.articleOrPronoun.has(prevKey) || afterArticle || (prevC && this.agrees(prevC, cands)))
          && nounish && posSet.has('verb') && !(this.lang.keepCase && !(next && isUpper(next.t.text[0])))) {
          // After an article (or la, which is one before a noun) or a determiner: anything but a verb. After a real article,
          // a contraction (del, nel) or a determiner that agrees with the noun, however much likelier the verb is alone:
          // "la garganta le quemaba de tanta sed" (Quiroga) is thirst, not ser's sed "be!". German writes its nouns with a
          // capital, so a lower-case word after das is an adjective before its noun or a verb after the pronoun: "das weiß
          // ich nicht" (Siddhartha).
          want = (c) => d.pos[c.e] !== 'verb';
          if (prevPos === 'article' || prevPos === 'contraction' || (prevC && this.agrees(prevC, cands))) margin = Infinity;
        } else if (determinerBefore(prev, prevKey) && d.pos[cands[0].e] === 'adverb' && posSet.has('adjective') && next && firstPos(next) === 'noun') {
          // un beau baptême: before a noun, beau the adjective, not the adverb of avoir beau "in vain". "un peu étourdie",
          // un peu de, tout autour de keep their adverb: no noun follows.
          want = (c) => d.pos[c.e] === 'adjective';

        } else if (prev && this.prepositions.has(prevKey) && posSet.has('verb') && posSet.size > 1) {
          // After a preposition: anything but a conjugated verb (de una cuchillada, para comer). A noun beats the verb
          // however much likelier the verb is alone: "la garganta le quemaba de tanta sed" (Quiroga) is thirst, not ser's
          // sed "be!". Not after a word that is also a pronoun before a verb (French en, y: il en a).
          want = (c) => d.pos[c.e] !== 'verb' || nonFinite(c);
          if (prevC && d.pos[prevC.e] === 'preposition' && !this.beforeVerb.has(prevKey) && nounish) margin = Infinity;
        } else if (prev && this.beforeVerb.has(prevKey) && posSet.has('verb')) {
          want = (c) => d.pos[c.e] === 'verb';
          if (clitics.has(prevKey)) margin = Infinity;
        } else if (this.lang.keepCase && posSet.has('determiner') && posSet.has('verb')) {
          // German sein: "his" before a noun or adjective, "to be" otherwise (er muss da sein.).
          const nextNoun = !!next && (isUpper(next.t.text[0]) || NOUNISH.has(firstPos(next)));
          want = nextNoun ? (c) => d.pos[c.e] === 'determiner' || d.pos[c.e] === 'pronoun' : (c) => d.pos[c.e] === 'verb';
        } else if (!this.lang.keepCase && prevC && d.pos[prevC.e] === 'noun' && adjectiveOver(cands[0])
          && cands.some((c) => d.pos[c.e] === 'adjective' && this.fitsNoun(prevC, c))) {
          // Right after a noun, an adjective that agrees with it: "à boutons noirs" (Bovary) are black buttons, not noir
          // "black person"; "El hombre enfermo" (Quiroga) is sick, not a sick person. But "signor conte" (I promessi sposi)
          // is the count: conte as conto's feminine plural "known" cannot go with signor.
          want = (c) => d.pos[c.e] === 'adjective' && this.fitsNoun(prevC, c);
        } else if (afterArticle && next && firstPos(next) === 'noun' && posSet.has('adjective') && d.pos[cands[0].e] === 'noun') {
          // Between a determiner and a noun, the adjective: "d'un long cordon trop mince" (Bovary), not long "length".
          want = (c) => d.pos[c.e] === 'adjective';
        } else if (prevPos === 'adjective' && k >= 2 && adjacent(words[k - 2], prev!) && ['adjective', 'verb'].includes(d.pos[cands[0].e])
          && !(next && firstPos(next) === 'noun')
          && ['article', 'determiner', 'contraction'].includes(d.pos[chosenOf(words[k - 2])?.e ?? -1] ?? '')
          && cands.some((c) => d.pos[c.e] === 'noun' && !isUpper(d.head[c.e][0] ?? ''))) {
          // After an article and an adjective, the noun: "una bella signora" (Pinocchio) is a lady, not signore's feminine
          // "lordly". Not before a noun: "quelque bon petit frère" (Lettres de mon moulin) is small.
          want = (c) => d.pos[c.e] === 'noun' && (this.lang.keepCase || !isUpper(d.head[c.e][0] ?? ''));
          margin = 3;
        }
        if (!want && !answer && prev && genders[prevKey] && cands.filter((c) => d.pos[c.e] === 'noun' && d.gender[c.e]).length > 1) {
          want = (c) => NOUNISH.has(d.pos[c.e]);
        }
        // An article's gender rules out a form of the other one: "il sole apparve" (Pinocchio) is the sun, not solo's
        // feminine plural "alone".
        const ag = afterArticle || prevPos === 'determiner' ? genders[prevKey] : undefined;
        if (!want && !answer && ag && cands.some((c) => formGender(c) && formGender(c) !== ag)) {
          want = (c) => !formGender(c) || formGender(c) === ag;
        }
        if (want) {
          let fits = cands.filter(want);
          const top = sc(cands[0]);
          // The article's gender picks among nouns spelled alike: el cura (priest), la cura (cure). Among the nouns only:
          // "la jeune fée" (Perrault) keeps jeune "young" ahead of the noun jeune "youth", which agrees with la as well.
          const g = prev && !answer ? genders[prevKey] : undefined;
          if (g) {
            const slots = fits.flatMap((c, i) => (d.pos[c.e] === 'noun' ? [i] : []));
            const nouns = slots.map((i) => fits[i]);
            const agree = nouns.filter((c) => d.gender[c.e] && d.gender[c.e].includes(g));
            const ordered = [...agree, ...nouns.filter((c) => !agree.includes(c))];
            fits = [...fits];
            slots.forEach((s, j) => { fits[s] = ordered[j]; });
          }
          fits = fits.filter((c) => sc(c) > top - margin);
          // A noun over an adjective spelled the same after an article (un hidalgo), when it is nearly as likely. Not
          // before a noun: un beau baptême is a fine baptism, not a boyfriend's.
          const noun = answer ? undefined : fits.find((c) => d.pos[c.e] === 'noun');
          const nounSlot = (this.beforeNoun.has(prevKey) || this.articleOrPronoun.has(prevKey)) && !(next && firstPos(next) === 'noun');
          choice = noun && fits[0] && d.pos[fits[0].e] === 'adjective' && nounSlot && sc(noun) > sc(fits[0]) - 3
            ? noun : fits[0] ?? cands[0];
        }
      }
      if (choice && choice !== w.a.cands[0]) {
        w.t.key = d.key[choice.e];
        w.t.lemma = w.a.prefix ? w.a.prefix + d.head[choice.e].toLowerCase() : d.head[choice.e];
        if (w.a.prefix) w.t.key = this.fold(w.t.lemma);
      }
      if (this.lang.stress && choice) {
        // A reading the language's rules ruled out is no rival for the stress: "ни слова" is сло́ва, whatever слова́ scores.
        const rs = answer ? cw(k).readings : [];
        const ruled = answer ? (o: Cand): boolean => { const i = w.a.cands.indexOf(o); return !answer.prefer!(rs[i], i); } : undefined;
        const st = this.stressOf(w.t.text, choice, w.a, ruled);
        if (st !== undefined) w.t.stress = st;
      }
      const inverted = this.inversion(w.t.text, () => question(w.at)
        || (!!prevC && !this.lang.coordinators?.includes(prevKey) && d.pos[prevC.e] !== 'interjection'));
      const reflexive = !!choice && (said?.reflexive ?? this.isReflexive(choice, w.a, prevKey, () => !!inverted));
      const chosen: Chosen = { a: w.a, c: choice, reflexive };
      if (inverted) chosen.inverted = inverted;
      // The rule's hint holds for the reading it preferred; a reading it did not prefer kept its own (too far below to win).
      if (said?.hint && choice) {
        const i = w.a.cands.indexOf(choice);
        if (!said.prefer || said.prefer(cw(k).readings[i], i)) {
          chosen.hint = said.hint;
          if (said.sense) chosen.sense = said.sense;
        }
      }
      if (said?.noPhrase) chosen.noPhrase = true;
      this.chosen.set(w.t, chosen);
      const v = view.get(k);
      if (v && choice) v.chosen = v.readings[w.a.cands.indexOf(choice)];
    }
  }

  /**
   * The subject pronoun hyphened after a verb in an inversion (SpacedLang.hyphenSubjects), or undefined: "te dis-je encore
   * une fois" (Lettres de mon moulin) has je; "Mais que voulez-vous, c'est le maire" (Bovary) vous, after a word of the
   * clause; "— Mais dépêchez-vous, mère Rolet!" none, after a conjunction, nor "apporte-moi une citrouille" (Perrault).
   * `questionOrWord`: the sentence is a question, or a word of the clause comes right before that no order follows.
   */
  private inversion(text: string, questionOrWord: () => boolean): string | undefined {
    const subjects = this.lang.hyphenSubjects;
    if (!subjects || !/[-‐]/.test(text)) return undefined;
    const subject = text.split(/[-‐]/).slice(1).map((p) => this.fold(p).toLowerCase()).find((p) => p in subjects);
    if (!subject) return undefined;
    return !this.lang.reflexive?.imperative?.[subject] || questionOrWord() ? subject : undefined;
  }

  /**
   * Whether the word after la, lo, les, l' is a verb, making that word the pronoun. All its readings count, not only the
   * likeliest alone: "com a testa um pouco franzida" (Missa do Galo) is the forehead, though testa reads first as testar's
   * "tests", and "infilata la porta di casa" (Pinocchio) is the door. A noun, adjective or participle that comes near the
   * verb's score wins (a participle, because a pronoun never comes right before one: "No apartaban la vista de las medias",
   * Quiroga). After a subject or object pronoun, a negation or a name the word is the pronoun before any verb: il la
   * regarde, non lo so. A lone letter's noun reading (the letter a) does not count: qui l'a vu. Nor does a subjunctive
   * but after que, che or the like: "levantéme la venda" (Lazarillo) is the bandage, not "may sell it".
   */
  private verbNext(next: Word, pronounBefore: boolean, afterConjunction: boolean): boolean {
    const d = this.data;
    // A word that is first a preposition or the like is no verb: Machado's "a minha alegria accordava a delle" is dele
    // "his", not delir's "may destroy".
    const top = next.a.cands[0];
    if (top && ['preposition', 'conjunction', 'contraction', 'article'].includes(d.pos[top.e])) return false;
    // Nor an adverb read as itself: "prit pour moi la plus tendre amitié" (Candide) is plus, not plaire's past historic.
    if (top && d.pos[top.e] === 'adverb' && top.desc < 0) return false;
    let verb = -Infinity;
    let noun = -Infinity;
    for (const c of next.a.cands) {
      const pos = d.pos[c.e];
      const desc = c.desc >= 0 ? d.descs[c.desc] : '';
      // A past participle goes with the noun (la vista), a present one with the verb ("en les voyant", "la retirant"). A form
      // that is a participle and a present at once (fait, dit, mis, pris) is the verb as well: "On le fait tourner à droite"
      // (Candide) is "makes him turn", not "the fact".
      const part = pos === 'verb' && !!desc && desc.split('; ').every((p) => /\bparticiple\b/.test(p) && !/\bpresent participle\b/.test(p));
      // Every form it can be is a subjunctive or an imperative (venda), not "first-person singular present; second-person
      // singular imperative" (he, which "las he de aprender" needs) nor "present indicative/subjunctive" (regardent).
      const subjunctive = !!desc && desc.split('; ').every((p) => /\b(?:subjunctive|imperative)\b/.test(p) && !/\bindicative\b/.test(p));
      // A contraction counts against the verb too: "Contei-vos a da visita imperial" (Os Maias) is not dar's "gives".
      if (pos === 'verb' && !part) {
        if (!subjunctive || pronounBefore || afterConjunction) verb = Math.max(verb, c.score!);
      } else if (part || pos === 'contraction' || (NOUNISH.has(pos) && next.t.text.length > 1)) noun = Math.max(noun, c.score!);
    }
    if (verb === -Infinity) return false;
    return !!pronounBefore || verb > noun + ARTICLE_MARGIN;
  }

  /**
   * A determiner that says its gender and number agrees with a noun reading of the word after it: "de tanta sed" (tanta is
   * feminine singular, sed "thirst" feminine). A finite verb is then out of the question, however likely alone.
   */
  private agrees(det: Cand, cands: Cand[]): boolean {
    const d = this.data;
    if (d.pos[det.e] !== 'determiner' || det.desc < 0) return false;
    const form = d.descs[det.desc];
    const g = /\bfeminine\b/.test(form) ? 'f' : /\bmasculine\b/.test(form) ? 'm' : '';
    if (!g || !/\bsingular\b/.test(form)) return false;
    return cands.some((c) => d.pos[c.e] === 'noun' && c.desc < 0 && d.gender[c.e].split('/').includes(g));
  }

  /**
   * Whether an adjective reading can stand after a noun reading: the gender and number its form says (conto's "feminine
   * plural" conte) do not contradict the noun's. A headword adjective is singular, of either gender (jeune, grande).
   */
  private fitsNoun(noun: Cand, adj: Cand): boolean {
    const d = this.data;
    const nd = noun.desc >= 0 ? d.descs[noun.desc] : '';
    const ad = adj.desc >= 0 ? d.descs[adj.desc] : '';
    const nounPlural = /\bplural\b/.test(nd) || d.gender[noun.e] === 'pl';
    const adjPlural = /\bplural\b/.test(ad) && !/\bsingular\b/.test(ad);
    const adjSingular = !ad || (/\bsingular\b/.test(ad) && !/\bplural\b/.test(ad));
    if ((adjPlural && !nounPlural) || (adjSingular && nounPlural)) return false;
    const g = /\bfeminine\b/.test(nd) ? 'f' : d.gender[noun.e];
    if (!g || g === 'pl') return true;
    if (/\bfeminine\b/.test(ad) && !/\bmasculine\b/.test(ad)) return g.includes('f');
    if (/\bmasculine\b/.test(ad) && !/\bfeminine\b/.test(ad)) return g.includes('m');
    return true;
  }

  /** A candidate as a context rule sees it. */
  private reading(c: Cand): ContextReading {
    const d = this.data;
    const r: ContextReading = { key: d.key[c.e], head: d.head[c.e], pos: d.pos[c.e], gender: d.gender[c.e], form: c.desc >= 0 ? d.descs[c.desc] : '',
      hint: d.hint[c.e], score: c.score ?? 0, labels: this.notesOf(c.e) };
    const aspect = d.aspect.get(c.e)?.aspect;
    if (aspect) r.aspect = aspect;
    return r;
  }

  /**
   * German separable verbs: a finite verb and its particle at the end of the clause are one verb. "Ja, ja, danke, Mutter,
   * ich stehe schon auf" (Die Verwandlung) is aufstehen "to get up", not stehen "to stand" and auf "on": both words take its
   * key, lemma and hint, and the card shows the verb with both pieces.
   */
  private joinSeparable(words: Word[], tokens: Token[]): void {
    const d = this.data;
    const coordinators = new Set(this.lang.separable?.coordinators ?? []);
    for (let k = 1; k < words.length; k++) {
      const p = words[k];
      if (!this.separable.has(p.t.text) || p.start || !this.endsClause(words, tokens, k)) continue;
      // um, ohne, statt and wieder before zu + an infinitive open an infinitive clause: "kam die Bedienerin herein, um zu sagen"
      // (Die Verwandlung), "die Dinge wieder zu holen" (wiederholen is not separable).
      if (['um', 'ohne', 'statt', 'anstatt', 'wieder'].includes(p.t.text) && words[k + 1]?.t.text === 'zu') continue;
      // von … aus is a frame: "Man sah vom Bett aus", "von der Tür aus zu kitzeln suchte". Only von and its noun right before
      // aus, and no sich: "Frau von Briest drückte ihre Zustimmung aus" (Effi Briest) is ausdrücken, "und ruhte sich dort einen
      // Augenblick lang von der Anstrengung aus" (Die Verwandlung) ausruhen, "Es ging von der Fähre … etwas aus" ausgehen.
      if (p.t.text === 'aus' && this.vonFrame(words, tokens, k)) continue;
      // "Er ging auf und ab": a pair of particles is an adverb (up and down), not abgehen.
      if (k >= 2 && coordinators.has(words[k - 1].t.text) && this.separable.has(words[k - 2].t.text)) continue;
      const v = this.clauseVerb(words, tokens, k);
      const vc = v ? this.chosen.get(v.t) : undefined;
      const pc = this.chosen.get(p.t);
      if (!v || !vc?.c || !pc) continue;
      const head = p.t.text + d.head[vc.c.e].toLowerCase();
      const e = d.byKey.get(head)?.find((x) => d.pos[x] === 'verb');
      if (e === undefined) continue;
      const piece = (w: Word, c: Cand | undefined): Part => ({ text: w.t.text, key: c ? d.key[c.e] : undefined, gloss: (c && d.hint[c.e]) || undefined });
      const parts = [piece(v, vc.c), piece(p, pc.c)];
      vc.sep = { e, desc: vc.c.desc, parts };
      pc.sep = { e, desc: -1, parts, particle: true };
      // And its reflexive sense: "Dann wandte sie sich eilig ab" (Immensee) is abwenden's "to turn away". Not a sich a
      // preposition takes: "streckte er die rechte Hand weit von sich zur Treppe hin" (Die Verwandlung) stretched it out.
      const own = words.slice(Math.max(0, k - 6), k).some((w, j, ws) => w.t.text === 'sich'
        && !(j > 0 && this.prepositions.has(ws[j - 1].t.text.toLowerCase())) && !['von', 'vor', 'an', 'auf', 'für', 'mit', 'zu', 'bei', 'hinter', 'über', 'unter', 'gegen'].includes(ws[j - 1]?.t.text ?? ''));
      pc.reflexive = vc.reflexive = vc.reflexive || (!!d.rhint[e] && own);
      for (const t of [v.t, p.t]) {
        t.key = d.key[e];
        t.lemma = d.head[e];
      }
    }
  }

  /**
   * The aus at word k closes a von … aus frame ("vom Bett aus"): von or vom and up to three words of its noun right before it,
   * with no comma between, and no sich in the clause (a reflexive verb's von is its own: "ruhte sich … von der Anstrengung aus").
   */
  private vonFrame(words: Word[], tokens: Token[], k: number): boolean {
    for (let j = k - 1; j >= Math.max(0, k - 4); j--) {
      for (let t = words[j].at + 1; t < words[j + 1].at; t++) if (tokens[t].kind !== 'space') return false;
      const x = words[j].t.text;
      if (x === 'von' || x === 'vom') return !words.slice(Math.max(0, j - 6), j).some((w) => /^sich/.test(w.t.text));
      const c = this.chosen.get(words[j].t)?.c;
      if (c && this.data.pos[c.e] === 'verb' && !words[j].t.name) return false;
    }
    return false;
  }

  /**
   * Word k is the last of its clause: a mark or the paragraph's end comes next, or und/oder + not another particle (ging
   * auf und ab is not aufgehen), or zu + an infinitive ("Reinhard fing an zu erzählen", Immensee).
   */
  private endsClause(words: Word[], tokens: Token[], k: number): boolean {
    const next = words[k + 1];
    if (!next) return true;
    for (let t = words[k].at + 1; t < next.at; t++) if (tokens[t].kind !== 'space') return true;
    const after = words[k + 2];
    if (this.lang.separable?.coordinators?.includes(next.t.text)) return !(after && this.separable.has(after.t.text));
    if (next.t.text === 'zu' && after) {
      const c = this.chosen.get(after.t)?.c;
      return !!c && this.data.pos[c.e] === 'verb' && c.desc < 0;
    }
    return false;
  }

  /**
   * The finite verb of the clause word k ends. Back from the particle, the words fall into stretches cut by commas and by
   * und/oder/aber: the particle's own stretch, then the ones before it. The first verb of a stretch is the one (a German
   * main clause has its verb first or second), but a stretch after a comma that opens with der, wie, dass … and ends with
   * its verb is a clause of its own and is passed over: "Er sah den Mann, der dort stand, lange an" is ansehen; "und alle
   * kehrten, wie erleichtert, in ihre Wohnung zurück" (Die Verwandlung) zurückkehren; "Sie schloß die Tür auf und trat
   * ein" eintreten, not einschließen. Never across a full stop, semicolon, colon, quote or dash.
   */
  private clauseVerb(words: Word[], tokens: Token[], k: number): Word | undefined {
    const d = this.data;
    const coordinators = new Set(this.lang.separable?.coordinators ?? []);
    const verb = (w: Word): boolean => {
      const c = this.chosen.get(w.t)?.c;
      return !!c && !w.t.name && d.pos[c.e] === 'verb' && (c.desc < 0 || !/\b(?:infinitive|participle)\b/.test(d.descs[c.desc]));
    };
    let end = k;
    for (let stretch = 0; stretch < 5 && end > 0; stretch++) {
      // The stretch is words[start, end); `cut` is what ends it in front: a mark, a coordinator, or the paragraph's start.
      let start = end - 1;
      let cut = '';
      while (start > 0) {
        for (let t = words[start - 1].at + 1; t < words[start].at; t++) if (tokens[t].kind !== 'space') cut += tokens[t].text;
        if (cut) break;
        if (coordinators.has(words[start - 1].t.text)) { cut = 'and'; break; }
        start--;
      }
      const lead = this.chosen.get(words[start].t)?.c;
      const subordinate = stretch > 0 && cut !== 'and' && verb(words[end - 1]) && !!lead
        && ['article', 'pronoun', 'conjunction', 'adverb', 'determiner'].includes(d.pos[lead.e]);
      if (!subordinate) {
        for (let j = start; j < end; j++) if (verb(words[j])) return words[j];
      }
      if (start === 0 || (cut !== ',' && cut !== 'and')) return undefined;
      // Past the coordinator itself.
      end = cut === 'and' ? start - 1 : start;
    }
    return undefined;
  }

  /**
   * Fixed phrases (phrases.tsv.gz): adjacent words that spell one, the longest first, take its hint, and a lookup of any of
   * them shows it first. "Y sin embargo estaba ya en Buenos Aires" (Quiroga) is "however", not sin "without" and embargo.
   * Every phrase the paragraph spells is found first, then taken from the left, the longest at each word; but a verb's phrase
   * that ends on the first half of a contraction gives way to a phrase that the contraction starts: "Stando alla larga da'
   * prepotenti" (I promessi sposi) is alla larga "at bay", not stando a "according to" ending on alla's a. A preposition's
   * keeps it: "fino alla fine" is fino a "until", not alla fine "in the end".
   */
  private findPhrases(words: Word[], tokens: Token[]): void {
    const d = this.data;
    // Words of a phrase stand side by side, with spaces, a hyphen or nothing (an elision) between them.
    const joined = (x: Word, y: Word): boolean => {
      for (let k = x.at + 1; k < y.at; k++) if (tokens[k].kind !== 'space' && tokens[k].text !== '-' && tokens[k].text !== '‐') return false;
      return true;
    };
    const low = (w: Word): string => this.fold(w.t.text).toLowerCase();
    /** A contraction's second half is an article: del (de + el), alla (a + la); not dessas (de + essas) nor disso. */
    const endsInArticle = (note: string): boolean => {
      let yes = this.articleEnds.get(note);
      if (yes === undefined) {
        const second = /^contraction of [^ +]+ ?\+ ?([^ +]+)/.exec(note)?.[1];
        yes = !second || this.analyze(second).cands.some((c) => d.pos[c.e] === 'article');
        this.articleEnds.set(note, yes);
      }
      return yes;
    };
    /**
     * The spellings a word may have in a phrase: its own; an elided one's full word as read ("parce qu'il" has parce que;
     * Manzoni's s' read as si is not se, so "come s'è visto" is not come se "as if"); the dictionary form of a word the book
     * spells its own way (Machado's "ao contrario" is ao contrário); and, last in a phrase, a contraction's first word ("A
     * pesar del hambre", Quiroga, has a pesar de), but not in a verb's phrase when the rest of it is no article: "Ha dessas
     * reminiscências" (Dom Casmurro) is not haver de. `own`: how many of the spellings are the word's own, before those of a
     * contraction cut.
     */
    const forms = (w: Word, last: boolean, verbPhrase = false): { out: string[]; own: number } => {
      const out = [low(w)];
      const c = this.chosen.get(w.t)?.c;
      if (out[0].endsWith("'")) {
        const full = [...'eaio'].map((v) => out[0].slice(0, -1) + v);
        const head = c ? this.fold(d.head[c.e]).toLowerCase() : '';
        out.push(...(full.includes(head) ? [head] : full));
      }
      if (c && c.desc < 0 && !this.chosen.get(w.t)?.a.parts) {
        const key = this.fold(d.key[c.e]).toLowerCase();
        if (!out.includes(key)) out.push(key);
      }
      const own = out.length;
      if (last && c && d.pos[c.e] === 'contraction') {
        // As its note says ({contraction of de + o} do), or as it is spelled (del, al: the article's letters cut off).
        const note = this.notesOf(c.e)[0] ?? '';
        if (!verbPhrase || endsInArticle(note)) {
          const con = /^contraction of ([^ +]+)/.exec(note);
          if (con) out.push(this.fold(con[1]).toLowerCase());
          for (const cut of [1, 2]) if (out[0].length > cut) out.push(out[0].slice(0, -cut));
        }
      }
      return { out, own };
    };
    const memo = new Map<number, { out: string[]; own: number }>();
    const formsAt = (j: number, last: boolean, verbPhrase: boolean): { out: string[]; own: number } => {
      const id = j * 4 + (last ? 2 : 0) + (verbPhrase ? 1 : 0);
      let f = memo.get(id);
      if (!f) memo.set(id, (f = forms(words[j], last, verbPhrase)));
      return f;
    };
    const off = (w: Word): boolean => !!w.t.name || !!this.chosen.get(w.t)?.noPhrase;
    const pronouns = new Set([...(this.lang.reflexive?.always ?? []), ...(this.lang.reflexive?.ifPronominal ?? [])]);
    const infinitive = this.lang.reflexive?.infinitive;
    /** The reflexive pronoun before word k that is the verb's own (se daba, me doy), or ''. */
    const ownReflexive = (k: number, c: Cand): string => {
      if (k === 0 || !joined(words[k - 1], words[k]) || off(words[k - 1])) return '';
      const p = low(words[k - 1]);
      return pronouns.has(p) && this.ownPerson(p, c) ? p : '';
    };
    /** A match: words [start, start + len), the phrase, and whether its last word is a contraction cut short (del as de). */
    const found: { start: number; len: number; phrase: Phrase; cut: boolean }[] = [];
    for (let k = 0; k < words.length - 1; k++) {
      if (off(words[k])) continue;
      const first = formsAt(k, false, false).out;
      // A phrase that starts with a verb is found by its infinitive too ("acababan de colocar" is acabar de "to have just",
      // "le hacía falta" hacer falta), and a pronominal verb's from the pronoun before it: "no se daba cuenta de nada"
      // (Cuentos de la selva), "me doy cuenta" (Platero y yo) are darse cuenta "to realize". The word's own spelling first:
      // "sin darse cuenta de" is darse cuenta, not dar cuenta de "to finish off".
      const c = this.chosen.get(words[k].t)?.c;
      const verb = !!c && d.pos[c.e] === 'verb';
      // Not before a contraction, which as often says where the verb's action goes: "le couteau lui tomba des mains"
      // (Perrault) fell from his hands, not tomber des mains "to be very boring"; "Corrieron a echarse al agua".
      const n1 = k + 1 < words.length ? this.chosen.get(words[k + 1].t)?.c : undefined;
      const lemma = verb && !(n1 && d.pos[n1.e] === 'contraction') ? this.fold(d.key[c.e]).toLowerCase() : '';
      const own = verb ? ownReflexive(k, c) : '';
      const reflexive = !!infinitive && !!own ? infinitive(lemma) : '';
      // A verb that se and a person's pronoun stand before says what happens to that person, not the plain verb's phrase: "la
      // boca se le hizo agua" (Cuentos de la selva) his mouth watered, not hacer agua "to let in water". (se alone keeps it:
      // "se moría de sed", "se dieron vuelta" are morir de sed, dar vuelta.)
      const pronominal = verb && k >= 2 && pronouns.has(low(words[k - 2])) && this.ownPerson(low(words[k - 2]), c)
        && this.beforeVerb.has(low(words[k - 1])) && !pronouns.has(low(words[k - 1]))
        && joined(words[k - 2], words[k - 1]) && joined(words[k - 1], words[k]);
      const starts = [reflexive ? [reflexive] : [], first, lemma && !first.includes(lemma) && !pronominal ? [lemma] : []];
      for (const [r, fs] of starts.entries()) {
        const most = Math.max(0, ...fs.map((f) => d.phraseLen.get(f) ?? 0));
        if (!most) continue;
        let n = 1;
        while (k + n < words.length && n < most && joined(words[k + n - 1], words[k + n]) && !off(words[k + n])) n++;
        let hit: { key: string; cut: boolean } | undefined;
        let len = n;
        for (; len >= 2 && !hit; len--) {
          // Every way to spell the run, the words' own spellings first, then with a contraction cut short at its end.
          let keys = fs;
          for (let j = k + 1; j < k + len - 1; j++) {
            const out = formsAt(j, false, verb).out;
            keys = keys.flatMap((pre) => out.map((f) => pre + ' ' + f));
          }
          const { out, own } = formsAt(k + len - 1, true, verb);
          for (let i = 0; i < out.length && !hit; i++) {
            for (const pre of keys) {
              const key = pre + ' ' + out[i];
              // A phrase books have as often word for word only as spelled: "Il se passa la main sur le visage".
              if (d.phrases.has(key) && (r === 1 || !d.phrases.get(key)!.spelled)) { hit = { key, cut: i >= own }; break; }
            }
          }
        }
        if (!hit) continue;
        len++;
        // A verb and a preposition found by the verb's infinitive are the phrase before an infinitive ("acababan de colocar"
        // is acabar de "to have just", "Io sto per mettermi in viaggio" stare per "to be about to"); before a noun the
        // preposition is as often its own: "lo tenía por el asa asido" (Lazarillo), "quello che stava a cavalcioni".
        if (r === 2 && len === 2) {
          const p = this.chosen.get(words[k + 1].t)?.c;
          const after = k + 2 < words.length && joined(words[k + 1], words[k + 2]) ? this.chosen.get(words[k + 2].t)?.c : undefined;
          if (p && d.pos[p.e] === 'preposition' && !(after && d.pos[after.e] === 'verb' && (after.desc < 0 || /\binfinitive\b/.test(d.descs[after.desc])))) continue;
        }
        const phrase = d.phrases.get(hit.key)!;
        // A verb's phrase, wherever its verb stands: "avant de se mettre au lit" (Madame Bovary) is au lit "in bed", not se
        // mettre à "to start".
        const verbal = verb || words.slice(k, k + len).some((x) => { const xc = this.chosen.get(x.t)?.c; return !!xc && d.pos[xc.e] === 'verb'; });
        // The pronoun belongs to the phrase too.
        if (r === 0) found.push({ start: k - 1, len: len + 1, phrase, cut: hit.cut });
        else found.push({ start: k, len, phrase, cut: hit.cut && verbal });
        break;
      }
    }
    // "pensarci sul serio" is sul serio "seriously", not pensarci su.
    const starts = new Set(found.map((m) => m.start));
    let free = 0;
    for (const m of found.sort((x, y) => x.start - y.start || y.len - x.len)) {
      if (m.start < free || (m.cut && starts.has(m.start + m.len - 1))) continue;
      free = m.start + m.len;
      for (let j = m.start; j < free; j++) {
        const ch = this.chosen.get(words[j].t);
        if (ch) ch.phrase = m.phrase;
      }
    }
  }

  /**
   * Whether a reflexive pronoun before a verb can be its own, by person (SpacedLang.reflexive.persons): me with a form that
   * may be first-person singular ("me daba cuenta"), se with a third person, any with a form of no person (an infinitive, a
   * gerund). "me dan a entender" (Marianela) is "they give me to understand", not darse a entender.
   */
  private ownPerson(pronoun: string, c: Cand): boolean {
    const person = this.lang.reflexive?.persons?.[pronoun];
    if (!person || c.desc < 0) return true;
    const finite = this.data.descs[c.desc].split('; ').filter((p) => /-person\b/.test(p));
    if (!finite.length) return true;
    const [who, number] = person.split('-person');
    return finite.some((p) => {
      if (who === 'third' && /\bformal\b/.test(p)) return true;
      const m = /((?:first|second|third)(?:\/(?:first|second|third))*)-person(?: (singular|plural))?/.exec(p);
      return !!m && m[1].split('/').includes(who) && (!number.trim() || m[2] === number.trim());
    });
  }

  /**
   * Whether a verb is read with its reflexive sense: a reflexive pronoun before it or joined to it, or the form says so.
   * `notImperative`: the verb is not one, whatever its form: the sentence is a question, whose verb-pronoun runs are
   * inversions ("Que faites-vous là ?"), or a word comes right before a hyphened run in its clause, where no imperative
   * stands ("Mais que voulez-vous, c'est le maire", Bovary). Spanish joins pronouns to imperatives alone: "pues siéntate".
   */
  private isReflexive(c: Cand, a: Analysis, prevKey: string, notImperative?: () => boolean): boolean {
    const d = this.data;
    if (d.pos[c.e] !== 'verb' || !d.rhint[c.e]) return false;
    if (c.desc >= 0 && /\breflexive\b/.test(d.descs[c.desc])) return true;
    const r = this.lang.reflexive;
    if (!r) return false;
    const joined = !!a.parts && a.parts.length > 1;
    const pronoun = joined ? this.fold(a.parts![1].text).toLowerCase() : prevKey;
    const desc = c.desc >= 0 ? d.descs[c.desc] : '';
    if (joined) {
      // An infinitive or gerund with its own se: "no pudo levantarse más" (Quiroga) "could not get up", yéndose al campo.
      // Not with an object after it, where se stands for le (decírselo "to say it to him").
      const after = a.parts![2] ? this.fold(a.parts![2].text).toLowerCase() : '';
      if (r.joined?.includes(pronoun) && (c.desc < 0 || /\b(?:infinitive|gerund)\b/.test(desc)) && !this.articleOrPronoun.has(after)) return true;
      // An imperative is reflexive only with its own person's pronoun: siéntate (sit down), "Levez-vous, dit le professeur"
      // (stand up), but dame (give me); and not in a question: "Que faites-vous là ?" is an inversion.
      if (/\bimperative\b/.test(desc)) {
        const person = r.imperative?.[pronoun];
        return !!person && new RegExp(person).test(desc) && !notImperative?.();
      }
    }
    if (r.always.includes(pronoun)) return true;
    return d.pronominal[c.e] && r.ifPronominal.includes(pronoun);
  }

  /** Russian: where the headword's stress is; ещё, её, вперёд have no reading, their ё is the stress. */
  private headStress(e: number): number {
    return stressIndex(this.data.reading[e] || this.data.head[e]);
  }

  /**
   * Russian: the UTF-16 offset of the stressed vowel in `text`, when known and needed. A book that prints е for ё ("звали ее
   * Настасья Петровна", Tolstoy) gets the mark on the е that is the ё.
   */
  private stressOf(text: string, c: Cand, a: Analysis, ruled?: (o: Cand) => boolean): number | undefined {
    if (/[ёЁ́]/.test(text) || a.parts) return undefined;
    if (vowels(text) < 2) return undefined;
    if (text.length !== text.normalize('NFC').length) return undefined;
    let at = c.stress;
    if (c.desc < 0) at = this.headStress(c.e);
    if (at < 0 || at >= text.length) return undefined;
    // Other readings of the same spelling with another stress (до́ма "at home", дома́ "houses") leave it unknown,
    // unless the reading chosen is clearly the likelier one.
    for (const o of a.cands) {
      if (o === c || ruled?.(o)) continue;
      const os = o.desc < 0 ? this.headStress(o.e) : o.stress;
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
    let known = ctx?.token ? this.chosen.get(ctx.token) : undefined;
    /** Whether the word was read as a name where it stands; undefined without a sentence. */
    let named: boolean | undefined;
    if (known && ctx?.token?.text === surface) {
      ({ a, c: chosen, reflexive } = known);
      named = !!ctx.token.name;
    } else if (ctx?.sentence && ctx.sentence.includes(surface)) {
      const tok = this.segment(ctx.sentence).find((t) => t.text === surface && t.kind === 'word');
      known = tok ? this.chosen.get(tok) : undefined;
      a = known?.a ?? this.analyze(surface);
      chosen = known ? known.c : a.cands[0];
      reflexive = known?.reflexive ?? false;
      if (tok) named = !!tok.name;
    } else {
      known = undefined;
      const lead = this.splitLeadingElision(surface);
      if (lead) return lead;
      a = this.analyze(surface, false);
      chosen = a.cands[0];
      reflexive = !!chosen && this.isReflexive(chosen, a, '');
    }
    // A separated German verb leads with the verb it is part of: fängt in "So fängt ein wohlbekanntes Märchen an" is
    // anfangen, an "part of anfangen".
    const sep = known?.sep;
    let order = chosen ? [chosen, ...a.cands.filter((c) => c !== chosen && !c.accent)] : a.cands.filter((c) => !c.accent);
    if (sep) order = [{ e: sep.e, desc: sep.desc, stress: -1, penalty: 0 }, ...order];
    const entries = this.entriesFor(order, reflexive);
    if (known?.hint && !sep && entries.length) entries[0] = this.leadWith(entries[0], known.hint, known.sense);
    const out: WordLookup = { surface, key: a.key, entries };
    if (sep) out.key = d.key[sep.e];
    else if (chosen) out.key = a.prefix ? this.fold(a.prefix + d.head[chosen.e].toLowerCase()) : d.key[chosen.e];
    const first = order[0];
    if (sep?.particle) out.form = 'part';
    else if (first && first.desc >= 0 && d.descs[first.desc]) out.form = d.descs[first.desc];
    // German before 1996 wrote ß where dass, Fluss, gewiss have ss: the card says so ("old spelling of dass").
    else if (first && this.lang.keepCase && surface.includes('ß') && d.head[first.e].includes('ss')) out.form = 'old spelling';
    // An inversion is no imperative, though the hyphened form is filed as one: "Que faites-vous là ?" (Perrault) is the
    // second-person plural, "Que vois-je là !" (Le Horla) the first-person singular, "te dis-je" its present or past.
    if (known?.inverted && out.form && /\bimperative\b/.test(out.form)) {
      const person = this.lang.hyphenSubjects![known.inverted];
      out.form = `${person} ${tenseFor(out.form, person) ?? 'present indicative'}, with the subject after it`;
      if (entries[0]?.form) entries[0] = { ...entries[0], form: out.form };
    }
    else if (first && d.pos[first.e] === 'contraction') {
      const con = /^contraction of (.+)$/.exec(this.notesOf(first.e)[0] ?? '');
      if (con) out.parts = con[1].split(/\s*\+\s*|\s+/).map((p) => this.part(p));
    }
    if (sep) out.parts = sep.parts;
    else if (a.parts) {
      out.parts = a.parts.map(({ pos: _, ...p }) => p);
      // The verb's piece with the sense the word was read with: "Emfim, despedi-me" (Dom Casmurro) is "to say goodbye", not
      // despedir's "to dismiss".
      if (reflexive && chosen && d.rhint[chosen.e] && out.parts[0]?.key === d.key[chosen.e]) out.parts[0] = { ...out.parts[0], gloss: d.rhint[chosen.e] };
    }
    // A fixed phrase leads: embargo in "Y sin embargo estaba ya en Buenos Aires" is "part of sin embargo", however. The key
    // stays the word's own, which is what the reader marks known or saved.
    const phrase = known?.phrase;
    if (phrase) {
      const senses = d.sensesOf(phrase.senses, 'phrase');
      if (!senses.length && phrase.hint) senses.push({ pos: 'phrase', glosses: [phrase.hint] });
      if (senses.length) {
        entries.unshift({ head: phrase.key, senses, source: 'Wiktionary' } as SpacedEntry);
        out.phrase = phrase.key;
        out.form = 'part';
      }
    }
    if (a.name || named || (named === undefined && !entries.length && isUpper(surface[0] ?? ''))) out.name = true;
    return out;
  }

  /**
   * The entry with the sense a context rule named first: que after más leads with "than", its second sense; impersonal había
   * with haber's "there be; there was". A sense leads when one of its glosses starts with the hint's first words; when none
   * does ("it is (cold)" for hace frío), the hint leads as a sense of its own, so the card says what the page says.
   */
  private leadWith(entry: SpacedEntry, hint: string, sense?: RegExp): SpacedEntry {
    const head = hint.split(/[,;]/)[0].replace(/\s*\(.*?\)\s*/g, ' ').trim().toLowerCase();
    const starts = (g: string): boolean => {
      const t = g.replace(/^\(.*?\)\s*/, '').toLowerCase();
      return t === head || t.startsWith(head + ' ') || t.startsWith(head + ',') || t.startsWith(head + ';');
    };
    let at = entry.senses.findIndex((s) => s.glosses.some(starts));
    if (at < 0 && sense) at = entry.senses.findIndex((s) => s.glosses.some((g) => sense.test(g)) || !!s.notes?.some((n) => sense.test(n)));
    if (at === 0) return entry;
    const senses = at > 0 ? [entry.senses[at], ...entry.senses.filter((_, i) => i !== at)]
      : [{ pos: entry.senses[0]?.pos, glosses: [hint] }, ...entry.senses];
    return { ...entry, senses };
  }

  /** "l'homme" looked up as one surface: the word after the elision, with both as parts. */
  private splitLeadingElision(surface: string): WordLookup | null {
    const m = /^([^'’ʼ]+['’ʼ])(.+)$/.exec(surface);
    if (!m || !this.elisions.has(this.fold(m[1]).toLowerCase()) || this.wholeKnown(surface)) return null;
    const inner = this.lookup(m[2]);
    return { ...inner, surface, parts: [this.part(m[1]), ...(inner.parts ?? [this.part(m[2])])] };
  }

  private notesOf(e: number): string[] {
    let notes = this.data.notes.get(e);
    if (!notes) {
      const s = this.data.senses[e];
      notes = s.startsWith('{') ? s.slice(1, s.indexOf('}')).split(', ') : [];
      this.data.notes.set(e, notes);
    }
    return notes;
  }

  /**
   * Entries for the candidates in order, the sections of one key merged into one entry (the leading section's senses
   * first). `reflexive`: the first entry's reflexive senses lead (acordarse "to remember" before acordar "to agree").
   */
  private entriesFor(order: Cand[], reflexive = false): SpacedEntry[] {
    const d = this.data;
    const byKey = new Map<string, SpacedEntry>();
    const out: SpacedEntry[] = [];
    const listed = new Set<number>();
    for (const c of order) {
      // An entry once, by its first reading (the form the word is of it here): Russian слова has two, one per stress.
      if (listed.has(c.e)) continue;
      listed.add(c.e);
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
        const aspect = d.aspect.get(c.e);
        if (aspect) {
          entry.aspect = aspect.aspect;
          if (aspect.partners.length) entry.partners = aspect.partners;
        }
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
    // A fixed phrase's hint over each of its words (sin embargo "however"); a separated verb's over both pieces (stehe …
    // auf "to get up").
    if (known?.phrase?.hint) return known.phrase.hint;
    if (known?.sep) return (known.reflexive && d.rhint[known.sep.e]) || d.hint[known.sep.e] || undefined;
    // What the language's rule says the word means here: que "than" after más, había "there was".
    if (known?.hint) return known.hint;
    // A form's own hint (hay "there is", ihnen "them"), not for a reading whose key has a capital where the language keeps
    // case: Effi Briest's "wie geht es Ihnen denn eigentlich?" is the polite Sie's, "you".
    const own = d.formHints.get(this.fold(token.text).toLowerCase());
    if (own && c.desc >= 0 && !(this.lang.keepCase && d.key[c.e] !== d.key[c.e].toLowerCase())) return own;
    // A German compound's hint is its pieces' meanings when they are nouns, adjectives or numbers before the head (Gartenpforte
    // "garden gate", Seitenflügel "side wing", Spätherbstnachmittag "late autumn afternoon"), the head's alone when a piece is
    // a verb's stem or a preposition (Weckuhr "clock", not "to wake clock"); the card has its pieces.
    // Only pieces with one plain meaning each (plainPiece): "Haben Sie von Landpartien gehört?" (Effi Briest) is no "country
    // match", Zimmerherr no "room Mr", Seestadt no "lake city"; those keep the head's hint.
    if (a.prefix && a.parts && a.parts.length > 1 && d.hint[c.e] && d.pos[c.e] === 'noun' && this.plainPiece(d.key[c.e], true)) {
      const mods = a.parts.slice(0, -1);
      const first = (g?: string): string => (g ?? '').split(/[,;]/)[0].replace(/^to /, '').replace(/\s*\(.*?\)/g, '').trim();
      const head = first(d.hint[c.e]);
      // Not twice: Vogelbauer is a "birdcage" already.
      if (mods.every((p) => p.gloss && ['noun', 'adjective', 'numeral'].includes(p.pos ?? '') && first(p.gloss) && !head.includes(first(p.gloss))
        && this.plainPiece(p.key))) {
        return `${mods.map((p) => first(p.gloss)).join(' ')} ${head}`;
      }
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
  readonly latin: boolean;

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

/**
 * The tense a form description gives a person, its imperative left out: "first/second-person singular present indicative;
 * first/second-person singular past historic; second-person singular imperative" (dis) is "present indicative" for
 * "first-person singular"; undefined when no part has that person.
 */
function tenseFor(form: string, person: string): string | undefined {
  const [who, number] = person.split('-person ');
  for (const part of form.split('; ')) {
    const m = /^((?:first|second|third)(?:\/(?:first|second|third))*)-person (singular|plural) (.+)$/.exec(part);
    if (m && m[2] === number && m[1].split('/').includes(who) && !/\bimperative\b/.test(m[3])) return m[3];
  }
  return undefined;
}

/** A Roman numeral in capitals: I, VI, XIV, MDCCC. */
const ROMAN = /^(?=[MDCLXVI])M{0,3}(?:C[MD]|D?C{0,3})(?:X[CL]|L?X{0,3})(?:I[XV]|V?I{0,3})$/;

const RU_VOWEL = /[аеёиоуыэюя]/i;
function vowels(s: string): number {
  let n = 0;
  for (const ch of s) if (RU_VOWEL.test(ch)) n++;
  return n;
}

/**
 * The index of the stressed vowel in the folded word of a stress-marked spelling (сказа́ть -> 4), -1 when unmarked. Other
 * combining marks belong to the letter before them: й is и + a breve in NFD, and counting the breve put the mark of
 * прийти́ one letter too far (past the end).
 */
export function stressIndex(written: string): number {
  if (!written) return -1;
  let n = 0;
  let acute = -1;
  let yo = -1;
  for (const ch of written.toLowerCase().normalize('NFD')) {
    if (ch === '́') { if (n && acute < 0) acute = n - 1; }
    else if (ch === '̈') { if (n && yo < 0) yo = n - 1; }
    else if (!/\p{M}/u.test(ch)) n++;
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
  // Fixed phrases are optional: a language without the file reads word by word.
  const phrasesP = get('phrases.tsv.gz').then(gunzip).catch(() => '');
  for (const p of [entriesP, formsP]) p.catch(() => {});
  const data = new Data();
  data.parseForms(await formsP);
  report(25);
  await yieldToEventLoop();
  await data.parseEntries(await entriesP, (f) => report(25 + f * 70));
  data.parsePrior(await priorP);
  data.parsePhrases(await phrasesP);
  const engine = new SpacedEngine(lang, data);
  try {
    const m = JSON.parse(await metaP) as Partial<LangEngine['meta']>;
    engine.meta = { built: m.built ?? '', counts: m.counts ?? {}, sources: m.sources ?? [] };
  } catch { /* the engine works without its credits */ }
  report(100);
  return engine;
}
