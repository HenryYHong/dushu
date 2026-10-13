// Checks the judge itself. (1) Each passage's reference translation, offered as a candidate, should come back correct:
// anything else is the judge being pedantic. (2) Translations with ONE seeded error of a known type should be caught.
// Writes results/judge-check.json. Usage: node scripts/eval/judge-check.mjs
import { createServer } from 'vite';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EVAL_DIR, MODELS, ROOT, callClaude, cached, loadWorld, pool, readJson } from './lib.mjs';
import { ERROR_TYPES, answerKey, judge } from './judge.mjs';

const SEED_SYSTEM = `You help test a grader of English translations of Chinese. Given the Chinese passage and a correct English translation, rewrite the translation so that it contains exactly ONE error of the requested type and is otherwise unchanged. Make the error real but plausible, the kind a weak translator makes. Return JSON only: {"translation":"<the corrupted translation>","error":"<what you changed, in a few words>"}.
Types: wrong-sense (a word or phrase gets a wrong meaning), name-mangled (a person's name is turned into an English word or a wrong name), negation-modality (flip or drop a negation, question or condition), omission (drop a meaningful clause), addition (invent a detail), idiom-literal (render an idiom word for word), number-unit (change a number, date or unit).`;

const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { passages } = await loadWorld(vite);
  const references = await readJson('references.json');
  const items = passages.filter(p => p.split !== 'legacy');
  const asItem = (p, answer) => ({ id: p.id, text: p.text, paragraph: p.paragraph, answer });

  const clean = await pool(items, 6, async p => {
    const verdict = await judge(asItem(p, references[p.id].reference), answerKey(p, references));
    return { id: p.id, verdict: verdict.verdict, errors: verdict.errors };
  });

  const types = ERROR_TYPES.filter(t => t !== 'register-fluency');
  const jobs = items.filter((_, i) => i % 3 === 0).flatMap((p, i) => [types[i % types.length], types[(i + 3) % types.length]].map(type => ({ p, type })));
  const seeded = await pool(jobs, 6, async ({ p, type }) => {
    const user = JSON.stringify({ type, passage: p.text, translation: references[p.id].reference });
    const reply = await cached('judge-seed', { user, SEED_SYSTEM }, () => callClaude({ model: MODELS.sonnet, system: SEED_SYSTEM, user, effort: 'medium', maxTokens: 1200 }));
    let corrupted;
    try { corrupted = JSON.parse(reply.text.replace(/^```(?:json)?|```$/g, '').trim()); } catch { return null; }
    const verdict = await judge(asItem(p, corrupted.translation), answerKey(p, references));
    return { id: p.id, type, change: corrupted.error, verdict: verdict.verdict, found: verdict.errors.map(e => `${e.type}/${e.severity}`) };
  });
  const rows = seeded.filter(Boolean);
  const summary = {
    referencesJudged: clean.length, referencesCorrect: clean.filter(c => c.verdict === 'correct').length, referencesWrong: clean.filter(c => c.verdict === 'wrong').length,
    falsePositives: clean.filter(c => c.verdict !== 'correct'),
    seeded: rows.length, caughtAny: rows.filter(r => r.verdict !== 'correct').length, caughtMajor: rows.filter(r => r.verdict === 'wrong').length,
    caughtRightType: rows.filter(r => r.found.some(f => f.startsWith(r.type))).length,
    byType: Object.fromEntries(types.map(t => { const r = rows.filter(x => x.type === t); return [t, { n: r.length, caught: r.filter(x => x.verdict !== 'correct').length, major: r.filter(x => x.verdict === 'wrong').length }]; })),
    misses: rows.filter(r => r.verdict === 'correct'),
  };
  await writeFile(join(EVAL_DIR, 'results/judge-check.json'), JSON.stringify(summary, null, 1));
  console.log(JSON.stringify({ ...summary, falsePositives: summary.falsePositives.length, misses: summary.misses.length }));
} finally { await vite.close(); }
