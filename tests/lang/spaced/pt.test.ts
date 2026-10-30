// Portuguese on real sentences from Dom Casmurro (1899, in its own spelling): hyphened pronouns, contractions, forms,
// levels, hints.
import { describe, expect, it } from 'vitest';
import { expectCovers, fixture, loadLang, tok, words } from './load';

const NOITE = 'Uma noite destas, vindo da cidade para o Engenho Novo, encontrei no trem da Central um rapaz aqui do bairro.';

describe('Portuguese a', () => {
  it('is the preposition before an indefinite or a demonstrative, the article before a possessive', async () => {
    const pt = await loadLang('pt');
    // Um apólogo: "disse a um novelo de linha".
    expect(pt.hint(tok(pt, 'Era uma vez uma agulha, que disse a um novelo de linha.', 'a'))).toBe('to');
    expect(pt.hint(tok(pt, 'Vou a cada casa.', 'a'))).toBe('to');
    expect(pt.hint(tok(pt, 'Vi a minha casa.', 'a'))).not.toBe('to');
    expect(pt.hint(tok(pt, 'Um apólogo de uma agulha e um novelo de linha.', 'novelo'))).toBe('ball of thread');
  });
});

describe('Portuguese tokens', () => {
  it('cover the paragraph exactly', async () => {
    const pt = await loadLang('pt');
    for (const p of (await fixture('pt-casmurro')).slice(0, 40)) expectCovers(pt.segment(p), p);
  });

  it('give every word its dictionary form, and names as names', async () => {
    const pt = await loadLang('pt');
    const lemmas = Object.fromEntries(words(pt, NOITE).map((t) => [t.text, t.lemma]));
    expect(lemmas).toMatchObject({ Uma: 'um', noite: 'noite', vindo: 'vir', cidade: 'cidade', encontrei: 'encontrar', rapaz: 'rapaz',
      bairro: 'bairro' });
    for (const w of ['Engenho', 'Novo', 'Central']) expect(tok(pt, NOITE, w).name).toBe(true);
  });

  it('keep a verb and the pronouns hyphened to it as one word', async () => {
    const pt = await loadLang('pt');
    const t = words(pt, 'Dá-me o livro, quero fazê-lo amanhã e dar-te-ei a casa.');
    expect(t.map((w) => w.text)).toEqual(['Dá-me', 'o', 'livro', 'quero', 'fazê-lo', 'amanhã', 'e', 'dar-te-ei', 'a', 'casa']);
    expect(t[0].key).toBe('dar');
    expect(t[4].key).toBe('fazer');
    expect(t[7].key).toBe('dar');
    expect(pt.lookup('fazê-lo').parts?.map((p) => p.text)).toEqual(['fazê', 'lo']);
    expect(tok(pt, 'sentou-se ao pé de mim', 'sentou-se').key).toBe('sentar');
  });
});

describe('Portuguese lookups', () => {
  it('give contractions and forms their meaning', async () => {
    const pt = await loadLang('pt');
    const hints = Object.fromEntries(words(pt, NOITE).map((t) => [t.text, pt.hint(t)]));
    expect(hints).toMatchObject({ da: 'of the, from the', no: 'in the', do: 'of the, from the', para: 'for' });
    // Wiktionary's head line says "first-person singular preterite"; the table adds "indicative".
    expect(pt.lookup('encontrei').form).toMatch(/^first-person singular preterite\b/);
    expect(pt.lookup('casas').entries[0].head).toBe('casa');
  });
});

describe('Portuguese keys, levels and hints', () => {
  it('level and hint the common words', async () => {
    const pt = await loadLang('pt');
    for (const k of ['ser', 'ter', 'de', 'não']) expect(pt.level(k)).toBe(1);
    const hints = Object.fromEntries(words(pt, 'Eu não tenho casa, mas ele quer ir ao mar.').map((t) => [t.text, pt.hint(t)]));
    expect(hints).toMatchObject({ Eu: 'I', não: 'not', tenho: 'to have', casa: 'house', mas: 'but', ir: 'to go' });
  });

  it('credit Wiktionary and the frequency list with their licenses', async () => {
    const pt = await loadLang('pt');
    expect(pt.meta.sources.map((s) => s.license)).toContain('CC BY-SA 4.0 (and GFDL)');
    expect(pt.meta.counts.entries).toBeGreaterThan(40000);
  });
});
