// The hint over a word is read at a glance, so the 400 commonest words of every spaced language must have one that is a
// short plain English gloss: not a description of the word ("Generic demonstrative pronoun"), not its grammar
// ("third-person singular", "form of"), not cut in the middle, not a capitalized sentence. Below that, the dictionary
// builder's fixes (scripts/lang/wikt/build.py) on the sentences of the classics where readers met the defects.
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Token } from '../../../src/types';
import { loadLang, lookupIn, tok, words } from './load';

const DATA = process.env.DUSHU_LANG_DATA || join(__dirname, '..', '..', '..', 'public', 'data');

const IDS = ['es', 'fr', 'de', 'it', 'pt', 'ru'] as const;

const DESCRIPTION = /^(?:Used|Indicates|Generic|Refers|Optional|Expresses|Emphasi[sz]es|Denotes|Marks|Intensifies|Introduces|A verbal|An? [a-z]+ particle)\b/i;
const GRAMMAR = /\b(?:first|second|third)-person\b|\bform of\b|\b(?:singular|plural|nominative|genitive|dative|accusative|instrumental|prepositional)\b/i;

/** What is wrong with a hint, or '' when it reads as a short plain gloss. */
function hintProblem(hint: string | undefined): string {
  if (!hint) return 'no hint';
  for (const part of hint.split('|')) {
    if (part.length > 40) return 'long';
    if (DESCRIPTION.test(part)) return 'description';
    if (GRAMMAR.test(part)) return 'grammar';
    // Mr, Earth, God are English written so; a capitalized phrase is a sentence about the word.
    if (/^[A-ZÀ-ÝА-Я]/.test(part) && part.split(' ').length > 2) return 'capitalized';
    if (part.split(/[,;]\s*/).some((piece) => piece.split(' ').length > 4)) return 'wordy';
    for (const [a, b] of [['(', ')'], ['“', '”'], ['[', ']']]) if (part.split(a).length !== part.split(b).length) return 'unbalanced';
    if ((part.match(/"/g) ?? []).length % 2) return 'unbalanced';
  }
  return '';
}

describe.each(IDS)('%s hints of the 400 commonest words', (id) => {
  it('are short plain glosses', async () => {
    const eng = await loadLang(id);
    const keys = eng.levelWords(1).slice(0, 400);
    expect(keys.length).toBe(400);
    const bad: string[] = [];
    for (const key of keys) {
      // A key the tokenizer would cut alone (l' needs a word after it) is asked about as one token.
      const first = words(eng, key)[0];
      const t: Token = first?.text === key ? first : { text: key, start: 0, end: key.length, kind: 'word', inDict: true };
      const h = eng.hint(t);
      const problem = t?.name ? '' : hintProblem(h);
      if (problem) bad.push(`${key}: ${problem}: ${h ?? ''}`);
    }
    expect(bad).toEqual([]);
  }, 60000);
});

describe('hintProblem', () => {
  it('passes plain glosses and catches the kinds of junk Wiktionary glosses turn into', () => {
    for (const h of ['house', 'to go', 'there is, there are', 'I', 'to have to, must', 'to remember|to agree']) expect(hintProblem(h), h).toBe('');
    expect(hintProblem('Generic demonstrative pronoun. Translate')).toBe('description');
    expect(hintProblem('Used to link an interrogative clause')).toBe('description');
    expect(hintProblem('second-person singular')).toBe('grammar');
    expect(hintProblem('nominative/accusative neuter singular of')).toBe('grammar');
    expect(hintProblem('Refers to a neuter')).toBe('description');
    expect(hintProblem('some”)')).toBe('unbalanced');
    expect(hintProblem(undefined)).toBe('no hint');
  });
});

/** The hint over a word of a sentence, as the reader shows it. */
async function hintIn(id: 'es' | 'fr' | 'de' | 'it' | 'pt' | 'ru', sentence: string, word: string): Promise<string | undefined> {
  const eng = await loadLang(id);
  return eng.hint(tok(eng, sentence, word));
}

/** The word with its stressed vowel marked, as the reader shows it. */
const stressed = (text: string, at: number | undefined): string => (at === undefined ? text : text.slice(0, at + 1) + '\u0301' + text.slice(at + 1));

describe('Spanish words the dictionary used to read as another', () => {
  it('keeps a word with an entry of its own from an old spelling of another (Platero y yo: "¡Ay, qué relumbres")', async () => {
    const es = await loadLang('es');
    const ay = tok(es, '¡Ay, qué relumbres y olores! ¡Ay, cómo ríen los prados!', 'Ay');
    expect(ay.lemma).toBe('ay');
    // haberlo is haber + lo, not an archaic spelling of habérselas (Marianela).
    const card = lookupIn(es, 'El discreto Golfín se sentó tranquilamente, como podría haberlo hecho en el banco de un paseo', 'haberlo');
    expect(card.entries.map((e) => e.head)).not.toContain('habérselas');
  });

  it('never makes a verb of a noun\'s plural through a chain of pointers (Quiroga: "Esa luz que ves allá")', async () => {
    const es = await loadLang('es');
    const card = lookupIn(es, 'Esa luz que ves allá es Buenos Aires.', 'ves');
    expect(card.entries[0].head).toBe('ver');
    for (const e of card.entries) expect((e as { form?: string }).form ?? '').not.toMatch(/^(?:feminine|masculine)? ?plural$/);
  });

  it('gives an old spelling the form it spells, as old spelling (Quiroga: "se fué a vivir al monte")', async () => {
    const es = await loadLang('es');
    const card = lookupIn(es, 'El hombre enfermo aceptó, y se fué a vivir al monte, lejos, más lejos que Misiones todavía.', 'fué');
    expect(card.form).toBe('third-person singular preterite indicative (old spelling)');
  });

  it('keeps a feminine noun its own meaning (Marianela: "¡Eh, muchacha, aguarda")', async () => {
    expect(await hintIn('es', '¡Eh, muchacha, aguarda, detén el paso!', 'muchacha')).toBe('girl');
    const es = await loadLang('es');
    expect(tok(es, '¡Eh, muchacha, aguarda, detén el paso!', 'muchacha').lemma).toBe('muchacha');
  });

  it('attaches a neuter demonstrative to its own stem only, hinted as itself (Quiroga: "y eso le hacía bien")', async () => {
    const es = await loadLang('es');
    const s = 'Hacía allá mucho calor, y eso le hacía bien.';
    expect(await hintIn('es', s, 'eso')).toBe('that');
    expect(lookupIn(es, s, 'eso').entries.map((e) => e.head)).toEqual(['ése']);
    // "Por eso" is the fixed phrase "that's why" (phrases.tsv.gz).
    expect(await hintIn('es', 'Por eso quiero que se vaya a vivir al monte...', 'eso')).toBe("that's why");
    expect(lookupIn(es, 'Al oir esto, la tortuga se sintió con una fuerza inmensa', 'esto').entries.map((e) => e.head)).toEqual(['éste']);
  });

  it('files no synonym of another word as a form (Marianela: "alfombra para un cuarto")', async () => {
    const es = await loadLang('es');
    const card = lookupIn(es, 'Después le sacó el cuero, tan grande que él solo podía servir de alfombra para un cuarto.', 'cuarto');
    expect(card.entries.map((e) => e.head)).not.toContain('dinero');
  });

  it('reads a spelling as the word the subtitles mostly mean by it (sé, montes, rica)', async () => {
    const es = await loadLang('es');
    // The prior: sé is saber's "I know" far more often than ser's "be!" (Platero y yo).
    expect(tok(es, 'Lo llamo dulcemente: "¿Platero?", y viene a mí con un trotecillo alegre que parece que se ríe en no sé qué cascabeleo ideal...', 'sé').lemma).toBe('saber');
    expect(tok(es, 'La tortuga cargada así caminó, caminó y caminó de día y de noche. Atravesó montes, campos, cruzó a nado ríos', 'montes').lemma).toBe('monte');
    // Costa Rica's Rica in the treebanks no longer makes rica "fenugreek" (La Rioja) of the adjective.
    expect(tok(es, '—Ahora —se dijo el hombre,— voy a comer tortuga, que es una carne muy rica.', 'rica').lemma).toBe('rico');
  });
});

describe('French, German and Italian words the dictionary used to read as another', () => {
  it('takes no pronunciation line for a sense (Perrault: "dès qu\'on fut sorti de table")', async () => {
    const fr = await loadLang('fr');
    const s = 'alla, dès qu\'on fut sorti de table, se cacher derrière la tapisserie';
    expect(await hintIn('fr', s, 'dès')).not.toMatch(/audio/i);
    for (const e of lookupIn(fr, s, 'dès').entries) for (const x of e.senses) expect(x.glosses.join(' ')).not.toMatch(/\(file\)|^Audio/);
  });

  it('keeps a feminine noun of its own out of the masculine\'s forms (Perrault: "pour marraine")', async () => {
    const fr = await loadLang('fr');
    expect(tok(fr, 'on donna pour marraine à la petite princesse toutes les fées qu\'on put trouver dans le pays', 'marraine').lemma).toBe('marraine');
  });

  it('describes a form that fills several cells by its cells (Perrault: "garnis de diamants")', async () => {
    const fr = await loadLang('fr');
    const card = lookupIn(fr, 'une cuiller, une fourchette et un couteau de fin or, garnis de diamants et de rubis', 'garnis');
    const garnir = card.entries.find((e) => e.head === 'garnir') as { form?: string } | undefined;
    expect(garnir?.form).toMatch(/^masculine plural past participle; /);
    expect(garnir?.form).not.toMatch(/inflected form/);
  });

  it('hints an oblique personal pronoun as one (Kafka: "Was ist mit mir geschehen?")', async () => {
    expect(await hintIn('de', '»Was ist mit mir geschehen?« dachte er.', 'mir')).toBe('me');
    expect(await hintIn('de', 'Die unverhofften Ferien kamen ihnen herrlich zustatten.', 'ihnen')).toBe('them');
  });

  it('keeps agent nouns and plurals their own (Max und Moritz: "Schneider Böck", "Alle Hühner waren fort")', async () => {
    const de = await loadLang('de');
    expect(tok(de, 'Wußte Schneider Böck zu machen.', 'Schneider').lemma).not.toBe('schneiden');
    expect(tok(de, 'Doch der Bäcker, mit Bedacht, Hat das Backhaus zugemacht.', 'Bäcker').lemma).toBe('Bäcker');
    expect(lookupIn(de, 'Alle Hühner waren fort,', 'Hühner').entries[0].head).toBe('Huhn');
  });

  it('agrees an Italian past participle (Pinocchio: "è stata una nottata d\'inferno")', async () => {
    const it_ = await loadLang('it');
    const card = lookupIn(it_, '— Non lo so, babbo, ma credetelo che è stata una nottata d\'inferno, e me ne ricorderò fin che campo.', 'stata');
    expect(card.entries.map((e) => e.head)).toContain('essere');
  });

  it('reads a pre-reform spelling as the word it spells (Dom Casmurro: "aquella vida antiga")', async () => {
    const pt = await loadLang('pt');
    expect(tok(pt, 'A certos respeitos, aquella vida antiga apparece-me despida de muitos encantos', 'aquella').lemma).toMatch(/^aquel[ae]$/);
    // tive is ter's "I had"; estar has it only by way of the clipped tar of Portugal.
    expect(tok(pt, 'Nunca pude entender a conversação que tive com uma senhora, há muitos annos', 'tive').lemma).toBe('ter');
  });
});

describe('Russian words the dictionary used to read as another', () => {
  const NIGHTS = 'Мне вдруг показалось, что меня, одинокого, все покидают и что все от меня отступаются.';

  it('hints a personal pronoun\'s oblique forms as themselves, under their own pronoun (Белые ночи)', async () => {
    const ru = await loadLang('ru');
    expect(await hintIn('ru', NIGHTS, 'Мне')).toBe('me');
    expect(await hintIn('ru', NIGHTS, 'меня')).toBe('me');
    expect(lookupIn(ru, 'Может быть, я вам завтра же скажу, а может быть, нет… Я еще с вами наперед поговорю', 'вами').key).toBe('вы');
  });

  it('marks the stress of the reading running text means (Толстой: "открыла глаза", "отерла слезы")', async () => {
    const ru = await loadLang('ru');
    const at = (s: string, w: string) => stressed(w, tok(ru, s, w).stress);
    expect(at('Девочка открыла глаза, увидела медведей и бросилась к окну.', 'глаза')).toBe('глаза́');
    expect(at('Наконец она перестала, отерла слезы, и мы снова пошли.', 'слезы')).toBe('сле́зы');
    expect(at('да благо опомнились вовремя, опустили руки и с участием прошли друг подле друга.', 'руки')).toBe('ру́ки');
    // й is one letter: пойду́ and прийти́ get their mark (Белые ночи).
    const walk = 'Пойду ли на Невский, пойду ли в сад, брожу ли по набережной — ни одного лица из тех, кого привык встречать';
    expect(stressed('Пойду', tok(ru, walk, 'Пойду').stress)).toBe('Пойду́');
  });

  it('hints an inchoative verb by its verb, not "to begin" (Толстой: "Девочка захотела сесть")', async () => {
    expect(await hintIn('ru', 'Девочка захотела сесть и видит у стола три стула.', 'захотела')).toBe('to want');
  });

  it('reads жаль as "it\'s a pity" and небо as the sky (Белые ночи)', async () => {
    const ru = await loadLang('ru');
    expect(tok(ru, '— Вам жаль меня, Настенька; вам просто жаль меня, дружочек мой!', 'жаль').lemma).toBe('жаль');
    expect(lookupIn(ru, 'Небо было такое звездное, такое светлое небо, что, взглянув на него', 'Небо').entries[0].senses[0].glosses[0]).toBe('sky');
  });

  it('records the aspect of a verb and its partner (forms.tsv.gz A lines)', async () => {
    const entries = gunzipSync(await readFile(join(DATA, 'ru', 'entries.tsv.gz'))).toString('utf8').split('\n').filter((l) => l && !l.startsWith('#'));
    const forms = gunzipSync(await readFile(join(DATA, 'ru', 'forms.tsv.gz'))).toString('utf8').split('\n');
    const aspect = new Map(forms.filter((l) => l.startsWith('A\t')).map((l) => { const c = l.split('\t'); return [+c[1], [c[2], c[3]]]; }));
    const verb = (key: string) => entries.findIndex((l) => l.startsWith(key + '\t') && l.split('\t')[3] === 'verb');
    expect(aspect.get(verb('сказать'))).toEqual(['pf', 'говори́ть']);
    expect(aspect.get(verb('брать'))).toEqual(['impf', 'взять']);
  });
});

describe('hints in American English, with their verbs whole', () => {
  it('spells the 1,000 commonest words\' hints the American way', async () => {
    const british = /\b(?:colour|grey|neighbour|travell(?:er|ing)|kilometre|metre|centre|theatre|splendour|honour|favour|defence|programme|mum)\b|\w+ \/ \w+/i;
    for (const id of ['es', 'fr', 'de', 'it', 'pt', 'ru'] as const) {
      const eng = await loadLang(id);
      const bad = eng.levelWords(2).slice(0, 1000).map((k) => [k, eng.hint({ text: k, start: 0, end: k.length, kind: 'word', inDict: true })] as const)
        .filter(([, h]) => h && british.test(h));
      expect(bad, id).toEqual([]);
    }
  }, 60000);

  it('keeps a light verb\'s complement (Белые ночи: "что вы не влюбились в меня")', async () => {
    expect(await hintIn('ru', '— Я оттого люблю вас, что вы не влюбились в меня.', 'влюбились')).toBe('to fall in love');
  });
});

describe('fixed phrases', () => {
  it('reads a fixed phrase as one (Quiroga: "Y sin embargo estaba ya en Buenos Aires"; Белые ночи: "потому что")', async () => {
    expect(await hintIn('es', 'Y sin embargo, estaba ya en Buenos Aires, y ella no lo sabía.', 'embargo')).toBe('however');
    expect(await hintIn('ru', 'потому что вот уже восемь лет, как я живу в Петербурге, и почти ни одного знакомства не умел завести.', 'потому')).toBe('because');
  });
});

/** The data lines of one of a language's files (entries.tsv.gz, prior.tsv.gz …), comments left out. */
async function dataLines(id: string, file: string): Promise<string[]> {
  return gunzipSync(await readFile(join(DATA, id, file))).toString('utf8').split('\n').filter((l) => l && !l.startsWith('#'));
}

describe('how common a word is: only the share of its spellings that is its own', () => {
  it('keeps a rare word spelled like another word\'s common form rare (staio, gire, he, mala)', async () => {
    const it_ = await loadLang('it');
    const es = await loadLang('es');
    // staio "bushel" took a tenth of stare's stai, gire "to go" the subtitles' gia (già), he the auxiliary's he.
    // (gire was the 98th word of Italian, staio the 607th, he the 224th of Spanish; now none is among the 2,500 commonest.)
    for (const [eng, key] of [[it_, 'staio'], [it_, 'gire'], [es, 'he'], [es, 'mala']] as const) {
      expect(eng.level(key) ?? 7, key).toBeGreaterThan(3);
    }
    // Pinocchio: girò is girare, no longer the archaic gire.
    expect(tok(it_, 'Pinocchio girò la chiave, e la porta si aprì.', 'girò').lemma).toBe('girare');
    // Lazarillo: "Yo he cumplido con mi deber" is haber's he.
    expect(tok(es, 'Yo he cumplido con mi deber.', 'he').lemma).toBe('haber');
    expect(tok(es, 'o tres días ya dichos moría mala muerte, tanto que otra cosa no hacía', 'mala').lemma).toBe('malo');
  });

  it('reads a form that fills two cells no other verb shares as that verb (fr va, Candide: "Il va de France droit sur l\'Espagne")', async () => {
    const fr = await loadLang('fr');
    expect(tok(fr, 'Il va de France droit sur l’Espagne.', 'va').lemma).toBe('aller');
    expect(fr.level('va') ?? 7).toBeGreaterThan(4);
  });

  it('keeps a noun the treebanks name, whose spellings are all a verb\'s too (Platero: "al empezar la cuesta")', async () => {
    const es = await loadLang('es');
    expect(tok(es, 'Todos los días, cuando, al empezar la cuesta, tomamos el atajo, tú la has visto en su puesto verde.', 'cuesta').lemma).toBe('cuesta');
  });
});

describe('the builder\'s pointers and the forms tables leave out', () => {
  it('gives Spanish los a pronoun of its own (Quiroga: "Y el hombre los echó con la escoba")', async () => {
    const es = await loadLang('es');
    const card = lookupIn(es, 'Y el hombre los echó con la escoba.', 'los');
    expect(card.entries.some((e) => e.senses[0]?.pos === 'pronoun' && e.senses.some((s) => s.glosses.join(' ').includes('them')))).toBe(true);
  });

  it('reaches the lemma through an alternative form and its own plural (Collodi: "ai tonnini tuoi figliuoli")', async () => {
    const it_ = await loadLang('it');
    expect(tok(it_, 'Ti prego, per l’amore che porti ai tonnini tuoi figliuoli; aiutaci, o siamo perduti.', 'figliuoli').key).toBe('figliolo');
    // sur, "su used before words beginning with u" (Manzoni), and pe', the "truncation of pei" (Pirandello).
    expect(tok(it_, '«Intendo,» disse il conte zio; e sur un certo fondo di goffaggine, dipintogli in viso dalla natura', 'sur').key).toBe('su');
    expect(tok(it_, 'mio padre non ebbe mai pe’ suoi commerci stabile sede', 'pe’').key).toBe('pei');
  });

  it('files a reflexive verb\'s forms written with their pronoun (Collodi: "Geppetto si accòrse di avere in bocca")', async () => {
    const it_ = await loadLang('it');
    expect(tok(it_, 'Finito il combattimento, mastr’Antonio si trovò fra le mani la parrucca gialla di Geppetto, e Geppetto si accòrse di avere in bocca la parrucca brizzolata del falegname.', 'accòrse').key).toBe('accorgersi');
    expect(tok(it_, 'Ma i due, quando s’accorsero d’essere osservati, si fermarono anch’essi, si parlaron sottovoce, e tornarono indietro.', 'accorsero').key).toBe('accorgersi');
  });

  it('reads Machado\'s quiz as querer\'s quis (curated "of")', async () => {
    const pt = await loadLang('pt');
    const t = tok(pt, 'Minha mãe quiz saber o que era.', 'quiz');
    expect(t.key).toBe('querer');
    expect(pt.hint(t)).toBe('wanted');
  });

  it('keeps a noun made from a verb (Капитанская дочка: "Родители мои благословили меня")', async () => {
    const ru = await loadLang('ru');
    expect(tok(ru, 'Родители мои благословили меня.', 'Родители').key).toBe('родитель');
    // Герой нашего времени: Wiktionary's продолжение, with its stress, where a curated stand-in had none.
    expect(tok(ru, 'В продолжение двух дней мои дела ужасно подвинулись.', 'продолжение').stress).toBe(7);
  });

  it('gives a participle its short forms and declension, and an adjective its comparative, with their stress', async () => {
    const ru = await loadLang('ru');
    // Герой нашего времени: "В конце коридора была отворена дверь в боковую комнату".
    const door = tok(ru, 'Мы вышли в коридор. В конце коридора была отворена дверь в боковую комнату.', 'отворена');
    expect(door.key).toBe('отворить');
    expect(stressed(door.text, door.stress)).toBe('отворена́');
    // Белые ночи: "и солнце-то было в старину теплее".
    expect(tok(ru, 'И моложе-то она была в старину, и солнце-то было в старину теплее, и сливки в старину не так скоро кисли, — все в старину!', 'теплее').key).toBe('теплый');
  });

  it('lists no feminine noun as the masculine\'s form (хозяин is no "masculine" of хозяйка)', async () => {
    const ru = await loadLang('ru');
    const card = lookupIn(ru, 'глядя на опрокинутое лицо хозяина, который в свою очередь уже совсем успел потеряться', 'хозяина');
    expect(card.entries.map((e) => e.head)).not.toContain('хозяйка');
  });

  it('declines German participles and Ihr, keeps das Alter\'s forms its own, and joins a separable verb', async () => {
    const de = await loadLang('de');
    // Effi Briest: "die nach den Seebädern hinausführende Hauptstraße".
    expect(tok(de, 'das mit seiner Front auf die nach den Seebädern hinausführende Hauptstraße, mit seinem Giebel aber auf ein zwischen der Stadt und den Dünen liegendes Wäldchen herniederblickte', 'hinausführende').key).toBe('hinausführen');
    // Die Verwandlung: the Prokurist's "Ihre Stellung".
    expect(await hintIn('de', 'Und Ihre Stellung ist durchaus nicht die festeste.', 'Ihre')).toBe('your');
    // Immensee: "Wir Alten" are old people, not das Alter "age".
    const alten = lookupIn(de, 'Wir Alten haben uns im Leben schon genug umhergetrieben', 'Alten');
    expect(alten.entries.find((e) => e.head === 'Alter' && e.gender === 'n')).toBeUndefined();
    // Immensee: "von einem Guckfenster, welches nach der Diele hinausging", a subordinate clause's joined verb.
    expect(tok(de, 'von einem Guckfenster, welches nach der Diele hinausging, der grüne Vorhang weggeschoben', 'hinausging').key).toBe('hinausgehen');
    // Werther: the old spelling of trockenen.
    expect(tok(de, 'Sie hat einen trocknen Husten, die Knochen stehn ihr zum Gesichte heraus', 'trocknen').key).toBe('trocken');
    expect(await hintIn('de', 'Während der Überfahrt ließ Elisabeth ihre Hand auf dem Rande des Kahnes ruhen.', 'Überfahrt')).toBe('crossing');
  });

  it('reads a contraction Wiktionary gives only the pieces of by its pieces (durchs, pei)', async () => {
    expect(await hintIn('de', 'dann liefen beide Kinder durchs Haus in den Garten', 'durchs')).toBe('through the');
    expect(await hintIn('it', 'mio padre non ebbe mai pe’ suoi commerci stabile sede', 'pe’')).toBe('for the');
  });

  it('hints a demonym by its place and a diminutive by its noun (Platero: "otoño moguereño", "cabecitas finas")', async () => {
    expect(await hintIn('es', '¡Claras tardes del otoño moguereño!', 'moguereño')).toBe('of Moguer');
    expect(await hintIn('es', 'Se adivinan cabezotas obscuras de asnos, y cabecitas finas de niños', 'cabecitas')).toBe('little head');
  });
});

describe('curated hints of one section, and phrases a reader leaves out or rewrites', () => {
  it('hints one section of a word and keeps a curated section off the treebanks\' readings (fr que "than", comme "how")', async () => {
    const entries = (await dataLines('fr', 'entries.tsv.gz')).map((l) => l.split('\t'));
    const que = entries.filter((c) => c[0] === 'que' && c[3] === 'conjunction').map((c) => c[8]);
    expect(que).toEqual(['that', 'than']);
    const comme = entries.findIndex((c) => c[0] === 'comme' && c[3] === 'adverb');
    expect(entries[comme][8]).toBe('how');
    const prior = (await dataLines('fr', 'prior.tsv.gz')).find((l) => l.startsWith('comme\t')) ?? '';
    expect(prior.split('\t')[1].split(' ').map((x) => +x.split(':')[0])).not.toContain(comme);
  });

  it('leaves out a phrase a reader dropped, and one Wiktionary calls a euphemism', async () => {
    const es = await loadLang('es');
    // Lazarillo: "quiero que sepa vuestra merced" is no "que yo sepa".
    expect(lookupIn(es, 'Mas también quiero que sepa vuestra merced que, con todo lo que adquiría', 'sepa').phrase).toBeUndefined();
    const pt = await loadLang('pt');
    // A cartomante: "ele tornou a bater uma, duas, três pancadas".
    expect(lookupIn(pt, 'a curiosidade fustigava-lhe o sangue, as fontes latejavam-lhe; ele tornou a bater uma, duas, três pancadas.', 'uma').phrase).toBeUndefined();
    const de = await loadLang('de');
    // Immensee: a possessive and a noun are that, unless listed (meine Rede, not "my point exactly").
    expect(lookupIn(de, '»Habt ihr meine Rede begriffen?«', 'Rede').phrase).toBeUndefined();
  });

  it('leads a listed phrase\'s card with the reader\'s gloss, and always writes a listed phrase', async () => {
    const it_ = await loadLang('it');
    const fine = lookupIn(it_, 'e dopo aver resistito un bel pezzo, alla fine non ne potè più', 'fine');
    expect(fine.phrase).toBe('alla fine');
    expect(fine.entries[0].senses[0].glosses[0]).toBe('in the end, finally');
    // La Parure: "par conséquent" was cut at PHRASE_MAX by its rarest word.
    expect(await hintIn('fr', 'Je n’ai pas de toilette et, par conséquent, je ne peux aller à cette fête.', 'conséquent')).toBe('consequently');
  });
});
