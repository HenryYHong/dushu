// The sync server in process: the real Worker, each account in memory instead of a Durable Object's SQLite database.
import { createHash } from 'node:crypto';
import worker, { accountRequest, limitsRequest, type DurableObjectNamespace, type Env } from '../../cloud/src/worker';
import { AccountCore, LimitsCore, memoryLimits, memoryStore, type AccountStore } from '../../cloud/src/account';
import { recordSize } from '../../src/core/syncExchange';
import releasedWorker, { accountRequest as releasedAccountRequest } from '../fixtures/released/cloud/worker';
import { AccountCore as ReleasedAccountCore } from '../fixtures/released/cloud/account';
import { countRecord as releasedCount, noCounts as releasedNoCounts } from '../fixtures/released/syncExchange';

const hex = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * An account's store as the Worker live today reads it: main's sqlStore (tests/fixtures/released/cloud/sqlStore.ts) over the
 * database today's Worker wrote. Its records table never knew a language, so it answers and counts every record, '@ja:' ones
 * included (main's countRecord reads the kind from the key's first letter, so those count as nothing), and the room sums them
 * all. Its books are the `books` and `book_chunks` tables, which hold the Chinese books only (another language's are on a
 * shelf of their own, cloud/src/sqlStore.ts). `tests/cloud/sync-languages.test.ts` checks this against main's own sqlStore on
 * a real SQLite.
 */
export function releasedView(store: ReturnType<typeof memoryStore>): AccountStore {
  const { books, chunks } = store.shelves.chinese;
  const pieces = (key: string) => [...chunks.keys()].filter((k) => k.startsWith(`${key}\u0000`));
  return {
    ...store,
    records(epoch, version) {
      const table = store.records(epoch, version);
      return {
        ...table,
        changed: (since, also) => [...store.data].filter(([k, r]) => r.rev > since || also.has(k)).map(([key, r]) => ({ key, at: r.at, data: r.data })),
        counts: () => {
          const c = releasedNoCounts();
          for (const [k, r] of store.data) releasedCount(c, k, r.data);
          return c;
        },
      };
    },
    books: () => [...books.values()],
    putBook: (b) => { books.set(b.key, b); },
    dropBook: (key) => { books.delete(key); for (const k of pieces(key)) chunks.delete(k); },
    putChunk: (key, i, d) => { chunks.set(`${key}\u0000${i}`, d.slice()); },
    getChunk: (key, i) => chunks.get(`${key}\u0000${i}`),
    chunkCount: (key) => pieces(key).length,
    recordBytes: () => [...store.data.values()].reduce((n, r) => n + recordSize(r.data), 0),
    // Main's wipe empties the tables it knows, not the other languages' books.
    wipe: () => {
      const { books: kept, chunks: keptChunks } = store.shelves.others;
      const [b, c] = [new Map(kept), new Map(keptChunks)];
      store.wipe();
      for (const [k, v] of b) kept.set(k, v);
      for (const [k, v] of c) keptChunks.set(k, v);
    },
  };
}

/**
 * `released`, when it answers true, has the server as it is live today (tests/fixtures/released/cloud, main ff6ab6c) answer
 * the next request instead of this one, over the same accounts (releasedView): a test can update the server, or roll it back,
 * between two requests.
 */
export function cloud(extra: Partial<Env> = {}, opts: { released?: () => boolean } = {}) {
  const stores = new Map<string, ReturnType<typeof memoryStore>>();
  const names = new Set<string>();
  const released = () => opts.released?.() === true;
  const ACCOUNTS: DurableObjectNamespace = {
    idFromName: (name) => { const id = hex(name); names.add(id); return { toString: () => id }; },
    idFromString: (id) => { if (!names.has(id)) throw new TypeError('Invalid Durable Object ID'); return { toString: () => id }; },
    get: (id) => {
      const key = id.toString();
      if (!stores.has(key)) stores.set(key, memoryStore());
      const store = stores.get(key)!;
      // A core keeps nothing between requests but its store (the owners come with each one), so one is made per request.
      return {
        fetch: (url, init) => (released()
          ? releasedAccountRequest(new ReleasedAccountCore(releasedView(store) as never), new Request(url, init))
          : accountRequest(new AccountCore(store), new Request(url, init))),
      };
    },
  };
  // The shared days as the Worker keeps them, in memory.
  const limits = new LimitsCore(memoryLimits());
  const LIMITS: DurableObjectNamespace = {
    idFromName: () => ({ toString: () => 'global' }),
    idFromString: () => ({ toString: () => 'global' }),
    get: () => ({ fetch: (url, init) => limitsRequest(limits, new Request(url, init)) }),
  };
  const env: Env = { ACCOUNTS, LIMITS, MAIL_MODE: 'log', ...extra };
  const fetch = (request: Request): Promise<Response> => (released() ? (releasedWorker.fetch(request, env as never) as Promise<Response>) : worker.fetch(request, env));
  const call = (path: string, init: RequestInit & { origin?: string } = {}) => fetch(new Request(`https://sync.test${path}`, {
    ...init, headers: { 'Content-Type': 'application/json', Origin: init.origin ?? 'https://henryyhong.com', ...(init.headers as Record<string, string>) },
  }));
  const post = (path: string, body: unknown, token?: string) => call(path, { method: 'POST', body: JSON.stringify(body), headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { env, call, post, fetch, stores };
}

export async function signedIn(c: ReturnType<typeof cloud>, email = 'reader@example.com') {
  const { devCode } = await (await c.post('/auth/code', { email })).json() as { devCode: string };
  const res = await c.post('/auth/verify', { email, code: devCode });
  return (await res.json() as { token: string }).token;
}
