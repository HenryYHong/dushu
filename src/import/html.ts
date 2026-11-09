// HTML pages and Markdown files.
import type { Block, ImportedBook } from '../types';
import { AssetStore, dropAssets } from './assets';
import { extractBlocks, normalizeInline } from './blocks';
import { chaptersFromBlocks, detectWrapWidth, linesToParagraphs, paragraphsToBlocks, trimLine } from './chapters';
import { decodeText, normalizeNewlines, sniffMarkupCharset, unreadableMessage, withHongKongCharacters } from './encoding';
import { parseXhtml } from './markup';
import { cleanAuthors, cleanTitle, parseFilename } from './meta';
import { langId } from '../lang/active';

/**
 * An Aozora Bunko (青空文庫) work page, as "Find a book" brings it: its DC metadata names it, the story is .main_text, and the
 * header (title and author again), the hidden contents and the bibliographic notes after the text are the library's.
 * Returns the title and author it names, after taking everything but the story out of the page; null for any other page.
 */
export function tidyAozora(doc: Document): { title: string; author: string } | null {
  const meta = (name: string) => [...doc.getElementsByTagName('meta')].find((m) => (m.getAttribute('name') ?? '') === name)?.getAttribute('content')?.trim() ?? '';
  const main = doc.querySelector('.main_text');
  if (meta('DC.Publisher') !== '青空文庫' || !main) return null;
  const body = doc.getElementsByTagName('body')[0];
  if (body) body.replaceChildren(main);
  return { title: meta('DC.Title'), author: meta('DC.Creator') };
}

export async function importHtml(bytes: Uint8Array, sourceName: string): Promise<ImportedBook> {
  const decoded = await withHongKongCharacters(decodeText(bytes, sniffMarkupCharset(bytes)));
  const doc = parseXhtml(decoded.text);
  const aozora = tidyAozora(doc);
  const store = new AssetStore();
  // A Japanese page's own readings (<ruby>) stay on its blocks: Aozora prints them over the hard words.
  const ruby = langId() === 'ja' || (doc.documentElement.getAttribute('xml:lang') ?? doc.documentElement.getAttribute('lang') ?? '').startsWith('ja');
  const { blocks } = extractBlocks(doc, { ruby, resolveImage: (src) => (/^data:/i.test(src) ? store.addDataUri(src) : undefined) });

  const meta = (name: string): string => {
    for (const m of Array.from(doc.getElementsByTagName('meta'))) {
      if ((m.getAttribute('name') ?? m.getAttribute('property') ?? '').toLowerCase() === name) return m.getAttribute('content') ?? '';
    }
    return '';
  };
  const pageTitle = doc.getElementsByTagName('title')[0]?.textContent ?? '';
  const firstH1 = blocks.find((b): b is Extract<Block, { t: 'h' }> => b.t === 'h' && b.level === 1);
  const fromFile = parseFilename(sourceName);
  const title = cleanTitle(aozora?.title || meta('og:title') || pageTitle || firstH1?.text || '') || fromFile.title || 'Untitled';
  const author = cleanAuthors([aozora?.author || meta('author') || meta('article:author')]);

  const dropped = await store.finalize(); // SVG images become PNG; any that cannot are removed
  return {
    title,
    author,
    format: 'html',
    script: 'unknown',
    chapters: dropAssets(chaptersFromBlocks(blocks, { title }), undefined, dropped).chapters,
    assets: store.assets,
    sourceName,
    ...(decoded.unreadable ? { warnings: [unreadableMessage(decoded.unreadable)] } : {}),
  };
}

// ---------------------------------------------------------------- markdown ---

function stripInline(s: string): string {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>\n]+>/g, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])\*(?!\s)([^*]+?)\*(?!\w)/g, '$1$2')
    .replace(/~~(.+?)~~/g, '$1');
}

type MdPiece = { kind: 'text'; lines: string[] } | { kind: 'block'; block: Block };

/** Markdown to blocks: #-headings, quotes, rules, lists and plain paragraphs (same wrap rules as TXT). */
export function markdownToBlocks(source: string): Block[] {
  const pieces: MdPiece[] = [];
  let text: string[] | null = null;
  const endText = () => {
    if (text) pieces.push({ kind: 'text', lines: text });
    text = null;
  };
  const pushLine = (l: string) => {
    (text ??= []).push(l);
  };
  const addBlock = (block: Block) => {
    endText();
    pieces.push({ kind: 'block', block });
  };

  let fence = false;
  for (const raw of normalizeNewlines(source).split('\n')) {
    if (/^\s*(```|~~~)/.test(raw)) {
      fence = !fence;
      pushLine('');
      continue;
    }
    if (fence) {
      pushLine(raw);
      pushLine('');
      continue;
    }
    const head = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(raw);
    if (head) {
      const t = normalizeInline(stripInline(head[2]));
      if (t) addBlock({ t: 'h', level: head[1].length as 1 | 2 | 3 | 4 | 5 | 6, text: t });
      continue;
    }
    if (/^\s{0,3}(?:-\s*){3,}$|^\s{0,3}(?:\*\s*){3,}$|^\s{0,3}(?:_\s*){3,}$/.test(raw)) {
      addBlock({ t: 'hr' });
      continue;
    }
    const q = /^\s{0,3}>\s?(.*)$/.exec(raw);
    if (q) {
      const t = normalizeInline(stripInline(q[1]));
      if (t) addBlock({ t: 'quote', text: t });
      continue;
    }
    if (/^\s*\|?[\s:|-]+\|?\s*$/.test(raw) && raw.includes('-') && raw.includes('|')) continue; // table separator row
    const item = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(raw);
    if (item) {
      pushLine(stripInline(item[1]));
      pushLine('');
      continue;
    }
    pushLine(raw.includes('|') && /^\s*\|.*\|\s*$/.test(raw) ? stripInline(raw).replace(/^\s*\||\|\s*$/g, '').replace(/\s*\|\s*/g, '\u3000') : stripInline(raw));
  }
  endText();

  const prose: string[] = [];
  for (const p of pieces) if (p.kind === 'text') for (const l of p.lines) if (trimLine(l)) prose.push(trimLine(l));
  const width = detectWrapWidth(prose);
  const blocks: Block[] = [];
  for (const p of pieces) {
    if (p.kind === 'block') blocks.push(p.block);
    else blocks.push(...paragraphsToBlocks(linesToParagraphs(p.lines, width)));
  }
  return blocks;
}

export function importMarkdown(bytes: Uint8Array, sourceName: string): ImportedBook {
  const decoded = decodeText(bytes);
  const blocks = markdownToBlocks(decoded.text);
  const fromFile = parseFilename(sourceName);
  const h1 = blocks.find((b): b is Extract<Block, { t: 'h' }> => b.t === 'h' && b.level === 1);
  const title = cleanTitle(h1?.text ?? '') || fromFile.title || 'Untitled';
  return {
    title,
    author: fromFile.author,
    format: 'md',
    script: 'unknown',
    chapters: chaptersFromBlocks(blocks, { title }),
    assets: new Map(),
    sourceName,
    ...(decoded.unreadable ? { warnings: [unreadableMessage(decoded.unreadable)] } : {}),
  };
}
