// Questions about tokens that hold for every language.
import type { Token } from '../types';
import { hasHan } from '../core/text';
import { isChinese } from './active';

/** A word that can be looked up: a Chinese word ('han') or a word of another language ('word'). */
export const isWord = (t: Pick<Token, 'kind'>): boolean => t.kind === 'han' || t.kind === 'word';

/** Whether a selection has something to look up: Han characters for Chinese, letters of any script for another language. */
export function hasWordText(s: string): boolean {
  return isChinese() ? hasHan(s) : /\p{L}/u.test(s);
}
