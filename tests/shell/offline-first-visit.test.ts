// One visit, then offline: the dictionary a first visit downloads is handed to the offline copy in every language, filed
// where the worker looks for it, and a device that never opened Chinese does not download the Chinese dictionary. Also the
// page's side: what it hands over, and the download line's total.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { byteMeter, dataSizes, fetchDataBytes } from '../../src/core/dataFetch';
import { loadWorker } from './swHarness';

const gz = { type: 'application/gzip' };
const ES_FILES = {
  '/data/es/entries.tsv.gz': { ...gz, body: 'palabras', etag: '"e1"' },
  '/data/es/forms.tsv.gz': { ...gz, body: 'formas', etag: '"f1"' },
  '/data/es/meta.json': { type: 'application/json', body: '{}', etag: '"m1"' },
};
const ZH_FILES = {
  '/data/cedict.tsv.gz': { ...gz, body: 'words', etag: '"c1"' },
  '/data/chars.tsv.gz': { ...gz, body: 'chars', etag: '"h1"' },
  '/samples/tang-poems.txt': { type: 'text/plain', body: '靜夜思', etag: '"t1"' },
};
const PRECACHE = ['assets/index-AbCd1234.js', 'icon.svg', 'data/cedict.tsv.gz', 'data/chars.tsv.gz', 'samples/tang-poems.txt'];
const handed = (files: Record<string, { body: string; etag?: string }>) =>
  new Map(Object.entries(files).map(([path, f]) => [`https://app.test${path}`, new Response(f.body, { headers: f.etag ? { ETag: f.etag } : {} })]));

describe('installing after a first visit in Spanish', () => {
  async function installed() {
    const sw = loadWorker({ online: true, files: { ...ES_FILES, ...ZH_FILES }, precache: PRECACHE, langs: { es: 'v1' } });
    sw.stores.set('dushu-first-visit', handed(ES_FILES));
    await sw.install();
    return sw;
  }

  it('files the Spanish dictionary in the Spanish cache, asked whether it changed, not downloaded again', async () => {
    const sw = await installed();
    const es = sw.stores.get('dushu-lang-es-v1')!;
    expect([...es.keys()].sort()).toEqual(Object.keys(ES_FILES).map((p) => `https://app.test${p}`).sort());
    expect(await es.get('https://app.test/data/es/entries.tsv.gz')!.text()).toBe('palabras');
    expect(sw.added.filter((u) => u.includes('/data/es/'))).toEqual([]);
    expect(sw.stores.has('dushu-first-visit')).toBe(false);
  });

  it('never asks for the Chinese dictionary or classics', async () => {
    const sw = await installed();
    expect(sw.requests.filter((u) => /\/data\/[^/]+$|\/samples\/[^/]+$/.test(u))).toEqual([]);
    expect([...(sw.stores.get('dushu-static-d')?.keys() ?? [])].filter((u) => !u.includes('/fonts/'))).toEqual([]);
    // The app shell is precached as always.
    expect(sw.added).toContain('https://app.test/assets/index-AbCd1234.js');
  });

  it('reads the dictionary offline afterwards', async () => {
    const sw = await installed();
    const off = loadWorker({ online: false, strict: true, langs: { es: 'v1' } });
    off.stores.set('dushu-lang-es-v1', new Map(sw.stores.get('dushu-lang-es-v1')!));
    expect(await (await off.request('data/es/entries.tsv.gz'))!.text()).toBe('palabras');
  });

  it('asks again for a handed-over file the server gave no ETag, into the same cache (the browser has it fresh)', async () => {
    const files = { '/data/es/entries.tsv.gz': { ...gz, body: 'palabras' } };
    const sw = loadWorker({ online: true, files, precache: PRECACHE, langs: { es: 'v1' } });
    sw.stores.set('dushu-first-visit', handed(files));
    await sw.install();
    expect(sw.added).toContain('https://app.test/data/es/entries.tsv.gz');
    expect(sw.added.filter((u) => /\/data\/[^/]+$/.test(u))).toEqual([]);
  });
});

describe('the reading fonts\' rules', () => {
  const sheet = 'assets/fonts-Zx12Cv34.css';
  const files = { [`/${sheet}`]: { type: 'text/css', body: '@font-face{}' } };

  it('are not downloaded on a first visit in Spanish', async () => {
    const sw = loadWorker({ online: true, files, precache: PRECACHE, fontSheets: [sheet] });
    await sw.install();
    expect(sw.requests.some((u) => u.endsWith(sheet))).toBe(false);
  });

  it('are kept when a first visit in Chinese hands them over, and an update copies them instead of downloading', async () => {
    const sw = loadWorker({ online: true, files, precache: PRECACHE, fontSheets: [sheet] });
    sw.stores.set('dushu-first-visit', new Map([[`https://app.test/${sheet}`, new Response('@font-face{}')]]));
    await sw.install();
    expect(await sw.stores.get('dushu-app-t')!.get(`https://app.test/${sheet}`)!.clone().text()).toBe('@font-face{}');
    const next = loadWorker({ online: true, files, precache: PRECACHE, fontSheets: [sheet] });
    next.stores.set('dushu-app-old', new Map(sw.stores.get('dushu-app-t')!));
    await next.install();
    expect(next.requests.some((u) => u.endsWith(sheet))).toBe(false);
    expect(next.stores.get('dushu-app-t')!.has(`https://app.test/${sheet}`)).toBe(true);
  });
});

describe('installing after a first visit in Chinese', () => {
  it('keeps the handed-over dictionary in the static cache and precaches the rest of the Chinese files', async () => {
    const sw = loadWorker({ online: true, files: { ...ES_FILES, ...ZH_FILES }, precache: PRECACHE, langs: { es: 'v1' } });
    sw.stores.set('dushu-first-visit', handed({ '/data/cedict.tsv.gz': ZH_FILES['/data/cedict.tsv.gz'] }));
    await sw.install();
    const stat = sw.stores.get('dushu-static-d')!;
    expect(await stat.get('https://app.test/data/cedict.tsv.gz')!.text()).toBe('words');
    expect(sw.added).not.toContain('https://app.test/data/cedict.tsv.gz');
    // Not handed over (the classics, a file the page did not fetch): downloaded ahead as before, so they work offline too.
    expect(sw.added).toEqual(expect.arrayContaining(['https://app.test/data/chars.tsv.gz', 'https://app.test/samples/tang-poems.txt']));
    // Another language's dictionary is not.
    expect(sw.requests.some((u) => u.includes('/data/es/'))).toBe(false);
  });

  it('an update keeps precaching Chinese for a device whose previous offline copy had it', async () => {
    const sw = loadWorker({ online: true, files: ZH_FILES, precache: PRECACHE });
    sw.stores.set('dushu-static-old', handed({ '/data/cedict.tsv.gz': ZH_FILES['/data/cedict.tsv.gz'] }));
    await sw.install();
    expect(await sw.stores.get('dushu-static-d')!.get('https://app.test/data/cedict.tsv.gz')!.text()).toBe('words');
    expect(sw.added).toEqual(expect.arrayContaining(['https://app.test/data/chars.tsv.gz', 'https://app.test/samples/tang-poems.txt']));
  });
});

// ------------------------------------------------------------------------------------------------- the page ---

afterEach(() => { vi.unstubAllGlobals(); });

const serve = (files: Record<string, { type: string; body: string }>) => vi.stubGlobal('fetch', async (url: string) => {
  const f = files[new URL(url).pathname];
  if (!f) return new Response('<!doctype html><title>LinguPengu</title>', { status: 200, headers: { 'content-type': 'text/html' } });
  const bytes = new TextEncoder().encode(f.body);
  return new Response(bytes, { headers: { 'content-type': f.type, 'content-length': String(bytes.length) } });
});

describe('a data file the page downloads', () => {
  it('is handed over as it arrives, and an index.html in its place is refused and never kept', async () => {
    serve({ '/data/es/entries.tsv.gz': { ...gz, body: 'palabras' } });
    const kept: string[] = [];
    const keep = (url: string) => { kept.push(url); };
    expect(new TextDecoder().decode(await fetchDataBytes('https://app.test/data/es/entries.tsv.gz', keep))).toBe('palabras');
    await expect(fetchDataBytes('https://app.test/data/es/missing.tsv.gz', keep)).rejects.toThrow(/not a data file/);
    expect(kept).toEqual(['https://app.test/data/es/entries.tsv.gz']);
  });

  it('counts toward a total that is whole before the first byte, from the sizes the build wrote', async () => {
    serve({
      '/data/es/sizes.json': { type: 'application/json', body: JSON.stringify({ 'entries.tsv.gz': 8, 'forms.tsv.gz': 6, 'ipa.tsv.gz': 100 }) },
      '/data/es/entries.tsv.gz': { ...gz, body: 'palabras' },
      '/data/es/forms.tsv.gz': { ...gz, body: 'formas' },
    });
    const seen: [number, number][] = [];
    const meter = byteMeter((loaded, total) => seen.push([loaded, total]), dataSizes('https://app.test/data/es/'));
    // Both are asked for; one has not started yet (a browser queues requests), and still counts at its size.
    const entries = meter('entries.tsv.gz');
    meter('forms.tsv.gz');
    await new Promise((r) => setTimeout(r, 10));
    entries(0, 0);
    expect(seen.at(-1)).toEqual([0, 14]);
    entries(0, 8);
    expect(seen.at(-1)).toEqual([8, 14]);
  });

  it('without the sizes (the dev server), counts each file at its Content-Length once it starts', async () => {
    serve({ '/data/es/entries.tsv.gz': { ...gz, body: 'palabras' } });
    const seen: [number, number][] = [];
    const meter = byteMeter((loaded, total) => seen.push([loaded, total]), dataSizes('https://app.test/data/es/'));
    await fetchDataBytes('https://app.test/data/es/entries.tsv.gz', undefined, meter('entries.tsv.gz'));
    expect(seen[0]).toEqual([0, 8]);
    expect(seen.at(-1)).toEqual([8, 8]);
    expect(seen.every(([loaded, total]) => loaded <= total)).toBe(true);
  });
});
