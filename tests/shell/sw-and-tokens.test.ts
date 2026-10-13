// The service worker, run against fake caches, and the color tokens, parsed from tokens.css.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..', '..');
const swSource = readFileSync(join(root, 'public/sw.js'), 'utf8');

type Handler = (event: unknown) => void;

/** Loads sw.js with a fake browser. `strict` makes a cache lookup miss unless it passes ignoreVary, like a host that sends Vary: Origin. */
function loadWorker(opts: { online: boolean; strict?: boolean; files?: Record<string, { type: string; body: string }> }) {
  const handlers: Record<string, Handler> = {};
  const stores = new Map<string, Map<string, Response>>();
  const lookups: Array<Record<string, unknown> | undefined> = [];
  const files = opts.files ?? {};
  let fetched = 0;
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
      add: async () => {},
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
  const fakeFetch = async (r: Request) => {
    fetched++;
    if (!opts.online) throw new TypeError('Failed to fetch');
    const f = files[new URL(r.url).pathname];
    if (!f) return new Response('nope', { status: 404 });
    return new Response(f.body, { status: 200, headers: { 'content-type': f.type } });
  };
  const self = {
    registration: { scope: 'https://app.test/' },
    location: { origin: 'https://app.test' },
    addEventListener: (t: string, fn: Handler) => { handlers[t] = fn; },
    skipWaiting() {}, clients: { claim: async () => {} },
  };
  const src = swSource.replace('__BUILD__', 't').replace('__DATA_VERSION__', 'd').replace('__PRECACHE__', '[]');
  new Function('self', 'caches', 'fetch', src)(self, fakeCaches, fakeFetch);
  async function request(path: string, init: { navigate?: boolean } = {}): Promise<Response | undefined> {
    const url = new URL(path, 'https://app.test/').href;
    const mode = init.navigate ? 'navigate' : 'cors';
    let answer: Promise<Response> | undefined;
    handlers.fetch({ request: { method: 'GET', url, mode, headers: new Headers() }, respondWith: (p: Promise<Response>) => { answer = Promise.resolve(p); } });
    return answer;
  }
  return { request, stores, lookups, handlers, get fetched() { return fetched; } };
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
  for (const [name, t] of Object.entries(themes)) {
    it(`${name}: small secondary text (--text-3) is AA on every surface it sits on`, () => {
      for (const bg of ['--bg', '--surface', '--surface-2']) expect(ratio(t['--text-3'], t[bg]), `${name} --text-3 on ${bg}`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(t['--text-2'], t['--bg'])).toBeGreaterThanOrEqual(6);
    });
    it(`${name}: --danger reads as text and is not the brand accent`, () => {
      expect(t['--danger']).toBeTruthy();
      expect(t['--danger']).not.toBe(t['--accent']);
      expect(ratio(t['--danger'], t['--bg'])).toBeGreaterThanOrEqual(4.5);
      expect(ratio(t['--danger'], t['--danger-soft'])).toBeGreaterThanOrEqual(4.5);
    });
  }
});
