// The server half of Claude translation, shared by the two places that hold the owner's key: the Mac (scripts/claude-bridge.ts,
// the key in a file) and the sync account online (cloud/src/worker.ts, the key a Cloudflare secret). Both check a request the
// same way, build the same prompt and stream the answer the same way; the browser only ever sends the passage.
import Anthropic from '@anthropic-ai/sdk';
import type { TranslateRequest } from '../types';
import { CLAUDE_LIMITS, CLAUDE_MODELS, DEFAULT_CLAUDE_MODEL, buildUserMessage, clampContext, systemPromptFor } from './claudePrompts';
import { otherLang } from '../lang/names';

/** The slice of the SDK used here, so tests can inject a fake. */
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

export interface ParsedRequest extends TranslateRequest { model: string }
export type Parsed = { ok: true; request: ParsedRequest } | { ok: false; status: number; message: string };
export const badRequest = (status: number, message: string): Parsed => ({ ok: false, status, message });

/** Only what the prompt needs. Anything else the caller sends is dropped. */
export function parseTranslateBody(value: unknown): Parsed {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return badRequest(400, 'The translation request was not understood.');
  const v = value as Record<string, unknown>;
  if (typeof v.text !== 'string' || !v.text.trim()) return badRequest(400, 'Select some text to translate.');
  if (v.text.length > CLAUDE_LIMITS.text) return badRequest(413, 'That passage is too long for one request. Select a shorter one.');
  if (v.mode !== 'translate' && v.mode !== 'explain') return badRequest(400, 'The translation request was not understood.');
  if (v.context !== undefined && typeof v.context !== 'string') return badRequest(400, 'The translation request was not understood.');
  const model = v.model === undefined ? DEFAULT_CLAUDE_MODEL : v.model;
  if (typeof model !== 'string' || !CLAUDE_MODELS.some(m => m.value === model)) return badRequest(400, 'That Claude model is not offered. Pick Sonnet or Haiku in Settings.');
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
  // A book in another language names it; a request that names none is Chinese, as every request was before languages.
  const lang = otherLang(v.lang);
  return { ok: true, request: { text, mode: v.mode, model, terms, ...(lang ? { lang } : {}),
    context: typeof v.context === 'string' && v.context.trim() ? clampContext(v.context.trim(), text) : undefined } };
}

export interface Failure { status: number; code: string; message: string }

/** Where the key lives, for the messages that are about it. */
export type KeyHome = 'mac' | 'cloud';
const HOME = { mac: 'your Mac', cloud: 'the sync server' } as const;

/** Short, plain messages for the reader. The SDK's own text can carry request details, so it is never passed on. */
export function describeError(e: unknown, home: KeyHome = 'mac', keyFix = ''): Failure {
  const where = HOME[home];
  if (e instanceof Anthropic.AuthenticationError) return { status: 502, code: 'upstream_auth', message: `Anthropic rejected the key on ${where}.${keyFix ? ` ${keyFix}` : ''}` };
  if (e instanceof Anthropic.PermissionDeniedError) return { status: 502, code: 'upstream_permission', message: `The key on ${where} is not allowed to use this model. Pick another model in Settings.` };
  if (e instanceof Anthropic.RateLimitError) return { status: 429, code: 'rate_limit', message: 'Claude is rate limiting requests. Wait a moment and try again.' };
  if (e instanceof Anthropic.NotFoundError) return { status: 502, code: 'upstream_model', message: 'Claude does not know that model. Pick another model in Settings.' };
  if (e instanceof Anthropic.BadRequestError) {
    const detail = String((e as { message?: string }).message ?? '');
    return /credit|balance|billing/i.test(detail)
      ? { status: 402, code: 'credit', message: `The Anthropic account behind the key on ${where} is out of credit.` }
      : { status: 502, code: 'upstream_request', message: 'Claude could not handle that request.' };
  }
  // A timeout is also a connection error to the SDK, but Claude was reached: the answer took over 90 s (after retries).
  if (e instanceof Anthropic.APIConnectionTimeoutError) return { status: 504, code: 'upstream_timeout', message: 'Claude took too long to answer. Try again, or pick a faster model in Settings.' };
  if (e instanceof Anthropic.APIConnectionError) return { status: 502, code: 'upstream_connection', message: home === 'mac' ? 'Your Mac could not reach Claude. Check its internet connection.' : 'The sync server could not reach Claude. Try again in a minute.' };
  if (e instanceof Anthropic.APIError && typeof e.status === 'number' && e.status >= 500) return { status: 502, code: 'upstream_unavailable', message: 'Claude is having trouble right now. Try again in a minute.' };
  if (e instanceof Anthropic.APIError) return { status: 502, code: 'upstream_error', message: `Claude returned an error (${e.status ?? 'unknown'}).` };
  return { status: 502, code: 'upstream_error', message: 'Claude translation failed.' };
}

/** The Messages request for a checked passage. */
export function claudeBody(request: ParsedRequest, effort: 'low' | 'medium'): Record<string, unknown> {
  const size = request.text.length * 2 + (request.mode === 'explain' ? 1200 : 600);
  const body: Record<string, unknown> = {
    model: request.model,
    max_tokens: Math.min(8000, Math.max(1000, size)),
    output_config: { effort },
    system: systemPromptFor(request),
    messages: [{ role: 'user', content: buildUserMessage(request) }],
  };
  // Server-side fallback exists for Sonnet only; Haiku has none.
  if (request.model !== 'claude-haiku-5-5') { body.betas = ['server-side-fallback-2026-07-01']; body.fallbacks = 'default'; }
  return body;
}

export interface ClaudeResult {
  stop: string | null;
  /** Input tokens include cache writes and reads. */
  usage: { input: number; output: number };
  /** A refusal or an empty answer: the tokens were still used. */
  failure?: Failure;
}

/** Streams one translation, passing each piece of text to `onText`. SDK errors are thrown (see describeError). */
export async function runClaude(client: ServerClient, request: ParsedRequest, effort: 'low' | 'medium', signal: AbortSignal, onText: (delta: string) => void): Promise<ClaudeResult> {
  const messages = client.beta.messages.stream(claudeBody(request, effort), { signal });
  messages.on('text', delta => { if (delta) onText(delta); });
  const final = await messages.finalMessage();
  const u = final.usage ?? {};
  const usage = { input: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0), output: u.output_tokens ?? 0 };
  if (final.stop_reason === 'refusal') return { stop: final.stop_reason, usage, failure: { status: 422, code: 'refusal', message: 'Claude declined to translate this passage.' } };
  if (!final.content.some(b => b.type === 'text' && b.text?.trim())) return { stop: final.stop_reason, usage, failure: { status: 502, code: 'empty', message: 'Claude sent back an empty answer. Try again.' } };
  return { stop: final.stop_reason, usage };
}
