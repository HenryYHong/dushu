// Uses the existing private Tailscale account. No Funnel, open LAN ports, router changes or certificate bypass.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
process.chdir(root);
const run = (args) => execFileSync('tailscale', args, { encoding: 'utf8', timeout: 30000 });
try {
  const status = JSON.parse(run(['status', '--json']));
  if (status.BackendState !== 'Running') throw new Error('Connect Tailscale on this Mac first, then run npm run ipad.');
  const hostname = status.Self?.DNSName?.replace(/\.$/, '');
  const owner = status.User?.[status.Self?.UserID]?.LoginName;
  if (!hostname?.endsWith('.ts.net') || !owner) throw new Error('A signed-in, untagged Tailscale Mac with MagicDNS is required.');
  const serve = JSON.parse(run(['serve', 'status', '--json']));
  const existing = serve.Web?.[`${hostname}:8443`];
  if (existing && JSON.stringify(existing) !== JSON.stringify({ Handlers: { '/': { Proxy: 'http://127.0.0.1:4317' } } })) {
    throw new Error('Port 8443 already serves another app. Nothing was changed.');
  }
  mkdirSync('.dushu-local', { recursive: true });
  writeFileSync('.dushu-local/ipad.json', JSON.stringify({ host: `${hostname}:8443`, owner }), { mode: 0o600 });
  console.log(execFileSync(process.execPath, [join(root, 'scripts/start-local.mjs'), '--restart'], { encoding: 'utf8', timeout: 15000 }));
  console.log(run(['serve', '--bg', '--https=8443', 'http://127.0.0.1:4317']));
  console.log(`Open on iPad (same Tailscale account): https://${hostname}:8443/?importLocalBooks#/`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
