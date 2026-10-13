// DOM pieces shared by the vocabulary and review screens.
import { formatSyllable, toneOf } from '../../core/pinyin';
import type { Dictionary, PinyinStyle, Settings, VocabItem } from '../../types';
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

/**
 * Shows saved words and their book sentences in the script the reader is set to, so a card never mixes the two.
 * `original` leaves the book's own script alone (the headword is the one the sentence uses). The dictionary may not have
 * loaded yet; until it has, sentences are shown as saved and `ready` is false so a screen can draw again.
 */
export interface ScriptView {
  ready: boolean;
  word(item: VocabItem): string;
  text(sentence: string): string;
}

export function scriptView(mode: Settings['script'], dict: Pick<Dictionary, 'toSimplified' | 'toTraditional'> | null): ScriptView {
  const convert = (t: string): string => {
    if (!dict || mode === 'original') return t;
    return mode === 'simplified' ? dict.toSimplified(t) : dict.toTraditional(t);
  };
  return {
    ready: mode === 'original' || !!dict,
    text: convert,
    word(item) {
      if (mode === 'simplified') return item.simp;
      if (mode === 'traditional') return item.trad || item.simp;
      // As written: the form that appears in the saved sentence, else the simplified one.
      const s = item.context?.sentence ?? '';
      return item.trad && item.trad !== item.simp && s.includes(item.trad) && !s.includes(item.simp) ? item.trad : item.simp;
    },
  };
}
