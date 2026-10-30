// Russian on real sentences from Kashtanka (1887): lemmas, stress, ё, hyphened particles, names, levels, hints.
import { describe, expect, it } from 'vitest';
import { expectCovers, fixture, loadLang, tok, words } from './load';

const KASHTANKA = 'Молодая рыжая собака — помесь такса с дворняжкой — очень похожая мордой на лисицу, бегала взад и вперёд по тротуару.';

/** The word with its stressed vowel marked, as the reader shows it. */
const stressed = (text: string, at: number | undefined): string => (at === undefined ? text : text.slice(0, at + 1) + '́' + text.slice(at + 1));

describe('Russian tokens', () => {
  it('cover the paragraph exactly', async () => {
    const ru = await loadLang('ru');
    for (const p of (await fixture('ru-kashtanka')).slice(0, 40)) expectCovers(ru.segment(p), p);
    expectCovers(ru.segment(KASHTANKA), KASHTANKA);
  });

  it('give every word its dictionary form', async () => {
    const ru = await loadLang('ru');
    expect(words(ru, KASHTANKA).map((t) => t.lemma)).toEqual(['молодой', 'рыжий', 'собака', 'помесь', 'такса', 'с', 'дворняжка',
      'очень', 'похожий', 'морда', 'на', 'лисица', 'бегать', 'взад', 'и', 'вперёд', 'по', 'тротуар']);
  });

  it('mark the stressed vowel of a word of two syllables or more', async () => {
    const ru = await loadLang('ru');
    const marked = Object.fromEntries(words(ru, KASHTANKA).map((t) => [t.text, stressed(t.text, t.stress)]));
    expect(marked).toMatchObject({ Молодая: 'Молода́я', собака: 'соба́ка', бегала: 'бе́гала', лисицу: 'лиси́цу', тротуару: 'тротуа́ру' });
    // ё is always stressed and already says so; a one-vowel word needs no mark.
    expect(tok(ru, KASHTANKA, 'вперёд').stress).toBeUndefined();
    expect(tok(ru, KASHTANKA, 'с').stress).toBeUndefined();
  });

  it('keep particles hyphened to a word with it', async () => {
    const ru = await loadLang('ru');
    const t = words(ru, 'Скажи-ка, кто-то пришёл?');
    expect(t.map((w) => w.text)).toEqual(['Скажи-ка', 'кто-то', 'пришёл']);
    expect(t[0].key).toBe('сказать');
    expect(t[1].key).toBe('кто-то');
    expect(t[2].lemma).toBe('прийти');
  });

  it('take capitalized unknown words in mid-sentence as names', async () => {
    const ru = await loadLang('ru');
    const s = 'День начался с того, что её хозяин, столяр Лука Александрыч, надел шапку.';
    expect(tok(ru, s, 'Лука').name).toBe(true);
    expect(tok(ru, s, 'Александрыч').name).toBe(true);
    expect(tok(ru, s, 'надел').lemma).toBe('надеть');
  });
});

describe('Russian lookups', () => {
  it('read е for ё and explain forms, with the stressed headword', async () => {
    const ru = await loadLang('ru');
    expect(ru.lookup('вперед').key).toBe(ru.lookup('вперёд').key);
    const said = ru.lookup('сказала');
    expect(said.key).toBe('сказать');
    expect(said.form).toBe('feminine singular past');
    expect(said.entries[0].reading).toBe('сказа́ть');
    expect(ru.lookup('лисицу').form).toBe('accusative singular');
    expect(ru.lookup('лисицу').entries[0].gender).toBe('f');
  });
});

describe('Russian keys, levels and hints', () => {
  it('level and hint the common words, prepositions included', async () => {
    const ru = await loadLang('ru');
    for (const k of ['я', 'быть', 'не', 'в']) expect(ru.level(k)).toBe(1);
    const hints = Object.fromEntries(words(ru, 'Это собака, она бегала с ним в доме.').map((t) => [t.text, ru.hint(t)]));
    expect(hints).toMatchObject({ собака: 'dog', бегала: 'to run', с: 'with, from', в: 'in, into' });
    expect(hints['Это']).toMatch(/^this/);
  });

  it('credit Wiktionary and the frequency list with their licenses', async () => {
    const ru = await loadLang('ru');
    expect(ru.meta.sources.map((s) => s.license)).toContain('CC BY-SA 4.0 (and GFDL)');
    expect(ru.meta.counts.entries).toBeGreaterThan(40000);
  });
});
