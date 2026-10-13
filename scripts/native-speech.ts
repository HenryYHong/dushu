// Loopback-only macOS speech renderer. No cloud, shell interpolation, arbitrary paths, or persistent audio.
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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
    let body: { voice?: unknown; text?: unknown };
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { res.writeHead(400).end(); return; }
    if (!body || typeof body.text !== 'string' || !body.text.trim() || body.text.length > 600) { res.writeHead(400).end(); return; }
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
      await writeFile(input, body.text, 'utf8');
      await execute('/usr/bin/say', ['-v', voice.name, '-f', input, '-o', output, '--file-format=WAVE', '--data-format=LEI16@24000'],
        { timeout: 30000, signal: ctl.signal });
      const audio = await readFile(output);
      if (!ctl.signal.aborted) {
        res.setHeader('Content-Type', 'audio/wav');
        res.setHeader('Content-Length', audio.length);
        res.end(audio);
      }
    } finally {
      active--;
      if (folder) await rm(folder, { recursive: true, force: true });
    }
  }
  const install = (server: { middlewares: { use: (fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void } }) => {
    server.middlewares.use((req, res, next) => {
      void handle(req, res, next).catch(() => { if (!res.headersSent) res.writeHead(500); if (!res.writableEnded) res.end(); });
    });
  };
  return { name: 'dushu-native-speech', configureServer: install, configurePreviewServer: install };
}
