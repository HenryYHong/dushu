// German. Keys keep their case (Essen the meal, essen to eat); words missing from the dictionary are tried as compounds
// (Haustürschlüssel = Haus + Tür + Schlüssel).
import type { LangEngine } from '../types';
import { loadSpacedEngine, type LoadOpts, type SpacedLang } from './core';
import { germanContext } from './de-context';
import { germanRespell, SEPARABLE_PARTICLES } from './de-spelling';

export const GERMAN: SpacedLang = {
  id: 'de',
  script: 'latin',
  keepCase: true,
  compounds: true,
  apostropheSuffixes: { s: 'es' },
  // fängt … an is anfangen, stehe … auf aufstehen, kehrte … zurück zurückkehren: the particle closes the clause. da is not
  // one here (er ist da is not dasein).
  separable: {
    particles: SEPARABLE_PARTICLES,
    coordinators: ['und', 'oder', 'aber', 'sondern', 'denn'],
  },
  // A word nothing reads: the spelling before 1996 (Laßt, Wußte), a capital a line of verse gave it (Angewurzelt), an
  // adjective's or participle's ending (zappelnden), a separable verb's zu-infinitive (zurückzuwandern) (de-spelling.ts).
  respell: germanRespell,
  // »Elisabeth!« (Immensee) and „Komm“: German opens quotes with » and „; « and “ close them.
  sentenceOpeners: '»„‚›',
  // der/die/das as the article or a pronoun, sie "she" or "they", da "there" or "since", adverbs without an ending, sich
  // after its verb … (de-context.ts).
  context: germanContext,
};

export function loadEngine(baseUrl: string, opts?: LoadOpts): Promise<LangEngine> {
  return loadSpacedEngine(GERMAN, baseUrl, opts);
}
