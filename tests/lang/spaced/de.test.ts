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
