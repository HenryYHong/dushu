// Pinyin as colored spans for the popup and the book card. A name or a place is capitalized and grouped the way an
// English reader writes it ("Guō Jìng", "Táohuā Dǎo"); everything else stays lowercase, one space between syllables.
import type { AppContext, LexiconEntry } from '../../types';
import { needsApostrophe, pinyinGroups } from '../../core/names';
import { formatSyllable, toneOf } from '../../core/pinyin';
import { h } from '../dom';

export interface PinyinKind {
  kind: LexiconEntry['kind'] | undefined;
  /** The word the syllables belong to; its characters decide the grouping. */
  word: string;
  /** Sizes of the words to capitalize, when the dictionary already says (a proper noun of CC-CEDICT: Cao2 Cao1). */
  groups?: number[];
}

/** One syllable list as colored spans in the user's pinyin style. */
export function pinyinSpans(ctx: AppContext, syllables: string[], as?: PinyinKind): HTMLElement {
  const { pinyinStyle, toneColors } = ctx.settings.get();
  const box = h('span.pp-py');
  const list = syllables.filter(Boolean);
  const capital = !!as && (!!as.groups || as.kind === 'name' || as.kind === 'place') && pinyinStyle !== 'zhuyin';
  const groups = !capital ? null : as!.groups ?? pinyinGroups(as!.word, as!.kind, (s) => ctx.dictSync()?.toSimplified(s) ?? s);
  const sizes = groups && groups.reduce((a, b) => a + b, 0) === list.length ? groups : list.map(() => 1);
  let at = 0;
  sizes.forEach((size, g) => {
    if (g > 0) box.appendChild(document.createTextNode(' '));
    list.slice(at, at + size).forEach((s, i) => {
      const lower = s.toLowerCase();
      let text = formatSyllable(lower, pinyinStyle);
      if (capital && i === 0) text = text.charAt(0).toUpperCase() + text.slice(1);
      // Inside a capitalized word pinyin writes Píng'ér, Xī'ān.
      if (capital && i > 0 && needsApostrophe(text)) text = "'" + text;
      const span = h('span.pp-syl', null, text);
      if (toneColors) span.classList.add(`tone-${toneOf(lower)}`);
      box.appendChild(span);
    });
    at += size;
  });
  return box;
}
