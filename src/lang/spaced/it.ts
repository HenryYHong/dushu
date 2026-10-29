// Italian. Elided words stand alone (dell' + anno, un' + altra); po' and di' keep their apostrophe; enclitic pronouns join
// the verb (dimmi, farlo, andarsene).
import type { LangEngine } from '../types';
import { loadSpacedEngine, stripAccents, type LoadOpts, type SpacedLang } from './core';

const CLITIC_START = /^(?:m|t|s|c|v|n|l)/;

export const ITALIAN: SpacedLang = {
  id: 'it',
  script: 'latin',
  finalApostrophe: true,
  elisions: ["l'", "un'", "dell'", "all'", "dall'", "nell'", "sull'", "coll'", "quell'", "bell'", "sant'", "quest'", "d'", "c'",
    "m'", "t'", "s'", "v'", "n'", "gl'", "tutt'", "senz'", "com'", "dov'", "anch'", "cos'", "ch'", "mezz'", "buon'", "nessun'",
    "qual'", "grand'", "pover'", "quand'", "ov'", "s'", "neanch'", "nemmen'"],
  enclitics: ['glielo', 'gliela', 'glieli', 'gliele', 'gliene', 'me', 'te', 'se', 'ce', 've', 'mi', 'ti', 'si', 'ci', 'vi',
    'ne', 'lo', 'la', 'li', 'le', 'gli'],
  encliticStems(stem, first) {
    // farlo = far(e) + lo, porlo = por(re) + lo; dimmi = di' + mi and vattene = va' + te + ne double the pronoun's consonant.
    const out = [stem, stem + 'e', stem + 're', stripAccents(stem)];
    if (CLITIC_START.test(first) && stem.length >= 3 && stem.endsWith(first[0]) && stem[stem.length - 2] !== first[0]) {
      const short = stem.slice(0, -1);
      out.push(short + "'", short, short.slice(0, -1) + stripAccents(short.slice(-1)) + "'");
      if (short === 'di') out.push('dì');
    }
    if (first === 'gli' || first.startsWith('glie')) out.push(stem + "'");
    return [...new Set(out)];
  },
  beforeNoun: ['il', 'un', 'uno', 'una', 'del', 'dello', 'della', 'dei', 'degli', 'delle', 'al', 'allo', 'alla', 'ai', 'agli',
    'alle', 'dal', 'dallo', 'dalla', 'dai', 'dagli', 'dalle', 'nel', 'nello', 'nella', 'nei', 'negli', 'nelle', 'sul', 'sullo',
    'sulla', 'sui', 'sugli', 'sulle', 'mio', 'mia', 'miei', 'mie', 'tuo', 'tua', 'tuoi', 'tue', 'suo', 'sua', 'suoi', 'sue',
    'nostro', 'nostra', 'nostri', 'nostre', 'vostro', 'vostra', 'vostri', 'vostre', 'questo', 'questa', 'questi', 'queste',
    'quel', 'quello', 'quella', 'quei', 'quegli', 'quelle', 'ogni', 'qualche', 'alcuni', 'alcune', 'molto', 'molta', 'molti',
    'molte', 'tanti', 'tante', 'pochi', 'poche', 'tutti', 'tutte', 'i', 'molto', 'più'],
  beforeVerb: ['io', 'tu', 'lui', 'lei', 'noi', 'voi', 'mi', 'ti', 'si', 'ci', 'vi', 'ne', 'non', "m'", "t'", "s'", "c'", "v'"],
  articleOrPronoun: ['lo', 'la', 'le', 'gli', "l'"],
  prepositions: ['di', 'a', 'da', 'in', 'con', 'su', 'per', 'tra', 'fra', 'senza', 'sopra', 'sotto', 'verso', 'contro', "d'"],
  reflexive: { always: ['si'], ifPronominal: ['mi', 'ti', 'ci', 'vi'] },
};

export function loadEngine(baseUrl: string, opts?: LoadOpts): Promise<LangEngine> {
  return loadSpacedEngine(ITALIAN, baseUrl, opts);
}
