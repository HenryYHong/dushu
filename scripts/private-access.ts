// Trust identity headers only from a loopback Tailscale Serve proxy, for this exact owner and host.
import { readFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import type { Plugin } from 'vite';

export interface PrivateAccess { host: string; owner: string }
export function privateAccess(): PrivateAccess | null {
  try {
    const value = JSON.parse(readFileSync('.dushu-local/ipad.json', 'utf8'));
    return typeof value.host === 'string' && /^[a-z0-9.-]+\.ts\.net:8443$/.test(value.host)
      && typeof value.owner === 'string' && value.owner.length > 0 ? value : null;
  } catch { return null; }
}
export function trustedRequest(req: IncomingMessage, config = privateAccess()): boolean {
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress || '')) return false;
  const host = req.headers.host || '';
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host);
  if (!local && (!config || host !== config.host || req.headers['tailscale-user-login'] !== config.owner)) return false;
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  if (req.headers.origin) {
    try {
      const origin = new URL(req.headers.origin);
      if (origin.host !== host || (!local && origin.protocol !== 'https:')) return false;
    } catch { return false; }
  }
  return true;
}
export function privateGateway(): Plugin {
  const install = (server: any) => { server.middlewares.use((req: IncomingMessage, res: import('node:http').ServerResponse, next: () => void) => {
    if (!trustedRequest(req)) { res.writeHead(403, { 'Cache-Control': 'no-store' }).end('Private Dushu: connect with the Mac owner’s Tailscale account.'); return; }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    if (req.url?.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    if (req.url === '/api/private-status') {
      if (req.method !== 'GET') { res.writeHead(405).end(); return; }
      res.setHeader('Content-Type', 'application/json');
      const access = privateAccess();
      res.end(JSON.stringify({ url: access ? `https://${access.host}/` : null }));
      return;
    }
    next();
  }); };
  return { name: 'dushu-private-gateway', configureServer: install, configurePreviewServer: install };
}
