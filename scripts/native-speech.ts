// Loopback-only macOS speech renderer. No cloud, shell interpolation, arbitrary paths, or persistent audio.
// A request may carry `marks`, the offsets where its words start: scripts/speech-marks.swift then renders it and says when each
// word starts in the audio (the X-Dushu-Marks header, [[offset, ms], ...]). Without that helper, `say` renders it and the reader
// highlights the paragraph.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { bridgeRequest } from './private-access';

const execute = promisify(execFile);
type Voice = { name: string; lang: string; voiceURI: string };
let installed: Promise<Voice[]> | null = null;

async function voices(): Promise<Voice[]> {
  return installed ??= execute('/usr/bin/say', ['-v', '?'], { timeout: 5000 }).then(({ stdout }) =>
    stdout.split('\n').flatMap(line => {
      const match = /^(.*?)\s+(zh_\S+)\s+#/.exec(line);
      return match && /\((Premium|Enhanced)\)/.test(match[1])
        ? [{ name: match[1].trim(), lang: match[2].replace('_', '-'), voiceURI: `dushu-mac:${match[1].trim()}` }] : [];
    })).catch(error => { installed = null; throw error; });
}

let helper: Promise<string | null> | null = null;

/**
 * The compiled word-timing helper, or null. It is built once per version of its source with the Mac's own Swift compiler, into
 * the user's cache folder: programs in Desktop or Documents may not be allowed to run from a login job. Without Xcode's command
 * line tools nothing is built; `xcode-select -p` is asked first because running a missing compiler opens an install dialog.
 */
export function markHelper(): Promise<string | null> {
  return helper ??= (async () => {
    if (process.platform !== 'darwin') return null;
    const source = await readFile(join('scripts', 'speech-marks.swift'));
    const dir = join(homedir(), 'Library', 'Caches', 'Dushu');
    const bin = join(dir, `speech-marks-${createHash('sha256').update(source).digest('hex').slice(0, 12)}`);
    try { await access(bin, constants.X_OK); return bin; } catch { /* not built yet */ }
    await execute('/usr/bin/xcode-select', ['-p'], { timeout: 5000 });
    await mkdir(dir, { recursive: true });
    // Per process: the server and a test run may build at the same moment.
    const src = `${bin}.${process.pid}.swift`;
    const tmp = `${bin}.${process.pid}.tmp`;
    await writeFile(src, source);
    try {
      // Through xcrun, which also finds the macOS SDK (the compiler alone cannot load its standard library).
      await execute('/usr/bin/xcrun', ['swiftc', '-O', src, '-o', tmp], { timeout: 300000 });
      await rename(tmp, bin);
    } finally {
      await rm(src, { force: true });
      await rm(tmp, { force: true });
    }
    return bin;
  })().catch(() => null);
}

/** [[offset, ms], ...] from the helper's output, or null when it is not that. */
export function parseMarks(stdout: string, length: number): [number, number][] | null {
  try {
    const marks = (JSON.parse(stdout) as { marks?: unknown }).marks;
    if (!Array.isArray(marks)) return null;
    const ok = marks.every((m): m is [number, number] => Array.isArray(m) && m.length === 2 && Number.isInteger(m[0]) && Number.isInteger(m[1])
      && m[0] >= 0 && m[0] < length && m[1] >= 0);
    return ok ? marks : null;
  } catch { return null; }
}

export function nativeSpeech(): Plugin {
  let active = 0;
  async function handle(req: IncomingMessage, res: ServerResponse, next: () => void) {
    const path = new URL(req.url || '/', 'http://localhost').pathname;
    if (path !== '/api/native-voices' && path !== '/api/native-speech') { next(); return; }
    if (!bridgeRequest(req)) { res.writeHead(403).end(); return; }
    res.setHeader('Cache-Control', 'no-store');
    if (process.platform !== 'darwin') { res.writeHead(404).end(); return; }
    if (path === '/api/native-voices') {
      if (req.method !== 'GET') { res.writeHead(405).end(); return; }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(await voices()));
      return;
    }
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    if (!req.headers['content-type']?.startsWith('application/json')) { res.writeHead(415).end(); return; }
    if (active >= 2) { res.writeHead(429).end(); return; }
    let bytes = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > 8192) { res.writeHead(413).end(); return; }
      chunks.push(chunk);
    }
    let body: { voice?: unknown; text?: unknown; marks?: unknown };
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { res.writeHead(400).end(); return; }
    if (!body || typeof body.text !== 'string' || !body.text.trim() || body.text.length > 600) { res.writeHead(400).end(); return; }
    const text = body.text;
    const marks = body.marks;
    if (marks !== undefined && !(Array.isArray(marks) && marks.length <= 600
      && marks.every((m) => Number.isInteger(m) && m >= 0 && m < text.length))) { res.writeHead(400).end(); return; }
    const voice = (await voices()).find(v => v.voiceURI === body.voice);
    if (!voice) { res.writeHead(400).end(); return; }
    if (active >= 2) { res.writeHead(429).end(); return; }
    const ctl = new AbortController();
    res.on('close', () => { if (!res.writableEnded) ctl.abort(); });
    active++;
    let folder: string | undefined;
    try {
      folder = await mkdtemp(join(tmpdir(), 'dushu-speech-'));
      const input = join(folder, 'input.txt');
      const output = join(folder, 'speech.wav');
      let timed: [number, number][] | null = null;
      const bin = Array.isArray(marks) && marks.length ? await markHelper() : null;
      if (bin) {
        const request = join(folder, 'request.json');
        await writeFile(request, JSON.stringify({ voice: voice.name, lang: voice.lang, text, marks }), 'utf8');
        try {
          const { stdout } = await execute(bin, [request, output], { timeout: 30000, signal: ctl.signal });
          timed = parseMarks(stdout, text.length);
        } catch (error) {
          if (ctl.signal.aborted) throw error;
          // The helper failed on this text: `say` reads it, without word times.
        }
      }
      if (!timed) {
        await writeFile(input, text, 'utf8');
        await execute('/usr/bin/say', ['-v', voice.name, '-f', input, '-o', output, '--file-format=WAVE', '--data-format=LEI16@24000'],
          { timeout: 30000, signal: ctl.signal });
      }
      const audio = await readFile(output);
      if (!ctl.signal.aborted) {
        res.setHeader('Content-Type', 'audio/wav');
        if (timed) res.setHeader('X-Dushu-Marks', JSON.stringify(timed));
        res.setHeader('Content-Length', audio.length);
        res.end(audio);
      }
    } finally {
      active--;
      if (folder) await rm(folder, { recursive: true, force: true });
    }
  }
  const install = (server: { middlewares: { use: (fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void } }) => {
    if (!process.env.VITEST) void markHelper(); // build it now, so the first reading does not wait for the compiler
    server.middlewares.use((req, res, next) => {
      void handle(req, res, next).catch(() => { if (!res.headersSent) res.writeHead(500); if (!res.writableEnded) res.end(); });
    });
  };
  return { name: 'dushu-native-speech', configureServer: install, configurePreviewServer: install };
}
