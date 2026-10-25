// The sync server in process: the real Worker, each account in memory instead of a Durable Object's SQLite database.
import { createHash } from 'node:crypto';
import worker, { accountRequest, limitsRequest, type DurableObjectNamespace, type Env } from '../../cloud/src/worker';
import { AccountCore, LimitsCore, memoryLimits, memoryStore } from '../../cloud/src/account';

const hex = (s: string) => createHash('sha256').update(s).digest('hex');

export function cloud(extra: Partial<Env> = {}) {
  const cores = new Map<string, AccountCore>();
  const names = new Set<string>();
  const ACCOUNTS: DurableObjectNamespace = {
    idFromName: (name) => { const id = hex(name); names.add(id); return { toString: () => id }; },
    idFromString: (id) => { if (!names.has(id)) throw new TypeError('Invalid Durable Object ID'); return { toString: () => id }; },
    get: (id) => {
      const key = id.toString();
      if (!cores.has(key)) cores.set(key, new AccountCore(memoryStore()));
      return { fetch: (url, init) => accountRequest(cores.get(key)!, new Request(url, init)) };
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
  const call = (path: string, init: RequestInit & { origin?: string } = {}) => worker.fetch(new Request(`https://sync.test${path}`, {
    ...init, headers: { 'Content-Type': 'application/json', Origin: init.origin ?? 'https://henryyhong.com', ...(init.headers as Record<string, string>) },
  }), env);
  const post = (path: string, body: unknown, token?: string) => call(path, { method: 'POST', body: JSON.stringify(body), headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { env, call, post };
}

export async function signedIn(c: ReturnType<typeof cloud>, email = 'reader@example.com') {
  const { devCode } = await (await c.post('/auth/code', { email })).json() as { devCode: string };
  const res = await c.post('/auth/verify', { email, code: devCode });
  return (await res.json() as { token: string }).token;
}

