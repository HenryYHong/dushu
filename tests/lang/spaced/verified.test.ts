// What six native verifiers found when they read every word of every classic after the shared engine (phrases found by a
// verb's other forms, a rule's own hint, Russian stress by case) and the builder's rank rework, fixed where it went wrong.
// Every sentence is from a book in public/samples. Run against the build that goes with this code (DUSHU_LANG_DATA).
import { describe, expect, it } from 'vitest';
import { loadLang, lookupIn, tok } from './load';

describe('phrases found through a verb\'s other forms', () => {
  it('a pronoun before the verb is its own only in its person (es, it)', async () => {
    const es = await loadLang('es');
    // Marianela: "they give me to understand", not darse a entender; "make me go through", not hacerse pasar por.
    expect(lookupIn(es, '—Paréceme que teniéndolas en mi mano me dan a entender.', 'dan').phrase).toBeUndefined();
    expect(lookupIn(es, '—Pero no me hagan pasar por túneles, que me da mucho miedo.', 'hagan').phrase).toBeUndefined();
    // Cuentos de la selva, Platero y yo: but se daba, me doy are darse cuenta.
    expect(lookupIn(es, 'no se daba cuenta de nada', 'daba').phrase).toBe('darse cuenta');
    const it_ = await loadLang('it');
    // I promessi sposi: "let me go", not lasciarsi andare.
    expect(lookupIn(it_, '«Mi lascino andare ora,» disse Renzo', 'lascino').phrase).toBeUndefined();
  });

  it('se and a person\'s pronoun before the verb keep the plain verb\'s phrase off; se alone does not', async () => {
    const es = await loadLang('es');
    // Cuentos de la selva: his mouth watered, not hacer agua "to let in water"; "se moría de sed" is morir de sed.
    expect(lookupIn(es, 'pero la boca se le hizo agua, y clavó los dientes en el huevo.', 'hizo').phrase).toBeUndefined();
    const sed = 'le dió de beber al hombre, que estaba tendido sobre su manta y se moría de sed.';
    expect(lookupIn(es, sed, 'moría').phrase).toBe('morir de sed');
  });

  it('acabar de is "to have just" in the present and imperfect only (es, pt)', async () => {
    const es = await loadLang('es');
    // Marianela, Leyendas, Cuentos de la selva, Lazarillo.
    expect(lookupIn(es, 'Cuando el joven acabó de hablarle, sus labios se removieron', 'acabó').phrase).toBeUndefined();
    expect(lookupIn(es, 'acabamos de comer, aunque yo nunca empezaba.', 'acabamos').phrase).toBeUndefined();
    expect(es.hint(tok(es, 'Me parece que acabo de salir del caos primitivo.', 'acabo'))).toBe('to have just');
    expect(es.hint(tok(es, '—Acaba de bajar a la huerta—replicó el señor de Penáguilas', 'Acaba'))).toBe('to have just');
    expect(es.hint(tok(es, 'Es como si acabara de bajar del cielo.', 'acabara'))).toBe('to have just');
    expect(lookupIn(es, 'Antes de que Celipín acabara de hablar, los dos se habían puesto en camino', 'acabara').phrase).toBeUndefined();
    const pt = await loadLang('pt');
    // Os Maias.
    expect(lookupIn(pt, 'Era elle, o viuvo, acabando de almoçar, com duas raparigas hespanholas.', 'acabando').phrase).toBeUndefined();
  });

  it('querer decir, volere dire, querer dizer are "to mean" with nobody told', async () => {
    const es = await loadLang('es');
    // Quiroga, Lazarillo.
    expect(lookupIn(es, '¡eso es lo que te dije, lo que te quiero decir!', 'quiero').phrase).toBeUndefined();
    expect(lookupIn(es, 'Como calló, mi amo le preguntó, si quería decir más, que lo dijese.', 'quería').phrase).toBeUndefined();
    const it_ = await loadLang('it');
    // I promessi sposi, Il fu Mattia Pascal; "vuol dire un cervello bizzarro" means one.
    expect(lookupIn(it_, '«E io la prego di volermi dire se si possa far loro del bene', 'volermi').phrase).toBeUndefined();
    expect(lookupIn(it_, '— Non ci ha voluto dire, intanto, donde le fosse venuto quell’anellino', 'voluto').phrase).toBeUndefined();
    expect(lookupIn(it_, 'vuol dire un cervello bizzarro e un po\' balzano', 'vuol').phrase).toBe('volere dire');
    const pt = await loadLang('pt');
    // Os Maias.
    expect(lookupIn(pt, '—Ha uma coisa que eu lhe queria dizer!...', 'queria').phrase).toBeUndefined();
  });

  it('French verb phrases the words after undo: venir de, vouloir dire, avoir mal', async () => {
    const fr = await loadLang('fr');
    // Le Tour du monde, Madame Bovary, Candide, Le Horla.
    expect(lookupIn(fr, 'Il pensait que le moment n’était pas venu de dire à son maître ce qui s’était passé', 'venu').phrase).toBeUndefined();
    expect(lookupIn(fr, 'L’envie lui vint de retourner chez Lheureux:', 'vint').phrase).toBeUndefined();
    expect(lookupIn(fr, 'Je m’écriai, je voulus dire, Arrêtez, barbares!', 'voulus').phrase).toBeUndefined();
    expect(fr.hint(tok(fr, '— J’ai mal dormi ;', 'mal'))).toBe('badly');
    // But "qu'elle venait de retirer" (Perrault) has just.
    expect(fr.hint(tok(fr, 'la clef du cabinet qu’elle venait de retirer de la serrure', 'venait'))).toBe('to have just');
  });

  it('a verb\'s phrase ending on a contraction gives way to the one it starts, and de plus belle is one', async () => {
    const fr = await loadLang('fr');
    // Madame Bovary: au lit "in bed", not se mettre à; Candide: mettre au courant stays.
    expect(lookupIn(fr, 'et le soir avant de se mettre au lit.', 'lit').phrase).toBe('au lit');
    expect(lookupIn(fr, 'il ne put s’empêcher de le mettre au courant de la situation.', 'courant').phrase).toBe('mettre au courant');
    // Le Tour du monde.
    expect(lookupIn(fr, 'la conversation interrompue reprenait de plus belle.', 'belle').phrase).toBe('de plus belle');
    // Candide: about, not "by the way" undone.
    expect(lookupIn(fr, 'Ils allaient s’égorger à propos de la Sainte Vierge.', 'propos').phrase).toBe('à propos de');
  });

  it('a phrase books have as often word for word is found only as spelled (the builder\'s =)', async () => {
    const fr = await loadLang('fr');
    // Madame Bovary.
    expect(lookupIn(fr, 'Il se passa la main sur le visage, tel qu’un homme pris d’étourdissement;', 'passa').phrase).toBeUndefined();
    const pt = await loadLang('pt');
    // Os Maias.
    expect(lookupIn(pt, '—As Rosas Murchas! em hollandez! exclamou Ega apertando as mãos na cabeça.', 'apertando').phrase).toBeUndefined();
    const it_ = await loadLang('it');
    // I promessi sposi: "took out", the plain sense first.
    expect(it_.hint(tok(it_, 'tirò fuori il suo mezzo pane, e sbocconcellando, si mosse verso quella parte.', 'tirò'))).toBe('to pull out');
  });

  it('a phrase\'s hint keeps its whole first gloss when it has no short one', async () => {
    const es = await loadLang('es');
    // Cuentos de la selva.
    expect(es.hint(tok(es, 'Los pescados se han ido, y nos moriremos de hambre.', 'moriremos'))).toBe('to die of hunger');
  });
});

describe('Spanish', () => {
  it('que after a comparison is "than" only where it compares', async () => {
    const es = await loadLang('es');
    // Cuentos de la selva: a superlative's relative.
    expect(es.hint(tok(es, 'Era el pájaro más raro y más feo que puede darse, todo pelado, todo rabón', 'que'))).not.toBe('than');
    // Lazarillo, Cuentos de la selva, Marianela.
    expect(es.hint(tok(es, 'pedir pan por las puertas y casas más grandes que me parecía', 'que'))).not.toBe('than');
    expect(es.hint(tok(es, 'Después, como nada más tenían que hacer allí, salieron de la jaula', 'que'))).not.toBe('than');
    expect(es.hint(tok(es, '—Eso sí que es admirable.... Por más que digas—replicó Florentina', 'que', 1))).not.toBe('than');
    expect(es.hint(tok(es, '—Mira, Nela, más vale que te vayas.', 'que'))).not.toBe('than');
    const educacion = 'No tiene más educación que la que ella misma se ha dado, como planta que se fecunda';
    expect(es.hint(tok(es, educacion, 'que'))).toBe('than');
    expect(es.hint(tok(es, educacion, 'que', 1))).not.toBe('than');
  });

  it('haber with menester, lástima, its subject or a participle before is no "there was"', async () => {
    const es = await loadLang('es');
    // Lazarillo, El sombrero de tres picos.
    expect(es.hint(tok(es, 'porque, puesto caso que yo no había menester muchas salsas para comer', 'había'))).toBe('to have');
    expect(es.hint(tok(es, 'Tanta lástima haya Dios de mí como yo había dél', 'haya'))).toBe('to have');
    expect(es.hint(tok(es, 'Con todo, le quería bien, con ver que no tenía ni podía más, y antes le había lástima que enemistad;', 'había'))).toBe('to have');
    expect(es.hint(tok(es, 'Muerto Su Ilustrísima, y dejado que hubo el mozo el seminario por el cuartel', 'hubo'))).toBe('to have');
    expect(es.hint(tok(es, 'Pero no había ni un pescado.', 'había'))).toBe('there was, there were');
  });
});

describe('French', () => {
  it('an inversion has its subject\'s person; an order stays one', async () => {
    const fr = await loadLang('fr');
    // Le Horla, Lettres de mon moulin, Madame Bovary, Perrault.
    expect(lookupIn(fr, 'Que vois-je là !', 'vois-je').form).toBe('first-person singular present indicative, with the subject after it');
    expect(lookupIn(fr, 'te dis-je encore une fois', 'dis-je').form).toMatch(/^first-person singular .*, with the subject after it$/);
    expect(lookupIn(fr, '— Mais dépêchez-vous, mère Rolet!', 'dépêchez-vous').form).toMatch(/imperative/);
    expect(lookupIn(fr, 'Va dans le jardin, et apporte-moi une citrouille.', 'apporte-moi').form).toMatch(/imperative/);
    expect(lookupIn(fr, '« Que faites-vous là, ma bonne femme ?', 'faites-vous').form).toBe('second-person plural present indicative, with the subject after it');
  });

  it('que is "than" or "as" only after a comparison it completes', async () => {
    const fr = await loadLang('fr');
    // Lettres de mon moulin, Madame Bovary, Candide.
    expect(fr.hint(tok(fr, 'Il faut dire aussi que la bête en valait la peine.', 'que'))).toBe('that');
    expect(fr.hint(tok(fr, 'elle prétendit qu’elle allait mieux et qu’elle se lèverait', 'qu’', 1))).toBe('that');
    expect(fr.hint(tok(fr, 'Étonnée et ravie d’entendre la langue de ma patrie, et non moins surprise des paroles que proférait cet homme', 'que'))).not.toBe('than');
    expect(fr.hint(tok(fr, 'La veille, en effet, on avait apporté un autre papier qu’elle ne connaissait pas;', 'qu’'))).not.toBe('than');
    expect(fr.hint(tok(fr, 'Jamais madame Bovary ne fut aussi belle qu’à cette époque', 'qu’'))).toBe('as');
  });

  it('comme opens an exclamation only with a clause of its own', async () => {
    const fr = await loadLang('fr');
    // Madame Bovary, Le Horla, La Parure, Candide.
    expect(fr.hint(tok(fr, '— comme le premier jour, aux Comices!', 'comme'))).toBe('as');
    expect(fr.hint(tok(fr, '— comme il y a deux ans, lorsqu’elle était malade!', 'comme'))).toBe('as');
    const horla = 'Comme je m’arrêtais à regarder un géant des batailles, qui portait trois fleurs magnifiques, je vis, je vis distinctement, tout près de moi, la tige !';
    expect(fr.hint(tok(fr, horla, 'Comme'))).toBe('as');
    expect(fr.hint(tok(fr, 'Comme la vie est singulière, changeante !', 'Comme'))).toBe('how');
    expect(fr.hint(tok(fr, 'Comme vous voilà faite!', 'Comme'))).toBe('how');
    expect(fr.hint(tok(fr, '— Oh! comme tu as de grands yeux, maman! comme tu es pâle! comme tu sues!...', 'comme', 2))).toBe('how');
  });

  it('a name in capitals finds its accented spelling', async () => {
    const fr = await loadLang('fr');
    // Madame Bovary.
    expect(fr.hint(tok(fr, '«THEODORE ROUAULT.»', 'THEODORE'))).toBeTruthy();
  });
});

describe('Portuguese', () => {
  it('a pronoun hyphened to a verb is its object: no inversion', async () => {
    const pt = await loadLang('pt');
    // A cartomante.
    expect(lookupIn(pt, '«Preciso falar-lhe, sem falta, amanhã; escolha o logar e diga-me.»', 'diga-me').form).not.toMatch(/subject after it/);
  });

  it('que after mais is "than" only where it compares', async () => {
    const pt = await loadLang('pt');
    // Os Maias, Memórias póstumas, Dom Casmurro.
    expect(pt.hint(tok(pt, 'É melhor que te vás embora...', 'que'))).not.toBe('than');
    expect(pt.hint(tok(pt, 'Era o melhor que podia fazer', 'que'))).not.toBe('than');
    expect(pt.hint(tok(pt, 'o homem mais probo que conheci', 'que'))).not.toBe('than');
    expect(pt.hint(tok(pt, 'por mais preparado que estivesse, padeci muito', 'que'))).not.toBe('than');
    expect(pt.hint(tok(pt, 'Em casa brincava de missa, mas era melhor que a ama', 'que'))).toBe('than');
  });

  it('a verb with se joined and its subject after it is passive', async () => {
    const pt = await loadLang('pt');
    // Os Maias, Memórias póstumas.
    expect(pt.hint(tok(pt, 'Arranjaram-se mais cadeiras: aqui e além, sobre a relva pisada', 'Arranjaram-se'))).toBe('to arrange');
    expect(pt.hint(tok(pt, 'vieram as toalhas de Flandres; matou-se um capado; encommendaram-se ás madres', 'matou-se'))).toBe('to kill');
    expect(pt.hint(tok(pt, '—ó vovô, o papá matou-se com uma pistola!', 'matou-se'))).toBe('to commit suicide');
    // Dom Casmurro, Memórias póstumas: "outra vez" is "again", a before an infinitive no subject, foi-se "went away".
    expect(pt.hint(tok(pt, 'Calou-se outra vez.', 'Calou-se'))).toBe('to fall silent');
    expect(tok(pt, 'Foi-se o embryão, naquelle ponto em que se não distingue Laplace de uma tartaruga.', 'Foi-se').key).toBe('ir');
  });

  it('an old feminine reaches its word; an accentless word its accented headword', async () => {
    const pt = await loadLang('pt');
    // Memórias póstumas, Iracema.
    expect(tok(pt, 'A que me captivou foi uma dama hespanhola, Marcella', 'hespanhola').key).toBe('espanhol');
    expect(pt.hint(tok(pt, 'Iracema foi preparar o moquem da viagem.', 'moquem'))).toBeTruthy();
  });

  it('n\' before a word is em, the word after it read as itself', async () => {
    const pt = await loadLang('pt');
    // Iracema.
    expect(tok(pt, '—O coração de Iracema está como o abaty n’agua do rio.', 'agua').key).toBe('água');
  });
});

describe('Italian', () => {
  it('an apostrophe after a preposition, or closing a quote, is no elision', async () => {
    const it_ = await loadLang('it');
    // I promessi sposi, Inferno.
    expect(tok(it_, 'che va a perdersi in lucido serpeggiamento pur tra\' monti che l’accompagnano', 'tra').key).toBe('tra');
    expect(tok(it_, 'e noi movemmo i piedi inver’ la terra,', 'inver').key).toBe('inverso');
    expect(tok(it_, 'che ’l cane a quella lievre ch’elli acceffa’.', 'acceffa').key).toBe('acceffare');
    // But Dante's era: "che già li er' al petto".
    expect(tok(it_, 'E ’l mio buon duca, che già li er’ al petto,', 'er’').key).toBe('essere');
    // Il fu Mattia Pascal: pe' is pei, then l.
    expect(lookupIn(it_, 'Pepita tutt’a un tratto la afferrò pe’l collo e la gettò', 'pe’').key).toBe('pei');
  });

  it('pure after an order heading its clause is "go ahead"', async () => {
    const it_ = await loadLang('it');
    // I promessi sposi, Il fu Mattia Pascal.
    expect(it_.hint(tok(it_, 'Via, fate presto, e venite pure senza timore', 'pure'))).toBe('go ahead');
    expect(it_.hint(tok(it_, 'Ma creda pure che è stata una combinazione', 'pure'))).toBe('go ahead');
    expect(it_.hint(tok(it_, 'bisogna pur considerare che non era più un giovanotto', 'pur'))).toBe('also, too');
  });

  it('a pronominal verb\'s form with no pronoun is the plain verb; grida, venti, vecchia by their neighbors', async () => {
    const it_ = await loadLang('it');
    // I promessi sposi, Il fu Mattia Pascal.
    expect(tok(it_, 'Ma a nessuno la gente accorse in numero tale da potere intraprender tutto', 'accorse').key).toBe('accorrere');
    expect(tok(it_, '—Ma, a questo punto, s’accorse che il pentirsi', 'accorse').key).toBe('accorgersi');
    expect(tok(it_, 'un frastono di mille grida di trionfo e d’imprecazione', 'grida').key).toBe('grido');
    expect(tok(it_, 'nè scemato il numero, dà fuori un’altra grida, ancor più vigorosa', 'grida').key).toBe('grida');
    expect(tok(it_, '«Il nome legittimo,» interruppe ancora il podestà, «come l’ho sentito proferir più volte dal nostro', 'volte').key).toBe('volta');
    // Il principe.
    expect(tok(it_, 'Non è acquea; perchè bagnerebbe, e verrebbe asciugata da’ venti.', 'venti').key).toBe('vento');
    // I promessi sposi: twenty before "e più miglia"; the adjective after molto.
    expect(tok(it_, 'giacchè nelle memorie di quel tempo troviamo che da venti e più miglia veniva gente in folla', 'venti').key).toBe('venti');
    expect(tok(it_, 'Secondo le regole più comuni e men contraddette, è cosa molto brutta;', 'brutta').key).toBe('brutto');
    // Pinocchio; I promessi sposi: not before a word that may be its noun.
    expect(tok(it_, '«Oh!» disse la vecchia.', 'vecchia').key).toBe('vecchia');
    expect(tok(it_, 'la vecchia casa', 'vecchia').key).toBe('vecchio');
    // A participle stands without its pronoun: "s'è avvisto di qualche cosa".
    expect(tok(it_, 's’è avvisto di qualche cosa;', 'avvisto').key).toBe('avvedersi');
  });
});

describe('German', () => {
  it('a compound gives its pieces\' meanings only when each piece has one plain meaning', async () => {
    const de = await loadLang('de');
    // Effi Briest, Die Verwandlung.
    expect(de.hint(tok(de, 'nur an einer Stelle von einer kleinen weißgestrichenen Eisentür unterbrochene Kirchhofsmauer', 'Eisentür'))).toBe('iron door');
    expect(de.hint(tok(de, 'da man ein Zimmer der Wohnung an drei Zimmerherren vermietet hatte', 'Zimmerherren'))).not.toMatch(/room/);
    expect(de.hint(tok(de, 'Haben Sie von Landpartien gehört?', 'Landpartien'))).not.toMatch(/country/);
    expect(de.hint(tok(de, 'Aber ich habe mit ihm eine Partie zu Oberförster Ring verabredet', 'Oberförster'))).not.toMatch(/queen/);
    expect(tok(de, 'klopfte es vorsichtig an die Tür am Kopfende seines Bettes.', 'Kopfende').name).toBeFalsy();
  });

  it('von … aus is a frame only right before aus, with no sich; a particle after a comma is still one', async () => {
    const de = await loadLang('de');
    // Effi Briest, Die Verwandlung, Siddhartha.
    expect(tok(de, 'Frau von Briest drückte ihre Zustimmung aus, bestand aber darauf', 'drückte').key).toBe('ausdrücken');
    expect(tok(de, 'und ruhte sich dort einen Augenblick lang von der Anstrengung aus.', 'ruhte').key).toBe('ausruhen');
    expect(tok(de, 'Man sah vom Bett aus, daß er auf vier Uhr richtig eingestellt war', 'sah').key).toBe('sehen');
    expect(tok(de, 'kam der Spätnachmittagsdampfer die Kessine herunter und legte an der Landungsbrücke, gegenüber dem Hotel, an.', 'legte').key).toBe('anlegen');
  });

  it('a sich a preposition takes makes no reflexive verb', async () => {
    const de = await loadLang('de');
    // Die Verwandlung.
    expect(de.hint(tok(de, 'Im Vorzimmer aber streckte er die rechte Hand weit von sich zur Treppe hin', 'streckte'))).toBe('to stretch out');
  });

  it('Sie in narration after someone\'s speech is "they"', async () => {
    const de = await loadLang('de');
    // Die Verwandlung.
    expect(de.hint(tok(de, '»Mutter?« rief die Schwester von der anderen Seite. Sie verständigten sich durch Gregors Zimmer.', 'Sie'))).toBe('they');
  });

  it('old umlauts and ß: the word spelled so first, the name after a title as spelled', async () => {
    const de = await loadLang('de');
    // Struwwelpeter, Max und Moritz, Siddhartha, Effi Briest, Die Verwandlung.
    expect(tok(de, 'Er schlug die Stühl und Vögel tot', 'Stühl').key).toBe('Stuhl');
    expect(tok(de, '»Ja, ja, ja!« rief Meister Böck', 'Böck').name).toBe(true);
    expect(tok(de, 'während er es mit Fasten und Buße zu töten meinte.', 'Buße').key).toBe('Buße');
    expect(tok(de, 'nicht nur das kleine Fräulein in gleichem Maße liebten', 'Maße').key).toBe('Maß');
    const gewiss = lookupIn(de, 'gewiß hatte er auch geläutet.', 'gewiß');
    expect(gewiss.form).toBe('old spelling');
    expect(de.hint(tok(de, 'gewiß hatte er auch geläutet.', 'gewiß'))).toBe('certainly');
  });

  it('a name the book has after a title stays one wherever it stands, its umlaut kept', async () => {
    const de = await loadLang('de');
    // Max und Moritz.
    de.beginBook!('Wußte Schneider Böck zu machen.\n\nEinen, der sich Böck benannte.');
    expect(tok(de, 'Einen, der sich Böck benannte.', 'Böck').name).toBe(true);
    expect(tok(de, 'Einen, der sich Böck benannte.', 'Böck').key).toBe('Böck');
    de.beginBook!();
  });

  it('an apostrophe closing a quote is no cut-off e', async () => {
    const de = await loadLang('de');
    // Effi Briest.
    expect(tok(de, '\'Ich liebe diese Frau so sehr, daß ich ihr alles verzeihen kann\', und wenn wir dann', 'kann').key).toBe('können');
  });

  it('an article stays one before a declined participle or an old adjective spelling', async () => {
    const de = await loadLang('de');
    // Werther, Immensee.
    expect(de.hint(tok(de, 'fühlte mich in der überfließenden Fülle wie vergöttert', 'der'))).toBe('the');
    expect(de.hint(tok(de, 'Sie hat die goldnen Augen', 'die'))).toBe('the');
  });
});

describe('Russian', () => {
  it('-ка on an imperative is no inversion', async () => {
    const ru = await loadLang('ru');
    // Капитанская дочка.
    expect(lookupIn(ru, 'Подойди-ка поближе, говори, кто тебя подослал', 'Подойди-ка').form).toMatch(/imperative/);
  });

  it('стало after a predicative is "became"', async () => {
    const ru = await loadLang('ru');
    // Белые ночи.
    expect(ru.hint(tok(ru, 'Мне страшно стало оставаться одному', 'стало'))).not.toBe('began');
  });

  it('a noun after a noun keeps its stress when only the stress would tell; a feminine after две its plural\'s', async () => {
    const ru = await loadLang('ru');
    // Герой нашего времени: го́ры the subject, ска́лы after две.
    const gory = tok(ru, 'Со всех сторон горы неприступные, красноватые скалы', 'горы');
    expect(gory.stress === undefined || gory.stress === 1).toBe(true);
    expect(tok(ru, 'хоть бы две скалы, похожие одна на другую', 'скалы').stress).toBe(2);
  });

  it('по- comparatives are their comparative\'s; a comparative gives way to a noun spelled alike', async () => {
    const ru = await loadLang('ru');
    // Белые ночи, Капитанская дочка.
    expect(tok(ru, 'старался держаться подальше от канавы', 'подальше').key).toBe('дальше');
    expect(tok(ru, 'Я жил недорослем, гоняя голубей и играя в чехарду', 'голубей').key).toBe('голубь');
  });
});
