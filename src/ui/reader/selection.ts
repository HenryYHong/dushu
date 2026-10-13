// Mapping DOM selections to offsets in the source text. Selection.toString() would include the <rt> pinyin,
// so offsets are computed by counting only text outside <rt>.

export interface BlockSpan {
  block: HTMLElement;
  /** UTF-16 offsets into the block's text. */
  start: number;
  end: number;
}

/** Pinyin and reader controls (marked data-rd-ui) are not part of the text. */
function insideRt(node: Node): boolean {
  const el = node.nodeType === 1 ? (node as Element) : node.parentElement;
  return !!el?.closest('rt, [data-rd-ui]');
}

/** The text nodes of a block, in order, skipping pinyin. */
export function textNodes(block: Node): Text[] {
  const out: Text[] = [];
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (insideRt(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text);
  return out;
}

/** Text of a block as displayed, without pinyin. */
export function blockText(block: Node): string {
  return textNodes(block).map((t) => t.data).join('');
}

/** Offset of a DOM point within the block's pinyin-free text. */
export function pointToOffset(block: Node, node: Node, offset: number): number {
  // A point inside an <rt> counts as the end of its base character.
  const rt = (node.nodeType === 1 ? (node as Element) : node.parentElement)?.closest('rt');
  if (rt && rt.parentNode) {
    node = rt.parentNode;
    offset = Array.prototype.indexOf.call(rt.parentNode.childNodes, rt);
  }
  let acc = 0;
  for (const t of textNodes(block)) {
    if (t === node) return acc + Math.min(offset, t.data.length);
    let before: boolean;
    if (node.nodeType === 3) {
      before = !!(t.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING);
    } else if (offset < node.childNodes.length) {
      before = !!(node.childNodes[offset].compareDocumentPosition(t) & Node.DOCUMENT_POSITION_PRECEDING);
    } else {
      before = node.contains(t) || !!(node.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_PRECEDING);
    }
    if (!before) break;
    acc += t.data.length;
  }
  return acc;
}

/** Never split a surrogate pair. */
export function snapToCodePoint(text: string, i: number, dir: -1 | 1): number {
  if (i <= 0 || i >= text.length) return Math.max(0, Math.min(i, text.length));
  const lo = text.charCodeAt(i - 1);
  const hi = text.charCodeAt(i);
  if (lo >= 0xd800 && lo <= 0xdbff && hi >= 0xdc00 && hi <= 0xdfff) return dir < 0 ? i - 1 : i + 1;
  return i;
}

/**
 * The part of each block covered by `range`, in document order. `blocks` are the text blocks of the chapter.
 * Blocks the range only touches (zero-length overlap) are left out.
 */
export function rangeToSpans(range: Range, blocks: HTMLElement[]): BlockSpan[] {
  const out: BlockSpan[] = [];
  for (const block of blocks) {
    if (!range.intersectsNode(block)) continue;
    const text = blockText(block);
    let start = block.contains(range.startContainer) ? pointToOffset(block, range.startContainer, range.startOffset) : 0;
    let end = block.contains(range.endContainer) ? pointToOffset(block, range.endContainer, range.endOffset) : text.length;
    start = snapToCodePoint(text, start, -1);
    end = snapToCodePoint(text, end, 1);
    if (end > start) out.push({ block, start, end });
  }
  return out;
}

/** Plain text of the selection with no pinyin: block pieces joined by newlines. */
export function spansText(spans: BlockSpan[], textOf: (b: HTMLElement) => string): string {
  return spans.map((s) => textOf(s.block).slice(s.start, s.end)).join('\n');
}
