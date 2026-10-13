import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, describe, expect, it } from 'vitest';
import { BRIDGE_ROUTES, PUBLIC_ORIGIN, bridgeCors, bridgeRequest, crossOrigin, extraOrigins, isBridgeRoute, privateGateway, trustedRequest } from '../../scripts/private-access';

const config = { host: 'my-mac.private.ts.net:8443', owner: 'owner@example.com' };
const noEnv = {};

function req(host: string, headers: Record<string, string> = {}, remote = '127.0.0.1', method = 'GET') {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { method, socket: { remoteAddress: remote }, headers: { host, ...lower } } as unknown as IncomingMessage;
}
function fakeRes() {
  const headers = new Map<string, string>();
  const out = { status: 0, ended: false };
  const res = {
    setHeader: (k: string, v: string) => { headers.set(k.toLowerCase(), String(v)); },
    writeHead: (status: number) => { out.status = status; return res; },
    end: () => { out.ended = true; return res; },
  } as unknown as ServerResponse;
  return { res, headers, out };
}
const owner = (extra: Record<string, string> = {}) => ({ 'tailscale-user-login': config.owner, ...extra });

describe('bridge routes', () => {
  it('covers exactly the routes the public site needs', () => {
    for (const path of ['/api/claude/status', '/api/claude/translate', '/api/local-model/api/tags', '/api/local-model/api/generate',
      '/api/native-voices', '/api/native-speech', '/api/local-books', '/api/local-books/huozhe', '/api/private-status']) expect(isBridgeRoute(path)).toBe(true);
    for (const path of ['/', '/index.html', '/api/other', '/api/claude', '/api/local-booksx', '/assets/api/claude/status']) expect(isBridgeRoute(path)).toBe(false);
    expect(BRIDGE_ROUTES).toHaveLength(6);
  });
});

describe('who may call the bridge (origin and identity matrix)', () => {
  const ok = (r: IncomingMessage, env = noEnv) => bridgeRequest(r, config, env);

  it('keeps allowing the app itself, locally and through the owner proxy', () => {
    expect(ok(req('localhost:4317'))).toBe(true);
    expect(ok(req('127.0.0.1:5240', { origin: 'http://127.0.0.1:5240' }))).toBe(true);
    expect(ok(req(config.host, owner({ origin: `https://${config.host}` })))).toBe(true);
    expect(ok(req(config.host))).toBe(false);
  });

  it('lets the public site in only through the private host with the owner identity', () => {
    const origin = PUBLIC_ORIGIN;
    expect(ok(req(config.host, owner({ origin, 'sec-fetch-site': 'cross-site' })))).toBe(true);
    expect(ok(req(config.host, { origin, 'tailscale-user-login': 'other@example.com' }))).toBe(false);
    expect(ok(req(config.host, { origin }))).toBe(false);
    expect(ok(req('other-mac.private.ts.net:8443', owner({ origin })))).toBe(false);
    expect(ok(req('localhost:4317', { origin }))).toBe(false);
    expect(ok(req(config.host, owner({ origin })), noEnv)).toBe(true);
    expect(bridgeRequest(req(config.host, owner({ origin })), null, noEnv)).toBe(false);
  });

  it('refuses a request that did not come through the loopback proxy', () => {
    expect(ok(req(config.host, owner({ origin: PUBLIC_ORIGIN }), '192.168.1.5'))).toBe(false);
    expect(ok(req(config.host, owner({ origin: PUBLIC_ORIGIN }), '100.64.1.2'))).toBe(false);
  });

  it.each([
    'http://henryyhong.com', 'https://www.henryyhong.com', 'https://henryyhong.com.evil.example', 'https://evilhenryyhong.com',
    'https://henryyhong.com:8443', 'https://evil.example', 'null', 'not a url', 'https://HENRYYHONG.COM/', '*',
  ])('rejects the origin %s even with the owner identity', (origin) => {
    expect(ok(req(config.host, owner({ origin })))).toBe(false);
    expect(crossOrigin(req(config.host, { origin }), noEnv)).toBeNull();
  });

  it('accepts a test origin only from DUSHU_EXTRA_ORIGINS, with no wildcards', () => {
    const env = { DUSHU_EXTRA_ORIGINS: 'http://localhost:5241, https://test.example, *, http://localhost:5242/path, not-a-url' };
    expect(extraOrigins(env)).toEqual(['http://localhost:5241', 'https://test.example']);
    expect(ok(req('localhost:5240', { origin: 'http://localhost:5241' }), env)).toBe(true);
    expect(ok(req('localhost:5240', { origin: 'http://localhost:5243' }), env)).toBe(false);
    expect(ok(req('localhost:5240', { origin: 'http://localhost:5241' }), noEnv)).toBe(false);
    expect(ok(req(config.host, owner({ origin: 'https://test.example' })), env)).toBe(true);
    expect(ok(req(config.host, { origin: 'https://test.example' }), env)).toBe(false);
  });

  it('is unchanged for requests without an Origin header', () => {
    for (const r of [req('localhost:1'), req(config.host, owner()), req('localhost:1', { 'sec-fetch-site': 'cross-site' })]) {
      expect(ok(r)).toBe(trustedRequest(r, config));
    }
  });
});

describe('CORS headers', () => {
  const cors = (r: IncomingMessage, env = noEnv) => { const f = fakeRes(); const done = bridgeCors(r, f.res, config, env); return { ...f, done }; };

  it('always varies on Origin, and says nothing to a site that is not allowed', () => {
    const plain = cors(req('localhost:1'));
    expect(plain.headers.get('vary')).toBe('Origin');
    expect(plain.headers.has('access-control-allow-origin')).toBe(false);
    const evil = cors(req(config.host, owner({ origin: 'https://evil.example' })));
    expect(evil.done).toBe(false);
    expect(evil.headers.get('vary')).toBe('Origin');
    expect([...evil.headers.keys()].filter(k => k.startsWith('access-control'))).toEqual([]);
  });

  it('echoes only the exact allowed origin and never allows credentials', () => {
    const allowed = cors(req(config.host, owner({ origin: PUBLIC_ORIGIN })));
    expect(allowed.done).toBe(false);
    expect(allowed.headers.get('access-control-allow-origin')).toBe(PUBLIC_ORIGIN);
    expect(allowed.headers.has('access-control-allow-credentials')).toBe(false);
    // The identity is checked separately: a wrong user still gets a readable refusal, not data.
    const denied = cors(req(config.host, { origin: PUBLIC_ORIGIN }));
    expect(denied.headers.get('access-control-allow-origin')).toBe(PUBLIC_ORIGIN);
    expect(bridgeRequest(req(config.host, { origin: PUBLIC_ORIGIN }), config, noEnv)).toBe(false);
  });

  it('answers a preflight from the owner, with Private Network Access and a short cache', () => {
    const r = req(config.host, owner({ origin: PUBLIC_ORIGIN, 'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type, x-evil, Cache-Control, pragma, authorization', 'access-control-request-private-network': 'true' }), '127.0.0.1', 'OPTIONS');
    const { done, headers, out } = cors(r);
    expect(done).toBe(true);
    expect(out.status).toBe(204);
    expect(headers.get('access-control-allow-origin')).toBe(PUBLIC_ORIGIN);
    expect(headers.get('access-control-allow-methods')).toBe('GET, POST, OPTIONS');
    expect(headers.get('access-control-allow-headers')).toBe('content-type, cache-control, pragma');
    expect(headers.get('access-control-allow-private-network')).toBe('true');
    expect(headers.get('access-control-max-age')).toBe('600');
    expect(headers.get('vary')).toContain('Origin');
    expect(headers.has('access-control-allow-credentials')).toBe(false);
  });

  it('adds the Private Network header only when the browser asked for it', () => {
    const r = req(config.host, owner({ origin: PUBLIC_ORIGIN, 'access-control-request-method': 'GET' }), '127.0.0.1', 'OPTIONS');
    expect(cors(r).headers.has('access-control-allow-private-network')).toBe(false);
  });

  it.each([
    ['another user', { origin: PUBLIC_ORIGIN, 'tailscale-user-login': 'other@example.com', 'access-control-request-method': 'POST' }, config.host],
    ['no identity', { origin: PUBLIC_ORIGIN, 'access-control-request-method': 'POST' }, config.host],
    ['a localhost host', { origin: PUBLIC_ORIGIN, 'access-control-request-method': 'POST' }, 'localhost:4317'],
    ['no requested method', owner({ origin: PUBLIC_ORIGIN }), config.host],
  ])('refuses a preflight with %s', (_name, headers, host) => {
    const { done, out, headers: sent } = cors(req(host, headers, '127.0.0.1', 'OPTIONS'));
    expect(done).toBe(true);
    expect(out.status).toBe(403);
    expect(sent.has('access-control-allow-methods')).toBe(false);
    expect(sent.has('access-control-allow-private-network')).toBe(false);
  });

  it('does not answer a preflight from a site that is not allowed (the gateway then refuses it)', () => {
    const r = req(config.host, owner({ origin: 'https://evil.example', 'access-control-request-method': 'POST' }), '127.0.0.1', 'OPTIONS');
    expect(cors(r).done).toBe(false);
    expect(bridgeRequest(r, config, noEnv)).toBe(false);
  });
});

describe('the gateway over real HTTP', () => {
  const servers: ReturnType<typeof createServer>[] = [];
  afterAll(() => { for (const s of servers) s.close(); });
  async function start(access = config) {
    const middlewares: ((req: IncomingMessage, res: ServerResponse, next: () => void) => void)[] = [];
    (privateGateway(() => access).configureServer as unknown as (server: unknown) => void)({ middlewares: { use: (fn: never) => middlewares.push(fn) } });
    const server = createServer((rq, rs) => middlewares[0](rq, rs, () => { rs.writeHead(200, { 'Content-Type': 'text/plain' }); rs.end('next'); }));
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    return (method: string, path: string, headers: Record<string, string>) => new Promise<{ status: number; headers: Record<string, unknown>; body: string }>((resolve, reject) => {
      const r = httpRequest({ host: '127.0.0.1', port, method, path, headers }, rs => {
        let body = '';
        rs.on('data', c => { body += c; });
        rs.on('end', () => resolve({ status: rs.statusCode ?? 0, headers: rs.headers, body }));
      });
      r.on('error', reject);
      r.end();
    });
  }

  it('lets the owner preflight and call a bridge route from the public site', async () => {
    const call = await start();
    const pre = await call('OPTIONS', '/api/claude/translate', { host: config.host, origin: PUBLIC_ORIGIN, 'tailscale-user-login': config.owner,
      'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type', 'access-control-request-private-network': 'true' });
    expect(pre.status).toBe(204);
    expect(pre.headers['access-control-allow-private-network']).toBe('true');
    const status = await call('GET', '/api/private-status', { host: config.host, origin: PUBLIC_ORIGIN, 'tailscale-user-login': config.owner });
    expect(status.status).toBe(200);
    expect(status.headers['access-control-allow-origin']).toBe(PUBLIC_ORIGIN);
    expect(status.headers['access-control-allow-credentials']).toBeUndefined();
    expect(JSON.parse(status.body)).toEqual({ app: 'dushu', url: `https://${config.host}/` });
    const pass = await call('GET', '/api/local-books', { host: config.host, origin: PUBLIC_ORIGIN, 'tailscale-user-login': config.owner });
    expect(pass.body).toBe('next');
  });

  it('refuses another account, other sites, and every route outside the bridge', async () => {
    const call = await start();
    const asOther = await call('GET', '/api/private-status', { host: config.host, origin: PUBLIC_ORIGIN, 'tailscale-user-login': 'other@example.com' });
    expect(asOther.status).toBe(403);
    expect(asOther.body).not.toContain(config.host);
    expect((await call('GET', '/api/private-status', { host: config.host, origin: 'https://evil.example', 'tailscale-user-login': config.owner })).status).toBe(403);
    expect((await call('OPTIONS', '/api/claude/translate', { host: config.host, origin: 'https://evil.example', 'tailscale-user-login': config.owner,
      'access-control-request-method': 'POST' })).status).toBe(403);
    // The page itself and other APIs never accept the public origin.
    expect((await call('GET', '/', { host: config.host, origin: PUBLIC_ORIGIN, 'tailscale-user-login': config.owner })).status).toBe(403);
    expect((await call('GET', '/api/other', { host: config.host, origin: PUBLIC_ORIGIN, 'tailscale-user-login': config.owner })).status).toBe(403);
    expect((await call('GET', '/', { host: config.host, 'tailscale-user-login': config.owner })).status).toBe(200);
  });

  it('fails closed with no private configuration', async () => {
    const call = await start(null as never);
    const r = await call('GET', '/api/private-status', { host: config.host, origin: PUBLIC_ORIGIN, 'tailscale-user-login': config.owner });
    expect(r.status).toBe(403);
  });
});
