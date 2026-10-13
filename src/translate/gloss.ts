// Offline word-by-word gloss: "word (pinyin): meaning · …". Always available once the dictionary is loaded.
import { formatPinyin } from '../core/pinyin';
import { segment } from '../core/segment';
import type { Dictionary, Token, Translator } from '../types';
import { entriesForReading } from '../core/reading';

export interface GlossDeps {
  segment: (text: string, dict: Dictionary) => Token[];
  /** Numbered pinyin (space separated) to tone marks. */
  format: (numbered: string) => string;
}

const defaultDeps: GlossDeps = { segment, format: n => formatPinyin(n, 'marks') };

const NOISE = /^(CL:|variant of|old variant of|see |abbr\. for)/i;

/** First definition that says what the word means, not just which word it is a variant of. */
function shortGloss(defs: string[]): string {
  const real = defs.find(d => !NOISE.test(d)) ?? defs[0] ?? '';
  return real.replace(/\s*\(.*?\)\s*$/, '').trim() || real;
}

function glossOne(token: Token, dict: Dictionary, deps: GlossDeps): { word: string; pinyin: string; gloss: string } | null {
  const entry = entriesForReading(dict.lookup(token.text), token.pinyin ?? [])[0];
  if (entry) {
    const syllables = token.pinyin?.filter(Boolean).join(' ') || entry.pinyin;
    return { word: token.text, pinyin: deps.format(syllables), gloss: shortGloss(entry.defs) };
  }
  return null;
}

/** Characters of a Han token the dictionary has no word for are glossed one by one. */
function glossChars(token: Token, dict: Dictionary, deps: GlossDeps) {
  const out: { word: string; pinyin: string; gloss: string }[] = [];
  const chars = [...token.text];
  chars.forEach((ch, i) => {
    const info = dict.char(ch);
    if (!info) return;
    const numbered = token.pinyin?.[i] ?? '';
    const pinyin = numbered ? deps.format(numbered) : (info.readings[0] ?? '');
    out.push({ word: ch, pinyin, gloss: info.definition });
  });
  return out;
}

export function glossText(text: string, dict: Dictionary, deps: GlossDeps = defaultDeps): string {
  const seen = new Set<string>();
  const items: string[] = [];
  const push = (g: { word: string; pinyin: string; gloss: string }) => {
    if (seen.has(g.word)) return;
    seen.add(g.word);
    const py = g.pinyin ? ` (${g.pinyin})` : '';
    items.push(g.gloss ? `${g.word}${py}: ${g.gloss}` : `${g.word}${py}`);
  };
  for (const token of deps.segment(text, dict)) {
    if (token.kind !== 'han') continue;
    const whole = glossOne(token, dict, deps);
    if (whole) push(whole);
    else glossChars(token, dict, deps).forEach(push);
  }
  return items.join(' · ');
}

export function createGlossTranslator(dict: Dictionary | null, deps: GlossDeps = defaultDeps): Translator {
  return {
    id: 'gloss',
    label: 'Word-by-word (offline)',
    async availability() { return dict ? 'yes' : 'no'; },
    async translate(req, opts) {
      if (!dict) throw new Error('The dictionary is still loading. Try again in a moment.');
      if (opts?.signal?.aborted) throw new DOMException('Translation canceled', 'AbortError');
      const out = glossText(req.text, dict, deps);
      if (!out) throw new Error('There are no Chinese words to gloss here.');
      opts?.onDelta?.(out);
      return out;
    },
  };
}
