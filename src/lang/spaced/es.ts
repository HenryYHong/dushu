// Spanish. Enclitic pronouns join the verb (dámelo, decirle, sentaos); articles and pronouns tell nouns from verbs.
import type { LangEngine } from '../types';
import { loadSpacedEngine, type LoadOpts, type SpacedLang } from './core';
import { spanishContext } from './es-context';

/**
 * The word without its written accents (acute and grave), keeping the tilde of ñ and the diaeresis of ü: enséña is enseña,
 * not "ensena", so "—A ver, enséñame tu cara" (Marianela) is enseñar + me.
 */
const stripStress = (s: string): string => s.normalize('NFD').replace(/[\u0300\u0301]/g, '').normalize('NFC');

export const SPANISH: SpacedLang = {
  id: 'es',
  script: 'latin',
  enclitics: ['me', 'te', 'se', 'nos', 'os', 'le', 'les', 'lo', 'la', 'los', 'las'],
  encliticStems(stem, first) {
    // The written accent that keeps the stress (dá-me-lo, diciéndo-le) goes when the pronouns do; sentad + os is
    // sentaos and sentemos + nos is sentémonos.
    const plain = stripStress(stem);
    const out = [stem, plain];
    // A stem of more than one syllable in -o with no written accent is the preterite that lost its accent to the pronoun:
    // Galdós's "preguntome varias cosas" is preguntó + me. The present pregunto + me is written pregúntome.
    if (plain === stem && /[aeiu][^aeiou]*o$/.test(stem)) out.unshift(stem.slice(0, -1) + 'ó');
    if (first === 'os') out.push(stem + 'd', plain + 'd');
    if ((first === 'nos' || first === 'se') && stem.endsWith('mo')) out.push(plain + 's');
    return [...new Set(out)];
  },
  // hay: what there is comes next (hay mates "there are gourds", not matar's "you kill").
  beforeNoun: ['hay', 'el', 'un', 'una', 'unos', 'unas', 'mi', 'mis', 'tu', 'tus', 'su', 'sus', 'nuestro', 'nuestra', 'nuestros',
    'nuestras', 'vuestro', 'vuestra', 'vuestros', 'vuestras', 'este', 'esta', 'estos', 'estas', 'ese', 'esa', 'esos', 'esas',
    'aquel', 'aquella', 'aquellos', 'aquellas', 'del', 'al', 'cada', 'otro', 'otra', 'otros', 'otras', 'ningún', 'ninguna',
    'algún', 'alguna', 'algunos', 'algunas', 'varios', 'varias', 'cuyo', 'cuya', 'cuyos', 'cuyas', 'buen', 'gran'],
  beforeVerb: ['yo', 'tú', 'él', 'ella', 'usted', 'nosotros', 'nosotras', 'vosotros', 'vosotras', 'ellos', 'ellas', 'ustedes',
    'me', 'te', 'se', 'nos', 'os', 'le', 'les', 'no'],
  articleOrPronoun: ['la', 'los', 'las', 'lo'],
  genderBefore: { el: 'm', un: 'm', este: 'm', ese: 'm', aquel: 'm', del: 'm', al: 'm', la: 'f', una: 'f', esta: 'f', esa: 'f',
    aquella: 'f' },
  auxiliaries: ['haber'],
  prepositions: ['de', 'a', 'en', 'con', 'por', 'para', 'sin', 'sobre', 'entre', 'hasta', 'desde', 'hacia', 'contra', 'según',
    'tras', 'bajo', 'ante'],
  // Only verbs the subtitles show mostly reflexive read so: se dio prisa is "hurried", not dar's "to hit oneself".
  // se on an infinitive or gerund is the verb's own (levantarse "to get up"); before a finite verb it may be impersonal.
  reflexive: { always: [], ifPronominal: ['se', 'me', 'te', 'nos', 'os'], joined: ['se'],
    imperative: { te: '(?<!formal )second-person singular [a-z ]*imperative', os: '(?<!formal )second-person plural [a-z ]*imperative', nos: 'first-person plural [a-z ]*imperative', se: 'formal|third-person [a-z ]*imperative' } },
  // sí, solo, que, fuera, lo, les, reflexive pronouns and their verbs, adjectives against nouns and verbs (es-context.ts).
  context: spanishContext,
};

export function loadEngine(baseUrl: string, opts?: LoadOpts): Promise<LangEngine> {
  return loadSpacedEngine(SPANISH, baseUrl, opts);
}
