// The page's Content-Security-Policy must let the public copy reach the owner's Mac, and the browser no longer calls Anthropic.
// The Mac's own name is never written here: a wildcard for Tailscale names covers it, and the app only ever connects to an
// address the owner typed or carried over in a one-time link (parseMacUrl).
import type { Plugin } from 'vite';

export const BRIDGE_CONNECT = 'https://*.ts.net:*';

/** Rewrites connect-src in the CSP meta tag: adds the Tailscale wildcard once and drops the Anthropic API host. */
export function withBridgeConnectSrc(html: string): string {
  return html.replace(/(<meta\s[^>]*http-equiv="Content-Security-Policy"[^>]*content=")([^"]*)(")/i, (_match, open: string, policy: string, close: string) => {
    const directives = policy.split(';').map(d => d.trim()).filter(Boolean).map(directive => {
      if (!/^connect-src\s/.test(directive)) return directive;
      const sources = directive.split(/\s+/).slice(1).filter(s => s !== 'https://api.anthropic.com');
      if (!sources.includes(BRIDGE_CONNECT)) sources.splice(1, 0, BRIDGE_CONNECT);
      return `connect-src ${sources.join(' ')}`;
    });
    return `${open}${directives.join('; ')}${close}`;
  });
}

export function bridgeCsp(): Plugin {
  return { name: 'dushu-bridge-csp', transformIndexHtml: { order: 'post', handler: withBridgeConnectSrc } };
}
