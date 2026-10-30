// The hook a language's own context rules plug into (SpacedLang.context). The shared engine reads a sentence one word at a
// time, left to right; before its generic rules (an article before a noun, a pronoun before a verb …) it asks the language,
// which sees the word, its neighbors and their readings and says which readings to prefer and how strongly. Rules that hold
// in one language only live there: French en after s' or n' is the pronoun "of it", Russian да before a comma is "yes",
// German sie before a plural verb is "they".
//
// A rule in a language module (fr.ts), for "la princesse se percerait la main d'un fuseau, et qu'elle en mourrait":
//
//   context(q) {
//     if (q.word.low !== 'en') return null;
//     const p = q.prev?.low ?? '';
//     if (["s'", "n'", "j'", "m'", "t'", 'il', 'elle', 'on', 'ils', 'elles'].includes(p)
//       || (q.next && q.next.readings.length && isFiniteVerb(q.next.readings[0]))) {
//       return { prefer: (r) => r.pos === 'pronoun', margin: Infinity };
//     }
//     return null;
//   },

/** One reading of a word: an entry of the dictionary, and the form the word on the page is of it. */
export interface ContextReading {
  /** The entry's key (folded headword) and headword: acordar, la, sie, её. */
  key: string;
  head: string;
  /** Part of speech, as the dictionary has it: 'noun', 'verb', 'adjective', 'adverb', 'pronoun', 'determiner', 'article' … */
  pos: string;
  /** Nouns: 'm', 'f', 'n', 'm/f', 'pl'; '' otherwise. */
  gender: string;
  /** How the word is a form of the entry ("third-person singular present indicative", "feminine"); '' for the headword. */
  form: string;
  /** The entry's short hint ("to remember", "her, it"). */
  hint: string;
  /** How likely the reading is by the word alone, in nats (higher is likelier); a word's readings come sorted by it. */
  score: number;
  /**
   * The usage labels of the entry's first sense ('archaic', 'literary', 'informal', 'vulgar' …), so a rule can prefer the plain
   * word: "la cagione cessa" (I promessi sposi) is cessare "ceases", not cesso's informal, vulgar adjective. Empty when none.
   */
  labels: string[];
  /**
   * Russian verbs: the aspect, 'pf' perfective, 'impf' imperfective, 'both'. After стать, начать, перестать only an
   * imperfective stands: "Она стала засыпать" (Каштанка) is засыпать "to fall asleep", not the perfective "to fill up".
   */
  aspect?: 'pf' | 'impf' | 'both';
}

/** A word of the sentence as a context rule sees it. */
export interface ContextWord {
  /** As on the page: Sie, l', Платеро. */
  text: string;
  /** Folded and lower-cased, the way the language's word lists hold words: sie, l', платеро. */
  low: string;
  /** Its readings, likeliest first by the word alone. Empty for a word the dictionary lacks. */
  readings: ContextReading[];
  /** The reading the engine chose: set for the words before the one being read, undefined for it and the words after. */
  chosen?: ContextReading;
  /** What stands between the word before and this one, when it is more than space (',' '«' ', —'); '' when only space. */
  before: string;
  /**
   * What stands between this word and the next one, or the end of the paragraph, when it is more than space: ',' for "Да,
   * вы наймите", '!' for "Да!", '' when only space follows.
   */
  after: string;
  /** Read as a name (Platero, Gregor). */
  name: boolean;
}

/** What a context rule is asked about: one word of a sentence. */
export interface ContextQuery {
  /** The sentence's words in order (up to the next . ! ? … or an opening quote), and where the word is among them. */
  words: ContextWord[];
  at: number;
  /**
   * words[at]: the word to read. It has a reading at least; with one, only an answer's `reflexive` matters (there is nothing
   * to choose between).
   */
  word: ContextWord;
  /** The words right before and after, when only space (or nothing, after an elision) separates them; undefined across a comma. */
  prev?: ContextWord;
  next?: ContextWord;
  /** The word starts its sentence, or quoted speech (« Rassurez-vous, …). */
  sentenceStart: boolean;
  /** The sentence ends with a question mark (Come stai? is "how", not "as"). */
  question: boolean;
  /**
   * The words of the paragraph's sentences before this one, as read (each with its `chosen` reading): what a sentence says
   * of the ones before it. The Prokurist's "Sie haben vielleicht … nicht gelesen" (Die Verwandlung) is polite "you" because he
   * has said "Herr Samsa" and "Ihre Eltern" a sentence earlier, with nothing polite in this one.
   */
  earlier: ContextWord[];
}

/** A context rule's answer: which readings fit, and how far below the likeliest one a fitting reading may be and still win. */
export interface ContextChoice {
  /**
   * The readings that fit here; the likeliest of them wins (`i` is the reading's place in word.readings). Left out, the
   * generic rules choose as if the rule had not answered, and only the answer's `hint`, `reflexive` and `noPhrase` hold.
   */
  prefer?: (r: ContextReading, i: number) => boolean;
  /**
   * In nats: CONTEXT_MARGIN (5) for a cue that may only choose between near readings, Infinity for one that decides however
   * unlikely the reading is alone (se before acuerdo). A choice that prefers every reading keeps the likeliest, and stops the
   * generic rules from moving the word.
   */
  margin: number;
  /**
   * What the word means where it stands, when that is one sense of the reading chosen, not a reading of its own: Spanish que
   * after a comparison is the conjunction's "than" ("Una olla de algo más vaca que carnero", Don Quijote), impersonal había
   * haber's "there was" ("Pero no había ni un pescado", Cuentos de la selva). It is the word's hint, and the card leads with
   * the sense it names (the first sense with a gloss that starts so), or with the hint itself when no sense does.
   */
  hint?: string;
  /**
   * The sense the card leads with, when the hint does not start one of its glosses: hace in "aquí hace frío" (El sombrero de
   * tres picos) says "it is cold" over the word and leads with hacer's "(impersonal) in expressions about the weather".
   */
  sense?: RegExp;
  /**
   * The word is not part of a fixed phrase here, however its neighbors are spelled: "dans le petit bois qu'on appelait parc"
   * (Candide) is the little wood, not petit bois "kindling". Any word of a run that says so keeps the run from matching.
   */
  noPhrase?: boolean;
  /**
   * The verb is read with its reflexive sense (true) or not (false), whatever the pronouns next to it say: German "setzte er
   * sich" puts sich after the verb, where the generic rule does not look. Left out, the engine decides.
   */
  reflexive?: boolean;
}

/** The hook itself: an answer, or nothing to leave the word to the generic rules. */
export type ContextRule = (q: ContextQuery) => ContextChoice | null | undefined;

/** How far a weak cue may move a word from its likeliest reading (core.ts uses the same). */
export const CONTEXT_MARGIN = 5;

/** A verb form that agrees with a subject (fue, fängt, сказала), not an infinitive, gerund or participle. */
export const isFiniteVerb = (r: ContextReading): boolean =>
  r.pos === 'verb' && !!r.form && !/\b(?:infinitive|gerund|participle)\b/.test(r.form);

/** A participle (partido, vista, gesehen), past or present. */
export const isParticiple = (r: ContextReading): boolean => r.pos === 'verb' && /\bparticiple\b/.test(r.form);

/** A noun, adjective, numeral or name: what comes after an article. */
export const isNounish = (r: ContextReading): boolean => ['noun', 'adjective', 'numeral', 'proper noun'].includes(r.pos);
