// Live preview sentence for the settings screen: simple ruby rendering with the current settings.
import type { Dictionary, Settings, Token } from '../../types';
import { readingFontSizeKey } from '../../store/settings';
import { segment } from '../../core/segment';
import { formatSyllable, toneOf } from '../../core/pinyin';
import { clear, h } from '../dom';
import { effectiveLineHeight, gridMetrics, measureQuotes, measureSyllables, setQuoteVars, widthOfPinyin } from '../reader/grid';
import { CURLY_QUOTES, displayTokens, pinyinVisible, punctSide, renderTokens } from '../reader/render';
import { hskLevels } from '../../core/hskLevel';
import { activeEngine, isChinese, lang } from '../../lang/active';
import { SAMPLE_SENTENCES } from '../../lang/samples';
import { rtEmFor } from '../reader/grid';
// The words of another language are drawn by the reader's own renderer, so the preview needs the reader's styles.
import '../../styles/reader.css';

/**
 * Has a measure word, 慢慢地, 一个 and 不大 so tone colors, sandhi and polyphones are all visible, and a second sentence with words from
 * HSK 2 to beyond the list, so each HSK level shows less pinyin than the one before.
 */
export const PREVIEW_TEXT = '我们慢慢地走进一个不大的院子，他说：“你好，这是我的家。”他神情温和，却难掩几分无奈与惆怅。';

const FONT_VAR: Record<Settings['fontFamily'], string> = {
  serif: 'var(--font-serif)',
  sans: 'var(--font-sans)',
  kai: 'var(--font-kai)',
};

type Visibility = Pick<Settings, 'pinyin' | 'hskThreshold'>;

/** Should this word carry pinyin? The reader's rule. `isKnown` is the user's known-words check. */
export function showsPinyin(word: string, s: Visibility, dict: Dictionary, isKnown: (w: string) => boolean, pinyin?: string[]): boolean {
  return pinyinVisible(word, { mode: s.pinyin, hskThreshold: s.hskThreshold, isKnown, hskLevel: hskLevels(dict) }, pinyin);
}

/** Same structure as the reader: a plain inline character with its pinyin hung above it, every character in one cell width. */
function charSpans(token: Token, s: Settings, show: boolean, widthOf: (text: string) => number): HTMLElement {
  const chars = [...token.text];
  return h('span.set-w', null, chars.map((ch, i) => {
    const py = token.pinyin?.[i] ?? '';
    if (!show || !py) return h('ruby.set-ruby', null, ch);
    const text = formatSyllable(py, s.pinyinStyle);
    // Long syllables are squeezed to fit their cell, as in the reader (the stylesheet does the math from --set-w).
    const w = widthOf(text);
    const label = h('span.set-rtx', w >= 1.8 ? { style: `--set-w:${w.toFixed(2)}` } : null, text);
    const rt = h('rt', { class: s.toneColors ? `tone-${toneOf(py)}` : '' }, label);
    return h('ruby.set-ruby', null, ch, rt);
  }));
}

/** Fills `target` with the sentence. Without a dictionary yet, shows the plain text. */
export function renderPreview(target: HTMLElement, s: Settings, dict: Dictionary | null, isKnown: (w: string) => boolean): void {
  clear(target);
  if (!isChinese()) { renderOtherPreview(target, s, isKnown); return; }
  target.style.fontFamily = FONT_VAR[s.fontFamily];
  const fontSize = s[readingFontSizeKey(s)];
  target.style.fontSize = `${fontSize}px`;
  target.style.lineHeight = String(effectiveLineHeight(s.lineHeight, s.pinyin));
  target.style.maxWidth = `${s.pageWidth}px`;
  // The even grid: the cell is sized from the longest syllable at the pinyin size (see reader/grid.ts).
  const grid = s.pinyin !== 'off';
  target.classList.toggle('set-grid', grid);
  target.classList.toggle('set-zy', s.pinyinStyle === 'zhuyin');
  let widthOf = (text: string) => widthOfPinyin(text);
  if (grid) {
    const probe = h('ruby.set-ruby', { style: 'position:absolute;visibility:hidden' }, h('rt'));
    target.appendChild(probe);
    const family = getComputedStyle(probe.querySelector('rt')!).fontFamily || 'sans-serif';
    probe.remove();
    const measure = measureSyllables(s.pinyinStyle, family);
    widthOf = measure.widthOf;
    const m = gridMetrics(measure.typical, fontSize, s.pinyinStyle);
    target.style.setProperty('--set-pad', String(m.padEm));
    target.style.setProperty('--set-cell', String(m.cellEm));
    target.style.setProperty('--set-rt', String(m.rtEm));
    target.style.setProperty('--set-sq', String(m.sqEm));
    setQuoteVars(target, 'set', measureQuotes(target, 'zh', false));
  }
  if (!dict) {
    target.append(PREVIEW_TEXT);
    return;
  }
  const text = s.script === 'traditional' ? dict.toTraditional(PREVIEW_TEXT) : PREVIEW_TEXT;
  const tokens = segment(text, dict);
  // Which words keep pinyin goes by the dictionary reading, as in the reader; the tone changes are only what is shown.
  const shown = displayTokens(tokens, s.sandhi);
  shown.forEach((t, i) => {
    if (t.kind === 'han') target.append(charSpans(t, s, showsPinyin(t.text, s, dict, isKnown, tokens[i].pinyin), widthOf));
    else {
      const side = t.kind === 'punct' ? punctSide(t.text) : '';
      const quote = t.kind === 'punct' ? CURLY_QUOTES[t.text] : undefined;
      if (quote) target.append(h(`span.set-pu.set-pu-q${quote.side}.set-pq-${quote.key}`, null, t.text));
      else if (side) target.append(h(`span.set-pu.set-pu-${side}`, null, t.text));
      else target.append(t.text);
    }
  });
}

/**
 * Another language: the opening of one of its classics, drawn as the reader draws it (lang/samples.ts), with its furigana,
 * hints or stress marks shown the way the settings say.
 */
function renderOtherPreview(target: HTMLElement, s: Settings, isKnown: (w: string) => boolean): void {
  const L = lang();
  const engine = activeEngine();
  const fontSize = s[readingFontSizeKey(s)];
  const article = h('div.rd-article.set-lang-sample', { lang: L.tag });
  article.style.cssText = `--rd-size:${fontSize}px;--rd-lh:${effectiveLineHeight(s.lineHeight, s.pinyin)};--rd-rt:${rtEmFor(fontSize)};`
    + `--rd-font:${s.fontFamily === 'sans' ? L.fonts.sans : L.fonts.serif};padding:0;max-width:${s.pageWidth}px`;
  article.classList.toggle('rd-py-off', s.pinyin === 'off');
  target.style.fontFamily = '';
  target.append(article);
  const text = SAMPLE_SENTENCES[L.id];
  if (!engine) { article.append(text); return; }
  const tokens = engine.segment(text);
  const visible = (t: Token) => t.kind === 'word' && !(t.name && L.aid === 'hint')
    && pinyinVisible(t.key || t.text, { mode: s.pinyin, hskThreshold: s.hskThreshold, isKnown, hskLevel: (k) => engine.level(k) });
  const { nodes } = renderTokens(tokens, tokens, {
    style: s.pinyinStyle, toneColors: false, sandhi: false, visible,
    aid: L.aid === 'furigana' ? 'furigana' : 'hint', hint: (t) => engine.hint(t), stress: !!L.stress && s.stress,
  });
  article.append(nodes);
}
