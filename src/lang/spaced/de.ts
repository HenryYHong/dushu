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
};

export function loadEngine(baseUrl: string, opts?: LoadOpts): Promise<LangEngine> {
  return loadSpacedEngine(GERMAN, baseUrl, opts);
}
