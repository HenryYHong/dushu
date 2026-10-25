// Dushu's sync account online: a device signs in with an emailed code and then syncs exactly as it would with the owner's
// Mac (src/core/sync.ts speaks the same exchange). One Durable Object per email holds that account (account.ts), so its
// requests run one at a time; another holds the daily count of emails sent. Sessions are bearer tokens
// '<account id>.<secret>': only the secret's SHA-256 is stored. Read-aloud uses Workers AI, kept under its free daily
// allowance (SPEECH_MAX_CHARS).
import Anthropic from '@anthropic-ai/sdk';
import { AccountCore, BOOK_CHUNK, CloudError, allowedEmail, normalEmail, type ClaudeLimits } from './account';
import { sqlStore, type SqlStorage } from './sqlStore';
import { SYNC_LIMITS, SyncError } from '../../src/core/syncExchange';
import { CLAUDE_MODELS, DEFAULT_CLAUDE_MODEL } from '../../src/translate/claudePrompts';
import { describeError, parseTranslateBody, runClaude, type ServerClient } from '../../src/translate/claudeServer';

export interface DurableObjectId { toString(): string }
export interface DurableObjectStub { fetch(input: string, init?: RequestInit): Promise<Response> }
export interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  idFromString(id: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}
interface DurableObjectState { storage: { sql: SqlStorage } }
export interface ExecutionContext { waitUntil(promise: Promise<unknown>): void }

export interface Env {
  ACCOUNTS: DurableObjectNamespace;
  LIMITS: DurableObjectNamespace;
  /** Resend (resend.com) key for the sign-in emails: a secret, never in this repo. */
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
  /** Who may sign in (comma separated); everyone when empty. A secret, so no email is in this repo. */
  ALLOWED_EMAILS?: string;
  /** 'log' (local testing only): codes are logged and returned instead of emailed. */
  MAIL_MODE?: string;
  /** Emails sent per day at most, across all accounts. */
  DAILY_EMAILS?: string;
  /** The owner's Anthropic key, for Claude translation through the account: a secret, never in this repo. */
  ANTHROPIC_API_KEY?: string;
  /** Claude requests and input tokens per account per day (the Mac's defaults). */
  CLAUDE_MAX_REQUESTS?: string;
  CLAUDE_MAX_INPUT_TOKENS?: string;
  /** Tests make the Anthropic client; the Worker makes the real one. */
  claudeClient?: (apiKey: string) => ServerClient;
  /** Workers AI (wrangler.toml [ai]), for read-aloud through the account. */
  AI?: { run(model: string, input: Record<string, unknown>, options?: { returnRawResponse?: boolean }): Promise<unknown> };
  /** Characters read aloud per account per day. */
  SPEECH_MAX_CHARS?: string;
}

/** The account's voice: MeloTTS on Workers AI, Mandarin (a WAV file, 44.1 kHz). */
const SPEECH_MODEL = '@cf/myshell-ai/melotts';
/**
 * Never billed: Workers AI gives every account 10,000 neurons a day for nothing, and MeloTTS costs about 19 a minute of
 * audio ($0.000205 a minute at $0.011 per 1,000). At 3.5 characters a second (slower than it reads), 90,000 characters is
 * about 430 minutes, 8,000 neurons: under the free allowance with room to spare. Past it the app reads with the device's voice.
 */
const SPEECH_MAX_CHARS = 90_000;
/** A sentence at most (src/speech/tts.ts sends one at a time, 180 characters or fewer). */
const SPEECH_TEXT = 400;
const speechLimit = (env: Env) => Math.min(SPEECH_MAX_CHARS, Number(env.SPEECH_MAX_CHARS) > 0 ? Number(env.SPEECH_MAX_CHARS) : SPEECH_MAX_CHARS);

const claudeLimits = (env: Env): ClaudeLimits => ({
  requests: Number(env.CLAUDE_MAX_REQUESTS) > 0 ? Number(env.CLAUDE_MAX_REQUESTS) : 3000,
  inputTokens: Number(env.CLAUDE_MAX_INPUT_TOKENS) > 0 ? Number(env.CLAUDE_MAX_INPUT_TOKENS) : 3_000_000,
});

const TOKEN = /^([0-9a-f]{64})\.([A-Za-z0-9_-]{43})$/;
const ORIGINS = [/^https:\/\/henryyhong\.com$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/, /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.ts\.net(:\d+)?$/];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

async function sha256(text: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function secret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Six digits, every code equally likely. */
function sixDigits(): string {
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < 4_294_000_000) return String(buf[0] % 1_000_000).padStart(6, '0');
  }
}

async function readJson(request: Request, max: number): Promise<Record<string, unknown>> {
  const length = Number(request.headers.get('Content-Length') ?? 0);
  if (length > max) throw new CloudError(413, 'Too much to sync in one request.');
  const text = await request.text();
  if (text.length > max) throw new CloudError(413, 'Too much to sync in one request.');
  let body: unknown;
  try { body = JSON.parse(text || '{}'); } catch { throw new CloudError(400, 'The request was not understood.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new CloudError(400, 'The request was not understood.');
  return body as Record<string, unknown>;
}

async function sendCode(env: Env, email: string, code: string): Promise<void> {
  if (env.MAIL_MODE === 'log') { console.log(`Dushu sign-in code for ${email}: ${code}`); return; }
  if (!env.RESEND_API_KEY) throw new CloudError(503, 'Sign-in emails are not set up on the sync server yet.');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.MAIL_FROM || 'Dushu <onboarding@resend.dev>',
      to: [email],
      subject: `${code} is your Dushu sign-in code`,
      text: `Your Dushu sign-in code is ${code}.\n\nType it in Dushu's Settings within 10 minutes. If you did not ask for it, you can ignore this email.`,
    }),
  });
  if (!res.ok) {
    console.error('Dushu sync: the sign-in email was not sent', res.status, (await res.text()).slice(0, 300));
    throw new CloudError(502, 'The sign-in email could not be sent. Try again in a minute.');
  }
}

/** Asks an account's Durable Object to do `op`. */
async function call(stub: DurableObjectStub, op: string, body: unknown, token = ''): Promise<Response> {
  return stub.fetch(`https://account/${op}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Secret': token }, body: JSON.stringify(body) });
}

function bearer(request: Request, env: Env): { stub: DurableObjectStub; secret: string } {
  const m = TOKEN.exec((request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, ''));
  if (!m) throw new CloudError(401, 'This device is signed out of sync. Sign in again in Settings.');
  let id: DurableObjectId;
  try { id = env.ACCOUNTS.idFromString(m[1]); } catch { throw new CloudError(401, 'This device is signed out of sync. Sign in again in Settings.'); }
  return { stub: env.ACCOUNTS.get(id), secret: m[2] };
}

/**
 * Claude through the account: the same request checks, prompt and answer stream as the Mac (src/translate/claudeServer.ts),
 * so the app reads it the same way (NDJSON events: text, then done or error).
 */
async function claudeTranslate(request: Request, env: Env, ctx: ExecutionContext | undefined): Promise<Response> {
  const { stub, secret: s } = bearer(request, env);
  if (!env.ANTHROPIC_API_KEY) throw new CloudError(503, 'Claude is not set up on the sync server yet.', 'no_key');
  const parsed = parseTranslateBody(await readJson(request, 65536));
  if (!parsed.ok) throw new CloudError(parsed.status, parsed.message, 'bad_request');
  const gate = await call(stub, 'claude-start', { limits: claudeLimits(env) }, s);
  if (!gate.ok) return gate;
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encode = new TextEncoder();
  const send = (event: object) => writer.write(encode.encode(JSON.stringify(event) + '\n')).catch(() => {});
  const ctl = new AbortController();
  request.signal?.addEventListener?.('abort', () => ctl.abort());
  const client = env.claudeClient?.(env.ANTHROPIC_API_KEY) ?? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 90_000 }) as unknown as ServerClient;
  const work = (async () => {
    try {
      const r = await runClaude(client, parsed.request, 'low', ctl.signal, (delta) => void send({ type: 'text', text: delta }));
      await call(stub, 'claude-used', { input: r.usage.input, output: r.usage.output }, s).catch(() => {});
      await send(r.failure ? { type: 'error', code: r.failure.code, message: r.failure.message } : { type: 'done', stop: r.stop, usage: r.usage });
    } catch (e) {
      if (!ctl.signal.aborted) {
        const f = describeError(e, 'cloud', 'Replace ANTHROPIC_API_KEY on the sync server.');
        await send({ type: 'error', code: f.code, message: f.message });
      }
    } finally {
      await writer.close().catch(() => {});
    }
  })();
  ctx?.waitUntil(work);
  return new Response(readable, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' } });
}

/** Read-aloud through the account: one sentence read by Workers AI, counted against the day before it is read. */
async function speech(request: Request, env: Env): Promise<Response> {
  const { stub, secret: s } = bearer(request, env);
  if (!env.AI) throw new CloudError(503, 'Read-aloud is not set up on the sync server.', 'no_voice');
  const body = await readJson(request, 8192);
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) throw new CloudError(400, 'There is nothing to read.');
  const chars = [...text].length;
  if (chars > SPEECH_TEXT) throw new CloudError(413, 'That is too long to read at once.');
  const gate = await call(stub, 'speech-start', { chars, limit: speechLimit(env) }, s);
  if (!gate.ok) return gate;
  // The model's answer as it comes, { audio: base64 WAV }: decoding megabytes here would take the Worker past the free plan's
  // CPU time, so the device decodes it (src/speech/tts.ts).
  let res: unknown;
  try { res = await env.AI.run(SPEECH_MODEL, { prompt: text, lang: 'zh' }, { returnRawResponse: true }); } catch (e) {
    console.error('Dushu speech', e);
    throw new CloudError(502, 'The sync server could not read that aloud. Try again in a moment.', 'voice_failed');
  }
  if (!(res instanceof Response) || !res.ok || !res.body) {
    console.error('Dushu speech', res instanceof Response ? res.status : typeof res);
    throw new CloudError(502, 'The sync server could not read that aloud. Try again in a moment.', 'voice_failed');
  }
  return new Response(res.body, { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}

async function claudeStatus(request: Request, env: Env): Promise<Response> {
  const { stub, secret: s } = bearer(request, env);
  const res = await call(stub, 'claude-status', { limits: claudeLimits(env) }, s);
  if (!res.ok) return res;
  const { usage, limitMessage } = await res.json() as { usage: unknown; limitMessage: string | null };
  const configured = !!env.ANTHROPIC_API_KEY;
  return json(200, {
    app: 'dushu', configured, problem: configured ? undefined : 'Claude is not set up on the sync server yet.',
    models: CLAUDE_MODELS.map((m) => ({ id: m.value, label: m.label })), defaultModel: DEFAULT_CLAUDE_MODEL,
    usage, limits: claudeLimits(env), limitReached: limitMessage !== null, limitMessage: limitMessage ?? undefined,
    ready: configured && limitMessage === null,
  });
}

async function route(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path === '/' && request.method === 'GET') return json(200, { app: 'dushu-sync' });

  if (path === '/auth/code' && request.method === 'POST') {
    const email = normalEmail((await readJson(request, 4096)).email);
    if (!email) throw new CloudError(400, 'That does not look like an email address.');
    if (!allowedEmail(email, env.ALLOWED_EMAILS)) throw new CloudError(403, 'That email cannot sign in to this Dushu.');
    const code = sixDigits();
    const stub = env.ACCOUNTS.get(env.ACCOUNTS.idFromName(`email:${email}`));
    const kept = await call(stub, 'code', { email, hash: await sha256(code) });
    if (!kept.ok) return kept;
    const limit = await call(env.LIMITS.get(env.LIMITS.idFromName('global')), 'email', { max: Number(env.DAILY_EMAILS) || 90 });
    if (!limit.ok) return limit;
    await sendCode(env, email, code);
    return json(200, { ok: true, ...(env.MAIL_MODE === 'log' ? { devCode: code } : {}) });
  }

  if (path === '/auth/verify' && request.method === 'POST') {
    const body = await readJson(request, 4096);
    const email = normalEmail(body.email);
    const code = typeof body.code === 'string' ? body.code.replace(/\D/g, '') : '';
    if (!email || code.length !== 6) throw new CloudError(400, 'Type the six-digit code from the email.');
    const id = env.ACCOUNTS.idFromName(`email:${email}`);
    const s = secret();
    const res = await call(env.ACCOUNTS.get(id), 'verify', { codeHash: await sha256(code), sessionHash: await sha256(s) });
    if (!res.ok) return res;
    const { email: named } = await res.json() as { email: string };
    return json(200, { token: `${id.toString()}.${s}`, email: named || email });
  }

  if (path === '/auth/signout' && request.method === 'POST') {
    const { stub, secret: s } = bearer(request, env);
    return call(stub, 'signout', {}, s);
  }
  if (path === '/me') {
    const { stub, secret: s } = bearer(request, env);
    if (request.method === 'GET') return call(stub, 'me', {}, s);
    if (request.method !== 'POST') throw new CloudError(405, 'Not allowed.');
    return call(stub, 'mac', await readJson(request, 4096), s);
  }
  if (path === '/books') {
    const { stub, secret: s } = bearer(request, env);
    if (request.method === 'GET') return call(stub, 'books', {}, s);
    if (request.method === 'POST') return call(stub, 'book-start', await readJson(request, 4096), s);
    if (request.method === 'DELETE') return call(stub, 'book-drop', { key: new URL(request.url).searchParams.get('key') ?? '' }, s);
    throw new CloudError(405, 'Not allowed.');
  }
  if (path === '/books/chunk') {
    const { stub, secret: s } = bearer(request, env);
    const q = new URL(request.url).searchParams;
    const where = `key=${encodeURIComponent(q.get('key') ?? '')}&i=${encodeURIComponent(q.get('i') ?? '')}`;
    if (request.method === 'GET') return stub.fetch(`https://account/chunk-get?${where}`, { method: 'POST', headers: { 'X-Secret': s }, body: '{}' });
    if (request.method !== 'PUT') throw new CloudError(405, 'Not allowed.');
    if (Number(request.headers.get('Content-Length') ?? 0) > BOOK_CHUNK) throw new CloudError(413, 'That piece of the book is too large.');
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > BOOK_CHUNK) throw new CloudError(413, 'That piece of the book is too large.');
    return stub.fetch(`https://account/chunk-put?${where}`, { method: 'POST', headers: { 'X-Secret': s, 'Content-Type': 'application/octet-stream' }, body: bytes });
  }
  if (path === '/claude/status' && request.method === 'GET') return claudeStatus(request, env);
  if (path === '/claude/translate' && request.method === 'POST') return claudeTranslate(request, env, ctx);
  if (path === '/speech' && request.method === 'POST') return speech(request, env);
  if (path === '/sync') {
    const { stub, secret: s } = bearer(request, env);
    if (request.method === 'GET') return call(stub, 'status', {}, s);
    if (request.method !== 'POST') throw new CloudError(405, 'Not allowed.');
    return call(stub, 'sync', await readJson(request, SYNC_LIMITS.body), s);
  }
  throw new CloudError(404, 'Not found.');
}

function failure(e: unknown): Response {
  if (e instanceof CloudError) return json(e.status, { error: e.message, ...(e.code ? { code: e.code } : {}) });
  if (e instanceof SyncError) return json(e.status, { error: e.message });
  console.error('Dushu sync', e);
  return json(500, { error: 'The sync server could not do that. Try again in a minute.' });
}

export default {
  async fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    const origin = request.headers.get('Origin') ?? '';
    const cors: Record<string, string> = ORIGINS.some((r) => r.test(origin))
      ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE', 'Access-Control-Max-Age': '86400', Vary: 'Origin' }
      : { Vary: 'Origin' };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    let res: Response;
    try { res = await route(request, env, ctx); } catch (e) { res = failure(e); }
    // A Durable Object's answer has fixed headers: copied into one that can carry CORS.
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    out.headers.set('Cache-Control', 'no-store');
    return out;
  },
};

/** What an account's Durable Object does with a request from the Worker. Apart from the class so tests can run it in memory. */
export async function accountRequest(core: AccountCore, request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const op = url.pathname.slice(1);
    // A piece of a book is bytes; everything else is JSON. Both are read before the account is touched.
    const bytes = op === 'chunk-put' ? new Uint8Array(await request.arrayBuffer()) : null;
    const body = bytes ? {} : await request.json() as Record<string, unknown>;
    const key = url.searchParams.get('key') ?? '';
    const index = Number(url.searchParams.get('i'));
    const now = Date.now();
    const token = request.headers.get('X-Secret') ?? '';
    // Hashed before the account is touched, so each operation below runs whole, as one transaction.
    const session = token ? await sha256(token) : '';
    const str = (v: unknown) => (typeof v === 'string' ? v : '');
    switch (op) {
      case 'code': core.storeCode(str(body.email), str(body.hash), now); return json(200, { ok: true });
      case 'verify': return json(200, core.verify(str(body.codeHash), str(body.sessionHash), now));
      case 'me': return json(200, core.me(session, now));
      case 'mac': return json(200, core.setMac(session, str(body.mac), now));
      case 'signout': core.signOut(session); return json(200, { ok: true });
      case 'status': return json(200, core.status(session, now));
      case 'sync': return json(200, core.sync(session, body, now));
      case 'books': return json(200, core.listBooks(session, now));
      case 'book-start': return json(200, core.startBook(session, body, now));
      case 'book-drop': core.dropBook(session, str(body.key), now); return json(200, { ok: true });
      case 'chunk-put': return json(200, core.putBookChunk(session, key, index, bytes!, now));
      case 'claude-status': return json(200, core.claudeStatus(session, body.limits as ClaudeLimits, now));
      case 'claude-start': core.claudeStart(session, body.limits as ClaudeLimits, now); return json(200, { ok: true });
      case 'claude-used': core.claudeUsed(session, Number(body.input), Number(body.output), now); return json(200, { ok: true });
      case 'speech-start': core.speechStart(session, Number(body.chars) || 0, Number(body.limit) || 0, now); return json(200, { ok: true });
      case 'chunk-get': return new Response(core.getBookChunk(session, key, index, now) as Uint8Array<ArrayBuffer>, { headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' } });
      default: return json(404, { error: 'Not found.' });
    }
  } catch (e) { return failure(e); }
}

/** One sync account (one email). */
export class Account {
  private readonly core: AccountCore;
  constructor(state: DurableObjectState) {
    this.core = new AccountCore(sqlStore(state.storage.sql));
  }

  fetch(request: Request): Promise<Response> {
    return accountRequest(this.core, request);
  }
}

/** The daily count of sign-in emails across all accounts, so the email service's free allowance is never run past. */
export class Limits {
  private readonly sql: SqlStorage;
  constructor(state: DurableObjectState) {
    this.sql = state.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS days (day TEXT PRIMARY KEY, n INTEGER NOT NULL)');
  }

  async fetch(request: Request): Promise<Response> {
    const { max } = await request.json() as { max: number };
    const day = new Date().toISOString().slice(0, 10);
    const n = Number(this.sql.exec('SELECT n FROM days WHERE day = ?', day).toArray()[0]?.n ?? 0);
    if (n >= max) return json(429, { error: 'The sync server has sent all the sign-in emails it can today. Try again tomorrow.' });
    this.sql.exec('INSERT OR REPLACE INTO days (day, n) VALUES (?, ?)', day, n + 1);
    this.sql.exec('DELETE FROM days WHERE day < ?', new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10));
    return json(200, { ok: true });
  }
}
