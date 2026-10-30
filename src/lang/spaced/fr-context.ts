// French context rules (SpacedLang.context): the small words whose reading depends on their neighbors, and the words
// next to them. Each rule looks at grammar, what stands before and after, never at a list of sentences; it answers only
// where it is sure and leaves every other word to the shared engine's generic rules (lang/spaced/core.ts useContext).
//
// The examples are from the classics the readers met them in: Perrault's Contes (1697), Voltaire's Candide (1759),
// Flaubert's Madame Bovary (1857), Maupassant's La Parure (1884) and Le Horla (1887).
import { CONTEXT_MARGIN, isParticiple, type ContextChoice, type ContextQuery, type ContextReading, type ContextWord } from './context';

type Prefer = (r: ContextReading) => boolean;

const is = (pos: string): Prefer => (r) => r.pos === pos;

/** A decisive answer: the likeliest reading that fits, however unlikely alone; none when no reading fits. */
function decide(q: ContextQuery, prefer: Prefer): ContextChoice | null {
  return q.word.readings.some(prefer) ? { prefer, margin: Infinity } : null;
}

// ------------------------------------------------------------------------------------------------- readings ---

/**
 * A verb form with a person or an imperative (mourrait, donne), not an infinitive or participle. Any one of the cells a
 * form fills counts: garnis is "masculine plural past participle; first/second-person singular present indicative".
 */
const finite = (r: ContextReading): boolean => r.pos === 'verb' && !!r.form
  && r.form.split('; ').some((f) => /\b(?:first|second|third)-person\b|\bimperative\b/.test(f) && !/\bparticiple\b/.test(f));
/**
 * The infinitive: a French verb's headword, spelled as one (avoir, mourir, prendre). Wiktionary files a few other words
 * as verbs (dit "called", ayant "having", voilà), which are not.
 */
const infinitive = (r: ContextReading): boolean => r.pos === 'verb'
  && (/\binfinitive\b/.test(r.form) || (!r.form && /(?:er|ir|ïr|re|oir)$/.test(r.head)));
const presentParticiple = (r: ContextReading): boolean => r.pos === 'verb' && /\bpresent participle\b/.test(r.form);
const pastParticiple = (r: ContextReading): boolean => isParticiple(r) && !presentParticiple(r);
/** What a clitic pronoun comes before: a verb with a person, or an infinitive (pour en avoir, de les voir). */
const verbal = (r: ContextReading): boolean => finite(r) || infinitive(r);
const nounish = (r: ContextReading): boolean => ['noun', 'adjective', 'numeral', 'proper noun'].includes(r.pos);

/**
 * words[i] is a subject: a pronoun that is nothing else (il, on), elle, nous, vous or a name not after a preposition
 * ("avec elle"), qui not after one ("à qui le roi" has its subject after it), or ne, which a subject went before.
 */
function subject(q: ContextQuery, i: number): boolean {
  const w = q.words[i];
  if (!w) return false;
  if (SUBJECT_CLITIC.has(w.low) || w.low === 'ne' || w.low === "n'") return true;
  if (!SUBJECT_OR_STRONG.has(w.low) && w.low !== 'qui' && !w.name) return false;
  const before = q.words[i - 1];
  return !before || !!w.before || before.chosen?.pos !== 'preposition';
}

/** The best score among a word's readings that fit, -Infinity when none does. */
function best(w: ContextWord, fit: Prefer): number {
  let s = -Infinity;
  for (const r of w.readings) if (fit(r) && r.score > s) s = r.score;
  return s;
}

/** How far a verb reading must lead the others to call a word the verb by itself (core.ts ARTICLE_MARGIN). */
const VERB_MARGIN = 2;

/** The word is plainly a verb: it has no other reading, or its verb reading leads the others by VERB_MARGIN. */
function plainlyVerb(w: ContextWord): boolean {
  const verb = best(w, verbal);
  return verb > -Infinity && verb > best(w, (r) => !verbal(r)) + VERB_MARGIN;
}

// ---------------------------------------------------------------------------------------------- word classes ---

/**
 * Pronouns that only ever stand before a verb or another clitic: after them en is the pronoun (s'en trouva sept, n'en
 * mourra point, il en eut, j'en ferais). s' is never si here (si elides before il, ils only), nor l' the article.
 */
const ONLY_BEFORE_VERB = new Set(["n'", 'ne', "s'", 'se', "j'", "m'", 'me', "t'", 'te', "l'", "c'", 'y', 'il', 'ils', 'on', 'tu']);
/** Pronouns that are clitics before a verb but may stand alone too (avec elle en voiture): they need a verb after them. */
const CLITIC_OR_STRONG = new Set(['elle', 'elles', 'nous', 'vous', 'lui', 'leur', 'le', 'la', 'les', 'qui']);
/** Pronouns that stand alone, after which même is "-self, very": cela même, lui même. */
const STRONG_PRONOUN = new Set(['lui', 'elle', 'eux', 'elles', 'moi', 'toi', 'soi', 'nous', 'vous', 'cela', 'ceci', 'ça', 'celui',
  'celle']);
/** Object pronouns: a clitic after which a word that can be a verb is one. */
const OBJECT_CLITIC = new Set(['le', 'la', 'les', "l'", 'me', "m'", 'te', "t'", 'se', "s'", 'lui', 'leur', 'y', 'en', 'nous', 'vous']);

/** Adverbs that take de, so that des after them is de + les: autour des chapiteaux, auprès des portes, près des fenêtres. */
const DE_ADVERB = new Set(['près', 'auprès', 'autour', 'loin', 'lors', 'hors', 'dehors', 'au-dessus', 'au-dessous', 'dessus',
  'dessous', 'au-delà', 'alentour', 'beaucoup', 'peu', 'trop', 'assez', 'tant', 'autant', 'combien', 'plus', 'moins']);
/** Pronouns that take de of a whole: un des valseurs, l'une des fenêtres, celle des sillons, chacun des, aucun des. */
const DE_PRONOUN = new Set(['un', 'une', "l'un", "l'une", 'celui', 'celle', 'ceux', 'celles', 'chacun', 'chacune', 'aucun',
  'aucune', 'plusieurs', 'quelques-uns', 'quelques-unes', 'certains', 'certaines', 'uns', 'unes', 'rien', "quelqu'un",
  'lequel', 'laquelle', 'lesquels', 'lesquelles', 'nul', 'nulle']);
/**
 * Verbs whose complement is "from" or "of" something (de + les): "le couteau lui tomba des mains" (Perrault), "on se moque
 * des prêtres", "les oreilles s'écartaient des têtes" (Bovary). The pronominal ones only with se before them.
 */
const DE_VERB = new Set(['sortir', 'ressortir', 'descendre', 'tomber', 'revenir', 'partir', 'sauter', 'échapper', 'jaillir',
  'arracher', 'parler', 'causer', 'discuter', 'rire', 'jouir', 'dépendre', 'profiter', 'grincer']);
const DE_PRONOMINAL = new Set(['approcher', 'rapprocher', 'éloigner', 'écarter', 'séparer', 'moquer', 'souvenir', 'occuper',
  'servir', 'méfier', 'emparer', 'détacher', 'plaindre', 'passer', 'contenter', 'charger', 'réjouir', 'défaire', 'débarrasser',
  'détourner', 'retirer', 'échapper', 'apercevoir', 'douter', 'inquiéter', 'soucier', 'garder', 'dégager', 'entretenir']);

/**
 * Adjectives that are determiners in all but name (chaque, plusieurs, quelque): si chaque jour is "if", not "so"; tout
 * autre chose.
 */
const DETERMINER_LIKE = new Set(['chaque', 'plusieurs', 'quelque', 'quelques', 'tel', 'telle', 'tels', 'telles', 'aucun',
  'aucune', 'nul', 'nulle', 'autre', 'autres', 'même', 'mêmes', 'certain', 'certaine', 'certains', 'certaines', 'tout',
  'toute', 'tous', 'toutes', 'quel', 'quelle', 'quels', 'quelles']);
/** Degree and manner adverbs si makes "so" of: si bien qu'on l'apercevait à peine, si fort que, si longtemps. */
const SO_ADVERB = new Set(['bien', 'mal', 'peu', 'fort', 'vite', 'loin', 'près', 'haut', 'bas', 'longtemps', 'souvent', 'tard',
  'tôt', 'volontiers', 'aisément', 'doucement']);
/** -ment adverbs that open a clause, which si stays "if" before: si seulement, si vraiment. */
const SENTENCE_ADVERB = new Set(['seulement', 'vraiment', 'réellement', 'absolument', 'simplement', 'certainement',
  'probablement', 'évidemment', 'heureusement', 'malheureusement', 'justement', 'également', 'notamment', 'autrement',
  'précisément', 'sérieusement', 'franchement', 'décidément', 'apparemment']);
/** Adverbs of degree an adjective follows: fort vive, très recherché, si fâchés, trop mince. */
const INTENSIFIER = new Set(['très', 'fort', 'si', 'trop', 'assez', 'aussi', 'moins', 'plus', 'tellement', 'bien']);
/**
 * Verbs that take a bare infinitive: after them le, la, les before an infinitive are the pronoun ("je veux l'aller voir
 * aussi", "et alla les porter dans un verre d'eau", Perrault).
 */
const BARE_INFINITIVE = new Set(['falloir', 'vouloir', 'pouvoir', 'devoir', 'aller', 'venir', 'savoir', 'oser', 'sembler',
  'paraître', 'croire', 'penser', 'espérer', 'compter', 'daigner', 'désirer', 'souhaiter', 'préférer', 'courir']);
/** Copulas, after which fort is the adjective "strong" (il était fort), not the adverb "hard" (il frappa fort). */
const COPULA = new Set(['être', 'devenir', 'sembler', 'paraître', 'rester', 'demeurer', 'redevenir']);
/** Words that put a duration after voilà or voici, which is then "ago" (voilà trois ans "three years ago"). */
const DURATION = new Set(['lendemain', 'an', 'ans', 'année', 'années', 'mois', 'jour', 'jours', 'semaine', 'semaines', 'heure',
  'heures', 'minute', 'minutes', 'siècle', 'siècles', 'temps', 'longtemps', 'instant', 'instants', 'moment', 'moments', 'nuit',
  'nuits', 'soir', 'soirs', 'matin', 'matins']);
/** Prepositions tout makes "right, all" of: tout à fait, tout près, tout autour, tout au fond, tout en riant. */
const TOUT_PREPOSITION = new Set(['à', 'en', 'contre', 'près', 'auprès', 'autour', 'au', 'aux', 'sur', 'dans']);
/** Clitics before a verb, after which tout is the subject "everything" (tout se passa, tout n'est que …). */
const TOUT_CLITIC = new Set(['se', "s'", 'me', "m'", 'te', "t'", 'lui', 'y', 'nous', 'vous', 'ne', "n'"]);
/** Adverbs that open or link a clause, which tout does not modify: "de la musique, des arts, de tout enfin" (Bovary). */
const CLAUSE_ADVERB = new Set(['enfin', 'alors', 'ensuite', 'encore', 'aussi', 'donc', 'pourtant', 'cependant', 'maintenant',
  'déjà', 'toujours', 'jamais', 'ainsi', 'puis', 'même', 'seulement', 'surtout', 'partout', 'ailleurs', 'ici', 'là', 'bien',
  'pas', 'point', 'plus', 'non', 'oui', "aujourd'hui", 'demain', 'hier', 'souvent', 'parfois', 'quelquefois', 'peut-être']);
/** Words that make a conjunction with que (parce que, avant que, si bien que): que after them is never ne … que. */
const QUE_LOCUTION = new Set(['parce', 'avant', 'après', 'pour', 'sans', 'bien', 'afin', 'depuis', 'pendant', 'tandis', 'lors',
  'dès', 'alors', 'encore', 'plutôt', 'aussitôt', 'sitôt', 'tant', 'tel', 'telle', 'tels', 'telles', 'même', 'autant',
  'ainsi', 'sorte', 'moins', 'mesure', 'pourvu', 'peur', 'crainte', 'façon', 'manière', 'ce', 'est-ce', "jusqu'à", 'outre',
  'malgré', 'selon', 'vu', 'attendu', 'maintenant', 'point']);
/** Negation words that make ne … que something else: ne … pas que "not only", n'a rien que. plus, jamais, guère stay. */
const NOT_RESTRICTIVE = new Set(['pas', 'point', 'rien', 'personne', 'aucun', 'aucune', 'nul', 'nulle', 'nullement', 'ni']);
/** Comparatives whose que is "than" or "as" even after ne: "Jamais madame Bovary ne fut aussi belle qu'à cette époque". */
const COMPARATIVE = new Set(['aussi', 'autant', 'tant', 'moins', 'mieux', 'meilleur', 'meilleure', 'pire', 'davantage', 'tel',
  'telle', 'même', 'autrement', 'plutôt']);
/** Comparatives a later que completes as "than": "rien de plus beau que cette cour" (Perrault), "autre chose que". */
const THAN = new Set(['plus', 'moins', 'mieux', 'meilleur', 'meilleure', 'meilleurs', 'meilleures', 'pire', 'pires', 'davantage',
  'autre', 'autres', 'autrement', 'plutôt']);
/** Comparatives a later que completes as "as": "Jamais madame Bovary ne fut aussi belle qu'à cette époque". */
const AS = new Set(['aussi', 'autant']);
/** Determiners that make a superlative of plus, whose que is then the relative: "le plus beau que j'aie vu". */
const SUPERLATIVE = new Set(['le', 'la', 'les', "l'", 'du', 'des', 'au', 'aux', 'mon', 'ma', 'mes', 'ton', 'ta', 'tes', 'son', 'sa',
  'ses', 'notre', 'nos', 'votre', 'vos', 'leur', 'leurs']);
/** Nouns of time that même after them makes "very": "dès le soir même" (Perrault), "le jour même", "à l'instant même". */
const TIME_NOUNS = new Set(['jour', 'soir', 'nuit', 'matin', 'instant', 'moment', 'heure', 'année', 'an', 'semaine', 'mois',
  'lendemain', 'veille', 'temps', 'minute', 'seconde', 'époque', 'siècle']);
/** Words that start a clause of their own between ne and que. */
const CLAUSE_START = new Set(['que', "qu'", 'qui', 'quand', 'si', "s'", 'comme', 'lorsque', "lorsqu'", 'puisque', "puisqu'",
  'et', 'ou', 'mais', 'car', 'dont', 'où', 'quoique', "quoiqu'"]);
/** The words that complete ne: after ne, a word that is one of them stays the negation (ne point is not poindre's). */
const NEGATION = new Set(['pas', 'point', 'plus', 'jamais', 'rien', 'guère', 'personne', 'aucun', 'aucune', 'nul', 'nulle',
  'nullement', 'que', "qu'", 'ni']);
/**
 * Relative pronouns the subject of their clause comes right after, never an object pronoun: le, la, les after them are
 * the article ("au milieu du mur dont la peinture verte s'écaillait", Bovary).
 */
const RELATIVE_BEFORE_SUBJECT = new Set(['dont', 'lequel', 'laquelle', 'lesquels', 'lesquelles', 'duquel', 'desquels',
  'desquelles', 'auquel', 'auxquels', 'auxquelles']);
/** Subject pronouns that are never anything else: after one comes the verb or its clitics (il entre, on le fait). */
const SUBJECT_CLITIC = new Set(['il', 'ils', 'on', 'je', "j'", 'tu']);
/** Subject pronouns that also stand alone (avec elle): a subject unless a preposition comes before it. */
const SUBJECT_OR_STRONG = new Set(['elle', 'elles', 'nous', 'vous']);
/**
 * Verbs that take some of a thing, after which du is the partitive "some": "lui demander du bonbon" (Perrault), "nous
 * mangeons du porc" (Candide), "en offrant du sucre" (Bovary), "il y a du sang sur cette clef".
 */
const PARTITIVE_VERB = new Set(['avoir', 'faire', 'manger', 'boire', 'prendre', 'acheter', 'demander', 'donner', 'verser',
  'mettre', 'apporter', 'offrir', 'servir', 'vendre', 'chercher', 'vouloir', 'porter', 'trouver', 'falloir', 'jeter',
  'répandre', 'gagner', 'perdre', 'cracher', 'avaler', 'goûter', 'éprouver', 'sentir']);
/** The adjectives that go before their noun (a name too): le pauvre Charles, la petite Berthe, le vieux Rouault. */
const PRENOMINAL = new Set(['pauvre', 'pauvres', 'petit', 'petite', 'petits', 'petites', 'grand', 'grande', 'grands', 'grandes',
  'jeune', 'jeunes', 'vieux', 'vieil', 'vieille', 'vieilles', 'bon', 'bonne', 'bons', 'bonnes', 'beau', 'bel', 'belle', 'beaux',
  'belles', 'gros', 'grosse', 'cher', 'chère', 'chers', 'chères', 'brave', 'braves', 'joli', 'jolie', 'gentil', 'gentille',
  'digne', 'excellent', 'excellente', 'malheureux', 'malheureuse', 'défunt', 'défunte', 'feu', 'saint', 'sainte']);
/** Verbs of going, which s'en makes "go away, go back": s'en aller, s'en retourner, s'en revenir. */
const GOING = new Set(['aller', 'retourner', 'revenir', 'venir', 'repartir', 'partir', 'fuir', 'courir']);
/** Adverbs of place that are prepositions before a noun: "il sortit de dessous la table", "en dehors". */
const PLACE_ADVERB = new Set(['dessous', 'dessus', 'dedans', 'dehors']);

// ------------------------------------------------------------------------------------------------ the rules ---

/**
 * en the pronoun "of it" against en the preposition "in". After a clitic it is the pronoun: "votre fille n'en mourra
 * point", "il s'en trouva sept"; before a plain verb too: "toute la maison en trembla", "qu'elle en mourrait"; and before
 * an infinitive: "ils ne purent en venir à bout". Before a gerund it is the preposition ("en revenant"), and so before a
 * noun ("se mit en route"): a verb with a person after a verb with a person is not French.
 */
function en(q: ContextQuery): ContextChoice | null {
  const { prev, next } = q;
  if (prev && ONLY_BEFORE_VERB.has(prev.low)) return decide(q, is('pronoun'));
  if (!next || !next.readings.length || next.readings.some(presentParticiple)) return null;
  // "En voilà des ajustements !"
  if (['voilà', 'voici'].includes(next.low)) return decide(q, is('pronoun'));
  if (best(next, verbal) === -Infinity) return null;
  if (prev && CLITIC_OR_STRONG.has(prev.low)) return decide(q, is('pronoun'));
  // After a verb, en + a noun ("se mit en route", "la tenir en joue"), but en + an infinitive ("croit en manquer", "je
  // pouvais en avoir besoin") and, after a participle ending a clause, en + a verb ("l'ouvrier qui l'a fondue en est mort").
  if (prev?.chosen?.pos === 'verb') {
    if (next.readings[0] && infinitive(next.readings[0])) return decide(q, is('pronoun'));
    return pastParticiple(prev.chosen) && plainlyVerb(next) && finite(next.readings[0]) ? decide(q, is('pronoun')) : null;
  }
  if (plainlyVerb(next)) return decide(q, is('pronoun'));
  // A preposition before it: "sans en avoir", "d'en être", "pour en savoir".
  if (prev?.chosen?.pos === 'preposition' && next.readings.some(infinitive)) return decide(q, is('pronoun'));
  return null;
}

/**
 * des the contraction de + les "of the" against des the plural article "some". After a noun, an adjective, a number, one
 * of a whole (un des valseurs) or an adverb that takes de (autour des chapiteaux), and after a verb whose complement takes
 * de (tomba des mains, se moque des prêtres): of the. Anywhere else, at a sentence start, after a preposition or a verb:
 * some ("Des taches de graisse", "avec des éclats de voix", "on fit acheter des mouches"). After et, ou, ni and a comma, as
 * the des of the same list read: "l'odeur des viandes et des truffes", "des pierrots dans des voitures et des danseuses".
 */
function des(q: ContextQuery): ContextChoice | null {
  const contraction = is('contraction');
  const article: Prefer = (r) => r.pos === 'article' && r.key === 'des';
  const { prev } = q;
  const listed = prev ? ['et', 'ou', 'ni'].includes(prev.low) : q.at > 0 && q.word.before === ',';
  if (listed) {
    for (let i = q.at - 1; i >= 0; i--) {
      const c = q.words[i].chosen;
      if (q.words[i].low === 'des' && c) return decide(q, c.pos === 'contraction' ? contraction : article);
    }
    return decide(q, article);
  }
  if (!prev || prev.name) return decide(q, article);
  const c = prev.chosen;
  if (!c) return null;
  if (['noun', 'adjective', 'numeral', 'proper noun'].includes(c.pos) || DE_PRONOUN.has(prev.low) || DE_ADVERB.has(prev.low)
    || compoundPreposition(q)) return decide(q, contraction);
  if (c.pos === 'verb') {
    const se = q.at >= 2 && ['se', "s'"].includes(q.words[q.at - 2].low);
    if (DE_VERB.has(c.key) || (se && DE_PRONOMINAL.has(c.key))) return decide(q, contraction);
    // A participle in a tense of avoir has an object ("sa mère ayant cuit et fait des galettes"); one after être or a
    // noun is an adjective or a passive, of the (entourés des, suivie des).
    if (pastParticiple(c)) {
      const avoir = q.words.slice(Math.max(0, q.at - 5), q.at - 1).some((w) => w.chosen?.key === 'avoir');
      return decide(q, avoir ? article : contraction);
    }
  }
  return decide(q, article);
}

/** A preposition that ends in de: au-delà, au devant, en dehors, par-dessus ("au devant du carrosse", Perrault). */
function compoundPreposition(q: ContextQuery): boolean {
  const prev = q.prev;
  return !!prev && prev.chosen?.pos === 'preposition'
    && (prev.low.includes('-') || (q.at >= 2 && ['au', 'en', 'par'].includes(q.words[q.at - 2].low)));
}

/**
 * du is "some" after a preposition that cannot take de ("avec du sablon et avec du grès", Perrault; "dans du lait"), and
 * after a verb that takes some of a thing, not with se ("lui demander du bonbon", "nous mangeons du porc", Candide; "Pourquoi
 * y a-t-il du sang sur cette clef ?"); everywhere else it stays de + le, which it is most often, at a sentence start too
 * ("Du reste", "Du temps de madame Dubuc") and after verbs of motion or speech (sortit du bois, parlait du temps).
 */
function du(q: ContextQuery): ContextChoice | null {
  const prev = q.prev;
  const article = (r: ContextReading): boolean => r.pos === 'article' && r.key === 'du';
  const c = prev?.chosen;
  if (prev && c && (finite(c) || infinitive(c) || presentParticiple(c)) && PARTITIVE_VERB.has(c.key)) {
    // Not with se, nor in a noun made with à and the verb: "dans la salle à manger du château" (Lettres de mon moulin); but
    // "son estafier qui lui servait à boire du vin de Porto" (Candide).
    const before = q.words[q.at - 2]?.low ?? '';
    const compound = before === 'à' && q.words[q.at - 3]?.chosen?.pos === 'noun';
    return ['se', "s'"].includes(before) || compound ? null : decide(q, article);
  }
  if (!prev || c?.pos !== 'preposition' || compoundPreposition(q) || DE_ADVERB.has(prev.low)) return null;
  return decide(q, article);
}

/**
 * The comparison a que completes, a few words back in its clause: "than" after plus, moins, mieux, autre ("il ne se peut
 * rien de plus beau que cette cour", Perrault), "as" after aussi, autant ("Jamais madame Bovary ne fut aussi belle qu'à cette
 * époque"); '' when there is none. Not a superlative ("le plus beau que j'aie vu", the relative), nor plus after ne, which
 * makes que "only": "il n'y avait plus que".
 */
function comparison(q: ContextQuery): string {
  // que after et, ou, mais starts a clause of its own: "elle prétendit qu'elle allait mieux et qu'elle se lèverait" (Bovary).
  if (q.at >= 1 && ['et', 'ou', 'mais', 'ni'].includes(q.words[q.at - 1].low)) return '';
  let noun = false;
  for (let i = q.at - 1, n = 0; i >= 0 && n < 6; i--, n++) {
    const w = q.words[i];
    // A verb between them takes the que as its own: "d'autres à demi brûlées criaient qu'on achevât" (Candide).
    if (/[,;:()«»—–]/.test(w.after) || (i < q.at - 1 && (CLAUSE_START.has(w.low) || (!!w.chosen && finite(w.chosen))))) return '';
    if (!THAN.has(w.low) && !AS.has(w.low)) {
      noun ||= w.chosen?.pos === 'noun';
      continue;
    }
    // aussi right before que is "also": "Il faut dire aussi que la bête en valait la peine" (Lettres de mon moulin).
    if (w.low === 'aussi' && i === q.at - 1) return '';
    // Past a noun, a clause after que is about the noun, the relative's: "non moins surprise des paroles que proférait cet
    // homme" (Candide), "un autre papier qu'elle ne connaissait pas" (Bovary).
    // ("un aussi étrange animal que l'homme a été formé", Candide, compares: aussi and autant take a clause after their que.)
    if (noun && !AS.has(w.low) && clauseAfter(q)) return '';
    if (/^autres?$/.test(w.low) && q.at - i > 2) continue;
    // plus de, moins de say "than" with their de: "il y avait plus de cinquante ans qu'elle n'était sortie" (Perrault) is
    // "since".
    const a = q.words[i + 1];
    if (a && !w.after && ['de', "d'"].includes(a.low)) return '';
    const b = q.words[i - 1];
    if (b && !b.after && SUPERLATIVE.has(b.low)) return '';
    if (w.low === 'plus' && q.words.slice(Math.max(0, i - 4), i).some((x) => x.low === 'ne' || x.low === "n'")) return '';
    return AS.has(w.low) ? 'as' : 'than';
  }
  return '';
}

/**
 * que opens a clause: a finite verb comes right after it or after its subject (a pronoun, or a determiner and a noun) and the
 * pronouns before the verb: "que proférait cet homme", "qu'elle ne connaissait pas", "que l'adultère avivait".
 */
function clauseAfter(q: ContextQuery): boolean {
  let i = q.at + 1;
  const at = (j: number): ContextWord | undefined => (j < q.words.length && !q.words[j - 1].after ? q.words[j] : undefined);
  const subject = at(i);
  if (!subject) return false;
  if (SUBJECT_CLITIC.has(subject.low) || SUBJECT_OR_STRONG.has(subject.low) || ['ce', "c'"].includes(subject.low)) i++;
  else if (subject.readings[0] && ['article', 'determiner'].includes(subject.readings[0].pos) && at(i + 1)?.readings[0]?.pos === 'noun') i += 2;
  while (at(i) && (OBJECT_CLITIC.has(at(i)!.low) || ['ne', "n'"].includes(at(i)!.low))) i++;
  const verb = at(i);
  return !!verb && !!verb.readings[0] && finite(verb.readings[0]);
}

/**
 * ne … que is "only": "parce que l'on n'en avait fait faire que sept" (Perrault), "Et elle n'aimait que cela" (La Parure).
 * A ne before it in its clause, with no pas, point, rien between and no comparative (aussi belle qu'à cette époque), que
 * not part of a conjunction (avant que) nor opening a clause of its own (supposer qu'il …), and the ne not one that a rien
 * or personne before it already completes (rien n'affirmait qu'…). After ne savoir, que is "what": "Le prince ne savait
 * qu'en croire".
 */
function que(q: ContextQuery): ContextChoice | null {
  // Opening a question before an inverted verb, que is "what": "« Que faites-vous là, ma bonne femme ? »" (Perrault), "Que
  // vois-je là ?", "Que me voulez-vous ?".
  if (q.sentenceStart && q.next) {
    const verb = OBJECT_CLITIC.has(q.next.low) ? q.words[q.at + 2] : q.next;
    if (verb && /[-‐]/.test(verb.text) && !!verb.readings[0] && finite(verb.readings[0])) return decide(q, is('pronoun'));
  }
  const compared = comparison(q);
  if (compared && q.word.readings.some(is('conjunction'))) return { prefer: is('conjunction'), margin: Infinity, hint: compared };
  const only = is('adverb');
  if (!q.word.readings.some(only)) return null;
  if (q.prev && QUE_LOCUTION.has(q.prev.low)) return null;
  if (q.next && ['il', 'ils', 'on', 'je', "j'", 'tu'].includes(q.next.low)) return null;
  for (let i = q.at - 1, n = 0; i >= 0 && n < 10; i--, n++) {
    const w = q.words[i];
    // A mark between ne and que closes the clause: "Il ne dit rien, que je sache".
    if (/[,;:()«»—–]/.test(w.after)) return null;
    if (w.low === 'ne' || w.low === "n'") {
      if (i > 0 && NOT_RESTRICTIVE.has(q.words[i - 1].low)) return null;
      const verb = q.words.slice(i + 1, q.at).find((x) => x.chosen?.pos === 'verb');
      return verb?.chosen?.key === 'savoir' ? null : decide(q, only);
    }
    if (NOT_RESTRICTIVE.has(w.low) || CLAUSE_START.has(w.low) || COMPARATIVE.has(w.low)) return null;
  }
  return null;
}

/**
 * si is "so" before an adjective, a past participle or an adverb of degree ("qui étaient si fâchés de n'avoir point
 * d'enfants", "si bien qu'on l'apercevait à peine"), "yes" standing alone against a no ("Mais si !"), and "if" anywhere
 * else.
 */
function si(q: ContextQuery): ContextChoice | null {
  const { next } = q;
  if (!next) {
    // Not "— Si…, reprit Léon, n'osant poursuivre" (Bovary): an if left hanging. But "— Si, dit-elle. Continuez.": a yes
    // the speaker's verb follows, inverted.
    const said = q.words[q.at + 1];
    const yes = /^!/.test(q.word.after) || (q.prev?.low === 'mais' && /^[,!.]/.test(q.word.after))
      || (q.word.after === ',' && !!said && /[-‐]/.test(said.text) && !!said.readings[0] && finite(said.readings[0]));
    if (yes) return decide(q, is('interjection'));
    return null;
  }
  const top = next.readings[0];
  if (!top || next.name || ['pronoun', 'determiner', 'article', 'proper noun', 'numeral', 'preposition', 'conjunction'].includes(top.pos)) {
    return null;
  }
  const near = next.readings.filter((r) => r.score > top.score - 3);
  const so = near.some((r) => (r.pos === 'adjective' && !DETERMINER_LIKE.has(next.low)) || pastParticiple(r)
    || (r.pos === 'adverb' && (SO_ADVERB.has(next.low) || (/ment$/.test(next.low) && !SENTENCE_ADVERB.has(next.low)))));
  return so ? decide(q, is('adverb')) : null;
}

/**
 * leur the pronoun "to them" before a verb ("Enfin, pourtant il leur naquit une fille", Perrault; "pour leur dire"),
 * the determiner "their" before a noun. A word that can be either (leur porte) is the verb after a subject or a clitic.
 */
function leur(q: ContextQuery): ContextChoice | null {
  const { prev, next } = q;
  // Before a present participle too: "la bûcheronne leur ayant donné à chacun un morceau de pain" (Perrault).
  if (next?.readings[0] && presentParticiple(next.readings[0])) return decide(q, is('pronoun'));
  if (!next || best(next, verbal) === -Infinity) return null;
  if ((prev && (ONLY_BEFORE_VERB.has(prev.low) || CLITIC_OR_STRONG.has(prev.low))) || plainlyVerb(next)) {
    return decide(q, is('pronoun'));
  }
  // After a preposition, before an infinitive: "pour leur dire", "de leur donner".
  if (prev?.chosen?.pos === 'preposition' && next.readings[0] && infinitive(next.readings[0])) return decide(q, is('pronoun'));
  return null;
}

/**
 * même the adjective "same" after a determiner (la même chose) or before a noun (en même temps), "very, itself" after a
 * noun or a pronoun (le soir même, cela même); anywhere else the adverb "even": "n'osant même croiser les cuisses"
 * (Bovary), "et même", "même les". After a noun that the verb follows, the subject is what même stresses, "even": "Son
 * patron même l'engageait à visiter une […]" (Bovary), "Sa grande salle même était ornée d'une tapisserie" (Candide).
 */
function meme(q: ContextQuery): ContextChoice | null {
  const { prev, next } = q;
  const c = prev?.chosen;
  const adjective = is('adjective');
  // After a noun of time, "very": "dès le soir même" (Perrault), "le jour même".
  if (prev && c?.pos === 'noun' && TIME_NOUNS.has(c.key) && q.word.readings.some(adjective)) return { prefer: adjective, margin: Infinity, hint: 'very' };
  const nominal = !!c && (['noun', 'proper noun'].includes(c.pos) || prev!.name || STRONG_PRONOUN.has(prev!.low));
  if (nominal && next && !next.name && (OBJECT_CLITIC.has(next.low) || SUBJECT_CLITIC.has(next.low)
    || SUBJECT_OR_STRONG.has(next.low) || plainlyVerb(next))) return decide(q, is('adverb'));
  if (c && (['article', 'determiner', 'numeral', 'contraction', 'noun', 'proper noun'].includes(c.pos) || prev!.name)) {
    return decide(q, adjective);
  }
  if (prev && STRONG_PRONOUN.has(prev.low)) return decide(q, adjective);
  // Before a noun after a preposition or at the start: "en même temps", "de même nature"; not "il avait même peur".
  if (next && !next.name && next.readings[0]?.pos === 'noun' && (!prev || c?.pos === 'preposition')) return decide(q, adjective);
  return decide(q, is('adverb'));
}

/**
 * fort the adverb "very" before an adjective, an adverb or a participle ("comme elle était fort vive", Perrault; "l'air
 * raisonnable et fort embarrassé", Bovary; "une jeune fille fort mal vêtue"), and "hard, loudly" after a verb that is not
 * a copula, straight or through si, trop, bien (il frappa fort, "on heurta si fort à la porte", "Elle crie trop fort").
 * Before a noun it is the adjective (un fort parfum), but "un fort honnête homme" is very honest.
 */
function fort(q: ContextQuery): ContextChoice | null {
  const { prev, next } = q;
  const adverb = is('adverb');
  const c = prev?.chosen;
  if (next && !next.name && !DETERMINER_LIKE.has(next.low)) {
    const top = next.readings[0];
    const near = next.readings.filter((r) => top && r.score > top.score - 3);
    // A noun first is a noun, unless it is as much an adjective or an adverb (fort bête, fort mal).
    if (top && !['pronoun', 'determiner', 'article', 'preposition', 'conjunction'].includes(top.pos)
      && (top.pos !== 'noun' || SO_ADVERB.has(next.low) || near.some(is('adjective')))
      && near.some((r) => r.pos === 'adjective' || r.pos === 'adverb' || pastParticiple(r))) return decide(q, adverb);
  }
  const nounNext = !!next && !!next.readings[0] && nounish(next.readings[0]);
  if (c && finite(c) && !COPULA.has(c.key) && !nounNext) return decide(q, adverb);
  // Through a degree adverb: the verb before it.
  const verb = q.at >= 2 ? q.words[q.at - 2].chosen : undefined;
  if (c?.pos === 'adverb' && prev && INTENSIFIER.has(prev.low) && !/\S/.test(q.words[q.at - 2].after) && verb && finite(verb)
    && !COPULA.has(verb.key) && !nounNext) return decide(q, adverb);
  return null;
}

/**
 * tout, toute: the adverb "quite, all" before an adjective, a participle, an adverb or a preposition (tout étonné, toute
 * seule, tout autour de la chambre, tout en riant); the pronoun "everything" before a verb, a clitic or a mark (tout est
 * prêt, c'est tout) and before ce qui, ce que; the determiner "all" before a determiner or a noun, left to the engine.
 * After avoir, before its participle, it is the object: "il avait tout vu".
 */
function tout(q: ContextQuery): ContextChoice | null {
  const { prev, next } = q;
  if (prev?.chosen && ['article', 'determiner', 'contraction'].includes(prev.chosen.pos)) return null;
  if (!next) return q.word.low === 'tout' && q.word.after && !/^[-–—]/.test(q.word.after) ? decide(q, is('pronoun')) : null;
  const top = next.readings[0];
  if (!top || next.name) return null;
  const third = q.words[q.at + 2];
  if (q.word.low === 'tout' && next.low === 'ce' && third && ['qui', 'que', "qu'", 'dont'].includes(third.low)) return decide(q, is('pronoun'));
  const afterAvoir = prev?.chosen?.key === 'avoir';
  if (pastParticiple(top) && afterAvoir) return q.word.low === 'tout' ? decide(q, is('pronoun')) : null;
  if (DETERMINER_LIKE.has(next.low) || CLAUSE_ADVERB.has(next.low)) return null;
  // toute is the adverb only before a feminine word (toute seule, toute dorée), not before a masculine participle that a
  // feminine noun is spelled like: "à toute félicité".
  if (q.word.low === 'toute' && /\bmasculine\b|^past participle$/.test(top.form)) return null;
  const place = ['preposition', 'contraction'].includes(top.pos) && TOUT_PREPOSITION.has(next.low);
  if (top.pos === 'adjective' || top.pos === 'adverb' || pastParticiple(top) || presentParticiple(top) || place) return decide(q, is('adverb'));
  if (q.word.low !== 'tout') return null;
  // Not before le, la, les, leur, which are determiners there (tout le monde, tout le reste, tout leur possible); but "tout
  // leur semblait sérieux" has leur the pronoun before a verb.
  if (next.low === 'leur' && third && !/\S/.test(next.after) && plainlyVerb(third)) return decide(q, is('pronoun'));
  return finite(top) || TOUT_CLITIC.has(next.low) ? decide(q, is('pronoun')) : null;
  return null;
}

/**
 * voilà, voici the presentative "there is, here is" ("Voilà ce que c'est", "me voici"), "ago" only before a duration
 * (voilà trois ans).
 */
function voila(q: ContextQuery): ContextChoice | null {
  const words = q.words.slice(q.at + 1, q.at + 3);
  const n = q.next;
  const duration = words.some((w) => DURATION.has(w.low)) && !!n
    && (n.readings[0]?.pos === 'numeral' || ['longtemps', 'quelques', 'plusieurs', 'des', 'un', 'une'].includes(n.low));
  return decide(q, is(duration ? 'preposition' : 'verb'));
}

/**
 * ce the pronoun "it, that" before a verb, a clitic or a relative pronoun ("ce fut", "ce n'est", "ce qui", "ce que"), the
 * determiner "this" before a noun.
 */
function ce(q: ContextQuery): ContextChoice | null {
  const { next } = q;
  if (!next) return decide(q, is('pronoun'));
  const relative = ['qui', 'que', "qu'", 'dont', 'ne', "n'", 'à', 'sur', 'pour', 'dans'].includes(next.low);
  return relative || OBJECT_CLITIC.has(next.low) || plainlyVerb(next) ? decide(q, is('pronoun')) : null;
}

/** personne the noun "person" after a determiner or an adjective ("une jeune personne", "en personne"). */
function personne(q: ContextQuery): ContextChoice | null {
  const c = q.prev?.chosen;
  const determined = !!c && (['article', 'determiner', 'contraction', 'adjective', 'numeral'].includes(c.pos) || q.prev!.low === 'en');
  return determined ? decide(q, is('noun')) : null;
}

/**
 * moyen the noun "means" ("par ce moyen", "il n'y eut pas moyen de", "aucun moyen d'être connue"), the adjective
 * "middle, average" only after a noun or before one (la taille moyenne, le moyen âge).
 */
function moyen(q: ContextQuery): ContextChoice | null {
  const { prev, next } = q;
  if (prev?.chosen?.pos === 'noun' || (next && next.readings[0]?.pos === 'noun')) return null;
  return decide(q, is('noun'));
}

/** ensemble the adverb "together" ("ils se trouvaient ensemble"), the noun "whole, set" after a determiner (l'ensemble). */
function ensemble(q: ContextQuery): ContextChoice | null {
  const c = q.prev?.chosen;
  // Not after tous: "dirent-ils tous ensemble".
  const p = q.prev?.low ?? '';
  const determined = !!c && !['tous', 'toutes'].includes(p) && (['article', 'determiner', 'contraction'].includes(c.pos) || p === "d'");
  return decide(q, is(determined ? 'noun' : 'adverb'));
}

/**
 * le, les after de or à are the pronoun: those never contract as the article does (du, des, au, aux), so "de les voir".
 * After a verb that takes an infinitive, le, la, les before one are too: "je veux l'aller voir aussi" (Perrault).
 */
function lePronoun(q: ContextQuery): ContextChoice | null {
  const { prev, next } = q;
  if (!next) return null;
  const pronoun = is('pronoun');
  // "Les voilà aussitôt à parcourir les chambres" (Perrault): there they are.
  if (['voilà', 'voici'].includes(next.low)) return decide(q, pronoun);
  // After dont, lequel … comes the subject of the clause, which no object pronoun goes before: "au milieu du mur dont la
  // peinture verte s'écaillait" (Bovary) is the paint, not "her" and peinturer's "paints".
  if (prev && RELATIVE_BEFORE_SUBJECT.has(prev.low)) return decide(q, is('article'));
  const verbNext = next.readings.some(verbal);
  // Before a word that can only be a verb: "comme si le sacrement l'eût guérie" (Bovary). The shared engine leaves a
  // subjunctive to a pronoun before it, and there is none here.
  if (next.readings.length && next.readings.every((r) => verbal(r) && !isParticiple(r))) return decide(q, pronoun);
  // After a subject or ne, before a verb, an object: "On le fait tourner à droite" (Candide), "ce qui le séduisait", "ne
  // le dis pas". fait is "past participle; third-person singular present indicative", a verb with a person all the same.
  if (verbNext && prev && subject(q, q.at - 1) && next.readings.some(finite)) return decide(q, pronoun);
  // After ne and its pas or point, before an infinitive: "Pourquoi ne point le dire ?" (Bovary).
  const before = q.at >= 2 ? q.words[q.at - 2] : undefined;
  if (prev && NEGATION.has(prev.low) && before && ['ne', "n'"].includes(before.low) && next.readings.some(infinitive)) {
    return decide(q, pronoun);
  }
  // sans before an infinitive that is also a noun, as likely the verb: "je vivais sans le savoir" (Le Horla).
  if (prev?.low === 'sans' && best(next, infinitive) >= best(next, (r) => !verbal(r)) - 0.5) return decide(q, pronoun);
  // la before a word whose nouns are all masculine is no article: "à la vouloir posséder" is to want her.
  if (q.word.low === 'la' && verbNext && !next.readings.some((r) => (nounish(r) && !(r.pos === 'noun' && r.gender === 'm'))
    || isParticiple(r))) return decide(q, pronoun);
  // les before a word that is a singular noun or an infinitive: not the article, which would want a plural ("il fallait,
  // dès le seuil de la porte, les lancer sous le banc", Bovary: lancer "throw" has the plural lancers).
  if (q.word.low === 'les' && next.readings.some(infinitive) && !/[sxz]$/.test(next.low)
    && next.readings.every((r) => r.pos === 'verb' || (r.pos === 'noun' && !r.form))) return decide(q, is('pronoun'));
  if (!prev?.chosen) return null;
  if (['le', 'les'].includes(q.word.low) && ['de', 'à'].includes(prev.low) && prev.chosen.pos === 'preposition'
    && next.readings.some(verbal)) return decide(q, is('pronoun'));
  // Not before a time of day: "Rodolphe vint le soir" (soir is also an old verb).
  const top = next.readings[0];
  const nounFirst = !!top && nounish(top) && best(next, infinitive) < top.score - VERB_MARGIN;
  const modal = prev.chosen.pos === 'verb' && BARE_INFINITIVE.has(prev.chosen.key);
  return modal && next.readings.some(infinitive) && !DURATION.has(next.low) && !nounFirst ? decide(q, is('pronoun')) : null;
}

/**
 * vu the preposition "given" before a determiner ("vu la circonstance", Bovary); anywhere else voir's participle, also
 * through rien or jamais ("Tu n'as donc jamais rien vu") and alone ("Ainsi vu d'en haut, le paysage").
 */
function vu(q: ContextQuery): ContextChoice | null {
  const first = q.next?.readings[0];
  const aux = ['avoir', 'être'].includes(q.prev?.chosen?.key ?? '');
  const given = !!first && ['article', 'determiner', 'contraction'].includes(first.pos) && !aux;
  return decide(q, given ? is('preposition') : (r) => r.pos === 'verb');
}

/**
 * or the conjunction "now" opening a sentence or a clause ("Or, un soir, son mari rentra", La Parure); after a word it is
 * gold: "un couteau de fin or"; and before et, after a comma too: "une croix vénitienne, or et pierreries" (Bovary).
 */
function or(q: ContextQuery): ContextChoice | null {
  return q.prev || q.next?.low === 'et' ? decide(q, is('noun')) : null;
}

/**
 * aussi opening a sentence before an inverted verb is "therefore": "Aussi croyait-il à chaque minute entendre arriver le
 * garde-champêtre" (Bovary).
 */
function aussi(q: ContextQuery): ContextChoice | null {
  const n = q.next;
  const inverted = !!n && /[-‐]/.test(n.text) && !!n.readings[0] && finite(n.readings[0]);
  return q.sentenceStart && inverted ? decide(q, is('conjunction')) : null;
}

/**
 * plus after ne in its clause is "no longer, no more": "nous ne pouvons plus nourrir nos enfants" (Le Petit Poucet), "je
 * ne pouvais plus dormir" (Le Horla), "il n'y avait plus de". Not where pas, rien or jamais complete the ne (rien de plus
 * beau), nor across a mark or a clause of its own (qu'il ne fût plus content que …).
 */
function plus(q: ContextQuery): ContextChoice | null {
  // Not the comparative after de or an article: "n'eût osé en souhaiter de plus facile" (Candide), "ne … pas le plus".
  if (q.prev && ['de', "d'", 'le', 'la', 'les', "l'", 'au', 'du', 'des'].includes(q.prev.low)) return null;
  for (let i = q.at - 1, n = 0; i >= 0 && n < 6; i--, n++) {
    const w = q.words[i];
    if (/[,;:()«»—–]/.test(w.after)) return null;
    // The particle "no longer" where the dictionary has one; else the adverb, saying so.
    if (w.low === 'ne' || w.low === "n'") return decide(q, is('particle')) ?? { prefer: is('adverb'), margin: Infinity, hint: 'no longer, no more' };
    if (NEGATION.has(w.low) || CLAUSE_START.has(w.low) || COMPARATIVE.has(w.low)) return null;
  }
  return null;
}

/**
 * pas the noun "step" after a determiner, a number, an adjective or à: "à dix pas de distance on ne se voyait pas"
 * (Perrault), "à chaque pas", "sous leurs pas", "doubler le pas" (Candide), "à pas lents". Old French puts the pronoun
 * between ne and pas ("pour ne le pas réveiller"): that le is the pronoun, and pas stays "not".
 */
function pas(q: ContextQuery): ContextChoice | null {
  const p = q.prev;
  const c = p?.chosen;
  // "sans s'engager à pas un d'eux" (Perrault): pas un is "not one".
  if (!p || !c || (q.next && ['un', 'une'].includes(q.next.low))) return null;
  const step = ['article', 'determiner', 'numeral', 'contraction', 'adjective'].includes(c.pos) || ['à', 'chaque'].includes(p.low);
  return step ? decide(q, is('noun')) : null;
}

/**
 * bien before que is "although" where no verb, si or aussi comes before it: "et bien qu'elle exécrât Tellier" (Bovary),
 * "des êtres invisibles bien que tangibles" (Le Horla), and after a comma. "il faut bien que", "tu sais bien que", "si
 * bien que", "aussi bien que", "eh bien" keep their own words.
 */
function bien(q: ContextQuery): ContextChoice | null {
  const { prev, next } = q;
  if (!next || !['que', "qu'"].includes(next.low)) return null;
  if (prev) {
    const c = prev.chosen;
    if (['si', 'aussi', 'eh', 'ou', 'tant', 'tout', 'combien'].includes(prev.low)) return null;
    // A verb as read, as it may be, or with its subject hyphened to it: "Savez-vous bien que c'est ici la maison d'un Ogre
    // ?" (Perrault), which the dictionary has whole as an interjection.
    if (prev.readings.some((r) => r.pos === 'verb') || /[-‐](?:je|tu|il|elle|on|nous|vous|ils|elles)$/.test(prev.low)
      || (c && ['article', 'determiner', 'adverb'].includes(c.pos))) return null;
  }
  return decide(q, is('conjunction'));
}

/** un, une after l' or les is the pronoun "one": "dont l'une a épousé un médecin" (Le Horla), "les unes dans les autres". */
function un(q: ContextQuery): ContextChoice | null {
  return q.prev && ["l'", 'les'].includes(q.prev.low) ? decide(q, is('pronoun')) : null;
}

/**
 * dessous, dessus, dedans, dehors after de, par or en are not the nouns "the underside, the inside": "il sortit de dessous
 * la table" is the preposition, "en dessous" the adverb.
 */
function placeAdverb(q: ContextQuery): ContextChoice | null {
  if (!q.prev || !['de', "d'", 'par', 'en', 'là'].includes(q.prev.low)) return null;
  const n = q.next?.readings[0];
  const object = !!n && ['article', 'determiner', 'contraction', 'noun', 'proper noun', 'pronoun'].includes(n.pos);
  return (object ? decide(q, is('preposition')) : null) ?? decide(q, is('adverb'));
}

/**
 * mal before a participle or an adjective is the adverb "badly": "aux crins mal peignés", "ces vins mal faits" (Bovary);
 * and after a verb but avoir and faire, which make idioms of the noun (avoir mal, faire mal): "le petit répondait mal à ses
 * efforts".
 */
function mal(q: ContextQuery): ContextChoice | null {
  const n = q.next;
  const top = n?.readings[0];
  const c = q.prev?.chosen;
  if (c && finite(c) && !['avoir', 'faire'].includes(c.key)) return decide(q, is('adverb'));
  if (!n || !top) return null;
  const near = n.readings.filter((r) => r.score > top.score - 3);
  return near.some((r) => pastParticiple(r) || r.pos === 'adjective') && !near.some((r) => finite(r) && !isParticiple(r))
    ? decide(q, is('adverb')) : null;
}

/**
 * meilleur is bon's comparative "better, best" (bien's is mieux): "la plus belle et la meilleure", "le meilleur homme du
 * monde". Wiktionary files it under both.
 */
function meilleur(q: ContextQuery): ContextChoice | null {
  return decide(q, (r) => r.key === 'bon');
}

/**
 * toilettes in a book of the time is the plural of toilette, "dresses, outfits": "Elle n'avait pas de toilettes, pas de
 * bijoux, rien" (La Parure). The lavatory is a twentieth-century sense.
 */
function toilettes(q: ContextQuery): ContextChoice | null {
  return decide(q, (r) => r.key === 'toilette');
}

/**
 * mort, morte without a determiner is "dead", not the nouns "death" and "dead person", which want one ("la mort", "un
 * mort"): "gouverneur de Normandie, mort à la bataille de Montlhéry" (Bovary), "il était là, dans ce four, mort" (Le
 * Horla), "Mort ? Peut-être". After a preposition the noun stays: "condamné à mort".
 */
function mort(q: ContextQuery): ContextChoice | null {
  const c = q.prev?.chosen;
  if (q.word.name || (c && ['article', 'determiner', 'contraction', 'preposition', 'numeral', 'adjective'].includes(c.pos))) return null;
  // After an auxiliary, mourir's participle, which the shared engine reads: "Il est mort hier."
  if (c && ['être', 'avoir'].includes(c.key)) return null;
  return decide(q, is('adjective'));
}

/**
 * A and O at a sentence start in Candide's edition are À and Ô, printed without their accents (the engine adds their
 * readings, fr.ts capitalAccent): "A peine ont-ils mis le pied dans la ville", "A ce discours Candide s'évanouit", "O ciel !
 * à quel excès se porte le zèle". Not A before a participle, which is avoir's: "A dit le roi ?".
 */
function capital(q: ContextQuery): ContextChoice | null {
  const w = q.word;
  if (!q.sentenceStart || (w.text !== 'A' && w.text !== 'O')) return null;
  if (w.text === 'O') return w.after === '.' ? null : decide(q, (r) => r.key === 'ô');
  const n = q.next?.readings[0];
  return q.next && !(n && isParticiple(n)) ? decide(q, (r) => r.key === 'à') : null;
}

/**
 * comme opening an exclamation is "how": "Comme la vie est singulière, changeante !" (La Parure). Not comme si "as if", nor a
 * comparison the sentence goes on with ("Comme il faisait beau, …" has its comma before the clause it explains).
 */
function comme(q: ContextQuery): ContextChoice | null {
  const last = q.words[q.words.length - 1];
  if (!q.sentenceStart || !q.next || q.next.low === 'si' || q.next.low === "s'" || !last.after.includes('!') || q.question) return null;
  // Its clause has a verb: "— comme le premier jour, aux Comices!" (Bovary) has none, like the first day; "Comme vous voilà
  // faite!" (Candide) has voilà. Not "comme il y a deux ans", like two years ago, nor a clause before a narrated one: "Comme je
  // m'arrêtais à regarder un géant des batailles, qui portait trois fleurs magnifiques, je vis" (Le Horla) is "as".
  // Right after a subject pronoun any finite reading counts: "comme tu sues!" (Bovary) is suer's, though savoir's sues leads.
  const verb = (w: ContextWord, i: number): boolean => ['voilà', 'voici'].includes(w.low)
    || w.readings.some((r) => finite(r) && (r.score > (w.readings[0]?.score ?? 0) - 3 || SUBJECT_OR_STRONG.has(q.words[i - 1]?.low)
      || SUBJECT_CLITIC.has(q.words[i - 1]?.low)));
  let comma = q.words.findIndex((w, i) => i >= q.at && /[,;:—–]/.test(w.after));
  if (comma < 0) comma = q.words.length - 1;
  if (!q.words.slice(q.at + 1, comma + 1).some((w, j) => verb(w, q.at + 1 + j))) return null;
  const span = q.words[q.at + 4];
  if (q.next.low === 'il' && q.words[q.at + 2]?.low === 'y' && q.words[q.at + 3]?.low === 'a' && span
    && (span.readings.some((r) => r.pos === 'numeral') || ['un', 'une', 'quelques', 'des'].includes(span.low))) return null;
  const narrated = q.words.some((w, i) => i > comma && SUBJECT_CLITIC.has(w.low) && /[,;]/.test(q.words[i - 1].after)
    && !!q.words[i + 1]?.readings.some((r) => finite(r) && /\bpast historic\b/.test(r.form)));
  if (narrated) return null;
  return q.word.readings.some(is('conjunction')) ? { prefer: is('conjunction'), margin: Infinity, hint: 'how', sense: /\bhow\b/ } : null;
}

/**
 * faire before an infinitive makes someone do it: "ce terrible don fit frémir toute l'assemblée" (Perrault), "On le fait
 * tourner à droite" (Candide), "il fit venir le médecin". venir de before an infinitive has just done it: "la clef du cabinet
 * qu'elle venait de retirer de la serrure" (Perrault), "Je viens d'aller consulter mon médecin" (Le Horla).
 */
function verbBeforeInfinitive(q: ContextQuery): ContextChoice | null {
  const w = q.word;
  const faire = (r: ContextReading): boolean => r.key === 'faire' && r.pos === 'verb';
  const venir = (r: ContextReading): boolean => r.key === 'venir' && finite(r) && /\b(?:present|imperfect)\b/.test(r.form);
  const inf = (x?: ContextWord): boolean => !!x && !x.name && !!x.readings[0] && infinitive(x.readings[0]);
  if (w.readings.some(faire) && inf(q.next) && !['être', 'avoir'].includes(q.next!.readings[0].key)) {
    return { prefer: faire, margin: Infinity, hint: 'to make, have (done)', sense: /\b(?:to cause|to make)\b/ };
  }
  // A pronoun may stand between: "ma soeur venait d'en partir" (Candide).
  let de = q.next && ['de', "d'"].includes(q.next.low) && !q.next.after ? q.words[q.at + 2] : undefined;
  if (de && OBJECT_CLITIC.has(de.low) && !de.after) de = q.words[q.at + 3];
  // Not the phrase venir de "to come from", which the dictionary has: "il vient de Paris".
  if (w.readings.some(venir) && inf(de)) return { prefer: venir, margin: Infinity, hint: 'to have just', sense: /\bhave just\b/, noPhrase: true };
  return null;
}

const WORD_RULES: Record<string, (q: ContextQuery) => ContextChoice | null> = {
  comme,
  a: capital, o: capital,
  en, des, du, que, "qu'": que, si, leur, même: meme, fort, tout, toute: tout, voilà: voila, voici: voila, ce,
  personne, moyen, moyens: moyen, ensemble, le: lePronoun, la: lePronoun, les: lePronoun, "l'": lePronoun, vu, or, aussi,
  plus, pas, bien, un, une: un, uns: un, unes: un, dessous: placeAdverb, dessus: placeAdverb, dedans: placeAdverb,
  dehors: placeAdverb, mal, meilleur, meilleurs: meilleur, toilettes, mort, morte: mort, morts: mort, mortes: mort,
};

/**
 * A verb that its s', m' or t' is written onto is reflexive, as it is when they stand apart: "La jeune demoiselle ne
 * s'ennuyait point" (Perrault) is "was not bored", "car elle s'appelait ainsi" "was called". The dictionary has s'ennuyait
 * whole, so the word is one token and the shared engine sees no pronoun before it. m' and t' only with their own person
 * (je m'amuse, but il m'aime).
 */
function fusedReflexive(q: ContextQuery): ContextChoice | null {
  const m = /^([smt])'./.exec(q.word.low);
  if (!m) return null;
  const person = { s: /\bthird-person\b|\binfinitive\b|\bparticiple\b/, m: /\bfirst-person singular\b/, t: /\bsecond-person singular\b/ }[m[1] as 's' | 'm' | 't'];
  const own = (r: ContextReading): boolean => r.pos === 'verb' && !r.key.includes("'") && (!r.form || person.test(r.form));
  const fit = q.word.readings.some(own) ? own : (r: ContextReading) => r.pos === 'verb' && (!r.form || person.test(r.form));
  return q.word.readings.some(fit) ? { prefer: fit, margin: Infinity, reflexive: true } : null;
}

/**
 * se mettre is "to start" before à and an infinitive ("Il se mit à pleurer"), and "to put oneself, get" before anything
 * else: "Ils se mirent à table" (Perrault) sat down to eat, "se mit à genoux", "Mettez-vous derrière elle" (Bovary). With
 * the pronoun before être, y or en too: "elle s'était mise à rire", "sa fenêtre, elle s'y mettait souvent" (Bovary).
 */
function seMettre(q: ContextQuery): ContextChoice | null {
  const verb = (r: ContextReading): boolean => r.key === 'mettre';
  if (!q.word.readings.some(verb)) return null;
  const se = (w?: ContextWord): boolean => !!w && ['se', "s'", 'me', "m'", 'te', "t'", 'nous', 'vous'].includes(w.low);
  const b1 = q.words[q.at - 1];
  const b2 = q.words[q.at - 2];
  // Or joined to an imperative: "Ah ! monsieur, mettez-vous à table" (Candide), "Mettez-vous derrière elle".
  const joined = /[-‐](?:vous|toi|nous)$/.test(q.word.low);
  if (!joined && !se(b1) && !(se(b2) && (b1?.chosen?.key === 'être' || ['y', 'en'].includes(b1?.low ?? '')))) return null;
  const a = q.words[q.at + 1];
  const inf = OBJECT_CLITIC.has(q.words[q.at + 2]?.low ?? '') ? q.words[q.at + 3] : q.words[q.at + 2];
  const start = !!a && ['à', 'a'].includes(a.low) && !q.word.after && !a.after && !!inf && !!inf.readings[0]
    && infinitive(inf.readings[0]);
  return { prefer: verb, margin: Infinity, reflexive: start };
}

/**
 * After a subject, the verb: "l'énorme bloc de pierres qui porte la petite cité" (Le Horla) carries, not porte "door"; "il
 * entre dans la salle" (Perrault) enters, not entre "between"; "Le bon Jacques court à son secours" (Candide) runs, not court
 * "short"; "la mort qui approche". A word that is first a function word stays one (il y a, ne pas). And after et, a bare
 * noun before an article is the verb of the same subject: "elle alla […] ouvrir la fenêtre et huma l'air frais" (Bovary)
 * sniffed, not huma "humanity".
 */
function verbAfterSubject(q: ContextQuery): ContextChoice | null {
  const { prev, next } = q;
  const w = q.word;
  const top = w.readings[0];
  if (!prev || !top || w.name || NEGATION.has(w.low) || !w.readings.some(finite)) return null;
  if (!top.form && ['adverb', 'pronoun', 'preposition', 'conjunction', 'determiner', 'article', 'particle', 'contraction',
    'interjection'].includes(top.pos)) {
    // No preposition or conjunction comes right after il, on, je: "il entre dans la salle" (Perrault) enters, not entre
    // "between"; "je puis" can.
    if (SUBJECT_CLITIC.has(prev.low) && ['preposition', 'conjunction', 'contraction'].includes(top.pos)) return decide(q, finite);
    // After nous, vous that a preposition governs it stays itself, where the shared engine reads a verb after any clitic:
    // "Que ces comices soient pour vous comme des arènes pacifiques" (Bovary) is "like", not commer's.
    return SUBJECT_OR_STRONG.has(prev.low) && !subject(q, q.at - 1) ? decide(q, is(top.pos)) : null;
  }
  if (subject(q, q.at - 1)) {
    // An adjective after a name stands in apposition when the verb follows it: "madame Bovary jeune ne manquait pas de
    // s'arrêter" (Bovary) is young; but "Le bon Jacques court à son secours" (Candide) runs.
    // Nor a rare verb an adjective is spelled like: "l'Inde anglaise proprement dite" (Le Tour du monde), not anglaiser.
    const n = q.next;
    const apposition = !!n && (['ne', "n'"].includes(n.low) || OBJECT_CLITIC.has(n.low) || plainlyVerb(n));
    const far = best(w, finite) < top.score - CONTEXT_MARGIN;
    return prev.name && top.pos === 'adjective' && (apposition || far) ? null : decide(q, finite);
  }
  const n = next?.readings[0];
  if (['et', 'puis', 'mais'].includes(prev.low) && top.pos === 'noun' && n && ['article', 'determiner'].includes(n.pos)
    && q.words.slice(0, q.at - 1).some((x) => x.chosen && finite(x.chosen))) return decide(q, finite);
  return null;
}

/**
 * Right after a noun, a past participle or an adjective, not a noun spelled like one, which would want a determiner: "Il se
 * tenait les bras croisés sur ses genoux" (Bovary) are crossed arms, not crusaders; "à côté de bras et de jambes coupés"
 * (Candide) cut off, not coupés "coupé cars"; "ses espérances tombées".
 */
function participleAfterNoun(q: ContextQuery): ContextChoice | null {
  const c = q.prev?.chosen;
  const w = q.word;
  if (!c || c.pos !== 'noun' || q.prev!.name || w.name || w.readings[0]?.pos !== 'noun') return null;
  // The adjective first, as the shared engine reads one after a noun: "sa petite mine rosée qui souriait" (Bovary) is
  // pinkish, not roser's participle.
  return decide(q, is('adjective')) ?? decide(q, pastParticiple);
}

/**
 * Right after a verb that is not avoir, faire or être, a word as much an adjective as a noun is the adjective: "on la
 * croyait morte ou enchantée" (Perrault) dead, not mort "dead person"; "il tomba mort"; "d'animaux qui paraissaient morts".
 * avoir and faire make idioms with a bare noun (avoir mal, faire peur); être leaves a participle to the shared engine.
 */
function adjectiveAfterVerb(q: ContextQuery): ContextChoice | null {
  const c = q.prev?.chosen;
  const top = q.word.readings[0];
  if (!c || !finite(c) || ['avoir', 'faire', 'être'].includes(c.key) || !top || top.pos !== 'noun' || q.word.name) return null;
  // Not a color named after a thing: "son carrosse redeviendrait citrouille" (Perrault) is the pumpkin.
  return decide(q, (r) => r.pos === 'adjective' && r.score > top.score - 3 && !/-colou?red\b/.test(r.hint));
}

/**
 * An imperative opening a sentence before its object, or standing alone: "Faites votre devoir, lui dit-elle" (Perrault) is
 * faire's "do!", not fait "done"; "Ah ! faites, faites, sauvez-la !" (Bovary).
 */
function imperative(q: ContextQuery): ContextChoice | null {
  const imp = (r: ContextReading): boolean => r.pos === 'verb' && /\bimperative\b/.test(r.form);
  const top = q.word.readings[0];
  // An interjection stands alone as well: "« Gare ! » cria une voix" (Bovary) is "look out!", not garer's.
  if (!top || !['adjective', 'noun'].includes(top.pos) || !q.word.readings.some(imp) || q.word.readings.some(is('interjection'))) {
    return null;
  }
  const last = q.words[q.at - 1];
  const repeated = !!last && last.low === q.word.low && !!last.chosen && imp(last.chosen);
  if (!q.sentenceStart && !repeated) return null;
  // Alone, only before "!" or the word again: "casse! brise! lâche les sangsues!" (Bovary); "— Une chose... grave,
  // sérieuse." keeps the adjective.
  const n = q.next?.readings[0];
  const fits = q.next ? !!n && ['article', 'determiner', 'pronoun'].includes(n.pos)
    : /^!/.test(q.word.after) || q.words[q.at + 1]?.low === q.word.low;
  return fits ? decide(q, imp) : null;
}

/**
 * The word after a clitic read as the pronoun is the verb: "on n'en donne pas beaucoup aux employés" (La Parure) is
 * donner, not donne "deal"; "il leur dit".
 */
function afterClitic(q: ContextQuery): ContextChoice | null {
  const p = q.prev;
  if (!p || !p.chosen || !['en', 'leur', 'y'].includes(p.low) || (p.low !== 'y' && p.chosen.pos !== 'pronoun')) return null;
  // A function word or an adverb read as itself stays one: "à n'en plus finir" is plus, not plaire's past historic.
  const top = q.word.readings[0];
  if (!top || (!top.form && ['adverb', 'pronoun', 'conjunction', 'preposition', 'determiner', 'article'].includes(top.pos))) return null;
  return q.word.readings.some(verbal) && !q.word.readings.some(presentParticiple) ? decide(q, verbal) : null;
}

/**
 * After an adverb of degree, the adjective, else the participle: "comme elle était fort vive" is vif, not vivre's "may
 * live"; "qui étaient si fâchés" angry. A word that is first an adverb (si bien, si vite) or a function word (trop sur la
 * dot) stays one; a noun as much an adverb is the adverb (fort mal vêtue).
 */
function afterIntensifier(q: ContextQuery): ContextChoice | null {
  const p = q.prev;
  const top = q.word.readings[0];
  if (!p || !top || p.chosen?.pos !== 'adverb' || !INTENSIFIER.has(p.low) || q.word.name || DETERMINER_LIKE.has(q.word.low)) return null;
  if (!['noun', 'verb', 'adjective'].includes(top.pos)) return null;
  // After plus, moins, bien a noun stays one unless it is as much an adjective: "plus rien", but "plus long que large".
  const adjectiveNear = q.word.readings.some((r) => r.pos === 'adjective' && r.score > top.score - 3);
  if (['plus', 'moins', 'bien'].includes(p.low) && top.pos === 'noun' && !adjectiveNear) return null;
  // A participle of a compound tense stays the verb: "les religieuses qui avaient si bien présumé de sa vocation", "vous
  // vous êtes bien fait attendre" (Perrault).
  const before = q.words.slice(Math.max(0, q.at - 5), q.at - 1);
  if (before.some((w) => w.chosen?.key === 'avoir' || ['se', "s'", 'me', "m'", 'te', "t'"].includes(w.low))
    || before.some((w, i) => i > 0 && ['nous', 'vous'].includes(w.low) && w.low === before[i - 1].low)) return null;
  // A noun as much an adverb is the adverb: "une jeune fille fort mal vêtue", "si mal fait", "un peu plus bas".
  const adverbNear = q.word.readings.some((r) => r.pos === 'adverb' && r.score > top.score - 1.5);
  if (top.pos === 'noun' && adverbNear) return decide(q, is('adverb'));
  // Decisive even where the adjective leads: after être the engine would make a participle of it ("étaient si fâchés").
  // After bien, which also makes compound tenses (bien élevée "brought up", bien reçu), only a word that is no participle:
  // "serais-tu bien aise d'aller au bal" (Perrault) is glad, not aise "ease".
  if (p.low === 'bien') return q.word.readings.some(pastParticiple) ? null : decide(q, is('adjective'));
  return decide(q, is('adjective')) ?? decide(q, pastParticiple);
}

/**
 * An infinitive that is also a noun is the verb when no determiner comes before it and an infinitive, an object pronoun
 * or a negation follows: "afin de parler la dernière, et de pouvoir réparer […] le mal" (Perrault), "sans pouvoir le
 * dire"; but "le pouvoir de".
 */
function infinitiveNoun(q: ContextQuery): ContextChoice | null {
  const { prev, next } = q;
  if (!next || q.word.name || !q.word.readings.some((r) => r.pos === 'noun') || !q.word.readings.some(infinitive)) return null;
  // The noun needs its determiner (le pouvoir de); without one, before an infinitive or a clitic, the verb: "je ne crois
  // pas pouvoir jamais la prendre", "Mais comment pouvoir s'en débarrasser ?" (Bovary).
  const c = prev?.chosen;
  if (c && ['article', 'determiner', 'contraction', 'adjective', 'numeral'].includes(c.pos)) return null;
  const top = next.readings[0];
  const object = OBJECT_CLITIC.has(next.low) || ['pas', 'plus', 'jamais', 'rien', 'point', 'bien', 'mieux'].includes(next.low)
    || (!!top && infinitive(top));
  return object ? decide(q, infinitive) : null;
}

/**
 * A word that is as much an adjective as a noun is the adjective between a determiner or a preposition and a noun: "pour
 * aller chez la jeune mariée" (Perrault) is young, not jeune "youth"; "Une jeune personne blonde" (Bovary). Not a noun
 * likelier alone (le monde, une maison blanche), nor before an adjective (ce calme parfait).
 */
function adjectiveBeforeNoun(q: ContextQuery): ContextChoice | null {
  const { prev, next } = q;
  const c = prev?.chosen;
  if (!c || !next || !['article', 'determiner', 'contraction', 'preposition'].includes(c.pos)) return null;
  const top = q.word.readings[0];
  const asAdjective = best(q.word, (r) => r.pos === 'adjective' && !r.form);
  if (!top || !['noun', 'adjective'].includes(top.pos) || asAdjective < best(q.word, is('noun')) - 0.5) return null;
  // Before a name too, the adjectives that go before their noun: "Ce pauvre Bovary" (Bovary), "le pauvre Charles" are poor,
  // not pauvre "poor person". A noun stays one: "le chien Fidèle" (Candide), "le curé Bournisien".
  if (next.name) return c.pos !== 'preposition' && PRENOMINAL.has(q.word.low) ? decide(q, is('adjective')) : null;
  if (asAdjective < best(q.word, is('noun'))) return null;
  const n = next.readings[0];
  // Before another adjective that goes before the noun: "Ce pauvre jeune homme" (Bovary), "ce pauvre cher homme".
  if (n && PRENOMINAL.has(q.word.low) && PRENOMINAL.has(next.low)) return decide(q, is('adjective'));
  if (!n || !next.readings.some(is('noun')) || n.pos === 'adjective' || verbal(n)
    || ['determiner', 'article', 'preposition', 'conjunction', 'adverb', 'particle'].includes(n.pos)) return null;
  return decide(q, is('adjective'));
}

/**
 * Right after être and the other copulas, a word that is as much an adjective as a noun is the adjective: "Charles était
 * long à manger" (Bovary) is slow, not long "length"; "je suis fort bête". Not a participle (était coupé), which the engine
 * reads after its auxiliary, nor an adverb (furent mal rangés).
 */
function afterCopula(q: ContextQuery): ContextChoice | null {
  const c = q.prev?.chosen;
  const top = q.word.readings[0];
  if (!c || c.pos !== 'verb' || !COPULA.has(c.key) || !top || top.pos !== 'noun') return null;
  if (q.word.readings.some((r) => r.pos === 'verb' || (r.pos === 'adverb' && r.score > top.score - 1.5))) return null;
  // Not a color named after a thing: "son carrosse redeviendrait citrouille" (Perrault) is the pumpkin.
  const fit: Prefer = (r) => r.pos === 'adjective' && r.score > top.score - 1.5 && !/-colou?red\b/.test(r.hint);
  return decide(q, fit);
}

/**
 * After ne … que, an adjective that is also a participle is the adjective: "les suisses […] n'étaient qu'endormis"
 * (Perrault) asleep, where the engine would read through que to the participle of a compound tense.
 */
function afterRestrictive(q: ContextQuery): ContextChoice | null {
  const p = q.prev;
  if (!p || !['que', "qu'"].includes(p.low) || p.chosen?.pos !== 'adverb') return null;
  const top = q.word.readings[0];
  return top && (pastParticiple(top) || top.pos === 'adjective') ? decide(q, is('adjective')) : null;
}

/**
 * After the preposition en, the gerund: "tant elle souffrait en revenant" (La Parure) is revenir, not revenant "ghost";
 * "tout en ayant l'air d'écouter" (Bovary) is avoir's.
 */
function gerund(q: ContextQuery): ContextChoice | null {
  return q.prev?.low === 'en' && q.prev.chosen?.pos === 'preposition' ? decide(q, presentParticiple) : null;
}

/**
 * se with en or y between it and its verb still makes the verb reflexive, as the shared engine knows only right before it:
 * "chaque jour elle s'y acharnait davantage" (Bovary) persisted, "il s'en alla" went away, "il s'en trouva sept"
 * (Perrault). me and te with their own person: "je m'en vais". Not a verb of going after s'en, which is "away" there:
 * "Homais s'en retourna chez lui" (Bovary) went back, not "turned around".
 */
function reflexiveThroughClitic(q: ContextQuery, answer: ContextChoice | null): ContextChoice | null {
  const p = q.prev;
  const se = q.words[q.at - 2];
  if (!p || !['en', 'y'].includes(p.low) || !se || se.after || p.after || !q.word.readings.some(finite)) return answer;
  if (answer?.reflexive !== undefined) return answer;
  if (p.low === 'en' && q.word.readings.some((r) => finite(r) && GOING.has(r.key))) return answer;
  const person = ['se', "s'"].includes(se.low) ? /\bthird-person\b/ : ['me', "m'"].includes(se.low) ? /\bfirst-person singular\b/
    : ['te', "t'"].includes(se.low) ? /\bsecond-person singular\b/ : null;
  if (!person) return answer;
  const choice = answer ?? decide(q, finite);
  return choice && q.word.readings.some((r) => finite(r) && person.test(r.form)) ? { ...choice, reflexive: true } : answer;
}

/** French's context rule (SpacedLang.context). */
/**
 * Fixed phrases the words around them undo (ContextChoice.noPhrase): "dans le petit bois qu'on appelait parc" (Candide) is the
 * little wood, not petit bois "kindling"; "Ce dernier discours détermina Candide" this last speech, not ce dernier "the
 * latter"; "les deux savants jugèrent à propos de rétablir le membre" (Bovary) saw fit to, and "Emma cherchait à savoir" to
 * know, not "about" and "namely"; "avant de se mettre au lit" is going to bed, not se mettre à "to start"; "un petit homme
 * fort laid" very ugly, not homme fort "strong man"; "Il ne venait pas grand monde" not many people, not "high society"; "le
 * meilleur homme du monde" the best man in the world, not "man of the world"; "rien de plus beau" more beautiful, not de plus
 * "moreover".
 */
function phraseUndone(q: ContextQuery): boolean {
  const { prev, next } = q;
  const w = q.word.low;
  const adjective = (x?: ContextWord): boolean => !!x && !!x.readings[0] && ['adjective', 'adverb'].includes(x.readings[0].pos);
  if (w === 'petit' && next?.low === 'bois' && prev?.chosen && ['article', 'determiner', 'contraction'].includes(prev.chosen.pos)) return true;
  if (w === 'dernier' && prev?.low === 'ce' && next?.readings[0]?.pos === 'noun') return true;
  const second = next && !next.after ? q.words[q.at + 2] : undefined;
  const infinitiveAt = (x?: ContextWord): boolean => !!x && !!x.readings[0] && infinitive(x.readings[0]);
  // à propos de before an infinitive only ("jugèrent à propos de rétablir"): "s'égorger à propos de la Sainte Vierge"
  // (Candide) is "about", "l'apothicaire vint à propos" (Bovary) "at the right time".
  if (w === 'à' && next?.low === 'propos' && prev?.chosen?.pos === 'verb' && !['être', 'avoir'].includes(prev.chosen.key)
    && ['de', "d'"].includes(second?.low ?? '') && infinitiveAt(q.words[q.at + 3])) return true;
  if (w === 'à' && next?.low === 'savoir' && prev?.chosen?.pos === 'verb' && !['être', 'avoir'].includes(prev.chosen.key)) return true;
  if (w === 'fort' && prev?.low === 'homme' && adjective(next)) return true;
  if (w === 'grand' && next?.low === 'monde' && prev && ['pas', 'plus', 'guère', 'point'].includes(prev.low)) return true;
  if (w === 'homme' && next?.low === 'du' && prev && ['meilleur', 'plus', 'moins', 'pire'].includes(prev.low)) return true;
  // But de plus belle, "la conversation interrompue reprenait de plus belle" (Le Tour du monde), is "all the more".
  if (w === 'plus' && prev?.low === 'de' && adjective(next) && !q.word.after && next!.low !== 'belle') return true;
  // mal before a participle is "badly", not avoir mal "to hurt": "J'ai mal dormi" (Le Horla), "il avait mal entendu".
  if (w === 'mal' && prev?.chosen?.key === 'avoir' && !!next?.readings.some((r) => isParticiple(r) && r.score > next.readings[0].score - 3)) return true;
  // A verb's phrase ends where the words go on otherwise: venir de "to come from" is no "le moment n'était pas venu de dire
  // à son maître" (Le Tour du monde), "L'envie lui vint de retourner chez Lheureux" (Bovary), whose de has an infinitive
  // after it (venir de with an infinitive in the present or imperfect is "to have just", verbBeforeInfinitive). vouloir dire
  // is "to mean", but "Je m'écriai, je voulus dire, Arrêtez, barbares!" (Candide) wanted to say what follows.
  const verb = q.word.readings.find((r) => r.pos === 'verb');
  if (verb?.key === 'venir' && next && ['de', "d'"].includes(next.low) && infinitiveAt(second)) return true;
  if (verb?.key === 'vouloir' && next?.low === 'dire' && /[,:;«]/.test(next.after) && !/\b(?:present|imperfect)\b/.test(verb.form)) return true;
  return false;
}

export function frenchContext(q: ContextQuery): ContextChoice | null {
  const own = WORD_RULES[q.word.low];
  const answer = fusedReflexive(q) ?? (own ? own(q) : null) ?? verbBeforeInfinitive(q) ?? seMettre(q) ?? gerund(q) ?? verbAfterSubject(q) ?? afterClitic(q)
    ?? afterIntensifier(q) ?? afterRestrictive(q) ?? infinitiveNoun(q) ?? adjectiveBeforeNoun(q) ?? afterCopula(q)
    ?? participleAfterNoun(q) ?? adjectiveAfterVerb(q) ?? imperative(q);
  const choice = reflexiveThroughClitic(q, answer);
  return phraseUndone(q) ? { ...(choice ?? { margin: 0 }), noPhrase: true } : choice;
}
