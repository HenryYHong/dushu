// Runs one of the Chinese evaluation tools (scripts/eval/zh-*.run.ts) inside Vitest, so the app's TypeScript is used as it
// is, in a DOM (EPUB and HTML import parse markup). Started by scripts/eval/zh-dump.mjs and zh-bench.mjs, not by `npm test`.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [process.env.ZH_EVAL_ENTRY ?? 'scripts/eval/zh-dump.run.ts'],
    environment: 'jsdom',
    testTimeout: 6 * 3_600_000,
    hookTimeout: 600_000,
    // One file, one test: no parallel workers to wait for.
    fileParallelism: false,
  },
});
