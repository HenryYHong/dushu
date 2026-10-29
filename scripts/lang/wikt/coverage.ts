// How much of a real text a spaced-language engine resolves, and what it misses:
//   npx vite-node scripts/lang/wikt/coverage.ts es tests/lang/spaced/fixtures/es-quijote.txt [--hints]
// Prints the share of word tokens that resolve to a dictionary entry (and the share taken as names), the commonest
// misses, and with --hints every token as text→lemma[hint] for reading the result like a learner would.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname ?? __dirname, '..', '..', '..');
const [lang, file, ...flags] = process.argv.slice(2);
const mod = await import(`${ROOT}/src/lang/spaced/${lang}.ts`);
const eng = await mod.loadEngine('/', { fetchBytes: (n: string) => readFile(join(ROOT, 'public/data', lang, n)) });
const text = await readFile(file, 'utf8');
const paragraphs = text.split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);

let words = 0;
let found = 0;
let names = 0;
const misses = new Map<string, number>();
const lines: string[] = [];
const t0 = performance.now();
for (const p of paragraphs) {
  const toks = eng.segment(p);
  for (const t of toks) {
    if (t.kind !== 'word') continue;
    words++;
    if (t.inDict) found++;
    else if (t.name) names++;
    else misses.set(t.text, (misses.get(t.text) ?? 0) + 1);
  }
  if (flags.includes('--hints')) {
    lines.push(toks.filter((t: { kind: string }) => t.kind === 'word')
      .map((t: { text: string; lemma?: string; name?: boolean; stress?: number }) => `${t.text}→${t.lemma}${t.name ? '*' : ''}${t.stress !== undefined ? '@' + t.stress : ''}[${eng.hint(t) ?? ''}]`).join('  '));
  }
}
const ms = performance.now() - t0;
const pct = (n: number) => ((100 * n) / words).toFixed(1) + '%';
console.log(`${lang} ${file.split('/').pop()}: ${words} words, ${pct(found)} in the dictionary, ${pct(names)} names, ${pct(words - found - names)} unknown; ${text.length} chars in ${ms.toFixed(0)} ms (cold)`);
console.log('unknown:', [...misses.entries()].sort((a, b) => b[1] - a[1]).slice(0, 80).map(([w, n]) => (n > 1 ? `${w}×${n}` : w)).join(' '));
if (lines.length) console.log(lines.join('\n'));
