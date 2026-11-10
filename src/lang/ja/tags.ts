// JMdict's tag codes in plain English: parts of speech for Sense.pos (in the app's language: src/i18n), the rest for Sense.notes.
import { tt, ttm } from '../../i18n';

/** Parts of speech. Verbs say their class, which tells a learner how the word conjugates. */
const POS: Record<string, string> = {
  n: ttm('noun'), 'n-adv': ttm('adverbial noun'), 'n-t': ttm('noun (time)'), 'n-pref': ttm('noun used as a prefix'), 'n-suf': ttm('noun used as a suffix'),
  pn: ttm('pronoun'), num: ttm('number'), ctr: ttm('counter'), pref: ttm('prefix'), suf: ttm('suffix'), prt: ttm('particle'), conj: ttm('conjunction'), int: ttm('interjection'),
  exp: ttm('expression'), cop: ttm('copula'), aux: ttm('auxiliary'), 'aux-v': ttm('auxiliary verb'), 'aux-adj': ttm('auxiliary adjective'), unc: '',
  adv: ttm('adverb'), 'adv-to': ttm('adverb (takes と)'),
  'adj-i': ttm('adjective (i)'), 'adj-ix': ttm('adjective (i, いい/よい class)'), 'adj-na': ttm('adjective (na)'), 'adj-no': ttm('noun (takes の)'),
  'adj-pn': ttm('pre-noun adjective'), 'adj-t': ttm('adjective (taru)'), 'adj-f': ttm('used before nouns'), 'adj-ku': ttm('adjective (archaic ku)'),
  'adj-shiku': ttm('adjective (archaic shiku)'), 'adj-nari': ttm('adjective (archaic nari)'), 'adj-kari': ttm('adjective (archaic kari)'),
  v1: ttm('verb (ichidan)'), 'v1-s': ttm('verb (ichidan, くれる class)'), vz: ttm('verb (ichidan, -ずる)'),
  v5u: ttm('verb (godan, -う)'), 'v5u-s': ttm('verb (godan, -う, special)'), v5k: ttm('verb (godan, -く)'), 'v5k-s': ttm('verb (godan, 行く class)'),
  v5g: ttm('verb (godan, -ぐ)'), v5s: ttm('verb (godan, -す)'), v5t: ttm('verb (godan, -つ)'), v5n: ttm('verb (godan, -ぬ)'), v5b: ttm('verb (godan, -ぶ)'),
  v5m: ttm('verb (godan, -む)'), v5r: ttm('verb (godan, -る)'), 'v5r-i': ttm('verb (godan, -る, irregular)'), v5aru: ttm('verb (godan, -ある honorific)'),
  v5uru: ttm('verb (godan, -うる)'), vk: ttm('verb (irregular, 来る)'), vs: ttm('verb with する'), 'vs-i': ttm('verb (irregular, する)'),
  'vs-s': ttm('verb (する, special)'), 'vs-c': ttm('verb (archaic す)'), vn: ttm('verb (irregular, -ぬ)'), vr: ttm('verb (irregular, -り)'),
  'v-unspec': ttm('verb'), vi: ttm('intransitive'), vt: ttm('transitive'),
};

/** Usage notes. */
const MISC: Record<string, string> = {
  uk: 'usually written in kana', abbr: 'abbreviation', arch: 'archaic', obs: 'obsolete', dated: 'dated', rare: 'rare', hist: 'historical',
  col: 'colloquial', sl: 'slang', 'net-sl': 'internet slang', 'm-sl': 'manga slang', fam: 'familiar', chn: "children's language",
  joc: 'jocular', poet: 'poetic', form: 'formal or literary', hon: 'honorific', hum: 'humble', pol: 'polite', vulg: 'vulgar',
  derog: 'derogatory', sens: 'sensitive', euph: 'euphemism', X: 'rude or X-rated', fem: 'mostly used by women', male: 'mostly used by men',
  'on-mim': 'onomatopoeic or mimetic', yoji: 'four-character idiom', id: 'idiom', proverb: 'proverb', quote: 'quotation',
  char: 'character', company: 'company name', organization: 'organization name', person: 'name of a person', place: 'place name',
  product: 'product name', work: 'title of a work', serv: 'service name', ev: 'event', obj: 'object', fict: 'fictional', leg: 'legend',
  myth: 'mythology', dei: 'deity', creat: 'creature', group: 'group', relig: 'religion', ship: 'ship name', doc: 'document',
  surname: 'surname', given: 'given name', unclass: 'name',
};

const DIALECT: Record<string, string> = {
  ksb: 'Kansai dialect', osb: 'Osaka dialect', kyb: 'Kyoto dialect', ktb: 'Kanto dialect', thb: 'Tohoku dialect', hob: 'Hokkaido dialect',
  kyu: 'Kyushu dialect', rkb: 'Ryukyuan', nab: 'Nagano dialect', tsb: 'Tosa dialect', tsug: 'Tsugaru dialect', bra: 'Brazilian Japanese',
};

const FIELD: Record<string, string> = {
  Buddh: 'Buddhism', Christn: 'Christianity', MA: 'martial arts', Shinto: 'Shinto', agric: 'agriculture', anat: 'anatomy',
  archeol: 'archeology', archit: 'architecture', art: 'art', astron: 'astronomy', audvid: 'audiovisual', aviat: 'aviation',
  baseb: 'baseball', biochem: 'biochemistry', biol: 'biology', bot: 'botany', boxing: 'boxing', bus: 'business', cards: 'card games',
  chem: 'chemistry', chmyth: 'Chinese mythology', civeng: 'civil engineering', cloth: 'clothing', comp: 'computing',
  cryst: 'crystallography', dent: 'dentistry', ecol: 'ecology', econ: 'economics', elec: 'electrical engineering', electr: 'electronics',
  embryo: 'embryology', engr: 'engineering', ent: 'entomology', figskt: 'figure skating', film: 'film', finc: 'finance', fish: 'fishing',
  food: 'food', gardn: 'gardening', genet: 'genetics', geogr: 'geography', geol: 'geology', geom: 'geometry', go: 'go (game)',
  golf: 'golf', gramm: 'grammar', grmyth: 'Greek mythology', hanaf: 'hanafuda', horse: 'horse racing', internet: 'internet',
  jpmyth: 'Japanese mythology', kabuki: 'kabuki', law: 'law', ling: 'linguistics', logic: 'logic', mahj: 'mahjong', manga: 'manga',
  math: 'mathematics', mech: 'mechanical engineering', med: 'medicine', met: 'meteorology', mil: 'military', min: 'mineralogy',
  mining: 'mining', motor: 'motorsport', music: 'music', noh: 'noh', ornith: 'ornithology', paleo: 'paleontology', pathol: 'pathology',
  pharm: 'pharmacology', phil: 'philosophy', photo: 'photography', physics: 'physics', physiol: 'physiology', politics: 'politics',
  print: 'printing', prowres: 'pro wrestling', psy: 'psychiatry', psyanal: 'psychoanalysis', psych: 'psychology', rail: 'railways',
  rommyth: 'Roman mythology', shogi: 'shogi', ski: 'skiing', sports: 'sports', stat: 'statistics', stockm: 'stock market', sumo: 'sumo',
  surg: 'surgery', telec: 'telecommunications', tradem: 'trademark', tv: 'television', vet: 'veterinary', vidg: 'video games',
  zool: 'zoology',
};

const ARCHAIC_VERB = /^v[24]/;

export function isPosTag(t: string): boolean {
  return t in POS || ARCHAIC_VERB.test(t);
}

/** "verb (ichidan), transitive" for ["v1", "vt"]; undefined when the sense has no part of speech worth showing. */
export function posText(tags: readonly string[]): string | undefined {
  const out: string[] = [];
  for (const t of tags) {
    const s = POS[t] ? tt(POS[t]) : ARCHAIC_VERB.test(t) ? tt('verb (archaic)') : undefined;
    if (s && !out.includes(s)) out.push(s);
  }
  return out.length ? out.join(', ') : undefined;
}

/** Usage notes, fields and dialects of a sense's tags, in English. */
export function tagNotes(tags: readonly string[]): string[] {
  const out: string[] = [];
  for (const t of tags) {
    if (isPosTag(t)) continue;
    const s = MISC[t] ?? DIALECT[t] ?? FIELD[t];
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/** Senses only a historian needs: archaic or obsolete, rare. Used to rank, never to hide. */
export function isFringeSense(tags: readonly string[]): boolean {
  return tags.includes('arch') || tags.includes('obs') || tags.includes('rare');
}

/** Registers a reader of a novel meets only now and then: slang, euphemism, the vulgar, a dialect, children's words. */
const MARKED = new Set(['col', 'sl', 'net-sl', 'm-sl', 'euph', 'vulg', 'X', 'derog', 'sens', 'chn', 'joc', 'dated', 'hist']);

/**
 * A sense that is not the plain word: fringe (above), colloquial, slang, euphemism, dialect, or a specialist's (sumo,
 * Buddhism, anatomy). Never moved ahead of a plain one: あそこ is "there" before it is "genitals", 筈 "should" before "nock".
 */
export function isMarkedSense(tags: readonly string[]): boolean {
  return isFringeSense(tags) || tags.some((t) => MARKED.has(t) || t in DIALECT || t in FIELD);
}
