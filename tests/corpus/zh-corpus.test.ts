// The held-out Chinese corpus (tests/corpus/zh) read through the reader's path, two ways:
//
// 1. Silver gold: the blind audits' errors (silver.tsv) scored now. Fails only when fewer are right than the count recorded
//    in zh/baseline.json; later fixes raise that count (UPDATE_ZH_BASELINE=1). Checks that were right at the baseline and are
//    wrong now are listed.
// 2. Groupings against the stored baseline (zh/shown-baseline.tsv): every region whose cut or written reading changed, counted
//    per genre, the most frequent changes and a seeded sample of 40 with context, so any change to the cutting shows in the
//    test output. It does not fail (ZH_CORPUS_STRICT=1 makes any change fail); UPDATE_ZH_BASELINE=1 stores the new state.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Dictionary } from '../../src/types';
import { loadTestDictionary, readDataFile } from '../helpers/data';
import { compactTokens, decodeCompact, diffTokens, encodeCompact, loadEvalGazetteer, loadEvalReadingModel, readingNote, sample, shownFile, textHash, type Region, type ShownBlock, type ShownBook } from '../../scripts/eval/zh-shown';
import { readSilver, scoreSilver } from '../../scripts/eval/zh-silver';

const DIR = join(__dirname, 'zh');
const BASELINE = join(DIR, 'baseline.json');
const SHOWN_BASELINE = join(DIR, 'shown-baseline.tsv');
const UPDATE = process.env.UPDATE_ZH_BASELINE === '1';
const STRICT = process.env.ZH_CORPUS_STRICT === '1';

interface Baseline {
  recorded: string;
  silver: { right: number; total: number; rightHashes: string[] };
  corpus: Record<string, { texts: number; blocks: number; han: number; hanTokens: number; names: number }>;
}

const texts = readFileSync(join(DIR, 'texts.tsv'), 'utf8').split('\n').filter((l) => l && !l.startsWith('#')).map((l) => {
  const [id, folder, genre] = l.split('\t');
  return { id, folder, genre };
});
const genreOf = new Map(texts.map((t) => [t.id, t.genre]));

let dict: Dictionary;
const books = new Map<string, ShownBook>();
const readBaseline = (): Baseline => JSON.parse(readFileSync(BASELINE, 'utf8')) as Baseline;
const pending: Partial<Baseline> = {};

beforeAll(async () => {
  dict = await loadTestDictionary();
  // Names are detected with the name list (public/data/names.tsv.gz) and read with the reading model, as the reader does once
  // both have loaded.
  await loadEvalGazetteer();
  await loadEvalReadingModel(dict, readDataFile);
  for (const t of texts) books.set(t.id, await shownFile(`${t.id}.txt`, readFileSync(join(DIR, t.folder, `${t.id}.txt`)), dict));
}, 240_000);

const fmt = (s: { right: number; total: number }) => `${s.right}/${s.total}`;

describe('held-out Chinese corpus', () => {
  it('gets at least as many audited errors right as the baseline (silver gold)', () => {
    const checks = readSilver(join(DIR, 'silver.tsv'));
    const blocks = new Map<string, ShownBlock[]>([...books].map(([id, b]) => [id, b.blocks]));
    const { score, verdicts } = scoreSilver(checks, blocks);
    const out = [`silver gold: ${fmt(score)} right (${score.lost} lost: their place is no longer in the text)`];
    out.push('  by genre: ' + Object.entries(score.byGenre).map(([g, s]) => `${g} ${fmt(s)}`).join(', '));
    out.push('  by family: ' + Object.entries(score.byFamily).sort((a, b) => b[1].total - a[1].total).map(([f, s]) => `${f} ${fmt(s)}`).join(', '));
    if (UPDATE) {
      pending.silver = { right: score.right, total: score.total, rightHashes: score.rightHashes };
      console.log(out.join('\n'));
      return;
    }
    const base = readBaseline().silver;
    const now = new Set(score.rightHashes);
    const broken = checks.filter((c) => base.rightHashes.includes(c.hash) && !now.has(c.hash));
    const fixed = checks.filter((c) => now.has(c.hash) && !base.rightHashes.includes(c.hash));
    out.push(`  baseline ${base.right}/${base.total}; newly right ${fixed.length}, newly wrong ${broken.length}`);
    for (const c of broken.slice(0, 30)) out.push(`  newly wrong [${c.id} ${c.key}] ${c.before}【${c.target}】${c.after}  expected ${c.expectSeg || c.target}${c.expectPy.length ? ` {${c.expectPy.join(' ')}}` : ''} (${verdicts.get(c)})`);
    if (score.right > base.right) out.push(`  more right than the baseline: record it with UPDATE_ZH_BASELINE=1 npx vitest run tests/corpus/zh-corpus.test.ts`);
    console.log(out.join('\n'));
    expect(score.right, 'audited errors fixed (silver gold) fell below the baseline').toBeGreaterThanOrEqual(base.right);
  });

  it('shows every change in word groupings and readings against the stored baseline', () => {
    const note = readingNote(dict);
    const stats: Baseline['corpus'] = {};
    for (const t of texts) {
      const b = books.get(t.id)!;
      const s = (stats[t.genre] ??= { texts: 0, blocks: 0, han: 0, hanTokens: 0, names: 0 });
      s.texts++; s.blocks += b.blocks.length; s.han += b.han; s.names += b.found.length;
      for (const blk of b.blocks) for (const tok of blk.tokens) if (tok.kind === 'han') s.hanTokens++;
    }
    if (UPDATE) {
      writeFileSync(SHOWN_BASELINE, '# Groupings and readings of tests/corpus/zh as the reader shows them (simplified), compact form: see scripts/eval/zh-shown.ts.\n'
        + encodeCompact(texts.map((t) => ({ id: t.id, book: books.get(t.id)! })), dict));
      const silver = pending.silver ?? readBaseline().silver;
      writeFileSync(BASELINE, JSON.stringify({ recorded: new Date().toISOString().slice(0, 10), silver, corpus: stats }, null, 1) + '\n');
      console.log('corpus baseline recorded:', JSON.stringify(stats));
      return;
    }
    // the current blocks by text hash, per book, to find where a stored block went
    const current = new Map<string, Map<string, ShownBlock[]>>();
    for (const [id, b] of books) {
      const m = new Map<string, ShownBlock[]>();
      for (const blk of b.blocks) { const h = textHash(blk.shown); m.set(h, [...(m.get(h) ?? []), blk]); }
      current.set(id, m);
    }
    const used = new Set<ShownBlock>();
    const pick = (id: string, key: string, hash: string): ShownBlock | undefined => {
      const cands = current.get(id)?.get(hash) ?? [];
      return cands.find((b) => b.key === key && !used.has(b)) ?? cands.find((b) => !used.has(b));
    };
    // a stored block whose text hash is found again gets that text, so its tokens and written readings can be rebuilt; one
    // whose text changed in place (same key, same length: a variant folded) is cut over the new text, position by position
    const sameKey = (id: string, key: string, length: number) => books.get(id)?.blocks.find((b) => b.key === key && b.shown.length === length);
    const stored = decodeCompact(readFileSync(SHOWN_BASELINE, 'utf8'), (id, key, hash, length) => current.get(id)?.get(hash)?.[0]?.shown ?? sameKey(id, key, length)?.shown);
    const regions: (Region & { id: string; key: string })[] = [];
    // blocks of the baseline whose text is not found now, and blocks now whose text the baseline lacks (an import change)
    const gone: Record<string, number> = {};
    const added: Record<string, number> = {};
    const refolded: Record<string, number> = {};
    const deferred: typeof stored = [];
    for (const sb of stored) {
      const blk = pick(sb.id, sb.key, sb.hash);
      if (!blk) { deferred.push(sb); continue; }
      used.add(blk);
      for (const r of diffTokens(blk.shown, sb.tokens, compactTokens(blk, note))) regions.push({ ...r, id: sb.id, key: blk.key });
    }
    for (const sb of deferred) {
      const g = genreOf.get(sb.id) ?? '?';
      const blk = sameKey(sb.id, sb.key, sb.length);
      if (!blk || used.has(blk) || !sb.tokens.length) { gone[g] = (gone[g] ?? 0) + 1; continue; }
      used.add(blk);
      refolded[g] = (refolded[g] ?? 0) + 1;
      for (const r of diffTokens(blk.shown, sb.tokens, compactTokens(blk, note))) regions.push({ ...r, id: sb.id, key: blk.key });
    }
    const perGenre: Record<string, { seg: number; read: number }> = {};
    for (const r of regions) {
      const g = genreOf.get(r.id) ?? '?';
      const s = (perGenre[g] ??= { seg: 0, read: 0 });
      s[r.kind]++;
    }
    for (const [id, b] of books) for (const blk of b.blocks) if (!used.has(blk)) { const g = genreOf.get(id) ?? '?'; added[g] = (added[g] ?? 0) + 1; }
    const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
    const out = [`corpus groupings vs baseline: ${regions.length} changed regions (${regions.filter((r) => r.kind === 'seg').length} cut, ${regions.filter((r) => r.kind === 'read').length} reading); text changed: ${sum(refolded)} blocks in place (compared), ${sum(gone)} gone, ${sum(added)} new`];
    for (const t of [...new Set(texts.map((x) => x.genre))]) {
      const s = perGenre[t] ?? { seg: 0, read: 0 };
      const per1k = (1000 * (s.seg + s.read)) / Math.max(1, stats[t].han);
      out.push(`  ${t}: ${s.seg} cut, ${s.read} reading (${per1k.toFixed(1)} per 1,000 Han)${refolded[t] || gone[t] || added[t] ? `; text changed: ${refolded[t] ?? 0} blocks in place, ${gone[t] ?? 0} gone, ${added[t] ?? 0} new` : ''}`);
    }
    if (regions.length) {
      const freq = new Map<string, { n: number; r: Region }>();
      for (const r of regions) { const k = `${r.kind}\t${r.before}\t${r.after}`; const f = freq.get(k) ?? { n: 0, r }; f.n++; freq.set(k, f); }
      out.push('  most frequent changes (before → after, count):');
      for (const f of [...freq.values()].sort((a, b) => b.n - a.n).slice(0, 25)) out.push(`    ${f.r.kind} ${f.r.before} → ${f.r.after}  ×${f.n}`);
      out.push('  seeded sample of 40 changed regions (judge each better / same / worse):');
      for (const r of sample(regions, 40, 1)) out.push(`    [${r.id} ${r.key}] ${r.before} → ${r.after}   ${r.context}`);
      out.push('  When the changes are intended: UPDATE_ZH_BASELINE=1 npx vitest run tests/corpus/zh-corpus.test.ts');
    }
    console.log(out.join('\n'));
    if (STRICT) expect(regions.length + sum(gone) + sum(added), 'groupings changed (ZH_CORPUS_STRICT)').toBe(0);
  });
});

