import { tt, ttm } from '../i18n';

/**
 * Wiktionary's parts of speech as a card labels its senses: in the app's language (src/i18n). The dictionaries name them in
 * English ("noun"); a card shows them as the reader's interface does ("sustantivo"). One the list lacks shows as the data has it.
 */
const POS_LABELS: Record<string, string> = {
  noun: ttm('noun'), 'proper noun': ttm('proper noun'), verb: ttm('verb'), adjective: ttm('adjective'), adverb: ttm('adverb'),
  pronoun: ttm('pronoun'), determiner: ttm('determiner'), article: ttm('article'), numeral: ttm('numeral'), preposition: ttm('preposition'),
  postposition: ttm('postposition'), conjunction: ttm('conjunction'), interjection: ttm('interjection'), particle: ttm('particle'),
  contraction: ttm('contraction'), phrase: ttm('phrase'),
};

export const posLabel = (pos: string): string => (Object.hasOwn(POS_LABELS, pos) ? tt(POS_LABELS[pos]) : pos);
