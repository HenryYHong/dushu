#!/usr/bin/env node
// Builds public/data/names.tsv.gz, the name list (gazetteer) that name detection uses as a prior (core/gazetteer.ts,
// ARCHITECTURE.md §3 and §4.9): people, places and organizations with an article on the Chinese Wikipedia, from Wikidata (CC0).
//
//   node scripts/build-gazetteer.mjs [--fetch] [--endpoint URL]
//
// --fetch asks a Wikidata SPARQL endpoint for the items with a zh.wikipedia article: one query per class, one per label language
// (zh, zh-hans, zh-hant, zh-cn, zh-tw; labels and aliases) and band of sitelink counts, and one per band for the English label's
// first letter, with a pause between queries and Retry-After honored (about 90 queries, about 90 MB). The answers are kept in
// <raw>/wikidata/ (raw = $DUSHU_RAW or .cache/raw); a file already there is not asked for again. The default endpoint is QLever's
// copy of Wikidata (https://qlever.dev/api/wikidata), which answers a whole class in seconds; query.wikidata.org works too but
// limits a client to small queries. Without --fetch the build reads what is there.
// The build (scripts/gazetteer.run.ts, run inside Vitest so it uses the app's own dictionary) keeps names of 2 to 7 Han
// characters that the dictionary does not already have as a word, and writes the file. It prints counts only.
import { createWriteStream, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTool } from './eval/zh-dump.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(process.env.DUSHU_RAW || join(root, '.cache', 'raw'), 'wikidata');
const UA = 'Dushu-data-builder/0.1 (personal reading app)';
const PAUSE_MS = 4000;

const PREFIXES = `PREFIX schema: <http://schema.org/>
PREFIX wikibase: <http://wikiba.se/ontology#>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
`;
const ZHWIKI = '?article schema:isPartOf <https://zh.wikipedia.org/> ; schema:about ?item .';

/** Classes whose instances (P31, or P31 then any P279 chain) are kept, by kind. Humans are P31 Q5 only. */
export const CLASSES = {
  person: { human: 'Q5', fictional: 'Q95074', legendary: 'Q13002315', deity: 'Q178885', mythical: 'Q4271324' },
  place: { location: 'Q2221906', feature: 'Q618123', structure: 'Q811979', admin: 'Q56061', settlement: 'Q486972', polity: 'Q1048835', country: 'Q3024240' },
  org: { organization: 'Q43229' },
  other: { dynasty: 'Q164950', ethnic: 'Q41710', war: 'Q198', battle: 'Q178561', period: 'Q11514315' },
  // Stars and the Chinese constellations (角木蛟, 昴日鸡): the class tree files some of them under places; they are "other".
  sky: { astronomical: 'Q6999', constellation: 'Q1074076' },
};
export const LANGS = ['zh', 'zh-hans', 'zh-hant', 'zh-cn', 'zh-tw'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** POST one query and hand each TSV row (after the header) to `row`; retries on 429/5xx, honoring Retry-After. */
async function query(endpoint, sparql, row) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'User-Agent': UA, Accept: 'text/tab-separated-values', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ query: sparql }),
    });
    if (res.status === 429 || res.status >= 500) {
      const wait = Math.min(300, Number(res.headers.get('retry-after')) || 30 * attempt);
      await res.body?.cancel();
      if (attempt >= 6) throw new Error(`HTTP ${res.status} after ${attempt} tries`);
      console.log(`  HTTP ${res.status}, waiting ${wait} s`);
      await sleep(wait * 1000);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const dec = new TextDecoder();
    let rest = '';
    let header = true;
    let n = 0;
    for await (const chunk of res.body) {
      rest += dec.decode(chunk, { stream: true });
      let nl;
      while ((nl = rest.indexOf('\n')) >= 0) {
        const line = rest.slice(0, nl);
        rest = rest.slice(nl + 1);
        if (header) { header = false; continue; }
        // QLever reports an error that happens while streaming at the end of the body.
        if (line.includes('An error has occurred while exporting')) throw new Error('the endpoint stopped mid-answer');
        if (line) { row(line.split('\t')); n++; }
      }
    }
    if (rest.includes('An error has occurred')) throw new Error('the endpoint stopped mid-answer');
    if (rest.trim() && !header) { row(rest.split('\t')); n++; }
    return n;
  }
}

const qid = (iri) => /Q(\d+)>?$/.exec(iri)?.[1] ?? '';
/** A literal "…"@lang without its quotes and tag (TSV escapes \t \n \\ and \"). */
const literal = (s) => {
  const m = /^"(.*)"(@[\w-]+)?$/.exec(s);
  return m ? m[1].replace(/\\(.)/g, (_, c) => (c === 't' ? '\t' : c === 'n' ? '\n' : c)) : s;
};
const HAN_NAME = /^\p{Script=Han}{2,8}$/u;

/**
 * Write rows to `file` through a temporary file, so a failed fetch never leaves half a file. A file already there is kept (a
 * fetch that stopped halfway picks up where it was); a connection that drops mid-answer is asked again, a few times.
 */
async function fetchTo(endpoint, file, sparql, map) {
  if (existsSync(file)) { console.log(`  ${file.slice(RAW.length + 1)}: already fetched`); return; }
  for (let attempt = 1; ; attempt++) {
    const tmp = file + '.part';
    const out = createWriteStream(tmp);
    let kept = 0;
    try {
      const n = await query(endpoint, sparql, (cols) => {
        const line = map(cols);
        if (line) { out.write(line + '\n'); kept++; }
      });
      await new Promise((r) => out.end(r));
      renameSync(tmp, file);
      console.log(`  ${file.slice(RAW.length + 1)}: ${n} rows, ${kept} kept`);
      await sleep(PAUSE_MS);
      return;
    } catch (e) {
      await new Promise((r) => out.end(r));
      if (attempt >= 4) throw e;
      console.log(`  ${file.slice(RAW.length + 1)}: ${e.message ?? e}, asking again in ${20 * attempt} s`);
      await sleep(20000 * attempt);
    }
  }
}

async function fetchAll(endpoint) {
  mkdirSync(RAW, { recursive: true });
  for (const [kind, classes] of Object.entries(CLASSES)) {
    for (const [name, q] of Object.entries(classes)) {
      const pattern = name === 'human' ? `?item wdt:P31 wd:${q} .` : `?item wdt:P31/wdt:P279* wd:${q} .`;
      await fetchTo(endpoint, join(RAW, `class-${kind}-${name}.tsv`), `${PREFIXES}SELECT DISTINCT ?item WHERE { ${ZHWIKI} ${pattern} }`,
        (c) => qid(c[0]));
    }
  }
  // Labels and aliases, one query per language and per band of sitelink counts: a whole language at once is a 150 MB answer
  // that the connection does not always survive.
  for (const lang of LANGS) {
    for (const [pred, tag] of [['rdfs:label', 'label'], ['skos:altLabel', 'alias']]) {
      for (const [lo, hi] of SITELINK_BANDS) {
        await fetchTo(endpoint, join(RAW, `${tag}-${lang}.${lo}.tsv`),
          `${PREFIXES}SELECT ?item ?sl ?l WHERE { ${ZHWIKI} ?item wikibase:sitelinks ?sl . FILTER (?sl >= ${lo} && ?sl < ${hi}) ?item ${pred} ?l . FILTER (LANG(?l) = "${lang}") }`,
          (c) => { const l = literal(c[2] ?? ''); return HAN_NAME.test(l) ? `${qid(c[0])}\t${c[1]}\t${l}` : ''; });
      }
    }
  }
  // Whether each item's English label starts with a capital: a named thing (Tsinghua University, Old Bridge) does, a concept that
  // the class tree files under organizations or places (animism, urban planning) does not.
  for (const [lo, hi] of SITELINK_BANDS) {
    await fetchTo(endpoint, join(RAW, `en-${lo}.tsv`),
      `${PREFIXES}SELECT ?item ?l WHERE { ${ZHWIKI} ?item wikibase:sitelinks ?sl . FILTER (?sl >= ${lo} && ?sl < ${hi}) ?item rdfs:label ?l . FILTER (LANG(?l) = "en") }`,
      (c) => { const l = literal(c[1] ?? ''); return l ? `${qid(c[0])}\t${/^\p{Lu}/u.test(l) ? 'U' : /^\p{Ll}/u.test(l) ? 'l' : '-'}` : ''; });
  }
}

/** Bands of sitelink counts [from, to) that split the label queries into answers of a few hundred thousand rows. */
const SITELINK_BANDS = [[1, 2], [2, 3], [3, 5], [5, 9], [9, 20], [20, 100000]];

async function main() {
  const argv = process.argv.slice(2);
  let endpoint = 'https://qlever.dev/api/wikidata';
  let fetchFirst = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--fetch') fetchFirst = true;
    else if (argv[i] === '--endpoint') endpoint = argv[++i];
    else { console.error('usage: node scripts/build-gazetteer.mjs [--fetch] [--endpoint URL]'); return 2; }
  }
  if (fetchFirst) await fetchAll(endpoint);
  if (!existsSync(join(RAW, 'label-zh.1.tsv'))) { console.error(`No Wikidata answers in ${RAW}: run with --fetch first.`); return 2; }
  return runTool('scripts/gazetteer.run.ts', { raw: RAW, out: join(root, 'public', 'data', 'names.tsv.gz') });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(await main());
