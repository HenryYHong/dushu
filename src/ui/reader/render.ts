// Turning segmented text into DOM: one <span class="rd-w"> per Han token, one <ruby> per character with the
// pinyin in an <rt>. Pinyin style, tone colors, sandhi and visibility are applied to existing nodes, so changing
// them never re-segments. rt is never selectable and is skipped by every offset calculation (see selection.ts).
import { applySandhi, formatSyllable, toneOf } from '../../core/pinyin';
import { segment } from '../../core/segment';
import type { Dictionary, Lexicon, PinyinMode, PinyinStyle, Token } from '../../types';
import { widthOfPinyin } from './grid';
import { isWord } from '../../lang/token';

export interface PinyinDisplay {
  style: PinyinStyle;
  toneColors: boolean;
}

/**
 * The elements that carry a text offset (data-o): a Chinese character's ruby, and in any other language a word or a piece of
 * one (rd-o). Placing pages, marks and the reading place all go through these.
 */
export const POS_SEL = 'ruby.rd-c, .rd-o';

/**
 * The DOM for one word. For Chinese, `chars[i]` lines up with the i-th code point of `token.text`. For another language it
 * has one entry per piece that can carry an aid over it: a furigana piece, or the whole word for a hint.
 */
export interface TokenView {
  /** Index into the paragraph's token array. */
  index: number;
  token: Token;
  el: HTMLElement;
  chars: { ruby: HTMLElement; rt: HTMLElement | null; syllable: string }[];
}

export interface RenderedParagraph {
  el: HTMLElement;
  text: string;
  /** Tokens exactly as segmented (pristine pinyin). */
  tokens: Token[];
  /** Same tokens with sandhi applied when the setting is on; this is what the rt text shows. */
  shown: Token[];
  views: TokenView[];
  /** False while the <rt> nodes have not been built yet (see RenderOptions.deferPinyin). */
  pinyinBuilt?: boolean;
}

export interface RenderOptions extends PinyinDisplay {
  sandhi: boolean;
  /** Whether a token's pinyin is shown right now (pinyin mode, known words). Default: all. */
  visible?: (t: Token) => boolean;
  /**
   * Leave the <rt> nodes out; `buildPinyin` adds them later. The pinyin sits out of the flow, so the layout of a page does
   * not depend on it, and a long chapter can be paginated with a third of the DOM.
   */
  deferPinyin?: boolean;
  /** Give each word role=button and a spoken name (the word and its pinyin), for VoiceOver and Switch Control. */
  words?: boolean;
  /** Another language: what goes over its words (furigana come with the tokens; a hint is asked of `hint`). */
  aid?: 'furigana' | 'hint';
  hint?: (t: Token) => string | undefined;
  /** Russian: mark the stressed vowel. */
  stress?: boolean;
}

/** Copy of the tokens with the sandhi rewrite applied (or not). The originals stay untouched. */
export function displayTokens(tokens: Token[], sandhi: boolean): Token[] {
  const copy = tokens.map((t) => (t.pinyin ? { ...t, pinyin: [...t.pinyin] } : t));
  if (sandhi) applySandhi(copy);
  return copy;
}

function toneClass(syllable: string): string {
  return `tone-${toneOf(syllable)}`;
}

/** The text and tone class of one rt. */
export function rtContent(syllable: string, d: PinyinDisplay): { text: string; cls: string } {
  const s = syllable.toLowerCase();
  return { text: formatSyllable(s, d.style), cls: d.toneColors ? toneClass(s) : '' };
}

/** Full-width punctuation that takes a grid cell of its own (so lines of text stay on an even grid). */
const PUNCT_OPEN = '（《〈「『【〔［｛';
const PUNCT_CLOSE = '，。、；：！？）》〉」』】〕］｝';

/**
 * The four curly quotes are not full-width marks: in most fonts (Songti SC on a Mac, with the page marked zh) they are narrow,
 * proportional glyphs, so the half-cell trimming the other marks get would put an opening quote's ink on the mark before it and
 * leave a closing quote no box at all. They get a class of their own; the stylesheet gives each a half-cell box from the glyph's
 * measured advance (grid.ts, measureQuotes), whatever the font draws. 'o' opens, 'c' closes; `key` names the glyph.
 */
export const CURLY_QUOTES: Record<string, { side: 'o' | 'c'; key: string }> = {
  '\u2018': { side: 'o', key: 'lsq' },
  '\u2019': { side: 'c', key: 'rsq' },
  '\u201c': { side: 'o', key: 'ldq' },
  '\u201d': { side: 'c', key: 'rdq' },
};

/** 'o' for opening marks (the glyph hugs the right of its cell), 'c' for closing marks, '' for everything else. */
export function punctSide(text: string): 'o' | 'c' | '' {
  if (text.length !== 1) return '';
  if (PUNCT_OPEN.includes(text)) return 'o';
  if (PUNCT_CLOSE.includes(text)) return 'c';
  return '';
}

function createEl(tag: string, cls: string): HTMLElement {
  const el = document.createElement(tag);
  el.className = cls;
  return el;
}

/** Pinyin wider than this (per em of the pinyin font) may need squeezing to fit its cell; the stylesheet does the math. */
const SQUEEZE_FROM = 1.8;

/** Characters whose glyphs usually come from a fallback font (Ext B and later, compatibility forms, radicals). */
function isRare(cp: number): boolean {
  return cp >= 0x20000 || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0x2e80 && cp <= 0x2fdf);
}

/** Put the pinyin text in an rt's label and, for the few long syllables, the width the stylesheet squeezes them by. */
function setLabel(label: HTMLElement, text: string): void {
  label.textContent = text;
  const w = widthOfPinyin(text);
  if (w >= SQUEEZE_FROM) label.style.setProperty('--rd-w', w.toFixed(2));
  else if (label.style.length) label.style.removeProperty('--rd-w');
}

/** The <rt> for one syllable. The text sits in a span so the stylesheet can place it (Safari cannot position an rt itself). */
function makeRt(syllable: string, opts: PinyinDisplay): HTMLElement {
  const rt = document.createElement('rt');
  const c = rtContent(syllable, opts);
  const label = createEl('span', 'rd-rtx');
  setLabel(label, c.text);
  rt.appendChild(label);
  rt.setAttribute('aria-hidden', 'true');
  if (c.cls) rt.className = c.cls;
  return rt;
}

/** What a screen reader says for a word: the word, then its pinyin, never the ruby text inline ("第dì"). */
function wordName(token: Token, shown: Token, style: PinyinStyle): string {
  const py = (shown.pinyin ?? []).filter(Boolean).map((s) => formatSyllable(s, style)).join(' ');
  return py ? `${token.text}, ${py}` : token.text;
}

function decorateWord(view: TokenView, shown: Token, style: PinyinStyle): void {
  view.el.setAttribute('role', 'button');
  view.el.setAttribute('aria-label', wordName(view.token, shown, style));
}

/** The DOM for a word of a language other than Chinese (lang/types.ts): furigana pieces, a hint, a stress mark. */
function renderWord(token: Token, index: number, opts: RenderOptions): TokenView {
  const el = createEl('span', 'rd-w rd-word');
  el.dataset.s = String(token.start);
  el.dataset.e = String(token.end);
  el.dataset.i = String(index);
  if (token.inDict) el.classList.add('rd-dict');
  if (token.name) el.classList.add('rd-propn');
  const chars: TokenView['chars'] = [];
  const aid = opts.aid;
  if (token.ruby?.length) {
    // Japanese: kanji pieces carry their reading; kana are marked one character at a time, so a page can begin inside a word.
    let offset = token.start;
    for (const part of token.ruby) {
      if (part.rt) {
        const ruby = createEl('ruby', 'rd-o rd-r');
        ruby.dataset.o = String(offset);
        ruby.appendChild(document.createTextNode(part.text));
        let rt: HTMLElement | null = null;
        if (!opts.deferPinyin) { rt = makeAidRt(part.rt); ruby.appendChild(rt); }
        chars.push({ ruby, rt, syllable: part.rt });
        el.appendChild(ruby);
      } else {
        let o = offset;
        for (const ch of part.text) {
          const sp = createEl('span', 'rd-o');
          sp.dataset.o = String(o);
          sp.textContent = ch;
          el.appendChild(sp);
          o += ch.length;
        }
      }
      offset += part.text.length;
    }
  } else {
    // A spaced language: the word is one piece, wrapped in a ruby when it can carry a hint over it.
    // An elided word (French d’, l’, qu’; Italian dell’) carries no hint: one would hold it apart from the word it leans on.
    const box = aid === 'hint' && !/['’]$/.test(token.text) ? createEl('ruby', 'rd-o rd-hw') : el;
    box.dataset.o = String(token.start);
    if (box !== el) el.classList.add('rd-has-hw');
    // Under a hint the word sits in its own span, so the stylesheet can set word and hint in one cell as wide as the wider.
    const base = box !== el ? createEl('span', 'rd-hb') : box;
    appendStressed(base, token, opts.stress ?? false);
    if (base !== box) box.appendChild(base);
    if (box !== el) {
      const hint = opts.hint?.(token) ?? '';
      let rt: HTMLElement | null = null;
      if (hint && !opts.deferPinyin) { rt = makeAidRt(hint); box.appendChild(rt); }
      chars.push({ ruby: box, rt, syllable: hint });
      el.appendChild(box);
    } else el.classList.add('rd-o');
  }
  const view: TokenView = { index, token, el, chars };
  if (opts.words) {
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', token.reading && token.reading !== token.text ? `${token.text}, ${token.reading}` : token.text);
  }
  if (opts.visible && !opts.visible(token)) el.classList.add('rd-nopy');
  return view;
}

/** The word's text, with its stressed vowel (Russian) in a span the stylesheet marks. */
function appendStressed(box: HTMLElement, token: Token, stress: boolean): void {
  const at = stress && token.stress !== undefined && token.stress >= 0 && token.stress < token.text.length ? token.stress : -1;
  if (at < 0) { box.appendChild(document.createTextNode(token.text)); return; }
  const cp = token.text.codePointAt(at)!;
  const len = cp > 0xffff ? 2 : 1;
  if (at > 0) box.appendChild(document.createTextNode(token.text.slice(0, at)));
  const v = createEl('span', 'rd-stress');
  v.textContent = token.text.slice(at, at + len);
  box.appendChild(v);
  if (at + len < token.text.length) box.appendChild(document.createTextNode(token.text.slice(at + len)));
}

/** An rt for furigana or a hint: the text as it is, no tone colors. */
function makeAidRt(text: string): HTMLElement {
  const rt = document.createElement('rt');
  const label = createEl('span', 'rd-rtx');
  label.textContent = text;
  rt.appendChild(label);
  rt.setAttribute('aria-hidden', 'true');
  return rt;
}

/** What sits over a word of another language now (its furigana pieces, or its hint). */
function aidTexts(token: Token, opts: RenderOptions): string[] {
  if (token.ruby?.length) return token.ruby.filter((p) => p.rt).map((p) => p.rt!);
  if (opts.aid === 'hint') return [opts.hint?.(token) ?? ''];
  return [];
}

/** Build the nodes for a token list. Non-Han tokens become plain text nodes. */
export function renderTokens(tokens: Token[], shown: Token[], opts: RenderOptions): { nodes: DocumentFragment; views: TokenView[] } {
  const frag = document.createDocumentFragment();
  const views: TokenView[] = [];
  tokens.forEach((token, index) => {
    if (token.kind === 'word') {
      const view = renderWord(token, index, opts);
      views.push(view);
      frag.appendChild(view.el);
      return;
    }
    if (token.kind !== 'han') {
      const side = token.kind === 'punct' ? punctSide(token.text) : '';
      const quote = token.kind === 'punct' ? CURLY_QUOTES[token.text] : undefined;
      if (quote) {
        const pu = createEl('span', `rd-pu rd-pu-q rd-pu-q${quote.side} rd-pq-${quote.key}`);
        pu.appendChild(document.createTextNode(token.text));
        frag.appendChild(pu);
      } else if (side) {
        // ！ is drawn centered in its box (the other closing marks sit at the left), so the stylesheet moves it (rd-pu-b).
        const pu = createEl('span', side === 'o' ? 'rd-pu rd-pu-o' : token.text === '！' ? 'rd-pu rd-pu-c rd-pu-b' : 'rd-pu rd-pu-c');
        // The half-cell grid expects simplified forms (ink at the side, not centered). In a traditional book a font with both
        // locales (PingFang) would follow the text's zh-Hant and draw the centered ones, so the mark says it is simplified.
        pu.lang = 'zh-Hans';
        pu.appendChild(document.createTextNode(token.text));
        frag.appendChild(pu);
      } else frag.appendChild(document.createTextNode(token.text));
      return;
    }
    const el = createEl('span', 'rd-w');
    el.dataset.s = String(token.start);
    el.dataset.e = String(token.end);
    el.dataset.i = String(index);
    if (token.inDict) el.classList.add('rd-dict');
    const syls = shown[index].pinyin ?? [];
    const chars: TokenView['chars'] = [];
    let offset = token.start;
    let k = 0;
    for (const ch of token.text) {
      const ruby = createEl('ruby', isRare(ch.codePointAt(0) ?? 0) ? 'rd-c rd-rare' : 'rd-c');
      ruby.dataset.o = String(offset);
      ruby.appendChild(document.createTextNode(ch));
      const syllable = syls[k] ?? '';
      let rt: HTMLElement | null = null;
      if (syllable && !opts.deferPinyin) {
        rt = makeRt(syllable, opts);
        ruby.appendChild(rt);
      }
      chars.push({ ruby, rt, syllable });
      el.appendChild(ruby);
      offset += ch.length;
      k++;
    }
    // A heading in a narrow column may break inside a word this long (reader.css, @container rd-h).
    if (chars.length >= 5) el.classList.add('rd-w-long');
    const view: TokenView = { index, token, el, chars };
    if (opts.words) decorateWord(view, shown[index], opts.style);
    if (opts.visible && !opts.visible(token)) el.classList.add('rd-nopy');
    views.push(view);
    frag.appendChild(el);
  });
  return { nodes: frag, views };
}

/**
 * Add the <rt> nodes a deferred paragraph lacks, with the pinyin of the moment (sandhi, style, tone colors).
 * A paragraph that has them already is left alone; `refreshPinyin` keeps those up to date.
 */
export function buildPinyin(p: RenderedParagraph, opts: RenderOptions): void {
  if (p.pinyinBuilt !== false) return;
  p.pinyinBuilt = true;
  p.shown = displayTokens(p.tokens, opts.sandhi);
  for (const v of p.views) {
    if (v.token.kind === 'word') {
      const texts = aidTexts(v.token, opts);
      v.chars.forEach((c, i) => {
        c.syllable = texts[i] ?? '';
        if (c.syllable && !c.rt) { c.rt = makeAidRt(c.syllable); c.ruby.appendChild(c.rt); }
      });
      continue;
    }
    const shown = p.shown[v.index];
    const syls = shown.pinyin ?? [];
    v.chars.forEach((c, i) => {
      c.syllable = syls[i] ?? '';
      if (c.syllable && !c.rt) {
        c.rt = makeRt(c.syllable, opts);
        c.ruby.appendChild(c.rt);
      }
    });
    if (opts.words) decorateWord(v, shown, opts.style);
  }
}

/** Segment a paragraph and render it into `tag` (p, h2, blockquote, span …). */
export function renderParagraph(
  text: string,
  dict: Dictionary,
  opts: RenderOptions & { tag?: string; className?: string; lexicon?: Lexicon },
): RenderedParagraph {
  const tokens = segment(text, dict, opts.lexicon);
  const shown = displayTokens(tokens, opts.sandhi);
  const { nodes, views } = renderTokens(tokens, shown, opts);
  const el = createEl(opts.tag ?? 'p', opts.className ?? '');
  el.appendChild(nodes);
  return { el, text, tokens, shown, views };
}

/** Re-apply sandhi, style and tone colors to existing rt nodes. A paragraph without rt nodes yet only learns the new syllables. */
export function refreshPinyin(p: RenderedParagraph, opts: RenderOptions): void {
  p.shown = displayTokens(p.tokens, opts.sandhi);
  for (const v of p.views) {
    if (v.token.kind === 'word') {
      const texts = aidTexts(v.token, opts);
      v.chars.forEach((c, i) => {
        c.syllable = texts[i] ?? '';
        const label = c.rt?.firstElementChild as HTMLElement | null;
        if (label && label.textContent !== c.syllable) label.textContent = c.syllable;
      });
      continue;
    }
    const shown = p.shown[v.index];
    const syls = shown.pinyin ?? [];
    v.chars.forEach((c, i) => {
      c.syllable = syls[i] ?? '';
      if (!c.rt) return;
      const r = rtContent(c.syllable, opts);
      if (c.rt.textContent !== r.text) {
        const label = c.rt.firstElementChild as HTMLElement | null;
        if (label) setLabel(label, r.text);
        else c.rt.textContent = r.text;
      }
      c.rt.className = r.cls;
    });
    if (opts.words && v.el.hasAttribute('role')) decorateWord(v, shown, opts.style);
  }
}

/** Toggle the hidden-pinyin class on every Han word. */
export function refreshVisibility(p: RenderedParagraph, visible: (t: Token) => boolean): void {
  for (const v of p.views) v.el.classList.toggle('rd-nopy', !visible(v.token));
}

// ----------------------------------------------------------- visibility rule ---

export interface VisibilityRule {
  mode: PinyinMode;
  hskThreshold: number;
  isKnown(word: string): boolean;
  /** HSK level a reader can read the word at (7 = 7-9), given its reading here; see core/hskLevel.ts. */
  hskLevel(word: string, pinyin?: string[]): number | undefined;
}

/**
 * Should this word carry pinyin? off: never. all: always. unknown: unless marked known.
 * hsk: unless known, or readable at or below the threshold.
 */
export function pinyinVisible(word: string, rule: VisibilityRule, pinyin?: string[]): boolean {
  switch (rule.mode) {
    case 'off': return false;
    case 'all': return true;
    case 'unknown': return !rule.isKnown(word);
    case 'hsk': {
      if (rule.isKnown(word)) return false;
      const level = rule.hskLevel(word, pinyin);
      return level === undefined || level > rule.hskThreshold;
    }
  }
}

/** Han characters in the rendered paragraph's token array. */
export function hanLength(tokens: Token[]): number {
  let n = 0;
  for (const t of tokens) if (isWord(t)) n += [...t.text].length;
  return n;
}
