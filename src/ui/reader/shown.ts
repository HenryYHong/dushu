// A paragraph as the reader shows it: in the script picked in the settings, cut into words. The book is stored as it is
// spelled; the page may show it converted. The words are cut in the text shown, but the readings are chosen from the book's
// own characters (為 乾 盡 where the page shows 为 干 尽), which the conversion would otherwise lose.
// The reader (chapter.ts) and the audit dumps both go through here, so what is measured is what is shown.
import { buildLexicon } from '../../core/lexicon';
import { segment } from '../../core/segment';
import type { Dictionary, Lexicon, RubySpan, Script, Settings, Token } from '../../types';

export type ScriptMode = Settings['script'];

/** Definitions that only point at another character (偸 "variant of 偷"): such a character is not a spelling of its own. */
const POINTER = /^((old|unofficial|archaic|ancient|Japanese|erroneous|obsolete) )*variant of\b/i;

const ownMemo = new WeakMap<Dictionary, Map<string, boolean>>();

/**
 * Whether a book written in the script shown keeps its character `ch` where OpenCC would write `to`: `ch` is a standard
 * character of that script in itself (乾 qián, 坏, and in traditional 干 里), and no entry calls it a variant of `to` (拚 is a
 * variant of 拼, 沈 of 沉 in 沈思: those are converted).
 */
function keepsOwn(ch: string, to: string, side: 'simp' | 'trad', dict: Dictionary): boolean {
  let memo = ownMemo.get(dict);
  if (!memo) ownMemo.set(dict, (memo = new Map()));
  const key = `${side}${ch}${to}`;
  let v = memo.get(key);
  if (v === undefined) {
    const entries = dict.lookup(ch);
    v = entries.some((e) => e[side] === ch && !POINTER.test(e.defs[0] ?? ''))
      && !entries.some((e) => (e.trad === ch || e.simp === ch) && e.defs.some((d) => POINTER.test(d) && d.includes(to)));
    memo.set(key, v);
  }
  return v;
}

/**
 * `text` in the script the reader shows. The OpenCC tables take every character as written in the other script, so a book
 * already in the script shown would lose some of its own characters (乾坤 → 干坤 and 一坏 → 一坯 in a simplified book, 干戈 →
 * 幹戈 in a traditional one). `script` is the book's: a character that is standard in the script shown stays as the book has it.
 */
export function inScript(text: string, mode: ScriptMode, dict: Dictionary, script?: Script): string {
  if (mode === 'original') return text;
  const out = mode === 'simplified' ? dict.toSimplified(text) : dict.toTraditional(text);
  if (out === text || script !== mode) return out;
  const a = [...text];
  const b = [...out];
  if (a.length !== b.length) return out;
  const side = mode === 'simplified' ? 'simp' : 'trad';
  let changed = false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i] && keepsOwn(a[i], b[i], side, dict)) { b[i] = a[i]; changed = true; }
  }
  return changed ? b.join('') : out;
}

/**
 * The book's own spelling of a paragraph shown converted, when the two line up character for character (each character at
 * the same UTF-16 offset), else undefined. OpenCC keeps the number of characters, but a few rare characters change plane
 * (BMP to astral), which would shift the offsets after them.
 */
export function originalBeside(shown: string, source: string): string | undefined {
  if (shown === source || shown.length !== source.length) return undefined;
  for (let i = 0; i < shown.length; i++) {
    const a = shown.charCodeAt(i);
    const b = source.charCodeAt(i);
    if ((a >= 0xd800 && a <= 0xdfff) !== (b >= 0xd800 && b <= 0xdfff)) return undefined;
  }
  return source;
}

/** The book's names and terms in the script shown (they are stored as the book spells them). */
export function lexiconInScript(lexicon: Lexicon | undefined, mode: ScriptMode, dict: Dictionary, script?: Script): Lexicon | undefined {
  if (!lexicon || mode === 'original') return lexicon;
  return buildLexicon(lexicon.entries().map((e) => ({ ...e, word: inScript(e.word, mode, dict, script) }))
    .filter((e) => [...e.word].length === [...e.pinyin.split(' ')].length || !e.pinyin));
}

/** Tokens of a paragraph as shown (`shown` = inScript(source)), read from the book's own characters. */
export function segmentShown(shown: string, source: string, dict: Dictionary, lexicon?: Lexicon, ruby?: readonly RubySpan[]): Token[] {
  return segment(shown, dict, lexicon, ruby, originalBeside(shown, source));
}
