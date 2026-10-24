// Book import: EPUB, TXT (any common Chinese encoding), PDF (text layer), HTML, Markdown, pasted text.
// Contract: ARCHITECTURE.md section 4.5.
import type { ImportedBook } from '../types';
import { detectScript } from '../core/text';
import { decodeText, stripBidi } from './encoding';
import { importEpub } from './epub';
import { DAMAGED_MESSAGE } from './zip';
import { importMobi, looksLikeMobi } from './mobi';
import { ImportError, NO_CHINESE, pdfStartFailure } from './errors';
import { countHan } from './han';
import { joinSplitParagraphs, normalizePunctuation, totalHan } from './chapters';
import { importHtml, importMarkdown } from './html';
import { capChars } from './meta';
import { bookFromText, importTxt } from './txt';
import { IMPORT_VERSION } from './version';

export { ImportError } from './errors';
export { countHan } from './han';
export const ACCEPT = '.epub,.mobi,.azw3,.azw,.prc,.txt,.text,.pdf,.html,.htm,.xhtml,.md';

type Kind = 'epub' | 'mobi' | 'pdf' | 'txt' | 'html' | 'md';

function extension(name: string): string {
  return (/\.([A-Za-z0-9]+)$/.exec(name)?.[1] ?? '').toLowerCase();
}

/** A file over this size is refused before it is read: it would not fit in memory on an iPad, and no book is this big. */
export { IMPORT_VERSION } from './version';

export const MAX_FILE_BYTES = 200 * 1024 * 1024;
export const FILE_TOO_BIG = 'This file is larger than 200 MB, which is too big to import. Try a smaller edition of the book.';

async function readBytes(blob: Blob): Promise<Uint8Array> {
  if (blob.size > MAX_FILE_BYTES) throw new ImportError(FILE_TOO_BIG);
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'));
    reader.readAsArrayBuffer(blob);
  });
}

const startsWith = (b: Uint8Array, s: string): boolean => s.split('').every((c, i) => b[i] === c.charCodeAt(0));

const UNSUPPORTED: Record<string, string> = {
  kfx: 'Kindle (KFX) books are not supported. Use a DRM-free EPUB instead.',
  djvu: 'DjVu files are scanned images, so there is no text to read. Find an EPUB, text or PDF version.',
  doc: 'Word .doc files are not supported. Save the document as a text file or PDF, then import that.',
  docx: 'Word documents are not supported. Save the document as a text file or PDF, then import that.',
  rtf: 'RTF files are not supported. Save the document as a text file, then import that.',
  zip: 'Zip archives are not supported. Unzip it and import the EPUB or text file inside.',
};

function detectKind(name: string, bytes: Uint8Array): Kind {
  const ext = extension(name);
  if (startsWith(bytes, '%PDF')) return 'pdf';
  if (looksLikeMobi(bytes)) return 'mobi';
  if (startsWith(bytes, 'TPZ') || startsWith(bytes, '\u00ea' + 'DRMION')) {
    throw new ImportError('This is a Kindle format Dushu cannot read (Topaz or KFX). Use a DRM-free EPUB instead.');
  }
  if (startsWith(bytes, 'PK\u0003\u0004') || startsWith(bytes, 'PK\u0005\u0006')) {
    // A zip under any other name is most likely an EPUB; the EPUB reader says so if it is not.
    if (UNSUPPORTED[ext] && ext !== 'zip') throw new ImportError(UNSUPPORTED[ext]);
    return 'epub';
  }
  if (UNSUPPORTED[ext]) throw new ImportError(UNSUPPORTED[ext]);
  switch (ext) {
    case 'epub':
      throw new ImportError(DAMAGED_MESSAGE);
    case 'mobi':
    case 'azw':
    case 'azw3':
    case 'prc':
      throw new ImportError('This file is not a valid Kindle (MOBI or AZW3) book.');
    case 'pdf':
      throw new ImportError('This file is not a valid PDF.');
    case 'txt':
    case 'text':
      return 'txt';
    case 'html':
    case 'htm':
    case 'xhtml':
      return 'html';
    case 'md':
    case 'markdown':
      return 'md';
  }
  // Unknown or missing extension: look at the content.
  const head = decodeText(bytes.subarray(0, 4096)).text;
  if (/<\s*(?:!doctype html|html|body|p\b)/i.test(head)) return 'html';
  if (countHan(head) > 0) return 'txt';
  throw new ImportError(`Files of type .${ext || 'unknown'} are not supported. Use EPUB, MOBI, AZW3, TXT, PDF, HTML or Markdown.`);
}

const BIDI_TEST = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/;

/** Remove bidirectional controls from every title and block of text, whichever importer produced them. */
function stripBidiChapters(chapters: ImportedBook['chapters']): ImportedBook['chapters'] {
  return chapters.map((c) => {
    const blocks = c.blocks.some((b) => 'text' in b && BIDI_TEST.test(b.text))
      ? c.blocks.map((b) => ('text' in b && BIDI_TEST.test(b.text) ? { ...b, text: stripBidi(b.text) } : b))
      : c.blocks;
    return blocks === c.blocks && !BIDI_TEST.test(c.title) ? c : { ...c, title: stripBidi(c.title), blocks };
  });
}

/** Clean-ups for every format: paragraphs broken mid-sentence are joined, odd punctuation is set full-width. */
function tidyChapters(chapters: ImportedBook['chapters']): ImportedBook['chapters'] {
  return chapters.map((c) => {
    const blocks = joinSplitParagraphs(c.blocks).map((b) => ('text' in b ? { ...b, text: normalizePunctuation(b.text) } : b));
    return { ...c, title: normalizePunctuation(c.title), blocks };
  });
}

/** Last checks and the fields every importer leaves blank: reject non-Chinese files, detect the script. */
function finish(book: ImportedBook): ImportedBook {
  const chapters = tidyChapters(stripBidiChapters(book.chapters.filter((c) => c.blocks.length > 0)));
  const han = totalHan(chapters);
  let letters = 0;
  for (const c of chapters) for (const b of c.blocks) if (b.t === 'p' || b.t === 'h' || b.t === 'quote') letters += b.text.replace(/\s/g, '').length;
  if (han < 5 || (han < 500 && han / Math.max(letters, 1) < 0.02)) throw new ImportError(NO_CHINESE);

  let sample = '';
  for (const c of chapters) {
    for (const b of c.blocks) if (b.t === 'p' || b.t === 'quote') sample += b.text;
    if (sample.length > 60000) break;
  }
  // A title or author is a label: no direction controls, and never a paragraph long.
  const title = capChars(book.title) || 'Untitled';
  return { ...book, title, author: capChars(book.author), chapters, script: detectScript(sample), importVersion: IMPORT_VERSION };
}

/** EPUB, MOBI / AZW3, TXT (any common Chinese encoding), PDF (text layer), HTML, Markdown. Detects by extension + magic bytes. */
export async function importFile(file: Blob & { name: string }, opts?: { onProgress?: (fraction: number) => void }): Promise<ImportedBook> {
  const onProgress = opts?.onProgress;
  onProgress?.(0);
  const name = file.name || 'book';
  const bytes = await readBytes(file);
  if (!bytes.length) throw new ImportError('This file is empty.');
  const kind = detectKind(name, bytes);

  let book: ImportedBook;
  switch (kind) {
    case 'epub':
      book = await importEpub(bytes, name, onProgress);
      break;
    case 'mobi':
      book = await importMobi(bytes, name, onProgress);
      break;
    case 'pdf': {
      // The PDF reader is a chunk of its own, loaded on first use.
      const { importPdf } = await import('./pdf').catch(async () => { throw await pdfStartFailure(); });
      book = await importPdf(bytes, name, onProgress);
      break;
    }
    case 'html':
      book = await importHtml(bytes, name);
      break;
    case 'md':
      book = importMarkdown(bytes, name);
      break;
    default:
      book = importTxt(bytes, name);
  }
  const done = finish(book);
  onProgress?.(1);
  return done;
}

/** What pasted text with no title of its own is called. ui/library/importer.ts shows the same words while it is added. */
export const PASTED_TITLE = 'Pasted text';

/** Pasted text → one book; chapters detected like TXT. */
export function importText(text: string, title?: string, author?: string): ImportedBook {
  const trimmed = text.trim();
  if (!trimmed) throw new ImportError('There is no text to import.');
  return finish(
    bookFromText(trimmed, {
      format: 'paste',
      title: title?.trim() || undefined,
      author: author?.trim() || undefined,
      fallbackTitle: PASTED_TITLE,
    }),
  );
}
