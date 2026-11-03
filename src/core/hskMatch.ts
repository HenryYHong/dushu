// Whether the reading on screen is a reading the HSK list gives a word, and the 道 "said" rule of the HSK chip. Pure: the
// dictionary's hsk(word, pinyin) and the word card use it, and the tests check it without the data. ARCHITECTURE.md §4.1.

/** A numbered syllable ("hao3", "lü4", "r5") as letters and tone; a missing tone is neutral. */
function syllable(s: string): { base: string; tone: string } | null {
  const m = /^([a-zü:]+?)([1-5]?)$/.exec(s.toLowerCase().replace(/u:|v/g, 'ü'));
  return m ? { base: m[1], tone: m[2] || '5' } : null;
}

/**
 * Does `shown` (the reading on screen) say what `list` (a reading the HSK list gives `word`) says? Numbered pinyin, one
 * syllable per character.
 * - 'same': every syllable has the same letters and tone. 一 and 不 match in any tone, since their tone changes with the
 *   next syllable (不客气 bú kèqi is the list's bù kèqi).
 * - 'neutral': the same letters, and only neutral tones differ (北边 běibiān and the list's běibian).
 * - null: another reading, or another number of syllables.
 */
export function compareReading(list: readonly string[], shown: readonly string[], word: string): 'same' | 'neutral' | null {
  if (!list.length || list.length !== shown.length) return null;
  const chars = [...word];
  const aligned = chars.length === list.length;
  let kind: 'same' | 'neutral' = 'same';
  for (let k = 0; k < list.length; k++) {
    const a = syllable(list[k]);
    const b = syllable(shown[k]);
    if (!a || !b || a.base !== b.base) return null;
    if (a.tone === b.tone || (aligned && (chars[k] === '一' || chars[k] === '不'))) continue;
    if (a.tone === '5' || b.tone === '5') { kind = 'neutral'; continue; }
    return null;
  }
  return kind;
}

/** Verbs of speaking (and 便, 又, which lead one) after which a lone 道 is "said": 笑|道, 问|道, 又|道. */
const SAID_AFTER = new Set([...'笑说說问問答叫骂罵喝回便又']);
/** The colon or opening quote of the words said: 他道：「…」. Not a straight ", which can close a quote as well. */
const WORDS_SAID = new Set([...'：:“「『‘']);
const COMMA = new Set([...'，,']);
/** Before a comma, a numeral or demonstrative keeps 道 the measure word (金光万道，): a name ending in one (阿二道：) does not. */
const COUNTED = new Set([...'一二两兩三四五六七八九十百千万萬几幾半数數这這那哪每第']);

/**
 * Is this 道 the verb "said" of storytelling (他笑道：…)? The HSK list grades 道 only as a measure word (HSK 2: 一道题), so its
 * chip says nothing true of it here. Before a comma it is "said" or a noun (修道，), neither of them the measure word. `prev`
 * and `next` are the tokens around it, as the reader cut the text.
 */
export function isSaidDao(word: string, pinyin: readonly string[] | undefined, prev?: string, next?: string): boolean {
  if (word !== '道' || (pinyin?.length && !/^dao4$/i.test(pinyin[0]))) return false;
  const before = prev ? [...prev].pop()! : '';
  if (SAID_AFTER.has(before)) return true;
  const after = next ? [...next.trimStart()][0] ?? '' : '';
  return WORDS_SAID.has(after) || (COMMA.has(after) && !COUNTED.has(before));
}
