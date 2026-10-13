import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BRIDGE_EVENT, BridgeUnavailable, PUBLIC_APP_URL, bridgeBase, bridgeFetch, bridgeUrl, connectMac, connectedMac, disconnectMac, handoffLink,
  hasMacBridge, isCrossOriginBridge, parseMacUrl, probeMac,
} from '../../src/core/macBridge';

const MAC = 'https://my-mac.tail1234.ts.net:8443';

function memStorage(init: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(init));
  return {
    get length() { return m.size; }, clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => m.get(k) ?? null, removeItem: (k) => { m.delete(k); }, setItem: (k, v) => { m.set(k, String(v)); },
  };
}
function page(url: string, stored?: string) {
  const u = new URL(url);
  vi.stubGlobal('location', { hostname: u.hostname, protocol: u.protocol, origin: u.origin, href: u.href });
  const storage = memStorage(stored ? { 'dushu.mac-bridge.v1': stored } : {});
  vi.stubGlobal('localStorage', storage);
  return storage;
}
afterEach(() => { vi.unstubAllGlobals(); });

describe('parseMacUrl', () => {
  it.each([
    [MAC, MAC], ['my-mac.tail1234.ts.net:8443', MAC], [`${MAC}/`, MAC], ['  https://my-mac.tail1234.ts.net  ', 'https://my-mac.tail1234.ts.net'],
    ['MY-MAC.Tail1234.ts.net:8443', MAC], ['http://localhost:5240', 'http://localhost:5240'], ['http://127.0.0.1:5240/', 'http://127.0.0.1:5240'],
  ])('accepts %s', (input, origin) => { expect(parseMacUrl(input)).toBe(origin); });

  it.each([
    '', '   ', 'http://my-mac.tail1234.ts.net:8443', 'https://evil.example', 'https://my-mac.tail1234.ts.net.evil.example', 'https://ts.net',
    'https://user:pw@my-mac.tail1234.ts.net', `${MAC}/path`, `${MAC}/?a=1`, `${MAC}/#x`, 'javascript:alert(1)', 'ftp://my-mac.tail1234.ts.net',
    'https://localhost:5240', 'http://localhost.evil.example', 'http://192.168.1.5:8443', 'https://100.64.1.2:8443', 'not a url at all',
  ])('refuses %j', (input) => { expect(parseMacUrl(input)).toBeNull(); });
});

describe('where bridge requests go', () => {
  it('uses the page itself on the Mac (localhost or the private address) and nothing on the public site', () => {
    for (const url of ['http://localhost:5240/', 'http://127.0.0.1:4317/', 'https://my-mac.tail1234.ts.net:8443/']) {
      page(url);
      expect(bridgeBase()).toBe('');
      expect(hasMacBridge()).toBe(true);
      expect(isCrossOriginBridge()).toBe(false);
      expect(bridgeUrl('/api/claude/status')).toBe('/api/claude/status');
    }
    page('https://henryyhong.com/dushu/');
    expect(bridgeBase()).toBeNull();
    expect(hasMacBridge()).toBe(false);
    expect(bridgeUrl('/api/claude/status')).toBeNull();
  });

  it('uses the Mac this device was connected to, once it is', () => {
    const storage = page('https://henryyhong.com/dushu/');
    expect(connectMac(MAC)).toBe(MAC);
    expect(storage.getItem('dushu.mac-bridge.v1')).toBe(MAC);
    expect(connectedMac()).toBe(MAC);
    expect(hasMacBridge()).toBe(true);
    expect(isCrossOriginBridge()).toBe(true);
    expect(bridgeUrl('/api/claude/status')).toBe(`${MAC}/api/claude/status`);
    disconnectMac();
    expect(connectedMac()).toBeNull();
    expect(hasMacBridge()).toBe(false);
  });

  it('keeps the address out of anything but its own storage entry', () => {
    const storage = page('https://henryyhong.com/dushu/');
    connectMac(MAC);
    expect(storage.length).toBe(1);
    expect(storage.key(0)).toBe('dushu.mac-bridge.v1');
  });

  it('refuses a bad address and ignores a damaged stored one', () => {
    const storage = page('https://henryyhong.com/dushu/');
    expect(connectMac('https://evil.example')).toBeNull();
    expect(storage.length).toBe(0);
    page('https://henryyhong.com/dushu/', 'https://evil.example');
    expect(connectedMac()).toBeNull();
    expect(hasMacBridge()).toBe(false);
  });

  it('treats a connected address equal to the page origin as the page itself', () => {
    page('https://my-mac.tail1234.ts.net:8443/', MAC);
    expect(bridgeBase()).toBe('');
    page('http://localhost:5241/', 'http://localhost:5240');
    expect(bridgeBase()).toBe('http://localhost:5240');
  });

  it('survives storage that throws', () => {
    vi.stubGlobal('location', { hostname: 'henryyhong.com', protocol: 'https:', origin: 'https://henryyhong.com' });
    vi.stubGlobal('localStorage', { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } });
    expect(connectedMac()).toBeNull();
    expect(connectMac(MAC)).toBeNull();
    expect(() => disconnectMac()).not.toThrow();
  });

  it('announces a change so open screens can try again', () => {
    page('https://henryyhong.com/dushu/');
    const seen: string[] = [];
    vi.stubGlobal('dispatchEvent', (e: Event) => { seen.push(e.type); return true; });
    connectMac(MAC);
    disconnectMac();
    expect(seen).toEqual([BRIDGE_EVENT, BRIDGE_EVENT]);
  });
});

describe('bridgeFetch', () => {
  it('sends nothing to the Mac with cookies or credentials from the public site', async () => {
    page('https://henryyhong.com/dushu/', MAC);
    const fetch = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    await bridgeFetch('/api/claude/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', credentials: 'include' });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${MAC}/api/claude/translate`);
    expect(init.credentials).toBe('omit');
    expect(init.cache).toBeUndefined(); // no-store would make Safari preflight a plain GET; the Mac sends no-store itself
    expect(init.method).toBe('POST');
  });

  it('stays same-origin on the Mac', async () => {
    page('http://localhost:5240/');
    const fetch = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    await bridgeFetch('/api/claude/status');
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/claude/status');
    expect(init.credentials).toBe('same-origin');
    expect(init.cache).toBe('no-store');
  });

  it('fails clearly, without any request, when there is no Mac', async () => {
    page('https://henryyhong.com/dushu/');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(bridgeFetch('/api/claude/status')).rejects.toBeInstanceOf(BridgeUnavailable);
    await expect(bridgeFetch('/api/claude/status')).rejects.toThrow(/not connected to your Mac/);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('probeMac', () => {
  const answer = (response: Response) => { const fetch = vi.fn(async () => response); vi.stubGlobal('fetch', fetch); return fetch; };
  it('accepts a Dushu bridge and asks without credentials', async () => {
    const fetch = answer(new Response(JSON.stringify({ app: 'dushu', url: `${MAC}/` })));
    expect(await probeMac(MAC)).toEqual({ url: `${MAC}/` });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${MAC}/api/private-status`);
    expect(init.credentials).toBe('omit');
  });
  it('says what is wrong when the Mac refuses this device or the address is something else', async () => {
    answer(new Response(null, { status: 403 }));
    await expect(probeMac(MAC)).rejects.toThrow(/did not accept this device/);
    answer(new Response(JSON.stringify({ hello: 'world' })));
    await expect(probeMac(MAC)).rejects.toThrow(/did not answer like Dushu/);
    answer(new Response('<html>', { status: 200 }));
    await expect(probeMac(MAC)).rejects.toThrow(/did not answer like Dushu/);
    answer(new Response(null, { status: 404 }));
    await expect(probeMac(MAC)).rejects.toThrow(/did not answer like Dushu/);
  });
});

describe('the hand-off link', () => {
  it('opens Settings on the public site with the address in the part the server never sees', () => {
    const link = handoffLink(`${MAC}/`)!;
    expect(link).toBe(`${PUBLIC_APP_URL}#/settings?connect=${encodeURIComponent(MAC)}`);
    const url = new URL(link);
    expect(url.origin).toBe('https://henryyhong.com');
    expect(url.search).toBe('');
    expect(new URLSearchParams(url.hash.split('?')[1]).get('connect')).toBe(MAC);
    expect(parseMacUrl(new URLSearchParams(url.hash.split('?')[1]).get('connect')!)).toBe(MAC);
  });
  it('makes no link for an address that is not the owner\'s Mac', () => {
    expect(handoffLink('https://evil.example')).toBeNull();
    expect(handoffLink('')).toBeNull();
  });
});

// The public bundle and the repo must not carry the Mac's private address: it comes from .dushu-local/ipad.json at run time.
describe('the Mac\'s private address stays out of the repo and the build', () => {
  const root = process.cwd();
  const private_ = (() => { try { return JSON.parse(readFileSync(join(root, '.dushu-local/ipad.json'), 'utf8')) as { host?: string }; } catch { return null; } })();
  const files = (dir: string, out: string[] = []): string[] => {
    if (!existsSync(dir)) return out;
    for (const name of readdirSync(dir)) {
      if (['node_modules', '.git', '.cache', 'data', 'fonts', 'samples', 'cmaps', 'fixtures'].includes(name)) continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) files(path, out);
      else if (/\.(ts|mjs|js|css|html|json|md|webmanifest|command|py)$/.test(name) && statSync(path).size < 3_000_000) out.push(path);
    }
    return out;
  };
  it.skipIf(!private_?.host)('is in no source, document, script, test or built file', () => {
    const host = private_!.host!.split(':')[0];
    const tailnet = host.split('.').slice(1).join('.');
    const hits = [
      ...['src', 'scripts', 'tests', 'public', 'dist'].flatMap(d => files(join(root, d))),
      ...['README.md', 'ARCHITECTURE.md', 'index.html', 'vite.config.ts', 'package.json'].map(f => join(root, f)).filter(existsSync),
    ].filter(path => { const text = readFileSync(path, 'utf8'); return text.includes(host) || (tailnet.split('.')[0] !== 'ts' && text.includes(tailnet)); });
    expect(hits.map(p => p.slice(root.length + 1))).toEqual([]);
  });
});
