// @vitest-environment jsdom
// Defensive limits on what a file can do to the app: size caps, zip bombs, giant blocks, markup and control characters
// in titles, binary files named .txt, and error text that blames the right thing. All fixtures are small and generated.
import { strToU8, zipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { importFile, importText, MAX_FILE_BYTES } from '../../src/import';
import { splitLongParagraph, textToBlocks } from '../../src/import/chapters';
import { plausibleText, stripBidi, decodeText } from '../../src/import/encoding';
import { ImportError } from '../../src/import/errors';
import { cleanAuthors, cleanTitle } from '../../src/import/meta';
import { isPdfHostFailure, importPdf, PDF_HOST_MESSAGE, PDF_OFFLINE_MESSAGE, type PdfRuntime } from '../../src/import/pdf';
import { Archive, DAMAGED_MESSAGE, TOO_BIG_MESSAGE, ZIP_LIMITS } from '../../src/import/zip';
import { buildMobi } from './mobiWriter';
import { CONTAINER, PNG, asFile, makeEpub, opf, prose, xhtml } from './helpers';

/** Rewrite the uncompressed size a zip declares for every entry (central directory and local headers). */
function forgeSizes(zip: Uint8Array, size: number): Uint8Array {
  const out = zip.slice();
  const dv = new DataView(out.buffer);
  for (let i = 0; i + 4 <= out.length; i++) {
    const sig = dv.getUint32(i, true);
    if (sig === 0x02014b50 && i + 28 <= out.length) dv.setUint32(i + 24, size, true);
    else if (sig === 0x04034b50 && i + 26 <= out.length && (dv.getUint16(i + 6, true) & 8) === 0) dv.setUint32(i + 22, size, true);
  }
  return out;
}

describe('zip limits', () => {
  const book = () =>
    makeEpub({
      'META-INF/container.xml': CONTAINER('content.opf'),
      'content.opf': opf({ title: '书', manifest: [['a', 'a.xhtml', 'application/xhtml+xml']], spine: ['a'] }),
      'a.xhtml': xhtml(`<p>${prose(300)}</p>`),
    });

  it('imports a normal book through the bounded reader', async () => {
    const b = await importFile(asFile(book(), 'ok.epub'));
    expect(b.chapters.length).toBeGreaterThan(0);
  });

  it('refuses a book that declares more than the total limit before inflating anything', () => {
    const forged = forgeSizes(book(), Math.floor(ZIP_LIMITS.totalBytes / 2) + 1);
    expect(() => new Archive(forged)).toThrow(TOO_BIG_MESSAGE);
  });

  it('turns a declared size past the limit into a plain error, not a crash', async () => {
    const forged = forgeSizes(book(), 0xfffffff0);
    const err = await importFile(asFile(forged, 'bomb.epub')).catch((e) => e);
    expect(err).toBeInstanceOf(ImportError);
    expect(err.message).toBe(TOO_BIG_MESSAGE);
  });

  it('refuses one markup file over the per-file limit with its own message', async () => {
    const entries: Record<string, Uint8Array> = {
      'META-INF/container.xml': strToU8(CONTAINER('content.opf')),
      'content.opf': strToU8(opf({ title: '书', manifest: [['a', 'a.xhtml', 'application/xhtml+xml']], spine: ['a'] })),
      'a.xhtml': strToU8(xhtml(`<p>${prose(300)}</p>`)),
    };
    // Declares 100 MB for the chapter (over the 64 MB text limit, under the 300 MB total).
    const forged = forgeSizes(zipSync(entries), 100 * 1024 * 1024);
    const err = await importFile(asFile(forged, 'big-chapter.epub')).catch((e) => e);
    expect(err).toBeInstanceOf(ImportError);
    expect(err.message).toMatch(/too large|too big/);
  });

  it('a forged smaller size gives a damaged entry, never more memory than declared', async () => {
    const forged = forgeSizes(book(), 10);
    const err = await importFile(asFile(forged, 'forged.epub')).catch((e) => e);
    expect(err).toBeInstanceOf(ImportError);
  });

  it('only inflates what the book lists', () => {
    const zip = zipSync({
      'META-INF/container.xml': strToU8('x'),
      'junk/never-read.bin': new Uint8Array(1000),
    });
    const archive = new Archive(zip);
    archive.inflate(['META-INF/container.xml'], { maxBytes: 100 });
    expect(archive.get('META-INF/container.xml')).toBeDefined();
    expect(archive.get('junk/never-read.bin')).toBeUndefined();
  });

  it('stops listing at the entry limit', () => {
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i < ZIP_LIMITS.entries + 5; i++) files[`f${i}`] = new Uint8Array(0);
    expect(() => new Archive(zipSync(files))).toThrow(TOO_BIG_MESSAGE);
  });

  it('says damaged for a truncated or bit-flipped archive', async () => {
    const zip = book();
    const cut = await importFile(asFile(zip.slice(0, Math.floor(zip.length / 2)), 'cut.epub')).catch((e) => e);
    expect(cut).toBeInstanceOf(ImportError);
    expect(cut.message).toMatch(/damaged or incomplete/);
    const flipped = zip.slice();
    flipped[0] ^= 0xff;
    const flip = await importFile(asFile(flipped, 'flip.epub')).catch((e) => e);
    expect(flip.message).toBe(DAMAGED_MESSAGE);
  });

  it('refuses a file over the size cap before reading it', async () => {
    const huge = { name: 'x.txt', size: MAX_FILE_BYTES + 1, arrayBuffer: () => { throw new Error('must not be read'); } } as unknown as Blob & { name: string };
    await expect(importFile(huge)).rejects.toThrow(/larger than 200 MB/);
  });
});

describe('very long blocks', () => {
  const noPunct = '山水云烟花鸟虫鱼风雨雷电'.repeat(5000); // 60,000 characters, no punctuation at all
  const maxLen = (blocks: { t: string; text?: string }[]) => Math.max(...blocks.map((b) => [...(b.text ?? '')].length));

  it('cuts a 60,000-character block with no punctuation into small blocks and loses nothing', () => {
    const pieces = splitLongParagraph(noPunct);
    expect(pieces.join('')).toBe(noPunct);
    expect(pieces.length).toBeGreaterThan(30);
    for (const p of pieces) expect([...p].length).toBeLessThanOrEqual(3000);
  });

  it('prefers commas, semicolons and spaces when the text has them but no sentence ends', () => {
    const clause = '他走到桌边拿起书看了一会儿';
    const text = Array.from({ length: 800 }, () => clause).join('，');
    const pieces = splitLongParagraph(text);
    expect(pieces.join('')).toBe(text);
    for (const p of pieces.slice(0, -1)) expect(p.endsWith('，')).toBe(true);
    const spaced = Array.from({ length: 800 }, () => 'word').join(' ');
    const sp = splitLongParagraph(spaced);
    expect(sp.join('')).toBe(spaced);
    for (const p of sp.slice(0, -1)) expect(p.endsWith(' ')).toBe(true);
  });

  it('never splits a surrogate pair', () => {
    const text = '𠀀'.repeat(7000);
    const pieces = splitLongParagraph(text);
    expect(pieces.join('')).toBe(text);
    for (const p of pieces) expect([...p].join('')).toBe(p);
  });

  it('leaves an ordinary paragraph alone', () => {
    const p = prose(2900);
    expect(splitLongParagraph(p)).toEqual([p]);
  });

  it('applies to pasted text, TXT files and EPUB pages alike', async () => {
    const pasted = importText(noPunct, '书').chapters.flatMap((c) => c.blocks);
    expect(maxLen(pasted)).toBeLessThanOrEqual(3000);
    const txt = await importFile(asFile(new TextEncoder().encode(noPunct), 'long.txt'));
    expect(maxLen(txt.chapters.flatMap((c) => c.blocks))).toBeLessThanOrEqual(3000);
    const epub = await importFile(
      asFile(
        makeEpub({
          'META-INF/container.xml': CONTAINER('content.opf'),
          'content.opf': opf({ title: '书', manifest: [['a', 'a.xhtml', 'application/xhtml+xml']], spine: ['a'] }),
          'a.xhtml': xhtml(`<p>${noPunct}</p>`),
        }),
        'long.epub',
      ),
    );
    expect(maxLen(epub.chapters.flatMap((c) => c.blocks))).toBeLessThanOrEqual(3000);
  });

  it('handles a comma-only block of 200,000 characters quickly', () => {
    const t0 = Date.now();
    const blocks = textToBlocks(Array.from({ length: 20000 }, () => '一二三四五六七八九').join('，'));
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(maxLen(blocks)).toBeLessThanOrEqual(3000);
  });
});

describe('titles, authors and control characters', () => {
  it('caps a title and an author at 200 characters', () => {
    expect([...cleanTitle('长'.repeat(3000))].length).toBe(200);
    expect([...cleanAuthors(['名'.repeat(3000)])].length).toBeLessThanOrEqual(200);
    expect(cleanTitle('𠀀'.repeat(500))).toBe('𠀀'.repeat(200));
  });

  it('keeps markup out of authors', () => {
    expect(cleanAuthors(['<script>alert(1)</script>, 金庸'])).toBe('金庸');
    expect(cleanAuthors(['<script>…<, script>'])).toBe('');
    expect(cleanAuthors(['a < b'])).toBe('');
    expect(cleanAuthors(['<b>余华</b>'])).toBe('余华');
  });

  it('removes bidirectional controls from titles, authors, chapter titles and text', async () => {
    const rlo = '‮';
    const book = importText(`第一章 开始${rlo}\n\n${prose(80)}${rlo}⁦隐藏⁩\n`, `书${rlo}名`, `作${rlo}者`);
    const all = JSON.stringify(book);
    expect(all).not.toMatch(/[‪-‮⁦-⁩]/);
    expect(book.title).toBe('书名');
    expect(book.author).toBe('作者');
    expect(stripBidi('a‮b⁧c‎d')).toBe('abcd');
    const epub = await importFile(
      asFile(
        makeEpub({
          'META-INF/container.xml': CONTAINER('content.opf'),
          'content.opf': opf({ title: `书‮名`, creators: ['作‭者'], manifest: [['a', 'a.xhtml', 'application/xhtml+xml']], spine: ['a'] }),
          'a.xhtml': xhtml(`<h1>第一章‮</h1><p>${prose(120)}‮</p>`),
        }),
        'bidi.epub',
      ),
    );
    expect(JSON.stringify({ ...epub, assets: undefined })).not.toMatch(/[‪-‮⁦-⁩]/);
  });

  it('a long EPUB title does not come through whole', async () => {
    const epub = await importFile(
      asFile(
        makeEpub({
          'META-INF/container.xml': CONTAINER('content.opf'),
          'content.opf': opf({ title: '书'.repeat(3000), manifest: [['a', 'a.xhtml', 'application/xhtml+xml']], spine: ['a'] }),
          'a.xhtml': xhtml(`<p>${prose(200)}</p>`),
        }),
        'longtitle.epub',
      ),
    );
    expect([...epub.title].length).toBeLessThanOrEqual(200);
  });
});

describe('binary files', () => {
  function randomBytes(n: number): Uint8Array {
    // A fixed generator, so the test is the same on every run.
    let s = 12345;
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      s = (Math.imul(s, 1103515245) + 12345) >>> 0;
      out[i] = s >>> 24;
    }
    return out;
  }

  it('rejects 200 KB of random bytes named .txt', async () => {
    const err = await importFile(asFile(randomBytes(200_000), 'noise.txt')).catch((e) => e);
    expect(err).toBeInstanceOf(ImportError);
    expect(err.message).toMatch(/does not look like text/);
  });

  it('rejects bytes full of zeros', async () => {
    const bytes = new Uint8Array(5000);
    bytes.set(strToU8('abc'), 0);
    await expect(importFile(asFile(bytes, 'zero.txt'))).rejects.toThrow(/does not look like text/);
  });

  it('still accepts real GB18030 and Big5 text', async () => {
    // jsdom brings iconv-lite along; it writes the legacy encodings that TextEncoder cannot.
    const { createRequire } = await import('node:module');
    const iconv = createRequire(import.meta.url)('iconv-lite') as { encode(s: string, enc: string): Uint8Array };
    const sample = prose(3000, 2);
    for (const enc of ['gb18030', 'big5']) {
      const bytes = iconv.encode(sample, enc);
      expect(plausibleText(bytes, decodeText(bytes)), enc).toBe(true);
      const book = await importFile(asFile(bytes, `${enc}.txt`));
      expect(book.chapters.length).toBeGreaterThan(0);
    }
  });
});

describe('error text', () => {
  const html = '<p>' + '中文'.repeat(40) + '</p>';

  it('MOBI with a damaged record table is called damaged, not unsupported compression', async () => {
    const good = buildMobi(`<html><body>${html}</body></html>`, { images: [PNG, PNG, PNG] });
    const dv = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
    const count = dv(good).getUint16(76);
    expect(count).toBeGreaterThan(4);

    const first = good.slice();
    dv(first).setUint32(78 + 8, dv(first).getUint32(78)); // record 1 starts where record 0 starts
    const back = good.slice();
    dv(back).setUint32(78 + 3 * 8, dv(back).getUint32(78 + 2 * 8) - 1); // record 3 starts before record 2
    for (const bad of [first, back]) {
      const err = await importFile(asFile(bad, 'bad.mobi')).catch((e) => e);
      expect(err).toBeInstanceOf(ImportError);
      expect(err.message).not.toMatch(/compression/);
      expect(err.message).toMatch(/damaged/);
    }
  });

  it('tells a PDF worker that cannot load apart from a damaged PDF', async () => {
    const hostError = Object.assign(new Error('Setting up fake worker failed: "Failed to fetch dynamically imported module: http://x/pdf.worker.mjs".'), { name: 'UnknownErrorException' });
    expect(isPdfHostFailure(hostError)).toBe(true);
    expect(isPdfHostFailure(Object.assign(new Error('Invalid PDF structure.'), { name: 'InvalidPDFException' }))).toBe(false);
    const runtime = {
      pdfjs: { getDocument: () => ({ promise: Promise.reject(hostError) }) },
    } as unknown as PdfRuntime;
    // The server answers, so the worker file itself is the problem.
    vi.stubGlobal('fetch', async () => new Response(null, { status: 200 }));
    try {
      await expect(importPdf(new Uint8Array(20), 'x.pdf', undefined, runtime)).rejects.toThrow(PDF_HOST_MESSAGE);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  describe('offline', () => {
    afterEach(() => { vi.unstubAllGlobals(); });
    const hostError = Object.assign(new Error('Setting up fake worker failed: "Failed to fetch dynamically imported module: http://x/pdf.worker.mjs".'), { name: 'UnknownErrorException' });
    const runtime = { pdfjs: { getDocument: () => ({ promise: Promise.reject(hostError) }) } } as unknown as PdfRuntime;

    it('says a PDF needs a connection the first time when the device is offline, not that Dushu is served wrong', async () => {
      vi.stubGlobal('navigator', { ...navigator, onLine: false });
      const err = await importPdf(new Uint8Array(20), 'x.pdf', undefined, runtime).catch((e) => e);
      expect(err).toBeInstanceOf(ImportError);
      expect(err.message).toBe(PDF_OFFLINE_MESSAGE);
      expect(err.message).toBe('PDF import needs a connection the first time. Connect once and try again.');
    });

    it('says the same when the browser thinks it is online but the server does not answer (a Mac asleep)', async () => {
      const calls: string[] = [];
      vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => { calls.push(init?.method ?? 'GET'); throw new TypeError('Failed to fetch'); });
      await expect(importPdf(new Uint8Array(20), 'x.pdf', undefined, runtime)).rejects.toThrow(PDF_OFFLINE_MESSAGE);
      // A HEAD request: the service worker answers GET only, so it cannot hide that the server is gone.
      expect(calls).toEqual(['HEAD']);
    });

    it('says the same when the PDF reader\'s own code cannot load', async () => {
      vi.stubGlobal('navigator', { ...navigator, onLine: false });
      vi.resetModules();
      vi.doMock('../../src/import/pdf', () => { throw new TypeError('Failed to fetch dynamically imported module: http://x/assets/pdf-abc.js'); });
      try {
        const fresh = await import('../../src/import');
        const err = await fresh.importFile(asFile(new TextEncoder().encode('%PDF-1.4\n'), 'book.pdf')).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(fresh.ImportError);
        expect((err as Error).message).toBe(PDF_OFFLINE_MESSAGE);
      } finally {
        vi.doUnmock('../../src/import/pdf');
        vi.resetModules();
      }
    });
  });
});
