// "Save for offline use" (core/offlinePack.ts): the files a library can use, listed from what the build wrote down, and fetched
// through the service worker a few at a time, skipping what is stored.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fontUrlsOf, hskCharacters, packFiles, savePack } from '../../src/core/offlinePack';

const BASE = 'https://example.org/dushu/';
afterEach(() => { vi.unstubAllGlobals(); });

function serve(files: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const path = String(url).replace(BASE, '');
    if (!(path in files)) return new Response('', { status: 404 });
    const v = files[path];
    return new Response(typeof v === 'string' ? v : JSON.stringify(v), { status: 200 });
  }));
}

describe('the list', () => {
  it('reads the fonts a stylesheet names, once each, relative to it', () => {
    const css = '@font-face{src:url(./noto-a.woff2) format("woff2")}@font-face{src:url("noto-b.woff2")}@font-face{src:url(./noto-a.woff2)}';
    expect(fontUrlsOf(css, `${BASE}assets/fonts-x.css`)).toEqual([`${BASE}assets/noto-a.woff2`, `${BASE}assets/noto-b.woff2`]);
  });

  it('takes the HSK words’ characters, simplified and traditional, each once', () => {
    expect(hskCharacters('# head\n学习\t學習\t1\n习惯\t習慣\t2\n')).toEqual(['学', '习', '學', '習', '惯', '慣']);
  });

  it('a Spanish library: every dictionary file and every classic with its cover, nothing for fonts', async () => {
    serve({
      'data/es/sizes.json': { 'entries.tsv.gz': 100, 'native.tsv.gz': 50 },
      'samples/es/index.json': [{ file: 'platero.md', cover: 'covers/platero.jpg' }, { file: 'quijote.md' }],
    });
    const files = await packFiles('es', BASE);
    expect(files.map((f) => f.url.replace(BASE, ''))).toEqual([
      'data/es/entries.tsv.gz', 'data/es/native.tsv.gz', 'samples/es/index.json', 'samples/es/platero.md', 'samples/es/covers/platero.jpg', 'samples/es/quijote.md',
    ]);
    expect(files[0].size).toBe(100);
  });

  it('the Chinese library: the top-level data, the classics, Jigmo, the reading fonts and HSK stroke order', async () => {
    serve({
      'data/sizes.json': { 'cedict.tsv.gz': 10, 'names.tsv.gz': 5 },
      'samples/index.json': [{ file: 'tang-poems.txt', cover: 'covers/tang-poems.jpg' }],
      'assets/fonts-1.css': '@font-face{src:url(./slice-1.woff2)}',
    });
    const doc = { querySelectorAll: () => [{ href: `${BASE}assets/fonts-1.css` }, { href: `${BASE}assets/index-2.css` }] } as unknown as Document;
    const files = await packFiles('zh', BASE, { doc, readText: async () => '学\t學\t1\n' });
    const paths = files.map((f) => f.url.replace(BASE, ''));
    expect(paths).toEqual(expect.arrayContaining(['data/cedict.tsv.gz', 'data/names.tsv.gz', 'samples/tang-poems.txt', 'samples/covers/tang-poems.jpg',
      'fonts/Jigmo.woff2', 'assets/fonts-1.css', 'assets/slice-1.woff2']));
    expect(paths).not.toContain('assets/index-2.css');
    expect(paths.filter((p) => p.includes('hanzi-writer-data'))).toEqual([
      'https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0.1/%E5%AD%A6.json', 'https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0.1/%E5%AD%B8.json']);
  });
});

describe('saving', () => {
  it('fetches only what is not stored, counts the bytes, and a 404 (no strokes for a character) is no failure', async () => {
    const asked: string[] = [];
    vi.stubGlobal('caches', { match: async (url: string) => (url.endsWith('stored.gz') ? new Response('x') : undefined) });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      asked.push(url);
      if (url.endsWith('missing.json')) return new Response('', { status: 404 });
      if (url.endsWith('broken.gz')) return new Response('', { status: 500 });
      return new Response('12345', { status: 200 });
    }));
    const seen: number[] = [];
    const r = await savePack(['a/stored.gz', 'a/new.gz', 'a/missing.json', 'a/broken.gz'].map((url) => ({ url, size: 0 })), (p) => seen.push(p.done), { parallel: 2 });
    expect(asked.sort()).toEqual(['a/broken.gz', 'a/missing.json', 'a/new.gz']);
    expect(r).toEqual({ done: 4, total: 4, bytes: 5, failed: 1 });
    expect(seen.sort()).toEqual([1, 2, 3, 4]);
  });
});
