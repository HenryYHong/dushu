// German. Keys keep their case (Essen the meal, essen to eat); words missing from the dictionary are tried as compounds
// (Haustürschlüssel = Haus + Tür + Schlüssel).
import type { LangEngine } from '../types';
import { loadSpacedEngine, type LoadOpts, type SpacedLang } from './core';

export const GERMAN: SpacedLang = {
  id: 'de',
  script: 'latin',
  keepCase: true,
  compounds: true,
  apostropheSuffixes: { s: 'es' },
  // fängt … an is anfangen, stehe … auf aufstehen, kehrte … zurück zurückkehren: the particle closes the clause. da is not
  // one here (er ist da is not dasein).
  separable: {
    particles: ['ab', 'an', 'auf', 'aus', 'bei', 'beiseite', 'bereit', 'dabei', 'dahin', 'dar', 'davon', 'dazu', 'durch', 'ein',
      'empor', 'entgegen', 'entlang', 'fest', 'fort', 'frei', 'heim', 'her', 'herab', 'heran', 'herauf', 'heraus', 'herbei',
      'herein', 'herüber', 'herum', 'herunter', 'hervor', 'hin', 'hinab', 'hinauf', 'hinaus', 'hindurch', 'hinein', 'hinterher',
      'hinüber', 'hinunter', 'hinweg', 'hinzu', 'hoch', 'kennen', 'los', 'mit', 'nach', 'nieder', 'preis', 'statt', 'teil',
      'über', 'um', 'umher', 'unter', 'vor', 'voran', 'voraus', 'vorbei', 'vorüber', 'wahr', 'weg', 'weiter', 'wieder', 'zu',
      'zurecht', 'zurück', 'zusammen'],
    coordinators: ['und', 'oder', 'aber', 'sondern', 'denn'],
  },
  // »Elisabeth!« (Immensee) and „Komm“: German opens quotes with » and „; « and “ close them.
  sentenceOpeners: '»„‚›',
};

export function loadEngine(baseUrl: string, opts?: LoadOpts): Promise<LangEngine> {
  return loadSpacedEngine(GERMAN, baseUrl, opts);
}
