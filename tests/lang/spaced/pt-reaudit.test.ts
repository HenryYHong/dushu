// Portuguese after a native re-audit of five Machado books (Um apólogo, Missa do Galo, A cartomante, Dom Casmurro and O
// alienista I–III): each case is a sentence from them where a reader met the word read wrong (src/lang/spaced/pt-context.ts,
// pt-spelling.ts and curated/pt.json).
import { describe, expect, it } from 'vitest';
import type { LangEngine } from '../../../src/lang/types';
import { loadLang, tok } from './load';

const hint = (pt: LangEngine, text: string, word: string, nth = 0): string | undefined => pt.hint(tok(pt, text, word, nth));
const lemma = (pt: LangEngine, text: string, word: string, nth = 0): string | undefined => tok(pt, text, word, nth).lemma;

describe('Portuguese a as the preposition', () => {
  it('is "to" before a stressed pronoun', async () => {
    const pt = await loadLang('pt');
    const s = 'Tudo isto me era agora apresentado pela bocca de José Dias, que me denunciara a mim mesmo, e a quem eu perdoava tudo, o mal que dissera, o mal que fizera, e o que pudesse vir de um e do outro.';
    expect(hint(pt, s, 'a', 0)).toBe('to');
    expect(hint(pt, s, 'a', 1)).toBe('to');
    const t = 'Emfim, tornou a si, mas tinha a cara livida, e rompeu nestas palavras furiosas: —Beata!';
    expect(hint(pt, t, 'a', 0)).toBe('to');
    expect(hint(pt, t, 'si')).toBe('oneself');
    expect(hint(pt, t, 'a', 1)).toBe('the');
    const u = 'Não repara que esta distinta costureira só se importa comigo; eu é que vou aqui entre os dedos dela, unidinha a eles, furando abaixo e acima.';
    expect(hint(pt, u, 'a')).toBe('to');
  });

  it('is "to" before what is masculine or plural, which the article a cannot be', async () => {
    const pt = await loadLang('pt');
    const s = 'Um anonymo ou anonyma que passe na esquina da rua faz com que mettamos Sirius dentro do Marte, e tu sabes, leitor, a differença que ha de um a outro na distancia e no tamanho, mas a astronomia tem dessas confusões.';
    expect(hint(pt, s, 'a', 1)).toBe('to');
    expect(hint(pt, 'Primeiro deixo o seminario, daqui a dous mezes...', 'a')).toBe('to');
  });

  it('is "to" before a man\'s name, and before any name after a verb of telling or going', async () => {
    const pt = await loadLang('pt');
    const s = 'Evarista era mal composta de feições, longe de lastimal-o, agradecia-o a Deus, porquanto não corria o risco de preterir os interesses da sciencia.';
    expect(hint(pt, s, 'a')).toBe('to');
    expect(hint(pt, 'Hamlet observa a Horácio que há mais cousas no céu e na terra do que sonha a nossa filosofia.', 'a', 0)).toBe('to');
    expect(hint(pt, 'Não se vae a Roma brincando.', 'a')).toBe('to');
    // A country after a verb that is not of going keeps its article, and so does the subject of a clause.
    expect(hint(pt, 'E propoz-me a Europa, Minas, Petropolis.', 'a')).toBe('the');
    expect(hint(pt, 'A questão é saber se a Capitú da praia da Gloria já estava dentro da de Matacavallos.', 'a', 0)).toBe('the');
  });

  it('is "to which" before que after a noun, and "her" before não and a verb', async () => {
    const pt = await loadLang('pt');
    expect(hint(pt, 'Começára a escrever-me cartas, a que respondi com outras.', 'a', 1)).toBe('to');
    expect(hint(pt, 'Capitú attenta desde que a não via, indagava a causa.', 'a', 0)).toBe('her');
  });

  it('is "to" after ir, where the article would have joined it', async () => {
    const pt = await loadLang('pt');
    const s = '— A senhora nunca foi a casa de barbeiro?';
    expect(lemma(pt, s, 'foi')).toBe('ir');
    expect(hint(pt, s, 'a')).toBe('to');
  });

  it('is the article after que read as "than", unless it is concessive', async () => {
    const pt = await loadLang('pt');
    const s = 'E eu não desci triste nem zangado; achei a creada galante, appetecivel, melhor que a ama.';
    expect(hint(pt, s, 'a', 1)).toBe('the');
    expect(lemma(pt, s, 'ama')).toBe('ama');
  });
});

describe('Portuguese words after a and after a verb', () => {
  it('an infinitive that is also a noun is the verb after the preposition a', async () => {
    const pt = await loadLang('pt');
    expect(hint(pt, 'Ergueu-os logo, devagar, e ficámos a olhar um para o outro...', 'olhar')).toBe('to look');
    const s = 'Mas José Dias, que parára ao ver-me entrar, continuou a andar e a falar.';
    expect(hint(pt, s, 'andar')).toBe('to walk');
    expect(hint(pt, s, 'falar')).toBe('to speak');
  });

  it('an infinitive with me is reflexive after a verb of the speaker', async () => {
    const pt = await loadLang('pt');
    expect(hint(pt, 'Fui sentar-me na cadeira que ficava ao lado do canapé e repeti a palavra.', 'sentar-me')).toBe('to sit');
    const s = 'Há ocasiões em que sou como mamãe: acordando, custa-me dormir outra vez, rolo na cama, à toa, levanto-me, acendo vela, passeio, torno a deitar-me, e nada.';
    expect(hint(pt, s, 'deitar-me')).toBe('to lie down');
  });

  it('foi is ir past the subject before an infinitive', async () => {
    const pt = await loadLang('pt');
    expect(lemma(pt, 'Fui eu mesmo levar-lhe o meu papel.', 'Fui')).toBe('ir');
  });

  it('era after della, nela is ser, not the noun era', async () => {
    const pt = await loadLang('pt');
    expect(lemma(pt, 'O rosto della era agora sereno e puro.', 'era')).toBe('ser');
  });

  it('vale before its object is valer', async () => {
    const pt = await loadLang('pt');
    expect(lemma(pt, 'A velha caleça de praça, em que pela primeira vez passeaste com a mulher amada, fechadinhos ambos, vale o carro de Apolo.', 'vale')).toBe('valer');
    expect(lemma(pt, 'Então vale alguma cousa.', 'vale')).toBe('valer');
  });

  it('consigo after its verb is "with oneself"; ficou linda is lindo', async () => {
    const pt = await loadLang('pt');
    expect(hint(pt, 'Nunca tinha ido ao teatro, e mais de uma vez, ouvindo dizer ao Meneses que ia ao teatro, pedi-lhe que me levasse consigo.', 'consigo')).toBe('with oneself');
    expect(lemma(pt, 'Uma das que ainda tenho frescas é que, em certa ocasião, ela, que era apenas simpática, ficou linda, ficou lindíssima.', 'linda')).toBe('lindo');
  });
});

describe('Portuguese nouns Machado spells like verbs, and nouns of their own', () => {
  it('after an article, a possessive or an adjective, the noun: noticia, opera, memoria', async () => {
    const pt = await loadLang('pt');
    expect(lemma(pt, 'A simples noticia era já uma turvação grande.', 'noticia')).toBe('notícia');
    expect(lemma(pt, 'Agora é que eu ia começar a minha opera.', 'opera')).toBe('ópera');
    expect(lemma(pt, 'Convivas de boa memoria', 'memoria')).toBe('memória');
    expect(lemma(pt, 'Padua solicitava do sacristão uma das varas do pallio.', 'pallio')).toBe('pálio');
    expect(lemma(pt, 'Tambem eu, quando me casei, fui victima de intrigas; desfizeram-se.', 'victima')).toBe('vítima');
  });

  it('caso after a determiner is a case; suspeita after qualquer a suspicion', async () => {
    const pt = await loadLang('pt');
    expect(hint(pt, 'Se achares neste livro algum caso da mesma familia, avisa-me, leitor, para que o emende na segunda edição.', 'caso')).toBe('case');
    expect(lemma(pt, 'Era isto mesmo; deviamos dissimular para matar qualquer suspeita, e ao mesmo tempo gosar toda a liberdade anterior.', 'suspeita')).toBe('suspeita');
  });

  it('iguaizinhos is iguais, and costas the back', async () => {
    const pt = await loadLang('pt');
    expect(lemma(pt, 'Rindo para fazê-la sorrir e ver-lhe os dentes que luziam de brancos, todos iguaizinhos.', 'iguaizinhos')).toBe('igual');
    expect(hint(pt, 'Cuidei que ia dizer alguma coisa; mas estremeceu, como se tivesse um arrepio de frio, voltou as costas e foi sentar-se na cadeira.', 'costas')).toBe('back');
  });
});

describe('Portuguese pronouns and comparatives', () => {
  it('tu is "you" and deveras "really"', async () => {
    const pt = await loadLang('pt');
    expect(hint(pt, '— Tu crês deveras nessas cousas?', 'Tu')).toBe('you');
    expect(hint(pt, '— Tu crês deveras nessas cousas?', 'deveras')).toBe('really, truly');
  });

  it('que after a comparative is the conjunction (than), not the relative', async () => {
    const pt = await loadLang('pt');
    // The conjunction's hint is "that" until a rule can show its "than" sense; what matters here is which word it is.
    expect(hint(pt, 'Capitú um dia notou a differença, dizendo que os della eram mais bonitos que os meus.', 'que', 1)).toBe('that');
    expect(hint(pt, 'Não estando abotoadas, as mangas caíram naturalmente, e eu vi-lhe metade dos braços, muito claros, e menos magros do que se poderiam supor.', 'que')).toBe('that');
  });

  it('S. before a name is São or Santo', async () => {
    const pt = await loadLang('pt');
    expect(hint(pt, 'Póde ir a S. Paulo, a Pernambuco ou ainda mais longe.', 'S.')).toBe('saint');
    expect(hint(pt, 'Póde ir a S. Paulo, a Pernambuco ou ainda mais longe.', 'a', 1)).toBe('to');
  });
});

describe('Portuguese hints and phrases in Machado\'s spelling', () => {
  it('reads ao contrario, a principio, em todo caso, a não ser as phrases', async () => {
    const pt = await loadLang('pt');
    expect(hint(pt, 'Ao contrario, o pregão que o preto foi cantando lhe deixára uma impressão aborrecida.', 'contrario')).toBe('on the contrary');
    expect(hint(pt, 'A principio fui timido, mas elle fez-se entrado na minha confiança.', 'principio')).toBe('at first');
    expect(hint(pt, 'Em todo caso, o alienista não lhe attribuiu outra intenção.', 'caso')).toBe('in any case');
  });

  it('gives the hint a reader needs: digit, to cut in, protonotary', async () => {
    const pt = await loadLang('pt');
    expect(hint(pt, 'Era uma via lactea de algarismos.', 'algarismos')).toBe('digit');
    expect(hint(pt, 'Era uma via lactea de algarismos.', 'lactea')).toBe('Milky Way');
    expect(hint(pt, '— Não, não, atalhou ela.', 'atalhou')).toBe('to cut in, cut short');
    expect(lemma(pt, 'O protonotario apostolico', 'protonotario')).toBe('protonotário');
    expect(hint(pt, 'O protonotario apostolico', 'protonotario')).toBe('protonotary');
  });
});
