// Narrow same-origin Ollama bridge. Never exposes model management or arbitrary upstream URLs.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Plugin } from 'vite';
import { LOCAL_MODELS } from '../src/translate/localModels';
import { trustedRequest } from './private-access';

export function generationBody(value: any): object | null {
  if (!value || !LOCAL_MODELS.includes(value.model) || typeof value.prompt !== 'string' || !value.prompt.trim()
    || value.prompt.length > 10000 || (value.system !== undefined && (typeof value.system !== 'string' || value.system.length > 4000))
    || typeof value.stream !== 'boolean' || (value.format !== undefined && value.format !== 'json')) return null;
  return { model: value.model, prompt: value.prompt, system: value.system, stream: value.stream, format: value.format,
    think: false, options: { temperature: 0, num_ctx: 4096, num_predict: value.format === 'json' ? 400 : 1400 } };
}
export function localModelBridge(): Plugin {
  let active = 0;
  async function handle(req: IncomingMessage, res: ServerResponse, next: () => void) {
    const path = new URL(req.url || '/', 'http://localhost').pathname;
    if (!path.startsWith('/api/local-model/')) { next(); return; }
    if (!trustedRequest(req)) { res.writeHead(403).end(); return; }
    res.setHeader('Cache-Control', 'no-store');
    const tags = path === '/api/local-model/api/tags';
    if (!tags && path !== '/api/local-model/api/generate') { res.writeHead(404).end(); return; }
    if (req.method !== (tags ? 'GET' : 'POST')) { res.writeHead(405).end(); return; }
    const ctl = new AbortController();
    res.on('close', () => { if (!res.writableEnded) ctl.abort(); });
    let body: object | null = null;
    if (!tags) {
      if (!req.headers['content-type']?.startsWith('application/json')) { res.writeHead(415).end(); return; }
      if (active >= 2) { res.writeHead(429).end(); return; }
      const chunks: Buffer[] = []; let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 32768) { res.writeHead(413).end(); return; }
        chunks.push(chunk);
      }
      try { body = generationBody(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { /* reject below */ }
      if (!body) { res.writeHead(400).end(); return; }
      if (active >= 2) { res.writeHead(429).end(); return; }
      active++;
    }
    try {
      const upstream = await fetch(`http://127.0.0.1:11434/api/${tags ? 'tags' : 'generate'}`, {
        method: tags ? 'GET' : 'POST', signal: AbortSignal.any([ctl.signal, AbortSignal.timeout(tags ? 5000 : 180000)]),
        headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
      });
      if (!upstream.ok) { res.writeHead(upstream.status).end(); return; }
      res.setHeader('Content-Type', tags || !(body as any)?.stream ? 'application/json' : 'application/x-ndjson');
      if (tags) {
        const data = await upstream.json() as { models?: { name: string }[] };
        res.end(JSON.stringify({ models: data.models?.filter(m => LOCAL_MODELS.includes(m.name)).map(m => ({ name: m.name })) ?? [] }));
      } else if (upstream.body) await pipeline(Readable.fromWeb(upstream.body as any), res, { signal: ctl.signal });
      else res.writeHead(502).end();
    } finally { if (!tags) active--; }
  }
  const install = (server: any) => { server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
    void handle(req, res, next).catch(() => { if (!res.headersSent) res.writeHead(503); if (!res.writableEnded) res.end(); });
  }); };
  return { name: 'dushu-local-model', configureServer: install, configurePreviewServer: install };
}
