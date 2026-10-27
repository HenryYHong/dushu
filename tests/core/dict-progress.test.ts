// The dictionary download reports its bytes as they arrive, so the reader can say how far a slow first download has got.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadDictionary } from '../../src/core/dict';

const FILES: Record<string, string> = {
  'cedict.tsv.gz': '中國\t中国\tzhong1 guo2\tChina',
  'chars.tsv.gz': '中\tzhong1',
  'words.tsv.gz': '中国\t100',
  'hsk.tsv.gz': '中国\t中國\t1\t1\t5',
  't2s.tsv.gz': '國\t国',
  's2t.tsv.gz': '国\t國',
  'radicals.tsv.gz': '1\t⼀\t一',
  'meta.json': '{}',
};

afterEach(() => { vi.unstubAllGlobals(); });

describe('the dictionary download', () => {
  it('reports the bytes downloaded and their total, ending at the whole size', async () => {
    const enc = new TextEncoder();
    vi.stubGlobal('fetch', async (url: string) => {
      const body = FILES[url.split('/').pop()!];
      if (body === undefined) return new Response('', { status: 404 });
      const bytes = enc.encode(body);
      return new Response(bytes, { headers: { 'content-length': String(bytes.length), 'content-type': 'text/plain' } });
    });
    const seen: [number, number][] = [];
    const d = await loadDictionary('https://app.test/data/', { onBytes: (loaded, total) => seen.push([loaded, total]) });
    const whole = Object.values(FILES).reduce((n, b) => n + enc.encode(b).length, 0);
    expect(seen.at(-1)).toEqual([whole, whole]);
    for (let i = 1; i < seen.length; i++) expect(seen[i][0]).toBeGreaterThanOrEqual(seen[i - 1][0]);
    expect(seen.every(([loaded, total]) => loaded <= total)).toBe(true);
    expect(d.lookup('中国').map((e) => e.pinyin)).toEqual(['zhong1 guo2']);
  });
});
