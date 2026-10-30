// German's context rules (src/lang/spaced/de-context.ts) on the sentences of Max und Moritz, Immensee and Die Verwandlung
// where a native reader found the wrong reading (findings de-2 … de-25): the word read by itself, its neighbors decide.
import { describe, expect, it } from 'vitest';
import { loadLang, tok } from './load';

const de = () => loadLang('de');

/** The hint over the nth word `word` of `text`. */
async function hint(text: string, word: string, nth = 0): Promise<string | undefined> {
  const eng = await de();
  return eng.hint(tok(eng, text, word, nth));
}

describe('German der, die, das (de-4)', () => {
  it('are the article before a noun phrase, however it starts', async () => {
    // Die Verwandlung: an extended attribute, adjectives after adverbs; a participle the dictionary lacks inflected.
    expect(await hint('Ein wenig wurde der Fall durch den Teppich abgeschwächt, auch war der Rücken elastischer, als Gregor gedacht hatte, daher kam der nicht gar so auffallende dumpfe Klang.', 'der', 2)).toBe('the');
    expect(await hint('Den verfaulten Apfel in seinem Rücken und die entzündete Umgebung, die ganz von weichem Staub bedeckt war, spürte er schon kaum.', 'Den')).toBe('the');
    // Max und Moritz, Die Verwandlung: an adjective standing for its noun.
    expect(await hint('Doch der zweite folgt sogleich.', 'der')).toBe('the');
    expect(await hint('Warum ging denn die Schwester nicht zu den anderen?', 'den')).toBe('the');
  });

  it('are the relative pronoun after a comma, the demonstrative otherwise', async () => {
    const eng = await de();
    // Immensee.
    const tafel = 'Reinhard stellte die Rechentafel, die er schon unterm Arm hatte, flink hinter die Haustür, und dann liefen beide Kinder durchs Haus in den Garten und durch die Gartenpforte hinaus auf die Wiese.';
    expect(eng.hint(tok(eng, tafel, 'die', 0))).toBe('the');
    expect(eng.hint(tok(eng, tafel, 'die', 1))).toBe('who');
    expect(await hint('Der winkte ihm mit der Hand und ging dann gerade in die Felsen hinein.', 'Der')).toBe('that');
    expect(await hint('Der winkte ihm mit der Hand und ging dann gerade in die Felsen hinein.', 'der')).toBe('the');
    // Max und Moritz: das before its verb.
    expect(await hint('Das ist freilich angenehmer', 'Das')).toBe('that, which');
    // Immensee: after a comma, but its verb comes second with more of the clause after it.
    expect(await hint('»Nein,« sagte Reinhard, »die sind dann zu alt, die können nicht mit.«', 'die', 1)).toBe('that');
  });

  it('read deren as "whose"', async () => {
    const eng = await de();
    const text = 'Da hatte er wirklich keine Zeit mehr, die guten Absichten zu prüfen, welche die zwei Frauen hatten, deren Existenz er übrigens fast vergessen hatte.';
    expect(tok(eng, text, 'deren').key).toBe('dessen');
    expect(eng.hint(tok(eng, text, 'deren'))).toBe('whose');
  });
});

describe('German sie, Sie, ihr (de-2)', () => {
  it('read sie as "they" or "she" by the verb that agrees with it', async () => {
    // Max und Moritz, Immensee.
    expect(await hint('Tak, tak, tak! -- da kommen sie.', 'sie')).toBe('they');
    expect(await hint('Dann gingen sie beide hinein und setzten sich auf die neue Bank.', 'sie')).toBe('they');
    expect(await hint('Auf dem Hofe angekommen trafen sie einen Scherenschleiferkarren vor dem Herrenhause.', 'sie')).toBe('they');
    // An infinitive before its finite verb: indem … stehen blieb is singular.
    expect(await hint('»Wo bleiben denn aber deine Erdbeeren?« fragte sie endlich, indem sie stehen blieb und einen tiefen Atemzug tat.', 'sie', 1)).toBe('she');
  });

  it('read Sie as "you", and Ihr- as "your", in the Prokurist\'s speech', async () => {
    const eng = await de();
    const text = 'Sie verbarrikadieren sich da in Ihrem Zimmer, antworten bloß mit ja und nein, machen Ihren Eltern schwere, unnötige Sorgen.';
    expect(tok(eng, text, 'Sie').key).toBe('Sie');
    expect(eng.hint(tok(eng, text, 'Sie'))).toBe('you');
    expect(eng.hint(tok(eng, text, 'Ihrem'))).toBe('your');
  });

  it('keep a capital Sie before a singular verb "she": a line of verse in Immensee', async () => {
    expect(await hint('Sie sitzt im Thymiane, Sie sitzt in lauter Duft; Die blauen Fliegen summen Und blitzen durch die Luft.', 'Sie', 1)).toBe('she');
  });

  it('read ihr as "you" with its verb, "to her" alone, "their" with a plural verb', async () => {
    const eng = await de();
    expect(await hint('»Habt ihr meine Rede begriffen?«', 'ihr')).toBe('you');
    // Immensee: the dative of sie.
    const winkte = 'Der Mann winkte ihr mit seinem Rohrstock.';
    expect(tok(eng, winkte, 'ihr').key).toBe('sie');
    expect(eng.hint(tok(eng, winkte, 'ihr'))).toBe('her');
    expect(await hint('Die Zimmerherren hatten schon ihr Nachtmahl beendet, der mittlere hatte eine Zeitung hervorgezogen.', 'ihr')).toBe('their');
  });
});

describe('German da, denn, doch, ja (de-7, de-23)', () => {
  it('read da as "there" before its verb, inside or ending a clause, and "since" opening one with its verb last', async () => {
    expect(await hint('Seht, da ist die Witwe Bolte,', 'da')).toBe('there');
    expect(await hint('Angewurzelt stand sie da,', 'da')).toBe('there');
    expect(await hint('Ich hatte ursprünglich die Absicht, Ihnen das alles unter vier Augen zu sagen, aber da Sie mich hier nutzlos meine Zeit versäumen lassen, weiß ich nicht, warum es nicht auch Ihre Herren Eltern erfahren sollen.', 'da')).toBe('since, as');
    expect(await hint('Vielleicht merkte der Vater seinen guten Willen, denn er störte ihn hierbei nicht, sondern dirigierte sogar hie und da die Drehbewegung von der Ferne mit der Spitze seines Stockes.', 'da')).toBe('there');
  });

  it('read denn in a question as the particle, doch opening a clause as "but", ja before a mark as "yes"', async () => {
    expect(await hint('»Herr Samsa,« rief nun der Prokurist mit erhobener Stimme, »was ist denn los?', 'denn')).toBe('then');
    expect(await hint('Doch der Bäcker, mit Bedacht,', 'Doch')).toBe('but, yet');
    expect(await hint('»Ja, ja, danke, Mutter, ich stehe schon auf.«', 'Ja')).toBe('yes');
  });
});

describe('German um … zu, zu, während, damit, wie, selbst, alles (de-6)', () => {
  it('read um as "in order to" with zu and an infinitive, the preposition otherwise', async () => {
    expect(await hint('Er versuchte es wohl hundertmal, schloß die Augen, um die zappelnden Beine nicht sehen zu müssen, und ließ erst ab.', 'um')).toBe('in order to');
    expect(await hint('Der nächste Zug ging um sieben Uhr; um den einzuholen, hätte er sich unsinnig beeilen müssen.', 'um', 0)).toBe('around, at');
    expect(await hint('Der nächste Zug ging um sieben Uhr; um den einzuholen, hätte er sich unsinnig beeilen müssen.', 'um', 1)).toBe('in order to');
  });

  it('read zu before an adjective as "too"', async () => {
    expect(await hint('»Du kommst zu spät,« sagte sie.', 'zu')).toBe('too');
  });

  it('read während, damit and wie by their clause', async () => {
    expect(await hint('Der alte Herr hielt den Jungen die Fortsetzung seiner moralischen Reden, während er eifrig an einem Braten herumtranchierte.', 'während')).toBe('while');
    expect(await hint('Während des Lesens hatte Reinhard ein unmerkliches Zittern des Papiers empfunden.', 'Während')).toBe('during');
    expect(await hint('Ich hab’ dich ganz im geheimen verschrieben, damit die Freude desto größer sei.', 'damit')).toBe('so that');
    expect(await hint('Fort damit und in die Ecke', 'damit')).toBe('with it');
    expect(await hint('»Wie groß du geworden bist!« sagte sie.', 'Wie')).toBe('how');
  });

  it('read selbst after its noun or pronoun as "oneself", before what it stresses as "even"; alles alone as "everything"', async () => {
    expect(await hint('Sie hieß Elisabeth und mochte fünf Jahre zählen, er selbst war doppelt so alt.', 'selbst')).toBe('oneself');
    expect(await hint('Und selbst wenn er den Zug einholte, ein Donnerwetter des Chefs war nicht zu vermeiden.', 'selbst')).toBe('even');
    expect(await hint('Alles macht der Meister Böck,', 'Alles')).toBe('everything');
  });
});

describe('German adjectives and adverbs (de-8, de-19)', () => {
  it('read an adjective without an ending as its adverb, unless it is predicative', async () => {
    const mond = 'Wie er so saß, wurde es allmählich dunkler; endlich fiel ein Mondstrahl durch die Fensterscheiben auf die Gemälde an der Wand.';
    expect(await hint(mond, 'endlich')).toBe('finally, at last');
    expect(await hint('Aber schon sind sie ganz munter', 'ganz')).toBe('quite');
    expect(await hint('Nun ging er gleich an die Arbeit; Nägel, Hammer und die nötigen Bretter waren schon bereit.', 'gleich')).toBe('at once');
    const still = 'Die Tür wurde noch mit dem Stock zugeschlagen, dann war es endlich still.';
    expect(await hint(still, 'endlich')).toBe('finally, at last');
    expect(await hint(still, 'still')).toBe('quiet');
    expect(await hint('Als sie die Augen gegen ihn aufschlug, sah er, daß sie voll Tränen waren.', 'voll')).toBe('full');
  });

  it('read an adjective spelled like a verb before its noun as the adjective', async () => {
    expect(await hint('Er preßte sich an das Glas, das ihn festhielt und seinem heißen Bauch wohltat.', 'heißen')).toBe('hot');
    expect(await hint('Die, anstatt durch weise Lehren', 'weise')).toBe('wise');
    expect(await hint('Er war ein Reisender geworden, der natürlich ganz andere Möglichkeiten des Geldverdienens hatte.', 'andere')).toBe('other');
  });
});

describe('German nouns in mid-sentence (de-9, de-14, de-25)', () => {
  it('read a capital in mid-sentence as the noun, the article choosing among nouns spelled alike', async () => {
    const eng = await de();
    expect(tok(eng, 'Am Morgen nach seiner Ankunft ging er zu Elisabeth.', 'Morgen').key).toBe('Morgen');
    expect(eng.hint(tok(eng, 'Am Morgen nach seiner Ankunft ging er zu Elisabeth.', 'Morgen'))).toBe('morning');
    expect(tok(eng, '»Ja, ja, ja!« rief Meister Böck,', 'Meister').key).toBe('Meister');
    expect(eng.hint(tok(eng, '»Wenn das alles ist,« erwiderte der Alte und hob ihnen die volle Schüssel entgegen.', 'Alte'))).toBe('old man');
    expect(await hint('Ach, was war das für ein Graus!', 'Graus')).toBe('horror');
    expect(tok(eng, 'Abgerupft am Herde lagen,', 'Herde').key).toBe('Herd');
    expect(tok(eng, 'Er eilte zu ihnen und suchte sie mit ausgebreiteten Armen in ihr Zimmer zu drängen.', 'Armen').key).toBe('Arm');
  });

  it('read a verb made a noun as the verb, or as its own noun where a neuter one stands', async () => {
    expect(await hint('»Um Gottes willen,« rief die Mutter schon unter Weinen, »er ist vielleicht schwer krank, und wir quälen ihn.«', 'Weinen')).toBe('to cry');
    expect(await hint('Er sang die Lieder, indem er beim Lesen zuweilen die lustige Melodie mit halber Stimme anklingen ließ.', 'Lesen')).toBe('reading');
  });

  it('read a word said again and again as the exclamation', async () => {
    expect(await hint('Aber wehe, wehe, wehe!', 'wehe', 1)).toBe('alas! woe!');
  });
});

describe('German reflexive verbs (de-21)', () => {
  it('take their reflexive sense from sich anywhere in their clause', async () => {
    const text = 'Er erinnerte sich, schon öfters im Bett irgendeinen vielleicht durch ungeschicktes Liegen erzeugten, leichten Schmerz empfunden zu haben, der sich dann beim Aufstehen als reine Einbildung herausstellte.';
    expect(await hint(text, 'erinnerte')).toBe('to remember');
    expect(await hint(text, 'herausstellte')).toBe('to come to light');
    expect(await hint('Nachdem der Alte Hut und Stock in die Ecke gestellt hatte, setzte er sich in den Lehnstuhl.', 'setzte')).toBe('to sit down');
  });

  it('not from sich after a preposition, nor for a verb whose reflexive sense is another', async () => {
    expect(await hint('Er mußte sich, so fest er Kopf und Beine an sich zog und den Leib bis an den Boden drückte, unweigerlich sagen, daß er das Ganze nicht lange aushalten werde.', 'zog')).toBe('to pull');
    expect(await hint('Als Gregor Samsa eines Morgens aus unruhigen Träumen erwachte, fand er sich in seinem Bett zu einem ungeheueren Ungeziefer verwandelt.', 'fand')).toBe('to find');
  });
});

describe('German hints of the three books (curated)', () => {
  it('give the sense the books mean', async () => {
    expect(await hint('Denn nun war die Bedienerin da.', 'Bedienerin')).toBe('charwoman');
    expect(await hint('Er eilte unter das Kanapee.', 'Kanapee')).toBe('sofa');
    expect(await hint('Wußte Schneider Böck zu machen.', 'Schneider')).toBe('tailor');
    // seinem, seinen are sein's "his", not the archaic polite Er's "you".
    expect(await hint('Er preßte sich an das Glas, das ihn festhielt und seinem heißen Bauch wohltat.', 'seinem')).toBe('his');
    expect(await hint('Als Gregor Samsa eines Morgens aus unruhigen Träumen erwachte, fand er sich in seinem Bett zu einem ungeheueren Ungeziefer verwandelt.', 'verwandelt')).toBe('to transform');
  });
});

// ------------------------------------------------------------------------------------------- the native re-audit ---
// Findings of the second native audit (Max und Moritz, Immensee, Die Verwandlung, Effi Briest 1–3, Siddhartha 1–2).

describe('German possessives (re-audit: deine "yours", meiner "I")', () => {
  it('read mein, dein … with an ending before a noun phrase as "my, your"', async () => {
    const eng = await de();
    const rat = '»Rat, was ich Deiner Mutter zu Weihnachten schenke!';
    expect(tok(eng, rat, 'Deiner').key).toBe('dein');
    expect(eng.hint(tok(eng, rat, 'Deiner'))).toBe('your');
    expect(await hint('»Deine Augen sehen mich an.«', 'Deine')).toBe('your');
    expect(await hint('Wenn ich mich nicht wegen meiner Eltern zurückhielte, ich hätte längst gekündigt.', 'meiner')).toBe('my');
  });

  it('read meine after its subject as meinen "to mean"', async () => {
    const eng = await de();
    expect(tok(eng, '»Ich meine es genau so, wie ich es sage,« antwortete Herr Samsa.', 'meine').key).toBe('meinen');
  });
});

describe('German predicative adjectives (re-audit)', () => {
  it('read an adjective as itself with stehen and offen, aussehen, sich fühlen, and a copula opening a line', async () => {
    expect(await hint('Die Türen standen offen; die Sonne war schon hinter den Wäldern jenseits des Sees.', 'offen')).toBe('open');
    expect(await hint('»Du siehst so traurig aus.«', 'traurig')).toBe('sad');
    expect(await hint('Jetzt bin ich aber schon wieder ganz frisch.', 'frisch')).toBe('fresh');
    expect(await hint('Gregor war noch gar nicht angezogen, und er selbst fühlte sich durchaus nicht besonders frisch und beweglich.', 'frisch')).toBe('fresh');
    expect(await hint('zu beiden Seiten desselben standen blühende Obstbäume voll summender wühlender Bienen.', 'voll')).toBe('full');
  });

  it('keep the adverb opening its clause before a verb that is no copula, or with a phrase after it', async () => {
    expect(await hint('Natürlich muß er von Adel sein und eine Stellung haben und gut aussehen.', 'Natürlich')).toBe('naturally');
    expect(await hint('Deshalb blieb auch Gregor vorläufig auf dem Fußboden, zumal er fürchtete.', 'vorläufig')).toBe('temporarily');
    expect(await hint('Als sich auch da kein Erfolg zeigte, wurde sie ärgerlich und stieß ein wenig mit dem Besen.', 'ärgerlich')).toBe('annoying');
  });

  it('read an adjective with an ending the dictionary lacks as the adjective, not its adverb', async () => {
    expect(await hint('Als Gregor Samsa eines Morgens aus unruhigen Träumen erwachte, fand er sich in seinem Bett zu einem ungeheueren Ungeziefer verwandelt.', 'ungeheueren')).toBe('enormous');
  });
});

describe('German capitals at the start of a line or a sentence (re-audit)', () => {
  it('read a verb before its subject, before und and a verb, and an imperative before nur', async () => {
    const eng = await de();
    expect(tok(eng, 'Mahl er das, so schnell er kann!«', 'Mahl').key).toBe('mahlen');
    expect(tok(eng, 'Heute, nur heute Bin ich so schön Morgen, ach morgen Muß alles vergeh’n! Nur diese Stunde Bist du noch mein; Sterben, ach sterben Soll ich allein!', 'Soll').key).toBe('sollen');
    expect(tok(eng, 'Haut und trampelt alles tot.', 'Haut').key).toBe('hauen');
    expect(tok(eng, '»Warte nur: woher kommt der Wind?« sagte er und hob seine Hand in die Höhe.', 'Warte').key).toBe('warten');
    expect(tok(eng, 'Schau nur, wie fremd und vornehm aussehend er worden ist!«', 'Schau').key).toBe('schauen');
    // Not a noun after an article or a pronoun that comes before one: "an dessen Ende sie links in einen … Saal traten".
    expect(tok(eng, 'Ein hoher, kühler Hausflur nahm sie auf, an dessen Ende sie links in einen Gartensaal traten.', 'Ende').key).toBe('Ende');
    expect(tok(eng, 'Zweitens: Weil man dann und wann', 'Weil').key).toBe('weil');
  });

  it('read a word standing alone at a sentence start as the interjection it can be, and wehe before its dative', async () => {
    expect(await hint('»Ei,« sagte die Mutter, »Sie haben sich auch noch mit keinem Worte nach Ihrem Freunde erkundigt.«', 'Ei')).toBe('oh, why');
    expect(await hint('»Ja, ja, danke, Mutter, ich stehe schon auf.«', 'danke')).toBe('thanks');
    expect(await hint('Max und Moritz, wehe euch!', 'wehe')).toBe('woe');
    expect(await hint('»Und was sagt dein Vater dazu?«', 'Und')).toBe('and');
  });

  it('read a title before a name as the noun', async () => {
    const eng = await de();
    expect(tok(eng, '»Meister Müller, he, heran!', 'Meister').key).toBe('Meister');
  });
});

describe('German nouns (re-audit)', () => {
  it('read a capital as the noun where a preposition cannot stand', async () => {
    expect(await hint('»Gott grüß’ dich, Erich, und Dank für dein Willkommen!« rief ihm der andere entgegen.', 'Dank')).toBe('thanks');
    const eng = await de();
    expect(tok(eng, 'hörte man jetzt keinen Laut. Nun vielleicht war dieses Vorlesen aus der Übung gekommen.', 'Laut').key).toBe('Laut');
  });

  it('prefer a noun of its own over another noun\'s diminutive or a form with another gender', async () => {
    const eng = await de();
    expect(tok(eng, "Neulich erst hat mir der kleine Ventivegni von drüben gesagt: 'Fräulein Effi, was gilt die Wette.'", 'Fräulein').key).toBe('Fräulein');
    expect(tok(eng, 'Der Weg führte an einen Abhang, aus dem die Gipfel hundertjähriger Eichen nur kaum hervorragten.', 'Eichen').key).toBe('Eiche');
    expect(eng.hint(tok(eng, 'Wir Alten haben uns im Leben schon genug umhergetrieben.', 'Alten'))).toBe('old man');
  });

  it('read a verb made a noun after das, before a genitive, and against a plural', async () => {
    const eng = await de();
    const wald = 'Manchmal hörte man tief im Walde das Hämmern der Spechte und das Kreischen der andern Waldvögel.';
    expect(tok(eng, wald, 'Hämmern').key).toBe('hämmern');
    expect(tok(eng, wald, 'Kreischen').key).toBe('kreischen');
    expect(tok(eng, 'Was ist Fasten? Was ist Anhalten des Atems?', 'Anhalten').key).toBe('anhalten');
    expect(tok(eng, 'rings um sie her ein feines Schwirren und Summen, und manchmal hörte man tief im Walde das Hämmern der Spechte.', 'Summen').key).toBe('summen');
    expect(tok(eng, 'Die Sonne stand gerade über ihnen; kleine goldglänzende, stahlblaue Fliegen standen flügelschwingend in der Luft.', 'Fliegen').key).toBe('Fliege');
    expect(tok(eng, 'außerdem ist mir noch diese Plage des Reisens auferlegt, das unregelmäßige, schlechte Essen, ein immer wechselnder Verkehr.', 'Essen').key).toBe('Essen');
    // But not the plural of a noun after its article: "die freien Stellen des Bodens", "unter den zitternden Fingern der Mutter".
    expect(tok(eng, 'die Violine schreckte ihn auf, die, unter den zitternden Fingern der Mutter hervor, ihr entfiel.', 'Fingern').key).toBe('Finger');
  });

  it('read an adjective made a noun after etwas, and the article deciding across adjectives', async () => {
    const eng = await de();
    expect(await hint('Er wollte sich ihr zu Füßen werfen und sie um irgend etwas Gutes zum Essen bitten.', 'Gutes')).toBe('something good');
    expect(tok(eng, 'Nach einer Weile traten sie aus dem schattigen Laube wieder in eine weite Lichtung hinaus.', 'Laube').key).toBe('Laub');
    // After ein, the adjective's ending: das Reis "shoot", not der Reis "rice".
    expect(await hint('Sie nahm ein braunes Reis aus der Blechkapsel.', 'Reis')).toBe('shoot');
    expect(eng.hint(tok(eng, 'Freude sprang in seines Vaters Herzen über den Sohn, einen großen Weisen und Priester sah er in ihm heranwachsen.', 'Weisen'))).toBe('sage');
  });
});

describe('German prepositions with no noun phrase after them (re-audit: laut, lauter, nach)', () => {
  it('read laut as "loud" and lauter before a bare noun as "nothing but"', async () => {
    expect(await hint('»Ich weiß,« sagte Gregor vor sich hin; aber so laut, daß es die Schwester hätte hören können, wagte er die Stimme nicht zu erheben.', 'laut')).toBe('loud');
    expect(await hint('Laut ertönt sein Wehgeschrei,', 'Laut')).toBe('loud');
    expect(await hint('Es waren lauter Verse, die meisten füllten höchstens eine Seite.', 'lauter')).toBe('pure; nothing but');
    // A preposition before its noun phrase stays one: "Mit zitternder Hand zündete er die Lichter an".
    expect(await hint('Mit zitternder Hand zündete er die Lichter an.', 'Mit')).toBe('with');
  });

  it('read nach after its noun as "according to"', async () => {
    expect(await hint('Die dürfen sich das gönnen, und je weiter zurück, ich meine der Zeit nach, desto mehr dürfen sie sich’s gönnen.', 'nach')).toBe('according to');
  });
});

describe('German participles and past forms (re-audit: de-19, de-20)', () => {
  it('read a participle two verbs share by the dative gefallen and gehören take', async () => {
    const eng = await de();
    expect(tok(eng, 'Es klang so, daß man nicht wußte, ob man recht gehört hatte.', 'gehört').key).toBe('hören');
    expect(tok(eng, '»Da drin ist etwas gefallen,« sagte der Prokurist im Nebenzimmer links.', 'gefallen').key).toBe('fallen');
    expect(tok(eng, 'Du hast ihn vorgestern gesehen, und ich glaube, er hat dir auch gut gefallen.', 'gefallen').key).toBe('gefallen');
    expect(tok(eng, '"Siddhartha hat immer seinem Vater gehorcht."', 'gehorcht').key).toBe('gehorchen');
  });

  it('read a participle before its auxiliary, and gewohnt with sein and zu as the adjective', async () => {
    const eng = await de();
    expect(tok(eng, '»Mir fehlt noch von neulich die Maiblume,« sagte sie jetzt, als der ganze Fund bestimmt und geordnet war.', 'bestimmt').key).toBe('bestimmen');
    expect(await hint('Elisabeth, die ihm in allem zu folgen gewohnt und überdies lehrhaft war, ging bereitwillig darauf ein.', 'gewohnt')).toBe('used to; usual');
  });

  it('read a past form as the verb where no noun follows it', async () => {
    const eng = await de();
    expect(tok(eng, 'Aber Reinhard verlor alle Aufmerksamkeit an den geographischen Vorträgen; statt dessen verfaßte er ein langes Gedicht.', 'verfaßte').key).toBe('verfassen');
    expect(tok(eng, '»Das ist jemand aus dem Geschäft,« sagte er sich und erstarrte fast, während seine Beinchen nur desto eiliger tanzten.', 'erstarrte').key).toBe('erstarren');
    // An adjective without an ending before it is used as an adverb (Immensee).
    expect(tok(eng, 'die sie in einem Schubfach ihrer Schatulle sorgfältig aufbewahrte; und es gewährte ihm eine Befriedigung.', 'aufbewahrte').key).toBe('aufbewahren');
  });

  it('read an adjective spelled like a verb after this, after an adverb, and after a name\'s genitive', async () => {
    expect(await hint('daß die Untersuchung dieser verdächtigen Angelegenheit nur dem Verstand des Prokuristen anvertraut werden konnte.', 'verdächtigen')).toBe('suspicious');
    expect(await hint('Erichs immer gleichbleibende Aufmerksamkeit nahm sie mit einer fast demütigen Dankbarkeit auf.', 'demütigen')).toBe('humble');
    expect(await hint('ein frischer Wind erhob sich und streifte Reinhards heiße Stirne; die erste Lerche stieg jauchzend in die Luft.', 'heiße')).toBe('hot');
    expect(await hint('ein rechtwinklig angebauter Seitenflügel warf einen breiten Schatten erst auf einen weiß und grün quadrierten Fliesengang.', 'weiß')).toBe('white');
  });

  it('read heut as heute', async () => {
    const eng = await de();
    expect(tok(eng, '»Ihr Freund Erich hat ihn heut Mittag für Elisabeth von seinem Hofe hereingeschickt.«', 'heut').key).toBe('heute');
  });
});

describe('German sie and ihr (re-audit: de-2)', () => {
  it('read sie as "they" after a plural verb its singular object comes before, but not after two subjects joined by und', async () => {
    expect(await hint('So traten sie ihren Rückweg an; das Erdbeerensuchen hatten sie aufgegeben, denn Elisabeth war müde geworden.', 'sie', 1)).toBe('they');
    expect(await hint('Die Mutter wollte bald Gregor besuchen, aber der Vater und die Schwester hielten sie zuerst mit Vernunftgründen zurück.', 'sie')).not.toBe('they');
  });

  it('read ihr calling out before a plural noun as "you"', async () => {
    expect(await hint("»Fließet aus dem Aug', ihr Tränen!", 'ihr')).toBe('you');
    expect(await hint('»Alle um mich herum, ihr jungen Vögel!« rief er.', 'ihr')).toBe('you');
  });
});

describe('German clauses (re-audit)', () => {
  it('keep a clause whole across aber inside it, and ohne daß apart from the verb of the clause around it', async () => {
    const eng = await de();
    expect(await hint('Endlich ließ er sich aber doch erbitten, und nun wurde Tafel gehalten.', 'doch')).toBe('after all');
    const schwur = 'Sie dankte für die Entlassung und gab, ohne daß man es von ihr verlangte, einen fürchterlichen Schwur ab, niemandem etwas zu verraten.';
    expect(tok(eng, schwur, 'gab').key).toBe('abgeben');
    expect(tok(eng, schwur, 'verlangte').key).toBe('verlangen');
  });
});
