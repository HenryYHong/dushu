// Portuguese. A verb and the pronouns hyphened to it are one word (dá-me, fazê-lo, dar-te-ei); articles and pronouns tell
// nouns from verbs.
import type { LangEngine } from '../types';
import { loadSpacedEngine, stripAccents, type LoadOpts, type SpacedLang } from './core';

export const PORTUGUESE: SpacedLang = {
  id: 'pt',
  script: 'latin',
  elisions: ["d'"],
  hyphenClitics: ['me', 'te', 'se', 'lhe', 'lhes', 'nos', 'vos', 'o', 'a', 'os', 'as', 'lo', 'la', 'los', 'las', 'no', 'na',
    'nas', 'mo', 'ma', 'mos', 'mas', 'to', 'ta', 'tos', 'tas', 'lho', 'lha', 'lhos', 'lhas', 'ei', 'ás', 'á', 'emos', 'eis',
    'ão', 'ia', 'ias', 'íamos', 'íeis', 'iam'],
  encliticStems(stem, first) {
    // fazê-lo = fazer + o, comprá-la = comprar + a, fi-lo = fiz + o, vamo-nos = vamos + nos: the verb lost its last
    // letter to the pronoun.
    const plain = stripAccents(stem);
    const out = [stem, plain];
    if (/^l[oa]s?$/.test(first)) out.push(plain + 'r', stem + 'r', plain + 'z', plain + 's');
    if (first === 'nos') out.push(stem + 's');
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
  prepositions: ['de', 'em', 'com', 'por', 'para', 'sem', 'sobre', 'entre', 'até', 'desde', 'contra', 'sob', 'após', 'perante'],
  reflexive: { always: ['se'], ifPronominal: ['me', 'te', 'nos', 'vos'] },
};

export function loadEngine(baseUrl: string, opts?: LoadOpts): Promise<LangEngine> {
  return loadSpacedEngine(PORTUGUESE, baseUrl, opts);
}
