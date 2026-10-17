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

/** True when this PID is this folder's Dushu server. */
function isDushu(pid) {
  try {
    const command = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
    return command.includes(`${join(root, 'node_modules/vite/bin/vite.js')} preview --host `) && command.includes('--port 4317 --strictPort');
  } catch { return false; }
}
/** The PID serving port 4317 when it is this folder's Dushu server, else null. */
function listener() {
  try {
    const pids = execFileSync('/usr/sbin/lsof', ['-nP', '-t', '-iTCP:4317', '-sTCP:LISTEN'], { encoding: 'utf8' }).split('\n').filter(Boolean);
    return pids.length === 1 && isDushu(pids[0]) ? Number(pids[0]) : null;
  } catch { return null; }
}

if (process.argv.includes('--restart')) {
  let saved = null;
  try { saved = readFileSync(join(state, 'server.pid'), 'utf8').trim(); } catch { /* never started from here */ }
  // The saved PID can be stale (a second start that lost the port to a running server): then the server on the port is
  // stopped, but only after checking it is this Dushu. Never an unrelated PID, nor every process on a port.
  const pid = saved && /^\d+$/.test(saved) && isDushu(saved) ? Number(saved) : listener();
  if (pid) {
    try { process.kill(pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    for (let i = 0; i < 25 && isDushu(pid); i++) await new Promise(resolve => setTimeout(resolve, 200));
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
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await running()) { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  // Save the server that answers, which is not this child when one was already running but slow to answer.
  const pid = (ready && listener()) || child.pid;
  if (pid) writeFileSync(join(state, 'server.pid'), String(pid));
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
