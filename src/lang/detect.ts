// Which language a book is in, roughly: enough to tell someone who drops an English or French book into the Spanish library,
// or a Chinese one into the Japanese library, where it belongs. Common little words decide the languages written with spaces.
import type { LangId } from './types';

/** The most frequent short words of each language (articles, prepositions, pronouns), few enough to be shared rarely. */
const STOPWORDS: Record<string, string[]> = {
  en: ['the', 'and', 'of', 'to', 'was', 'he', 'that', 'it', 'his', 'with', 'had', 'you', 'for', 'she', 'her', 'which', 'were', 'have'],
  es: ['el', 'la', 'que', 'de', 'y', 'los', 'del', 'las', 'por', 'con', 'una', 'su', 'para', 'como', 'pero', 'sus', 'más', 'muy'],
  fr: ['le', 'la', 'les', 'et', 'des', 'du', 'est', 'une', 'il', 'qui', 'dans', 'pas', 'au', 'avec', 'ce', 'sur', 'elle', 'mais'],
  de: ['der', 'die', 'und', 'das', 'nicht', 'ist', 'ich', 'sie', 'zu', 'den', 'mit', 'sich', 'des', 'auf', 'ein', 'dem', 'auch', 'aber'],
  it: ['il', 'di', 'che', 'la', 'e', 'non', 'per', 'un', 'una', 'del', 'della', 'con', 'si', 'gli', 'le', 'era', 'ma', 'anche'],
  pt: ['o', 'a', 'que', 'de', 'e', 'do', 'da', 'não', 'em', 'um', 'uma', 'os', 'as', 'com', 'para', 'se', 'mais', 'ao'],
};

const NAMES: Record<string, string> = { en: 'English', zh: 'Chinese', ja: 'Japanese', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', pt: 'Portuguese', ru: 'Russian' };

/** The language a sample of text is most likely in, from its script and its common words; null when it cannot tell. */
export function guessLanguage(sample: string): string | null {
  const text = sample.slice(0, 40000);
  let han = 0, kana = 0, cyr = 0, latin = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0x3040 && cp <= 0x30ff) kana++;
    else if ((cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf)) han++;
    else if (cp >= 0x0400 && cp <= 0x04ff) cyr++;
    else if (/\p{Script=Latin}/u.test(ch)) latin++;
  }
  const total = han + kana + cyr + latin;
  if (total < 40) return null;
  if (kana > total * 0.08) return 'ja';
  if (han > total * 0.5) return 'zh';
  if (cyr > total * 0.5) return 'ru';
  if (latin < total * 0.5) return null;
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  if (words.length < 30) return null;
  const counts = new Map<string, number>();
  for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
  let best: string | null = null;
  let bestScore = 0;
  let second = 0;
  for (const [id, list] of Object.entries(STOPWORDS)) {
    const score = list.reduce((n, w) => n + (counts.get(w) ?? 0), 0) / words.length;
    if (score > bestScore) { second = bestScore; bestScore = score; best = id; } else if (score > second) second = score;
  }
  // Only a clear winner: a page of Spanish shares "la", "de", "que" with Italian and Portuguese.
  return bestScore > 0.08 && bestScore > second * 1.4 ? best : null;
}

/**
 * The message for a book that is plainly in another language than the library it is being added to, or null when it fits
 * (or it cannot tell). `here` is the library's language.
 */
export function wrongLanguage(sample: string, here: LangId): string | null {
  const found = guessLanguage(sample);
  if (!found || found === here) return null;
  const name = NAMES[found] ?? found;
  if (found === 'en') return `This book looks like it is in English. Dushu reads books in the language you are learning; this library is ${NAMES[here]}.`;
  return `This book looks like it is in ${name}, and this library is ${NAMES[here]}. Switch to ${name} (in Settings, or the language menu at the top) and add it there.`;
}
