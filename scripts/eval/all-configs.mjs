// The registry of configurations, and which of them a plain `node scripts/evaluate-translations.mjs` runs.
import { baselineConfigs, claudeLevers, finalClaudeConfigs, finalQwenConfigs, oldAppConfig, qwenLevers } from './configs.mjs';
import { MODELS } from './lib.mjs';

export function allConfigs() {
  return [...baselineConfigs(), oldAppConfig(), ...claudeLevers('sonnet', MODELS.sonnet), ...claudeLevers('haiku', MODELS.haiku), ...qwenLevers(), ...finalClaudeConfigs(), ...finalQwenConfigs()];
}
export const DEFAULT_CONFIGS = ['baseline.sonnet', 'baseline.haiku', 'baseline.qwen-raw', 'baseline.qwen-app'];
/** Order of rows in the report. */
export const REPORT_ORDER = allConfigs().map(c => c.id);
/** [model, before, after] for the headline table. */
export const HEADLINE = [
  ['Claude Sonnet 5.5', 'baseline.sonnet', 'final.sonnet'],
  ['Claude Haiku 5.5', 'baseline.haiku', 'final.haiku'],
  ['Qwen3.5 9B (Mac)', 'baseline.qwen-app', 'final.qwen-app'],
];
