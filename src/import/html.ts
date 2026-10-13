// HTML pages and Markdown files.
import type { Block, ImportedBook } from '../types';
import { AssetStore } from './assets';
import { extractBlocks, normalizeInline } from './blocks';
import { chaptersFromBlocks, detectWrapWidth, linesToParagraphs, paragraphsToBlocks, trimLine } from './chapters';
import { decodeText, normalizeNewlines, sniffMarkupCharset } from './encoding';
import { parseXhtml } from './markup';
import { cleanAuthors, cleanTitle, parseFilename } from './meta';

export function importHtml(bytes: Uint8Array, sourceName: string): ImportedBook {
  const text = decodeText(bytes, sniffMarkupCharset(bytes)).text;
  const doc = parseXhtml(text);
  const store = new AssetStore();
  const { blocks } = extractBlocks(doc, { resolveImage: (src) => (/^data:/i.test(src) ? store.addDataUri(src) : undefined) });

  const meta = (name: string): string => {
    for (const m of Array.from(doc.getElementsByTagName('meta'))) {
      if ((m.getAttribute('name') ?? m.getAttribute('property') ?? '').toLowerCase() === name) return m.getAttribute('content') ?? '';
    }
    return '';
  };
  const pageTitle = doc.getElementsByTagName('title')[0]?.textContent ?? '';
  const firstH1 = blocks.find((b): b is Extract<Block, { t: 'h' }> => b.t === 'h' && b.level === 1);
  const fromFile = parseFilename(sourceName);
  const title = cleanTitle(meta('og:title') || pageTitle || firstH1?.text || '') || fromFile.title || 'Untitled';
  const author = cleanAuthors([meta('author') || meta('article:author')]);

  return {
    title,
    author,
    format: 'html',
    script: 'unknown',
    chapters: chaptersFromBlocks(blocks, { title }),
    assets: store.assets,
    sourceName,
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
  const text = decodeText(bytes).text;
  const blocks = markdownToBlocks(text);
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
  };
}
