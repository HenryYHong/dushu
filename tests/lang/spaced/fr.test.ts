// French on real sentences from Les Misérables (1862): elision, hyphens, forms, names, context, levels, hints.
import { describe, expect, it } from 'vitest';
import { expectCovers, fixture, loadLang, lookupIn, tok, words } from './load';

const MYRIEL = "En 1815, M. Charles-François-Bienvenu Myriel était évêque de Digne. C'était un vieillard d'environ soixante-quinze ans; il occupait le siège de Digne depuis 1806.";

describe('French tokens', () => {
  it('cover the paragraph exactly', async () => {
    const fr = await loadLang('fr');
    for (const p of (await fixture('fr-miserables')).slice(0, 40)) expectCovers(fr.segment(p), p);
    expectCovers(fr.segment(MYRIEL), MYRIEL);
  });

  it("cut elided words off the word they lean on (l'homme, qu'il), but keep words of their own whole (aujourd'hui, jusqu'à)", async () => {
    const fr = await loadLang('fr');
    const t = (s: string) => words(fr, s).map((w) => w.text);
    expect(t("l'homme qu'il voit")).toEqual(["l'", 'homme', "qu'", 'il', 'voit']);
    // jusqu'à is a preposition of its own in Wiktionary ("until"), so it reads as one word.
    expect(t("C'était jusqu'à aujourd'hui")).toEqual(["C'", 'était', "jusqu'à", "aujourd'hui"]);
    expect(t('Il n’est pas venu')).toEqual(['Il', 'n’', 'est', 'pas', 'venu']);
    expect(tok(fr, "qu'on dit", "qu'").key).toBe("qu'");
  });

  it('keep a verb and the pronouns hyphened to it as one word', async () => {
    const fr = await loadLang('fr');
    const t = words(fr, 'Est-ce vrai? a-t-il dit, et peut-être donne-moi la main.');
    expect(t.map((w) => w.text)).toEqual(['Est-ce', 'vrai', 'a-t-il', 'dit', 'et', 'peut-être', 'donne-moi', 'la', 'main']);
    expect(t[0].lemma).toBe('être');
    expect(fr.lookup('a-t-il').parts?.map((p) => p.text)).toEqual(['a', 't', 'il']);
    expect(fr.lookup('a-t-il').key).toBe('avoir');
    expect(t.find((w) => w.text === 'donne-moi')!.key).toBe('donner');
    expect(t.find((w) => w.text === 'peut-être')!.key).toBe('peut-être');
  });

  it('take an abbreviation with its period, and names as names', async () => {
    const fr = await loadLang('fr');
    const t = words(fr, MYRIEL);
    expect(t[1].text).toBe('M.');
    expect(t[1].key).toBe('monsieur');
    expect(t.find((w) => w.text === 'Myriel')!.name).toBe(true);
    expect(t.filter((w) => w.text === 'Digne').every((w) => w.name)).toBe(true);
    expect(fr.hint(t.find((w) => w.text === 'Digne')!)).toBeUndefined();
  });
});

describe('French lookups', () => {
  it('read est as être, not east, unless nothing else fits', async () => {
    const fr = await loadLang('fr');
    const est = fr.lookup('est');
    expect(est.entries[0].head).toBe('être');
    expect(est.form).toBe('third-person singular present indicative');
    expect(est.entries.map((e) => e.head)).toContain('est');
    expect(tok(fr, 'Quel est ce bonhomme qui me regarde?', 'est').key).toBe('être');
  });

  it('explain forms, the agreeing participles included', async () => {
    const fr = await loadLang('fr');
    expect(fr.lookup('fûmes').form).toBe('first-person plural past historic indicative');
    expect(fr.lookup('terminée').key).toBe('terminer');
    expect(fr.lookup('terminée').form).toBe('feminine singular past participle');
    expect(fr.lookup('délivrés').key).toBe('délivrer');
    expect(fr.lookup('chevaux').entries[0].head).toBe('cheval');
    expect(fr.lookup('chevaux').form).toBe('plural');
    expect(fr.lookup('maison').entries[0].gender).toBe('f');
  });

  it("tell l' the article from l' the pronoun, and du from du", async () => {
    const fr = await loadLang('fr');
    expect(fr.hint(tok(fr, "l'homme", "l'"))).toBe('the');
    expect(fr.hint(tok(fr, "je l'ai vu", "l'"))).toMatch(/him/);
    expect(fr.hint(tok(fr, "à l'époque du couronnement", 'du'))).toBe('of the');
    expect(fr.lookup("l'homme").entries[0].head).toBe('homme');
    expect(fr.lookup("l'homme").parts?.map((p) => p.text)).toEqual(["l'", 'homme']);
  });

  it('read point and personne after ne as the negation (La Belle au bois dormant, 1697)', async () => {
    const fr = await loadLang('fr');
    const s = 'Il était une fois un roi et une reine qui étaient si fâchés de n’avoir point d’enfants, si fâchés qu’on ne saurait dire.';
    expect(tok(fr, s, 'point').key).toBe('point');
    expect(fr.hint(tok(fr, s, 'point'))).toBe('not');
    expect(fr.hint(tok(fr, 'Je ne vois personne.', 'personne'))).not.toBe('person');
    // Without ne, point is the noun.
    expect(fr.hint(tok(fr, 'Le point est clair.', 'point'))).not.toBe('not');
  });

  it('read beau after a determiner as the adjective, not the adverb of avoir beau', async () => {
    const fr = await loadLang('fr');
    const s = 'Enfin, pourtant il leur naquit une fille. On fit un beau baptême ; on donna pour marraine à la petite princesse toutes les fées.';
    expect(fr.hint(tok(fr, s, 'beau'))).not.toBe('in vain');
    expect(fr.lookup('beau', { token: tok(fr, s, 'beau'), sentence: s }).entries[0].senses[0].pos).toBe('adjective');
    expect(fr.lookup('dormant').form).toBe('present participle');
  });

  it('read a past participle after avoir or être', async () => {
    const fr = await loadLang('fr');
    expect(tok(fr, 'Il est mort hier.', 'mort').key).toBe('mourir');
    expect(lookupIn(fr, 'Il est arrivé dans le diocèse.', 'arrivé').form).toBe('past participle');
  });
});

describe('French keys, levels and hints', () => {
  it('normalize, level and hint the common words', async () => {
    const fr = await loadLang('fr');
    expect(fr.normalize('étaient')).toBe('être');
    expect(fr.normalize('Yeux')).toBe('œil');
    expect(fr.level('être')).toBe(1);
    expect(fr.level('évêque')!).toBeGreaterThanOrEqual(4);
    const hints = Object.fromEntries(words(fr, "Le vieil homme partit sans rien dire à sa fille.").map((t) => [t.text, fr.hint(t)]));
    expect(hints).toMatchObject({ Le: 'the', homme: 'man', partit: expect.stringMatching(/^to (?:leave|go away)$/), sans: 'without', dire: 'to say', fille: 'girl' });
  });

  it('match oe typed for œ', async () => {
    const fr = await loadLang('fr');
    expect(fr.lookup('oeuvres').entries[0].head).toBe('œuvre');
  });
});
