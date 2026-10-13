// Live preview sentence for the settings screen: simple ruby rendering with the current settings.
import type { Dictionary, Settings, Token } from '../../types';
import { readingFontSizeKey } from '../../store/settings';
import { segment } from '../../core/segment';
import { applySandhi, formatSyllable, toneOf } from '../../core/pinyin';
import { clear, h } from '../dom';
import { effectiveLineHeight, gridMetrics, measureLongest } from '../reader/grid';
import { punctSide } from '../reader/render';

/** Has a measure word, 慢慢地, 一个 and 不大 so tone colors, sandhi and polyphones are all visible. */
export const PREVIEW_TEXT = '我们慢慢地走进一个不大的院子，他说：“你好，这是我的家。”';

const FONT_VAR: Record<Settings['fontFamily'], string> = {
  serif: 'var(--font-serif)',
  sans: 'var(--font-sans)',
  kai: 'var(--font-kai)',
};

type Visibility = Pick<Settings, 'pinyin' | 'hskThreshold'>;

/** Should this word carry pinyin? Mirrors the reader's modes. `isKnown` is the user's known-words check. */
export function showsPinyin(word: string, s: Visibility, dict: Dictionary, isKnown: (w: string) => boolean): boolean {
  switch (s.pinyin) {
    case 'off': return false;
    case 'all': return true;
    case 'unknown': return !isKnown(word);
    case 'hsk': {
      const level = dict.hsk(word)?.hsk3;
      return level === undefined || level > s.hskThreshold;
    }
  }
}

/** Same structure as the reader: a plain inline character with its pinyin hung above it, every character in one cell width. */
function charSpans(token: Token, s: Settings, show: boolean): HTMLElement {
  const chars = [...token.text];
  return h('span.set-w', null, chars.map((ch, i) => {
    const py = token.pinyin?.[i] ?? '';
    if (!show || !py) return h('ruby.set-ruby', null, ch);
    const rt = h('rt', { class: s.toneColors ? `tone-${toneOf(py)}` : '' }, h('span.set-rtx', null, formatSyllable(py, s.pinyinStyle)));
    return h('ruby.set-ruby', null, ch, rt);
  }));
}

/** Fills `target` with the sentence. Without a dictionary yet, shows the plain text. */
export function renderPreview(target: HTMLElement, s: Settings, dict: Dictionary | null, isKnown: (w: string) => boolean): void {
  clear(target);
  target.style.fontFamily = FONT_VAR[s.fontFamily];
  const fontSize = s[readingFontSizeKey(s)];
  target.style.fontSize = `${fontSize}px`;
  target.style.lineHeight = String(effectiveLineHeight(s.lineHeight, s.pinyin));
  target.style.maxWidth = `${s.pageWidth}px`;
  // The even grid: the cell is sized from the longest syllable at the pinyin size (see reader/grid.ts).
  const grid = s.pinyin !== 'off';
  target.classList.toggle('set-grid', grid);
  if (grid) {
    const rt = h('rt', { style: 'position:absolute;visibility:hidden' });
    target.appendChild(rt);
    const family = getComputedStyle(rt).fontFamily || 'sans-serif';
    rt.remove();
    const m = gridMetrics(measureLongest(s.pinyinStyle, family), fontSize);
    target.style.setProperty('--set-pad', String(m.padEm));
    target.style.setProperty('--set-cell', String(m.cellEm));
    target.style.setProperty('--set-rt', String(m.rtEm));
  }
  if (!dict) {
    target.append(PREVIEW_TEXT);
    return;
  }
  const text = s.script === 'traditional' ? dict.toTraditional(PREVIEW_TEXT) : PREVIEW_TEXT;
  const tokens = segment(text, dict);
  if (s.sandhi) applySandhi(tokens);
  for (const t of tokens) {
    if (t.kind === 'han') target.append(charSpans(t, s, showsPinyin(t.text, s, dict, isKnown)));
    else {
      const side = t.kind === 'punct' ? punctSide(t.text) : '';
      if (side) target.append(h(`span.set-pu.set-pu-${side}`, null, t.text));
      else target.append(t.text);
    }
  }
}
