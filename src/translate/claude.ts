// Claude through the owner's sync account, or their Mac. The browser holds no key: the account's server (cloud/src/worker.ts,
// the key a Cloudflare secret) or the Mac (scripts/claude-bridge.ts, the key in a file) builds the prompt and streams the answer
// back, the same way (src/translate/claudeServer.ts). A device signed in uses the account, so Claude works anywhere; one that
// is not uses the Mac. This module is the client of both and their availability check.
import { bridgeFetch, hasMacBridge } from '../core/macBridge';
import { CLOUD_EVENT, cloudFetch, cloudSession } from '../core/cloud';
import type { Settings, TranslateRequest, Translator } from '../types';
import { CLAUDE_LIMITS, DEFAULT_CLAUDE_MODEL } from './claudePrompts';

export { buildUserMessage, CLAUDE_MODELS, DEFAULT_CLAUDE_MODEL, SYSTEM_PROMPTS } from './claudePrompts';

export interface ClaudeStatus {
  /** The Mac answered. */
  reachable: boolean;
  /** The Mac answered but would not accept this device. */
  denied: boolean;
  /** A key file is set up on the Mac. */
  configured: boolean;
  /** Reachable, configured and under today's limit. */
  ready: boolean;
  problem?: string;
  /** The account is not the owner's: Claude on the owner's key is not for it. */
  ownerOnly?: boolean;
  warning?: string;
  limitMessage?: string;
  usage?: { day: string; requests: number; inputTokens: number; outputTokens: number };
  limits?: { requests: number; inputTokens: number };
}

export interface ClaudeDeps {
  /** A bridge fetch; tests pass a fake. */
  fetch?: (path: string, init?: RequestInit) => Promise<Response>;
  hasBridge?: () => boolean;
}

const DOWN: ClaudeStatus = { reachable: false, denied: false, configured: false, ready: false };

/** Through the account when signed in, else the Mac: a bridge path ('/api/claude/…') sent to whichever holds the key. */
function claudeFetch(path: string, init?: RequestInit): Promise<Response> {
  if (!cloudSession()) return bridgeFetch(path, init);
  return cloudFetch(path.replace(/^\/api\/claude/, '/claude'), init) ?? Promise.reject(new TypeError('Signed out'));
}
const viaAccount = () => !!cloudSession();
/** Whether Claude has somewhere to go: the account (signed in) or the Mac. */
export const hasClaudeRoute = (): boolean => viaAccount() || hasMacBridge();
const STATUS_TTL = 8000;
const BLOCK_MS = 60000;

let cached: { at: number; value: ClaudeStatus } | null = null;
let blocked: { until: number } | null = null;

/** Forget what was learned (tests, and after the Mac connection changes). */
export function resetClaudeStatus(): void { cached = null; blocked = null; }
// Signing in or out changes where Claude goes.
globalThis.addEventListener?.(CLOUD_EVENT, resetClaudeStatus);

/** What the Mac says about Claude: reachable, key configured, today's use. Cached for a few seconds. */
export async function fetchClaudeStatus(opts: { signal?: AbortSignal; force?: boolean } & ClaudeDeps = {}): Promise<ClaudeStatus> {
  const bridge = opts.hasBridge ?? hasClaudeRoute;
  if (!bridge()) return DOWN;
  if (opts.force) blocked = null;
  if (!opts.force && cached && Date.now() - cached.at < STATUS_TTL) return cached.value;
  const call = opts.fetch ?? claudeFetch;
  let value: ClaudeStatus;
  try {
    const signal = opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(2500)]) : AbortSignal.timeout(2500);
    const response = await call('/api/claude/status', { signal });
    if (response.status === 401) value = { ...DOWN, reachable: true, denied: true, problem: 'This device is signed out of sync. Sign in again to use Claude.' };
    else if (response.status === 403) value = { ...DOWN, reachable: true, denied: true, problem: 'Your Mac did not accept this device. Sign in to Tailscale with the Mac owner\'s account.' };
    else if (!response.ok) value = DOWN;
    else {
      const data = await response.json() as Record<string, any>;
      const configured = data.configured === true;
      value = {
        reachable: true, denied: false, configured,
        ready: configured && data.limitReached !== true && !(blocked && Date.now() < blocked.until),
        problem: typeof data.problem === 'string' ? data.problem : undefined,
        ...(data.ownerOnly === true ? { ownerOnly: true } : {}),
        warning: typeof data.warning === 'string' ? data.warning : undefined,
        limitMessage: typeof data.limitMessage === 'string' ? data.limitMessage : undefined,
        usage: data.usage && typeof data.usage === 'object' ? data.usage : undefined,
        limits: data.limits && typeof data.limits === 'object' ? data.limits : undefined,
      };
    }
  } catch (e) {
    if ((e as { name?: string })?.name === 'AbortError' && opts.signal?.aborted) throw e;
    value = DOWN;
  }
  cached = { at: Date.now(), value };
  return value;
}

/**
 * Whether Claude was ready the last time anyone asked, without asking again: for a label or a button that has to be drawn
 * at once (the Explain button). The status is checked when a translator is picked, so it is warm by then.
 */
export function claudeReadySync(settings: Pick<Settings, 'localOnly'>, hasBridge: () => boolean = hasClaudeRoute): boolean {
  return !settings.localOnly && hasBridge() && cached?.value.ready === true && !(blocked && Date.now() < blocked.until);
}

/** Errors that will repeat if the same request is sent again soon: automatic mode stops choosing Claude for a minute. */
const STICKY = new Set(['daily_limit', 'no_key', 'upstream_auth', 'upstream_permission', 'upstream_model', 'credit', 'unreachable', 'denied']);
function noteFailure(code: string): void {
  if (!STICKY.has(code)) return;
  blocked = { until: Date.now() + BLOCK_MS };
  cached = null;
}

const NETWORK = 'Could not reach your Mac. Keep it awake and connected to Tailscale.';
const NETWORK_ACCOUNT = 'Could not reach the sync server. Check this device’s internet connection.';

class ClaudeError extends Error {
  constructor(message: string, readonly code: string) { super(message); this.name = 'ClaudeError'; }
}

async function readLines(response: Response, onLine: (line: string) => void): Promise<void> {
  if (!response.body) {
    for (const line of (await response.text()).split('\n')) if (line.trim()) onLine(line);
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let end: number;
      while ((end = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 1);
        if (line.trim()) onLine(line);
      }
      if (done) break;
    }
    if (pending.trim()) onLine(pending);
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
}

export function createClaudeTranslator(
  settings: Pick<Settings, 'claudeModel' | 'localOnly'>,
  deps: ClaudeDeps = {},
): Translator {
  const call = deps.fetch ?? claudeFetch;
  const bridge = deps.hasBridge ?? hasClaudeRoute;
  const where = () => (deps.fetch ? 'mac' : viaAccount() ? 'account' : 'mac');
  return {
    id: 'claude',
    get label() { return where() === 'account' ? 'Claude (through your account)' : 'Claude (through your Mac)'; },
    async availability() {
      if (settings.localOnly || !bridge()) return 'no';
      if (blocked && Date.now() < blocked.until) return 'no';
      return (await fetchClaudeStatus({ fetch: call, hasBridge: bridge })).ready ? 'yes' : 'no';
    },
    async translate(req: TranslateRequest, opts) {
      if (settings.localOnly) throw new Error('Local only is on, so this sentence stays on your Mac. Turn it off in Settings to use Claude.');
      if (!bridge()) throw new Error('Sign in, or connect this device to your Mac, in Settings to use Claude.');
      if (req.text.trim().length > CLAUDE_LIMITS.text) throw new Error('That passage is too long for one request. Select a shorter one.');
      if (opts?.signal?.aborted) throw new DOMException('Translation canceled', 'AbortError');
      let response: Response;
      try {
        response = await call('/api/claude/translate', {
          method: 'POST', signal: opts?.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: req.text, context: req.context, mode: req.mode, terms: req.terms,
            model: settings.claudeModel || DEFAULT_CLAUDE_MODEL }),
        });
      } catch (e) {
        if ((e as { name?: string })?.name === 'AbortError') throw e;
        noteFailure('unreachable');
        throw new Error(where() === 'account' ? NETWORK_ACCOUNT : NETWORK);
      }
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { error?: string; code?: string } | null;
        if (response.status === 401) {
          noteFailure('denied');
          throw new Error('This device is signed out of sync. Sign in again in Settings to use Claude.');
        }
        if (response.status === 403) {
          noteFailure('denied');
          throw new Error('Your Mac did not accept this device. Sign in to Tailscale with the Mac owner\'s account.');
        }
        const code = data?.code ?? 'error';
        const message = data?.error ?? `Claude through your ${where() === 'account' ? 'account' : 'Mac'} failed (${response.status}).`;
        noteFailure(code);
        throw new Error(message);
      }
      let text = '';
      let stop: string | null = null;
      let finished = false;
      try {
        await readLines(response, line => {
          let event: { type?: string; text?: string; stop?: string | null; message?: string; code?: string };
          try { event = JSON.parse(line); } catch { return; }
          if (event.type === 'text' && typeof event.text === 'string') { text += event.text; opts?.onDelta?.(text); }
          else if (event.type === 'done') { finished = true; stop = event.stop ?? null; }
          else if (event.type === 'error') throw new ClaudeError(event.message || 'Claude failed partway through.', event.code ?? 'error');
        });
      } catch (e) {
        if (e instanceof ClaudeError) { noteFailure(e.code); throw e; }
        if ((e as { name?: string })?.name === 'AbortError') throw e;
        throw new Error('The connection to your Mac ended before Claude finished. Try again.');
      }
      if (!finished) throw new Error('The connection to your Mac ended before Claude finished. Try again.');
      if (!text.trim()) throw new Error('Claude sent back an empty answer. Try again.');
      return stop === 'max_tokens' ? text.trim() + ' …' : text.trim();
    },
  };
}
