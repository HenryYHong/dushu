// The hint of every word in the first three paragraphs of every classic (public/samples/<id>/), read as a learner would,
// with counts of the odd ones: no hint, a hint that is grammar or a description, a rare lemma chosen over a common one,
// an adverb chosen over a noun or adjective spelled alike.
//   npx vite-node scripts/lang/wikt/classics.ts [es fr ...] [--list]
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
const ROOT = join(import.meta.dirname ?? __dirname, '..', '..', '..');
const rest = process.argv.slice(2);
const list = rest.includes('--list');
const langs = rest.filter((a) => !a.startsWith('--'));
const JUNK = /^(?:Used|Indicates|Generic|Refers|Optionally|Expresses|Emphasi[sz]es|Denotes|Marks|A verbal|Third|First|Second)|\b(?:first|second|third)-person\b|\bform of\b|\b(?:singular|plural)\b/;
const total: Record<string, number> = {};
for (const lang of langs.length ? langs : ['es', 'fr', 'de', 'it', 'pt', 'ru']) {
  const mod = await import(`${ROOT}/src/lang/spaced/${lang}.ts`);
  const eng = await mod.loadEngine('/', { fetchBytes: (n: string) => readFile(join(process.env.DUSHU_LANG_DATA || join(ROOT, 'public/data'), lang, n)) });
  const dir = join(ROOT, 'public/samples', lang);
  const files = (await readdir(dir)).filter((f) => f.endsWith('.md')).sort();
  const c = { words: 0, noHint: 0, junk: 0, rareLemma: 0, adverbOverContent: 0, cutWord: 0, phrases: 0 };
  const odd: string[] = [];
  for (const f of files) {
    const text = await readFile(join(dir, f), 'utf8');
    const paras = text.split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, ' ').trim()).filter((p) => p && !p.startsWith('#') && p.length > 60).slice(0, 3);
    for (const p of paras) {
      for (const t of eng.segment(p)) {
        if (t.kind !== 'word' || t.name || !t.inDict) continue;
        c.words++;
        const h: string | undefined = eng.hint(t);
        const look = eng.lookup(t.text, { token: t, sentence: p });
        const e0 = look.entries[0];
        const pos0 = e0?.senses[0]?.pos ?? '';
        const flags: string[] = [];
        if (!h) { c.noHint++; flags.push('nohint'); }
        else {
          if (JUNK.test(h)) { c.junk++; flags.push('junk'); }
          if (/[a-z]{2,}$/.test(h) && h.length >= 40) { c.cutWord++; flags.push('cut?'); }
        }
        const others = look.entries.slice(1);
        // A fixed phrase (por eso, sin embargo) leads the card with no level of its own: not a rare lemma.
        if (!look.phrase && e0 && (e0.level ?? 7) >= 5 && others.some((o: any) => (o.level ?? 7) <= 2)) { c.rareLemma++; flags.push('rare-lemma'); }
        if (look.phrase) { c.phrases++; flags.push('phrase'); }
        const posAll = look.entries.flatMap((e: any) => e.senses.map((s: any) => s.pos));
        if (pos0 === 'adverb' && e0.senses.slice(0, 2).every((s: any) => s.pos === 'adverb') && posAll.some((x: string) => x === 'adjective' || x === 'noun')
          && !['adverb'].includes(posAll[posAll.length - 1])) { c.adverbOverContent++; flags.push('adv'); }
        if (flags.length) odd.push(`${f.replace('.md', '')}: ${t.text}→${t.lemma} [${pos0}${look.form ? ' ' + look.form.slice(0, 40) : ''}] "${h ?? ''}" {${flags.join(',')}} alts: ${look.entries.slice(1, 3).map((e: any) => e.head + ':' + (e.senses[0]?.pos ?? '') + ':L' + (e.level ?? '-')).join(' ')}`);
      }
    }
  }
  console.log(`${lang}: ${JSON.stringify(c)}`);
  for (const [k, v] of Object.entries(c)) total[k] = (total[k] ?? 0) + v;
  if (list) console.log(odd.join('\n'));
}
console.log('total', JSON.stringify(total));
