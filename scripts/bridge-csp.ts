// The page's Content-Security-Policy must let the public copy reach the owner's Mac and the sync account's server
// (core/cloud.ts CLOUD_URL), and the browser no longer calls Anthropic.
// The Mac's own name is never written here: a wildcard for Tailscale names covers it, and the app only ever connects to an
// address the owner typed or carried over in a one-time link (parseMacUrl).
import type { Plugin } from 'vite';
import { CLOUD_URL } from '../src/core/cloud';

export const BRIDGE_CONNECT = 'https://*.ts.net:*';

/** The sync server's origin for connect-src (none while this build has no server). The dev server also lets a page reach
 * the sync server run locally with wrangler dev (port 8787); a build never does. */
export function cloudConnect(url = CLOUD_URL, dev = false): string[] {
  const out = [];
  try { if (url) out.push(new URL(url).origin); } catch { /* no server */ }
  if (dev) out.push('http://127.0.0.1:8787', 'http://localhost:8787');
  return out;
}

/** Rewrites connect-src in the CSP meta tag: adds the Tailscale wildcard (and `extra`) once and drops the Anthropic API host. */
export function withBridgeConnectSrc(html: string, extra: string[] = []): string {
  return html.replace(/(<meta\s[^>]*http-equiv="Content-Security-Policy"[^>]*content=")([^"]*)(")/i, (_match, open: string, policy: string, close: string) => {
    const directives = policy.split(';').map(d => d.trim()).filter(Boolean).map(directive => {
      if (!/^connect-src\s/.test(directive)) return directive;
      const sources = directive.split(/\s+/).slice(1).filter(s => s !== 'https://api.anthropic.com');
      if (!sources.includes(BRIDGE_CONNECT)) sources.splice(1, 0, BRIDGE_CONNECT);
      for (const origin of extra) if (!sources.includes(origin)) sources.splice(sources.indexOf(BRIDGE_CONNECT) + 1, 0, origin);
      return `connect-src ${sources.join(' ')}`;
    });
    return `${open}${directives.join('; ')}${close}`;
  });
}

export function bridgeCsp(): Plugin {
  return { name: 'dushu-bridge-csp', transformIndexHtml: { order: 'post', handler: (html, ctx) => withBridgeConnectSrc(html, cloudConnect(CLOUD_URL, !!ctx.server)) } };
}
