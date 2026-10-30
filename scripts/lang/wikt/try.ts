// Spot-check a spaced-language engine from the terminal: npx vite-node scripts/lang/wikt/try.ts es fue "Un hidalgo de los de lanza."
// A word prints its lookup; a phrase (anything with a space) prints each token as text→lemma[hint] (* name, @ stress).
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
const ROOT = join(import.meta.dirname ?? __dirname, '..', '..', '..');
const lang = process.argv[2];
const mod = await import(`${ROOT}/src/lang/spaced/${lang}.ts`);
const t0 = performance.now();
const eng = await mod.loadEngine('/', { fetchBytes: (n: string) => readFile(join(process.env.DUSHU_LANG_DATA || join(ROOT, 'public/data'), lang, n)) });
console.log('load ms', Math.round(performance.now() - t0));
for (const arg of process.argv.slice(3)) {
  if (arg.includes(' ')) {
    const toks = eng.segment(arg);
    console.log(toks.filter((t: any) => t.kind === 'word').map((t: any) => `${t.text}→${t.lemma}${t.name ? '*' : ''}${t.stress !== undefined ? '@' + t.stress : ''}[${eng.hint(t) ?? ''}]`).join('  '));
    continue;
  }
  const l = eng.lookup(arg);
  console.log(`${arg}: key=${l.key} form=${l.form ?? ''} name=${l.name ?? ''} parts=${JSON.stringify(l.parts ?? '')}`);
  for (const e of l.entries.slice(0, 4)) console.log(`   ${e.head} ${e.reading ?? ''} [${e.gender ?? ''}] L${e.level ?? '-'} form=${(e as any).form ?? ''} :: ${e.senses.slice(0, 3).map((s: any) => (s.pos ?? '') + ': ' + (s.notes ? '(' + s.notes.join(', ') + ') ' : '') + s.glosses.join(' / ')).join(' || ').slice(0, 260)}`);
}
