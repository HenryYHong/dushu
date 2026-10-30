// Aozora Bunko's ruby notation: 杜子春《とししゅん》 (the reading of the run of kanji before it) and ｜四月馬鹿《エイプリルフール》
// (｜ marks where the base starts, for anything that is not a plain run of kanji). The readings are the publisher's: the
// names, old readings and odd spellings an engine cannot guess (清《きよ》, 甲《こう》, 明後日《あさって》). They come out of the
// text and are kept beside it (types.ts RubySpan), so the page shows the book's own furigana and the engine reads as printed.
import type { Block, Chapter, RubySpan } from '../types';

const KANJI = /^[\p{Script=Han}々〆ヶ〇]$/u;
/** Longer than any reading: a 《 that is not a reading is left in the text. */
const MAX_RT = 40;

/** The code point that ends just before UTF-16 offset `end` in `s`, and where it starts. */
function before(s: string, end: number): { ch: string; at: number } {
  const lo = s.charCodeAt(end - 1);
  const at = lo >= 0xdc00 && lo <= 0xdfff && end >= 2 ? end - 2 : end - 1;
  return { ch: s.slice(at, end), at };
}

/** The text without its ruby notation, and the readings by offset in that text. Text without 《 comes back as it was. */
export function parseAozoraRuby(text: string): { text: string; ruby: RubySpan[] } {
  if (!text.includes('《')) return { text, ruby: [] };
  let out = '';
  const ruby: RubySpan[] = [];
  let bar = -1;
  // A base never reaches back into the one before it: 比較的《ひかくてき》呑気《のんき》 is two words, both kanji.
  let floor = 0;
  for (let i = 0; i < text.length;) {
    const ch = text[i];
    if (ch === '｜') { bar = out.length; i++; continue; }
    if (ch === '《') {
      const close = text.indexOf('》', i + 1);
      if (close > i + 1 && close - i - 1 <= MAX_RT) {
        let start = bar;
        if (start < 0) {
          start = out.length;
          while (start > floor) {
            const b = before(out, start);
            if (!KANJI.test(b.ch)) break;
            start = b.at;
          }
        }
        const rt = text.slice(i + 1, close);
        // Japanese also sets titles in 《》 (《朝日新聞》): with nothing under it, or kanji in it, it is not a reading and stays.
        if (start < out.length && !/\p{Script=Han}/u.test(rt)) {
          ruby.push({ start, end: out.length, rt });
          floor = out.length;
          bar = -1;
          i = close + 1;
          continue;
        }
      }
    }
    out += ch;
    i++;
  }
  return { text: out, ruby };
}

/** Every block and title of a Japanese book with its ruby notation taken out (the readings kept on the blocks). */
export function takeAozoraRuby(chapters: Chapter[]): Chapter[] {
  return chapters.map((c) => ({
    ...c,
    title: c.title.includes('《') ? parseAozoraRuby(c.title).text : c.title,
    blocks: c.blocks.map((b): Block => {
      if ((b.t !== 'p' && b.t !== 'h' && b.t !== 'quote') || !b.text.includes('《')) return b;
      const { text, ruby } = parseAozoraRuby(b.text);
      return ruby.length ? { ...b, text, ruby } : { ...b, text };
    }),
  }));
}

/** The spans of `ruby` inside text[from, to), moved to start at `from` (for a piece of a long paragraph). */
export function sliceRuby(ruby: readonly RubySpan[] | undefined, from: number, to: number): RubySpan[] | undefined {
  if (!ruby?.length) return undefined;
  const out = ruby.filter((r) => r.start >= from && r.end <= to).map((r) => ({ start: r.start - from, end: r.end - from, rt: r.rt }));
  return out.length ? out : undefined;
}
