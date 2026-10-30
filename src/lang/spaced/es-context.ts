// Spanish context rules (SpacedLang.context, context.ts): the words whose reading the generic rules cannot tell from the
// word alone, told here by what stands before and after them. Every rule is grammar (sí after a preposition is "oneself",
// anywhere else "yes"; a reflexive pronoun agrees in person with its verb), with the sentence from Quiroga's Cuentos de la
// selva, Galdós's Marianela or Jiménez's Platero y yo that showed it.
import {
  CONTEXT_MARGIN, isFiniteVerb, isParticiple, type ContextChoice, type ContextQuery, type ContextReading, type ContextWord,
} from './context';

/** Prepositions, with the old cabe "beside" of the Lazarillo: "Usaba poner cabe sí un jarrillo de vino". */
const PREPOSITIONS = new Set(['a', 'ante', 'bajo', 'cabe', 'con', 'contra', 'de', 'desde', 'en', 'entre', 'hacia', 'hasta', 'para',
  'por', 'según', 'sin', 'sobre', 'tras']);
/** Reflexive pronouns and the person each goes with: me levanto, te levantas, se levanta, nos levantamos, os levantáis. */
const REFLEXIVE: Record<string, RegExp> = {
  me: /\bfirst-person singular\b/,
  te: /(?<!formal )\bsecond-person singular\b/,
  se: /\bthird-person\b|\bformal\b/,
  nos: /\bfirst-person plural\b/,
  os: /(?<!formal )\bsecond-person plural\b/,
};
/** Object pronouns that stand between se and its verb: "se le escaparía", "se me figura", "se les ocurre". */
const DATIVES = new Set(['me', 'te', 'le', 'nos', 'os', 'les']);
/** Subject pronouns: "sabes tú que las estrellas bajan" has the conjunction after one, not a relative. */
const SUBJECTS = new Set(['yo', 'tú', 'él', 'ella', 'usted', 'nosotros', 'nosotras', 'vosotros', 'vosotras', 'ellos', 'ellas',
  'ustedes', 'vos']);
/** Nouns that make a conjunction with que: "es verdad que", "cada vez que", "de modo que", "a medida que", "puesto que". */
const CONJUNCTIONAL = new Set(['verdad', 'vez', 'veces', 'modo', 'manera', 'suerte', 'medida', 'puesto', 'fe', 'caso', 'lástima',
  'mentira', 'menester', 'cierto', 'claro']);
/** Words that only grade an adjective or adverb: muy alegre, tan solo, qué rica, un poco enfermo. */
const INTENSIFIERS = new Set(['muy', 'tan', 'bastante', 'demasiado', 'harto', 'qué', 'poco']);
/** Words after which an adjective is likelier than not, though a noun or verb may follow too: más viva, menos triste. */
const COMPARATIVES = new Set(['más', 'menos']);
/** The comparatives whose que is "than": "más vaca que carnero", "más lejos que Misiones todavía". */
const COMPARISON = new Set(['más', 'menos', 'mejor', 'peor', 'mayor', 'menor']);
/** Words of a comparison or a degree that a later que completes: "más vaca que carnero", "tanta sed que". */
const DEGREE = new Set(['más', 'menos', 'mejor', 'peor', 'mayor', 'menor', 'antes', 'después', 'tan', 'tanto', 'tanta', 'tantos',
  'tantas', 'tal', 'tales', 'otro', 'otra', 'otros', 'otras', 'mismo', 'misma', 'mismos', 'mismas', 'igual', 'distinto',
  'distinta', 'diferente', 'primero', 'así']);
/**
 * Ordinals and comparatives, which an article makes a noun of in their own sense: "Mi padre fue el primero que encendió las
 * luces" (the first one, not primero "former"), "se parecía muchísimo al menor" (the younger one, not "minor").
 */
const ORDINAL = /^(?:primer|segund|tercer|quint|sext|séptim|octav|noven|décim|últim|postrer|mayor|menor|mejor|peor)/;
/** Verbs a predicate adjective follows: "estaba ya herida", "cayó enfermo", "se puso loca de furor". */
const COPULAS = new Set(['ser', 'estar', 'parecer', 'quedar', 'seguir', 'andar', 'volver', 'caer', 'sentir', 'hallar', 'encontrar',
  'poner', 'tomar', 'navegar', 'vivir', 'llegar', 'ir', 'venir', 'mostrar']);
/** Adverbs of place, after which solo and fuera say where someone is: "voy a morir aquí solo", "allá fuera". */
const PLACE = new Set(['aquí', 'allí', 'allá', 'acá', 'ahí']);
/** Adverbs that may stand between a verb and what it governs: "estaba ya herida", "salir nunca fuera". */
const BETWEEN = new Set(['ya', 'no', 'muy', 'tan', 'más', 'menos', 'bien', 'mal', 'siempre', 'nunca', 'todavía', 'aún', 'también',
  'tampoco', 'solamente', 'sólo', 'casi', 'apenas', 'luego', 'entonces', 'allí', 'aquí']);
/**
 * The determiners after which a word with no noun after it is the noun itself (los flamencos, su cuarto): articles,
 * possessives, demonstratives. Not the quantifiers, after which it is the adjective of a noun understood: "esperaron todas
 * juntas", "un poco sordo", "todo muerto".
 */
const NOUN_DETERMINERS = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'del', 'al', 'mi', 'mis', 'tu', 'tus',
  'su', 'sus', 'nuestro', 'nuestra', 'nuestros', 'nuestras', 'vuestro', 'vuestra', 'vuestros', 'vuestras', 'este', 'esta',
  'estos', 'estas', 'ese', 'esa', 'esos', 'esas', 'aquel', 'aquella', 'aquellos', 'aquellas']);

/** Verbs whose infinitive takes the pronoun before them: "se quiso burlar" is quiso burlarse; but "se dejara rascar" lets. */
const MODALS = new Set(['poder', 'deber', 'querer', 'soler', 'saber', 'necesitar', 'desear', 'pensar', 'intentar', 'preferir']);
/** Modals that se makes impersonal: "No se puede bajar" (one cannot), "se debe permitir". */
const IMPERSONAL_MODALS = new Set(['poder', 'deber', 'necesitar']);
/** Determiners that say a feminine or a masculine noun follows: la vagabunda, el cuarto. */
const FEMININE = new Set(['la', 'las', 'una', 'unas', 'nuestra', 'nuestras', 'vuestra', 'vuestras', 'esta', 'estas',
  'esa', 'esas', 'aquella', 'aquellas']);
const MASCULINE = new Set(['el', 'los', 'un', 'unos', 'del', 'al', 'nuestro', 'nuestros', 'vuestro', 'vuestros', 'este', 'estos',
  'ese', 'esos', 'aquel', 'aquellos']);
/**
 * Object pronouns, which come before a finite verb and never before an imperative (that takes them after it: dile, dame): "le
 * di una al borriquillo débil" is dar's "I gave", not decir's "say!".
 */
const PROCLITICS = new Set(['me', 'te', 'se', 'le', 'lo', 'la', 'nos', 'os', 'les', 'los', 'las']);
/**
 * Titles, nouns before the name or office they go with: "el señor ingeniero", "su señor padre", "la señora marquesa". Not
 * the adjective spelled alike (señor "great big").
 */
const TITLES = new Set(['señor', 'señora', 'señores', 'señoras', 'señorito', 'señorita', 'don', 'doña', 'fray', 'sor', 'tío',
  'tía', 'señá', 'señó']);
/** Possessive pronouns, which an article makes "the one of mine, yours": "con la tuya", "la mía", "los suyos". */
const POSSESSIVES = new Set(['mío', 'tuyo', 'suyo', 'nuestro', 'vuestro']);
/**
 * Spans of time, after which hace is "ago": "hace tres años", "hace un rato", "hace mucho tiempo". Not a part of the day or a
 * season, which hacer's weather takes as well: "hace una noche de perros".
 */
const TIME = new Set(['año', 'día', 'mes', 'semana', 'hora', 'minuto', 'segundo', 'siglo', 'rato', 'tiempo', 'momento',
  'instante', 'temporada', 'época']);
/** Words that count a span of time: "hace unos días", "hace muchos años", "hace poco". */
const SPAN = new Set(['un', 'una', 'unos', 'unas', 'algún', 'alguna', 'algunos', 'algunas', 'varios', 'varias', 'mucho', 'mucha',
  'muchos', 'muchas', 'poco', 'poca', 'pocos', 'pocas', 'tanto', 'tanta', 'tantos', 'tantas', 'cuánto', 'cuánta', 'cuántos',
  'cuántas', 'largo', 'larga', 'largos', 'largas', 'breve', 'breves', 'medio', 'media']);
/**
 * haber with no participle after it says that something exists, "there was": "Pero no había ni un pescado" (Cuentos de la
 * selva), "Hubo un súbito silencio" (Platero y yo). Its forms and what each says (hay has a hint of its own).
 */
const IMPERSONAL_HABER: Record<string, string> = {
  había: 'there was, there were', hubo: 'there was, there were', hubiera: 'there were', hubiese: 'there were',
  habrá: 'there will be', habría: 'there would be', haya: 'there is, there are',
};
/** Adverbs that stand between impersonal haber and what there was: "no había allí más que", "hubo entonces un silencio". */
const HABER_BETWEEN = new Set(['allí', 'allá', 'aquí', 'ahí', 'acá', 'entonces', 'ya', 'también', 'todavía', 'aún', 'siempre',
  'luego', 'después', 'antes', 'apenas', 'casi', 'en']);
/** What follows impersonal haber that no noun's reading says: "no había nada", "hubo quien", "no había ni un pescado". */
const THERE_WAS = new Set(['nada', 'algo', 'nadie', 'alguien', 'quien', 'quienes', 'ni', 'mucho', 'mucha', 'muchos', 'muchas',
  'poco', 'poca', 'pocos', 'pocas', 'tanto', 'tanta', 'tantos', 'tantas', 'tal', 'tales', 'más', 'menos', 'varios', 'varias',
  'otro', 'otra', 'otros', 'otras', 'cosa', 'gente']);
/**
 * hacer's weather, "it is cold": "—Vamos, vamos; aquí hace frío" (El sombrero de tres picos), "Hacía mucho frío, además" (Cuentos
 * de la selva), "hace buen tiempo". The word and what the weather is.
 */
const WEATHER: Record<string, string> = { frío: 'cold', calor: 'hot', fresco: 'cool', sol: 'sunny', viento: 'windy',
  bochorno: 'muggy', buen: 'fine', bueno: 'fine', mal: 'bad weather', malo: 'bad weather', oscuro: 'dark' };
/** Words between hace and the weather: "hace mucho frío", "hacía un frío", "hace tanto calor". */
const WEATHER_BETWEEN = new Set(['mucho', 'mucha', 'un', 'una', 'tanto', 'tanta', 'poco', 'muy', 'bastante', 'algo', 'demasiado',
  'tan', 'más', 'menos', 'un', 'gran', 'buen', 'mal']);
/** hacer's forms of the third person singular, and the tense each says weather in. */
const WEATHER_HACER: Record<string, string> = { hace: 'it is', hacía: 'it was', hizo: 'it was', hará: 'it will be', haría: 'it would be',
  haga: 'it is', hiciera: 'it was', hiciese: 'it was' };
/** Where come and go point: "ven aquí", "ven conmigo", "ve y acompáñale", "ve con cuidado". */
const HITHER = new Set(['aquí', 'acá', 'allá', 'allí', 'ahí', 'a', 'al', 'con', 'conmigo', 'contigo', 'y', 'por', 'hacia', 'pronto',
  'tú', 'corriendo', 'luego', 'adentro', 'afuera', 'arriba', 'abajo', 'adelante']);
/**
 * Verbs a predicate adjective follows without an object in between: "cayó enfermo" fell ill, "quedó huérfano", "seguía
 * triste". Not ser, after which a noun is as likely ("era médico"); the others in COPULAS take one only with se: "se puso
 * enfermo", "se sintió cansado".
 */
const LINKING = new Set(['estar', 'quedar', 'caer', 'parecer', 'seguir', 'andar', 'permanecer', 'continuar']);
const LINKING_WITH_SE = new Set(['poner', 'sentir', 'volver', 'hallar', 'encontrar', 'mostrar', 'ver', 'creer']);

const isVerb = (r?: ContextReading): boolean => r?.pos === 'verb';
/** A verb's own form, an infinitive: the headword (poder) or a form the dictionary says is one. */
const isInfinitive = (r: ContextReading): boolean => r.pos === 'verb' && (!r.form || /\binfinitive\b/.test(r.form));
const isGerund = (r: ContextReading): boolean => r.pos === 'verb' && /\bgerund\b/.test(r.form);
/** Every way the form can be read is a subjunctive (que venga) or an imperative, none an indicative. */
const onlySubjunctive = (r: ContextReading): boolean => r.pos === 'verb' && !!r.form
  && r.form.split('; ').every((p) => /\b(?:subjunctive|imperative)\b/.test(p) && !/\bindicative\b/.test(p));
/** A past participle that agrees (querida, vistas): never the one of a compound tense, which stays masculine singular. */
const agreeingParticiple = (r: ContextReading): boolean => isParticiple(r) && /\b(?:feminine|plural)\b/.test(r.form);
const nounish = (r?: ContextReading): boolean => !!r && ['noun', 'adjective', 'numeral', 'proper noun'].includes(r.pos);
const isNoun = (r: ContextReading): boolean => r.pos === 'noun';
const isAdjective = (r: ContextReading): boolean => r.pos === 'adjective';
/** The noun spelled as the word is, not a form of another noun (medias "stockings", vista "sight"). */
const ownNoun = (r: ContextReading): boolean => r.pos === 'noun' && !r.form;
/** What a word was read as: its chosen reading for the words already read, its likeliest one for the words after. */
const readAs = (w?: ContextWord): ContextReading | undefined => w?.chosen ?? w?.readings[0];
const prefer = (f: (r: ContextReading) => boolean, margin = Infinity): ContextChoice => ({ prefer: f, margin });
/** An article, determiner or contraction as read: un, la, su, del. */
const determiner = (w?: ContextWord): boolean => ['article', 'determiner', 'contraction'].includes(readAs(w)?.pos ?? '');
/** Every way the form can be read is an imperative: di (decir's "say!"), ven (venir's "come!"). */
const onlyImperative = (r: ContextReading): boolean => r.pos === 'verb' && !!r.form
  && r.form.split('; ').every((p) => /\bimperative\b/.test(p));
/** The gender a noun reading has, from its form where it says one (una vagabunda is vagabundo's feminine). */
const genderOf = (r: ContextReading): string => (/\bfeminine\b/.test(r.form) ? 'f'
  : /\bmasculine\b/.test(r.form) ? 'm' : r.gender);
/** The gender a determiner or an adjective as read says its noun has: la, una, rica (rico's feminine); '' when it says none. */
function genderSaid(w: ContextWord | undefined): string {
  if (!w) return '';
  if (FEMININE.has(w.low)) return 'f';
  if (MASCULINE.has(w.low)) return 'm';
  const r = w.chosen;
  if (r?.pos !== 'adjective') return '';
  const f = /\bfeminine\b/.test(r.form);
  return f === /\bmasculine\b/.test(r.form) ? '' : f ? 'f' : 'm';
}

/**
 * The verb that governs word `at`: the word before, or the one before an adverb or two between them ("estaba ya herida",
 * "salir nunca fuera", "estoy cada vez más enfermo"), or its subject put after it ("No estás tú también alegre como yo?").
 * Only space may separate them.
 */
function verbBefore(q: ContextQuery): ContextWord | undefined {
  for (let i = q.at - 1, n = 0; i >= 0 && n < 4; i--, n++) {
    const w = q.words[i];
    if (w.after) return undefined;
    if (isVerb(w.chosen)) return w;
    if (w.low === 'vez' && i >= 1 && q.words[i - 1].low === 'cada' && !q.words[i - 1].after) {
      i--;
      continue;
    }
    if (!BETWEEN.has(w.low) && !SUBJECTS.has(w.low)) return undefined;
  }
  return undefined;
}

/** The word before `at` past the adverbs that may stand between ("brumosa ya y morada"), within its clause. */
function wordBefore(q: ContextQuery, at: number): ContextWord | undefined {
  for (let i = at - 1; i >= 0; i--) {
    const w = q.words[i];
    if (w.after) return undefined;
    if (!BETWEEN.has(w.low)) return w;
  }
  return undefined;
}

/**
 * The person of a reflexive pronoun agrees with the verb form: "se enfermó", "me levanto"; not "me dio", "te veo". A pronoun
 * before the verb never goes with an imperative (siéntate joins it), so "Si te parece bien" is parecer's third person.
 */
function agrees(pronoun: string, r: ContextReading): boolean | undefined {
  const person = REFLEXIVE[pronoun];
  if (!person || !r.form) return undefined;
  const form = r.form.split('; ').filter((p) => !/\bimperative\b/.test(p)).join('; ');
  // "me miraba" is "I looked at myself" or "he looked at me": the first and third persons share the form.
  if (pronoun === 'me' && /first\/third-person/.test(form)) return undefined;
  return person.test(form);
}

/**
 * la, las, los after a relative que: the article unless the next word is a verb far likelier than a noun. The generic rule
 * takes a pronoun before la for a subject, which a relative que is not always: "el sitio que las estrellas iluminan". So
 * after a pronoun that is no subject (mucho, tal, esto, todas) or a subject pronoun a preposition governs: "y rió mucho la
 * burla" (Lazarillo), "y era tal la fuerza pictórica", "acaricio en él la idea", "todas las conservas".
 */
function afterRelative(q: ContextQuery): ContextChoice | null {
  const { prev, next } = q;
  if (!prev || prev.chosen?.pos !== 'pronoun' || !next || PROCLITICS.has(prev.low)) return null;
  const governed = q.at >= 2 && !q.words[q.at - 2].after && PREPOSITIONS.has(q.words[q.at - 2].low);
  if (prev.low !== 'que' && SUBJECTS.has(prev.low) && !governed) return null;
  // A noun of the other number cannot follow: "a los que no ahondaren tanto los deleite" (Lazarillo) is "may it delight them".
  const plural = q.word.low !== 'la';
  const number = (r: ContextReading): string => (/\bplural\b/.test(r.form) || r.gender === 'pl' ? 'pl'
    : !r.form || /\bsingular\b/.test(r.form) ? 'sg' : '');
  let verb = -Infinity;
  let noun = -Infinity;
  for (const r of next.readings) {
    if (r.pos === 'verb' && !isParticiple(r)) verb = Math.max(verb, r.score);
    else if ((nounish(r) || isParticiple(r)) && (!number(r) || (number(r) === 'pl') === plural)) noun = Math.max(noun, r.score);
  }
  if (noun === -Infinity) return null;
  return verb > noun + 2 ? prefer((r) => r.pos === 'pronoun') : prefer((r) => r.pos === 'article' || r.pos === 'determiner');
}

/**
 * ir a + infinitive (going to), ir + gerund (going on), volver a + infinitive (again): the pronoun before them belongs to the
 * verb after. Not ir's preterite, which is going off to do it or so: "se fué a vivir al monte", "se fueron volando".
 */
function periphrasis(q: ContextQuery, verb: ContextReading): boolean {
  const { next } = q;
  if (!next || !['ir', 'volver'].includes(verb.key) || (verb.key === 'ir' && /\bpreterite\b/.test(verb.form))) return false;
  if (next.low === 'a') return !!q.words[q.at + 2]?.readings.some(isInfinitive) && !q.words[q.at + 1].after;
  return verb.key === 'ir' && next.readings.some(isGerund);
}

export function spanishContext(q: ContextQuery): ContextChoice | null {
  const w = q.word;
  const { prev, next } = q;
  const rs = w.readings;
  const has = (f: (r: ContextReading) => boolean): boolean => rs.some(f);
  const top = rs[0];

  // El at a sentence start before a verb of the third person is Él "he", its accent dropped by the printer (es.ts
  // capitalAccent): "El creía que estaba siempre en la ramada" (Cuentos de la selva), "¡El es un hombre bueno!". Before a noun
  // it is the article, and before a word nearly as likely one: "El hombre enfermo aceptó", "El guarda arrepentido quizás daba
  // largas razones", "El canto del grillo" (Platero y yo; canto is cantar's first person, which él never takes).
  if (w.text === 'El' && q.sentenceStart && next && has((r) => r.key === 'él')) {
    const verb = next.readings.find((r) => isFiniteVerb(r) && /\bthird-person singular\b/.test(r.form));
    const noun = next.readings.find((r) => (nounish(r) && !/\bplural\b/.test(r.form)) || isParticiple(r));
    if (verb && (!noun || verb.score > noun.score + 2)) return prefer((r) => r.key === 'él');
    return null;
  }

  // sí is "oneself" only after a preposition or before mismo: "dijo para sí", "a sí mismo", "por sí conocen las cosas".
  // Anywhere else it is "yes", the commonest word of Marianela's dialogue: "—Sí, señor", "Dicen que sí", "Eso sí que es
  // gracioso".
  if (w.low === 'sí') {
    const preposition = !!prev && (PREPOSITIONS.has(prev.low) || prev.chosen?.pos === 'preposition');
    if (preposition || (next && /^mism[oa]s?$/.test(next.low))) {
      return prefer((r) => r.pos === 'pronoun');
    }
    return prefer(has((r) => r.pos === 'particle') ? (r) => r.pos === 'particle' : (r) => r.pos !== 'pronoun');
  }

  // solo is "alone" where an adjective stands: closing its clause ("Aprenderé solo."), joined to another adjective ("solo y
  // mustio"), after the word it goes with ("Vivía solo en el bosque", "uno solo", "él solo podía servir de alfombra", "voy a
  // morir aquí solo"), after muy or tan ("tan solo allá"). It is the adverb "only" before what it limits: "solo un poco",
  // "solo dos", "solo que". Books before 2010 write the adverb sólo; this tells them apart in books that do not.
  if (w.low === 'solo' && has(isAdjective) && has((r) => r.pos === 'adverb')) {
    const adjective = prefer(isAdjective);
    const adverb = prefer((r) => r.pos === 'adverb');
    const p = prev?.chosen?.pos ?? '';
    const itsWord = !!prev && (prev.name || ['noun', 'pronoun', 'proper noun', 'numeral'].includes(p));
    if (w.after || (next && ['y', 'e'].includes(next.low) && q.words[q.at + 2]?.readings.some(isAdjective))) return adjective;
    // "a uno solo que me quiere", but "es solo que".
    if (next && next.low === 'que') return itsWord ? adjective : adverb;
    if (next && ['article', 'determiner', 'numeral'].includes(readAs(next)?.pos ?? '')) return adverb;
    if (itsWord || (prev && (INTENSIFIERS.has(prev.low) || PLACE.has(prev.low) || p === 'verb' || p === 'adjective'))) {
      return adjective;
    }
    return null;
  }

  // fuera is the adverb "outside" after a verb, a place or before de, and ser's or ir's "were" after si, que, como si or a
  // subject: "con la cabeza fuera del agua", "yo me salí fuera", "allá fuera repican"; but "como si fuera su propia hija".
  if (w.low === 'fuera' && has((r) => r.pos === 'adverb')
    && ((next && (next.low === 'de' || next.low === 'del')) || verbBefore(q) || (prev && PLACE.has(prev.low)))) {
    return prefer((r) => r.pos === 'adverb');
  }

  // cual is "which" after an article, a preposition or cada (la cual, del cual, cada cual, "no sé por cual dicha"), and "like"
  // anywhere else: "sus ojos son duros cual dos escarabajos de cristal negro" (Platero y yo), "inmóvil y sin expresión, cual
  // muñeco de piedra".
  if (w.low === 'cual' && has((r) => r.pos === 'adverb') && has((r) => r.pos === 'pronoun')) {
    const which = !!prev && (determiner(prev) || PREPOSITIONS.has(prev.low) || prev.low === 'cada' || prev.low === 'tal');
    return prefer(which ? (r) => r.pos === 'pronoun' : (r) => r.pos === 'adverb');
  }

  // mal is malo cut short before a masculine noun, "bad": "Contaba el mal ciego a todos cuantos allí se allegaban mis
  // desastres" (Lazarillo), "de mal humor", "hace mal tiempo". After a determiner with no noun after it, the noun "evil, harm":
  // "del mal", "mi mal", "¿Qué mal es este?". Anywhere else the adverb "badly": "lo hizo mal", "mal herido".
  if (w.low === 'mal' && has(isAdjective) && has(isNoun)) {
    const masculine = (r: ContextReading): boolean => isNoun(r) && !/\bplural\b/.test(r.form) && genderOf(r) !== 'f';
    // Before a participle the adverb grades it, even after a determiner: "en un mal disimulado desprecio" (Platero y yo), "tu
    // causa es tan mal criado", "estaba muy mal alojado"; but "del mal pago que le di" (Lazarillo) is a bad payment.
    const graded = !!next && next.readings.some((r) => isParticiple(r) && r.score > next.readings[0].score - 1)
      && !(determiner(prev) && readAs(next)?.pos === 'noun');
    if (graded) return prefer((r) => r.pos === 'adverb');
    const nounNext = !!next && !next.name && next.readings.some((r) => masculine(r) && r.score > next.readings[0].score - 3);
    // After a verb, a noun after mal is more often its object: "habla mal castellano"; but "hace mal tiempo".
    if (nounNext && (!isVerb(prev?.chosen) || readAs(next)?.pos === 'noun')) return prefer(isAdjective);
    if (prev && prev.low !== 'lo' && (determiner(prev) || prev.low === 'qué')) return prefer(isNoun);
    return prefer((r) => r.pos === 'adverb');
  }

  // bajo is the preposition "under" only with a noun phrase after it, "estaban bajo el agua", "bajo tierra", or before de: "por
  // bajo de las aletas". After más, muy or a determiner it is the adjective "low" ("el más bajo linaje"); with no noun phrase
  // after it, the adjective after a noun or a copula ("llevaba el escote redondo y bajo, al estilo de Madrid", "un tono bajo",
  // "era bajo"), the adverb after another verb ("habla bajo"), the noun "bass" after a preposition ("voz de bajo profundo").
  // After an object pronoun it is bajar's: "con el peso un poco me bajo para aliviarlo".
  if (w.low === 'bajo' && has((r) => r.pos === 'preposition') && has(isAdjective)
    && !(prev && PROCLITICS.has(prev.low) && prev.chosen?.pos === 'pronoun')) {
    const n = readAs(next);
    const phrase = !!next && (next.name || ['article', 'determiner', 'noun', 'pronoun', 'numeral', 'proper noun', 'contraction']
      .includes(n?.pos ?? ''));
    if (prev && (INTENSIFIERS.has(prev.low) || COMPARATIVES.has(prev.low) || determiner(prev))) return prefer(isAdjective);
    if (phrase || (next && ['de', 'del'].includes(next.low))) return prefer((r) => r.pos === 'preposition');
    if (prev && PREPOSITIONS.has(prev.low) && has(isNoun)) return prefer(isNoun);
    const verb = prev?.chosen && isVerb(prev.chosen) ? prev.chosen.key : '';
    if (verb && !COPULAS.has(verb) && has((r) => r.pos === 'adverb')) return prefer((r) => r.pos === 'adverb');
    return prefer(isAdjective);
  }

  // A title is the noun, before the name or office it goes with as anywhere: "Aquí están—dijo—el señor ingeniero y su
  // hermano", "el señor D. Teodoro", "su señor padre" (Marianela); not señor "great big", a colloquial adjective; "Escúcheme
  // V., señá Frasquita" (El sombrero de tres picos), not señar's "sign!". And the noun after it stays one: "su señor padre",
  // "nosotros los señores médicos", not padre "cool".
  if (TITLES.has(w.low) && has(isNoun)) return prefer((r) => isNoun(r) || r.pos === 'proper noun');
  if (prev && TITLES.has(prev.low) && prev.chosen?.pos === 'noun' && top && isNoun(top)) return prefer(isNoun);

  // consigo is "with himself, herself" after a verb or a preposition, or before mismo: "a quien Teodoro quiso llevar consigo"
  // (Marianela), "hablaba consigo mismo". With a subject or a pronoun before it, conseguir's "I achieve": "no lo consigo".
  if (w.low === 'consigo' && has((r) => r.pos === 'adverb') && has(isVerb)) {
    if ((prev && (isVerb(prev.chosen) || PREPOSITIONS.has(prev.low))) || (next && /^mism[oa]s?$/.test(next.low))) {
      return prefer((r) => r.pos === 'adverb');
    }
    return null;
  }

  // Impersonal haber, "there was": a third-person form with what there was after it, not a participle. "Pero no había ni un
  // pescado" (Cuentos de la selva), "Hubo un súbito silencio" (Platero y yo), "No los había" (with nothing after it, once
  // it has its pronoun). Not haber de or haber que ("había de ir", "hay que"), not after a subject ("yo había") nor after
  // the participle the old books put first ("dicho había").
  const there = IMPERSONAL_HABER[w.low];
  if (there && has((r) => r.key === 'haber') && !(prev && (SUBJECTS.has(prev.low) || determiner(prev) || (prev.chosen && isParticiple(prev.chosen))))) {
    const choice: ContextChoice = { prefer: (r) => r.key === 'haber', margin: Infinity, hint: there, sense: /\bthere be\b/ };
    let i = q.at + 1;
    while (i < q.words.length && i <= q.at + 2 && !q.words[i - 1].after && HABER_BETWEEN.has(q.words[i].low)) i++;
    const after = i < q.words.length && !q.words[i - 1].after ? q.words[i] : undefined;
    if (!after) return prev && ['lo', 'la', 'los', 'las'].includes(prev.low) ? choice : null;
    if (after.low === 'de' || after.low === 'que' || after.readings.some(isParticiple)) return null;
    const a = readAs(after);
    if (THERE_WAS.has(after.low) || after.name || (a && (nounish(a) || ['article', 'determiner', 'numeral'].includes(a.pos)))) return choice;
    return null;
  }

  // hacer's weather: "aquí hace frío" "it is cold", "Hacía mucho frío". Not with an object before the weather word: "hace un
  // día de perros" is the time of day's, which the preposition reads.
  const tense = WEATHER_HACER[w.low];
  if (tense && has((r) => r.key === 'hacer')) {
    let i = q.at + 1;
    while (i < q.words.length && i <= q.at + 2 && !q.words[i - 1].after && WEATHER_BETWEEN.has(q.words[i].low) && !WEATHER[q.words[i].low]) i++;
    const after = i < q.words.length && !q.words[i - 1].after ? q.words[i] : undefined;
    // buen and mal need their tiempo: "hace buen tiempo"; but "hace mal" is "does harm".
    const what = after && WEATHER[after.low];
    const timed = !!after && (after.low !== 'buen' && after.low !== 'mal' || q.words[i + 1]?.low === 'tiempo');
    if (what && timed) return { prefer: (r) => r.key === 'hacer', margin: Infinity, hint: `${tense} ${what}`, sense: /\bweather\b/ };
  }

  // hace before a span of time is "ago": "—Dicen que hace tres años" (Marianela), "hace un rato", "hace mucho tiempo", "hace
  // poco"; before anything else it is hacer's: "hace frío", "hace mucho frío".
  if (w.low === 'hace' && next && has((r) => r.pos === 'preposition')) {
    const second = !next.after ? q.words[q.at + 2] : undefined;
    const time = (x?: ContextWord): boolean => !!x && x.readings.some((r) => TIME.has(r.key));
    const noun = (x?: ContextWord): boolean => !!x && !!readAs(x) && nounish(readAs(x));
    if (time(next) || ((readAs(next)?.pos === 'numeral' || SPAN.has(next.low)) && time(second))
      || (['poco', 'mucho'].includes(next.low) && !noun(second))) {
      return prefer((r) => r.pos === 'preposition');
    }
  }

  // ven and ve at the head of their clause, before where to or with whom or alone, are venir's "come!" and ir's "go!": "—Choto,
  // Choto, ven aquí", "Ven, Pablo desea verte", "ven conmigo", "ve y acompáñale" (Marianela). ver's "they see", "he sees" has
  // a subject or a pronoun before it: "lo ven", "se ve", "No ve".
  if ((w.low === 'ven' || w.low === 've') && (q.sentenceStart || !prev || ['y', 'pues', 'anda'].includes(prev.low))
    && (w.after || (next && HITHER.has(next.low)))) {
    const key = w.low === 'ven' ? 'venir' : 'ir';
    const imperative = (r: ContextReading): boolean => r.key === key && /\bimperative\b/.test(r.form);
    if (has(imperative)) return prefer(imperative);
  }

  // basta is bastar's "is enough", or exclaimed the interjection "enough!", and after a noun basto's "coarse": "Basta ya de
  // generalidades", "la mano basta y ruda, endurecida por el arado" (Marianela). Never the Philippine conjunction "as long
  // as" or adverb "just".
  if (w.low === 'basta' && has(isVerb)) {
    if (prev?.chosen?.pos === 'noun' && has(isAdjective)) return prefer(isAdjective);
    const alone = (q.sentenceStart || !prev) && (!!w.after || (!!next && ['ya', 'de'].includes(next.low)));
    if (alone && has((r) => r.pos === 'interjection')) return prefer((r) => r.pos === 'interjection');
    return prefer(isVerb);
  }

  // ahora, and the Lazarillo's agora, is the correlative "now … now" only when it comes twice, "ahora ríe, ahora llora"; once,
  // it is "now": "sintió el desesperado ciego que agora tenía tiempo de tomar de mí venganza".
  if ((w.low === 'ahora' || w.low === 'agora') && has((r) => r.pos === 'conjunction') && has((r) => r.pos === 'adverb')) {
    const twice = q.words.some((x, i) => i !== q.at && ['ahora', 'agora', 'ora'].includes(x.low));
    return prefer((r) => r.pos === (twice ? 'conjunction' : 'adverb'));
  }

  // An imperative takes its pronouns after it (dile, dame), so after an object pronoun a form that is also another person's
  // is that one: "Las tomé, agradecido, y le di una al borriquillo débil" (Platero y yo) is dar's "I gave", not decir's "say!".
  // So is di before con or en, dar con, dar en "came upon": "di conmigo en Torrijos" (Lazarillo). (After me, te, se, nos,
  // os the reflexive rule below chooses.)
  if (top && onlyImperative(top) && has((r) => isVerb(r) && !onlyImperative(r))
    && ((prev && PROCLITICS.has(prev.low) && !REFLEXIVE[prev.low] && prev.chosen?.pos === 'pronoun')
      || (w.low === 'di' && next && ['con', 'conmigo', 'contigo', 'consigo', 'en'].includes(next.low)))) {
    return prefer((r) => isVerb(r) && !onlyImperative(r));
  }

  // After an article a possessive is the pronoun, "the one of yours": "qué también habrá subido al cielo con la tuya" (Platero
  // y yo), not tuya "thuja".
  if (prev && ['el', 'la', 'los', 'las', 'lo', 'al', 'del'].includes(prev.low)
    && has((r) => r.pos === 'pronoun' && POSSESSIVES.has(r.key))) {
    return prefer((r) => r.pos === 'pronoun' && POSSESSIVES.has(r.key));
  }

  // A word that is an adverb and an interjection is the interjection only where it is exclaimed (¡Arriba!) or spoken, after
  // the dialogue dash: "Arriba, por las ramas últimas, salta y pía un leve pajarillo" (Platero y yo) is "up above".
  if (has((r) => r.pos === 'interjection') && has((r) => r.pos === 'adverb') && !/[¡¿—]/.test(w.before) && !/[!?]/.test(w.after)
    && (top?.pos === 'interjection' || (q.sentenceStart && /^[,?…;:]/.test(w.after)))) {
    return prefer((r) => r.pos !== 'interjection');
  }

  // Neuter lo stands before an adjective, a participle or an adverb (lo más hondo, lo prometido), never before a noun; so
  // before a word that is a noun or a verb, lo is the pronoun and the word the verb: "Lo beso, lo engaño, lo hago rabiar"
  // (Marianela), "mientras mi hermano lo busca".
  if (w.low === 'lo' && next && next.readings.some(isFiniteVerb)
    && !next.readings.some((r) => isParticiple(r)
      || ['adjective', 'adverb', 'pronoun', 'determiner', 'conjunction', 'preposition'].includes(r.pos))) {
    return prefer((r) => r.pos === 'pronoun');
  }
  if (['la', 'las', 'los'].includes(w.low)) return afterRelative(q);

  // les is the pronoun "to them" in any book; the gender-neutral article is a neologism.
  if (w.low === 'les') return prefer((r) => r.pos === 'pronoun');

  // que after a noun or a pronoun starts a clause about it, the relative "which, who": "un hombre que vivía en Buenos Aires",
  // "algo que", "el que", "lo que". After a comparison it is "than", and after tan or tanto "that": "más vaca que carnero",
  // "tanta sed que", which the conjunction reads; and so after a subject ("sabes tú que") or a noun that makes a conjunction
  // with it ("es verdad que", "cada vez que").
  if (w.low === 'que' && has((r) => r.pos === 'pronoun') && has((r) => r.pos === 'conjunction')) {
    // Past a noun, before a verb or a pronoun, que is the noun's relative: "Ya no habrá más pescados ni bichos que vengan a
    // tomar agua" (Cuentos de la selva). Not after sino: "No hay más sino que tiene razón".
    const verbAfter = !!next && (PROCLITICS.has(next.low) || next.low === 'no' || isVerb(next.readings[0]));
    let noun = false;
    for (let i = q.at - 1; i >= Math.max(0, q.at - 4) && !q.words[i].after; i--) {
      if (q.words[i].chosen?.pos === 'noun') noun = true;
      if (i === q.at - 1 && q.words[i].low === 'sino') break;
      if (!DEGREE.has(q.words[i].low)) continue;
      if (noun && verbAfter && COMPARISON.has(q.words[i].low)) return null;
      // After a comparison que is the conjunction's "than": "Una olla de algo más vaca que carnero" (Don Quijote), "más lejos
      // que Misiones todavía" (Cuentos de la selva). Not after a superlative, whose que is the relative: "la más hermosa que
      // he visto", "el cuento más lindo que".
      const b1 = q.words[i - 1];
      const b2 = q.words[i - 2];
      const definite = (x?: ContextWord): boolean => !!x && ['el', 'la', 'los', 'las', 'lo'].includes(x.low);
      const superlative = !!b1 && !b1.after && (NOUN_DETERMINERS.has(b1.low) || b1.low === 'lo'
        || (b1.chosen?.pos === 'noun' && !!b2 && !b2.after && definite(b2)));
      if (COMPARISON.has(q.words[i].low) && !superlative) {
        return { prefer: (r) => r.pos === 'conjunction', margin: Infinity, hint: 'than' };
      }
      return null;
    }
    const p = prev?.chosen;
    if (!prev || prev.name || CONJUNCTIONAL.has(prev.low) || SUBJECTS.has(prev.low)) return null;
    if (prev.low === 'lo' || ['noun', 'article'].includes(p?.pos ?? '')
      || (p?.pos === 'pronoun' && !REFLEXIVE[prev.low] && !DATIVES.has(prev.low) && !['la', 'las', 'los'].includes(prev.low))) {
      return prefer((r) => r.pos === 'pronoun');
    }
    return null;
  }

  // A verb after a reflexive pronoun of its own person is reflexive: "Pero un día se enfermó" got sick, not "made ill";
  // "se detenía" stopped; "La tortuga se levantaba" got up. Of another person the pronoun is its object: "Me los dio D.
  // Teodoro", "te veo". se before le, me or les is the verb's own too: "esa vez no se le escaparía", "mis ojos se me cansan".
  // After se, a form of both ser and ir is ir: "se fué a vivir al monte" went off, not "was".
  if (has(isVerb)) {
    const clitic = prev && DATIVES.has(prev.low) && q.at >= 2 && !q.words[q.at - 2].after && q.words[q.at - 2].low === 'se' ? 'se'
      : prev && REFLEXIVE[prev.low] ? prev.low : '';
    if (clitic) {
      const serOrIr = has((r) => r.key === 'ir') && has((r) => r.key === 'ser');
      // Not an imperative, which takes its pronoun after it: "me di cuenta" is dar's "I gave", not decir's "say!".
      const finite = has((r) => isVerb(r) && !onlyImperative(r));
      const fits = (r: ContextReading): boolean => isVerb(r) && (!serOrIr || r.key === 'ir') && !(finite && onlyImperative(r));
      const verb = rs.find(fits) ?? rs.find(isVerb)!;
      let reflexive = agrees(clitic, verb);
      // Impersonal se says what is said, seen or believed: "se dice que", "Creeríase que", "se puede decir". And a verb with
      // an infinitive after it lends its se to the infinitive: "se quiso burlar de los flamencos".
      if (reflexive && clitic === 'se' && next && (next.low === 'que' || next.readings.some(isInfinitive))) reflexive = undefined;
      // So does ir going to do something, or going on doing it: "en el monte se va a morir", "la tortuga se iba debilitando".
      // But gone off doing it keeps its own: "se fueron volando a la cueva".
      if (reflexive && periphrasis(q, verb)) reflexive = false;
      const choice = prefer(has(fits) ? fits : isVerb);
      if (reflexive !== undefined) choice.reflexive = reflexive;
      return choice;
    }
    // Galdós joins se to a finite verb: "Detúvose", "hundiose en la frágil tierra" are se detuvo, se hundió. A finite form
    // that is not a subjunctive cannot end in -se by itself (fuese, cayese are subjunctives), nor a first-person one in -me
    // ("levantéme" is me levanté).
    if (top && isFiniteVerb(top) && !/\bsubjunctive\b/.test(top.form) && !(next && next.low === 'que')
      && (w.low.endsWith('se') || (w.low.endsWith('me') && agrees('me', top)))) {
      return { prefer: () => true, margin: 0, reflexive: true };
    }
    // fue, fueron, fuera are ser's and ir's: before a, a direction or a gerund they are ir, "fue a casa del ingeniero",
    // "Teodoro fue detrás", "fué corriendo a buscar remedios"; ser takes no gerund.
    if (has((r) => r.key === 'ir') && has((r) => r.key === 'ser') && next
      && (['a', 'al', 'hacia', 'hasta', 'detrás', 'delante', 'adelante'].includes(next.low) || next.readings.some(isGerund))) {
      return prefer((r) => r.key === 'ir');
    }
  }

  // An infinitive or gerund whose pronoun stands before the verb it depends on is reflexive as that pronoun says: "se quiso
  // burlar de los flamencos", "no me puedo levantar", "Florentina se va a enojar", "se iba perdiendo en la inmensidad". Not
  // after se puede or se debe, which say what one can or must do: "No se puede bajar", "Ni aun se debe permitir que".
  const lead = prev && isVerb(prev.chosen) ? q.at - 1
    : prev && prev.low === 'a' && q.at >= 2 && !q.words[q.at - 2].after && isVerb(q.words[q.at - 2].chosen) ? q.at - 2 : -1;
  if (lead >= 1 && top && (isInfinitive(top) || isGerund(top)) && !q.words[lead - 1].after && !(next && next.low === 'que')) {
    const clitic = q.words[lead - 1].low;
    const governor = q.words[lead].chosen!;
    const notGoneOff = !(governor.key === 'ir' && /\bpreterite\b/.test(governor.form));
    const depends = isGerund(top) ? governor.key === 'ir' && lead === q.at - 1 && notGoneOff
      : lead === q.at - 1 ? MODALS.has(governor.key) && !(clitic === 'se' && IMPERSONAL_MODALS.has(governor.key))
        : ['ir', 'volver'].includes(governor.key) && notGoneOff;
    if (REFLEXIVE[clitic] && depends && agrees(clitic, governor)) return { prefer: () => true, margin: 0, reflexive: true };
  }

  // A noun cannot follow a determiner or an adjective of the other gender: "¡Eres una real moza!" (Marianela) has real
  // "fine", not real "real (coin)"; and among the sections of one word they choose: "la frente" is the forehead, "el frente"
  // the front; the parrot's "¡Rica, papa!" (Cuentos de la selva) is food, not the pope. El and un take a feminine noun that
  // starts with a stressed a: "el agua", "este arca".
  {
    const before = prev ?? (q.at >= 1 && q.words[q.at - 1].after === ',' && q.words[q.at - 1].chosen?.pos === 'adjective'
      ? q.words[q.at - 1] : undefined);
    const g = before && before.low !== 'lo' && (determiner(before) || before.chosen?.pos === 'adjective') ? genderSaid(before) : '';
    const stressedA = /^h?[aá]/.test(w.low);
    const clash = (r: ContextReading): boolean => isNoun(r) && /^[mf]$/.test(genderOf(r)) && genderOf(r) !== g
      && !(g === 'm' && stressedA && genderOf(r) === 'f');
    // After a determiner, any reading a determiner may stand before; after an adjective, only a noun of its gender (it may
    // go with the word before: "en seguida río arriba", "quedado también hechos piedra").
    const fit = (r: ContextReading): boolean => (determiner(before) ? nounish(r) && r.pos !== 'proper noun' : isNoun(r))
      && !clash(r);
    // An adjective before its noun stays one: "una real moza" is no real "real (coin)".
    const beforeNoun = !!next && next.readings.some(isNoun);
    if (g && top && has(clash) && has(fit) && (clash(top) || (determiner(before) && isAdjective(top) && beforeNoun))) {
      return prefer(fit);
    }
  }

  // After a determiner or an adjective a participle is the noun spelled alike: "su venida", "una simple mirada", "gozosa
  // mirada", "tan aguda vista", "¡Maldita vista suya!" (Marianela); and so is one joined to a noun, "la alternada ida y
  // venida". Before a noun it is the adjective: "su querida hija".
  if (top && isParticiple(top) && has(ownNoun) && prev && !(next && (next.name || readAs(next)?.pos === 'noun'))) {
    const p = prev.chosen;
    // An adjective that goes with a noun before it goes with that noun, and the participle too: "terciopelo raso hecho cien
    // dobleces", "la belleza ciega hecha para recreo".
    const ownAdjective = (p?.pos === 'adjective' || (!!p && agreeingParticiple(p)))
      && !(q.at >= 2 && !q.words[q.at - 2].after && q.words[q.at - 2].chosen?.pos === 'noun');
    // Not a quantifier, after which it is the participle ("la cúpula verde toda pintada de cenit"), nor one with its agent
    // after it: "volvió gozoso llamado por la Nela". Joined to a noun that is a participle too, it is one ("ida y venida"),
    // but not with its object after it ("Después de haber apagado la lámpara y cruzado las dobles cortinas", Bécquer), nor
    // joined to another noun: "acabado el sermón y vuelto al altar" (Lazarillo).
    const modifier = (NOUN_DETERMINERS.has(prev.low) || ownAdjective) && !(next && next.low === 'por');
    const coordinate = ['y', 'e', 'ni', 'o'].includes(prev.low) && q.at >= 2 && !q.words[q.at - 2].after
      && q.words[q.at - 2].chosen?.pos === 'noun' && q.words[q.at - 2].readings.some(isParticiple)
      && !(next && NOUN_DETERMINERS.has(next.low));
    if (modifier || coordinate) return prefer(ownNoun);
  }

  // After haber, the participle, though an adverb is spelled alike: "—Por allí se ha escapado" (Marianela) is escapar's, not
  // escapado "in a rush".
  if (top && top.pos === 'adverb' && has(isParticiple) && verbBefore(q)?.chosen?.key === 'haber') return prefer(isParticiple);

  // A participle heading its clause ahead of its auxiliary, as the old books put it: "Criado te he y con buen amo te he
  // puesto" (Lazarillo) is criar's, not criado "servant". Not a subject before its verb: "Los pescados se han ido".
  if (top && !isVerb(top) && has(isParticiple) && (q.sentenceStart || !prev) && next && PROCLITICS.has(next.low) && !next.after
    && q.words[q.at + 2]?.readings.some((r) => r.key === 'haber' && isFiniteVerb(r))) {
    return prefer(isParticiple);
  }

  // At the head of a clause, before an infinitive, the verb that governs it: "Procura ser bueno, y Dios te guíe"
  // (Lazarillo), not procura "procural".
  if (top && top.pos === 'noun' && (q.sentenceStart || !prev) && next && readAs(next) && isInfinitive(readAs(next)!)
    && has(isFiniteVerb)) {
    return prefer(isFiniteVerb, CONTEXT_MARGIN);
  }

  // An adverb spelled like a plural noun is the noun after a determiner, or an adjective after one: "dilata las levantadas
  // narices" (Platero y yo) are nostrils, not narices "the heck". Not before de or que: "quedarse quieto antes de bajar".
  const modified = !!prev && (NOUN_DETERMINERS.has(prev.low)
    || (prev.chosen?.pos === 'adjective' && q.at >= 2 && !q.words[q.at - 2].after && NOUN_DETERMINERS.has(q.words[q.at - 2].low)));
  if (top && top.pos === 'adverb' && modified && !(next && ['de', 'del', 'que'].includes(next.low))
    && has((r) => isNoun(r) && /\bplural\b/.test(r.form))) {
    return prefer(isNoun);
  }

  // After a determiner, two words that can each be a noun or an adjective are the noun and its adjective when that reading
  // of the pair is likelier, a little more so as most Spanish adjectives come after their noun: "un periódico inglés" (a
  // newspaper, not "periodic"), "el médico francés", "Las jaras vecinas". The other way where that is likelier: "al
  // desgraciado joven", "el cóncavo hueco", "Un bendito padre". Not before a third word that is the noun ("los velludos
  // fornidos brazos"), nor an ordinal, a title or a word cut short, which come first: "Avanzó el cuarto estado", "el señor
  // ingeniero", "un gran mate".
  if (prev && determiner(prev) && prev.low !== 'lo' && top && nounish(top) && has(isNoun) && has(isAdjective)
    && !TITLES.has(w.low) && !has((r) => /\bapocopic\b/.test(r.form))
    && !/^(?:primer|segund|tercer|cuart|quint|sext|séptim|octav|noven|décim|últim)/.test(w.low) && next && !next.name
    && !(q.words[q.at + 2] && !next.after && readAs(q.words[q.at + 2])?.pos === 'noun')) {
    const g = genderSaid(prev);
    const best = (x: ContextReading[], f: (r: ContextReading) => boolean): number => Math.max(-Infinity,
      ...x.filter(f).map((r) => r.score));
    const noun = best(rs, (r) => isNoun(r) && (!g || !/^[mf]$/.test(genderOf(r)) || genderOf(r) === g));
    const after = best(next.readings, isAdjective);
    const first = best(rs, isAdjective) + best(next.readings, isNoun);
    if (noun + after + 0.3 > first) return prefer((r) => isNoun(r) && r.score === noun);
  }

  // An infinitive that is also a noun (poder, decir, saber) is the verb after al and before another infinitive: "Al decir
  // esto", "sin poder dormir", "para poder guiar su espíritu"; the noun after an article: "el poder y brío del arte".
  if (has(isInfinitive) && has(isNoun) && top && top.pos === 'noun') {
    // Not "al titular intermitente y traicionero río" (Sombrero de tres picos), where an adjective follows.
    if ((prev && prev.low === 'al' && !(next && next.readings[0] && nounish(next.readings[0])))
      || (next && next.readings[0] && isInfinitive(next.readings[0]))) return prefer(isInfinitive);
    return null;
  }

  // After estar, a predicate where a noun or a finite verb was likelier: "estaba ya herida" (Quiroga), "Pero yo estoy alegre"
  // (Marianela). Not a preposition or a conjunction: "estaban bajo el agua", "se están mientras se van limpiando". After ser,
  // not a finite verb: "debe ser tan alegre como el sol"; but ser after ser stays, "un si es no es severo".
  const governing = verbBefore(q);
  const copula = governing?.chosen?.key ?? '';
  const predicate = (r: ContextReading): boolean => ['adjective', 'adverb'].includes(r.pos) || isParticiple(r);
  if (top && (top.pos === 'noun' || isFiniteVerb(top)) && top.key !== 'ser' && top.key !== 'estar') {
    if (copula === 'estar' && has(predicate)) return prefer(predicate);
    if (copula === 'ser' && isFiniteVerb(top) && has((r) => !isFiniteVerb(r))) return prefer((r) => !isFiniteVerb(r));
    // So after a verb that links its subject to how it is, where no object follows: "cayó enfermo" fell ill (Marianela), "se
    // puso loca de furor", "quedó huérfano"; not a sick person.
    const i = governing ? q.words.indexOf(governing) : -1;
    const se = i >= 1 && !q.words[i - 1].after && !!REFLEXIVE[q.words[i - 1].low];
    if (top.pos === 'noun' && has(isAdjective) && (LINKING.has(copula) || (se && LINKING_WITH_SE.has(copula)))
      && !(next && (readAs(next)?.pos === 'noun' || determiner(next)))) {
      return prefer(isAdjective, CONTEXT_MARGIN);
    }
  }

  // After muy or tan the adjective, never a verb or a noun: "Estoy muy alegre", "tan alegre como el sol"; and after un poco:
  // "un poco enfermo". After qué, más or menos the adjective rather than a verb, "¡qué alegre cabalgar!", "la más viva
  // compasión", but a noun stays one: "¡Qué facha!", "vale más oro que pesa", "Más rosas, más rosas" (Platero y yo). "¿Qué
  // pasa?" asks.
  if (prev && top && !predicate(top) && has(isAdjective)) {
    const grading = INTENSIFIERS.has(prev.low) && prev.low !== 'qué' && (prev.low !== 'poco' || q.words[q.at - 2]?.low === 'un');
    const beforeVerb = (prev.low === 'qué' && !q.question) || COMPARATIVES.has(prev.low);
    if (grading || (beforeVerb && isFiniteVerb(top))) return prefer(isAdjective, grading ? Infinity : CONTEXT_MARGIN);
  }

  // A participle that agrees with a noun is no compound tense. Before its noun, or alone between commas, it is the adjective
  // spelled alike: "querida Nela", "No te enfades, querida". As the object of a verb, the noun: "dar vista a los ciegos",
  // "tener vista". Anywhere else it stays the participle: "la familia sentada a la mesa", "Y puesta denodadamente en
  // ejecución", "fue vista".
  if (top && agreeingParticiple(top) && !COPULAS.has(copula)) {
    const beforeNoun = !!next && (next.name || readAs(next)?.pos === 'noun');
    if (has(isAdjective) && (beforeNoun || (!prev && w.after))) return prefer(isAdjective);
    // Only a noun nearly as likely: "le tenían puesta una red" keeps the participle (tener puesta, not puesta "clutch").
    if (has(ownNoun) && governing && governing === prev) return prefer(ownNoun, 1);
    return null;
  }

  // After a noun or a verb, a subjunctive alone is unlikely beside an adjective: "agarrado vivas muchas víboras", "me
  // enterraré viva". So after y joining it to a word that can be an adjective ("una sangre espesa y morada", "un joven y alegre
  // y sencillo matrimonio"; but "Dios le socorra y valga", Lazarillo, is valer), and in a list of adjectives ("vivienda
  // infanzona, grande, sólida, alegre, restaurada"). Not after que or mientras, which take the subjunctive ("te querré mientras
  // viva"), nor after hay, which takes a noun ("allá hay mates tan grandes").
  const joined = !!prev && ['y', 'e', 'o', 'u', 'ni'].includes(prev.low) && q.at >= 2 && !q.words[q.at - 2].after
    && q.words[q.at - 2].readings.some((r) => isAdjective(r) || isParticiple(r));
  const listed = !prev && q.at >= 1 && q.words[q.at - 1].after === ',' && q.words[q.at - 1].chosen?.pos === 'adjective';
  if (top && onlySubjunctive(top) && has(isAdjective) && ((prev && prev.chosen?.key !== 'haber'
    && (['noun', 'verb'].includes(prev.chosen?.pos ?? '') || joined)) || listed)) {
    return prefer(isAdjective);
  }
  // Joined by y to an adjective, a word that can be one is one where a noun was likelier: "una sangre espesa y morada",
  // "brumosa ya y morada" (not morada "abode"), "una cosa enorme y tibia" (not tibia "shinbone").
  if (top && isNoun(top) && has(isAdjective) && prev && ['y', 'e', 'o', 'u', 'ni'].includes(prev.low)
    && !(next && (readAs(next)?.pos === 'noun' || determiner(next)))) {
    const other = wordBefore(q, q.at - 1)?.chosen;
    if (other && (isAdjective(other) || agreeingParticiple(other))) return prefer(isAdjective, CONTEXT_MARGIN);
  }
  // After an adjective before its noun, the noun: "dentro de un gran mate" (a gourd, not "may kill").
  if (top && onlySubjunctive(top) && has(isNoun) && prev && prev.chosen?.pos === 'adjective' && determiner(q.words[q.at - 2])) {
    return prefer(isNoun);
  }

  // Before a noun, after a determiner, a preposition or y, the adjective: "Hablaron un largo rato" (not largo "length"),
  // "de una correa y grueso bastón", "Era un hombre de mediana edad" (not mediana "median"), "Siguió a estas palabras un largo
  // silencio" (silenciar's "I silence" is far behind the noun). So at the head of a clause or after an adverb: "permaneció
  // luego largo tiempo", "¡O mala cosa, peor que tienes!" (Lazarillo; not mala "suitcase"). Not a title, which is a noun
  // before the name or office it goes with: "el señor ingeniero", not señor "great big".
  const n0 = readAs(next);
  const head = !prev || ['adverb', 'conjunction', 'interjection'].includes(prev.chosen?.pos ?? '');
  if (prev && (determiner(prev) || PREPOSITIONS.has(prev.low) || ['y', 'e'].includes(prev.low)) && prev.low !== 'lo' && top
    && (determiner(prev) ? !isAdjective(top) : isNoun(top) || isFiniteVerb(top)) && has(isAdjective) && !TITLES.has(w.low)
    && n0 && n0.pos === 'noun' && !next!.name && !next!.readings.some((r) => isAdjective(r) || agreeingParticiple(r))) {
    return prefer(isAdjective, CONTEXT_MARGIN);
  }
  if (head && top && isNoun(top) && has(isAdjective)
    && !TITLES.has(w.low) && !w.name && !w.after && n0 && n0.pos === 'noun' && !next!.name
    && !next!.readings.some((r) => isAdjective(r) || agreeingParticiple(r))) {
    return prefer(isAdjective, CONTEXT_MARGIN);
  }
  // After an article, a possessive or a demonstrative with no noun after it, the noun of the determiner's gender: "los
  // flamencos fueron entonces", "leyendo en su cuarto" (a room, not "fourth"), "un cuarto de hora", "el médico anunció", "por
  // la pendiente abajo" (the slope, not el pendiente "earring"). Not an adjective joined to another by y ("un claro y sano
  // racimo"), nor one before a word the dictionary lacks or a likely noun or infinitive ("la chillona metalería", "nuestro
  // rápido caminar"); a function word's far reading as a noun does not count ("los flamencos se morían de envidia": se is not
  // sudeste's abbreviation).
  if (prev && determiner(prev) && prev.low !== 'lo' && has(isNoun) && has(isAdjective) && top) {
    const coordinated = !!next && ['y', 'e', 'o', 'ni'].includes(next.low) && q.words[q.at + 2]?.readings.some(isAdjective)
      && !q.words[q.at + 2].readings.some((r) => ['article', 'determiner', 'preposition', 'numeral'].includes(r.pos));
    // Nor a prefix-like one hyphened to its noun: "su ex-patrón míster Dougald" (Quiroga).
    if (isAdjective(top) && NOUN_DETERMINERS.has(prev.low) && !ORDINAL.test(w.low) && !coordinated && !w.name
      && !w.after.startsWith('-')
      && !(next && (next.name || !next.readings.length || next.readings.some((r) => (nounish(r) || isInfinitive(r))
        && r.score > next.readings[0].score - 3)))) {
      // Only a noun of the determiner's gender: "las habituales" (the usual ones) is not habitual "beans", a masculine noun.
      const g = FEMININE.has(prev.low) ? 'f' : MASCULINE.has(prev.low) ? 'm' : '';
      // A noun's form may say its gender for it: una vagabunda is vagabundo's feminine (genderOf).
      const agree = (r: ContextReading): boolean => isNoun(r)
        && (!g || !genderOf(r) || genderOf(r).includes(g) || genderOf(r) === 'pl');
      if (has(agree)) return prefer(agree, 3);
    }
  }

  // An adjective needs a noun: a plural one with none before or after it, after a verb that takes no predicate, is the noun
  // spelled alike: "Tiene medias coloradas" (stockings, not medio "half"), "No van a encontrar medias así".
  if (top && isAdjective(top) && /\bplural\b/.test(top.form) && prev && isVerb(prev.chosen) && !COPULAS.has(prev.chosen!.key)
    && !(next && readAs(next)?.pos === 'noun') && has(ownNoun)) {
    return prefer(ownNoun);
  }
  return null;
}
