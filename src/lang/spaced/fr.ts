// French. Elided words stand alone (l' + homme, qu' + il); a verb and the pronouns hyphened to it are one word (dit-il,
// a-t-il, donne-moi).
import type { LangEngine } from '../types';
import { loadSpacedEngine, type LoadOpts, type SpacedLang } from './core';
import { frenchContext } from './fr-context';

export const FRENCH: SpacedLang = {
  id: 'fr',
  script: 'latin',
  elisions: ["l'", "d'", "j'", "m'", "n'", "s'", "t'", "c'", "ç'", "qu'", "jusqu'", "lorsqu'", "puisqu'", "quoiqu'", "presqu'",
    "entr'"],
  hyphenClitics: ['je', 'tu', 'il', 'elle', 'on', 'nous', 'vous', 'ils', 'elles', 'ce', 'le', 'la', 'les', 'lui', 'leur', 'moi',
    'toi', 'en', 'y', 't', "t'en", "m'en", "t'y", "m'y", 'là', 'ci'],
  // "ce soir-là", "ce monde-là", "celui-ci": a noun before them, as well as a verb.
  hyphenParticles: ['là', 'ci'],
  // "Que vois-je là !", "te dis-je", "Que faites-vous là ?": the subject after its verb, no imperative.
  hyphenSubjects: { je: 'first-person singular', tu: 'second-person singular', il: 'third-person singular', elle: 'third-person singular',
    on: 'third-person singular', ce: 'third-person singular', nous: 'first-person plural', vous: 'second-person plural',
    ils: 'third-person plural', elles: 'third-person plural' },
  coordinators: ['mais', 'et', 'ou', 'donc', 'or', 'ni', 'car', 'puis', 'alors'],
  beforeNoun: ['un', 'une', 'des', 'du', 'au', 'aux', 'mon', 'ma', 'mes', 'ton', 'ta', 'tes', 'son', 'sa', 'ses', 'notre',
    'nos', 'votre', 'vos', 'leurs', 'ce', 'cet', 'cette', 'ces', 'quel', 'quelle', 'quels', 'quelles', 'chaque', 'plusieurs',
    'quelques', 'aucun', 'aucune', 'certains', 'certaines'],
  beforeVerb: ['je', "j'", 'tu', 'il', 'elle', 'on', 'nous', 'vous', 'ils', 'elles', 'ne', "n'", 'me', "m'", 'te', "t'",
    'se', "s'", 'lui', 'y', 'en'],
  articleOrPronoun: ['le', 'la', 'les', "l'"],
  genderBefore: { le: 'm', un: 'm', ce: 'm', cet: 'm', mon: 'm', ton: 'm', son: 'm', du: 'm', au: 'm', la: 'f', une: 'f',
    cette: 'f', ma: 'f', ta: 'f', sa: 'f' },
  auxiliaries: ['avoir', 'être'],
  negation: { particles: ['ne', "n'"], words: ['pas', 'point', 'plus', 'jamais', 'rien', 'guère', 'personne', 'aucun', 'aucune', 'nullement'] },
  prepositions: ['de', "d'", 'à', 'en', 'dans', 'pour', 'par', 'sans', 'sur', 'sous', 'avec', 'chez', 'entre', 'vers', 'contre',
    'après', 'avant', 'depuis', 'pendant', 'parmi'],
  // Levez-vous "stand up", Assieds-toi: an imperative with its own person's pronoun hyphened to it is reflexive.
  reflexive: { always: ['se', "s'"], ifPronominal: ['me', "m'", 'te', "t'", 'nous', 'vous'],
    imperative: { vous: 'second-person plural [a-z ]*imperative', toi: 'second-person singular [a-z ]*imperative', nous: 'first-person plural [a-z ]*imperative' } },
  // Flaubert and Perrault capitalize Madame and Monsieur in mid-sentence: courtesy, not names.
  titles: ['madame', 'monsieur', 'mademoiselle', 'messieurs', 'mesdames', 'mesdemoiselles', 'mme', 'mlle', 'm.'],
  // Candide's edition prints À and Ô without their accents: "A peine ont-ils mis le pied dans la ville", "O ciel !".
  capitalAccent: { A: 'à', O: 'ô' },
  // en, des, que, si, leur, même, fort, tout … and the words next to them (fr-context.ts).
  context: frenchContext,
};

export function loadEngine(baseUrl: string, opts?: LoadOpts): Promise<LangEngine> {
  return loadSpacedEngine(FRENCH, baseUrl, opts);
}
