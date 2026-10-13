// What both sides of the Claude bridge agree on: the models offered, the prompts, and the request limits.
// The Mac builds the prompt from these; the browser only sends the passage, so it cannot send its own system prompt.
import type { TranslateRequest } from '../types';
import { wordSenseHint } from './contextSense';
import { translationMessage, translationSystem } from './prompt';

export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-5-5';
/** Sonnet is the default and Haiku the cheaper option. Opus is never offered. */
export const CLAUDE_MODELS: { value: string; label: string }[] = [
  { value: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (default)' },
  { value: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (cheaper)' },
];

/** Bounds the bridge enforces and the client respects, in UTF-16 units. */
export const CLAUDE_LIMITS = { text: 8000, context: 3000, terms: 30, termField: 200 } as const;

// The instructions and the message layout are the ones scripts/eval measured on Sonnet 5.5 and Haiku 5.5 (src/translate/prompt.ts).
export const SYSTEM_PROMPTS = {
  translate: translationSystem('translate', 'claude'),
  explain: translationSystem('explain', 'claude'),
} as const;

/** The user message: glossary, the sense the paragraph settles for 酒店 (if it does), the paragraph, then the sentence. */
export function buildUserMessage(req: Pick<TranslateRequest, 'text' | 'context' | 'terms'>): string {
  const hint = wordSenseHint(req.text, req.context ?? '');
  return translationMessage(req, { hints: hint ? { [hint.word]: hint.sense } : undefined });
}

/** A passage window of at most max units that keeps the selection, cut on code point boundaries. */
export function clampContext(context: string, focus: string, max: number = CLAUDE_LIMITS.context): string {
  if (context.length <= max) return context;
  const at = context.indexOf(focus);
  let start = Math.max(0, at < 0 ? 0 : at - Math.floor((max - Math.min(focus.length, max)) / 2));
  start = Math.min(start, context.length - max);
  if (start > 0 && /[\uDC00-\uDFFF]/.test(context[start])) start--;
  let end = Math.min(start + max, context.length);
  if (end < context.length && /[\uD800-\uDBFF]/.test(context[end - 1])) end--;
  return context.slice(start, end);
}
