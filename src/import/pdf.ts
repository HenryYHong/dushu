// PDF with a text layer, via pdf.js. Scanned PDFs (images only) are rejected with an explanation.
import type { ImportedBook } from '../types';
import { chaptersFromBlocks, paragraphsToBlocks } from './chapters';
import { ImportError } from './errors';
import { countHan } from './han';
import { cleanAuthors, cleanTitle, parseFilename } from './meta';
import { pagesToParagraphs, type PdfItem, type PdfPageItems } from './pdfLayout';

type PdfJs = typeof import('pdfjs-dist');

/** What importPdf needs from pdf.js: the module, and optionally a reader for its predefined CMaps. */
export interface PdfRuntime {
  pdfjs: PdfJs;
  cMapReaderFactory?: unknown;
}

export const SCANNED_MESSAGE =
  'This PDF has no text layer (it is scanned images), so there is no text to read. Run it through OCR to make a searchable PDF, or find an EPUB or text version, then import that.';

// Chinese PDFs often use predefined CMaps (GBK-EUC-H, UniGB-UCS2-H, B5pc-H, Adobe-GB1-UCS2 ...) to map
// font codes to characters. Bundle just those (only the URLs are in the code; each file is fetched on
// demand), so nothing comes from a CDN.
const CMAPS = import.meta.glob('/node_modules/pdfjs-dist/cmaps/{GB,UniGB,GBK,GBpc,GBT,B5,ETen,UniCNS,HK,CNS,Adobe-GB1,Adobe-CNS1,Ext,Add,H,V,Identity}*.bcmap', {
  query: '?url&no-inline',
  import: 'default',
  eager: true,
}) as Record<string, string>;

class BundledCMapReaderFactory {
  async fetch({ name }: { name: string }): Promise<{ cMapData: Uint8Array; isCompressed: boolean }> {
    const url = CMAPS[`/node_modules/pdfjs-dist/cmaps/${name}.bcmap`];
    if (!url) throw new Error(`Unable to load CMap ${name}`);
    const res = await fetch(url);
    return { cMapData: new Uint8Array(await res.arrayBuffer()), isCompressed: true };
  }
}

export const PDF_HOST_MESSAGE =
  'The PDF reader could not start. This is a problem with how Dushu is being served (its PDF worker file could not be loaded), not with your file. Reload the page and try again.';

/** True when a pdf.js failure is about loading its own worker or code, not about the file. */
export function isPdfHostFailure(e: unknown): boolean {
  const text = `${(e as { name?: string } | null)?.name ?? ''} ${(e as { message?: string } | null)?.message ?? e ?? ''}`;
  return /fake worker|worker|dynamically imported module|importing a module script|module script|failed to fetch|loading chunk|MIME type|NetworkError/i.test(text);
}

async function loadRuntime(): Promise<PdfRuntime> {
  try {
    const pdfjs = await import('pdfjs-dist');
    const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    return { pdfjs, cMapReaderFactory: BundledCMapReaderFactory };
  } catch {
    throw new ImportError(PDF_HOST_MESSAGE);
  }
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function usableMetadata(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s || s.includes('\ufffd') || /^(?:untitled|microsoft word)/i.test(s) || /\.(?:docx?|indd|pdf|tex|pages)$/i.test(s)) return '';
  return s;
}

export async function importPdf(
  data: Uint8Array,
  sourceName: string,
  onProgress?: (fraction: number) => void,
  runtime?: PdfRuntime,
): Promise<ImportedBook> {
  const { pdfjs, cMapReaderFactory } = runtime ?? (await loadRuntime());
  // pdf.js transfers the buffer to its worker, so hand it a copy.
  const task = pdfjs.getDocument({
    data: data.slice(),
    isEvalSupported: false,
    verbosity: 0,
    ...(cMapReaderFactory ? { CMapReaderFactory: cMapReaderFactory as never, cMapPacked: true } : {}),
  });
  let pdf;
  try {
    pdf = await task.promise;
  } catch (e) {
    const name = (e as { name?: string }).name;
    if (name === 'PasswordException') throw new ImportError('This PDF is password protected. Remove the password and import it again.');
    if (isPdfHostFailure(e)) throw new ImportError(PDF_HOST_MESSAGE);
    throw new ImportError('This PDF could not be read. It may be damaged.');
  }

  try {
    const pages: PdfPageItems[] = [];
    let chars = 0;
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const [x0, y0, x1, y1] = page.view;
      const content = await page.getTextContent();
      const items: PdfItem[] = [];
      for (const raw of content.items) {
        if (!('str' in raw) || !raw.str) continue;
        const t = raw.transform as number[];
        const vertical = !!content.styles[raw.fontName]?.vertical;
        items.push({
          str: raw.str,
          x: t[4],
          y: t[5],
          w: vertical ? raw.height : raw.width,
          size: (vertical ? Math.hypot(t[0], t[1]) : Math.hypot(t[2], t[3])) || raw.height,
          vertical,
        });
        chars += raw.str.replace(/\s/g, '').length;
      }
      pages.push({ width: x1 - x0, height: y1 - y0, items });
      page.cleanup();
      if (n === 10 && chars === 0) throw new ImportError(SCANNED_MESSAGE);
      onProgress?.(0.9 * (n / pdf.numPages));
      if (n % 5 === 0) await tick();
    }
    if (chars < 20) throw new ImportError(SCANNED_MESSAGE);

    const paragraphs = pagesToParagraphs(pages);
    const meta = await pdf.getMetadata().catch(() => null);
    const info = (meta?.info ?? {}) as Record<string, unknown>;
    const fromFile = parseFilename(sourceName);
    const metaTitle = usableMetadata(info.Title);
    const title = cleanTitle(countHan(fromFile.title) > 0 && countHan(metaTitle) === 0 ? fromFile.title : metaTitle || fromFile.title) || 'Untitled';
    const author = cleanAuthors([usableMetadata(info.Author)]);
    onProgress?.(0.97);
    return {
      title,
      author,
      format: 'pdf',
      script: 'unknown',
      chapters: chaptersFromBlocks(paragraphsToBlocks(paragraphs), { title }),
      assets: new Map(),
      sourceName,
    };
  } finally {
    await pdf.destroy();
  }
}
