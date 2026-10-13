// Start the already-installed Ollama only when unreachable. Never download a model or alter Tailscale settings.
import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(dirname(fileURLToPath(import.meta.url)));

async function launchModel() {
  const state = join(root, '.dushu-local');
  mkdirSync(state, { recursive: true });
  const log = openSync(join(state, 'ollama.log'), 'a');
  const child = spawn('ollama', ['serve'], { cwd: root, detached: true, stdio: ['ignore', log, log],
    env: { ...process.env, OLLAMA_HOST: '127.0.0.1:11434' } });
  closeSync(log);
  child.unref();
  return new Promise(resolve => {
    child.once('spawn', () => resolve(true));
    child.once('error', () => resolve(false));
  });
}

export async function ensureModelService({ fetcher = fetch, launch = launchModel,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)), report = console.log } = {}) {
  const probe = async () => {
    let response;
    try {
      response = await fetcher('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(1500) });
    } catch { return 'unreachable'; }
    try { return response.ok && Array.isArray((await response.json()).models) ? 'ready' : 'occupied'; }
    catch { return 'occupied'; }
  };
  const initial = await probe();
  if (initial === 'ready') { report('Local AI service is running.'); return true; }
  if (initial === 'occupied') {
    report('Port 11434 did not identify itself as Ollama. It was left untouched; dictionary reading still works.');
    return false;
  }
  if (await launch()) {
    for (let attempt = 0; attempt < 12; attempt++) {
      await wait(250);
      if (await probe() === 'ready') { report('Local AI service started privately on this Mac.'); return true; }
    }
  }
  report('Local AI could not start. Open the installed Ollama app and retry; dictionary reading still works.');
  return false;
}
