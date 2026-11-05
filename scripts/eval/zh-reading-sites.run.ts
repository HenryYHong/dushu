// Every place where the reading model may speak (core/readingModel.ts), with its features, as scripts/train_reading_model.py
// reads them. Run inside Vitest by that script (options arrive as JSON in ZH_EVAL_ARGS):
//
//   cpp: a folder with CPP's <split>.sent and <split>.lb; splits: which of them (each line is read alone, no names, as the
//        CPP benchmark's "dict" mode reads it). One row per CPP item: where the item's character is a one-character token,
//        whether a rule's case read it, and its features.
//   texts: files read through the reader's path with the book's names (import, detection, ui/reader/shown.ts). One row per
//        place, with the text around it.
//   lines: a file of paragraphs, one per line, read alone with no names (the check sentences of the model's test). One row per
//        place: line, offset, char, the rules' reading, whether a rule's case decided it, the text around it, features.
//   only: the characters to record (default: every character with two or more readings that is not in NOT_FOR_MODEL).
//   out: the TSV to write. chars: also write each character's own readings (for the training script's classes).
//
// Every one-character place is recorded, also where a rule's own case decided the reading (decided = 1): those readings are the
// training script's silver labels. The features come from siteFeatures itself, through the dictionary's own call (a stand-in
// model that only records), so what the model is trained on is what the app computes.
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { it } from 'vitest';
import { importFile } from '../../src/import';
import { markedToNumbered } from '../../src/core/pinyin';
import { NOT_FOR_MODEL, siteFeatures, type ReadingChooser, type ReadingSite } from '../../src/core/readingModel';
import { detectScript } from '../../src/core/text';
import { inScript, segmentShown } from '../../src/ui/reader/shown';
import type { Dictionary, Token } from '../../src/types';
import { bookLexicon, detectionTexts, loadEvalDictionary } from './zh-shown';
import { cppItems } from './zh-score';

interface Args { cpp?: string; splits?: string[]; texts?: string[]; lines?: string; out: string; chars?: string; only?: string }

interface Site { ch: string; fallback: string; decided: boolean; features: string[]; offset: number }

/** The readings a character has in the dictionary: its own CC-CEDICT rows and Unihan's. */
function readingsOf(dict: Dictionary, ch: string): string[] {
  const set = new Set(dict.lookup(ch).filter((e) => e.simp === ch || e.trad === ch).map((e) => e.pinyin.toLowerCase()).filter((p) => !p.includes(' ')));
  for (const r of dict.char(ch)?.readings ?? []) set.add(markedToNumbered(r));
  return [...set];
}

/** A stand-in model that records each one-character site (characters with two or more readings) and keeps the rules' reading. */
function recorder(dict: Dictionary, sink: Site[]): ReadingChooser {
  const poly = new Map<string, boolean>();
  return {
    choose: () => undefined,
    observe(site: ReadingSite, fallback: string, decided: boolean) {
      if (only ? !only.has(site.ch) : NOT_FOR_MODEL.has(site.ch)) return;
      let p = poly.get(site.ch);
      if (p === undefined) poly.set(site.ch, (p = readingsOf(dict, site.ch).length >= 2));
      if (!p) return;
      let offset = 0;
      for (let k = -1; ; k--) {
        const t = site.tok(k);
        if (!t) break;
        offset += t.length;
      }
      sink.push({ ch: site.ch, fallback, decided, features: siteFeatures(site, fallback), offset });
    },
  };
}

let only: Set<string> | undefined;

/** The tokens of one paragraph and the sites recorded while it was cut. */
function cutWithSites(dict: Dictionary, shown: string, source: string, lexicon?: Parameters<typeof segmentShown>[3]): { tokens: Token[]; sites: Site[] } {
  const sites: Site[] = [];
  dict.setReadingModel?.(recorder(dict, sites));
  try {
    return { tokens: segmentShown(shown, source, dict, lexicon), sites };
  } finally {
    dict.setReadingModel?.(null);
  }
}

const clean = (s: string) => s.replace(/[\t\n\r]/g, ' ');

it('writes the reading model sites', async () => {
  const a = JSON.parse(process.env.ZH_EVAL_ARGS ?? '{}') as Args;
  only = a.only ? new Set(Array.from(a.only)) : undefined;
  const dict = await loadEvalDictionary();
  dict.setReadingModel?.(null);
  const rows: string[] = [];
  const seen = new Set<string>();
  if (a.cpp) {
    rows.push('# split\titem\tchar\tgold\ttoken\tone\tapp\tsite\tdecided\tfallback\tfeatures');
    for (const split of a.splits ?? ['train', 'dev', 'test']) {
      const items = cppItems(readFileSync(`${a.cpp}/${split}.sent`, 'utf8'), readFileSync(`${a.cpp}/${split}.lb`, 'utf8'));
      // The script is told from the whole set, as scoreCpp does.
      const script = detectScript(items.map((x) => x.text).join('\n').slice(0, 400000));
      items.forEach((x, i) => {
        const { tokens, sites } = cutWithSites(dict, inScript(x.text, 'simplified', dict, script), x.text);
        const t = tokens.find((t) => t.start <= x.at && x.at < t.end);
        const app = t?.pinyin?.[[...x.text.slice(t.start, x.at)].length] ?? '?';
        const site = sites.find((s) => s.offset === x.at);
        seen.add(x.text[x.at]);
        rows.push([split, i, x.text[x.at], x.gold.replace(/v/g, 'ü'), t ? t.text : '', t && [...t.text].length === 1 ? 1 : 0, app, site ? 1 : 0, site?.decided ? 1 : 0, site?.fallback ?? ''].map(String).map(clean).concat(site ? site.features : []).join('\t'));
      });
      console.log(split, items.length, 'items');
    }
  }
  if (a.lines) {
    rows.push('# line\toffset\tchar\tfallback\tdecided\tcontext\tfeatures');
    readFileSync(a.lines, 'utf8').split('\n').forEach((line, i) => {
      if (!line.trim() || line.startsWith('#')) return;
      const shown = inScript(line, 'simplified', dict, detectScript(line));
      for (const s of cutWithSites(dict, shown, line).sites) {
        rows.push([i + 1, s.offset, s.ch, s.fallback, s.decided ? 1 : 0, clean(shown), s.features.join('\t')].join('\t'));
      }
    });
  }
  if (a.texts?.length && !rows.length) rows.push('# text\tblock\tstart\tchar\tfallback\tdecided\tcontext\tfeatures');
  for (const path of a.texts ?? []) {
    const book = await importFile(new File([readFileSync(path) as BlobPart], basename(path)));
    const { lexicon } = bookLexicon(detectionTexts(book.chapters), dict, 'simplified', book.script);
    let n = 0;
    book.chapters.forEach((c, ci) => c.blocks.forEach((b, bi) => {
      if (!(b.t === 'p' || b.t === 'h' || b.t === 'quote') || !b.text) return;
      const shown = inScript(b.text, 'simplified', dict, book.script);
      const { sites } = cutWithSites(dict, shown, b.text, lexicon);
      for (const s of sites) {
        const ctx = `${shown.slice(Math.max(0, s.offset - 20), s.offset)}【${shown.slice(s.offset, s.offset + 1)}】${shown.slice(s.offset + 1, s.offset + 21)}`;
        rows.push([basename(path).replace(/\.[^.]+$/, ''), `${ci}.${bi}`, s.offset, s.ch, s.fallback, s.decided ? 1 : 0, clean(ctx), s.features.join('\t')].join('\t'));
        seen.add(s.ch);
        n++;
      }
    }));
    console.log(basename(path), n, 'sites');
  }
  writeFileSync(a.out, rows.join('\n') + '\n');
  if (a.chars) writeFileSync(a.chars, [...seen].sort().map((c) => `${c}\t${readingsOf(dict, c).join(' ')}`).join('\n') + '\n');
});
