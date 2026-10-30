// Russian context rules (SpacedLang.context): the words a learner meets on every page whose reading depends on what stands
// around them. Each rule is grammar, what comes before and after, and each has its sentence from Tolstoy's stories,
// Kashtanka, White Nights, The Overcoat or The Captain's Daughter in tests/lang/spaced/ru-context.test.ts.
//
// - его, её, их are "his, her, their" before the noun they own and after a preposition (в его доме), and "him, her, them"
//   everywhere else: "сдвинул его с места", "звали его Михаил Иваныч".
// - все is "all" before a noun, "everyone" before a plural verb (Все засмеялись), "still" after its subject before a verb
//   with its object (она все жала мне руку), and всё "everything" otherwise; несколько "several" before a noun and
//   "somewhat" before an adjective (несколько рябоват); свет the world in "на свете", "вокруг света".
// - да standing alone before a comma or ! is "yes" (— Да, вы наймите у нас.); inside a clause it is "and, but".
// - что, как, чем open a question or exclamation as "what", "how", "what" (Что ж ты стоишь?), and are "that", "as", "than"
//   inside a sentence. то is "that" after a preposition (за то) and before ", что" (то, что он говорил).
// - After a preposition comes what it governs: из дома is the house, с лаем a bark, по набережной the embankment.
// - A noun-or-verb (начала: начало's "of the beginning", начать's "she began") is the verb before an infinitive or next to
//   its subject: "Тут Настенька остановилась и начала хохотать".
// - есть is "to eat" after a verb that takes an infinitive (стала есть, перестал есть); самого, самой are самый "the very"
//   before a noun (до самого дома) and сам "-self" before a pronoun (с самим собою); Полноте! is "come now".
// - After a full adjective, the noun that agrees with it (барское добро "the master's goods", not добро "okay"; but
//   "Дорогою задел его" is задеть, the instrumental agreeing with no noun); тем before a comparative is "all the (more)";
//   ни … ни "neither, nor"; ничего standing alone "it's all right".
// - Case: a preposition governs its cases (за ворот is the collar, not ворота's genitive plural), and ни, нет, a number,
//   a noun before or "не было" after ask for the genitive (и полка не было, стакан вина, ни слова). Where the
//   dictionary has two forms of one noun spelled alike, the case also says which stress the word has (ни сло́ва, твои
//   слова́).
// - A word standing alone that can be an interjection is one (Ладно, ладно; Гм…; О, вы угадали!); a short adjective after
//   its subject is the predicate (я с ним знаком, Савельич был прав); a verb that has its own -ся entry is that verb
//   (проститься "to say goodbye", not простить's passive), and Здравствуйте, Прощай are the greetings.
import { type ContextChoice, type ContextQuery, type ContextReading, type ContextWord } from './context';

const DECIDED = Infinity;
/** A weak cue: it chooses only between readings nearly as likely alone. */
const NEAR = 5;

/**
 * Words that are only ever prepositions. After one comes a noun, pronoun or adjective in the case it governs, never a
 * conjugated verb or an adverb: "Одна девочка ушла из дома в лес" (Tolstoy) is out of the house, not дома "at home".
 * Not после, около, вокруг, мимо, which are adverbs as well ("а после пошла"), nor надо "must".
 */
const PREPOSITIONS = new Set(['в', 'во', 'на', 'с', 'со', 'из', 'изо', 'от', 'ото', 'до', 'у', 'к', 'ко', 'о', 'об', 'обо', 'по',
  'за', 'под', 'подо', 'над', 'при', 'про', 'для', 'без', 'безо', 'через', 'перед', 'передо', 'между', 'сквозь', 'из-за',
  'из-под', 'возле', 'подле', 'среди', 'кроме', 'вместо', 'ради']);

/** The personal pronouns a sentence's subject can be: "— начала она" and "она начала" both make начала a verb. */
const SUBJECTS = new Set(['я', 'ты', 'он', 'она', 'оно', 'мы', 'вы', 'они']);

/**
 * Words that open a question or exclamation before что, как, чем, as the sentence's first word does: "Ну, что же?", "Но как
 * же, в кого же?", "И как заразительна эта радость!" (White Nights).
 */
const LEAD_INS = new Set(['а', 'и', 'но', 'ну', 'да', 'ах', 'ох', 'о', 'однако', 'боже', 'господи']);

/**
 * Verbs of knowing, seeing and telling, after which как and чем ask: "Я, право, не знаю, как отвечать", "мне очень хочется
 * знать, чем это кончится" (White Nights). Keys, as the dictionary folds them.
 */
const ASKING = new Set(['знать', 'верить', 'поверить', 'узнать', 'видеть', 'увидеть', 'слышать', 'услышать', 'понимать',
  'понять', 'помнить', 'вспомнить', 'смотреть', 'посмотреть', 'глядеть', 'спрашивать', 'спросить', 'рассказать', 'рассказывать',
  'сказать', 'описать', 'подумать', 'думать', 'догадаться', 'замечать', 'заметить', 'чувствовать', 'почувствовать']);

/** Verbs and words of need after which есть is the infinitive "to eat": "стала есть", "даёт много есть" (Kashtanka). */
const TAKES_INFINITIVE = new Set(['стать', 'начать', 'начинать', 'перестать', 'переставать', 'хотеть', 'захотеть', 'мочь',
  'уметь', 'любить', 'давать', 'дать', 'просить', 'попросить', 'бросить', 'кончить', 'садиться', 'сесть', 'пойти', 'идти',
  'сметь', 'успеть', 'забыть', 'учиться', 'привыкнуть', 'хотеться', 'захотеться']);
const NEED_WORDS = new Set(['много', 'нечего', 'охота', 'можно', 'нельзя', 'надо', 'нужно', 'пора', 'хочется', 'хотелось']);

/**
 * Words that are said of someone rather than owned: "мне его жаль", "жалко его стало". Before one, его is "him", though
 * the word can be an adjective.
 */
const PREDICATIVES = new Set(['жаль', 'жалко', 'нужно', 'надо', 'можно', 'нельзя', 'видно', 'слышно', 'стыдно', 'страшно',
  'больно', 'весело', 'грустно', 'скучно']);

/**
 * Words that stand for a determiner before a noun: свои, мои, эти, такие in "все свои фантастические годы". Not тот: "Но все
 * та же фантазия" is всё "still".
 */
const DETERMINER_LIKE = new Set(['мой', 'твой', 'свой', 'наш', 'ваш', 'этот', 'такой', 'какой', 'всякий', 'каждый',
  'другой', 'иной', 'весь', 'сам', 'самый', 'один', 'два', 'три', 'четыре']);

/**
 * The cases each preposition governs. After one, a word is in one of them: "Батюшка за ворот приподнял его" (The Captain's
 * Daughter) is ворот "collar" in the accusative, not ворота's genitive plural; "час от часу" the partitive ча́су, "в лесу́"
 * the locative. Prepositions that are adverbs as well (после, около, мимо) count only here, where a word with no case is
 * left alone.
 */
const PREP_CASES: Record<string, string[]> = (() => {
  const out: Record<string, string[]> = {};
  const set = (words: string, cases: string): void => {
    for (const w of words.split(' ')) out[w] = cases.split(' ');
  };
  set('в во на', 'accusative prepositional locative');
  set('о об обо', 'prepositional accusative');
  set('при', 'prepositional');
  set('по', 'dative accusative prepositional');
  set('за под подо', 'accusative instrumental');
  set('над надо перед передо', 'instrumental');
  set('между меж', 'instrumental genitive');
  set('с со', 'genitive instrumental accusative');
  set('к ко', 'dative');
  set('про через сквозь', 'accusative');
  set('из изо от ото до у без безо для из-за из-под возле подле среди кроме вместо ради около после мимо вокруг вдоль '
    + 'против посреди вроде насчет сверх', 'genitive');
  return out;
})();

/** Words after which a noun is in the genitive: "ни слова", "и полка не было", "сколько раз", "нет денег". */
const GENITIVE_AFTER = new Set(['ни', 'нет', 'сколько', 'столько', 'несколько', 'много', 'мало', 'немного', 'немало']);
/** How far a noun's genitive after another noun may be below the likeliest reading: "стакан вина" (wine, 0.6 below guilt). */
const AFTER_NOUN = 2.5;

/** Two, three and four take the genitive singular, or a noun's own counting form (два часа́, not ча́са). */
const SMALL_NUMBERS = new Set(['два', 'две', 'три', 'четыре', 'полтора', 'полторы']);

/**
 * Verbs a short adjective follows as the predicate: "Савельич был прав", "мороз показался не велик", "Новый мир был велик"
 * (Kashtanka). Keys.
 */
const LINKING = new Set(['быть', 'стать', 'становиться', 'казаться', 'показаться', 'оказаться', 'сделаться', 'являться']);

// ---- what a reading is

const verb = (r: ContextReading | undefined): boolean => r?.pos === 'verb';
/** An infinitive: a verb read as its headword (Russian verbs are listed by it) or so described. */
const infinitive = (r: ContextReading | undefined): boolean => verb(r) && (!r!.form || /\binfinitive\b/.test(r!.form));
/**
 * A word that is an infinitive: one of its readings is, or it ends like one and is a verb. The dictionary reads a -ся
 * infinitive first as the plain verb's "passive": "вся кровь начала бросаться в голову" (White Nights). Not есть when it is
 * быть's "is": "что есть, вероятно, и такие" (A Hero of Our Time).
 */
const infinitiveWord = (w: ContextWord | undefined): boolean => !!w && !finite(w.readings[0]) && w.readings.some((r) => verb(r)
  && (infinitive(r) || (/\bpassive\b/.test(r.form) && /(?:ть|ти|чь)(?:ся|сь)$/.test(w.low))));
/** A gerund (глядя, ответив): Wiktionary calls it an adverbial participle. */
const gerund = (r: ContextReading | undefined): boolean => verb(r) && /\badverbial participle\b/.test(r!.form);
/** A participle that declines like an adjective (поражённая, сшитые), not a gerund. */
const participle = (r: ContextReading | undefined): boolean =>
  verb(r) && /\bparticiple\b/.test(r!.form) && !/\badverbial\b/.test(r!.form);
/** A form with a tense: сказала, знаете, пойду (an imperative too when `imperative`). */
const finite = (r: ContextReading | undefined, imperative = false): boolean => verb(r) && !/\bparticiple\b/.test(r!.form)
  && (/\b(?:past|present|future)\b/.test(r!.form) || (imperative && /\bimperative\b/.test(r!.form)));
/** Past plural or third-person plural: засмеялись, учатся, переедут. */
const pluralVerb = (r: ContextReading | undefined): boolean =>
  finite(r) && /\bplural\b/.test(r!.form) && !/\b(?:first|second)-person\b/.test(r!.form);
/** A short adjective (рад, готов, знаком): it is said of a noun, not put before one. */
const shortForm = (r: ContextReading): boolean => /\bshort form\b/.test(r.form);
/** A word that can own a possessive or follow a determiner: a noun, a full adjective or participle. */
const nounLike = (r: ContextReading | undefined): boolean =>
  !!r && ((r.pos === 'noun' || r.pos === 'proper noun' || r.pos === 'adjective') && !shortForm(r) || participle(r));
/** What a preposition governs: anything with a case. */
const caseBearing = (r: ContextReading): boolean =>
  ['noun', 'proper noun', 'pronoun', 'adjective', 'determiner', 'numeral'].includes(r.pos) || participle(r);

const top = (w: ContextWord | undefined): ContextReading | undefined => w?.readings[0];
const read = (w: ContextWord | undefined): ContextReading | undefined => w?.chosen ?? w?.readings[0];
const comma = (s: string): boolean => s.startsWith(',');

// ---- case, number and gender

/** One way a form can be read: its cases, singular or plural (undefined when it says neither), and genders (m, f, n). */
interface Slot { cases: Set<string>; plural?: boolean; genders: Set<string> }

/** The endings of a full adjective or participle (сказанный, сказанного), not a short one (сказано). */
const ADJ_END = '(?:ый|ий|ой|ая|яя|ое|ее|ые|ие|ого|его|ому|ему|ым|им|ом|ем|ую|юю|ою|ею|ых|их|ыми|ими)';

const CASE_NAMES = /\b(nominative|genitive|partitive|dative|accusative|instrumental|prepositional|locative)\b/g;

/**
 * The ways a reading's form can be read, one per part between semicolons ("genitive; nominative plural" is a genitive
 * singular or a nominative plural). The partitive is a genitive (из дому, час от часу); the locative its own case (в лесу́).
 * A noun or adjective read as its headword is the nominative, and the accusative too but for a feminine noun in -а/-я. A
 * noun's form with no description at all is its counting form, a genitive: два часа́ (the builder writes its description
 * empty). A verb, an adverb or a pronoun's headword gives none.
 */
function slotsOf(r: ContextReading, w: ContextWord): Slot[] {
  const own = r.pos === 'noun' || r.pos === 'proper noun' ? r.gender.split('/').filter(Boolean) : [];
  const pluralOnly = own.includes('pl');
  const sing = own.filter((g) => g !== 'pl');
  if (!r.form) {
    if (countForm(r, w)) return [{ cases: new Set(['genitive']), plural: false, genders: new Set(sing) }];
    if (r.pos === 'noun' || r.pos === 'proper noun') {
      const cases = new Set(['nominative']);
      if (pluralOnly || !(own.includes('f') && /[ая]$/.test(r.head))) cases.add('accusative');
      // The number is left open: ребята is filed as a masculine noun, and is the plural of "все ребята".
      return [{ cases, plural: pluralOnly || undefined, genders: new Set(sing) }];
    }
    if (r.pos === 'adjective') return [{ cases: new Set(['nominative', 'accusative']), plural: false, genders: new Set(['m']) }];
    return [];
  }
  if (shortForm(r) || (r.pos === 'verb' && !participle(r))) return [];
  return r.form.split(';').map((part) => {
    const cases = new Set([...part.matchAll(CASE_NAMES)].map((m) => (m[1] === 'partitive' ? 'genitive' : m[1])));
    const genders = new Set(['masculine', 'feminine', 'neuter'].filter((g) => part.includes(g)).map((g) => g[0]));
    let plural: boolean | undefined = /\bplural\b/.test(part) ? true : /\bsingular\b/.test(part) || genders.size ? false : undefined;
    // A noun's form that names no number is a singular, of the noun's own gender.
    if (r.pos === 'noun' && plural === undefined && cases.size) plural = pluralOnly;
    if (r.pos === 'noun' && plural === false) for (const g of sing) genders.add(g);
    return { cases, plural, genders };
  });
}

/** A noun's counting form, which the builder writes with no description: часа́ of час, шага́ of шаг (два часа́). */
const countForm = (r: ContextReading, w: ContextWord): boolean =>
  r.pos === 'noun' && !r.form && (w.low === r.key + 'а' || w.low === r.key + 'я');

/**
 * Two readings of one entry: the forms spelled alike with another stress (сло́ва the genitive, слова́ the plural), not
 * another entry of the same key (пол "floor", "sex" and "half").
 */
const sameEntry = (a: ContextReading, b: ContextReading): boolean =>
  a.key === b.key && a.head === b.head && a.pos === b.pos && a.gender === b.gender && a.hint === b.hint;

/**
 * The builder's pointer from a feminine noun to the masculine it is the female of (хозяйка "masculine" of хозяин,
 * мечтательница of мечтатель): no form of a case, so never what a word agrees as.
 */
const genderPointer = (r: ContextReading): boolean => r.pos === 'noun' && /^(?:masculine|feminine)$/.test(r.form);

/** Every case a reading can be in (empty when it names none). */
function casesOf(r: ContextReading, w: ContextWord): Set<string> {
  const out = new Set<string>();
  for (const s of slotsOf(r, w)) for (const c of s.cases) out.add(c);
  return out;
}

/** A reading that can be in one of these cases. The locative is its own: "по снегу" is the dative сне́гу, "в снегу" снегу́. */
function inCase(r: ContextReading, w: ContextWord, cases: readonly string[]): boolean {
  const own = casesOf(r, w);
  return cases.some((c) => own.has(c));
}

/**
 * An adjective, determiner or participle and a noun agree: some reading of each shares a case (or names none), a number,
 * and in the singular a gender. "барское добро" agree; "Дорогою задел его" (The Overcoat) do not, an instrumental and a
 * nominative: дорогою is "on the way" and задел the verb.
 */
function agrees(adj: ContextReading, aw: ContextWord, noun: ContextReading, nw: ContextWord): boolean {
  const as = slotsOf(adj, aw);
  const ns = slotsOf(noun, nw);
  if (!as.length || !ns.length) return false;
  return as.some((a) => ns.some((n) => {
    if (a.cases.size && n.cases.size && ![...a.cases].some((c) => n.cases.has(c)
      || (c === 'prepositional' && n.cases.has('locative')) || (c === 'locative' && n.cases.has('prepositional')))) return false;
    if (a.plural !== undefined && n.plural !== undefined && a.plural !== n.plural) return false;
    return !(a.plural === false && n.plural === false && a.genders.size && n.genders.size && ![...a.genders].some((g) => n.genders.has(g)));
  }));
}

/** The word right before is a preposition, as read: из дома, за то, на его бледном лице. */
function afterPreposition(q: ContextQuery): boolean {
  return !!q.prev && PREPOSITIONS.has(q.prev.low) && read(q.prev)?.pos === 'preposition';
}

/** The sentence ends with an exclamation mark (Как они мучились…!). */
function exclaimed(q: ContextQuery): boolean {
  return q.words[q.words.length - 1].after.includes('!');
}

/**
 * The word opens its clause in a question or exclamation: first in the sentence, after a colon or dash, after a lead-in (Ну,
 * что же?) or after a name called (Иван Иваныч, что с тобой?).
 */
function opensClause(q: ContextQuery): boolean {
  if (startsSentence(q) || /[:—(«„]/.test(q.word.before)) return true;
  const before = q.words[q.at - 1];
  if (!before) return false;
  // The lead-in itself opens the clause: "Ну, что же?", not "что настоящий поэт уже умер и что друг его…".
  if (LEAD_INS.has(before.low)) return q.at === 1 || !!before.before;
  // A name called, unless a verb of believing or telling came first: "Верите ли вы, …, милая Настенька, что …" is "that".
  return before.name && !q.words.slice(0, q.at).some((w) => ASKING.has(read(w)?.key ?? ''));
}

/**
 * The word starts a sentence, and not by an ellipsis that leaves it open: "она не виновата… что она ничего не сделала!" goes
 * on in lower case.
 */
function startsSentence(q: ContextQuery): boolean {
  return q.sentenceStart && !(q.word.before.endsWith('…') && q.word.text[0] === q.word.text[0].toLowerCase());
}

/** The word before, across a comma, is a verb of knowing or telling: "не знаю, как отвечать". */
function afterAsking(q: ContextQuery): boolean {
  const before = q.words[q.at - 1];
  return !!before && comma(q.word.before) && ASKING.has(read(before)?.key ?? '');
}

/** A finite verb follows in the word's clause, past не, adverbs and particles: "я чаю не хочу". */
function clauseVerbAhead(q: ContextQuery): boolean {
  for (let i = q.at + 1; i < q.words.length && i <= q.at + 3; i++) {
    const w = q.words[i];
    if (w.before) return false;
    const r = top(w);
    if (finite(r)) return true;
    if (!(w.low === 'не' || r?.pos === 'adverb' || r?.pos === 'particle')) return false;
  }
  return false;
}

const choose = (prefer: (r: ContextReading) => boolean, margin = DECIDED): ContextChoice => ({ prefer, margin });
const has = (q: ContextQuery, f: (r: ContextReading) => boolean): boolean => q.word.readings.some(f);

// ---- the rules, one per word or kind of word

/**
 * его, её, их: the possessive "his, her, their" before the noun it owns, after a preposition (where "him" would be него:
 * "на его бледном лице") and after a noun it follows ("слова его", "Глаза его, как всегда, глядели серьёзно"); the pronoun
 * "him, her, them" everywhere else: "сдвинул его с места", "звали его Михаил Иваныч", "Я заставлю его уважать". A noun in
 * the instrumental after a verb is the means, not the thing owned: "Лев тронул её лапой", "прогнал их кнутом".
 */
function possessive(q: ContextQuery): ContextChoice | null {
  const own = (r: ContextReading): boolean => r.pos === 'pronoun' && r.key === q.word.low && !r.form;
  if (!has(q, own) || !has(q, (r) => !own(r))) return null;
  const yes = choose(own);
  const no = choose((r) => !own(r));
  const next = q.next;
  const n = top(next);
  const p = read(q.prev);
  if (afterPreposition(q)) return yes;
  // After a preposition that is an adverb as well, before its noun: "мимо их дома" (The Overcoat), "после его смерти".
  if (q.prev && PREP_CASES[q.prev.low] && ['preposition', 'adverb'].includes(p?.pos ?? '') && !!next?.readings.some(nounLike)) return yes;
  // A word the dictionary lacks after it is most often the noun: "опубликовать его вирши", "поражённая его грандиозностью";
  // but not one spelled like an infinitive: "заставило его заблистать".
  const unknownNext = !!next && !next.readings.length && !next.name && !/(?:ть|ти|чь|ться|тись)$/.test(next.low);
  if (next && !next.name && (nounLike(n) || unknownNext) && !PREDICATIVES.has(next.low)) {
    // The noun the adjectives lead to (тайным угрызением): in the instrumental or dative alone after a verb, it is how the
    // verb was done or to whom ("стал учить её разным наукам"), not the thing owned. After быть it is what one is: "как
    // будто оно было её кличкой".
    let head: ContextWord = next;
    for (let i = q.at + 1; i < q.words.length && i <= q.at + 3; i++) {
      const w = q.words[i];
      if (i > q.at + 1 && w.before) break;
      head = w;
      if (top(w)?.pos === 'noun' || !w.readings.length) break;
    }
    const cases = head.readings.filter((r) => r.pos === 'noun' || r.pos === 'adjective').map((r) => r.form);
    if (!head.readings.length && /(?:ом|ем|ой|ей|ою|ею|ами|ями|ью)$/.test(head.low)) cases.push('instrumental');
    const oblique = cases.length > 0 && cases.every((f) => /\b(?:instrumental|dative)\b/.test(f)
      && !/\b(?:nominative|genitive|accusative|prepositional)\b/.test(f));
    const linking = ['быть', 'стать', 'становиться', 'казаться', 'оказаться', 'сделаться', 'являться'].includes(p?.key ?? '');
    if (oblique && !linking && (finite(p, true) || infinitive(p) || gerund(p))) return no;
    return yes;
  }
  if (infinitiveWord(next)) return no;
  // After the noun it belongs to: "О приезде его я уже знаю", "Рука её задрожала", "при появлении их Тётка виляла хвостом".
  // A noun the dictionary lacks counts by its ending: "Сметливость его и тонкость чутья меня изумили" (The Captain's
  // Daughter).
  const prev = q.prev;
  const unknownNoun = !!prev && !prev.readings.length && !prev.name && /(?:ость|ние|ство|тие)$/.test(prev.low);
  if (prev && !prev.name && (p?.pos === 'noun' || unknownNoun)) {
    // But not when the clause has its subject already and the noun is a time ("Я целый год его любила").
    const clause = q.words.slice(0, q.at - 1);
    const from = clause.map((w) => !!w.before && /[,;:—]/.test(w.before)).lastIndexOf(true);
    const subject = clause.slice(Math.max(0, from)).some((w) => SUBJECTS.has(w.low));
    return subject && finite(n) ? no : yes;
  }
  return no;
}

/**
 * все: весь "all" before a noun or a word standing for a determiner (все ребята, все эти, все свои годы, во все глаза), before a
 * participle the dictionary lacks (все дарованные ей небом силы) and after a plural pronoun (мы все, кто ж эти все?); все
 * "everyone" before a plural verb, with adverbs and a preposition's phrase between (Все засмеялись, все молча смотрели, Все в
 * ту же минуту выбежали); всё "everything" otherwise (я все понял, все это, все еще). After its subject, before a verb that
 * has its object or is reflexive, it is the adverb "still, all the time": "она все жала мне руку" (White Nights). Spelled
 * всё, it is всё.
 */
function vse(q: ContextQuery): ContextChoice | null {
  const always = (r: ContextReading): boolean => r.key === 'все' && r.pos === 'adverb';
  if (q.prev && SUBJECTS.has(q.prev.low) && has(q, always) && keepsOn(q)) return choose(always);
  if (q.word.text.toLowerCase().includes('ё')) return null;
  const all = (r: ContextReading): boolean => r.key === 'весь';
  const everyone = (r: ContextReading): boolean => r.pos === 'pronoun' && r.head === 'все';
  const next = q.next;
  const n = top(next);
  // весь agrees as все: plural, or neuter singular (все время, все свое сердце). Not with a word in the instrumental or
  // dative alone ("светит на все иным светом", "все разом говорило") nor before a masculine or feminine noun as such ("все
  // вздор, все несбыточно": всё is nonsense). A genitive singular may be the plural (во все стороны): the dictionary gives
  // only the likeliest form of a word, so that is not held against it.
  const fits = (r: ContextReading): boolean => {
    if (r.pos === 'numeral') return true;
    const oblique = /\b(?:dative|instrumental|prepositional|locative)\b/.test(r.form);
    if (oblique && !/\b(?:nominative|accusative|genitive)\b/.test(r.form)) return false;
    // "Но все та же фантазия": та is feminine singular, so все is всё "still".
    if (/\b(?:masculine|feminine)\b/.test(r.form) && !/\b(?:plural|neuter)\b/.test(r.form)) return false;
    return !(r.pos === 'noun' && !r.form && /^[mf]$/.test(r.gender) && /[бвгджзйклмнпрстфхцчшщь]$/.test(next!.low));
  };
  // A participle in its short form is said of всё: "Ну, теперь все сказано" (White Nights).
  const shortParticiple = !!n && participle(n) && !new RegExp(ADJ_END + '(?:ся|сь)?$').test(next!.low);
  if (next && n && (nounLike(n) || n.pos === 'numeral' || n.pos === 'determiner' || DETERMINER_LIKE.has(n.key))
    && next.low !== 'это' && fits(n) && !shortParticiple && has(q, all)) {
    return choose(all);
  }
  // A plural participle or adjective the dictionary lacks: "все замерзнувшие способности", "все колеблющиеся черты".
  if (next && !next.readings.length && !next.name && /(?:ые|ие|ых|их|ыми|ими)$/.test(next.low) && has(q, all)) return choose(all);
  if (q.prev && ['мы', 'вы', 'они', 'эти', 'те'].includes(q.prev.low) && !finite(n) && has(q, all)) return choose(all);
  // The first verb after, past adverbs, не and a preposition with its phrase: plural is everyone, singular everything.
  // "что все от меня отступаются", "все на неё будут смотреть" (Kashtanka), "все до одного курили сигары", "Все в ту же
  // минуту выбежали" (The Overcoat).
  for (let i = q.at + 1; i < q.words.length && i <= q.at + 6; i++) {
    const w = q.words[i];
    if (w.before && i > q.at + 1) break;
    const r = top(w);
    if (pluralVerb(r)) return has(q, everyone) ? choose(everyone) : null;
    if (finite(r)) return null;
    if (r?.pos === 'preposition' && w.low !== 'что') {
      // The preposition's phrase: up to three words with a case, and же.
      let j = i + 1;
      while (j < q.words.length && j <= i + 3 && !q.words[j].before
        && (q.words[j].low === 'же' || q.words[j].readings.some(caseBearing)) && !q.words[j].readings.some((x) => finite(x))) j++;
      i = j - 1;
      continue;
    }
    const passes = ['adverb', 'pronoun'].includes(r?.pos ?? '') || w.low === 'не' || w.low === 'одного';
    if (!passes || ['еще', 'более', 'больше', 'равно', 'это', 'что'].includes(w.low)) break;
  }
  return null;
}

/**
 * всё after its subject is "still, all the time" when the verb after it has its object already, an infinitive, or is
 * reflexive: "она все жала мне руку", "он все улыбался", "я все хотел сказать". "я все понял" (everything) has no object
 * but всё.
 */
function keepsOn(q: ContextQuery): boolean {
  for (let i = q.at + 1; i < q.words.length && i <= q.at + 3; i++) {
    const w = q.words[i];
    if (w.before) return false;
    const r = top(w);
    if (finite(r)) {
      if (pluralVerb(r)) return false;
      if (/(?:ся|сь)$/.test(w.low)) return true;
      for (let j = i + 1; j < q.words.length && j <= i + 3; j++) {
        const o = q.words[j];
        if (o.before) return false;
        if (infinitiveWord(o)) return true;
        const ro = top(o);
        if (ro?.pos === 'preposition') return false;
        if (ro && (ro.pos === 'noun' || ro.pos === 'pronoun') && !SUBJECTS.has(o.low) && inCase(ro, o, ['accusative'])
          && !inCase(ro, o, ['dative'])) return true;
      }
      return false;
    }
    if (!(w.low === 'не' || r?.pos === 'adverb' || r?.pos === 'particle')) return false;
  }
  return false;
}

/** да before a comma, ! or ? stands alone: "yes" (— Да, вы наймите у нас. Ну, да, да!). Inside a clause, "and, but". */
function da(q: ContextQuery): ContextChoice | null {
  if (!q.word.after || q.word.after.startsWith('-')) return null;
  return has(q, (r) => r.pos === 'particle') ? choose((r) => r.pos === 'particle') : null;
}

/**
 * что: "what" opening a question or any sentence (Что ж ты стоишь? Что мне делать?), after a preposition (За что?), standing
 * alone (— Что?) and before an infinitive (стал он думать, что ему делать); "that" inside a sentence.
 */
function chto(q: ContextQuery): ContextChoice | null {
  const what = (r: ContextReading): boolean => r.pos === 'pronoun';
  if (!has(q, what)) return null;
  // An infinitive that ends the clause asks what to do ("что ему делать.", "не знали, что говорить,"); one that goes on is the
  // subject or result of a "that" clause: "поняла, что ворчать и лаять … бесполезно", "так напугался, что говорить не мог".
  const inf = (i: number): boolean => !!q.words[i] && !q.words[i].before && infinitiveWord(q.words[i])
    && (!!q.words[i].after || i === q.words.length - 1);
  const nextInf = inf(q.at + 1) || (top(q.words[q.at + 1])?.pos === 'pronoun' && !q.word.after && inf(q.at + 2));
  if (startsSentence(q) || (q.question && opensClause(q)) || afterPreposition(q) || /^[?!]/.test(q.word.after) || nextInf) {
    return choose(what);
  }
  return null;
}

/**
 * как: "how" opening a question (Как же я теперь буду обходиться без тебя?) or an exclamation (Как они мучились, как
 * боялись они!), asking after знать or видеть (не знаю, как отвечать), before an infinitive and after вот (Вот как это было);
 * "as, like" otherwise, and always after так or такой (так же уныло, как и теперь!).
 */
function kak(q: ContextQuery): ContextChoice | null {
  const how = (r: ContextReading): boolean => r.pos === 'adverb';
  if (!has(q, how)) return null;
  const before = q.words.slice(0, q.at).map((w) => w.low);
  if (before.some((w) => w === 'так' || w.startsWith('так') || w === 'столь' || w === 'тот')) return null;
  const next = q.next;
  const n = top(next);
  // Before a noun set off by a comma it compares, however the sentence ends: "Как камень, брошенный в гладкий источник, я
  // встревожил их спокойствие" (A Hero of Our Time); "Как мужчины странны!" exclaims. Nor does a name called before it ask:
  // "Грушницкий, как тень, следует за княжной везде".
  const simile = !!next && (n?.pos === 'noun' || n?.pos === 'proper noun' || next.name) && comma(next.after);
  const opens = opensClause(q) && !q.words[q.at - 1]?.name;
  // "Послушайте, вы как бы написали?" asks how; ", как бы сделала другая" compares.
  const inQuestion = q.question && (opens || ['же', 'ж'].includes(next?.low ?? '')
    || (['бы', 'б'].includes(next?.low ?? '') && !comma(q.word.before)));
  const inExclamation = exclaimed(q) && !q.question && (opens || (comma(q.word.before) && q.words[0].low === 'как'));
  // "смотрела, как на свои хозяйские" (The Captain's Daughter) looks on them as her own; "смотри, как на свете становится
  // холодно" (White Nights) asks how, a verb following.
  const verbAhead = q.words.slice(q.at + 1, q.at + 5).some((w, i) => (i === 0 || !w.before) && finite(top(w)));
  const asking = afterAsking(q) && (n?.pos !== 'preposition' || verbAhead);
  if (((inQuestion || inExclamation) && !simile) || asking || infinitiveWord(next) || q.prev?.low === 'вот') return choose(how);
  return null;
}

/**
 * чем: что's "(with) what" after a preposition (в чем дело, о чем он мечтает), opening a question or exclamation (Чем все
 * это кончилось!) and after знать (знать, чем это кончится); "than" otherwise (больше, чем когда-нибудь; Чем проще, тем
 * лучше).
 */
function chem(q: ContextQuery): ContextChoice | null {
  const what = (r: ContextReading): boolean => r.pos === 'pronoun';
  if (!has(q, what)) return null;
  if (afterPreposition(q) || ((q.question || exclaimed(q)) && opensClause(q)) || afterAsking(q)) return choose(what);
  return null;
}

/**
 * то: the pronoun "that" after a preposition (за то, несмотря на то), before ", что" (Получилось то, что незнакомец называл
 * египетской пирамидой) and before же (то же самое); тот "that" before a neuter noun (то занимательное животное). Otherwise
 * the "then" of если …, то.
 */
function to(q: ContextQuery): ContextChoice | null {
  const pronoun = (r: ContextReading): boolean => r.pos !== 'conjunction';
  if (!has(q, pronoun)) return null;
  const after = q.words[q.at + 1];
  const n = top(q.next);
  if (q.next && nounLike(n) && (/\bneuter\b/.test(n!.form) || n!.gender === 'n') && !/\bplural\b/.test(n!.form)) {
    return has(q, (r) => r.pos === 'determiner') ? choose((r) => r.pos === 'determiner') : choose(pronoun);
  }
  const clause = comma(q.word.after) && !!after
    && ['что', 'чтобы', 'чтоб', 'чего', 'чем', 'кто', 'как', 'где', 'куда', 'когда'].includes(after.low);
  if (afterPreposition(q) || q.next?.low === 'же' || clause) {
    return choose((r) => r.pos === 'pronoun');
  }
  return null;
}

/**
 * самого, самой, самому, самом: самый "the very, the most" before what it marks (до самого дома, на самой вершине, самою
 * серьезной), сам "-self" before a pronoun (с самим собою, самого себя).
 */
function sam(q: ContextQuery): ContextChoice | null {
  if (!has(q, (r) => r.key === 'самый') || !has(q, (r) => r.key === 'сам')) return null;
  const n = top(q.next);
  if (!q.next) return null;
  // Before a pronoun or a word of need, "-self": "с самим собою", "мне самой надо" (White Nights).
  if (n?.pos === 'pronoun' || PREDICATIVES.has(q.next.low)) return choose((r) => r.key === 'сам');
  // Any noun reading of the next word counts: "до самого дома" (White Nights) is the house, though дома reads first as
  // "at home".
  if (q.next.readings.some((r) => nounLike(r) || r.pos === 'numeral') || q.next.name) return choose((r) => r.key === 'самый');
  if (n && !n.form && ['adverb', 'verb', 'particle'].includes(n.pos)) return choose((r) => r.key === 'сам');
  return null;
}

/** есть: "to eat" after a verb or word that takes an infinitive ("стала есть", "перестал есть", "охота лаять, есть, бегать"). */
function est(q: ContextQuery): ContextChoice | null {
  const eat = (r: ContextReading): boolean => r.key === 'есть' && r.pos === 'verb';
  if (!has(q, eat)) return null;
  const p = q.prev;
  const before = q.words[q.at - 1];
  if ((p && (TAKES_INFINITIVE.has(read(p)?.key ?? '') && verb(read(p)) || NEED_WORDS.has(p.low)))
    || (before && comma(q.word.before) && infinitive(read(before)) && read(before)?.key !== 'есть')) {
    return choose(eat);
  }
  return null;
}

/**
 * A word that is a noun or a verb (начала: начало's "of the beginning" or начать's "she began"; дали: даль or дать) is
 * the verb before an infinitive and next to its subject: "Тут Настенька остановилась и начала хохотать", "— начала она
 * через минуту очень серьезно" (White Nights).
 */
function nounOrVerb(q: ContextQuery): ContextChoice | null {
  const tensed = (r: ContextReading): boolean => finite(r);
  if (finite(q.word.readings[0]) || !has(q, tensed) || !has(q, (r) => r.pos === 'noun')) return null;
  // A subject before it: a pronoun or кто ("Кто хлебал в моей чашке!", Tolstoy: хлебать "to slurp", not хлебало).
  const subject = !!q.prev && (SUBJECTS.has(q.prev.low) || q.prev.low === 'кто');
  // After a dash it says who spoke: "— Касатик! а касатик! — начала Матрена."
  const speaker = !!q.next && (SUBJECTS.has(q.next.low) || (q.next.name && q.word.before.includes('—')));
  // But not when the clause has its verb after it: "Поди вон, Савельич; я чаю не хочу" (The Captain's Daughter) is tea,
  // хочу the verb.
  if ((subject || speaker) && !clauseVerbAhead(q)) return choose(tensed, NEAR);
  // A genitive plural nothing governs, opening its clause, is no noun: "садился тот же час за стол, хлебал наскоро свои щи"
  // (The Overcoat) is хлебать, not хлебало "mouth".
  const nouns = q.word.readings.filter((r) => r.pos === 'noun');
  if ((q.at === 0 || comma(q.word.before)) && nouns.every((r) => /\bgenitive plural\b/.test(r.form) && !/;/.test(r.form))
    && !clauseVerbAhead(q)) {
    return choose(tensed, NEAR);
  }
  // Before an infinitive, a verb that takes one: начала хохотать, but "Стану морю кланяться" (A Hero of Our Time) bows to
  // the sea, морю is no морить "I exterminate".
  const takes = (r: ContextReading): boolean => tensed(r) && TAKES_INFINITIVE.has(r.key);
  if (q.next && infinitiveWord(q.next) && !q.next.name && has(q, takes)) return choose(takes, NEAR);
  return null;
}

/**
 * тем before a comparative is "the (more)" of чем …, тем: "чем скорее уснёшь, тем скорее наступит утро" (Kashtanka), "тем
 * лучше"; otherwise то's "(with) that" (кончилось тем, что …).
 */
function tem(q: ContextQuery): ContextChoice | null {
  const n = top(q.next);
  if (!q.next || !has(q, (r) => r.pos === 'adverb')) return null;
  const comparative = !!n && (/\bcomparative\b/.test(n.form)
    || (/(?:ее|ей|ше|же)$/.test(q.next.low) && ['adverb', 'adjective'].includes(n.pos)));
  return comparative ? choose((r) => r.pos === 'adverb') : null;
}

/**
 * After a preposition, what it governs: a noun, pronoun or adjective over an adverb or a conjugated verb (из дома, с лаем,
 * до самого дома), in a case the preposition takes ("Батюшка за ворот приподнял его": ворот "collar", not ворота's genitive
 * plural), and a noun over an adjective spelled alike when no noun follows ("брожу ли по набережной": the embankment, not
 * набережный "shoreside").
 */
function governed(q: ContextQuery): ContextChoice | null {
  const cases = q.prev && read(q.prev)?.pos === 'preposition' ? PREP_CASES[q.prev.low] : undefined;
  if (!cases) return null;
  const rs = q.word.readings;
  if (rs.length < 2 || q.word.after.startsWith('-')) return null;
  const fits = (r: ContextReading): boolean => caseBearing(r) && (!casesOf(r, q.word).size || inCase(r, q.word, cases));
  // The cases first: of the forms of the first reading's entry, those the preposition takes ("из дому" is the partitive
  // до́му, not the locative дому́). Another entry's headword wins only over a genitive ("за ворот"): a reading shows one form of
  // its entry, and the entry may have the case the preposition takes in another (обо всём is весь's too, though всем reads
  // as its dative).
  const t = rs[0];
  if (casesOf(t, q.word).size && !inCase(t, q.word, cases)) {
    // A feminine noun's headword is only its nominative: "вместо сорока рублей" (The Overcoat) is forty, not the magpie.
    const tc = [...casesOf(t, q.word)];
    const genitive = t.pos === 'noun' && tc.every((c) => c === 'genitive');
    const nominative = t.pos === 'noun' && !t.form && tc.every((c) => c === 'nominative');
    const ok = (r: ContextReading): boolean => (sameEntry(r, t) || nominative || (genitive && r.pos === 'noun' && !r.form))
      && casesOf(r, q.word).size > 0 && inCase(r, q.word, cases);
    if (rs.some(ok)) return choose(ok);
  }
  if (!afterPreposition(q)) return null;
  if (rs[0].pos === 'adjective') return substantive(q, true);
  // Only an adverb or a verb gives way: "кроме как" keeps its conjunction (not кака), and an initial (в С., от И. И. Зурина)
  // stays a letter.
  if (!(rs[0].pos === 'adverb' || rs[0].pos === 'verb') || !rs.some(caseBearing)) return null;
  // An adverb before an adjective or participle is its degree: "с сильно забившимся сердцем", "в довольно энергических
  // терминах", "на тяжело нагруженные лодки".
  const n = top(q.next);
  const degree = !!q.next && (n?.pos === 'adjective' || n?.pos === 'adverb' || participle(n) || !q.next.readings.length);
  if (rs[0].pos === 'adverb' && degree) return null;
  // Those in a case it takes first, then any: "Казбич выхватил ружье на бегу" (A Hero of Our Time) is бег's locative, though
  // бегу reads as its dative.
  return choose(rs.some(fits) ? fits : caseBearing);
}

/**
 * An adjective with no noun to go with it is the noun Russian makes of it, where the dictionary has one: a room or place in
 * the feminine ("заглянула в переднюю", Kashtanka; "в гостиной медовое варенье", The Captain's Daughter; "на перила
 * набережной", White Nights), a drink or dish in the genitive ("по бокалу шампанского", The Overcoat). Not a person: "кто-то в
 * белом сидел на берегу" (A Hero of Our Time) is someone in white, and "итти прямо к частному" (The Overcoat) the police
 * officer, not частное "quotient". Nor after a verb like быть, where the adjective is the predicate (она была больная).
 */
function substantive(q: ContextQuery, governs = false): ContextChoice | null {
  const rs = q.word.readings;
  const adj = rs[0];
  if (adj.pos !== 'adjective' || shortForm(adj) || !adj.form) return null;
  const noun = (r: ContextReading): boolean => r.pos === 'noun' && ((r.gender === 'f' && /(?:ая|яя)$/.test(r.head)
    && /\bfeminine\b/.test(adj.form)) || (r.gender === 'n' && /(?:ое|ее)$/.test(r.head) && /\bgenitive\b/.test(adj.form)
    && /\bgenitive\b/.test(r.form)));
  if (!has(q, noun)) return null;
  const next = q.next;
  const n = top(next);
  // A noun, adjective, number or name after it may be its noun ("Молодая рыжая собака", "целых три дня"), and so may a word
  // the dictionary lacks; an adverb or a pronoun after it says the adjective goes on ("впустила чёрную очень некрасивую
  // свинью", "Какая слепая ты", Kashtanka and White Nights).
  // A plural noun of its gender may hide the singular that agrees: "половину старого весла" (A Hero of Our Time), весла read as
  // the plural.
  const ownGender = (r: ContextReading): boolean => r.pos === 'noun' && /\bplural\b/.test(r.form)
    && slotsOf(adj, q.word).some((sl) => [...sl.genders].some((g) => r.gender.includes(g)));
  if (next && (next.name || !next.readings.length || ['adverb', 'pronoun', 'numeral'].includes(n?.pos ?? '')
    || (nounLike(n) && next.readings.some((r) => nounLike(r) && (agrees(adj, q.word, r, next) || !slotsOf(r, next).length || ownGender(r)))))) {
    return null;
  }
  // Nor before и and an adjective that agrees: "предвидел скорую и несомненную перемену" (The Captain's Daughter).
  const w2 = q.words[q.at + 2];
  if (next && ['и', 'или'].includes(next.low) && w2 && !w2.before
    && w2.readings.some((r) => r.pos === 'adjective' && agrees(adj, q.word, r, w2))) return null;
  // A noun in the nominative right after it is its own, spelled the old way: "не может отказаться русской человек" (The
  // Overcoat). And past a comma the adjectives may go on: "впустила чёрную, очень некрасивую свинью" (Kashtanka).
  if (n?.pos === 'noun' && !n.form && n.gender === 'm' && q.word.low.endsWith('ой')) return null;
  const after = q.words[q.at + 1];
  if (!next && after && comma(q.word.after) && (top(after)?.pos === 'adverb'
    || after.readings.some((r) => r.pos === 'adjective' && agrees(adj, q.word, r, after)))) return null;
  const p = read(q.prev);
  // After the noun it is said of: "Твоя рука холодная" (White Nights).
  if (q.prev && p?.pos === 'noun' && agrees(adj, q.word, p, q.prev)) return null;
  // Not after a pronoun or a linking verb, where it is said of someone: "Сторона мне знакомая" (The Captain's Daughter), она
  // была больная.
  if (!governs && (!q.prev || !p || p.pos === 'pronoun' || (verb(p) && LINKING.has(p.key)) || q.prev.low === 'не'
    || ['такой', 'какой', 'самый', 'сам'].includes(p.key) || !['noun', 'adjective', 'determiner', 'numeral', 'verb'].includes(p.pos))) {
    return null;
  }
  // A drink or dish in the neuter only after what holds it: "по бокалу шампанского", "стакана два шампанского", not "а
  // вторых она сама имела право" (Kashtanka: the second ones).
  const neuterOk = !!q.prev && (p?.pos === 'noun' || p?.pos === 'numeral');
  const fits = (r: ContextReading): boolean => noun(r) && (r.gender === 'f' || neuterOk);
  return has(q, fits) ? choose(fits) : null;
}

/** Полноте! standing alone is the interjection "come now, enough" (White Nights, ten times), not полнота's "fullness". */
function polnote(q: ContextQuery): ContextChoice | null {
  if (afterPreposition(q) || !has(q, (r) => r.pos === 'interjection')) return null;
  return choose((r) => r.pos === 'interjection');
}

/** право between commas or opening a sentence is the adverb "really" (Но я, право, не знаю); after иметь it is a right. */
function pravo(q: ContextQuery): ContextChoice | null {
  if (!/^[,!]/.test(q.word.after) || !(q.sentenceStart || comma(q.word.before)) || !has(q, (r) => r.pos === 'adverb')) return null;
  return choose((r) => r.pos === 'adverb');
}

/** ровно before a number, a time or nothing is "exactly": "ровно год тому назад", "ровно в десять часов", "ровно ничего". */
function rovno(q: ContextQuery): ContextChoice | null {
  const n = top(q.next);
  if (!n || !['numeral', 'preposition', 'noun', 'pronoun'].includes(n.pos) || !has(q, (r) => r.pos === 'particle')) return null;
  return choose((r) => r.pos === 'particle');
}

/**
 * ничего standing alone is "it's all right, never mind": "— Нет, ничего, ничего; напротив", "да это ничего…" (White Nights).
 * "у него нет ничего" and "больше ничего" keep "nothing".
 */
function nichego(q: ContextQuery): ContextChoice | null {
  if (!/^[,;!…]/.test(q.word.after) || !has(q, (r) => r.pos === 'adjective')) return null;
  const before = q.words[q.at - 1];
  if ((q.sentenceStart && !q.word.before.includes('—')) || comma(q.word.before) || ['это', 'будет'].includes(q.prev?.low ?? '')) {
    if (before?.low === 'ровно') return null;
    return choose((r) => r.pos === 'adjective');
  }
  return null;
}

/** ни … ни is "neither … nor" (ни колонн, ни карнизов); a single ни is "not a" (ни слова). */
function ni(q: ContextQuery): ContextChoice | null {
  const others = q.words.filter((w, i) => i !== q.at && w.low === 'ни');
  if (!others.length || !has(q, (r) => r.pos === 'conjunction')) return null;
  // "ни колонн, ни карнизов": a second ", ни" within a few words; "ни с чем не сообразный костюм, какого … ни в домах" is two.
  const paired = comma(q.word.before) || q.words.some((w, i) => i > q.at && i <= q.at + 4 && w.low === 'ни' && comma(w.before));
  return paired ? choose((r) => r.pos === 'conjunction') : null;
}

/**
 * всякий before a noun is the determiner (всякий раз, "нагруженных целыми горами всякой мебели"); alone, the pronoun
 * "anyone" (всякий вправе спросить).
 */
function vsyakiy(q: ContextQuery): ContextChoice | null {
  if (!has(q, (r) => r.pos === 'pronoun') || !has(q, (r) => r.pos === 'determiner')) return null;
  return nounLike(top(q.next)) ? choose((r) => r.pos === 'determiner') : choose((r) => r.pos === 'pronoun', NEAR);
}

/**
 * After an adjective or determiner, the noun that agrees with it: "кухарка, берегущая барское добро" (White Nights) is the
 * master's goods, not добро "okay"; "считает священным долгом" a duty, not долгий "long"; "своею дорогою особою" a person;
 * "свои толки" talk, not толочь "pound!"; "подъезд этого дома" the house, not "at home". A noun that does not agree is no
 * reason: "Дорогою задел его" (The Overcoat) is задеть, дорогою "on the way". Only after a full adjective (not рад, готов,
 * нельзя), and not for a word that is itself an adjective with its noun after it ("Молодая рыжая собака") nor for an
 * infinitive ("нельзя помочь").
 */
function agreement(q: ContextQuery): ContextChoice | null {
  const prev = q.prev;
  const p = read(prev);
  const rs = q.word.readings;
  if (!prev || !p || rs.length < 2 || q.word.name) return null;
  // сам is said of a person ("я сама мечтатель", White Nights), and самый, такой, какой of the adjective after them ("самые
  // мелкие", "такая черная", A Hero of Our Time), which stays one; "до самого дома" is still the house.
  if (p.key === 'сам' || (['самый', 'такой', 'какой'].includes(p.key) && rs[0].pos === 'adjective')) return null;
  const det = p.pos === 'determiner' || (p.pos === 'pronoun' && DETERMINER_LIKE.has(p.key) && !!p.form)
    || (p.pos === 'numeral' && p.key === 'один' && !!p.form);
  if (!(p.pos === 'adjective' || participle(p) || det) || shortForm(p) || /\bcomparative\b/.test(p.form)) return null;
  const cased = /\b(?:nominative|genitive|dative|accusative|instrumental|prepositional)\b/.test(p.form);
  // A participle the dictionary has only in the masculine (read so by ru.ts) shows its case by its ending: "залилась воющим
  // лаем" (Kashtanka) is an instrumental, so лаем is the bark, not "we bark".
  const obliqueEnding = participle(p) && !cased && /(?:ого|его|ому|ему|ым|им|ом|ем|ой|ей|ую|юю|ою|ею|ых|их|ыми|ими)$/.test(prev.low);
  if (!/(?:ый|ий|ой)$/.test(prev.low) && !cased && !det && !obliqueEnding) return null;
  // Another noun only as another form of the same entry: a reading shows one form of its entry, so "к прекрасному полу"
  // (The Captain's Daughter) may be the floor's dative though полу reads as its locative.
  const t = rs[0];
  // Nor over a genitive plural, which no other form of its entry is spelled like: "шёл белый пар" (Kashtanka) is steam, not
  // пара's "of pairs".
  const fits = (r: ContextReading): boolean => r.pos === 'noun' && !genderPointer(r) && agrees(p, prev, r, q.word)
    && (t.pos !== 'noun' || sameEntry(r, t) || /^genitive plural$/.test(t.form));
  if (fits(t) || t.pos === 'numeral' || !has(q, fits)) return null;
  // A conjugated verb only after an adjective in an oblique case, which no subject is in: "со звонким лаем" (Kashtanka), but
  // "больная пила" may be someone ill drinking.
  const oblique = (/\b(?:genitive|dative|instrumental|prepositional)\b/.test(p.form) && !/\bnominative\b/.test(p.form)) || obliqueEnding;
  // Nor a name: "Добрый Максим Максимыч" (A Hero of Our Time) is no maxim.
  // An adjective before more of its phrase keeps its noun for later: "задел его всем нечистым своим боком" (The Overcoat).
  const more = !!q.next && (!q.next.readings.length || q.next.name
    || ['noun', 'proper noun', 'adjective', 'determiner', 'pronoun', 'numeral'].includes(top(q.next)?.pos ?? '') || participle(top(q.next)));
  // "Я те дам заячий тулуп" (The Captain's Daughter): те is тебе, and дам the verb.
  if (t.pos === 'proper noun' || infinitive(t) || (finite(t) && !oblique) || (t.pos === 'adjective' && more)) return null;
  return choose(fits, NEAR);
}

/**
 * The genitive a word before or after asks for: after ни, нет, много, сколько ("ни слова", "сколько раз"), after a noun
 * ("стакан вина", "корочку сыра", "в смысле слова"), before "не было" ("и полка не было", Kashtanka: the regiment, not a
 * shelf), after a noun in the genitive and и ("без шума и треска": the crackle, not cod). After два, три, четыре, a noun's
 * counting form (два часа́) or its genitive singular (два сло́ва). Among a noun's forms spelled alike this picks the stress.
 */
function genitiveCue(q: ContextQuery): ContextChoice | null {
  const rs = q.word.readings;
  if (rs.length < 2 || q.word.name) return null;
  const gen = (r: ContextReading): boolean => ['noun', 'numeral', 'adjective', 'pronoun'].includes(r.pos) && inCase(r, q.word, ['genitive']);
  if (!has(q, gen)) return null;
  const p = q.prev;
  const pr = read(p);
  if (p?.low === 'лет' && has(q, (r) => r.pos === 'numeral')) return choose((r) => r.pos === 'numeral');
  // Before one, too, in a guess at a number: "сказать слова два" (The Overcoat), "часа три".
  const n1 = q.words[q.at + 1];
  if ((p && SMALL_NUMBERS.has(p.low)) || (q.next && SMALL_NUMBERS.has(q.next.low))) {
    const count = (r: ContextReading): boolean => r.pos === 'noun' && !r.form && r.key !== q.word.low;
    return choose(has(q, count) ? count : gen, NEAR);
  }
  const n2 = q.words[q.at + 2];
  // "не было" after a noun only, not after дома "at home": "его дома не было" (A Hero of Our Time).
  const notThere = !!n1 && !n1.before && rs[0].pos === 'noun' && (n1.low === 'нет' || (n1.low === 'не' && !!n2 && !n2.before
    && ['было', 'будет', 'бывало', 'бывает'].includes(n2.low)));
  if ((p && GENITIVE_AFTER.has(p.low)) || notThere) return choose(gen, NEAR);
  // After a noun, a noun's genitive singular, over another noun or a short adjective ("корочку сыра" is cheese, not сырой
  // "damp"), but not over a verb with a tense ("Хозяин сел перед ним", Kashtanka) nor a full adjective before its noun ("по
  // уходе бедного Акакия"), nor as an adjective's own noun ("за богдыхана китайского" is Chinese, not the language).
  const t = rs[0];
  // Between two forms of one noun (the stress), a weak cue: not in a list, "мелькнули в одно время свечи, чиновники" (The
  // Overcoat) are candles.
  const singular = (r: ContextReading): boolean => r.pos === 'noun' && slotsOf(r, q.word).some((sl) => sl.cases.has('genitive') && sl.plural !== true)
    && !(r.key === t.key && r.pos !== t.pos) && !(r !== t && sameEntry(r, t) && comma(q.word.after));
  // Only over a noun, or a short adjective that cannot be said of the noun before ("корочку сыра", but "члены гибки и
  // стройны", A Hero of Our Time). A weak cue: "на том свете душа ее" is the soul, not душ's "of the shower".
  const said = !!pr && pr.pos === 'noun' && slotsOf(pr, p!).some((sl) => sl.cases.has('nominative'))
    && /\bplural\b/.test(t.form) === /\bplural\b/.test(pr.form);
  if (p && !p.name && pr?.pos === 'noun' && (t.pos === 'noun' || (shortForm(t) && !said)) && has(q, singular)) {
    // A genitive already is the genitive: "После обеда часов в шесть" is час's, not часы "clock".
    return gen(t) ? choose((r) => r === t) : choose(singular, AFTER_NOUN);
  }
  return null;
}

/**
 * о before a word it cannot govern is the interjection "oh": before a comma or !, a name, боже, a subject pronoun, a verb, a
 * conjunction or an adverb ("— О, вы угадали с первого раза!", "О вы, …", "О если б…", "О как…", White Nights), and opening an
 * exclamation before a word with no prepositional ("О незваный господин!"). "о мои бока", "о чем" keep the preposition.
 */
function oh(q: ContextQuery): ContextChoice | null {
  const inter = (r: ContextReading): boolean => r.pos === 'interjection';
  if (!has(q, inter)) return null;
  if (/^[,!…]/.test(q.word.after) || q.at === q.words.length - 1) return choose(inter);
  const next = q.next;
  const n = top(next);
  if (!next || (!n && !next.name)) return null;
  // A word in a case о takes is governed by it: "ни о чём не думала", "о мои бока".
  if (next.readings.some((r) => r.pos === 'pronoun' && !SUBJECTS.has(next.low))
    || next.readings.some((r) => inCase(r, next, ['prepositional', 'accusative']) && !(r.pos === 'adjective' && !r.form))) return null;
  if (SUBJECTS.has(next.low) || finite(n, true)) return choose(inter);
  // The rest only where о opens its clause: "бредила о Севильском цирюльнике" (White Nights) is about the Barber of Seville.
  if (!(startsSentence(q) || /[,—(«„:]/.test(q.word.before))) return null;
  if (next.name || ['боже', 'господи'].includes(next.low)) return choose(inter);
  if (n && ['conjunction', 'particle', 'adverb', 'interjection'].includes(n.pos)) return choose(inter);
  if (startsSentence(q) && exclaimed(q) && !next.readings.some((r) => inCase(r, next, ['prepositional']))) return choose(inter);
  return null;
}

/**
 * A word standing alone that can be an interjection is one: at the start of its sentence or after a comma, and before a
 * comma, ! or …. "— Ладно, ладно, — сказал хозяин" (Kashtanka) is "all right", not ладный's "well-built"; "Гм… понимаю"
 * (The Captain's Daughter) "hm", not a hectometer.
 */
function standingAlone(q: ContextQuery): ContextChoice | null {
  const inter = (r: ContextReading): boolean => r.pos === 'interjection';
  const t = q.word.readings[0];
  // Not a word first read as a function word or adverb: "Однако, плохо же кормят тебя" (Kashtanka) is "however".
  if (!has(q, inter) || inter(t) || ['particle', 'conjunction', 'pronoun', 'preposition', 'determiner', 'adverb'].includes(t.pos)) return null;
  // Or calling to someone: "— Эй ты, пёс, поди сюда!" (Kashtanka).
  const calling = q.sentenceStart && ['ты', 'вы'].includes(q.next?.low ?? '');
  if (!calling && (!/^[,!…]/.test(q.word.after) || !(q.sentenceStart || comma(q.word.before) || /[—…]/.test(q.word.before)))) return null;
  return choose(inter);
}

/**
 * Здравствуйте, Прощай are the greetings, not the imperatives of здравствовать "be well!" and прощать "forgive!", where no
 * object follows: "— Здравствуйте, — говорит" (Tolstoy), "Батюшка сказал мне: «Прощай, Петр»" (The Captain's Daughter).
 */
function greeting(q: ContextQuery): ContextChoice | null {
  const t = q.word.readings[0];
  if (!verb(t) || !/\bimperative\b/.test(t.form) || !has(q, (r) => r.pos === 'interjection')) return null;
  const n = top(q.next);
  if (q.next && !q.next.name && (n?.pos === 'noun' || n?.pos === 'pronoun')) return null;
  return choose((r) => r.pos === 'interjection');
}

/**
 * A -ся verb that has its own entry is that verb, not another's passive: "Он хотел проститься с хозяином" is проститься "to
 * say goodbye", not простить "to forgive"; воротиться "to return", слушаться "to obey".
 */
function ownReflexive(q: ContextQuery): ContextChoice | null {
  const t = q.word.readings[0];
  if (!/(?:ся|сь)$/.test(q.word.low) || !verb(t) || !/\bpassive\b/.test(t.form)) return null;
  const own = (r: ContextReading): boolean => verb(r) && /(?:ся|сь)$/.test(r.key) && !/\bpassive\b/.test(r.form);
  return has(q, own) ? choose(own) : null;
}

/**
 * A short adjective after its subject, a linking verb or before ли is the predicate: "я с ним знаком" (White Nights) is
 * знакомый, not знак's instrumental "with a sign"; "Савельич был прав", "Ямщик казался мне прав" правый, not права; "Новый
 * мир был велик" (Kashtanka) big, not велик "bike"; "хорош ли, молод ли жилец?" good-looking.
 */
function predicate(q: ContextQuery): ContextChoice | null {
  // Not a neuter one: "мне стало стыдно" keeps стыдно "one is ashamed", a word of its own.
  const short = (r: ContextReading): boolean => r.pos === 'adjective' && shortForm(r) && !/\bneuter\b/.test(r.form);
  const t = q.word.readings[0];
  // A neuter short form that is also an adverb stays the adverb (было темно, я совершенно не знаю), and a verb a verb (она
  // пошла, мы любим): only a noun or another adjective spelled alike gives way.
  if (!has(q, short) || short(t) || !['noun', 'adjective'].includes(t.pos) || has(q, (r) => r.pos === 'adverb' || finite(r))) return null;
  const subject = (w: ContextWord | undefined): boolean => !!w && SUBJECTS.has(w.low);
  // A linking verb in the past agrees with it: "Савельич был прав", but "только и было толков" (A Hero of Our Time) is толк's
  // genitive plural.
  const linking = (w: ContextWord | undefined): boolean => {
    const r = read(w);
    if (!w || !r || !verb(r) || !LINKING.has(r.key)) return false;
    const g = ['masculine', 'feminine', 'neuter', 'plural'].find((x) => r.form.includes(x));
    return !g || q.word.readings.some((x) => short(x) && (g === 'masculine' ? /^masculine short/.test(x.form) : x.form.includes(g)));
  };
  const p = q.prev;
  const p2 = q.words[q.at - 2];
  // A dative between: "Ямщик казался мне прав" (The Captain's Daughter).
  const dative = !!p && DATIVES.has(p.low) && linking(p2);
  const negated = p?.low === 'не' && !p.before && (subject(p2) || linking(p2));
  return subject(p) || linking(p) || dative || negated || q.next?.low === 'ли' ? choose(short) : null;
}

/** The dative pronouns a predicate is said to: "казался мне прав". */
const DATIVES = new Set(['мне', 'тебе', 'ему', 'ей', 'нам', 'вам', 'им', 'себе']);

/**
 * свет is the world, not the light, where one lives on it, goes round it or comes to its end: "больше всего на свете",
 * "вокруг света", "на краю света", "по свету", "весь свет". "Яркий свет", "против света", "чем свет" keep the light.
 */
function svet(q: ContextQuery): ContextChoice | null {
  const world = (r: ContextReading): boolean => r.key === 'свет' && /\bworld\b/.test(r.hint);
  if (!has(q, world)) return null;
  const p = q.prev;
  if ((p?.low === 'на' && q.word.low === 'свете') || ['вокруг', 'по', 'краю', 'край', 'конца', 'конец'].includes(p?.low ?? '')
    || read(p)?.key === 'весь') return choose(world);
  return null;
}

/**
 * несколько is "several, a few" before a noun or number, or ending its phrase ("через несколько минут", "минут через
 * несколько"), and "somewhat" before an adjective, short form, adverb, verb or preposition: "несколько рябоват, несколько
 * рыжеват" (The Overcoat), "покажется несколько странным".
 */
function neskolko(q: ContextQuery): ContextChoice | null {
  const several = (r: ContextReading): boolean => r.pos === 'pronoun';
  const somewhat = (r: ContextReading): boolean => r.pos === 'adverb';
  if (!has(q, several) || !has(q, somewhat)) return null;
  const next = q.next;
  if (!next) return choose(several);
  const n = top(next);
  // A noun the dictionary lacks, by its genitive plural ending: "съел несколько горошинок".
  const unknownNoun = !next.readings.length && /(?:ок|ек|ов|ев|ей)$/.test(next.low);
  const nounish = next.name || unknownNoun || (!!n && ['noun', 'numeral', 'proper noun'].includes(n.pos))
    || next.readings.some((r) => (r.pos === 'adjective' || r.pos === 'determiner' || participle(r)) && !shortForm(r)
      && slotsOf(r, next).some((sl) => sl.cases.has('genitive') && sl.plural === true));
  return choose(nounish ? several : somewhat);
}

/**
 * чего after a preposition or opening a relative clause is что "what": "с чего начать", "После чего", "все, чего я требую"
 * (White Nights). Elsewhere the word's own "what; why" (Чего вы боитесь?).
 */
function chego(q: ContextQuery): ContextChoice | null {
  const what = (r: ContextReading): boolean => r.key === 'что';
  if (!has(q, what)) return null;
  const before = q.words[q.at - 1];
  if ((q.prev && PREP_CASES[q.prev.low]) || (before && comma(q.word.before) && ['все', 'то', 'ничего', 'того'].includes(before.low))) {
    return choose(what);
  }
  return null;
}

/**
 * A word read first as a verb in the first or second person is the noun where its clause has another verb: "вишь как он
 * сметает порошу" (The Captain's Daughter) is the fresh snow, not порошить "I snow"; and after что ending its clause, a
 * genitive: "Да что толку?" what use, not толочь "I pound".
 */
function verbOrNoun(q: ContextQuery): ContextChoice | null {
  const t = q.word.readings[0];
  if (!finite(t) || !/\b(?:first|second)-person\b/.test(t.form) || !has(q, (r) => r.pos === 'noun')) return null;
  const noun = (r: ContextReading): boolean => r.pos === 'noun';
  const verbBefore = !!q.prev && finite(read(q.prev), true);
  const what = q.prev?.low === 'что' && (!!q.word.after || q.at === q.words.length - 1) && has(q, (r) => noun(r) && inCase(r, q.word, ['genitive']));
  return verbBefore || what || clauseVerbAhead(q) ? choose(noun, NEAR) : null;
}

const RULES: Partial<Record<string, (q: ContextQuery) => ContextChoice | null>> = {
  его: possessive, ее: possessive, их: possessive,
  все: vse, да: da, что: chto, как: kak, чем: chem, то: to, есть: est, полноте: polnote, право: pravo, ровно: rovno,
  ничего: nichego, ни: ni, тем: tem, о: oh, несколько: neskolko, чего: chego,
  свет: svet, света: svet, свете: svet, свету: svet, светом: svet,
  самого: sam, самой: sam, самою: sam, самому: sam, самом: sam, самим: sam,
  ...Object.fromEntries(['всякий', 'всякая', 'всякое', 'всякие', 'всякого', 'всякой', 'всякому', 'всяким', 'всякую', 'всяких',
    'всякими', 'всяком', 'всякою'].map((w) => [w, vsyakiy])),
};

/**
 * A noun after a noun stays a noun, not a short adjective spelled alike: "На шестой день лев умер" (Tolstoy) is the lion,
 * not левый "left". A short adjective is said of its subject, never put after a noun as the generic rule after a noun
 * would have it.
 */
function noShortAfterNoun(q: ContextQuery): ContextChoice | null {
  const t = q.word.readings[0];
  if (read(q.prev)?.pos !== 'noun' || shortForm(t) || !has(q, (r) => r.pos === 'adjective' && shortForm(r))) return null;
  return choose(() => true, 0);
}

export function russianContext(q: ContextQuery): ContextChoice | null {
  const rule = RULES[q.word.low];
  if (rule) return rule(q) ?? governed(q);
  return standingAlone(q) ?? greeting(q) ?? ownReflexive(q) ?? governed(q) ?? predicate(q) ?? nounOrVerb(q) ?? verbOrNoun(q)
    ?? agreement(q) ?? genitiveCue(q) ?? substantive(q) ?? noShortAfterNoun(q);
}
