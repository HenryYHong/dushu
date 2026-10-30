// The hook a language's own context rules plug into (SpacedLang.context, src/lang/spaced/context.ts): what a rule is shown
// of the sentence, and how its answer moves a word. The rules here are made up for the tests; the languages' real ones are
// written in their modules.
import { describe, expect, it } from 'vitest';
import { CONTEXT_MARGIN, isFiniteVerb, type ContextQuery, type ContextRule } from '../../../src/lang/spaced/context';
import { FRENCH } from '../../../src/lang/spaced/fr';
import { GERMAN } from '../../../src/lang/spaced/de';
import { RUSSIAN } from '../../../src/lang/spaced/ru';
import { SPANISH } from '../../../src/lang/spaced/es';
import { loadCustom, loadLang, lookupIn, tok } from './load';

// Perrault, La Belle au bois dormant.
const PERRAULT = 'Le rang de la vieille fée étant venu, elle dit, en branlant la tête encore plus de dépit que de vieillesse, que la princesse se percerait la main d’un fuseau, et qu’elle en mourrait.';

/** The rule of context.ts's own example: en after a subject or elided pronoun, or before a finite verb, is "of it". */
const enRule: ContextRule = (q) => {
  if (q.word.low !== 'en') return null;
  const p = q.prev?.low ?? '';
  if (["s'", "n'", "j'", "m'", "t'", 'il', 'elle', 'on', 'ils', 'elles'].includes(p)
    || (q.next && q.next.readings.length && isFiniteVerb(q.next.readings[0]))) {
    return { prefer: (r) => r.pos === 'pronoun', margin: Infinity };
  }
  return null;
};

describe('a language context rule', () => {
  it('chooses among a word’s readings: "et qu’elle en mourrait" is en "of it", not "in"', async () => {
    const plain = await loadLang('fr');
    expect(plain.hint(tok(plain, PERRAULT, 'en', 1))).toBe('in');
    const eng = await loadCustom({ ...FRENCH, context: enRule });
    expect(eng.hint(tok(eng, PERRAULT, 'en', 1))).toBe('of it, some');
    expect(lookupIn(eng, PERRAULT, 'en', 1).entries[0].senses[0].pos).toBe('pronoun');
    // The preposition before a gerund is left to the generic rules: "en branlant la tête".
    expect(eng.hint(tok(eng, PERRAULT, 'en', 0))).toBe('in');
  });

  it('sees the sentence: its words, the marks around the word, its start, and whether it asks', async () => {
    const seen: ContextQuery[] = [];
    // What the words before and after were read as when the rule was asked (the view fills in as the sentence is read).
    const chosenThen = new Map<string, (string | undefined)[]>();
    const eng = await loadCustom({ ...RUSSIAN, context: (q) => { seen.push(q); chosenThen.set(q.word.text, q.words.map((w) => w.chosen?.key)); return null; } });
    // Белые ночи: "— Да, вы наймите у нас."
    eng.segment('— Да, вы наймите у нас.');
    const da = seen.find((q) => q.word.text === 'Да')!;
    expect(da.sentenceStart).toBe(true);
    expect(da.word.before).toBe('—');
    expect(da.word.after).toBe(',');
    expect(da.next).toBeUndefined();
    expect(da.words.map((w) => w.text)).toEqual(['Да', 'вы', 'наймите', 'у', 'нас']);
    expect(da.question).toBe(false);
    // The words before the one asked about are read already.
    expect(chosenThen.get('вы')).toEqual(['да', undefined, undefined, undefined, undefined]);

    seen.length = 0;
    const fr = await loadCustom({ ...FRENCH, context: (q) => { seen.push(q); return null; } });
    // Perrault, La Belle au bois dormant: « Que faites-vous là, ma bonne femme ? »
    fr.segment('« Que faites-vous là, ma bonne femme ? » dit la princesse.');
    expect(seen.find((q) => q.word.text === 'Que')!.question).toBe(true);
    expect(seen.find((q) => q.word.text === 'Que')!.sentenceStart).toBe(true);
  });

  it('can say "yes" for да before a comma, where the generic rules keep the conjunction', async () => {
    const plain = await loadLang('ru');
    expect(plain.hint(tok(plain, '— Да, вы наймите у нас.', 'Да'))).toBe('but');
    const eng = await loadCustom({
      ...RUSSIAN,
      context: (q) => (q.word.low === 'да' && /^[,!]/.test(q.word.after) ? { prefer: (r) => r.hint === 'yes', margin: Infinity } : null),
    });
    expect(eng.hint(tok(eng, '— Да, вы наймите у нас.', 'Да'))).toBe('yes');
    // Tolstoy's "да не нашла" (Три медведя) is left alone: no comma after it.
    expect(eng.hint(tok(eng, 'В лесу она заблудилась и стала искать дорогу домой, да не нашла, а пришла в лесу к домику.', 'да'))).toBe('but');
  });

  it('decides whether a verb is reflexive: "Er erinnerte sich" remembered, not reminded', async () => {
    // Die Verwandlung. German puts sich after the verb, where the generic rule does not look.
    const text = 'Er erinnerte sich, schon öfters im Bett irgendeinen vielleicht durch ungeschicktes Liegen erzeugten, leichten Schmerz empfunden zu haben.';
    const plain = await loadLang('de');
    expect(plain.hint(tok(plain, text, 'erinnerte'))).toBe('to remind');
    const eng = await loadCustom({
      ...GERMAN,
      context: (q) => (q.word.readings[0]?.pos === 'verb' && q.next?.low === 'sich' ? { prefer: () => true, margin: 0, reflexive: true } : null),
    });
    expect(eng.hint(tok(eng, text, 'erinnerte'))).toBe('to remember');
    expect(lookupIn(eng, text, 'erinnerte').entries[0].senses[0].glosses[0]).toMatch(/remember/);
  });

  it('stops the generic rules with an answer that prefers every reading', async () => {
    // Quiroga, La tortuga gigante: "volvió esa tarde" is the afternoon by the generic rules (after esa).
    const text = 'Y como él lo había dicho, la fiebre volvió esa tarde, más fuerte que antes, y perdió de nuevo el conocimiento.';
    const plain = await loadLang('es');
    expect(plain.hint(tok(plain, text, 'tarde'))).toBe('afternoon');
    const eng = await loadCustom({ ...SPANISH, context: (q) => (q.word.low === 'tarde' ? { prefer: () => true, margin: CONTEXT_MARGIN } : null) });
    expect(eng.hint(tok(eng, text, 'tarde'))).toBe('late');
  });
});
