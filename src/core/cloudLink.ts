// Signing in brings a device everything the account knows about the owner's Mac. A device on the Mac (the Mac's own page,
// or the private Tailscale copy) tells the account the Mac's private address; a device elsewhere that is signed in learns it
// and connects, so the Mac's books are added the next time Tailscale is on (library.ts listens for BRIDGE_EVENT). A device
// the person disconnected from the Mac on purpose is left alone. Nothing here is in the build: the address comes from the
// owner's own Mac and is kept in the owner's account and browser.
import { accountInfo, cloudSession, shareMac } from './cloud';
import { connectMac, connectedMac, isMacOrigin, macDeclined, parseMacUrl } from './macBridge';

const SHARED_KEY = 'dushu.cloud.mac-shared.v1';

function storage(): Storage | undefined {
  try { return globalThis.localStorage; } catch { return undefined; }
}

/** This Mac's private address, when the page is on the Mac: its own origin over Tailscale, else what the Mac reports. */
async function ownMacAddress(): Promise<string | null> {
  if (location.protocol === 'https:' && location.hostname.endsWith('.ts.net')) return parseMacUrl(location.origin);
  const res = await fetch('/api/private-status', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
  if (!res.ok) return null;
  const data = await res.json() as { url?: unknown };
  return typeof data.url === 'string' ? parseMacUrl(data.url) : null;
}

let running: Promise<void> | null = null;

/** Shares or learns the Mac's address for the signed-in account. Never throws; does nothing when signed out. */
export function linkMac(): Promise<void> {
  running ??= (async () => {
    const s = cloudSession();
    if (!s) return;
    try {
      if (isMacOrigin()) {
        const mine = await ownMacAddress();
        const mark = `${s.email}|${mine}`;
        if (mine && storage()?.getItem(SHARED_KEY) !== mark) {
          await shareMac(mine);
          storage()?.setItem(SHARED_KEY, mark);
        }
      } else if (!connectedMac() && !macDeclined()) {
        const info = await accountInfo();
        const mac = info?.mac ? parseMacUrl(info.mac) : null;
        if (mac) connectMac(mac);
      }
    } catch { /* offline or the server is busy: tried again on the next start or sign-in */ }
  })().finally(() => { running = null; });
  return running;
}
