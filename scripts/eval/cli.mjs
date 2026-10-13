// Command line of the evaluation.
import { createServer } from 'vite';
import { ROOT, loadWorld } from './lib.mjs';
import { runConfig, saveResults, score } from './run.mjs';
import { allConfigs, DEFAULT_CONFIGS } from './all-configs.mjs';

function parse(argv) {
  const opts = { configs: null, split: 'all', fresh: false, noJudge: false, report: true, list: false, legacy: true, limit: 0, reps: 1, judgeSeed: 0, concurrency: 4 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--configs') opts.configs = argv[++i].split(',');
    else if (a === '--split') opts.split = argv[++i];
    else if (a === '--fresh') opts.fresh = true;
    else if (a === '--no-judge') opts.noJudge = true;
    else if (a === '--no-report') opts.report = false;
    else if (a === '--no-legacy') opts.legacy = false;
    else if (a === '--limit') opts.limit = Number(argv[++i]);
    else if (a === '--concurrency') opts.concurrency = Number(argv[++i]);
    else if (a === '--reps') opts.reps = Number(argv[++i]);
    else if (a === '--judge-seed') opts.judgeSeed = Number(argv[++i]);
    else if (a === '--list') opts.list = true;
    else throw new Error(`Unknown option ${a}`);
  }
  return opts;
}

export async function main(argv) {
  const opts = parse(argv);
  if (opts.list) { for (const c of allConfigs()) console.log(`${c.id}\t${c.label}`); return; }
  const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    // Source modules call relative bridge URLs; point them at the production bridge on this Mac.
    const nativeFetch = globalThis.fetch;
    globalThis.location ??= new URL('http://127.0.0.1:4317/');
    globalThis.fetch = (url, init) => nativeFetch(typeof url === 'string' && url.startsWith('/') ? new URL(url, 'http://127.0.0.1:4317') : url, init);
    const world = await loadWorld(vite);
    let passages = world.passages.filter(p => opts.split === 'all' ? true : p.split === opts.split || (opts.legacy && p.split === 'legacy'));
    if (!opts.legacy) passages = passages.filter(p => p.split !== 'legacy');
    if (opts.limit) passages = passages.slice(0, opts.limit);
    const wanted = opts.configs ?? DEFAULT_CONFIGS;
    const known = new Map(allConfigs().map(c => [c.id, c]));
    for (const id of wanted) {
      const config = known.get(id);
      if (!config) throw new Error(`Unknown configuration ${id}. Use --list.`);
      const started = Date.now();
      console.log(`== ${id}: ${passages.length} passages`);
      const items = await runConfig(config, passages, world, opts);
      if (!opts.noJudge) {
        await saveResults(opts.judgeSeed ? { ...config, id: `${config.id}.judge${opts.judgeSeed}`, note: `Same outputs as ${config.id}, judged again with judge sample ${opts.judgeSeed}.` } : config, items);
        for (const split of ['dev', 'held']) {
          const s = score(items, split);
          console.log(`   ${split}: ${s.correct}/${s.n} correct, ${s.minor} minor, ${s.wrong} wrong, major errors ${s.majorErrors}`);
        }
      }
      console.log(`   ${((Date.now() - started) / 1000).toFixed(0)} s`);
    }
    if (opts.report && !opts.noJudge) {
      const { writeReport } = await import('./report.mjs');
      console.log(`Report: ${await writeReport()}`);
    }
  } finally { await vite.close(); }
}
