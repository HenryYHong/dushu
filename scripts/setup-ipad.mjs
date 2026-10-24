// Uses the existing private Tailscale account. No Funnel, open LAN ports, router changes or certificate bypass.
import { execFileSync } from 'node:child_process';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HTTPS_OFF } from './ipad-access.mjs';
const root = dirname(dirname(fileURLToPath(import.meta.url)));

/** Sets up the iPad address. `run` is the Tailscale command line; `save` and `restart` are what change this Mac. */
export function setupIpad({ run, save, restart, log = console.log }) {
  const status = JSON.parse(run(['status', '--json']));
  if (status.BackendState !== 'Running') throw new Error('Connect Tailscale on this Mac first, then run npm run ipad.');
  const hostname = status.Self?.DNSName?.replace(/\.$/, '');
  const owner = status.User?.[status.Self?.UserID]?.LoginName;
  if (!hostname?.endsWith('.ts.net') || !owner) throw new Error('A signed-in, untagged Tailscale Mac with MagicDNS is required.');
  // Checked before anything changes: without certificates `tailscale serve` cannot serve the address and waits.
  if (!status.CertDomains?.length) throw new Error(`${HTTPS_OFF} Then run npm run ipad again. Nothing was changed.`);
  const serve = JSON.parse(run(['serve', 'status', '--json']));
  const existing = serve.Web?.[`${hostname}:8443`];
  if (existing && JSON.stringify(existing) !== JSON.stringify({ Handlers: { '/': { Proxy: 'http://127.0.0.1:4317' } } })) {
    throw new Error('Port 8443 already serves another app. Nothing was changed.');
  }
  save({ host: `${hostname}:8443`, owner });
  log(restart());
  log(run(['serve', '--bg', '--https=8443', 'http://127.0.0.1:4317']));
  log(`Open on iPad (same Tailscale account): https://${hostname}:8443/?importLocalBooks#/`);
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  process.chdir(root);
  try {
    setupIpad({
      run: (args) => execFileSync('tailscale', args, { encoding: 'utf8', timeout: 30000 }),
      save: (access) => {
        mkdirSync('.dushu-local', { recursive: true });
        writeFileSync('.dushu-local/ipad.json', JSON.stringify(access), { mode: 0o600 });
      },
      // The launcher waits up to about 90 s for a server that is slow to start (at login it can take 15 s or more).
      restart: () => execFileSync(process.execPath, [join(root, 'scripts/start-local.mjs'), '--restart'], { encoding: 'utf8', timeout: 150_000 }),
    });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
