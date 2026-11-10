// public/sw.js run with a fake browser: caches in memory, a fake network, and the build's placeholders filled in.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const swSource = readFileSync(join(__dirname, '..', '..', 'public/sw.js'), 'utf8');

type Handler = (event: unknown) => void;

export interface WorkerOptions {
  online: boolean;
  /** A cache lookup misses unless it passes ignoreVary, like a host that sends Vary: Origin. */
  strict?: boolean;
  /** The server's files by path, with an ETag when it sends one. */
  files?: Record<string, { type: string; body: string; etag?: string }>;
  /** The build's precache list: data/ and samples/ fill ZH_STATIC, everything else SHELL (vite.config.ts serviceWorker). */
  precache?: string[];
  /** LANG_VERSIONS: each other language's data version, naming its cache. */
  langs?: Record<string, string>;
  /** FONT_SHEETS: the reading fonts' stylesheets, left out of the shell. */
  fontSheets?: string[];
}

/** Loads sw.js. The data version is 'd' (cache dushu-static-d) and the build 't' (dushu-app-t). */
export function loadWorker(opts: WorkerOptions) {
  const handlers: Record<string, Handler> = {};
  const stores = new Map<string, Map<string, Response>>();
  const lookups: Array<Record<string, unknown> | undefined> = [];
  const added: string[] = [];
  /** Every URL the worker asked the network for (add() included). */
  const requests: string[] = [];
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
      add: async (r: Request | string) => { added.push(key(r)); requests.push(key(r)); },
      keys: async () => [...m.keys()].map((u) => new Request(u)),
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
    requests.push(key(r));
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
  const precache = opts.precache ?? [];
  const isData = (p: string) => /^(data|samples)\//.test(p);
  const src = swSource.replace('__BUILD__', 't').replace('__DATA_VERSION__', 'd')
    .replace('__SHELL__', JSON.stringify(precache.filter((p) => !isData(p))))
    .replace('__ZH_STATIC__', JSON.stringify(precache.filter(isData)))
    .replace('__FONT_SHEETS__', JSON.stringify(opts.fontSheets ?? []))
    .replace('__LANG_VERSIONS__', JSON.stringify(opts.langs ?? {}));
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
  async function activate(): Promise<void> {
    let done: Promise<unknown> = Promise.resolve();
    handlers.activate({ waitUntil: (p: Promise<unknown>) => { done = p; } });
    await done;
  }
  return { request, install, activate, stores, lookups, added, requests, handlers, inits, get fetched() { return fetched; } };
}
