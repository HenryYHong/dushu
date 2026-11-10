// The Claude models offered, on their own so the settings (in the first chunk every language loads) do not pull in the
// prompts (claudePrompts.ts, prompt.ts).

export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-5-5';
/** Sonnet is the default and Haiku the cheaper option. Opus is never offered. */
export const CLAUDE_MODELS: { value: string; label: string }[] = [
  { value: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (default)' },
  { value: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (cheaper)' },
];
