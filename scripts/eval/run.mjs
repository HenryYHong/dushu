// Runs configurations over passages, judges the answers and keeps one results file per configuration.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EVAL_DIR, callClaude, callOllama, cached, pool, readJson, sha } from './lib.mjs';
import { answerKey, judge, screens } from './judge.mjs';

export const RESULTS_DIR = join(EVAL_DIR, 'results');

/** Cached model callers handed to each configuration, so a rerun with nothing changed costs nothing. */
export function makeCallers({ fresh = false, rep = 0 } = {}) {
  return {
    // Claude cannot be run at temperature 0, so replicates (rep) are separate samples with separate cache entries.
    claude: request => cached('claude', rep ? { ...request, rep } : request, () => callClaude(request), { fresh }),
    // Latency is only meaningful for a call that really ran, so Ollama results carry the timing of the original run.
    ollama: request => cached('ollama', request, () => callOllama(request), { fresh }),
  };
}

export async function runConfig(config, passages, world, opts = {}) {
  const sequential = config.sequential ?? config.provider !== 'claude';
  const reps = config.provider === 'claude' ? Math.max(1, opts.reps ?? 1) : 1;
  const jobs = passages.flatMap(passage => Array.from({ length: reps }, (_, rep) => ({ passage, rep })));
  const outputs = await pool(jobs, sequential ? 1 : (opts.concurrency ?? 4), async ({ passage, rep }) => {
    let out;
    try { out = await config.run(passage, { ...makeCallers({ ...opts, rep }), world }); }
    catch (error) { out = { text: '', error: String(error?.message ?? error).slice(0, 160) }; }
    return { id: passage.id, rep, split: passage.split, book: passage.book, cat: passage.cat, text: passage.text, paragraph: passage.paragraph,
      answer: out.text ?? '', error: out.error, firstMs: out.firstMs ?? null, totalMs: out.totalMs ?? null, calls: out.calls ?? 1,
      unverified: out.unverified ?? false, flags: out.flags ?? [], first: out.first, outTokens: out.outTokens, inTokens: out.inTokens };
  });
  if (opts.noJudge) return outputs;
  const references = await readJson('references.json');
  const byId = new Map(passages.map(p => [p.id, p]));
  await pool(outputs, opts.concurrency ?? 4, async item => {
    const passage = byId.get(item.id);
    item.judge = await judge(item, answerKey(passage, references), opts);
    item.screens = screens(item, passage);
  });
  return outputs;
}

export async function saveResults(config, items) {
  await mkdir(RESULTS_DIR, { recursive: true });
  const file = join(RESULTS_DIR, `${config.id}.json`);
  // Paragraph text is only needed to judge; keep the files small.
  const slim = items.map(({ paragraph, ...rest }) => rest);
  await writeFile(file, JSON.stringify({ id: config.id, label: config.label, model: config.model, ranAt: new Date().toISOString(), note: config.note, items: slim }, null, 1));
  return file;
}

export async function loadResults(id) {
  try { return JSON.parse(await readFile(join(RESULTS_DIR, `${id}.json`), 'utf8')); } catch { return null; }
}

// ---------------------------------------------------------------- scoring ---

export function score(items, split) {
  const rows = items.filter(i => split === 'all' ? i.split !== 'legacy' : i.split === split);
  const judged = rows.filter(r => r.judge && r.judge.verdict !== 'unjudged');
  const n = judged.length;
  const count = verdict => judged.filter(r => r.judge.verdict === verdict).length;
  const byType = {};
  for (const r of judged) for (const e of r.judge.errors) {
    byType[e.type] ??= { major: 0, minor: 0 };
    byType[e.type][e.severity]++;
  }
  const major = judged.reduce((s, r) => s + r.judge.errors.filter(e => e.severity === 'major').length, 0);
  const minor = judged.reduce((s, r) => s + r.judge.errors.filter(e => e.severity === 'minor').length, 0);
  const firsts = rows.map(r => r.firstMs).filter(v => typeof v === 'number');
  const totals = rows.map(r => r.totalMs).filter(v => typeof v === 'number');
  const q = (values, p) => { const s = [...values].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };
  return {
    n, correct: count('correct'), minor: count('minor'), wrong: count('wrong'), unjudged: rows.length - n,
    strict: n ? count('correct') / n : null, lenient: n ? (count('correct') + count('minor')) / n : null,
    majorErrors: major, minorErrors: minor, byType,
    unverified: rows.filter(r => r.unverified).length,
    firstP50: q(firsts, 0.5), firstP95: q(firsts, 0.95), totalP50: q(totals, 0.5), totalP95: q(totals, 0.95),
    calls: rows.reduce((s, r) => s + (r.calls || 1), 0),
  };
}

export { sha };
