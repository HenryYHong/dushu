// Italian. Elided words stand alone (dell' + anno, un' + altra); po' and di' keep their apostrophe; enclitic pronouns join
// the verb (dimmi, farlo, andarsene).
import type { LangEngine } from '../types';
import { loadSpacedEngine, stripAccents, type LoadOpts, type SpacedLang } from './core';
import { italianCliticPart, italianContext } from './it-context';

const CLITIC_START = /^(?:m|t|s|c|v|n|l)/;

export const ITALIAN: SpacedLang = {
  id: 'it',
  script: 'latin',
  finalApostrophe: true,
  elisions: ["l'", "un'", "dell'", "all'", "dall'", "nell'", "sull'", "coll'", "quell'", "bell'", "sant'", "quest'", "d'", "c'",
    "m'", "t'", "s'", "v'", "n'", "gl'", "tutt'", "senz'", "com'", "dov'", "anch'", "cos'", "ch'", "mezz'", "buon'", "nessun'",
    "qual'", "grand'", "pover'", "quand'", "ov'", "s'", "neanch'", "nemmen'",
    // Pirandello's and Collodi's clipped words: "fors'anche", "diss'io", "mentr'egli", "quattr'anni", "mastr'Antonio",
    // "nient'altro", "gliel'ho".
    "fors'", "diss'", "mentr'", "quattr'", "altr'", "tant'", "quant'", "stess'", "nient'", "mastr'", "diciott'", "press'",
    "poich'", "gliel'", "glien'", "mal'", "dev'", "trent'", "quarant'", "cinquant'"],
  enclitics: ['glielo', 'gliela', 'glieli', 'gliele', 'gliene', 'me', 'te', 'se', 'ce', 've', 'mi', 'ti', 'si', 'ci', 'vi',
    'ne', 'lo', 'la', 'li', 'le', 'gli'],
  encliticStems(stem, first) {
    // farlo = far(e) + lo, porlo = por(re) + lo; dimmi = di' + mi and vattene = va' + te + ne double the pronoun's consonant,
    // after an order of one syllable only (di', da', fa', sta', va'): "i limiti angustissimi" is angusto's superlative, not
    // angusti' + si + mi.
    const out = [stem, stem + 'e', stem + 're', stripAccents(stem)];
    if (CLITIC_START.test(first) && stem.length >= 3 && stem.length <= 4 && stem.endsWith(first[0]) && stem[stem.length - 2] !== first[0]) {
      const short = stem.slice(0, -1);
      out.push(short + "'", short, short.slice(0, -1) + stripAccents(short.slice(-1)) + "'");
      if (short === 'di') out.push('dì');
    }
    if (first === 'gli' || first.startsWith('glie')) out.push(stem + "'");
    return [...new Set(out)];
  },
  respell(f) {
    const out: string[] = [];
    // Collodi and Verga write j for i between vowels: bujo, gioja, ajutato are buio, gioia, aiutato.
    if (f.includes('j')) out.push(f.replace(/(?<=[aeiouàèéìòù])j(?=[aeiouàèéìòù]|$)/g, 'i'));
    // Verse and dialogue clip a final vowel: "Non mi picchiar tanto forte!" is picchiare, aver avere, esser essere, dir
    // dire, son sono, condur condurre; "Il pover'uomo" is povero.
    // Not a lone letter: Dante's "ve l cervel" is il.
    const base = f.endsWith("'") ? f.slice(0, -1) : f;
    if (base.length < 2) return out;
    if (f.endsWith("'")) out.push(base + 'o', base + 'a', base + 'e', base + 'i');
    else if (/[lrnm]$/.test(base)) out.push(base + 'e', base + 'o', base + 're');
    return out;
  },
  beforeNoun: ['il', 'un', 'uno', 'una', 'del', 'dello', 'della', 'dei', 'degli', 'delle', 'al', 'allo', 'alla', 'ai', 'agli',
    'alle', 'dal', 'dallo', 'dalla', 'dai', 'dagli', 'dalle', 'nel', 'nello', 'nella', 'nei', 'negli', 'nelle', 'sul', 'sullo',
    'sulla', 'sui', 'sugli', 'sulle', 'mio', 'mia', 'miei', 'mie', 'tuo', 'tua', 'tuoi', 'tue', 'suo', 'sua', 'suoi', 'sue',
    'nostro', 'nostra', 'nostri', 'nostre', 'vostro', 'vostra', 'vostri', 'vostre', 'questo', 'questa', 'questi', 'queste',
    'quel', 'quello', 'quella', 'quei', 'quegli', 'quelle', 'ogni', 'qualche', 'alcuni', 'alcune', 'molto', 'molta', 'molti',
    'molte', 'tanti', 'tante', 'pochi', 'poche', 'tutti', 'tutte', 'i', 'molto', 'più'],
  beforeVerb: ['io', 'tu', 'lui', 'lei', 'noi', 'voi', 'mi', 'ti', 'si', 'ci', 'vi', 'ne', 'non', "m'", "t'", "s'", "c'", "v'"],
  // li is "them" before a verb ("E chi te li ha mangiati?", Pinocchio) and the old plural article before a noun.
  articleOrPronoun: ['lo', 'la', 'le', 'gli', 'li', "l'"],
  prepositions: ['di', 'a', 'da', 'in', 'con', 'su', 'per', 'tra', 'fra', 'senza', 'sopra', 'sotto', 'verso', 'contro', "d'"],
  // il sole is the sun, not solo's feminine plural; una zia an aunt.
  genderBefore: { il: 'm', lo: 'm', un: 'm', uno: 'm', del: 'm', dello: 'm', al: 'm', allo: 'm', dal: 'm', nel: 'm', sul: 'm',
    col: 'm', questo: 'm', quel: 'm', quello: 'm', la: 'f', una: 'f', della: 'f', alla: 'f', dalla: 'f', nella: 'f', sulla: 'f',
    questa: 'f', quella: 'f' },
  // "è arrivato un Pesce-cane" (Pinocchio) has arrived, not arrivato "successful"; ha letto, not letto "bed".
  auxiliaries: ['essere', 'avere'],
  // Elided too: "Anche Papiano s'alzò per riaccendere il lanternino" stood up, not alzare's "to lift"; "m'accorsi".
  // A phrase of a pronominal verb is spelled with its infinitive: farsi coraggio, porsi in salvo.
  reflexive: { always: ['si', "s'"], ifPronominal: ['mi', 'ti', 'ci', 'vi', "m'", "t'", "c'", "v'"],
    infinitive: (key) => (key.endsWith('rre') ? key.slice(0, -2) : key.slice(0, -1)) + 'si',
    persons: { mi: 'first-person singular', "m'": 'first-person singular', ti: 'second-person singular', "t'": 'second-person singular',
      si: 'third-person', "s'": 'third-person', ci: 'first-person plural', "c'": 'first-person plural', vi: 'second-person plural',
      "v'": 'second-person plural' },
    imperative: { ti: '(?<!formal )second-person singular [a-z ]*imperative', vi: '(?<!formal )second-person plural [a-z ]*imperative', ci: 'first-person plural [a-z ]*imperative', si: 'formal|third-person [a-z ]*imperative' } },
  // come "like" or "how", ci "there" or "us", via "away" or the street, se ne andò, quella vocina …: it-context.ts.
  context: italianContext,
  // venirci, andarci: ci "there" on the card.
  cliticPart: italianCliticPart,
};

export function loadEngine(baseUrl: string, opts?: LoadOpts): Promise<LangEngine> {
  return loadSpacedEngine(ITALIAN, baseUrl, opts);
}
