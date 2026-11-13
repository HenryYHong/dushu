// An app update keeps what the device stored, offline included (public/sw.js): a file whose content did not change is copied
// from the old cache with no download (content-hashes.json against the copy the last install kept), one that changed is
// fetched, one that cannot be fetched keeps its old copy; stroke-order data from jsDelivr is kept for good.
import { describe, expect, it } from 'vitest';
import { loadWorker } from './swHarness';

const OLD = 'dushu-static-old';
const url = (p: string) => `https://app.test/${p}`;
const old = (entries: Record<string, string>) => new Map(Object.entries(entries).map(([k, v]) => [k.startsWith('http') ? k : url(k), new Response(v)]));

describe('an update', () => {
  it('copies an unchanged file, fetches a changed one, and keeps the old copy of one it cannot fetch', async () => {
    const sw = loadWorker({
      online: true, realAdd: true, precache: ['assets/index-AbCd1234.js'],
      files: {
        '/content-hashes.json': { type: 'application/json', body: JSON.stringify({ 'fonts/Jigmo.woff2': 'a1', 'data/meta.json': 'm2', 'data/names.tsv.gz': 'n2' }) },
        '/fonts/Jigmo.woff2': { type: 'font/woff2', body: 'new jigmo' },
        '/data/meta.json': { type: 'application/json', body: 'new meta' },
      },
    });
    sw.stores.set(OLD, old({
      'fonts/Jigmo.woff2': 'old jigmo', 'data/meta.json': 'old meta', 'data/names.tsv.gz': 'old names',
      'content-hashes.json': JSON.stringify({ 'fonts/Jigmo.woff2': 'a1', 'data/meta.json': 'm1', 'data/names.tsv.gz': 'n1' }),
    }));
    await sw.install();
    const now = sw.stores.get('dushu-static-d')!;
    expect(await now.get(url('fonts/Jigmo.woff2'))!.clone().text()).toBe('old jigmo');
    expect(sw.requests.some((u) => u.endsWith('/fonts/Jigmo.woff2'))).toBe(false);
    expect(await now.get(url('data/meta.json'))!.clone().text()).toBe('new meta');
    // Gone from the server for now (a weak connection would do the same): the old copy stays, so the app still works offline.
    expect(await now.get(url('data/names.tsv.gz'))!.clone().text()).toBe('old names');
    // This build's fingerprints are kept for the next update.
    expect(JSON.parse(await now.get(url('content-hashes.json'))!.clone().text())).toMatchObject({ 'data/meta.json': 'm2' });
  });

  it('keeps an older language cache’s files in the new one', async () => {
    const sw = loadWorker({
      online: true, realAdd: true, langs: { es: 'v2' },
      files: { '/content-hashes.json': { type: 'application/json', body: JSON.stringify({ 'data/es/native.tsv.gz': 'x' }) } },
    });
    sw.stores.set('dushu-lang-es-v1', old({ 'data/es/native.tsv.gz': 'significados' }));
    sw.stores.set(OLD, old({ 'content-hashes.json': JSON.stringify({ 'data/es/native.tsv.gz': 'x' }) }));
    await sw.install();
    expect(await sw.stores.get('dushu-lang-es-v2')!.get(url('data/es/native.tsv.gz'))!.clone().text()).toBe('significados');
  });
});

describe('stroke order', () => {
  const STROKE = 'https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0.1/%E5%AD%A6.json';
  it('is kept when fetched, and answers offline from then on; an update does not clear it', async () => {
    const sw = loadWorker({ online: true, files: { '/npm/hanzi-writer-data@2.0.1/%E5%AD%A6.json': { type: 'application/json', body: '{"strokes":[]}' } } });
    expect(await (await sw.request(STROKE))!.text()).toBe('{"strokes":[]}');
    await new Promise((r) => setTimeout(r, 0));
    const kept = sw.stores.get('dushu-strokes-v1')!;
    expect(kept.has(STROKE)).toBe(true);
    const off = loadWorker({ online: false });
    off.stores.set('dushu-strokes-v1', new Map(kept));
    expect(await (await off.request(STROKE))!.text()).toBe('{"strokes":[]}');
    await off.activate();
    expect(off.stores.has('dushu-strokes-v1')).toBe(true);
  });
});
