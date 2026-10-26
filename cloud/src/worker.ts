// Dushu's sync account online: a device signs in with an emailed code and then syncs exactly as it would with the owner's
// Mac (src/core/sync.ts speaks the same exchange). One Durable Object per email holds that account (account.ts), so its
// requests run one at a time; another holds the daily count of emails sent. Sessions are bearer tokens
// '<account id>.<secret>': only the secret's SHA-256 is stored. Read-aloud uses Workers AI, kept under its free daily
// allowance (SPEECH_MAX_CHARS).
import Anthropic from '@anthropic-ai/sdk';
import { AccountCore, BOOK_CHUNK, CloudError, LimitsCore, OWNER_ONLY_CLAUDE, allowedEmail, normalEmail, type ClaudeLimits, type Take } from './account';
import { sqlLimits, sqlStore, type SqlStorage } from './sqlStore';
import { codeEmail, logMailer, resendMailer, type Mailer } from './mail';
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
  /** Who may sign in (comma separated); everyone when unset. A secret, so no email is in this repo. */
  ALLOWED_EMAILS?: string;
  /** The owners (comma separated): Claude on the owner's key, the larger shares. When unset, ALLOWED_EMAILS. A secret too. */
  OWNER_EMAILS?: string;
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
  /** Tests send the sign-in emails; the Worker uses MAIL_MODE and RESEND_API_KEY. */
  mailer?: Mailer;
}

const owners = (env: Env) => env.OWNER_EMAILS ?? env.ALLOWED_EMAILS ?? '';

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
/** Everyone but the owners shares two thirds of the day, at most a sixth each (about 50 minutes of listening). */
const SPEECH_OTHERS_CHARS = 60_000;
const SPEECH_SHARE_CHARS = 15_000;
/** Sign-in codes a day from one network (a classroom shares one), and in all (Resend's free plan sends 100 a day). */
const CODES_PER_NETWORK = 40;
/** Wrong sign-in codes a day from one network. */
const WRONG_PER_NETWORK = 20;

/**
 * The network a request came from, as the limits count it: an IPv4 address, or an IPv6 address's /64 (anyone holding one
 * holds all of it). Hashed, so no address is kept.
 */
export async function networkOf(ip: string): Promise<string> {
  let net = ip.trim().toLowerCase();
  if (net.includes(':')) {
    const [head, tail = ''] = net.split('::');
    const a = head ? head.split(':') : [];
    const b = net.includes('::') ? (tail ? tail.split(':') : []) : [];
    const groups = [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill('0'), ...b];
    net = groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':') + '::/64';
  }
  return (await sha256(`dushu-net|${net}`)).slice(0, 32);
}

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

function mailer(env: Env): Mailer {
  if (env.mailer) return env.mailer;
  if (env.MAIL_MODE === 'log') return logMailer();
  if (!env.RESEND_API_KEY) throw new CloudError(503, 'Sign-in emails are not set up on the sync server yet.');
  return resendMailer(env.RESEND_API_KEY, env.MAIL_FROM || 'Dushu <onboarding@resend.dev>');
}

/** Counts against the days shared by every account (the Limits object); false when any is used up. */
async function takeShared(env: Env, items: Take[]): Promise<boolean> {
  const res = await env.LIMITS.get(env.LIMITS.idFromName('global')).fetch('https://limits/take', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }),
  });
  return res.ok && (await res.json() as { ok?: unknown }).ok === true;
}

/** Asks an account's Durable Object to do `op`. It is told who the owners are, to know whether it is one. */
async function call(env: Env, stub: DurableObjectStub, op: string, body: unknown, token = ''): Promise<Response> {
  return stub.fetch(`https://account/${op}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Secret': token, 'X-Owners': owners(env) }, body: JSON.stringify(body) });
}

function bearer(request: Request, env: Env): { stub: DurableObjectStub; secret: string; id: string } {
  const m = TOKEN.exec((request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, ''));
  if (!m) throw new CloudError(401, 'This device is signed out of sync. Sign in again in Settings.');
  let id: DurableObjectId;
  try { id = env.ACCOUNTS.idFromString(m[1]); } catch { throw new CloudError(401, 'This device is signed out of sync. Sign in again in Settings.'); }
  return { stub: env.ACCOUNTS.get(id), secret: m[2], id: m[1] };
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
  const gate = await call(env, stub, 'claude-start', { limits: claudeLimits(env) }, s);
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
      await call(env, stub, 'claude-used', { input: r.usage.input, output: r.usage.output }, s).catch(() => {});
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
  const { stub, secret: s, id } = bearer(request, env);
  if (!env.AI) throw new CloudError(503, 'Read-aloud is not set up on the sync server.', 'no_voice');
  const body = await readJson(request, 8192);
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) throw new CloudError(400, 'There is nothing to read.');
  const chars = [...text].length;
  if (chars > SPEECH_TEXT) throw new CloudError(413, 'That is too long to read at once.');
  const gate = await call(env, stub, 'speech-start', {}, s);
  if (!gate.ok) return gate;
  const { owner } = await gate.json() as { owner?: boolean };
  // The account's day (kept here, by account, so deleting the account does not start it again), everyone's, and everyone
  // else's but the owner's.
  const shared: Take[] = [
    { name: `speech-account:${id}`, n: chars, max: owner ? speechLimit(env) : Math.min(speechLimit(env), SPEECH_SHARE_CHARS) },
    { name: 'speech', n: chars, max: speechLimit(env) },
    ...(owner ? [] : [{ name: 'speech-others', n: chars, max: SPEECH_OTHERS_CHARS }]),
  ];
  if (!await takeShared(env, shared)) {
    throw new CloudError(429, 'Today’s free read-aloud is used up. It resets at midnight (UTC); until then Dushu reads with this device’s voice.', 'daily_limit');
  }
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
  const res = await call(env, stub, 'claude-status', { limits: claudeLimits(env) }, s);
  if (!res.ok) return res;
  const { usage, limitMessage, owner } = await res.json() as { usage: unknown; limitMessage: string | null; owner: boolean };
  if (!owner) return json(200, { app: 'dushu', configured: false, ownerOnly: true, ready: false, problem: OWNER_ONLY_CLAUDE });
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
    // The account's own limits first (a code sent just now, too many this hour), then the network's and the day's. Anyone may
    // ask for a code, so a network has a limit: it is named by a hash, never kept as it is.
    const stub = env.ACCOUNTS.get(env.ACCOUNTS.idFromName(`email:${email}`));
    const may = await call(env, stub, 'code-check', {});
    if (!may.ok) return may;
    const ip = request.headers.get('CF-Connecting-IP');
    if (ip && !await takeShared(env, [{ name: `net:${await networkOf(ip)}`, n: 1, max: CODES_PER_NETWORK }])) {
      throw new CloudError(429, 'Too many sign-in codes were asked for from this network today. Try again tomorrow.');
    }
    if (!await takeShared(env, [{ name: 'emails', n: 1, max: Number(env.DAILY_EMAILS) || 90 }])) {
      throw new CloudError(429, 'The sync server has sent all the sign-in emails it can today. Try again tomorrow.');
    }
    // The new code replaces the old one only once its email has gone out: a code in the inbox keeps working until then.
    const code = sixDigits();
    try { await mailer(env).send({ to: email, ...codeEmail(code) }); } catch (e) {
      if (e instanceof CloudError) throw e;
      console.error('Dushu sync: the sign-in email was not sent', e);
      throw new CloudError(502, 'The sign-in email could not be sent. Try again in a minute.');
    }
    const kept = await call(env, stub, 'code', { email, hash: await sha256(code) });
    if (!kept.ok) return kept;
    return json(200, { ok: true, ...(env.MAIL_MODE === 'log' ? { devCode: code } : {}) });
  }

  if (path === '/auth/verify' && request.method === 'POST') {
    const body = await readJson(request, 4096);
    const email = normalEmail(body.email);
    const code = typeof body.code === 'string' ? body.code.replace(/\D/g, '') : '';
    if (!email || code.length !== 6) throw new CloudError(400, 'Type the six-digit code from the email.');
    // A network that has typed too many wrong codes today is refused (each account also caps its own wrong codes).
    const ip = request.headers.get('CF-Connecting-IP');
    const wrong = ip ? `wrong:${await networkOf(ip)}` : '';
    if (wrong && !await takeShared(env, [{ name: wrong, n: 0, max: WRONG_PER_NETWORK - 1 }])) {
      throw new CloudError(429, 'Too many wrong codes from this network today. Try again tomorrow.');
    }
    const id = env.ACCOUNTS.idFromName(`email:${email}`);
    const s = secret();
    const res = await call(env, env.ACCOUNTS.get(id), 'verify', { codeHash: await sha256(code), sessionHash: await sha256(s) });
    if (res.status === 400 && wrong) await takeShared(env, [{ name: wrong, n: 1, max: Number.MAX_SAFE_INTEGER }]);
    if (!res.ok) return res;
    const { email: named, created } = await res.json() as { email: string; created?: string };
    return json(200, { token: `${id.toString()}.${s}`, email: named || email, ...(created ? { created } : {}) });
  }

  if (path === '/auth/signout' && request.method === 'POST') {
    const { stub, secret: s } = bearer(request, env);
    return call(env, stub, 'signout', {}, s);
  }
  if (path === '/me/delete' && request.method === 'POST') {
    const { stub, secret: s } = bearer(request, env);
    return call(env, stub, 'delete', {}, s);
  }
  if (path === '/me') {
    const { stub, secret: s } = bearer(request, env);
    if (request.method === 'GET') return call(env, stub, 'me', {}, s);
    if (request.method !== 'POST') throw new CloudError(405, 'Not allowed.');
    return call(env, stub, 'mac', await readJson(request, 4096), s);
  }
  if (path === '/books') {
    const { stub, secret: s } = bearer(request, env);
    if (request.method === 'GET') return call(env, stub, 'books', {}, s);
    if (request.method === 'POST') return call(env, stub, 'book-start', await readJson(request, 4096), s);
    if (request.method === 'DELETE') return call(env, stub, 'book-drop', { key: new URL(request.url).searchParams.get('key') ?? '' }, s);
    throw new CloudError(405, 'Not allowed.');
  }
  if (path === '/books/chunk') {
    const { stub, secret: s } = bearer(request, env);
    const q = new URL(request.url).searchParams;
    const where = `key=${encodeURIComponent(q.get('key') ?? '')}&i=${encodeURIComponent(q.get('i') ?? '')}`;
    if (request.method === 'GET') return stub.fetch(`https://account/chunk-get?${where}`, { method: 'POST', headers: { 'X-Secret': s, 'X-Owners': owners(env) }, body: '{}' });
    if (request.method !== 'PUT') throw new CloudError(405, 'Not allowed.');
    if (Number(request.headers.get('Content-Length') ?? 0) > BOOK_CHUNK) throw new CloudError(413, 'That piece of the book is too large.');
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > BOOK_CHUNK) throw new CloudError(413, 'That piece of the book is too large.');
    const upload = q.get('u') ?? '';
    return stub.fetch(`https://account/chunk-put?${where}&u=${encodeURIComponent(upload)}`, { method: 'POST', headers: { 'X-Secret': s, 'X-Owners': owners(env), 'Content-Type': 'application/octet-stream' }, body: bytes });
  }
  if (path === '/claude/status' && request.method === 'GET') return claudeStatus(request, env);
  if (path === '/claude/translate' && request.method === 'POST') return claudeTranslate(request, env, ctx);
  if (path === '/speech' && request.method === 'POST') return speech(request, env);
  if (path === '/sync') {
    const { stub, secret: s } = bearer(request, env);
    if (request.method === 'GET') return call(env, stub, 'status', {}, s);
    if (request.method !== 'POST') throw new CloudError(405, 'Not allowed.');
    return call(env, stub, 'sync', await readJson(request, SYNC_LIMITS.body), s);
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
    // After the last await: from here each operation runs to its end before another request reaches this account, so the
    // owners it is told are the ones it answers with.
    core.setOwners(request.headers.get('X-Owners') ?? '');
    switch (op) {
      case 'code-check': core.checkCode(now); return json(200, { ok: true });
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
      case 'chunk-put': return json(200, core.putBookChunk(session, key, index, bytes!, now, url.searchParams.get('u') ?? ''));
      case 'claude-status': return json(200, core.claudeStatus(session, body.limits as ClaudeLimits, now));
      case 'claude-start': core.claudeStart(session, body.limits as ClaudeLimits, now); return json(200, { ok: true });
      case 'claude-used': core.claudeUsed(session, Number(body.input), Number(body.output), now); return json(200, { ok: true });
      case 'speech-start': return json(200, core.speechStart(session, now));
      case 'delete': core.deleteAccount(session, now); return json(200, { ok: true });
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

/** What the Limits object does with a request from the Worker. Apart from the class so tests can run it in memory. */
export async function limitsRequest(core: LimitsCore, request: Request): Promise<Response> {
  try {
    const { items } = await request.json() as { items?: unknown };
    const ok = Array.isArray(items) && items.every((t) => t && typeof t.name === 'string' && typeof t.n === 'number' && typeof t.max === 'number')
      && core.take(items as Take[], Date.now());
    return json(200, { ok });
  } catch (e) { return failure(e); }
}

/**
 * The days shared by every account: sign-in emails (the email service's free allowance), read-aloud (Workers AI's free
 * allowance), and sign-in codes from each network.
 */
export class Limits {
  private readonly core: LimitsCore;
  constructor(state: DurableObjectState) {
    this.core = new LimitsCore(sqlLimits(state.storage.sql));
  }

  fetch(request: Request): Promise<Response> {
    return limitsRequest(this.core, request);
  }
}
