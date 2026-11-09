// @vitest-environment jsdom
// Books from outside the app (ui/library/incoming.ts): what sw.js kept from a share is taken once, with its file names and types,
// and files opened with the installed app wait for the library.
import { afterEach, describe, expect, it, vi } from 'vitest';

function fakeCaches() {
  const stores = new Map<string, Map<string, Response>>();
  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name)!;
    return { put: async (k: string, r: Response) => { m.set(k, r); }, match: async (k: string) => m.get(k)?.clone() };
  };
  return { stores, api: { open, has: async (n: string) => stores.has(n), delete: async (n: string) => stores.delete(n) } };
}

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('books from outside the app', () => {
  it('takes what was shared once, files with their names, and the text and link', async () => {
    const { stores, api } = fakeCaches();
    vi.stubGlobal('caches', api);
    const c = await api.open('dushu-shared');
    await c.put('./shared/file-0', new Response(new Blob(['PK…']), { headers: { 'Content-Type': 'application/epub+zip', 'X-Name': encodeURIComponent('坊っちゃん.epub') } }));
    await c.put('./shared/meta', new Response(JSON.stringify({ files: 1, title: 'A book', text: 'look https://www.gutenberg.org/ebooks/17340', url: '' })));
    const { takeIncoming } = await import('../../src/ui/library/incoming');
    const got = await takeIncoming();
    expect(got?.files.map((f) => [f.name, f.type])).toEqual([['坊っちゃん.epub', 'application/epub+zip']]);
    expect(got).toMatchObject({ title: 'A book', text: 'look https://www.gutenberg.org/ebooks/17340' });
    expect(stores.has('dushu-shared')).toBe(false);
    expect(await takeIncoming()).toBeNull();
  });

  it('keeps files opened with the app until the library asks', async () => {
    let consumer: ((p: { files: { getFile(): Promise<File> }[] }) => void) | undefined;
    vi.stubGlobal('launchQueue', { setConsumer: (fn: typeof consumer) => { consumer = fn; } });
    vi.stubGlobal('caches', fakeCaches().api);
    const { listenForOpenedFiles, takeIncoming, INCOMING_EVENT } = await import('../../src/ui/library/incoming');
    listenForOpenedFiles();
    const heard = new Promise((ok) => window.addEventListener(INCOMING_EVENT, ok, { once: true }));
    consumer!({ files: [{ getFile: async () => new File(['x'], 'book.epub') }] });
    await heard;
    expect((await takeIncoming())?.files.map((f) => f.name)).toEqual(['book.epub']);
  });
});
