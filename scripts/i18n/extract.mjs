// Collects the app's own words for translation: every tt('…'), ttm('…'), ttx('…', 'context') and ttn(n, '…', '…') in src/ (src/i18n/index.ts says
// how they are written). Writes src/i18n/strings.json: each English string, its plural form if it is a count, and the files it
// is in (context for whoever translates it). Also the classics' descriptions, from public/samples/<lang>/index.json. `--check` writes nothing and fails when the file is out of date.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const OUT = join(ROOT, 'src/i18n/strings.json');
const STR = String.raw`'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|\`(?:[^\`\\$]|\\.)*\``;
const ONE = new RegExp(String.raw`\b(tt|ttm)\(\s*(${STR})`, 'g');
const CTX = new RegExp(String.raw`\bttx\(\s*(${STR})\s*,\s*(${STR})`, 'g');
const MANY = new RegExp(String.raw`\bttn\(\s*[^,()]+(?:\([^()]*\))?\s*,\s*(${STR})\s*,\s*(${STR})`, 'g');

/** A string literal's value. Only literals reach here, and only from this repository. */
const value = (lit) => (lit[0] === '`' ? lit.slice(1, -1).replace(/\\(.)/g, '$1') : JSON.parse(lit[0] === "'" ? `"${lit.slice(1, -1).replace(/\\'/g, "'").replace(/"/g, '\\"')}"` : lit));

function files(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.ts$/.test(name) && !/\.d\.ts$/.test(name)) out.push(p);
  }
  return out;
}

export function extract() {
  const found = new Map();
  const add = (text, where, one) => {
    const e = found.get(text) ?? { where: [] };
    if (one !== undefined) e.one = one;
    if (!e.where.includes(where)) e.where.push(where);
    found.set(text, e);
  };
  for (const f of files(join(ROOT, 'src'))) {
    if (f.endsWith(join('i18n', 'index.ts'))) continue;
    const src = readFileSync(f, 'utf8');
    const where = relative(ROOT, f).replace(/\\/g, '/');
    for (const m of src.matchAll(ONE)) add(value(m[2]), where);
    for (const m of src.matchAll(MANY)) add(value(m[2]), where, value(m[1]));
    for (const m of src.matchAll(CTX)) add(`${value(m[1])} [${value(m[2])}]`, where);
  }
  // The classics' one-line descriptions (public/samples/<lang>/index.json `blurb`): the library shows them through tt().
  for (const dir of ['', ...readdirSync(join(ROOT, 'public/samples'))]) {
    const f = join(ROOT, 'public/samples', dir, 'index.json');
    let list;
    try { list = JSON.parse(readFileSync(f, 'utf8')); } catch { continue; }
    const items = Array.isArray(list) ? list : list.books ?? list.samples ?? [];
    for (const b of items) if (typeof b.blurb === 'string' && b.blurb) add(b.blurb, `public/samples/${dir ? `${dir}/` : ''}index.json`);
  }
  const strings = {};
  for (const k of [...found.keys()].sort()) {
    const e = found.get(k);
    strings[k] = { ...(e.one !== undefined ? { one: e.one } : {}), where: e.where.sort() };
  }
  return strings;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const text = JSON.stringify(extract(), null, 1) + '\n';
  if (process.argv.includes('--check')) {
    let old = '';
    try { old = readFileSync(OUT, 'utf8'); } catch { /* none yet */ }
    if (old !== text) { console.error('src/i18n/strings.json is out of date: run node scripts/i18n/extract.mjs'); process.exit(1); }
    console.log('strings.json is up to date');
  } else {
    writeFileSync(OUT, text);
    console.log(`${Object.keys(JSON.parse(text)).length} strings in src/i18n/strings.json`);
  }
}
