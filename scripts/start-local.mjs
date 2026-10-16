// Start the local build independently of the terminal or chat that launches it.
import { execFileSync, spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureModelService } from './start-model.mjs';
import { ensureIpadAccess } from './ipad-access.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const state = join(root, '.dushu-local');
const url = 'http://localhost:4317/';
await ensureModelService();
if (process.argv.includes('--restart')) {
  try {
    const saved = readFileSync(join(state, 'server.pid'), 'utf8').trim();
    if (!/^\d+$/.test(saved)) throw new Error('Invalid saved server PID');
    const command = execFileSync('/bin/ps', ['-p', saved, '-o', 'command='], { encoding: 'utf8' });
    if (!command.includes(`${join(root, 'node_modules/vite/bin/vite.js')} preview --host `) || !command.includes('--port 4317 --strictPort')) {
      throw new Error('The saved PID no longer belongs to Dushu; it was not stopped.');
    }
    process.kill(Number(saved), 'SIGTERM');
    await new Promise(resolve => setTimeout(resolve, 400));
  } catch (error) {
    // An exited process is fine. Never stop an unrelated PID or all processes on a port.
    if (error.status !== 1 && error.code !== 'ENOENT' && error.code !== 'ESRCH') throw error;
  }
}
async function running() {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
    return response.ok && /<meta\s+name="application-name"\s+content="Dushu"/.test(await response.text());
  } catch { return false; }
}

if (await running()) {
  console.log(`Dushu is already running at ${url}`);
} else {
  mkdirSync(state, { recursive: true });
  const log = openSync(join(state, 'server.log'), 'a');
  const child = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', '4317', '--strictPort'], {
    cwd: root, detached: true, stdio: ['ignore', log, log],
  });
  closeSync(log);
  child.unref();
  child.on('error', error => { console.error(error.message); process.exitCode = 1; });
  if (child.pid) writeFileSync(join(state, 'server.pid'), String(child.pid));
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await running()) { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!ready) {
    console.error(`Dushu could not start. See ${join(state, 'server.log')}`);
    process.exitCode = 1;
  } else console.log(`Dushu is running at ${url}. It stays running after this window closes.`);
}
if (!process.exitCode) {
  try {
    const access = JSON.parse(readFileSync(join(state, 'ipad.json'), 'utf8'));
    if (typeof access.host === 'string' && /^[a-z0-9.-]+\.ts\.net:8443$/.test(access.host)) {
      // The iPad address stays up: Tailscale back on and the port served again if either went away.
      try { for (const note of ensureIpadAccess(access.host)) console.log(note); }
      catch (error) { console.error(`Could not check Tailscale: ${error.message}`); }
      console.log(`Configured iPad address: https://${access.host}/ (keep this Mac awake).`);
    }
  } catch { /* Local-only installation: no private endpoint configured. */ }
}
