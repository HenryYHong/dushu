// Turning segmented text into DOM: one <span class="rd-w"> per Han token, one <ruby> per character with the
// pinyin in an <rt>. Pinyin style, tone colors, sandhi and visibility are applied to existing nodes, so changing
// them never re-segments. rt is never selectable and is skipped by every offset calculation (see selection.ts).
import { applySandhi, formatSyllable, toneOf } from '../../core/pinyin';
import { segment } from '../../core/segment';
import type { Dictionary, Lexicon, PinyinMode, PinyinStyle, Token } from '../../types';

export interface PinyinDisplay {
  style: PinyinStyle;
  toneColors: boolean;
}

/** The DOM for one Han token. `chars[i]` lines up with the i-th code point of `token.text`. */
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
}

export interface RenderOptions extends PinyinDisplay {
  sandhi: boolean;
  /** Whether a token's pinyin is shown right now (pinyin mode, known words). Default: all. */
  visible?: (t: Token) => boolean;
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
const PUNCT_OPEN = '（“‘《〈「『【〔［｛';
const PUNCT_CLOSE = '，。、；：！？）”’》〉」』】〕］｝';

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

/** Build the nodes for a token list. Non-Han tokens become plain text nodes. */
export function renderTokens(tokens: Token[], shown: Token[], opts: RenderOptions): { nodes: DocumentFragment; views: TokenView[] } {
  const frag = document.createDocumentFragment();
  const views: TokenView[] = [];
  tokens.forEach((token, index) => {
    if (token.kind !== 'han') {
      const side = token.kind === 'punct' ? punctSide(token.text) : '';
      if (side) {
        const pu = createEl('span', side === 'o' ? 'rd-pu rd-pu-o' : 'rd-pu rd-pu-c');
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
      const ruby = createEl('ruby', 'rd-c');
      ruby.dataset.o = String(offset);
      ruby.appendChild(document.createTextNode(ch));
      const syllable = syls[k] ?? '';
      let rt: HTMLElement | null = null;
      if (syllable) {
        rt = document.createElement('rt');
        const c = rtContent(syllable, opts);
        // The text sits in a span so the stylesheet can place it (Safari does not let an rt itself be positioned).
        const label = createEl('span', 'rd-rtx');
        label.textContent = c.text;
        rt.appendChild(label);
        if (c.cls) rt.className = c.cls;
        ruby.appendChild(rt);
      }
      chars.push({ ruby, rt, syllable });
      el.appendChild(ruby);
      offset += ch.length;
      k++;
    }
    const view: TokenView = { index, token, el, chars };
    if (opts.visible && !opts.visible(token)) el.classList.add('rd-nopy');
    views.push(view);
    frag.appendChild(el);
  });
  return { nodes: frag, views };
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

/** Re-apply sandhi, style and tone colors to existing rt nodes. */
export function refreshPinyin(p: RenderedParagraph, opts: RenderOptions): void {
  p.shown = displayTokens(p.tokens, opts.sandhi);
  for (const v of p.views) {
    const syls = p.shown[v.index].pinyin ?? [];
    v.chars.forEach((c, i) => {
      c.syllable = syls[i] ?? '';
      if (!c.rt) return;
      const r = rtContent(c.syllable, opts);
      if (c.rt.textContent !== r.text) {
        const label = c.rt.firstElementChild;
        if (label) label.textContent = r.text;
        else c.rt.textContent = r.text;
      }
      c.rt.className = r.cls;
    });
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
  /** HSK 3.0 band of the word (7 = 7-9), if it is on the list. */
  hskLevel(word: string): number | undefined;
}

/**
 * Should this word carry pinyin? off: never. all: always. unknown: unless marked known.
 * hsk: unless known, or on the HSK list at or below the threshold.
 */
export function pinyinVisible(word: string, rule: VisibilityRule): boolean {
  switch (rule.mode) {
    case 'off': return false;
    case 'all': return true;
    case 'unknown': return !rule.isKnown(word);
    case 'hsk': {
      if (rule.isKnown(word)) return false;
      const level = rule.hskLevel(word);
      return level === undefined || level > rule.hskThreshold;
    }
  }
}

/** Han characters in the rendered paragraph's token array. */
export function hanLength(tokens: Token[]): number {
  let n = 0;
  for (const t of tokens) if (t.kind === 'han') n += [...t.text].length;
  return n;
}
