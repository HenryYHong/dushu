// English for Chinese speakers (src/lang/spaced/en.ts, data from scripts/lang/en/build_en.py): Chinese hints and cards, the
// forms of a word found under its dictionary form, contractions and possessives, phrasal verbs, and exam levels.
import { describe, expect, it } from 'vitest';
import { loadLang, lookupIn, tok, words } from './load';

const ALICE = 'Alice was beginning to get very tired of sitting by her sister on the bank, and of having nothing to do.';
const DARCY = '“I don’t know what you’re talking about,” said Mr. Darcy, and he went away.';
const POSSESSIVE = 'The children’s books were on the table, and Holmes’s pipe lay beside them.';
const GAVE_UP = 'She gave up the idea at once, because of the rain.';

describe('English', () => {
  it('finds every form under its dictionary form, with Chinese hints', async () => {
    const en = await loadLang('en');
    const keys = words(en, ALICE).map((t) => t.key);
    expect(keys).toEqual(['alice', 'be', 'begin', 'to', 'get', 'very', 'tired', 'of', 'sit', 'by', 'her', 'sister', 'on', 'the', 'bank', 'and', 'of', 'have', 'nothing', 'to', 'do']);
    expect(en.hint(tok(en, ALICE, 'sister'))).toBe('姐妹');
    expect(lookupIn(en, ALICE, 'beginning').form).toBe('present participle');
    expect(lookupIn(en, DARCY, 'went').entries.some((e) => e.head === 'go')).toBe(true);
  });

  it('reads contractions as words, and be in all its forms', async () => {
    const en = await loadLang('en');
    expect(tok(en, DARCY, 'don’t').key).toBe("don't");
    expect(en.hint(tok(en, DARCY, 'don’t'))).toBe('不要');
    expect(tok(en, DARCY, '’re').key).toBe('be');
    expect(tok(en, POSSESSIVE, 'were').key).toBe('be');
    expect(tok(en, DARCY, 'I').name).toBeFalsy();
  });

  it('reads a possessive as its noun, and a name’s as the name', async () => {
    const en = await loadLang('en');
    expect(tok(en, POSSESSIVE, 'children’s').key).toBe('child');
    expect(lookupIn(en, POSSESSIVE, 'children’s').form).toBe('plural possessive');
    expect(tok(en, POSSESSIVE, 'Holmes’s').key).toBe('holmes');
  });

  it('takes a phrasal verb before a noun, and fixed phrases', async () => {
    const en = await loadLang('en');
    expect(en.hint(tok(en, GAVE_UP, 'gave'))).toBe('放弃');
    expect(lookupIn(en, GAVE_UP, 'gave').phrase).toBe('give up');
    expect(en.hint(tok(en, GAVE_UP, 'once'))).toBe('立刻');
    // be + particle is not a phrasal verb: "must be in want of a wife" (Pride and Prejudice) is no 到达.
    const austen = 'It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.';
    expect(en.hint(tok(en, austen, 'be'))).toBe('是');
  });

  it('has the Chinese exam levels', async () => {
    const en = await loadLang('en');
    expect(en.level('apple')).toBe(1);
    expect(en.level('possession')).toBe(2);
    expect(en.levelWords(1).length).toBeGreaterThan(1000);
    expect(en.levelWords(1).slice(0, 3)).toEqual(['the', 'be', 'and']);
  });
});

describe('English in older books', () => {
  const PETER = 'Once upon a time there were four little Rabbits. They lived with their Mother in a sand-bank, underneath the root of a very big fir-tree.';
  it('reads "once upon a time" as one phrase and a hyphened old spelling as the word', async () => {
    const en = await loadLang('en');
    expect(en.hint(tok(en, PETER, 'Once'))).toBe('从前');
    expect(tok(en, PETER, 'sand-bank').key).toBe('sandbank');
    expect(tok(en, 'I will come to-morrow.', 'to-morrow').key).toBe('tomorrow');
  });
});
