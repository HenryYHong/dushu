// Trust identity headers only from a loopback Tailscale Serve proxy, for this exact owner and host.
// The public copy of the app (https://henryyhong.com) may call the bridge routes cross-origin, and only for that owner.
import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

export interface PrivateAccess { host: string; owner: string }
export function privateAccess(): PrivateAccess | null {
  try {
    const value = JSON.parse(readFileSync('.dushu-local/ipad.json', 'utf8'));
    return typeof value.host === 'string' && /^[a-z0-9.-]+\.ts\.net:8443$/.test(value.host)
      && typeof value.owner === 'string' && value.owner.length > 0 ? value : null;
  } catch { return null; }
}

const LOOPBACK = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;

/** The one public origin that may use the Mac bridge. */
export const PUBLIC_ORIGIN = 'https://henryyhong.com';

/** Routes the public site needs. Everything else under /api/ stays same-origin only. */
export const BRIDGE_ROUTES = [
  '/api/claude/', '/api/local-model/', '/api/native-voices', '/api/native-speech', '/api/local-books', '/api/private-status', '/api/sync',
];
export function isBridgeRoute(path: string): boolean {
  return BRIDGE_ROUTES.some(route => route.endsWith('/') ? path.startsWith(route) : path === route || path.startsWith(`${route}/`));
}

/** DUSHU_EXTRA_ORIGINS: comma-separated exact origins (local testing only). Anything that is not a plain origin is ignored. */
export function extraOrigins(env: Record<string, string | undefined> = process.env): string[] {
  const out: string[] = [];
  for (const part of (env.DUSHU_EXTRA_ORIGINS ?? '').split(',')) {
    try {
      const url = new URL(part.trim());
      if ((url.protocol === 'https:' || url.protocol === 'http:') && url.origin === part.trim().replace(/\/$/, '') && !out.includes(url.origin)) out.push(url.origin);
    } catch { /* not an origin */ }
  }
  return out;
}

function header(req: IncomingMessage, name: string): string {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

export function trustedRequest(req: IncomingMessage, config = privateAccess()): boolean {
  if (!LOOPBACK.includes(req.socket.remoteAddress || '')) return false;
  const host = req.headers.host || '';
  const local = LOCAL_HOST.test(host);
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

/** Which allowed cross-origin site sent this request: the public site, or a test origin from DUSHU_EXTRA_ORIGINS. */
export function crossOrigin(req: IncomingMessage, env: Record<string, string | undefined> = process.env): 'public' | 'extra' | null {
  const origin = header(req, 'origin');
  if (!origin) return null;
  if (origin === PUBLIC_ORIGIN) return 'public';
  return extraOrigins(env).includes(origin) ? 'extra' : null;
}

/**
 * Bridge routes accept the app's own origin (trustedRequest) and, from the allowed sites, a cross-origin call.
 * The public site is trusted only through the owner's private host with the owner's Tailscale identity. A test origin
 * from DUSHU_EXTRA_ORIGINS may also use localhost. The caller never sends cookies: nothing here reads any.
 */
export function bridgeRequest(req: IncomingMessage, config = privateAccess(), env: Record<string, string | undefined> = process.env): boolean {
  const kind = crossOrigin(req, env);
  if (!kind) return trustedRequest(req, config);
  if (!LOOPBACK.includes(req.socket.remoteAddress || '')) return false;
  const host = req.headers.host || '';
  if (LOCAL_HOST.test(host)) return kind === 'extra';
  return !!config && host === config.host && req.headers['tailscale-user-login'] === config.owner;
}

/**
 * CORS for a bridge route. Always varies on Origin. An allowed site gets Access-Control-Allow-Origin (never credentials);
 * a preflight is answered here, with Private Network Access, only when the identity check passes. Returns true when the
 * response is finished.
 */
export function bridgeCors(req: IncomingMessage, res: ServerResponse, config = privateAccess(), env: Record<string, string | undefined> = process.env): boolean {
  res.setHeader('Vary', 'Origin');
  const kind = crossOrigin(req, env);
  if (!kind) return false;
  res.setHeader('Access-Control-Allow-Origin', header(req, 'origin'));
  res.setHeader('Access-Control-Expose-Headers', 'ETag, X-Dushu-Digest, X-Dushu-Marks, Content-Length');
  if (req.method !== 'OPTIONS') return false;
  if (!header(req, 'access-control-request-method') || !bridgeRequest(req, config, env)) { res.writeHead(403).end(); return true; }
  res.setHeader('Vary', 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers, Access-Control-Request-Private-Network');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  const wanted = header(req, 'access-control-request-headers').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  // Safari adds Cache-Control and Pragma to a request made with cache: 'no-store', which makes even a plain GET need a preflight.
  const allowed = wanted.filter(name => ['content-type', 'cache-control', 'pragma'].includes(name));
  res.setHeader('Access-Control-Allow-Headers', allowed.join(', ') || 'content-type');
  if (header(req, 'access-control-request-private-network') === 'true') res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Access-Control-Max-Age', '600');
  res.setHeader('Cache-Control', 'no-store');
  res.writeHead(204).end();
  return true;
}

export function privateGateway(config: () => PrivateAccess | null = privateAccess): Plugin {
  const install = (server: any) => { server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const path = new URL(req.url || '/', 'http://localhost').pathname;
    const bridge = isBridgeRoute(path);
    if (bridge && bridgeCors(req, res, config())) return;
    if (!(bridge ? bridgeRequest(req, config()) : trustedRequest(req, config()))) { res.writeHead(403, { 'Cache-Control': 'no-store' }).end('Private Dushu: connect with the Mac owner’s Tailscale account.'); return; }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    if (req.url?.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    if (path === '/api/private-status') {
      if (req.method !== 'GET') { res.writeHead(405).end(); return; }
      res.setHeader('Content-Type', 'application/json');
      const access = config();
      res.end(JSON.stringify({ app: 'dushu', url: access ? `https://${access.host}/` : null }));
      return;
    }
    next();
  }); };
  return { name: 'dushu-private-gateway', configureServer: install, configurePreviewServer: install };
}
