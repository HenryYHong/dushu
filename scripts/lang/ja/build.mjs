#!/usr/bin/env node
// Builds public/data/ja/, the data of the Japanese engine (src/lang/ja):
//   kuromoji/*.dat.gz  IPADIC as kuromoji.js ships it (the zero padding at the end of some files removed)
//   jmdict.tsv.gz      JMdict (English), one entry per line, with JLPT levels
//   kanji.tsv.gz       KANJIDIC2: meanings, readings, strokes, grade, old JLPT level
//   meta.json          build date, counts, sources and licences
//
// Usage: node scripts/lang/ja/build.mjs [--work <dir>]
// Downloads go to <dir> (default: $TMPDIR/dushu-ja-build); they are kept for the next run unless --clean is given.
// The formats are documented in src/lang/ja/data.ts, which reads them.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { strFromU8, unzipSync } from 'fflate';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = join(ROOT, 'public/data/ja');
const KUROMOJI = join(ROOT, 'node_modules/kuromoji/dict');
const args = process.argv.slice(2);
const WORK = resolve(args.includes('--work') ? args[args.indexOf('--work') + 1] : join(tmpdir(), 'dushu-ja-build'));
const CLEAN = args.includes('--clean');
const UA = 'Dushu-data-builder/0.1 (personal reading app)';

const JMDICT_RELEASE = '3.6.2+20261026175559';
const JMDICT_BASE = `https://github.com/scriptin/jmdict-simplified/releases/download/${encodeURIComponent(JMDICT_RELEASE)}`;
const JMDICT_ZIP = `jmdict-eng-${JMDICT_RELEASE}.json.zip`;
const KANJIDIC_ZIP = `kanjidic2-en-${JMDICT_RELEASE}.json.zip`;
/** Jonathan Waller's JLPT lists with JMdict entry numbers added by Stephen Kraus (stephenmk). */
const JLPT_COMMIT = 'main';
const JLPT_BASE = `https://raw.githubusercontent.com/stephenmk/yomitan-jlpt-vocab/${JLPT_COMMIT}/original_data`;

async function download(url, file) {
  if (existsSync(file) && statSync(file).size > 0) return;
  console.log(`download ${url}`);
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

function readZipJson(file) {
  const z = unzipSync(readFileSync(file));
  const name = Object.keys(z).find((n) => n.endsWith('.json'));
  return JSON.parse(strFromU8(z[name]));
}

function writeGz(name, text) {
  const bytes = gzipSync(Buffer.from(text, 'utf8'), { level: 9 });
  writeFileSync(join(OUT, name), bytes);
  return bytes.length;
}

// ------------------------------------------------------------- kuromoji ---

/**
 * kuromoji's builder sized several buffers to a power of two, so tid_pos.dat (36 MB of features) unpacks to 42 MB and unk.dat
 * (400 bytes) to 10 MB of zeros: the browser would hold 30 MB of nothing. Those files are cut after their last byte of data.
 * The rest are copied as they are (their gzip is tighter than zlib's).
 */
const PADDED = new Set(['tid.dat', 'tid_pos.dat', 'unk.dat', 'unk_pos.dat', 'unk_map.dat', 'unk_invoke.dat']);
const KUROMOJI_FILES = ['base.dat', 'check.dat', 'tid.dat', 'tid_pos.dat', 'tid_map.dat', 'cc.dat', 'unk.dat', 'unk_pos.dat', 'unk_map.dat', 'unk_char.dat', 'unk_invoke.dat'];

function buildKuromoji() {
  const dir = join(OUT, 'kuromoji');
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) if (f !== 'NOTICE.md' && !KUROMOJI_FILES.includes(f.replace(/\.gz$/, ''))) rmSync(join(dir, f));
  const sizes = {};
  for (const name of KUROMOJI_FILES) {
    const src = readFileSync(join(KUROMOJI, `${name}.gz`));
    let out = src;
    if (PADDED.has(name)) {
      const raw = gunzipSync(src);
      let end = raw.length;
      while (end > 0 && raw[end - 1] === 0) end--;
      // Keep the terminating NUL of the last feature string, and whole 4-byte words for the int tables.
      end = Math.min(raw.length, Math.ceil((end + 1) / 4) * 4);
      out = gzipSync(raw.subarray(0, end), { level: 9 });
    }
    writeFileSync(join(dir, `${name}.gz`), out);
    sizes[`kuromoji/${name}.gz`] = out.length;
  }
  // IPADIC's licence asks for its notice in every copy; kuromoji's NOTICE.md carries it.
  writeFileSync(join(dir, 'NOTICE.md'), readFileSync(join(KUROMOJI, '..', 'NOTICE.md')));
  return sizes;
}

// --------------------------------------------------------------- JMdict ---

const KANJI_FLAGS = { iK: 'I', oK: 'O', rK: 'R', sK: 'S', ateji: 'A', io: 'G', ik: 'I' };
const KANA_FLAGS = { ik: 'I', ok: 'O', rk: 'R', sk: 'S', gikun: 'J' };
const LANGS = {
  eng: 'English', fre: 'French', ger: 'German', ita: 'Italian', chi: 'Chinese', lat: 'Latin', por: 'Portuguese', spa: 'Spanish',
  kor: 'Korean', dut: 'Dutch', rus: 'Russian', ara: 'Arabic', san: 'Sanskrit', gre: 'Greek', grc: 'Ancient Greek', ain: 'Ainu',
  hin: 'Hindi', tha: 'Thai', tur: 'Turkish', haw: 'Hawaiian', heb: 'Hebrew', swe: 'Swedish', vie: 'Vietnamese', may: 'Malay',
  hun: 'Hungarian', afr: 'Afrikaans', ind: 'Indonesian', fin: 'Finnish', ukr: 'Ukrainian', per: 'Persian', dan: 'Danish',
  nor: 'Norwegian', tib: 'Tibetan', mon: 'Mongolian', cze: 'Czech', mal: 'Malayalam', geo: 'Georgian', pol: 'Polish',
  khm: 'Khmer', urd: 'Urdu', rum: 'Romanian', yid: 'Yiddish', som: 'Somali', amh: 'Amharic',
};

const clean = (s) => s.replace(/[\t\n\r\u001f|]/g, ' ').trim();

function formText(f, flags, extra = '') {
  const fl = (f.common ? 'P' : '') + f.tags.map((t) => flags[t] ?? '').join('');
  return clean(f.text) + (fl ? `#${fl}` : '') + extra;
}

/** JLPT level per JMdict entry number: 1 = N5 (easiest) … 5 = N1; a word on two lists keeps the easier. */
function readJlpt() {
  const level = new Map();
  let rows = 0;
  for (const n of [5, 4, 3, 2, 1]) {
    const lines = readFileSync(join(WORK, `jlpt-n${n}.csv`), 'utf8').split('\n').slice(1);
    for (const line of lines) {
      const id = line.split(',')[0]?.trim();
      if (!/^\d+$/.test(id)) continue;
      rows++;
      const lv = 6 - n;
      if (!level.has(id) || level.get(id) > lv) level.set(id, lv);
    }
  }
  return { level, rows };
}

function buildJmdict(jlpt) {
  const j = readZipJson(join(WORK, JMDICT_ZIP));
  const lines = [];
  const counts = { entries: 0, senses: 0, glosses: 0, jlptEntries: 0, common: 0 };
  const usedKanji = new Set();
  const levelSeen = new Set();
  for (const w of j.words) {
    const kanjiIndex = new Map(w.kanji.map((k, i) => [k.text, i]));
    const kanaIndex = new Map(w.kana.map((k, i) => [k.text, i]));
    const kanji = w.kanji.map((k) => formText(k, KANJI_FLAGS)).join(';');
    const kana = w.kana.map((k) => {
      const all = k.appliesToKanji.length === 1 && k.appliesToKanji[0] === '*';
      const restr = all ? '' : `@${k.appliesToKanji.map((t) => kanjiIndex.get(t)).filter((i) => i !== undefined).join(',')}`;
      return formText(k, KANA_FLAGS, restr === '@' ? '@-' : restr);
    }).join(';');
    for (const k of w.kanji) for (const ch of k.text) usedKanji.add(ch);
    const senses = [];
    for (const s of w.sense) {
      const tags = [...s.partOfSpeech, ...s.misc, ...s.field, ...s.dialect];
      const glosses = s.gloss.map((g) => {
        const t = clean(g.text);
        if (g.type === 'literal') return `lit. ${t}`;
        if (g.type === 'figurative') return `fig. ${t}`;
        return t;
      }).filter(Boolean);
      if (!glosses.length) continue;
      const notes = s.info.map(clean);
      for (const l of s.languageSource) {
        const lang = LANGS[l.lang] ?? l.lang;
        const from = l.wasei ? `made in Japan from ${lang}` : `from ${lang}`;
        notes.push(l.text ? `${from}: ${clean(l.text)}` : from);
      }
      const allK = s.appliesToKanji.length === 1 && s.appliesToKanji[0] === '*';
      const allR = s.appliesToKana.length === 1 && s.appliesToKana[0] === '*';
      let restr = '';
      if (!allK || !allR) {
        const k = allK ? '' : `k${s.appliesToKanji.map((t) => kanjiIndex.get(t)).filter((i) => i !== undefined).join(',')}`;
        const r = allR ? '' : `r${s.appliesToKana.map((t) => kanaIndex.get(t)).filter((i) => i !== undefined).join(',')}`;
        restr = [k, r].filter(Boolean).join(';');
      }
      let sense = `${tags.join(',')}\u001f${glosses.join('|')}`;
      if (notes.length || restr) sense += `\u001f${notes.join('|')}`;
      if (restr) sense += `\u001f${restr}`;
      senses.push(sense);
      counts.senses++;
      counts.glosses += glosses.length;
    }
    if (!senses.length) continue;
    const lv = jlpt.level.get(w.id);
    if (lv) { counts.jlptEntries++; levelSeen.add(w.id); }
    if (w.kanji.some((k) => k.common) || w.kana.some((k) => k.common)) counts.common++;
    lines.push(`${kanji}\t${kana}\t${lv ?? ''}\t${senses.join('\t')}`);
    counts.entries++;
  }
  const missing = [...jlpt.level.keys()].filter((id) => !levelSeen.has(id));
  if (missing.length) console.warn(`JLPT: ${missing.length} entry numbers not in this JMdict (${missing.slice(0, 10).join(' ')} …)`);
  const header = [
    `# JMdict (English) ${j.dictDate}, from jmdict-simplified ${j.version}. CC BY-SA 4.0, the Electronic Dictionary Research and Development Group.`,
    '# Columns: kanji forms; kana forms; JLPT level (1 = N5); senses. Format: src/lang/ja/data.ts.',
  ];
  const size = writeGz('jmdict.tsv.gz', header.concat(lines).join('\n') + '\n');
  return { size, counts, usedKanji, dictDate: j.dictDate, version: j.version, tags: j.tags };
}

// ------------------------------------------------------------ KANJIDIC2 ---

function buildKanji(usedKanji) {
  const j = readZipJson(join(WORK, KANJIDIC_ZIP));
  const lines = [];
  let inJmdict = 0;
  for (const c of j.characters) {
    const groups = c.readingMeaning?.groups ?? [];
    const on = [];
    const kun = [];
    const meanings = [];
    for (const g of groups) {
      for (const r of g.readings) {
        if (r.type === 'ja_on') on.push(r.value);
        else if (r.type === 'ja_kun') kun.push(r.value);
      }
      for (const m of g.meanings) if (m.lang === 'en') meanings.push(clean(m.value));
    }
    const nanori = c.readingMeaning?.nanori ?? [];
    if (!on.length && !kun.length && !meanings.length) continue;
    if (usedKanji.has(c.literal)) inJmdict++;
    const m = c.misc;
    lines.push([c.literal, m.strokeCounts?.[0] ?? '', m.grade ?? '', m.jlptLevel ?? '', m.frequency ?? '', on.join(' '), kun.join(' '), nanori.join(' '), meanings.join('|')].join('\t'));
  }
  const header = [
    `# KANJIDIC2 ${j.dictDate}, from jmdict-simplified ${j.version}. CC BY-SA 4.0, the Electronic Dictionary Research and Development Group.`,
    '# Columns: kanji; strokes; grade; old JLPT level (4 = easiest); newspaper frequency rank; on; kun; nanori; meanings.',
  ];
  const size = writeGz('kanji.tsv.gz', header.concat(lines).join('\n') + '\n');
  const have = new Set(lines.map((l) => l.split('\t')[0]));
  const missing = [...usedKanji].filter((ch) => /\p{Script=Han}/u.test(ch) && !have.has(ch));
  return { size, count: lines.length, inJmdict, missingFromJmdict: missing.length, dictDate: j.dictDate };
}

// ----------------------------------------------------------------- main ---

async function main() {
  mkdirSync(WORK, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  await download(`${JMDICT_BASE}/${encodeURIComponent(JMDICT_ZIP)}`, join(WORK, JMDICT_ZIP));
  await download(`${JMDICT_BASE}/${encodeURIComponent(KANJIDIC_ZIP)}`, join(WORK, KANJIDIC_ZIP));
  for (const n of [5, 4, 3, 2, 1]) await download(`${JLPT_BASE}/n${n}.csv`, join(WORK, `jlpt-n${n}.csv`));

  const sizes = buildKuromoji();
  const jlpt = readJlpt();
  const jm = buildJmdict(jlpt);
  sizes['jmdict.tsv.gz'] = jm.size;
  const kd = buildKanji(jm.usedKanji);
  sizes['kanji.tsv.gz'] = kd.size;

  const meta = {
    built: new Date().toISOString().slice(0, 10),
    counts: {
      entries: jm.counts.entries,
      senses: jm.counts.senses,
      glosses: jm.counts.glosses,
      commonEntries: jm.counts.common,
      jlptEntries: jm.counts.jlptEntries,
      jlptRows: jlpt.rows,
      kanji: kd.count,
      kanjiInJmdict: kd.inJmdict,
      ipadicWords: 392126,
    },
    sources: [
      { name: `JMdict (English) ${jm.dictDate}, via jmdict-simplified ${jm.version}`, license: 'CC BY-SA 4.0 (Electronic Dictionary Research and Development Group)', url: 'https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project' },
      { name: `KANJIDIC2 ${kd.dictDate}, via jmdict-simplified ${jm.version}`, license: 'CC BY-SA 4.0 (Electronic Dictionary Research and Development Group)', url: 'https://www.edrdg.org/wiki/index.php/KANJIDIC_Project' },
      { name: 'jmdict-simplified (JSON edition of JMdict and KANJIDIC2)', license: 'CC BY-SA 4.0 (data), MIT (code)', url: 'https://github.com/scriptin/jmdict-simplified' },
      { name: 'JLPT word lists by Jonathan Waller (tanos.co.uk)', license: 'CC BY', url: 'http://www.tanos.co.uk/jlpt/' },
      { name: 'yomitan-jlpt-vocab: Waller\'s lists matched to JMdict entries, by Stephen Kraus', license: 'CC BY-SA 4.0', url: 'https://github.com/stephenmk/yomitan-jlpt-vocab' },
      { name: 'IPADIC 2.7.0 (mecab-ipadic), as packaged by kuromoji.js', license: 'IPADIC licence (free use, modification and redistribution with the copyright notice; NAIST and ICOT)', url: 'https://github.com/taku910/mecab/tree/master/mecab-ipadic' },
      { name: 'kuromoji.js 0.1.2 (Takuya Asano, Atilika Inc.; dictionary format and Viterbi search, ported in src/lang/ja/ipadic.ts)', license: 'Apache-2.0', url: 'https://github.com/takuyaa/kuromoji.js' },
    ],
    files: sizes,
    hash: createHash('sha1').update(JSON.stringify(sizes)).digest('hex').slice(0, 10),
  };
  writeFileSync(join(OUT, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
  const total = Object.values(sizes).reduce((a, b) => a + b, 0);
  for (const [name, size] of Object.entries(sizes)) console.log(`${name.padEnd(28)} ${(size / 1024).toFixed(0).padStart(7)} KB`);
  console.log(`${'total'.padEnd(28)} ${(total / 1024).toFixed(0).padStart(7)} KB`);
  console.log(meta.counts);
  if (CLEAN) rmSync(WORK, { recursive: true, force: true });
}

main().catch((e) => { console.error(e); process.exit(1); });
