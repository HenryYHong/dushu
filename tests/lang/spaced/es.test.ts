// Spanish on real sentences from Don Quijote (1605): lemmas, forms, clitics, names, context, levels, hints.
import { describe, expect, it } from 'vitest';
import type { SpacedEntry } from '../../../src/lang/spaced/core';
import { expectCovers, fixture, loadLang, lookupIn, tok, words } from './load';

const QUIJOTE = 'En un lugar de la Mancha, de cuyo nombre no quiero acordarme, no ha mucho tiempo que vivía un hidalgo de los de lanza en astillero, adarga antigua, rocín flaco y galgo corredor.';

describe('Spanish tokens', () => {
  it('cover the paragraph exactly, one token per mark', async () => {
    const es = await loadLang('es');
    for (const p of (await fixture('es-quijote')).slice(0, 40)) expectCovers(es.segment(p), p);
    const toks = es.segment('—¿Qué dices, Sancho?... En 1605, 3,5 leguas.');
    expectCovers(toks, '—¿Qué dices, Sancho?... En 1605, 3,5 leguas.');
    expect(toks.filter((t) => t.kind === 'punct').map((t) => t.text)).toEqual(['—', '¿', ',', '?', '.', '.', '.', ',', '.']);
    expect(toks.filter((t) => t.kind === 'num').map((t) => t.text)).toEqual(['1605', '3,5']);
  });

  it('give every word its dictionary form', async () => {
    const es = await loadLang('es');
    const lemmas = words(es, QUIJOTE).map((t) => t.lemma);
    expect(lemmas).toEqual(['en', 'un', 'lugar', 'de', 'la', 'Mancha', 'de', 'cuyo', 'nombre', 'no', 'querer', 'acordar', 'no',
      'haber', 'mucho', 'tiempo', 'que', 'vivir', 'un', 'hidalgo', 'de', 'el', 'de', 'lanza', 'en', 'astillero', 'adarga',
      'antiguo', 'rocín', 'flaco', 'y', 'galgo', 'corredor']);
    expect(tok(es, QUIJOTE, 'Mancha').name).toBe(true);
    expect(tok(es, QUIJOTE, 'quiero').key).toBe('querer');
  });

  it('read a capital at the start of a sentence as the lower-case word', async () => {
    const es = await loadLang('es');
    const t = words(es, 'Una olla de algo más vaca que carnero. Tenía en su casa una ama.');
    expect(t[0].key).toBe('una');
    expect(t[0].name).toBeUndefined();
    expect(t.find((x) => x.text === 'Tenía')!.lemma).toBe('tener');
  });
});

describe('Spanish lookups', () => {
  it('list every lemma a form can be, the likelier first, each with its form', async () => {
    const es = await loadLang('es');
    const fue = es.lookup('fue');
    expect(fue.entries.map((e) => e.head).slice(0, 2)).toEqual(['ser', 'ir']);
    expect(fue.form).toBe('third-person singular preterite indicative');
    expect((fue.entries[1] as SpacedEntry).form).toBe('third-person singular preterite indicative');
    expect(es.lookup('hablábamos').form).toBe('first-person plural imperfect indicative');
    expect(es.lookup('antigua').entries[0].head).toBe('antiguo');
    expect(es.lookup('antigua').form).toBe('feminine');
    expect(es.lookup('casas').entries[0].head).toBe('casa');
    expect(es.lookup('casa').entries[0].gender).toBe('f');
  });

  it('give senses as clean English with usage notes', async () => {
    const es = await loadLang('es');
    const ir = es.lookup('ir').entries[0];
    expect(ir.senses[0].glosses[0]).toMatch(/^to go/);
    for (const e of [ir, ...es.lookup('casa').entries, ...es.lookup('hidalgo').entries]) {
      for (const s of e.senses) for (const g of s.glosses) expect(g).not.toMatch(/\[\[|\{\{|^(?:Alternative|Obsolete) form of/);
    }
    const notes = es.lookup('acordar').entries[0].senses.flatMap((s) => s.notes ?? []);
    expect(notes).toContain('reflexive');
  });

  it('split enclitic pronouns off the verb', async () => {
    const es = await loadLang('es');
    const damelo = es.lookup('dámelo');
    expect(damelo.key).toBe('dar');
    expect(damelo.parts?.map((p) => [p.text, p.key])).toEqual([['dá', 'dar'], ['me', 'me'], ['lo', 'lo']]);
    expect(es.lookup('decirle').parts?.map((p) => p.key)).toEqual(['decir', 'le']);
    expect(es.lookup('diciéndole').key).toBe('decir');
    expect(es.lookup('vámonos').key).toBe('ir');
    expect(es.lookup('sentémonos').key).toBe('sentar');
  });

  it('read a reflexive verb with its reflexive sense', async () => {
    const es = await loadLang('es');
    const t = tok(es, QUIJOTE, 'acordarme');
    expect(es.hint(t)).toBe('to remember');
    const look = lookupIn(es, 'No me acuerdo de nada.', 'acuerdo');
    expect(look.entries[0].head).toBe('acordar');
    expect(look.entries[0].senses[0].notes).toContain('reflexive');
    // dar is not mostly reflexive: se dio prisa is not "to hit oneself".
    expect(es.hint(tok(es, 'Se dio prisa a salir.', 'dio'))).toBe('to give');
    // An imperative is reflexive only with its own pronoun: siéntate (sit down), dame (give me).
    expect(es.hint(tok(es, 'Siéntate aquí.', 'Siéntate'))).toBe('to sit down');
    expect(es.hint(tok(es, 'Dámelo ahora.', 'Dámelo'))).toBe('to give');
  });

  it('tell a noun from a verb by the words around it', async () => {
    const es = await loadLang('es');
    const s = 'El vino llegó tarde y vino con su padre. La casa es grande y se casa con su prima.';
    expect(tok(es, s, 'vino', 0).key).toBe('vino');
    expect(tok(es, s, 'vino', 1).key).toBe('venir');
    expect(tok(es, s, 'casa', 0).key).toBe('casa');
    expect(tok(es, s, 'casa', 1).key).toBe('casar');
    expect(es.hint(tok(es, 'El cura y la cura.', 'cura', 0))).toBe('priest');
    expect(es.hint(tok(es, 'El cura y la cura.', 'cura', 1))).toBe('cure');
    expect(tok(es, 'Había partido por medio dos gigantes.', 'partido').key).toBe('partir');
    expect(tok(es, 'Le dio una cuchillada.', 'una').key).toBe('una');
    expect(es.hint(tok(es, 'La vio y la casa.', 'La'))).toBe('her, it');
    expect(es.hint(tok(es, 'La casa es grande.', 'La'))).toBe('the');
    // Cuentos de la selva: after hay comes what there is, not a verb.
    expect(tok(es, 'Allá hay mates tan grandes como una lata de kerosene.', 'mates').key).toBe('mate');
  });

  it('take a capitalized unknown word in mid-sentence as a name', async () => {
    const es = await loadLang('es');
    const s = 'Fue a ver a Sancho Panza y a Rocinante en Sigüenza.';
    for (const w of ['Sancho', 'Panza', 'Rocinante', 'Sigüenza']) expect(tok(es, s, w).name).toBe(true);
    expect(es.lookup('Sigüenza').name).toBe(true);
    expect(es.hint(tok(es, s, 'Sigüenza'))).toBeUndefined();
  });

  it('match old spellings without their modern accents', async () => {
    const es = await loadLang('es');
    expect(es.lookup('fué').key).toBe('ser');
    expect(es.lookup('mesmo').entries[0].head).toBe('mismo');
  });
});

describe('Spanish keys, levels and hints', () => {
  it('normalize any form to its folded dictionary form', async () => {
    const es = await loadLang('es');
    expect(es.normalize('fueron')).toBe('ser');
    expect(es.normalize('Casas')).toBe('casa');
    expect(es.normalize('está')).toBe('estar');
    expect(es.normalize('él')).toBe('él');
  });

  it('put the commonest words at A1 and rare ones higher', async () => {
    const es = await loadLang('es');
    for (const k of ['ser', 'casa', 'de', 'querer', 'tener']) expect(es.level(k)).toBe(1);
    expect(es.level('hidalgo')!).toBeGreaterThanOrEqual(5);
    expect(es.level('xyzzy')).toBeUndefined();
    const a1 = es.levelWords(1);
    expect(a1.length).toBe(500);
    expect(a1).toContain('ir');
    expect(es.levelWords(2).length).toBe(1200);
    expect(es.lookup('casa').entries[0].level).toBe(1);
  });

  it('give short hints', async () => {
    const es = await loadLang('es');
    const hints = Object.fromEntries(words(es, 'El hombre tenía una casa y un perro; quería ir a comer.').map((t) => [t.text, es.hint(t)]));
    expect(hints).toMatchObject({ El: 'the', hombre: 'man', tenía: 'to have', casa: 'house', perro: 'dog', ir: 'to go', comer: 'to eat' });
    expect(es.hint(tok(es, 'Hay muchos libros.', 'Hay'))).toBe('there is, there are');
    for (const t of words(es, QUIJOTE)) {
      const h = es.hint(t);
      if (h) expect(h.split(' ').length).toBeLessThanOrEqual(5);
    }
  });

  it('credit Wiktionary and the frequency list with their licences', async () => {
    const es = await loadLang('es');
    expect(es.meta.sources.map((s) => s.license)).toContain('CC BY-SA 4.0 (and GFDL)');
    expect(es.meta.sources.some((s) => /FrequencyWords/.test(s.name))).toBe(true);
    expect(es.meta.counts.entries).toBeGreaterThan(80000);
  });
});
