// Renders scripts/eval/report.md from the results files plus the hand-written notes in report-notes.md.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EVAL_DIR, readJson } from './lib.mjs';
import { ERROR_TYPES } from './judge.mjs';
import { loadResults, score } from './run.mjs';
import { allConfigs, HEADLINE, REPORT_ORDER } from './all-configs.mjs';

const pct = v => v === null ? 'n/a' : `${(v * 100).toFixed(0)}%`;
const sec = v => v === null ? 'n/a' : `${(v / 1000).toFixed(1)} s`;
const typeCell = (s, type) => { const t = s.byType[type]; return t ? `${t.major + t.minor}${t.major ? ` (${t.major} major)` : ''}` : '0'; };

function table(header, rows) {
  return [`| ${header.join(' | ')} |`, `|${header.map(() => '---').join('|')}|`, ...rows.map(r => `| ${r.join(' | ')} |`)].join('\n');
}

export async function writeReport() {
  const configs = allConfigs();
  const loaded = [];
  for (const id of REPORT_ORDER) {
    const result = await loadResults(id);
    const config = configs.find(c => c.id === id);
    if (result) loaded.push({ id, label: result.label ?? config?.label ?? id, note: result.note ?? config?.note ?? '', ranAt: result.ranAt, items: result.items });
  }
  const passages = await readJson('passages.json');
  const counts = { dev: passages.filter(p => p.split === 'dev').length, held: passages.filter(p => p.split === 'held').length };
  const parts = [];
  try { parts.push((await readFile(join(EVAL_DIR, 'report-notes.md'), 'utf8')).trim()); } catch { /* notes are optional */ }

  const summary = split => table(
    ['Configuration', 'n', 'Correct', 'Minor only', 'Wrong', 'Strict pass', 'Lenient pass', 'Major errors', 'Minor errors', ...ERROR_TYPES],
    loaded.filter(r => score(r.items, split).n > 0).map(r => {
      const s = score(r.items, split);
      return [`\`${r.id}\``, s.n, s.correct, s.minor, s.wrong, pct(s.strict), pct(s.lenient), s.majorErrors, s.minorErrors, ...ERROR_TYPES.map(t => typeCell(s, t))];
    }));
  const byId = new Map(loaded.map(r => [r.id, r]));
  const headline = HEADLINE.flatMap(([model, before, after]) => [['before', before], ['after', after]].map(([when, id]) => {
    const r = byId.get(id);
    if (!r) return null;
    const s = score(r.items, 'held');
    return [model, when, `\`${id}\``, `${s.correct}/${s.n} (${pct(s.strict)})`, `${s.n - s.wrong}/${s.n} (${pct(s.lenient)})`, s.majorErrors, s.minorErrors, ...ERROR_TYPES.map(t => typeCell(s, t))];
  })).filter(Boolean);
  parts.push(`## Before and after, held-out (${counts.held} passages, never used for tuning)\n\nClaude rows are 3 samples per passage (n is passages times samples). Strict pass: no error at all. Lenient pass: no major error. "Before" is the app as it was at the start of this round; "after" is what ships now.\n\n${table(['Model', '', 'Configuration', 'Strict pass', 'Lenient pass', 'Major errors', 'Minor errors', ...ERROR_TYPES], headline)}`);
  parts.push(`## Held-out results, every configuration (${counts.held} passages, never used for tuning)\n\nStrict pass = no error at all. Lenient pass = no major error. Error type cells count every error of that type (major ones in brackets).\n\n${summary('held')}`);
  parts.push(`## Dev results (${counts.dev} passages, used for tuning)\n\n${summary('dev')}`);

  const legacy = table(['Configuration', 'n', 'Correct', 'Minor only', 'Wrong', 'Pattern screen passes'],
    loaded.filter(r => r.items.some(i => i.split === 'legacy')).map(r => {
      const rows = r.items.filter(i => i.split === 'legacy');
      if (!rows.length) return [`\`${r.id}\``, '0', '', '', '', ''];
      const s = score(rows.map(i => ({ ...i, split: 'dev' })), 'dev');
      const screened = rows.filter(i => i.answer && !i.screens?.some(f => f.startsWith('legacy'))).length;
      return [`\`${r.id}\``, s.n, s.correct, s.minor, s.wrong, `${screened}/${rows.length}`];
    }));
  parts.push(`## Older hand-made fixtures (25 sentences the app was tuned on before this round)\n\nThese carry the app's old special cases (the 酒店 sense). They guard against regressions and are not part of the dev or held-out numbers.\n\n${legacy}`);

  const latency = table(['Configuration', 'First token p50', 'First token p95', 'Total p50', 'Total p95', 'Model calls'],
    loaded.filter(r => r.items.some(i => i.split !== 'legacy')).map(r => {
      const s = score(r.items.filter(i => i.split !== 'legacy'), 'all');
      return [`\`${r.id}\``, sec(s.firstP50), sec(s.firstP95), sec(s.totalP50), sec(s.totalP95), s.calls];
    }));
  parts.push(`## Latency (all ${counts.dev + counts.held} new passages; Claude calls ran 4 at a time, Qwen one at a time)\n\n${latency}`);

  const inventory = loaded.map(r => `- \`${r.id}\`: ${r.label}. ${r.note}`).join('\n');
  parts.push(`## Configurations\n\n${inventory}`);

  const final = loaded.filter(r => r.id.startsWith('final.'));
  const failures = [];
  for (const r of final) {
    const bad = r.items.filter(i => i.split === 'held' && i.judge && i.judge.verdict !== 'correct');
    if (!bad.length) continue;
    failures.push(`### \`${r.id}\` held-out passages that were not fully correct\n\n` + bad.map(i =>
      `- \`${i.id}\` (${i.judge.verdict}${i.unverified ? ', labeled unverified' : ''}): ${i.judge.errors.map(e => `${e.type}/${e.severity}: ${e.why}`).join(' ')}`).join('\n'));
  }
  if (failures.length) parts.push(`## What still goes wrong\n\n${failures.join('\n\n')}`);
  try {
    const check = JSON.parse(await readFile(join(EVAL_DIR, 'results/judge-check.json'), 'utf8'));
    const byType = Object.entries(check.byType).map(([type, v]) => `${type} ${v.caught}/${v.n}`).join(', ');
    parts.push(`## Checking the judge\n\n- Each passage's own reference translation, offered as a candidate: ${check.referencesCorrect} of ${check.referencesJudged} judged fully correct, ${check.referencesWrong} judged wrong (so the judge's false-alarm rate on a good translation is about ${Math.round(100 * (1 - check.referencesCorrect / check.referencesJudged))}%, all minor).\n- Translations with one seeded error: ${check.caughtAny} of ${check.seeded} caught (${check.caughtMajor} as major, ${check.caughtRightType} with the right type). By type: ${byType}.\n- Judging the same outputs twice with different judge samples moved a configuration's strict pass count by 1 to 2 passages out of 81 to 126, so judge noise is small next to the noise of Claude's own sampling.`);
  } catch { /* the check is optional */ }
  parts.push('_Generated by `node scripts/evaluate-translations.mjs`. Do not edit by hand: edit `scripts/eval/report-notes.md` for the narrative._');
  const file = join(EVAL_DIR, 'report.md');
  await writeFile(file, `${parts.join('\n\n')}\n`);
  return file;
}
