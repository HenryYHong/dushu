// Translation accuracy evaluation. One command:  node scripts/evaluate-translations.mjs
// See scripts/eval/README.md for the options. Passages, answer keys and results live in scripts/eval/.
import { main } from './eval/cli.mjs';
await main(process.argv.slice(2));
