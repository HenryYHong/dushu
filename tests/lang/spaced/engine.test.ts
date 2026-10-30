// The shared engine's own rules (core.ts), each with the sentence from the book an auditor found it wrong in (finding IDs
// from the audit of the classics: es-13 is the thirteenth Spanish one). Language-only rules belong to the languages' tests.
import { describe, expect, it } from 'vitest';
import type { LangEngine } from '../../../src/lang/types';
import { loadLang, lookupIn, tok, words } from './load';

/** The token's dictionary form and hint, as the reader shows them. */
const read = (eng: LangEngine, text: string, word: string, nth = 0): string => {
  const t = tok(eng, text, word, nth);
  return `${t.lemma} ${eng.hint(t) ?? ''}`.trim();
};
/** The part of speech the reading of the word in its sentence has (its card's first sense). */
const pos = (eng: LangEngine, text: string, word: string, nth = 0): string | undefined => lookupIn(eng, text, word, nth).entries[0]?.senses[0]?.pos;

describe('names', () => {
  // Platero y yo opens with the name: before it has come up in the middle of a sentence, beginBook learns it from the book.
  const PLATERO = 'Platero es pequeño, peludo, suave; tan blando por fuera, que se diría todo de algodón, que no lleva huesos.';

  it('a name the book uses in mid-sentence stays one at a sentence start (es-4)', async () => {
    const eng = await loadLang('es');
    eng.beginBook?.('');
    expect(tok(eng, PLATERO, 'Platero').name).toBeFalsy();
    eng.beginBook?.('La cabra va al lado de Platero, rozándose a sus patas, tirando, con los dientes, de la punta de las espadañas de la carga.');
    expect(tok(eng, PLATERO, 'Platero').name).toBe(true);
    expect(eng.hint(tok(eng, PLATERO, 'Platero'))).toBeUndefined();
    // The same paragraph teaches it too: its mid-sentence words are read before the ones that start sentences.
    eng.beginBook?.();
    const para = `${PLATERO} La cabra va al lado de Platero, rozándose a sus patas.`;
    expect(tok(eng, para, 'Platero', 0).name).toBe(true);
    eng.beginBook?.();
  });

  it('a common word a line of verse capitalizes is not learned as one (it: "La piccola mia lampa / Non, come sol")', async () => {
    const eng = await loadLang('it');
    // Il fu Mattia Pascal.
    eng.beginBook?.('La piccola mia lampa Non, come sol, risplende, Nè, come incendio, fuma.');
    const t = tok(eng, 'Oh perchè dunque il signor Anselmo Paleari ne voleva accendere ora un altro col vetro rosso, là in camera mia, pe’ suoi esperimenti spiritici? Non era già di troppo quell’uno?', 'Non');
    expect(t.name).toBeFalsy();
    expect(t.key).toBe('non');
    eng.beginBook?.();
  });

  it('an unknown capitalized word at a sentence start is not a name (es-16): Detúvose', async () => {
    const eng = await loadLang('es');
    // Marianela, ch. I.
    const t = tok(eng, 'Detúvose, y mirando a todo el círculo del horizonte, parecía impaciente y desasosegado.', 'Detúvose');
    expect(t.name).toBeFalsy();
    expect(t.key).toBe('detener');
  });

  it('quoted speech starts a sentence: after « and a colon (fr-13, ru-23, pt-17)', async () => {
    const fr = await loadLang('fr');
    // Perrault, La Belle au bois dormant.
    const text = 'Dans ce moment, la jeune fée sortit de derrière la tapisserie, et dit tout haut ces paroles : « Rassurez-vous, roi et reine, votre fille n’en mourra point. »';
    expect(tok(fr, text, 'Rassurez-vous').name).toBeFalsy();
    expect(tok(fr, text, 'Rassurez-vous').key).toBe('rassurer');
    const ru = await loadLang('ru');
    // Tolstoy, Три медведя.
    const bear = 'Большой медведь взял свою чашку, взглянул и заревел страшным голосом: «Кто хлебал в моей чашке!»';
    expect(tok(ru, bear, 'Кто').name).toBeFalsy();
    expect(ru.hint(tok(ru, bear, 'Кто'))).toBe('who');
  });
});

describe('scoring', () => {
  it('a regional function word does not beat a plural noun (es-22): las naranjas mandarinas', async () => {
    const eng = await loadLang('es');
    // Platero y yo, ch. I.
    expect(read(eng, 'Le gustan las naranjas mandarinas, las uvas moscateles, todas de ámbar, los higos morados, con su cristalina gotita de miel.', 'naranjas')).toBe('naranja orange');
  });

  it('a function word gives way where it cannot stand: d’or is gold, la plus belle personne a person (fr-7)', async () => {
    const eng = await loadLang('fr');
    // Perrault, La Belle au bois dormant.
    expect(pos(eng, 'On mit devant chacune d’elles un couvert magnifique, avec un étui d’or massif où il y avait une cuiller, une fourchette et un couteau de fin or, garnis de diamants et de rubis.', 'or')).toBe('noun');
    expect(pos(eng, 'La plus jeune lui donna pour don qu’elle serait la plus belle personne du monde.', 'personne')).toBe('noun');
  });

  it('a form of another word does not borrow its frequency: la pelle is skin, il sole the sun (it-10)', async () => {
    const eng = await loadLang('it');
    // Pinocchio.
    const pelle = 'Vedo che ha la pelle molto dura, e con la sua pelle voglio fare un tamburo per la banda musicale del mio paese.';
    expect(read(eng, pelle, 'pelle', 0)).toBe('pelle skin');
    expect(read(eng, pelle, 'pelle', 1)).toBe('pelle skin');
    expect(read(eng, 'il sole apparve fuori in tutto il suo splendore, e il mare diventò tranquillissimo e buono come un olio.', 'sole')).toBe('sole sun');
  });

  it('a female word is itself, not the male one’s feminine (it-10, es-18, ru)', async () => {
    const it_ = await loadLang('it');
    // Pinocchio; Il fu Mattia Pascal.
    expect(read(it_, 'e guardando vide in un palco una bella signora, che aveva al collo una grossa collana d’oro.', 'signora')).toBe('signora lady');
    expect(tok(it_, 'Zia Scolastica (l’ho saputo dipoi) voleva a tutti i costi che mia madre riprendesse marito.', 'Zia').key).toBe('zia');
    const es = await loadLang('es');
    // Marianela.
    expect(tok(es, 'Esto decía, cuando se vino corriendo hacia ellos una muchacha, una niña, una chicuela, de ligerísimos pies y menguada estatura.', 'muchacha').key).toBe('muchacha');
  });

  it('an interjection standing apart is one (es-6): ¡Ay, qué relumbres!', async () => {
    const eng = await loadLang('es');
    // Platero y yo.
    const text = '¡Ay, qué relumbres y olores! ¡Ay, cómo ríen los prados! ¡Ay, qué alboradas se oyen!';
    expect(words(eng, text).filter((t) => t.text === 'Ay').map((t) => t.key)).toEqual(['ay', 'ay', 'ay']);
  });
});

describe('the words around', () => {
  it('after a preposition or a determiner that agrees, the noun whatever the verb’s odds (es-13): de tanta sed', async () => {
    const eng = await loadLang('es');
    // Quiroga, La tortuga gigante.
    expect(read(eng, 'La fiebre aumentaba siempre, y la garganta le quemaba de tanta sed.', 'sed')).toBe('sed thirst');
  });

  it('right after a noun, an agreeing adjective (es-10, fr-11)', async () => {
    const es = await loadLang('es');
    // Quiroga, La tortuga gigante.
    expect(pos(es, 'El hombre enfermo aceptó, y se fué a vivir al monte, lejos, más lejos que Misiones todavía.', 'enfermo')).toBe('adjective');
    const fr = await loadLang('fr');
    // Madame Bovary.
    expect(pos(fr, 'Quoiqu’il ne fût pas large des épaules, son habit-veste de drap vert à boutons noirs devait le gêner aux entournures.', 'noirs')).toBe('adjective');
  });

  it('between an article and a noun, the adjective; the article’s gender sorts nouns only (fr-5)', async () => {
    const eng = await loadLang('fr');
    // Perrault; Madame Bovary.
    expect(read(eng, 'Dans ce moment, la jeune fée sortit de derrière la tapisserie, et dit tout haut ces paroles.', 'jeune')).toBe('jeune young');
    expect(pos(eng, 'et d’où pendait, au bout d’un long cordon trop mince, un petit croisillon de fils d’or, en manière de gland.', 'long')).toBe('adjective');
  });

  it('after an auxiliary, the participle, through negation, but not over a function word (fr-4, it-3)', async () => {
    const fr = await loadLang('fr');
    // Perrault, Le Chat botté; La Belle au bois dormant.
    expect(tok(fr, 'Le maître Chat arriva enfin dans un beau château, dont le maître était un ogre, le plus riche qu’on ait jamais vu.', 'vu').key).toBe('voir');
    expect(tok(fr, 'on vit entrer une vieille fée, qu’on n’avait point priée, parce qu’il y avait plus de cinquante ans qu’elle n’était sortie d’une tour.', 'plus').key).toBe('plus');
    const it_ = await loadLang('it');
    // Pinocchio.
    expect(read(it_, '— Qui nel mare vicino è arrivato un Pesce-cane grosso come una montagna.', 'arrivato')).toBe('arrivare to arrive');
  });

  it('la, lo weigh all the next word’s readings, and the pair agrees (es-14, pt-9, it-8, es-23)', async () => {
    const es = await loadLang('es');
    // Quiroga, Las medias de los flamencos: vista is ver's participle first, the noun here.
    const medias = 'No apartaban la vista de las medias, y se agachaban también, tratando de tocar con la lengua las patas de los flamencos.';
    expect(es.hint(tok(es, medias, 'la'))).toBe('the');
    expect(tok(es, medias, 'vista').key).toBe('vista');
    // Platero y yo: lo is the pronoun, so dejo is the verb, not dejo "accent".
    expect(tok(es, 'Lo dejo suelto, y se va al prado, y acaricia tibiamente con su hocico, rozándolas apenas, las florecillas rosas, celestes y gualdas.', 'dejo').key).toBe('dejar');
    const pt = await loadLang('pt');
    // Missa do Galo: testa is testar's "tests" first.
    const galo = 'ela, às vezes, ficava séria, muito séria, com a testa um pouco franzida.';
    expect(pt.hint(tok(pt, galo, 'a', 0))).toBe('the');
    expect(tok(pt, galo, 'testa').key).toBe('testa');
    const it_ = await loadLang('it');
    // Pinocchio.
    const so = '— Non lo so, babbo, ma credetelo che è stata una nottata d’inferno, e me ne ricorderò fin che campo.';
    expect(tok(it_, so, 'so').key).toBe('sapere');
    expect(it_.hint(tok(it_, 'finchè, infilata la porta di casa, saltò nella strada e si dètte a scappare.', 'la'))).toBe('the');
  });

  it('un peu keeps its adverb; an article makes a noun of tarde (fr-3)', async () => {
    const fr = await loadLang('fr');
    // Perrault, La Belle au bois dormant.
    expect(pos(fr, 'Elle n’eut pas plus tôt pris le fuseau, que, comme elle était fort vive, un peu étourdie, et que d’ailleurs l’arrêt des fées l’ordonnait ainsi, elle s’en perça la main.', 'peu')).toBe('adverb');
    const es = await loadLang('es');
    // Quiroga, La tortuga gigante.
    expect(pos(es, 'Y como él lo había dicho, la fiebre volvió esa tarde, más fuerte que antes, y perdió de nuevo el conocimiento.', 'tarde')).toBe('noun');
  });

  it('a preposition before a mark is not one, nor after a preposition (it-4): "era già lungo", "per lungo tempo"', async () => {
    const eng = await loadLang('it');
    // Pinocchio.
    const text = 'Il suo naso, che era già lungo, gli diventò più lungo almeno quattro dita.';
    expect(pos(eng, text, 'lungo', 0)).toBe('adjective');
    // Machiavelli, Il Principe.
    expect(pos(eng, 'e la guarisca di quelle sue piaghe già per lungo tempo infistolite.', 'lungo')).toBe('adjective');
    // Le Tour du monde: an objectless preposition is the adverb, if it has one.
    const fr = await loadLang('fr');
    expect(pos(fr, '— Il y a même deux cigares dedans, dit-il; ce sera pour ce soir, après dîner.', 'dedans')).toBe('adverb');
  });
});

describe('reflexive verbs', () => {
  it('an imperative with its own pronoun, not an inversion (fr-16)', async () => {
    const eng = await loadLang('fr');
    // Madame Bovary.
    expect(eng.hint(tok(eng, '— Levez-vous, dit le professeur.', 'Levez-vous'))).toBe('to rise');
    // Perrault: a question.
    expect(eng.hint(tok(eng, '« Que faites-vous là, ma bonne femme ? » dit la princesse.', 'faites-vous'))).toBe('to do');
  });

  it('se joined to an infinitive or gerund (es-11): deteniéndose', async () => {
    const eng = await loadLang('es');
    // Marianela.
    expect(eng.hint(tok(eng, '—Espectáculo asombroso, sí—dijo el forastero deteniéndose en contemplarlo—, pero que a mí antes me causa espanto que placer.', 'deteniéndose'))).toBe('to stop');
  });
});

describe('words joined to a verb', () => {
  it('a clitic on the card is the pronoun, not the article (es-15, it-22)', async () => {
    const es = await loadLang('es');
    // Quiroga, La tortuga gigante.
    const parts = lookupIn(es, 'el director del Zoológico se comprometió a tenerla en el jardín, y a cuidarla como si fuera su propia hija.', 'tenerla').parts!;
    expect(parts.map((p) => p.gloss)).toEqual(['to have', 'her, it']);
    const it_ = await loadLang('it');
    // Pinocchio.
    const lo = lookupIn(it_, 'Detto fatto, prese subito l’ascia arrotata per cominciare a levargli la scorza e a digrossarlo.', 'digrossarlo').parts!;
    expect(lo[1].gloss).not.toBe('the');
  });

  it('a finite verb with its pronoun after it, old style (es-16): hundiose', async () => {
    const eng = await loadLang('es');
    // Marianela.
    const look = lookupIn(eng, 'Dio un paso y hundiose en la frágil tierra movediza.', 'hundiose');
    expect(look.key).toBe('hundir');
    expect(look.parts?.map((p) => p.text)).toEqual(['hundio', 'se']);
  });

  it('Machado’s fazel-o, tiral-os, fil-a, and a verb’s pronouns leave only the verb (pt-5, pt-19)', async () => {
    const eng = await loadLang('pt');
    // Dom Casmurro.
    const look = lookupIn(eng, 'Vi-lhe fazer um gesto para tiral-os outra vez do bolso, mas não passou do gesto.', 'tiral-os');
    expect(look.key).toBe('tirar');
    expect(look.parts?.map((p) => p.gloss)).toEqual(['to take', 'them']);
    expect(tok(eng, 'um homem consola-se mais ou menos das pessoas que perde.', 'consola-se').key).toBe('consolar');
  });
});

describe('spellings a book has its own way', () => {
  it('an accent left off: oir, seminario, ceu (es-25, pt-2)', async () => {
    const es = await loadLang('es');
    // Quiroga, La tortuga gigante.
    expect(read(es, 'Al oir esto, la tortuga se sintió con una fuerza inmensa porque aún tenía tiempo de salvar al cazador.', 'oir')).toBe('oír to hear');
    const pt = await loadLang('pt');
    // Dom Casmurro.
    const gloria = '—D. Gloria, a senhora persiste na ideia de metter o nosso Bentinho no seminario?';
    expect(tok(pt, gloria, 'seminario').key).toBe('seminário');
    expect(tok(pt, gloria, 'metter').key).toBe('meter');
    const visinhos = 'Os visinhos, que não gostam dos meus habitos reclusos e calados, deram curso á alcunha, que afinal pegou.';
    expect(tok(pt, visinhos, 'visinhos').key).toBe('vizinho');
    expect(tok(pt, visinhos, 'habitos').key).toBe('hábito');
  });

  it('the other accent, not none: Collodi’s sè and ripetè (it-9)', async () => {
    const eng = await loadLang('it');
    // Pinocchio.
    expect(read(eng, '— Che nome gli metterò? — disse fra sè e sè.', 'sè')).toBe('sé oneself');
    expect(lookupIn(eng, '— Aprimi, ti dico! — ripetè Geppetto — se no, quando vengo in casa, il gatto te lo do io!', 'ripetè').form).toMatch(/historic/);
  });

  it('j for i, a clipped vowel (it-24): bujo, picchiar, pover’', async () => {
    const eng = await loadLang('it');
    // Pinocchio.
    expect(tok(eng, '— Non mi picchiar tanto forte! —', 'picchiar').key).toBe('picchiare');
    expect(tok(eng, 'Insomma, tanto dissero e tanto fecero, che il carabiniere rimesse in libertà Pinocchio, e condusse in prigione quel pover’uomo di Geppetto.', 'pover’').key).toBe('povero');
    // Il fu Mattia Pascal.
    expect(tok(eng, 'non fa accendere i lampioni, e spesso — se è nuvolo — ci lascia al bujo.', 'bujo').key).toBe('buio');
  });

  it('a book’s е for ё gets the stress mark on it (ru-15), and й does not move a mark (ru-14)', async () => {
    const eng = await loadLang('ru');
    // Каштанка.
    expect(tok(eng, 'Она была поменьше, и звали ее Настасья Петровна.', 'ее').stress).toBe(1);
    // Белые ночи.
    expect(tok(eng, '— Простите, если я вам скажу опять что-нибудь такое… Но вот что: я не могу не прийти сюда завтра.', 'прийти').stress).toBe(5);
  });
});

describe('German', () => {
  it('a separable verb is one reading on both its pieces (de-3)', async () => {
    const eng = await loadLang('de');
    // Die Verwandlung.
    const text = 'Gregor hatte ausführlich antworten und alles erklären wollen, beschränkte sich aber bei diesen Umständen darauf, zu sagen: »Ja, ja, danke, Mutter, ich stehe schon auf.«';
    expect(read(eng, text, 'stehe')).toBe('aufstehen to get up');
    expect(read(eng, text, 'auf')).toBe('aufstehen to get up');
    const card = lookupIn(eng, text, 'auf');
    expect(card.entries[0].head).toBe('aufstehen');
    expect(card.form).toBe('part');
    expect(card.parts?.map((p) => p.text)).toEqual(['stehe', 'auf']);
    expect(lookupIn(eng, text, 'stehe').form).toMatch(/first-person singular present/);
  });

  it('finds the verb past commas and clauses of their own, never across a sentence (de-3)', async () => {
    const eng = await loadLang('de');
    // Die Verwandlung.
    const vater = 'Der Vater kehrte auch zu seinem Frühstück zurück, die Schwester aber flüsterte: »Gregor, mach auf, ich beschwöre dich.«';
    expect(tok(eng, vater, 'kehrte').key).toBe('zurückkehren');
    expect(tok(eng, vater, 'mach').key).toBe('aufmachen');
    const alle = 'Je tiefer sie gelangten, desto mehr verlor sich das Interesse der Familie Samsa für sie, und alle kehrten, wie erleichtert, in ihre Wohnung zurück.';
    expect(tok(eng, alle, 'kehrten').key).toBe('zurückkehren');
    // Immensee: a full stop ends the clause, and a particle starting a sentence is no verb's (kam … Auf is not aufkommen).
    const licht = 'Ein süßer Duft schlug ihm entgegen; das heimelte ihn an, das roch wie zu Haus der Mutter Weihnachtsstube. Mit zitternder Hand zündete er sein Licht an.';
    expect(tok(eng, licht, 'zündete').key).toBe('anzünden');
    expect(tok(eng, licht, 'roch').key).toBe('riechen');
    const abreise = 'So kam der letzte Tag der Ferienzeit und der Morgen der Abreise. Auf ihre Bitte erhielt Elisabeth von der Mutter die Erlaubnis, ihren Freund an den Postwagen zu begleiten.';
    expect(tok(eng, abreise, 'kam').key).toBe('kommen');
  });

  it('a capital in mid-sentence the dictionary has as a noun is that noun (de-9)', async () => {
    const eng = await loadLang('de');
    // Immensee.
    expect(read(eng, 'Nun ging er gleich an die Arbeit; Nägel, Hammer und die nötigen Bretter waren schon bereit.', 'Hammer')).toMatch(/^Hammer /);
    // Effi Briest: a capital with no noun of its own is the lower-case word (formal Ihnen is ihnen, "you").
    expect(tok(eng, '»Nun, Kind«, sagte die Ritterschaftsrätin, »wie geht es Ihnen denn eigentlich?«', 'Ihnen').key).toBe('sie');
  });

  it('a compound’s hint is its head’s meaning, its pieces on the card (de-11): Weckuhr', async () => {
    const eng = await loadLang('de');
    // Die Verwandlung.
    const text = 'Und er sah zur Weckuhr hinüber, die auf dem Kasten tickte.';
    const uhr = eng.hint(words(eng, 'Uhr')[0]);
    expect(eng.hint(tok(eng, text, 'Weckuhr'))).toBe(uhr);
    expect(eng.hint(tok(eng, text, 'Weckuhr'))).not.toMatch(/^to /);
    expect(lookupIn(eng, text, 'Weckuhr').parts?.map((p) => p.text)).toEqual(['Weck', 'uhr']);
  });
});
