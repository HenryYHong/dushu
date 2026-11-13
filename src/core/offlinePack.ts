// "Save for offline use" (Settings › Data): everything this library can use, stored on the device at once, so it works with no
// connection at all (an iPad on a plane), not only the parts already opened. The service worker (public/sw.js) does the storing:
// each file is fetched through it, and it keeps what it fetches (cache first), in the caches an app update carries over. This
// module only lists the files and fetches them, a few at a time, skipping what is already stored.
//
// For the library's language: every dictionary file (data/sizes.json lists them, the rare words and the own-language meanings
// included), every bundled classic and its cover, and for Chinese and Japanese the reading fonts (the stylesheet the page loaded
// and each font file it names) and Jigmo, the font for rare characters; for Chinese also the stroke order of every HSK character
// (from jsDelivr, which the service worker keeps too).
//
// What still needs the internet offline is said where it is used: sentence translation (but Chrome's on-device translator and
// the word-by-word gloss), finding new books, sync and signing in.
import type { LangId } from '../lang/types';

export interface PackFile {
  url: string;
  /** Its size when the build wrote it down (data/sizes.json), for the progress line; 0 when unknown. */
  size: number;
}

export interface PackProgress {
  done: number;
  total: number;
  /** Bytes fetched in this run (files already stored count 0). */
  bytes: number;
  failed: number;
}

const STROKES = 'https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0.1/';
const JIGMO = ['fonts/Jigmo.woff2', 'fonts/Jigmo2.woff2', 'fonts/Jigmo3.woff2'];

const at = (path: string, base: string): string => new URL(path, base).href;

async function json<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    return res.ok ? (await res.json()) as T : null;
  } catch {
    return null;
  }
}

/** The font files a stylesheet names (url(...) of each @font-face), as absolute addresses. */
export function fontUrlsOf(css: string, sheetUrl: string): string[] {
  const out = new Set<string>();
  for (const m of css.matchAll(/url\(\s*(['"]?)([^'")]+?\.woff2)\1\s*\)/g)) out.add(new URL(m[2], sheetUrl).href);
  return [...out];
}

/** The characters of the HSK word list (simplified and traditional), each once: what stroke order is saved for. */
export function hskCharacters(hskTsv: string): string[] {
  const out = new Set<string>();
  for (const line of hskTsv.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const [simp, trad] = line.split('\t');
    for (const ch of `${simp ?? ''}${trad ?? ''}`) if (/\p{Script=Han}/u.test(ch)) out.add(ch);
  }
  return [...out];
}

/**
 * Every file the `lang` library can use, for the app at `base` (document.baseURI). `readText` reads a data file as text, gzip
 * undone (core/dataFetch.ts fetchDataText: the HSK list, for stroke order). `doc` is where the reading fonts' stylesheet is
 * linked, when the page loaded it.
 */
export async function packFiles(lang: LangId, base: string, opts: {
  readText?: (url: string) => Promise<string>;
  doc?: Pick<Document, 'querySelectorAll'>;
} = {}): Promise<PackFile[]> {
  const files = new Map<string, number>();
  const add = (url: string, size = 0) => { if (!files.has(url)) files.set(url, size); };
  const dataDir = lang === 'zh' ? 'data/' : `data/${lang}/`;
  const sizes = await json<Record<string, number>>(at(`${dataDir}sizes.json`, base));
  for (const [name, size] of Object.entries(sizes ?? {})) add(at(dataDir + name, base), size);
  const sampleDir = lang === 'zh' ? 'samples/' : `samples/${lang}/`;
  add(at(`${sampleDir}index.json`, base));
  const samples = await json<{ file?: string; cover?: string }[]>(at(`${sampleDir}index.json`, base));
  for (const s of samples ?? []) {
    if (s.file) add(at(sampleDir + s.file, base));
    if (s.cover) add(at(sampleDir + s.cover, base));
  }
  if (lang === 'zh' || lang === 'ja') {
    for (const f of JIGMO) add(at(f, base));
    const sheets = [...(opts.doc?.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]') ?? [])].map((l) => l.href).filter((h) => /\/assets\/fonts-[^/]*\.css$/.test(h));
    for (const sheet of sheets) {
      add(sheet);
      try {
        const res = await fetch(sheet);
        if (res.ok) for (const u of fontUrlsOf(await res.text(), sheet)) add(u);
      } catch { /* the sheet is stored once read; its fonts are listed next time */ }
    }
  }
  if (lang === 'zh' && opts.readText) {
    try {
      for (const ch of hskCharacters(await opts.readText(at('data/hsk.tsv.gz', base)))) add(`${STROKES}${encodeURIComponent(ch)}.json`);
    } catch { /* no stroke order offline this time */ }
  }
  return [...files].map(([url, size]) => ({ url, size }));
}

/** Whether a file is already stored (any of the app's caches). */
async function stored(url: string): Promise<boolean> {
  try {
    return !!(await caches.match(url, { ignoreVary: true }));
  } catch {
    return false;
  }
}

/** How many of `files` are stored on this device already. */
export async function storedCount(files: readonly PackFile[]): Promise<number> {
  let n = 0;
  for (let i = 0; i < files.length; i += 50) {
    const got = await Promise.all(files.slice(i, i + 50).map((f) => stored(f.url)));
    n += got.filter(Boolean).length;
  }
  return n;
}

/**
 * Fetches every file not stored yet, `parallel` at a time, through the service worker (which keeps each one). Resolves with
 * the final progress; `signal` stops it (what was stored stays stored, and the next run goes on from there).
 */
export async function savePack(files: readonly PackFile[], onProgress: (p: PackProgress) => void,
  opts: { parallel?: number; signal?: AbortSignal } = {}): Promise<PackProgress> {
  const progress: PackProgress = { done: 0, total: files.length, bytes: 0, failed: 0 };
  let next = 0;
  const work = async () => {
    while (next < files.length && !opts.signal?.aborted) {
      const f = files[next++];
      try {
        if (!(await stored(f.url))) {
          const res = await fetch(f.url, { signal: opts.signal });
          // The bytes are read so the service worker's copy is complete before this counts as done.
          const body = await res.arrayBuffer();
          if (res.ok) progress.bytes += body.byteLength;
          else if (res.status !== 404) progress.failed++;
        }
      } catch {
        if (opts.signal?.aborted) break;
        progress.failed++;
      }
      progress.done++;
      onProgress({ ...progress });
    }
  };
  await Promise.all(Array.from({ length: opts.parallel ?? 6 }, work));
  // Ask the browser to keep it all (Safari clears a site's storage after weeks unused unless it is kept).
  try { await navigator.storage?.persist?.(); } catch { /* not offered */ }
  return progress;
}
