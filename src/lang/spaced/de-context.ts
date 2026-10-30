// German's own context rules (SpacedLang.context, context.ts): the words whose reading depends on their neighbors. German
// marks most of it with word order and endings, so the rules read those: what comes right before and after a word, whether
// its clause ends with the finite verb (a subordinate clause: "da er krank war"), and which verb agrees with a pronoun
// ("da kommen sie" is "they", "sie kam" is "she").
//
// Each rule returns an answer for the word, or null to leave it to the next rule and then to the generic ones in core.ts.
import { isFiniteVerb, isParticiple, type ContextChoice, type ContextQuery, type ContextReading, type ContextRule, type ContextWord } from './context';
import { SEPARABLE_PARTICLES } from './de-spelling';

/** A cue that decides, however unlikely the reading is by the word alone. */
const DECIDE = Infinity;

/** Coordinating conjunctions: a new clause (or a new verb's stretch of one) starts after them. */
const COORD = new Set(['und', 'oder', 'aber', 'sondern', 'denn']);
/** Pronouns written with a capital for courtesy (Sie, Ihnen, Ihr Zimmer): never a noun, whatever their capital says. */
const POLITE = new Set(['sie', 'ihnen', 'ihr', 'ihre', 'ihrem', 'ihren', 'ihrer', 'ihres', 'du', 'dich', 'dir', 'dein',
  'deine', 'deinem', 'deinen', 'deiner', 'deines', 'euch', 'euer', 'eure', 'eurem', 'euren', 'eurer', 'eures']);
/** Subject pronouns: one of them before a pronoun in its clause makes that pronoun the object (als er sie sah). */
const NOMINATIVE = new Set(['ich', 'du', 'er', 'es', 'wir', 'man']);
/** Words that open a clause whose finite verb comes last: "als sie ihn sah", "weil sie müde waren". */
const SUBORDINATORS = new Set(['als', 'wenn', 'daß', 'dass', 'weil', 'ob', 'da', 'nachdem', 'bevor', 'ehe', 'während', 'bis',
  'damit', 'obwohl', 'obgleich', 'obschon', 'indem', 'sobald', 'solange', 'seit', 'seitdem', 'wie', 'wo', 'wohin', 'woher',
  'warum', 'weshalb', 'was', 'wer', 'wen', 'wem', 'falls', 'sodaß', 'sodass', 'sooft', 'soweit', 'wobei', 'womit', 'wodurch',
  'worauf', 'woran', 'worin', 'welcher', 'welche', 'welches', 'welchem', 'welchen', 'der', 'die', 'das', 'dem', 'den', 'denen',
  'deren', 'dessen', 'je']);
/** The definite article's forms, which are also the relative pronoun. */
const ARTICLES = new Set(['der', 'die', 'das', 'dem', 'den', 'des']);
/** Verbs a predicative adjective goes with: "Es war still" is quiet, "Er ging still" quietly. */
const COPULAS = new Set(['sein', 'werden', 'bleiben', 'scheinen', 'aussehen', 'erscheinen', 'wirken', 'finden', 'vorkommen']);
/**
 * Verbs whose first reflexive sense is not what sich with them usually means: "gab er sich einen letzten Schwung" (Die
 * Verwandlung) gave himself, not geben's "to stop"; "drückte sich mit ganzem Leib an die Tür" pressed, not "to avoid"; "eine
 * besondere Wärme wollte sich nicht mehr ergeben" arise, not "to surrender"; "fand er sich in seinem Bett zu einem
 * ungeheueren Ungeziefer verwandelt" found himself, not "to be found".
 */
const NOT_REFLEXIVE = new Set(['geben', 'drücken', 'ergeben', 'verziehen', 'finden']);
/** Words that open an infinitive clause, not a prepositional phrase: "um sich aufzurichten", "ohne sich länger aufzuhalten". */
const INFINITIVE_OPENERS = new Set(['um', 'ohne', 'statt', 'anstatt']);
/** Auxiliaries and modals: the reflexive belongs to the other verb of the clause ("hat sich gesetzt"). */
const AUXILIARIES = new Set(['sein', 'haben', 'werden', 'können', 'müssen', 'wollen', 'sollen', 'dürfen', 'mögen']);
/** Determiners that come after an article, not instead of a noun: die beiden Kinder, die meisten, die vielen. */
const AFTER_ARTICLE = new Set(['beide', 'viel', 'wenig', 'ander', 'anderer', 'einig', 'meist', 'sämtlich', 'einzig', 'paar']);
/** The reflexive pronoun of each person, and the subject it is reflexive with: ich … mich, wir … uns. */
const REFLEXIVE: Record<string, string | null> = { sich: null, mich: 'ich', dich: 'du', uns: 'wir', euch: 'ihr' };
/**
 * Words whose adjective or adverb section is a narrower sense, not the word's own meaning: klar "obviously", nötig "urgently";
 * "Da ist der Schneider weg!" (Max und Moritz) is gone, not weg "unconscious".
 */
const NARROW_ADVERB = new Set(['klar', 'nötig', 'weg', 'gar', 'übertrieben', 'unheimlich', 'richtig']);
/** Personal pronouns in the dative: gefallen and gehören take one ("er hat dir auch gut gefallen", Effi Briest). */
const DATIVE = new Set(['mir', 'dir', 'ihm', 'ihr', 'uns', 'euch', 'ihnen', 'sich', 'wem', 'dem']);
/**
 * Adjectives of a state that stehen, liegen, lassen and halten take as their predicate: "Die Türen standen offen" (Immensee),
 * "sie hatten sie wohl offen gelassen" (Die Verwandlung) are open, not "openly".
 */
const STATE = new Set(['offen', 'frei', 'leer', 'bereit']);
const STATE_VERBS = new Set(['stehen', 'liegen', 'lassen', 'halten', 'bleiben']);
/**
 * Titles before a name: "»Meister Müller, he, heran!" (Max und Moritz) is the master, at a line's start as in mid-sentence,
 * not viel's superlative "meister".
 */
const TITLES = new Set(['Meister', 'Onkel', 'Tante', 'Herr', 'Frau', 'Fräulein', 'Doktor', 'Pastor', 'Pfarrer', 'Schneider',
  'Witwe', 'Vetter', 'Base', 'Gebrüder', 'Gebrüdern', 'Jungfer', 'Jungfrau', 'Lehrer', 'Professor', 'Kapitän', 'Major', 'Hauptmann',
  'Leutnant', 'Graf', 'Gräfin', 'Baron', 'Fürst', 'Prinz', 'König', 'Kaiser']);
/**
 * Particles that follow an imperative: "»Warte nur: woher kommt der Wind?«", "Schau nur, wie fremd und still es ist"
 * (Immensee) are wait and look, not die Warte "lookout" and die Schau "show".
 */
const AFTER_IMPERATIVE = new Set(['nur', 'mal', 'doch', 'einmal', 'bloß']);

// ---------------------------------------------------------------------------------------------------- helpers ---

const isCap = (w: ContextWord): boolean => /^\p{Lu}/u.test(w.text);
/** Marks between two words that end a clause: anything but space and an apostrophe (Müh'). */
const cuts = (s: string): boolean => /[^\s'’ʼ]/.test(s);
/** A verb read as its headword: the infinitive, which is also the first and third person plural (sie kommen). */
const headwordVerb = (r: ContextReading): boolean => r.pos === 'verb' && r.form === '';
const finiteLike = (r: ContextReading): boolean => isFiniteVerb(r) || headwordVerb(r);
/** A verb form with a person, though it may also be a participle ("third-person singular present; past participle", ertönt). */
const personal = (r: ContextReading): boolean => r.pos === 'verb' && /\b(?:first|second|third)-person\b/.test(r.form);

/**
 * Word j joins two clauses: und, oder, sondern, and aber or denn read as the conjunction. Inside a clause they are adverbs:
 * "Jetzt bin ich aber schon wieder ganz frisch" (Die Verwandlung) is one clause.
 */
function coordAt(q: ContextQuery, j: number): boolean {
  const w = q.words[j];
  if (!COORD.has(w.low)) return false;
  if (w.low !== 'aber' && w.low !== 'denn') return true;
  return (w.chosen ?? w.readings[0])?.pos === 'conjunction' || j === 0 || cuts(w.before);
}

/** Where word i's clause begins and ends: at a mark, and (with `coord`) at und, oder, aber, sondern, denn. */
function clause(q: ContextQuery, i: number, coord = true): [number, number] {
  const w = q.words;
  let s = i;
  while (s > 0 && !cuts(w[s].before) && !(coord && coordAt(q, s - 1))) s--;
  let e = i;
  while (e + 1 < w.length && !cuts(w[e].after) && !(coord && coordAt(q, e + 1))) e++;
  return [s, e];
}

/** Word i opens its clause: the sentence's first word, after a mark, or after und, aber, oder … */
function clauseInitial(q: ContextQuery, i: number): boolean {
  return i === 0 || cuts(q.words[i].before) || coordAt(q, i - 1);
}

/** The verb reading a word is read as: the one chosen for a word before, else its likeliest verb reading (lower case). */
function verbOf(w: ContextWord | undefined): ContextReading | undefined {
  if (!w) return undefined;
  if (w.chosen) return w.chosen.pos === 'verb' ? w.chosen : undefined;
  const top = w.readings[0];
  if (!top || ['pronoun', 'article', 'determiner', 'preposition', 'conjunction', 'contraction'].includes(top.pos)) return undefined;
  if (top.pos === 'verb') return top;
  // sie lieben: lower case, a verb reading beats the adjective's inflected lieben next to a subject.
  return isCap(w) ? undefined : w.readings.find(finiteLike);
}

/**
 * Whether a verb form says third person singular or plural: "first/third-person plural preterite indicative" (waren) is
 * plural, "third-person singular present; second-person plural present" (geht) singular, the headword (kommen) plural.
 */
function number3(r: ContextReading): 'sg' | 'pl' | '' {
  if (r.pos !== 'verb') return '';
  if (r.form === '') return 'pl';
  let sg = false;
  let pl = false;
  for (const part of r.form.split(/;\s*/)) {
    if (!/third-person/.test(part)) continue;
    if (/\bsingular\b/.test(part)) sg = true;
    if (/\bplural\b/.test(part)) pl = true;
  }
  return sg === pl ? '' : sg ? 'sg' : 'pl';
}

/**
 * The finite verb at the end of the clause that starts at `from`, as a subordinate clause has it ("weil sie müde waren",
 * "daß er nicht kommen wollte"). A verb read as its headword counts only when no other finite verb is in the clause: "daß sie
 * kommen" is plural, but "Während der Zeit konnte er nicht schlafen" ends with an infinitive.
 */
function finalVerb(q: ContextQuery, from: number, coord = false): ContextReading | undefined {
  const [, e] = clause(q, from, coord);
  const last = q.words[e];
  if (e <= from || isCap(last)) return undefined;
  const v = verbOf(last);
  if (!v) return undefined;
  if (isFiniteVerb(v)) return v;
  if (!headwordVerb(v)) return undefined;
  for (let j = from + 1; j < e; j++) {
    const o = verbOf(q.words[j]);
    if (o && isFiniteVerb(o) && !isCap(q.words[j])) return undefined;
  }
  return v;
}

/** The endings of an inflected adjective, old ones too: die zappelnden Beine, zu den obern Zimmern, in den dunkeln Gängen. */
const ENDING = /(?:e|en|er|es|em|rn|ln)$/;
/** A possessive (mein, seine, ihren …): before its noun, or standing for it ("in die seine", Immensee). */
const POSSESSIVE_WORD = /^(?:mein|dein|sein|ihr|unser|euer|eur)(?:e|em|en|er|es)?$/;

/** A lower-case word that can be an adjective, participle or number inside a noun phrase: die zappelnden Beine, die drei. */
function adjectival(w: ContextWord | undefined): boolean {
  if (!w || isCap(w)) return false;
  if (!w.readings.length) return ENDING.test(w.low);
  // ein, eine open a noun phrase of their own: "die noch ein Kind war" is a relative clause.
  if (w.readings[0].pos === 'article') return false;
  return w.readings.some((r) => r.pos === 'numeral' || ((r.pos === 'adjective' || isParticiple(r) || declinedVerb(r)) && attributive(r, w.low))
    || (['determiner', 'pronoun', 'adverb'].includes(r.pos) && AFTER_ARTICLE.has(r.key)));
}

/**
 * A verb's form declined like an adjective, its case named: a present participle the builder declines ("in der
 * überfließenden Fülle", Werther, is überfließen's "genitive … singular"), between an article and its noun.
 */
const declinedVerb = (r: ContextReading): boolean => r.pos === 'verb' && /\b(?:nominative|accusative|dative|genitive)\b/.test(r.form);

/**
 * An adjective or participle form that can stand before a noun: inflected (zappelnden, gekreuzten) or a headword in -e
 * (erste, leise). Not one without an ending, which only follows its noun or verb: "die vielen Beinchen, die ununterbrochen in
 * der verschiedensten Bewegung waren", "die Eltern, die niemals früher Zimmer vermietet hatten" (Die Verwandlung).
 */
function attributive(r: ContextReading, low: string): boolean {
  if (!ENDING.test(low)) return false;
  // A participle with an adjective's ending, read bare because the dictionary lists no declined forms (de-spelling.ts): "mit
  // ausgebreiteten Armen", "aus der umgeworfenen großen Kanne" (Die Verwandlung), "voll summender wühlender Bienen"
  // (Immensee). Not one whose own spelling ends so: gefallen, gefunden.
  if (isParticiple(r) && /(?:t|en|[elr]nd)(?:e|en|er|es|em)$/.test(low)) return true;
  if (r.form === '') return r.pos === 'adjective' && low.endsWith('e');
  // A comparative with its own ending: "auf den höheren Teilen der Möbel".
  if (r.form === 'comparative') return /er(?:e|en|em|er|es)$/.test(low);
  // An old spelling with its ending, which the dictionary describes as a spelling only: "Sie hat die goldnen Augen"
  // (Immensee), "dem düstern Kabinette" (Werther).
  if (r.pos === 'adjective' && /^(?:alternative|dated|archaic|obsolete)\b/.test(r.form) && /(?:en|nen|ern|rn|ln)$/.test(low)) return true;
  return /\b(?:nominative|accusative|dative|genitive|inflected|strong|weak|mixed|plural|singular|superlative|feminine|masculine|neuter)\b/.test(r.form);
}

/**
 * A verb's past form shaped like an inflected adjective, right before a noun: "an der vorbereiteten Speise" (Die
 * Verwandlung) is the participle, inflected as the dictionary does not list it.
 */
function pastBeforeNoun(q: ContextQuery, k: number): boolean {
  const w = q.words[k];
  return !!w && !isCap(w) && ENDING.test(w.low) && w.readings.length > 0 && w.readings.every((r) => r.pos === 'verb')
    && w.readings.some((r) => /\b(?:preterite|participle)\b/.test(r.form)) && joined(q, k) && nounHere(q, k + 1);
}

/** A word that can only be a noun here: capitalized in mid-sentence, not a courtesy pronoun. */
function nounHere(q: ContextQuery, j: number): boolean {
  const w = q.words[j];
  return !!w && j > 0 && isCap(w) && !POLITE.has(w.low) && !(w.name && w.readings.length > 0);
}

/** The noun of the noun phrase starting at j (past its adjectives) is plural in every reading: Tränen, Vögel. */
function pluralNoun(q: ContextQuery, j: number): boolean {
  let k = j;
  while (k < q.words.length && !nounHere(q, k) && adjectival(q.words[k]) && (k === j || !cuts(q.words[k].before))) k++;
  if (!nounHere(q, k) || (k > j && cuts(q.words[k].before))) return false;
  const nouns = q.words[k].readings.filter((r) => r.pos === 'noun');
  return nouns.length > 0 && nouns.every((r) => r.gender === 'pl' || (/\bplural\b/.test(r.form) && !/\bsingular\b/.test(r.form)));
}

/** Words j and j+1 stand side by side, only space between them. */
const joined = (q: ContextQuery, j: number): boolean => j + 1 < q.words.length && !cuts(q.words[j].after);

/** What an extended attribute's adjectives may follow: a noun, an adverb, an adjective used as one, a pronoun (sich, ihm). */
function attributeLead(w: ContextWord): boolean {
  const r = w.chosen ?? w.readings[0];
  if (isCap(w)) return true;
  if (!r || POSSESSIVE_WORD.test(w.low)) return false;
  return r.pos === 'adverb' || r.pos === 'pronoun' || r.pos === 'numeral' || (r.pos === 'adjective' && r.form === '');
}

/**
 * A noun phrase starts at word j, after der, die, das: a noun (die Tür), adjectives or a number before one (die
 * zappelnden Beine, die drei Kinder), one standing for its noun ("Doch der zweite folgt sogleich", Max und Moritz; "zu den
 * anderen"), a possessive standing for one ("in die seine"), or an extended attribute, adjectives after adverbs or a phrase,
 * before their noun ("der seitlich geneigte Kopf", "die auf dem Tisch liegenden Bücher"). Not a verb, a subject pronoun or a
 * name: "die er schon unterm Arm hatte", "das ihn festhielt", "den Gregor vor zwei Tagen für ungenießbar erklärt hatte" are
 * relative clauses.
 *
 * `reach`: where a relative clause is likeliest (after a comma), only an adjective right after counts ('comma': "die
 * Eltern, die niemals früher Zimmer vermietet hatten", "der sich so gern schöner Frauenhände bemächtigt", Immensee); after a
 * possessive likewise ('near': "in ihr Zimmer", but "an ihr ganz neuen Empfindlichkeit" is "her").
 */
function nounPhrase(q: ContextQuery, j: number, reach: 'near' | 'comma' | 'far' = 'far'): boolean {
  const W = q.words;
  const w = W[j];
  if (!w) return false;
  if (nounHere(q, j)) return true;
  if (isCap(w)) return false;
  const adj = (k: number): boolean => adjectival(W[k]) || pastBeforeNoun(q, k);
  // A possessive standing for its noun: "in die seine und …", "ließ seine Augen träumerisch in den ihren ruhen" (Immensee).
  // After a comma only before a mark or und: "einer großen Reinigung unterzogen, die ihr nur nach Verbrauch einiger Kübel
  // Wasser gelungen war" (Die Verwandlung) is the relative pronoun and "to her".
  if (POSSESSIVE_WORD.test(w.low) && reach !== 'near') {
    const alone = cuts(w.after) || j + 1 >= W.length || COORD.has(W[j + 1].low);
    return reach === 'comma' ? alone : alone || !(nounHere(q, j + 1) || adj(j + 1) || (W[j + 1].readings[0]?.pos ?? '') === 'adverb');
  }
  const top = w.readings[0];
  if (adj(j) && (cuts(w.after) || j + 1 >= W.length)) return true;
  if (adjectival(w) && top && reach !== 'near' && (top.pos === 'numeral' || AFTER_ARTICLE.has(top.key)
    || ((top.pos === 'adjective' || isParticiple(top)) && attributive(top, w.low)))) return true;
  // die eine Seite, an der einen Seitentür: "the one" (weak, so eine or einen; "das ein gutes Zeichen" is the pronoun).
  if (top?.pos === 'article' && /^einen?$/.test(w.low) && reach === 'far' && joined(q, j) && nounPhrase(q, j + 1, 'near')) return true;
  let chain = -1;
  for (let k = j; k < Math.min(W.length, j + 12); k++) {
    if (k > j && cuts(W[k].before)) return false;
    const x = W[k];
    // A name after adjectives is their noun: "sah bisweilen auf den stillen Gregor hin".
    if (nounHere(q, k) || (chain >= 0 && x.name)) {
      if (chain === j) return true;
      if (chain > j && reach === 'far' && attributeLead(W[chain - 1])) return true;
      if (reach !== 'far') return false;
      chain = -1;
      continue;
    }
    if (adj(k)) {
      if (chain < 0) chain = k;
      continue;
    }
    chain = -1;
    if (isCap(x) || reach === 'near') return false;
    const r = x.readings[0];
    if (r && (isFiniteVerb(r) || NOMINATIVE.has(x.low) || x.low === 'sie' || r.pos === 'conjunction')) return false;
  }
  return false;
}

/**
 * The subject of word i's clause comes before it: a pronoun (er, ich), or a noun or name not inside a prepositional phrase.
 * Not a singular noun before a plural verb right before the word: "das Erdbeerensuchen hatten sie aufgegeben" (Immensee) has
 * its object first, and sie is "they".
 */
function subjectBefore(q: ContextQuery, i: number): boolean {
  const [s] = clause(q, i);
  const before = i > 0 && !cuts(q.words[i].before) ? verbOf(q.words[i - 1]) : undefined;
  // Two nouns joined by und are a plural subject: "aber der Vater und die Schwester hielten sie zuerst … zurück" (Die
  // Verwandlung); the clause starts after und.
  const joinedSubject = s > 1 && q.words[s - 1].low === 'und' && (nounHere(q, s - 2) || q.words[s - 2].name);
  const plural = !!before && isFiniteVerb(before) && number3(before) === 'pl' && !joinedSubject;
  let inPhrase = false;
  for (let j = s; j < i; j++) {
    const w = q.words[j];
    const r = w.chosen;
    if (r && (r.pos === 'preposition' || r.pos === 'contraction')) { inPhrase = true; continue; }
    if (NOMINATIVE.has(w.low) || w.low === 'sie') return true;
    if (nounHere(q, j) || w.name) {
      if (!inPhrase && !(plural && !w.name && singularAt(q, j))) return true;
      inPhrase = false;
    }
  }
  return false;
}

/**
 * The noun at j can only be singular: its article says so (das, dem, ein …), or its reading does: a form that says so
 * ("dative singular"), a verb made a noun (das Suchen), a headword that is not its own plural (der Wagen and das Zimmer are).
 */
function singularAt(q: ContextQuery, j: number): boolean {
  const det = j > 0 && !cuts(q.words[j].before) ? q.words[j - 1].low : '';
  if (/^(?:das|dem|des|ein|eines|einem|dieses|diesem|jedes|jedem|kein|keines|keinem)$/.test(det)) return true;
  const r = q.words[j].chosen;
  if (!r || r.pos === 'verb') return !!r;
  if (r.pos !== 'noun' || r.gender === 'pl') return false;
  if (r.form) return /\bsingular\b/.test(r.form) && !/\bplural\b/.test(r.form);
  return !(/(?:er|el|en|chen|lein)$/.test(r.head) && /[mn]/.test(r.gender));
}

/**
 * The verb a pronoun at i is the subject of, when word order shows it: right after it (sie kommen), right before it with
 * nothing that could be the subject before that ("Da kommen sie", "Schneiden sie sich Brot"), or at the end of a clause it
 * opens after a conjunction ("weil sie müde waren"). Undefined when another subject comes first (als er sie sah).
 */
function verbOfSubject(q: ContextQuery, i: number): ContextReading | undefined {
  if (subjectBefore(q, i)) return undefined;
  const w = q.words;
  const [s] = clause(q, i);
  const lead = w[s];
  // A clause a conjunction or relative pronoun opens has its verb last. Not "da kommen sie", where da is "there" and the verb
  // comes second, nor "Auf dem Hofe angekommen trafen sie …" (Immensee): der, die, das open one only as the relative pronoun.
  const relative = (x: ContextWord): boolean => SUBORDINATORS.has(x.low) && (!ARTICLES.has(x.low) || x.chosen?.pos === 'pronoun');
  const opener = relative(lead) && !(lead.low === 'da' && lead.chosen?.pos === 'adverb')
    && !(s + 1 < w.length && s + 1 !== i && verbOf(w[s + 1]) && finiteLike(verbOf(w[s + 1])!));
  if (s < i && (opener || (lead.chosen?.pos === 'preposition' && s + 1 < i && relative(w[s + 1])))) {
    return finalVerb(q, s);
  }
  const prev = i > 0 && !cuts(w[i].before) ? w[i - 1] : undefined;
  const pv = prev && !(i - 1 > 0 && isCap(prev)) ? verbOf(prev) : undefined;
  // After its verb: "gingen sie", "als wolle sie vermeiden" (Die Verwandlung).
  if (pv && isFiniteVerb(pv)) return pv;
  const next = joined(q, i) ? w[i + 1] : undefined;
  const nv = verbOf(next);
  if (next && nv && finiteLike(nv) && !isCap(next)) {
    // An infinitive before its finite verb: "indem sie stehen blieb" (Immensee) is singular.
    const after = joined(q, i + 1) ? verbOf(w[i + 2]) : undefined;
    return headwordVerb(nv) && after && isFiniteVerb(after) && !isCap(w[i + 2]) ? after : nv;
  }
  // "da kommen sie" (Max und Moritz): a verb read as its headword is plural.
  return pv && finiteLike(pv) ? pv : undefined;
}

/** The reading of `key` and part of speech whose hint says `hint` (one of the sections of a key: sie "she" or "they"). */
const section = (key: string, pos: string, hint: RegExp) => (r: ContextReading): boolean => r.key === key && r.pos === pos && hint.test(r.hint);
const SHE = section('sie', 'pronoun', /\bshe\b/);
const THEY = section('sie', 'pronoun', /\bthey\b/);
const POLITE_SIE = (r: ContextReading): boolean => r.key === 'Sie';
/** The possessive her or their: the reading of ihr with that hint. */
const POSSESSIVE = (hint: RegExp) => (r: ContextReading): boolean => r.key === 'ihr' && r.pos === 'determiner' && hint.test(r.hint);

const has = (w: ContextWord, f: (r: ContextReading) => boolean): boolean => w.readings.some(f);
const prefer = (f: (r: ContextReading) => boolean, margin = DECIDE): ContextChoice => ({ prefer: f, margin });

/**
 * Another courtesy form in mid-sentence in the sentence (Sie, Ihnen, Ihr), which makes a sentence's first Sie polite too; or
 * one read as polite in the paragraph's sentences before: the Prokurist's "Sie haben vielleicht … nicht gelesen" (Die
 * Verwandlung) comes after his "Ihre Eltern" and "Herr Samsa" in the same speech.
 */
function politeSentence(q: ContextQuery): boolean {
  const courtesy = ['sie', 'ihnen', 'ihr', 'ihre', 'ihrem', 'ihren', 'ihrer', 'ihres'];
  if (q.words.some((w, j) => j > 0 && j !== q.at && isCap(w) && courtesy.includes(w.low))) return true;
  // The sentences before count only inside one speech, still open where this sentence starts: "»Mutter?« rief die Schwester
  // von der anderen Seite. Sie verständigten sich durch Gregors Zimmer." (Die Verwandlung) is narration, "they".
  // A paragraph with no quotes at all is one speaker's, as the Prokurist's "Schonen Sie meine Eltern! … Sie haben vielleicht".
  let open = true;
  let polite = false;
  const marks = (text: string): void => {
    for (const ch of text) {
      if ('»„'.includes(ch)) { open = true; polite = false; }
      else if ('«“'.includes(ch)) { open = false; polite = false; }
    }
  };
  for (const w of q.earlier) {
    marks(w.before);
    if (open && isCap(w) && courtesy.includes(w.low) && (w.chosen?.key === 'Sie' || w.chosen?.key === 'Ihr')) polite = true;
  }
  if (q.earlier.length) marks(q.earlier[q.earlier.length - 1].after);
  marks(q.words[0]?.before ?? '');
  return open && polite;
}

/**
 * Whom ihr, ihre … belongs to: the sie of its clause ("Sie nahmen ihre Bücher" their, "bis sie ihren Kahn erreicht hatten"
 * their); else its clause's verb, when the possessive follows it ("beide setzten ihre Wanderung fort" their, "und ihren jungen
 * Körper dehnte" her; but in "Ihrer Hühner waren drei", Max und Moritz, the hens are the subject); else the sentence's last
 * sie ("und man hörte nur das schwere Tappen ihrer Füße").
 */
function owner(q: ContextQuery): 'her' | 'their' | 'your' | '' {
  const of = (j: number): 'her' | 'their' | 'your' | '' => {
    const c = q.words[j].chosen!;
    return c.key === 'Sie' ? 'your' : /\bthey\b/.test(c.hint) ? 'their' : /\bshe\b/.test(c.hint) ? 'her' : '';
  };
  const said = (j: number): boolean => !!q.words[j].chosen && (q.words[j].low === 'sie' || q.words[j].low === 'ihnen');
  const [s, e] = clause(q, q.at);
  for (let j = q.at - 1; j >= s; j--) if (said(j)) return of(j);
  const span = q.words.slice(s, e + 1);
  if (span.some((x, k) => s + k !== q.at && ['ich', 'du', 'er', 'wir', 'ihr'].includes(x.low))) return '';
  if (q.at > s && !span.some((x) => x.low === 'man' || x.low === 'es')) {
    for (let j = s; j <= e; j++) {
      const v = j === q.at || (j > 0 && isCap(q.words[j])) ? undefined : verbOf(q.words[j]);
      if (v && isFiniteVerb(v)) return number3(v) === 'pl' ? 'their' : number3(v) === 'sg' ? 'her' : '';
    }
  }
  for (let j = s - 1; j >= 0; j--) if (said(j)) return of(j);
  return '';
}

// ------------------------------------------------------------------------------------------------------ rules ---

/**
 * sie, Sie: "she" or "they" by the verb that agrees with it, "you" with a capital in mid-sentence. "Tak, tak, tak! -- da
 * kommen sie" (Max und Moritz) are the boys; "Sie verbarrikadieren sich da in Ihrem Zimmer" (Die Verwandlung) is the
 * Prokurist speaking to Gregor, as its Ihrem shows.
 */
function sie(q: ContextQuery): ContextChoice | null {
  const w = q.word;
  if (w.low !== 'sie') return null;
  const v = verbOfSubject(q, q.at);
  const n = v ? number3(v) : '';
  // The polite Sie takes a plural verb: a capital before a singular one starts a line of verse ("Der Kuckuck lacht von
  // ferne, / Sie sitzt im Thymiane", Immensee).
  if (w.text === 'Sie' && !q.sentenceStart) return n === 'sg' && has(w, SHE) ? prefer(SHE) : has(w, POLITE_SIE) ? prefer(POLITE_SIE) : null;
  if (w.text === 'Sie' && (n === 'pl' || !n) && politeSentence(q) && has(w, POLITE_SIE)) return prefer(POLITE_SIE);
  if (n === 'pl' && has(w, THEY)) return prefer(THEY);
  if (n === 'sg' && has(w, SHE)) return prefer(SHE);
  return null;
}

/**
 * ihr: the possessive before a noun ("ihr Zimmer"), "you" (plural) with its verb ("ihr wißt", "habt ihr"), and "to her"
 * anywhere else ("Der Mann winkte ihr mit seinem Rohrstock", Immensee). ihre, ihren …: "your" with a capital in mid-sentence
 * (Ihrem Zimmer), else her or their by whom it belongs to (owner).
 */
function ihr(q: ContextQuery): ContextChoice | null {
  const w = q.word;
  if (!/^ihr(?:e|em|en|er|es)?$/.test(w.low)) return null;
  const capMid = isCap(w) && !q.sentenceStart;
  const polite = (r: ContextReading): boolean => r.key === 'Ihr' && r.pos === 'determiner';
  const np = joined(q, q.at) && nounPhrase(q, q.at + 1, 'near');
  // ihr before a plural noun is no possessive (that would be ihre): opening its clause, it calls out to them, "you": "»Fließet
  // aus dem Aug', ihr Tränen!" (Max und Moritz), "»Alle um mich herum, ihr jungen Vögel!«" (Immensee).
  if (w.low === 'ihr' && np && q.at > 0 && /[,!:]/.test(w.before) && pluralNoun(q, q.at + 1) && has(w, (r) => r.key === 'ihr' && r.pos === 'pronoun')) {
    return prefer((r) => r.key === 'ihr' && r.pos === 'pronoun');
  }
  if (capMid && has(w, polite) && (np || w.low !== 'ihr')) return prefer(polite);
  if (w.low === 'ihr') {
    if (!np) {
      // ihr is "you" with a verb of the second person plural: right after it ("Hört ihr es wohl", Immensee) unless a subject
      // comes first ("aber es geht ihr schon besser", Die Verwandlung), right before it (ihr wißt), or ending its clause with
      // no other subject ("was ihr gefunden habt"; but "welche er ihr sonst erzählt" is "to her").
      const plural2 = (x: ContextWord | undefined, only: boolean): boolean => !!x && x.readings[0]?.pos === 'verb'
        && x.readings.some((r) => r.pos === 'verb' && /second-person plural/.test(r.form) && !(only && /third-person singular/.test(r.form)));
      const at = q.at;
      const before = at > 0 && !cuts(w.before) ? q.words[at - 1] : undefined;
      const subject = at > 1 && !cuts(q.words[at - 1].before) && (NOMINATIVE.has(q.words[at - 2].low) || nounHere(q, at - 2));
      const [s, e] = clause(q, at);
      const span = q.words.slice(s, e + 1);
      const you = (plural2(before, false) && !subject) || plural2(joined(q, at) ? q.words[at + 1] : undefined, false)
        || (span.some((x, k) => s + k !== at && (!isCap(x) || s + k === 0) && plural2(x, true))
          && !span.some((x) => ['ich', 'du', 'er', 'es', 'wir', 'man', 'sie'].includes(x.low)));
      if (you) return prefer((r) => r.key === 'ihr' && r.pos === 'pronoun');
      // gab ihr, mit ihr: the dative of sie ("to her").
      const dative = (r: ContextReading): boolean => r.key === 'sie' && /\bdative\b/.test(r.form);
      return has(w, dative) ? prefer((r) => dative(r) && /\bshe\b/.test(r.hint)) : null;
    }
  }
  const o = owner(q);
  if (o === 'your' && has(w, polite)) return prefer(polite);
  if (o === 'their' && has(w, POSSESSIVE(/\btheir\b/))) return prefer(POSSESSIVE(/\btheir\b/));
  if (o === 'her' && has(w, POSSESSIVE(/\bher\b/))) return prefer(POSSESSIVE(/\bher\b/));
  return null;
}

/**
 * ihnen is "them": the "they" section of sie, whose form hint says "them". Ihnen in mid-sentence is the polite "you" ("Ich
 * danke Ihnen"), but the form hint of ihnen is the same for both spellings and would still say "them", so it stays sie's until
 * form hints can tell the two apart (requests-de.md).
 */
function ihnen(q: ContextQuery): ContextChoice | null {
  // Ihnen with a capital in mid-sentence is the polite Sie's "you": Effi Briest's "wie geht es Ihnen denn eigentlich?", the
  // Prokurist's "Ihnen das alles unter vier Augen zu sagen" (Die Verwandlung).
  if (q.word.text === 'Ihnen' && !q.sentenceStart && has(q.word, POLITE_SIE)) return prefer(POLITE_SIE);
  return q.word.low === 'ihnen' && has(q.word, THEY) ? prefer(THEY) : null;
}

/**
 * laß, lass before whom or what it lets is lassen's "let!", not the adjective lass "weary" of the old spelling: "Laß uns eine
 * Weile ausruhen" (Immensee), "laß mich".
 */
function lass(q: ContextQuery): ContextChoice | null {
  const w = q.word;
  if (w.low !== 'laß' && w.low !== 'lass') return null;
  const imperative = (r: ContextReading): boolean => r.key === 'lassen' && /imperative/.test(r.form);
  const n = joined(q, q.at) ? q.words[q.at + 1] : undefined;
  const object = !!n && (['uns', 'mich', 'dich', 'ihn', 'sie', 'es', 'euch', 'mir', 'dir', 'ihm', 'ihr', 'doch', 'nur', 'ab', 'los',
    'das', 'den', 'die', 'dem', 'mein', 'meine', 'dein', 'deine'].includes(n.low) || n.name);
  return object && has(w, imperative) ? prefer(imperative) : null;
}

/**
 * mein, dein, sein, unser, euer with an ending: the possessive "my, your" before its noun phrase ("Rat, was ich Deiner Mutter
 * zu Weihnachten schenke!", Immensee; "wegen meiner Eltern", Effi Briest), not the pronoun deiner "yours" or ich's genitive.
 * meine right after its subject is meinen "to mean": "Ich meine es genau so" (Effi Briest).
 */
function possessive(q: ContextQuery): ContextChoice | null {
  const w = q.word;
  if (!/^(?:mein|dein|sein|unser|euer|eur)(?:e|em|en|er|es)?$/.test(w.low) || w.low === 'sein') return null;
  const det = (r: ContextReading): boolean => r.pos === 'determiner' && /^(?:mein|dein|sein|unser|euer)$/.test(r.key);
  if (!has(w, det)) return null;
  const subject = !!q.prev && (NOMINATIVE.has(q.prev.low) || q.prev.low === 'sie') && !isCap(w);
  if (subject && /^meinen?$/.test(w.low) && has(w, (r) => r.pos === 'verb' && r.key === 'meinen')
    && !(joined(q, q.at) && nounPhrase(q, q.at + 1))) return prefer((r) => r.pos === 'verb' && r.key === 'meinen');
  return joined(q, q.at) && nounPhrase(q, q.at + 1) ? prefer(det) : null;
}

/**
 * A title before a name or noun is that noun, at a line's start too: "»Meister Müller, he, heran!" (Max und Moritz) is the
 * master, not viel's superlative "meister".
 */
function title(q: ContextQuery): ContextChoice | null {
  const w = q.word;
  // The name after a title is the name where the dictionary has one: "Machten sie mit Onkel Fritz" (Max und Moritz) is not
  // Fritz "German", "die Gebrüder Grimm" not der Grimm "wrath".
  // A person's name, not a place's: "Unter Onkel Fritzens Decke" is not the Tyrolean village.
  const name = (r: ContextReading): boolean => r.pos === 'proper noun' && /\b(?:name|surname|diminutive)\b/.test(r.hint);
  if (q.at > 0 && !cuts(w.before) && TITLES.has(q.words[q.at - 1].text) && isCap(w) && has(w, name)) return prefer(name);
  if (!TITLES.has(w.text) || !joined(q, q.at) || !isCap(q.words[q.at + 1])) return null;
  return has(w, (r) => r.pos === 'noun' && r.key === w.text) ? prefer((r) => r.pos === 'noun' && r.key === w.text) : null;
}

/**
 * A word standing alone at the start of a sentence, before a comma or an exclamation, is the interjection it can be: "»Ei,«
 * sagte die Mutter" and "»Ei was!" (Immensee) are "why", not the egg; "Ja, ja, danke, Mutter" (Die Verwandlung) "thanks",
 * not ich danke "I thank". wehe before its dative is "woe to": "Max und Moritz, wehe euch!" (Max und Moritz).
 */
function interjection(q: ContextQuery): ContextChoice | null {
  const w = q.word;
  const own = (r: ContextReading): boolean => r.pos === 'interjection' && r.key.toLowerCase() === w.low;
  const any = (r: ContextReading): boolean => r.pos === 'interjection';
  if (!has(w, any) || w.readings[0].pos === 'interjection') return null;
  const pick = has(w, own) ? own : any;
  const next = joined(q, q.at) ? q.words[q.at + 1] : undefined;
  if (w.low === 'wehe' && next && DATIVE.has(next.low)) return prefer(pick);
  if (!clauseInitial(q, q.at) && !q.sentenceStart) return null;
  // danke: alone, or before schön, sehr, vielmals; not after ich ("ich danke Ihnen").
  if (w.low === 'danke') return cuts(w.after) || (next && /^(?:schön|sehr|vielmals)$/.test(next.low)) ? prefer(pick) : null;
  if (!q.sentenceStart || !['noun', 'verb'].includes(w.readings[0].pos)) return null;
  return cuts(w.after) || next?.low === 'was' ? prefer(pick) : null;
}

/**
 * A verb that opens its clause with a capital, as a line of verse does, before its subject: "Mahl er das, so schnell"
 * (Max und Moritz) is mahlen "grind", "Sterben, ach sterben Soll ich allein!" (Immensee) sollen, not das Soll "debit";
 * before und and another verb ("Haut und trampelt alles tot", hauen); an imperative before nur ("»Warte nur", "Schau nur",
 * Immensee). Not after a word a noun follows (an article, a preposition, an adjective).
 */
function verbFirst(q: ContextQuery): ContextChoice | null {
  const w = q.word;
  if (!isCap(w) || POLITE.has(w.low) || w.name) return null;
  const verb = (r: ContextReading): boolean => r.pos === 'verb' && (isFiniteVerb(r) || /imperative/.test(r.form));
  if (!has(w, verb) || w.readings[0].pos !== 'noun') return null;
  const prev = q.at > 0 && !cuts(w.before) ? q.words[q.at - 1] : undefined;
  if (prev && (!['verb', 'interjection'].includes(prev.chosen?.pos ?? '') || adjectival(prev))) return null;
  const next = joined(q, q.at) ? q.words[q.at + 1] : undefined;
  if (!next) return null;
  if (NOMINATIVE.has(next.low) || next.low === 'sie') return prefer(verb);
  const third = joined(q, q.at + 1) ? q.words[q.at + 2] : undefined;
  if (q.sentenceStart && next.low === 'und' && third && !isCap(third) && verbOf(third) && personal(verbOf(third)!)) return prefer(verb);
  const imperative = (r: ContextReading): boolean => r.pos === 'verb' && /imperative/.test(r.form);
  if (AFTER_IMPERATIVE.has(next.low) && (q.sentenceStart || clauseInitial(q, q.at)) && has(w, imperative)) return prefer(imperative);
  return null;
}

/**
 * der, die, das, den, dem: the article before a noun phrase, else the pronoun: relative after a comma ("die Rechentafel,
 * die er schon unterm Arm hatte", Immensee), demonstrative otherwise ("Der winkte ihm mit der Hand"; "Das ist freilich
 * angenehmer", Max und Moritz). deren is always the pronoun "whose".
 */
function article(q: ContextQuery): ContextChoice | null {
  const w = q.word;
  if (w.low === 'deren') return has(w, (r) => r.key === 'dessen') ? prefer((r) => r.key === 'dessen') : null;
  if (!['der', 'die', 'das', 'den', 'dem'].includes(w.low)) return null;
  if (!has(w, (r) => r.pos === 'pronoun') || !has(w, (r) => r.pos === 'article')) return null;
  const prev = q.at > 0 ? q.words[q.at - 1] : undefined;
  // ", der", ", mit dem", ", in die": a relative pronoun opens its clause after a comma, alone or after a preposition.
  const spot = cuts(w.before) ? /,/.test(w.before) : !!prev && prev.chosen?.pos === 'preposition' && /,/.test(prev.before);
  if (joined(q, q.at) && nounPhrase(q, q.at + 1, spot ? 'comma' : 'far')) return prefer((r) => r.pos === 'article');
  // Not a relative pronoun: one its verb follows in second place, with more of the clause after it ("Nein, sagte Reinhard,
  // die sind dann zu alt", Immensee), or one a mark follows ("fing er jetzt an, die, welche ihr am besten gefallen").
  const next = joined(q, q.at) ? q.words[q.at + 1] : undefined;
  const nv = next && (next.readings[0]?.pos === 'verb' ? next.readings[0] : undefined);
  const second = !!nv && finiteLike(nv) && joined(q, q.at + 1);
  const relative = spot && !cuts(w.after) && !second;
  if (w.low === 'das' && has(w, (r) => r.key === 'das')) return prefer((r) => r.key === 'das' && r.pos === 'pronoun');
  const own = w.readings.filter((r) => r.key === 'der' && r.pos === 'pronoun');
  const who = own.find((r) => /\bwho\b/.test(r.hint)) ?? own[0];
  const that = own.find((r) => r !== who) ?? who;
  const pick = relative ? who : that;
  return pick ? prefer((r) => r === pick) : null;
}

/**
 * A noun in mid-sentence is written with a capital, and that capital decides: "am Morgen" (Immensee) is the morning, not
 * morgen "tomorrow"; "rief Meister Böck" (Max und Moritz) the master, not viel's "meister". An article before it chooses
 * among nouns spelled alike by their gender and case: "der Alte" is the old man, not das Alter "age".
 */
function capitalNoun(q: ContextQuery): ContextChoice | null {
  const w = q.word;
  if (q.sentenceStart || !isCap(w) || w.name || POLITE.has(w.low) || w.text === w.text.toUpperCase()) return null;
  const prev = q.at > 0 && !cuts(w.before) ? q.words[q.at - 1] : undefined;
  // A function word with a capital is a verse line's first word or follows a colon: "dachte er: Es war halb sieben Uhr". Not
  // a preposition with no noun phrase after it, nor one after an article: "Erich, und Dank für dein Willkommen!" (Immensee)
  // is thanks, not dank "thanks to"; "hörte man jetzt keinen Laut." (Die Verwandlung) a sound, not laut "according to".
  const top = w.readings[0];
  if (['pronoun', 'article', 'determiner', 'conjunction', 'preposition', 'particle', 'contraction'].includes(top.pos)) {
    const next = joined(q, q.at) ? q.words[q.at + 1] : undefined;
    const stranded = top.pos === 'preposition' && (!next || ['preposition', 'conjunction'].includes(next.readings[0]?.pos ?? '')
      || ['article', 'determiner'].includes(prev?.chosen?.pos ?? ''));
    if (!stranded) return null;
  }
  // A place's adjective before its noun: "einer der alten Berliner Herren", "aus einem reichen Danziger Kornhändlerhause"
  // (Effi Briest).
  const place = (r: ContextReading): boolean => r.pos === 'adjective' && /^\p{Lu}/u.test(r.key);
  if (has(w, place) && joined(q, q.at) && nounHere(q, q.at + 1)) return prefer(place);
  const noun = (r: ContextReading): boolean => r.pos === 'noun' && /^\p{Lu}/u.test(r.key);
  let nouns = w.readings.filter(noun);
  // A noun's diminutive or other gender filed as its form gives way to a noun of its own: "Fräulein Effi" (Effi Briest) is
  // Miss, not Frau's diminutive; "die Gipfel hundertjähriger Eichen" (Immensee) oaks, not Ei's "little egg"; "das Kreischen
  // der andern Waldvögel" screeching, not Kreis's. And a form that names a gender its noun lacks belongs to another word:
  // "Wir Alten" (Immensee) are old people, not das Alter "age", whose entry lists der Alte's forms.
  const genderForm = (r: ContextReading): boolean => /^(?:neuter|masculine|feminine)$/.test(r.form);
  // Only where an entry of the same word has that gender: der Letzte lists its neuter as its own form ("mußte das Letzte
  // erwachen", Siddhartha).
  const otherGender = (r: ContextReading): boolean => {
    if (genderForm(r)) return false;
    const g = r.form.match(/\b(?:masculine|feminine|neuter)\b/g);
    return !!g && !!r.gender && r.gender !== 'pl' && !g.some((x) => r.gender.includes(x[0]))
      && nouns.some((o) => o !== r && o.key === r.key && g.some((x) => o.gender.includes(x[0])));
  };
  const lower = w.text[0].toLowerCase() + w.text.slice(1);
  const verbal = (r: ContextReading): boolean => r.pos === 'verb' && (r.form === '' || /verbal noun/.test(r.form)) && r.key === lower;
  if (nouns.some((r) => !otherGender(r))) nouns = nouns.filter((r) => !otherGender(r));
  // Not where the article fits only the other gender's form: "mußte das Letzte erwachen" (Siddhartha) is das Letzte, the
  // last thing, filed as der Letzte's neuter.
  const own = nouns.filter((r) => !genderForm(r));
  let a = q.at - 1;
  while (a > 0 && !cuts(q.words[a + 1].before) && adjectival(q.words[a]) && !ARTICLES.has(q.words[a].low)) a--;
  const article = q.at > 0 && a >= 0 && !cuts(q.words[a + 1].before) && ARTICLES.has(q.words[a].low) ? q.words[a].low : '';
  const fits = (r: ContextReading): boolean => !article || agrees(article, r);
  if (own.length < nouns.length && (own.some((r) => (r.key === w.text || /\bplural\b/.test(r.form)) && fits(r)) || (!own.length && has(w, verbal)))) nouns = own;
  if (!nouns.length) return has(w, verbal) ? prefer(verbal) : null;
  // A verb's infinitive made a noun is neuter: where a neuter singular can stand it is that noun ("beim Lesen", Immensee),
  // or the verb when the dictionary lacks the noun ("statt ihn mit Weinen und Zureden zu stören", Die Verwandlung, is
  // crying, not the wines); elsewhere it is another noun spelled alike ("kleine goldglänzende, stahlblaue Fliegen" are flies,
  // not das Fliegen "flying").
  if (has(w, verbal)) {
    const self = nouns.filter((r) => r.key === w.text && r.form === '' && r.gender.includes('n'));
    // Joined by und to a noun before, it stands where that one does: "rings um sie her ein feines Schwirren und Summen"
    // (Immensee) is buzzing, not Summe's plural "sums".
    const slot = prev && /^(?:und|oder)$/.test(prev.low) && q.at > 1 && !cuts(prev.before) && nounHere(q, q.at - 2)
      ? neuterSlot(q, q.at - 2) : neuterSlot(q, q.at);
    // After dem or beim a masculine noun fits as well, and its frequency speaks: "an einem Braten" is a roast.
    const masculine = nouns.some((r) => !self.includes(r) && r.gender.includes('m') && !/\bplural\b/.test(r.form));
    // The verb's noun is singular: before a genitive it is the act ("Was ist Anhalten des Atems?", Siddhartha), not
    // Anhalt's dative plural.
    const opens = !prev || (['verb', 'pronoun', 'adverb', 'conjunction'].includes(prev.chosen?.pos ?? '') && !adjectival(prev));
    const genitive = opens && joined(q, q.at) && /^(?:des|der|eines|einer)$/.test(q.words[q.at + 1].low) && !self.length
      && nouns.every((r) => /^dative plural$/.test(r.form));
    if (genitive) return prefer(verbal);
    // After das with no neuter noun of its own spelled so, the verb's noun: "das Hämmern der Spechte und das Kreischen der
    // andern Waldvögel" (Immensee) is hammering, not Hammer's dative plural; "das Kratzen der Möbel" (Die Verwandlung).
    const neuter = nouns.filter((r) => r.gender.includes('n') && !/\bplural\b/.test(r.form));
    if (slot === 'n' && !self.length) return neuter.length ? prefer((r) => neuter.includes(r)) : prefer(verbal);
    if (slot === 'n' || (slot === 'mn' && !masculine)) return self.length ? prefer((r) => self.includes(r)) : null;
    if (!slot && self.length < nouns.length) nouns = nouns.filter((r) => !self.includes(r));
  }
  // An adjective made a noun after etwas, nichts, viel, wenig: "um irgend etwas Gutes zum Essen zu bitten" (Die Verwandlung)
  // is something good, not das Gut's genitive "property".
  if (prev && /^(?:etwas|nichts|viel|wenig|allerlei|mancherlei|genug)$/.test(prev.low) && /es$/.test(w.low)) {
    const made = nouns.filter((r) => r.key === w.text && r.form === '');
    if (made.length) return prefer((r) => made.includes(r));
  }
  // Only between nouns of different genders: Kommis (clerk) and Kommi (commie) are both masculine, and their frequency speaks.
  // The article may stand before the adjectives: "aus dem schattigen Laube" (Immensee) is das Laub's dative, "leaves".
  let d = q.at - 1;
  while (d > 0 && !cuts(q.words[d + 1].before) && adjectival(q.words[d]) && !ARTICLES.has(q.words[d].low)) d--;
  const det = prev && d >= 0 && !cuts(q.words[d + 1].before) ? q.words[d] : undefined;
  // After ein, kein, mein … the adjective's ending says the gender: "Sie nahm ein braunes Reis aus der Blechkapsel" (Immensee)
  // is das Reis "shoot", not der Reis "rice".
  const first = det && d + 1 < q.at ? q.words[d + 1].low : '';
  const marker = det && /^(?:ein|kein|mein|dein|sein|ihr|unser|euer)$/.test(det.low) ? (/es$/.test(first) ? 'das' : /er$/.test(first) ? 'der' : '') : '';
  const fit = det && new Set(nouns.map((r) => r.gender)).size > 1 ? nouns.filter((r) => agrees(marker || det.low, r)) : [];
  if (fit.length && fit.length < nouns.length) return prefer((r) => fit.includes(r));
  // After an adjective, a noun of its own, not an adjective made a noun: "mit ausgebreiteten Armen" (Die Verwandlung) are
  // arms, not Armer "poor person". (The article decides first: "einen großen Weisen" is a sage.)
  if (prev && adjectival(prev) && nouns.some((r) => r.form !== 'inflected form')) nouns = nouns.filter((r) => r.form !== 'inflected form');
  return prefer((r) => nouns.includes(r));
}

/**
 * Whether word i stands where a neuter singular noun can: only one ('n': after das, ins, an adjective in -es), a neuter or
 * a masculine one ('mn': after dem, des, beim, einem, an adjective in -em, a bare preposition), or neither (''). A verb made a
 * noun is neuter: "rief die Mutter schon unter Weinen", "ein vorsichtiges Schließen der … Tür" (Die Verwandlung); but
 * "seiner moralischen Reden" (Immensee) are speeches, and "die freien Stellen des Bodens" places.
 */
function neuterSlot(q: ContextQuery, i: number): 'n' | 'mn' | '' {
  let j = i - 1;
  // Adjectives in a row, a comma between them or not: "das unregelmäßige, schlechte Essen" (Die Verwandlung).
  const link = (k: number): boolean => !cuts(q.words[k].before) || (q.words[k].before === ',' && k < i && adjectival(q.words[k]));
  while (j >= 0 && link(j + 1) && adjectival(q.words[j]) && !/^(?:der|die|das|den|dem|des)$/.test(q.words[j].low)) {
    const a = q.words[j].low;
    const det = j > 0 && link(j) ? q.words[j - 1].low : '';
    if (/es$/.test(a) && !/^(?:des|eines|[mds]eines|ihres|unseres|dieses|jenes)$/.test(det)) return 'n';
    if (/e[sm]$/.test(a)) return 'mn';
    if (/en$/.test(a) && !/^(?:dem|des|im|am|zum|vom|beim|einem|eines)$/.test(det)) return '';
    j--;
  }
  // Adjectives with no article before them say it with their own ending, and -e or -er is never a neuter singular:
  // "kleine goldglänzende, stahlblaue Fliegen" (Immensee) are flies.
  if (j + 1 < i && (j < 0 || !link(j + 1)) && /e[r]?$/.test(q.words[j + 1].low)) return '';
  if (j < 0 || !link(j + 1)) return 'mn';
  const d = q.words[j].low;
  if (/^(?:das|ins|aufs|ans|durchs|fürs|ums|übers|dieses|jedes|keines|alles|vieles|manches|etwas|nichts)$/.test(d)) return 'n';
  if (/^(?:dem|des|im|am|zum|vom|beim|ein|eines|einem|kein|keinem|diesem|jedem)$/.test(d)) return 'mn';
  if (POSSESSIVE_WORD.test(d)) return /^(?:mein|dein|sein|ihr|unser|euer)$/.test(d) ? 'mn' : /es$/.test(d) ? 'n' : /em$/.test(d) ? 'mn' : '';
  return q.words[j].chosen?.pos === 'preposition' ? 'mn' : '';
}

/** The genders, numbers and cases an article (or a determiner with its ending) allows: der Alte is masculine nominative. */
function agrees(article: string, r: ContextReading): boolean {
  let det = article;
  // A contraction carries its article: am Herde (an dem) is Herd's dative, not die Herde "herd" (Max und Moritz).
  if (/^(?:am|im|vom|zum|beim)$/.test(det)) det = 'dem';
  else if (det === 'zur') det = 'der';
  else if (/^(?:ins|ans|aufs|durchs|fürs|ums|übers)$/.test(det)) det = 'das';
  // ein, mein, kein have no ending (masculine or neuter nominative): "was war das für ein Graus" is a horror, not Grau's genitive.
  const own = /^(?:ein|kein|mein|dein|sein|ihr|unser|euer|dies|jen|jed|welch)(e|em|en|er|es)?$/.exec(det);
  const end = { der: 'er', die: 'e', das: 'es', den: 'en', dem: 'em', des: 'es' }[det] ?? (own ? own[1] ?? '' : null);
  if (end === null) return true;
  const g = r.gender;
  const form = r.form;
  // A headword is the nominative singular; a nominalized adjective's "inflected form" says nothing of its case.
  if (/inflected/.test(form)) return true;
  // Eltern is a plural of its own (gender "pl"); der Nachzügler, die Nachzügler: a masculine or neuter noun in -er, -el, -en,
  // -chen or -lein is its own plural.
  // A masculine noun in -e is weak, -n in every other case (der Junge, dem Jungen): "aus dem schattigen Laube" (Immensee) is
  // not der Laube, the fish.
  const parts = form ? form.split(/;\s*/) : g === 'pl' ? ['plural'] : /(?:er|el|en|chen|lein)$/.test(r.head) && /[mn]/.test(g) ? ['singular', 'plural']
    : g === 'm' && /e$/.test(r.head) ? ['nominative singular'] : ['singular'];
  const fits = (gender: string, cases: string[], plural: boolean): boolean => parts.some((p) => {
    const pl = /\bplural\b/.test(p) || g === 'pl';
    if (pl !== plural) return false;
    // A form that names its gender has that one: der Letzte's "nominative/accusative neuter singular" is das Letzte.
    const named = p.match(/\b(?:masculine|feminine|neuter)\b/g);
    const own = named ? named.map((x) => x[0]).join('/') : g;
    if (!plural && !own.split('/').some((x) => gender.includes(x))) return false;
    const c = p.match(/nominative|accusative|dative|genitive/g);
    return !c || c.some((x) => cases.includes(x));
  });
  // einen is only masculine accusative singular: "einen großen Weisen und Priester" (Siddhartha) is a sage, not Weise's plural.
  if (det === 'einen') return fits('m', ['accusative'], false);
  switch (det === 'das' ? 'das' : det === 'des' ? 'des' : end) {
    case 'er': return det === 'der' || /^(?:dies|jen|jed|welch)/.test(det)
      ? fits('m', ['nominative'], false) || fits('f', ['dative', 'genitive'], false) || fits('', ['genitive'], true)
      : fits('f', ['dative', 'genitive'], false) || fits('', ['genitive'], true) || fits('m', ['nominative'], false);
    case 'e': return fits('f', ['nominative', 'accusative'], false) || fits('', ['nominative', 'accusative'], true);
    case 'das': return fits('n', ['nominative', 'accusative'], false);
    case 'es': case 'des': return fits('mn', ['genitive', 'nominative', 'accusative'], false);
    case 'en': return fits('m', ['accusative'], false) || fits('', ['dative', 'accusative', 'nominative', 'genitive'], true);
    case 'em': return fits('mn', ['dative'], false);
    default: return fits('mn', ['nominative', 'accusative'], false);
  }
}

/**
 * An adjective spelled like a verb, between a determiner or preposition and its noun: "seinem heißen Bauch" (Die
 * Verwandlung) is hot, not heißen "to be named"; "durch weise Lehren" (Max und Moritz) wise, not weisen "to point".
 */
function adjectiveBeforeNoun(q: ContextQuery): ContextChoice | null {
  const w = q.word;
  // andere, anderen before a noun is the adjective "other", not the pronoun "another": "der natürlich ganz andere
  // Möglichkeiten des Geldverdienens hatte" (Die Verwandlung). Only anderer: "einige Schritte" is "some", not einig "united".
  const top = w.readings[0];
  if (!isCap(w) && top?.pos === 'pronoun' && top.key === 'anderer' && joined(q, q.at) && nounHere(q, q.at + 1)
    && has(w, (r) => r.pos === 'adjective' && r.key === top.key && attributive(r, w.low))) return prefer((r) => r.pos === 'adjective' && r.key === top.key);
  // At a line's start, an adjective before its noun, not a form of a noun spelled alike: "Dürren Ast des Baumes hangen" (Max
  // und Moritz) is dry, not die Dürre "drought".
  if (q.sentenceStart && isCap(w) && top?.pos === 'noun' && top.form && joined(q, q.at) && nounHere(q, q.at + 1)
    && has(w, (r) => r.pos === 'adjective' && attributive(r, w.low))) return prefer((r) => r.pos === 'adjective');
  if (isCap(w) || !has(w, (r) => r.pos === 'verb' && !isParticiple(r)) || !has(w, (r) => r.pos === 'adjective' || isParticiple(r))) return null;
  // A content word: ein (the article, or einen's imperative) is not one.
  if (!['verb', 'adjective'].includes(w.readings[0].pos)) return null;
  if (!joined(q, q.at) || !(nounHere(q, q.at + 1) || adjectival(q.words[q.at + 1]))) return null;
  // What may stand before it: a determiner or preposition, an inflected adjective, one adverb after either ("mit einer fast
  // demütigen Dankbarkeit", Immensee), a determiner the dictionary reads first as a pronoun ("die Untersuchung dieser
  // verdächtigen Angelegenheit", Die Verwandlung), or a name's genitive ("streifte Reinhards heiße Stirne", Immensee).
  const lead = (k: number): boolean => {
    const x = q.words[k];
    if (!x) return false;
    if (isCap(x) && k > 0 && /s$/.test(x.low) && (x.name || /\bgenitive\b/.test(x.chosen?.form ?? ''))) return true;
    const pc = x.chosen;
    if (!pc) return false;
    if (['article', 'determiner', 'preposition', 'contraction', 'numeral'].includes(pc.pos)) return true;
    if (pc.pos === 'adjective') return ENDING.test(x.low);
    return pc.pos === 'pronoun' && /^(?:dies|jen|welch|ein|kein|mein|dein|sein|ihr|unser|eur)(?:e|em|en|er|es)$/.test(x.low);
  };
  const at = q.at;
  if (at === 0 || cuts(w.before)) return null;
  const adverb = q.words[at - 1].chosen?.pos === 'adverb' && at > 1 && !cuts(q.words[at - 1].before);
  if (!(lead(at - 1) || (adverb && lead(at - 2)))) return null;
  return prefer((r) => r.pos === 'adjective' || isParticiple(r));
}

/**
 * An adjective without an ending is an adverb unless it is predicative, last in a clause with sein, werden, bleiben …: "Er
 * ging langsam" is slowly; "Es war ganz still" is quite (ganz) and quiet (still). German writes both alike; the dictionary
 * has an adverb section for the ones whose adverb a reader needs (ganz "quite", gleich "at once", endlich "finally").
 */
function adverbial(q: ContextQuery): ContextChoice | null {
  const w = q.word;
  const adj = w.readings.find((r) => r.pos === 'adjective' && r.form === '');
  const adv = w.readings.find((r) => r.pos === 'adverb' && r.form === '' && r.key === adj?.key);
  if (!adj || !adv || NARROW_ADVERB.has(adj.key) || (isCap(w) && !q.sentenceStart)) return null;
  // With an ending the headword lacks it is the adjective, which the dictionary lists bare (de-spelling.ts): "zu einem
  // ungeheueren Ungeziefer" (Die Verwandlung).
  if (w.low !== adj.key.toLowerCase() && ENDING.test(w.low) && w.low.startsWith(adj.key.toLowerCase())) return prefer((r) => r === adj);
  // Only a word read first as one of the two: zu is the particle "to" before its adjective "shut".
  if (w.readings[0] !== adj && w.readings[0] !== adv) return null;
  // A word standing alone ("Gut!", "Still!") is left to the generic rules, which make an interjection of it.
  if (clauseInitial(q, q.at) && cuts(w.after)) return null;
  // Before a noun it is the adjective: a headword in -e is also its inflected form ("Denn wer böse Streiche macht", Max und
  // Moritz), and voll takes a bare noun ("daß sie voll Tränen waren", Immensee). Not another adverb: "es war noch eben Zeit
  // genug", "Hatte er wirklich Lust".
  if ((w.low.endsWith('e') || adj.key === 'voll') && joined(q, q.at) && nounHere(q, q.at + 1)) return prefer((r) => r === adj);
  // voll "full of" takes a noun phrase, von or a genitive before it: "standen blühende Obstbäume voll summender wühlender
  // Bienen" (Immensee), "immer bin ich voll von Fragen gewesen", "edler Versprechungen voll" (Siddhartha).
  if (adj.key === 'voll' && ((joined(q, q.at) && (nounPhrase(q, q.at + 1) || q.words[q.at + 1].low === 'von'))
    || (cuts(w.after) && q.at > 0 && nounHere(q, q.at - 1) && !cuts(w.before)))) return prefer((r) => r === adj);
  // Opening its clause before a verb that is no copula, it is the adverb: "Natürlich muß er von Adel sein" (Effi Briest);
  // but "Schön ist es hier" puts the predicate first.
  const second = joined(q, q.at) ? verbOf(q.words[q.at + 1]) : undefined;
  if (clauseInitial(q, q.at) && second && personal(second) && !COPULAS.has(second.key)) return prefer((r) => r === adv);
  // Predicative: last in a clause with a copula, or followed only by a copula or auxiliary ("Es war still", "ihm ganz
  // unmöglich ist"); but "Es ging jetzt meist nur sehr still zu", "die Reisenden waren eben zurückgekehrt", "daß es mit ihm
  // nicht ganz in Ordnung war" (Die Verwandlung).
  const [s, e0] = clause(q, q.at);
  // A predicate joined to another one before their verb: "die ihm in allem zu folgen gewohnt und überdies lehrhaft war"
  // (Immensee), "wie fremd und still es ist"; not "wurde sie ärgerlich und stieß ein wenig" (Die Verwandlung).
  const [, eAll] = clause(q, q.at, false);
  let e = e0;
  if (eAll > e0 && /^(?:und|oder)$/.test(q.words[e0 + 1].low)) {
    let k = e0 + 2;
    while (k <= eAll && !isCap(q.words[k]) && ['adjective', 'adverb', 'pronoun'].includes(q.words[k].readings[0]?.pos ?? '')) k++;
    if (k === eAll && q.words[k].readings.some((r) => r.pos === 'verb' && (COPULAS.has(r.key) || AUXILIARIES.has(r.key)))) e = eAll;
  }
  // sein is "his" first by itself; at a clause's end it is the verb ("und konnte ruhig sein", Die Verwandlung).
  const key = (x: ContextWord): string | undefined => {
    const r = x.chosen ?? x.readings[0];
    return r?.pos === 'verb' ? r.key : x.readings.find((o) => o.pos === 'verb' && COPULAS.has(o.key) && o.form === '')?.key;
  };
  const span = q.words.slice(s, e + 1);
  const reflexive = span.some((x) => x.low in REFLEXIVE);
  // A copula: sein, werden, bleiben …; fühlen with sich ("er selbst fühlte sich durchaus nicht besonders frisch", Die
  // Verwandlung); sehen with aus closing the clause ("Du siehst so traurig aus", Immensee); stehen, liegen, lassen with a
  // state ("Die Türen standen offen", Immensee). A verb with a capital starts a line of verse: "Bin ich so schön" (Immensee).
  const closing = q.words[e].low;
  const copula = (x: ContextWord, j: number): boolean => {
    if (j > 0 && isCap(x) && x.readings.some((r) => r.pos === 'noun')) return false;
    const k = key(x);
    if (!k) return false;
    if (COPULAS.has(k) || COPULAS.has(closing + k)) return true;
    // A weaker copula only with the adjective last: "Gregor fühlte sich tatsächlich, abgesehen von einer …, ganz wohl" (Die
    // Verwandlung) has its predicate later.
    return !/,/.test(w.after) && ((k === 'fühlen' && reflexive) || (STATE.has(adj.key) && STATE_VERBS.has(k)));
  };
  // After the adjective only copulas and auxiliaries, the particle of a separated copula (aus), or zu before an infinitive.
  // Not a prepositional phrase, which may be the predicate itself: "um acht Uhr tatsächlich auf dem Bahnhof sein" (Die
  // Verwandlung) is "actually".
  let tail = true;
  for (let j = q.at + 1; j <= e; j++) {
    const x = q.words[j];
    if (copula(x, j) || AUXILIARIES.has(key(x) ?? '')) continue;
    if (j === e && span.some((y, k) => s + k !== q.at && COPULAS.has(x.low + (key(y) ?? '')))) continue;
    if (x.low === 'zu' && j < e) continue;
    // A pronoun subject before the verb that closes the clause: "Schau nur, wie fremd und still es ist" (Immensee).
    if (!isCap(x) && x.readings[0]?.pos === 'pronoun' && j < e) continue;
    if ((x.low === 'und' || x.low === 'oder') && j < e) {
      while (j + 1 < e && !isCap(q.words[j + 1]) && ['adjective', 'adverb'].includes(q.words[j + 1].readings[0]?.pos ?? '')) j++;
      continue;
    }
    tail = false;
    break;
  }
  const predicative = tail && span.some((x, j) => s + j !== q.at && copula(x, s + j));
  // The adverb read first stays where it is a sense of its own (bloß "merely", eben "just"); an adverb that is only the
  // adjective with -ly gives way: "Jetzt bin ich aber schon wieder ganz frisch" (Die Verwandlung), not "freshly".
  const ly = /^[a-z-]+ly\b/.test(adv.hint) && adv.score <= adj.score + 1;
  if (predicative && (ly || w.readings[0] === adj)) return prefer((r) => r === adj);
  if (predicative) return null;
  return prefer((r) => r === adv);
}

/**
 * A preposition needs its noun phrase after it; a word that is one and also an adjective is the adjective where none
 * follows: "aber so laut, daß es die Schwester hätte hören können", "und Gregor laut vor Wut darüber zischte" (Die
 * Verwandlung), "Laut ertönt sein Wehgeschrei" (Max und Moritz) are loud, not laut "according to". lauter before a noun with
 * no article is "nothing but": "Es waren lauter Verse" (Immensee), "vor lauter Unruhe".
 */
function stranded(q: ContextQuery): ContextChoice | null {
  const w = q.word;
  const next = joined(q, q.at) ? q.words[q.at + 1] : undefined;
  if (w.low === 'lauter' && has(w, (r) => r.key === 'lauter') && next && nounHere(q, q.at + 1)) {
    const pc = q.at > 0 && !cuts(w.before) ? q.words[q.at - 1].chosen : undefined;
    if (!pc || !['article', 'determiner'].includes(pc.pos)) return prefer((r) => r.key === 'lauter');
  }
  // um opens an infinitive clause too ("Um während der Ferienzeit eine …", Immensee), which zu() reads.
  if (w.readings[0].pos !== 'preposition' || (isCap(w) && !q.sentenceStart) || has(w, (r) => r.pos === 'conjunction')) return null;
  const adj = (r: ContextReading): boolean => r.pos === 'adjective';
  const adv = (r: ContextReading): boolean => r.pos === 'adverb';
  if (!has(w, adj) && !has(w, adv)) return null;
  // After its noun and before a mark, nach is "according to" ("ich meine der Zeit nach", Effi Briest), and über after a
  // stretch of time with ganz "throughout" ("Oft lag er dort die ganzen langen Nächte über", Die Verwandlung).
  const post = (r: ContextReading): boolean => r.pos === 'postposition';
  // Not nach closing a separable verb after its dative: "ging eifriger dem Handel nach" (Siddhartha) is nachgehen.
  const owner = q.at > 1 && !cuts(q.words[q.at - 1].before) ? q.words[q.at - 2].low : '';
  if (!next && has(w, post) && q.at > 0 && !cuts(w.before) && nounHere(q, q.at - 1) && !q.words[q.at - 1].name
    && (w.low === 'nach' ? /^(?:der|ihrer|seiner|meiner|deiner|unserer|eurer|dieser|jener)$/.test(owner)
      : q.words.slice(Math.max(0, q.at - 4), q.at).some((x) => /^ganze[nr]?$/.test(x.low)))) return prefer(post);
  // Before a mark, only a word with no adverb that is no separable particle: a particle closing its clause (aus, um, auf,
  // ab) is read by the generic rule, or joined to its verb.
  if (!next) return has(w, adv) || SEPARABLE_PARTICLES.includes(w.low) ? null : prefer(adj);
  if (nounPhrase(q, q.at + 1) || adjectival(next) || pastBeforeNoun(q, q.at + 1)) return null;
  // Before a verb, und, oder, daß: "redete laut und brauchte grobe Schimpfworte" (Siddhartha). Not before wie, which may
  // open the noun phrase: "mit wie viel fehlgeschlagenen Hoffnungen" (Werther).
  const n = next.readings[0];
  const none = /^(?:daß|dass|und|oder)$/.test(next.low) || (!isCap(next) && !!n && (personal(n)
    || (n.pos === 'preposition' && !has(w, adv))));
  if (!none) return null;
  return has(w, adv) ? prefer(adv) : prefer(adj);
}

/**
 * A past participle two verbs share: gehören and gefallen take a dative; without one in the clause, the participle is of
 * hören and fallen: "ob man recht gehört hatte" (Die Verwandlung) heard, "Da drin ist etwas gefallen" fallen; but "er hat
 * dir auch gut gefallen" (Effi Briest) pleased. Before an auxiliary closing a clause, a word that is a participle and an
 * adverb is the participle: "als der ganze Fund bestimmt und geordnet war" (Immensee) identified, not "certainly".
 * gewohnt with sein and a zu-infinitive is "used to": "die ihm in allem zu folgen gewohnt und überdies lehrhaft war".
 */
function participle(q: ContextQuery): ContextChoice | null {
  const w = q.word;
  if (isCap(w) || !has(w, isParticiple)) return null;
  const [s, e] = clause(q, q.at, false);
  const span = q.words.slice(s, e + 1);
  const aux = (k: string): boolean => span.some((x, j) => s + j !== q.at && (verbOf(x)?.key === k || x.readings.some((r) => r.pos === 'verb' && r.key === k && isFiniteVerb(r))));
  // gehört, gefallen: the ge- verb's reading against the bare verb's participle. A weak one (-t) with haben or werden, as
  // hören takes; a strong one (-en) with sein only when the two are near alike by the word alone: "Lotte war indes in einen
  // sonderbaren Zustand geraten" (Werther) is geraten "to get into", not raten's.
  const base = w.readings.find((r) => isParticiple(r) && w.readings.some((o) => o !== r && o.pos === 'verb' && o.key === 'ge' + r.key));
  const own = base && w.readings.find((o) => o.pos === 'verb' && o.key === 'ge' + base.key);
  const dative = (x: ContextWord): boolean => DATIVE.has(x.low) || /^(?:[dms]?einem|ihrem|unserem|eurem|diesem|jenem|keinem|welchem)$/.test(x.low);
  const weak = /t$/.test(w.low) && (aux('haben') || aux('werden'));
  const strong = /en$/.test(w.low) && aux('sein') && !!own && base!.score > own.score - 0.5;
  if (base && (weak || strong) && !span.some((x, j) => s + j !== q.at && dative(x))) return prefer((r) => r === base);
  if (w.low === 'gewohnt' && aux('sein') && span.some((x) => x.readings.some((r) => /zu-infinitive/.test(r.form)) || x.low === 'zu')) {
    return has(w, (r) => r.pos === 'adjective') ? prefer((r) => r.pos === 'adjective') : null;
  }
  if (w.readings[0].pos !== 'adverb') return null;
  // Before an auxiliary that ends the clause, or before und and another participle that does.
  const n1 = q.at + 1 <= e ? q.words[q.at + 1] : undefined;
  const auxAt = (j: number): boolean => j === e && !!q.words[j].readings.some((r) => r.pos === 'verb' && AUXILIARIES.has(r.key) && isFiniteVerb(r));
  const before = (n1 && auxAt(q.at + 1)) || (n1?.low === 'und' && q.at + 2 <= e && q.words[q.at + 2].readings.some(isParticiple) && auxAt(q.at + 3));
  return before ? prefer(isParticiple) : null;
}

/**
 * A word that is a verb's past form and an inflected adjective stands before its noun as the adjective; anywhere else it is
 * the verb: "statt dessen verfaßte er ein langes Gedicht" (Immensee) wrote, "sagte er sich und erstarrte fast" (Die
 * Verwandlung) froze, "die die Aussicht auf den See verdeckten" hid, not verfasst, erstarrt, verdeckt.
 */
function pastForm(q: ContextQuery): ContextChoice | null {
  const w = q.word;
  if (isCap(w) || w.readings[0].pos !== 'adjective' || !w.readings[0].form) return null;
  const finite = (r: ContextReading): boolean => isFiniteVerb(r) && /\bpreterite\b/.test(r.form);
  if (!has(w, finite)) return null;
  if (joined(q, q.at) && nounPhrase(q, q.at + 1, 'near')) return null;
  const prev = q.at > 0 && !cuts(w.before) ? q.words[q.at - 1] : undefined;
  // An adjective without an ending is an adverb here: "die sie in einem Schubfach ihrer Schatulle sorgfältig aufbewahrte"
  // (Immensee) kept.
  if (prev?.chosen && (['article', 'determiner', 'numeral'].includes(prev.chosen.pos) || (prev.chosen.pos === 'adjective' && ENDING.test(prev.low)))) return null;
  // "es solle keine übereilte, keine rasche Tat sein" (Werther), "von Eurer ganz berauschten, aber auch etwas müden Effi"
  // (Effi Briest): a determiner before it, or before the adverb before it.
  const determiner = (x: ContextWord | undefined): boolean => !!x && /^(?:dies|jen|welch|ein|kein|mein|dein|sein|ihr|unser|eur)(?:e|em|en|er|es)$/.test(x.low);
  const before = prev?.chosen?.pos === 'adverb' && q.at > 1 && !cuts(prev.before) ? q.words[q.at - 2] : undefined;
  if (determiner(prev) || determiner(before) || ['article', 'determiner'].includes(before?.chosen?.pos ?? '')) return null;
  return prefer(finite);
}

/**
 * After an article comes no verb: "einen breiten Schatten erst auf einen weiß und grün quadrierten Fliesengang" (Effi Briest)
 * is white, not weiß "knows".
 */
function afterArticle(q: ContextQuery): ContextChoice | null {
  const w = q.word;
  const pc = q.at > 0 && !cuts(w.before) ? q.words[q.at - 1].chosen : undefined;
  if (isCap(w) || pc?.pos !== 'article' || w.readings[0].pos !== 'verb' || !joined(q, q.at)) return null;
  // Inside its noun phrase, before the noun or another adjective ("Was soll das heißen?" has the pronoun das).
  const next = q.words[q.at + 1];
  const inside = nounHere(q, q.at + 1) || adjectival(next)
    || (/^(?:und|oder)$/.test(next.low) && joined(q, q.at + 1) && q.words[q.at + 2].readings.some((r) => r.pos === 'adjective'));
  const nounish = (r: ContextReading): boolean => r.pos === 'adjective' || r.pos === 'numeral' || isParticiple(r);
  return inside && has(w, nounish) ? prefer(nounish) : null;
}

/**
 * An adverb's short form against a verb's: "Ihr Freund Erich hat ihn heut Mittag … hereingeschickt" (Immensee) is heute
 * "today", not heuen "makes hay", which would need its subject before it.
 */
function shortAdverb(q: ContextQuery): ContextChoice | null {
  const w = q.word;
  const adv = (r: ContextReading): boolean => r.pos === 'adverb' && /^alternative form\b/.test(r.form);
  if (isCap(w) && !q.sentenceStart || w.readings[0].pos !== 'verb' || !has(w, adv)) return null;
  const prev = q.prev?.low ?? '';
  return NOMINATIVE.has(prev) || prev === 'sie' ? null : prefer(adv);
}

/**
 * da: the conjunction "since, as" opens a clause whose verb comes last ("da er krank war"); everywhere else it is the adverb
 * "there, then": before its verb ("Seht, da ist die Witwe Bolte", Max und Moritz; "und da kam sie", Immensee), inside a
 * clause, or ending one ("Angewurzelt stand sie da").
 */
function da(q: ContextQuery): ContextChoice | null {
  if (q.word.low !== 'da') return null;
  const adv = (r: ContextReading): boolean => r.pos === 'adverb';
  if (!has(q.word, adv)) return null;
  // "hie und da", "hier und da": now and then, there.
  const pair = q.at >= 2 && q.words[q.at - 1].low === 'und' && ['hie', 'hier', 'dort'].includes(q.words[q.at - 2].low);
  const conj = !pair && clauseInitial(q, q.at) && joined(q, q.at) && !verbOf(q.words[q.at + 1]) && !!finalVerb(q, q.at);
  return conj ? prefer((r) => r.pos === 'conjunction') : prefer(adv);
}

/**
 * denn: the conjunction "for" opens its clause; inside one it is the particle of a question ("was ist denn los?", Die
 * Verwandlung). doch: "but, yet" opening a clause ("Doch der Bäcker, mit Bedacht", Max und Moritz), "yes" standing alone,
 * "after all" inside a clause. ja: "yes" before a mark or another ja ("Ja, ja, danke, Mutter"), the particle inside a clause.
 */
function particle(q: ContextQuery): ContextChoice | null {
  const w = q.word;
  const initial = clauseInitial(q, q.at);
  const alone = initial && cuts(w.after);
  if (w.low === 'denn') return initial ? prefer((r) => r.pos === 'conjunction') : prefer((r) => r.pos === 'adverb');
  if (w.low === 'doch') {
    if (alone && has(w, (r) => r.pos === 'particle')) return prefer((r) => r.pos === 'particle');
    return initial ? prefer((r) => r.pos === 'conjunction') : prefer((r) => r.pos === 'adverb');
  }
  if (w.low === 'ja') {
    const yes = cuts(w.after) || (joined(q, q.at) && q.words[q.at + 1].low === 'ja') || (q.at > 0 && q.words[q.at - 1].low === 'ja' && !cuts(w.before));
    return yes && initial ? prefer((r) => r.pos === 'interjection') : null;
  }
  return null;
}

/**
 * zu: "too" before an adjective or adverb without an ending ("zu spät", "zu wenig"), "to" before an infinitive or a noun.
 * um: "in order to" with zu and an infinitive later in its clause ("um die zappelnden Beine nicht sehen zu müssen", "um sich
 * aufzurichten", Die Verwandlung), else the preposition.
 */
function zu(q: ContextQuery): ContextChoice | null {
  const w = q.word;
  if (w.low === 'zu' && joined(q, q.at)) {
    const n = q.words[q.at + 1];
    if (isCap(n) || n.readings.some((r) => r.pos === 'verb' && (r.form === '' || /infinitive/.test(r.form)))) return null;
    const top = n.readings[0];
    if (top && ['adjective', 'adverb'].includes(top.pos) && top.form === '' && !(joined(q, q.at + 1) && nounHere(q, q.at + 2))) {
      return prefer((r) => r.pos === 'adverb');
    }
    return null;
  }
  // ohne, statt, anstatt the same, and before daß: "und gab, ohne daß man es von ihr verlangte, einen fürchterlichen Schwur
  // ab" (Die Verwandlung) is the conjunction, which keeps the clause apart from the verb ab belongs to.
  if (INFINITIVE_OPENERS.has(w.low) && w.low !== 'um' && joined(q, q.at) && /^da(?:ß|ss)$/.test(q.words[q.at + 1].low)
    && has(w, (r) => r.pos === 'conjunction')) return prefer((r) => r.pos === 'conjunction');
  if (INFINITIVE_OPENERS.has(w.low) && joined(q, q.at) && has(w, (r) => r.pos === 'conjunction')) {
    const [, e] = clause(q, q.at, false);
    for (let j = q.at + 1; j <= e; j++) {
      const x = q.words[j];
      const inf = x.readings.some((r) => r.pos === 'verb' && /zu-infinitive/.test(r.form))
        || (x.low === 'zu' && j < e && q.words[j + 1].readings.some((r) => r.pos === 'verb' && r.form === ''));
      if (inf) return prefer((r) => r.pos === 'conjunction');
    }
  }
  return null;
}

/**
 * Conjunction, preposition or adverb by what follows: während with a subject is "while", with a genitive "during"; damit
 * opening a clause with its subject next and its verb last is "so that", else "with it" ("Fort damit", Max und Moritz). wie
 * is "how" opening a question or a clause about a quality ("wie schön sie war"), else "as, like".
 */
function clauseWord(q: ContextQuery): ContextChoice | null {
  const w = q.word;
  if (w.low === 'während') {
    // The preposition takes the genitive (während des Essens, während seines fünfjährigen Dienstes); the conjunction a
    // subject ("während er eifrig an einem Braten herumschnitt", "während die Mutter ihr Nähzeug …"). der, einer, ihrer … can
    // be either: the clause's last verb decides ("während der Vater schlief", "Während der Überfahrt ließ Elisabeth …").
    const n = joined(q, q.at) ? q.words[q.at + 1] : undefined;
    if (!n) return null;
    const conj = (r: ContextReading): boolean => r.pos === 'conjunction';
    const prep = (r: ContextReading): boolean => r.pos === 'preposition';
    if (['des', 'eines', 'seines', 'ihres', 'meines', 'deines', 'unseres', 'dieses', 'jenes', 'dessen', 'deren'].includes(n.low)) return prefer(prep);
    if (NOMINATIVE.has(n.low) || n.low === 'sie' || ['die', 'das', 'ein', 'eine'].includes(n.low) || n.name || nounHere(q, q.at + 1)) return prefer(conj);
    return prefer(finalVerb(q, q.at) ? conj : prep);
  }
  if (w.low === 'damit') {
    // The conjunction "so that" opens a clause with its subject next and its verb last ("damit die Freude desto größer sei",
    // Immensee); "Damit hatte er aber auch die …" and "damit begnügen" are the adverb "with it".
    const n = joined(q, q.at) ? q.words[q.at + 1] : undefined;
    const conj = clauseInitial(q, q.at) && !!n && !n.readings.some((r) => r.pos === 'verb' && n.readings[0]?.pos === 'verb') && !!finalVerb(q, q.at);
    return conj ? prefer((r) => r.pos === 'conjunction') : prefer((r) => r.pos === 'adverb');
  }
  if (w.low === 'wie' && has(w, (r) => r.pos === 'adverb') && clauseInitial(q, q.at)) {
    const n = joined(q, q.at) ? q.words[q.at + 1] : undefined;
    const quality = !!n && !isCap(n) && n.readings[0]?.pos === 'adjective' && n.readings[0].form === '' && !!finalVerb(q, q.at + 1);
    if ((q.question && q.at === 0) || quality) return prefer((r) => r.pos === 'adverb');
  }
  return null;
}

/**
 * selbst after a pronoun or noun, or ending its clause, is "oneself" ("er selbst war doppelt so alt", Immensee; "der
 * Prokurist selbst", Die Verwandlung); before what it stresses it is "even" ("Und selbst wenn er den Zug einholte").
 * alles not before a noun is "everything": "alles andere besorgte die Mutter", but "alles Gute".
 */
function selbst(q: ContextQuery): ContextChoice | null {
  const w = q.word;
  if (w.low === 'selbst') {
    const prev = q.at > 0 && !cuts(w.before) ? q.words[q.at - 1] : undefined;
    const pc = prev?.chosen;
    const after = !!prev && (prev.name || (isCap(prev) && q.at > 1) || (!!pc && ['pronoun', 'noun', 'proper noun'].includes(pc.pos)));
    if ((after || cuts(w.after)) && has(w, (r) => r.pos === 'particle')) return prefer((r) => r.pos === 'particle');
    return null;
  }
  if (w.low === 'alles' && has(w, (r) => r.key === 'alles')) {
    if (joined(q, q.at) && nounHere(q, q.at + 1)) return null;
    return prefer((r) => r.key === 'alles');
  }
  return null;
}

/**
 * A verb with sich (or mich with ich, uns with wir …) in its clause takes its reflexive sense, wherever the pronoun stands:
 * "Er erinnerte sich" is remembered, "setzte er sich in den Lehnstuhl" sat down, "der sich dann … als reine Einbildung
 * herausstellte" turned out (Die Verwandlung). Not an auxiliary or modal: in "hat sich gesetzt" the reflexive is setzen's.
 */
function reflexive(q: ContextQuery): boolean {
  const v = q.word.readings[0];
  if (!v || v.pos !== 'verb' || AUXILIARIES.has(v.key) || NOT_REFLEXIVE.has(v.key)) return false;
  const [s, e] = clause(q, q.at);
  const words = q.words.slice(s, e + 1).map((w) => w.low);
  // Not after a preposition: "zog Kopf und Beine an sich", "er tat vor sich selbst, als …" (Immensee) have sich as an object.
  const own = (x: string, j: number): boolean => x in REFLEXIVE && (REFLEXIVE[x] === null || words.includes(REFLEXIVE[x]!))
    && !(j > 0 && !INFINITIVE_OPENERS.has(words[j - 1]) && ['preposition', 'contraction'].includes(q.words[s + j - 1].chosen?.pos ?? q.words[s + j - 1].readings[0]?.pos ?? ''));
  if (!words.some(own)) return false;
  if (isFiniteVerb(v)) return true;
  // A participle or infinitive takes it after an auxiliary or modal, or alone ("um sich aufzurichten"), and only the last of
  // them: in "Er erinnerte sich … Schmerz empfunden zu haben" it is erinnern's, in "daß sie sich im leeren Zimmer verlassen
  // fühlen werde" fühlen's.
  for (let j = s; j <= e; j++) {
    if (j === q.at || (j > 0 && isCap(q.words[j]))) continue;
    const o = verbOf(q.words[j]);
    if (!o) continue;
    if (isFiniteVerb(o) && !AUXILIARIES.has(o.key)) return false;
    if (j > q.at && !isFiniteVerb(o) && !AUXILIARIES.has(o.key)) return false;
  }
  return true;
}

/**
 * A word said again and again is an exclamation: "Aber wehe, wehe, wehe!" (Max und Moritz) is "woe", not weh "sore".
 */
function repeated(q: ContextQuery): ContextChoice | null {
  const w = q.word;
  const again = (j: number): boolean => j >= 0 && j < q.words.length && q.words[j].low === w.low;
  if (!(again(q.at - 1) && /^,?$/.test(w.before)) && !(again(q.at + 1) && /^,?$/.test(w.after))) return null;
  return has(w, (r) => r.pos === 'interjection') ? prefer((r) => r.pos === 'interjection') : null;
}

const RULES = [sie, ihr, ihnen, lass, possessive, article, interjection, title, verbFirst, capitalNoun, stranded, adjectiveBeforeNoun,
  participle, pastForm, afterArticle, shortAdverb, adverbial, da, particle, zu, clauseWord, selbst, repeated];

export const germanContext: ContextRule = (q) => {
  for (const rule of RULES) {
    const answer = rule(q);
    if (answer) return answer;
  }
  // Every reading preferred keeps the likeliest one: only the reflexive sense is decided.
  if (reflexive(q)) return { prefer: () => true, margin: DECIDE, reflexive: true };
  return null;
};
