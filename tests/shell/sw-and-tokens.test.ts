// The service worker, run against fake caches, and the color tokens, parsed from tokens.css.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..', '..');
const swSource = readFileSync(join(root, 'public/sw.js'), 'utf8');

type Handler = (event: unknown) => void;

/** Loads sw.js with a fake browser. `strict` makes a cache lookup miss unless it passes ignoreVary, like a host that sends Vary: Origin. */
function loadWorker(opts: { online: boolean; strict?: boolean; files?: Record<string, { type: string; body: string; etag?: string }>; precache?: string[] }) {
  const handlers: Record<string, Handler> = {};
  const stores = new Map<string, Map<string, Response>>();
  const lookups: Array<Record<string, unknown> | undefined> = [];
  const added: string[] = [];
  const files = opts.files ?? {};
  let fetched = 0;
  const inits: (RequestInit | undefined)[] = [];
  const key = (r: Request | string) => new URL(typeof r === 'string' ? r : r.url, 'https://app.test/').href;
  const makeCache = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name)!;
    return {
      match: async (r: Request | string, o?: { ignoreVary?: boolean; ignoreSearch?: boolean }) => {
        lookups.push(o);
        if (opts.strict && !o?.ignoreVary) return undefined;
        const k = key(r);
        const hit = m.get(o?.ignoreSearch ? k.split('?')[0] : k) ?? m.get(k);
        return hit?.clone();
      },
      put: async (r: Request | string, res: Response) => { m.set(key(r), res); },
      add: async (r: Request | string) => { added.push(key(r)); },
    };
  };
  const fakeCaches = {
    open: async (n: string) => makeCache(n),
    keys: async () => [...stores.keys()],
    delete: async (n: string) => stores.delete(n),
    match: async (r: Request | string, o?: { ignoreVary?: boolean }) => {
      lookups.push(o);
      if (opts.strict && !o?.ignoreVary) return undefined;
      for (const m of stores.values()) { const h = m.get(key(r)); if (h) return h.clone(); }
      return undefined;
    },
  };
  const fakeFetch = async (r: Request | string, init?: RequestInit) => {
    fetched++;
    inits.push(init);
    if (!opts.online) throw new TypeError('Failed to fetch');
    const f = files[new URL(typeof r === 'string' ? r : r.url).pathname];
    if (!f) return new Response('nope', { status: 404 });
    const asked = new Headers(init?.headers ?? (typeof r === 'string' ? undefined : r.headers)).get('If-None-Match');
    if (f.etag && asked === f.etag) return new Response(null, { status: 304 });
    return new Response(f.body, { status: 200, headers: { 'content-type': f.type, ...(f.etag ? { ETag: f.etag } : {}) } });
  };
  const self = {
    registration: { scope: 'https://app.test/' },
    location: { origin: 'https://app.test' },
    addEventListener: (t: string, fn: Handler) => { handlers[t] = fn; },
    skipWaiting() {}, clients: { claim: async () => {} },
  };
  const src = swSource.replace('__BUILD__', 't').replace('__DATA_VERSION__', 'd').replace('__PRECACHE__', JSON.stringify(opts.precache ?? []));
  // A worker resolves a relative Request against its own URL.
  const SwRequest = class extends Request { constructor(input: string, init?: RequestInit) { super(new URL(input, 'https://app.test/').href, init); } };
  new Function('self', 'caches', 'fetch', 'Request', src)(self, fakeCaches, fakeFetch, SwRequest);
  async function request(path: string, init: { navigate?: boolean } = {}): Promise<Response | undefined> {
    const url = new URL(path, 'https://app.test/').href;
    const mode = init.navigate ? 'navigate' : 'cors';
    let answer: Promise<Response> | undefined;
    handlers.fetch({ request: { method: 'GET', url, mode, headers: new Headers() }, respondWith: (p: Promise<Response>) => { answer = Promise.resolve(p); } });
    return answer;
  }
  async function install(): Promise<void> {
    let done: Promise<unknown> = Promise.resolve();
    handlers.install({ waitUntil: (p: Promise<unknown>) => { done = p; } });
    await done;
  }
  return { request, install, stores, lookups, added, handlers, inits, get fetched() { return fetched; } };
}

describe('service worker', () => {
  it('finds cached files even when the host sends Vary: Origin (every lookup ignores Vary)', async () => {
    const files = { '/assets/vocab-abc.js': { type: 'text/javascript', body: 'export const x = 1;' } };
    const sw = loadWorker({ online: true, strict: true, files });
    expect(await (await sw.request('assets/vocab-abc.js'))!.text()).toContain('export');
    // Now offline: the stored copy must still be found.
    const off = loadWorker({ online: false, strict: true });
    off.stores.set('dushu-app-t', new Map([['https://app.test/assets/vocab-abc.js', new Response('export const x = 1;')]]));
    off.stores.set('dushu-app-t', new Map(sw.stores.get('dushu-app-t')!));
    const res = await off.request('assets/vocab-abc.js');
    expect(await res!.text()).toContain('export');
    for (const o of off.lookups) expect(o?.ignoreVary).toBe(true);
    expect(off.lookups.length).toBeGreaterThan(0);
  });

  it('serves the stored app shell when offline, with Vary ignored', async () => {
    const sw = loadWorker({ online: false, strict: true });
    sw.stores.set('dushu-app-t', new Map([['https://app.test/', new Response('<!doctype html><title>Dushu</title>', { headers: { 'content-type': 'text/html' } })]]));
    const res = await sw.request('', { navigate: true });
    expect(await res!.text()).toContain('Dushu');
  });

  it('does not let a navigation to another file replace the stored app shell', async () => {
    const files = {
      '/': { type: 'text/html; charset=utf-8', body: '<!doctype html><title>Dushu</title>' },
      '/manifest.webmanifest': { type: 'application/manifest+json', body: '{"name":"Dushu"}' },
    };
    const sw = loadWorker({ online: true, files });
    await sw.request('', { navigate: true });
    // The page is asked of the server, never reused from the browser's cache (GitHub Pages lets it be for 10 minutes).
    expect(sw.inits.at(-1)).toMatchObject({ cache: 'no-cache' });
    await new Promise((r) => setTimeout(r, 10));
    const shell = () => sw.stores.get('dushu-app-t')?.get('https://app.test/');
    expect(shell()?.headers.get('content-type')).toContain('text/html');
    await sw.request('manifest.webmanifest', { navigate: true });
    await new Promise((r) => setTimeout(r, 10));
    expect(shell()?.headers.get('content-type')).toContain('text/html');
    // A non-HTML answer for the root itself (a captive portal, a proxy error page in JSON) is not stored either.
    const odd = loadWorker({ online: true, files: { '/': { type: 'application/json', body: '{}' } } });
    await odd.request('', { navigate: true });
    await new Promise((r) => setTimeout(r, 10));
    expect(odd.stores.get('dushu-app-t')?.get('https://app.test/')).toBeUndefined();
  });

  it('stores a classic the first time it is fetched, so adding it works offline later', async () => {
    const files = { '/samples/kong-yiji.txt': { type: 'text/plain', body: '孔乙己' } };
    const on = loadWorker({ online: true, files });
    expect(await (await on.request('samples/kong-yiji.txt'))!.text()).toBe('孔乙己');
    await new Promise((r) => setTimeout(r, 10));
    const off = loadWorker({ online: false, strict: true });
    off.stores.set('dushu-static-d', new Map(on.stores.get('dushu-static-d')!));
    expect(await (await off.request('samples/kong-yiji.txt'))!.text()).toBe('孔乙己');
  });

  it('takes over the dictionary files a first visit already downloaded: asked whether they changed, not fetched again', async () => {
    const files = {
      '/data/cedict.tsv.gz': { type: 'application/gzip', body: 'words', etag: '"v1"' },
      '/data/hsk.tsv.gz': { type: 'application/gzip', body: 'new levels', etag: '"v2"' },
    };
    const sw = loadWorker({ online: true, files, precache: ['data/cedict.tsv.gz', 'data/hsk.tsv.gz', 'data/chars.tsv.gz'] });
    sw.stores.set('dushu-first-visit', new Map([
      ['https://app.test/data/cedict.tsv.gz', new Response('words', { headers: { ETag: '"v1"' } })],
      // Changed on the server since the page downloaded it: the new copy is stored.
      ['https://app.test/data/hsk.tsv.gz', new Response('old levels', { headers: { ETag: '"v1"' } })],
    ]));
    await sw.install();
    const stat = sw.stores.get('dushu-static-d')!;
    expect(await stat.get('https://app.test/data/cedict.tsv.gz')!.text()).toBe('words');
    expect(await stat.get('https://app.test/data/hsk.tsv.gz')!.text()).toBe('new levels');
    expect(sw.added).toContain('https://app.test/data/chars.tsv.gz'); // not handed over: downloaded as before
    expect(sw.added).not.toContain('https://app.test/data/cedict.tsv.gz');
    expect(sw.stores.has('dushu-first-visit')).toBe(false);
  });

  it('keeps what the previous offline copy had, when an update changed other files: asked, not fetched again', async () => {
    const files = { '/data/cedict.tsv.gz': { type: 'application/gzip', body: 'words', etag: '"v1"' } };
    const sw = loadWorker({ online: true, files, precache: ['data/cedict.tsv.gz'] });
    sw.stores.set('dushu-static-older', new Map([['https://app.test/data/cedict.tsv.gz', new Response('words', { headers: { ETag: '"v1"' } })]]));
    await sw.install();
    expect(await sw.stores.get('dushu-static-d')!.get('https://app.test/data/cedict.tsv.gz')!.text()).toBe('words');
    expect(sw.added).not.toContain('https://app.test/data/cedict.tsv.gz');
  });

  it('precaches the bundled Newsreader files at install, and they ship with their license', async () => {
    expect(swSource).toMatch(/const UI_FONTS = \['fonts\/newsreader-roman\.woff2', 'fonts\/newsreader-italic\.woff2'\];/);
    const sw = loadWorker({ online: true });
    await sw.install();
    expect(sw.added).toEqual(expect.arrayContaining(['https://app.test/fonts/newsreader-roman.woff2', 'https://app.test/fonts/newsreader-italic.woff2']));
    let total = 0;
    for (const f of ['newsreader-roman.woff2', 'newsreader-italic.woff2']) {
      const bytes = readFileSync(join(root, 'public/fonts', f));
      expect(bytes.subarray(0, 4).toString('latin1'), f).toBe('wOF2');
      total += bytes.length;
    }
    expect(total).toBeLessThan(125_000);
    expect(readFileSync(join(root, 'public/fonts/Newsreader-OFL.txt'), 'utf8')).toMatch(/SIL OPEN FONT LICENSE Version 1\.1/);
    // Loaded from this origin only, never from a font CDN.
    const main = readFileSync(join(root, 'src/main.ts'), 'utf8');
    expect(main).toMatch(/url\('newsreader-roman\.woff2'\)/);
    for (const f of ['src/main.ts', 'src/styles/tokens.css', 'src/styles/base.css', 'index.html']) {
      expect(readFileSync(join(root, f), 'utf8'), f).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
    }
  });

  it('copies hashed files an earlier build stored instead of downloading them again (the PDF worker is 1.4 MB)', async () => {
    const worker = 'assets/pdf.worker.min-yatZIOMy.mjs';
    const sw = loadWorker({ online: true, precache: [worker, 'assets/index-N3wHash1.js', 'data/cedict.tsv.gz'] });
    sw.stores.set('dushu-app-old', new Map([[`https://app.test/${worker}`, new Response('worker bytes')]]));
    await sw.install();
    expect(await sw.stores.get('dushu-app-t')!.get(`https://app.test/${worker}`)!.text()).toBe('worker bytes');
    // Only what changed is downloaded: the shell and the new chunk, and the data into its own cache.
    const appFiles = (w: typeof sw) => w.added.filter((u) => !/\/(data|fonts)\//.test(u));
    expect(appFiles(sw)).toEqual(['https://app.test/', 'https://app.test/assets/index-N3wHash1.js']);
    expect(sw.added).toContain('https://app.test/data/cedict.tsv.gz');
    // A first install has nothing to copy, so it downloads everything.
    const first = loadWorker({ online: true, precache: [worker] });
    await first.install();
    expect(appFiles(first)).toEqual(['https://app.test/', `https://app.test/${worker}`]);
  });

  it('never touches private API paths or other origins', async () => {
    const sw = loadWorker({ online: true });
    expect(await sw.request('api/local-books')).toBeUndefined();
    let answered = false;
    sw.handlers.fetch({ request: { method: 'GET', url: 'https://other.test/x', mode: 'cors', headers: new Headers() }, respondWith: () => { answered = true; } });
    expect(answered).toBe(false);
  });
});

// ---------------------------------------------------------------- tokens ---

const tokens = readFileSync(join(root, 'src/styles/tokens.css'), 'utf8');
function theme(selector: RegExp): Record<string, string> {
  const m = tokens.match(new RegExp(selector.source + String.raw`\s*\{([^}]*)\}`));
  const out: Record<string, string> = {};
  for (const [, k, v] of (m?.[1] ?? '').matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)) out[k] = v;
  return out;
}
const light = theme(/:root(?![^\s{]*\[)/);
const themes: Record<string, Record<string, string>> = {
  light,
  sepia: { ...light, ...theme(/:root\[data-theme='sepia'\]/) },
  dark: { ...light, ...theme(/:root\[data-theme='dark'\]/) },
};
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

describe('color tokens', () => {
  it('dark is a warm near-black, not pure black, and the book text a little dimmer than the interface', () => {
    const d = themes.dark;
    expect(lum(d['--bg'])).toBeGreaterThan(lum('#0b0a08'));
    expect(d['--bg']).not.toBe('#000000');
    expect(lum(d['--reader-text'])).toBeLessThan(lum(d['--text']));
    expect(ratio(d['--reader-text'], d['--bg'])).toBeGreaterThanOrEqual(12);
    // At night a filled control is lacquer red, darker than the red of thin marks, so nothing glares.
    expect(lum(d['--accent-fill'])).toBeLessThan(lum(d['--accent']));
  });
  for (const [name, t] of Object.entries(themes)) {
    it(`${name}: small secondary text (--text-3) is AA on every surface it sits on`, () => {
      for (const bg of ['--bg', '--surface', '--surface-2']) expect(ratio(t['--text-3'], t[bg]), `${name} --text-3 on ${bg}`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(t['--text-2'], t['--bg'])).toBeGreaterThanOrEqual(6);
    });
    it(`${name}: the filled red (seal, primary button, badges) carries its text at 4.5:1`, () => {
      expect(ratio(t['--accent-fill-text'], t['--accent-fill'])).toBeGreaterThanOrEqual(4.5);
    });
    it(`${name}: --danger reads as text and is not the brand accent`, () => {
      expect(t['--danger']).toBeTruthy();
      expect(t['--danger']).not.toBe(t['--accent']);
      expect(ratio(t['--danger'], t['--bg'])).toBeGreaterThanOrEqual(4.5);
      expect(ratio(t['--danger'], t['--danger-soft'])).toBeGreaterThanOrEqual(4.5);
    });
  }
});
