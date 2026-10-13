// Real PDFs, built in the test, read with the legacy pdf.js build in Node (CJK text through predefined CMaps).
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { importPdf, SCANNED_MESSAGE, type PdfRuntime } from '../../src/import/pdf';
import { NodeCMapReaderFactory, makePdf, type PdfLine } from './pdfhelpers';

let runtime: PdfRuntime;
beforeAll(async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  runtime = { pdfjs: pdfjs as never, cMapReaderFactory: NodeCMapReaderFactory };
});

const S1 = '清晨的阳光照进窗子，他慢慢地走到桌边，拿起那本旧书，轻轻地翻开了第一页。';
const S2 = '外面的风很大，树叶沙沙地响着，远处传来几声鸟叫，他忽然觉得很安静。';

/** Wrap text into lines of n characters. */
function wrapLines(text: string, n: number, x: number, top: number, indent = false): PdfLine[] {
  const chars = [...text];
  const out: PdfLine[] = [];
  for (let i = 0, row = 0; i < chars.length; i += n, row++) {
    out.push({ x: x + (indent && row === 0 ? 24 : 0), y: top - row * 18, text: chars.slice(i, i + n).join('') });
  }
  return out;
}

describe('importPdf', () => {
  it('reads Chinese text, paragraphs and chapter headings', async () => {
    const page1: PdfLine[] = [
      { x: 72, y: 780, text: '第一章 清晨', size: 18 },
      ...wrapLines(S1 + S2, 24, 72, 740, true),
      ...wrapLines(S2 + S1, 24, 72, 740 - 18 * 4, true),
      { x: 290, y: 40, text: '1' },
    ];
    const page2: PdfLine[] = [
      { x: 72, y: 780, text: '第二章 午后', size: 18 },
      ...wrapLines(S1 + S1, 24, 72, 740, true),
      { x: 290, y: 40, text: '2' },
    ];
    const bytes = makePdf([page1, page2], { info: '<< /Title (Test Book) /Author (Zhang San) >>' });
    const progress: number[] = [];
    const book = await importPdf(bytes, '测试.pdf', (f) => progress.push(f), runtime);
    expect(book.format).toBe('pdf');
    expect(book.chapters.map((c) => c.title)).toEqual(['第一章 清晨', '第二章 午后']);
    const texts = book.chapters.map((c) => c.blocks.filter((b) => b.t === 'p').map((b) => (b.t === 'p' ? b.text : '')));
    expect(texts[0]).toEqual([S1 + S2, S2 + S1]);
    expect(texts[1]).toEqual([S1 + S1]);
    expect(book.chapters.flatMap((c) => c.blocks.map((b) => (b.t === 'p' || b.t === 'h' ? b.text : ''))).join('')).not.toMatch(/[0-9]/);
    expect(book.author).toBe('Zhang San');
    expect(progress.length).toBeGreaterThan(0);
    expect(progress[progress.length - 1]).toBeLessThanOrEqual(1);
  });

  it('prefers a Chinese file name over a missing title', async () => {
    const bytes = makePdf([wrapLines(S1, 24, 72, 740).concat(wrapLines(S2, 24, 72, 700))]);
    const book = await importPdf(bytes, '我的书.pdf', undefined, runtime);
    expect(book.title).toBe('我的书');
  });

  it('explains a PDF with no text layer', async () => {
    const bytes = makePdf([[], []]);
    await expect(importPdf(bytes, 'scan.pdf', undefined, runtime)).rejects.toThrow(SCANNED_MESSAGE);
    await expect(importPdf(bytes, 'scan.pdf', undefined, runtime)).rejects.toThrow(/scanned images/);
  });

  it('reports a damaged PDF', async () => {
    await expect(importPdf(new TextEncoder().encode('%PDF-1.4\nnot really'), 'bad.pdf', undefined, runtime)).rejects.toThrow(/could not be read/);
  });
});

describe('importFile routes PDFs', () => {
  it('sends %PDF bytes to the PDF importer whatever the name says', async () => {
    const calls: string[] = [];
    vi.resetModules();
    vi.doMock('../../src/import/pdf', () => ({
      importPdf: async (_b: Uint8Array, name: string) => {
        calls.push(name);
        return {
          title: 'T', author: '', format: 'pdf', script: 'unknown', assets: new Map(),
          chapters: [{ title: 'c', blocks: [{ t: 'p', text: '这是一段足够长的中文文字，用来通过检查。' }] }],
        };
      },
    }));
    const { importFile } = await import('../../src/import');
    const book = await importFile(Object.assign(new Blob([new TextEncoder().encode('%PDF-1.7 rest')]), { name: 'book.dat' }));
    expect(calls).toEqual(['book.dat']);
    expect(book.script).not.toBe('');
    vi.doUnmock('../../src/import/pdf');
  });
});
