// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://henryyhong.com/dushu/" }
// On the public site, a device signed in learns where the owner's Mac is from the account and connects to it, so the Mac's
// books come the next time Tailscale is on; one the person disconnected from the Mac on purpose stays disconnected.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../../cloud/src/worker';
import { cloudSession, requestCode, signIn } from '../../src/core/cloud';
import { linkMac } from '../../src/core/cloudLink';
import { BRIDGE_EVENT, connectMac, connectedMac, disconnectMac, isMacOrigin } from '../../src/core/macBridge';
import { cloud } from './helpers';

beforeEach(() => { vi.spyOn(console, 'log').mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear(); });

async function signedInWithMac(mac?: string) {
  const c = cloud({ OWNER_EMAILS: 'reader@example.com' });
  let code = '';
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const res = await worker.fetch(new Request(req.url, { method: req.method, headers: req.headers, body: req.method === 'GET' ? undefined : await req.text() }), c.env);
    if (req.url.endsWith('/auth/code') && res.ok) code = (await res.clone().json() as { devCode: string }).devCode;
    return res;
  });
  localStorage.setItem('dushu.cloud.url.v1', 'https://sync.test');
  await requestCode('reader@example.com');
  await signIn('reader@example.com', code);
  if (mac) {
    await worker.fetch(new Request('https://sync.test/me', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cloudSession()!.token}` }, body: JSON.stringify({ mac }) }), c.env);
  }
}

describe('a signed-in device on the public site', () => {
  it('connects to the Mac the account knows, and the library hears of it', async () => {
    expect(isMacOrigin()).toBe(false);
    await signedInWithMac('https://my-mac.tail1234.ts.net:8443');
    const heard = vi.fn();
    window.addEventListener(BRIDGE_EVENT, heard);
    await linkMac();
    window.removeEventListener(BRIDGE_EVENT, heard);
    expect(connectedMac()).toBe('https://my-mac.tail1234.ts.net:8443');
    expect(heard).toHaveBeenCalled();
  });

  it('stays disconnected when the person disconnected it, and does nothing when the account knows no Mac', async () => {
    await signedInWithMac('https://my-mac.tail1234.ts.net:8443');
    connectMac('https://my-mac.tail1234.ts.net:8443');
    disconnectMac();
    await linkMac();
    expect(connectedMac()).toBeNull();
    localStorage.clear();
    await signedInWithMac();
    await linkMac();
    expect(connectedMac()).toBeNull();
  });
});
