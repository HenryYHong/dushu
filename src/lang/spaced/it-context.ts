// Italian context rules (SpacedLang.context, see context.ts): the words whose reading depends on the words around them, read
// the way a grammar says, from what comes before and after. Every example is from Pinocchio (Collodi, 1883), Rosso Malpelo
// (Verga, 1878), Il fu Mattia Pascal (Pirandello, 1904), Il treno ha fischiato (Pirandello, 1914) or I promessi sposi
// (Manzoni, 1840).
//
// What each rule decides:
//   come      "like, as" in a comparison, "how" in a question, an exclamation or after sapere, vedere, dire …
//   ci, vi    "there" (or "about it") before essere, volere, andare, credere, pensare …; "us", "you" otherwise
//   via       "away" after a verb, the street after an article or preposition, "come on!" standing apart
//   se        the pronoun before ne, lo, la (se ne andò, se lo mangiò), "if" before a subjunctive or another person
//   quello, altro, loro, uno: the determiner before a noun, the pronoun standing for one
//   male, pure, fin, bisogna, presto, circa, intanto, prima, piuttosto, cosa, ei: by the word before or after
//   a plural noun or adjective with no determiner, after its subject, is the verb (Pinocchio chiese, — riprese, Pinocchio
//   corse); gli before such a verb is "to him"; after a determiner a noun, not a verb spelled alike (un altro anno)
//   a noun that is also an adjective's form (signora, signore's "great") is the noun when nothing follows it to describe
//   ah, eh and a word exclaimed alone are interjections (Ah, un pajo d'ali!; — Basta!)
//   lo, la, li, le, gli, l': the article before a noun of their gender and number, the pronoun before a verb (lo prese)
//   a word after an article of its gender and number (il conte zio, la grida); a title after signor (signor curato)
//   Manzoni's ne', da' (nei, dai before a masculine plural), essi, par, quantunque, bravi (henchmen), stessi, volse
//   s'era alzato, si era addormentato: a reflexive's compound tense; a modal lends its si to the infinitive (si volesse
//   vendicare); a number before what it counts (venti paia); an obsolete form or a rare lemma gives way (sonno, girò)
import { CONTEXT_MARGIN, isFiniteVerb, isNounish, isParticiple, type ContextChoice, type ContextQuery, type ContextReading, type ContextRule, type ContextWord } from './context';

/** Before a noun: what makes a word after it a noun, not a verb or an adverb. */
const NOUN_SLOT = new Set(['article', 'determiner', 'contraction', 'preposition', 'adjective', 'numeral']);
/** The object pronouns that stand before a verb, elided or not. */
const CLITICS = new Set(['mi', 'ti', 'si', 'ci', 'vi', 'ne', 'lo', 'la', 'li', 'le', 'gli', "m'", "t'", "s'", "c'", "v'", "n'", "l'",
  'glielo', 'gliela', 'glieli', 'gliele', 'gliene', "gliel'"]);
/** The forms they take before lo, la, ne: me lo, te la, se ne, ce n'è. */
const CLUSTER_FIRST = new Set(['me', 'te', 'se', 'ce', 've']);

/**
 * How near (in nats) a noun must come to the adjective's form spelled alike to be read instead of it: before a name or a verb
 * (signora 0.2, but grossa 1.2, bella 2.7), and standing alone (vecchia 0.9).
 */
const NEAR = 0.5;
const APART_NOUN = 3;
/** How far below a verb a noun spelled alike may be and still be read after a demonstrative (quelle grida: 3.3). */
const NOUN_UNDER_VERB = 4;
const decisive = (prefer: (r: ContextReading) => boolean): ContextChoice => ({ prefer, margin: Infinity });
const pos = (p: string) => (r: ContextReading): boolean => r.pos === p;
const chosenPos = (w: ContextWord | undefined): string => w?.chosen?.pos ?? '';
const topPos = (w: ContextWord | undefined): string => w?.readings[0]?.pos ?? '';
const forms = (r: ContextReading): string[] => (r.form ? r.form.split('; ') : []);
/** A form with a person: fu, chiese, andasse. A participle or infinitive spelled alike does not count (prese the participle). */
const finite = (r: ContextReading): boolean => r.pos === 'verb' && forms(r).some((f) => /\b(?:first|second|third)-person\b/.test(f));
const finiteForms = (w: ContextWord | undefined): string[] =>
  (w?.readings ?? []).filter(finite).flatMap((r) => forms(r).filter((f) => /\b(?:first|second|third)-person\b/.test(f)));
const isVerbWord = (w: ContextWord | undefined): boolean => !!w && w.readings.some(finite);
/**
 * The word reads as a noun, an adjective, a number or a name: what a determiner stands before. A noun of its own spelling
 * counts too, however likely another reading: "tutt'altra cosa" (cosa reads first as "what?").
 */
const nounish = (w: ContextWord | undefined): boolean =>
  !!w && (w.name || (w.readings.length > 0 && (isNounish(w.readings[0]) || (w.readings[0].pos === 'determiner' && !CLITICS.has(w.low))
    || (w.readings[0].pos === 'pronoun' && !CLITICS.has(w.low) && w.readings.some((r) => r.pos === 'noun' && !r.form)))));
/** The word stands apart: a mark or the sentence's start before it, a mark or the end after it (— Ah! …; Ma, via, che …). */
const apart = (q: ContextQuery): boolean => (q.sentenceStart || q.word.before !== '') && (q.word.after !== '' || q.at === q.words.length - 1);
/** The sentence ends with an exclamation mark: "Come mi sentivo leggero!" */
const exclaims = (q: ContextQuery): boolean => /!/.test(q.words[q.words.length - 1]?.after ?? '');
/** The word after next, when only space separates them all: the verb of "se lo mangiò", "ci si calan". */
const afterNext = (q: ContextQuery): ContextWord | undefined =>
  q.next && q.next.after === '' && q.at + 2 < q.words.length ? q.words[q.at + 2] : undefined;
const key = (w: ContextWord | undefined): string => w?.readings[0]?.key ?? '';

// ---------------------------------------------------------------------------------------------------------- come ---

/** Verbs a question in indirect speech follows: "non sapeva come fare", "Figuratevi come rimase", "Ecco come". */
const ASKING = new Set(['sapere', 'capire', 'vedere', 'guardare', 'dire', 'domandare', 'chiedere', 'spiegare',
  'raccontare', 'insegnare', 'mostrare', 'immaginare', 'figurare', 'figurarsi', 'pensare', 'ricordare', 'indovinare',
  'intendere', 'comprendere', 'notare', 'osservare', 'accorgersi', 'considerare', 'imparare', 'ecco', 'domandarsi', 'chiedersi',
  'immaginarsi']);

/** The words a question at the start of a sentence opens with: "E come hai fatto a scappare?", "Ma come si fa per averlo?" */
const OPENERS = new Set(['e', 'ed', 'ma', 'o', 'eppure', 'allora', 'or', 'ora', 'dunque']);
/** Subject pronouns, which a question in indirect speech may put before its verb: "Guardi come lei mi tratta!" */
const SUBJECTS = new Set(['io', 'tu', 'lui', 'lei', 'egli', 'ella', 'noi', 'voi', 'loro', 'essi', 'esse', 'ei']);
/** Pronouns that are also articles: a verb must follow for them to be pronouns ("come la madre" is like the mother). */
const ARTICLE_TOO = new Set(['lo', 'la', 'li', 'le', 'gli', "l'"]);

/** The word reads first as a verb that is conjugated or an infinitive: not a participle, nor a noun spelled like a verb. */
const verbFirst = (w: ContextWord | undefined): boolean => {
  const r = w?.readings[0];
  return !!r && r.pos === 'verb' && (finite(r) || !r.form || /\binfinitive\b/.test(r.form));
};

/**
 * The verb after come, past its pronouns, non and mai: "come hai fatto", "come si chiama", "come me lo figuro", "come mai
 * sei qui?", "come fare a chetarlo". Undefined when a noun, an article or a participle comes first ("mi sentivo come
 * trattenuto", as if held back); with `subject`, a subject pronoun may come first too ("Guardi come lei mi tratta!").
 */
function comeVerb(q: ContextQuery, subject: boolean): ContextWord | undefined {
  for (let i = q.at + 1, n = 0; i < q.words.length && q.words[i - 1].after === '' && n < 4; i++, n++) {
    const w = q.words[i];
    if (verbFirst(w)) return w;
    const next = q.words[i + 1];
    const verbNext = w.after === '' && !!next;
    if (ARTICLE_TOO.has(w.low) || CLUSTER_FIRST.has(w.low)) {
      if (!verbNext) return undefined;
      continue;
    }
    if (CLITICS.has(w.low) || ['non', 'mai', 'pur', 'pure'].includes(w.low) || (subject && n === 0 && SUBJECTS.has(w.low))) continue;
    return undefined;
  }
  return undefined;
}

/**
 * A verb of knowing, asking or telling right before come, with at most an adverb or a pronoun between: "non sapeva come
 * fare a chetarlo", "Lo sapeva bene come stavo!", "Figuratevi come rimase", "Ecco come vanno le cose!".
 */
function asked(q: ContextQuery): boolean {
  if (q.word.before !== '') return false;
  for (let i = q.at - 1, between = 0; i >= 0 && between <= 2; i--, between++) {
    const w = q.words[i];
    if (ASKING.has(w.chosen?.key ?? '') || ASKING.has(w.low)) return true;
    // "Immaginatevi dunque come restò", "raccontami piuttosto come vi siete sposati".
    const between = w.readings.some((r) => r.pos === 'adverb') || CLITICS.has(w.low) || SUBJECTS.has(w.low) || w.low === 'dunque';
    if (w.before !== '' || !between) return false;
  }
  return false;
}

/**
 * come heads its sentence, or a quotation in it, with at most e, ma, ora … before it: "— E come hai fatto a scappare?", "—
 * Oh, a proposito, — mi domandò mio fratello, — e come hai fatto, in tutto questo tempo, per...".
 */
function heads(q: ContextQuery): boolean {
  if (q.sentenceStart) return true;
  for (let i = q.at - 1; i >= 0; i--) {
    const w = q.words[i];
    if (!OPENERS.has(w.low)) return false;
    if (i === 0 || /[—«“"]/.test(w.before)) return true;
  }
  return true;
}

/**
 * The verb closes a clause of its own: a comma, a semicolon or a colon after it, or after the participle, infinitive or
 * subject that follow it. "Come vedi, è tutto pieno!", "Come potete immaginarvelo, la Fata lasciò …", "Come vuol lei; ma
 * guardi", "va' a buttarlo dalla finestra, come ho fatto io, capisci?": a parenthesis, as you see.
 */
function aside(q: ContextQuery, verb: ContextWord): boolean {
  const j = q.words.indexOf(verb);
  for (let k = j; k < q.words.length && k <= j + 2; k++) {
    const w = q.words[k];
    if (k > j && !(SUBJECTS.has(w.low) || w.readings[0]?.pos === 'verb')) return false;
    if (/^[,;:—–]/.test(w.after)) return true;
    if (w.after !== '') return false;
  }
  return false;
}

/**
 * come asks ("how") or compares ("like, as"). It compares before a noun, a pronoun or se: "si divincolava come un'anguilla",
 * "come se fosse un cane di guardia", "Perchè non sono malpelo come te!". Before a verb it asks after a verb of knowing or
 * telling ("non sapeva come fare a chetarlo", "Figuratevi come rimase"), opening a question ("E come hai fatto a scappare?")
 * or an exclamation ("Come mi sentivo leggero!") and as a noun ("il conto del come avrebbe speso"); alone it is "What!" ("—
 * Come! Che legge è questa?"). Otherwise it compares: "sacrificarsi come ha fatto sua madre", "un metro come sei tu", a
 * parenthesis ("Come vedi, è tutto pieno!"); before a past subjunctive it is "as if" ("buttava a manate oro e argento, come
 * fossero rena"), and opening a sentence before a past historic "as soon as" ("Come aprì il cassetto").
 */
function comeAsks(q: ContextQuery): boolean {
  if (['article', 'contraction'].includes(chosenPos(q.prev))) return true;
  const ask = asked(q);
  const head = heads(q);
  // Or at a clause's head after a mark in a question ("allora io, scusi, come mi trovo?"), or in an exclamation after an
  // interjection ("Eh via, come sei sciocchina!", but "Ecco un paese, come piace veramente a me!").
  const opens = head || q.word.before !== '';
  const exclaimed = head || (q.word.before !== '' && chosenPos(q.words[0]) === 'interjection');
  if (!q.next) return ask || head || /^[!?]/.test(q.word.after);
  const verb = comeVerb(q, ask);
  if (!verb && !['no', 'mai', 'diavolo'].includes(q.next.low)) return false;
  if (ask || (head && q.question)) return true;
  const f = finiteForms(verb);
  if (!head && f.length && f.every((x) => /\b(?:imperfect|pluperfect) subjunctive\b/.test(x))) return false;
  if (verb && aside(q, verb)) return false;
  if ((opens && q.question) || (exclaimed && exclaims(q))) return true;
  // "Come rimanesse il burattino, quand'ebbe compitate alla peggio quelle quattro parole": how.
  if (head) return f.some((x) => /subjunctive/.test(x)) && !f.some((x) => /past historic/.test(x));
  return false;
}

// -------------------------------------------------------------------------------------------------------- ci, vi ---

/** Verbs ci stands for a place or a thing with: ci sono, ci vuole, ci torno, ci credo, ci penso, ci riusciamo. */
const PLACE_VERBS = new Set(['essere', 'esserci', 'volere', 'volerci', 'stare', 'andare', 'venire', 'tornare', 'ritornare', 'entrare',
  'arrivare', 'restare', 'rimanere', 'vivere', 'abitare', 'morire', 'cascare', 'ricascare', 'cadere', 'passare', 'salire',
  'scendere', 'mettere', 'metterci', 'credere', 'pensare', 'ripensare', 'badare', 'riuscire', 'giocare', 'sperare', 'contare',
  'tenere', 'scapitare', 'durare', 'trovarsi', 'provare', 'piovere', 'correre', 'nascere']);
/** ci and vi joined to a verb of place are "there" on the card: "Tu, Renzo, procura di venirci" (I promessi sposi). */
export function italianCliticPart(verbKey: string, clitic: string): 'pronoun' | 'adverb' {
  return (clitic === 'ci' || clitic === 'vi') && PLACE_VERBS.has(verbKey) && !['credere', 'pensare', 'ripensare', 'badare', 'sperare', 'contare'].includes(verbKey) ? 'adverb' : 'pronoun';
}
/** Of those, the ones a "we" does not make reflexive: "ci andremo" is there, "ci mettemmo a ridere" ourselves. */
const PLACE_EVEN_WE = new Set(['essere', 'esserci', 'andare', 'venire', 'tornare', 'ritornare', 'entrare', 'arrivare', 'restare',
  'rimanere', 'vivere', 'stare', 'credere', 'pensare', 'riuscire', 'volere']);

/** The verb a clitic leans on, past the other clitics (ci si calan, ce n'è, ce l'ho), and the word after it. */
function verbOf(q: ContextQuery): [ContextWord | undefined, ContextWord | undefined] {
  let i = q.at + 1;
  while (i < q.words.length && q.words[i - 1].after === '' && (CLITICS.has(q.words[i].low) || CLUSTER_FIRST.has(q.words[i].low)) && i - q.at < 3) i++;
  if (i >= q.words.length || q.words[i - 1].after !== '') return [undefined, undefined];
  const v = q.words[i];
  const w = q.words[i + 1] && v.after === '' ? q.words[i + 1] : undefined;
  return [v, w];
}

/**
 * ci (c', ce) is "there" or "about it" with a verb of being, going, staying, believing or thinking ("Qui non ci sono
 * signori!", "ci vuol pazienza", "Ma si sa che ci torno!", "io non ci credo", "Ci avevo pensato"), after mi or ti ("Ti ci
 * porto io") and before si or ne ("come ci si giocasse", "ce n'era"); otherwise "us" or "ourselves" ("Ci farà un bene",
 * "lì ci divertiremo"). A "we" makes most verbs reflexive: "ci accordammo subito".
 */
function ciThere(q: ContextQuery): string {
  if (['mi', 'ti', "m'", "t'"].includes(q.prev?.low ?? '')) return 'there';
  const n = q.next?.low ?? '';
  if (['si', "s'", 'ne', "n'"].includes(n)) return 'there';
  const [v] = verbOf(q);
  if (!v) return '';
  const fs = finiteForms(v);
  // The verb that says: past an auxiliary and the adverbs after it to its participle ("Ci avevo pensato", "che ci avesse
  // tanto impressionato", "ci siamo a poco a poco adattati"), past a modal to its infinitive ("Non ci ha voluto dire", "non
  // ci voglio venire", "ci possano esser regole", "non ci so credere").
  let i = q.words.indexOf(v);
  let k = key(v);
  let participle = false;
  for (let step = 0; step < 2; step++) {
    const aux = k === 'avere' || k === 'essere';
    const modal = ['potere', 'dovere', 'volere', 'sapere'].includes(k);
    if (!aux && !modal) break;
    let j = i + 1;
    while (j < q.words.length && j - i <= 4 && q.words[j - 1].after === '' && !q.words[j].readings.some((r) => r.pos === 'verb')) j++;
    const w = j < q.words.length && q.words[j - 1].after === '' && j - i <= 4 ? q.words[j] : undefined;
    const r = w?.readings.find((x) => x.pos === 'verb' && (aux ? /\bpast participle\b/.test(x.form) : !x.form || /\binfinitive\b/.test(x.form)));
    if (!w || !r) break;
    i = j;
    k = r.key;
    participle ||= aux;
  }
  // avere alone is "there": "Io ci ho anche questo", "lei ci avrà parenti", "ci aveva due piaghe alle gambe".
  if (k === 'avere' && !participle) return 'there';
  // essere says "there" whatever participle follows ("Che ci sia nascosto dentro qualcuno?", "Non ci sarebbe mancato
  // altro!"), but "ci siamo divertiti" is ourselves.
  if (key(v) === 'essere') return participle && fs.every((f) => /first-person plural/.test(f)) ? '' : 'there';
  if (!PLACE_VERBS.has(k)) return '';
  return !fs.length || !fs.every((f) => /first-person plural/.test(f)) || PLACE_EVEN_WE.has(k) ? k : '';
}

/** Verbs whose ci is "about it", not "there": "io non ci credo", "Ci avevo pensato". */
const CI_ABOUT = new Set(['credere', 'pensare', 'ripensare', 'badare', 'sperare', 'contare']);

/** Verbs vi is "there" with: going, staying, succeeding in it. */
const VI_PLACE = new Set(['andare', 'venire', 'tornare', 'ritornare', 'entrare', 'arrivare', 'restare', 'rimanere', 'stare',
  'salire', 'scendere', 'montare', 'riuscire']);

/**
 * vi is "there" before a form of essere ("v'era un volume") or si ("vi si tratteneva per ore intere"), with a verb of going
 * or staying, and in narration before a past historic or imperfect of the third person ("raccolto un fastello di legna …, vi
 * appiccarono il fuoco"); "you" otherwise: "Vi prometto, babbo", "Ecco la colazione che vi manda la Fata", "Chi vi offende?".
 */
function viThere(q: ContextQuery): boolean {
  if (['si', "s'"].includes(q.next?.low ?? '')) return true;
  const [v] = verbOf(q);
  if (!v) return false;
  const fs = finiteForms(v);
  if (!fs.length || fs.some((f) => /second-person plural/.test(f))) return false;
  // "Oggi è impossibile: vi anderò un altro giorno", "pareva vi riuscisse a meraviglia": going there, succeeding in it.
  if (key(v) === 'essere' || VI_PLACE.has(key(v))) return true;
  return fs.every((f) => /third-person/.test(f) && /past historic|imperfect indicative|imperfect subjunctive/.test(f));
}

// ------------------------------------------------------------------------------------------------------------- se ---

/**
 * se before ne, lo, la, li, le and a verb of the third person is the pronoun: "e se ne andarono", "se lo mangiò in un
 * boccone", "se la passavano bene". Before a past subjunctive or a first or second person it is "if": "o non sarebbe più
 * saporito se lo friggessi in padella?", "se le incontri per la strada". Before an article it is "if" too, which the
 * article's own reading decides (se la nipote del marchese): only a verb after the pronoun counts.
 */
function sePronoun(q: ContextQuery): boolean | null {
  const n = q.next?.low ?? '';
  const ne = n === 'ne' || n === "n'";
  if (!ne && !['lo', 'la', 'li', 'le', "l'"].includes(n)) return null;
  const v = afterNext(q);
  const fs = finiteForms(v);
  if (!fs.length) return ne ? true : null;
  // A word that is first a noun (se la nipote, se l'umanità) leaves la to be the article.
  if (!ne && v && v.readings[0]?.pos !== 'verb') return null;
  const third = fs.filter((f) => /\bthird-person\b|\/third-person/.test(f));
  // "aspettando che il serpente se ne andasse": with ne, any mood; with lo or la, not a subjunctive ("se le incontri per la
  // strada", if you meet them).
  return third.some((f) => ne || !/subjunctive|imperative/.test(f));
}

// ---------------------------------------------------------------------------------------------- determiner or not ---

/**
 * A word that is a determiner before a noun and a pronoun standing alone: "quella vocina" (that), but "tutto quello che"
 * (that which); "fece altri due starnuti" (two more), but "come tutti gli altri" (the others); "le loro faccende" (their),
 * but "promise loro un bellissimo regalo" (them). loro after its noun is "their" too: "a modo loro".
 */
function determinerHere(q: ContextQuery): boolean {
  if (q.word.low === 'loro') {
    if (['article', 'contraction', 'determiner'].includes(chosenPos(q.prev))) return true;
    if (q.prev && q.word.before === '' && ['noun'].includes(chosenPos(q.prev))) return true;
    return nounish(q.next) && !['verb', 'preposition'].includes(chosenPos(q.prev)) && !q.next!.name;
  }
  const n = q.next;
  if (!n) return false;
  if (nounish(n)) return true;
  // A word the dictionary lacks is a noun it has with a suffix: "quelle risatacce grulle", "quelle carnucce tènere".
  if (!n.readings.length) return /^\p{Ll}/u.test(n.text);
  // quegli before a verb is "that man": "Quegli chiuse gli occhi".
  if (q.word.low === 'quegli' && finite(n.readings[0])) return false;
  // A noun read first as a verb, but not much less likely than the verb: "quella veste da camera", "A quelle grida
  // strazianti" (gridare's grida 3.3 nats likelier), not "Ma quella era la notte degl'incontri" (era "age", 12 nats).
  const top = n.readings[0];
  return !CLITICS.has(n.low) && !['pronoun', 'conjunction', 'preposition', 'adverb', 'article', 'contraction'].includes(top.pos)
    && n.readings.some((r) => (r.pos === 'noun' || r.pos === 'adjective') && r.score > top.score - NOUN_UNDER_VERB);
}

// ------------------------------------------------------------------------------------------ article or pronoun ---

/** What a word before a noun asks of it: its gender ('' for either) and number. */
interface Asks { g: '' | 'm' | 'f'; pl: boolean | null }
const M_SG: Asks = { g: 'm', pl: false };
const F_SG: Asks = { g: 'f', pl: false };
const SG: Asks = { g: '', pl: false };
/** Manzoni elides le too: "presentaron l'arme", "depon l'armi", "L'immagini più recenti". */
const ANY: Asks = { g: '', pl: null };
const M_PL: Asks = { g: 'm', pl: true };
const F_PL: Asks = { g: 'f', pl: true };
/**
 * The articles, the contractions of a preposition with one and the demonstratives, by what they ask of the noun after them.
 * Manzoni's de', a', da', ne', co', su', pe', que' are the masculine plural ones clipped: "individui della specie de' bravi".
 */
const ASKS: Record<string, Asks> = {};
for (const [asks, words] of [
  [M_SG, 'il lo un uno del dello al allo dal dallo nel nello sul sullo col collo pel quel quello questo codesto'],
  [F_SG, 'la una della alla dalla nella sulla colla quella questa codesta'],
  [SG, "un'"],
  [ANY, "l' dell' all' dall' nell' sull' coll' quell' quest'"],
  [M_PL, "i gli li dei degli ai agli dai dagli nei negli sui sugli coi cogli de' a' da' ne' co' su' pe' que' quei quegli questi"],
  [F_PL, 'le delle alle dalle nelle sulle colle quelle queste'],
] as [Asks, string][]) for (const w of words.split(' ')) ASKS[w] = asks;

/** A noun that names one thing or many alike: città, re, crisi, specie, bontà. */
const INVARIABLE = /(?:[àèéìòùy]|[^aeiouàèéìòù]|i|ie)$/;

/**
 * The reading can stand after a word that asks `a` of it: a noun, adjective, determiner, numeral or participle of its gender
 * and number. "il conte zio" is the count (masculine), not conto's feminine plural "known"; "la grida" (Manzoni's edict) is
 * feminine singular, not grido's plural "cries"; "le braccia" is a masculine noun's plural in -a.
 */
function fits(r: ContextReading, text: string, a: Asks): boolean {
  if (r.pos === 'proper noun') return true;
  const low = text.toLowerCase();
  const f = r.form;
  if (r.pos === 'noun') {
    const pl = /\bplural\b/.test(f) || r.gender === 'pl';
    if (a.pl !== null && pl !== a.pl && !(!f && INVARIABLE.test(low))) return false;
    if (!a.g) return true;
    if (a.g === 'f' && pl && /a$/.test(low)) return true;
    const g = /\bfeminine\b/.test(f) ? 'f' : /\bmasculine\b/.test(f) ? 'm' : r.gender;
    return !g || g === 'pl' || g === 'm/f' || g.includes(a.g);
  }
  const participle = r.pos === 'verb' && /\bpast participle\b/.test(f);
  if (!['adjective', 'determiner', 'numeral', 'pronoun'].includes(r.pos) && !participle) return false;
  if (r.pos === 'numeral') return a.pl === null || a.pl !== ['uno', 'una', 'un', "un'"].includes(low);
  // loro, altrui stand before one thing or many: "le loro faccende", "da' loro panni".
  const pl = /\bplural\b/.test(f) ? true : ['loro', 'altrui'].includes(low) ? null : f || /o$/.test(low) || /e$/.test(low) ? false : null;
  if (pl !== null && a.pl !== null && pl !== a.pl) return false;
  const g = /\bfeminine\b/.test(f) ? 'f' : /\bmasculine\b/.test(f) || (!f && /o$/.test(low)) ? 'm' : '';
  return !a.g || !g || g === a.g;
}

/** What the word before asks of this one, when it is read as an article, a contraction or a determiner. */
function asksOf(w: ContextWord | undefined): Asks | undefined {
  if (!w || !['article', 'contraction', 'determiner'].includes(w.chosen?.pos ?? '')) return undefined;
  return ASKS[w.low];
}

/** The best score among the readings that pass `ok`, -Infinity when none does. */
const best = (w: ContextWord, ok: (r: ContextReading) => boolean): number =>
  w.readings.reduce((m, r) => (ok(r) && r.score > m ? r.score : m), -Infinity);

/** Relatives and conjunctions, after which an article and its noun are as likely as a pronoun and its verb. */
const RELATIVES = new Set(['che', "ch'", 'cui', 'quale', 'quali']);
/** How much likelier a verb must be than a noun that agrees to make the word before it a pronoun (core.ts's ARTICLE_MARGIN). */
const ARTICLE_MARGIN = 2;
/** The words that are the article or the object pronoun. */
const ARTICLE_OR_PRONOUN = new Set(['lo', 'la', 'li', 'le', 'gli', "l'"]);

/**
 * The word before makes a la, lo, gli after it an object pronoun: a clitic read as one ("me lo", but not se "if": "se la cosa
 * era vera"), non, a name or a subject pronoun that is no preposition's object ("Geppetto lo prese", but "disse fra sè il
 * burattino").
 */
function pronounBefore(q: ContextQuery): boolean {
  const p = q.prev;
  if (!p) return false;
  // chi is who does it: "A chi la tocca, la tocca".
  if (p.name || p.low === 'non' || p.low === 'chi') return true;
  const pp = chosenPos(p);
  if (CLITICS.has(p.low) || CLUSTER_FIRST.has(p.low)) return pp === 'pronoun' || pp === 'adverb';
  if (pp !== 'pronoun' || RELATIVES.has(p.low)) return false;
  const before = q.at > 0 && p.before === '' ? q.words[q.at - 2] : undefined;
  return !before || !['preposition', 'contraction'].includes(chosenPos(before));
}

/**
 * lo, la, li, le, gli, l' are the article before a word that can be their noun (of their gender and number) and the object
 * pronoun before a verb: "Geppetto lo prese per il collo" (prese, plural, cannot follow lo), "li richiuse subito", "gli
 * fosse uscita", "gli si fosse allargato" (before another clitic: to him). Where the next word can be both, a pronoun, non or
 * a name before makes the pronoun ("Non me lo dire", "Geppetto la porta"); a preposition the article; after che, cui or
 * nothing the likelier of the noun and the verb: "chi si rallegrava che la cosa fosse finita bene" (the thing, not cosare's
 * "does something"), "che la gente accorresse", "che l'acqua".
 */
function articleOrPronoun(q: ContextQuery): ContextChoice | null {
  const w = q.word;
  const a = ASKS[w.low];
  const n = q.next;
  if (!ARTICLE_OR_PRONOUN.has(w.low) || !n || !w.readings.some(pos('article')) || !w.readings.some(pos('pronoun'))) return null;
  if (n.name) return decisive(pos('article'));
  if (['si', "s'", 'ne', "n'"].includes(n.low)) return decisive(pos('pronoun'));
  // "la più bella", "per lo più", "gli stessi occhi": the adverb of degree, or stesso, before the noun.
  if (['più', 'meno', 'stesso', 'stessa', 'stessi', 'stesse'].includes(n.low)) return decisive(pos('article'));
  const noun = best(n, (r) => fits(r, n.text, a));
  const before = pronounBefore(q);
  // "Non me lo dire": an infinitive is an order after non.
  const verbAll = best(n, (r) => finite(r) || (before && r.pos === 'verb' && (!r.form || /\binfinitive\b/.test(r.form))));
  if (noun === -Infinity) return verbAll === -Infinity ? null : decisive(pos('pronoun'));
  // A preposition or tutto before: "per la strada", "tutti gli altri". Not a demonstrative standing alone: "Questo lo so".
  if (verbAll === -Infinity || ['preposition', 'contraction', 'article'].includes(chosenPos(q.prev))
    || (chosenPos(q.prev) === 'determiner' && q.prev!.chosen!.key === 'tutto')) return decisive(pos('article'));
  // An adjective and its noun after it, both agreeing, are the article's: "se non le precise parole" (precidere's "cut
  // off" being far likelier alone).
  const nn = afterNext(q);
  if (nn && n.readings.some((r) => ['adjective', 'determiner', 'numeral'].includes(r.pos) && fits(r, n.text, a))
    && nn.readings[0]?.pos === 'noun' && fits(nn.readings[0], nn.text, a)) return decisive(pos('article'));
  if (before) return decisive(pos('pronoun'));
  // A subjunctive or an order is the verb only after che or a conjunction, where a clause starts: "levantéme la venda"
  // (Spanish) is the bandage.
  const loose = RELATIVES.has(q.prev?.low ?? '') || chosenPos(q.prev) === 'conjunction';
  const verb = loose ? verbAll : best(n, (r) => finite(r) && forms(r).some((f) => !/subjunctive|imperative/.test(f) || /indicative/.test(f)));
  return decisive(pos(verb > noun + ARTICLE_MARGIN ? 'pronoun' : 'article'));
}

/** An adjective's form can describe the noun: the same number, and the gender the noun has ("le porte chiuse"). */
function agrees(noun: ContextReading, adj: ContextReading): boolean {
  const nounPlural = /\bplural\b/.test(noun.form) || noun.gender === 'pl';
  if (nounPlural !== /\bplural\b/.test(adj.form)) return false;
  const g = /\bfeminine\b/.test(noun.form) ? 'f' : noun.gender;
  const a = /\bfeminine\b/.test(adj.form) ? 'f' : /\bmasculine\b/.test(adj.form) ? 'm' : '';
  return !a || !g || g === 'pl' || g.includes(a);
}

// ------------------------------------------------------------------------------------------------- the rest ---

/**
 * cosa is a thing where it is named rather than asked about: after essere, come or a preposition ("era cosa troppo
 * evidente", "come cosa sua", "in cosa che li toccasse"), and before what describes it ("stimò cosa prudente", "e cosa
 * veramente enorme", "cosa della quale"). Before a verb it asks: "Ma cosa volete fare?", "a cosa davano un calcio".
 */
function cosaThing(q: ContextQuery): boolean {
  const n = q.next;
  if (n && (verbFirst(n) || CLITICS.has(n.low) || ['mai', 'non', 'ne', "n'"].includes(n.low))) return false;
  if (q.prev?.chosen?.key === 'essere' || ['come', "com'", 'qual'].includes(q.prev?.low ?? '') || chosenPos(q.prev) === 'preposition') return true;
  const r = n?.readings[0];
  if (!r) return false;
  if (r.pos === 'adjective' || isParticiple(r) || ['che', "ch'", 'cui', 'della', 'alla', 'dalla', 'nella'].includes(n!.low)) return true;
  // A relative after a preposition ("quella storia, cosa di cui si curasse meno"), an adverb of degree and its adjective
  // ("cosa troppo evidente").
  if (r.pos === 'preposition' && ['cui', 'quale'].includes(afterNext(q)?.low ?? '')) return true;
  const a = afterNext(q)?.readings[0];
  return r.pos === 'adverb' && !!a && (a.pos === 'adjective' || isParticiple(a));
}

/**
 * The honorifics that stand before a name or another title: signor curato, signora badessa. Not padre or frate, which an
 * order's adjective follows: "un frate cappuccino" (Capuchin).
 */
const TITLES = new Set(['signor', 'signora', 'signori', 'sor', 'monsignor', 'monsignore']);
/** Lemmas the dictionary ranks as if they were common, whose forms are a common verb's too: gire (archaic "to go"). */
const RARE_LEMMAS = new Set(['gire']);
const MODALS = new Set(['volere', 'potere', 'dovere', 'sapere']);

/**
 * The word is a participle after a form of essere that si (s') comes before, with at most two adverbs between: "s'era
 * fieramente ribellato", "si era addormentato", "s'è visto".
 */
function reflexiveAux(q: ContextQuery): boolean {
  for (let i = q.at - 1, between = 0; i >= 1 && q.words[i].after === '' && between <= 2; i--, between++) {
    const w = q.words[i];
    if (w.chosen?.key === 'essere') return ['si', "s'"].includes(q.words[i - 1].low) && q.words[i - 1].after === '';
    if (chosenPos(w) !== 'adverb') return false;
  }
  return false;
}

/** An infinitive comes next, past the clitics: "si volesse vendicare", "si voleva metter riparo". */
function infinitiveAfter(q: ContextQuery): boolean {
  for (let i = q.at + 1; i < q.words.length && q.words[i - 1].after === '' && i - q.at <= 3; i++) {
    const w = q.words[i];
    if (w.readings.some((r) => r.pos === 'verb' && (!r.form || /\binfinitive\b/.test(r.form)))) return true;
    if (!CLITICS.has(w.low) && !['non', 'più', 'mai', 'pur', 'anche'].includes(w.low)) return false;
  }
  return false;
}

// ------------------------------------------------------------------------------------------------- the rule itself ---

/**
 * A fixed phrase the words around a verb undo (ContextChoice.noPhrase). volere dire is "to mean" with nothing said to anyone
 * and nothing said already: "E io la prego di volermi dire se si possa far loro del bene" (I promessi sposi), "Non ci ha
 * voluto dire, intanto, donde le fosse venuto quell'anellino" (Il fu Mattia Pascal), "lo voglio dire" want to tell, to say.
 * "vuol dire un cervello bizzarro" means one.
 */
function phraseUndone(q: ContextQuery): boolean {
  const verb = q.word.readings.find((r) => r.pos === 'verb');
  const next = q.next;
  if (!verb || verb.key !== 'volere' || !next || !/^dir(?:e|lo|la|gli|mi|ti|ci|vi|le|ne)?$/.test(next.low)) return false;
  // A pronoun on volere (volermi), or before it past its auxiliary: "ce lo vuoi dire", "Non ci ha voluto dire". Not the
  // conjunction se: "come se volesse dire".
  if (/^voler(?:mi|ti|ci|vi|gli|lo|la|li|le|ne|celo|melo|telo)$/.test(q.word.low)) return true;
  for (let i = q.at - 1; i >= 0 && i >= q.at - 3 && !q.words[i].after; i--) {
    const x = q.words[i];
    if (CLITICS.has(x.low) || /^(?:me|te|ce|ve|glie)$/.test(x.low)) return true;
    if (!['avere', 'essere'].includes(x.chosen?.key ?? '')) break;
  }
  return false;
}

/** A reflexive pronoun stands before the verb, past the pronouns between (se ne accorse), or is joined to it (accortosi). */
function ownPronoun(q: ContextQuery): boolean {
  if (/(?:si|mi|ti|ci|vi|sene|mene|tene|cene|vene)$/.test(q.word.low)) return true;
  for (let i = q.at - 1; i >= 0 && i >= q.at - 3; i--) {
    const x = q.words[i];
    if (x.after && i < q.at - 1) break;
    if (['si', "s'", 'mi', "m'", 'ti', "t'", 'ci', "c'", 'vi', "v'", 'se', 'me', 'te', 'ce', 've'].includes(x.low)) return true;
    if (!CLITICS.has(x.low) && !['ne', "n'", 'non'].includes(x.low)) break;
  }
  return false;
}

export const italianContext: ContextRule = (q) => {
  const choice = italianRules(q);
  return phraseUndone(q) ? { ...(choice ?? { margin: 0 }), noPhrase: true } : choice;
};

const italianRules: ContextRule = (q) => {
  const w = q.word;
  const low = w.low;
  const has = (p: string): boolean => w.readings.some((r) => r.pos === p);
  // A name before is a name, whatever its spelling reads as alone ("Lo stesso giorno Oliva corse piangendo").
  const prevPos = q.prev?.name ? 'proper noun' : chosenPos(q.prev);

  // A pronominal verb's form with no pronoun of its own is the plain verb spelled alike: "Ma a nessuno la gente accorse in
  // numero tale" (I promessi sposi), "Papiano e il Paleari accorsero a trattenermi" (Il fu Mattia Pascal) are accorrere "to
  // rush", not accorgersi "to notice", which "s'accorse" is.
  // A finite form only: a participle stands without its pronoun, "le strade in cui si trovava incamminato", "s'è avvisto".
  if (w.readings.some((r) => isFiniteVerb(r) && r.key.endsWith('rsi')) && w.readings.some((r) => r.pos === 'verb' && !r.key.endsWith('rsi'))
    && !ownPronoun(q)) {
    return decisive((r) => !(r.pos === 'verb' && r.key.endsWith('rsi')));
  }

  // After molto, così, tanto … an adjective: "è cosa molto brutta" (I promessi sposi), not brutta "rough copy".
  if (q.prev && ['molto', 'così', 'cosí', 'troppo', 'assai', 'sì'].includes(q.prev.low) && w.readings.some((r) => r.pos === 'noun')
    && w.readings.some((r) => r.pos === 'adjective') && !w.readings.some((r) => r.pos === 'adverb') && !(q.next && q.next.readings[0]?.pos === 'noun')) {
    return { prefer: (r) => r.pos === 'adjective', margin: CONTEXT_MARGIN };
  }
  // An adjective's feminine or masculine after an article, with nothing after it that could be its noun, is the noun spelled
  // so: "«Oh!» disse la vecchia" (Pinocchio), "era una vecchia di casa" (I promessi sposi) are the old woman, not vecchio's
  // feminine "old". Not before an adjective or a word that may be a noun: "la vecchia casa".
  const lead = w.readings[0];
  const own = w.readings.find((r) => r.pos === 'noun' && !r.form && r.key === low);
  if (own && lead && lead.pos === 'adjective' && /^(?:feminine|masculine)(?: (?:singular|plural))?$/.test(lead.form)
    && prevPos === 'article' && !(q.next && (q.next.readings.some((r) => ['noun', 'adjective', 'proper noun'].includes(r.pos))
      || ['e', 'ed', 'o', 'od'].includes(q.next.low)))) {
    return { prefer: (r) => r === own, margin: 4 };
  }

  switch (low) {
    case 'grida':
      // After a plural determiner or adjective, grido's plural "cries": "un frastono di mille grida di trionfo" (I promessi
      // sposi), "le sue grida", "alte grida". Manzoni's edict is la grida (plural gride).
      if (q.prev && /^(?:le|mille|sue|tue|mie|loro|alte|tante|quelle|queste|delle|alle|dalle|nelle|sulle|colle|molte|poche|altre|due|tre|cento)$/.test(q.prev.low)
        && w.readings.some((r) => r.key === 'grido')) return decisive((r) => r.key === 'grido');
      // After a feminine singular, the edict: "dà fuori un'altra grida, ancor più vigorosa".
      if (q.prev && /^(?:la|una|un'|altra|quella|questa|nuova|ogni|sua|tal|tale|della|alla|nella|colla|quell'|quest')$/.test(q.prev.low)
        && w.readings.some((r) => r.key === 'grida' && r.pos === 'noun')) return decisive((r) => r.key === 'grida' && r.pos === 'noun');
      return null;
    case 'venti':
      // The winds after an article or a preposition with its article, with no noun after it: "verrebbe asciugata da' venti"
      // (Il principe); before a noun, twenty.
      if ((prevPos === 'article' || prevPos === 'contraction' || /^[a-z]+'$/.test(q.prev?.low ?? '')) && !(q.next && q.next.readings[0]?.pos === 'noun')
        && w.readings.some((r) => r.key === 'vento')) return decisive((r) => r.key === 'vento');
      return null;
    case 'come':
    case "com'":
      if (!has('conjunction')) return null;
      return decisive(pos(comeAsks(q) ? 'adverb' : 'conjunction'));
    case 'quello': case 'quella': case 'quelli': case 'quelle': case 'quegli':
    case 'altro': case 'altra': case 'altri': case 'altre': case 'loro':
      if (!has('pronoun') || !has('determiner')) return null;
      return decisive(pos(determinerHere(q) ? 'determiner' : 'pronoun'));
    case 'ci': case "c'": case 'ce': {
      if (!has('adverb')) return null;
      // Its sense where it stands, of the adverb's "there; about it" (ContextChoice.hint).
      const verb = ciThere(q);
      return verb ? { ...decisive(pos('adverb')), hint: CI_ABOUT.has(verb) ? 'about it' : 'there' } : decisive(pos('pronoun'));
    }
    case 'vi': case "v'":
      if (!has('adverb')) return null;
      return decisive(pos(viThere(q) ? 'adverb' : 'pronoun'));
    case 'se': {
      const p = sePronoun(q);
      return p === null ? null : decisive(pos(p ? 'pronoun' : 'conjunction'));
    }
    case 'via':
      // "Non lo buttar via", "se ne volò via": away; "il carro correva sui ciottoli della via maestra", "per via Borgo
      // Nuovo": the street; "Sarebbe un peccato, via!", "Via, via, non ci pensiamo!", "Eh via!": come on.
      if (prevPos === 'verb') return decisive(pos('adverb'));
      if (NOUN_SLOT.has(prevPos)) return decisive(pos('noun'));
      if ((apart(q) || prevPos === 'interjection') && has('interjection')) return decisive(pos('interjection'));
      return decisive(pos('adverb'));
    case 'male':
      // "tu m'hai fatto male!", "il male della scienza", "che c'è di male?": harm; "l'hai trattato così male",
      // "Male, ragazzo mio, male!": badly.
      if (NOUN_SLOT.has(prevPos) || ['fare', 'farsi'].includes(q.prev?.chosen?.key ?? '')) return decisive(pos('noun'));
      return decisive(pos('adverb'));
    case 'pure':
    case 'pur': {
      // "pur dicendo, e con ragione, tanto male" (even while), "sebbene sentisse avvicinarsi la morte, pure sperava" (yet):
      // the conjunction; "Passate pure" (go ahead), "appartiene pure a noi" (also): the adverb.
      // "se pure le fosse mai passata per il capo": even if.
      const gerund = !!q.next?.readings.some((r) => /\bgerund\b/.test(r.form)) || q.prev?.low === 'se';
      const concessive = w.before !== '' && q.words.slice(0, q.at).some((x) => ['sebbene', 'benché', 'benchè', 'quantunque', 'ancorché', 'ancorchè'].includes(x.low));
      if (gerund || concessive) return has('conjunction') ? decisive(pos('conjunction')) : null;
      // After an order heading its clause, "go ahead"; elsewhere "also" (ContextChoice.hint): "Via, fate presto, e venite pure
      // senza timore" (I promessi sposi), "Ma creda pure che è stata una combinazione" (Il fu Mattia Pascal). Not a verb said
      // of nobody, whose form is an imperative's too: "Bisogna pur considerare".
      const c = q.prev?.chosen;
      const head = q.at === 1 || (q.at >= 2 && (OPENERS.has(q.words[q.at - 2].low) || q.words[q.at - 2].after !== ''));
      const order = head && !!c && /\bimperative\b/.test(c.form) && !['bisognare', 'occorrere', 'parere', 'sembrare', 'convenire', 'bastare'].includes(c.key);
      return has('adverb') ? { ...decisive(pos('adverb')), hint: order ? 'go ahead' : 'also, too' } : null;
    }
    case 'fin':
      // fin is fino's clipped form far more than fine's: "me ne ricorderò fin che campo", "fin dalla mattina"; but "alla fin
      // fine" is the end.
      return decisive((r) => (['article', 'contraction', 'determiner', 'adjective'].includes(prevPos) ? r.pos === 'noun' : r.key === 'fino'));
    case 'bisogna':
      // "bisogna sapersela figurare" is bisognare, "it is necessary"; la bisogna "the matter" only after a determiner.
      return decisive(NOUN_SLOT.has(prevPos) && prevPos !== 'preposition' ? pos('noun') : pos('verb'));
    case 'presto':
      // "I ragazzi fanno presto a promettere": quickly; the literary adjective "ready" and the noun "loan" need a determiner.
      return decisive(['article', 'contraction', 'determiner'].includes(prevPos) ? (r) => r.pos !== 'adverb' : pos('adverb'));
    case 'circa':
      // "per circa due anni", "un'ora circa": about; "circa la sua domanda": regarding. A number that reads first as
      // something else counts: "circa sei mila lire" (sei, essere's "you are"), "circa vent'anni".
      if (q.next?.readings.some(pos('numeral')) || ['un', 'uno', 'una', "un'", 'mezzo', "mezz'", "mezz'ora"].includes(q.next?.low ?? '')
        // Numbers the dictionary lacks: "circa trentamila volumi", "circa dugento", "da circa sett'ore", "Circa vent'anni".
        || /^(?:due|tre|quattr|cinqu|sei|sett|ott|nove|diec|dodic|quindic|vent|trent|quarant|cinquant|sessant|settant|ottant|novant|cent|dugent|mille|\d)/.test(q.next?.low ?? '')
        || ['numeral', 'noun'].includes(prevPos)) return decisive(pos('adverb'));
      return null;
    case 'intanto':
      // "intanto che correvano" (while), "Intanto, mentre camminava" (meanwhile).
      return decisive(pos(['che', "ch'"].includes(q.next?.low ?? '') ? 'conjunction' : 'adverb'));
    case 'uno':
      // "uno scherzo affettuoso": a; "disse uno dei carabinieri", "a uno a uno", "Uno, due fiammiferi": one; "Uno però
      // avanzava la supposizione": someone.
      if (['di', 'dei', 'degli', 'delle', 'del', 'della', "d'", "dell'"].includes(q.next?.low ?? '')) return decisive(pos('numeral'));
      // The article uno stands only before s and a consonant, z, gn, ps, pn, x, y (un elsewhere): "cacciò uno strillo
      // acutissimo", "in uno scoppio di pianto", however likelier strillare's "I shout" is; "ne troverai uno poco lontano" is one.
      if (q.next && /^(?:s[^aeiouàèéìòù]|z|gn|ps|pn|x|y|i[aeiouàèéìòù])/.test(q.next.low)
        && q.next.readings.some((r) => r.pos === 'noun' || r.pos === 'adjective')) return decisive(pos('article'));
      // "rammentare ad uno ad uno tutti i maltrattamenti": one by one.
      if (prevPos === 'preposition') return decisive(pos('pronoun'));
      if ((isVerbWord(q.next) && !nounish(q.next)) || ['che', "ch'"].includes(q.next?.low ?? '')) return decisive(pos('pronoun'));
      return decisive(pos('numeral'));
    case 'colla': case 'colle': case 'cogli':
      // Collodi's con + article before its noun: "colla bocca spalancata", "colle mani in terra", "cogli occhi fuori del capo";
      // after an article or a preposition the noun: "un po' di colla sciolta" (glue).
      if (!has('contraction')) return null;
      return decisive(NOUN_SLOT.has(prevPos) ? (r) => r.pos !== 'contraction' : pos('contraction'));
    case 'prima':
      // "per la prima volta", "la sua prima moglie": first; "Prima però di fare il gran salto": before.
      if (['article', 'contraction', 'determiner'].includes(prevPos)) return decisive((r) => r.pos !== 'adverb');
      return null;
    case 'ne':
      // ne before its verb is "of it, some": "Neppur una ne cadeva in fallo", "una ne ho che posso romper subito".
      return has('pronoun') && q.next && (verbFirst(q.next) || CLITICS.has(q.next.low)) ? decisive(pos('pronoun')) : null;
    case 'ben':
      // The clipped bene is the adverb before what it measures: "ne meriterebbe una ben più diffusa e perenne"; but "tutti gli
      // volevano un ben dell'anima" is the good.
      if (!has('adverb') || !q.next?.readings[0]) return null;
      return ['adjective', 'adverb'].includes(topPos(q.next)) || isParticiple(q.next.readings[0]) ? decisive(pos('adverb')) : null;
    case 'piuttosto':
      // "piuttosto che" rather than; otherwise rather, instead: "va' piuttosto a cercarti un po' di lavoro".
      return decisive(pos(['che', "ch'", 'di', "d'"].includes(q.next?.low ?? '') ? 'preposition' : 'adverb'));
    case 'ei':
      // Verga's and Collodi's ei is egli: "ei si caricava Ranocchio sulle spalle", "Ei, che c'era avvezzo alle beffe".
      if (has('pronoun') && (!q.next || CLITICS.has(q.next.low) || q.next.low === 'non' || verbFirst(q.next))) return decisive(pos('pronoun'));
      return null;
    case 'cosa':
      // "un'altra cosa", "qualche cosa", "ogni cosa": a thing; "che cosa vogliono da me?": what.
      if (['article', 'determiner', 'adjective', 'contraction', 'numeral'].includes(prevPos)) return decisive(pos('noun'));
      if (['che', "ch'"].includes(q.prev?.low ?? '')) return decisive(pos('pronoun'));
      return cosaThing(q) ? decisive(pos('noun')) : null;
    case "ne'": case "da'": {
      // Manzoni's and Pirandello's ne' and da' are nei and dai, "in the", "from the", before a masculine plural: "ne' luoghi
      // più terribili", "Stando alla larga da' prepotenti", "da' suoi confratelli". Before anything else ne' is né, nor, and
      // da' the order "give!": "Da' retta a me".
      if (!has('contraction')) return null;
      const n = q.next;
      const plural = !!n && (n.readings.some((r) => fits(r, n.text, M_PL)) || (!n.readings.length && /^\p{Ll}/u.test(n.text)));
      return decisive(plural ? pos('contraction') : (r) => r.pos !== 'contraction');
    }
    case 'essi': case 'esse':
      // "they, them", never essere's: "concepii così misera stima dei libri, sieno essi a stampa o manoscritti", "Una di esse".
      return has('pronoun') ? decisive(pos('pronoun')) : null;
    case 'par':
      // par is pare, "seems", after a pronoun or before che, di and the like: "mi par di vederli", "e il ponte … par che
      // renda", "E ti par poco?"; after an article, a contraction or a preposition it is pari: "al par di", "da par suo".
      // Before a possessive it is pari too: "a un galantuomo par mio", like me.
      if (!has('verb')) return null;
      return decisive(['article', 'contraction', 'preposition', 'determiner'].includes(prevPos) || /^(?:mio|tuo|suo|nostro|vostro)$/.test(q.next?.low ?? '')
        ? (r) => r.pos !== 'verb' : pos('verb'));
    case 'signor': case 'signore': case 'signora': case 'signori':
      // A gentleman, a lady, or the title before a name or another title, never signore's old adjective "great": "Il signor
      // conte si levò per tempo", "E lei, signora, che è di Milano".
      return has('noun') ? decisive(pos('noun')) : null;
    case 'quantunque':
      // "E quantunque quell'annata fosse ancor più scarsa": although. The adverb "to a degree" is all but gone.
      return has('conjunction') ? decisive(pos('conjunction')) : null;
    case 'piú':
      // Pirandello writes più with an acute accent: "non poteva piú, non voleva piú", more, as più is.
      return decisive((r) => r.pos !== 'preposition');
    case 'lungo':
      // Along before an article or a demonstrative ("lungo la strada", "lungo quel muro"), long elsewhere: "gli diventò più
      // lungo", "col collo lungo proteso", "per tirare in lungo il mio matrimonio".
      if (!has('preposition') || !has('adjective')) return null;
      return decisive(prevPos !== 'preposition' && q.next && (q.next.name || ['article', 'contraction', 'determiner'].includes(topPos(q.next))) ? pos('preposition') : pos('adjective'));
    case 'stessi': case 'stesse': {
      // "gli stessi occhi", "le sue stesse grida", "quegli stessi che", "sè stessi": the same, -selves. stare's "stessi" after
      // che, se or come, or before how one stays: "se stessi zitto".
      if (!w.readings.some((r) => r.key === 'stesso')) return null;
      const n = q.next?.readings[0];
      const verb = ['che', "ch'", 'se', 'come', "com'", 'non'].includes(q.prev?.low ?? '') || CLITICS.has(q.prev?.low ?? '')
        ? !n || n.pos === 'adjective' || n.pos === 'adverb' || isParticiple(n) || n.pos === 'preposition' : false;
      if (verb && q.prev?.low !== 'se') return decisive((r) => r.key === 'stare');
      if (NOUN_SLOT.has(prevPos) || ['noun', 'pronoun', 'proper noun'].includes(prevPos) || q.prev?.low === 'se') {
        return decisive(verb ? (r) => r.key === 'stare' : (r) => r.key === 'stesso');
      }
      return null;
    }
    case 'bravo': case 'bravi':
      // Manzoni's henchmen: "individui della specie de' bravi", "Costui, seguito da quattro bravi", "il primo bravo che
      // incontrò". Before a noun or standing alone the adjective and the cry: "un bravo ragazzo", "— Bravo!"; da bravo is
      // "like a good boy": "Su, da bravo, Medoro".
      if (!has('noun') || !['article', 'contraction', 'determiner', 'preposition', 'numeral', 'adjective'].includes(prevPos)
        || topPos(q.next) === 'noun' || q.next?.name || q.prev?.low === 'da') return null;
      return decisive(pos('noun'));
    case 'volse': case 'volsero': case 'volsi': {
      // "si volse indietro", "volse gli occhi": volgere, turned. volse is volere's old past only before an infinitive: "non
      // volse sentir altro".
      if (!w.readings.some((r) => r.key === 'volgere')) return null;
      let i = q.at + 1;
      while (i < q.words.length && q.words[i - 1].after === '' && CLITICS.has(q.words[i].low)) i++;
      const v = q.words[i - 1].after === '' ? q.words[i] : undefined;
      const inf = !!v && v.readings.some((r) => r.pos === 'verb' && (!r.form || /\binfinitive\b/.test(r.form)));
      return decisive((r) => r.key === (inf ? 'volere' : 'volgere'));
    }
    case 'date':
      // "date le specialissime condizioni" (given), "Date qui", "date retta": dare; after an article or a number the dates.
      if (['article', 'contraction', 'determiner', 'numeral', 'adjective', 'preposition'].includes(prevPos)) return null;
      return w.readings.some((r) => r.key === 'dare') ? decisive((r) => r.key === 'dare') : null;
  }

  // The rest is about common words; a name is left to the generic rules.
  if (w.name) return null;

  // An article before a name in mid-sentence, never the pronoun: "— Press'a poco, come la Stia..." (the Stia farm, though
  // stia is also stare's subjunctive).
  if (['la', 'lo', 'le', 'gli', 'li', "l'", 'il', 'i'].includes(low) && q.next?.name && has('article')) return decisive(pos('article'));
  // The article where a noun of its gender and number follows, the pronoun before a verb: "gli chiese il vecchietto"
  // asked him (chiese, feminine, cannot follow gli), "Geppetto lo prese per il collo".
  const ap = articleOrPronoun(q);
  if (ap) return ap;

  const top = w.readings[0];
  if (!top) return null;

  // A reflexive verb's compound tense: "Belluca, la sera avanti, s'era fieramente ribellato al suo capo-ufficio" (had
  // rebelled, not "had incited"), "si era addormentato" (fallen asleep).
  if (w.readings.some(isParticiple) && !(['adverb', 'conjunction'].includes(top.pos) && !top.form) && reflexiveAux(q)) return { prefer: isParticiple, margin: Infinity, reflexive: true };
  // A modal lends its si to the infinitive after it: "sembrava che si volesse vendicare sui deboli" wanted to take revenge,
  // not volersi bene, "to be fond of".
  if (top.pos === 'verb' && MODALS.has(top.key) && ['si', "s'", 'mi', "m'", 'ti', "t'", 'ci', "c'", 'vi', "v'"].includes(q.prev?.low ?? '')
    && infinitiveAfter(q)) return { prefer: pos('verb'), margin: Infinity, reflexive: false };
  if (w.readings.length < 2) return null;

  // A title after the clipped signor (or signora) is a noun: "son venuto, signor curato" (the parish priest,
  // not curato "kept"), "il signor conte", "la signora badessa".
  // Not after "un signor": "un signor dabbene, puntuale" is an honest gentleman.
  const title = q.prev && TITLES.has(q.prev.low) && !['un', 'uno', 'una', "un'"].includes(q.words[q.at - 2]?.low ?? '');
  // After signori only a noun as likely as the adjective: "questi signori medici" (doctors), but "tra loro signori grandi".
  if (title && ['adjective', 'noun'].includes(top.pos)) {
    const noun = w.readings.find((r) => r.pos === 'noun' && /^\p{Ll}/u.test(r.head));
    if (noun && noun.score > top.score - (q.prev!.low === 'signori' ? 0.01 : APART_NOUN)) return decisive((r) => r === noun);
  }

  // A living word over an obsolete form spelled alike: "mi venne sonno" is sleep, not essere's old sonno (sono).
  const old = (r: ContextReading): boolean => /\(obsolete\)/.test(r.form);
  if (old(top) && w.readings.some((r) => !old(r) && r.score > top.score - CONTEXT_MARGIN)) return { prefer: (r) => !old(r), margin: CONTEXT_MARGIN };
  // A rare lemma the dictionary ranks as if it were common: "Girò gli occhi smarriti" turned (girare), not gire's "I shall
  // go"; "la gente" the people, not gire's present participle.
  if (RARE_LEMMAS.has(top.key) && w.readings.some((r) => !RARE_LEMMAS.has(r.key))) return decisive((r) => !RARE_LEMMAS.has(r.key));

  // A number before what it counts: "faceva un fracasso come venti paia di zoccoli" (not vento's winds), "sei mesi" (not
  // essere's "you are"), "sei mila lire".
  const num = w.readings.find(pos('numeral'));
  const nTop = q.next?.readings[0];
  if (num && top !== num && top.pos !== 'article' && nTop && ((nTop.pos === 'noun' && /\bplural\b/.test(nTop.form)) || nTop.pos === 'numeral' || q.next!.low === 'mila')) {
    return decisive((r) => r === num);
  }

  // A plural noun or adjective with no determiner before it, where a verb of the narrative can stand, is the verb: "Pinocchio
  // chiese un po' d'elemosina", "— Ma neanche la morte mi vuole, — riprese.", "Il carro riprese la sua corsa", "Pinocchio
  // corse subito" (not corso's "Corsican women"); so is any verb after a pronoun that only comes before one ("si mosse
  // brancolando", "glielo infissi nel pancione"). After a determiner or a preposition it stays the noun ("a mie spese", "le
  // loro mosse", "nelle chiese"); a second person, a subjunctive or an order is too rare in a story to outweigh it ("Signori
  // assassini", "le bellissime ali", "documenti di straordinario valore").
  //
  // An adjective gives way only right after its subject, to a verb nearly as likely and with no noun after it: not "le porte
  // chiuse" (agreeing), "alle ore otto e mezzo precise" (precidere is rare), "brevi e commosse parole", "le labbra fine,
  // taglienti, accese". After a mark only a dialogue tag ("— M'ha parlato! — concluse, con gli occhi brillanti di gioja") or a
  // verb before an adverb or the place it goes to ("appena che m'ebbe visto nell'acqua, corse subito verso di me", "Curvo,
  // quasi spezzato in due, corse alla sua poltrona"; but "fuochi artificiali, corse di barberi" are races).
  const nx = q.next?.readings[0];
  const tag = !q.prev && (/—/.test(w.before) || (!!nx && (nx.pos === 'adverb' || ((nx.pos === 'preposition' || nx.pos === 'contraction')
    && !/^d/.test(q.next!.low)))));
  // An article and its noun after it are an object, which only a verb takes: "Pinocchio, a quelle parole, chiuse gli occhi".
  const object = !!q.next && topPos(q.next) === 'article' && !!afterNext(q) && nounish(afterNext(q));
  const describes = top.pos === 'adjective' && !tag && !object && ((prevPos === 'noun' && agrees(q.prev!.chosen!, top)) || !q.prev
    || ['noun', 'adjective'].includes(topPos(q.next)) || !w.readings.some((r) => finite(r) && r.score > top.score - 3));
  if ((top.pos === 'noun' || top.pos === 'adjective') && /\bplural\b/.test(top.form) && w.readings.some(finite) && !NOUN_SLOT.has(prevPos)
    && prevPos !== 'verb' && !describes) {
    const afterClitic = !!q.prev && (CLITICS.has(q.prev.low) || q.prev.low.startsWith('glie')) && chosenPos(q.prev) === 'pronoun';
    const told = (r: ContextReading): boolean => forms(r).some((f) => /\bthird-person\b/.test(f) && !/subjunctive|imperative|conditional/.test(f));
    // "mele e pesche e pere": a noun in a list of nouns.
    const listed = !!q.prev && ['e', 'ed', 'o', 'né', 'nè'].includes(q.prev.low) && q.prev.before === '' && chosenPos(q.words[q.at - 2]) === 'noun';
    if (afterClitic) return decisive(finite);
    if (w.readings.some(told) && !listed) return decisive(told);
  }

  // An adjective's form after a determiner is a noun when nothing comes after it to describe: "disse la vecchia, accennando
  // una piccola barca" (the old woman). Before a name or a verb only a noun about as likely as the adjective is read, a title
  // that is also an adjective's form ("una signora casa", a great house): "la signora Candida", but "la bella Bambina", "una
  // grossa Lumaca", "una bassa cancellata". Not after tutto ("era tutta composta di ragazzi") nor in a doubled adjective
  // ("bassa bassa").
  const ownNoun = w.readings.find((r) => r.pos === 'noun' && !r.form);
  const before = asksOf(q.prev);
  // A headword that is a noun and an adjective alike counts when the two are as likely and no noun or name follows: "col
  // curato del paese" (the parish priest, not "kept"), "dell'innominato", but "quel singolare perdono", "dal fedel Griso".
  const nr = q.next?.readings[0];
  const describesNext = !!q.next && (q.next.name || !nr || isNounish(nr) || isParticiple(nr)
    || q.next.readings.some((r) => r.pos === 'noun' && r.score > nr.score - 3)
    // "un vero e proprio sacrilegio": two adjectives before their noun.
    || (['e', 'ed', 'o'].includes(q.next.low) && !!afterNext(q)?.readings.some(pos('adjective'))));
  const alike = !top.form && !!ownNoun && ownNoun.score >= top.score - 0.01 && !describesNext;
  if (top.pos === 'adjective' && ownNoun && (top.form || alike) && ['article', 'contraction', 'determiner', 'adjective'].includes(prevPos)
    && (!before || fits(ownNoun, w.text, before))
    && q.prev?.chosen?.key !== 'tutto' && q.prev?.low !== low) {
    // Alone after a contraction it is a manner: "i maccheroni alla napoletana".
    const room = !q.next ? (prevPos === 'contraction' ? NEAR : APART_NOUN) : q.next.name || !nounish(q.next) ? NEAR : -Infinity;
    if (ownNoun.score > top.score - room) return decisive((r) => r.pos === 'noun' && !r.form);
  }

  // After a determiner, an article or a number comes a noun, not a verb spelled like one: "dopo un altro anno" (a year, not
  // the old spelling of hanno), "fin dal primo anno". Only a noun nearly as likely: "tutto era" keeps essere.
  // A noun of the determiner's gender and number first: Manzoni's "la grida" is the edict, not grido's plural "cries".
  const det = asksOf(q.prev);
  if (finite(top) && ['article', 'contraction', 'determiner', 'numeral', 'adjective'].includes(prevPos)
    && !['che', "ch'"].includes(q.prev?.low ?? '') && w.readings.some((r) => r.pos === 'noun' && r.score > top.score - CONTEXT_MARGIN)) {
    const agreeing = (r: ContextReading): boolean => r.pos === 'noun' && !!det && fits(r, w.text, det);
    const noun = w.readings.some(agreeing) ? agreeing : pos('noun');
    return { prefer: noun, margin: CONTEXT_MARGIN };
  }

  // After an article, a contraction or a demonstrative, a reading of its gender and number: "il conte zio" is the count,
  // not conto's feminine plural "known"; "Il conte duca".
  if (det) {
    // Not a capitalized noun for a word in lower case: "moltiplica il cinquecento per cinque" is the number, not the
    // Cinquecento (the 16th century).
    const ok = w.readings.filter((r) => fits(r, w.text, det) && r.pos !== 'proper noun' && (/^\p{Ll}/u.test(r.head) || !/^\p{Ll}/u.test(w.text)));
    if (ok.length && (isNounish(top) || isParticiple(top)) && w.readings.some((r) => isNounish(r) && !fits(r, w.text, det))) {
      // A noun first ("il paese dei morti", the dead, not morire's participle), the adjective before a noun ("a questo
      // fine" is the aim, "il fine lavoro" fine).
      const order = topPos(q.next) === 'noun' ? ['adjective', 'noun'] : ['noun', 'adjective'];
      const p = order.find((x) => ok.some((r) => r.pos === x));
      return decisive((r) => ok.includes(r) && (!p || r.pos === p));
    }
  }

  // After an article, a noun of its gender over an adverb or a conjunction spelled alike: "ci arrivò un'ora circa prima di
  // sera" (an hour, not ora "now").
  // Not "un no", "un sì": a refusal, which the dictionary has only as the Noh theater.
  // Nor an adverb of degree before what it measures: "una ben più diffusa".
  if (det && chosenPos(q.prev) === 'article' && ['adverb', 'conjunction'].includes(top.pos) && !top.form
    && !['no', 'sì', 'si', 'ben', 'più', 'meno', 'molto', 'tanto', 'così', 'assai', 'troppo'].includes(low)) {
    const noun = w.readings.find((r) => r.pos === 'noun' && fits(r, w.text, det) && /^\p{Ll}/u.test(r.head));
    if (noun && noun.score > top.score - 3) return decisive((r) => r === noun);
  }

  // A word in lower case is no proper noun: "come i figliuoli" are sons, not the surname Figliuolo's plural.
  if (top.pos === 'proper noun' && /^\p{Ll}/u.test(w.text) && w.readings.some((r) => r.pos !== 'proper noun')) {
    return decisive((r) => r.pos !== 'proper noun');
  }

  // An infinitive before its participle, though a rare noun is spelled alike: "dopo averla sgranocchiata e ingoiata in un
  // attimo" (not averla, the shrike). Not after a verb: "ho piacere" is pleasure.
  const infinitive = w.readings.find((r) => r.pos === 'verb' && (!r.form || /\binfinitive\b/.test(r.form)));
  if (top.pos === 'noun' && infinitive && infinitive.score > top.score - NEAR && !!q.next?.readings[0]
    && /\bpast participle\b/.test(q.next.readings[0].form)) {
    return decisive((r) => r === infinitive);
  }

  // ah, eh are interjections wherever they stand, not the dialect particle a' they are also spelled as: "— Ah tu sai dunque".
  if (top.pos === 'particle' && w.readings.some((r) => r.pos === 'interjection' && !r.form)) {
    return decisive((r) => r.pos === 'interjection' && !r.form);
  }

  // A word exclaimed alone that can be an interjection is one: "— No, no, basta! non ne posso più!", "e io, zitto!", "—
  // Ma no, scusi! — esclamai io". Not a function word read as itself ("Ma, via, che te n'importa?" is but), nor an order before
  // more words ("Va', Lumaca, e spicciati!").
  if (apart(q) && !['interjection', 'conjunction', 'preposition', 'pronoun', 'article', 'determiner'].includes(top.pos)
    && w.readings.some((r) => r.pos === 'interjection' && !r.form) && /^[!?]/.test(w.after)) {
    return decisive((r) => r.pos === 'interjection' && !r.form);
  }
  return null;
};
