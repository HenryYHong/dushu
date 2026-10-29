// The hint over a word is read at a glance, so the 400 commonest words of every spaced language must have one that is a
// short plain English gloss: not a description of the word ("Generic demonstrative pronoun"), not its grammar
// ("third-person singular", "form of"), not cut in the middle, not a capitalized sentence.
import { describe, expect, it } from 'vitest';
import type { Token } from '../../../src/types';
import { loadLang, words } from './load';

const IDS = ['es', 'fr', 'de', 'it', 'pt', 'ru'] as const;

const DESCRIPTION = /^(?:Used|Indicates|Generic|Refers|Optional|Expresses|Emphasi[sz]es|Denotes|Marks|Intensifies|Introduces|A verbal|An? [a-z]+ particle)\b/i;
const GRAMMAR = /\b(?:first|second|third)-person\b|\bform of\b|\b(?:singular|plural|nominative|genitive|dative|accusative|instrumental|prepositional)\b/i;

/** What is wrong with a hint, or '' when it reads as a short plain gloss. */
function hintProblem(hint: string | undefined): string {
  if (!hint) return 'no hint';
  for (const part of hint.split('|')) {
    if (part.length > 40) return 'long';
    if (DESCRIPTION.test(part)) return 'description';
    if (GRAMMAR.test(part)) return 'grammar';
    // Mr, Earth, God are English written so; a capitalized phrase is a sentence about the word.
    if (/^[A-ZÀ-ÝА-Я]/.test(part) && part.split(' ').length > 2) return 'capitalized';
    if (part.split(/[,;]\s*/).some((piece) => piece.split(' ').length > 4)) return 'wordy';
    for (const [a, b] of [['(', ')'], ['“', '”'], ['[', ']']]) if (part.split(a).length !== part.split(b).length) return 'unbalanced';
    if ((part.match(/"/g) ?? []).length % 2) return 'unbalanced';
  }
  return '';
}

describe.each(IDS)('%s hints of the 400 commonest words', (id) => {
  it('are short plain glosses', async () => {
    const eng = await loadLang(id);
    const keys = eng.levelWords(1).slice(0, 400);
    expect(keys.length).toBe(400);
    const bad: string[] = [];
    for (const key of keys) {
      // A key the tokenizer would cut alone (l' needs a word after it) is asked about as one token.
      const first = words(eng, key)[0];
      const t: Token = first?.text === key ? first : { text: key, start: 0, end: key.length, kind: 'word', inDict: true };
      const h = eng.hint(t);
      const problem = t?.name ? '' : hintProblem(h);
      if (problem) bad.push(`${key}: ${problem}: ${h ?? ''}`);
    }
    expect(bad).toEqual([]);
  }, 60000);
});

describe('hintProblem', () => {
  it('passes plain glosses and catches the kinds of junk Wiktionary glosses turn into', () => {
    for (const h of ['house', 'to go', 'there is, there are', 'I', 'to have to, must', 'to remember|to agree']) expect(hintProblem(h), h).toBe('');
    expect(hintProblem('Generic demonstrative pronoun. Translate')).toBe('description');
    expect(hintProblem('Used to link an interrogative clause')).toBe('description');
    expect(hintProblem('second-person singular')).toBe('grammar');
    expect(hintProblem('nominative/accusative neuter singular of')).toBe('grammar');
    expect(hintProblem('Refers to a neuter')).toBe('description');
    expect(hintProblem('some”)')).toBe('unbalanced');
    expect(hintProblem(undefined)).toBe('no hint');
  });
});
