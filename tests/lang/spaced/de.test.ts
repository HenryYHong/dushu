// German on real sentences from Die Verwandlung (1915): case-kept keys, compounds, forms, names, sein, levels, hints.
import { describe, expect, it } from 'vitest';
import { expectCovers, fixture, loadLang, tok, words } from './load';

const SAMSA = 'Als Gregor Samsa eines Morgens aus unruhigen Träumen erwachte, fand er sich in seinem Bett zu einem ungeheueren Ungeziefer verwandelt.';

describe('German tokens', () => {
  it('cover the paragraph exactly', async () => {
    const de = await loadLang('de');
    for (const p of (await fixture('de-verwandlung')).slice(0, 40)) expectCovers(de.segment(p), p);
    const toks = de.segment('»Was ist mit mir geschehen?« dachte er.');
    expectCovers(toks, '»Was ist mit mir geschehen?« dachte er.');
    expect(toks.filter((t) => t.kind === 'punct').map((t) => t.text)).toEqual(['»', '?', '«', '.']);
  });

  it('give every word its dictionary form', async () => {
    const de = await loadLang('de');
    const lemmas = Object.fromEntries(words(de, SAMSA).map((t) => [t.text, t.lemma]));
    expect(lemmas).toMatchObject({ eines: 'ein', Träumen: 'Traum', unruhigen: 'unruhig', erwachte: 'erwachen', fand: 'finden',
      seinem: 'sein', Bett: 'Bett', Ungeziefer: 'Ungeziefer', verwandelt: 'verwandeln' });
    expect(tok(de, SAMSA, 'Gregor').name).toBe(true);
    expect(tok(de, SAMSA, 'Samsa').name).toBe(true);
  });

  it("cut geht's into the verb and es", async () => {
    const de = await loadLang('de');
    const t = words(de, "Wie geht's dir?");
    expect(t.map((w) => w.text)).toEqual(['Wie', 'geht', "'s", 'dir']);
    expect(t[2].key).toBe('es');
    expect(de.hint(t[2])).toBe('it');
  });
});

describe('German lookups', () => {
  it('keep the case of a key: Essen the meal is not essen to eat', async () => {
    const de = await loadLang('de');
    const s = 'Das Essen ist gut, wir essen jetzt.';
    expect(tok(de, s, 'Essen').key).toBe('Essen');
    expect(tok(de, s, 'Essen').name).toBeUndefined();
    expect(tok(de, s, 'essen').key).toBe('essen');
    // A noun is written with a capital in mid-sentence: Buch is a book, not a name.
    expect(tok(de, 'Er hat sein Buch.', 'Buch').name).toBeUndefined();
  });

  it('read sein as "his" before a noun and "to be" at the end of a clause', async () => {
    const de = await loadLang('de');
    const s = 'Er hat sein Buch. Er muss da sein.';
    expect(de.hint(tok(de, s, 'sein', 0))).toBe('his');
    expect(de.hint(tok(de, s, 'sein', 1))).toBe('to be');
  });

  it('explain forms', async () => {
    const de = await loadLang('de');
    expect(de.lookup('Häuser').entries[0].head).toBe('Haus');
    expect(de.lookup('Häuser').form).toBe('plural');
    expect(de.lookup('Haus').entries[0].gender).toBe('n');
    expect(de.lookup('ging').key).toBe('gehen');
    expect(de.lookup('ging').form).toMatch(/preterite/);
    expect(de.lookup('Bäume').entries[0].head).toBe('Baum');
  });

  it('split a compound the dictionary lacks into words it has, the last one inflected', async () => {
    const de = await loadLang('de');
    const look = de.lookup('Fensterblech');
    expect(look.parts?.map((p) => [p.text, p.key])).toEqual([['Fenster', 'Fenster'], ['blech', 'Blech']]);
    expect(look.entries[0].head).toBe('Blech');
  });
});

describe('German keys, levels and hints', () => {
  it('normalize, level and hint the common words', async () => {
    const de = await loadLang('de');
    expect(de.normalize('ging')).toBe('gehen');
    expect(de.normalize('Häuser')).toBe('Haus');
    for (const k of ['sein', 'haben', 'ich', 'nicht']) expect(de.level(k)).toBe(1);
    expect(de.level('Ungeziefer')!).toBeGreaterThanOrEqual(4);
    const hints = Object.fromEntries(words(de, 'Ich habe das Haus gesehen, und er ist nicht hier.').map((t) => [t.text, de.hint(t)]));
    expect(hints).toMatchObject({ Ich: 'I', habe: 'to have', Haus: 'house', und: 'and', nicht: 'not', hier: 'here' });
  });

  it('credit Wiktionary and the frequency list with their licences', async () => {
    const de = await loadLang('de');
    expect(de.meta.sources.map((s) => s.license)).toContain('CC BY-SA 4.0 (and GFDL)');
    expect(de.meta.counts.entries).toBeGreaterThan(60000);
  });
});

describe('German spellings the dictionary has otherwise (de-spelling.ts, re-audit de-22)', () => {
  it('read a participle or adjective with an ending the dictionary lists bare', async () => {
    const de = await loadLang('de');
    const beine = 'Er versuchte es wohl hundertmal, schloß die Augen, um die zappelnden Beine nicht sehen zu müssen.';
    expect(tok(de, beine, 'zappelnden').key).toBe('zappeln');
    expect(de.hint(tok(de, beine, 'zappelnden'))).toBe('to wriggle');
    expect(tok(de, SAMSA, 'ungeheueren').key).toBe('ungeheuer');
    // Die Verwandlung: the participle still reads as an adjective before its noun, and the noun after it as the noun.
    const arme = 'Er eilte zu ihnen und suchte sie mit ausgebreiteten Armen in ihr Zimmer zu drängen.';
    expect(tok(de, arme, 'ausgebreiteten').key).toBe('ausbreiten');
    expect(tok(de, arme, 'Armen').key).toBe('Arm');
  });

  it('read the spelling before 1996 and a capital a line of verse gave', async () => {
    const de = await loadLang('de');
    expect(tok(de, 'Später rief sie: »Laßt mich doch zu Gregor, er ist ja mein unglücklicher Sohn!', 'Laßt').key).toBe('lassen');
    expect(tok(de, 'Wußte Schneider Böck zu machen.', 'Wußte').key).toBe('wissen');
    expect(tok(de, '»Leb wohl!« sagte er, »leb wohl, Elisabeth! Vergiß es nicht!«', 'Vergiß').key).toBe('vergessen');
  });

  it("read a separable verb's zu-infinitive as the verb, and its present participle with zu", async () => {
    const de = await loadLang('de');
    // Effi Briest: an altar rug "to be put together" from single squares.
    const teppich = 'Beide waren fleißig bei der Arbeit, die der Herstellung eines aus Einzelquadraten zusammenzusetzenden Altarteppichs galt.';
    expect(tok(de, teppich, 'zusammenzusetzenden').key).toBe('zusammensetzen');
    expect(tok(de, 'durch die gegenüberstehende Tür trat er in einen kleinen Flur.', 'gegenüberstehende').key).toBe('gegenüberstehen');
  });
});

describe('German hints of the re-audit (curated)', () => {
  it('give a preposition its second common sense, and viel its plural and superlative', async () => {
    const de = await loadLang('de');
    const hint = (text: string, word: string, nth = 0): string | undefined => de.hint(tok(de, text, word, nth));
    expect(hint('»Nach Indien, nach Indien!« sang er und schwenkte sich mit ihr im Kreise.', 'nach')).toBe('after; to');
    expect(hint('Wir sprachen gestern abend, als du weggegangen warst, noch lange über dich.', 'über')).toBe('over; about');
    expect(hint('statt dessen aber hatte er nur die vielen Beinchen, die ununterbrochen in der verschiedensten Bewegung waren.', 'vielen')).toBe('many');
    expect(hint('Es waren lauter Verse, die meisten füllten höchstens eine Seite.', 'meisten')).toBe('most');
    expect(hint('Aber du sagtest doch, er sei Landrat.', 'Landrat')).toBe('district administrator');
  });

  it('read the phrases the books have', async () => {
    const de = await loadLang('de');
    const hint = (text: string, word: string, nth = 0): string | undefined => de.hint(tok(de, text, word, nth));
    expect(hint('Jetzt nur still und schnell nach Haus,', 'Haus')).toBe('home');
    expect(hint('Aber Reinhard verlor alle Aufmerksamkeit; statt dessen verfaßte er ein langes Gedicht.', 'dessen')).toBe('instead');
    expect(hint('die ganze Zeit über zitterte er unter dem Kanapee.', 'über')).toBe('all the while');
    expect(hint('»Hm,« sagte er, »ich kann den gelben Vogel nicht leiden.«', 'leiden')).toBe("can't stand");
  });
});
