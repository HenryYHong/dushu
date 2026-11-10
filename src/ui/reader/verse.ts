// Chinese verse on the page: the lines of a poem typed as plain paragraphs (唐诗八首: 床前明月光，疑是地上霜。) are set with
// no first-line indent, and break only between their clauses (render.ts). Found when the chapter is drawn, so books
// imported before this need no new import.
import type { Block } from '../../types';
import { POEM_TITLE, VERSE_LINE } from '../../core/verseLines';

export { POEM_TITLE, VERSE_LINE };

/** The marks a clause of verse ends with. */
export const CLAUSE_MARKS = '，、；：。！？';

/**
 * Which blocks are lines of verse: a paragraph that reads as one (VERSE_LINE) right under a poem's title (a level 3
 * heading, or a POEM_TITLE line an older import left as a paragraph) or another line of verse, or in a run of two or more
 * such paragraphs. One short prose line that happens to read like verse ("他笑了，我也笑了。") stays prose.
 */
export function verseLines(blocks: readonly Block[]): boolean[] {
  const line = blocks.map((b) => b.t === 'p' && VERSE_LINE.test(b.text.trim()));
  const out = line.map(() => false);
  for (let i = 0; i < blocks.length; i++) {
    if (!line[i]) continue;
    const prev = blocks[i - 1];
    const underTitle = !!prev && ((prev.t === 'h' && prev.level === 3) || (prev.t === 'p' && POEM_TITLE.test(prev.text.trim())));
    out[i] = underTitle || line[i - 1] === true || line[i + 1] === true;
  }
  return out;
}
