// Portuguese context rules (SpacedLang.context): the words whose reading turns on their neighbors. Each rule reads the
// grammar around the word, what comes before it and after it, the way a reader does; the examples are from Dom Casmurro
// (1899, in its own spelling), Missa do Galo, Um apólogo, A cartomante and O alienista.
//
// - que: "that" after a verb or an adverb (disse que, é que, agora que), "which, who" after a noun or a pronoun (a pessoa
//   que, Escobar, que …), "what" in a question (Que é?) and "what a" or "how" in an exclamation (Que susto!).
// - se: "if, whether" at the head of a clause, after a verb (não sei se), before a subject, an article or not (se ella,
//   se o rosto, se não); the pronoun "oneself" before the verb it goes with (não se lembra, que se dera).
// - a, o before an infinitive: "começou a falar" is the preposition "to", "o pintar e vestir" the article; o, a, os, as are
//   the article where no pronoun can stand (after a verb, at the head of a sentence: "precipitavamos as cerimonias").
// - a is "to" where neither the article nor the pronoun can stand: before a stressed pronoun (a mim, a quem, a si), before
//   what is masculine or plural (de um a outro, daqui a dous mezes), before a man's name (agradecia-o a Deus), and after ir.
// - que after a comparative is the conjunction "than": "eram mais bonitos que os meus".
// - nos: "us" before a verb (Deus nos livre), "in the" before a noun (nos quartos).
// - foi, fui, foram, fosse: ir "to go" before a place (ao, á, para, lá), an infinitive or a gerund (foi andando), or with its
//   own pronoun (fui-me); ser "to be" otherwise.
// - me, te, nos, vos with a verb of their own person are reflexive: sentei-me "I sat down", despedi-me "I said goodbye";
//   and an infinitive with me after a verb of the speaker's: "Fui sentar-me".
// - a word that is a noun and a verb: the noun after an article, a possessive or an adjective (a minha opera, boa memoria),
//   the infinitive after a and a modal (continuou a andar, fazia-o parecer), the verb after dela and before its object (O
//   rosto della era, vale o carro de Apolo).
// - and todos, gente, tarde, ora, como, quer, pois, mesmo, fóra, D., S., quiz, tivera, tu, si, consigo: see
//   portugueseContext.
import { CONTEXT_MARGIN, isFiniteVerb, type ContextChoice, type ContextQuery, type ContextReading, type ContextWord } from './context';

type Choice = ContextChoice | null;

/** Prefer the readings of one part of speech, however unlikely alone. */
const as = (pos: string): ContextChoice => ({ prefer: (r) => r.pos === pos, margin: Infinity });
const CONJ = as('conjunction');
const PRON = as('pronoun');
const DET = as('determiner');

/** The readings of a word near its likeliest: what it can plausibly be. */
function near(w: ContextWord, margin = CONTEXT_MARGIN): ContextReading[] {
  const top = w.readings[0]?.score ?? 0;
  return w.readings.filter((r) => r.score > top - margin);
}
/** The reading chosen for a word before, else its likeliest. */
const reading = (w: ContextWord | undefined): ContextReading | undefined => w?.chosen ?? w?.readings[0];
const posOf = (w: ContextWord | undefined): string => (w?.name ? 'name' : reading(w)?.pos ?? '');
const keyOf = (w: ContextWord | undefined): string => reading(w)?.key ?? '';
const isVerb = (r: ContextReading): boolean => r.pos === 'verb';
/**
 * A verb's headword (its infinitive; the future subjunctive of a regular verb is spelled the same), a form so named, or
 * another spelling of the headword ("a arrenegar", Machado's arrenegar for renegar).
 */
const infinitive = (r: ContextReading): boolean => r.pos === 'verb' && (!r.form || /\binfinitive\b/.test(r.form)
  || !/\b(?:first|second|third)-person\b|\b(?:imperative|indicative|subjunctive|conditional|preterite|participle|gerund)\b/.test(r.form));
const gerund = (r: ContextReading): boolean => r.pos === 'verb' && /\bgerund\b/.test(r.form);
/** Every person the form can be is in the subjunctive (or the imperative, spelled like it): seja, deixe, fosse. */
const subjunctive = (r: ContextReading): boolean => r.pos === 'verb' && !!r.form
  && r.form.split('; ').every((p) => /\b(?:subjunctive|imperative)\b/.test(p) && !/\bindicative\b/.test(p));
/** The imperfect or future subjunctive, the moods of "if": se fosse, se quizer. */
const ifMood = (r: ContextReading): boolean => r.pos === 'verb' && !!r.form
  && r.form.split('; ').every((p) => /\b(?:imperfect|future) subjunctive\b/.test(p));
/** The word's plausible verb readings all are so (and it has one). */
function verbIs(w: ContextWord | undefined, test: (r: ContextReading) => boolean): boolean {
  const vs = w ? near(w).filter(isVerb) : [];
  return vs.length > 0 && vs.every(test);
}
const canBeVerb = (w: ContextWord): boolean => near(w).some(isVerb);
/** A noun (or adjective, numeral) that cannot be a verb here: Que susto!, De que sexo? */
const nounOnly = (w: ContextWord | undefined): boolean => !!w && !w.name && w.readings.length > 0
  && ['noun', 'adjective', 'numeral'].includes(w.readings[0].pos) && !canBeVerb(w);

/** Pronouns that stand between se, que or não and their verb: se me não visse, que lhe importa. */
const CLITICS = new Set(['me', 'te', 'se', 'lhe', 'lhes', 'nos', 'vos', 'o', 'a', 'os', 'as', 'mo', 'ma', 'lho', 'lha', "lh'o", "lh'a"]);
/** Subject pronouns, by key (elle is ele). */
const SUBJECTS = new Set(['eu', 'tu', 'ele', 'ela', 'você', 'nós', 'vós', 'eles', 'elas', 'vocês']);
/** Words that make the clause after que a result: tão contente que, com tal força que, taes e tantas que. */
const RESULT = new Set(['tão', 'tanto', 'tanta', 'tantos', 'tantas', 'tal', 'tais', 'taes', 'tamanho', 'tamanha']);
/** Comparatives, after which que (and do que) is "than": melhor que a ama, mais do que o que se passou. */
const COMPARATIVE = new Set(['mais', 'menos', 'melhor', 'melhores', 'pior', 'piores', 'maior', 'maiores', 'menor', 'menores',
  'antes', 'outro', 'outra', 'outros', 'outras']);
/** Prepositions that make a conjunction of que: para que, até que, sem que, desde que, como que. */
const CONJ_PREPOSITIONS = new Set(['para', 'pra', 'até', 'sem', 'desde', 'como', 'conforme', 'salvo', 'senão', 'afim', 'segundo']);
/**
 * Verbs that tell someone something, so the que after the person told starts what is told: "disse a Capitú que a filha
 * chamava por ella", "disse ao filho que se fosse embora".
 */
const TELLING = new Set(['dizer', 'pedir', 'perguntar', 'responder', 'contar', 'explicar', 'mandar', 'prometer', 'jurar',
  'confessar', 'escrever', 'declarar', 'ordenar', 'rogar', 'lembrar', 'avisar', 'recomendar', 'mostrar', 'ensinar',
  'afirmar', 'anunciar', 'repetir', 'replicar', 'observar', 'propor', 'suplicar', 'segredar', 'insinuar', 'participar',
  'comunicar', 'gritar', 'bradar', 'assegurar', 'garantir', 'notar']);
const TO = new Set(['a', 'á', 'à', 'ao', 'aos', 'às', 'ás']);
/**
 * Pronouns and words standing for a noun that take a preposition and never an article: "a mim", "a quem", "a si", "a ella",
 * "a todos", "a ambos", "a alguem", "a isto".
 */
const STRESSED = new Set(['mim', 'ti', 'si', 'ele', 'elle', 'ela', 'ella', 'eles', 'elles', 'elas', 'ellas', 'você', 'voce',
  'vocês', 'voces', 'nós', 'vós', 'quem', 'isto', 'isso', 'aquilo', 'aquillo', 'tudo', 'nada', 'todos', 'todas', 'ambos', 'ambas',
  'alguém', 'alguem', 'ninguém', 'ninguem', 'outrem', 'algo']);
/**
 * Verbs a person or a place follows with a, which before a name is "to", not the article: "disse a Capitú que",
 * "agradecia-o a Deus", "contar estas esperanças a Capitú", "vae a Roma". The telling verbs (TELLING) count too.
 */
const TO_SOMEONE = new Set(['dar', 'entregar', 'oferecer', 'agradecer', 'emprestar', 'pagar', 'servir', 'obedecer', 'apresentar',
  'ir', 'vir', 'voltar', 'tornar', 'chegar', 'levar', 'partir', 'regressar', 'subir', 'descer', 'correr', 'fugir', 'mandar']);
/** After these the pronoun comes before its verb, so a before an infinitive is "her, it": "para a ver", "que a não via". */
const DRAWS_PRONOUN = new Set(['não', 'que', 'se', 'nunca', 'já', 'quem']);
/** Words that open a clause, whose subject may follow with its article: se a Capitú, que a Europa, quando a Gloria. */
const CLAUSE_OPENERS = new Set(['se', 'que', 'quando', 'como', 'porque', 'emquanto', 'enquanto', 'onde', 'logo', 'pois', 'mas']);
const pronounBefore = (P: ContextWord | undefined): boolean => !!P && (posOf(P) === 'preposition' || DRAWS_PRONOUN.has(P.low));

/**
 * The reading cannot follow the article a, which is feminine and singular: it is masculine (o pé, o tempo, outro, meu,
 * Deus) or plural (todos, mezes, dous).
 */
function notFeminineSingular(r: ContextReading): boolean {
  if (/\bplural\b/.test(r.form) || r.gender === 'pl') return true;
  if (/\bfeminine\b/.test(r.form)) return false;
  if (r.pos === 'noun' || r.pos === 'proper noun') return r.gender === 'm';
  // dous, tres, cem: every numeral but um (whose feminine is uma) counts more than one.
  if (r.pos === 'numeral') return r.key !== 'um';
  // outro, meu, todo, algum, ambos as headwords are masculine; an adjective's headword may be either (grande).
  if (r.pos === 'determiner' || r.pos === 'pronoun') return /\bmasculine\b/.test(r.form) || (!r.form && /(?:o|u|um|os|ns)$/.test(r.key));
  if (r.pos === 'adjective') return /\bmasculine\b/.test(r.form);
  return false;
}

/** A name a cannot be the article of: a man's (Deus, Escobar, José Dias) or one without the -a of a woman's or a country's. */
function masculineName(N: ContextWord): boolean {
  const rs = near(N).filter((r) => r.pos !== 'interjection');
  return rs.length ? rs.every(notFeminineSingular) : !/[aã]s?$/.test(N.low);
}

/**
 * a is the preposition "to" where neither the article nor the pronoun can stand: before a stressed pronoun ("a mim", "a
 * quem", "a si", "a ella", "a todos"), before what is masculine or plural ("de um a outro", "daqui a dous mezes", "a pé",
 * "continuou a andar", "entrou a olhar"), and before a man's name, or any name after a verb of telling, giving or going
 * ("agradecia-o a Deus", "disse a Capitú que", "vae a Roma"). Before que it is "to which" after a noun, a verb or a comma
 * ("o fim a que ia", "cartas, a que respondi"), but "the one that" after ser ("é a que vou dizer"); before não and a verb it
 * is the pronoun ("desde que a não via").
 */
function prepositionA(q: ContextQuery): Choice {
  const N = q.next;
  if (!N) return null;
  const P = q.prev;
  const TO_ = as('preposition');
  if (STRESSED.has(N.low)) return TO_;
  if (N.low === 'que') {
    const pp = posOf(P);
    return q.sentenceStart || q.word.before || pp === 'noun' || (pp === 'verb' && !['ser', 'estar'].includes(keyOf(P))) ? TO_ : null;
  }
  if (N.low === 'não') {
    // "a não ser" except; "levasse a não ficar lá" to; "como a não faria" her, it.
    const W = q.words[q.at + 2];
    if (!W || W.before) return null;
    if (W.low === 'ser' || near(W).some(infinitive)) return TO_;
    return verbIs(W, isFiniteVerb) ? PRON : null;
  }
  if (N.name) {
    // "para a Europa", "A Casa Verde": after a preposition and at the head of a sentence the article; and before the subject
    // of a clause, or what ser says one is: "a questão é saber se a Capitú da praia da Gloria …", "não era ainda a Capitú do
    // Flamengo".
    if (q.sentenceStart || (P && (posOf(P) === 'preposition' || CLAUSE_OPENERS.has(P.low)))) return null;
    const PP = q.words[q.at - 2];
    if (keyOf(P) === 'ser' || (P && posOf(P) === 'adverb' && keyOf(PP) === 'ser' && !P.before)) return null;
    // After a comma too: "Póde ir a S. Paulo, a Pernambuco ou ao Pará".
    if (masculineName(N)) return TO_;
    if (!P) return null;
    // Past a subject: "disse elle a Sua Magestade". A woman's name after a verb of telling or giving ("deixei recado a
    // Sanchinha"); a country or a city only after one of going, since ir a Roma has no article but "propoz-me a Europa"
    // does.
    const v = SUBJECTS.has(keyOf(P)) && q.at >= 2 && !P.before ? PP : P;
    const place = near(N).some((r) => r.pos === 'proper noun' || r.pos === 'noun');
    const going = ['ir', 'vir', 'voltar', 'tornar', 'chegar', 'levar', 'partir', 'regressar', 'subir', 'descer', 'correr', 'fugir'];
    if (posOf(v) === 'verb' && (going.includes(keyOf(v)) || (!place && (TO_SOMEONE.has(keyOf(v)) || TELLING.has(keyOf(v)))))) return TO_;
    // "Othello mataria a si e a Desdemona": a second a after e repeats the first.
    if (['e', 'ou', 'nem'].includes(P.low)) {
      for (let i = q.at - 2, n = 0; i >= 0 && n < 6; i--, n++) {
        if (q.words[i + 1].before) break;
        const c = q.words[i].low === 'a' ? q.words[i].chosen : undefined;
        if (c) return c.pos === 'preposition' ? TO_ : null;
      }
    }
    return null;
  }
  const rs = near(N).filter((r) => r.pos !== 'interjection');
  if (!rs.length || rs.some(isFiniteVerb)) return null;
  // After ir, a before a noun is "to", as the article would have joined it (á casa, à missa): "A senhora nunca foi a casa de
  // barbeiro?" (Missa do Galo).
  if (P?.chosen?.key === 'ir' && rs.some((r) => r.pos === 'noun')) return TO_;
  const other = rs.filter((r) => !isVerb(r));
  // A number above one, whatever else it may be: "daqui a dous mezes" (dous is also the dated noun and ordinal).
  if (other.some((r) => r.pos === 'numeral' && r.key !== 'um')) return TO_;
  if (!other.length || !other.every(notFeminineSingular)) return null;
  // A masculine noun that is also an infinitive takes the pronoun where one draws it: "para a olhar" (to look at her).
  return rs.some(isVerb) && pronounBefore(P) ? PRON : TO_;
}

/** The verb a clause turns on, past the pronouns, the subject and não after word `at`: Que a deixe? se me não visse. */
function verbAfter(q: ContextQuery, at = q.at): ContextWord | undefined {
  for (let i = at + 1; i < q.words.length && i <= at + 4; i++) {
    const w = q.words[i];
    if (w.before) return undefined;
    if (CLITICS.has(w.low) || w.low === 'não' || SUBJECTS.has(keyOf(w))) continue;
    return canBeVerb(w) ? w : undefined;
  }
  return undefined;
}

/** The word starts a clause: the sentence's first word, or the first after a comma, a semicolon or a dash. */
const clauseStart = (q: ContextQuery, i: number): boolean => i === 0 || !!q.words[i].before;

/** A correlative tão, tanto, tal a few words back in the clause: "tão violento, que ainda agora cuido ouvil-o". */
function result(q: ContextQuery): boolean {
  for (let i = q.at - 1, n = 0; i >= 0 && n < 6; i--, n++) {
    const w = q.words[i];
    if (RESULT.has(w.low)) return true;
    // "tão cruel e perverso que peguei no rapaz": e and ou join the words tão governs; another conjunction starts a clause.
    const pos = posOf(w);
    if ((pos === 'conjunction' && w.low !== 'e' && w.low !== 'ou') || w.low === 'que' || (w.before && i < q.at - 1)) return false;
  }
  return false;
}

/** The que before this one in the sentence, as read: "a vocação que se discutira … e que eu confessei" is the same que twice. */
function earlierQue(q: ContextQuery): ContextReading | undefined {
  for (let i = q.at - 2; i >= 0; i--) if (q.words[i].low === 'que' && q.words[i].chosen) return q.words[i].chosen;
  return undefined;
}

/** Comparatives a few words before que, which is then "than": mais, menos, melhor, pior, maior, menor. */
const MORE_LESS = new Set(['mais', 'menos', 'melhor', 'melhores', 'pior', 'piores', 'peor', 'peores', 'maior', 'maiores', 'menor', 'menores']);
/**
 * A comparative a few words back in the clause makes que "than": "os della eram mais bonitos que os meus", "menos magros do
 * que se poderiam supor" (Missa do Galo), "mais temor a Deus que aos homens". Not after an article, where it is the
 * superlative and que the relative ("o maior obstaculo que achou"), nor past a noun when a verb follows que, which is then
 * the relative too ("não faria mais promessas que não pudesse pagar").
 */
function compared(q: ContextQuery): number {
  let noun = false;
  for (let i = q.at - 1, n = 0; i >= 0 && n < 5; i--, n++) {
    const w = q.words[i];
    if (q.words[i + 1].before || w.low === 'que') return -1;
    if (MORE_LESS.has(w.low)) {
      const before = q.words[i - 1];
      if (before && !w.before && ['article', 'contraction'].includes(posOf(before))) return -1;
      const N = q.next;
      return noun && N && (canBeVerb(N) || CLITICS.has(N.low) || N.low === 'não') ? -1 : i;
    }
    if (posOf(w) === 'noun' || w.name) noun = true;
  }
  return -1;
}

/** Told to someone: a telling verb, a or ao, and the person (and their article or adjectives) right before que. */
function toldTo(q: ContextQuery): boolean {
  for (let i = q.at - 1, n = 0; i > 0 && n < 4; i--, n++) {
    const w = q.words[i];
    if (i < q.at - 1 && q.words[i + 1].before) return false;
    if (TO.has(w.low)) {
      const v = q.words[i - 1];
      return !w.before && posOf(v) === 'verb' && TELLING.has(keyOf(v));
    }
    if (!['name', 'noun', 'adjective', 'determiner', 'article', 'proper noun'].includes(posOf(w))) return false;
  }
  return false;
}

/**
 * que. Wiktionary has it as the relative pronoun ("which, who", the likeliest alone), the conjunction ("that", "than"), the
 * interrogative determiner ("what") and the adverb of exclamation ("how"). What stands before it says which.
 */
function que(q: ContextQuery): Choice {
  const P = q.at > 0 ? q.words[q.at - 1] : undefined;
  const N = q.next;
  if (q.sentenceStart || !P) {
    // At the head of a sentence: a subjunctive makes it the conjunction, the clause standing alone ("— Que a deixe? Que a
    // deixe, por quê?" "That I leave her?"; "Que me mande buscar, sem falta"); before a noun it asks or exclaims "what"
    // (Que versos? Que susto, meu Deus!), before an adjective "how" (Que lindos que são!); in a question before a verb it is
    // "what" (Que é? Que lhe importa o meu ar?), and in a statement "that" (— Que não é meu filho.).
    const v = verbAfter(q);
    if (v && verbIs(v, subjunctive)) return CONJ;
    if (N && nounOnly(N)) {
      const after = q.words[q.at + 2];
      return N.readings[0].pos === 'adjective' && !(after && !after.before && nounOnly(after)) ? as('adverb') : DET;
    }
    return q.question ? DET : CONJ;
  }
  const pl = P.low;
  const pp = posOf(P);
  if (q.word.before) {
    // After a comma: the result of a tão before it ("As veias eram tão azuis, que apesar da pouca claridade, podia
    // contá-las"), what a verb says or asks ("Juram que o libretto foi sacrificado, que a partitura corrompeu o sentido"),
    // and after a person or a thing the relative: "Escobar, que me ouviu com egual attenção".
    if (result(q)) return CONJ;
    if (pp === 'verb' || pp === 'adverb') return CONJ;
    if (['name', 'noun', 'pronoun', 'adjective', 'proper noun', 'numeral'].includes(pp)) return PRON;
    return null;
  }
  // After a verb, what is said, thought or seen, and the cleft "é que": "Repito que sim", "Mais tarde é que eu soube que o
  // teatro era um eufemismo". In a question before a noun, "what": "Sabe que horas são?"
  if (pp === 'verb') return q.question && N && nounOnly(N) ? DET : CONJ;
  // A preposition before a noun asks which one: "De que sexo?", "com que mão havia de abençoar o povo".
  if (pp === 'preposition' && N && nounOnly(N)) return DET;
  if (pp === 'preposition') {
    // para que, até que, sem que join a clause ("para que não fosse mais longe"); "para que?" alone or before an
    // infinitive asks what for ("mas para que escolher?").
    if (CONJ_PREPOSITIONS.has(pl)) return q.question && (!N || verbIs(N, infinitive)) ? DET : CONJ;
    // "A noticia de que ella vivia alegre": de que before a subject is "that"; before a verb it is the relative (a casa de
    // que lhe falei).
    if (pl === 'de' && N && (SUBJECTS.has(keyOf(N)) || N.name || ['article', 'determiner'].includes(N.readings[0]?.pos ?? ''))) return CONJ;
    // em que, com que, a que: the relative after its preposition ("a edade em que a metade do homem …").
    return PRON;
  }
  // o que, os que: "Fez o que disse", what or the one that.
  if (['o', 'a', 'os', 'as'].includes(pl) && (pp === 'article' || pp === 'pronoun')) return N && nounOnly(N) ? DET : PRON;
  if (compared(q) >= 0) return CONJ;
  if (pp === 'contraction') {
    // "mais do que o que se passou nas ruas": than, after a comparative; elsewhere do que is "of what" (depois do que se
    // passou), and daquelle que "of the one who".
    const PP = q.words[q.at - 2];
    if ((pl === 'do' || pl === 'da') && PP && !P.before && COMPARATIVE.has(PP.low)) return CONJ;
    return result(q) ? CONJ : PRON;
  }
  if (pp === 'conjunction') {
    if (['e', 'mas', 'ou', 'nem', 'porém', 'porem'].includes(pl)) {
      // A question that starts so asks "what": "Mas que é?", "E que pessoa, o reitor?". Otherwise que repeats the one
      // before: "prometteu que ia ver, que falaria logo que pudesse, e que me pegasse com Deus" (that), "a vocação que se
      // discutira naquella tarde, e que eu confessei não sentir em mim" (which).
      const start = clauseStart(q, q.at - 1);
      if (q.question && start) return DET;
      const before = earlierQue(q);
      if (before && (before.pos === 'conjunction' || before.pos === 'pronoun')) return as(before.pos);
      return start ? CONJ : null;
    }
    // pois que, contanto que, emquanto que, senão que.
    return CONJ;
  }
  // agora que, ainda que, então que, mais que; but after an article the adverb stands for a noun: "foi o mais que pôde".
  if (pp === 'adverb') {
    const PP = q.words[q.at - 2];
    return PP && !P.before && ['article', 'contraction'].includes(posOf(PP)) ? PRON : CONJ;
  }
  if (result(q)) return CONJ;
  if (pp === 'pronoun') {
    // não menos que, nada menos que: than.
    if (pl === 'menos' || pl === 'mais') return CONJ;
    // A subject after its verb, and que what the verb says: "Dizem elles que …", "Supponha você que está no seminario";
    // but ser's is the relative: "Fui eu que cancei primeiro".
    const PP = q.words[q.at - 2];
    if (PP && !P.before && posOf(PP) === 'verb' && SUBJECTS.has(keyOf(P)) && !['ser', 'estar'].includes(keyOf(PP))) return CONJ;
    return PRON;
  }
  if (pp === 'noun' || pp === 'name' || pp === 'proper noun') {
    // uma vez que, a primeira vez que, cada vez que: "that", "when".
    if (pl === 'vez' || pl === 'vezes') return CONJ;
    // A bare noun after ser: "É verdade que tambem gostava de mim", "era tempo que".
    const PP = q.words[q.at - 2];
    if (pp === 'noun' && PP && !P.before && keyOf(PP) === 'ser') return CONJ;
    if (toldTo(q)) return CONJ;
    return PRON;
  }
  if (pp === 'adjective') {
    // melhor que a ama, mais forte que o outro, tão contente que trocou o homem: than, or the result.
    if (COMPARATIVE.has(pl)) return CONJ;
    const PP = q.words[q.at - 2];
    if (PP && !P.before && ['mais', 'menos', 'tão', 'tanto', 'assim'].includes(PP.low)) {
      // But "o mais velho que" is the relative after the article.
      const PPP = q.words[q.at - 3];
      return (PP.low === 'mais' || PP.low === 'menos') && PPP && !PP.before && ['article', 'contraction'].includes(posOf(PPP)) ? PRON : CONJ;
    }
    // An adjective after a verb says what is good, possible or certain: "É bom que te sintas na alma do outro", "Não me
    // parece bonito que o nosso Bentinho ande mettido nos cantos". After a noun or an article it is the relative: "a
    // emoção nova que me fazia assim", "a primeira que lhe beijava a mão".
    return PP && !P.before && posOf(PP) === 'verb' ? CONJ : PRON;
  }
  if (pp === 'determiner') {
    // taes e tantas que, é certo que; but "outros que tambem traziam tocha", "esta que o deslumbrava".
    if (RESULT.has(pl)) return CONJ;
    if (pl === 'certo' || pl === 'certa') return CONJ;
    return PRON;
  }
  return null;
}

/**
 * se: the conjunction "if, whether", or the pronoun "oneself" that goes before its verb. A clitic never starts a clause,
 * never stands before an article, a subject or não unless something draws it there, and never after a verb (it would be
 * joined to it: sentou-se).
 */
function se(q: ContextQuery): Choice {
  const P = q.at > 0 ? q.words[q.at - 1] : undefined;
  const N = q.next;
  // Nothing after it but a mark: "Era como se, tendo confiado a alguem …", "se, porém …".
  if (q.word.after) return CONJ;
  if (!N) return null;
  if (P && P.low === 'se' && !q.word.before) return PRON;  // "queria ver se se podiam chamar assim"
  const n = N.low;
  // Before a subject, an article, a name, a noun or an adverb: "se o rosto é egual", "se eu os tinha", "se Capitú achasse
  // longe", "se nunca os vira". o, a, os, as never follow the pronoun se.
  if (['o', 'a', 'os', 'as'].includes(n)) return CONJ;
  if (!CLITICS.has(n) && n !== 'não') {
    if (!N.readings.length) return null;
    if (!canBeVerb(N) || N.name || SUBJECTS.has(keyOf(N))) return CONJ;
  }
  const v = verbAfter(q);
  // The head of a clause: "Se precisa de absolvição, está absolvido", "Deus me perdoe, se a julgo mal".
  if (q.sentenceStart || !P || q.word.before) return CONJ;
  const pl = P.low;
  const pp = posOf(P);
  const ifm = !!v && verbIs(v, ifMood);
  // After a verb, whether: "Não sei se disse que isto se passava", "perguntou se estava no seminario".
  if (pp === 'verb') return CONJ;
  // como se: "as if" before the subjunctive ("como se fossem gente"), the pronoun before the indicative ("como se diz",
  // "o diabo não é tão feio como se pinta").
  if (pl === 'como') return ifm ? CONJ : PRON;
  // e se, ou se, mas se: "e se estava bom de todo", "ou se fez ambas as cousas", "mas se foi certo".
  if (['e', 'ou', 'mas', 'porém'].includes(pl)) return CONJ;
  // The imperfect or future subjunctive is "if" after an adverb ("Tambem se não vier em um anno …"), not after what draws
  // the pronoun before its verb: que, quando, não, a subject ("disse ao filho que se fosse embora", "de maneira que não se
  // vissem as horas", "elles se entrelaçassem").
  if (ifm && pp === 'adverb' && pl !== 'não') return CONJ;
  // Otherwise the pronoun before its verb: "não se lembra", "o que se dera entre mim e Capitú", "para se mostrar
  // esquecido", "quando se zangava".
  return PRON;
}

/** Words that begin what belongs to a noun: "a ideia da paternidade", "as honras delle". */
const OF = /^(?:de|da|do|das|dos|dela|dele|delas|deles|della|delle|dellas|delles)$/;

/**
 * o, a, os, as are no pronoun where a pronoun cannot stand free: at the head of a clause ("A denuncia de José Dias
 * alvoroçara-me"; "o proprio texto, as memorias do amigo"); after a verb, where the pronoun would be joined to it
 * ("precipitavamos as cerimonias", "Pois que não amo a politica"); after mim, ti, si or a contraction ("accendeu nella o
 * desejo de ler"); after a preposition, which takes no finite verb ("com o catalogo na mão"); and before what can only
 * follow a noun: de, não, or a verb of its own ("posto que a ideia da paternidade", "se o papa não tiver", "como se as
 * casas morressem meninas"). The word after may still read as a verb alone: Machado's denuncia, musica and catalogo lack
 * the accent of denúncia, música and catálogo.
 */
function notPronoun(q: ContextQuery): Choice {
  const N = q.next;
  if (!N || N.name || !N.readings.length || !['verb', 'noun', 'adjective'].includes(N.readings[0].pos)) return null;
  const P = q.prev;
  const pp = posOf(P);
  const not: ContextChoice = { prefer: (r) => r.pos !== 'pronoun' && r.pos !== 'interjection', margin: Infinity };
  if (q.sentenceStart) return not;
  if (pp === 'verb' || pp === 'contraction' || (!!P && ['mim', 'ti', 'si'].includes(P.low))) return not;
  if (pp === 'preposition' && !near(N).some(infinitive)) return not;
  // No pronoun before a word that cannot well be a verb: "prova que as ideias arithmeticas são" (idear's ideias is far below
  // the noun).
  if (N.readings[0].pos === 'noun' && !near(N).some(isVerb)) return not;
  // A noun in Machado's spelling counts, however far below its verb look-alike: "em que a opera fosse executada".
  const nounNext = near(N).some((r) => r.pos === 'noun' || r.pos === 'adjective') || nounReadings(N).some((r) => r.pos === 'noun');
  const after = q.words[q.at + 2];
  const ofAfter = !!after && !after.before && (OF.test(after.low) || after.low === 'não');
  const verbAfterNext = !!after && !after.before && after.readings.length > 0 && near(after).every(isFiniteVerb);
  // After a comma Machado may still set the pronoun first ("os meus acreditam, o esperam"), so only before a noun or what
  // follows one: "Quando as bonecas de Capitú adoeciam, o medico era eu".
  if (q.word.before) return nounNext || ofAfter || verbAfterNext ? not : null;
  // After a subject pronoun or a negation the pronoun comes before its verb: "agora que eu a via de dias a dias".
  if (!P || SUBJECTS.has(keyOf(P)) || ['não', 'nunca', 'já', 'também', 'tambem', 'só'].includes(P.low)) return null;
  if (nounNext && (ofAfter || verbAfterNext)) return not;
  return null;
}

/**
 * a and o before an infinitive. a is the preposition after a verb or a comma ("enfiou a linha na agulha, e entrou a
 * coser"; "passo a escrever o livro"; "estive a ouvir"), o the article of the infinitive as a noun ("o pintar e vestir das
 * pessoas"). After a preposition or what draws a pronoun before the verb they are the pronoun: "para a ver".
 */
function beforeInfinitive(q: ContextQuery): Choice {
  const N = q.next;
  if (!N || N.name || !N.readings.length || !infinitive(N.readings[0])) return null;
  const P = q.prev;
  const drawn = pronounBefore(P);
  // A noun spelled like the infinitive takes the article: "a dor"; "com o andar da opera", with de after it, but "o desejo
  // de o saber" is "to know it".
  const after = q.words[q.at + 2];
  const ofAfter = !!after && !after.before && /^(?:de|da|do|das|dos)$/.test(after.low);
  if (near(N).some((r) => r.pos === 'noun' && (q.word.low === 'o' || r.gender.includes('f'))) && (!drawn || ofAfter)) return null;
  if (q.word.low === 'a') return drawn ? PRON : as('preposition');
  return drawn ? PRON : as('article');
}

/** A verb form a finite verb could be here, more than a noun: "Deus nos livre", "Ella nos disse". */
function verbHere(w: ContextWord, subjectBefore: boolean): boolean {
  const rs = near(w);
  const verb = rs.filter((r) => isFiniteVerb(r)).reduce((m, r) => Math.max(m, r.score), -Infinity);
  if (verb === -Infinity) return false;
  if (subjectBefore) return true;
  const other = rs.filter((r) => !isVerb(r)).reduce((m, r) => Math.max(m, r.score), -Infinity);
  return verb > other + 2;
}

/** nos: "us" before a verb ("os cuidados que nos deu", "Deus nos livre"), "in the" before a noun ("nos quartos"). */
function nos(q: ContextQuery): Choice {
  const N = q.next;
  if (!N || !q.word.readings.some((r) => r.pos === 'pronoun' && r.key === 'nos')) return null;
  const P = q.prev;
  const subject = !!P && (['name', 'noun', 'pronoun', 'proper noun'].includes(posOf(P)) || ['não', 'que', 'se', 'já', 'também', 'nunca', 'quem'].includes(P.low));
  return verbHere(N, subject) ? { prefer: (r) => r.pos === 'pronoun' && r.key === 'nos', margin: Infinity } : as('contraction');
}

/** The person a pronoun joined to or set before its verb is of: me "first-person singular". */
const PERSON: Record<string, RegExp> = {
  me: /^first-person singular\b/, te: /^second-person singular\b/, nos: /^first-person plural\b/, vos: /^second-person plural\b/,
};
/**
 * The verb is of that person and no other: sentei, despedi, fui are only "I", but disse is "I said" and "he said", and
 * "disse-me" is far more often "he told me". An imperative spelled alike does not count: despedi is also "dismiss!" to
 * vós, but "Emfim, despedi-me" is "I said goodbye".
 */
const onlyPerson = (p: string) => (r: ContextReading): boolean => {
  if (!isVerb(r) || !r.form) return false;
  const parts = r.form.split('; ').filter((f) => !/\bimperative\b/.test(f));
  return parts.length > 0 && parts.every((f) => PERSON[p].test(f));
};

/** Adverbs between ir and where it goes or what it goes to do: "foi logo falar", "foram então estudar". */
const GOING_ADVERBS = new Set(['logo', 'então', 'já', 'depois', 'hoje', 'ainda', 'também', 'tambem', 'cedo', 'primeiro', 'amanhã', 'agora']);
/** fui, foi, foram, fosse: ir "to go" (not ser "to be") where it goes somewhere or does something. */
function serOrIr(q: ContextQuery): Choice {
  const rs = near(q.word);
  // fóra "outside" stays the adverb.
  if (!['ser', 'ir'].includes(q.word.readings[0]?.key ?? '') || !rs.some((r) => r.key === 'ir') || !rs.some((r) => r.key === 'ser')) return null;
  const toIr = (reflexive?: boolean): ContextChoice => ({ prefer: (r) => r.key === 'ir', margin: Infinity, reflexive });
  // fui-me, foi-se: ser takes no pronoun of its own ("trepei ainda uma vez ao cavallo magro de D'Artagnan e fui-me ás
  // aventuras", "foi-se embora"); but "foi-me dito" is the passive, "me" there the one told.
  const own = /^[^-]+-(me|se|nos)$/.exec(q.word.low)?.[1];
  const N = q.next;
  if (own && (own === 'se' || verbIs(q.word, onlyPerson(own)))) return toIr(true);
  if (!N || q.word.after) return null;
  // Past an adverb or the subject (and its mesmo): "Foi logo falar ao pae", "Fui eu mesmo levar-lhe o recado". "Foi então
  // que" and "foi elle mesmo que" stay ser.
  let k = q.at + 1;
  while (k < q.at + 4 && k < q.words.length - 1 && !q.words[k].after && !q.words[k + 1].before
    && (GOING_ADVERBS.has(q.words[k].low) || SUBJECTS.has(keyOf(q.words[k])) || /^mesm[oa]s?$/.test(q.words[k].low))) k++;
  const W = q.words[k];
  if (!W || W.before) return null;
  // To a place: "fui á casa visinha", "foi ao seminario", "Quando fomos para a casa", "foi lá", "foi embora". Not "foi para
  // mim" (was for me).
  if (['ao', 'aos', 'à', 'á', 'às', 'ás', 'lá', 'cá', 'embora', 'ali', 'alli', 'acolá'].includes(W.low)) return toIr();
  if (W.low === 'para' || W.low === 'pra') {
    const after = q.words[k + 1];
    return after && !after.before && ['mim', 'ti', 'si', 'nós', 'vós'].includes(after.low) ? null : toIr();
  }
  // a with no article: "A senhora nunca foi a casa de barbeiro?", "foi a bordo recebê-lo", "consentiu que eu fosse a pé", "se
  // acaso fosse a Roma". "foi a ultima vez" has the article, and stays ser.
  const after = q.words[k + 1];
  if (W.low === 'a' && after && !after.before && !W.after) {
    const rs = near(after).filter((r) => r.pos !== 'interjection');
    if (after.low === 'casa' || after.name || (rs.length && !rs.some(isVerb) && rs.every(notFeminineSingular))) return toIr();
  }
  // To do something, or going on doing it: "todos os antigos foram estudar", "foi ter com ella", "calou-se também, e foi
  // andando".
  const top = W.readings[0];
  if (top && (gerund(top) || (infinitive(top) && !near(W, 2).some((r) => r.pos === 'noun')))) return toIr();
  return null;
}

/**
 * A verb with a pronoun of its own person, joined (sentei-me) or before it (me sentei), takes its reflexive sense: "Sentei-me
 * á mesa" (Missa do Galo) "I sat down", "Emfim, despedi-me" (Dom Casmurro) "I said goodbye", not "to seat", "to dismiss".
 */
function ownPerson(q: ContextQuery): Choice {
  // se joined to a form that is the third person's present and also the imperative of tu (ergue, levanta, volta) is the
  // third person's: "A virgem ergue-se de um impeto" (Iracema) "gets up", not "raise yourself!".
  if (/^[^-]+-se$/.test(q.word.low)) {
    const third = (r: ContextReading): boolean => isVerb(r) && /\bthird-person [a-z ]*present indicative\b/.test(r.form)
      && /\bimperative\b/.test(r.form);
    return near(q.word).some(third) ? { prefer: third, margin: CONTEXT_MARGIN, reflexive: true } : null;
  }
  const joined = /^[^-]+-(me|te|nos|vos)\b/.exec(q.word.low)?.[1];
  const p = joined ?? (q.prev && PERSON[q.prev.low] ? q.prev.low : undefined);
  if (!p || !verbIs(q.word, onlyPerson(p))) return null;
  return { prefer: onlyPerson(p), margin: joined ? CONTEXT_MARGIN : Infinity, reflexive: true };
}

/**
 * ir with se or me before it is "to go away" only where it goes nowhere else: "assim tambem se vão embora"; but "uma febre,
 * que se ia aggravando" (was getting worse) and "Não se vae a Roma brincando" (one does not go to Rome) are not.
 */
function irAway(q: ContextQuery): Choice {
  const P = q.prev;
  if (!P || !['se', 'me', 'te', 'nos'].includes(P.low) || q.word.readings[0]?.key !== 'ir') return null;
  const N = q.next;
  const away = !N || q.word.after !== '' || N.low === 'embora';
  return { prefer: (r) => r.key === 'ir', margin: CONTEXT_MARGIN, reflexive: away };
}

/** tivemos, tivera: ter's forms, not estar's clipped colloquial ones (tá, tava), which are spelled alike. */
function terNotEstar(q: ContextQuery): Choice {
  const rs = near(q.word);
  if (q.word.low.startsWith('est') || !rs.some((r) => r.key === 'ter') || !rs.some((r) => r.key === 'estar')) return null;
  return { prefer: (r) => r.key === 'ter', margin: Infinity };
}

/**
 * Verbs a bare infinitive follows: "quiz saber", "fazia-o parecer mais velho", "vou jantar com você", "não se fartavam de
 * olhar" has de; these have nothing between.
 */
const BARE_INFINITIVE = new Set(['poder', 'dever', 'querer', 'saber', 'fazer', 'deixar', 'ver', 'ouvir', 'sentir', 'mandar', 'ir',
  'vir', 'costumar', 'conseguir', 'tentar', 'preferir', 'desejar', 'esperar', 'ousar', 'pretender', 'parecer', 'procurar',
  'precisar', 'soer', 'tencionar', 'buscar']);

/**
 * An infinitive that is also a noun (olhar "gaze", andar "floor", falar "speech", parecer "opinion") is the verb after the
 * preposition a and after a verb that takes a bare infinitive: "ficámos a olhar um para o outro", "continuou a andar e a
 * falar" (Dom Casmurro), "fazia-o parecer mais velho" (A cartomante).
 */
function infinitiveAfter(q: ContextQuery): Choice {
  const P = q.prev;
  const c = P?.chosen;
  if (!c || q.word.name) return null;
  const rs = near(q.word);
  // An infinitive ends in r: the verb headword crescendo ("growing", a borrowing) is no infinitive of "ia crescendo".
  const inf = (r: ContextReading): boolean => infinitive(r) && /r$/.test(r.key);
  if (!rs.some(inf) || !rs.some((r) => r.pos === 'noun')) return null;
  const verbBefore = isFiniteVerb(c) && BARE_INFINITIVE.has(c.key);
  return (P.low === 'a' && c.pos === 'preposition') || verbBefore ? { prefer: inf, margin: Infinity } : null;
}

/**
 * Readings a word may plausibly have here: those near its likeliest, and a noun or adjective in Machado's own spelling
 * however far below (noticia notícia, opera ópera, memoria memória, titulo título), which the verb they also spell
 * (noticiar, operar, memoriar, titular) outscores alone.
 */
const OLD_SPELLING = /\b(?:alternative form|obsolete|old spelling)\b/;
function nounReadings(w: ContextWord): ContextReading[] {
  const top = w.readings[0]?.score ?? 0;
  return w.readings.filter((r) => (r.pos === 'noun' || r.pos === 'adjective')
    && (r.score > top - CONTEXT_MARGIN || (OLD_SPELLING.test(r.form) && r.score > top - 9)));
}

/**
 * Words after which a noun comes, as read: the article, the indefinite article, a possessive, and a preposition joined to the
 * article (do, na, pelo, num) or to a demonstrative (deste, naquella). Not este, esse, aquelle alone, which stand for a
 * noun before a verb ("Este era homem de fortes qualidades").
 */
const INTRODUCERS = new Set(['um', 'uma', 'uns', 'umas', 'meu', 'minha', 'meus', 'minhas', 'teu', 'tua', 'teus', 'tuas', 'seu', 'sua',
  'seus', 'suas', 'nosso', 'nossa', 'nossos', 'nossas', 'vosso', 'vossa', 'vossos', 'vossas', 'do', 'da', 'dos', 'das', 'no', 'na',
  'nos', 'nas', 'ao', 'aos', 'à', 'á', 'às', 'ás', 'pelo', 'pela', 'pelos', 'pelas', 'num', 'numa', 'nuns', 'numas', 'dum', 'duma',
  'deste', 'desta', 'destes', 'destas', 'desse', 'dessa', 'desses', 'dessas', 'neste', 'nesta', 'nestes', 'nestas', 'nesse',
  'nessa', 'nesses', 'nessas', 'daquele', 'daquela', 'daqueles', 'daquelas', 'daquelle', 'daquella', 'daquelles', 'daquellas',
  'naquele', 'naquela', 'naqueles', 'naquelas', 'naquelle', 'naquella', 'naquelles', 'naquellas', 'qualquer', 'quaisquer',
  'todo', 'toda', 'algum', 'alguma', 'nenhum', 'nenhuma', 'tal', 'taes', 'tais', 'certo', 'certa']);
function introduces(w: ContextWord | undefined): boolean {
  const c = w?.chosen;
  if (!w || !c || w.name) return false;
  if (c.pos === 'article') return true;
  // "algum caso" though algum was read as the pronoun "someone".
  return INTRODUCERS.has(w.low) && c.pos !== 'verb';
}

/** An adjective and a noun agree, as far as their forms say: boa memória, velho costume, simples notícia. */
function agrees(adjective: ContextReading, noun: ContextReading): boolean {
  const plural = (r: ContextReading): boolean => /\bplural\b/.test(r.form) || r.gender === 'pl';
  if (plural(adjective) !== plural(noun) && /\b(?:singular|plural)\b/.test(adjective.form)) return false;
  if (/\bfeminine\b/.test(adjective.form)) return !noun.gender || noun.gender.includes('f');
  if (/\bmasculine\b/.test(adjective.form) || (!adjective.form && /o$/.test(adjective.key))) return !noun.gender || noun.gender.includes('m');
  return true;
}

/**
 * After an article, a possessive or another word that a noun follows, and after an adjective that follows one, a verb or
 * a conjunction cannot stand: "a minha opera" is ópera, "A simples noticia" notícia, "uma grande opera", "boa memoria",
 * "em todo caso" a case, not caso "if". But an adjective before an infinitive says what it is to do it: "é bom saber",
 * "não era preciso falar alto". And a feminine noun of its own is the noun, not the feminine of an adjective, where no noun
 * follows for that adjective to describe: "qualquer suspeita" suspicion (not suspeito "suspicious"), "uma senhora mineira"
 * a lady (not senhor "great"), "as escravas riam".
 */
function nounAfter(q: ContextQuery): Choice {
  const P = q.prev;
  if (!P || q.word.name) return null;
  const direct = introduces(P);
  let viaAdjective = false;
  if (!direct && P.chosen?.pos === 'adjective' && !P.before) {
    const PP = q.words[q.at - 2];
    viaAdjective = introduces(PP) || (!!PP && ['de', 'com', 'em', 'por', 'sem'].includes(PP.low)) || (!!PP?.chosen && isVerb(PP.chosen));
  }
  if (!direct && !viaAdjective) return null;
  const top = q.word.readings[0];
  const rs = nounReadings(q.word);
  if (!top || !rs.length) return null;
  // Past an adjective, a noun it agrees with: "boa memoria", "velho costume"; not "dos nadas veiu" (vir), whose veio "vein"
  // is masculine and singular.
  const nouns = rs.filter((r) => r.pos === 'noun' && (!viaAdjective || agrees(P.chosen!, r)));
  // "toda parada" (all stopped), "todo cheio": todo before a participle or an adjective says how much, and no noun follows.
  const all = /^tod[oa]s?$/.test(P.low);
  if (top.pos === 'verb' || top.pos === 'conjunction') {
    if (viaAdjective && infinitive(top)) return null;
    if (all && /\bparticiple\b/.test(top.form)) return null;
    // A participle before a noun describes it: "a minha querida mamãe", "sua querida filha".
    if (/\bparticiple\b/.test(top.form) && q.next?.readings[0]?.pos === 'noun') return null;
    return nouns.length ? { prefer: (r) => nouns.includes(r), margin: Infinity } : null;
  }
  // Nothing after it the adjective could describe: an end, a mark, a word that is no noun ("tal suspeita não ia"), or an
  // adjective of its own ("uma senhora mineira"); not "uma longa demora", "as longas e trabalhadas viagens".
  const N = q.next;
  const afterN = q.words[q.at + 2];
  const free = !N || (N.readings.length > 0 && !N.name && (N.readings[0].pos === 'adjective' || !nounReadings(N).some((r) => r.pos === 'noun'))
    && !(['e', 'ou'].includes(N.low) && afterN && !afterN.before
      && afterN.readings.some((r) => r.pos === 'adjective' || /\bparticiple\b/.test(r.form))));
  if (!direct || all || top.pos !== 'adjective' || !free) return null;
  // A feminine noun near the adjective's score ("A ultima foi de duzentos" is the last one, not última "recent news"), or
  // the noun in Machado's spelling: "o contracto" is contrato, not the adjective contracto "contracted".
  // Not segunda-feira "Monday" for "a segunda" (the second one).
  const near5 = nouns.filter((r) => r.score > top.score - CONTEXT_MARGIN && r.key !== top.key && !r.key.includes('-'));
  const own = near5.filter((r) => /\bfeminine\b/.test(top.form) ? /a$/.test(r.key) : OLD_SPELLING.test(r.form));
  return own.length ? { prefer: (r) => own.includes(r), margin: Infinity } : null;
}

/**
 * A finite verb, not the noun era or vale, after a pronoun joined to de or em (dela, dele, nella), which follows its noun
 * and is no article: "Tudo nela era atenuado e passivo" (Missa do Galo), "O rosto della era agora sereno", "A agitação dele
 * era grande" (A cartomante). After a verb, a word that is a noun or another finite verb is the noun: "pediu-lhes
 * noticias", "tinha memoria para guardal-as".
 */
const OF_PRONOUN = /^(?:[dn]el[ae]s?|[dn]ell[ae]s?)$/;
const COPULAS = new Set(['ser', 'estar', 'ficar', 'parecer']);
function verbAfterOf(q: ContextQuery): Choice {
  const P = q.prev;
  if (!P || !P.chosen || q.word.name) return null;
  const rs = near(q.word);
  const all = q.word.readings;
  if (OF_PRONOUN.test(P.low) && rs.some(isFiniteVerb) && all.some((r) => !isVerb(r))) return { prefer: isFiniteVerb, margin: Infinity };
  // After ser, ficar, estar a feminine adjective, not a noun of its own spelled alike: "ela, que era apenas simpática, ficou
  // linda" (Missa do Galo) is lindo "beautiful", not linda "cachaça".
  const N = q.next;
  if (isVerb(P.chosen) && COPULAS.has(P.chosen.key) && q.word.readings[0]?.pos === 'noun' && !OF.test(N?.low ?? '')
    && N?.readings[0]?.pos !== 'adjective') {
    // Only one near the noun, and with no adjective after it to describe the noun: "era moça inteira" stays a girl.
    const top = q.word.readings[0];
    const feminine = rs.filter((r) => r.pos === 'adjective' && /\bfeminine\b/.test(r.form) && r.key !== top.key && r.score > top.score - 2);
    if (feminine.length) return { prefer: (r) => feminine.includes(r), margin: Infinity };
  }
  if (isVerb(P.chosen) && !/\bparticiple\b/.test(P.chosen.form) && q.word.readings[0]?.pos === 'verb') {
    const verbs = rs.filter(isVerb);
    // After ser, estar, ficar what it is: "as cores que eram vivas" (vivo "bright", not viver).
    const copula = COPULAS.has(P.chosen.key);
    const others = nounReadings(q.word);
    const adjectives = others.filter((r) => r.pos === 'adjective');
    const pick = copula && adjectives.length ? adjectives : others.filter((r) => r.pos === 'noun');
    if (pick.length && verbs.length && verbs.every(isFiniteVerb)) return { prefer: (r) => pick.includes(r), margin: Infinity };
  }
  return null;
}

/**
 * A word that is a noun or a finite verb (vale "valley" or "is worth") is the verb before its object, where nothing before it
 * asks for a noun: "fechadinhos ambos, vale o carro de Apolo" (A cartomante), "Então vale alguma cousa?", "esta pagina vale
 * por mezes" (Dom Casmurro).
 */
function verbBeforeObject(q: ContextQuery): Choice {
  const N = q.next;
  const top = q.word.readings[0];
  if (!N || !top || top.pos !== 'noun' || q.word.name) return null;
  const finite = near(q.word).filter((r) => isFiniteVerb(r) && /\bthird-person (?:singular|plural) present indicative\b/.test(r.form));
  if (!finite.length) return null;
  const P = q.prev;
  const pp = posOf(P);
  if (P && (introduces(P) || ['article', 'determiner', 'preposition', 'contraction', 'adjective', 'numeral'].includes(pp))) return null;
  const article = (['article', 'determiner'].includes(N.readings[0]?.pos ?? '') || /^(?:algu|nenhu|muit|pouc|tant)/.test(N.low)) && !N.name;
  // After a verb the noun is its object ("Só lhe achava desculpa por não ter"), unless an object of its own follows: "O
  // presente que se ignora vale o futuro".
  if (pp === 'verb') return article ? { prefer: (r) => finite.includes(r), margin: Infinity } : null;
  const object = article || ['por', 'mais', 'menos', 'sempre', 'nada', 'tudo', 'isso', 'isto'].includes(N.low);
  return object ? { prefer: (r) => finite.includes(r), margin: Infinity } : null;
}

/**
 * An infinitive with me, te or nos joined to it is reflexive when the verb it follows is of that person: "Fui sentar-me na
 * cadeira" (Missa do Galo) is "to sit down", "quis levantar-me" "to get up", "torno a deitar-me" "to lie down"; but "Vem
 * dizer-me" (he comes to tell me) is not.
 */
function infinitiveReflexive(q: ContextQuery): Choice {
  const joined = /^[^-]+-(me|te|nos)$/.exec(q.word.low)?.[1];
  if (!joined || !verbIs(q.word, infinitive)) return null;
  // "cuido haver-me provocado um gesto": the auxiliary of a compound tense, me its object.
  if (near(q.word).some((r) => r.key === 'haver' || r.key === 'ter')) return null;
  for (let i = q.at - 1, n = 0; i >= 0 && n < 3; i--, n++) {
    const w = q.words[i];
    const c = w.chosen;
    if (q.words[i + 1].before) return null;
    // quis, queria, podia are "I" and "he": "Quis dar-me um abraço" is he; only with eu in the sentence is it I ("Escobar,
    // disse eu, indo pôr-me embaixo da janella").
    if (c && isFiniteVerb(c)) {
      const own = verbIs(w, onlyPerson(joined)) || (verbIs(w, canBePerson(joined)) && q.words.slice(0, q.at).some((x) => keyOf(x) === SUBJECT_OF[joined]));
      return own ? { prefer: infinitive, margin: CONTEXT_MARGIN, reflexive: true } : null;
    }
  }
  return null;
}
const SUBJECT_OF: Record<string, string> = { me: 'eu', te: 'tu', nos: 'nós' };
/** The verb form may be of that person: quis is "I wanted" or "he wanted", fui only "I went". */
const canBePerson = (p: string) => (r: ContextReading): boolean => isVerb(r) && !!r.form && r.form.split('; ').some((f) =>
  !/\bimperative\b/.test(f) && (p === 'me' ? /\bfirst(?:\/third)?-person singular\b/ : p === 'te' ? /\bsecond-person singular\b/ : /\bfirst-person plural\b/).test(f));

export function portugueseContext(q: ContextQuery): Choice {
  const w = q.word.low;
  if (w === 'que') return que(q);
  if (w === 'se') return se(q);
  if (w === 'nos') return nos(q);
  if (w === 'a' || w === 'o' || w === 'os' || w === 'as') {
    // After que read as "than" the article, not the pronoun: "Em casa brincava de missa, mas era melhor que a ama" is
    // "than the nurse", not "than loves her".
    const P = q.prev;
    // But "por mais que a sacudisse" (however much he shook her) is concessive, and takes the pronoun.
    // Only before a noun it agrees with, or what follows a noun: "mais forte que o ribombo do mar", but "mais do que o reli
    // no dia" (than I read it again), "melhor do que os tinha vivido".
    const c = P?.low === 'que' && P.chosen?.pos === 'conjunction' ? compared({ ...q, at: q.at - 1, word: P, prev: q.words[q.at - 2], next: q.word }) : -1;
    const N = q.next;
    const after = q.words[q.at + 2];
    const fem = w.startsWith('a');
    const plural = w.endsWith('s');
    const noun = !!N && N.readings.some((r) => r.pos === 'noun' && r.gender.includes(fem ? 'f' : 'm') && /\bplural\b/.test(r.form) === plural);
    if (c >= 0 && q.words[c - 1]?.low !== 'por' && (noun || (!!after && !after.before && OF.test(after.low)))) {
      return { prefer: (r) => r.pos === 'article', margin: Infinity };
    }
    if (w === 'a') return prepositionA(q) ?? beforeInfinitive(q) ?? notPronoun(q);
    return (w === 'o' ? beforeInfinitive(q) : null) ?? notPronoun(q);
  }
  if (w === 'quiz' && q.word.readings.some(isVerb)) {
    // Machado's quiz is quis, querer's "wanted": "Não quiz; preferiu ficar perto da egreja". The noun quiz needs an article.
    return ['article', 'determiner', 'contraction'].includes(posOf(q.prev)) ? null : { prefer: isVerb, margin: Infinity };
  }
  if (w === 'todos' || w === 'todas') {
    // "todos os documentos", "todas as cousas", "todos elles": all, before what it counts; alone it is "everyone".
    const N = q.next;
    return N && ['article', 'determiner', 'contraction'].includes(N.readings[0]?.pos ?? '') || (N && SUBJECTS.has(keyOf(N)))
      ? as('determiner') : null;
  }
  const whole = (r: ContextReading): boolean => r.pos === 'adjective' && r.key === 'todo';
  if ((w === 'todo' || w === 'toda') && q.next && ['o', 'a', 'um', 'uma'].includes(q.next.low) && q.word.readings.some(whole)) {
    // Before the article, the whole of it: "toda a gente estava nos quartos", "recapitulou todo o mal que pensava".
    return { prefer: whole, margin: Infinity };
  }
  if (w === 'quer') {
    // quer … quer "whether … or", and the indefinite "o que quer que", "como quer que seja"; anywhere else querer's
    // "wants": "Mamãe quer que eu seja padre", "Papae quer ver?".
    const P = q.prev;
    const indefinite = q.next?.low === 'que' && !!P && ['que', 'quem', 'como', 'onde', 'quando'].includes(P.low);
    if (q.words.some((x, i) => i !== q.at && x.low === 'quer') || indefinite) return CONJ;
    return q.word.readings.some(isVerb) ? { prefer: isVerb, margin: Infinity } : null;
  }
  if (w === 'pois' && q.sentenceStart) {
    // Opening a sentence it is "so, well": "Pois eu hei de crer...?", "Pois seja obrigação"; in a clause, "because".
    return q.word.readings.some((r) => r.pos === 'adverb') ? as('adverb') : null;
  }
  if (w === 'fóra' && q.word.readings.some((r) => r.pos === 'adverb')) {
    // Machado writes the adverb fóra ("cá fóra", "fóra de casa") and the verb fôra, fòra: the accent tells them apart.
    return as('adverb');
  }
  if (w === 'gente') {
    // "a gente" with a verb is "we, one" (quando a gente cuidava tel-os); anywhere else people: "mais gente", "como se
    // fossem gente", "toda a gente".
    const N = q.next;
    return q.prev?.low === 'a' && q.words[q.at - 2]?.low !== 'toda' && N && near(N).some(isFiniteVerb) ? null : as('noun');
  }
  if (w === 'tarde') {
    // A noun after what stands before a noun ("uma celebre tarde de Novembro", "naquella tarde", "Hoje de tarde"), the
    // adverb "late" after a verb or an adverb: "É tarde", "devia ser muito tarde", "entrou tarde".
    const pp = posOf(q.prev);
    const PP = q.prev ? q.words[q.at - 2] : undefined;
    const noun = ['article', 'determiner', 'contraction', 'preposition', 'adjective', 'numeral'].includes(pp)
      || q.next?.low === 'de' || (!!PP && ['article', 'determiner'].includes(posOf(PP)));
    return noun ? as('noun') : as('adverb');
  }
  if (w === 'ora') {
    // ora … ora "now … now": "ora no Flamengo, ora na Gloria". Alone at the head of a sentence, "well": "Ora, medo!", "Ora
    // esta!"; elsewhere "now": "Os mesmos sonhos que ora conto".
    if (q.words.some((x, i) => i !== q.at && x.low === 'ora')) return CONJ;
    return q.sentenceStart || q.word.before ? as('interjection') : as('adverb');
  }
  if (w === 'como' && q.question) {
    // How, asking, before its verb: "Como passou a noite?", "E como havia de saber que Deus me dispensava?", "Capitú
    // como vae?". Not the comparison: "tão culpada como Capitú?", "não seriam para mim como rimas das estrellas".
    const N = q.next;
    const compared = q.words.slice(0, q.at).some((x) => RESULT.has(x.low));
    return !compared && (!N || N.readings[0]?.pos === 'verb') ? as('adverb') : null;
  }
  if (w === 'd.') {
    // Dona before a woman's name (D. Gloria, D. Fortunata, D. Conceição), Dom before a man's (D. Pedro, D. João).
    const N = q.next;
    if (!N) return null;
    const head = /o$/.test(N.low) && !/ção$/.test(N.low) ? 'Dom' : 'Dona';
    return q.word.readings.some((r) => r.head === head) ? { prefer: (r) => r.head === head, margin: Infinity } : null;
  }
  if (w === 's.') {
    // São or Santo before a man's name, Santa before a woman's: "o dito de S. Paulo", "Póde ir a S. Paulo"; never segunda-feira.
    const N = q.next;
    // Not S. Alteza, S. Magestade (Sua): a title, which the dictionary has as a noun.
    if (!N || !N.name || N.readings.some((r) => r.pos === 'noun')) return null;
    const key = /a$/.test(N.low) ? 'santa' : 'santo';
    return q.word.readings.some((r) => r.key === key) ? { prefer: (r) => r.key === key, margin: Infinity } : null;
  }
  if (w === 'mesmo') {
    // Emphatic after a verb, an adverb, a pronoun or a contraction standing for one: "ha mesmo necessidade" (really), "antes
    // mesmo da administração interina" (even), "é isso mesmo" (that very thing). After an article or before a noun it is
    // "same": "o mesmo aspecto", "nesse mesmo capitulo".
    const pp = posOf(q.prev);
    const pronoun = pp === 'pronoun' && !['o', 'a', 'os', 'as', 'que'].includes(q.prev!.low);
    // nisso, disso, daquillo stand for a pronoun; no, do, nesse for an article or a determiner ("no mesmo passo").
    const emphatic = pp === 'verb' || pp === 'adverb' || pronoun || /^[nd](?:isso|isto|aquilo|aquillo)$/.test(q.prev?.low ?? '');
    return emphatic && q.word.readings.some((r) => r.pos === 'adverb') ? as('adverb') : null;
  }
  if (w === 'tu' && q.word.readings.some((r) => r.pos === 'pronoun')) {
    // The pronoun "you" ("— Tu crês deveras nessas cousas?", "a vocação eras tu"), not the interjection of a telephone's
    // tone, which comes in a row: "tu, tu, tu".
    const row = [q.words[q.at - 1], q.words[q.at + 1]].some((x) => x?.low === 'tu');
    return row ? null : PRON;
  }
  if (w === 'si' && q.word.readings.some((r) => r.pos === 'pronoun') && (posOf(q.prev) === 'preposition' || /^(?:mesm|propri|própri)/.test(q.next?.low ?? ''))) {
    // After a preposition, "oneself": "tornou a si", "a si propria", "mataria a si e a Desdemona"; not the note si.
    return PRON;
  }
  if (w === 'consigo' || w === 'comsigo') {
    // "with him(self)" after the verb or what it describes ("pedi-lhe que me levasse consigo", "como se falasse consigo",
    // "calado e mettido comsigo"); conseguir's "I manage" before an infinitive or after não ("Não consigo dormir").
    const c = q.prev?.chosen;
    const own = (r: ContextReading): boolean => r.pos !== 'verb' && r.key.endsWith('sigo');
    if (c && (isVerb(c) || c.pos === 'adjective') && !(q.next && verbIs(q.next, infinitive)) && q.word.readings.some(own)) return { prefer: own, margin: Infinity };
    return null;
  }
  {
    // An adverb spelled like a second-person pluperfect (deveras "really", dever's "thou hadst owed"): the adverb, as the
    // pluperfect of thou is all but absent from narration. "— Tu crês deveras nessas cousas?" (A cartomante).
    const rs = q.word.readings;
    const adverb = rs.find((r) => r.pos === 'adverb' && r.key === w);
    if (adverb && rs[0].pos === 'verb' && rs.filter(isVerb).every((r) => /^second-person (?:singular|plural) pluperfect\b/.test(r.form))) return as('adverb');
  }
  // After the relative que, a word that can be a verb is one ("o centro que falta"); after the conjunction or the
  // interrogative, one before its object: "para fingir que vale alguma coisa neste mundo?" and "mas que vale isso?" (Um
  // apólogo) are valer, not vale "valley"; "Eu é que furo o pano" furar, not furo "hole". A bare noun may follow the
  // conjunction ("dizia que missa não era cousa de brincadeira"), and a title the relative ("é dahi que mestre Povo tirou").
  const P = q.prev;
  if (P?.low === 'que' && q.word.readings[0]?.pos === 'noun' && near(q.word).some(isFiniteVerb)) {
    const N = q.next;
    const object = !!N && N.low !== 'que' && ['article', 'determiner', 'pronoun'].includes(N.readings[0]?.pos ?? '');
    if ((P.chosen?.pos === 'pronoun' && !N?.name) || object) return { prefer: isFiniteVerb, margin: Infinity };
  }
  const word = infinitiveAfter(q) ?? nounAfter(q) ?? verbAfterOf(q) ?? verbBeforeObject(q);
  if (word) return word;
  const answer = serOrIr(q) ?? irAway(q) ?? terNotEstar(q) ?? ownPerson(q) ?? infinitiveReflexive(q);
  // The verb after se read as "if" is not reflexive: "se soubesse", "se fosse para o seminario" (went, not went away).
  const afterIf = q.prev?.low === 'se' && q.prev.chosen?.pos === 'conjunction' && canBeVerb(q.word);
  if (afterIf) return answer ? { ...answer, reflexive: false } : { prefer: isVerb, margin: CONTEXT_MARGIN, reflexive: false };
  return answer;
}
