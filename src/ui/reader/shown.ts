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
  const out = converted(text, mode, dict, script);
  // On the simplified page a 著 that reads as 着 is written 着 (zheAsWritten), whichever script the book is in.
  return mode === 'simplified' && out.includes('著') ? zheAsWritten(out, text, dict) : out;
}

/** inScript's conversion by the tables, keeping a book's own standard characters. */
function converted(text: string, mode: Exclude<ScriptMode, 'original'>, dict: Dictionary, script?: Script): string {
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

/**
 * The book's names and terms in the script shown (they are stored as the book spells them), keeping the book's 著: the page's cut
 * is made on it (segmentShown), so 摸著天 still finds the nickname where the page shows 摸着天.
 */
export function lexiconInScript(lexicon: Lexicon | undefined, mode: ScriptMode, dict: Dictionary, script?: Script): Lexicon | undefined {
  if (!lexicon || mode === 'original') return lexicon;
  return buildLexicon(lexicon.entries().map((e) => ({ ...e, word: converted(e.word, mode, dict, script) }))
    .filter((e) => [...e.word].length === [...e.pinyin.split(' ')].length || !e.pinyin));
}

/**
 * Tokens of a paragraph as shown (`shown` = inScript(source)), read from the book's own characters. Where the page writes 着 for the
 * book's 著 (zheAsWritten), the cut is made on the 著, so it is the cut the book's own spelling gets, and the tokens show the 着.
 */
export function segmentShown(shown: string, source: string, dict: Dictionary, lexicon?: Lexicon, ruby?: readonly RubySpan[]): Token[] {
  const orig = originalBeside(shown, source);
  const cut = orig && shown.includes('着') ? withBookZhe(shown, orig) : shown;
  const tokens = segment(cut, dict, lexicon, ruby, orig);
  return cut === shown ? tokens : tokens.map((t) => ({ ...t, text: shown.slice(t.start, t.end) }));
}

/** `shown` with the book's 著 back where the page writes 着 for it. */
function withBookZhe(shown: string, source: string): string {
  let out = '';
  let from = 0;
  for (let i = shown.indexOf('着'); i >= 0; i = shown.indexOf('着', i + 1)) {
    if (source[i] !== '著') continue;
    out += shown.slice(from, i) + '著';
    from = i + 1;
  }
  return from ? out + shown.slice(from) : shown;
}

/** The readings 着 stands for in simplified text. */
const ZHE_READING = /^(zhe5|zhao2|zhuo2|zhao1)$/;

/**
 * `shown` (a paragraph converted to simplified) with each 著 that reads zhe, zháo, zhuó or zhāo written 着, the one simplified
 * spelling of those words: OpenCC keeps 著 because it is also zhù (著作, 显著 stay). The readings are the reader's own, from a cut of
 * the paragraph without the book's names (a 著 never turns on a name); 着 and 著 are one UTF-16 unit each, so offsets hold.
 */
function zheAsWritten(shown: string, source: string, dict: Dictionary): string {
  const chars = shown.split('');
  let changed = false;
  for (const t of segment(shown, dict, undefined, undefined, originalBeside(shown, source))) {
    if (t.kind !== 'han' || !t.pinyin || !t.text.includes('著')) continue;
    let off = t.start;
    [...t.text].forEach((ch, k) => {
      if (ch === '著' && ZHE_READING.test(t.pinyin![k] ?? '')) { chars[off] = '着'; changed = true; }
      off += ch.length;
    });
  }
  return changed ? chars.join('') : shown;
}
