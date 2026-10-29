// Spanish. Enclitic pronouns join the verb (dámelo, decirle, sentaos); articles and pronouns tell nouns from verbs.
import type { LangEngine } from '../types';
import { loadSpacedEngine, stripAccents, type LoadOpts, type SpacedLang } from './core';

export const SPANISH: SpacedLang = {
  id: 'es',
  script: 'latin',
  enclitics: ['me', 'te', 'se', 'nos', 'os', 'le', 'les', 'lo', 'la', 'los', 'las'],
  encliticStems(stem, first) {
    // The written accent that keeps the stress (dá-me-lo, diciéndo-le) goes when the pronouns do; sentad + os is
    // sentaos and sentemos + nos is sentémonos.
    const out = [stem, stripAccents(stem)];
    if (first === 'os') out.push(stem + 'd', stripAccents(stem) + 'd');
    if ((first === 'nos' || first === 'se') && stem.endsWith('mo')) out.push(stripAccents(stem) + 's');
    return [...new Set(out)];
  },
  beforeNoun: ['el', 'un', 'una', 'unos', 'unas', 'mi', 'mis', 'tu', 'tus', 'su', 'sus', 'nuestro', 'nuestra', 'nuestros',
    'nuestras', 'vuestro', 'vuestra', 'vuestros', 'vuestras', 'este', 'esta', 'estos', 'estas', 'ese', 'esa', 'esos', 'esas',
    'aquel', 'aquella', 'aquellos', 'aquellas', 'del', 'al', 'cada', 'otro', 'otra', 'otros', 'otras', 'ningún', 'ninguna',
    'algún', 'alguna', 'algunos', 'algunas', 'varios', 'varias', 'cuyo', 'cuya', 'cuyos', 'cuyas', 'muy', 'tan', 'buen', 'gran'],
  beforeVerb: ['yo', 'tú', 'él', 'ella', 'usted', 'nosotros', 'nosotras', 'vosotros', 'vosotras', 'ellos', 'ellas', 'ustedes',
    'me', 'te', 'se', 'nos', 'os', 'le', 'les', 'no'],
  articleOrPronoun: ['la', 'los', 'las', 'lo'],
  prepositions: ['de', 'a', 'en', 'con', 'por', 'para', 'sin', 'sobre', 'entre', 'hasta', 'desde', 'hacia', 'contra', 'según',
    'tras', 'bajo', 'ante'],
  reflexive: { always: ['se'], ifPronominal: ['me', 'te', 'nos', 'os'] },
};

export function loadEngine(baseUrl: string, opts?: LoadOpts): Promise<LangEngine> {
  return loadSpacedEngine(SPANISH, baseUrl, opts);
}
