// Claude through this Mac. The API key lives only in a file outside the repo and is read for each request; the browser never
// sees it and never sends a system prompt. Owner-only (bridgeRequest), size-capped, with a daily spend guard.
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import Anthropic from '@anthropic-ai/sdk';
import type { Plugin } from 'vite';
import { CLAUDE_LIMITS, CLAUDE_MODELS, DEFAULT_CLAUDE_MODEL, SYSTEM_PROMPTS, buildUserMessage, clampContext } from '../src/translate/claudePrompts';
import type { TranslateRequest } from '../src/types';
import { bridgeRequest } from './private-access';

export const KEY_FILE_DISPLAY = '~/.config/dushu/anthropic-api-key';
const MAX_BODY = 65536;
const MAX_ACTIVE = 4;

/** The slice of the SDK this file uses, so tests can inject a fake. */
export interface ServerStream {
  on(event: 'text', fn: (delta: string) => void): unknown;
  finalMessage(): Promise<{
    stop_reason: string | null;
    content: { type: string; text?: string }[];
    usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null };
  }>;
}
export interface ServerClient {
  beta: { messages: { stream(body: Record<string, unknown>, opts?: { signal?: AbortSignal }): ServerStream } };
}

export interface ClaudeBridgeConfig {
  keyFile: string;
  usageFile: string;
  maxRequests: number;
  maxInputTokens: number;
  effort: 'low' | 'medium';
  clientFactory: (apiKey: string) => ServerClient;
  now: () => Date;
}

function positive(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}
export function claudeBridgeConfig(env: Record<string, string | undefined> = process.env): ClaudeBridgeConfig {
  return {
    keyFile: join(homedir(), '.config', 'dushu', 'anthropic-api-key'),
    usageFile: join('.dushu-local', 'claude-usage.json'),
    maxRequests: positive(env.DUSHU_CLAUDE_MAX_REQUESTS, 3000),
    maxInputTokens: positive(env.DUSHU_CLAUDE_MAX_INPUT_TOKENS, 3_000_000),
    effort: env.DUSHU_CLAUDE_EFFORT === 'medium' ? 'medium' : 'low',
    clientFactory: apiKey => new Anthropic({ apiKey, timeout: 90_000 }) as unknown as ServerClient,
    now: () => new Date(),
  };
}

// ---------------------------------------------------------------- key ---

export type KeyState = { ok: true; key: string; warning?: string } | { ok: false; problem: 'missing' | 'empty' | 'invalid' };
/** Read per request, so replacing the file takes effect at once. The key is returned only to the code that calls the API. */
export function readKey(file: string): KeyState {
  let text: string;
  try { text = readFileSync(file, 'utf8').trim(); } catch { return { ok: false, problem: 'missing' }; }
  if (!text) return { ok: false, problem: 'empty' };
  if (!/^[\x21-\x7e]{20,400}$/.test(text)) return { ok: false, problem: 'invalid' };
  let warning: string | undefined;
  try { if (statSync(file).mode & 0o077) warning = `Run chmod 600 on ${KEY_FILE_DISPLAY}; other users on this Mac can read it.`; } catch { /* no stat, no warning */ }
  return { ok: true, key: text, warning };
}
const KEY_MESSAGES = {
  missing: `No Claude key is set up on your Mac. Save it in ${KEY_FILE_DISPLAY}.`,
  empty: `The Claude key file on your Mac is empty. Save the key in ${KEY_FILE_DISPLAY}.`,
  invalid: `The Claude key file on your Mac does not look like an API key. Check ${KEY_FILE_DISPLAY}.`,
} as const;

// -------------------------------------------------------------- usage ---

export interface Usage { day: string; requests: number; inputTokens: number; outputTokens: number }
export function localDay(date: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}
/** Requests and tokens per local day, in a small file. Reads and writes are synchronous, so two requests never interleave. */
export class Ledger {
  constructor(private config: Pick<ClaudeBridgeConfig, 'usageFile' | 'now'>) {}
  today(): Usage {
    const day = localDay(this.config.now());
    try {
      const value = JSON.parse(readFileSync(this.config.usageFile, 'utf8'));
      const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
      if (value && value.day === day) return { day, requests: n(value.requests), inputTokens: n(value.inputTokens), outputTokens: n(value.outputTokens) };
    } catch { /* first use today, or a damaged file: start from zero */ }
    return { day, requests: 0, inputTokens: 0, outputTokens: 0 };
  }
  private save(usage: Usage): void {
    try {
      mkdirSync(dirname(this.config.usageFile), { recursive: true });
      const temp = `${this.config.usageFile}.tmp`;
      writeFileSync(temp, JSON.stringify(usage), { mode: 0o600 });
      renameSync(temp, this.config.usageFile);
    } catch { /* a read-only folder must not stop translation */ }
  }
  add(requests: number, inputTokens: number, outputTokens: number): Usage {
    const usage = this.today();
    usage.requests += requests;
    usage.inputTokens += inputTokens;
    usage.outputTokens += outputTokens;
    this.save(usage);
    return usage;
  }
}
export function limitMessage(usage: Usage, config: Pick<ClaudeBridgeConfig, 'maxRequests' | 'maxInputTokens'>): string | null {
  if (usage.requests >= config.maxRequests) return `Today's Claude limit on your Mac (${config.maxRequests.toLocaleString('en-US')} requests) is used up. It resets at midnight. Local only still works.`;
  if (usage.inputTokens >= config.maxInputTokens) return `Today's Claude limit on your Mac (${config.maxInputTokens.toLocaleString('en-US')} input tokens) is used up. It resets at midnight. Local only still works.`;
  return null;
}

// -------------------------------------------------------------- input ---

export interface ParsedRequest extends TranslateRequest { model: string }
export type Parsed = { ok: true; request: ParsedRequest } | { ok: false; status: number; message: string };
const bad = (status: number, message: string): Parsed => ({ ok: false, status, message });

/** Only what the Mac's own prompt needs. Anything else the caller sends is dropped. */
export function parseTranslateBody(value: unknown): Parsed {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return bad(400, 'The translation request was not understood.');
  const v = value as Record<string, unknown>;
  if (typeof v.text !== 'string' || !v.text.trim()) return bad(400, 'Select some Chinese text to translate.');
  if (v.text.length > CLAUDE_LIMITS.text) return bad(413, 'That passage is too long for one request. Select a shorter one.');
  if (v.mode !== 'translate' && v.mode !== 'explain') return bad(400, 'The translation request was not understood.');
  if (v.context !== undefined && typeof v.context !== 'string') return bad(400, 'The translation request was not understood.');
  const model = v.model === undefined ? DEFAULT_CLAUDE_MODEL : v.model;
  if (typeof model !== 'string' || !CLAUDE_MODELS.some(m => m.value === model)) return bad(400, 'That Claude model is not offered. Pick Sonnet or Haiku in Settings.');
  const terms: NonNullable<TranslateRequest['terms']> = [];
  if (Array.isArray(v.terms)) {
    for (const t of v.terms.slice(0, CLAUDE_LIMITS.terms)) {
      if (!t || typeof t !== 'object' || typeof t.word !== 'string' || typeof t.pinyin !== 'string' || typeof t.gloss !== 'string') continue;
      const cap = (s: string) => s.slice(0, CLAUDE_LIMITS.termField);
      terms.push({ word: cap(t.word), pinyin: cap(t.pinyin), gloss: cap(t.gloss),
        ...(t.kind === 'name' || t.kind === 'term' || t.kind === 'idiom' ? { kind: t.kind } : {}) });
    }
  }
  const text = v.text.trim();
  return { ok: true, request: { text, mode: v.mode, model, terms,
    context: typeof v.context === 'string' && v.context.trim() ? clampContext(v.context.trim(), text) : undefined } };
}

// ------------------------------------------------------------- errors ---

export interface Failure { status: number; code: string; message: string }
/** Short, plain messages for the reader. The SDK's own text can carry request details, so it is never passed on. */
export function describeError(e: unknown): Failure {
  if (e instanceof Anthropic.AuthenticationError) return { status: 502, code: 'upstream_auth', message: `Anthropic rejected the key on your Mac. Replace it in ${KEY_FILE_DISPLAY}.` };
  if (e instanceof Anthropic.PermissionDeniedError) return { status: 502, code: 'upstream_permission', message: 'The key on your Mac is not allowed to use this model. Pick another model in Settings.' };
  if (e instanceof Anthropic.RateLimitError) return { status: 429, code: 'rate_limit', message: 'Claude is rate limiting requests. Wait a moment and try again.' };
  if (e instanceof Anthropic.NotFoundError) return { status: 502, code: 'upstream_model', message: 'Claude does not know that model. Pick another model in Settings.' };
  if (e instanceof Anthropic.BadRequestError) {
    const detail = String((e as { message?: string }).message ?? '');
    return /credit|balance|billing/i.test(detail)
      ? { status: 402, code: 'credit', message: 'The Anthropic account behind the key on your Mac is out of credit.' }
      : { status: 502, code: 'upstream_request', message: 'Claude could not handle that request.' };
  }
  if (e instanceof Anthropic.APIConnectionError) return { status: 502, code: 'upstream_connection', message: 'Your Mac could not reach Claude. Check its internet connection.' };
  if (e instanceof Anthropic.APIError && typeof e.status === 'number' && e.status >= 500) return { status: 502, code: 'upstream_unavailable', message: 'Claude is having trouble right now. Try again in a minute.' };
  if (e instanceof Anthropic.APIError) return { status: 502, code: 'upstream_error', message: `Claude returned an error (${e.status ?? 'unknown'}).` };
  return { status: 502, code: 'upstream_error', message: 'Claude translation failed.' };
}

// ------------------------------------------------------------ handler ---

export function claudeStatus(config: ClaudeBridgeConfig, ledger = new Ledger(config)) {
  const key = readKey(config.keyFile);
  const usage = ledger.today();
  const limit = limitMessage(usage, config);
  return {
    app: 'dushu',
    configured: key.ok,
    problem: key.ok ? undefined : KEY_MESSAGES[key.problem],
    warning: key.ok ? key.warning : undefined,
    models: CLAUDE_MODELS.map(m => ({ id: m.value, label: m.label })),
    defaultModel: DEFAULT_CLAUDE_MODEL,
    usage: { ...usage },
    limits: { requests: config.maxRequests, inputTokens: config.maxInputTokens },
    limitReached: limit !== null,
    limitMessage: limit ?? undefined,
    ready: key.ok && limit === null,
  };
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

export function claudeHandler(overrides: Partial<ClaudeBridgeConfig> = {}) {
  const config: ClaudeBridgeConfig = { ...claudeBridgeConfig(), ...overrides };
  const ledger = new Ledger(config);
  let active = 0;

  return async function handle(req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> {
    const path = new URL(req.url || '/', 'http://localhost').pathname;
    if (path !== '/api/claude/status' && path !== '/api/claude/translate') { next(); return; }
    if (!bridgeRequest(req)) { res.writeHead(403).end(); return; }
    res.setHeader('Cache-Control', 'no-store');
    if (path === '/api/claude/status') {
      if (req.method !== 'GET') { res.writeHead(405).end(); return; }
      json(res, 200, claudeStatus(config, ledger));
      return;
    }
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    if (!req.headers['content-type']?.startsWith('application/json')) { res.writeHead(415).end(); return; }
    if (active >= MAX_ACTIVE) { json(res, 429, { code: 'busy', error: 'Your Mac is already translating several passages. Try again in a moment.' }); return; }
    active++;
    try {
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > MAX_BODY) { json(res, 413, { code: 'too_large', error: 'That passage is too long for one request. Select a shorter one.' }); return; }
        chunks.push(chunk);
      }
      let parsed: Parsed;
      try { parsed = parseTranslateBody(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { parsed = bad(400, 'The translation request was not understood.'); }
      if (!parsed.ok) { json(res, parsed.status, { code: 'bad_request', error: parsed.message }); return; }
      const key = readKey(config.keyFile);
      if (!key.ok) { json(res, 503, { code: 'no_key', error: KEY_MESSAGES[key.problem] }); return; }
      const limit = limitMessage(ledger.today(), config);
      if (limit) { json(res, 429, { code: 'daily_limit', error: limit }); return; }
      await stream(parsed.request, key.key, req, res);
    } finally { active--; }
  };

  async function stream(request: ParsedRequest, apiKey: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const ctl = new AbortController();
    res.on('close', () => { if (!res.writableEnded) ctl.abort(); });
    ledger.add(1, 0, 0); // counted before the call, so a failing client cannot loop past the cap
    const send = (event: object) => {
      if (res.writableEnded || res.destroyed) return;
      if (!res.headersSent) res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
      res.write(JSON.stringify(event) + '\n');
    };
    const fail = (f: Failure) => {
      if (res.writableEnded || res.destroyed) return;
      if (!res.headersSent) { json(res, f.status, { code: f.code, error: f.message }); return; }
      send({ type: 'error', code: f.code, message: f.message });
      res.end();
    };
    try {
      const size = request.text.length * 2 + (request.mode === 'explain' ? 1200 : 600);
      const body: Record<string, unknown> = {
        model: request.model,
        max_tokens: Math.min(8000, Math.max(1000, size)),
        output_config: { effort: config.effort },
        system: SYSTEM_PROMPTS[request.mode],
        messages: [{ role: 'user', content: buildUserMessage(request) }],
      };
      // Server-side fallback exists for Sonnet only; Haiku has none.
      if (request.model !== 'claude-haiku-5-5') { body.betas = ['server-side-fallback-2026-07-01']; body.fallbacks = 'default'; }
      const messages = config.clientFactory(apiKey).beta.messages.stream(body, { signal: ctl.signal });
      messages.on('text', delta => { if (delta) send({ type: 'text', text: delta }); });
      const final = await messages.finalMessage();
      const u = final.usage ?? {};
      const input = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
      ledger.add(0, input, u.output_tokens ?? 0);
      if (final.stop_reason === 'refusal') { fail({ status: 422, code: 'refusal', message: 'Claude declined to translate this passage.' }); return; }
      if (!final.content.some(b => b.type === 'text' && b.text?.trim())) { fail({ status: 502, code: 'empty', message: 'Claude sent back an empty answer. Try again.' }); return; }
      send({ type: 'done', stop: final.stop_reason, usage: { input, output: u.output_tokens ?? 0 } });
      res.end();
    } catch (e) {
      if (ctl.signal.aborted) { if (!res.writableEnded) res.end(); return; }
      fail(describeError(e));
    }
  }
}

export function claudeBridge(): Plugin {
  const handle = claudeHandler();
  const install = (server: any) => { server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
    void handle(req, res, next).catch(() => { if (!res.headersSent) res.writeHead(503); if (!res.writableEnded) res.end(); });
  }); };
  return { name: 'dushu-claude-bridge', configureServer: install, configurePreviewServer: install };
}
