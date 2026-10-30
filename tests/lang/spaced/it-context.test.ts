// Italian context rules (src/lang/spaced/it-context.ts) on the sentences of the books a native reader went through: Pinocchio
// (Collodi), Rosso Malpelo (Verga) and Il fu Mattia Pascal (Pirandello). Each word is read where it stands: come "like" or
// "how", ci "there" or "us", via "away" or the street, quella before its noun.
import { describe, expect, it } from 'vitest';
import type { LangEngine } from '../../../src/lang/types';
import { loadLang, lookupIn, tok } from './load';

/** The word's dictionary form, part of speech and hint where it stands (the nth of its spelling). */
function read(eng: LangEngine, text: string, word: string, nth = 0): { key: string; pos: string; hint: string } {
  const t = tok(eng, text, word, nth);
  const pos = lookupIn(eng, text, word, nth).entries[0]?.senses[0]?.pos ?? '';
  return { key: t.key ?? '', pos, hint: eng.hint(t) ?? '' };
}

describe('Italian come', () => {
  it('compares before a noun, a pronoun or a parenthesis, and asks in a question or after a verb of knowing', async () => {
    const it_ = await loadLang('it');
    const like = { pos: 'conjunction', hint: 'like, as' };
    const how = { pos: 'adverb', hint: 'how' };
    expect(read(it_, 'E perchè si divincolava come un’anguilla e faceva sforzi incredibili, per isgusciare dalle grinfie del pescatore verde, questi prese una bella buccia di giunco', 'come')).toMatchObject(like);
    expect(read(it_, '— Perchè non sono malpelo come te! — rispose lo sciancato.', 'come')).toMatchObject(like);
    expect(read(it_, '— Ma ti avverto, carino mio, che nel carro non c’è più posto. Come vedi, è tutto pieno!... —', 'Come')).toMatchObject(like);
    expect(read(it_, 'capace di scrivere la Divina Commedia, signor Meis, e di sacrificarsi come ha fatto sua madre e mia madre', 'come')).toMatchObject(like);
    expect(read(it_, '— E come hai fatto a scappare?', 'come')).toMatchObject(how);
    expect(read(it_, 'E perchè il corpo gli seguitava a brontolare più che mai, e non sapeva come fare a chetarlo, pensò di uscir di casa e di dare una scappata al paesello vicino', 'come')).toMatchObject(how);
    expect(read(it_, 'Figuratevi come rimase quel buon vecchio di maestro Ciliegia!', 'come')).toMatchObject(how);
    expect(read(it_, 'Ah, un pajo d’ali! Come mi sentivo leggero!', 'Come')).toMatchObject(how);
    expect(read(it_, '— Come! Che legge è questa? — gridai.', 'Come')).toMatchObject(how);
  });

  it('takes the hint of come se and come mai', async () => {
    const it_ = await loadLang('it');
    const text = 'E poi cominciò ad abbaiare: e, abbaiando proprio come se fosse un cane di guardia, faceva colla voce: bù—bù-bù-bù.';
    expect(it_.hint(tok(it_, text, 'come'))).toBe('as if');
    expect(it_.hint(tok(it_, text, 'se'))).toBe('as if');
    expect(it_.hint(tok(it_, '— Come mai sei qui? — ripetè il Gatto.', 'Come'))).toBe('how come');
  });
});

describe('Italian ci, vi', () => {
  it('reads ci as "there" with a verb of being, going or believing, and "us" otherwise', async () => {
    const it_ = await loadLang('it');
    // The adverb, with the sense it has where it stands: "there" with being and going, "about it" with believing and thinking.
    const there = { pos: 'adverb', hint: 'there' };
    const about = { pos: 'adverb', hint: 'about it' };
    const us = { pos: 'pronoun', hint: 'us' };
    expect(read(it_, '— Qui non ci sono signori! — replicò duramente il burattinaio.', 'ci')).toMatchObject(there);
    expect(read(it_, 'Pinocchio ci pensò un poco, e poi disse risolutamente:', 'ci')).toMatchObject(about);
    expect(read(it_, 'Ma ormai mi sono impietosito e ci vuol pazienza.', 'ci')).toMatchObject(there);
    expect(read(it_, '— Ma io... — rispose, impacciata, Adriana, — io non ci credo, ecco...', 'ci')).toMatchObject(about);
    expect(read(it_, 'Lei lo denunzii, non abbia riguardo, non tema per noi... Ci farà un bene, creda, un gran bene!', 'Ci')).toMatchObject(us);
    expect(read(it_, 'lì non studieremo più; lì ci divertiremo dalla mattina alla sera e staremo sempre allegri.', 'ci')).toMatchObject(us);
    // Past a modal to its infinitive: told us.
    expect(read(it_, '— Non ci ha voluto dire, intanto, donde le fosse venuto quell’anellino che si fece tagliare da un orefice', 'ci')).toMatchObject(us);
    expect(read(it_, '— Non vi date alla disperazione, padrone. Dei ciuchini ce n’è tanti, in questo mondo!', 'ce').hint).toBe('there');
  });

  it('reads vi as "there" before essere and in narration, "you" when someone is spoken to', async () => {
    const it_ = await loadLang('it');
    expect(read(it_, 'Fra questi libri, v’era un volume rilegato in cartoncino grosso, colla costola e colle punte di cartapecora.', 'v’').hint).toBe('there');
    expect(read(it_, 'si rasciugò gli occhi, e preparato un buon lettino di paglia, vi distese sopra il vecchio Geppetto.', 'vi').hint).toBe('there');
    expect(read(it_, 'Vi prometto, babbo, che imparerò un’arte, e che sarò la consolazione e il bastone della vostra vecchiaia.', 'Vi').hint).toBe('you');
  });
});

describe('Italian via, se, loro, demonstratives', () => {
  it('reads via as "away" after a verb, the street after an article, "come on" standing apart', async () => {
    const it_ = await loadLang('it');
    // After buttare it is the phrase buttare via, found by the verb's infinitive.
    expect(read(it_, '— Non lo buttar via: tutto in questo mondo può far comodo.', 'via')).toMatchObject({ pos: 'phrase', hint: 'to throw away' });
    expect(read(it_, 'nel tempo che i ciuchini galoppavano e che il carro correva sui ciottoli della via maestra, gli parve al burattino di sentire una voce', 'via')).toMatchObject({ pos: 'noun', hint: 'street' });
    expect(read(it_, 'Via, via, non ci pensiamo!', 'via')).toMatchObject({ pos: 'interjection', hint: 'come on' });
  });

  it('reads se before ne, lo, la and a verb of the third person as the pronoun, before a past subjunctive as "if"', async () => {
    const it_ = await loadLang('it');
    expect(read(it_, 'Ciò detto salutarono Pinocchio, e augurandogli una buona raccolta, se ne andarono per i fatti loro.', 'se').key).toBe('si');
    expect(read(it_, 'senza dargli nemmeno il tempo di dire ohi, se lo mangiò in un boccone con le penne e tutto.', 'se').key).toBe('si');
    expect(read(it_, 'o non sarebbe più saporito se lo friggessi in padella?', 'se')).toMatchObject({ key: 'se', hint: 'if' });
  });

  it('reads loro, quello, altro, uno as determiners before a noun and pronouns standing alone', async () => {
    const it_ = await loadLang('it');
    expect(read(it_, 'Le strade formicolavano di persone che correvano di qua e di là per le loro faccende: tutti lavoravano', 'loro')).toMatchObject({ pos: 'determiner', hint: 'their' });
    expect(read(it_, 'ringraziò mille volte la Volpe e il Gatto, e promise loro un bellissimo regalo.', 'loro')).toMatchObject({ pos: 'pronoun', hint: 'they, them' });
    const vocina = 'Girò gli occhi smarriti intorno alla stanza per vedere di dove mai poteva essere uscita quella vocina, e non vide nessuno!';
    expect(read(it_, vocina, 'quella')).toMatchObject({ pos: 'determiner', hint: 'that' });
    expect(read(it_, 'perchè tutto quello che si perde nel vicino bosco, si ritrova sempre.', 'quello').pos).toBe('pronoun');
    expect(read(it_, 'Quegli si ritirò, ripetendo: — Ah già! ah già!', 'Quegli').pos).toBe('pronoun');
    expect(read(it_, 'Allora prese a rimbrottarla apertamente; e in fine, dopo un altro anno, ormai disperando per sempre', 'altro')).toMatchObject({ pos: 'determiner', hint: 'other' });
    expect(read(it_, 'E gli altri soggiungevano malignamente:', 'altri').pos).toBe('pronoun');
    expect(read(it_, '— Ho capito; — disse allora uno di loro — bisogna impiccarlo.', 'uno').hint).toBe('one');
    expect(read(it_, 'La signorina Caporale cacciò uno strillo acutissimo, che ci fece sobbalzar tutti quanti dalle seggiole.', 'uno').hint).toBe('a, an');
  });
});

describe('Italian words read by the word before or after', () => {
  it('reads male, pure, fin, bisogna, presto, circa, intanto, prima, piuttosto, cosa where they stand', async () => {
    const it_ = await loadLang('it');
    expect(read(it_, '— Ohi! tu m’hai fatto male! — gridò rammaricandosi la solita vocina.', 'male').hint).toBe('harm, pain');
    expect(read(it_, '— Povero Merlo! — disse Pinocchio al Gatto — perchè l’hai trattato così male?', 'male').hint).toBe('badly');
    // After an order "go ahead", elsewhere "also".
    expect(read(it_, '— Passate pure, — disse il falegname, senza aver la forza di rizzarsi in piedi.', 'pure')).toMatchObject({ pos: 'adverb', hint: 'go ahead' });
    expect(read(it_, 'e sebbene sentisse avvicinarsi la morte, pure sperava sempre che da un momento a un altro sarebbe capitata qualche anima pietosa', 'pure').pos).toBe('conjunction');
    expect(read(it_, '— Non lo so, babbo, ma credetelo che è stata una nottata d’inferno, e me ne ricorderò fin che campo.', 'fin').key).toBe('fino');
    expect(read(it_, 'babbino mio, — disse Pinocchio — non c’è tempo da perdere. Bisogna pensar subito a fuggire.', 'Bisogna').key).toBe('bisognare');
    expect(read(it_, 'I ragazzi fanno presto a promettere, ma il più delle volte, fanno tardi a mantenere.', 'presto')).toMatchObject({ pos: 'adverb', hint: 'soon, quickly' });
    expect(read(it_, 'Fui, per circa due anni, non so se più cacciatore di topi che guardiano di libri', 'circa').hint).toBe('about');
    expect(read(it_, 'Intanto cominciò a farsi notte, e Pinocchio, ricordandosi che non aveva mangiato nulla', 'Intanto').hint).toBe('meanwhile');
    expect(read(it_, 'Sarà presentato per la prima volta il famoso', 'prima').key).toBe('primo');
    expect(read(it_, 'Invece di fare il bighellone per la strada, va\' piuttosto a cercarti un po\' di lavoro', 'piuttosto').hint).toBe('rather');
    expect(read(it_, '— Mi dica un’altra cosa. Lei che passeggia tutto il giorno e tutta la notte per il mare', 'cosa').hint).toBe('thing');
    expect(read(it_, 'Ei possedeva delle idee strane, Malpelo!', 'Ei').hint).toBe('he');
  });

  it('reads Collodi\'s colla, colle, cogli as con + the article, but colla after an article or preposition as glue', async () => {
    const it_ = await loadLang('it');
    const stucco = 'Questa volta maestro Ciliegia restò di stucco, cogli occhi fuori del capo per la paura, colla bocca spalancata e colla lingua giù ciondoloni fino al mento';
    expect(read(it_, stucco, 'colla')).toMatchObject({ pos: 'contraction', hint: 'with the' });
    expect(read(it_, stucco, 'cogli').hint).toBe('with the');
    expect(read(it_, 'Geppetto con un po\' di colla sciolta in un guscio d’uovo gli appiccicò i due piedi al loro posto', 'colla').pos).toBe('noun');
  });

  it('reads a plural noun with no determiner after a subject as the verb, and gli before it as "to him"', async () => {
    const it_ = await loadLang('it');
    expect(read(it_, '— Ma neanche la morte mi vuole, — riprese. — Niente...', 'riprese').key).toBe('riprendere');
    expect(read(it_, 'In men di mezz’ora passarono altre venti persone, e a tutte Pinocchio chiese un po\' d’elemosina', 'chiese').key).toBe('chiedere');
    expect(read(it_, 'Molti ancora vanno nelle chiese per provvedere dell’alimento necessario le loro lanternucce.', 'chiese').key).toBe('chiesa');
    const vecchietto = '— E tu, che concetto ne hai? — gli chiese il vecchietto.';
    expect(read(it_, vecchietto, 'gli')).toMatchObject({ pos: 'pronoun', hint: 'to him, to them' });
    expect(read(it_, vecchietto, 'chiese').key).toBe('chiedere');
  });

  it('reads a noun after a determiner, the article before a name, an infinitive before its participle', async () => {
    const it_ = await loadLang('it');
    // anno, the old spelling of hanno, after a determiner is the year.
    expect(read(it_, 'Allora prese a rimbrottarla apertamente; e in fine, dopo un altro anno, ormai disperando per sempre', 'anno').key).toBe('anno');
    expect(read(it_, 'furono giudicati così lodevoli e soddisfacenti, che la Fata, tutta contenta, gli disse:', 'la').pos).toBe('article');
    expect(read(it_, 'La Fata gli dette la pallina, e Pinocchio dopo averla sgranocchiata e ingoiata in un attimo, disse leccandosi i labbri:', 'averla').pos).toBe('verb');
    expect(read(it_, 'm’accorsi ch’era già donna e che doveva perciò portare, se vogliamo, quella veste da camera che la rendeva un po’ goffa', 'quella').pos).toBe('determiner');
    expect(read(it_, 'A quelle grida strazianti il burattino, che in fondo aveva un cuore eccellente, si mosse a compassione', 'quelle').pos).toBe('determiner');
    // A word in lower case is no surname: Figliuolo's plural.
    expect(read(it_, 'Ti prego, per l’amore che porti ai tonnini tuoi figliuoli; aiutaci, o siamo perduti.', 'figliuoli').pos).toBe('noun');
  });

  it('reads Pinocchio corse as running, not corso\'s Corsican women', async () => {
    const it_ = await loadLang('it');
    expect(read(it_, 'Il povero Pinocchio corse subito al focolare dove c’era una pentola che bolliva', 'corse').key).toBe('correre');
  });

  it('cuts the clipped words of the old texts off the next word: fors\'anche, diss\'io', async () => {
    const it_ = await loadLang('it');
    const text = 'I ragazzi dovrebbero sapere che un buon medicamento preso a tempo, può salvarli da una grave malattia e fors’anche dalla morte....';
    expect(read(it_, text, 'fors’')).toMatchObject({ key: 'forse', hint: 'maybe' });
    expect(read(it_, text, 'anche').key).toBe('anche');
  });

  it('reads a title noun as the noun, but keeps an adjective before a name', async () => {
    const it_ = await loadLang('it');
    expect(read(it_, '— Prego, anche a me, — si rinzelò la signora Candida, agitandosi su la seggiola.', 'signora')).toMatchObject({ key: 'signora', hint: 'lady' });
    expect(read(it_, 'pareva oramai più morto che vivo, la bella Bambina dai capelli turchini si affacciò daccapo alla finestra', 'bella').key).toBe('bello');
  });

  it('reads a word standing apart as an interjection: ah, eh, basta', async () => {
    const it_ = await loadLang('it');
    expect(read(it_, 'Ah, un pajo d’ali! Come mi sentivo leggero!', 'Ah')).toMatchObject({ pos: 'interjection', hint: 'ah' });
    expect(read(it_, '— No, no, basta! non ne posso più!', 'basta').pos).toBe('interjection');
  });
});

describe('Italian hints the books need', () => {
  it('hints the object pronouns by what they stand for, and a fixed phrase as the books mean it', async () => {
    const it_ = await loadLang('it');
    const so = '— Non lo so, babbo, ma credetelo che è stata una nottata d’inferno, e me ne ricorderò fin che campo.';
    expect(read(it_, so, 'lo').hint).toBe('him, it');
    expect(read(it_, so, 'so').key).toBe('sapere');
    const fine = 'e dopo aver resistito un bel pezzo, alla fine non ne potè più, e lasciò andare un sonorosissimo starnuto.';
    expect(it_.hint(tok(it_, fine, 'fine'))).toBe('in the end');
    expect(read(it_, '— Il gatto — disse Pinocchio, vedendo il gatto che colle zampine davanti si divertiva a far ballare alcuni trucioli di legno.', 'divertiva').hint).toBe('to have fun');
    expect(read(it_, 'Geppetto si accòrse di avere in bocca la parrucca brizzolata del falegname.', 'accòrse').hint).toBe('noticed');
    expect(read(it_, 'E il conduttore del carro?... Figuratevi un omino più largo che lungo, tenero e untuoso come una palla di burro', 'omino')).toMatchObject({ key: 'omino', hint: 'little man' });
  });
});

// The second native audit read I promessi sposi (Manzoni), Il treno ha fischiato (Pirandello) and the three books above again.
describe('Italian article or pronoun, by what follows', () => {
  it('reads lo, la, gli as the article before a noun of their gender and number, the pronoun before a verb', async () => {
    const it_ = await loadLang('it');
    // After che, the likelier of the noun and the verb: the thing, not cosare "does something"; the people, not gire's
    // participle; the water.
    const cosa = 'chi si rallegrava che la cosa fosse finita bene, e lodava Ferrer, e pronosticava guai seri per il vicario';
    expect(read(it_, cosa, 'la').pos).toBe('article');
    expect(read(it_, cosa, 'cosa')).toMatchObject({ key: 'cosa', hint: 'thing' });
    const gente = 'Renzo, ch’era il più in sè di tutti, pensò che, di qua o di là, conveniva andar subito, prima che la gente accorresse';
    expect(read(it_, gente, 'gente').key).toBe('gente');
    expect(read(it_, 'i quali stavano osservando con molto piacere, che l’acqua s’andava intorbidando', 'acqua').key).toBe('acqua');
    // prese, plural, cannot follow lo; richiuse, feminine, cannot follow li.
    const collo = 'fino a uno che, votatolo, lo prese per il collo, gli fece fare il mulinello, e lo scagliò a fracassarsi sulle lastre';
    expect(read(it_, collo, 'lo').hint).toBe('him, it');
    expect(read(it_, collo, 'prese').key).toBe('prendere');
    expect(read(it_, 'il Gatto spalancò tutt’e due gli occhi, che parvero due lanterne verdi; ma poi li richiuse subito', 'li').pos).toBe('pronoun');
    // Before another clitic, to him; after non or a pronoun, before an infinitive or a verb.
    expect(read(it_, 'Pareva che il viso, tutt’a un tratto, gli si fosse allargato.', 'gli').hint).toBe('to him, to them');
    expect(read(it_, '— Non me lo dire! — urlò Pinocchio che tremava ancora dalla paura.', 'lo').hint).toBe('him, it');
    expect(read(it_, '— Grazie, caro. Questo lo so.', 'so').key).toBe('sapere');
    expect(read(it_, 'Si accòrse, con suo grandissimo stupore, che gli orecchi gli erano cresciuti più d’un palmo', 'orecchi').key).toBe('orecchio');
    expect(read(it_, 'sì, sì, sì, la stessa voce.... gli stessi occhi.... gli stessi capelli.... sì sì, sì....', 'stessi')).toMatchObject({ key: 'stesso', hint: 'same' });
  });

  it('reads a word after an article of its own gender and number: il conte, la grida', async () => {
    const it_ = await loadLang('it');
    expect(read(it_, 'Filippo IV, ossia il conte d’Olivares, comunemente chiamato il conte duca, non lo voleva lì', 'conte', 1)).toMatchObject({ key: 'conte', hint: 'count' });
    expect(read(it_, 'E, tenendo la grida sciorinata in aria, cominciò a leggere, borbottando a precipizio in alcuni passi', 'grida')).toMatchObject({ key: 'grida', hint: 'proclamation, edict' });
    expect(read(it_, 'A quelle grida strazianti il burattino, che in fondo aveva un cuore eccellente, si mosse a compassione', 'grida').key).toBe('grido');
  });
});

describe('Italian titles and the old texts\' spellings', () => {
  it('reads signore as the gentleman and the title, and the title after it as a noun', async () => {
    const it_ = await loadLang('it');
    const conte = '— E va bene! Il signor conte si levò per tempo, alle ore otto e mezzo precise... La signora contessa indossò un abito lilla';
    expect(read(it_, conte, 'signor')).toMatchObject({ key: 'signore', hint: 'gentleman, sir' });
    expect(read(it_, conte, 'conte').key).toBe('conte');
    expect(read(it_, conte, 'signora').key).toBe('signora');
    expect(read(it_, '«son venuto, signor curato, per sapere a che ora le comoda che ci troviamo in chiesa.»', 'curato')).toMatchObject({ pos: 'noun', hint: 'parish priest' });
    // A word that is a noun and an adjective alike, after an article, with no noun after it: the person.
    expect(read(it_, 'quando entrò l’aiutante di camera, col curato del paese, il quale annunziò', 'curato').hint).toBe('parish priest');
    expect(read(it_, 'Mi cagionava un vero e proprio ribrezzo', 'vero').hint).toBe('true');
  });

  it('reads Manzoni\'s ne\', da\', que\', sur, par and essi as he meant them', async () => {
    const it_ = await loadLang('it');
    expect(read(it_, 'e poi, ch’è peggio, ne\' luoghi più terribili o più pietosi della storia', 'ne\'')).toMatchObject({ key: 'nei', hint: 'in the' });
    expect(read(it_, 'Stando alla larga da\' prepotenti, dissimulando le loro soverchierie passeggiere e capricciose', 'da\'')).toMatchObject({ key: 'dai', hint: 'from the' });
    expect(read(it_, '— Da\' retta a me: bevila.', 'Da\'').key).toBe('dare');
    expect(read(it_, 'o di far pensare, a tutti que\' passi insomma che richiedono bensì un po\' di rettorica', 'que\'').hint).toBe('those');
    expect(read(it_, '«Intendo,» disse il conte zio; e sur un certo fondo di goffaggine, dipintogli in viso dalla natura', 'sur').hint).toBe('on');
    expect(read(it_, 'e il ponte, che ivi congiunge le due rive, par che renda ancor più sensibile all’occhio questa trasformazione', 'par').hint).toBe('seems');
    expect(read(it_, '«una piccola bagattella! a un galantuomo par mio! e domani com’andrà?»', 'par').key).toBe('pari');
    expect(read(it_, 'io concepii così misera stima dei libri, sieno essi a stampa o manoscritti', 'essi')).toMatchObject({ pos: 'pronoun', hint: 'they, them' });
    expect(read(it_, 'Sagace e avventuroso, mio padre non ebbe mai pe’ suoi commerci stabile sede', 'pe’').hint).toBe('for the');
  });
});

describe('Italian words by their neighbors, after the second audit', () => {
  it('reads s\' before a verb, and si before a compound tense, as the reflexive', async () => {
    const it_ = await loadLang('it');
    expect(read(it_, 'Anche Papiano s’alzò per riaccendere il lanternino.', 'alzò').hint).toBe('to stand up');
    expect(read(it_, 'il fatto che Belluca, la sera avanti, s’era fieramente ribellato al suo capo-ufficio', 'ribellato').hint).toBe('to rebel');
    // A modal lends its si to the infinitive: wanted to take revenge.
    const vendicare = 'e sembrava che si volesse vendicare sui deboli di tutto il male che s’immaginava gli avessero fatto';
    expect(read(it_, vendicare, 'volesse').hint).toBe('to want');
  });

  it('reads cosa, quantunque, lungo, venti, date, chiuse, stessi, bravi where they stand', async () => {
    const it_ = await loadLang('it');
    expect(read(it_, 'Che i due descritti di sopra stessero ivi ad aspettar qualcheduno, era cosa troppo evidente', 'cosa').hint).toBe('thing');
    expect(read(it_, 'E quantunque quell’annata fosse ancor più scarsa delle antecedenti', 'quantunque').hint).toBe('although');
    expect(read(it_, 'faceva un fracasso come venti paia di zoccoli da contadini.', 'venti')).toMatchObject({ key: 'venti', hint: 'twenty' });
    expect(read(it_, 'aveva affidato circa sei mila lire, ricavate dalla vendita dei mobili', 'circa').hint).toBe('about');
    expect(read(it_, 'E a nessuno passava per il capo che, date le specialissime condizioni in cui quell’infelice viveva da tant’anni', 'date').key).toBe('dare');
    expect(read(it_, 'non ebbe fiato per dir altro. Chiuse gli occhi, aprì la bocca', 'Chiuse').key).toBe('chiudere');
    const bravi = 'a prima vista si davano a conoscere per individui della specie de\' bravi.';
    expect(read(it_, bravi, 'bravi')).toMatchObject({ key: 'bravo', hint: 'henchman' });
    expect(read(it_, 'non potei prender sonno. Che dovevo fare, insomma?', 'sonno').key).toBe('sonno');
    expect(read(it_, 'Girò gli occhi smarriti intorno alla stanza per vedere di dove mai poteva essere uscita quella vocina', 'Girò').key).toBe('girare');
    expect(read(it_, 'ora ch’egli aveva sentito fischiare il treno, non poteva piú, non voleva piú esser trattato a quel modo.', 'piú').hint).toBe('more');
    expect(read(it_, 'che posso, se non altro, rompere a mezzo: una ne ho, che posso romper subito', 'ne').key).toBe('ne');
    expect(read(it_, 'se alla partenza mancasse un’ora sola, sarei quasi capace di aspettare', 'ora').key).toBe('ora');
    expect(read(it_, 'col nome di Gorgonzola in bocca, di paese in paese, ci arrivò, un’ora circa prima di sera', 'ora').hint).not.toBe('now');
  });
});

describe('Italian fixed phrases, as the books mean them', () => {
  it('takes the longer phrase and the literal hint', async () => {
    const it_ = await loadLang('it');
    const liberta = 'Insomma, tanto dissero e tanto fecero, che il carabiniere rimesse in libertà Pinocchio, e condusse in prigione quel pover’uomo di Geppetto.';
    expect(it_.hint(tok(it_, liberta, 'libertà'))).toBe('free, at liberty');
    const piedi = 'che n’era scoppiato fuori in quel momento, squadrò Renzo da capo a piedi; poi diede d’occhio al compagno';
    expect(it_.hint(tok(it_, piedi, 'capo'))).toBe('from head to toe');
    expect(it_.hint(tok(it_, piedi, 'piedi'))).toBe('from head to toe');
    expect(it_.hint(tok(it_, 'giacchè questa persona le sta tanto a cuore....', 'cuore'))).toBe('to heart');
    expect(it_.hint(tok(it_, 'Che i due descritti di sopra stessero ivi ad aspettar qualcheduno, era cosa troppo evidente', 'sopra'))).toBe('above');
  });
});

describe('Italian hints for the words of the old texts', () => {
  it('hints a word by the sense the books use, and the old spellings by their meaning', async () => {
    const it_ = await loadLang('it');
    const hint = (text: string, word: string): string => it_.hint(tok(it_, text, word)) ?? '';
    expect(hint('Mi pare un burattino fatto di un legname molto asciutto, e sono sicuro che a buttarlo sul fuoco', 'sicuro')).toBe('sure, safe');
    expect(hint('— gridò Pinocchio sempre più accecato dalla collera', 'collera')).toBe('anger');
    expect(hint('seguiti da certi topi grossi quanto un coniglio', 'topi')).toBe('mice');
    expect(hint('scende appoggiata a due monti contigui, l’uno detto di san Martino, l’altro, con voce lombarda, il Resegone', 'san')).toBe('saint');
    expect(hint('sin dove potevano vedere la sciara nera e desolata, sporca di ginestre riarse', 'sciara')).toBe('lava field');
    expect(hint('egli andava a rincantucciarsi col suo corbello fra le gambe, per rosicchiarsi quel suo pane', 'corbello')).toBe('basket');
    expect(hint('Appena giunto sotto la vite, crac.... sentì stringersi le gambe', 'vite')).toBe('vine; screw');
    expect(hint('gli squarci che abbiam riportati delle gride contro i bravi, ne sono un piccolo, ma fedel saggio', 'gride')).toBe('proclamations, edicts');
    expect(hint('che la sua sorella s’era fatta sposa, e aveva altro pel capo', 'pel')).toBe('for the');
    expect(hint('«Or bene,» gli disse il bravo, all’orecchio, ma in tono solenne di comando', 'solenne')).toBe('solemn');
  });

  it('hints the phrases the books use, a longer one first', async () => {
    const it_ = await loadLang('it');
    const hint = (text: string, word: string): string => it_.hint(tok(it_, text, word)) ?? '';
    expect(hint('— mi venne da osservare a mo’ di scusa, rivolto al Bernaldez.', 'mo’')).toBe('by way of, like');
    expect(hint('e al quale io affido il manoscritto appena sarà terminato, se mai sarà', 'mai')).toBe('if ever');
    expect(hint('le armi e gli armati che vedeva sempre in giro, un castello, quel castello', 'giro')).toBe('around');
    expect(hint('» e lasciò la frase a mezzo', 'mezzo')).toBe('halfway, half');
    expect(hint('Di queste galline, sette le mangeremo noi, e una la daremo a te, a condizione, s’intende bene, che tu faccia finta di dormire', 'intende')).toBe('of course');
  });
});
