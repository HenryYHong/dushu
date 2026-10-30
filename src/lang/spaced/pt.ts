// Portuguese. A verb and the pronouns hyphened to it are one word (dá-me, fazê-lo, dar-te-ei); articles and pronouns tell
// nouns from verbs.
import type { LangEngine } from '../types';
import { loadSpacedEngine, stripAccents, type LoadOpts, type SpacedLang } from './core';

/**
 * Portuguese as spelled before the reforms of 1911 and 1943, the way the 1899 Dom Casmurro has it: doubled consonants
 * (cabellos, aggregado, metter), ph th y (phrase, theatro, typo), ct (acto, projecto), cç (acção), and veiu for veio.
 */
function oldSpelling(f: string): string {
  return f.replace(/([bcdfglmnptv])\1/g, '$1').replace(/ph/g, 'f').replace(/th/g, 't').replace(/y/g, 'i')
    .replace(/c(?=[tç])/g, '').replace(/eiu$/, 'eio').replace(/'/g, '');
}

export const PORTUGUESE: SpacedLang = {
  id: 'pt',
  script: 'latin',
  elisions: ["d'"],
  hyphenClitics: ['me', 'te', 'se', 'lhe', 'lhes', 'nos', 'vos', 'o', 'a', 'os', 'as', 'lo', 'la', 'los', 'las', 'no', 'na',
    'nas', 'mo', 'ma', 'mos', 'mas', 'to', 'ta', 'tos', 'tas', 'lho', 'lha', 'lhos', 'lhas', 'ei', 'ás', 'á', 'emos', 'eis',
    'ão', 'ia', 'ias', 'íamos', 'íeis', 'iam', "lh'o", "lh'a", "lh'os", "lh'as", "m'o", "m'a", "t'o", "t'a"],
  encliticStems(stem, first) {
    // fazê-lo = fazer + o, comprá-la = comprar + a, fi-lo = fiz + o, vamo-nos = vamos + nos: the verb lost its last
    // letter to the pronoun. Machado's 1899 spelling puts the l on the verb: "para tiral-os outra vez do bolso" is tirar
    // + os, fazel-o fazer, fel-o fez, and mettel-o the old metter (meter).
    const plain = stripAccents(stem);
    const out = [stem, plain];
    if (/^l[oa]s?$/.test(first)) out.push(plain + 'r', stem + 'r', plain + 'z', plain + 's');
    if (/^[oa]s?$/.test(first) && plain.endsWith('l') && plain.length >= 2) {
      const b = plain.slice(0, -1);
      for (const v of new Set([b, oldSpelling(b)])) out.push(v + 'r', v + 'z', v + 's');
    }
    if (first === 'nos') out.push(stem + 's');
    return [...new Set(out)];
  },
  respell(f) {
    const out = [oldSpelling(f)];
    // visinho is vizinho, quizesse quisesse: s and z between vowels, one or the other.
    for (const w of new Set([out[0], f])) {
      for (let i = 1; i < w.length - 1; i++) {
        if ((w[i] === 's' || w[i] === 'z') && /[aeiouáéíóúâêôãõ]/.test(w[i - 1]) && /[aeiouáéíóúâêôãõ]/.test(w[i + 1])) {
          out.push(w.slice(0, i) + (w[i] === 's' ? 'z' : 's') + w.slice(i + 1));
        }
      }
    }
    return [...new Set(out)];
  },
  beforeNoun: ['um', 'uma', 'uns', 'umas', 'do', 'da', 'dos', 'das', 'ao', 'aos', 'à', 'às', 'pelo', 'pela', 'pelos', 'pelas',
    'num', 'numa', 'meu', 'minha', 'meus', 'minhas', 'teu', 'tua', 'teus', 'tuas', 'seu', 'sua', 'seus', 'suas', 'nosso',
    'nossa', 'nossos', 'nossas', 'este', 'esta', 'estes', 'estas', 'esse', 'essa', 'esses', 'essas', 'aquele', 'aquela',
    'aqueles', 'aquelas', 'cada', 'outro', 'outra', 'outros', 'outras', 'algum', 'alguma', 'alguns', 'algumas', 'nenhum',
    'nenhuma', 'muito', 'muita', 'muitos', 'muitas', 'pouco', 'pouca', 'poucos', 'poucas', 'deste', 'desta', 'neste', 'nesta',
    'desse', 'dessa', 'nesse', 'nessa', 'daquele', 'daquela', 'naquele', 'naquela'],
  beforeVerb: ['eu', 'tu', 'ele', 'ela', 'você', 'nós', 'vós', 'eles', 'elas', 'vocês', 'me', 'te', 'se', 'lhe', 'lhes', 'nos',
    'vos', 'não'],
  articleOrPronoun: ['o', 'a', 'os', 'as'],
  noArticleBefore: ['um', 'uma', 'uns', 'umas', 'este', 'esta', 'estes', 'estas', 'esse', 'essa', 'esses', 'essas', 'aquele',
    'aquela', 'aqueles', 'aquelas', 'cada', 'algum', 'alguma', 'alguns', 'algumas', 'nenhum', 'nenhuma', 'qualquer'],
  prepositions: ['de', 'em', 'com', 'por', 'para', 'sem', 'sobre', 'entre', 'até', 'desde', 'contra', 'sob', 'após', 'perante'],
  // A tarde "the afternoon" against tarde "late"; the article's gender against a form of the other one.
  genderBefore: { o: 'm', um: 'm', este: 'm', esse: 'm', aquele: 'm', do: 'm', no: 'm', ao: 'm', pelo: 'm', a: 'f', uma: 'f',
    esta: 'f', essa: 'f', aquela: 'f', da: 'f', na: 'f', à: 'f', pela: 'f' },
  // tinha passado "had passed", havia dito "had said": the compound tenses take ter (and in Machado's day haver).
  auxiliaries: ['ter', 'haver'],
  reflexive: { always: ['se'], ifPronominal: ['me', 'te', 'nos', 'vos'],
    imperative: { te: '(?<!formal )second-person singular [a-z ]*imperative', vos: '(?<!formal )second-person plural [a-z ]*imperative', nos: 'first-person plural [a-z ]*imperative', se: 'third-person [a-z ]*imperative' } },
};

export function loadEngine(baseUrl: string, opts?: LoadOpts): Promise<LangEngine> {
  return loadSpacedEngine(PORTUGUESE, baseUrl, opts);
}
