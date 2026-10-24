// The launcher keeps the private iPad address up (scripts/ipad-access.mjs), with a stand-in for the Tailscale command line.
import { describe, expect, it } from 'vitest';
// @ts-expect-error a plain .mjs script
import { ensureIpadAccess } from '../../scripts/ipad-access.mjs';
// @ts-expect-error a plain .mjs script
import { setupIpad } from '../../scripts/setup-ipad.mjs';
// @ts-expect-error a plain .mjs script
import { START_WAIT_MS, stamp, waitForServer } from '../../scripts/start-local.mjs';

const HOST = 'my-mac.example-tailnet.ts.net:8443';
function fake(state: string, web: Record<string, unknown> | null, self?: { DNSName: string; CertDomains: string[] | null }) {
  const calls: string[] = [];
  const run = (args: string[]) => {
    calls.push(args.join(' '));
    if (args[0] === 'up') {
      // Like Tailscale on this Mac: it refuses until the non-default settings are named again.
      if (!args.includes('--accept-routes')) {
        throw Object.assign(new Error('exit 1'), { stderr: "Error: changing settings via 'tailscale up' requires mentioning all\nnon-default flags. To proceed, either re-run your command with --reset or\nuse the command below to explicitly mention the current value of\nall non-default settings:\n\n\ttailscale up --timeout=15s --accept-routes\n\n" });
      }
      if (state === 'Stopped') state = 'Running';
      return '';
    }
    if (args[0] === 'status') return JSON.stringify(self ? { BackendState: state, Self: { DNSName: self.DNSName }, CertDomains: self.CertDomains } : { BackendState: state });
    if (args[0] === 'serve' && args[1] === 'status') return JSON.stringify(web ? { Web: web } : {});
    return '';
  };
  return { run, calls };
}
const ours = { [HOST]: { Handlers: { '/': { Proxy: 'http://127.0.0.1:4317' } } } };

describe('keeping the iPad address up', () => {
  it('does nothing when Tailscale is on and the port is served', () => {
    const t = fake('Running', ours);
    expect(ensureIpadAccess(HOST, t.run)).toEqual([]);
    expect(t.calls).toEqual(['status --json', 'serve status --json']);
  });
  it('turns Tailscale back on when it was switched off', () => {
    const t = fake('Stopped', ours);
    expect(ensureIpadAccess(HOST, t.run)).toEqual(['Tailscale was off on this Mac, so it was turned back on.']);
    // It names the settings Tailscale asks for, and nothing else.
    expect(t.calls).toEqual(['status --json', 'up --timeout=15s', 'up --timeout=15s --accept-routes', 'status --json', 'serve status --json']);
  });
  it('serves the port again when the setting is gone', () => {
    const t = fake('Running', null);
    expect(ensureIpadAccess(HOST, t.run)).toHaveLength(1);
    expect(t.calls).toContain('serve --bg --https=8443 http://127.0.0.1:4317');
  });
  it('never signs in, and leaves a port another app serves', () => {
    const login = fake('NeedsLogin', null);
    expect(ensureIpadAccess(HOST, login.run)[0]).toMatch(/sign in again/);
    expect(login.calls).toEqual(['status --json']);
    const other = fake('Running', { [HOST]: { Handlers: { '/': { Proxy: 'http://127.0.0.1:9000' } } } });
    expect(ensureIpadAccess(HOST, other.run)[0]).toMatch(/left alone/);
    expect(other.calls.some((c) => c.startsWith('serve --bg'))).toBe(false);
  });
  it('says what to do, instead of waiting on Tailscale, when the Mac moved network or HTTPS is off', () => {
    const name = HOST.replace(/:8443$/, '');
    const fine = fake('Running', null, { DNSName: `${name}.`, CertDomains: [name] });
    expect(ensureIpadAccess(HOST, fine.run)).toHaveLength(1);
    expect(fine.calls).toContain('serve --bg --https=8443 http://127.0.0.1:4317');
    const movedMsg = `This Mac's Tailscale address is now my-mac.other-tailnet.ts.net (Dushu has ${name}). Run npm run ipad on this Mac to use it.`;
    const moved = fake('Running', null, { DNSName: 'my-mac.other-tailnet.ts.net.', CertDomains: ['my-mac.other-tailnet.ts.net'] });
    expect(ensureIpadAccess(HOST, moved.run)).toEqual([movedMsg]);
    // Moved to a network with HTTPS off (the tailnet move): both steps are named, HTTPS first.
    const movedNoHttps = fake('Running', null, { DNSName: 'my-mac.other-tailnet.ts.net.', CertDomains: null });
    const both = ensureIpadAccess(HOST, movedNoHttps.run);
    expect(both).toHaveLength(2);
    expect(both[0]).toMatch(/HTTPS certificates are off/);
    expect(both[1]).toBe(movedMsg);
    const noHttps = fake('Running', null, { DNSName: `${name}.`, CertDomains: null });
    expect(ensureIpadAccess(HOST, noHttps.run)).toEqual([expect.stringMatching(/HTTPS certificates are off/)]);
    for (const t of [moved, movedNoHttps, noHttps]) expect(t.calls.some((c) => c.startsWith('serve'))).toBe(false);
  });
});

describe('npm run ipad', () => {
  const name = HOST.replace(/:8443$/, '');
  const tailnet = (certs: string[] | null) => {
    const calls: string[] = [];
    const did: string[] = [];
    const run = (args: string[]) => {
      calls.push(args.join(' '));
      if (args[0] === 'status') return JSON.stringify({ BackendState: 'Running', Self: { DNSName: `${name}.`, UserID: 7 }, User: { 7: { LoginName: 'owner@example.com' } }, CertDomains: certs });
      if (args[0] === 'serve' && args[1] === 'status') return '{}';
      return '';
    };
    const deps = { run, save: () => did.push('save'), restart: () => { did.push('restart'); return ''; }, log: () => {} };
    return { deps, calls, did };
  };
  it('checks HTTPS certificates before it changes anything', () => {
    const off = tailnet(null);
    expect(() => setupIpad(off.deps)).toThrow(/HTTPS certificates are off.*Nothing was changed/);
    expect(off.did).toEqual([]);
    expect(off.calls).toEqual(['status --json']);
    const on = tailnet([name]);
    setupIpad(on.deps);
    expect(on.did).toEqual(['save', 'restart']);
    expect(on.calls).toContain('serve --bg --https=8443 http://127.0.0.1:4317');
  });
});

describe('the launcher waiting for its server', () => {
  const clock = () => { let t = 0; return { now: () => t, pause: async () => { t += 250; } }; };
  it('keeps waiting while the server it started is alive, up to about 90 s', async () => {
    // Answers after 30 s, as at login: the old loop gave up after about 6 s.
    const slow = clock();
    expect(await waitForServer({ answers: async () => slow.now() >= 30_000, holder: () => null, alive: () => true, ...slow })).toBe(true);
    expect(slow.now()).toBe(30_000);
    const never = clock();
    expect(await waitForServer({ answers: async () => false, holder: () => null, alive: () => true, ...never })).toBe(false);
    expect(START_WAIT_MS).toBeGreaterThanOrEqual(90_000);
    expect(never.now()).toBe(START_WAIT_MS);
  });
  it('counts this Dushu holding the port as running even when it is slow to answer, and stops when the server exits', async () => {
    const held = clock();
    expect(await waitForServer({ answers: async () => false, holder: () => 4242, alive: () => true, ...held })).toBe(true);
    expect(held.now()).toBe(0);
    const dead = clock();
    expect(await waitForServer({ answers: async () => false, holder: () => null, alive: () => false, ...dead })).toBe(false);
    expect(dead.now()).toBe(0);
  });
  it('stamps its log lines with the local time', () => {
    expect(stamp(new Date(2026, 9, 23, 8, 5, 2))).toBe('2026-10-23 08:05:02');
  });
});
