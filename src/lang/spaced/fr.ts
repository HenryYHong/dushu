// French. Elided words stand alone (l' + homme, qu' + il); a verb and the pronouns hyphened to it are one word (dit-il,
// a-t-il, donne-moi).
import type { LangEngine } from '../types';
import { loadSpacedEngine, type LoadOpts, type SpacedLang } from './core';

export const FRENCH: SpacedLang = {
  id: 'fr',
  script: 'latin',
  elisions: ["l'", "d'", "j'", "m'", "n'", "s'", "t'", "c'", "ç'", "qu'", "jusqu'", "lorsqu'", "puisqu'", "quoiqu'", "presqu'",
    "entr'"],
  hyphenClitics: ['je', 'tu', 'il', 'elle', 'on', 'nous', 'vous', 'ils', 'elles', 'ce', 'le', 'la', 'les', 'lui', 'leur', 'moi',
    'toi', 'en', 'y', 't', "t'en", "m'en", "t'y", "m'y", 'là', 'ci'],
  beforeNoun: ['un', 'une', 'des', 'du', 'au', 'aux', 'mon', 'ma', 'mes', 'ton', 'ta', 'tes', 'son', 'sa', 'ses', 'notre',
    'nos', 'votre', 'vos', 'leurs', 'ce', 'cet', 'cette', 'ces', 'quel', 'quelle', 'quels', 'quelles', 'chaque', 'plusieurs',
    'quelques', 'aucun', 'aucune', 'certains', 'certaines', 'très', 'cette'],
  beforeVerb: ['je', "j'", 'tu', 'il', 'elle', 'on', 'nous', 'vous', 'ils', 'elles', 'ne', "n'", 'me', "m'", 'te', "t'",
    'se', "s'", 'lui', 'y', 'en'],
  articleOrPronoun: ['le', 'la', 'les', "l'"],
  prepositions: ['de', "d'", 'à', 'en', 'dans', 'pour', 'par', 'sans', 'sur', 'sous', 'avec', 'chez', 'entre', 'vers', 'contre',
    'après', 'avant', 'depuis', 'pendant', 'parmi'],
  reflexive: { always: ['se', "s'"], ifPronominal: ['me', "m'", 'te', "t'", 'nous', 'vous'] },
};

export function loadEngine(baseUrl: string, opts?: LoadOpts): Promise<LangEngine> {
  return loadSpacedEngine(FRENCH, baseUrl, opts);
}
