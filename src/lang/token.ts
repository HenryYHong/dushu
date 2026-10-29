// Questions about tokens that hold for every language.
import type { Token } from '../types';

/** A word that can be looked up: a Chinese word ('han') or a word of another language ('word'). */
export const isWord = (t: Pick<Token, 'kind'>): boolean => t.kind === 'han' || t.kind === 'word';
