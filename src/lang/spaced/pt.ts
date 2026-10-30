// Portuguese. A verb and the pronouns hyphened to it are one word (dá-me, fazê-lo, dar-te-ei); articles and pronouns tell
// nouns from verbs.
import type { LangEngine } from '../types';
import { loadSpacedEngine, stripAccents, type LoadOpts, type SpacedLang } from './core';
import { portugueseContext } from './pt-context';
import { oldSpelling, respellings } from './pt-spelling';

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
      // With its cedilla kept: "abraçal-o" is abraçar.
      for (const b of new Set([stem.slice(0, -1), plain.slice(0, -1)])) {
        for (const v of new Set([b, oldSpelling(b)])) out.push(v + 'r', v + 'z', v + 's');
      }
    }
    if (first === 'nos') out.push(stem + 's');
    // The verb in its old spelling, last: "approximou-se", "annunciou-me", "propoz-me" are aproximou, anunciou, propôs.
    out.push(...respellings(plain));
    return [...new Set(out)];
  },
  // Machado's 1899 spelling (pt-spelling.ts): cabellos cabelos, visinho vizinho, signaes sinais, comnosco conosco.
  respell: respellings,
  // And his nouns without their accents, spelled like a verb's form: silencio, medico, musica, pagina.
  looseAccents: true,
  // "— Mas, Sr. Nogueira, que fará você todo esse tempo?" (Missa do Galo): the title is senhor, Nogueira the name.
  titles: ['sr.', 'sra.', 'srs.', 'sras.', 'snr.', 'snra.', 'dr.'],
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
  // que, se, nos, a before an infinitive, foi (ser or ir) and the rest that turn on their neighbors: pt-context.ts.
  context: portugueseContext,
};

export function loadEngine(baseUrl: string, opts?: LoadOpts): Promise<LangEngine> {
  return loadSpacedEngine(PORTUGUESE, baseUrl, opts);
}
