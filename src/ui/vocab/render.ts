// DOM pieces shared by the vocabulary and review screens.
import { formatSyllable, toneOf } from '../../core/pinyin';
import type { PinyinStyle } from '../../types';
import { h } from '../dom';
import { excerpt, splitContext } from './model';

/** Numbered pinyin ("ni3 hao3") as spans in the user's style, colored by tone when asked. */
export function pinyinEl(numbered: string, style: PinyinStyle, toneColors: boolean, cls = ''): HTMLElement {
  const el = h('span', { class: `zh-py ${cls}`.trim() });
  numbered.split(/\s+/).filter(Boolean).forEach((syl, i) => {
    if (i) el.appendChild(document.createTextNode(' '));
    el.appendChild(h('span', { class: toneColors ? `tone-${toneOf(syl)}` : '' }, formatSyllable(syl, style)));
  });
  return el;
}

/** A context sentence with the saved word in bold (or marked), shortened around the word. */
export function contextEl(sentence: string, words: string[], tag: 'b' | 'mark' = 'b', max = 80): HTMLElement {
  const parts = splitContext(sentence, words);
  if (!parts) return h('span', null, [...sentence].length > max ? [...sentence].slice(0, max).join('') + '…' : sentence);
  const p = excerpt(parts, max);
  return h('span', null, p.before, h(tag, null, p.match), p.after);
}
