// What a second native reading of Perrault's Contes (1697), Candide (1759), Madame Bovary (1857), La Parure (1884) and Le
// Horla (1887) found after the context rules (fr-context.ts) and the hints (scripts/lang/wikt/curated/fr.json) of the first
// round: participles read as rare nouns spelled the same, le and la after a relative or a subject, the verb after its
// subject, the reflexive written onto its verb, and the first gloss of common words where these books mean another sense.
// Every sentence is from one of the books.
import { describe, expect, it } from 'vitest';
import type { LangEngine } from '../../../src/lang/types';
import { loadLang, lookupIn, tok } from './load';

/** The hint over a word of a sentence (the nth of that spelling). */
async function hint(sentence: string, word: string, nth = 0): Promise<string | undefined> {
  const fr = await loadLang('fr');
  return fr.hint(tok(fr, sentence, word, nth));
}

/** The key a word of a sentence is read as (what saving it records). */
async function key(sentence: string, word: string, nth = 0): Promise<string> {
  const fr = await loadLang('fr');
  return tok(fr, sentence, word, nth).key!;
}

/** The part of speech of the reading a word of a sentence leads its card with, after a fixed phrase it is part of. */
const pos = (fr: LangEngine, sentence: string, word: string, nth = 0): string | undefined =>
  lookupIn(fr, sentence, word, nth).entries.find((e) => e.senses.length && e.senses[0].pos !== 'phrase')?.senses[0].pos;

const CROISES = 'Il se tenait les bras croisés sur ses genoux, et, ainsi levant la figure vers Emma, il la regardait de près, fixement.';
const HORLA_FEMMES = 'Je me trouvais chez elle avec deux jeunes femmes, dont l’une a épousé un médecin, le docteur Parent, qui s’occupe beaucoup des maladies nerveuses.';
const BARBE_BLEUE = 'Lorsqu’elle fut seule, elle appela sa sœur, et lui dit : Ma sœur Anne, car elle s’appelait ainsi, monte, je te prie, sur le haut de la tour pour voir si mes frères ne viennent point.';
const MUR = 'Il y avait, pour décorer l’appartement, accrochée à un clou, au milieu du mur dont la peinture verte s’écaillait sous le salpêtre, une tête de Minerve au crayon noir.';
const CANDIDE_EXERCICE = 'On le fait tourner à droite, à gauche, hausser la baguette, remettre la baguette, coucher en joue, tirer, doubler le pas, et on lui donne trente coups de bâton.';

describe('a participle or a verb, not a rare word spelled the same (the regression of the rebuild)', () => {
  it('reads a participle right after a noun, not a noun that would want a determiner', async () => {
    expect(await key(CROISES, 'croisés')).toBe('croiser');
    expect(await hint('mais les pêcheurs attardés jurent avoir rencontré rôdant sur les dunes, entre deux marées, autour de la petite ville jetée ainsi loin du monde, un vieux berger.', 'attardés')).toBe('late, lingering');
    expect(await hint('un assez gros homme qui était à genoux, les yeux bandés, sur le tillac d’un des vaisseaux de la flotte.', 'bandés')).toBe('bandaged');
    expect(await hint('Le grand fauteuil était renversé, et même le Fanal de Rouen gisait par terre, étendu entre les deux pilons.', 'étendu')).toBe('stretched out, wide');
  });

  it('reads the verb after et before its object, and l’une as the pronoun with avoir after it', async () => {
    expect(await key('Mais elle était exaspérée de honte, elle avait envie de le battre, elle alla dans le corridor ouvrir la fenêtre et huma l’air frais pour se calmer.', 'huma')).toBe('humer');
    const fr = await loadLang('fr');
    expect(pos(fr, HORLA_FEMMES, 'une')).toBe('pronoun');
    expect(await key(HORLA_FEMMES, 'a')).toBe('avoir');
    expect(await key('une si grande quantité de grands arbres et de petits, de ronces et d’épines entrelacées les unes dans les autres, que bête ni homme n’y aurait pu passer.', 'unes')).toBe('un');
  });

  it('reads pauvre before a name or another adjective as the adjective, a noun before a name as the noun', async () => {
    expect(await hint('Ce pauvre Bovary qui m’avait laissée tout exprès!', 'pauvre')).toBe('poor');
    expect(await hint('car on avait répété durant un mois: «Ce pauvre jeune homme!', 'pauvre')).toBe('poor');
    const fr = await loadLang('fr');
    const reve = 'Elle avait lu Paul et Virginie et elle avait rêvé la maisonnette de bambous, le nègre Domingo, le chien Fidèle, mais surtout l’amitié douce de quelque bon petit frère.';
    expect(pos(fr, reve, 'chien')).toBe('noun');
    // An adjective after a name before its verb stands in apposition.
    expect(pos(fr, 'Dans les premiers temps que Charles fréquentait les Bertaux, madame Bovary jeune ne manquait pas de s’informer du malade.', 'jeune')).toBe('adjective');
  });

  it('reads dessous after de as the preposition, an imperative at the start, and the adjective after a verb', async () => {
    const fr = await loadLang('fr');
    expect(pos(fr, 'Il les tira de dessous le lit, l’un après l’autre.', 'dessous')).toBe('preposition');
    expect(await key('« Faites votre devoir, lui dit-elle en lui tendant le col ; exécutez l’ordre qu’on vous a donné.', 'Faites')).toBe('faire');
    expect(await hint('on vit entrer une vieille fée, qu’on n’avait point priée, parce qu’il y avait plus de cinquante ans qu’elle n’était sortie d’une tour, et qu’on la croyait morte ou enchantée.', 'morte')).toBe('dead');
    expect(await hint('ce n’étaient que des corps étendus d’hommes et d’animaux qui paraissaient morts.', 'morts')).toBe('dead');
    // Without a determiner, mort is no noun.
    expect(await hint('— Cette simple dalle recouvre Pierre de Brézé, seigneur de la Varenne et de Brissac, grand maréchal de Poitou et gouverneur de Normandie, mort à la bataille de Montlhéry, le 16 juillet 1465.', 'mort')).toBe('dead');
    expect(await hint('je voyais la cuve de feu, et je pensais qu’il était là, dans ce four, mort…', 'mort')).toBe('dead');
    // Standing alone, an interjection or an adjective stays one.
    expect(pos(fr, '— Gare!', 'Gare')).toBe('interjection');
    expect(pos(fr, '— Une chose... grave, sérieuse.', 'grave')).toBe('adjective');
  });
});

describe('le, la, les: the article after dont, the pronoun after a subject (the other regression)', () => {
  it('reads the article after dont, lequel …, where a subject comes', async () => {
    const fr = await loadLang('fr');
    expect(pos(fr, MUR, 'la')).toBe('article');
    expect(pos(fr, MUR, 'peinture')).toBe('noun');
  });

  it('reads the pronoun after a subject or a negation, before a verb only, and la before a masculine infinitive', async () => {
    const fr = await loadLang('fr');
    expect(pos(fr, CANDIDE_EXERCICE, 'le')).toBe('pronoun');
    expect(await key(CANDIDE_EXERCICE, 'fait')).toBe('faire');
    expect(pos(fr, 'Cependant elle n’était plus aussi pâle, et son visage avait une expression de sérénité, comme si le sacrement l’eût guérie.', 'l’')).toBe('pronoun');
    expect(pos(fr, 'Alors, j’étais somnambule, je vivais, sans le savoir, de cette double vie mystérieuse.', 'le')).toBe('pronoun');
    expect(pos(fr, '— Pourquoi ne point le dire à Monsieur?', 'le')).toBe('pronoun');
    expect(pos(fr, 'Ce fut alors que le pauvre maître d’hôtel désespéra de la pouvoir encore tromper.', 'la')).toBe('pronoun');
  });
});

describe('the verb after its subject', () => {
  it('after qui, il, je or a name, a verb spelled like a noun or a preposition', async () => {
    expect(await key('Après plusieurs heures de marche, j’atteignis l’énorme bloc de pierres qui porte la petite cité dominée par la grande église.', 'porte')).toBe('porter');
    expect(await key('Le bon Jacques court à son secours, l’aide à remonter.', 'court')).toBe('courir');
    expect(await key('Il passe une grande cour pavée de marbre ; il monte l’escalier ; il entre dans la salle des gardes, qui étaient rangés en haie.', 'entre')).toBe('entrer');
    expect(await key('— Je cours, dit l’apothicaire, chercher dans mon laboratoire, un peu de vinaigre aromatique.', 'cours')).toBe('courir');
    // vous after a preposition is no subject, and comme stays "like".
    const fr = await loadLang('fr');
    expect(pos(fr, 'Que ces comices soient pour vous comme des arènes pacifiques où le vainqueur, en en sortant, tendra la main au vaincu.', 'comme')).toBe('conjunction');
  });
});

describe('the reflexive written onto its verb or apart from it by en, y', () => {
  it('reads s’ennuyait, s’appelait, s’emporta with their reflexive sense', async () => {
    const perrault = 'La jeune demoiselle ne s’ennuyait point et oublia ce que sa marraine lui avait recommandé.';
    expect(await hint(perrault, 's’ennuyait')).toBe('to be bored');
    expect(await hint(BARBE_BLEUE, 's’appelait')).toBe('to be called');
    expect(await hint('Madame s’emporta.', 's’emporta')).toBe('to get angry');
    const fr = await loadLang('fr');
    expect(lookupIn(fr, perrault, 's’ennuyait').entries[0].senses[0].notes ?? []).toContain('reflexive');
  });

  it('reads se … y, en … verb as reflexive, but s’en with a verb of going as "away"', async () => {
    expect(await hint('et, chaque jour, elle s’y acharnait davantage, tarissant toute félicité à la vouloir trop grande.', 'acharnait')).toBe('to persist, be relentless');
    expect(await hint('Puis Charles, ayant bouclé son malade dans le moteur mécanique, s’en retourna chez lui, où Emma, tout anxieuse, l’attendait sur la porte.', 'retourna')).toBe('to go back');
  });

  it('reads se mettre as "to start" only before à and an infinitive', async () => {
    expect(await hint('Candide baisa d’abord le bas de la robe du commandant, ensuite ils se mirent à table.', 'mirent')).toBe('to put');
    expect(await hint('Il s’approcha en tremblant et en admirant, et se mit à genoux auprès d’elle.', 'mit')).toBe('to put');
    expect(await hint('Il se mit à pleurer : le couteau lui tomba des mains, et il alla dans la basse-cour couper la gorge à un petit agneau.', 'mit')).toBe('to start');
  });
});

describe('the small words: plus, pas, du, même, que, bien, or, mal, meilleur', () => {
  it('reads plus after ne as "no longer", not after de', async () => {
    expect(await hint('Un soir que ces enfants étaient couchés, et que le bûcheron était auprès du feu avec sa femme, il lui dit, le cœur serré de douleur : « Tu vois bien que nous ne pouvons plus nourrir nos enfants ; je ne saurais les voir mourir de faim devant mes yeux.', 'plus')).toBe('no longer, no more');
    expect(await hint('— Je viens d’aller consulter mon médecin, car je ne pouvais plus dormir.', 'plus')).toBe('no longer, no more');
    expect(await hint('Charles n’eût osé en souhaiter de plus facile.', 'plus')).not.toBe('no longer, no more');
  });

  it('reads pas after a number or à as the noun "step", but not pas un', async () => {
    const foret = 'Ils allèrent dans une forêt fort épaisse, où, à dix pas de distance, on ne se voyait pas l’un l’autre.';
    expect(await hint(foret, 'pas', 0)).toBe('step');
    expect(await hint(foret, 'pas', 1)).toBe('not');
    expect(await hint('elle les écoutait tous, sans s’engager à pas un d’eux.', 'pas')).toBe('not');
  });

  it('reads du after a verb that takes some of a thing as "some"', async () => {
    expect(await hint('Ce pauvre homme, voyant bien qu’il ne fallait pas se jouer à une ogresse, prit son grand couteau, et monta à la chambre de la petite Aurore : elle avait pour lors quatre ans, et vint en sautant et en riant se jeter à son col, et lui demander du bonbon.', 'du')).toBe('some');
    expect(await hint('et les cochons étant faits pour être mangés, nous mangeons du porc toute l’année.', 'du')).toBe('some');
    expect(await hint('La Barbe-Bleue, l’ayant considérée, dit à sa femme : Pourquoi y a-t-il du sang sur cette clef ?', 'du')).toBe('some');
  });

  it('reads même after a noun the verb follows as "even", after a time as "very"', async () => {
    expect(await hint('Sa grande salle même était ornée d’une tapisserie.', 'même')).toBe('even');
    expect(await hint('Le sucre en poudre même lui parut plus blanc et plus fin qu’ailleurs.', 'même')).toBe('even');
    expect(await hint('La Barbe-Bleue revint de son voyage dès le soir même, et dit qu’il avait reçu des lettres.', 'même')).toBe('very');
    expect(await hint('La mairie se trouvant à une demi-lieue de la ferme, on s’y rendit à pied, et l’on revint de même, une fois la cérémonie faite à l’église.', 'même')).toBe('likewise');
  });

  it('reads que opening a question as "what", bien before que as "although"', async () => {
    expect(await hint('« Que faites-vous là, ma bonne femme ?', 'Que')).toBe('what, which');
    expect(await hint('« Ah ! qu’ai-je fait là ?', 'qu’')).toBe('what, which');
    expect(await hint('Guillaumin, et, bien qu’elle exécrât Tellier, elle blâmait Lheureux.', 'bien')).toBe('although');
    expect(await hint('gouvernés comme un bétail humain par des êtres invisibles bien que tangibles, des sortes de vampires.', 'bien')).toBe('although');
    expect(await hint('Savez-vous bien que c’est ici la maison d’un Ogre qui mange les petits enfants ?', 'bien')).toBe('well');
    expect(await hint('Resté dans l’angle, derrière la porte, si bien qu’on l’apercevait à peine, le nouveau était un gars de la campagne.', 'bien')).not.toBe('although');
  });

  it('reads or before et as gold, mal by a verb or a participle as "badly", meilleur as bon’s', async () => {
    expect(await hint('Elle vit d’abord des bracelets, puis un collier de perles, puis une croix vénitienne, or et pierreries, d’un admirable travail.', 'or')).toBe('gold');
    expect(await hint('qui voltigeant, se soutenant, faisant dans l’air des demi-cercles comme un oiseau, allait, avant de tomber, s’accrocher aux crins mal peignés de la vieille jument blanche, immobile à la porte.', 'mal')).toBe('badly');
    expect(await hint('Mais, naturellement paisible, le petit répondait mal à ses efforts.', 'mal')).toBe('badly');
    const fr = await loadLang('fr');
    const parure = 'je ne sais rien de meilleur que cela… », elle songeait aux dîners fins, aux argenteries reluisantes.';
    expect(tok(fr, parure, 'meilleur').key).toBe('bon');
    expect(fr.hint(tok(fr, parure, 'meilleur'))).toBe('better, best');
    expect(await key('Elle n’avait pas de toilettes, pas de bijoux, rien.', 'toilettes')).toBe('toilette');
  });
});

describe('hints the second reading corrected (curated/fr.json)', () => {
  it('reads the sense the book means', async () => {
    expect(await hint(BARBE_BLEUE, 'lui')).toBe('him, to him/her');
    expect(await hint('Les autres gens de la noce causaient de leurs affaires ou se faisaient des niches dans le dos.', 'causaient')).toBe('to chat, to cause');
    expect(await hint('La princesse demeura toute interdite, et ne répondit rien.', 'demeura')).toBe('to remain, stay');
    expect(await hint('On renvoya la bonne ; on changea de logement ; on loua sous les toits une mansarde.', 'changea')).toBe('to change');
    expect(await hint('Ils prièrent donc le joaillier de ne pas le vendre avant trois jours.', 'prièrent')).toBe('to ask, beg, pray');
    expect(await hint('Cependant, au haut bout de la table, seul parmi toutes ces femmes, courbé sur son assiette remplie, et la serviette nouée dans le dos comme un enfant, un vieillard mangeait.', 'assiette')).toBe('plate');
    expect(await hint('Sur le grand poêle de porcelaine à baguette de cuivre, une statue de femme drapée jusqu’au menton regardait immobile la salle pleine de monde.', 'porcelaine')).toBe('porcelain');
    expect(await hint('Les carreaux, chaque matin, étaient chargés de givre, et la lumière, blanchâtre à travers eux, comme par des verres dépolis, quelquefois ne variait pas de la journée.', 'carreaux')).toBe('windowpane, tile');
    expect(await hint('Candide écoutait attentivement, et croyait innocemment; car il trouvait mademoiselle Cunégonde extrêmement belle.', 'belle')).toBe('beautiful, fine');
    expect(await hint('Quand Charles, bouleversé par la nouvelle de la saisie, était rentré à la maison, Emma venait d’en sortir.', 'bouleversé')).toBe('to upset, overwhelm');
  });

  it('reads the fixed phrase', async () => {
    expect(await hint('Mais cette exaltation délicieuse, qui fait à la fois votre charme et votre tourment, vous a empêchée de comprendre.', 'fois')).toBe('at once, both');
    expect(await hint('— Tu as raison, dit sa marraine, va voir.', 'raison')).toBe('to be right');
  });
});
