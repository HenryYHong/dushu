// Italian on real sentences from Pinocchio (1883): elision, po', enclitics, forms, levels, hints.
import { describe, expect, it } from 'vitest';
import { expectCovers, fixture, loadLang, tok, words } from './load';

const LEGNO = 'Non era un legno di lusso, ma un semplice pezzo da catasta.';

describe('Italian tokens', () => {
  it('cover the paragraph exactly', async () => {
    const it_ = await loadLang('it');
    for (const p of (await fixture('it-pinocchio')).slice(0, 40)) expectCovers(it_.segment(p), p);
  });

  it('give every word its dictionary form', async () => {
    const it_ = await loadLang('it');
    expect(words(it_, LEGNO).map((t) => t.lemma)).toEqual(['non', 'essere', 'un', 'legno', 'di', 'lusso', 'ma', 'un', 'semplice',
      'pezzo', 'da', 'catasta']);
  });

  it("cut elided words off the next (un’occhiata, dell'anno), but keep po' whole", async () => {
    const it_ = await loadLang('it');
    const t = (s: string) => words(it_, s).map((w) => w.text);
    expect(t('per dare un’occhiata')).toEqual(['per', 'dare', 'un’', 'occhiata']);
    expect(tok(it_, 'per dare un’occhiata', 'un’').key).toBe('uno');
    expect(t("Voglio farlo dell'anno prossimo.")).toEqual(['Voglio', 'farlo', "dell'", 'anno', 'prossimo']);
    const po = tok(it_, "Dammi un po' di pane.", "po'");
    expect(po.key).toBe('poco');
    expect(it_.hint(po)).toBe('little');
  });
});

describe('Italian lookups', () => {
  it('join enclitic pronouns to the verb', async () => {
    const it_ = await loadLang('it');
    expect(it_.lookup('dimmi').key).toBe('dire');
    expect(it_.lookup('dimmi').parts?.map((p) => p.key)).toEqual(['dire', 'mi']);
    expect(it_.lookup('farlo').parts?.map((p) => [p.text, p.key])).toEqual([['far', 'fare'], ['lo', 'lo']]);
    expect(tok(it_, 'Dammi il pane e vattene.', 'vattene').lemma).toMatch(/^andar/);
  });

  it('explain forms, the commonest irregular ones included', async () => {
    const it_ = await loadLang('it');
    expect(it_.lookup('era').key).toBe('essere');
    expect(it_.lookup('era').form).toBe('third-person singular imperfect indicative');
    expect(it_.lookup('ho').key).toBe('avere');
    expect(it_.lookup('gran').key).toBe('grande');
  });
});

describe('Italian keys, levels and hints', () => {
  it('level and hint the common words', async () => {
    const it_ = await loadLang('it');
    for (const k of ['essere', 'avere', 'di', 'non']) expect(it_.level(k)).toBe(1);
    const hints = Object.fromEntries(words(it_, 'Il vecchio falegname aveva una casa e voleva fare un burattino.').map((t) => [t.text, it_.hint(t)]));
    expect(hints).toMatchObject({ Il: 'the', aveva: 'to have', casa: 'house', e: 'and', voleva: 'to want', fare: 'to do' });
  });

  it('credit Wiktionary and the frequency list with their licences', async () => {
    const it_ = await loadLang('it');
    expect(it_.meta.sources.map((s) => s.license)).toContain('CC BY-SA 4.0 (and GFDL)');
    expect(it_.meta.counts.entries).toBeGreaterThan(80000);
  });
});
