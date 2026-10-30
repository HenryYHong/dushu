// What the shared engine (core.ts, context.ts) does for every spaced language and the language rules that use it: a rule's
// own hint for the reading it chooses, a rule keeping a phrase off, phrases found by a verb's infinitive, the accent a
// capital lost, Roman numerals, titles and initials, one reading per Russian stress and the aspect of a verb, German's old
// spellings, separated and joined particles and compounds. Every sentence is from a book in public/samples or the fixtures.
import { describe, expect, it } from 'vitest';
import type { ContextReading } from '../../../src/lang/spaced/context';
import { FRENCH } from '../../../src/lang/spaced/fr';
import { ITALIAN } from '../../../src/lang/spaced/it';
import { loadCustom, loadLang, lookupIn, tok, words } from './load';

describe('a rule names the sense of the reading it chooses (ContextChoice.hint)', () => {
  it('Spanish que after a comparison is "than", and the card leads with that sense', async () => {
    const es = await loadLang('es');
    // Cuentos de la selva.
    const text = 'El hombre enfermo aceptó, y se fué a vivir al monte, lejos, más lejos que Misiones todavía.';
    expect(es.hint(tok(es, text, 'que'))).toBe('than');
    expect(lookupIn(es, text, 'que').entries[0].senses[0].glosses[0]).toBe('than');
    // After a superlative it is the relative (Lazarillo).
    expect(es.hint(tok(es, '"Tio, éste es el paso más angosto que en el arroyo hay.', 'que'))).not.toBe('than');
    // Past a noun, before its verb (Cuentos de la selva).
    expect(es.hint(tok(es, 'Ya no habrá más pescados ni bichos que vengan a tomar agua, y nos moriremos de hambre.', 'que'))).not.toBe('than');
  });

  it('Spanish impersonal haber is "there was", hacer\'s weather "it is cold", hace before a span of time "ago"', async () => {
    const es = await loadLang('es');
    // Cuentos de la selva.
    expect(es.hint(tok(es, 'Pero no había ni un pescado.', 'había'))).toBe('there was, there were');
    expect(lookupIn(es, 'Pero no había ni un pescado.', 'había').entries[0].senses[0].glosses.join(' ')).toMatch(/there be/);
    // Platero y yo.
    expect(es.hint(tok(es, 'Hubo un súbito silencio', 'Hubo'))).toBe('there was, there were');
    // The auxiliary stays (Cuentos de la selva).
    expect(es.hint(tok(es, 'Y como él lo había dicho, la fiebre volvió esa tarde, más fuerte que antes, y perdió de nuevo el conocimiento.', 'había'))).toBe('to have');
    // El sombrero de tres picos, Cuentos de la selva.
    expect(es.hint(tok(es, '—Vamos, vamos; aquí hace frío.', 'hace'))).toBe('it is cold');
    expect(lookupIn(es, '—Vamos, vamos; aquí hace frío.', 'hace').entries[0].senses[0].glosses[0]).toMatch(/weather/);
    expect(es.hint(tok(es, 'Hacía mucho frío, además, y adentro reinaba la oscuridad más completa', 'Hacía'))).toBe('it was cold');
    // Marianela.
    expect(es.hint(tok(es, '—Dicen que hace tres años', 'hace'))).toBe('ago');
  });

  it('French que after plus is "than", after aussi "as"; comme opening an exclamation "how"; plus after ne "no longer"', async () => {
    const fr = await loadLang('fr');
    // Perrault, Madame Bovary, La Parure.
    expect(fr.hint(tok(fr, 'il ne se peut rien de plus beau que cette cour', 'que'))).toBe('than');
    expect(fr.hint(tok(fr, 'Jamais madame Bovary ne fut aussi belle qu’à cette époque', 'qu’'))).toBe('as');
    // A verb between them takes the que (Candide).
    expect(fr.hint(tok(fr, 'rendaient les derniers soupirs; d’autres à demi brûlées criaient qu’on achevât de', 'qu’'))).not.toBe('than');
    expect(fr.hint(tok(fr, 'Qui sait ? qui sait ? Comme la vie est singulière, changeante !', 'Comme'))).toBe('how');
    expect(fr.hint(tok(fr, 'Il n’était plus reconnaissable.', 'plus'))).toMatch(/^no longer/);
    // And de plus before an adjective is no "moreover".
    expect(fr.hint(tok(fr, 'il ne se peut rien de plus beau que cette cour', 'plus'))).toBe('more');
  });

  it('French faire before an infinitive makes someone do it, venir de has just done it, même after a time is "very"', async () => {
    const fr = await loadLang('fr');
    // Perrault, Candide.
    expect(fr.hint(tok(fr, 'Ce terrible don fit frémir toute la compagnie, et il n’y eut personne qui ne pleurât.', 'fit'))).toBe('to make, have (done)');
    expect(fr.hint(tok(fr, 'On le fait tourner à droite, à gauche, hausser la baguette, remettre la baguette, coucher en joue, tirer', 'fait'))).toBe('to make, have (done)');
    const clef = 'Elle pensa mourir de peur, et la clef du cabinet qu’elle venait de retirer de la serrure, lui tomba de la main.';
    expect(fr.hint(tok(fr, clef, 'venait'))).toBe('to have just');
    // Not the phrase venir de "to come from".
    expect(lookupIn(fr, clef, 'venait').phrase).toBeUndefined();
    expect(fr.hint(tok(fr, 'Il s’adressa ensuite à un homme qui venait de parler tout seul une heure de suite sur la charité dans une grande assemblée.', 'venait'))).toBe('to have just');
    expect(fr.hint(tok(fr, 'Cacambo partit dès le jour même: c’était un très bon homme que ce Cacambo.', 'même'))).toBe('very');
  });

  it('Russian потому, что and оттого, что are "because"; стал before an infinitive "began"; да standing alone "yes"', async () => {
    const ru = await loadLang('ru');
    // Каштанка, Белые ночи.
    expect(ru.hint(tok(ru, 'В первые дни знакомства Каштанка думала, что он говорит много потому, что очень умён, но прошло немного времени', 'потому'))).toBe('because');
    const began = 'Я пришел назад в город очень поздно, и уже пробило десять часов, когда я стал подходить к квартире.';
    expect(ru.hint(tok(ru, began, 'стал'))).toBe('began');
    expect(lookupIn(ru, began, 'стал').entries[0].senses[0].glosses[0]).toBe('to begin');
    expect(ru.hint(tok(ru, '— Да, вы наймите у нас.', 'Да'))).toBe('yes');
  });
});

describe('Italian ci and pure say their sense where they stand', () => {
  it('pure after an order is "go ahead", elsewhere "also"', async () => {
    const it_ = await loadLang('it');
    // Pinocchio, Il fu Mattia Pascal.
    expect(it_.hint(tok(it_, "— Va' pure a invitare i tuoi compagni per la colazione di domani: ma ricordati di tornare a casa prima che faccia notte.", 'pure'))).toBe('go ahead');
    expect(it_.hint(tok(it_, 'Subito però mi sovvenne la scusa che io ero pure in ballo lì: parlavano di me, quei due', 'pure'))).toBe('also, too');
  });
});

describe('the rest of what a rule sees and says', () => {
  it('a rule can keep a fixed phrase off (ContextChoice.noPhrase): le petit bois, ce dernier discours, se mettre au lit', async () => {
    const fr = await loadLang('fr');
    // Candide, Madame Bovary.
    expect(lookupIn(fr, 'Un jour Cunégonde, en se promenant auprès du château, dans le petit bois qu’on appelait parc, vit entre des broussailles le docteur Pangloss', 'petit').phrase).toBeUndefined();
    expect(fr.hint(tok(fr, 'Ce dernier discours détermina Candide', 'dernier'))).toBe('last');
    expect(lookupIn(fr, 'les deux savants jugèrent à propos de rétablir le membre', 'propos').phrase).toBeUndefined();
    expect(lookupIn(fr, 'un petit homme fort laid', 'fort').phrase).toBeUndefined();
  });

  it('a reading carries its entry\'s labels, and a Russian verb its aspect', async () => {
    let seen: ContextReading[] = [];
    const it_ = await loadCustom({ ...ITALIAN, context: (q) => { if (q.word.low === 'cagione') seen = q.word.readings; return null; } });
    // I promessi sposi.
    it_.segment('Dal progresso della storia si rileva poi la cagione di queste reticenze.');
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((r) => Array.isArray(r.labels))).toBe(true);
    const ru = await loadLang('ru');
    // Каштанка: after стать only an imperfective stands, засыпа́ть "to fall asleep", not the perfective засы́пать "to fill up".
    const asleep = 'Но скоро утомление и теплота взяли верх над грустью… Она стала засыпать.';
    expect(tok(ru, asleep, 'засыпать').stress).toBe(5);
    const look = lookupIn(ru, asleep, 'засыпать');
    expect(look.entries[0].aspect).toBe('impf');
    // The card can say "perfective; partner: брать" for взять.
    const take = ru.lookup('взять');
    expect(take.entries[0].aspect).toBe('pf');
    expect(take.entries[0].partners).toEqual(['брать']);
  });

  it('a rule sees the paragraph\'s earlier sentences: the Prokurist\'s "Sie haben vielleicht" is polite after "Schonen Sie"', async () => {
    const de = await loadLang('de');
    // Die Verwandlung.
    const text = 'Herr Prokurist! Schonen Sie meine Eltern! Für alle die Vorwürfe, die Sie mir jetzt machen, ist ja kein Grund; man hat mir ja davon auch kein Wort gesagt. Sie haben vielleicht die letzten Aufträge, die ich geschickt habe, nicht gelesen.';
    expect(tok(de, text, 'Sie', 2).key).toBe('Sie');
  });
});

describe('one reading per Russian stress', () => {
  it('lets the case choose the stress: ни сло́ва, твои слова́, час от ча́су', async () => {
    const ru = await loadLang('ru');
    // Белые ночи.
    expect(tok(ru, 'Теперь я не скажу ни слова.', 'слова').stress).toBe(2);
    expect(lookupIn(ru, 'Теперь я не скажу ни слова.', 'слова').form).toMatch(/genitive/);
    expect(tok(ru, 'Я вспомнил твои же слова, Настенька!', 'слова').stress).toBe(4);
    // The Captain's Daughter.
    expect(tok(ru, 'Ветер между тем час от часу становился сильнее.', 'часу').stress).toBe(1);
  });
});

describe('fixed phrases', () => {
  it('a verb\'s phrase by its infinitive, a pronominal one from the pronoun before: se daba cuenta, acababan de', async () => {
    const es = await loadLang('es');
    // Cuentos de la selva, Platero y yo.
    const daba = 'El creía que estaba siempre en la ramada, por que no se daba cuenta de nada.';
    expect(lookupIn(es, daba, 'daba').phrase).toBe('darse cuenta');
    expect(lookupIn(es, daba, 'se').phrase).toBe('darse cuenta');
    expect(lookupIn(es, 'Entonces, al mirar el campo por la ventana abierta, me doy cuenta de que los que alborotan son los pájaros.', 'cuenta').phrase).toBe('darse cuenta');
    // "sin darse cuenta de" is darse cuenta, not dar cuenta de.
    expect(lookupIn(es, 'El hombre comía sin darse cuenta de quién le daba la comida, porque tenía delirio con la fiebre y no conocía a nadie.', 'cuenta').phrase).toBe('darse cuenta');
    expect(es.hint(tok(es, 'Hacía apenas una hora que acababan de colocar el último tronco del dique, cuando el buque de guerra apareció otra vez', 'acababan'))).toBe('to have just');
    // Before a noun a verb's preposition is its own: "antes lo tenía por el asa asido" (Lazarillo).
    expect(lookupIn(es, 'nunca después desamparaba el jarro, antes lo tenía por el asa asido', 'por').phrase).toBeUndefined();
  });

  it('a contraction ends a verb\'s phrase only when the rest of it is an article; an elided word is what it was read as', async () => {
    const pt = await loadLang('pt');
    // Dom Casmurro: not haver de.
    expect(lookupIn(pt, 'Ha dessas reminiscências que não descançam antes que a penna ou a lingua as publique.', 'Ha').phrase).toBeUndefined();
    // Machado's spelling meets the phrase's: deante de is diante de.
    expect(lookupIn(pt, 'Mexia-se todo, falava de tudo, fazia-me parar a cada passo deante de um mostrador ou de um cartaz de theatro.', 'deante').phrase).toBe('diante de');
    const it_ = await loadLang('it');
    // I promessi sposi: s' read as si is not se, so come s'è visto is not come se "as if".
    expect(lookupIn(it_, 'e a fare star a dovere don Rodrigo, come s’è visto di sopra.', 'come').phrase).toBeUndefined();
  });

  it('a verb\'s phrase ending on a contraction gives way to the phrase the contraction starts; a preposition\'s keeps it', async () => {
    const it_ = await loadLang('it');
    // I promessi sposi.
    expect(lookupIn(it_, 'Stando alla larga da\' prepotenti, dissimulando le loro soverchierie passeggiere e capricciose', 'alla').phrase).toBe('alla larga');
    expect(lookupIn(it_, 'La conversazione fu sempre più fredda, fino alla fine.', 'alla').phrase).toBe('fino a');
  });
});

describe('words the printer or the book spells its own way', () => {
  it('a capital without its accent: Quiroga\'s El is él before his verb; Candide\'s A and O are à and ô', async () => {
    const es = await loadLang('es');
    // Cuentos de la selva.
    expect(tok(es, 'El creía que estaba siempre en la ramada, por que no se daba cuenta de nada.', 'El').key).toBe('él');
    expect(es.hint(tok(es, '¡El es un hombre bueno!', 'es'))).toBe('to be');
    const enfermo = 'El hombre enfermo aceptó, y se fué a vivir al monte, lejos, más lejos que Misiones todavía.';
    expect(tok(es, enfermo, 'El').key).toBe('el');
    // Platero y yo: canto is cantar's first person, which él never takes.
    expect(tok(es, 'El canto del grillo', 'El').key).toBe('el');
    // The card of the article does not list él.
    expect(lookupIn(es, enfermo, 'El').entries.some((e) => e.head === 'él')).toBe(false);
    const fr = await loadLang('fr');
    // Candide.
    expect(fr.hint(tok(fr, 'A ce discours, Candide s’évanouit encore; mais revenu à soi, et ayant dit tout ce qu’il devait dire', 'A'))).toBe('to, at');
    expect(tok(fr, 'O ciel! à quel excès se porte le zèle de la religion dans les dames!', 'O').key).toBe('ô');
  });

  it('a chapter\'s Roman numeral is a number: "I. Platero", "VI. Tonterías"; V. is usted', async () => {
    const es = await loadLang('es');
    expect(es.segment('I. Platero').filter((t) => t.kind === 'num').map((t) => t.text)).toEqual(['I']);
    expect(es.segment('VI. Tonterías').filter((t) => t.kind === 'num').map((t) => t.text)).toEqual(['VI']);
    expect(es.segment('—Escúcheme V., señá Frasquita (le dijo Garduña, llamándola aparte).').some((t) => t.kind === 'num')).toBe(false);
  });

  it('Machado\'s nouns without their accents are the nouns: silencio, medico, musica', async () => {
    const pt = await loadLang('pt');
    // Dom Casmurro, O alienista.
    expect(tok(pt, 'Seguiu-se um alto silencio, durante o qual estive a pique de entrar na sala, mas outra força maior, outra emoção.', 'silencio').key).toBe('silêncio');
    expect(tok(pt, 'o nosso medico esperou tres annos', 'medico').key).toBe('médico');
    expect(pt.hint(tok(pt, 'A musica é de Satanaz, joven maestro de muito futuro, que apprendeu no conservatorio do ceu.', 'musica'))).toBe('music');
  });

  it('a vowel cut with an apostrophe, read as the book spells it: Dante\'s perch\' is perché, se\' sei', async () => {
    const it_ = await loadLang('it');
    // Inferno.
    expect(tok(it_, 'perch’ i’ fu’ ribellante a la sua legge', 'perch’').key).toBe('perché');
    expect(tok(it_, 'Or se’ tu quel Virgilio e quella fonte', 'se’').key).toBe('essere');
  });

  it('an unaccented word reads as an accented headword only if it is in the frequency list or a verb\'s form', async () => {
    const es = await loadLang('es');
    // oir is oír (Marianela's spelling); a rare accented headword does not take a word of its own.
    expect(es.lookup('oir').key).toBe('oír');
  });
});

describe('names, titles and abbreviations', () => {
  it('a courtesy title is the common word; the word after one a name unless it is a noun', async () => {
    const fr = await loadLang('fr');
    // Madame Bovary.
    const madame = tok(fr, 'La vieille bonne se présenta, lui fit ses salutations, s’excusa de ce que le dîner n’était pas prêt, et engagea Madame, en attendant, à prendre connaissance de sa maison.', 'Madame');
    expect(madame.name).toBeFalsy();
    expect(fr.hint(madame)).toBe('madam');
    const de = await loadLang('de');
    // Max und Moritz, Effi Briest, Die Verwandlung.
    expect(tok(de, '»Ja, ja, ja!« rief Meister Böck,', 'Böck').name).toBe(true);
    expect(de.hint(tok(de, '»Ja, ja, ja!« rief Meister Böck,', 'Böck'))).toBeUndefined();
    expect(tok(de, 'Dann hängt er am Ende mit der Frau Pastor Trippel zusammen, die wir heute abend sehen sollen?', 'Trippel').name).toBe(true);
    expect(tok(de, '»der Herr Prokurist ist gekommen und erkundigt sich, warum du nicht mit dem Frühzug weggefahren bist.', 'Prokurist').name).toBeFalsy();
  });

  it('an initial after a name or a title; a title\'s abbreviation before a name; etc. ends its sentence', async () => {
    const ru = await loadLang('ru');
    // The Captain's Daughter, Каштанка.
    const b = tok(ru, 'по милости майора гвардии князя Б., близкого нашего родственника.', 'Б.');
    expect(b.name).toBe(true);
    expect(ru.hint(b)).toBeUndefined();
    expect(tok(ru, 'от переплётчика в трактир, из трактира к куму и т. д. Одним словом, когда Каштанка попала на незнакомый тротуар, то уже вечерело и столяр был пьян, как сапожник.', 'Одним').name).toBeFalsy();
    const es = await loadLang('es');
    // Marianela: D. after Sr. is don.
    expect(es.hint(tok(es, '—Otro vaso para el Sr. D. Teodoro—dijo D. Francisco al criado.', 'D.'))).toBe('Mr. (title)');
    const pt = await loadLang('pt');
    // Missa do Galo, Dom Casmurro.
    const sr = '— Mas, Sr. Nogueira, que fará você todo esse tempo?';
    expect(words(pt, sr).map((t) => t.text)).toContain('Sr.');
    expect(tok(pt, sr, 'Nogueira').name).toBe(true);
    expect(pt.hint(tok(pt, 'No principio era o dó, e o dó fez-se ré, etc. Este calix (e enchia-o novamente) este calix é um breve estribilho.', 'Este'))).toBe('this');
  });
});

describe('French words with pronouns joined to them', () => {
  it('ce soir-là is the evening; j\'aime is j\' + aimer; Savez-vous is savoir; an inversion is no imperative', async () => {
    const fr = await loadLang('fr');
    // Lettres de mon moulin, Le Horla, Perrault.
    expect(fr.hint(tok(fr, 'car vous saurez que le diable, ce soir-là, avait pris la face ronde et les traits indécis du jeune sacristain', 'soir-là'))).toBe('evening');
    const horla = 'J’aime ce pays, et j’aime y vivre parce que j’y ai mes racines, ces profondes et délicates racines';
    expect(words(fr, horla).map((t) => t.text).slice(0, 2)).toEqual(['J’', 'aime']);
    expect(tok(fr, horla, 'aime').key).toBe('aimer');
    expect(tok(fr, 'Savez-vous bien que c’est ici la maison d’un Ogre qui mange les petits enfants ?', 'Savez-vous').key).toBe('savoir');
    // A noun or interjection of its own stays: "Il leur donna rendez-vous dans un cabaret" (Candide).
    expect(tok(fr, 'Il leur donna rendez-vous dans un cabaret.', 'rendez-vous').key).toBe('rendez-vous');
    const que = lookupIn(fr, '« Que faites-vous là, ma bonne femme ?', 'faites-vous');
    expect(que.form).toBe('second-person plural present indicative, with the subject after it');
    expect(que.parts?.map((p) => p.text)).toEqual(['faites', 'vous']);
  });

  it('a participle and a present at once is the verb after le: "On le fait tourner", without French\'s own rules', async () => {
    const plain = await loadCustom({ ...FRENCH, context: undefined });
    // Candide.
    const tourner = 'On le fait tourner à droite, à gauche, hausser la baguette, remettre la baguette';
    expect(plain.hint(tok(plain, tourner, 'le'))).toBe('him, it');
    // But an adverb read as itself is no verb.
    expect(plain.hint(tok(plain, 'aussi le révérend père Croust, supérieur de la maison, prit pour moi la plus tendre amitié', 'la', 1))).toBe('the');
  });
});

describe('verbs and their pieces on the card', () => {
  it('a reflexive verb\'s piece has its reflexive sense; Italian ci on a verb of place is "there"', async () => {
    const pt = await loadLang('pt');
    // Dom Casmurro.
    const emfim = 'Emfim, despedi-me, veiu ao patamar da escada; a filha deu-me rocommendações para Capitú e para minha mãe.';
    expect(lookupIn(pt, emfim, 'despedi-me').parts?.[0].gloss).toBe(pt.hint(tok(pt, emfim, 'despedi-me')));
    const it_ = await loadLang('it');
    // I promessi sposi.
    const ci = lookupIn(it_, 'Tu, Renzo, procura di venirci: o se, per caso impensato, tu non potessi, mandate un uomo fidato', 'venirci');
    expect(ci.parts?.[1].gloss).toMatch(/^there/);
  });
});

describe('German', () => {
  it('reads the spelling before 1996 where it is another word too: Muß, Laß', async () => {
    const de = await loadLang('de');
    // Max und Moritz, Immensee.
    expect(tok(de, 'Muß man mit Vergnügen hören.', 'Muß').key).toBe('müssen');
    expect(tok(de, 'Laß uns eine Weile ausruhen; wir finden die andern schon.', 'Laß').key).toBe('lassen');
  });

  it('a separated verb keeps its reflexive sense; a particle after a comma, before zu or in von … aus is no verb\'s', async () => {
    const de = await loadLang('de');
    // Immensee (as the German request quotes it), Die Verwandlung.
    expect(de.hint(tok(de, 'Dann wandte sie sich eilig ab, und Reinhard hörte, wie sie schluchzend die Treppe hinaufging.', 'ab'))).toBe('to turn away');
    const kam = 'Während des Schreibens kam die Bedienerin herein, um zu sagen, daß sie fortgehe, denn ihre Morgenarbeit war beendet.';
    expect(tok(de, kam, 'um').key).toBe('um');
    expect(tok(de, kam, 'kam').key).toBe('hereinkommen');
    expect(tok(de, 'Man sah vom Bett aus, daß er auf vier Uhr richtig eingestellt war; gewiß hatte er auch geläutet.', 'sah').key).toBe('sehen');
  });

  it('a particle verb written as one word the dictionary lacks in that form; a final e cut off', async () => {
    const de = await loadLang('de');
    // Effi Briest, Die Verwandlung, Max und Moritz.
    expect(tok(de, 'als sie auf den breiten, aufgemauerten Balkon hinaustrat', 'hinaustrat').key).toBe('hinaustreten');
    expect(tok(de, 'um in sein Zimmer zurückzuwandern', 'zurückzuwandern').key).toBe('zurückwandern');
    expect(tok(de, "Mancher gibt sich viele Müh'", 'Müh').key).toBe('Mühe');
    expect(tok(de, '»Richtig. Den hätt ich fast vergessen.«', 'hätt').key).toBe('haben');
  });

  it('a compound of nouns says its pieces (Gartenpforte "garden gate"), a verb\'s stem only its head; -ende is no Ende', async () => {
    const de = await loadLang('de');
    // Immensee.
    expect(de.hint(tok(de, 'und dann liefen beide Kinder durchs Haus in den Garten und durch die Gartenpforte hinaus auf die Wiese.', 'Gartenpforte'))).toBe('garden gate');
    // Not twice: Vogelbauer is a birdcage.
    expect(de.hint(tok(de, 'ein vergoldetes Vogelbauer', 'Vogelbauer'))).not.toMatch(/bird bird/);
    // Effi Briest.
    expect(tok(de, 'Effi reichte dem verlegen Eintretenden die Hand, die dieser mit einem gewissen Ungestüm küßte.', 'Eintretenden').key).not.toMatch(/Ende$/);
  });
});
