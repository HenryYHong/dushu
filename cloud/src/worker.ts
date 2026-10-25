// Dushu's sync account online: a device signs in with an emailed code and then syncs exactly as it would with the owner's
// Mac (src/core/sync.ts speaks the same exchange). One Durable Object per email holds that account (account.ts), so its
// requests run one at a time; another holds the daily count of emails sent. Sessions are bearer tokens
// '<account id>.<secret>': only the secret's SHA-256 is stored. Nothing here holds a book or any book text.
import { AccountCore, CloudError, allowedEmail, normalEmail } from './account';
import { sqlStore, type SqlStorage } from './sqlStore';
import { SYNC_LIMITS, SyncError } from '../../src/core/syncExchange';

export interface DurableObjectId { toString(): string }
export interface DurableObjectStub { fetch(input: string, init?: RequestInit): Promise<Response> }
export interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  idFromString(id: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}
interface DurableObjectState { storage: { sql: SqlStorage } }

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
}

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

async function route(request: Request, env: Env): Promise<Response> {
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
  if (path === '/sync') {
    const { stub, secret: s } = bearer(request, env);
    if (request.method === 'GET') return call(stub, 'status', {}, s);
    if (request.method !== 'POST') throw new CloudError(405, 'Not allowed.');
    return call(stub, 'sync', await readJson(request, SYNC_LIMITS.body), s);
  }
  throw new CloudError(404, 'Not found.');
}

function failure(e: unknown): Response {
  if (e instanceof CloudError || e instanceof SyncError) return json(e.status, { error: e.message });
  console.error('Dushu sync', e);
  return json(500, { error: 'The sync server could not do that. Try again in a minute.' });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin') ?? '';
    const cors: Record<string, string> = ORIGINS.some((r) => r.test(origin))
      ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Max-Age': '86400', Vary: 'Origin' }
      : { Vary: 'Origin' };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    let res: Response;
    try { res = await route(request, env); } catch (e) { res = failure(e); }
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
    const op = new URL(request.url).pathname.slice(1);
    const body = await request.json() as Record<string, unknown>;
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
