// Keeps the private iPad address up: Tailscale connected and port 8443 served to this Mac's Dushu. start-local.mjs runs it
// when iPad access is set up (npm run ipad), and the login job runs start-local.mjs every 15 minutes, so the owner's
// devices can always reach the Mac for its books and sync. It never signs in, changes the account or takes over a port
// another app serves.
import { execFileSync } from 'node:child_process';

// The Mac app's binary is also its command line, and it decides which to be from TERM: without it (as under the login job)
// it starts as the app and never returns. So TERM is always set for it.
const CLIS = ['/Applications/Tailscale.app/Contents/MacOS/tailscale', 'tailscale'];

/** Runs the Tailscale command line. */
export function tailscale(args) {
  let missing;
  const env = { ...process.env, TERM: process.env.TERM || 'dumb' };
  for (const cli of CLIS) {
    try { return execFileSync(cli, args, { encoding: 'utf8', timeout: 25000, stdio: ['ignore', 'pipe', 'pipe'], env }); }
    catch (e) { if (e.code === 'ENOENT') { missing = e; continue; } throw e; }
  }
  throw missing ?? new Error('Tailscale is not installed.');
}

/** `host` is "name.tailnet.ts.net:8443". Returns what it did or found, for the log; empty when all was well. */
export function ensureIpadAccess(host, run = tailscale) {
  const notes = [];
  const state = JSON.parse(run(['status', '--json'])).BackendState;
  if (state === 'NeedsLogin' || state === 'NeedsMachineAuth' || state === 'NoState') {
    return ['Tailscale needs you to sign in again on this Mac (open Tailscale), so your iPad cannot reach Dushu until then.'];
  }
  if (state === 'Stopped') {
    try { run(['up', '--timeout=15s']); } catch (e) {
      // "tailscale up" refuses unless every setting that is not the default is named again, and says how: run exactly
      // that, so the Mac's settings stay as they are (here --accept-routes).
      const again = /^\s*tailscale (up(?: --?[\w-]+(?:=\S+)?)*)\s*$/m.exec(String(e?.stderr ?? ''))?.[1];
      if (again) { try { run(again.split(/\s+/)); } catch { /* the state below says whether it worked */ } }
    }
    const now = JSON.parse(run(['status', '--json'])).BackendState;
    notes.push(now === 'Running' ? 'Tailscale was off on this Mac, so it was turned back on.' : `Tailscale was off on this Mac and did not come back on (${now}).`);
  }
  const web = JSON.parse(run(['serve', 'status', '--json']) || '{}').Web?.[host];
  const target = web?.Handlers?.['/']?.Proxy;
  if (!web) {
    run(['serve', '--bg', '--https=8443', 'http://127.0.0.1:4317']);
    notes.push('The iPad address was not set up in Tailscale, so it was set up again.');
  } else if (target && !/^http:\/\/(127\.0\.0\.1|localhost):4317\/?$/.test(target)) {
    notes.push(`Port 8443 serves something else (${target}), so it was left alone.`);
  }
  return notes;
}
