// Fixed phrases (phrases.tsv.gz, optional): words that spell one together take its hint, and a lookup of any of them shows
// the phrase first. The builder writes the file; until it does, these tests give the engine a small one of their own.
import { describe, expect, it } from 'vitest';
import { SPANISH } from '../../../src/lang/spaced/es';
import { FRENCH } from '../../../src/lang/spaced/fr';
import { RUSSIAN } from '../../../src/lang/spaced/ru';
import { loadCustom, lookupIn, tok } from './load';

const ES = ['# words\thint\tsenses', 'sin embargo\thowever\tnevertheless|however', 'a pesar de\tdespite\tdespite|in spite of',
  'de pronto\tsuddenly\tsuddenly|all of a sudden', 'en seguida\tat once\tat once|immediately'].join('\n');
const FR = ['tout à fait\tquite\tquite|entirely', 'parce que\tbecause\tbecause', "c' est à dire\tthat is\tthat is (to say)"].join('\n');
const RU = ['потому что\tbecause\tbecause', 'то есть\tthat is\tthat is, i.e.', 'до сих пор\tuntil now\tuntil now|still'].join('\n');

describe('fixed phrases', () => {
  it('give their hint to each of their words: "Y sin embargo estaba ya en Buenos Aires"', async () => {
    const eng = await loadCustom(SPANISH, { 'phrases.tsv.gz': ES });
    // Quiroga, La tortuga gigante.
    const text = 'Y sin embargo estaba ya en Buenos Aires, y ella no lo sabía.';
    expect(eng.hint(tok(eng, text, 'sin'))).toBe('however');
    expect(eng.hint(tok(eng, text, 'embargo'))).toBe('however');
    // The words around it keep their own.
    expect(eng.hint(tok(eng, text, 'estaba'))).toBe('to be');
  });

  it('lead the card of any of their words, which keeps its own key', async () => {
    const eng = await loadCustom(SPANISH, { 'phrases.tsv.gz': ES });
    const look = lookupIn(eng, 'Y sin embargo estaba ya en Buenos Aires, y ella no lo sabía.', 'embargo');
    expect(look.phrase).toBe('sin embargo');
    expect(look.entries[0].head).toBe('sin embargo');
    expect(look.entries[0].senses[0].glosses).toEqual(['nevertheless', 'however']);
    expect(look.form).toBe('part');
    expect(look.key).toBe('embargo');
    // The word's own entry still follows.
    expect(look.entries.some((e) => e.head === 'embargo')).toBe(true);
  });

  it('match a contraction at their end and an elided word: "A pesar del hambre", "parce qu’il"', async () => {
    const es = await loadCustom(SPANISH, { 'phrases.tsv.gz': ES });
    // Quiroga, La tortuga gigante.
    const text = 'A pesar del hambre que sentía, el hombre tuvo lástima de la pobre tortuga, y la llevó arrastrando con una soga hasta su ramada.';
    expect(['A', 'pesar', 'del'].map((w) => es.hint(tok(es, text, w)))).toEqual(['despite', 'despite', 'despite']);
    expect(es.hint(tok(es, text, 'hambre'))).toBe('hunger');

    const fr = await loadCustom(FRENCH, { 'phrases.tsv.gz': FR });
    // Perrault, La Belle au bois dormant.
    const fee = 'Mais, comme chacun prenait place à table, on vit entrer une vieille fée, qu’on n’avait point priée, parce qu’il y avait plus de cinquante ans qu’elle n’était sortie d’une tour.';
    expect(fr.hint(tok(fr, fee, 'parce'))).toBe('because');
    expect(fr.hint(tok(fr, fee, 'qu’', 1))).toBe('because');
    expect(fr.hint(tok(fr, fee, 'qu’', 2))).toBe('that');
    // Perrault, La Barbe bleue: "il n’y avait pas moyen de la nettoyer tout à fait".
    const clef = 'Il demeura toujours du sang, car la clef était fée, et il n’y avait pas moyen de la nettoyer tout à fait : quand on ôtait le sang d’un côté, il revenait de l’autre.';
    expect(['tout', 'à', 'fait'].map((w) => fr.hint(tok(fr, clef, w)))).toEqual(['quite', 'quite', 'quite']);
    // Hyphens join a phrase's words as the tokenizer cuts them, c' est à dire (Candide).
    const cad = 'Ils rencontrèrent un nègre étendu par terre, n’ayant plus que la moitié de son habit, c’est-à-dire d’un caleçon de toile bleue.';
    expect(['c’', 'est', 'à', 'dire'].map((w) => fr.hint(tok(fr, cad, w)))).toEqual(['that is', 'that is', 'that is', 'that is']);
  });

  it('take the longest that fits and never reach across a comma: потому что, то есть, до сих пор', async () => {
    const eng = await loadCustom(RUSSIAN, { 'phrases.tsv.gz': RU });
    // Белые ночи.
    const text = 'Мне вдруг показалось, что меня, одинокого, все покидают и что все от меня отступаются. Оно, конечно, всякий вправе спросить: кто ж эти все? потому что вот уже восемь лет, как я живу в Петербурге, и почти ни одного знакомства не умел завести.';
    expect(eng.hint(tok(eng, text, 'потому'))).toBe('because');
    expect(eng.hint(tok(eng, text, 'что', 2))).toBe('because');
    // The что of "показалось, что меня" stays "that".
    expect(eng.hint(tok(eng, text, 'что', 0))).not.toBe('because');
    // Каштанка.
    const k = 'Он заставлял её ходить на задних лапах, изображал из неё колокол, то есть сильно дёргал её за хвост, отчего она визжала и лаяла.';
    expect(eng.hint(tok(eng, k, 'то'))).toBe('that is');
    expect(eng.hint(tok(eng, k, 'есть'))).toBe('that is');
    // Белые ночи: "так что паутина еще до сих пор благополучно висит на месте".
    const p = 'Но она только посмотрела на меня в удивлении и пошла прочь, не ответив ни слова, так что паутина еще до сих пор благополучно висит на месте.';
    expect(['до', 'сих', 'пор'].map((w) => eng.hint(tok(eng, p, w)))).toEqual(['until now', 'until now', 'until now']);
  });

  it('are optional: without the file, words read one by one', async () => {
    const eng = await loadCustom(SPANISH, { 'phrases.tsv.gz': '' });
    expect(eng.hint(tok(eng, 'Y sin embargo estaba ya en Buenos Aires, y ella no lo sabía.', 'embargo'))).not.toBe('however');
  });
});
