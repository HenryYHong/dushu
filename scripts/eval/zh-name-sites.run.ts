// Every string the name model is asked about (core/lexicon.ts modelNames), with the features the app computes, and every name the
// rules found, as scripts/train_name_model.py reads them. Run inside Vitest by that script (options arrive as JSON in ZH_EVAL_ARGS):
//
//   dir: a folder of texts (.txt, one text each, paragraphs on lines), or files: the texts to read;
//   model: a name model file (the priors alone will do: the features need only the character priors);
//   out: the TSV to write: text id, word, simplified, count, places of its own, the kind the rules found, the name list's kind,
//        shape, whether the book's statistics back it, the model's three scores, the kind it joined as, the features
//        (space-separated).
//
// Detection runs with the name list, as the reader has it. Prints counts only.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { it } from 'vitest';
import { parseGazetteer } from '../../src/core/gazetteer';
import { detectTerms, type NameSiteRecord } from '../../src/core/lexicon';
import { nameShape, parseNameModel } from '../../src/core/nameModel';
import { DATA_DIR, loadEvalDictionary } from './zh-shown';

interface Args { dir?: string; files?: string[]; model: string; out: string }

it('records the name sites of the texts', async () => {
  const a = JSON.parse(process.env.ZH_EVAL_ARGS ?? '{}') as Args;
  const dict = await loadEvalDictionary();
  const gazetteer = parseGazetteer(gunzipSync(readFileSync(join(DATA_DIR, 'names.tsv.gz'))).toString('utf8'));
  const model = parseNameModel(gunzipSync(readFileSync(a.model)).toString('utf8'));
  if (!model) throw new Error(`${a.model}: not a name model of this features version`);
  const files = a.files ?? readdirSync(a.dir!).filter((f) => f.endsWith('.txt')).sort().map((f) => join(a.dir!, f));
  const rows = ['text\tword\tsimp\tcount\tfree\tfound\tlist\tshape\tbacked\tp_none\tp_person\tp_place\ttook\tfeatures'];
  let sites = 0;
  const t0 = performance.now();
  for (const f of files) {
    const id = basename(f).replace(/\.txt$/, '');
    let got: NameSiteRecord[] = [];
    detectTerms([readFileSync(f, 'utf8')], dict, { gazetteer, nameModel: model, nameSites: (s) => { got = s; } });
    for (const s of got) {
      const simp = s.site.simp.join('');
      const p = s.scores ?? [0, 0, 0];
      rows.push([id, s.word, simp, s.site.count, s.site.free, s.found ?? '', gazetteer?.kindOf(simp) ?? '', nameShape(s.site.simp), s.backed ? 1 : 0,
        p[0].toFixed(4), p[1].toFixed(4), p[2].toFixed(4), s.took ?? '', s.features.join(' ')].join('\t'));
    }
    sites += got.length;
  }
  writeFileSync(a.out, rows.join('\n') + '\n');
  console.log(`${files.length} texts, ${sites} sites, ${Math.round((performance.now() - t0) / 1000)} s`);
});
