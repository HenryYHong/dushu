// Sentence translation through the sync account, for anyone signed in: Qwen3 on Cloudflare Workers AI (cloud/src/worker.ts
// aiTranslate), free and capped per day so it never leaves the free allowance. The server builds the prompt and runs the same
// checks as the Mac's local model; the browser only sends the passage. Claude stays the owner's (claude.ts).
import { CLOUD_EVENT, cloudFetch, cloudSession } from '../core/cloud';
import type { Settings, Translator } from '../types';
import { ACCOUNT_TEXT } from './prompt';
import { isChinese, langId } from '../lang/active';
import { answeredInto, targetField } from './targets';

/** A used-up day or a refusal repeats if asked again soon: Automatic skips this translator for a while. */
const BLOCK_MS = 10 * 60_000;
let blockedUntil = 0;

/** Forget a failure (tests, and signing in or out). */
export function resetAccountTranslator(): void { blockedUntil = 0; }
globalThis.addEventListener?.(CLOUD_EVENT, resetAccountTranslator);

export function createAccountTranslator(settings: Pick<Settings, 'localOnly'>): Translator {
  return {
    id: 'account',
    label: 'Qwen (through your account)',
    async availability() {
      return !settings.localOnly && !!cloudSession() && Date.now() >= blockedUntil ? 'yes' : 'no';
    },
    async translate(req, opts) {
      if (settings.localOnly) throw new Error('Local only is on, so this sentence stays on this device. Turn it off in Settings to translate it online.');
      if (req.text.trim().length > ACCOUNT_TEXT) throw new Error('That passage is too long to translate at once. Select a shorter one.');
      const sent = cloudFetch('/ai/translate', {
        method: 'POST', signal: opts?.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: req.text, context: req.context, mode: req.mode, terms: req.terms, ...(isChinese() ? {} : { lang: langId() }),
          ...targetField(req.to, langId()) }),
      });
      if (!sent) throw new Error('Sign in to translate sentences through your account.');
      let response: Response;
      try { response = await sent; } catch (e) {
        if ((e as { name?: string })?.name === 'AbortError') throw e;
        throw new Error('Could not reach the sync server. Check this device’s internet connection.');
      }
      const data = await response.json().catch(() => null) as { text?: string; unverified?: string; error?: string; code?: string; to?: unknown } | null;
      if (!response.ok) {
        if (response.status === 401) throw new Error('This device is signed out. Sign in again to translate sentences.');
        if (response.status === 429 || data?.code === 'no_model') blockedUntil = Date.now() + BLOCK_MS;
        throw new Error(data?.error ?? `Translation through your account failed (${response.status}).`);
      }
      const text = data?.text?.trim();
      if (!text) throw new Error('The sync server sent back an empty translation. Try again.');
      if (data?.unverified) opts?.onNote?.({ kind: 'unverified', detail: data.unverified });
      const answered = answeredInto(req.to, data?.to, langId());
      if (answered) opts?.onInto?.(answered);
      opts?.onDelta?.(text);
      return text;
    },
  };
}
