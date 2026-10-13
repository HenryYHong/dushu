// Plain text: decode, pull the title and author out of the head, then chapters.
import type { BookFormat, ImportedBook } from '../types';
import { stripBoilerplate } from './boilerplate';
import { chaptersFromBlocks, cpLen, stripGutenbergBlocks, detectHeadingLine, isRuleLine, textToBlocks, trimLine } from './chapters';
import { NOT_TEXT_MESSAGE, decodeText, normalizeNewlines, plausibleText } from './encoding';
import { ImportError } from './errors';
import { authorFromLine, isGenericName, parseFilename } from './meta';
import { countHan } from './han';

const norm = (s: string) => s.replace(/[《》\s\u3000]/g, '');

export interface TextBookOptions {
  format: BookFormat;
  sourceName?: string;
  title?: string;
  author?: string;
}

/** Text to a book. A title/author passed in wins; then the file name; then the first lines. */
export function bookFromText(text: string, opts: TextBookOptions): ImportedBook {
  const lines = stripBoilerplate(normalizeNewlines(text).split('\n'), { isHeading: (l) => !!detectHeadingLine(l) });
  const fromFile = opts.sourceName ? parseFilename(opts.sourceName) : { title: '', author: '' };
  let title = (opts.title ?? '').trim() || fromFile.title;
  let author = (opts.author ?? '').trim() || fromFile.author;
  const explicitTitle = !!(opts.title ?? '').trim();

  // Look at the head of the file: "书名：", "作者：" and a bare title line.
  let seen = 0;
  for (let i = 0; i < lines.length && seen < 12; i++) {
    const t = trimLine(lines[i]);
    if (!t) continue;
    seen++;
    if (detectHeadingLine(t) && seen > 1) break;
    const byline = authorFromLine(t);
    if (byline) {
      if (!author) author = byline;
      lines[i] = '';
      continue;
    }
    const named = /^书名[:：]\s*(.{1,40})$/.exec(t) ?? /^書名[:：]\s*(.{1,40})$/.exec(t);
    if (named) {
      if (!title || isGenericName(title)) title = named[1].replace(/^《(.*)》$/, '$1').trim();
      lines[i] = '';
      continue;
    }
    if (seen === 1) {
      const bare = t.replace(/^《(.*)》$/, '$1').trim();
      const looksLikeTitle = cpLen(bare) <= 40 && !detectHeadingLine(t) && !isRuleLine(t) && !/[。！？，；、]$/.test(bare);
      if (!looksLikeTitle) continue;
      if (!explicitTitle && (!title || isGenericName(title) || (countHan(title) === 0 && countHan(bare) > 0))) {
        title = bare;
        lines[i] = '';
      } else if (norm(bare) === norm(title)) {
        lines[i] = '';
      }
    }
  }

  title = title || 'Untitled';
  const blocks = stripGutenbergBlocks(textToBlocks(lines.join('\n')));
  return {
    title,
    author,
    format: opts.format,
    script: 'unknown',
    chapters: chaptersFromBlocks(blocks, { title }),
    assets: new Map(),
    sourceName: opts.sourceName,
  };
}

export function importTxt(bytes: Uint8Array, sourceName: string): ImportedBook {
  const decoded = decodeText(bytes);
  if (!plausibleText(bytes, decoded)) throw new ImportError(NOT_TEXT_MESSAGE);
  return bookFromText(decoded.text, { format: 'txt', sourceName });
}
