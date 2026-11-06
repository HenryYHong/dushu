// English, for Chinese speakers: the glosses and hints are Chinese (ECDICT, scripts/lang/en/build_en.py), and word levels
// follow the Chinese exam lists (levels.tsv.gz: 中考 高考 CET-4 CET-6 IELTS/TOEFL GRE). Contractions are words of their own
// (don't, I'm, it's: curated.tsv), a noun's 's is its possessive (a form in forms.tsv.gz), and the 'll 're 've 'd of a word the
// dictionary does not join them to are will, are, have and would.
import type { LangEngine } from '../types';
import { loadSpacedEngine, type LoadOpts, type SpacedLang } from './core';

export const ENGLISH: SpacedLang = {
  id: 'en',
  script: 'latin',
  // Alice's, Holmes's: a name's 's is the possessive, the dictionary's "'s" (written ʼs here so the lookup does not cut it
  // again: core.ts reads a value that starts with ' or ’ as another suffix).
  apostropheSuffixes: { s: 'ʼs', ll: 'will', re: 'are', ve: 'have', m: 'am', d: 'would' },
  beforeNoun: ['the', 'a', 'an', 'this', 'these', 'those', 'my', 'your', 'his', 'its', 'our', 'their', 'some', 'any', 'every',
    'each', 'no', 'many', 'much', 'few', 'several', 'both', 'either', 'neither', 'another', 'such', 'whose'],
  beforeVerb: ['i', 'you', 'he', 'she', 'we', 'they', 'not', "don't", "doesn't", "didn't", 'will', 'would', 'shall', 'should',
    'can', 'could', 'may', 'might', 'must', "can't", "couldn't", "won't", "wouldn't", "shouldn't", "mustn't"],
  auxiliaries: ['have', 'be'],
  prepositions: ['of', 'in', 'on', 'at', 'by', 'for', 'with', 'from', 'into', 'onto', 'upon', 'about', 'over', 'under', 'through',
    'between', 'among', 'against', 'without', 'within', 'during', 'before', 'after', 'toward', 'towards', 'across', 'behind',
    'beside', 'near'],
  coordinators: ['and', 'but', 'or', 'so', 'yet', 'nor'],
  // gave up the idea, looked after the children: the phrasal verb before a noun too.
  phrasesBeforeNoun: true,
  // to-day, to-morrow, sand-bank (Peter Rabbit, Jane Eyre): today, tomorrow, sandbank.
  joinHyphens: true,
  respell: (folded) => (/[-‐]/.test(folded) ? [folded.replace(/[-‐]/g, '')] : []),
  // Mr. Darcy, Lady Catherine, Aunt Polly: courtesy, not a name of its own.
  titles: ['mr.', 'mrs.', 'miss', 'sir', 'lady', 'lord', 'dr.', 'madam', 'master', 'captain', 'aunt', 'uncle', 'mr', 'mrs', 'dr'],
};

export function loadEngine(baseUrl: string, opts?: LoadOpts): Promise<LangEngine> {
  return loadSpacedEngine(ENGLISH, baseUrl, opts);
}
