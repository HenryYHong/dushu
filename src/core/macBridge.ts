// How this device reaches the Mac's private services (Claude, the local model, Premium voices, the owner's books).
// On the private site (localhost or the Tailscale address) the bridge is the page's own origin. On the public copy of the
// app the owner connects once per device: the Mac's private address is kept in this browser only, never in the build,
// the settings or a backup. The server still decides who may use it (the owner's exact Tailscale identity).

const STORE_KEY = 'dushu.mac-bridge.v1';
/** Set when the person disconnected this device from the Mac: signing in never connects it again by itself. */
const DECLINED_KEY = 'dushu.mac-bridge.declined.v1';
/** Where the public copy of the app lives. The hand-off link opens it; nothing private is in this address. */
export const PUBLIC_APP_URL = 'https://henryyhong.com/dushu/';
/** Fired on window when the connected Mac changes, so open screens can try again. */
export const BRIDGE_EVENT = 'dushu:bridge';

const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])$/;

/** True when the page itself is served by the Mac (localhost, or the private Tailscale address over HTTPS). */
export function isMacOrigin(): boolean {
  return typeof location !== 'undefined' && (LOOPBACK.test(location.hostname)
    || (location.protocol === 'https:' && location.hostname.endsWith('.ts.net')));
}

/**
 * The origin of a Mac address a person typed or a link carried, or null. Accepts the Tailscale name (https, *.ts.net,
 * optional port, nothing else) and, for testing on one machine, a loopback address. Credentials, paths and queries are refused.
 */
export function parseMacUrl(input: string): string | null {
  let text = input.trim();
  if (!text) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`;
  let url: URL;
  try { url = new URL(text); } catch { return null; }
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) return null;
  const tailnet = url.protocol === 'https:' && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.ts\.net$/.test(url.hostname);
  const loopback = url.protocol === 'http:' && LOOPBACK.test(url.hostname);
  return tailnet || loopback ? url.origin : null;
}

function storage(): Storage | undefined {
  try { return globalThis.localStorage; } catch { return undefined; }
}

/** The Mac this device was connected to, or null. */
export function connectedMac(): string | null {
  try {
    const value = storage()?.getItem(STORE_KEY);
    return value ? parseMacUrl(value) : null;
  } catch { return null; }
}
function announce(): void {
  try { globalThis.dispatchEvent?.(new Event(BRIDGE_EVENT)); } catch { /* no window */ }
}
export function connectMac(url: string): string | null {
  const origin = parseMacUrl(url);
  if (!origin) return null;
  try { storage()?.setItem(STORE_KEY, origin); storage()?.removeItem(DECLINED_KEY); } catch { return null; }
  announce();
  return origin;
}
export function disconnectMac(): void {
  try { storage()?.removeItem(STORE_KEY); storage()?.setItem(DECLINED_KEY, '1'); } catch { /* nothing stored */ }
  announce();
}
/** Whether the person disconnected this device from the Mac on purpose (core/cloudLink.ts leaves it so). */
export function macDeclined(): boolean {
  try { return storage()?.getItem(DECLINED_KEY) === '1'; } catch { return false; }
}

/**
 * Where bridge requests go: '' for the page's own origin, an origin for the connected Mac, or null when this device has no way
 * to reach one. A Mac the person connected on purpose wins over the page's own origin.
 */
export function bridgeBase(): string | null {
  const mac = connectedMac();
  if (mac && !(typeof location !== 'undefined' && mac === location.origin)) return mac;
  return isMacOrigin() ? '' : null;
}

/** Whether this device can try the Mac at all. It does not mean the Mac is awake: ask the status route for that. */
export function hasMacBridge(): boolean {
  return bridgeBase() !== null;
}

/** True when requests cross to another origin (the public site talking to the Mac). */
export function isCrossOriginBridge(): boolean {
  return !!bridgeBase();
}

export function bridgeUrl(path: string): string | null {
  const base = bridgeBase();
  return base === null ? null : `${base}${path}`;
}

export class BridgeUnavailable extends Error {
  constructor() { super('This device is not connected to your Mac. Connect it in Settings.'); this.name = 'BridgeUnavailable'; }
}

/**
 * fetch for a bridge path such as '/api/claude/status'. Cross-origin calls never send cookies or credentials; the Mac
 * decides by the owner's Tailscale identity. Throws BridgeUnavailable when there is no Mac to ask.
 */
export function bridgeFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const url = bridgeUrl(path);
  if (url === null) return Promise.reject(new BridgeUnavailable());
  // The Mac sends Cache-Control: no-store itself. Asking for no-store in the request would add headers that make Safari
  // preflight even a plain GET, so the option is only set for the page's own origin.
  if (isCrossOriginBridge()) return fetch(url, { ...init, cache: undefined, credentials: 'omit' });
  return fetch(url, { cache: 'no-store', ...init, credentials: init.credentials ?? 'same-origin' });
}

/** Checks that the address is a Dushu bridge that answers this device. Resolves the Mac's own private address. */
export async function probeMac(origin: string, signal?: AbortSignal): Promise<{ url: string | null }> {
  const response = await fetch(`${origin}/api/private-status`, {
    credentials: 'omit', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(6000)]) : AbortSignal.timeout(6000),
  });
  if (response.status === 403) throw new Error('Your Mac answered but did not accept this device. Sign in to Tailscale with the same account as the Mac.');
  if (!response.ok) throw new Error('That address did not answer like Dushu on your Mac.');
  const data = await response.json().catch(() => null) as { app?: string; url?: string | null } | null;
  if (!data || data.app !== 'dushu') throw new Error('That address did not answer like Dushu on your Mac.');
  return { url: typeof data.url === 'string' ? data.url : null };
}

/** The one-time hand-off link the private site shows: it opens Settings on the public site with the Mac address filled in. */
export function handoffLink(macUrl: string, appUrl = PUBLIC_APP_URL): string | null {
  const origin = parseMacUrl(macUrl);
  return origin ? `${appUrl}#/settings?connect=${encodeURIComponent(origin)}` : null;
}
