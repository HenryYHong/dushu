// French context rules (src/lang/spaced/fr-context.ts) on the sentences where readers of Perrault's Contes (1697),
// Maupassant's La Parure (1884) and Flaubert's Madame Bovary (1857) met the defects: the small words whose reading
// depends on their neighbors, each with a sentence where it must move and one where it must stay.
import { describe, expect, it } from 'vitest';
import type { LangEngine } from '../../../src/lang/types';
import { loadLang, lookupIn, tok } from './load';

/** The hint over a word of a sentence (the nth of that spelling). */
async function hint(sentence: string, word: string, nth = 0): Promise<string | undefined> {
  const fr = await loadLang('fr');
  return fr.hint(tok(fr, sentence, word, nth));
}

/** The part of speech of the reading a word of a sentence leads its card with, after a fixed phrase it is part of. */
const pos = (fr: LangEngine, sentence: string, word: string, nth = 0): string | undefined =>
  lookupIn(fr, sentence, word, nth).entries.find((e) => e.senses.length && e.senses[0].pos !== 'phrase')?.senses[0].pos;

const BARBE_BLEUE = 'La Barbe-Bleue se mit à crier si fort que toute la maison en trembla.';
const CENDRILLON = 'On l’apporta chez les deux sœurs, qui firent tout leur possible pour faire entrer leur pied dans la pantoufle, mais elles ne purent en venir à bout.';
const FUSEAU = 'Elle n’eut pas plus tôt pris le fuseau, que, comme elle était fort vive, un peu étourdie, et que d’ailleurs l’arrêt des fées l’ordonnait ainsi, elle s’en perça la main et tomba évanouie.';
const COUVERT = 'Le roi lui fit donner un couvert ; mais il n’y eut pas moyen de lui donner un étui d’or massif, comme aux autres, parce que l’on n’en avait fait faire que sept, pour les sept fées.';
const BAPTEME = 'On fit un beau baptême ; on donna pour marraine à la petite princesse toutes les fées qu’on put trouver dans le pays (il s’en trouva sept), afin que, chacune d’elles lui faisant un don, comme c’était la coutume des fées en ce temps-là, la princesse eût, par ce moyen, toutes les perfections imaginables.';

describe('en: the pronoun "of it" before a verb, the preposition before a noun or a gerund (fr-1)', () => {
  it('after a clitic, before a plain verb or an infinitive', async () => {
    expect(await hint('« Rassurez-vous, roi et reine, votre fille n’en mourra point. »', 'en')).toBe('of it, some');
    expect(await hint(BAPTEME, 'en', 0)).toBe('of it, some');
    expect(await hint(BARBE_BLEUE, 'en')).toBe('of it, some');
    // "en venir à bout" is a phrase of its own ("to manage"); its en is the pronoun all the same.
    expect(await hint(CENDRILLON, 'en')).toBe('to manage, overcome');
    expect(pos(await loadLang('fr'), CENDRILLON, 'en')).toBe('pronoun');
    expect(await hint('Tout le monde en veut ; c’est très recherché et on n’en donne pas beaucoup aux employés.', 'en')).toBe('of it, some');
    // And the word after it is the verb: donne is donner, not donne "deal".
    const fr = await loadLang('fr');
    expect(tok(fr, 'Tout le monde en veut ; c’est très recherché et on n’en donne pas beaucoup aux employés.', 'donne').key).toBe('donner');
  });

  it('stays the preposition before a gerund and a noun, and the gerund is the verb\'s (fr-12)', async () => {
    const fr = await loadLang('fr');
    const parure = 'Elle avait une amie riche, une camarade de couvent qu’elle ne voulait plus aller voir, tant elle souffrait en revenant.';
    expect(await hint(parure, 'en')).toBe('in');
    expect(tok(fr, parure, 'revenant').key).toBe('revenir');
    expect(tok(fr, 'Puis, tout en ayant l’air d’écouter Canivet, il se passait l’index sous les narines et répétait:', 'ayant').key).toBe('avoir');
    expect(await hint('— Le Loup lui cria en adoucissant un peu sa voix : Tire la chevillette, la bobinette cherra.', 'en')).toBe('in');
    expect(await hint('Vers quatre heures du matin, Charles, bien enveloppé dans son manteau, se mit en route pour les Bertaux.', 'en')).not.toBe('of it, some');
    expect(await hint('Un matin, qu’elle s’en retournait ainsi, elle crut distinguer tout à coup le long canon d’une carabine qui semblait la tenir en joue.', 'en', 1)).not.toBe('of it, some');
    expect(await hint(BAPTEME, 'en', 1)).toBe('in');
  });
});

describe('des and du: "of the" after what takes de, "some" elsewhere', () => {
  it('reads the contraction after a noun, a pronoun of a whole, an adverb or a verb that takes de', async () => {
    expect(await hint(FUSEAU, 'des')).toBe('of the');
    expect(await hint('Il se mit à pleurer : le couteau lui tomba des mains, et il alla dans la basse-cour couper la gorge à un petit agneau.', 'des')).toBe('of the');
    expect(await hint('À lire des romans, de mauvais livres, des ouvrages qui sont contre la religion et dans lesquels on se moque des prêtres par des discours tirés de Voltaire.', 'des', 2)).toBe('of the');
    expect(await hint('Le Chat, qui allait au devant du carrosse, disait toujours la même chose à tous ceux qu’il rencontrait.', 'du')).toBe('of the');
  });

  it('reads the article after a verb, a preposition and at a sentence start, and as the list it goes on', async () => {
    expect(await hint('Il fit des billets, prit des engagements ruineux, eut affaire aux usuriers, à toutes les races de prêteurs.', 'des')).toBe('some');
    expect(await hint('— On envoya quérir la bonne coiffeuse pour dresser les cornettes à deux rangs, et on fit acheter des mouches de la bonne faiseuse.', 'des')).toBe('some');
    expect(await hint('Des taches de graisse et de tabac suivaient sur sa poitrine large la ligne des petits boutons.', 'Des')).toBe('some');
    expect(await hint('Elle leur fit part des oranges et des citrons que le prince lui avait donnés.', 'des', 1)).toBe('of the');
    const sablon = 'Elle eut beau la laver, et même la frotter avec du sablon et avec du grès, il demeura toujours du sang.';
    expect(await hint(sablon, 'du', 0)).toBe('some');
    expect(await hint(sablon, 'du', 1)).toBe('some');
  });
});

describe('que after ne is "only" (fr-21)', () => {
  it('in ne … que, through the verb and its clitics', async () => {
    expect(await hint(COUVERT, 'que', 1)).toBe('only');
    expect(await hint('Et elle n’aimait que cela.', 'que')).toBe('only');
    const fr = await loadLang('fr');
    expect(lookupIn(fr, COUVERT, 'que', 1).entries[0].senses[0].glosses[0]).toMatch(/^only/);
  });

  it('not after ne savoir, nor in a comparison, nor where pas or a rien before ne completes the negation', async () => {
    expect(await hint('Le prince ne savait qu’en croire, lorsqu’un vieux paysan prit la parole.', 'qu’', 0)).not.toBe('only');
    expect(await hint('Jamais madame Bovary ne fut aussi belle qu’à cette époque.', 'qu’')).not.toBe('only');
    expect(await hint('Ce n’est pas que le bûcheron ne fût peut-être encore plus fâché que sa femme.', 'que', 0)).not.toBe('only');
    expect(await hint('En effet, Bovary pouvait réussir; rien n’affirmait à Emma qu’il ne fût pas habile.', 'qu’')).not.toBe('only');
    expect(await hint(COUVERT, 'que', 0)).toBe('because');
  });
});

describe('si, fort, même, leur, tout: the words of degree and the pronouns before a verb', () => {
  it('reads si before an adjective as "so", and the adjective after it (fr-2)', async () => {
    const s = 'Il était une fois un roi et une reine qui étaient si fâchés de n’avoir point d’enfants, si fâchés qu’on ne saurait dire.';
    expect(await hint(s, 'si')).toBe('so');
    expect(await hint(s, 'fâchés')).toBe('angry');
    expect(await hint('— Mais si tu l’avais perdue dans la rue, nous l’aurions entendue tomber.', 'si')).toBe('if');
    expect(await hint('— Mais si.', 'si')).toBe('yes');
    expect(await hint('— Si, dit-elle.', 'Si')).toBe('yes');
    expect(await hint('elle avait des paroles si affectueuses et des regards si hautains, des façons si diverses, que l’on ne distinguait plus l’égoïsme de la charité.', 'si', 2)).toBe('so');
  });

  it('reads fort before an adjective or after a verb as the adverb (fr-9)', async () => {
    expect(await hint(FUSEAU, 'fort')).toBe('very, strongly');
    expect(await hint(FUSEAU, 'vive')).toBe('lively, keen');
    expect(await hint('Dans ce moment, on heurta si fort à la porte que la Barbe-Bleue s’arrêta tout court.', 'fort')).toBe('very, strongly');
    expect(await hint('la cadette commença à trouver que le maître du logis était un fort honnête homme.', 'fort')).toBe('very, strongly');
    expect(await hint('c’est trop fort!', 'fort')).toBe('strong');
  });

  it('reads même as "even" after a verb and "same" after a determiner (fr-9)', async () => {
    expect(await hint('Toutes ces choses, dont une autre femme de sa caste ne se serait même pas aperçue, la torturaient et l’indignaient.', 'même')).toBe('even');
    expect(await hint('On disait même tout bas à la cour qu’elle avait les inclinations des ogres.', 'même')).toBe('even');
    expect(await hint('Le Chat, qui allait au devant du carrosse, disait toujours la même chose à tous ceux qu’il rencontrait.', 'même')).toBe('same, very');
  });

  it('reads leur before a verb as "to them", before a noun as "their" (fr-10)', async () => {
    expect(await hint('Enfin, pourtant il leur naquit une fille.', 'leur')).toBe('to them');
    expect(await hint(CENDRILLON, 'leur', 1)).toBe('their');
    expect(await hint('Elle alla s’asseoir auprès de ses sœurs et leur fit mille honnêtetés.', 'leur')).toBe('to them');
    expect(await hint('Il ne savait que faire, lorsque, la bûcheronne leur ayant donné à chacun un morceau de pain pour leur déjeuner, il songea qu’il pourrait se servir de son pain au lieu de cailloux.', 'leur', 0)).toBe('to them');
  });

  it('reads tout before an adjective or a preposition as the adverb, before a verb or ce qui as the pronoun', async () => {
    const fr = await loadLang('fr');
    const parc = 'Ces défenses n’étaient pas nécessaires ; car il crut dans un quart d’heure, tout autour du parc, une si grande quantité de grands arbres.';
    expect(pos(fr, parc, 'tout')).toBe('adverb');
    expect(pos(fr, 'Elle approuva tout ce qu’il avait fait.', 'tout')).toBe('pronoun');
    expect(await hint('Elle approuva tout ce qu’il avait fait.', 'tout')).toBe('everything that');
    expect(pos(fr, 'il demanda ce qu’elle faisait là toute seule et ce qu’elle avait à pleurer.', 'toute')).toBe('adverb');
    expect(pos(fr, 'Cependant tout le palais s’était réveillé avec la princesse.', 'tout')).toBe('determiner');
    expect(pos(fr, 'N’était-il pas, lui, l’obstacle à toute félicité, la cause de toute misère ?', 'toute')).toBe('determiner');
    expect(await hint('On l’apporta chez les deux sœurs, qui firent tout leur possible.', 'tout')).toBe('all');
  });
});

describe('ce, voilà, moyen, ensemble, pouvoir, vu, or, aussi', () => {
  it('reads ce before a verb or a relative pronoun as the pronoun', async () => {
    const fr = await loadLang('fr');
    expect(pos(fr, '(Ce fut là la première fois qu’elle l’appela sa fille).', 'Ce')).toBe('pronoun');
    expect(await hint('Ils feraient bonne chère de ce qui nous reste là.', 'ce')).toBe('what, which');
    expect(pos(fr, 'Ce pauvre homme, voyant bien qu’il ne fallait pas se jouer à une ogresse, prit son grand couteau.', 'Ce')).toBe('determiner');
  });

  it('reads voilà as "there is" unless a duration follows (fr-7)', async () => {
    expect(await hint('« Voilà, lui dit-il, les clefs des deux grands garde-meubles ; voilà celles de la vaisselle d’or et d’argent. »', 'Voilà')).toBe('there is');
  });

  it('reads moyen after a determiner or pas as the noun "means" (fr-14)', async () => {
    expect(await hint(BAPTEME, 'moyen')).toBe('means');
    expect(await hint(COUVERT, 'moyen')).toBe('means');
  });

  it('reads ensemble after a verb as "together" (fr-15)', async () => {
    expect(await hint('de grandes herbes minces s’y courbaient ensemble, selon le courant qui les poussait.', 'ensemble')).toBe('together');
    expect(await hint('« C’est à monsieur le marquis de Carabas, » dirent-ils tous ensemble ; car la menace du Chat leur avait fait peur.', 'ensemble')).toBe('together');
  });

  it('reads pouvoir after de before an infinitive as the verb, and les before an infinitive as "them" (fr-20)', async () => {
    const fr = await loadLang('fr');
    const s = 'alla se cacher derrière la tapisserie, afin de parler la dernière, et de pouvoir réparer, autant qu’il lui serait possible, le mal que la vieille aurait fait.';
    expect(pos(fr, s, 'pouvoir')).toBe('verb');
    const bovary = 'il fallait, dès le seuil de la porte, les lancer sous le banc, de façon à frapper contre la muraille en faisant beaucoup de poussière.';
    expect(await hint(bovary, 'les')).toBe('them');
    expect(pos(fr, bovary, 'lancer')).toBe('verb');
    expect(pos(fr, 'Rodolphe vint le soir, plus tôt que de coutume.', 'soir')).toBe('noun');
    expect(pos(fr, '— Je vous avouerai franchement, répondit la princesse, que je n’ai pas encore pris ma résolution là-dessus, et que je ne crois pas pouvoir jamais la prendre telle que vous la souhaitez.', 'pouvoir')).toBe('verb');
    expect(await hint('Les voilà aussitôt à parcourir les chambres, les cabinets, les garde-robes, toutes plus belles et plus riches les unes que les autres.', 'Les')).toBe('them');
  });

  it('reads vu as voir\'s participle unless a determiner follows, and or after a word as gold (fr-7)', async () => {
    expect(await hint('— Tu n’as donc jamais rien vu?', 'vu')).toBe('to see');
    expect(await hint('Aujourd’hui cependant, vu la circonstance, il faut bien que...', 'vu')).toBe('given');
    expect(await hint('une fourchette et un couteau de fin or, garnis de diamants et de rubis.', 'or')).toBe('gold');
    expect(await hint('Or, un soir, son mari rentra, l’air glorieux, et tenant à la main une large enveloppe.', 'Or')).toBe('now, yet');
  });

  it('reads aussi before an inverted verb as "therefore"', async () => {
    expect(await hint('Aussi croyait-il à chaque minute entendre arriver le garde-champêtre.', 'Aussi')).toBe('therefore');
  });
});

describe('adjectives after a word of degree, a copula or a determiner (fr-5)', () => {
  it('reads the adjective, not the noun or the participle', async () => {
    const fr = await loadLang('fr');
    expect(await hint('pour aller chez la jeune mariée, tant elles avaient d’impatience de voir toutes les richesses de sa maison.', 'jeune')).toBe('young');
    expect(await hint('Charles était long à manger; elle grignotait quelques noisettes.', 'long')).toBe('long');
    expect(pos(fr, 'Le jardin, plus long que large, allait, entre deux murs de bauge.', 'long')).toBe('adjective');
    expect(await hint('ils dirent qu’ils n’avaient vu sortir personne qu’une jeune fille fort mal vêtue.', 'mal')).toBe('badly');
    // A pumpkin is a pumpkin; a participle of a compound tense stays the verb.
    expect(pos(fr, 'si elle demeurait au bal un moment davantage, son carrosse redeviendrait citrouille.', 'citrouille')).toBe('noun');
    expect(pos(fr, 'il voulait que Berthe fût bien élevée, qu’elle eût des talents.', 'élevée')).toBe('verb');
    expect(pos(fr, 'sans doute qu’il ne chicanerait pas trop sur la dot.', 'sur')).toBe('preposition');
  });
});

describe('hints the native reader corrected', () => {
  it('reads the 19th-century sense and the whole phrase', async () => {
    expect(await hint('Puis il se demanda ce qu’elle deviendrait, si elle se marierait, et à qui?', 'Puis')).toBe('then');
    expect(await hint(FUSEAU, 'd’ailleurs')).toBe('besides, moreover');
    expect(await hint('La servante parut; Emma comprit, et demanda «ce qu’il faudrait d’argent pour arrêter toutes les poursuites».', 'argent')).toBe('money, silver');
    expect(await hint('elle l’essuya deux ou trois fois ; mais le sang ne s’en allait point.', 'deux')).toBe('two or three');
    expect(await hint('la malheureuse, après avoir bien couru sans trouver personne qui voulût la recevoir, alla mourir au coin d’un bois.', 'coin')).toBe('in the corner');
    expect(await hint('Ces bonnes gens étaient ravis de revoir leurs enfants avec eux, et cette joie dura tant que les dix écus durèrent.', 'eux')).toBe('them');
    expect(await hint('Le roi ordonna qu’on la laissât dormir en repos, jusqu’à ce que son heure de se réveiller fût venue.', 'ce')).toBe('until');
    expect(await hint('Elle se tenait en face, appuyée contre la cloison de la chaloupe, où la lune entrait par un des volets ouverts.', 'tenait')).toBe('to stand, hold on');
  });
});
