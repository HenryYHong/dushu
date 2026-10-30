// Portuguese words whose reading turns on their neighbors (src/lang/spaced/pt-context.ts), each on a sentence of Um apólogo,
// Missa do Galo or Dom Casmurro (1899, in its own spelling) where a reader met it read wrong.
import { describe, expect, it } from 'vitest';
import type { LangEngine } from '../../../src/lang/types';
import { loadLang, tok } from './load';

/** The hint over a word of the sentence (the nth of that spelling). */
const hint = (pt: LangEngine, text: string, word: string, nth = 0): string | undefined => pt.hint(tok(pt, text, word, nth));
const lemma = (pt: LangEngine, text: string, word: string, nth = 0): string | undefined => tok(pt, text, word, nth).lemma;

describe('Portuguese que', () => {
  it('is "that" after a verb, in the cleft é que, and after an adverb', async () => {
    const pt = await loadLang('pt');
    expect(hint(pt, 'Repito que sim, e falarei sempre que me der na cabeça.', 'que')).toBe('that');
    const s = 'Mais tarde é que eu soube que o teatro era um eufemismo em ação.';
    expect(hint(pt, s, 'que', 0)).toBe('that');
    expect(hint(pt, s, 'que', 1)).toBe('that');
    expect(hint(pt, 'Agora que expliquei o titulo, passo a escrever o livro.', 'que')).toBe('that');
  });

  it('is the relative after a noun or a name, and after the comma that follows one', async () => {
    const pt = await loadLang('pt');
    expect(hint(pt, 'Cada qual tem o ar que Deus lhe deu.', 'que')).toBe('which, who');
    expect(hint(pt, 'Quando voltei ao seminario, contei tudo ao meu amigo Escobar, que me ouviu com egual attenção e acabou com a mesma tristeza da outra.', 'que')).toBe('which, who');
  });

  it('asks "what" in a question, and before a noun in an exclamation', async () => {
    const pt = await loadLang('pt');
    expect(hint(pt, 'Que lhe importa o meu ar?', 'Que')).toBe('what');
    expect(hint(pt, '—Que susto, meu Deus!', 'Que')).toBe('what');
    expect(hint(pt, '—De que sexo? perguntei rindo.', 'que')).toBe('what');
  });

  it('is "that" at the head of a clause of its own, with a subjunctive', async () => {
    const pt = await loadLang('pt');
    const s = '— Que a deixe? Que a deixe, por quê?';
    expect(hint(pt, s, 'Que', 0)).toBe('that');
    expect(hint(pt, s, 'Que', 1)).toBe('that');
  });

  it('is "that" after a tão, after a person told something, and again after e', async () => {
    const pt = await loadLang('pt');
    expect(hint(pt, 'As veias eram tão azuis, que apesar da pouca claridade, podia contá-las do meu lugar.', 'que')).toBe('that');
    expect(hint(pt, 'Gurgel tornou á sala e disse a Capitú que a filha chamava por ella.', 'que')).toBe('that');
    const s = 'Não marcou dia; prometteu que ia ver, que falaria logo que pudesse, e que me pegasse com Deus.';
    expect(hint(pt, s, 'que', 3)).toBe('that');
  });

  it('reads o que as "what", and mais que as "more than"', async () => {
    const pt = await loadLang('pt');
    const s = 'Fez o que disse, e atou o lenço outra vez na testa.';
    expect(hint(pt, s, 'o')).toBe('what');
    expect(hint(pt, s, 'que')).toBe('what');
    expect(hint(pt, 'A presença de Conceição espertara-me ainda mais que o livro.', 'que')).toBe('more than');
  });
});

describe('Portuguese se', () => {
  it('is "if, whether" after a verb, at the head of a clause, and before a subject or an article', async () => {
    const pt = await loadLang('pt');
    const s = 'Não sei se disse que isto se passava em casa de uma baronesa, que tinha a modista ao pé de si, para não andar atrás dela.';
    expect(hint(pt, s, 'se', 0)).toBe('if');
    expect(hint(pt, s, 'se', 1)).toBe('oneself');
    expect(hint(pt, s, 'passava')).toBe('to take place');
    expect(hint(pt, 'Deus me perdoe, se a julgo mal.', 'se')).toBe('if');
    expect(hint(pt, 'Deus me perdoe, se a julgo mal.', 'a')).toBe('her');
    expect(hint(pt, 'Se soubesse, não teria falado, mas falei pela veneração, pela estima, pelo affecto.', 'Se')).toBe('if');
  });

  it('is "as if" before the subjunctive after como, the pronoun before the indicative', async () => {
    const pt = await loadLang('pt');
    expect(hint(pt, 'Tambem, se adoeciam, tratava delles como se fossem gente.', 'se', 1)).toBe('if');
    expect(hint(pt, 'Tambem, se adoeciam, tratava delles como se fossem gente.', 'gente')).toBe('people');
    expect(hint(pt, 'O diabo não é tão feio como se pinta.', 'se')).toBe('oneself');
  });

  it('is the pronoun after que, with the subjunctive too', async () => {
    const pt = await loadLang('pt');
    const s = 'Capitú recompoz-se; disse ao filho que se fosse embora, e pediu-me que lhe explicasse.';
    expect(hint(pt, s, 'se')).toBe('oneself');
    expect(hint(pt, s, 'fosse')).toBe('to go away');
  });
});

describe('Portuguese a, o, os, as', () => {
  it('a before an infinitive is "to", unless a preposition comes before it', async () => {
    const pt = await loadLang('pt');
    const s = 'Chegou a costureira, pegou do pano, pegou da agulha, pegou da linha, enfiou a linha na agulha, e entrou a coser.';
    expect(hint(pt, s, 'a', 1)).toBe('the');
    expect(hint(pt, s, 'a', 2)).toBe('to');
    expect(hint(pt, 'Agora que expliquei o titulo, passo a escrever o livro.', 'a')).toBe('to');
    expect(hint(pt, 'Varias pessoas acudiram, mas não tiveram tempo de a levantar; ella ergueu-se muito vexada.', 'a')).toBe('her');
  });

  it('are the article after a verb, at the head of a sentence and before what follows a noun', async () => {
    const pt = await loadLang('pt');
    expect(hint(pt, 'Voltava com ella, arranjavamos o altar, engrolavamos o latim e precipitavamos as cerimonias.', 'as')).toBe('the');
    expect(hint(pt, 'A denuncia de José Dias alvoroçara-me, a licção do velho coqueiro tambem.', 'A')).toBe('the');
    const s = 'Eu, posto que a ideia da paternidade do outro me estivesse já familiar, não gostava da resurreição.';
    expect(hint(pt, s, 'a')).toBe('the');
    expect(lemma(pt, s, 'ideia')).toBe('ideia');
  });
});

describe('Portuguese nos', () => {
  it('is "us" before a verb and "in the" before a noun', async () => {
    const pt = await loadLang('pt');
    const s = 'Agora, se considerares que elle foi unico, imaginarás os cuidados que nos deu, os somnos que nos tirou.';
    expect(hint(pt, s, 'nos', 0)).toBe('us');
    expect(hint(pt, s, 'nos', 1)).toBe('us');
    const q = 'Às dez horas da noite toda a gente estava nos quartos; às dez e meia a casa dormia.';
    expect(hint(pt, q, 'nos')).toBe('in the');
    expect(hint(pt, q, 'toda')).toBe('all, the whole');
    expect(hint(pt, q, 'gente')).toBe('people');
  });
});

describe('Portuguese ser and ir', () => {
  it('foi, foram, fomos are ir before a place, an infinitive or a gerund', async () => {
    const pt = await loadLang('pt');
    expect(lemma(pt, 'A agulha vendo que ela não lhe dava resposta, calou-se também, e foi andando.', 'foi')).toBe('ir');
    const s = 'Os amigos que me restam são de data recente; todos os antigos foram estudar a geologia dos campos santos.';
    expect(lemma(pt, s, 'foram')).toBe('ir');
    expect(hint(pt, s, 'todos')).toBe('all');
    expect(lemma(pt, 'Quando fomos para a casa de Matacavallos, já ella estava assim decorada.', 'fomos')).toBe('ir');
    expect(lemma(pt, 'Foi o mesmo que accender em mim o desejo de ler o que era.', 'Foi')).toBe('ser');
    expect(hint(pt, 'Foi o mesmo que accender em mim o desejo de ler o que era.', 'mesmo')).toBe('the same as');
  });

  it('fui-me is "I went off", and a pronoun of the verb\'s own person is reflexive', async () => {
    const pt = await loadLang('pt');
    const s = 'Sentei-me à mesa que havia no centro da sala, e à luz de um candeeiro de querosene, enquanto a casa dormia, trepei ainda uma vez ao cavalo magro de D’Artagnan e fui-me às aventuras.';
    expect(hint(pt, s, 'fui-me')).toBe('to go away');
    expect(hint(pt, s, 'Sentei-me')).toBe('to sit');
    expect(hint(pt, 'Emfim, despedi-me, veiu ao patamar da escada.', 'despedi-me')).toBe('to say goodbye');
  });

  it('tivera is ter, not estar', async () => {
    const pt = await loadLang('pt');
    expect(lemma(pt, 'Depois referiu uma história de sonhos, e afirmou-me que só tivera um pesadelo, em criança.', 'tivera')).toBe('ter');
  });
});

describe('Portuguese words read by their neighbors', () => {
  it('tarde is "late" after a verb, "afternoon" after an article or before de', async () => {
    const pt = await loadLang('pt');
    expect(hint(pt, 'A idéia do oratório trouxe-me a da missa, lembrou-me que podia ser tarde e quis dizê-lo.', 'tarde')).toBe('late');
    expect(hint(pt, 'Eia, comecemos a evocação por uma celebre tarde de Novembro, que nunca me esqueceu.', 'tarde')).toBe('afternoon');
  });

  it('ora is "now … now" twice in a sentence, "well" alone at its head', async () => {
    const pt = await loadLang('pt');
    expect(hint(pt, 'Os dous pequenos passavam dias, ora no Flamengo, ora na Gloria.', 'ora')).toBe('sometimes … sometimes');
    expect(hint(pt, '—Ora, medo!', 'Ora')).toBe('well, come now');
  });

  it('como asks "how", quer is querer, pois opens with "so", fóra is "outside"', async () => {
    const pt = await loadLang('pt');
    expect(hint(pt, '—Como passou a noite?', 'Como')).toBe('how');
    expect(lemma(pt, '—Mamãe quer que eu seja padre, mas eu não posso ser padre, disse finalmente.', 'quer')).toBe('querer');
    expect(hint(pt, '—Pois eu hei de crer...?', 'Pois')).toBe('so, then, well');
    expect(hint(pt, '—Pois eu hei de crer...?', 'hei')).toBe('will, must');
    expect(hint(pt, 'Ha boas universidades por esse mundo fóra.', 'fóra')).toBe('outside');
  });

  it('D. is Dona before a woman\'s name, and quiz is querer\'s quis', async () => {
    const pt = await loadLang('pt');
    expect(hint(pt, '— Leio, D. Inácia.', 'D.')).toBe('Dona, Dom (title)');
    expect(hint(pt, 'Minha mãe quiz saber o que era.', 'quiz')).toBe('wanted');
  });

  it('after que, a word before its object is the verb: vale, furo', async () => {
    const pt = await loadLang('pt');
    expect(lemma(pt, '— Por que está você com esse ar, toda cheia de si, toda enrolada, para fingir que vale alguma coisa neste mundo?', 'vale')).toBe('valer');
    const s = '— Sim, mas que vale isso? Eu é que furo o pano, vou adiante, puxando por você.';
    expect(lemma(pt, s, 'vale')).toBe('valer');
    expect(lemma(pt, s, 'furo')).toBe('furar');
    expect(hint(pt, s, 'que', 0)).toBe('what');
  });

  it('mesmo is emphatic after a verb, an adverb or a pronoun, "same" after an article', async () => {
    const pt = await loadLang('pt');
    expect(hint(pt, 'Mas, olhe cá, mana Gloria, ha mesmo necessidade de fazel-o padre?', 'mesmo')).toBe('even, really, very');
    expect(hint(pt, 'E com o mesmo balanço do corpo, Conceição enfiou pelo corredor.', 'mesmo')).toBe('same');
  });

  it('eu mesmo is "myself"; á and ás are "to the"', async () => {
    const pt = await loadLang('pt');
    expect(hint(pt, 'Se só me faltassem os outros, vá; um homem consola-se mais ou menos das pessoas que perde; mas falto eu mesmo, e esta lacuna é tudo.', 'mesmo')).toBe('myself');
    expect(hint(pt, 'Os visinhos, que não gostam dos meus habitos reclusos e calados, deram curso á alcunha, que afinal pegou.', 'á')).toBe('to the');
    expect(hint(pt, 'Mas eu não hei de trocar as datas á minha vida só para agradar ás pessoas que não amam historias velhas.', 'ás')).toBe('to the');
  });
});

describe('Portuguese spelled before the reforms', () => {
  it('reads papae, comnosco, abraçal-o and approximou-se', async () => {
    const pt = await loadLang('pt');
    expect(lemma(pt, '—Mamãe, jantar, papae chegou!', 'papae')).toBe('papai');
    expect(lemma(pt, 'Vá aonde quizer, mas fique morando comnosco.', 'comnosco')).toBe('conosco');
    expect(tok(pt, 'Fiquei tão enthusiasmado com a facilidade mental do meu amigo, que não pude deixar de abraçal-o.', 'abraçal-o').key).toBe('abraçar');
    expect(tok(pt, 'Depois, como Padua falasse ao sacristão, baixinho, approximou-se delles.', 'approximou-se').key).toBe('aproximar');
  });
});
