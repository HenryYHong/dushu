// Start the local build independently of the terminal or chat that launches it.
import { execFileSync, spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureModelService } from './start-model.mjs';
import { ensureIpadAccess } from './ipad-access.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const state = join(root, '.dushu-local');
const url = 'http://localhost:4317/';
/** How long a server that is still starting is waited for. At login, with everything else starting, it can take 15 s or more. */
export const START_WAIT_MS = 90_000;

/** Local time for the log lines (the login job appends to one log): 2026-10-23 08:15:02. */
export const stamp = (d = new Date()) => d.toLocaleString('sv-SE');
const say = (...a) => console.log(`[${stamp()}]`, ...a);
const warn = (...a) => console.error(`[${stamp()}]`, ...a);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Waits for the server. Ready when it answers as Dushu, or when this folder's Dushu holds the port but is slow to answer.
 * Gives up when the spawned server has exited (and no Dushu holds the port), or after `limitMs` while it is still starting.
 */
export async function waitForServer({ answers, holder, alive, limitMs = START_WAIT_MS, now = Date.now, pause = () => sleep(250) }) {
  const start = now();
  for (;;) {
    if (await answers() || holder()) return true;
    if (!alive() || now() - start >= limitMs) return !!holder();
    await pause();
  }
}

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
async function running() {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
    return response.ok && /<meta\s+name="application-name"\s+content="Dushu"/.test(await response.text());
  } catch { return false; }
}

async function main() {
  await ensureModelService();
  if (process.argv.includes('--restart')) {
    let saved = null;
    try { saved = readFileSync(join(state, 'server.pid'), 'utf8').trim(); } catch { /* never started from here */ }
    // The saved PID can be stale (a second start that lost the port to a running server): then the server on the port is
    // stopped, but only after checking it is this Dushu. Never an unrelated PID, nor every process on a port.
    const pid = saved && /^\d+$/.test(saved) && isDushu(saved) ? Number(saved) : listener();
    if (pid) {
      try { process.kill(pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      for (let i = 0; i < 25 && isDushu(pid); i++) await sleep(200);
    }
  }

  // A Dushu that holds the port but is slow to answer (busy at login) is running: a second one would only lose the port.
  if (await running() || listener()) {
    say(`Dushu is already running at ${url}`);
  } else {
    mkdirSync(state, { recursive: true });
    const log = openSync(join(state, 'server.log'), 'a');
    // Only this launcher names the owner's sync folder (scripts/sync-bridge.ts has no default): a server started any other
    // way, such as npm run dev, npm run preview or a QA script, answers that sync is off and never touches his words.
    const child = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', '4317', '--strictPort'], {
      cwd: root, detached: true, stdio: ['ignore', log, log], env: { ...process.env, DUSHU_SYNC_DIR: join(state, 'sync'), DUSHU_ACCOUNT_BOOKS: '1' },
    });
    closeSync(log);
    child.unref();
    child.on('error', error => { warn(error.message); process.exitCode = 1; });
    const ready = await waitForServer({ answers: running, holder: listener, alive: () => child.exitCode === null && child.signalCode === null });
    // Save the server that answers, which is not this child when one was already running but slow to answer.
    const pid = (ready && listener()) || child.pid;
    if (pid) writeFileSync(join(state, 'server.pid'), String(pid));
    if (!ready) {
      warn(`Dushu could not start. See ${join(state, 'server.log')}`);
      process.exitCode = 1;
    } else say(`Dushu is running at ${url}. It stays running after this window closes.`);
  }
  // Even when the server did not start: the iPad address check is independent of it, and the login job runs it here.
  try {
    const access = JSON.parse(readFileSync(join(state, 'ipad.json'), 'utf8'));
    if (typeof access.host === 'string' && /^[a-z0-9.-]+\.ts\.net:8443$/.test(access.host)) {
      // The iPad address stays up: Tailscale back on and the port served again if either went away.
      try { for (const note of ensureIpadAccess(access.host)) say(note); }
      catch (error) { warn(`Could not check Tailscale: ${error.message}`); }
      say(`Configured iPad address: https://${access.host}/ (keep this Mac awake).`);
    }
  } catch { /* Local-only installation: no private endpoint configured. */ }
}

// Run when started as a script (Dushu.command, npm start, the login job, npm run ipad); tests import the helpers only.
if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) await main();
